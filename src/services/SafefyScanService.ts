import { APP_CONFIG } from '../config';

export type InsightXNetwork = 'sol' | 'eth' | 'base' | 'bsc' | 'monad' | 'xlayer' | 'abs' | 'sui';

export type InsightXEndpointStatus =
    | 'available'
    | 'unsupported'
    | 'missing'
    | 'error'
    | 'rate_limited'
    | 'not_configured';

export type InsightXEndpointResult<T = unknown> = {
    status: InsightXEndpointStatus;
    data: T | null;
    error?: string;
    httpStatus?: number;
    cached?: boolean;
    cachedAt?: string;
    fetchedAt: string;
    retryAfter?: string | null;
};

export type InsightXToken = {
    address: string;
    name?: string | null;
    symbol?: string | null;
    logo?: string | null;
    decimals?: number | null;
    total_supply?: number | null;
    age?: number | null;
    socials?: Array<{ type: string; url?: string | null }>;
    additional_info?: Record<string, unknown> | null;
};

export type InsightXScannerResponse = {
    network?: { name: string; symbol: string };
    token?: InsightXToken;
    extensions?: Record<string, unknown>;
    results?: {
        generated_at?: number;
        simple?: {
            score?: number;
            message?: string;
            reasons?: string[];
        };
        advanced?: Record<string, any>;
    };
};

export type InsightXOverview = {
    cluster_pct?: number;
    snipers_pct?: number;
    bundlers_pct?: number;
    dev_pct?: number;
    insiders_pct?: number;
    top10_pct?: number;
};

export type InsightXDistribution = {
    gini?: number;
    hhi?: number;
    nakamoto?: number;
    top_10_holder_concentration?: number;
};

export type InsightXWalletEntry = {
    address?: string;
    balance?: number;
    percentage?: number;
    reasons?: string[] | null;
    slot?: number | null;
    label?: string;
    tags?: string[];
    smart_contract?: boolean;
};

export type InsightXSnipers = {
    total_sniper_pct?: number;
    count?: {
        total?: number;
        sold_partially?: number;
        sold_fully?: number;
        bought_more?: number;
    };
    snipers?: InsightXWalletEntry[];
};

export type InsightXBundlers = {
    total_bundlers_pct?: number;
    bundlers?: InsightXWalletEntry[];
};

export type InsightXInsiders = {
    total_insiders_pct?: number;
    insiders?: InsightXWalletEntry[];
};

export type InsightXLabel = {
    address: string;
    label: string;
    tags?: string[];
    smart_contract: boolean;
};

export type InsightXAtlasSnapshot = {
    nodes?: Array<Record<string, any>>;
    links?: Array<Record<string, any>>;
    edges?: Array<Record<string, any>>;
    token?: Record<string, any>;
    currency?: Record<string, any>;
    [key: string]: any;
};

export type SafefyScanReport = {
    network: InsightXNetwork;
    address: string;
    generatedAt: string;
    source: 'insightx';
    endpoints: {
        scanner: InsightXEndpointResult<InsightXScannerResponse>;
        overview: InsightXEndpointResult<InsightXOverview>;
        distribution: InsightXEndpointResult<InsightXDistribution>;
        clusters: InsightXEndpointResult<any>;
        snipers: InsightXEndpointResult<InsightXSnipers>;
        bundlers: InsightXEndpointResult<InsightXBundlers>;
        insiders: InsightXEndpointResult<InsightXInsiders>;
        atlasLatest: InsightXEndpointResult<InsightXAtlasSnapshot>;
        atlasTimestamps: InsightXEndpointResult<unknown>;
        labels: InsightXEndpointResult<InsightXLabel[]>;
    };
};

export type LiveTokenLiquidity = {
    tokenLiquidity: number;
    liquidityUsd: number;
    tokenPriceUsd: number | null;
    pairCount: number;
    source: string;
};

