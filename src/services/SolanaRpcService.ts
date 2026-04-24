
import { APP_CONFIG } from '../config';
import { SolanaProvider } from './SolanaProvider';
import { fetchProvider } from './ProviderGateway';


export class SolanaRpcService {
    private static readonly IS_BROWSER = typeof window !== 'undefined';
    private static readonly IS_DEV = import.meta.env.DEV;
    private static RPC_ENDPOINTS = [
        ...(SolanaRpcService.IS_BROWSER ? ['/api/providers/solana-helius'] : (APP_CONFIG.heliusKey ? [`https://mainnet.helius-rpc.com/?api-key=${APP_CONFIG.heliusKey}`] : [])),
        ...(SolanaRpcService.IS_BROWSER ? ['/api/providers/solana-alchemy'] : (APP_CONFIG.alchemyKey ? [`https://solana-mainnet.g.alchemy.com/v2/${APP_CONFIG.alchemyKey}`] : [])),
        SolanaRpcService.IS_DEV ? '/api/solana-public' : 'https://api.mainnet-beta.solana.com'
    ];

    private static currentEndpointIndex = 0;

    private static getEndpoint(): string {
        return this.RPC_ENDPOINTS[this.currentEndpointIndex];
    }

    // Direct access to Moralis Key without importing MoralisService
    private static MORALIS_KEY = APP_CONFIG.moralisKey;


    private static rotateEndpoint() {
        this.currentEndpointIndex = (this.currentEndpointIndex + 1) % this.RPC_ENDPOINTS.length;
    }

    private static async fetchWithRetry(url: string, options: any, retries = 3, backoff = 500): Promise<any> {
        // Use current endpoint instead of passed url if it matches the base RPC
        let targetUrl = url;
        if (this.RPC_ENDPOINTS.includes(url)) {
            targetUrl = this.getEndpoint();
        }

        try {
            const response = await fetch(targetUrl, options);

            if (response.status === 429 || response.status === 401 || response.status === 403) {
                console.warn(`[SolanaRpc] Error ${response.status} on ${targetUrl}. Rotating...`);
                this.rotateEndpoint();

                if (retries > 0) {
                    await new Promise(r => setTimeout(r, backoff));
                    // Recursive call will use new endpoint
                    return this.fetchWithRetry(this.getEndpoint(), options, retries - 1, backoff); // No exponential backoff needed if rotating? Keep it anyway.
                } else {
                    throw new Error(`Max retries exceeded. Last error: ${response.status}`);
                }
            }

            if (!response.ok) {
                throw new Error(`RPC Error: ${response.status} ${response.statusText}`);
            }

            return await response.json();
        } catch (e: any) {
            console.warn(`[SolanaRpc] Network Error on ${targetUrl}: ${e.message}. Rotating...`);
            this.rotateEndpoint();

            if (retries > 0) {
                await new Promise(r => setTimeout(r, backoff));
                return this.fetchWithRetry(this.getEndpoint(), options, retries - 1, backoff);
            }
            throw e;
        }
    }

