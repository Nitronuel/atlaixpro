// Shared Smart Alert rule evaluation primitives for backend jobs.
export type SmartAlertType = 'Price' | 'Volume' | 'Liquidity' | 'Whale' | 'Alpha' | 'Risk';

export interface SmartAlertRuleSnapshot {
    id: string;
    user_id: string;
    alert_type: SmartAlertType;
    target: string;
    chain_id: string;
    condition: string;
    threshold: string;
    trigger_label: string;
    cooldown_minutes: number;
    last_triggered_at: string | null;
}

export interface SmartAlertMarketSnapshot {
    priceUsd?: number | null;
    volume24hUsd?: number | null;
    liquidityUsd?: number | null;
    whaleUsd?: number | null;
    whaleSide?: 'buy' | 'sell' | null;
    alphaEvent?: string | null;
    riskSeverity?: string | null;
}

export interface SmartAlertEvaluationResult {
    shouldTrigger: boolean;
    observedValue: string | null;
    message: string;
    dedupeKey: string;
}

const UNIT_MULTIPLIERS: Record<string, number> = {
    k: 1_000,
    m: 1_000_000,
    b: 1_000_000_000
};

export const parseAlertNumber = (value: string) => {
    const normalized = value.trim().replace(/[$,\s]/g, '').toLowerCase();
    const match = normalized.match(/^(-?\d+(?:\.\d+)?)([kmb%]?)$/);
    if (!match) return Number.NaN;

    const numeric = Number(match[1]);
    if (!Number.isFinite(numeric)) return Number.NaN;

    const unit = match[2];
    if (unit === '%') return numeric;
    return numeric * (UNIT_MULTIPLIERS[unit] || 1);
};

const formatUsd = (value: number | null | undefined) => {
    if (!Number.isFinite(Number(value))) return null;
    return `$${Number(value).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
};

const isCooldownActive = (rule: SmartAlertRuleSnapshot) => {
    if (!rule.last_triggered_at) return false;
    const lastTriggeredAt = new Date(rule.last_triggered_at).getTime();
    if (!Number.isFinite(lastTriggeredAt)) return false;
    return Date.now() - lastTriggeredAt < rule.cooldown_minutes * 60_000;
};

const compareThreshold = (observed: number | null | undefined, condition: string, threshold: string) => {
    const observedNumber = Number(observed);
    const thresholdNumber = parseAlertNumber(threshold);
    if (!Number.isFinite(observedNumber) || !Number.isFinite(thresholdNumber)) return false;

    if (condition.includes('below') || condition.includes('drops')) return observedNumber <= thresholdNumber;
    return observedNumber >= thresholdNumber;
};

const matchesWhale = (rule: SmartAlertRuleSnapshot, snapshot: SmartAlertMarketSnapshot) => {
    if (!compareThreshold(snapshot.whaleUsd, 'above', rule.threshold)) return false;
    const side = snapshot.whaleSide || 'buy';
    if (rule.condition === 'buy above') return side === 'buy';
    if (rule.condition === 'sell above') return side === 'sell';
    return true;
};

export const evaluateSmartAlertRule = (
    rule: SmartAlertRuleSnapshot,
    snapshot: SmartAlertMarketSnapshot,
    now = new Date()
): SmartAlertEvaluationResult => {
    if (isCooldownActive(rule)) {
        return {
            shouldTrigger: false,
            observedValue: null,
            message: 'Alert is inside its cooldown window.',
            dedupeKey: `${rule.id}:cooldown`
        };
    }

    let matched = false;
    let observedValue: string | null = null;

    switch (rule.alert_type) {
        case 'Price':
            matched = compareThreshold(snapshot.priceUsd, rule.condition, rule.threshold);
            observedValue = formatUsd(snapshot.priceUsd);
            break;
        case 'Volume':
            matched = compareThreshold(snapshot.volume24hUsd, rule.condition, rule.threshold);
            observedValue = formatUsd(snapshot.volume24hUsd);
            break;
        case 'Liquidity':
            matched = compareThreshold(snapshot.liquidityUsd, rule.condition, rule.threshold);
            observedValue = formatUsd(snapshot.liquidityUsd);
            break;
        case 'Whale':
            matched = matchesWhale(rule, snapshot);
            observedValue = formatUsd(snapshot.whaleUsd);
            break;
        case 'Alpha':
            matched = Boolean(snapshot.alphaEvent && snapshot.alphaEvent.toLowerCase() === rule.threshold.toLowerCase());
            observedValue = snapshot.alphaEvent || null;
            break;
        case 'Risk':
            matched = Boolean(snapshot.riskSeverity && (
                rule.threshold.toLowerCase() === 'any new risk' ||
                snapshot.riskSeverity.toLowerCase() === rule.threshold.toLowerCase()
            ));
            observedValue = snapshot.riskSeverity || null;
            break;
    }

    const bucket = now.toISOString().slice(0, 13);
    const message = matched
        ? `${rule.trigger_label} triggered${observedValue ? ` at ${observedValue}` : ''}.`
        : `${rule.trigger_label} has not met its condition.`;

    return {
        shouldTrigger: matched,
        observedValue,
        message,
        dedupeKey: `${rule.id}:${rule.alert_type}:${bucket}`
    };
};
