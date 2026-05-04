// Intelligence service module for Atlaix data workflows.
import { AlphaGauntletEvent, AlphaGauntletEventType, AlphaGauntletTrigger, MarketCoin } from '../types';

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

    if (triggers.includes('Liquidity Added') || triggers.includes('Liquidity Removed')) return 'Liquidity Event';
    if (triggers.includes('Price Dump') && (triggers.includes('Strong Sell Pressure') || lpToMarketCapRatio < 0.15)) return 'Market Stress';
    if (triggers.includes('Price Recovery') && triggers.includes('Volume Spike')) return 'Recovery';
    if (triggers.includes('Strong Sell Pressure')) {
        if (strongPositiveMomentum && buyVolumeLeads) return 'Recovery';
        if (strongPositiveMomentum) return triggers.includes('Price Recovery') ? 'Recovery' : 'Unusual Activity';
        if (strongNegativeMomentum || (countSellPressure && sellVolumeLeads)) return 'Distribution';
        return 'Unusual Activity';
    }
    if (triggers.includes('Strong Buy Pressure') && (triggers.includes('Volume Spike') || buySellRatio >= 1.4)) return 'Accumulation';
    if (priceChange24h < -15) return 'Market Stress';
    return 'Unusual Activity';
};

const buildSummary = (eventType: AlphaGauntletEventType, coin: MarketCoin, triggers: AlphaGauntletTrigger[], score: number) => {
    const triggerText = triggers.slice(0, 2).join(' + ').toLowerCase();
    return `${coin.ticker} qualified as ${eventType.toLowerCase()} with ${triggerText || 'unusual activity'} and a ${score} Alpha score.`;
};

export const AlphaGauntletService = {
    OVERVIEW_THRESHOLD,
    DETECTION_THRESHOLD,

    qualifyToken(coin: MarketCoin): AlphaGauntletEvent | null {
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

        if (volumeToLiquidity >= 1.2 || volumeToMarketCap >= 0.2 || volume24h >= 1000000) triggers.push('Volume Spike');
        if (transactions24h >= 2000 || transactions24h / Math.max(holderProxy, 1) >= 2) triggers.push('Transaction Spike');
        if ((buySellRatio >= 1.25 && netFlow > 0) || (volumeFlowRatio >= 1.08 && priceChange24h >= 5) || (buySellRatio >= 1.5 && volume24h >= 500000)) triggers.push('Strong Buy Pressure');
        if ((buySellRatio <= 0.8 && netFlow < 0) || (volumeFlowRatio <= 0.92 && priceChange24h <= 5) || (buySellRatio <= 0.67 && volume24h >= 500000 && netFlow <= 0)) triggers.push('Strong Sell Pressure');
        if (lpToMarketCapRatio >= 0.25 && volumeToLiquidity >= 0.6) triggers.push('Liquidity Added');
        if (lpToMarketCapRatio <= 0.08 && volume24h >= 500000) triggers.push('Liquidity Removed');
        if (holderProxy >= 2500 && transactions24h >= 2500) triggers.push('Holder Growth Spike');
        if (priceChange24h <= -12 || priceChange1h <= -8) triggers.push('Price Dump');
        if ((priceChange1h >= 5 || priceChange24h >= 12) && priceChange24h > -10 && volumeToLiquidity >= 0.5) triggers.push('Price Recovery');
        if (absNetFlow >= 35000 || absNetFlow >= volume24h * 0.08) triggers.push('Abnormal Large Trades');

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

        const total = Math.round(
            marketStructure * 0.35 +
            liquidityHealth * 0.25 +
            activity * 0.25 +
            eventStrength * 0.15
        );

        const severity = total >= 85 ? 'High' : total >= 72 ? 'Medium' : 'Low';

        return {
            token: coin,
            eventType,
            triggers,
            score: total,
            scores: { marketStructure, liquidityHealth, activity, eventStrength, total },
            severity,
            summary: buildSummary(eventType, coin, triggers, total),
            detectedAt: Date.now(),
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
        };
    },

    qualifyTokens(tokens: MarketCoin[], threshold = DETECTION_THRESHOLD): AlphaGauntletEvent[] {
        return tokens
            .map(token => this.qualifyToken(token))
            .filter((event): event is AlphaGauntletEvent => Boolean(event && event.score >= threshold))
            .sort((a, b) => b.score - a.score);
    },

    getOverviewEvents(tokens: MarketCoin[]): AlphaGauntletEvent[] {
        return this.qualifyTokens(tokens, OVERVIEW_THRESHOLD);
    },

    getDetectionEvents(tokens: MarketCoin[]): AlphaGauntletEvent[] {
        return this.qualifyTokens(tokens, DETECTION_THRESHOLD);
    }
};
