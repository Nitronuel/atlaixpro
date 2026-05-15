import { AlphaGauntletEvent } from '../../types';
import { getHonestTriggerLabel } from './DetectionEventPresenter';

export type DetectionTimelineSentiment = 'bullish' | 'bearish' | 'neutral';

export type DetectionTimelineCard = {
    id: string;
    title: string;
    description: string;
    usdValue: number;
    detectedAt: number;
    sentiment: DetectionTimelineSentiment;
    type: string;
};

const formatCompactUsd = (value: number) => {
    if (!Number.isFinite(value) || value <= 0) return '$0';
    return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
        notation: 'compact',
        maximumFractionDigits: 2
    }).format(value);
};

const previousValueFromChange = (current: number, changePct: number) => {
    if (!Number.isFinite(current) || !Number.isFinite(changePct) || changePct <= -100) return null;
    const previous = current / (1 + changePct / 100);
    return Number.isFinite(previous) && previous >= 0 ? previous : null;
};

export const getDetectionTimelineEventKey = (event: AlphaGauntletEvent) => {
    const tokenKey = event.token.address || event.token.ticker;
    return [
        event.token.chain.toLowerCase(),
        tokenKey.toLowerCase(),
        event.eventType.toLowerCase()
    ].join(':');
};

export const getDetectionVolumeDescription = (event: AlphaGauntletEvent) => {
    const tokenLabel = event.token.ticker;
    const currentVolume = formatCompactUsd(event.metrics.volume24h);
    const volumeDelta24h = event.snapshotDeltas?.find((delta) => delta.window === '24h');
    const liquidityContext = event.metrics.liquidity > 0
        ? ` That is ${(event.metrics.volume24h / event.metrics.liquidity).toFixed(2)}x current liquidity.`
        : '';

    if (volumeDelta24h && Number.isFinite(volumeDelta24h.volumeChangePct)) {
        const previousVolume = previousValueFromChange(event.metrics.volume24h, volumeDelta24h.volumeChangePct);
        const direction = volumeDelta24h.volumeChangePct >= 0 ? 'up' : 'down';
        const previousText = previousVolume !== null ? ` from ${formatCompactUsd(previousVolume)} in the prior 24h` : ' from the prior 24h';
        return `${tokenLabel} produced ${currentVolume} in latest 24h volume, ${direction} ${Math.abs(volumeDelta24h.volumeChangePct).toFixed(2)}%${previousText}.${liquidityContext}`;
    }

    return `${tokenLabel} produced ${currentVolume} in latest 24h volume.${liquidityContext} Prior 24h baseline is still warming up.`;
};

const cardTypeForTitle = (title: string, sentiment: DetectionTimelineSentiment) => {
    if (/sell|outflow/i.test(title)) return 'Sell-Side Flow';
    if (/buy|inflow/i.test(title)) return 'Buy-Side Flow';
    if (/liquidity/i.test(title)) return 'Liquidity Event';
    if (/dump|breakdown|recovery|pump|removed|added/i.test(title)) return 'Market Event';
    return sentiment === 'neutral' ? 'Detection Event' : 'Market Event';
};

const makeCard = (
    event: AlphaGauntletEvent,
    suffix: string,
    title: string,
    description: string,
    usdValue: number,
    sentiment: DetectionTimelineSentiment
): DetectionTimelineCard => ({
    id: `${getDetectionTimelineEventKey(event)}:${event.detectedAt}:${suffix}`,
    title,
    description,
    usdValue: Number(usdValue || 0),
    detectedAt: event.detectedAt,
    sentiment,
    type: cardTypeForTitle(title, sentiment)
});

