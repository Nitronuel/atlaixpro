import type {
    AlphaGauntletEvent,
    DetectionSnapshotDelta,
    DetectionTriggerDetail,
    DetectionWatchCondition
} from '../src/types';
import { DetectionPairSnapshotStore, DetectionPairSnapshotRow } from './detection-pair-snapshot-store';

const WINDOWS: Array<{ label: DetectionSnapshotDelta['window']; ms: number }> = [
    { label: '5m', ms: 5 * 60 * 1000 },
    { label: '15m', ms: 15 * 60 * 1000 },
    { label: '1h', ms: 60 * 60 * 1000 },
    { label: '6h', ms: 6 * 60 * 60 * 1000 },
    { label: '24h', ms: 24 * 60 * 60 * 1000 }
];

const pct = (current: number, previous: number) => {
    if (!Number.isFinite(current) || !Number.isFinite(previous) || previous <= 0) return 0;
    return ((current - previous) / previous) * 100;
};

const parseNumber = (value: string | number | undefined) => {
    if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
    const raw = String(value || '').replace(/[$,%+\s]/g, '').toUpperCase();
    const parsed = Number.parseFloat(raw);
    if (!Number.isFinite(parsed)) return 0;
    if (raw.includes('T')) return parsed * 1e12;
    if (raw.includes('B')) return parsed * 1e9;
    if (raw.includes('M')) return parsed * 1e6;
    if (raw.includes('K')) return parsed * 1e3;
    return raw.includes('-') ? -parsed : parsed;
};

const round = (value: number, places = 2) => {
    const factor = 10 ** places;
    return Math.round((Number(value) || 0) * factor) / factor;
};

const formatPct = (value: number) => `${value >= 0 ? '+' : ''}${round(value, 1)}%`;

const formatUsd = (value: number) => new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    notation: 'compact',
    maximumFractionDigits: 2
}).format(Number(value || 0));

const capturedMs = (snapshot: DetectionPairSnapshotRow) => new Date(snapshot.captured_at || 0).getTime();

const findBaseline = (snapshots: DetectionPairSnapshotRow[], targetTimestamp: number) => {
    const older = snapshots
        .filter((snapshot) => capturedMs(snapshot) > 0 && capturedMs(snapshot) <= targetTimestamp)
        .sort((a, b) => capturedMs(b) - capturedMs(a));

    return older[0] || null;
};

const buildDelta = (
    event: AlphaGauntletEvent,
    baseline: DetectionPairSnapshotRow,
    window: DetectionSnapshotDelta['window'],
    toCapturedAt: string
): DetectionSnapshotDelta => {
    const currentTxns = event.metrics.transactions24h;
    const previousTxns = Number(baseline.buys_24h || 0) + Number(baseline.sells_24h || 0);
    const currentBuys = parseNumber(event.token.dexBuys);
    const currentSells = parseNumber(event.token.dexSells);

    return {
        window,
        fromCapturedAt: baseline.captured_at || '',
        toCapturedAt,
        liquidityChangePct: round(pct(event.metrics.liquidity, Number(baseline.liquidity_usd || 0))),
        liquidityChangeUsd: round(event.metrics.liquidity - Number(baseline.liquidity_usd || 0)),
        priceChangePct: round(pct(Number(String(event.token.price || '').replace(/[$,\s]/g, '')), Number(baseline.price_usd || 0))),
        volumeChangePct: round(pct(event.metrics.volume24h, Number(baseline.volume_24h || 0))),
        transactionChangePct: round(pct(currentTxns, previousTxns)),
        buyChangePct: round(pct(currentBuys, Number(baseline.buys_24h || 0))),
        sellChangePct: round(pct(currentSells, Number(baseline.sells_24h || 0)))
    };
};

