// Intelligence service module for Atlaix data workflows.
import type { SmartMoneyQualification } from '../types';

export type SmartMoneyProcessStatus = 'queued' | 'scanning' | 'completed' | 'failed' | 'already_tracked';
export type SmartMoneyDecision = 'qualified' | 'watchlist' | 'needs_review' | 'rejected';
export type SmartMoneyWalletType =
    | 'early_accumulator'
    | 'consistent_profitable_trader'
    | 'high_conviction_holder'
    | 'whale_capital_wallet'
    | 'needs_review'
    | 'unknown';
export type SmartMoneyIntelligenceConfidence = 'high' | 'medium' | 'low';
export type SmartMoneyDiscoverySource = 'early_buy_swap' | 'transfer_recipient' | 'unknown';
export type SmartMoneyReasonCode =
    | 'early_token_entry'
    | 'strong_capital_base'
    | 'positive_pnl'
    | 'high_win_rate'
    | 'enough_positions'
    | 'limited_trade_sample'
    | 'weak_profitability'
    | 'low_balance';
export type SmartMoneyRiskFlag =
    | 'low_trade_sample'
    | 'negative_pnl'
    | 'low_win_rate'
    | 'low_balance'
    | 'transfer_only_discovery';

export type SmartMoneyNumericMetrics = {
    netWorthUsd?: number | null;
    realizedPnlUsd?: number | null;
    unrealizedPnlUsd?: number | null;
    totalPnlUsd?: number | null;
    pnlPct?: number | null;
    winRatePct?: number | null;
    capitalEfficiency?: number | null;
    avgBuyUsd?: number | null;
    tradesAnalyzed?: number | null;
    winningTrades?: number | null;
    losingTrades?: number | null;
    tokensTraded?: number | null;
    daysActive?: number | null;
    lastActiveAt?: string | null;
};

export type SmartMoneyScoreBreakdown = {
    scoreTotal?: number | null;
    scoreProfitability?: number | null;
    scoreConsistency?: number | null;
    scoreTiming?: number | null;
    scoreCapitalEfficiency?: number | null;
    scoreRiskAdjusted?: number | null;
};

export type SmartMoneyClassificationInput = SmartMoneyNumericMetrics & {
    status?: string;
    source?: 'moralis-swaps' | 'alchemy-transfers';
    confidence?: 'high' | 'low';
    buyerUsdValue?: number | null;
    score?: number | null;
    qualification?: SmartMoneyQualification;
};

export type SmartMoneyClassification = SmartMoneyNumericMetrics & SmartMoneyScoreBreakdown & {
    processStatus: SmartMoneyProcessStatus;
    decision: SmartMoneyDecision;
    walletType: SmartMoneyWalletType;
    intelligenceConfidence: SmartMoneyIntelligenceConfidence;
    discoverySource: SmartMoneyDiscoverySource;
    reasonCodes: SmartMoneyReasonCode[];
    riskFlags: SmartMoneyRiskFlag[];
    decisionSummary: string;
};

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const round = (value: number, decimals = 2) => Number(value.toFixed(decimals));

export const parseCurrencyLike = (value?: string | number | null): number | null => {
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    if (!value) return null;
    const cleaned = value.replace(/[$,\s]/g, '').trim();
    const match = cleaned.match(/^([+-]?\d+(?:\.\d+)?)([KMBT])?$/i);
    if (!match) return Number.isFinite(Number(cleaned)) ? Number(cleaned) : null;

    const suffix = (match[2] || '').toUpperCase();
    const multiplier = suffix === 'T' ? 1_000_000_000_000
        : suffix === 'B' ? 1_000_000_000
            : suffix === 'M' ? 1_000_000
                : suffix === 'K' ? 1_000
                    : 1;
    return Number(match[1]) * multiplier;
};

export const parsePercentLike = (value?: string | number | null): number | null => {
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    if (!value || value === 'N/A') return null;
    const parsed = Number(value.replace('%', '').replace('+', '').trim());
    return Number.isFinite(parsed) ? parsed : null;
};

export function deriveProcessStatus(status?: string): SmartMoneyProcessStatus {
    if (status === 'queued') return 'queued';
    if (status === 'scanning') return 'scanning';
    if (status === 'failed') return 'failed';
    if (status === 'already_tracked') return 'already_tracked';
    return 'completed';
}

