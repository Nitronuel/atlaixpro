// Atlaix: Intelligence service module for Atlaix data workflows.
import { MarketCoin, SavedWallet } from '../types';
import { createClient } from '@supabase/supabase-js';
import { APP_CONFIG } from '../config';

// --- INITIALIZE SUPABASE ---
const hasSupabaseConfig = Boolean(APP_CONFIG.supabaseUrl && APP_CONFIG.supabaseAnonKey);
const supabase = hasSupabaseConfig
    ? createClient(APP_CONFIG.supabaseUrl, APP_CONFIG.supabaseAnonKey, {
        auth: {
            persistSession: false,
            autoRefreshToken: false
        }
    })
    : null;
let supabaseAvailable = hasSupabaseConfig;
let hasWarnedAboutSupabase = false;
let lastStalePurgeAt = 0;

const warnSupabaseOnce = (message: string) => {
    if (hasWarnedAboutSupabase) return;
    hasWarnedAboutSupabase = true;
    console.warn(message);
};

const DEXSCREENER_SEARCH_URL = '/api/dexscreener/latest/dex/search';
const DEXSCREENER_PAIRS_URL = '/api/dexscreener/latest/dex/pairs';
const DEXSCREENER_TOKENS_URL = '/api/dexscreener/latest/dex/tokens';
const SMART_MONEY_TABLE = 'smart_money_wallets';

// --- REQUIREMENTS ---
// Broaden discovery intake, then rank for quality before surfacing to the feed.
const REQUIREMENTS = {
    DISCOVERY_MIN_LIQUIDITY_USD: 50000,
    DISCOVERY_MIN_VOLUME_24H: 10000,
    DISCOVERY_MIN_TXNS_24H: 25,
    RETENTION_MIN_LIQUIDITY_USD: 40000,
    RETENTION_MIN_VOLUME_24H: 5000,
    FEED_MIN_SCORE: 32,
    TARGET_LIST_SIZE: 1000
};

const EXCLUDED_SYMBOLS = [
    'USDC', 'USDT', 'DAI', 'BUSD', 'TUSD', 'USDS', 'EURC', 'STETH',
    'USDE', 'FDUSD', 'WRAPPED', 'MSOL', 'JITOSOL', 'SLERF'
];

const USD_QUOTE_SYMBOLS = new Set([
    'USD', 'USDC', 'USDT', 'DAI', 'USDS',
    'WETH', 'ETH', 'SOL', 'WSOL', 'WBTC', 'BTC', 'WBNB', 'BNB'
]);

// --- SEED DATA (CLEARED) ---
// Seed data cleared to prioritize live network scanning.
const SEED_DATA: MarketCoin[] = [];

// --- DISCOVERY QUERIES ---
// Broad discovery terms to reduce blind spots across chains, narratives, and meme rotations.
const TARGET_QUERIES = [
    // L1s & L2s
    'SOL', 'BASE', 'ETH', 'BSC', 'ARB', 'ARBITRUM', 'OP', 'OPTIMISM', 'POLY', 'POLYGON', 'AVAX', 'SUI', 'APT', 'SEI', 'TRON', 'TON',
    // Narratives
    'AI', 'AGENT', 'AGENTS', 'COMPUTE', 'DATA', 'CLOUD', 'DEPIN', 'RWA', 'GAMING', 'GAME', 'BET', 'CASINO', 'INFRA', 'ROBOT', 'GPU', 'MEMEAI',
    // Memes (Top)
    'PEPE', 'WIF', 'BONK', 'FLOKI', 'SHIB', 'DOGE', 'MOG', 'POPCAT', 'MEW', 'BRETT', 'ANDY', 'WOLF', 'PENGU', 'FARTCOIN', 'GIGA',
    // Memes (Culture)
    'TRUMP', 'MAGA', 'BIDEN', 'VOTE', 'USA', 'PEPE', 'WOJAK', 'CHAD', 'SIGMA', 'BASED', 'CULT', 'VIRAL',
    // Animals
    'CAT', 'DOG', 'FROG', 'TOAD', 'APE', 'MONKEY', 'LION', 'TIGER', 'FISH', 'PANDA', 'SHARK', 'FOX', 'PIG', 'HAMSTER',
    // Tech/Generic
    'TECH', 'PROTO', 'PROTOCOL', 'SWAP', 'DEX', 'YIELD', 'FARM', 'DAO', 'GOV', 'ALPHA', 'BETA', 'INDEX', 'MEME', 'TRENDING',
    // Meta/Trending
    'NEIRO', 'MOODENG', 'GOAT', 'SPX', 'GNO', 'VIRTUAL', 'LUNA', 'BANK', 'AIXBT', 'GAME', 'MOODENG', 'MUBARAK',
    // Launch / rotation
    'PUMP', 'MOON', 'LAUNCH', 'EARLY', 'HOT', 'TREND', 'TRENDING NOW', 'NEW', 'FRESH',
    // Chain-native meme anchors
    'JUP', 'RAY', 'JTO', 'ORCA', 'TOSHI', 'DEGEN', 'AERO', 'MFER', 'NEIROETH', 'FWOG'
];

// Shuffle queries once on load
let SHUFFLED_QUERIES = [...TARGET_QUERIES].sort(() => Math.random() - 0.5);
let currentQueryIndex = 0;

