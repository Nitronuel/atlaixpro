// Atlaix: Smart Money scanner discovery workflow for qualified wallet candidates.
export type SmartScannerChain = 'solana' | 'eth' | 'base' | 'bsc' | 'polygon' | 'arbitrum' | 'optimism';

export type SmartScannerBuyer = {
    wallet: string;
    firstSeenAt: string | null;
    txHash: string | null;
    amountRaw: string;
    usdValue?: number;
    pairAddress?: string | null;
    exchange?: string | null;
    source: 'moralis-swaps' | 'alchemy-transfers';
    confidence: 'high' | 'low';
};

type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

const MORALIS_EVM_CHAIN_BY_SCANNER: Record<Exclude<SmartScannerChain, 'solana'>, string> = {
    eth: '0x1',
    base: '0x2105',
    bsc: '0x38',
    polygon: '0x89',
    arbitrum: '0xa4b1',
    optimism: '0xa'
};

export const SMART_SCANNER_EVM_NETWORK_BY_CHAIN: Record<Exclude<SmartScannerChain, 'solana'>, string> = {
    eth: 'eth-mainnet',
    base: 'base-mainnet',
    bsc: 'bnb-mainnet',
    polygon: 'polygon-mainnet',
    arbitrum: 'arb-mainnet',
    optimism: 'opt-mainnet'
};

const ZERO_EVM_ADDRESS = '0x0000000000000000000000000000000000000000';

export function isLikelySolanaAddress(value: string) {
    const trimmed = value.trim();
    return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(trimmed);
}

export function isLikelyEvmAddress(value: string) {
    return /^0x[a-fA-F0-9]{40}$/.test(value.trim());
}

export function isSmartScannerChain(value: string): value is SmartScannerChain {
    return value === 'solana' || value in SMART_SCANNER_EVM_NETWORK_BY_CHAIN;
}

function readEnv(...keys: string[]) {
    for (const key of keys) {
        const value = process.env[key]?.trim();
        if (value) return value;
    }
    return '';
}

function asString(value: unknown): string {
    return typeof value === 'string' ? value : '';
}

function asNumber(value: unknown): number | undefined {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string') {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : undefined;
    }
    return undefined;
}

function pickString(source: Record<string, unknown>, keys: string[]): string {
    for (const key of keys) {
        const value = asString(source[key]);
        if (value) return value;
    }
    return '';
}

function getNestedRecord(source: Record<string, unknown>, keys: string[]): Record<string, unknown> {
    for (const key of keys) {
        const value = source[key];
        if (value && typeof value === 'object' && !Array.isArray(value)) {
            return value as Record<string, unknown>;
        }
    }
    return {};
}

function extractArrayPayload(payload: unknown): Record<string, unknown>[] {
    if (Array.isArray(payload)) {
        return payload.filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === 'object' && !Array.isArray(entry));
    }

    if (!payload || typeof payload !== 'object') return [];
    const objectPayload = payload as Record<string, unknown>;
    const result = objectPayload.result || objectPayload.swaps || objectPayload.data;
    return Array.isArray(result)
        ? result.filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === 'object' && !Array.isArray(entry))
        : [];
}

