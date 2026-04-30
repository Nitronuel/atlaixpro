// Atlaix: Intelligence service module for Atlaix data workflows.

import { MoralisService, WalletBalance } from './MoralisService';
import { DatabaseService } from './DatabaseService';
import { AlchemyService } from './AlchemyService';
import { SolanaRpcService } from './SolanaRpcService';

export type ChainType = 'Solana' | 'Ethereum' | 'BSC' | 'Polygon' | 'Avalanche' | 'Base' | 'Arbitrum' | 'Optimism' | 'All Chains';

export interface PortfolioData {
    netWorth: string;
    assets: {
        symbol: string;
        address: string;
        balance: string;
        value: string;
        price: string;
        currentPrice: number;
        logo: string;
        rawValue: number;
        avgBuy?: string;
        pnl?: string;
        pnlPercent?: number;
        chain?: string;
        chainLogo?: string;
        buyTime?: number;
    }[];
    recentActivity: {
        type: string;
        desc: string;
        time: string;
        hash: string;
    }[];
    providerUsed: 'Moralis' | 'Cache';
    chainIcon: string;
    timestamp: number;
}

// --- PERFORMANCE ENGINE ---

class SmartCache {
    private cache = new Map<string, { data: any; expiry: number }>();
    private pendingRequests = new Map<string, Promise<any>>();
    private TTL = 60 * 1000;

    async getOrFetch(key: string, fetcher: () => Promise<any>): Promise<any> {
        const now = Date.now();
        if (this.cache.has(key)) {
            const entry = this.cache.get(key)!;
            if (entry.expiry > now) {
                return { ...entry.data, providerUsed: 'Cache' };
            }
        }

        if (this.pendingRequests.has(key)) {
            return this.pendingRequests.get(key);
        }

        const promise = fetcher().then((data) => {
            this.cache.set(key, { data, expiry: Date.now() + this.TTL });
            this.pendingRequests.delete(key);
            return data;
        }).catch(err => {
            this.pendingRequests.delete(key);
            throw err;
        });

        this.pendingRequests.set(key, promise);
        return promise;
    }
}

const cacheManager = new SmartCache();

// --- MORALIS PROVIDER INTEGRATION ---

/**
 * Universal fetcher that routes all requests to the Moralis Data API.
 */