const takeDiscoveryQueries = (batchSize: number, restartFromTop: boolean = false) => {
    if (SHUFFLED_QUERIES.length === 0) return [];

    if (restartFromTop || batchSize >= SHUFFLED_QUERIES.length) {
        currentQueryIndex = 0;
        SHUFFLED_QUERIES = [...TARGET_QUERIES].sort(() => Math.random() - 0.5);
        currentQueryIndex = 0;
        return [...SHUFFLED_QUERIES];
    }

    const end = Math.min(currentQueryIndex + batchSize, SHUFFLED_QUERIES.length);
    const queries = SHUFFLED_QUERIES.slice(currentQueryIndex, end);

    if (end >= SHUFFLED_QUERIES.length) {
        SHUFFLED_QUERIES = [...TARGET_QUERIES].sort(() => Math.random() - 0.5);
        currentQueryIndex = 0;
    } else {
        currentQueryIndex = end;
    }

    return queries;
};

// API Response Types
interface DexPair {
    chainId: string;
    dexId: string;
    url: string;
    pairAddress: string;
    baseToken: { address: string; name: string; symbol: string; };
    quoteToken: { symbol: string; };
    priceUsd: string;
    priceChange: { h1: number; h24: number; h6: number; };
    liquidity?: { usd: number; };
    fdv?: number;
    volume: { h24: number; };
    txns: { h24: { buys: number; sells: number; } };
    pairCreatedAt?: number;
    info?: { imageUrl?: string; };
}

interface Cache {
    marketData: { data: MarketCoin[]; timestamp: number; } | null;
}
const cache: Cache = { marketData: null };
const CACHE_FRESH_DURATION = 15000; // Refresh every 15s to find new tokens continually
const STALE_TOKEN_RETENTION_DAYS = 7;
const HYDRATION_LIMIT = 700;
const ACTIVE_FEED_LIMIT = 1000;
const STALE_PURGE_INTERVAL_MS = 12 * 60 * 60 * 1000;
const LOCAL_CACHE_KEY = 'atlaix-live-alpha-cache';
const LOCAL_CACHE_MAX_AGE_MS = 60 * 60 * 1000;
const DEXSCREENER_SEARCH_CACHE_TTL_MS = 3 * 60 * 1000;
const DEXSCREENER_RATE_LIMIT_COOLDOWN_MS = 45 * 1000;
const DEXSCREENER_SEARCH_CONCURRENCY = 3;

const dexSearchCache = new Map<string, { expiresAt: number; pairs: DexPair[] }>();
const dexInflightSearches = new Map<string, Promise<DexPair[]>>();
let dexRateLimitedUntil = 0;

// Helpers
const formatCurrency = (value: number) => {
    if (!value && value !== 0) return '$0.00';
    if (value >= 1000000000) return `$${(value / 1000000000).toFixed(2)}B`;
    if (value >= 1000000) return `$${(value / 1000000).toFixed(2)}M`;
    if (value >= 1000) return `$${(value / 1000).toFixed(2)}K`;
    return `$${value.toFixed(2)}`;
};

const formatPrice = (price: string | number) => {
    const num = typeof price === 'string' ? parseFloat(price) : price;
    if (isNaN(num)) return '$0.00';
    if (num === 0) return '$0.00';

    // Avoid scientific notation for small numbers
    if (num < 0.01) {
        // limit to 10 decimals, remove trailing zeros
        return `$${num.toFixed(12).replace(/\.?0+$/, '')}`;
    }
    if (num < 1.00) return `$${num.toFixed(6)}`;
    return `$${num.toFixed(2)}`;
};

const parseFormattedValue = (val: string): number => {
    if (!val) return 0;
    const clean = val.replace(/[$,]/g, '');
    let multiplier = 1;
    if (clean.includes('B')) multiplier = 1e9;
    else if (clean.includes('M')) multiplier = 1e6;
    else if (clean.includes('K')) multiplier = 1e3;
    return parseFloat(clean) * multiplier;
};

const getStaleCutoffIso = () => {
    const cutoff = new Date(Date.now() - (STALE_TOKEN_RETENTION_DAYS * 24 * 60 * 60 * 1000));
    return cutoff.toISOString();
};

const canUseLocalStorage = () => typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';

const setCachedMarketData = (data: MarketCoin[]) => {
    cache.marketData = { data, timestamp: Date.now() };

    if (!canUseLocalStorage()) return;

    try {
        window.localStorage.setItem(LOCAL_CACHE_KEY, JSON.stringify(cache.marketData));
    } catch {
        // Ignore storage quota and privacy mode errors.
    }
};

const getLocalCachedMarketData = () => {
    if (!canUseLocalStorage()) return null;

    try {
        const raw = window.localStorage.getItem(LOCAL_CACHE_KEY);
        if (!raw) return null;

        const parsed = JSON.parse(raw) as Cache['marketData'];
        if (!parsed?.data || !Array.isArray(parsed.data) || typeof parsed.timestamp !== 'number') return null;
        if (Date.now() - parsed.timestamp > LOCAL_CACHE_MAX_AGE_MS) return null;

        return parsed;
    } catch {
        return null;
    }
};

const getTimeAgo = (timestamp: number) => {
    const diffMs = Date.now() - timestamp;
    const minutes = Math.floor(diffMs / 60000);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (minutes < 60) return `${Math.max(0, minutes)} Mins`;
    if (hours < 24) return `${hours} Hours`;
    if (days === 1) return `1 Day`;
    return `${days} Days`;
};

const mapSmartMoneyRowToWallet = (row: any): SavedWallet => ({
    addr: row.wallet_address,
    name: row.name || `Tracked ${String(row.wallet_address || '').slice(0, 6)}...${String(row.wallet_address || '').slice(-4)}`,
    categories: Array.isArray(row.categories) && row.categories.length ? row.categories : ['Smart Money'],
    timestamp: row.created_at ? new Date(row.created_at).getTime() : Date.now(),
    lastBalance: row.last_balance || undefined,
    lastWinRate: row.last_win_rate || undefined,
    lastPnl: row.last_pnl || undefined,
    qualification: row.qualification || undefined,
    autoTracked: false,
    autoPromotedToSmartMoney: true
});

