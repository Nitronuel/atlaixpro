import type { AlphaGauntletEvent } from '../src/types';
import { AlphaGauntletService } from '../src/services/AlphaGauntletService';
import { ChainActivityService } from '../src/services/ChainActivityService';
import type { RealActivity } from '../src/services/ChainActivityService';
import { DatabaseService } from '../src/services/DatabaseService';
import { ImpactfulTokenActivityStore } from './impactful-token-activity';
import type { ImpactfulTokenActivity } from './impactful-token-activity';
import { DetectionSnapshotStore } from './detection-snapshot-store';
import { DetectionPairSnapshotStore } from './detection-pair-snapshot-store';
import { enrichEventsWithSnapshotDeltas } from './detection-snapshot-delta-enricher';
import { DetectionOutcomeTracker } from './detection-outcome-tracker';
import { buildDetectionImpactActivities } from './token-impact-timeline-builder';

type RunnerStatus = {
    enabled: boolean;
    running: boolean;
    lastRunStartedAt: string | null;
    lastRunCompletedAt: string | null;
    lastRunStatus: 'idle' | 'success' | 'error';
    lastError: string;
    tokensDetected: number;
    tokensWatched: number;
    timelinesPrewarmed: number;
    intervalMs: number;
    topLimit: number;
};

const ONE_HOUR_MS = 60 * 60 * 1000;
const ONE_DAY_MS = 24 * ONE_HOUR_MS;
const DEFAULT_INTERVAL_MS = 5 * 60 * 1000;
const DEFAULT_TOP_LIMIT = 50;
const PREWARM_CONCURRENCY = 2;
const PREWARM_STALE_MS = 10 * 60 * 1000;
const WATCH_REFRESH_BUFFER_MS = 5 * 60 * 1000;
const PREWARM_TIMEOUT_MS = 18_000;
const SNAPSHOT_CLEANUP_INTERVAL_MS = 60 * 60 * 1000;
const WHALE_TRADE_MIN_USD = 100_000;
const LARGE_WALLET_MOVEMENT_MIN_USD = 500_000;

const readNumberEnv = (key: string, fallback: number) => {
    const value = Number(process.env[key]);
    return Number.isFinite(value) && value > 0 ? value : fallback;
};

const readBooleanEnv = (key: string, fallback: boolean) => {
    const value = process.env[key]?.trim().toLowerCase();
    if (value === 'true') return true;
    if (value === 'false') return false;
    return fallback;
};

const withTimeout = async <T>(promise: Promise<T>, timeoutMs: number, fallback: T): Promise<T> => {
    let timeout: ReturnType<typeof setTimeout> | null = null;
    try {
        return await Promise.race([
            promise,
            new Promise<T>((resolve) => {
                timeout = setTimeout(() => resolve(fallback), timeoutMs);
            })
        ]);
    } finally {
        if (timeout) clearTimeout(timeout);
    }
};

const parseCurrencyValue = (value?: string | number) => {
    if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
    const normalized = String(value || '').replace(/[$,\s]/g, '').toUpperCase();
    const multiplier = normalized.endsWith('M') ? 1_000_000 : normalized.endsWith('K') ? 1_000 : 1;
    return (Number(normalized.replace(/[MK]$/, '')) || 0) * multiplier;
};

const getActivityType = (activity: RealActivity): ImpactfulTokenActivity['type'] => {
    switch (activity.type) {
        case 'Buy': return 'Whale Buy';
        case 'Sell': return 'Whale Sell';
        case 'Add Liq': return 'Liquidity Added';
        case 'Remove Liq': return 'Liquidity Removed';
        case 'Burn': return 'Burn';
        default: return 'Whale Transfer';
    }
};

const getActivityTitle = (activity: RealActivity) => {
    switch (activity.type) {
        case 'Buy': return 'Whale Buy';
        case 'Sell': return 'Whale Sell';
        case 'Add Liq': return 'Liquidity Added';
        case 'Remove Liq': return 'Liquidity Removed';
        case 'Burn': return 'Token Burn';
        default: return 'Large Wallet Movement';
    }
};

const getSeverity = (activity: RealActivity, usdValue: number, threshold: number): ImpactfulTokenActivity['severity'] => {
    if (activity.type === 'Sell' && usdValue >= threshold * 3) return 'Critical';
    if (activity.type === 'Remove Liq' && usdValue >= threshold * 2) return 'Critical';
    if (activity.type === 'Sell' || activity.type === 'Remove Liq' || usdValue >= threshold * 3) return 'High';
    return 'Signal';
};

