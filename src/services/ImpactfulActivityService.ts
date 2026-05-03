import { RealActivity } from './ChainActivityService';

export type ImpactfulActivity = {
    id: string;
    type: string;
    severity: 'Critical' | 'High' | 'Signal';
    title: string;
    description: string;
    usdValue: number;
    tokenAmount: number;
    wallet: string;
    txHash: string;
    detectedAt: number;
    source: 'webhook' | 'recent-scan';
};

const parseUsd = (value: string) => Number(String(value || '').replace(/[$,]/g, '')) || 0;

const getThresholds = (liquidityUsd: number) => {
    const liquidityBased = liquidityUsd > 0 ? liquidityUsd * 0.005 : 0;
    const whaleThreshold = Math.max(1_000, Math.min(25_000, liquidityBased || 5_000));

    return { whaleThreshold };
};

const normalizeColorSeverity = (event: RealActivity, usdValue: number, threshold: number): ImpactfulActivity['severity'] => {
    if (event.type === 'Sell' && usdValue >= threshold * 3) return 'Critical';
    if (event.type === 'Sell' || usdValue >= threshold * 3) return 'High';
    return 'Signal';
};

const normalizeTitle = (event: RealActivity, usdValue: number, threshold: number) => {
    if (event.type === 'Buy') return 'Whale Buy';
    if (event.type === 'Sell') return 'Whale Sell';
    if (event.type === 'Burn') return 'Token Burn';
    if (event.tag === 'Whale' || usdValue >= threshold * 2) return 'Large Wallet Movement';
    return event.type;
};

export const ImpactfulActivityService = {
    watchToken: async (input: {
        chain: string;
        tokenAddress: string;
        pairAddress?: string;
        priceUsd: number;
        liquidityUsd: number;
        ttlMs?: number;
        configureWebhook?: boolean;
    }) => {
        try {
            await fetch('/api/token-activity/watch', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(input)
            });
        } catch (error) {
            console.warn('[ImpactfulActivity] watch registration failed', error);
        }
    },

    cacheActivities: async (chain: string, tokenAddress: string, activities: ImpactfulActivity[]): Promise<ImpactfulActivity[]> => {
        if (!activities.length) return [];

        try {
            const response = await fetch('/api/token-activity/cache', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ chain, tokenAddress, activities })
            });
            if (!response.ok) return activities;
            const data = await response.json();
            return Array.isArray(data.activities) ? data.activities : activities;
        } catch (error) {
            console.warn('[ImpactfulActivity] cache write failed', error);
            return activities;
        }
    },

    getWebhookActivities: async (chain: string, tokenAddress: string): Promise<ImpactfulActivity[]> => {
        try {
            const response = await fetch(`/api/token-activity/${encodeURIComponent(chain.toLowerCase())}/${encodeURIComponent(tokenAddress)}`);
            if (!response.ok) return [];
            const data = await response.json();
            const activities = Array.isArray(data.activities) ? data.activities : [];

            return activities.map((activity: any) => ({
                id: activity.id,
                type: activity.type,
                severity: activity.severity,
                title: activity.title,
                description: activity.description,
                usdValue: Number(activity.usdValue || 0),
                tokenAmount: Number(activity.tokenAmount || 0),
                wallet: activity.wallet || '',
                txHash: activity.txHash || '',
                detectedAt: Number(activity.detectedAt || Date.now()),
                source: 'webhook'
            }));
        } catch (error) {
            console.warn('[ImpactfulActivity] webhook activity fetch failed', error);
            return [];
        }
    },

    fromRecentChainActivity: (events: RealActivity[], liquidityUsd: number): ImpactfulActivity[] => {
        const { whaleThreshold } = getThresholds(liquidityUsd);

        return events
            .map((event, index): ImpactfulActivity | null => {
                const usdValue = parseUsd(event.usd);
                const isImpactfulTrade = (event.type === 'Buy' || event.type === 'Sell') && usdValue >= whaleThreshold;
                const isImpactfulBurn = event.type === 'Burn' && usdValue >= Math.max(1_000, whaleThreshold * 0.25);
                const isWhaleTransfer = event.type === 'Transfer' && usdValue >= Math.max(whaleThreshold * 2, 5_000);

                if (!isImpactfulTrade && !isImpactfulBurn && !isWhaleTransfer) return null;

                return {
                    id: `${event.hash}-${event.type}-${index}`,
                    type: event.type,
                    severity: normalizeColorSeverity(event, usdValue, whaleThreshold),
                    title: normalizeTitle(event, usdValue, whaleThreshold),
                    description: event.desc,
                    usdValue,
                    tokenAmount: Number(event.val || 0),
                    wallet: event.wallet,
                    txHash: event.hash,
                    detectedAt: Date.now(),
                    source: 'recent-scan' as const
                };
            })
            .filter((event): event is ImpactfulActivity => event !== null);
    }
};