    private static async rpcCall(method: string, params: any[]): Promise<any> {
        let lastError: unknown = null;

        for (let attempt = 0; attempt < this.RPC_ENDPOINTS.length; attempt++) {
            try {
                const data = await this.fetchWithRetry(this.getEndpoint(), {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        jsonrpc: '2.0',
                        id: 1,
                        method,
                        params
                    })
                }, 1);

                if (data?.error) {
                    throw new Error(data.error.message || `RPC ${method} returned an error response`);
                }

                return data.result;
            } catch (e) {
                lastError = e;
                console.warn(`RPC ${method} failed on ${this.getEndpoint()}:`, e);
                this.rotateEndpoint();
            }
        }

        console.error(`RPC ${method} failed on all configured Solana endpoints:`, lastError);
        throw lastError;
    }

    static async getAccountInfo(address: string): Promise<any> {
        try {
            const result = await this.rpcCall('getAccountInfo', [address, { encoding: 'jsonParsed' }]);
            return result?.value || null;
        } catch (e) {
            return null;
        }
    }

    static async getAccountOwner(address: string): Promise<string | null> {
        const info = await this.getAccountInfo(address);
        return info?.owner || null;
    }

    static async getTokenAccountOwner(address: string): Promise<string | null> {
        const info = await this.getAccountInfo(address);
        return info?.data?.parsed?.info?.owner || null;
    }

    static async getTokenSupply(mintAddress: string): Promise<number> {
        try {
            const result = await this.rpcCall('getTokenSupply', [mintAddress]);
            return result?.value?.uiAmount || 0;
        } catch (e) {
            return 0;
        }
    }

    static async getTokenLargestAccounts(mintAddress: string): Promise<any[]> {
        try {
            const result = await this.rpcCall('getTokenLargestAccounts', [mintAddress]);
            return result?.value || [];
        } catch (e) {
            return [];
        }
    }

    static async getLpMintFromRaydium(pairAddress: string): Promise<string | null> {
        const RAYDIUM_V4_PROGRAM_ID = '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8';
        const RAYDIUM_CPMM_PROGRAM_ID = 'CPMMoo8L3FKEzbYdesnHb69EsoQDghyqEEbYCM9N3h75';

        const accountInfo = await this.getAccountInfo(pairAddress);
        if (!accountInfo || !accountInfo.data || !accountInfo.data[0]) return null;

        const owner = accountInfo.owner;
        const base64Data = accountInfo.data[0];
        const binaryString = atob(base64Data);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
            bytes[i] = binaryString.charCodeAt(i);
        }

        let offset = -1;
        if (owner === RAYDIUM_V4_PROGRAM_ID || bytes.length === 752) offset = 464;
        else if (owner === RAYDIUM_CPMM_PROGRAM_ID || bytes.length >= 600) offset = 136;

        if (offset === -1 || bytes.length < offset + 32) return null;

        const lpMintBytes = bytes.slice(offset, offset + 32);
        return this.toBase58(lpMintBytes);
    }

    private static toBase58(B: Uint8Array): string {
        const A = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
        let d = [], s = "", i, j, c, n;
        for (i in B) { j = 0, c = B[i]; s += c || s.length ^ i ? "" : 1; while (j in d || c) { n = d[j]; n = n ? n * 256 + c : c; c = n / 58 | 0; d[j] = n % 58; j++ } }
        while (j--) s += A[d[j]];
        return s;
    }

    static async getHolderCount(mintAddress: string): Promise<number | null> {
        // Expensive call, retry carefully
        try {
            const result = await this.rpcCall('getProgramAccounts', [
                'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
                {
                    encoding: 'base64',
                    filters: [
                        { dataSize: 165 },
                        { memcmp: { offset: 0, bytes: mintAddress } }
                    ]
                }
            ]);
            if (Array.isArray(result)) return result.length;
            return null;
        } catch (e) {
            return null;
        }
    }

    static async getSignaturesForAddress(address: string, limit: number = 20, before?: string): Promise<any[]> {
        try {
            const params: any = [address, { limit }];
            if (before) params[1].before = before;

            const result = await this.rpcCall('getSignaturesForAddress', params);
            return result || [];
        } catch (e) {
            console.error('RPC getSignaturesForAddress failed:', e);
            return [];
        }
    }

    static async getTransaction(signature: string): Promise<any> {
        try {
            const result = await this.rpcCall('getTransaction', [
                signature,
                { encoding: 'jsonParsed', maxSupportedTransactionVersion: 0 }
            ]);
            return result || null;
        } catch (e) {
            return null;
        }
    }
    static async getTokenAccountsByOwner(walletAddress: string, mintAddress: string): Promise<string | null> {
        try {
            const result = await this.rpcCall('getTokenAccountsByOwner', [
                walletAddress,
                { mint: mintAddress },
                { encoding: 'jsonParsed' }
            ]);

            if (result && result.value && result.value.length > 0) {
                // Return the first account found (usually the ATA)
                return result.value[0].pubkey;
            }
            return null;
        } catch (e) {
            console.error('RPC getTokenAccountsByOwner failed:', e);
            return null;
        }
    }

    /**
     * Finds the largest incoming transfer (buy/receive) using normalized Solana history.
     */
    // Simple in-memory cache for wallet history to avoid repeated deep scans per wallet.
    // Key: walletAddress, Value: { timestamp: number, transactions: any[] }
    private static historyCache = new Map<string, { timestamp: number, transactions: any[] }>();

    /**
     * Smart Preload: Fetches history until ALL required mints have a found "Buy" transaction,
     * or until MAX_HISTORY is reached.
     */
    static async preloadHistory(walletAddress: string, requiredMints: string[]) {
        const MAX_HISTORY = 10000;
        const CACHE_TTL = 10 * 60 * 1000;

        // Check if cache is already sufficient?
        const cached = this.historyCache.get(walletAddress);
        if (cached && (Date.now() - cached.timestamp < CACHE_TTL)) {
            // MERGE Logic: If we are lazy loading for a specific mint that wasn't in the original "requiredMints",
            // we might want to check if the current history is deep enough?
            // For now, accept the cache if present.
            return;
        }
        let allTransactions: any[] = [];
        let beforeSignature = '';
        let consecutiveFailures = 0;

        // Tracking set to know when we are done
        const pendingMints = new Set(requiredMints.map(m => m.toLowerCase()));

        // Helper to check if a tx satisfies a mint
        const checkTxForMints = (tx: any) => {
            if (!tx) return;
            const SOL_MINT = 'so11111111111111111111111111111111111111112'; // Lowercase check

            // Check Native
            if (tx.nativeTransfers) {
                const incoming = tx.nativeTransfers.find((t: any) => t.toUserAccount === walletAddress);
                if (incoming && (incoming.amount / 1e9) > 0) pendingMints.delete(SOL_MINT);
            }
            // Check Tokens
            if (tx.tokenTransfers) {
                tx.tokenTransfers.forEach((t: any) => {
                    const tMint = (t.mint || '').toLowerCase();
                    if (t.toUserAccount === walletAddress && pendingMints.has(tMint)) {
                        pendingMints.delete(tMint);
                    }
                });
            }
        };

        while (allTransactions.length < MAX_HISTORY) {
            // Optimization: STOP if we found everything
            if (pendingMints.size === 0) {
                break;
            }

            try {
                await new Promise(r => setTimeout(r, 100));
                const pageStats = await SolanaProvider.getParsedAddressTransactions(walletAddress, beforeSignature || undefined);
                if (!Array.isArray(pageStats) || pageStats.length === 0) break;

                allTransactions = [...allTransactions, ...pageStats];
                consecutiveFailures = 0;

                // Process this page to see if we satisfy any pending mints
                for (const tx of pageStats) {
                    checkTxForMints(tx);
                }

                const lastTx = pageStats[pageStats.length - 1];
                beforeSignature = lastTx.signature;

                if (pageStats.length < 100) break; // End of history

            } catch (e) {
                console.error("Parsed Solana history fetch error", e);
                consecutiveFailures++;
                if (consecutiveFailures > 3) break;
                await new Promise(r => setTimeout(r, 2000));
            }
        }

        this.historyCache.set(walletAddress, { timestamp: Date.now(), transactions: allTransactions });
    }

    /**
     * Finds the largest incoming transfer (buy/receive) using normalized Solana history.
     * EXPECTS history to be preloaded via preloadHistory for performance, but falls back to cache check.
     * It does NOT perform a new fetch if cache is missed, to strictly separate concerns and avoid race conditions.
     */
    static async getLargestIncomingTransfer(walletAddress: string, mintAddress: string): Promise<{ block: number, time: number, amount: number } | null> {
        let cached = this.historyCache.get(walletAddress);

        // LAZY LOAD FALLBACK:
        // If cache is missing, we MUST fetch data or else we return N/A.
        // Initiate a historical data scan for the specific asset to preload relevant activity.
        if (!cached) {
            console.warn(`[SolanaRpc] Cache miss for ${walletAddress}. Triggering Lazy Load...`);
            await this.preloadHistory(walletAddress, [mintAddress]);
            cached = this.historyCache.get(walletAddress);
        }

        let allTransactions: any[] = [];
        if (cached) {
            allTransactions = cached.transactions;
        } else {
            return null;
        }

        // 3. Analyze History for Specific Asset
        const targetMint = mintAddress.toLowerCase();
        const isNativeSol = targetMint === 'so11111111111111111111111111111111111111112';


        let largestBuyAmount = 0;
        let largestBuyBlock = 0;
        let largestBuyTime = 0;
        let foundBuy = false;

        for (const tx of allTransactions) {
            const timestamp = tx.timestamp || 0;
            const slot = tx.slot || 0;

            // --- NATIVE SOL LOGIC ---
            if (isNativeSol) {
                if (tx.nativeTransfers) {
                    const incomingNative = tx.nativeTransfers.find((t: any) => t.toUserAccount === walletAddress);
                    if (incomingNative) {
                        const amount = incomingNative.amount / 1e9;
                        if (amount > largestBuyAmount) {
                            largestBuyAmount = amount;
                            largestBuyBlock = slot;
                            largestBuyTime = timestamp;
                            foundBuy = true;
                        }
                    }
                }
            }
            // --- SPL TOKEN LOGIC ---
            else {
                if (tx.tokenTransfers) {
                    const incomingToken = tx.tokenTransfers.find((t: any) =>
                        (t.mint || '').toLowerCase() === targetMint && t.toUserAccount === walletAddress
                    );

                    if (incomingToken) {
                        const amount = incomingToken.tokenAmount;
                        if (amount > largestBuyAmount) {
                            largestBuyAmount = amount;
                            largestBuyBlock = slot;
                            largestBuyTime = timestamp;
                            foundBuy = true;
                        }
                    }
                }
            }
        }

        if (foundBuy && largestBuyAmount > 0) {
            return { block: largestBuyBlock, time: largestBuyTime, amount: largestBuyAmount };
        }

        return null;
    }

    static async getHistoricalPrice(mintAddress: string, timestamp: number): Promise<number> {
        try {
            // Use Moralis Solana API directly
            const dateStr = new Date(timestamp * 1000).toISOString();
            const url = `https://solana-gateway.moralis.io/token/mainnet/${mintAddress}/price?toDate=${encodeURIComponent(dateStr)}`;

            const response = await fetchProvider('moralis', url, {
                headers: {
                    'accept': 'application/json',
                    'X-API-Key': this.MORALIS_KEY
                }
            });

            if (!response.ok) return 0;
            const data = await response.json();
            return data.usdPrice || 0;
        } catch (e) {
            console.error("Historical Price Fetch Error", e);
            return 0;
        }
    }

    static async getEstimatedEntry(walletAddress: string, mintAddress: string): Promise<{ price: number, time: number }> {
        try {
            const transfer = await this.getLargestIncomingTransfer(walletAddress, mintAddress);
            if (transfer && transfer.time) {
                const price = await this.getHistoricalPrice(mintAddress, transfer.time);
                return { price, time: transfer.time };
            }
        } catch (e) {
            console.error("Est Entry Error", e);
        }
        return { price: 0, time: 0 };
    }
}
