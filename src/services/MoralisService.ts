
import { APP_CONFIG } from '../config';
import { SolanaRpcService } from './SolanaRpcService';

// API Key from Config
const MORALIS_API_KEY = APP_CONFIG.moralisKey;

interface MoralisTransfer {
    transaction_hash: string;
    block_timestamp: string;
    block_number: string;
    to_address: string;
    from_address: string;
    value: string; // Raw value
    decimals?: number;
}

export interface RealActivity {
    type: 'Buy' | 'Sell' | 'Add Liq' | 'Remove Liq' | 'Transfer' | 'Burn';
    val: string;
    desc: string;
    time: string;
    color: string;
    usd: string;
    hash: string;
    wallet: string;
    tag: string;
}

export interface WalletBalance {
    token_address: string;
    symbol: string;
    name: string;
    logo?: string;
    thumbnail?: string;
    decimals: number;
    balance: string;
    possible_spam: boolean;
    verified_contract?: boolean;
    usd_value?: number;
    price_usd?: number;
}

export const normalizeWalletBalancePayload = (payload: any, isSolana: boolean): WalletBalance => ({
    token_address: payload.token_address || payload.mint,
    symbol: payload.symbol,
    name: payload.name,
    logo: payload.logo || payload.thumbnail,
    decimals: Number(isSolana ? (payload.decimals ?? payload.token_decimals ?? payload.tokenDecimal ?? 0) : payload.decimals),
    balance: isSolana ? (payload.amountRaw || payload.balance || payload.amount) : (payload.balance || payload.amount),
    possible_spam: payload.possible_spam ?? payload.possibleSpam,
    verified_contract: payload.verified_contract ?? payload.isVerifiedContract,
    usd_value: payload.usd_value,
    price_usd: payload.usd_price || payload.usdPrice || 0
});

const getTimeAgo = (timestamp: string) => {
    const seconds = Math.floor((Date.now() - new Date(timestamp).getTime()) / 1000);
    if (seconds < 60) return `${seconds}s ago`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
    return `${Math.floor(seconds / 86400)}d ago`;
};

const mapChainToMoralisEVM = (chain: string) => {
    switch (chain.toLowerCase()) {
        case 'ethereum': return '0x1';
        case 'bsc': return '0x38';
        case 'base': return '0x2105';
        case 'arbitrum': return '0xa4b1';
        case 'polygon': return '0x89';
        case 'avalanche': return '0xa86a';
        default: return '0x1';
    }
};