export type DetectedTokenNetwork = {
    network: InsightXNetwork;
    confidence: 'high' | 'medium' | 'low';
    source: string;
};

export const INSIGHTX_NETWORKS: Array<{ id: InsightXNetwork; label: string; family: 'Solana' | 'EVM' | 'Sui' }> = [
    { id: 'sol', label: 'Solana', family: 'Solana' },
    { id: 'eth', label: 'Ethereum', family: 'EVM' },
    { id: 'base', label: 'Base', family: 'EVM' },
    { id: 'bsc', label: 'BNB Chain', family: 'EVM' },
    { id: 'monad', label: 'Monad', family: 'EVM' },
    { id: 'xlayer', label: 'X Layer', family: 'EVM' },
    { id: 'abs', label: 'Abstract', family: 'EVM' },
    { id: 'sui', label: 'Sui', family: 'Sui' }
];

const inFlightReports = new Map<string, Promise<SafefyScanReport>>();

const DEXSCREENER_CHAIN_IDS: Partial<Record<InsightXNetwork, string>> = {
    sol: 'solana',
    eth: 'ethereum',
    base: 'base',
    bsc: 'bsc',
    monad: 'monad',
    xlayer: 'xlayer',
    abs: 'abstract',
    sui: 'sui'
};

const EVM_NETWORKS = INSIGHTX_NETWORKS
    .filter((item) => item.family === 'EVM')
    .map((item) => item.id);

function apiUrl(path: string) {
    return APP_CONFIG.apiBaseUrl
        ? `${APP_CONFIG.apiBaseUrl.replace(/\/$/, '')}${path}`
        : path;
}

function localBackendApiUrl(path: string) {
    if (APP_CONFIG.apiBaseUrl || typeof window === 'undefined') return '';
    const hostname = window.location.hostname;
    if (hostname !== 'localhost' && hostname !== '127.0.0.1') return '';
    return `http://127.0.0.1:3101${path}`;
}

async function retryLocalBackend(path: string, primaryResponse: Response) {
    const fallbackUrl = localBackendApiUrl(path);
    if (!fallbackUrl || primaryResponse.status !== 404) return primaryResponse;
    try {
        return await fetch(fallbackUrl);
    } catch {
        return primaryResponse;
    }
}

async function fetchJson<T>(path: string): Promise<T> {
    const primaryResponse = await fetch(apiUrl(path));
    const response = await retryLocalBackend(path, primaryResponse);
    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
        throw new Error(typeof payload?.error === 'string' ? payload.error : `Safety scan request failed with status ${response.status}.`);
    }

    return payload as T;
}

export function isLikelyInsightXAddress(address: string, network: InsightXNetwork) {
    const value = address.trim();
    if (!value) return false;
    if (network === 'sol') return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value);
    if (network === 'sui') return value.length > 20;
    return /^0x[a-fA-F0-9]{40}$/.test(value);
}

export function getInsightXNetworkLabel(network: InsightXNetwork) {
    return INSIGHTX_NETWORKS.find((item) => item.id === network)?.label || network.toUpperCase();
}

async function getDexScreenerTokenPairs(network: InsightXNetwork, address: string) {
    const chainId = DEXSCREENER_CHAIN_IDS[network];
    if (!chainId) return [];

    const response = await fetch(`https://api.dexscreener.com/token-pairs/v1/${encodeURIComponent(chainId)}/${encodeURIComponent(address.trim())}`);
    if (!response.ok) return [];

    const pairs = await response.json().catch(() => []);
    return Array.isArray(pairs) ? pairs : [];
}