const isImpactful = (activity: RealActivity, usdValue: number, threshold: number) => {
    if ((activity.type === 'Buy' || activity.type === 'Sell') && usdValue >= WHALE_TRADE_MIN_USD) return true;
    if ((activity.type === 'Add Liq' || activity.type === 'Remove Liq') && usdValue >= Math.max(5_000, threshold)) return true;
    if (activity.type === 'Burn' && usdValue >= Math.max(1_000, threshold * 0.25)) return true;
    return activity.type === 'Transfer' && usdValue >= LARGE_WALLET_MOVEMENT_MIN_USD;
};

const toImpactfulActivities = (event: AlphaGauntletEvent, recentActivity: RealActivity[]): ImpactfulTokenActivity[] => {
    const tokenAddress = event.token.address || '';
    const chain = event.token.chain.toLowerCase();
    const liquidityUsd = event.metrics?.liquidity || parseCurrencyValue(event.token.liquidity);
    const whaleThreshold = Math.max(WHALE_TRADE_MIN_USD, liquidityUsd > 0 ? liquidityUsd * 0.005 : WHALE_TRADE_MIN_USD);

    return recentActivity
        .map((activity, index): ImpactfulTokenActivity | null => {
            const usdValue = parseCurrencyValue(activity.usd);
            if (!isImpactful(activity, usdValue, whaleThreshold)) return null;

            return {
                id: `${activity.hash}-${activity.type}-${index}`,
                chain,
                tokenAddress,
                type: getActivityType(activity),
                severity: getSeverity(activity, usdValue, whaleThreshold),
                title: getActivityTitle(activity),
                description: activity.desc,
                usdValue,
                tokenAmount: Number(activity.val || 0),
                wallet: activity.wallet,
                txHash: activity.hash,
                detectedAt: Date.now()
            };
        })
        .filter((activity): activity is ImpactfulTokenActivity => Boolean(activity));
};

export class DetectionEngineRunner {
    private timer: ReturnType<typeof setInterval> | null = null;
    private inFlight = false;
    private watchedUntil = new Map<string, number>();
    private prewarmedAt = new Map<string, number>();
    private status: RunnerStatus;
    private readonly configureWebhooks = readBooleanEnv('DETECTION_ENGINE_CONFIGURE_WEBHOOKS', false);
    private readonly prewarmLimit = readNumberEnv('DETECTION_ENGINE_PREWARM_LIMIT', DEFAULT_TOP_LIMIT);
    private lastSnapshotCleanupAt = 0;

    constructor() {
        this.status = {
            enabled: process.env.DETECTION_ENGINE_ENABLED !== 'false',
            running: false,
            lastRunStartedAt: null,
            lastRunCompletedAt: null,
            lastRunStatus: 'idle',
            lastError: '',
            tokensDetected: 0,
            tokensWatched: 0,
            timelinesPrewarmed: 0,
            intervalMs: readNumberEnv('DETECTION_ENGINE_INTERVAL_MS', DEFAULT_INTERVAL_MS),
            topLimit: readNumberEnv('DETECTION_ENGINE_TOP_LIMIT', DEFAULT_TOP_LIMIT)
        };
    }

    start() {
        if (!this.status.enabled || this.timer) return;

        setTimeout(() => {
            this.runNow().catch((error) => {
                console.warn('[DetectionEngine] initial run failed', error);
            });
        }, readNumberEnv('DETECTION_ENGINE_INITIAL_DELAY_MS', 15_000));

        this.timer = setInterval(() => {
            this.runNow().catch((error) => {
                console.warn('[DetectionEngine] scheduled run failed', error);
            });
        }, this.status.intervalMs);
    }

    getStatus() {
        return {
            ...this.status,
            watchStats: ImpactfulTokenActivityStore.getWatchStats()
        };
    }

