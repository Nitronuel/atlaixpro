import { createClient } from '@supabase/supabase-js';
import type { AlphaGauntletEvent, MarketCoin } from '../src/types';
import { AlphaGauntletService } from '../src/services/AlphaGauntletService';
import { DatabaseService } from '../src/services/DatabaseService';
import {
    evaluateSmartAlertRule,
    getThresholdKindForCondition,
    normalizeSmartAlertCondition,
    type SmartAlertCondition,
    type SmartAlertMarketSnapshot,
    type SmartAlertRuleSnapshot,
    type SmartAlertThresholdKind,
    type SmartAlertType
} from './smart-alert-evaluator';

type SmartAlertRuleRow = SmartAlertRuleSnapshot & {
    token_address: string | null;
    threshold_kind: SmartAlertThresholdKind | string | null;
    enabled: boolean;
    trigger_count: number | null;
    metadata?: SmartAlertRuleMetadata | null;
    created_at?: string | null;
};

type LinkedAlertConditionMetadata = {
    id: string;
    alertType: SmartAlertType;
    condition: SmartAlertCondition;
    thresholdKind: SmartAlertThresholdKind;
    threshold: string;
    label: string;
    status?: 'pending' | 'met' | 'expired' | 'error';
    metAt?: string | null;
    observedValue?: string | null;
    baselineValue?: number | null;
    lastError?: string | null;
};

type SmartAlertRuleMetadata = {
    alertMode?: 'single' | 'linked';
    token?: {
        address?: string;
        pairAddress?: string | null;
        chainId?: string;
        name?: string;
        symbol?: string;
    } | null;
    matchLogic?: 'all';
    timeWindowMinutes?: number | null;
    status?: 'active' | 'paused' | 'completed' | 'expired';
    conditions?: LinkedAlertConditionMetadata[];
    completedAt?: string | null;
};

type SmartAlertStatus = {
    enabled: boolean;
    running: boolean;
    lastRunStartedAt: string | null;
    lastRunCompletedAt: string | null;
    lastRunStatus: 'idle' | 'success' | 'error';
    lastError: string;
    intervalMs: number;
    batchSize: number;
    rulesChecked: number;
    triggersCreated: number;
};

const ALERT_RULE_COLUMNS = [
    'id',
    'user_id',
    'alert_type',
    'target',
    'chain_id',
    'token_address',
    'condition',
    'threshold_kind',
    'threshold',
    'trigger_label',
    'cooldown_minutes',
    'enabled',
    'last_triggered_at',
    'baseline_value',
    'trigger_count',
    'metadata',
    'created_at'
].join(',');

const LEGACY_ALERT_RULE_COLUMNS = ALERT_RULE_COLUMNS
    .split(',')
    .filter((column) => column !== 'metadata')
    .join(',');

const readEnv = (...keys: string[]) => {
    for (const key of keys) {
        const value = process.env[key]?.trim();
        if (value) return value;
    }
    return '';
};

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

const parseMetric = (value: string | number | undefined | null) => {
    if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
    const raw = String(value || '').replace(/[$,%+\s]/g, '').toUpperCase();
    const parsed = Number.parseFloat(raw);
    if (!Number.isFinite(parsed)) return 0;
    const signed = raw.startsWith('-') ? -Math.abs(parsed) : parsed;
    if (raw.includes('T')) return signed * 1e12;
    if (raw.includes('B')) return signed * 1e9;
    if (raw.includes('M')) return signed * 1e6;
    if (raw.includes('K')) return signed * 1e3;
    return signed;
};

const normalizeText = (value: string | undefined | null) => String(value || '').trim().toLowerCase();

const tokenMatchesRule = (coin: MarketCoin, rule: SmartAlertRuleRow) => {
    const tokenAddress = normalizeText(rule.token_address);
    if (tokenAddress) {
        return normalizeText(coin.address) === tokenAddress || normalizeText(coin.pairAddress) === tokenAddress;
    }

    const target = normalizeText(rule.target);
    if (!target || target === 'any token') return true;

    return normalizeText(coin.ticker) === target ||
        normalizeText(coin.name) === target ||
        normalizeText(coin.address) === target ||
        normalizeText(coin.pairAddress) === target;
};