const liquidityTrigger = (delta: DetectionSnapshotDelta): DetectionTriggerDetail | null => {
    if (delta.liquidityChangePct <= -20 && Math.abs(delta.liquidityChangeUsd) >= 25000) {
        return {
            id: `liquidity-contraction-${delta.window}`,
            label: 'Liquidity Contraction',
            kind: 'observed',
            strength: Math.min(100, Math.round(Math.abs(delta.liquidityChangePct) * 2)),
            explanation: `Liquidity fell ${formatPct(delta.liquidityChangePct)} (${formatUsd(Math.abs(delta.liquidityChangeUsd))}) over ${delta.window}.`,
            metrics: {
                window: delta.window,
                liquidityChangePct: delta.liquidityChangePct,
                liquidityChangeUsd: delta.liquidityChangeUsd
            }
        };
    }

    if (delta.liquidityChangePct >= 25 && delta.liquidityChangeUsd >= 25000) {
        return {
            id: `liquidity-expansion-${delta.window}`,
            label: 'Liquidity Expansion',
            kind: 'observed',
            strength: Math.min(100, Math.round(delta.liquidityChangePct * 1.5)),
            explanation: `Liquidity increased ${formatPct(delta.liquidityChangePct)} (${formatUsd(delta.liquidityChangeUsd)}) over ${delta.window}.`,
            metrics: {
                window: delta.window,
                liquidityChangePct: delta.liquidityChangePct,
                liquidityChangeUsd: delta.liquidityChangeUsd
            }
        };
    }

    return null;
};

const volumeTrigger = (event: AlphaGauntletEvent, delta: DetectionSnapshotDelta): DetectionTriggerDetail | null => {
    const volumeToLiquidity = event.metrics.liquidity > 0 ? event.metrics.volume24h / event.metrics.liquidity : 0;
    if (delta.window !== '24h' || delta.volumeChangePct < 50 || volumeToLiquidity < 0.5) return null;

    return {
        id: `volume-expansion-${delta.window}`,
        label: 'Volume Expansion',
        kind: 'observed',
        strength: Math.min(100, Math.round(delta.volumeChangePct)),
        explanation: `24h volume rose ${formatPct(delta.volumeChangePct)} versus the prior 24h and is ${volumeToLiquidity.toFixed(2)}x current liquidity.`,
        metrics: {
            window: delta.window,
            volumeChangePct: delta.volumeChangePct,
            volumeToLiquidity: round(volumeToLiquidity)
        }
    };
};

const tradeAccelerationTrigger = (delta: DetectionSnapshotDelta): DetectionTriggerDetail | null => {
    const threshold = delta.window === '1h' ? 100 : delta.window === '6h' ? 75 : 0;
    if (!threshold || delta.transactionChangePct < threshold) return null;

    return {
        id: `trade-count-acceleration-${delta.window}`,
        label: 'Trade Count Acceleration',
        kind: 'observed',
        strength: Math.min(100, Math.round(delta.transactionChangePct / 2)),
        explanation: `Trade count accelerated ${formatPct(delta.transactionChangePct)} versus ${delta.window} ago.`,
        metrics: {
            window: delta.window,
            transactionChangePct: delta.transactionChangePct
        }
    };
};

const priceMoveTrigger = (event: AlphaGauntletEvent, delta: DetectionSnapshotDelta): DetectionTriggerDetail | null => {
    if (delta.window !== '1h' && delta.window !== '6h' && delta.window !== '24h') return null;
    const sellerDominance = event.metrics.sellVolume24h > event.metrics.buyVolume24h * 1.15;
    const buyerDominance = event.metrics.buyVolume24h > event.metrics.sellVolume24h * 1.15;

    if (delta.priceChangePct <= -10 && sellerDominance) {
        return {
            id: `price-dump-${delta.window}`,
            label: delta.priceChangePct <= -22 ? 'Major Dump' : 'Price Breakdown',
            kind: 'observed',
            strength: Math.min(100, Math.round(Math.abs(delta.priceChangePct) * 3)),
            explanation: `Price fell ${formatPct(delta.priceChangePct)} over ${delta.window} while sell-side flow led buy-side flow.`,
            metrics: {
                window: delta.window,
                priceChangePct: delta.priceChangePct
            }
        };
    }

    if (delta.priceChangePct >= 12 && buyerDominance) {
        return {
            id: `confirmed-recovery-${delta.window}`,
            label: 'Confirmed Recovery',
            kind: 'observed',
            strength: Math.min(100, Math.round(delta.priceChangePct * 2)),
            explanation: `Price recovered ${formatPct(delta.priceChangePct)} over ${delta.window} with buy-side flow leading.`,
            metrics: {
                window: delta.window,
                priceChangePct: delta.priceChangePct
            }
        };
    }

    return null;
};

