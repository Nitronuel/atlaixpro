import type { AlphaGauntletEvent } from '../src/types';
import type { ImpactfulTokenActivity } from './impactful-token-activity';
import { getDetectionKey } from './detection-snapshot-store';

const normalizeAddress = (value = '') => value.trim().toLowerCase();

const formatCompactUsd = (value: number) => {
    if (!Number.isFinite(value) || value <= 0) return '$0';
    return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
        notation: 'compact',
        maximumFractionDigits: 2
    }).format(value);
};

const severityForSentiment = (sentiment: 'bullish' | 'bearish' | 'neutral', event: AlphaGauntletEvent): ImpactfulTokenActivity['severity'] => {
    if (sentiment === 'bearish' && event.severity !== 'Low') return 'Critical';
    if (sentiment === 'bearish') return 'High';
    if (event.severity === 'High') return 'High';
    return 'Signal';
};

const typeForTitle = (title: string, sentiment: 'bullish' | 'bearish' | 'neutral') => {
    if (/sell|outflow|dump|removed/i.test(title)) return 'Whale Sell';
    if (/buy|inflow|recovery|pump|added/i.test(title)) return 'Whale Buy';
    if (/liquidity/i.test(title)) return 'Liquidity Event';
    return sentiment === 'bearish' ? 'Whale Sell' : sentiment === 'bullish' ? 'Whale Buy' : 'Whale Transfer';
};

const toActivity = (
    event: AlphaGauntletEvent,
    suffix: string,
    title: string,
    description: string,
    usdValue: number,
    sentiment: 'bullish' | 'bearish' | 'neutral'
): ImpactfulTokenActivity | null => {
    const tokenAddress = event.token.address;
    if (!tokenAddress) return null;

    const id = `${getDetectionKey(event)}:${event.detectedAt}:${suffix}`;
    const chain = event.token.chain.toLowerCase();

    return {
        id,
        chain,
        tokenAddress: normalizeAddress(tokenAddress),
        type: typeForTitle(title, sentiment),
        severity: severityForSentiment(sentiment, event),
        title,
        description,
        usdValue: Number(usdValue || 0),
        tokenAmount: 0,
        wallet: event.token.pairAddress || tokenAddress,
        txHash: id,
        detectedAt: event.detectedAt,
        source: 'detection-engine'
    };
};

export const buildDetectionImpactActivities = (event: AlphaGauntletEvent): ImpactfulTokenActivity[] => {
    const tokenLabel = event.token.ticker;
    const valueBasis = Math.max(
        event.metrics.volume24h || 0,
        event.metrics.liquidity || 0,
        (event.metrics.marketCap || 0) * 0.01
    );
    const activities: Array<ImpactfulTokenActivity | null> = [];

    activities.push(toActivity(
        event,
        'admission',
        `${event.eventType} Admission`,
        `${tokenLabel} entered the Detection Engine as ${event.eventType} with score ${event.score}.`,
        valueBasis,
        event.eventType === 'Accumulation' || event.eventType === 'Recovery'
            ? 'bullish'
            : event.eventType === 'Distribution' || event.eventType === 'Market Stress'
                ? 'bearish'
                : 'neutral'
    ));

    if (event.triggers.includes('Strong Buy Pressure')) {
        activities.push(toActivity(
            event,
            'buy-pressure',
            'Qualified Buy Pressure',
            `${tokenLabel} is showing stronger buy-side pressure across the latest 24h market flow.`,
            Math.max(event.metrics.buyVolume24h || 0, valueBasis),
            'bullish'
        ));
    }

    if (event.triggers.includes('Strong Sell Pressure')) {
        activities.push(toActivity(
            event,
            'sell-pressure',
            'Qualified Sell Pressure',
            `${tokenLabel} has elevated sell-side pressure relative to current market activity.`,
            Math.max(event.metrics.sellVolume24h || 0, valueBasis),
            'bearish'
        ));
    }

    if (event.triggers.includes('Price Recovery')) {
        activities.push(toActivity(
            event,
            'recovery',
            'Recovery Momentum',
            `${tokenLabel} is rebounding with ${event.metrics.priceChange24h >= 0 ? '+' : ''}${event.metrics.priceChange24h.toFixed(2)}% 24h price momentum.`,
            event.metrics.volume24h,
            'bullish'
        ));
    }

    if (event.triggers.includes('Price Dump')) {
        activities.push(toActivity(
            event,
            'price-dump',
            'Major Dump Event',
            `${tokenLabel} moved ${event.metrics.priceChange24h.toFixed(2)}% over 24h with elevated activity.`,
            event.metrics.volume24h,
            'bearish'
        ));
    } else if (event.metrics.priceChange24h >= 12) {
        activities.push(toActivity(
            event,
            'price-pump',
            'Major Pump Event',
            `${tokenLabel} moved +${event.metrics.priceChange24h.toFixed(2)}% over 24h with meaningful volume.`,
            event.metrics.volume24h,
            'bullish'
        ));
    }

    if (event.triggers.includes('Volume Spike')) {
        activities.push(toActivity(
            event,
            'volume',
            'Major Volume Event',
            `${tokenLabel} produced ${formatCompactUsd(event.metrics.volume24h)} in 24h market volume.`,
            event.metrics.volume24h,
            'neutral'
        ));
    }

    if (event.triggers.includes('Liquidity Added')) {
        activities.push(toActivity(
            event,
            'liquidity-added',
            'Liquidity Added',
            `${tokenLabel} shows constructive liquidity expansion with ${formatCompactUsd(event.metrics.liquidity)} active liquidity.`,
            event.metrics.liquidity,
            'bullish'
        ));
    }

    if (event.triggers.includes('Liquidity Removed')) {
        activities.push(toActivity(
            event,
            'liquidity-removed',
            'Liquidity Removed',
            `${tokenLabel} shows a liquidity reduction risk with ${formatCompactUsd(event.metrics.liquidity)} active liquidity remaining.`,
            event.metrics.liquidity,
            'bearish'
        ));
    }

    if (event.triggers.includes('Abnormal Large Trades')) {
        const positiveFlow = event.metrics.netFlow > 0;
        const negativeFlow = event.metrics.netFlow < 0;
        activities.push(toActivity(
            event,
            'large-trades',
            positiveFlow ? 'Abnormal Large Inflow' : negativeFlow ? 'Abnormal Large Outflow' : 'Abnormal Large Trades',
            `${tokenLabel} has ${positiveFlow ? 'positive' : negativeFlow ? 'negative' : 'unusual'} net flow of ${formatCompactUsd(Math.abs(event.metrics.netFlow))}.`,
            Math.abs(event.metrics.netFlow),
            positiveFlow ? 'bullish' : negativeFlow ? 'bearish' : 'neutral'
        ));
    }

    return activities.filter((activity): activity is ImpactfulTokenActivity => Boolean(activity));
};