export function mapDiscoverySource(source?: SmartMoneyClassificationInput['source']): SmartMoneyDiscoverySource {
    if (source === 'moralis-swaps') return 'early_buy_swap';
    if (source === 'alchemy-transfers') return 'transfer_recipient';
    return 'unknown';
}

function buildScores(input: SmartMoneyClassificationInput): SmartMoneyScoreBreakdown {
    const pnlPct = input.pnlPct ?? input.qualification?.metrics.pnlPercent ?? null;
    const winRatePct = input.winRatePct ?? input.qualification?.metrics.winRate ?? null;
    const netWorthUsd = input.netWorthUsd ?? input.qualification?.metrics.netWorthUsd ?? null;
    const tradesAnalyzed = input.tradesAnalyzed ?? input.qualification?.metrics.activePositions ?? null;
    const capitalEfficiency = input.capitalEfficiency ?? pnlPct;

    const scoreProfitability = pnlPct === null ? null : clamp((pnlPct + 20) * 1.4, 0, 100);
    const scoreConsistency = winRatePct === null ? null : clamp(winRatePct, 0, 100);
    const scoreTiming = input.buyerUsdValue && input.buyerUsdValue >= 1_000 ? 80 : input.buyerUsdValue ? 60 : 45;
    const scoreCapitalEfficiency = capitalEfficiency === null ? null : clamp((capitalEfficiency + 10) * 2, 0, 100);
    const samplePenalty = tradesAnalyzed !== null && tradesAnalyzed < 3 ? 15 : 0;
    const balancePenalty = netWorthUsd !== null && netWorthUsd < 2_500 ? 15 : 0;
    const baseScore = input.score ?? input.qualification?.score ?? 0;
    const scoreRiskAdjusted = clamp(baseScore - samplePenalty - balancePenalty, 0, 100);

    return {
        scoreTotal: round(baseScore, 0),
        scoreProfitability: scoreProfitability === null ? null : round(scoreProfitability, 0),
        scoreConsistency: scoreConsistency === null ? null : round(scoreConsistency, 0),
        scoreTiming,
        scoreCapitalEfficiency: scoreCapitalEfficiency === null ? null : round(scoreCapitalEfficiency, 0),
        scoreRiskAdjusted: round(scoreRiskAdjusted, 0)
    };
}