const buildSnapshotInsights = (deltas: DetectionSnapshotDelta[]) => {
    const insights: string[] = [];
    const shortest = deltas[0];
    const hour = deltas.find((delta) => delta.window === '1h') || shortest;

    if (shortest) {
        if (Math.abs(shortest.liquidityChangePct) >= 10) {
            insights.push(`Liquidity changed ${formatPct(shortest.liquidityChangePct)} over ${shortest.window}.`);
        }
        if (Math.abs(shortest.volumeChangePct) >= 25) {
            insights.push(`24h volume baseline changed ${formatPct(shortest.volumeChangePct)} vs ${shortest.window} ago.`);
        }
    }

    if (hour && Math.abs(hour.priceChangePct) >= 5) {
        insights.push(`Snapshot price moved ${formatPct(hour.priceChangePct)} over ${hour.window}.`);
    }

    if (hour && hour.transactionChangePct >= 25) {
        insights.push(`Trade activity accelerated ${formatPct(hour.transactionChangePct)} over ${hour.window}.`);
    }

    return insights.slice(0, 4);
};

const buildSnapshotWatchConditions = (deltas: DetectionSnapshotDelta[]): DetectionWatchCondition[] => {
    const latest = deltas[0];
    if (!latest) return [];

    return [
        {
            label: 'Liquidity delta stays controlled',
            direction: 'neutral',
            metric: `liquidityChangePct:${latest.window}`,
            threshold: -20,
            explanation: `If liquidity drops more than 20% over ${latest.window}, classify the token as higher liquidity risk.`
        },
        {
            label: 'Volume acceleration confirms signal',
            direction: 'bullish',
            metric: `volumeChangePct:${latest.window}`,
            threshold: 25,
            explanation: `Rising volume over ${latest.window} improves confidence when price and flow agree.`
        }
    ];
};