    async runNow() {
        if (!this.status.enabled || this.inFlight) return this.getStatus();

        this.inFlight = true;
        this.status.running = true;
        this.status.lastRunStartedAt = new Date().toISOString();
        this.status.lastError = '';

        try {
            const response = await DatabaseService.getMarketData(true, false);
            await DetectionPairSnapshotStore.insertCoinSnapshots(response.data);
            await this.prunePairSnapshotsIfDue();
            const detectedEvents = AlphaGauntletService.getDetectionEvents(response.data);
            const topEvents = detectedEvents
                .filter((event) => Boolean(event.token.address))
                .sort((a, b) => b.score - a.score)
                .slice(0, this.status.topLimit);

            const snapshotAwareTopEvents = await enrichEventsWithSnapshotDeltas(topEvents);
            const sharedTopEvents = await DetectionSnapshotStore.upsertEvents(snapshotAwareTopEvents);
            await DatabaseService.syncDetectionEvents(sharedTopEvents);
            await DetectionOutcomeTracker.recordDueOutcomes(sharedTopEvents);
            await this.persistDetectionTimelineEvents(sharedTopEvents);
            await this.watchTopEvents(sharedTopEvents);
            await this.prewarmTopEvents(sharedTopEvents);

            this.status.tokensDetected = detectedEvents.length;
            this.status.tokensWatched = topEvents.length;
            this.status.lastRunStatus = 'success';
            this.status.lastRunCompletedAt = new Date().toISOString();
            return this.getStatus();
        } catch (error) {
            this.status.lastRunStatus = 'error';
            this.status.lastError = error instanceof Error ? error.message : 'Detection engine run failed.';
            this.status.lastRunCompletedAt = new Date().toISOString();
            console.warn('[DetectionEngine] run failed', error);
            return this.getStatus();
        } finally {
            this.inFlight = false;
            this.status.running = false;
        }
    }

    private async watchTopEvents(events: AlphaGauntletEvent[]) {
        const now = Date.now();

        for (const event of events) {
            const tokenAddress = event.token.address;
            if (!tokenAddress) continue;

            const chain = event.token.chain.toLowerCase();
            const watchKey = `${chain}:${tokenAddress.toLowerCase()}`;
            if ((this.watchedUntil.get(watchKey) || 0) > now + WATCH_REFRESH_BUFFER_MS) continue;

            const ttlMs = event.severity === 'High' ? ONE_DAY_MS : ONE_HOUR_MS;
            await ImpactfulTokenActivityStore.watchToken({
                chain,
                tokenAddress,
                pairAddress: event.token.pairAddress,
                priceUsd: parseCurrencyValue(event.token.price),
                liquidityUsd: event.metrics?.liquidity || parseCurrencyValue(event.token.liquidity),
                ttlMs,
                configureWebhook: this.configureWebhooks
            });
            this.watchedUntil.set(watchKey, now + ttlMs);
        }
    }

    private async prunePairSnapshotsIfDue() {
        const now = Date.now();
        if (now - this.lastSnapshotCleanupAt < SNAPSHOT_CLEANUP_INTERVAL_MS) return;
        this.lastSnapshotCleanupAt = now;
        await DetectionPairSnapshotStore.pruneOldSnapshots();
    }

    private async persistDetectionTimelineEvents(events: AlphaGauntletEvent[]) {
        let warmed = 0;

        for (const event of events) {
            const tokenAddress = event.token.address;
            if (!tokenAddress) continue;

            const chain = event.token.chain.toLowerCase();
            const activities = buildDetectionImpactActivities(event);
            if (!activities.length) continue;

            ImpactfulTokenActivityStore.cacheActivities(chain, tokenAddress, activities);
            warmed += 1;
        }

        this.status.timelinesPrewarmed += warmed;
    }

    private async prewarmTopEvents(events: AlphaGauntletEvent[]) {
        const now = Date.now();
        const candidates = events
            .filter((event) => {
                const tokenAddress = event.token.address;
                if (!tokenAddress) return false;
                const key = `${event.token.chain.toLowerCase()}:${tokenAddress.toLowerCase()}`;
                return now - (this.prewarmedAt.get(key) || 0) >= PREWARM_STALE_MS;
            })
            .slice(0, this.prewarmLimit);

        let cursor = 0;
        let prewarmed = 0;
        const workers = Array.from({ length: PREWARM_CONCURRENCY }, async () => {
            while (cursor < candidates.length) {
                const event = candidates[cursor++];
                const tokenAddress = event.token.address;
                if (!tokenAddress) continue;

                const chain = event.token.chain.toLowerCase();
                const key = `${chain}:${tokenAddress.toLowerCase()}`;
                const priceUsd = parseCurrencyValue(event.token.price);
                const recentActivity = await withTimeout(
                    ChainActivityService.getTokenActivity(tokenAddress, chain, priceUsd, event.token.pairAddress),
                    PREWARM_TIMEOUT_MS,
                    []
                );
                const impactful = toImpactfulActivities(event, recentActivity);

                if (impactful.length > 0) {
                    ImpactfulTokenActivityStore.cacheActivities(chain, tokenAddress, impactful);
                    prewarmed += 1;
                }

                this.prewarmedAt.set(key, Date.now());
            }
        });

        await Promise.all(workers);
        this.status.timelinesPrewarmed += prewarmed;
    }
}