export function classifySmartMoneyWallet(input: SmartMoneyClassificationInput): SmartMoneyClassification {
    const processStatus = deriveProcessStatus(input.status);
    const discoverySource = mapDiscoverySource(input.source);
    const netWorthUsd = input.netWorthUsd ?? input.qualification?.metrics.netWorthUsd ?? null;
    const winRatePct = input.winRatePct ?? input.qualification?.metrics.winRate ?? null;
    const pnlPct = input.pnlPct ?? input.qualification?.metrics.pnlPercent ?? null;
    const tradesAnalyzed = input.tradesAnalyzed ?? input.qualification?.metrics.activePositions ?? null;
    const winningTrades = input.winningTrades ?? input.qualification?.metrics.profitablePositions ?? null;
    const losingTrades = input.losingTrades ?? (
        tradesAnalyzed !== null && winningTrades !== null ? Math.max(0, tradesAnalyzed - winningTrades) : null
    );
    const scores = buildScores({ ...input, netWorthUsd, winRatePct, pnlPct, tradesAnalyzed, winningTrades, losingTrades });
    const reasonCodes = new Set<SmartMoneyReasonCode>();
    const riskFlags = new Set<SmartMoneyRiskFlag>();

    if (input.buyerUsdValue || discoverySource !== 'unknown') reasonCodes.add('early_token_entry');
    if (netWorthUsd !== null && netWorthUsd >= 25_000) reasonCodes.add('strong_capital_base');
    if (pnlPct !== null && pnlPct >= 10) reasonCodes.add('positive_pnl');
    if (winRatePct !== null && winRatePct >= 60) reasonCodes.add('high_win_rate');
    if (tradesAnalyzed !== null && tradesAnalyzed >= 4) reasonCodes.add('enough_positions');

    if (tradesAnalyzed !== null && tradesAnalyzed < 3) {
        reasonCodes.add('limited_trade_sample');
        riskFlags.add('low_trade_sample');
    }
    if (pnlPct !== null && pnlPct < 0) riskFlags.add('negative_pnl');
    if (pnlPct !== null && pnlPct < 5) reasonCodes.add('weak_profitability');
    if (winRatePct !== null && winRatePct < 35) riskFlags.add('low_win_rate');
    if (netWorthUsd !== null && netWorthUsd < 2_500) {
        reasonCodes.add('low_balance');
        riskFlags.add('low_balance');
    }
    if (discoverySource === 'transfer_recipient') riskFlags.add('transfer_only_discovery');

    const score = scores.scoreRiskAdjusted ?? scores.scoreTotal ?? 0;
    let decision: SmartMoneyDecision = 'needs_review';
    if (processStatus === 'failed') {
        decision = 'rejected';
    } else if (processStatus === 'queued' || processStatus === 'scanning') {
        decision = 'needs_review';
    } else if (input.qualification?.qualified && score >= 60) {
        decision = 'qualified';
    } else if (score >= 45 || (netWorthUsd !== null && netWorthUsd >= 25_000 && (winRatePct ?? 0) >= 45)) {
        decision = 'watchlist';
    } else if (riskFlags.has('low_trade_sample') && discoverySource !== 'unknown') {
        decision = 'needs_review';
    } else if (netWorthUsd !== null || winRatePct !== null || pnlPct !== null) {
        decision = 'rejected';
    }

    let walletType: SmartMoneyWalletType = 'unknown';
    if (decision === 'needs_review') walletType = 'needs_review';
    else if (netWorthUsd !== null && netWorthUsd >= 250_000) walletType = 'whale_capital_wallet';
    else if ((winRatePct ?? 0) >= 60 && (pnlPct ?? 0) >= 15) walletType = 'consistent_profitable_trader';
    else if ((input.buyerUsdValue ?? 0) >= 1_000 && (tradesAnalyzed ?? 0) <= 3) walletType = 'high_conviction_holder';
    else if (discoverySource !== 'unknown') walletType = 'early_accumulator';

    const hasGoodMetrics = netWorthUsd !== null && winRatePct !== null && pnlPct !== null && tradesAnalyzed !== null;
    const intelligenceConfidence: SmartMoneyIntelligenceConfidence = hasGoodMetrics && tradesAnalyzed >= 4 && input.confidence !== 'low'
        ? 'high'
        : hasGoodMetrics || input.confidence === 'high'
            ? 'medium'
            : 'low';

    const summaryParts: string[] = [];
    if (reasonCodes.has('strong_capital_base')) summaryParts.push('strong capital base');
    if (reasonCodes.has('high_win_rate')) summaryParts.push('high win rate');
    if (reasonCodes.has('positive_pnl')) summaryParts.push('positive PnL');
    if (riskFlags.has('low_trade_sample')) summaryParts.push('limited sample');
    if (riskFlags.has('transfer_only_discovery')) summaryParts.push('transfer-only discovery');

    const decisionSummary = summaryParts.length
        ? `${decision.replace('_', ' ')}: ${summaryParts.slice(0, 3).join(', ')}.`
        : `${decision.replace('_', ' ')}: waiting for enough wallet performance data.`;

    return {
        processStatus,
        decision,
        walletType,
        intelligenceConfidence,
        discoverySource,
        reasonCodes: Array.from(reasonCodes),
        riskFlags: Array.from(riskFlags),
        decisionSummary,
        netWorthUsd,
        realizedPnlUsd: input.realizedPnlUsd ?? null,
        unrealizedPnlUsd: input.unrealizedPnlUsd ?? null,
        totalPnlUsd: input.totalPnlUsd ?? null,
        pnlPct,
        winRatePct,
        capitalEfficiency: input.capitalEfficiency ?? pnlPct ?? null,
        avgBuyUsd: input.avgBuyUsd ?? null,
        tradesAnalyzed,
        winningTrades,
        losingTrades,
        tokensTraded: input.tokensTraded ?? tradesAnalyzed ?? null,
        daysActive: input.daysActive ?? null,
        lastActiveAt: input.lastActiveAt ?? null,
        ...scores
    };
}