export function normalizeMoralisSwapBuyer(swap: Record<string, unknown>, tokenAddress: string, chain: SmartScannerChain): SmartScannerBuyer | null {
    const bought = getNestedRecord(swap, ['bought', 'boughtToken', 'tokenBought', 'baseToken']);
    const sold = getNestedRecord(swap, ['sold', 'soldToken', 'tokenSold', 'quoteToken']);
    const transaction = getNestedRecord(swap, ['transaction']);
    const tokenAddressLower = tokenAddress.toLowerCase();
    const boughtAddress = pickString(bought, ['address', 'tokenAddress', 'token_address', 'mint']).toLowerCase();
    const soldAddress = pickString(sold, ['address', 'tokenAddress', 'token_address', 'mint']).toLowerCase();
    const transactionType = pickString(swap, ['transactionType', 'transaction_type', 'type', 'side']).toLowerCase();

    if (boughtAddress && boughtAddress !== tokenAddressLower && transactionType !== 'buy') return null;
    if (soldAddress === tokenAddressLower && transactionType !== 'buy') return null;

    const wallet = pickString(swap, [
        'walletAddress',
        'wallet_address',
        'wallet',
        'traderAddress',
        'trader_address',
        'maker',
        'signer'
    ]) || pickString(transaction, ['fromAddress', 'from_address', 'walletAddress', 'wallet_address', 'signer']);

    const normalizedWallet = chain === 'solana' ? wallet.trim() : wallet.trim().toLowerCase();
    if (chain === 'solana' ? !isLikelySolanaAddress(normalizedWallet) : !isLikelyEvmAddress(normalizedWallet)) {
        return null;
    }
    if (normalizedWallet.toLowerCase() === ZERO_EVM_ADDRESS || normalizedWallet.toLowerCase() === tokenAddressLower) {
        return null;
    }

    return {
        wallet: normalizedWallet,
        firstSeenAt: pickString(swap, ['blockTimestamp', 'block_timestamp', 'blockTime', 'block_time', 'timestamp', 'createdAt']) || null,
        txHash: pickString(swap, ['transactionHash', 'transaction_hash', 'txHash', 'hash', 'signature']) || pickString(transaction, ['hash', 'signature']) || null,
        amountRaw: pickString(bought, ['amountRaw', 'amount_raw', 'amount', 'value']) || pickString(swap, ['amountRaw', 'amount_raw', 'amount']) || '0',
        usdValue: asNumber(swap.totalValueUsd || swap.totalValueUSD || swap.usdValue || swap.valueUsd || bought.usdValue || bought.usd_value),
        pairAddress: pickString(swap, ['pairAddress', 'pair_address', 'pair']) || null,
        exchange: pickString(swap, ['exchangeName', 'exchange_name', 'exchange', 'dex', 'market']) || null,
        source: 'moralis-swaps',
        confidence: 'high'
    };
}

function addBuyer(buyers: Map<string, SmartScannerBuyer>, buyer: SmartScannerBuyer | null, limit: number) {
    if (!buyer) return;
    const key = buyer.wallet.toLowerCase();
    if (!buyers.has(key)) {
        buyers.set(key, buyer);
    }
    return buyers.size >= limit;
}

async function readMoralisJson(response: Response) {
    const text = await response.text();
    const payload = text ? JSON.parse(text) : {};
    if (!response.ok) {
        const error = typeof payload?.message === 'string'
            ? payload.message
            : typeof payload?.error === 'string'
                ? payload.error
                : `Moralis request failed with status ${response.status}.`;
        throw new Error(error);
    }
    return payload;
}

export async function discoverMoralisEvmEarlyBuyers(
    tokenAddress: string,
    chain: Exclude<SmartScannerChain, 'solana'>,
    limit: number,
    options: { fetcher?: Fetcher; moralisKey?: string; maxPages?: number } = {}
) {
    const moralisKey = options.moralisKey ?? readEnv('MORALIS_API_KEY');
    if (!moralisKey) {
        throw new Error('Moralis API key is not configured on the backend.');
    }

    const fetcher = options.fetcher || fetch;
    const buyers = new Map<string, SmartScannerBuyer>();
    let cursor = '';
    let pages = 0;
    const maxPages = options.maxPages || 10;

    do {
        const params = new URLSearchParams({
            chain: MORALIS_EVM_CHAIN_BY_SCANNER[chain],
            order: 'ASC',
            limit: String(Math.min(100, Math.max(10, limit * 2))),
            transactionTypes: 'buy'
        });
        if (cursor) params.set('cursor', cursor);

        const response = await fetcher(`https://deep-index.moralis.io/api/v2.2/erc20/${tokenAddress}/swaps?${params.toString()}`, {
            headers: {
                accept: 'application/json',
                'X-API-Key': moralisKey
            }
        });
        const payload = await readMoralisJson(response);
        for (const swap of extractArrayPayload(payload)) {
            if (addBuyer(buyers, normalizeMoralisSwapBuyer(swap, tokenAddress, chain), limit)) break;
        }

        cursor = asString(payload?.cursor);
        pages += 1;
    } while (buyers.size < limit && cursor && pages < maxPages);

    return [...buyers.values()].slice(0, limit);
}