const coinToSnapshot = (coin: MarketCoin): SmartAlertMarketSnapshot => {
    const buyVolume = parseMetric(coin.buyVolume24h);
    const sellVolume = parseMetric(coin.sellVolume24h);
    const whaleUsd = Math.max(Math.abs(parseMetric(coin.netFlow)), buyVolume, sellVolume);

    return {
        tokenLabel: coin.ticker || coin.name,
        tokenAddress: coin.address || coin.pairAddress || coin.ticker,
        priceUsd: parseMetric(coin.price),
        volume24hUsd: parseMetric(coin.volume24h),
        liquidityUsd: parseMetric(coin.liquidity),
        whaleUsd,
        whaleSide: coin.smartMoneySignal === 'Outflow' || sellVolume > buyVolume ? 'sell' : 'buy',
        riskSeverity: coin.riskLevel
    };
};

const eventToSnapshot = (event: AlphaGauntletEvent): SmartAlertMarketSnapshot => ({
    ...coinToSnapshot(event.token),
    alphaEvent: event.eventType,
    tokenLabel: event.token.ticker || event.token.name,
    tokenAddress: event.token.address || event.token.pairAddress || event.token.ticker
});

export class SmartAlertRunner {
    private timer: ReturnType<typeof setInterval> | null = null;
    private inFlight = false;
    private supabaseClient: any | null | undefined;
    private supabaseAvailable = true;
    private hasWarnedAboutSupabase = false;
    private status: SmartAlertStatus;

    constructor() {
        this.status = {
            enabled: readBooleanEnv('SMART_ALERTS_ENABLED', true),
            running: false,
            lastRunStartedAt: null,
            lastRunCompletedAt: null,
            lastRunStatus: 'idle',
            lastError: '',
            intervalMs: readNumberEnv('SMART_ALERTS_INTERVAL_MS', 60_000),
            batchSize: readNumberEnv('SMART_ALERTS_BATCH_SIZE', 100),
            rulesChecked: 0,
            triggersCreated: 0
        };
    }

    start() {
        if (!this.status.enabled || this.timer) return;

        setTimeout(() => {
            this.runNow().catch((error) => {
                console.warn('[SmartAlerts] initial run failed', error);
            });
        }, readNumberEnv('SMART_ALERTS_INITIAL_DELAY_MS', 10_000));

        this.timer = setInterval(() => {
            this.runNow().catch((error) => {
                console.warn('[SmartAlerts] scheduled run failed', error);
            });
        }, this.status.intervalMs);
    }

    getStatus() {
        return { ...this.status };
    }

    async runNow() {
        if (!this.status.enabled || this.inFlight) return this.getStatus();

        this.inFlight = true;
        this.status.running = true;
        this.status.lastRunStartedAt = new Date().toISOString();
        this.status.lastError = '';

        try {
            const supabase = this.getSupabase();
            if (!supabase) {
                this.status.lastRunStatus = 'error';
                this.status.lastError = 'Supabase service-role credentials are not configured for Smart Alerts.';
                return this.getStatus();
            }

            const rules = await this.loadEnabledRules(supabase);
            if (!rules.length) {
                this.status.rulesChecked = 0;
                this.status.triggersCreated = 0;
                this.status.lastRunStatus = 'success';
                return this.getStatus();
            }

            const response = await DatabaseService.getMarketData(true, false);
            const marketCoins = response.data || [];
            const alphaEvents = AlphaGauntletService.getDetectionEvents(marketCoins);
            let triggersCreated = 0;

            for (const rule of rules) {
                const created = await this.evaluateRule(supabase, rule, marketCoins, alphaEvents);
                triggersCreated += created;
            }

            this.status.rulesChecked = rules.length;
            this.status.triggersCreated = triggersCreated;
            this.status.lastRunStatus = 'success';
            return this.getStatus();
        } catch (error) {
            this.status.lastRunStatus = 'error';
            this.status.lastError = error instanceof Error ? error.message : 'Smart Alert runner failed.';
            console.warn('[SmartAlerts] run failed', error);
            return this.getStatus();
        } finally {
            this.status.lastRunCompletedAt = new Date().toISOString();
            this.status.running = false;
            this.inFlight = false;
        }
    }

