// Intelligence service module for Atlaix data workflows.
import { AlphaGauntletEvent, AlphaGauntletEventType, AlphaGauntletTrigger, DetectionLane, MarketCoin } from '../types';
import { buildDetectionSummary, enrichDetectionEvent, getHonestTriggerLabel } from './detection/DetectionEventPresenter';
import { isExcludedAlphaToken } from '../utils/tokenFilters';

const OVERVIEW_THRESHOLD = 70;
const DETECTION_THRESHOLD = 65;

const parseMetric = (value: string | number | undefined): number => {
    if (typeof value === 'number') return value;
    if (!value) return 0;

    const raw = value.toString();
    const isNegative = raw.includes('-');
    let clean = raw.replace(/[$,%+\s]/g, '');
    let multiplier = 1;

    if (clean.includes('T')) multiplier = 1e12;
    else if (clean.includes('B')) multiplier = 1e9;
    else if (clean.includes('M')) multiplier = 1e6;
    else if (clean.includes('K')) multiplier = 1e3;

    clean = clean.replace(/[TBMK-]/g, '');
    const parsed = parseFloat(clean);
    if (Number.isNaN(parsed)) return 0;

    return (isNegative ? -parsed : parsed) * multiplier;
};

const clamp = (value: number, min = 0, max = 100) => Math.max(min, Math.min(max, value));
const scoreRatio = (value: number, target: number) => clamp((value / target) * 100);

const getAgeHours = (coin: MarketCoin) => {
    if (!coin.createdTimestamp) return 999;
    const ageMs = Date.now() - coin.createdTimestamp;
    return Math.max(0, ageMs / (1000 * 60 * 60));
};

const hasBothSides = (buys: number, sells: number) => buys > 0 && sells > 0;

const hasHealthyLiquidityStructure = (marketCap: number, liquidity: number, volume24h: number) => {
    if (marketCap <= 0) return false;

    const lpToMarketCapRatio = liquidity / marketCap;
    if (lpToMarketCapRatio >= 0.1) return true;

    // DexScreener often gives FDV instead of circulating market cap. For larger,
    // active tokens, a strict 10% LP/FDV rule hides otherwise valid events.
    if (marketCap >= 25000000) return lpToMarketCapRatio >= 0.025 && liquidity >= 750000 && volume24h >= 500000;
    if (marketCap >= 10000000) return lpToMarketCapRatio >= 0.04 && liquidity >= 500000 && volume24h >= 500000;
    if (marketCap >= 3000000) return lpToMarketCapRatio >= 0.06 && liquidity >= 250000 && volume24h >= 350000;

    return false;
};

const inferLane = (
    eventType: AlphaGauntletEventType,
    ageHours: number,
    lpToMarketCapRatio: number,
    score: number,
    triggers: AlphaGauntletTrigger[]
): DetectionLane => {
    if (eventType === 'Market Stress') return 'Market Stress';
    if (triggers.includes('Liquidity Removed') || lpToMarketCapRatio <= 0.08) return 'Liquidity Risk';
    if (ageHours <= 6) return 'Fresh Launch';
    if (ageHours <= 72) return 'Emerging Momentum';
    if (score < 72) return 'Watchlist Candidate';
    return 'Established Momentum';
};

const classifyEvent = (
    triggers: AlphaGauntletTrigger[],
    priceChange24h: number,
    buySellRatio: number,
    lpToMarketCapRatio: number,
    volumeFlowRatio: number,
    netFlow: number
): AlphaGauntletEventType => {
    const strongPositiveMomentum = priceChange24h >= 12;
    const strongNegativeMomentum = priceChange24h <= -12;
    const buyVolumeLeads = volumeFlowRatio >= 1.02 || netFlow > 0;
    const sellVolumeLeads = volumeFlowRatio <= 0.98 || netFlow < 0;
    const countSellPressure = buySellRatio <= 0.8;

    if (triggers.includes('Price Dump') && (triggers.includes('Strong Sell Pressure') || lpToMarketCapRatio < 0.15)) return 'Market Stress';
    if (triggers.includes('Strong Sell Pressure')) {
        if (strongPositiveMomentum && buyVolumeLeads) return 'Recovery';
        if (strongPositiveMomentum) return triggers.includes('Price Recovery') ? 'Recovery' : 'Unusual Activity';
        if (strongNegativeMomentum || (countSellPressure && sellVolumeLeads)) return 'Distribution';
        return 'Unusual Activity';
    }
    if (triggers.includes('Strong Buy Pressure') && (triggers.includes('Volume Spike') || buySellRatio >= 1.4)) return 'Accumulation';
    if (triggers.includes('Price Recovery') && triggers.includes('Volume Spike')) return 'Recovery';
    if (triggers.includes('Liquidity Added') || triggers.includes('Liquidity Removed')) return 'Liquidity Event';
    if (priceChange24h < -15) return 'Market Stress';
    return 'Unusual Activity';
};