export const buildDetectionTimelineCards = (event: AlphaGauntletEvent): DetectionTimelineCard[] => {
    const tokenLabel = event.token.ticker;
    const valueBasis = Math.max(
        event.metrics.volume24h || 0,
        event.metrics.liquidity || 0,
        (event.metrics.marketCap || 0) * 0.01
    );
    const cards: DetectionTimelineCard[] = [];

    cards.push(makeCard(
        event,
        'admission',
        `${event.eventType} Admission`,
        `${tokenLabel} entered the Detection Engine as ${event.eventType} with activity score ${event.score}.`,
        valueBasis,
        event.eventType === 'Accumulation' || event.eventType === 'Potential Accumulation' || event.eventType === 'Recovery'
            ? 'bullish'
            : event.eventType === 'Distribution' || event.eventType === 'Potential Distribution' || event.eventType === 'Market Stress'
                ? 'bearish'
                : 'neutral'
    ));

    if (event.triggers.includes('Strong Buy Pressure')) {
        cards.push(makeCard(
            event,
            'buy-pressure',
            getHonestTriggerLabel('Strong Buy Pressure'),
            `${tokenLabel} has buy-side USD flow leading sell-side flow across the latest 24h market activity.`,
            Math.max(event.metrics.buyVolume24h || 0, valueBasis),
            'bullish'
        ));
    }

    if (event.triggers.includes('Strong Sell Pressure')) {
        cards.push(makeCard(
            event,
            'sell-pressure',
            getHonestTriggerLabel('Strong Sell Pressure'),
            `${tokenLabel} has sell-side USD flow leading buy-side flow across the latest 24h market activity.`,
            Math.max(event.metrics.sellVolume24h || 0, valueBasis),
            'bearish'
        ));
    }

    if (event.triggers.includes('Price Recovery') || event.triggers.includes('Confirmed Recovery')) {
        const trigger = event.triggers.includes('Confirmed Recovery') ? 'Confirmed Recovery' : 'Price Recovery';
        cards.push(makeCard(
            event,
            'recovery',
            getHonestTriggerLabel(trigger),
            `${tokenLabel} is rebounding with ${event.metrics.priceChange24h >= 0 ? '+' : ''}${event.metrics.priceChange24h.toFixed(2)}% 24h price momentum and buy-side flow support.`,
            event.metrics.volume24h,
            'bullish'
        ));
    }

    if (event.triggers.includes('Sharp Pullback') || event.triggers.includes('Price Dump') || event.triggers.includes('Major Dump')) {
        const trigger = event.triggers.includes('Major Dump') ? 'Major Dump' : event.triggers.includes('Price Dump') ? 'Price Dump' : 'Sharp Pullback';
        cards.push(makeCard(
            event,
            'price-dump',
            getHonestTriggerLabel(trigger),
            `${tokenLabel} moved ${event.metrics.priceChange24h.toFixed(2)}% over 24h with sell-side or liquidity context.`,
            event.metrics.volume24h,
            'bearish'
        ));
    }

    if (event.metrics.priceChange24h >= 12 && !event.triggers.includes('Price Recovery') && !event.triggers.includes('Confirmed Recovery')) {
        cards.push(makeCard(
            event,
            'price-pump',
            'Major Pump Event',
            `${tokenLabel} moved +${event.metrics.priceChange24h.toFixed(2)}% over 24h with meaningful volume.`,
            event.metrics.volume24h,
            'bullish'
        ));
    }

    if (event.triggers.includes('Volume Spike') || event.triggers.includes('Elevated Volume')) {
        const trigger = event.triggers.includes('Volume Spike') ? 'Volume Spike' : 'Elevated Volume';
        cards.push(makeCard(
            event,
            'volume',
            getHonestTriggerLabel(trigger),
            getDetectionVolumeDescription(event),
            event.metrics.volume24h,
            'neutral'
        ));
    }

    if (event.triggers.includes('Liquidity Added')) {
        cards.push(makeCard(
            event,
            'liquidity-added',
            getHonestTriggerLabel('Liquidity Added'),
            `${tokenLabel} has deep current liquidity structure with ${formatCompactUsd(event.metrics.liquidity)} active liquidity. Fresh liquidity addition is not yet snapshot-confirmed.`,
            event.metrics.liquidity,
            'bullish'
        ));
    }

    if (event.triggers.includes('Liquidity Removed')) {
        cards.push(makeCard(
            event,
            'liquidity-removed',
            getHonestTriggerLabel('Liquidity Removed'),
            `${tokenLabel} has thin liquidity risk with ${formatCompactUsd(event.metrics.liquidity)} active liquidity remaining. Actual liquidity removal is not yet snapshot-confirmed.`,
            event.metrics.liquidity,
            'bearish'
        ));
    }

    if (event.triggers.includes('Abnormal Large Trades')) {
        const positiveFlow = event.metrics.netFlow > 0;
        const negativeFlow = event.metrics.netFlow < 0;
        cards.push(makeCard(
            event,
            'large-trades',
            positiveFlow ? 'Large Flow Inflow' : negativeFlow ? 'Large Flow Outflow' : getHonestTriggerLabel('Abnormal Large Trades'),
            `${tokenLabel} has ${positiveFlow ? 'positive' : negativeFlow ? 'negative' : 'unusual'} net flow of ${formatCompactUsd(Math.abs(event.metrics.netFlow))}.`,
            Math.abs(event.metrics.netFlow),
            positiveFlow ? 'bullish' : negativeFlow ? 'bearish' : 'neutral'
        ));
    }

    if (event.triggers.includes('Possible Artificial Volume')) {
        cards.push(makeCard(
            event,
            'possible-artificial-volume',
            getHonestTriggerLabel('Possible Artificial Volume'),
            `${tokenLabel} has unusually high activity with balanced buy/sell flow and muted price movement.`,
            event.metrics.volume24h,
            'neutral'
        ));
    }

    return cards;
};