    private getSupabase() {
        if (!this.supabaseAvailable) return null;
        if (this.supabaseClient !== undefined) return this.supabaseClient;

        const url = readEnv('SUPABASE_URL', 'VITE_SUPABASE_URL');
        const key = readEnv('SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_SERVICE_KEY');

        if (!url || !key) {
            this.warnSupabaseOnce('[SmartAlerts] Supabase service-role credentials are missing; saved alerts will not be evaluated.');
            this.supabaseClient = null;
            return this.supabaseClient;
        }

        this.supabaseClient = createClient(url, key, {
            auth: {
                persistSession: false,
                autoRefreshToken: false
            }
        });

        return this.supabaseClient;
    }

    private warnSupabaseOnce(message: string) {
        if (this.hasWarnedAboutSupabase) return;
        this.hasWarnedAboutSupabase = true;
        console.warn(message);
    }

    private async loadEnabledRules(supabase: any): Promise<SmartAlertRuleRow[]> {
        let { data, error } = await supabase
            .from('alert_rules')
            .select(ALERT_RULE_COLUMNS)
            .eq('enabled', true)
            .order('last_checked_at', { ascending: true, nullsFirst: true })
            .limit(this.status.batchSize);

        if (error?.code === '42703') {
            ({ data, error } = await supabase
                .from('alert_rules')
                .select(LEGACY_ALERT_RULE_COLUMNS)
                .eq('enabled', true)
                .order('last_checked_at', { ascending: true, nullsFirst: true })
                .limit(this.status.batchSize));
        }

        if (error) throw error;

        return (data || []).map((row: any) => {
            const condition = normalizeSmartAlertCondition(row.condition || 'above');
            return {
                ...row,
                condition,
                threshold_kind: row.threshold_kind || getThresholdKindForCondition(row.alert_type, condition),
                cooldown_minutes: Number(row.cooldown_minutes || 60),
                trigger_count: Number(row.trigger_count || 0),
                baseline_value: row.baseline_value === null || row.baseline_value === undefined ? null : Number(row.baseline_value)
            };
        });
    }

    private getSnapshotsForRule(
        rule: SmartAlertRuleRow,
        marketCoins: MarketCoin[],
        alphaEvents: AlphaGauntletEvent[]
    ): SmartAlertMarketSnapshot[] {
        const chain = normalizeText(rule.chain_id);
        const coins = marketCoins
            .filter((coin) => !chain || normalizeText(coin.chain) === chain)
            .filter((coin) => tokenMatchesRule(coin, rule));

        if (rule.alert_type === 'Alpha') {
            const events = alphaEvents
                .filter((event) => !chain || normalizeText(event.token.chain) === chain)
                .filter((event) => tokenMatchesRule(event.token, rule));
            return events.map(eventToSnapshot);
        }

        return coins.map(coinToSnapshot);
    }

    private async evaluateRule(
        supabase: any,
        rule: SmartAlertRuleRow,
        marketCoins: MarketCoin[],
        alphaEvents: AlphaGauntletEvent[]
    ) {
        if (rule.metadata?.alertMode === 'linked') {
            return this.evaluateLinkedRule(supabase, rule, marketCoins, alphaEvents);
        }

        const now = new Date();
        const snapshots = this.getSnapshotsForRule(rule, marketCoins, alphaEvents);

        if (!snapshots.length) {
            await this.updateRuleEvaluation(supabase, rule, {
                last_checked_at: now.toISOString(),
                last_error: 'No matching market snapshot was available for this alert.'
            });
            return 0;
        }

        let triggersCreated = 0;
        let lastObservedValue: string | null = null;
        let lastObservedNumber: number | null = null;
        let nextBaselineValue: number | null = null;
        let lastError: string | null = null;

        for (const snapshot of snapshots) {
            const result = evaluateSmartAlertRule(rule, snapshot, now);
            lastObservedValue = result.observedValue;
            lastObservedNumber = result.observedNumber;
            lastError = result.lastError;
            if (result.nextBaselineValue !== null) nextBaselineValue = result.nextBaselineValue;

            if (!result.shouldTrigger) continue;

            const inserted = await this.insertTrigger(supabase, rule, snapshot, result, now);
            if (inserted) triggersCreated += 1;

            await this.updateRuleEvaluation(supabase, rule, {
                last_triggered_at: now.toISOString(),
                trigger_count: Number(rule.trigger_count || 0) + triggersCreated,
                ...(result.nextBaselineValue !== null ? {
                    baseline_value: result.nextBaselineValue,
                    baseline_observed_at: now.toISOString()
                } : {})
            });

            if (normalizeText(rule.target) !== 'any token') break;
        }

        await this.updateRuleEvaluation(supabase, rule, {
            last_checked_at: now.toISOString(),
            last_observed_value: lastObservedValue,
            last_observed_at: now.toISOString(),
            last_error: lastError,
            ...(nextBaselineValue !== null ? {
                baseline_value: nextBaselineValue,
                baseline_observed_at: now.toISOString()
            } : {}),
            ...(lastObservedNumber !== null && normalizeSmartAlertCondition(rule.condition) !== 'changes_by_percent' ? {
                baseline_value: lastObservedNumber,
                baseline_observed_at: now.toISOString()
            } : {})
        });

        return triggersCreated;
    }