const getChainId = (chainId: string) => {
    if (chainId === 'solana') return 'solana';
    if (chainId === 'ethereum') return 'ethereum';
    if (chainId === 'bsc') return 'bsc';
    if (chainId === 'base') return 'base';
    return 'ethereum';
};

const getTokenAddressKey = (chain: string | undefined, address: string | undefined) =>
    `${(chain || 'unknown').toLowerCase()}:${(address || '').toLowerCase()}`;

const getPairAddressKey = (pair: DexPair) => getTokenAddressKey(getChainId(pair.chainId), pair.baseToken.address);

const getPairStats = (pair: DexPair) => {
    const liquidity = pair.liquidity?.usd || 0;
    const volume = pair.volume?.h24 || 0;
    const buys = pair.txns?.h24?.buys || 0;
    const sells = pair.txns?.h24?.sells || 0;
    const txns = buys + sells;
    const ageHours = pair.pairCreatedAt ? (Date.now() - pair.pairCreatedAt) / (1000 * 60 * 60) : 9999;
    const priceChange24h = pair.priceChange?.h24 || 0;
    const flowRatio = txns > 0 ? buys / txns : 0.5;
    return { liquidity, volume, buys, sells, txns, ageHours, priceChange24h, flowRatio };
};

const meetsDiscoveryThresholds = (pair: DexPair) => {
    const { liquidity, volume, txns } = getPairStats(pair);
    return (
        liquidity >= REQUIREMENTS.DISCOVERY_MIN_LIQUIDITY_USD &&
        volume >= REQUIREMENTS.DISCOVERY_MIN_VOLUME_24H &&
        txns >= REQUIREMENTS.DISCOVERY_MIN_TXNS_24H
    );
};

const scorePair = (pair: DexPair, isExisting: boolean = false) => {
    const { liquidity, volume, txns, ageHours, priceChange24h, flowRatio } = getPairStats(pair);

    const liquidityScore = Math.min(liquidity / 250000, 8) * 8;
    const volumeScore = Math.min(volume / 100000, 8) * 7;
    const txnScore = Math.min(txns / 100, 6) * 4;
    const ageScore = ageHours <= 24 ? 12 : ageHours <= 72 ? 9 : ageHours <= 168 ? 5 : 2;
    const momentumScore = Math.max(-8, Math.min(priceChange24h, 25)) * 0.4;
    const flowScore = Math.max(0, (flowRatio - 0.45) * 30);
    const logoScore = pair.info?.imageUrl ? 5 : 0;
    const chainScore = ['solana', 'base', 'ethereum', 'bsc'].includes(getChainId(pair.chainId)) ? 3 : 0;
    const fdv = pair.fdv || 0;
    const fdvPenalty = fdv > 0 && fdv < 250000 ? -6 : 0;
    const existingScore = isExisting ? 6 : 0;

    return liquidityScore + volumeScore + txnScore + ageScore + momentumScore + flowScore + logoScore + chainScore + existingScore + fdvPenalty;
};

const scoreMarketCoin = (coin: MarketCoin) => {
    const liquidity = parseFormattedValue(coin.liquidity);
    const volume = parseFormattedValue(coin.volume24h);
    const buys = parseInt(coin.dexBuys || '0', 10) || 0;
    const sells = parseInt(coin.dexSells || '0', 10) || 0;
    const txns = buys + sells;
    const flowRatio = txns > 0 ? buys / txns : 0.5;
    const ageHours = coin.createdTimestamp ? (Date.now() - coin.createdTimestamp) / (1000 * 60 * 60) : 9999;
    const change24h = parseFloat(coin.h24.replace(/[%+,]/g, '')) || 0;

    const liquidityScore = Math.min(liquidity / 250000, 8) * 8;
    const volumeScore = Math.min(volume / 100000, 8) * 7;
    const txnScore = Math.min(txns / 100, 6) * 4;
    const ageScore = ageHours <= 24 ? 12 : ageHours <= 72 ? 9 : ageHours <= 168 ? 5 : 2;
    const momentumScore = Math.max(-8, Math.min(change24h, 25)) * 0.4;
    const flowScore = Math.max(0, (flowRatio - 0.45) * 30);
    const logoScore = coin.img?.includes('ui-avatars.com') ? 0 : 5;

    return liquidityScore + volumeScore + txnScore + ageScore + momentumScore + flowScore + logoScore + 4;
};

const shouldRetainCoin = (coin: MarketCoin) => {
    const liquidity = parseFormattedValue(coin.liquidity);
    const volume = parseFormattedValue(coin.volume24h);
    return (
        liquidity >= REQUIREMENTS.RETENTION_MIN_LIQUIDITY_USD &&
        volume >= REQUIREMENTS.RETENTION_MIN_VOLUME_24H
    );
};

const isUsefulDynamicQuery = (value: string) => {
    const normalized = value.trim();
    if (normalized.length < 2 || normalized.length > 24) return false;
    return /^[a-z0-9 .+-]+$/i.test(normalized);
};