function summarizeDexScreenerPairs(pairs: any[], address: string) {
    const normalizedAddress = address.trim().toLowerCase();
    return pairs.reduce((acc, pair: any) => {
        const liquidity = pair?.liquidity || {};
        const liquidityUsd = Number(liquidity.usd);
        const priceUsd = Number(pair?.priceUsd);
        const baseAddress = String(pair?.baseToken?.address || '').toLowerCase();
        const quoteAddress = String(pair?.quoteToken?.address || '').toLowerCase();
        const tokenLiquidity = baseAddress === normalizedAddress
            ? Number(liquidity.base)
            : quoteAddress === normalizedAddress
                ? Number(liquidity.quote)
                : NaN;

        if (Number.isFinite(tokenLiquidity) && tokenLiquidity > 0) {
            acc.tokenLiquidity += tokenLiquidity;
            acc.pairCount += 1;
            if (Number.isFinite(priceUsd) && priceUsd > 0) {
                acc.weightedPriceTotal += priceUsd * tokenLiquidity;
                acc.priceWeight += tokenLiquidity;
            }
        }
        if (Number.isFinite(liquidityUsd) && liquidityUsd > 0) {
            acc.liquidityUsd += liquidityUsd;
        }
        return acc;
    }, { tokenLiquidity: 0, liquidityUsd: 0, weightedPriceTotal: 0, priceWeight: 0, pairCount: 0 });
}

export const SafefyScanService = {
    async getHealth() {
        return fetchJson<{ configured: boolean; cacheEntries: number }>('/api/insightx/health');
    },

    async scanToken(network: InsightXNetwork, address: string) {
        const normalizedAddress = address.trim();
        if (!isLikelyInsightXAddress(normalizedAddress, network)) {
            throw new Error(network === 'sol'
                ? 'Enter a valid Solana token address.'
                : network === 'sui'
                    ? 'Enter a valid Sui token address.'
                    : 'Enter a valid 0x token address for this network.');
        }

        const key = `${network}:${normalizedAddress.toLowerCase()}`;
        const inFlight = inFlightReports.get(key);
        if (inFlight) return inFlight;

        const params = new URLSearchParams({ network, address: normalizedAddress });
        const request = fetchJson<SafefyScanReport>(`/api/insightx/report?${params.toString()}`)
            .finally(() => {
                inFlightReports.delete(key);
            });

        inFlightReports.set(key, request);
        return request;
    },

    async detectTokenNetwork(address: string): Promise<DetectedTokenNetwork | null> {
        const value = address.trim();
        if (!value) return null;
        if (/^0x[a-fA-F0-9]{40}$/.test(value)) {
            const candidates = await Promise.all(EVM_NETWORKS.map(async (network) => {
                const pairs = await getDexScreenerTokenPairs(network, value);
                const totals = summarizeDexScreenerPairs(pairs, value);
                return { network, ...totals };
            }));
            const best = candidates
                .filter((item) => item.pairCount > 0 || item.liquidityUsd > 0)
                .sort((a, b) => b.liquidityUsd - a.liquidityUsd || b.pairCount - a.pairCount)[0];

            return best
                ? { network: best.network, confidence: best.liquidityUsd > 0 ? 'high' : 'medium', source: 'DexScreener' }
                : { network: 'eth', confidence: 'low', source: 'Address format' };
        }

        if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value)) {
            return { network: 'sol', confidence: 'medium', source: 'Address format' };
        }

        if (value.length > 44) {
            return { network: 'sui', confidence: 'low', source: 'Address format' };
        }

        return null;
    },

    async getLiveTokenLiquidity(network: InsightXNetwork, address: string): Promise<LiveTokenLiquidity | null> {
        const pairs = await getDexScreenerTokenPairs(network, address);
        const totals = summarizeDexScreenerPairs(pairs, address);

        if (totals.tokenLiquidity <= 0 && totals.liquidityUsd <= 0) return null;

        return {
            tokenLiquidity: totals.tokenLiquidity,
            liquidityUsd: totals.liquidityUsd,
            tokenPriceUsd: totals.priceWeight > 0 ? totals.weightedPriceTotal / totals.priceWeight : null,
            pairCount: totals.pairCount,
            source: 'DexScreener'
        };
    }
};