export async function discoverMoralisSolanaEarlyBuyers(
    tokenAddress: string,
    limit: number,
    options: { fetcher?: Fetcher; moralisKey?: string; maxPages?: number } = {}
) {
    const moralisKey = options.moralisKey ?? readEnv('MORALIS_API_KEY');
    if (!moralisKey) {
        throw new Error('Moralis API key is not configured on the backend.');
    }

    const fetcher = options.fetcher || fetch;
    const buyers = new Map<string, SmartScannerBuyer>();
    let cursor = '';
    let pages = 0;
    const maxPages = options.maxPages || 10;

    do {
        const params = new URLSearchParams({
            limit: String(Math.min(100, Math.max(10, limit * 2))),
            order: 'ASC',
            transactionTypes: 'buy'
        });
        if (cursor) params.set('cursor', cursor);

        const response = await fetcher(`https://solana-gateway.moralis.io/token/mainnet/${tokenAddress}/swaps?${params.toString()}`, {
            headers: {
                accept: 'application/json',
                'X-API-Key': moralisKey
            }
        });
        const payload = await readMoralisJson(response);
        for (const swap of extractArrayPayload(payload)) {
            if (addBuyer(buyers, normalizeMoralisSwapBuyer(swap, tokenAddress, 'solana'), limit)) break;
        }

        cursor = asString(payload?.cursor);
        pages += 1;
    } while (buyers.size < limit && cursor && pages < maxPages);

    return [...buyers.values()].slice(0, limit);
}

export async function smartScannerAlchemyEvmRpc<T>(
    chain: Exclude<SmartScannerChain, 'solana'>,
    method: string,
    params: unknown[],
    options: { fetcher?: Fetcher; alchemyKey?: string } = {}
): Promise<T> {
    const alchemyKey = options.alchemyKey ?? readEnv('ALCHEMY_API_KEY');
    if (!alchemyKey) {
        throw new Error('Alchemy API key is not configured on the backend.');
    }

    const network = SMART_SCANNER_EVM_NETWORK_BY_CHAIN[chain];
    const fetcher = options.fetcher || fetch;
    const providerResponse = await fetcher(`https://${network}.g.alchemy.com/v2/${alchemyKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            jsonrpc: '2.0',
            id: `smart-money-scanner-${method}`,
            method,
            params
        })
    });
    const payload = await providerResponse.json().catch(() => ({})) as { result?: T; error?: { message?: string } };
    if (!providerResponse.ok || payload.error) {
        throw new Error(payload.error?.message || `Alchemy ${method} failed with status ${providerResponse.status}.`);
    }
    return payload.result as T;
}

export async function smartScannerSolanaRpc<T>(
    method: string,
    params: unknown,
    options: { fetcher?: Fetcher; alchemyKey?: string } = {}
): Promise<T> {
    const alchemyKey = options.alchemyKey ?? readEnv('ALCHEMY_API_KEY');
    if (!alchemyKey) {
        throw new Error('Alchemy API key is not configured on the backend.');
    }

    const fetcher = options.fetcher || fetch;
    const providerResponse = await fetcher(`https://solana-mainnet.g.alchemy.com/v2/${alchemyKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            jsonrpc: '2.0',
            id: `smart-money-scanner-${method}`,
            method,
            params
        })
    });
    const payload = await providerResponse.json().catch(() => ({})) as { result?: T; error?: { message?: string } };
    if (!providerResponse.ok || payload.error) {
        throw new Error(payload.error?.message || `Alchemy Solana ${method} failed with status ${providerResponse.status}.`);
    }
    return payload.result as T;
}