const buildDynamicQueries = (currentList: MarketCoin[]) => {
    const ranked = [...currentList].sort((a, b) => {
        const scoreA = parseFormattedValue(a.volume24h) + (parseFormattedValue(a.liquidity) * 0.2);
        const scoreB = parseFormattedValue(b.volume24h) + (parseFormattedValue(b.liquidity) * 0.2);
        return scoreB - scoreA;
    });

    const dynamic = new Set<string>();
    ranked.slice(0, 25).forEach((coin) => {
        const ticker = coin.ticker?.trim();
        const name = coin.name?.trim();
        const chain = coin.chain?.trim();

        if (ticker && isUsefulDynamicQuery(ticker)) dynamic.add(ticker);
        if (name && isUsefulDynamicQuery(name)) dynamic.add(name);
        if (name) {
            const firstWord = name.split(/\s+/)[0];
            if (isUsefulDynamicQuery(firstWord)) dynamic.add(firstWord);
        }
        if (chain && isUsefulDynamicQuery(chain)) dynamic.add(chain.toUpperCase());
    });

    return [...dynamic];
};

const getDiscoveryQueries = (currentList: MarketCoin[], batchSize: number, force: boolean = false) => {
    const baseQueries = takeDiscoveryQueries(batchSize, force);
    const dynamicQueries = buildDynamicQueries(currentList).slice(0, force ? 30 : 12);
    return [...new Set([...baseQueries, ...dynamicQueries])];
};

const mergeFetchedPairs = (pairs: DexPair[], existingAddresses: Set<string>) => {
    const bestByAddress = new Map<string, DexPair>();

    for (const pair of pairs) {
        const symbol = pair.baseToken?.symbol?.toUpperCase();
        if (!symbol || EXCLUDED_SYMBOLS.includes(symbol)) continue;

        const addressKey = getPairAddressKey(pair);
        const previous = bestByAddress.get(addressKey);
        const currentScore = scorePair(pair, existingAddresses.has(addressKey));
        const previousScore = previous ? scorePair(previous, existingAddresses.has(addressKey)) : Number.NEGATIVE_INFINITY;

        if (!previous || currentScore > previousScore) {
            bestByAddress.set(addressKey, pair);
        }
    }

    return [...bestByAddress.values()];
};

async function mapWithConcurrency<T, R>(
    items: T[],
    concurrency: number,
    worker: (item: T, index: number) => Promise<R>
) {
    const results: R[] = new Array(items.length);
    let cursor = 0;

    const runners = Array.from({ length: Math.max(1, Math.min(concurrency, items.length || 1)) }, async () => {
        while (cursor < items.length) {
            const currentIndex = cursor;
            cursor += 1;
            results[currentIndex] = await worker(items[currentIndex], currentIndex);
        }
    });

    await Promise.all(runners);
    return results;
}

// --- API METHODS ---

const searchDexScreener = async (query: string): Promise<DexPair[]> => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) return [];

    const cached = dexSearchCache.get(normalizedQuery);
    if (cached && cached.expiresAt > Date.now()) {
        return cached.pairs;
    }

    if (dexRateLimitedUntil > Date.now()) {
        return [];
    }

    const inflight = dexInflightSearches.get(normalizedQuery);
    if (inflight) {
        return inflight;
    }

    const request = (async () => {
        try {
            const response = await fetch(`${DEXSCREENER_SEARCH_URL}?q=${encodeURIComponent(query)}`);
            if (response.status === 429) {
                dexRateLimitedUntil = Date.now() + DEXSCREENER_RATE_LIMIT_COOLDOWN_MS;
                return [];
            }
            if (!response.ok) return [];
            const data = await response.json();
            const pairs = data.pairs || [];
            dexSearchCache.set(normalizedQuery, {
                expiresAt: Date.now() + DEXSCREENER_SEARCH_CACHE_TTL_MS,
                pairs
            });
            return pairs;
        } catch (e) {
            return [];
        } finally {
            dexInflightSearches.delete(normalizedQuery);
        }
    })();

    dexInflightSearches.set(normalizedQuery, request);

    try {
        return await request;
    } catch (e) {
        return [];
    }
};

const updatePairsBulk = async (chainId: string, pairAddresses: string[]): Promise<DexPair[]> => {
    try {
        // DexScreener supports up to 30 pairs per request
        const chunks = [];
        for (let i = 0; i < pairAddresses.length; i += 30) {
            chunks.push(pairAddresses.slice(i, i + 30));
        }

        const results = await Promise.all(chunks.map(async chunk => {
            try {
                const url = `${DEXSCREENER_PAIRS_URL}/${chainId}/${chunk.join(',')}`;
                const res = await fetch(url);
                if (!res.ok) return { pairs: [] };
                return await res.json();
            } catch (err) {
                return { pairs: [] };
            }
        }));

        let allPairs: DexPair[] = [];
        results.forEach((r: any) => {
            if (r && r.pairs) allPairs = [...allPairs, ...r.pairs];
        });
        return allPairs;
    } catch (e) {
        return [];
    }
};