    private async evaluateLinkedRule(
        supabase: any,
        rule: SmartAlertRuleRow,
        marketCoins: MarketCoin[],
        alphaEvents: AlphaGauntletEvent[]
    ) {
        const now = new Date();
        const metadata = rule.metadata || {};
        const conditions = Array.isArray(metadata.conditions) ? metadata.conditions : [];

        if (!conditions.length || metadata.status === 'completed' || metadata.status === 'expired') {
            await this.updateRuleEvaluation(supabase, rule, {
                last_checked_at: now.toISOString()
            });
            return 0;
        }

        const createdAt = new Date((rule as any).created_at || now.toISOString()).getTime();
        if (metadata.timeWindowMinutes && Number.isFinite(createdAt) && now.getTime() - createdAt > metadata.timeWindowMinutes * 60_000) {
            await this.updateRuleEvaluation(supabase, rule, {
                last_checked_at: now.toISOString(),
                metadata: {
                    ...metadata,
                    status: 'expired',
                    conditions: conditions.map((condition) => condition.status === 'met' ? condition : { ...condition, status: 'expired' })
                }
            });
            return 0;
        }

        const snapshots = this.getSnapshotsForRule(rule, marketCoins, alphaEvents);
        if (!snapshots.length) {
            await this.updateRuleEvaluation(supabase, rule, {
                last_checked_at: now.toISOString(),
                last_error: 'No matching market snapshot was available for this linked alert request.'
            });
            return 0;
        }

        const snapshot = snapshots[0];
        let triggersCreated = 0;
        let lastObservedValue: string | null = null;
        let lastError: string | null = null;

        const nextConditions = [];
        for (const condition of conditions) {
            if (condition.status === 'met') {
                nextConditions.push(condition);
                continue;
            }

            const conditionRule: SmartAlertRuleSnapshot = {
                id: `${rule.id}:${condition.id}`,
                user_id: rule.user_id,
                alert_type: condition.alertType,
                target: rule.target,
                chain_id: rule.chain_id,
                condition: condition.condition,
                threshold_kind: condition.thresholdKind,
                threshold: condition.threshold,
                trigger_label: condition.label,
                cooldown_minutes: rule.cooldown_minutes,
                last_triggered_at: null,
                baseline_value: condition.baselineValue ?? null
            };
            const result = evaluateSmartAlertRule(conditionRule, snapshot, now);
            lastObservedValue = result.observedValue;
            lastError = result.lastError;

            const nextCondition: LinkedAlertConditionMetadata = {
                ...condition,
                observedValue: result.observedValue,
                lastError: result.lastError,
                ...(result.nextBaselineValue !== null ? { baselineValue: result.nextBaselineValue } : {})
            };

            if (result.shouldTrigger) {
                nextCondition.status = 'met';
                nextCondition.metAt = now.toISOString();
                const inserted = await this.insertLinkedTrigger(supabase, rule, snapshot, {
                    title: 'Partial target met',
                    message: `${condition.label} met for ${snapshot.tokenLabel || rule.target}.`,
                    observedValue: result.observedValue,
                    threshold: condition.threshold,
                    dedupeKey: `${rule.id}:${condition.id}:partial`,
                    metadata: {
                        eventType: 'partial_met',
                        conditionId: condition.id,
                        tokenLabel: snapshot.tokenLabel || null,
                        tokenAddress: snapshot.tokenAddress || null,
                        completedConditions: nextConditions.filter((item) => item.status === 'met').length + 1,
                        totalConditions: conditions.length,
                        evaluatedAt: now.toISOString()
                    }
                }, now);
                if (inserted) triggersCreated += 1;
            }

            nextConditions.push(nextCondition);
        }

        const completedConditions = nextConditions.filter((condition) => condition.status === 'met').length;
        const allConditionsMet = completedConditions === nextConditions.length;
        let nextMetadata: SmartAlertRuleMetadata = {
            ...metadata,
            status: allConditionsMet ? 'completed' : 'active',
            conditions: nextConditions,
            ...(allConditionsMet ? { completedAt: now.toISOString() } : {})
        };

        if (allConditionsMet) {
            const inserted = await this.insertLinkedTrigger(supabase, rule, snapshot, {
                title: 'Linked alert triggered',
                message: `All ${nextConditions.length} linked conditions were met for ${snapshot.tokenLabel || rule.target}.`,
                observedValue: lastObservedValue,
                threshold: `${nextConditions.length} conditions`,
                dedupeKey: `${rule.id}:linked-complete`,
                metadata: {
                    eventType: 'linked_triggered',
                    tokenLabel: snapshot.tokenLabel || null,
                    tokenAddress: snapshot.tokenAddress || null,
                    completedConditions,
                    totalConditions: nextConditions.length,
                    evaluatedAt: now.toISOString()
                }
            }, now);
            if (inserted) triggersCreated += 1;
        }

        await this.updateRuleEvaluation(supabase, rule, {
            last_checked_at: now.toISOString(),
            last_observed_value: lastObservedValue,
            last_observed_at: now.toISOString(),
            last_error: lastError,
            metadata: nextMetadata,
            ...(allConditionsMet ? {
                last_triggered_at: now.toISOString(),
                trigger_count: Number(rule.trigger_count || 0) + triggersCreated
            } : triggersCreated ? {
                trigger_count: Number(rule.trigger_count || 0) + triggersCreated
            } : {})
        });

        return triggersCreated;
    }