export const MoralisService = {
    /**
     * Get Token Metadata (Supply, Decimals, etc.)
     */
    getTokenMetadata: async (tokenAddress: string, chain: string): Promise<{ totalSupply: string, decimals: number, symbol: string } | null> => {
        if (!tokenAddress) return null;

        const isSolana = chain.toLowerCase() === 'solana';
        if (isSolana) {
            // Solana doesn't use this endpoint usually, simpler to use RPC
            return null;
        }

        const hexChain = mapChainToMoralisEVM(chain);
        const url = `https://deep-index.moralis.io/api/v2.2/erc20/metadata?chain=${hexChain}&addresses%5B0%5D=${tokenAddress}`;

        try {
            const response = await fetch(url, {
                headers: { 'accept': 'application/json', 'X-API-Key': MORALIS_API_KEY }
            });

            if (!response.ok) return null;

            const data = await response.json();
            // Data is array
            if (Array.isArray(data) && data.length > 0) {
                const info = data[0];
                return {
                    totalSupply: info.total_supply,
                    decimals: parseInt(info.decimals),
                    symbol: info.symbol
                };
            }
            return null;
        } catch (e) {
            console.error("Moralis Metadata Error", e);
            return null;
        }
    },

    /**
     * Fetches real token transfers and categorizes them as Buys/Sells
     * by comparing against the Liquidity Pair Address from DexScreener.
     */
    getTokenActivity: async (tokenAddress: string, chain: string, pairAddress: string, tokenPrice: number): Promise<RealActivity[]> => {
        // Validate Token Address
        if (!tokenAddress || tokenAddress.length < 20) {
            console.warn("Invalid Token Address for Moralis");
            return [];
        }

        const isSolana = chain.toLowerCase() === 'solana';

        // Select Endpoint
        let url = '';
        if (isSolana) {
            url = `https://solana-gateway.moralis.io/token/mainnet/${tokenAddress}/transfers?limit=50`;
        } else {
            const hexChain = mapChainToMoralisEVM(chain);
            url = `https://deep-index.moralis.io/api/v2.2/erc20/${tokenAddress}/transfers?chain=${hexChain}&order=DESC&limit=50`;
        }

        try {
            const response = await fetch(url, {
                headers: {
                    'accept': 'application/json',
                    'X-API-Key': MORALIS_API_KEY
                }
            });

            // Gracefully handle 404/400 without crashing
            if (response.status === 404 || response.status === 400) {
                console.warn(`Moralis data not found for ${tokenAddress} on ${chain}`);
                return [];
            }

            if (!response.ok) throw new Error(`Moralis API Error: ${response.status} ${response.statusText}`);

            const data = await response.json();
            const transfers: MoralisTransfer[] = data.result;

            if (!transfers || transfers.length === 0) return [];

            return transfers.map((tx) => {
                // --- Advanced Filtering Logic ---
                const to = (tx.to_address || '').toLowerCase();
                const from = (tx.from_address || '').toLowerCase();
                const decimals = tx.decimals ? Number(tx.decimals) : 18;
                const rawVal = parseFloat(tx.value) / Math.pow(10, decimals);
                const usdVal = rawVal * tokenPrice;
                const isBuy = pairAddress && from === pairAddress.toLowerCase();
                const isSell = pairAddress && to === pairAddress.toLowerCase();

                // Filter for significant liquidity events: additions, removals, burns, and large transfers (> $500k).

                // 1. Burn Detection
                const deadAddresses = [
                    '0x0000000000000000000000000000000000000000',
                    '0x000000000000000000000000000000000000dead',
                    '1nc1nerator11111111111111111111111111111111'
                ];
                if (deadAddresses.includes(to)) {
                    return {
                        type: 'Burn',
                        val: rawVal < 0.01 ? '< 0.01' : rawVal.toFixed(2),
                        desc: 'burned tokens',
                        time: getTimeAgo(tx.block_timestamp),
                        color: 'text-primary-orange',
                        usd: `$${usdVal.toLocaleString(undefined, { maximumFractionDigits: 0 })}`,
                        hash: tx.transaction_hash,
                        wallet: from,
                        tag: 'Burner'
                    };
                }

                // 2. Whale Transfer Detection (>$500,000)
                // Exclude standard DEX swaps from this categorization to focus on transfer events.
                if (usdVal > 500000) {
                    // If it's not a buy/sell (it's a raw transfer) OR if we want to flag huge buys as Whales?
                    // User said "Whale Transfer", usually implies raw transfer or OTC. 
                    // But let's include any movement > 500k as a Whale event for now, but label it distinctively.
                    // However, request says "only report... whale transfer".
                    // If it's a Buy/Sell, it might technically be a "Whale Trade". 
                    // Adhere to strict transfer logic, flagging transactions exceeding $500k.
                    // "Whale Transfer" usually means wallet-to-wallet.

                    if (!isBuy && !isSell) {
                        return {
                            type: 'Transfer', // Label as Whale Transfer in UI
                            val: rawVal < 0.01 ? '< 0.01' : rawVal.toFixed(2),
                            desc: 'Whale Transfer',
                            time: getTimeAgo(tx.block_timestamp),
                            color: 'text-purple-500',
                            usd: `$${usdVal.toLocaleString(undefined, { maximumFractionDigits: 0 })}`,
                            hash: tx.transaction_hash,
                            wallet: from,
                            tag: 'Whale'
                        };
                    }
                }

                // 3. Liquidity Events (Mock/Heuristic for now as Moralis doesn't give "Add Liq" event directly without logs)
                // Real detection requires parsing log topics. 
                // For this implementation, we will filter out standard small Buys/Sells and only return null
                // effectively hiding them from this specific "On Chain Activity" view.

                return null; // Top-level filter: if not one of the above, exclude it.
            }).filter(Boolean) as RealActivity[]; // Remove nulls

        } catch (error) {
            console.error("Failed to fetch Moralis data:", error);
            return [];
        }
    },

    /**
     * Fetches Wallet Balances for the Wallet Tracking Page
     */
    getWalletBalances: async (address: string, chain: string): Promise<WalletBalance[]> => {
        if (!address) return [];

        const isSolana = chain.toLowerCase() === 'solana';
        const hexChain = !isSolana ? mapChainToMoralisEVM(chain) : '';

        // --- 1. Fetch Token Balances (ERC20 / SPL) ---
        const tokenPromise = (async () => {
            let allTokens: any[] = [];
            let cursor: string | null = null;
            let loops = 0;

            try {
                do {
                    if (loops > 5) break; // Safety limit

                    let url = '';
                    if (isSolana) {
                        url = `https://solana-gateway.moralis.io/account/mainnet/${address}/tokens`; // Solana endpoint rarely paginates this way?
                    } else {
                        url = `https://deep-index.moralis.io/api/v2.2/${address}/erc20?chain=${hexChain}&exclude_spam=true&limit=100`;
                        if (cursor) url += `&cursor=${cursor}`;
                    }

                    const response = await fetch(url, {
                        headers: { 'accept': 'application/json', 'X-API-Key': APP_CONFIG.moralisKey }
                    });

                    if (!response.ok) {
                        console.error(`[Moralis] Error ${response.status} for ${url}`);
                        break;
                    }

                    const data = await response.json();
                    const pageTokens = Array.isArray(data) ? data : (data.result || []);
                    allTokens = [...allTokens, ...pageTokens];

                    cursor = data.cursor || null;
                    loops++;

                    // Ensure array response handling for Solana endpoint compatibility.
                    if (isSolana) break;

                } while (cursor);

                return allTokens.map((t: any) => normalizeWalletBalancePayload(t, isSolana));
            } catch (error) {
                console.error("[Moralis] Fetch tokens error", error);
                return [];
            }
        })();

        // --- 2. Fetch Native Balance (ETH, SOL, BNB) ---
        const nativePromise = (async (): Promise<WalletBalance | null> => {
            try {
                if (isSolana) {
                    // Solana Native Balance via RPC
                    const info = await SolanaRpcService.getAccountInfo(address);
                    if (info && info.lamports > 0) {
                        const bal = info.lamports / 1e9;
                        const price = await MoralisService.getTokenPriceAtBlock('So11111111111111111111111111111111111111112', 'Solana');
                        return {
                            token_address: 'So11111111111111111111111111111111111111112', // Wrapped SOL address as proxy ID
                            symbol: 'SOL',
                            name: 'Solana',
                            logo: 'https://cryptologos.cc/logos/solana-sol-logo.png',
                            decimals: 9,
                            balance: info.lamports.toString(), // Raw units
                            possible_spam: false,
                            verified_contract: true,
                            usd_value: bal * price,
                            price_usd: price
                        };
                    }
                } else {
                    // EVM Native Balance via Moralis
                    const url = `https://deep-index.moralis.io/api/v2.2/${address}/balance?chain=${hexChain}`;
                    const response = await fetch(url, {
                        headers: { 'accept': 'application/json', 'X-API-Key': APP_CONFIG.moralisKey }
                    });
                    if (response.ok) {
                        const data = await response.json();
                        // Moralis returns { balance: "wei" }
                        const balWei = data.balance;
                        if (parseFloat(balWei) > 0) {
                            // Determine Native Symbol
                            let symbol = 'ETH';
                            let name = 'Ethereum';
                            let logo = 'https://cryptologos.cc/logos/ethereum-eth-logo.png';

                            if (chain.toLowerCase() === 'bsc') { symbol = 'BNB'; name = 'Binance Coin'; logo = 'https://cryptologos.cc/logos/bnb-bnb-logo.png'; }
                            else if (chain.toLowerCase() === 'base') { symbol = 'ETH'; name = 'Ethereum (Base)'; logo = 'https://cryptologos.cc/logos/base-base-logo.png'; }
                            else if (chain.toLowerCase() === 'polygon') { symbol = 'MATIC'; name = 'Polygon'; logo = 'https://cryptologos.cc/logos/polygon-matic-logo.png'; }
                            else if (chain.toLowerCase() === 'avalanche') { symbol = 'AVAX'; name = 'Avalanche'; logo = 'https://cryptologos.cc/logos/avalanche-avax-logo.png'; }

                            // Fetch Price for Native (Using zero address or Wrapped address usually work)
                            // Moralis native price endpoint: /erc20/address/price is for tokens. 
                            // But usually we can check Wrapped Native
                            let wNative = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2'; // WETH
                            if (chain.toLowerCase() === 'bsc') wNative = '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c'; // WBNB
                            else if (chain.toLowerCase() === 'polygon') wNative = '0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270'; // WMATIC
                            else if (chain.toLowerCase() === 'avalanche') wNative = '0xB31f66AA3C1e785363F0875A1B74E27b85FD66c7'; // WAVAX

                            const price = await MoralisService.getTokenPriceAtBlock(wNative, chain);
                            const balEth = parseFloat(balWei) / 1e18;

                            return {
                                token_address: '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
                                symbol: symbol,
                                name: name,
                                logo: logo,
                                decimals: 18,
                                balance: balWei,
                                possible_spam: false,
                                verified_contract: true,
                                usd_value: balEth * price,
                                price_usd: price
                            };
                        }
                    }
                }
            } catch (e) {
                console.error("Native Balance Fetch Error", e);
            }
            return null;
        })();

        // Wait for both
        const [tokens, native] = await Promise.all([tokenPromise, nativePromise]);

        if (native) {
            // Check if native is already in tokens (Wrapped version sometimes shows up? No, native is distinct from WETH)
            // Prepend the new event to ensure immediate visibility.
            return [native, ...tokens];
        }

        return tokens;
    },

    /**
     * Helper to get block number for a specific date (EVM only)
     */
    getDateToBlock: async (chain: string, date: string): Promise<number | undefined> => {
        const hexChain = mapChainToMoralisEVM(chain);
        const url = `https://deep-index.moralis.io/api/v2.2/dateToBlock?chain=${hexChain}&date=${date}`;

        try {
            const response = await fetch(url, {
                headers: { 'accept': 'application/json', 'X-API-Key': MORALIS_API_KEY }
            });
            if (response.ok) {
                const data = await response.json();
                return data.block;
            }
        } catch (e) {
            console.error("Date to Block Error", e);
        }
        return undefined;
    },

    /**
     * Get Token Price at a specific block (Historical Price)
     * For Solana: uses timestamp (seconds since epoch)
     * For EVM: uses block number
     */
    getTokenPriceAtBlock: async (tokenAddress: string, chain: string, block?: string, timestamp?: number): Promise<number> => {
        if (!tokenAddress) return 0;

        const isSolana = chain.toLowerCase() === 'solana';
        let url = '';

        if (isSolana) {
            url = `https://solana-gateway.moralis.io/token/mainnet/${tokenAddress}/price`;
            // Solana supports historical prices via 'toDate' parameter (ISO 8601 format)
            if (timestamp) {
                const dateStr = new Date(timestamp * 1000).toISOString();
                url += `?toDate=${encodeURIComponent(dateStr)}`;
            }
        } else {
            const hexChain = mapChainToMoralisEVM(chain);
            url = `https://deep-index.moralis.io/api/v2.2/erc20/${tokenAddress}/price?chain=${hexChain}`;
            if (block) {
                url += `&to_block=${block}`;
            }
        }

        try {
            const response = await fetch(url, {
                headers: { 'accept': 'application/json', 'X-API-Key': MORALIS_API_KEY }
            });
            if (!response.ok) return 0;
            const data = await response.json();
            return data.usdPrice || 0;
        } catch (e) {
            return 0;
        }
    },

    /**
     * Unified helper to get price at a specific time for any chain.
     * Handles EVM Date -> Block conversion automatically.
     */
    getPriceAtTime: async (tokenAddress: string, chain: string, timestamp: number): Promise<number> => {
        const isSolana = chain.toLowerCase() === 'solana';

        if (isSolana) {
            return MoralisService.getTokenPriceAtBlock(tokenAddress, chain, undefined, timestamp);
        } else {
            // EVM: Convert Date to Block first
            const dateStr = new Date(timestamp * 1000).toISOString();
            const block = await MoralisService.getDateToBlock(chain, dateStr);
            if (block) {
                return MoralisService.getTokenPriceAtBlock(tokenAddress, chain, block.toString());
            }
        }
        return 0;
    },

    /**
     * Get Token Price at a specific time (Wrapper for Logic)
     */
    getTokenPriceAtTime: async (tokenAddress: string, chain: string, timestamp: number): Promise<number> => {
        const isSolana = chain.toLowerCase() === 'solana';

        if (isSolana) {
            // Solana supports direct timestamp
            return MoralisService.getTokenPriceAtBlock(tokenAddress, chain, undefined, timestamp);
        } else {
            // EVM requires Block Number
            const dateStr = new Date(timestamp * 1000).toISOString();
            const block = await MoralisService.getDateToBlock(chain, dateStr);
            if (block) {
                return MoralisService.getTokenPriceAtBlock(tokenAddress, chain, block.toString());
            }
        }
        return 0;
    },

    /**
     * Estimates the cost basis (avg buy price) for a specific token in a wallet.
     * Strategy:
     * 1. Get last 50 transfers.
     * 2. Identify incoming transfers (Buys).
     * 3. Find the LARGEST buy transaction.
     * 4. Get the historical price at that block/time.
     * 5. Use that as the estimated entry price.
     * Note: This is an estimation to save API calls vs calculating weighted average of all history.
     */
    getEstimatedCostBasis: async (walletAddress: string, tokenAddress: string, chain: string): Promise<{ price: number, timestamp: number }> => {
        if (!walletAddress || !tokenAddress) return { price: 0, timestamp: 0 };

        // --- SOLANA LOGIC (Unified via normalized Solana RPC service) ---
        if (chain.toLowerCase() === 'solana') {
            try {
                const result = await SolanaRpcService.getEstimatedEntry(walletAddress, tokenAddress);
                return { price: result.price, timestamp: result.time * 1000 };
            } catch (e) {
                console.warn("[MoralisService] Solana Cost Basis Error", e);
                return { price: 0, timestamp: 0 };
            }
        }

        const hexChain = mapChainToMoralisEVM(chain);

        // --- NATIVE TOKEN LOGIC (ETH, BNB, MATIC) ---
        if (tokenAddress.toLowerCase() === '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee') {
            const url = `https://deep-index.moralis.io/api/v2.2/${walletAddress}?chain=${hexChain}&order=DESC&limit=50`;

            try {
                const response = await fetch(url, {
                    headers: { 'accept': 'application/json', 'X-API-Key': MORALIS_API_KEY }
                });

                if (!response.ok) return { price: 0, timestamp: 0 };
                const data = await response.json();
                const transfers: MoralisTransfer[] = data.result || [];

                if (transfers.length === 0) return { price: 0, timestamp: 0 };

                // Filter for Incoming Transfers (Buys/Receives)
                const incoming = transfers.filter(tx => tx.to_address.toLowerCase() === walletAddress.toLowerCase());

                if (incoming.length === 0) return { price: 0, timestamp: 0 };

                // Find largest incoming transfer
                const largestBuy = incoming.reduce((prev, current) => {
                    return parseFloat(current.value) > parseFloat(prev.value) ? current : prev;
                });

                // For Price, we map Native -> Wrapped Native Address because Moralis Price API needs a token address
                let wrappedAddr = '';
                switch (chain.toLowerCase()) {
                    case 'ethereum': wrappedAddr = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2'; break; // WETH
                    case 'bsc': wrappedAddr = '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c'; break; // WBNB
                    case 'base': wrappedAddr = '0x4200000000000000000000000000000000000006'; break; // WETH
                    case 'polygon': wrappedAddr = '0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270'; break; // WMATIC
                    case 'avalanche': wrappedAddr = '0xB31f66AA3C1e785363F0875A1B74E27b85FD66c7'; break; // WAVAX
                    default: wrappedAddr = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2'; // Default WETH
                }

                const buyTime = new Date(largestBuy.block_timestamp).getTime();

                if (largestBuy && largestBuy.block_number) {
                    const price = await MoralisService.getTokenPriceAtBlock(wrappedAddr, chain, largestBuy.block_number);
                    return { price, timestamp: buyTime };
                }
                return { price: 0, timestamp: 0 };

            } catch (e) {
                console.error("Native Cost Basis Error", e);
                return { price: 0, timestamp: 0 };
            }
        }

        // --- ERC20 LOGIC ---
        const url = `https://deep-index.moralis.io/api/v2.2/${walletAddress}/erc20/transfers?chain=${hexChain}&contract_addresses%5B0%5D=${tokenAddress}&order=DESC&limit=50`;

        try {
            const response = await fetch(url, {
                headers: { 'accept': 'application/json', 'X-API-Key': MORALIS_API_KEY }
            });

            if (!response.ok) return { price: 0, timestamp: 0 };
            const data = await response.json();
            const transfers: MoralisTransfer[] = data.result || [];

            if (transfers.length === 0) return { price: 0, timestamp: 0 };

            // Filter for Incoming Transfers (Buys/Receives)
            const incoming = transfers.filter(tx => tx.to_address.toLowerCase() === walletAddress.toLowerCase());

            if (incoming.length === 0) return { price: 0, timestamp: 0 };

            // Find the largest single incoming transfer to use as the reference "Buy"
            const largestBuy = incoming.reduce((prev, current) => {
                return parseFloat(current.value) > parseFloat(prev.value) ? current : prev;
            });

            const buyTime = new Date(largestBuy.block_timestamp).getTime();

            // Fetch price at that specific block
            if (largestBuy && largestBuy.block_number) {
                const price = await MoralisService.getTokenPriceAtBlock(tokenAddress, chain, largestBuy.block_number);
                return { price, timestamp: buyTime };
            }

            return { price: 0, timestamp: 0 };

        } catch (e) {
            console.error("Error estimating cost basis", e);
            return { price: 0, timestamp: 0 };
        }
    }
};
