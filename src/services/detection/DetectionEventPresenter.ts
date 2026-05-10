import {
    AlphaGauntletEvent,
    AlphaGauntletEventType,
    AlphaGauntletTrigger,
    DetectionConfidence,
    DetectionLane,
    DetectionTriggerDetail,
    DetectionWatchCondition
} from '../../types';

const clamp = (value: number, min = 0, max = 100) => Math.max(min, Math.min(max, value));

const formatCompactUsd = (value: number) => {
    if (!Number.isFinite(value) || value <= 0) return '$0';
    return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
        notation: 'compact',
        maximumFractionDigits: 2
    }).format(value);
};

export const HONEST_TRIGGER_LABELS: Record<AlphaGauntletTrigger, string> = {
    'Elevated Volume': 'Elevated Volume Relative to Liquidity',
    'Volume Spike': 'Volume Expansion',
    'Transaction Spike': 'Trade Count Acceleration',
    'Strong Buy Pressure': 'Buyer Dominance',
    'Strong Sell Pressure': 'Seller Dominance',
    'Liquidity Added': 'Deep Liquidity Structure',
    'Liquidity Removed': 'Thin Liquidity Risk',
    'Holder Growth Spike': 'Active Trade Proxy Spike',
    'Sharp Pullback': 'Sharp Pullback',
    'Price Dump': 'Price Breakdown',
    'Major Dump': 'Major Dump',
    'Price Recovery': 'Recovery Attempt',
    'Confirmed Recovery': 'Confirmed Recovery',
    'Abnormal Large Trades': 'Large Flow Imbalance',
    'Possible Artificial Volume': 'Possible Artificial Volume'
};

export const getHonestTriggerLabel = (trigger: AlphaGauntletTrigger | string) => {
    return HONEST_TRIGGER_LABELS[trigger as AlphaGauntletTrigger] || trigger;
};

const triggerId = (trigger: AlphaGauntletTrigger) => trigger.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

const triggerStrength = (trigger: AlphaGauntletTrigger, event: AlphaGauntletEvent) => {
    const metrics = event.metrics;
    const volumeToLiquidity = metrics.liquidity > 0 ? metrics.volume24h / metrics.liquidity : 0;
    const buySellSkew = Math.abs((metrics.buySellRatio || 1) - 1);
    const netFlowShare = metrics.volume24h > 0 ? Math.abs(metrics.netFlow) / metrics.volume24h : 0;

    switch (trigger) {
        case 'Elevated Volume':
            return clamp(volumeToLiquidity * 28);
        case 'Volume Spike':
            return clamp(volumeToLiquidity * 35);
        case 'Transaction Spike':
            return clamp((metrics.transactions24h / 4000) * 100);
        case 'Strong Buy Pressure':
        case 'Strong Sell Pressure':
            return clamp((buySellSkew / 1.25) * 100 + netFlowShare * 30);
        case 'Liquidity Added':
            return clamp((metrics.lpToMarketCapRatio / 0.25) * 100);
        case 'Liquidity Removed':
            return clamp((0.12 - metrics.lpToMarketCapRatio) * 900);
        case 'Holder Growth Spike':
            return clamp((metrics.holders / 5000) * 100);
        case 'Sharp Pullback':
            return clamp(Math.abs(metrics.priceChange24h) * 1.8);
        case 'Price Dump':
        case 'Major Dump':
        case 'Price Recovery':
        case 'Confirmed Recovery':
            return clamp(Math.abs(metrics.priceChange24h) * 2.5);
        case 'Abnormal Large Trades':
            return clamp(netFlowShare * 350);
        case 'Possible Artificial Volume':
            return clamp(volumeToLiquidity * 18 + (metrics.transactions24h / 10000) * 40);
        default:
            return 50;
    }
};