export const DatabaseService = {
    getCachedMarketData: (): { data: MarketCoin[], source: string, latency: number } | null => {
        const start = performance.now();

        if (cache.marketData) {
            return {
                data: cache.marketData.data,
                source: 'MEMORY_CACHE',
                latency: Math.round(performance.now() - start)
            };
        }

        const localCache = getLocalCachedMarketData();
        if (!localCache) return null;

        cache.marketData = localCache;
        return {
            data: localCache.data,
            source: 'LOCAL_CACHE',
            latency: Math.round(performance.now() - start)
        };
    },

    getInitialMarketData: async (): Promise<{ data: MarketCoin[], source: string, latency: number }> => {
        const start = performance.now();
        const cached = DatabaseService.getCachedMarketData();
        if (cached?.data.length) {
            return cached;
        }

        const hydrated = await DatabaseService.fetchFromSupabase();
        if (hydrated.length) {
            setCachedMarketData(hydrated);
            return {
                data: hydrated,
                source: 'SUPABASE',
                latency: Math.round(performance.now() - start)
            };
        }

        return {
            data: SEED_DATA,
            source: 'EMPTY',
            latency: Math.round(performance.now() - start)
        };
    },

    getMarketData: async (force: boolean = false, partial: boolean = false): Promise<{ data: MarketCoin[], source: string, latency: number }> => {
        const start = performance.now();
        const shouldRunDiscovery = !partial;

        // Cache Check
        if (!force && !partial && cache.marketData) {
            const age = Date.now() - cache.marketData.timestamp;
            if (age < CACHE_FRESH_DURATION) {
                return {
                    data: cache.marketData.data,
                    source: 'CACHE',
                    latency: Math.round(performance.now() - start)
                };
            }
        }

        try {
            // 1. Load existing market data from the persistent database.
            let dbTokens = await DatabaseService.fetchFromSupabase();

            // --- SEED DATA INJECTION ---
            // If DB is empty (first run or permission error), use Seed Data immediately
            if (dbTokens.length === 0) {
                dbTokens = [...SEED_DATA];
            }

            let currentList = [...dbTokens];
            const currentCount = currentList.length;
            const existingAddressKeys = new Set(currentList.map((token) => getTokenAddressKey(token.chain, token.address)));

            let newPairs: DexPair[] = [];
            let updatedPairs: DexPair[] = [];

            // --- CRITICAL LOGIC: POPULATION VS MAINTENANCE ---

            // If we have fewer than target tokens, we avoid updating prices to conserve bandwidth.
            // Allocate full bandwidth to discovery operations.
            if (currentCount < REQUIREMENTS.TARGET_LIST_SIZE) {
                if ((force || partial) && currentList.length > 0) {
                    const chainMap: Record<string, string[]> = {};
                    currentList.forEach(t => {
                        const cid = t.chain === 'ethereum' ? 'ethereum' : t.chain === 'solana' ? 'solana' : t.chain === 'bsc' ? 'bsc' : 'base';
                        if (!chainMap[cid]) chainMap[cid] = [];
                        if (t.pairAddress) chainMap[cid].push(t.pairAddress);
                    });

                    const updatePromises = Object.entries(chainMap).map(([chainId, addrs]) => updatePairsBulk(chainId, addrs));
                    const updateResults = await Promise.all(updatePromises);
                    updateResults.forEach(pairs => updatedPairs = [...updatedPairs, ...pairs]);
                }

                // Phase 1: Aggressive Discovery
                // Focus strictly on finding new tokens. Defer refreshing existing data.
                // 25 Parallel Queries = Aggressive population without hitting limits.
                if (shouldRunDiscovery) {
                    const batchSize = force ? 12 : 8;
                    const queries = getDiscoveryQueries(currentList, batchSize, force);

                    const searchResults = await mapWithConcurrency(queries, DEXSCREENER_SEARCH_CONCURRENCY, (q) => searchDexScreener(q));
                    searchResults.forEach(pairs => newPairs = [...newPairs, ...pairs]);
                }

            } else {
                // Phase 2: Maintenance and Optimization
                // We have reached the target list size.
                // Priority 1: Keep prices fresh (Refresh ALL).
                // Priority 2: Continue searching for high-quality tokens to replace lower-quality ones.

                // A. Update existing tokens (Bulk Endpoint is efficient)
                const chainMap: Record<string, string[]> = {};

                // Refresh all tracked tokens to ensure real-time data accuracy.
                // Even at the current target size, chunking pair refreshes keeps requests bounded.
                currentList.forEach(t => {
                    const cid = t.chain === 'ethereum' ? 'ethereum' : t.chain === 'solana' ? 'solana' : t.chain === 'bsc' ? 'bsc' : 'base';
                    if (!chainMap[cid]) chainMap[cid] = [];
                    if (t.pairAddress) chainMap[cid].push(t.pairAddress);
                });

                const updatePromises = Object.entries(chainMap).map(([chainId, addrs]) => updatePairsBulk(chainId, addrs));
                const updateResults = await Promise.all(updatePromises);
                updateResults.forEach(pairs => updatedPairs = [...updatedPairs, ...pairs]);

                // B. Continuous Discovery (Run 5 searches to find new assets)
                // Continue discovery process to identify high-potential assets even when the list is at capacity.
                if (shouldRunDiscovery) {
                    const discoveryBatch = force ? 8 : 4;
                    const queries = getDiscoveryQueries(currentList, discoveryBatch, force);

                    const searchResults = await mapWithConcurrency(queries, DEXSCREENER_SEARCH_CONCURRENCY, (q) => searchDexScreener(q));
                    searchResults.forEach(pairs => newPairs = [...newPairs, ...pairs]);
                }
            }

            // 2. Process & Merge Data
            const allFetchedPairs = mergeFetchedPairs([...newPairs, ...updatedPairs], existingAddressKeys);
            const tokenMap = new Map<string, MarketCoin>();
            const pairScores = new Map<string, number>();

            // Fill map with existing DB data first
            currentList.forEach(t => {
                tokenMap.set(getTokenAddressKey(t.chain, t.address), t);
                pairScores.set(getTokenAddressKey(t.chain, t.address), scoreMarketCoin(t));
            });

            // Sort new pairs by liquidity
            allFetchedPairs.sort((a, b) => scorePair(b, existingAddressKeys.has(getPairAddressKey(b))) - scorePair(a, existingAddressKeys.has(getPairAddressKey(a))));

            for (const p of allFetchedPairs) {
                const addressKey = getPairAddressKey(p);
                const isExisting = tokenMap.has(addressKey);
                const candidateScore = scorePair(p, isExisting);

                if (!isExisting && !meetsDiscoveryThresholds(p)) continue;

                tokenMap.set(addressKey, DatabaseService.transformPair(p));
                pairScores.set(addressKey, candidateScore);
            }

            // 3. Convert back to array
            let mergedList = Array.from(tokenMap.entries())
                .map(([addressKey, coin]) => ({ addressKey, coin, score: pairScores.get(addressKey) ?? scoreMarketCoin(coin) }))
                .filter(({ coin, score }) => shouldRetainCoin(coin) && score >= REQUIREMENTS.FEED_MIN_SCORE);

            // 4. Sorting Strategy ("Hot Score")
            mergedList.sort((a, b) => {
                if (b.score !== a.score) return b.score - a.score;

                const volA = parseFormattedValue(a.coin.volume24h);
                const volB = parseFormattedValue(b.coin.volume24h);
                const liqA = parseFormattedValue(a.coin.liquidity);
                const liqB = parseFormattedValue(b.coin.liquidity);

                const scoreA = volA + (liqA * 0.2);
                const scoreB = volB + (liqB * 0.2);
                return scoreB - scoreA;
            });

            // 5. Limit size & Sync
            // Return the top 1000 assets to maintain a broader market view.
            const finalData = mergedList.slice(0, ACTIVE_FEED_LIMIT).map((entry) => entry.coin);

            // Sync new discoveries to DB (Background)
            if (newPairs.length > 0 || updatedPairs.length > 0) {
                DatabaseService.syncToSupabase(finalData).catch(err => console.warn("Supabase Sync Warning:", err.message));
            }

            setCachedMarketData(finalData);

            return {
                data: finalData,
                source: partial ? 'PARTIAL_UPDATE' : (newPairs.length > 0 ? 'LIVE_SEARCH' : 'LIVE_UPDATE'),
                latency: Math.round(performance.now() - start)
            };

        } catch (error) {
            console.error("Critical Fetch Error:", error);
            const stored = await DatabaseService.fetchFromSupabase();
            // Fallback to seed if DB is also dead
            return { data: stored.length ? stored : SEED_DATA, source: 'FALLBACK', latency: 0 };
        }
    },

    /**
     * Bulk fetch prices for multiple tokens via DexScreener.
     * @param tokenAddresses List of token addresses
     * @param chain Optional chain to prioritize pairs on (e.g. 'ethereum')
     */
    getBulkPrices: async (tokenAddresses: string[], chain?: string): Promise<Record<string, number>> => {
        if (!tokenAddresses.length) return {};

        // Stablecoins and major quote tokens that indicate a USD-denominated price
        const USD_QUOTE_SYMBOLS = new Set([
            'USDT', 'USDC', 'DAI', 'BUSD', 'TUSD', 'USDS', 'USDE', 'FDUSD', 'FRAX', 'LUSD', 'GUSD', 'USDP',
            'WETH', 'ETH', 'WBTC', 'BTC', 'WBNB', 'BNB', 'WSOL', 'SOL', 'WAVAX', 'AVAX', 'WMATIC', 'MATIC'
        ]);

        // Deduplicate addresses to minimize requests
        const uniqueAddresses = [...new Set(tokenAddresses)];

        try {
            // Chunk into 30s as DexScreener limits tokens endpoint to 30 addresses
            const chunks = [];
            for (let i = 0; i < uniqueAddresses.length; i += 30) {
                chunks.push(uniqueAddresses.slice(i, i + 30));
            }

            const results = await Promise.all(chunks.map(async chunk => {
                try {
                    const url = `${DEXSCREENER_TOKENS_URL}/${chunk.join(',')}`;
                    const res = await fetch(url);
                    if (!res.ok) return { pairs: [] };
                    return await res.json();
                } catch (err) {
                    // Silently fail individual chunks to avoid breaking the whole batch
                    return { pairs: [] };
                }
            }));

            const priceMap: Record<string, number> = {};
            // Track liquidity for each address to prefer higher liquidity pairs
            const liquidityMap: Record<string, number> = {};

            // Create a set of lowercase addresses we're searching for
            const searchSet = new Set(uniqueAddresses.map(a => a.toLowerCase()));

            results.forEach((data: any) => {
                if (!data || !data.pairs) return;
                data.pairs.forEach((pair: any) => {
                    if (!pair.priceUsd) return;

                    // Chain Preference: If chain is specified, strictly prioritize it.
                    // We treat pairs on the wrong chain as having 0 liquidity for comparison, 
                    // unless we haven't found ANY price yet.
                    const isTargetChain = chain ? (pair.chainId === chain.toLowerCase()) : true;

                    // Filter quote token...
                    const quoteSymbol = pair.quoteToken?.symbol?.toUpperCase();
                    if (!quoteSymbol || !USD_QUOTE_SYMBOLS.has(quoteSymbol)) {
                        return;
                    }

                    const baseAddr = pair.baseToken?.address?.toLowerCase();
                    const rawLiquidity = pair.liquidity?.usd || 0;
                    const price = parseFloat(pair.priceUsd);

                    // Boost liquidity for target chain to ensure it wins
                    const effectiveLiquidity = isTargetChain ? (rawLiquidity + 1000000000) : rawLiquidity;

                    // Sanity check
                    if (price > 1000000) return;

                    if (baseAddr && searchSet.has(baseAddr)) {
                        // Only update if we don't have a price yet, or this pair has better liquidity
                        if (!priceMap[baseAddr] || effectiveLiquidity > (liquidityMap[baseAddr] || 0)) {
                            priceMap[baseAddr] = price;
                            liquidityMap[baseAddr] = effectiveLiquidity;
                        }
                    }
                });
            });

            return priceMap;

        } catch (e) {
            console.error("DexScreener Price Fetch Error", e);
            return {};
        }
    },

    transformPair: (pair: DexPair, index: number = 0): MarketCoin => {
        const buys = pair.txns?.h24?.buys || 0;
        const sells = pair.txns?.h24?.sells || 0;
        const totalTxns = buys + sells;
        const flowRatio = totalTxns > 0 ? (buys / totalTxns) : 0.5;
        const dexFlowScore = Math.round(flowRatio * 100);
        const estimatedNetFlow = (pair.volume.h24 * (flowRatio - 0.5));
        const netFlowStr = (estimatedNetFlow >= 0 ? '+' : '-') + formatCurrency(Math.abs(estimatedNetFlow));

        let signal: MarketCoin['signal'] = 'None';
        const priceChangeH1 = pair.priceChange?.h1 || 0;
        const priceChangeH24 = pair.priceChange?.h24 || 0;
        const ageHours = pair.pairCreatedAt ? (Date.now() - pair.pairCreatedAt) / (1000 * 60 * 60) : 999;

        if (ageHours < 72) signal = 'Volume Spike';
        else if (priceChangeH1 > 10 && totalTxns > 500) signal = 'Breakout';
        else if (buys > sells * 1.5) signal = 'Accumulation';

        const trend: MarketCoin['trend'] = priceChangeH24 >= 0 ? 'Bullish' : 'Bearish';
        const liq = pair.liquidity?.usd || 0;
        const riskLevel: MarketCoin['riskLevel'] = liq < 5000 ? 'High' : liq < 50000 ? 'Medium' : 'Low';
        const smartMoneySignal: MarketCoin['smartMoneySignal'] = estimatedNetFlow > 50000 ? 'Inflow' : estimatedNetFlow < -50000 ? 'Outflow' : 'Neutral';

        return {
            id: index,
            name: pair.baseToken.name,
            ticker: pair.baseToken.symbol,
            price: formatPrice(pair.priceUsd),
            h1: `${(priceChangeH1).toFixed(2)}%`,
            h24: `${(priceChangeH24).toFixed(2)}%`,
            d7: `${(pair.priceChange?.h6 || 0).toFixed(2)}%`,
            cap: formatCurrency(pair.fdv || pair.liquidity?.usd || 0),
            liquidity: formatCurrency(pair.liquidity?.usd || 0),
            volume24h: formatCurrency(pair.volume.h24),
            dexBuys: buys.toString(),
            dexSells: sells.toString(),
            dexFlow: dexFlowScore,
            netFlow: netFlowStr,
            smartMoney: smartMoneySignal === 'Inflow' ? 'Inflow' : 'Neutral',
            smartMoneySignal,
            signal,
            riskLevel,
            age: pair.pairCreatedAt ? getTimeAgo(pair.pairCreatedAt) : 'Unknown',
            createdTimestamp: pair.pairCreatedAt || Date.now(),
            img: pair.info?.imageUrl || `https://ui-avatars.com/api/?name=${pair.baseToken.symbol}&background=random&color=fff`,
            trend,
            chain: getChainId(pair.chainId),
            address: pair.baseToken.address,
            pairAddress: pair.pairAddress,
            // Attempt to capture makers if available in raw response (some endpoints provide it)
            activeWallets24h: (pair as any).boosts?.active || (pair as any).makers || 0
        };
    },

    syncToSupabase: async (tokens: MarketCoin[]) => {
        try {
            if (!tokens.length || !supabase || !supabaseAvailable) return;
            const dedupedPayload = new Map<string, {
                address: string;
                ticker: string;
                name: string;
                chain: string;
                price: string;
                liquidity: string;
                volume_24h: string;
                last_seen_at: Date;
                raw_data: MarketCoin;
            }>();

            tokens.forEach((t) => {
                const key = `${t.chain.toLowerCase()}:${t.address.toLowerCase()}`;
                dedupedPayload.set(key, {
                    address: t.address,
                    ticker: t.ticker,
                    name: t.name,
                    chain: t.chain,
                    price: t.price,
                    liquidity: t.liquidity,
                    volume_24h: t.volume24h,
                    last_seen_at: new Date(),
                    raw_data: t
                });
            });

            const dbPayload = [...dedupedPayload.values()];

            // Upsert in batches to be safe
            const { error } = await supabase
                .from('discovered_tokens')
                .upsert(dbPayload, { onConflict: 'address,chain' });

            if (error) {
                warnSupabaseOnce(`Supabase Sync Warning: ${error.message}`);
                if (/Failed to fetch|fetch failed|network/i.test(error.message)) {
                    supabaseAvailable = false;
                }
                return;
            }

            await DatabaseService.purgeStaleTokens();
        } catch (e) {
            supabaseAvailable = false;
            warnSupabaseOnce("Supabase Sync skipped because the Supabase endpoint is unavailable in this environment.");
        }
    },

    purgeStaleTokens: async (force: boolean = false) => {
        try {
            if (!supabaseAvailable) return;
            if (!force && Date.now() - lastStalePurgeAt < STALE_PURGE_INTERVAL_MS) return;
            if (!supabase) return;

            const cutoffIso = getStaleCutoffIso();
            const { error } = await supabase
                .from('discovered_tokens')
                .delete()
                .lt('last_seen_at', cutoffIso);

            if (error) {
                if (/row-level security|permission|not allowed|forbidden/i.test(error.message)) {
                    return;
                }
                warnSupabaseOnce(`Supabase Purge Warning: ${error.message}`);
                if (/Failed to fetch|fetch failed|network/i.test(error.message)) {
                    supabaseAvailable = false;
                }
                return;
            }

            lastStalePurgeAt = Date.now();
        } catch (e) {
            if (e instanceof Error && /fetch failed|failed to fetch|network/i.test(e.message)) {
                supabaseAvailable = false;
            }
        }
    },

    fetchFromSupabase: async (): Promise<MarketCoin[]> => {
        try {
            if (!supabase || !supabaseAvailable) return [];
            const cutoffIso = getStaleCutoffIso();
            const { data, error } = await supabase
                .from('discovered_tokens')
                .select('*')
                .gte('last_seen_at', cutoffIso)
                .order('last_seen_at', { ascending: false })
                .limit(HYDRATION_LIMIT);

            if (error || !data) {
                if (error) {
                    warnSupabaseOnce(`Supabase Sync Warning: ${error.message}`);
                    if (/Failed to fetch|fetch failed|network/i.test(error.message)) {
                        supabaseAvailable = false;
                    }
                }
                return [];
            }
            const tokens = data.map((row: any) => row.raw_data as MarketCoin);
            if (tokens.length) {
                setCachedMarketData(tokens);
            }
            return tokens;
        } catch (e) {
            supabaseAvailable = false;
            return [];
        }
    },

    upsertSmartMoneyWallet: async (wallet: SavedWallet) => {
        try {
            if (!supabase || !supabaseAvailable) return;
            if (!wallet.qualification?.qualified) return;

            const payload = {
                wallet_address: wallet.addr,
                name: wallet.name,
                categories: wallet.categories?.length ? wallet.categories : ['Smart Money'],
                last_balance: wallet.lastBalance || null,
                last_win_rate: wallet.lastWinRate || null,
                last_pnl: wallet.lastPnl || null,
                qualification: wallet.qualification,
                smart_money_score: wallet.qualification.score,
                source: 'wallet-tracking',
                updated_at: new Date().toISOString()
            };

            const { error } = await supabase
                .from(SMART_MONEY_TABLE)
                .upsert(payload, { onConflict: 'wallet_address' });

            if (error) {
                warnSupabaseOnce(`Supabase Smart Money Sync Warning: ${error.message}`);
                if (/Failed to fetch|fetch failed|network/i.test(error.message)) {
                    supabaseAvailable = false;
                }
            }
        } catch (e) {
            if (e instanceof Error && /fetch failed|failed to fetch|network/i.test(e.message)) {
                supabaseAvailable = false;
            }
        }
    },

    fetchSmartMoneyWallets: async (): Promise<SavedWallet[]> => {
        try {
            if (!supabase || !supabaseAvailable) return [];

            const { data, error } = await supabase
                .from(SMART_MONEY_TABLE)
                .select('*')
                .order('smart_money_score', { ascending: false })
                .order('updated_at', { ascending: false })
                .limit(100);

            if (error || !data) {
                if (error) {
                    warnSupabaseOnce(`Supabase Smart Money Read Warning: ${error.message}`);
                    if (/Failed to fetch|fetch failed|network/i.test(error.message)) {
                        supabaseAvailable = false;
                    }
                }
                return [];
            }

            return data.map(mapSmartMoneyRowToWallet);
        } catch (e) {
            if (e instanceof Error && /fetch failed|failed to fetch|network/i.test(e.message)) {
                supabaseAvailable = false;
            }
            return [];
        }
    },

    getTokenDetails: async (address: string, chainFilter?: string): Promise<any> => {
        try {
            if (!address || address.length < 30) return null;

            // Use the tokens endpoint to get ALL pairs for this address
            // Aggregation is critical for accurate "Total Volume/Liquidity"
            const response = await fetch(`${DEXSCREENER_TOKENS_URL}/${address}`);
            if (!response.ok) return null;

            const data = await response.json();
            if (!data.pairs || data.pairs.length === 0) return null;

            let bestPair: any = null;
            let maxLiq = -1;

            // Iterate to find the Highest Liquidity Pair (Primary Pair)
            data.pairs.forEach((p: any) => {
                // Ensure we are looking at the right token
                if (p.baseToken?.address?.toLowerCase() !== address.toLowerCase()) return;

                // Chain Filter
                if (chainFilter && p.chainId.toLowerCase() !== chainFilter.toLowerCase()) return;

                // Blacklist specific DEXes known for bad data
                if (['9inch', 'shibaswap'].includes(p.dexId)) return;

                const liq = p.liquidity?.usd || 0;

                // Track "best" pair: STRICTLY highest liquidity wins
                if (liq > maxLiq) {
                    maxLiq = liq;
                    bestPair = p;
                }
            });

            // If no pairs found matching filters
            if (!bestPair) {
                if (data.pairs.length > 0) bestPair = data.pairs[0];
                else return null;
            }

            // Return the best pair directly with added pool count metric
            return {
                ...bestPair,
                poolCount: data.pairs ? data.pairs.length : 0,
                activeWallets24h: (bestPair as any).boosts?.active || (bestPair as any).makers || 0
            };

        } catch (e) {
            console.error("DexScreener Aggregation Error", e);
            return null;
        }
    },

    checkAndTriggerIngestion: async () => {
        await DatabaseService.getMarketData(true, true);
    },

    searchGlobalPairs: async (query: string): Promise<MarketCoin[]> => {
        const pairs = await searchDexScreener(query);
        // Transform and return top results
        return pairs.slice(0, 10).map((p, i) => DatabaseService.transformPair(p, i));
    }
};