const fetchFromMoralis = async (chain: string, address: string): Promise<PortfolioData> => {

    // 1. Fetch Real Balances
    // ALWAYS use Moralis as the Source of Truth for Balances (Universal Chain Support)
        const balances = await MoralisService.getWalletBalances(address, chain);
    const isEVM = chain.toLowerCase() !== 'solana';

    // 2. Identify tokens missing prices (Moralis sometimes doesn't have pricing for new pairs)
    const missingPriceAddresses = balances
        .filter(b => (!b.price_usd || b.price_usd === 0) && (!b.usd_value || b.usd_value === 0))
        .map(b => b.token_address);

    // 2.5 ALCHEMY FALLBACK (New Layer)
    // If Moralis failed, try Alchemy for standard tokens on EVM
    let alchemyPrices: Record<string, number> = {};
    // Alchemy doesn't support Token API for Sol yet

    if (missingPriceAddresses.length > 0 && isEVM) {
        try {
            alchemyPrices = await AlchemyService.getBulkPrices(missingPriceAddresses, chain);
        } catch (e) {
            console.warn("Alchemy Fallback Failed", e);
        }
    }

    // 3. Fetch remaining missing prices from DexScreener Fallback (Long-tail)
    // Filter out addresses that Alchemy ALREADY found
    const stillMissingAddresses = missingPriceAddresses.filter(addr => !alchemyPrices[addr.toLowerCase()]);

    let dexPrices: Record<string, number> = {};
    if (stillMissingAddresses.length > 0) {
        // Pass 'chain' to prioritize pairs on the correct network (e.g. Ethereum)
        let dexChain = chain.toLowerCase();
        if (dexChain === 'eth') dexChain = 'ethereum';

        dexPrices = await DatabaseService.getBulkPrices(stillMissingAddresses, dexChain);
    }

    let totalUsd = 0;

    // Chain Metadata
    let chainName = chain.charAt(0).toUpperCase() + chain.slice(1);
    let chainLogo = 'https://cryptologos.cc/logos/ethereum-eth-logo.png';
    if (chain.toLowerCase() === 'solana') { chainLogo = 'https://cryptologos.cc/logos/solana-sol-logo.png'; }
    else if (chain.toLowerCase() === 'bsc') { chainName = 'BSC'; chainLogo = 'https://cryptologos.cc/logos/bnb-bnb-logo.png'; }
        else if (chain.toLowerCase() === 'base') { chainName = 'Base'; chainLogo = 'https://cryptologos.cc/logos/base-base-logo.png'; }
        else if (chain.toLowerCase() === 'arbitrum') { chainName = 'Arbitrum'; chainLogo = 'https://cryptologos.cc/logos/arbitrum-arb-logo.png'; }
        else if (chain.toLowerCase() === 'optimism') { chainName = 'Optimism'; chainLogo = 'https://cryptologos.cc/logos/optimism-ethereum-op-logo.png'; }
        else if (chain.toLowerCase() === 'polygon') { chainName = 'Polygon'; chainLogo = 'https://cryptologos.cc/logos/polygon-matic-logo.png'; }
        else if (chain.toLowerCase() === 'avalanche') { chainName = 'Avalanche'; chainLogo = 'https://cryptologos.cc/logos/avalanche-avax-logo.png'; }

    // 4. Process Assets & Calculate Values
    const processedAssetsRaw = await Promise.all(balances.map(async b => {
        // Fix: Allow 0 decimals (Solana) but default to 18 if undefined/null
        const decimals = (b.decimals !== undefined && b.decimals !== null) ? Number(b.decimals) : 18;
        const bal = parseFloat(b.balance) / Math.pow(10, decimals);

        // Price Logic: Moralis Price -> Alchemy Price -> DexScreener Price -> Derived -> 0
        let price = b.price_usd || 0;

        // Try Alchemy
        if (price === 0 && alchemyPrices[b.token_address.toLowerCase()]) {
            price = alchemyPrices[b.token_address.toLowerCase()];
        }

        // Try DexScreener
        if (price === 0 && dexPrices[b.token_address.toLowerCase()]) {
            price = dexPrices[b.token_address.toLowerCase()];
        }

        // If Moralis gave usd_value but no unit price (rare but possible), calc unit price
        if (price === 0 && b.usd_value && b.usd_value > 0) {
            price = b.usd_value / bal;
        }

        // --- STABILITY CHECK ---
        // Fix for Stablecoins showing $0.002 due to PulseChain/Bad DexScreener Data
        const stableSymbols = ['USDT', 'USDC', 'DAI', 'USDe', 'FDUSD', 'USDS'];
        if (b.symbol && stableSymbols.includes(b.symbol.toUpperCase())) {
            // If price is suspiciously low (< $0.80) or missing, force a robust check
            if (price < 0.80) {
                // Try fetching specific price from Moralis (Price Endpoint is often more accurate than Balances endpoint for major tokens)
                const sanePrice = await MoralisService.getTokenPriceAtBlock(b.token_address, chain);
                if (sanePrice > 0.80) {
                    price = sanePrice;
                }
            }
        }

        // Final Value Calc
        const value = (price > 0) ? (bal * price) : (b.usd_value || 0);

        totalUsd += value;

        return {
            symbol: b.symbol,
            address: b.token_address,
            balanceObj: bal, // Internal numeric
            currentPrice: price, // Internal numeric
            balance: `${bal.toLocaleString(undefined, { maximumFractionDigits: 4 })} ${b.symbol}`,
            value: `$${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
            price: `$${price.toLocaleString(undefined, { maximumFractionDigits: 6 })}`,
            logo: b.logo || `https://ui-avatars.com/api/?name=${b.symbol}&background=random`,
            rawValue: value,
            chain: chainName,
            chainLogo: chainLogo
        };
    }));

    const processedAssets = processedAssetsRaw.sort((a, b) => b.rawValue - a.rawValue);

    // 5. Assets with minimal defaults for PnL
    const finalAssets = processedAssets.map(asset => ({
        ...asset,
        avgBuy: 'N/A',
        pnl: asset.rawValue > 1.0 ? 'Loading...' : 'N/A', // Only calculate if > $1 (User Verified)
        pnlPercent: undefined
    }));

    const recentActivity: any[] = [];

    return {
        netWorth: `$${totalUsd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
        providerUsed: 'Moralis',
        timestamp: Date.now(),
        chainIcon: chainLogo,
        assets: finalAssets,
        recentActivity: recentActivity
    };
};

export const ChainRouter = {
    fetchPortfolio: async (chain: string, address: string, forceRefresh: boolean = false): Promise<PortfolioData> => {
        // Normalize key for caching
        const normalizedChain = chain.toLowerCase();
        const requestKey = `moralis_${normalizedChain}_${address}`;

        if (forceRefresh) {
            return cacheManager.getOrFetch(`${requestKey}_${Date.now()}`, async () => {
                if (chain === 'All Chains' || normalizedChain === 'all chains') {
                    if (address.startsWith('0x')) {
                        const chains = ['Ethereum', 'Base', 'BSC', 'Arbitrum', 'Optimism', 'Polygon', 'Avalanche'];
                        const results = await Promise.all(chains.map(async c => {
                            try {
                                return await fetchFromMoralis(c, address);
                            } catch {
                                return null;
                            }
                        }));
                        const validResults = results.filter(r => r !== null);
                        if (validResults.length === 0) return fetchFromMoralis('Ethereum', address);

                        const allAssets = validResults.flatMap(res => res?.assets || []).sort((a, b) => b.rawValue - a.rawValue);
                        const totalUsdVal = allAssets.reduce((acc, curr) => acc + curr.rawValue, 0);
                        const latestTimestamp = validResults.reduce((latest, current) => Math.max(latest, current?.timestamp || 0), 0);

                        return {
                            netWorth: `$${totalUsdVal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
                            providerUsed: 'Moralis',
                            timestamp: latestTimestamp || Date.now(),
                            chainIcon: 'https://cryptologos.cc/logos/ethereum-eth-logo.png',
                            assets: allAssets,
                            recentActivity: []
                        };
                    }

                    return fetchFromMoralis('Solana', address);
                }

                return fetchFromMoralis(chain, address);
            });
        }

        return cacheManager.getOrFetch(requestKey, async () => {
            // Handle Multi-Chain EVM Aggregation
            if (chain === 'All Chains' || normalizedChain === 'all chains') {
                if (address.startsWith('0x')) {
                    // It's an EVM address, fetch from major EVM chains
                    const chains = ['Ethereum', 'Base', 'BSC', 'Arbitrum', 'Optimism', 'Polygon', 'Avalanche'];

                    try {
                        // Concurrent fetch with individual error handling
                        const promises = chains.map(async c => {
                            try {
                                return await fetchFromMoralis(c, address);
                            } catch (e) {
                                // console.warn(`Failed to fetch ${c} portfolio, skipping`, e);
                                return null;
                            }
                        });

                        const results = await Promise.all(promises);
                        const validResults = results.filter(r => r !== null);

                        // If all failed, throw
                        if (validResults.length === 0) throw new Error("All chains failed to fetch");

                        // Merge Results
                        let totalUsdVal = 0;
                        let allAssets: any[] = [];
                        let latestTimestamp = 0;

                        validResults.forEach(res => {
                            if (res && res.assets) {
                                // De-duplicate assets if necessary (though usually they are unique per chain)
                                allAssets = [...allAssets, ...res.assets];
                                if (res.timestamp > latestTimestamp) latestTimestamp = res.timestamp;
                            }
                        });

                        // Sort by Value Desc
                        allAssets.sort((a, b) => b.rawValue - a.rawValue);
                        totalUsdVal = allAssets.reduce((acc, curr) => acc + curr.rawValue, 0);

                        return {
                            netWorth: `$${totalUsdVal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
                            providerUsed: 'Moralis',
                            timestamp: latestTimestamp || Date.now(),
                            chainIcon: 'https://cryptologos.cc/logos/ethereum-eth-logo.png', // Default icon
                            assets: allAssets,
                            recentActivity: []
                        };

                    } catch (e) {
                        console.error("Multi-chain fetch critical error", e);
                        // Last resort fallback
                        return fetchFromMoralis('Ethereum', address);
                    }
                } else {
                    // Not 0x, assume Solana (since we only support Sol + EVM for now)
                    return fetchFromMoralis('Solana', address);
                }
            }


            // Single Chain Fetch
            const portfolio = await fetchFromMoralis(chain, address);

            // [Optimisation] Trigger Solana History Preload for PnL
            // [Optimisation] Trigger Solana History Preload for PnL
            // DEPRECATED: We now use Moralis Hybrid approach in fetchTokenPnL
            // if (chain.toLowerCase() === 'solana') {
            //    const mints = portfolio.assets.map(a => a.address);
            //    SolanaRpcService.preloadHistory(address, mints).catch(e => console.error("Preload Warning", e));
            // }

            return portfolio;
        });
    },

    fetchTokenPeriodPnL: async (chain: string, tokenAddress: string, currentPrice: number, period: '1D' | '1W' | '1M' | '>1M'): Promise<{ pnl: string, pnlPercent: number | undefined, startPrice: string }> => {
        let delta = 0;
        const ONE_DAY = 24 * 60 * 60 * 1000;
        switch (period) {
            case '1D': delta = ONE_DAY; break;
            case '1W': delta = ONE_DAY * 7; break;
            case '1M': delta = ONE_DAY * 30; break;
            case '>1M': delta = ONE_DAY * 90; break; // Approximate >1M blocks as a 90-day trend window.
            default: delta = ONE_DAY;
        }

        const targetTime = Math.floor((Date.now() - delta) / 1000);
        const oldPrice = await MoralisService.getTokenPriceAtTime(tokenAddress, chain, targetTime);

        if (oldPrice > 0) {
            const pnlValue = ((currentPrice - oldPrice) / oldPrice) * 100;
            const pnlPrefix = pnlValue >= 0 ? '+' : '';
            return {
                startPrice: `$${oldPrice.toLocaleString(undefined, { maximumFractionDigits: 6 })}`,
                pnl: `${pnlPrefix}${pnlValue.toFixed(2)}%`,
                pnlPercent: pnlValue
            };
        }

        return {
            startPrice: 'N/A',
            pnl: 'N/A',
            pnlPercent: undefined
        };
    },

    fetchTokenPnL: async (chain: string, walletAddress: string, tokenAddress: string, currentPrice: number, timeFilter: string = 'ALL'): Promise<{ pnl: string, pnlPercent: number | undefined, avgBuy: string, buyTime?: number }> => {

        // 1. Get Actual Cost Basis & Buy Time
        // EVM -> Use Alchemy (Better Transaction History)
        // Solana -> Use normalized Solana RPC history (via Moralis wrapper or direct service)

        let costBasis = 0;
        let buyTime = 0;

        try {
            if (chain.toLowerCase() === 'solana') {
                const result = await MoralisService.getEstimatedCostBasis(walletAddress, tokenAddress, chain);
                costBasis = result.price;
                buyTime = result.timestamp;
            } else {
                // Use Alchemy for EVM PnL
                const result = await AlchemyService.getEstimatedCostBasis(walletAddress, tokenAddress, chain);
                costBasis = result.price;
                buyTime = result.timestamp;
            }
        } catch (e) {
            console.warn("Cost Basis Fetch Error", e);
        }

        // 2. Determine Reference Price for PnL
        let referencePrice = costBasis;
        let pnlBasisLabel = 'Avg Buy';

        if (timeFilter !== 'ALL') {
            const now = Date.now();
            let lookbackMs = 0;
            switch (timeFilter) {
                case '1D': lookbackMs = 24 * 60 * 60 * 1000; break;
                case '1W': lookbackMs = 7 * 24 * 60 * 60 * 1000; break;
                case '1M': lookbackMs = 30 * 24 * 60 * 60 * 1000; break;
                case '>1M': lookbackMs = 30 * 24 * 60 * 60 * 1000; break; // Special case handled below
            }

            const startTime = now - lookbackMs;

            // Scenario A: Asset purchased AFTER the start time (e.g. bought 2 days ago, filter is 7 days)
            // Calculate total PnL from the initial purchase date.
            if (buyTime >= startTime) {
                referencePrice = costBasis;
                // If filtering for >1M and it's newer, it technically doesn't match the filter, 
                // but the UI typically shows everything or filters. 
                // The new requirement is "filter logic... calculate and display PnL within selected time frame".
                // Return standard PnL; UI filtering logic will handle strict display requirements.
                // For now, we assume we show it with full PnL.
            }
            // Scenario B: Asset held LONGER than start time (e.g. bought 1 year ago, filter is 7 days)
            // PnL should be change since 7 days ago.
            else {
                // For >1M block filters, utilize cumulative PnL for historical accuracy. 
                // Or "Change since 1 month ago"? usually >1M implies "Overall for old stuff".
                // Let's stick to the prompt: "calculate and display PnL within the selected time frame"

                if (timeFilter !== '>1M') {
                    // Fetch Historical Price at startTime
                    // Convert ms to seconds
                    const historicalPrice = await MoralisService.getPriceAtTime(tokenAddress, chain, Math.floor(startTime / 1000));
                    if (historicalPrice > 0) {
                        referencePrice = historicalPrice;
                        pnlBasisLabel = 'Price ' + timeFilter + ' Ago';
                    }
                }
            }
        }

        if (referencePrice > 0) {
            const pnlValue = (currentPrice - referencePrice) / referencePrice * 100;
            const pnlPrefix = pnlValue >= 0 ? '+' : '';

            // Format Avg Buy tooltip or display to indicate if it's shifted?
            // For now keeping simple return.
            return {
                avgBuy: `$${referencePrice.toLocaleString(undefined, { maximumFractionDigits: 6 })}`, // This might be dynamically 7d price
                pnl: `${pnlPrefix}${pnlValue.toFixed(2)}%`,
                pnlPercent: pnlValue,
                buyTime: buyTime
            };
        }

        return {
            avgBuy: 'N/A',
            pnl: 'N/A',
            pnlPercent: undefined,
            buyTime: buyTime || 0
        };
    }
};