const triggerExplanation = (trigger: AlphaGauntletTrigger, event: AlphaGauntletEvent) => {
    const m = event.metrics;
    const volumeToLiquidity = m.liquidity > 0 ? m.volume24h / m.liquidity : 0;
    const netFlow = formatCompactUsd(Math.abs(m.netFlow));

    switch (trigger) {
        case 'Elevated Volume':
            return `24h volume is ${volumeToLiquidity.toFixed(2)}x current liquidity. Historical volume baseline is still needed before calling this true expansion.`;
        case 'Volume Spike':
            return `24h volume expanded versus the available baseline and is ${volumeToLiquidity.toFixed(2)}x current liquidity.`;
        case 'Transaction Spike':
            return `${m.transactions24h.toLocaleString()} buys/sells were observed over 24h, so trade activity is elevated.`;
        case 'Strong Buy Pressure':
            return `Buy-side USD flow leads sell-side flow with an estimated ${formatCompactUsd(Math.max(m.buyVolume24h, 0))} buy volume.`;
        case 'Strong Sell Pressure':
            return `Sell-side USD flow is elevated with estimated sell volume of ${formatCompactUsd(Math.max(m.sellVolume24h, 0))}.`;
        case 'Liquidity Added':
            return `Liquidity depth is high relative to market cap, but no historical snapshot has confirmed fresh liquidity was added yet.`;
        case 'Liquidity Removed':
            return `Liquidity is thin relative to market cap and volume, but no historical snapshot has confirmed actual removal yet.`;
        case 'Holder Growth Spike':
            return `The current holder figure is an active-trade proxy, not verified holder growth.`;
        case 'Sharp Pullback':
            return `Price is showing a sharp short-window pullback; sell flow and liquidity context decide whether it becomes a dump.`;
        case 'Price Dump':
            return `Price is down ${m.priceChange24h.toFixed(2)}% over 24h with sell-side or liquidity context supporting the move.`;
        case 'Major Dump':
            return `Price is down ${m.priceChange24h.toFixed(2)}% over 24h with enough activity to classify the move as major stress.`;
        case 'Price Recovery':
            return `Price is bouncing with ${m.priceChange24h >= 0 ? '+' : ''}${m.priceChange24h.toFixed(2)}% 24h movement, but prior drawdown still needs snapshot confirmation.`;
        case 'Confirmed Recovery':
            return `Price recovery is supported by buy-side flow and controlled liquidity conditions.`;
        case 'Abnormal Large Trades':
            return `Net flow is ${netFlow}, suggesting a large aggregate flow imbalance rather than a single-wallet whale trade.`;
        case 'Possible Artificial Volume':
            return `High activity is paired with balanced buy/sell flow and muted price movement, a pattern that can resemble artificial volume.`;
        default:
            return `${getHonestTriggerLabel(trigger)} contributed to this detection.`;
    }
};

const triggerKind = (trigger: AlphaGauntletTrigger) => {
    if (trigger === 'Liquidity Added' || trigger === 'Liquidity Removed' || trigger === 'Holder Growth Spike') return 'inferred';
    if (trigger === 'Elevated Volume') return 'inferred';
    if (trigger === 'Abnormal Large Trades' || trigger === 'Possible Artificial Volume') return 'derived';
    return 'derived';
};

export const buildTriggerDetails = (event: AlphaGauntletEvent): DetectionTriggerDetail[] => {
    return event.triggers.map((trigger) => ({
        id: triggerId(trigger),
        label: getHonestTriggerLabel(trigger),
        kind: triggerKind(trigger),
        strength: Math.round(triggerStrength(trigger, event)),
        explanation: triggerExplanation(trigger, event),
        metrics: {
            volume24h: event.metrics.volume24h,
            liquidity: event.metrics.liquidity,
            marketCap: event.metrics.marketCap,
            buySellRatio: Number(event.metrics.buySellRatio.toFixed(3)),
            netFlow: event.metrics.netFlow
        }
    }));
};

export const inferDetectionLane = (event: AlphaGauntletEvent): DetectionLane => {
    const ageHours = event.metrics.ageHours;
    const lpRatio = event.metrics.lpToMarketCapRatio;

    if (event.eventType === 'Market Stress') return 'Market Stress';
    if (event.triggers.includes('Liquidity Removed') || lpRatio <= 0.08) return 'Liquidity Risk';
    if (ageHours <= 6) return 'Fresh Launch';
    if (ageHours <= 72) return 'Emerging Momentum';
    if (event.score < 72) return 'Watchlist Candidate';
    return 'Established Momentum';
};

export const buildConfidence = (event: AlphaGauntletEvent): DetectionConfidence => {
    let score = 72;
    const reasons: string[] = [];

    if (event.metrics.ageHours < 6) {
        score -= 12;
        reasons.push('Fresh token, limited history.');
    } else {
        reasons.push('Token has enough age for basic market context.');
    }

    if (event.triggers.some((trigger) => trigger === 'Liquidity Added' || trigger === 'Liquidity Removed')) {
        score -= 10;
        reasons.push('Liquidity signal is inferred until snapshot history confirms a real change.');
    }

    if (event.triggers.includes('Holder Growth Spike')) {
        score -= 12;
        reasons.push('Active-wallet/holder signal is a proxy, not verified holder growth.');
    }

    if (event.metrics.volume24h > 0 && event.metrics.liquidity > 0) {
        reasons.push('DexScreener market, liquidity, and volume fields are available.');
    } else {
        score -= 15;
        reasons.push('Some market fields are missing or zero.');
    }

    if (event.metrics.transactions24h >= 500 && event.metrics.buySellRatio > 0) {
        reasons.push('Buy/sell activity is available for direction checks.');
    } else {
        score -= 10;
        reasons.push('Buy/sell activity is incomplete.');
    }

    if (event.triggers.includes('Strong Buy Pressure') && event.triggers.includes('Strong Sell Pressure')) {
        score -= 8;
        reasons.push('Buy and sell signals conflict.');
    }

    const normalized = clamp(score);
    return {
        score: Math.round(normalized),
        label: normalized >= 75 ? 'High' : normalized >= 55 ? 'Medium' : 'Low',
        reasons: reasons.slice(0, 4)
    };
};