export async function discoverAlchemyEvmTransferRecipients(
    tokenAddress: string,
    chain: Exclude<SmartScannerChain, 'solana'>,
    limit: number,
    options: { fetcher?: Fetcher; alchemyKey?: string } = {}
): Promise<SmartScannerBuyer[]> {
    type AssetTransferResponse = {
        transfers?: Array<{
            hash?: string;
            from?: string;
            to?: string;
            metadata?: { blockTimestamp?: string };
            rawContract?: { value?: string | null };
        }>;
        pageKey?: string;
    };

    const buyers = new Map<string, SmartScannerBuyer>();
    let pageKey: string | undefined;
    let page = 0;

    while (buyers.size < limit && page < 8) {
        const result = await smartScannerAlchemyEvmRpc<AssetTransferResponse>(chain, 'alchemy_getAssetTransfers', [{
            fromBlock: '0x0',
            toBlock: 'latest',
            order: 'asc',
            category: ['erc20'],
            contractAddresses: [tokenAddress],
            withMetadata: true,
            excludeZeroValue: true,
            maxCount: '0x3e8',
            pageKey
        }], options);

        for (const transfer of result.transfers || []) {
            const to = (transfer.to || '').trim().toLowerCase();
            const from = (transfer.from || '').trim().toLowerCase();
            if (!isLikelyEvmAddress(to) || to === ZERO_EVM_ADDRESS || to === tokenAddress.toLowerCase()) continue;
            if (from === to) continue;
            addBuyer(buyers, {
                wallet: to,
                firstSeenAt: transfer.metadata?.blockTimestamp || null,
                txHash: transfer.hash || null,
                amountRaw: transfer.rawContract?.value || '0',
                source: 'alchemy-transfers',
                confidence: 'low'
            }, limit);
            if (buyers.size >= limit) break;
        }

        if (!result.pageKey || !(result.transfers || []).length) break;
        pageKey = result.pageKey;
        page += 1;
    }

    return [...buyers.values()].slice(0, limit);
}

export async function discoverAlchemySolanaTokenRecipients(
    tokenAddress: string,
    limit: number,
    options: { fetcher?: Fetcher; alchemyKey?: string } = {}
): Promise<SmartScannerBuyer[]> {
    type MintSignature = { signature: string; blockTime?: number | null };
    type ParsedTransaction = {
        blockTime?: number | null;
        transaction?: { signatures?: string[] };
        meta?: {
            postTokenBalances?: Array<{
                mint?: string;
                owner?: string;
                uiTokenAmount?: { amount?: string };
            }>;
        };
    };

    const signatures = await smartScannerSolanaRpc<MintSignature[]>('getSignaturesForAddress', [
        tokenAddress,
        { limit: Math.min(1000, Math.max(100, limit * 4)), commitment: 'finalized' }
    ], options).catch(() => []);
    const chronological = [...signatures].reverse();
    const buyers = new Map<string, SmartScannerBuyer>();

    for (let index = 0; index < chronological.length && buyers.size < limit; index += 1) {
        const signature = chronological[index]?.signature;
        if (!signature) continue;

        const transaction = await smartScannerSolanaRpc<ParsedTransaction | null>('getTransaction', [
            signature,
            {
                commitment: 'finalized',
                encoding: 'jsonParsed',
                maxSupportedTransactionVersion: 0
            }
        ], options).catch(() => null);
        if (!transaction) continue;

        for (const balance of transaction.meta?.postTokenBalances || []) {
            const owner = balance.owner || '';
            if (balance.mint !== tokenAddress || !isLikelySolanaAddress(owner)) continue;
            addBuyer(buyers, {
                wallet: owner,
                firstSeenAt: transaction.blockTime ? new Date(transaction.blockTime * 1000).toISOString() : null,
                txHash: transaction.transaction?.signatures?.[0] || signature,
                amountRaw: balance.uiTokenAmount?.amount || '0',
                source: 'alchemy-transfers',
                confidence: 'low'
            }, limit);
            if (buyers.size >= limit) break;
        }
    }

    return [...buyers.values()].slice(0, limit);
}

export async function discoverSmartScannerEarlyBuyers(tokenAddress: string, chain: SmartScannerChain, limit: number) {
    try {
        const moralisBuyers = chain === 'solana'
            ? await discoverMoralisSolanaEarlyBuyers(tokenAddress, limit)
            : await discoverMoralisEvmEarlyBuyers(tokenAddress.toLowerCase(), chain, limit);
        if (moralisBuyers.length) return moralisBuyers;
    } catch (error) {
        console.warn('[SmartMoneyScanner] Moralis swap discovery failed, trying transfer fallback:', error instanceof Error ? error.message : error);
    }

    return chain === 'solana'
        ? discoverAlchemySolanaTokenRecipients(tokenAddress, limit)
        : discoverAlchemyEvmTransferRecipients(tokenAddress.toLowerCase(), chain, limit);
}
