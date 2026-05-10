import type { AlphaGauntletEvent } from '../src/types';
import type { ImpactfulTokenActivity } from './impactful-token-activity';
import { buildDetectionTimelineCards } from '../src/services/detection/DetectionTimelinePresenter';

const normalizeAddress = (value = '') => value.trim().toLowerCase();

const severityForSentiment = (sentiment: 'bullish' | 'bearish' | 'neutral', event: AlphaGauntletEvent): ImpactfulTokenActivity['severity'] => {
    if (sentiment === 'bearish' && event.severity !== 'Low') return 'Critical';
    if (sentiment === 'bearish') return 'High';
    if (event.severity === 'High') return 'High';
    return 'Signal';
};

export const buildDetectionImpactActivities = (event: AlphaGauntletEvent): ImpactfulTokenActivity[] => {
    const tokenAddress = event.token.address;
    if (!tokenAddress) return [];

    const chain = event.token.chain.toLowerCase();

    return buildDetectionTimelineCards(event).map((card): ImpactfulTokenActivity => ({
        id: card.id,
        chain,
        tokenAddress: normalizeAddress(tokenAddress),
        type: card.type,
        severity: severityForSentiment(card.sentiment, event),
        title: card.title,
        description: card.description,
        usdValue: card.usdValue,
        tokenAmount: 0,
        wallet: event.token.pairAddress || tokenAddress,
        txHash: card.id,
        detectedAt: card.detectedAt,
        source: 'detection-engine'
    }));
};
