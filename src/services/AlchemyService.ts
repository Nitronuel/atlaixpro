
import { MoralisService } from './MoralisService';
import { fetchAlchemyRpc, getBackendAlchemyKey } from './ProviderGateway';

const ALCHEMY_KEY = typeof window !== 'undefined' ? 'backend' : getBackendAlchemyKey();

export const AlchemyService = {
    /**
     * Bulk fetch prices for token addresses via Alchemy.
     * Alchemy Token API supports fetching prices by address for specific chains.
     */
    getBulkPrices: async (tokenAddresses: string[], chain: string): Promise<Record<string, number>> => {
        if (!tokenAddresses.length || !ALCHEMY_KEY) return {};

        // Map internal chain names to Alchemy network names
        let network = 'eth-mainnet';
        switch (chain.toLowerCase()) {
            case 'ethereum': network = 'eth-mainnet'; break;
            case 'polygon': network = 'polygon-mainnet'; break;
            case 'arbitrum': network = 'arb-mainnet'; break;
            case 'optimism': network = 'opt-mainnet'; break;
            case 'base': network = 'base-mainnet'; break;
            case 'solana': return {}; // Alchemy Token API structure differs for Solana, skipping for MVP
            case 'bsc': return {}; // Alchemy doesn't fully support BSC Token API widely yet
            default: network = 'eth-mainnet';
        }

        // Deduplicate addresses
        const uniqueAddresses = [...new Set(tokenAddresses)];
        const priceMap: Record<string, number> = {};

        try {
            // Alchemy supports batch requests via JSON-RPC
            // method: "alchemy_getTokenPrices"

            const response = await fetchAlchemyRpc(
                network,
                {
                    id: 1,
                    jsonrpc: "2.0",
                    method: "alchemy_getTokenPrices",
                    params: [
                        {
                            addresses: uniqueAddresses.map(a => ({ address: a }))
                        }
                    ]
                }
            );

            if (!response.ok) {
                const text = await response.text();
                console.error(`[AlchemyService] Error ${response.status}: ${text}`);
                return {};
            }

            const data = await response.json();

            // Response format: 
            // result: { address: { currency: "USD", error: null, value: "123.45" }, ... }

            if (data.result) {
                const items = Array.isArray(data.result.data) ? data.result.data : [];

                items.forEach((item: any) => {
                    if (item.prices && item.prices.length > 0) {
                        const usdPrice = item.prices.find((p: any) => p.currency === 'usd');
                        if (usdPrice && usdPrice.value) {
                            const val = parseFloat(usdPrice.value);
                            if (!isNaN(val)) {
                                priceMap[item.address.toLowerCase()] = val;
                            }
                        }
                    }
                });
            }

            return priceMap;

        } catch (error) {
            console.error("Alchemy Price Fetch Error", error);
            return {};
        }
    },

    /**
     * Fetch all Token Balances (ERC20) for an address
     */
    /**
     * Fetch all Token Balances (ERC20) for an address
     */
    getWalletBalances: async (address: string, chain: string): Promise<any[]> => {
        if (!address || !ALCHEMY_KEY) return [];

        let network = 'eth-mainnet';
        switch (chain.toLowerCase()) {
            case 'ethereum': network = 'eth-mainnet'; break;
            case 'polygon': network = 'polygon-mainnet'; break;
            case 'arbitrum': network = 'arb-mainnet'; break;
            case 'optimism': network = 'opt-mainnet'; break;
            case 'base': network = 'base-mainnet'; break;
            case 'bsc': return []; // Not supported on Alchemy Core
            case 'solana': return []; // Different API
            default: network = 'eth-mainnet';
        }

        const assets: any[] = [];
        const wrappedNativeByChain: Record<string, string> = {
            ethereum: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
            base: '0x4200000000000000000000000000000000000006',
            polygon: '0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270',
            arbitrum: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1',
            optimism: '0x4200000000000000000000000000000000000006'
        };

        try {
            // 1. Get Native Balance
            const nativeRes = await fetchAlchemyRpc(
                network,
                {
                    jsonrpc: "2.0",
                    method: "eth_getBalance",
                    params: [address, "latest"],
                    id: 1
                }
            );

            const nativeData = await nativeRes.json();
            if (nativeData.result && nativeData.result !== '0x0') {
                const balWei = BigInt(nativeData.result);
                if (balWei > 0n) {
                    // Determine Native Symbol
                    let symbol = 'ETH';
                    let name = 'Ethereum';
                    let logo = 'https://cryptologos.cc/logos/ethereum-eth-logo.png';

                    if (chain.toLowerCase() === 'bsc') { symbol = 'BNB'; name = 'Binance Coin'; logo = 'https://cryptologos.cc/logos/bnb-bnb-logo.png'; }
                    else if (chain.toLowerCase() === 'base') { symbol = 'ETH'; name = 'Ethereum (Base)'; logo = 'https://cryptologos.cc/logos/base-base-logo.png'; }
                    else if (chain.toLowerCase() === 'polygon') { symbol = 'MATIC'; name = 'Polygon'; logo = 'https://cryptologos.cc/logos/polygon-matic-logo.png'; }
                    else if (chain.toLowerCase() === 'arbitrum') { symbol = 'ETH'; name = 'Arbitrum'; logo = 'https://cryptologos.cc/logos/arbitrum-arb-logo.png'; }
                    else if (chain.toLowerCase() === 'optimism') { symbol = 'ETH'; name = 'Optimism'; logo = 'https://cryptologos.cc/logos/optimism-ethereum-op-logo.png'; }

                    const nativePriceMap = await AlchemyService.getBulkPrices(
                        wrappedNativeByChain[chain.toLowerCase()] ? [wrappedNativeByChain[chain.toLowerCase()]] : [],
                        chain
                    );
                    const nativePrice = wrappedNativeByChain[chain.toLowerCase()]
                        ? nativePriceMap[wrappedNativeByChain[chain.toLowerCase()].toLowerCase()] || 0
                        : 0;
                    const nativeBalance = Number(balWei) / 1e18;

                    assets.push({
                        token_address: '0x0000000000000000000000000000000000000000',
                        symbol,
                        name,
                        logo,
                        decimals: 18,
                        balance: balWei.toString(),
                        possible_spam: false,
                        verified_contract: true,
                        usd_value: nativePrice ? nativeBalance * nativePrice : undefined,
                        price_usd: nativePrice || undefined
                    });
                }
            }

            // 2. Fetch All Token Balances (Loop with PageKey)
            let pageKey: string | undefined = undefined;
            let allTokens: any[] = [];
            let loops = 0;

            do {
                if (loops > 50) break; // Increased loop limit for large wallets

                // Alchemy expects: [address, { pageKey: "...", type: ["erc20"] }]
                // Default to ERC20 standard if only address is provided.
                // Best practice is robust options object.
                const params: any[] = [address];

                const options: any = { type: ["erc20"] };
                if (pageKey) options.pageKey = pageKey;

                params.push(options);

                const tokenRes = await fetchAlchemyRpc(
                    network,
                    {
                        jsonrpc: "2.0",
                        method: "alchemy_getTokenBalances",
                        params: params,
                        id: 2
                    }
                );

                const data = await tokenRes.json();
                const tokens = data.result?.tokenBalances || [];

                // Filter non-zero immediately to save memory
                const nonZero = tokens.filter((t: any) => {
                    return t.tokenBalance && t.tokenBalance !== '0x0' && !t.tokenBalance.startsWith('0x000000000000000000');
                });

                allTokens = [...allTokens, ...nonZero];
                pageKey = data.result?.pageKey;
                loops++;
            } while (pageKey);

            if (allTokens.length === 0) return assets;

            // 3. Get Metadata in Batches (Limit 15 per call to avoid rate limits? Alchemy allows bursts but be safe)
            // Batch size 20 seems safe for free tier
            const BATCH_SIZE = 20;
            const chunks = [];
            for (let i = 0; i < allTokens.length; i += BATCH_SIZE) {
                chunks.push(allTokens.slice(i, i + BATCH_SIZE));
            }

            const processedTokens = [];

            // Process chunks sequentially to respect rate limits slightly better than Promise.all(all)
            for (const chunk of chunks) {
                const metadataPromises = chunk.map((t: any) =>
                    fetchAlchemyRpc(
                        network,
                        {
                            jsonrpc: "2.0",
                            method: "alchemy_getTokenMetadata",
                            params: [t.contractAddress],
                            id: 1
                        }
                    )
                        .then(r => r.json())
                        .then(d => ({ ...t, metadata: d.result }))
                        .catch(() => ({ ...t, metadata: null }))
                );

                const chunkResult = await Promise.all(metadataPromises);
                processedTokens.push(...chunkResult);
            }

            const tokenAssets = processedTokens.map((t: any) => {
                // If metadata missing, DON'T drop. Show unknown.
                const decimals = t.metadata?.decimals || 18;
                const balRaw = BigInt(t.tokenBalance);
                const symbol = t.metadata?.symbol || 'UNK';
                const name = t.metadata?.name || 'Unknown Token';

                // Skip Spam if needed? No, user wants everything. 
                // We'll trust Alchemy's default filtering if any, but they generally return everything.

                return {
                    token_address: t.contractAddress,
                    symbol: symbol,
                    name: name,
                    logo: t.metadata?.logo || null,
                    decimals: decimals,
                    balance: balRaw.toString(),
                    possible_spam: false,
                    verified_contract: true
                };
            });

            return [...assets, ...tokenAssets];

        } catch (e) {
            console.error("[AlchemyService] getWalletBalances failed", e);
            return [];
        }
    },
    /**
     * Estimates Cost Basis for EVM Tokens using Alchemy Asset Transfers
     */
    getEstimatedCostBasis: async (walletAddress: string, tokenAddress: string, chain: string): Promise<{ price: number, timestamp: number }> => {
        if (!walletAddress || !ALCHEMY_KEY) return { price: 0, timestamp: 0 };

        let network = 'eth-mainnet';
        switch (chain.toLowerCase()) {
            case 'ethereum': network = 'eth-mainnet'; break;
            case 'polygon': network = 'polygon-mainnet'; break;
            case 'arbitrum': network = 'arb-mainnet'; break;
            case 'optimism': network = 'opt-mainnet'; break;
            case 'base': network = 'base-mainnet'; break;
            default: return { price: 0, timestamp: 0 }; // Alchemy doesn't support others for this API
        }

        try {
            // Fetch Incoming Transfers (Receives)
            // Filters: toAddress = wallet, category = ["erc20", "external"] (for native)
            // We want to find the big buys.

            const isNative = tokenAddress === '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee' || tokenAddress === '0x0000000000000000000000000000000000000000';

            const params: any = {
                fromBlock: "0x0",
                toBlock: "latest",
                toAddress: walletAddress,
                category: isNative ? ["external", "internal"] : ["erc20"],
                maxCount: "0x32", // Limit 50
                order: "desc" // Newest first? Or do we want largest? Alchemy returns time-ordered usually? 
                // We actually want ALL recent transfers to find the big one.
            };

            if (!isNative) {
                params.contractAddresses = [tokenAddress];
            }

            const response = await fetchAlchemyRpc(
                network,
                {
                    jsonrpc: "2.0",
                    method: "alchemy_getAssetTransfers",
                    params: [params],
                    id: 42
                }
            );

            const data = await response.json();
            const transfers = data.result?.transfers || [];

            if (transfers.length === 0) return { price: 0, timestamp: 0 };

            // Find Largest Incoming Transfer (Assume this is the main entry)
            // Only consider transfers with value > 0
            const validTransfers = transfers.filter((t: any) => t.value && parseFloat(t.value) > 0);

            if (validTransfers.length === 0) return { price: 0, timestamp: 0 };

            const largestTx = validTransfers.reduce((prev: any, current: any) => {
                return parseFloat(current.value) > parseFloat(prev.value) ? current : prev;
            });

            if (!largestTx) return { price: 0, timestamp: 0 };

            // Start timestamp
            const blockNum = largestTx.blockNum; // Hex string e.g. 0x123

            // We need the timestamp of this block to find the price
            // And we need the price at this block.

            // Alchemy gives us the block number. We can pass this to Moralis or Alchemy to get price.
            // Since we decided to use Moralis for historical prices (Alchemy pricing is limited):

            // Import MoralisService dynamically to avoid circular dep issues if any? 
            // Better to assume caller handles price fetch? 
            // No, the interface is getEstimatedCostBasis -> { price, timestamp }
            // So we must fetch price here.

            // Replaced with static import at top

            // Get timestamp for return value
            // Retrieve block details using the configured Price Service.
            // Let's get price first.

            // Map Native
            let lookupAddr = tokenAddress;
            if (isNative) {
                switch (chain.toLowerCase()) {
                    case 'ethereum': lookupAddr = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2'; break;
                    case 'base': lookupAddr = '0x4200000000000000000000000000000000000006'; break;
                    case 'polygon': lookupAddr = '0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270'; break;
                    case 'arbitrum': lookupAddr = '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1'; break;
                    case 'optimism': lookupAddr = '0x4200000000000000000000000000000000000006'; break;
                }
            }

            const price = await MoralisService.getTokenPriceAtBlock(lookupAddr, chain, BigInt(blockNum).toString());

            // We also need timestamp. Moralis Price might result doesn't explicitly return timestamp unless we ask for block info.
            // Let's fetch block timestamp cheaply via Alchemy?
            // eth_getBlockByNumber

            const blockRes = await fetchAlchemyRpc(
                network,
                {
                    jsonrpc: "2.0",
                    method: "eth_getBlockByNumber",
                    params: [blockNum, false],
                    id: 43
                }
            );

            const blockData = await blockRes.json();
            const timestamp = blockData.result?.timestamp ? parseInt(blockData.result.timestamp, 16) * 1000 : 0;

            return { price, timestamp };

        } catch (e) {
            console.error("[AlchemyService] Cost Basis Error", e);
            return { price: 0, timestamp: 0 };
        }
    }
};