export const buildWhyDetected = (event: AlphaGauntletEvent): string[] => {
    const labels = (event.triggerDetails?.length ? event.triggerDetails : buildTriggerDetails(event))
        .slice(0, 3)
        .map((trigger) => `${trigger.label}: ${trigger.explanation}`);

    if (labels.length) return labels;
    return [`${event.token.ticker} met the current Detection Engine activity threshold.`];
};

export const buildCounterSignals = (event: AlphaGauntletEvent): string[] => {
    const counters: string[] = [];
    const m = event.metrics;

    if (event.triggers.includes('Liquidity Added')) {
        counters.push('Liquidity depth is inferred from the current ratio; snapshot history has not confirmed fresh liquidity addition yet.');
    }

    if (event.triggers.includes('Liquidity Removed')) {
        counters.push('Thin liquidity does not prove liquidity was removed; it should be treated as liquidity risk until snapshots confirm contraction.');
    }

    if (event.triggers.includes('Holder Growth Spike')) {
        counters.push('Holder growth is not verified; current logic uses an active-trade proxy.');
    }

    if (m.priceChange24h > 10 && m.netFlow < 0) {
        counters.push('Price is positive while estimated net flow is negative, which can indicate distribution into strength.');
    }

    if (m.priceChange24h < -8 && m.netFlow > 0) {
        counters.push('Price is weak while estimated net flow is positive, so this may be absorption or delayed price response.');
    }

    if (m.liquidity > 0 && m.volume24h / m.liquidity >= 5) {
        counters.push('Volume turnover is very high relative to liquidity, so execution risk may be elevated.');
    }

    return counters.slice(0, 4);
};

export const buildWatchConditions = (event: AlphaGauntletEvent): DetectionWatchCondition[] => {
    const m = event.metrics;
    const conditions: DetectionWatchCondition[] = [];

    if (event.eventType === 'Accumulation' || event.triggers.includes('Strong Buy Pressure')) {
        conditions.push({
            label: 'Buyer dominance holds',
            direction: 'bullish',
            metric: 'buySellRatio',
            threshold: 1.25,
            explanation: 'Signal improves if buy-side activity stays ahead of sell-side activity.'
        });
    }

    if (event.eventType === 'Market Stress' || event.triggers.includes('Strong Sell Pressure')) {
        conditions.push({
            label: 'Sell pressure cools',
            direction: 'bullish',
            metric: 'buySellRatio',
            threshold: 1,
            explanation: 'Stress weakens if buy and sell activity normalizes.'
        });
    }

    conditions.push({
        label: 'Liquidity remains usable',
        direction: 'neutral',
        metric: 'liquidity',
        threshold: Math.max(50000, Math.round(m.liquidity * 0.75)),
        explanation: 'A large liquidity drop would reduce confidence and increase exit risk.'
    });

    return conditions.slice(0, 3);
};

export const buildDetectionSummary = (eventType: AlphaGauntletEventType, tokenLabel: string, triggerLabels: string[], score: number) => {
    const triggerText = triggerLabels.slice(0, 2).join(' + ').toLowerCase();
    return `${tokenLabel} qualified as ${eventType.toLowerCase()} with ${triggerText || 'unusual activity'} and a ${score} activity score.`;
};

export const enrichDetectionEvent = (event: AlphaGauntletEvent): AlphaGauntletEvent => {
    const triggerDetails = event.triggerDetails?.length ? event.triggerDetails : buildTriggerDetails(event);
    const enriched: AlphaGauntletEvent = {
        ...event,
        lane: event.lane || inferDetectionLane(event),
        activityScore: event.activityScore ?? event.scores.activity,
        marketQualityScore: event.marketQualityScore ?? Math.round((event.scores.marketStructure + event.scores.eventStrength) / 2),
        liquidityQualityScore: event.liquidityQualityScore ?? event.scores.liquidityHealth,
        manipulationRiskScore: event.manipulationRiskScore ?? Math.round(clamp(100 - event.scores.liquidityHealth + (event.triggers.includes('Holder Growth Spike') ? 12 : 0))),
        confidence: event.confidence || buildConfidence(event),
        triggerDetails,
        dataFreshnessMs: event.dataFreshnessMs ?? Math.max(0, Date.now() - event.detectedAt)
    };

    return {
        ...enriched,
        whyDetected: event.whyDetected?.length ? event.whyDetected : buildWhyDetected(enriched),
        counterSignals: event.counterSignals?.length ? event.counterSignals : buildCounterSignals(enriched),
        watchConditions: event.watchConditions?.length ? event.watchConditions : buildWatchConditions(enriched),
        summary: event.summary.includes('Alpha score')
            ? buildDetectionSummary(event.eventType, event.token.ticker, triggerDetails.map((trigger) => trigger.label), event.score)
            : event.summary
    };
};