const mergeUnique = (existing: string[] = [], next: string[] = []) => {
    const seen = new Set<string>();
    return [...existing, ...next].filter((item) => {
        const key = item.toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
};

const applySnapshotClassification = (event: AlphaGauntletEvent, deltas: DetectionSnapshotDelta[]) => {
    const strongestContraction = deltas.find((delta) => delta.liquidityChangePct <= -20 && Math.abs(delta.liquidityChangeUsd) >= 25000);
    const strongestExpansion = deltas.find((delta) => delta.liquidityChangePct >= 25 && delta.liquidityChangeUsd >= 25000);

    if (strongestContraction) {
        const eventType = event.metrics.priceChange24h <= -8 || event.triggers.includes('Strong Sell Pressure')
            ? 'Market Stress'
            : 'Liquidity Event';

        return {
            eventType,
            lane: eventType === 'Market Stress' ? 'Market Stress' : 'Liquidity Risk',
            severity: event.severity === 'Low' ? 'Medium' : event.severity
        } as Pick<AlphaGauntletEvent, 'eventType' | 'lane' | 'severity'>;
    }

    if (strongestExpansion && event.eventType === 'Liquidity Event') {
        return {
            eventType: 'Liquidity Event',
            lane: event.lane || 'Emerging Momentum',
            severity: event.severity
        } as Pick<AlphaGauntletEvent, 'eventType' | 'lane' | 'severity'>;
    }

    return {
        eventType: event.eventType,
        lane: event.lane,
        severity: event.severity
    } as Pick<AlphaGauntletEvent, 'eventType' | 'lane' | 'severity'>;
};

export const enrichEventWithSnapshotDeltas = async (event: AlphaGauntletEvent): Promise<AlphaGauntletEvent> => {
    const tokenAddress = event.token.address;
    if (!tokenAddress) return event;

    try {
        const snapshots = await DetectionPairSnapshotStore.getRecentSnapshots(event.token.chain, tokenAddress, 300);
        if (snapshots.length < 2) return event;

        const now = Date.now();
        const toCapturedAt = new Date().toISOString();
        const deltas = WINDOWS
            .map(({ label, ms }) => {
                const baseline = findBaseline(snapshots, now - ms);
                return baseline ? buildDelta(event, baseline, label, toCapturedAt) : null;
            })
            .filter((delta): delta is DetectionSnapshotDelta => Boolean(delta));

        if (!deltas.length) return event;

        const observedTriggers = deltas
            .flatMap((delta) => [
                liquidityTrigger(delta),
                volumeTrigger(event, delta),
                tradeAccelerationTrigger(delta),
                priceMoveTrigger(event, delta)
            ])
            .filter((trigger): trigger is DetectionTriggerDetail => Boolean(trigger));
        const snapshotInsights = buildSnapshotInsights(deltas);
        const classification = applySnapshotClassification(event, deltas);
        const confidence = event.confidence
            ? {
                ...event.confidence,
                score: Math.min(100, event.confidence.score + 8),
                label: event.confidence.score + 8 >= 75 ? 'High' : event.confidence.score + 8 >= 55 ? 'Medium' : 'Low',
                reasons: mergeUnique(event.confidence.reasons, ['Snapshot history is available for delta-based evidence.']).slice(0, 5)
            }
            : event.confidence;

        const counterSignals = [...(event.counterSignals || [])];
        const liquidityDrop = deltas.find((delta) => delta.liquidityChangePct <= -20 && Math.abs(delta.liquidityChangeUsd) >= 25000);
        if (liquidityDrop) {
            counterSignals.unshift(`Observed liquidity contraction: ${formatPct(liquidityDrop.liquidityChangePct)} over ${liquidityDrop.window}.`);
        }

        const confirmedLabels = new Set(observedTriggers.map((trigger) => trigger.label.toLowerCase()));
        const triggers = [...event.triggers];
        if (confirmedLabels.has('volume expansion') && !triggers.includes('Volume Spike')) triggers.push('Volume Spike');
        if (confirmedLabels.has('confirmed recovery') && !triggers.includes('Confirmed Recovery')) triggers.push('Confirmed Recovery');
        if (confirmedLabels.has('price breakdown') && !triggers.includes('Price Dump')) triggers.push('Price Dump');
        if (confirmedLabels.has('major dump') && !triggers.includes('Major Dump')) triggers.push('Major Dump');

        return {
            ...event,
            ...classification,
            triggers,
            confidence,
            snapshotDeltas: deltas,
            snapshotInsights,
            triggerDetails: [...observedTriggers, ...(event.triggerDetails || [])],
            whyDetected: mergeUnique(snapshotInsights, event.whyDetected || []).slice(0, 5),
            counterSignals: mergeUnique(counterSignals, []).slice(0, 5),
            watchConditions: [...buildSnapshotWatchConditions(deltas), ...(event.watchConditions || [])].slice(0, 5)
        };
    } catch (error) {
        console.warn('[DetectionEngine] snapshot delta enrichment failed', error);
        return event;
    }
};

export const enrichEventsWithSnapshotDeltas = async (events: AlphaGauntletEvent[]) => {
    const enriched: AlphaGauntletEvent[] = [];
    for (const event of events) {
        enriched.push(await enrichEventWithSnapshotDeltas(event));
    }
    return enriched;
};
