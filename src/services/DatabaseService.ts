import { MarketCoin } from '../types';
import { createClient } from '@supabase/supabase-js';
import { APP_CONFIG } from '../config';

// --- INITIALIZE SUPABASE ---
const supabase = createClient(APP_CONFIG.supabaseUrl, APP_CONFIG.supabaseAnonKey);

const DEXSCREENER_SEARCH_URL = 'https://api.dexscreener.com/latest/dex/search';
const DEXSCREENER_PAIRS_URL = 'https://api.dexscreener.com/latest/dex/pairs';

// --- REQUIREMENTS ---
// Strict filters for High Quality Alpha
const REQUIREMENTS = {
    MIN_LIQUIDITY_USD: 500000, // Minimum liquidity threshold set to $500k
    MIN_VOLUME_24H: 50000,    // Increased to ensure active trading
    MIN_TXNS_24H: 100,        // Filter out dead/zombie tokens
    MIN_FDV: 1000000,         // Minimum $1M FDV to avoid micro-caps/scams
    TARGET_LIST_SIZE: 300     // Keep a curated list of top 300 alpha tokens
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
// Broader search terms to find trending/high-volume tokens across chains
const TARGET_QUERIES = [
    // L1s & L2s
    'SOL', 'BASE', 'ETH', 'BSC', 'ARB', 'POLY', 'AVAX', 'SUI', 'APT', 'SEI', 'TRON', 'TON',
    // Narratives
    'AI', 'AGENT', 'COMPUTE', 'DATA', 'CLOUD', 'DEPIN', 'RWA', 'GAMING', 'GAME', 'BET', 'CASINO',
    // Memes (Top)
    'PEPE', 'WIF', 'BONK', 'FLOKI', 'SHIB', 'DOGE', 'MOG', 'POPCAT', 'MEW', 'BRETT', 'ANDY', 'WOLF',
    // Memes (Culture)
    'TRUMP', 'MAGA', 'BIDEN', 'VOTE', 'USA', 'PEPE', 'WOJAK', 'CHAD', 'GIGA',
    // Animals
    'CAT', 'DOG', 'FROG', 'TOAD', 'APE', 'MONKEY', 'LION', 'TIGER', 'FISH',
    // Tech/Generic
    'TECH', 'PROTO', 'SWAP', 'DEX', 'YIELD', 'FARM', 'DAO', 'GOV', 'VOTE',
    // Meta/Trending
    'NEIRO', 'MOODENG', 'GOAT', 'SPX', 'GNO', 'VIRTUAL', 'LUNA'
];

// Shuffle queries once on load
const SHUFFLED_QUERIES = [...TARGET_QUERIES].sort(() => Math.random() - 0.5);
let currentQueryIndex = 0;

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

const getChainId = (chainId: string) => {
    if (chainId === 'solana') return 'solana';
    if (chainId === 'ethereum') return 'ethereum';
    if (chainId === 'bsc') return 'bsc';
    if (chainId === 'base') return 'base';
    return 'ethereum';
};

// --- API METHODS ---

const searchDexScreener = async (query: string): Promise<DexPair[]> => {
    try {
        const response = await fetch(`${DEXSCREENER_SEARCH_URL}?q=${query}`);
        if (response.status === 429) return []; // Skip if rate limited
        if (!response.ok) return [];
        const data = await response.json();
        return data.pairs || [];
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
    getMarketData: async (force: boolean = false, partial: boolean = false): Promise<{ data: MarketCoin[], source: string, latency: number }> => {
        const start = performance.now();

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

            let newPairs: DexPair[] = [];
            let updatedPairs: DexPair[] = [];

            // --- CRITICAL LOGIC: POPULATION VS MAINTENANCE ---

            // If we have fewer than target tokens, we avoid updating prices to conserve bandwidth.
            // Allocate full bandwidth to discovery operations.
            if (currentCount < REQUIREMENTS.TARGET_LIST_SIZE) {
                // Phase 1: Aggressive Discovery
                // Focus strictly on finding new tokens. Defer refreshing existing data.
                // 25 Parallel Queries = Aggressive population without hitting limits.
                const batchSize = 25;
                const end = Math.min(currentQueryIndex + batchSize, SHUFFLED_QUERIES.length);
                const queries = SHUFFLED_QUERIES.slice(currentQueryIndex, end);

                // Advance index loop
                currentQueryIndex = end >= SHUFFLED_QUERIES.length ? 0 : end;

                // Parallel Fetch
                const searchResults = await Promise.all(queries.map(q => searchDexScreener(q)));
                searchResults.forEach(pairs => newPairs = [...newPairs, ...pairs]);

            } else {
                // Phase 2: Maintenance and Optimization
                // We have 300+ tokens. 
                // Priority 1: Keep prices fresh (Refresh ALL).
                // Priority 2: Continue searching for high-quality tokens to replace lower-quality ones.

                // A. Update existing tokens (Bulk Endpoint is efficient)
                const chainMap: Record<string, string[]> = {};

                // Refresh all tracked tokens to ensure real-time data accuracy.
                // 300 tokens = 10 API calls. Safe within 300 req/min limit.
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
                const discoveryBatch = 5;
                const end = Math.min(currentQueryIndex + discoveryBatch, SHUFFLED_QUERIES.length);
                const queries = SHUFFLED_QUERIES.slice(currentQueryIndex, end);
                currentQueryIndex = end >= SHUFFLED_QUERIES.length ? 0 : end;

                const searchResults = await Promise.all(queries.map(q => searchDexScreener(q)));
                searchResults.forEach(pairs => newPairs = [...newPairs, ...pairs]);
            }

            // 2. Process & Merge Data
            const allFetchedPairs = [...newPairs, ...updatedPairs];
            const tokenMap = new Map<string, MarketCoin>();

            // Fill map with existing DB data first
            currentList.forEach(t => tokenMap.set(t.address, t));

            // Process fetched pairs
            const seenSymbols = new Set<string>();
            currentList.forEach(t => seenSymbols.add(t.ticker.toUpperCase()));

            // Sort new pairs by liquidity
            allFetchedPairs.sort((a, b) => (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0));

            for (const p of allFetchedPairs) {
                const symbol = p.baseToken.symbol.toUpperCase();

                // Strict Filtering
                if (EXCLUDED_SYMBOLS.includes(symbol)) continue;
                if (!p.info?.imageUrl) continue; // Must have logo

                // Quality Floors
                const liq = p.liquidity?.usd || 0;
                const vol = p.volume.h24 || 0;
                if (liq < REQUIREMENTS.MIN_LIQUIDITY_USD) continue;
                if (vol < REQUIREMENTS.MIN_VOLUME_24H) continue;

                if (tokenMap.has(p.baseToken.address)) {
                    // Update existing
                    tokenMap.set(p.baseToken.address, DatabaseService.transformPair(p));
                } else {
                    // New discovery
                    if (!seenSymbols.has(symbol)) {
                        seenSymbols.add(symbol);
                        tokenMap.set(p.baseToken.address, DatabaseService.transformPair(p));
                    }
                }
            }

            // 3. Convert back to array
            let mergedList = Array.from(tokenMap.values());

            // FILTER: Remove tokens below liquidity threshold (even if they were in DB)
            mergedList = mergedList.filter(t => {
                const liq = parseFormattedValue(t.liquidity);
                return liq >= REQUIREMENTS.MIN_LIQUIDITY_USD;
            });

            // 4. Sorting Strategy ("Hot Score")
            mergedList.sort((a, b) => {
                const volA = parseFormattedValue(a.volume24h);
                const volB = parseFormattedValue(b.volume24h);
                const liqA = parseFormattedValue(a.liquidity);
                const liqB = parseFormattedValue(b.liquidity);

                const scoreA = volA + (liqA * 0.2);
                const scoreB = volB + (liqB * 0.2);
                return scoreB - scoreA;
            });

            // 5. Limit size & Sync
            // Return the top 500 assets to maintain a comprehensive market view.
            const finalData = mergedList.slice(0, 500);

            // Sync new discoveries to DB (Background)
            if (newPairs.length > 0 || updatedPairs.length > 0) {
                DatabaseService.syncToSupabase(finalData).catch(err => console.warn("Supabase Sync Warning:", err.message));
            }

            cache.marketData = { data: finalData, timestamp: Date.now() };

            return {
                data: finalData,
                source: newPairs.length > 0 ? 'LIVE_SEARCH' : 'LIVE_UPDATE',
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
                    const url = `https://api.dexscreener.com/latest/dex/tokens/${chunk.join(',')}`;
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
            if (!tokens.length) return;
            const dbPayload = tokens.map(t => ({
                address: t.address,
                ticker: t.ticker,
                name: t.name,
                chain: t.chain,
                price: t.price,
                liquidity: t.liquidity,
                volume_24h: t.volume24h,
                last_seen_at: new Date(),
                raw_data: t
            }));

            // Upsert in batches to be safe
            const { error } = await supabase
                .from('discovered_tokens')
                .upsert(dbPayload, { onConflict: 'address' });

            if (error) console.warn("Supabase Sync Warning:", error.message);
        } catch (e) {
            console.warn("Supabase Sync skipped");
        }
    },

    fetchFromSupabase: async (): Promise<MarketCoin[]> => {
        try {
            const { data, error } = await supabase
                .from('discovered_tokens')
                .select('*')
                .order('last_seen_at', { ascending: false })
                .limit(400);

            if (error || !data) return [];
            return data.map((row: any) => row.raw_data as MarketCoin);
        } catch (e) {
            return [];
        }
    },

    getTokenDetails: async (address: string, chainFilter?: string): Promise<any> => {
        try {
            if (!address || address.length < 30) return null;

            // Use the tokens endpoint to get ALL pairs for this address
            // Aggregation is critical for accurate "Total Volume/Liquidity"
            const response = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${address}`);
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