const buildSummary = (eventType: AlphaGauntletEventType, coin: MarketCoin, triggers: AlphaGauntletTrigger[], score: number) => {
    const triggerLabels = triggers.map(getHonestTriggerLabel);
    return buildDetectionSummary(eventType, coin.ticker, triggerLabels, score);
};

const computeV2Scores = (
    marketStructure: number,
    liquidityHealth: number,
    activity: number,
    eventStrength: number,
    triggers: AlphaGauntletTrigger[],
    metrics: {
        liquidity: number;
        volume24h: number;
        lpToMarketCapRatio: number;
        buySellRatio: number;
        netFlow: number;
        priceChange24h: number;
    }
) => {
    const volumeToLiquidity = metrics.liquidity > 0 ? metrics.volume24h / metrics.liquidity : 0;
    const flowShare = metrics.volume24h > 0 ? Math.abs(metrics.netFlow) / metrics.volume24h : 0;
    const buySellBalance = Math.max(0, 100 - Math.abs((metrics.buySellRatio || 1) - 1) * 45);
    const turnoverPenalty = volumeToLiquidity >= 8 ? 35 : volumeToLiquidity >= 5 ? 22 : volumeToLiquidity >= 3 ? 10 : 0;
    const thinLiquidityPenalty = metrics.lpToMarketCapRatio <= 0.08 ? 26 : metrics.lpToMarketCapRatio <= 0.12 ? 12 : 0;
    const contradictionPenalty =
        metrics.priceChange24h > 10 && metrics.netFlow < 0 ? 18 :
            metrics.priceChange24h < -8 && metrics.netFlow > 0 ? 12 :
                0;

    const activityScore = activity;
    const liquidityQualityScore = Math.round(clamp(liquidityHealth - turnoverPenalty - thinLiquidityPenalty));
    const marketQualityScore = Math.round(clamp(
        marketStructure * 0.3 +
        eventStrength * 0.25 +
        buySellBalance * 0.25 +
        liquidityQualityScore * 0.2 -
        contradictionPenalty
    ));
    const manipulationRiskScore = Math.round(clamp(
        turnoverPenalty +
        thinLiquidityPenalty +
        contradictionPenalty +
        (flowShare >= 0.2 ? 18 : flowShare >= 0.12 ? 10 : 0) +
        (triggers.includes('Liquidity Removed') ? 12 : 0)
    ));
    const detectionGrade = Math.round(clamp(
        activityScore * 0.3 +
        marketQualityScore * 0.3 +
        liquidityQualityScore * 0.2 +
        eventStrength * 0.2 -
        manipulationRiskScore * 0.15
    ));

    return {
        activityScore,
        marketQualityScore,
        liquidityQualityScore,
        manipulationRiskScore,
        detectionGrade
    };
};

const laneThreshold = (lane: DetectionLane) => {
    switch (lane) {
        case 'Fresh Launch': return 58;
        case 'Emerging Momentum': return 62;
        case 'Established Momentum': return 65;
        case 'Market Stress': return 60;
        case 'Liquidity Risk': return 62;
        case 'Watchlist Candidate': return 68;
        case 'Paid Attention': return 70;
        default: return DETECTION_THRESHOLD;
    }
};