    private async insertTrigger(
        supabase: any,
        rule: SmartAlertRuleRow,
        snapshot: SmartAlertMarketSnapshot,
        result: ReturnType<typeof evaluateSmartAlertRule>,
        now: Date
    ) {
        const { data, error } = await supabase
            .from('alert_triggers')
            .insert({
                alert_rule_id: rule.id,
                user_id: rule.user_id,
                alert_type: rule.alert_type,
                title: `${rule.alert_type} Alert`,
                message: result.message,
                observed_value: result.observedValue,
                threshold: rule.threshold,
                source: 'smart-alert-runner',
                dedupe_key: result.dedupeKey,
                metadata: {
                    tokenLabel: snapshot.tokenLabel || null,
                    tokenAddress: snapshot.tokenAddress || null,
                    condition: normalizeSmartAlertCondition(rule.condition),
                    thresholdKind: rule.threshold_kind,
                    evaluatedAt: now.toISOString()
                },
                created_at: now.toISOString()
            })
            .select('id');

        if (error?.code === '23505') return false;
        if (error) throw error;
        return Boolean(data && data.length > 0);
    }

    private async insertLinkedTrigger(
        supabase: any,
        rule: SmartAlertRuleRow,
        snapshot: SmartAlertMarketSnapshot,
        event: {
            title: string;
            message: string;
            observedValue: string | null;
            threshold: string | null;
            dedupeKey: string;
            metadata: Record<string, unknown>;
        },
        now: Date
    ) {
        const { data, error } = await supabase
            .from('alert_triggers')
            .insert({
                alert_rule_id: rule.id,
                user_id: rule.user_id,
                alert_type: rule.alert_type,
                title: event.title,
                message: event.message,
                observed_value: event.observedValue,
                threshold: event.threshold,
                source: 'smart-alert-runner',
                dedupe_key: event.dedupeKey,
                metadata: event.metadata,
                created_at: now.toISOString()
            })
            .select('id');

        if (error?.code === '23505') return false;
        if (error) throw error;
        return Boolean(data && data.length > 0);
    }

    private async updateRuleEvaluation(supabase: any, rule: SmartAlertRuleRow, patch: Record<string, unknown>) {
        const { error } = await supabase
            .from('alert_rules')
            .update(patch)
            .eq('id', rule.id);

        if (error) throw error;
    }
}