const shouldAdmitEvent = (event: AlphaGauntletEvent, fallbackThreshold: number) => {
    const lane = event.lane || 'Watchlist Candidate';
    const grade = event.score;
    const threshold = Math.max(Math.min(fallbackThreshold, 70), laneThreshold(lane));

    if (lane === 'Liquidity Risk') {
        return event.triggers.includes('Liquidity Removed') && (
            event.metrics.volume24h >= 500000 ||
            event.metrics.lpToMarketCapRatio <= 0.06 ||
            event.snapshotDeltas?.some((delta) => delta.liquidityChangePct <= -20)
        );
    }

    if (lane === 'Watchlist Candidate') {
        return grade >= threshold && (event.confidence?.score || 0) >= 55;
    }

    return grade >= threshold;
};

export const AlphaGauntletService = {
    OVERVIEW_THRESHOLD,
    DETECTION_THRESHOLD,

    qualifyToken(coin: MarketCoin): AlphaGauntletEvent | null {
        if (isExcludedAlphaToken(coin)) return null;

        const marketCap = parseMetric(coin.cap);
        const liquidity = parseMetric(coin.liquidity);
        const volume24h = parseMetric(coin.volume24h);
        const buys = parseMetric(coin.dexBuys);
        const sells = parseMetric(coin.dexSells);
        const transactions24h = buys + sells;
        const holderProxy = Math.max(coin.activeWallets24h || 0, Math.round(transactions24h * 0.65));
        const ageHours = getAgeHours(coin);
        const lpToMarketCapRatio = marketCap > 0 ? liquidity / marketCap : 0;
        const buySellRatio = sells > 0 ? buys / sells : buys > 0 ? buys : 0;
        const buyVolume24h = parseMetric(coin.buyVolume24h);
        const sellVolume24h = parseMetric(coin.sellVolume24h);
        const volumeFlowRatio = sellVolume24h > 0 ? buyVolume24h / sellVolume24h : buyVolume24h > 0 ? buyVolume24h : buySellRatio;
        const priceChange24h = parseMetric(coin.h24);
        const priceChange1h = parseMetric(coin.h1);
        const netFlow = parseMetric(coin.netFlow);
        const absNetFlow = Math.abs(netFlow);

        const marketEligible =
            marketCap >= 500000 &&
            liquidity >= 100000 &&
            volume24h >= 250000 &&
            holderProxy >= 500 &&
            transactions24h >= 500 &&
            ageHours >= 3 &&
            hasHealthyLiquidityStructure(marketCap, liquidity, volume24h) &&
            hasBothSides(buys, sells);

        if (!marketEligible) return null;

        const triggers: AlphaGauntletTrigger[] = [];
        const volumeToLiquidity = liquidity > 0 ? volume24h / liquidity : 0;
        const volumeToMarketCap = marketCap > 0 ? volume24h / marketCap : 0;
        const largeFlowThreshold = liquidity < 250000
            ? Math.max(50000, liquidity * 0.2, volume24h * 0.25)
            : liquidity < 1000000
                ? Math.max(150000, liquidity * 0.12, volume24h * 0.15)
                : Math.max(300000, liquidity * 0.08, volume24h * 0.12);

        if (volumeToLiquidity >= 1.2 || volumeToMarketCap >= 0.2 || volume24h >= 1000000) triggers.push('Volume Spike');
        if (
            transactions24h >= 10000 ||
            (transactions24h >= 5000 && volumeToLiquidity >= 3) ||
            (ageHours <= 24 && transactions24h >= 3500 && volumeToLiquidity >= 2)
        ) triggers.push('Transaction Spike');
        if ((buySellRatio >= 1.25 && netFlow > 0) || (volumeFlowRatio >= 1.08 && priceChange24h >= 5) || (buySellRatio >= 1.5 && volume24h >= 500000)) triggers.push('Strong Buy Pressure');
        if ((buySellRatio <= 0.8 && netFlow < 0) || (volumeFlowRatio <= 0.92 && priceChange24h <= 5) || (buySellRatio <= 0.67 && volume24h >= 500000 && netFlow <= 0)) triggers.push('Strong Sell Pressure');
        if (lpToMarketCapRatio >= 0.25 && volumeToLiquidity >= 0.6) triggers.push('Liquidity Added');
        if (lpToMarketCapRatio <= 0.08 && volume24h >= 500000) triggers.push('Liquidity Removed');
        if (priceChange24h <= -12 || priceChange1h <= -8) triggers.push('Price Dump');
        if ((priceChange1h >= 5 || priceChange24h >= 12) && priceChange24h > -10 && volumeToLiquidity >= 0.5) triggers.push('Price Recovery');
        if (absNetFlow >= largeFlowThreshold) triggers.push('Abnormal Large Trades');

        if (triggers.length === 0) return null;

        const eventType = classifyEvent(triggers, priceChange24h, buySellRatio, lpToMarketCapRatio, volumeFlowRatio, netFlow);

        const marketStructure = Math.round((
            scoreRatio(marketCap, 5000000) * 0.35 +
            scoreRatio(holderProxy, 5000) * 0.25 +
            scoreRatio(transactions24h, 5000) * 0.25 +
            scoreRatio(ageHours, 24) * 0.15
        ));

        const liquidityHealth = Math.round((
            scoreRatio(liquidity, 1000000) * 0.55 +
            scoreRatio(lpToMarketCapRatio, 0.25) * 0.35 +
            (coin.riskLevel === 'Low' ? 10 : coin.riskLevel === 'Medium' ? 5 : 0)
        ));

        const activity = Math.round((
            scoreRatio(volume24h, 1500000) * 0.45 +
            scoreRatio(transactions24h, 4000) * 0.3 +
            scoreRatio(Math.abs(buySellRatio - 1), 1) * 0.25
        ));

        const eventStrength = Math.round(clamp(
            triggers.length * 18 +
            scoreRatio(Math.abs(priceChange24h), 40) * 0.25 +
            scoreRatio(absNetFlow, 250000) * 0.25
        ));

        const legacyTotal = Math.round(
            marketStructure * 0.35 +
            liquidityHealth * 0.25 +
            activity * 0.25 +
            eventStrength * 0.15
        );

        const v2Scores = computeV2Scores(marketStructure, liquidityHealth, activity, eventStrength, triggers, {
            liquidity,
            volume24h,
            lpToMarketCapRatio,
            buySellRatio,
            netFlow,
            priceChange24h
        });
        const total = Math.max(legacyTotal, v2Scores.detectionGrade);
        const severity = total >= 85 || (eventType === 'Market Stress' && v2Scores.manipulationRiskScore >= 55) ? 'High' : total >= 72 ? 'Medium' : 'Low';
        const lane = inferLane(eventType, ageHours, lpToMarketCapRatio, total, triggers);

        return enrichDetectionEvent({
            token: coin,
            eventType,
            triggers,
            score: total,
            scores: { marketStructure, liquidityHealth, activity, eventStrength, total },
            severity,
            summary: buildSummary(eventType, coin, triggers, total),
            detectedAt: Date.now(),
            lane,
            activityScore: v2Scores.activityScore,
            marketQualityScore: v2Scores.marketQualityScore,
            liquidityQualityScore: v2Scores.liquidityQualityScore,
            manipulationRiskScore: v2Scores.manipulationRiskScore,
            metrics: {
                marketCap,
                liquidity,
                volume24h,
                holders: holderProxy,
                transactions24h,
                ageHours,
                lpToMarketCapRatio,
                buySellRatio,
                buyVolume24h,
                sellVolume24h,
                volumeFlowRatio,
                priceChange24h,
                netFlow
            }
        });
    },

    qualifyTokens(tokens: MarketCoin[], threshold = DETECTION_THRESHOLD): AlphaGauntletEvent[] {
        return tokens
            .map(token => this.qualifyToken(token))
            .filter((event): event is AlphaGauntletEvent => Boolean(event && shouldAdmitEvent(event, threshold)))
            .sort((a, b) => {
                const urgencyA = a.lane === 'Market Stress' ? (a.manipulationRiskScore || 0) : a.score;
                const urgencyB = b.lane === 'Market Stress' ? (b.manipulationRiskScore || 0) : b.score;
                if (urgencyB !== urgencyA) return urgencyB - urgencyA;
                return (b.confidence?.score || 0) - (a.confidence?.score || 0);
            });
    },

    getOverviewEvents(tokens: MarketCoin[]): AlphaGauntletEvent[] {
        return this.qualifyTokens(tokens, OVERVIEW_THRESHOLD);
    },

    getDetectionEvents(tokens: MarketCoin[]): AlphaGauntletEvent[] {
        return this.qualifyTokens(tokens, DETECTION_THRESHOLD);
    }
};
