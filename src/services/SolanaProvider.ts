import { APP_CONFIG } from '../config';

type RpcPayload<T> = {
    result?: T;
    error?: {
        message?: string;
    };
};

type RpcAccountKey =
    | string
    | {
        pubkey?: string;
        signer?: boolean;
        writable?: boolean;
    };

type RpcInstruction = {
    parsed?: {
        type?: string;
        info?: Record<string, unknown>;
    };
};

type RpcTokenBalance = {
    accountIndex: number;
    mint: string;
    owner?: string;
    uiTokenAmount?: {
        amount?: string;
        decimals?: number;
        uiAmount?: number | null;
        uiAmountString?: string;
    };
};

type RpcParsedTransaction = {
    slot: number;
    blockTime: number | null;
    meta?: {
        err?: object | null;
        preBalances?: number[];
        postBalances?: number[];
        preTokenBalances?: RpcTokenBalance[];
        postTokenBalances?: RpcTokenBalance[];
    };
    transaction?: {
        signatures?: string[];
        message?: {
            accountKeys?: RpcAccountKey[];
            instructions?: RpcInstruction[];
        };
    };
};

export type ParsedTokenTransfer = {
    mint: string;
    tokenAmount: number;
    fromUserAccount?: string;
    toUserAccount?: string;
};

export type ParsedNativeTransfer = {
    amount: number;
    fromUserAccount?: string;
    toUserAccount?: string;
};

export type ParsedAddressTransaction = {
    signature: string;
    slot: number;
    timestamp: number;
    feePayer: string;
    type: 'SWAP' | 'BURN' | 'TRANSFER';
    description: string;
    tokenTransfers: ParsedTokenTransfer[];
    nativeTransfers: ParsedNativeTransfer[];
};

const IS_BROWSER = typeof window !== 'undefined';
const IS_DEV = Boolean((typeof import.meta !== 'undefined' && (import.meta as ImportMeta & { env?: Record<string, unknown> }).env?.DEV) || process.env.NODE_ENV !== 'production');
const RPC_TIMEOUT_MS = 12000;
const DEFAULT_PROVIDER_RETRY_LIMIT = 1;
const PROVIDER_WARN_COOLDOWN_MS = 5000;
const HAS_HELIUS = IS_BROWSER || Boolean(APP_CONFIG.heliusKey);
const HELIUS_RPC_URL = APP_CONFIG.heliusKey
    ? `https://mainnet.helius-rpc.com/?api-key=${APP_CONFIG.heliusKey}`
    : null;
const ALCHEMY_RPC_URL = APP_CONFIG.alchemyKey
    ? `https://solana-mainnet.g.alchemy.com/v2/${APP_CONFIG.alchemyKey}`
    : null;
const HELIUS_ENDPOINT = IS_BROWSER
    ? '/api/providers/solana-helius'
    : HELIUS_RPC_URL;
const ALCHEMY_ENDPOINT = IS_BROWSER
    ? '/api/providers/solana-alchemy'
    : ALCHEMY_RPC_URL;
const PUBLIC_ENDPOINT = (IS_DEV && IS_BROWSER) ? '/api/solana-public' : 'https://api.mainnet-beta.solana.com';
const RPC_ENDPOINTS = [
    HELIUS_ENDPOINT,
    ALCHEMY_ENDPOINT,
    PUBLIC_ENDPOINT
].filter(Boolean) as string[];

const TX_BATCH_SIZE = 8;
const endpointCooldowns = new Map<string, number>();
const warningCooldowns = new Map<string, number>();
const methodCooldowns = new Map<string, number>();
const methodQueueChains = new Map<string, Promise<void>>();
const methodLastStartedAt = new Map<string, number>();
const rpcResponseCache = new Map<string, { expiresAt: number; value: unknown }>();
const inflightRpcRequests = new Map<string, Promise<unknown>>();
const DEFAULT_METHOD_POLICY = {
    minIntervalMs: HAS_HELIUS ? 50 : 70,
    cacheTtlMs: 0
};
const METHOD_POLICIES: Record<string, { minIntervalMs: number; cacheTtlMs: number }> = {
    getAsset: {
        minIntervalMs: HAS_HELIUS ? 120 : 220,
        cacheTtlMs: 90_000
    },
    getTransactionsForAddress: {
        minIntervalMs: HAS_HELIUS ? 140 : 220,
        cacheTtlMs: 60_000
    },
    getTokenAccounts: {
        minIntervalMs: HAS_HELIUS ? 180 : 260,
        cacheTtlMs: 45_000
    },
    getTokenLargestAccounts: {
        minIntervalMs: HAS_HELIUS ? 80 : 120,
        cacheTtlMs: 30_000
    },
    getProgramAccounts: {
        minIntervalMs: HAS_HELIUS ? 90 : 120,
        cacheTtlMs: 45_000
    },
    getSignaturesForAddress: {
        minIntervalMs: HAS_HELIUS ? 90 : 140,
        cacheTtlMs: 30_000
    },
    getTransaction: {
        minIntervalMs: HAS_HELIUS ? 60 : 100,
        cacheTtlMs: 90_000
    },
    getTokenSupply: {
        minIntervalMs: HAS_HELIUS ? 60 : 90,
        cacheTtlMs: 60_000
    },
    getTokenAccountsByOwner: {
        minIntervalMs: HAS_HELIUS ? 100 : 140,
        cacheTtlMs: 30_000
    }
};

function getMethodTimeoutMs(method: string) {
    if (method === 'getSignaturesForAddress') {
        return 6000;
    }
    return RPC_TIMEOUT_MS;
}

function getProviderRetryLimit(method: string) {
    if (method === 'getSignaturesForAddress') {
        return 0;
    }
    return DEFAULT_PROVIDER_RETRY_LIMIT;
}

function normalizeRpcParams(method: string, params: unknown) {
    if (method !== 'getTokenAccounts' || !params || Array.isArray(params) || typeof params !== 'object') {
        if (method !== 'getTransactionsForAddress' || !params || Array.isArray(params) || typeof params !== 'object') {
            return params;
        }

        const nextParams = { ...(params as Record<string, unknown>) };

        if ('account' in nextParams && !('address' in nextParams)) {
            nextParams.address = nextParams.account;
            delete nextParams.account;
        }

        return nextParams;
    }

    const nextParams = { ...(params as Record<string, unknown>) };

    if ('mint' in nextParams && !('mintAddress' in nextParams)) {
        nextParams.mintAddress = nextParams.mint;
        delete nextParams.mint;
    }

    if ('owner' in nextParams && !('ownerAddress' in nextParams)) {
        nextParams.ownerAddress = nextParams.owner;
        delete nextParams.owner;
    }

    return nextParams;
}

function isHeliusEndpoint(url: string) {
    return url.includes('helius-rpc.com') || url.includes('/api/solana-helius') || url.includes('/api/providers/solana-helius');
}

function isAlchemyEndpoint(url: string) {
    return url.includes('alchemy.com') || url.includes('/api/solana-alchemy') || url.includes('/api/providers/solana-alchemy');
}

function getProviderRpcParams(method: string, params: unknown, url: string) {
    const normalizedParams = normalizeRpcParams(method, params);

    if (method === 'getTransactionsForAddress') {
        return normalizedParams;
    }

    if (method !== 'getTokenAccounts' || !normalizedParams || Array.isArray(normalizedParams) || typeof normalizedParams !== 'object') {
        return normalizedParams;
    }

    const nextParams = { ...(normalizedParams as Record<string, unknown>) };

    if (isHeliusEndpoint(url)) {
        if ('mintAddress' in nextParams && !('mint' in nextParams)) {
            nextParams.mint = nextParams.mintAddress;
        }

        if ('ownerAddress' in nextParams && !('owner' in nextParams)) {
            nextParams.owner = nextParams.ownerAddress;
        }

        delete nextParams.mintAddress;
        delete nextParams.ownerAddress;
        return nextParams;
    }

    if (isAlchemyEndpoint(url)) {
        if ('mint' in nextParams && !('mintAddress' in nextParams)) {
            nextParams.mintAddress = nextParams.mint;
        }

        if ('owner' in nextParams && !('ownerAddress' in nextParams)) {
            nextParams.ownerAddress = nextParams.owner;
        }

        delete nextParams.mint;
        delete nextParams.owner;
    }

    return nextParams;
}

function getMethodPolicy(method: string) {
    return METHOD_POLICIES[method] || DEFAULT_METHOD_POLICY;
}

function getRequestCacheKey(method: string, params: unknown) {
    return `${method}:${JSON.stringify(normalizeRpcParams(method, params))}`;
}

function rpcError(status: number, message?: string) {
    const detail = message?.trim();
    return new Error(detail ? `Solana RPC request failed: ${status} ${detail}` : `Solana RPC request failed: ${status}`);
}

function delay(ms: number) {
    return new Promise((resolve) => globalThis.setTimeout(resolve, ms));
}

function getRpcErrorStatus(error: unknown) {
    if (!(error instanceof Error)) return null;
    const match = error.message.match(/Solana RPC request failed:\s*(\d+)/i);
    return match ? Number(match[1]) : null;
}

function isRetryableStatus(status: number | null) {
    return status === 429 || status === 503;
}

function getCooldownMs(status: number | null) {
    if (status === 429) return 12000;
    if (status === 503) return 2500;
    return 0;
}

function getRetryDelayMs(status: number | null, attempt: number) {
    if (status === 429) return 1000 * (attempt + 1);
    if (status === 503) return 350 * (attempt + 1);
    return 0;
}

function isEndpointCoolingDown(url: string) {
    const until = endpointCooldowns.get(url) ?? 0;
    return until > Date.now();
}

function markEndpointCooldown(url: string, error: unknown) {
    const cooldownMs = getCooldownMs(getRpcErrorStatus(error));
    if (cooldownMs > 0) {
        endpointCooldowns.set(url, Date.now() + cooldownMs);
    }
}

function isMethodCoolingDown(method: string) {
    const until = methodCooldowns.get(method) ?? 0;
    return until > Date.now();
}

function markMethodCooldown(method: string, error: unknown) {
    const cooldownMs = getCooldownMs(getRpcErrorStatus(error));
    if (cooldownMs > 0) {
        methodCooldowns.set(method, Date.now() + cooldownMs);
    }
}

function warnProviderFailure(method: string, url: string, error: unknown) {
    const status = getRpcErrorStatus(error);
    if (status === 429 || status === 503) {
        return;
    }

    const warningKey = `${method}:${url}:${status ?? 'unknown'}`;
    const lastWarnAt = warningCooldowns.get(warningKey) ?? 0;

    if ((Date.now() - lastWarnAt) < PROVIDER_WARN_COOLDOWN_MS) {
        return;
    }

    warningCooldowns.set(warningKey, Date.now());
    console.warn(`[SolanaProvider] ${method} failed on ${url}`, error);
}

async function enqueueRpcByMethod<T>(method: string, task: () => Promise<T>) {
    const previous = methodQueueChains.get(method) ?? Promise.resolve();
    const resultPromise = previous
        .catch(() => undefined)
        .then(async () => {
            const { minIntervalMs } = getMethodPolicy(method);
            const lastStartedAt = methodLastStartedAt.get(method) ?? 0;
            const waitMs = Math.max(0, lastStartedAt + minIntervalMs - Date.now());

            if (waitMs > 0) {
                await delay(waitMs);
            }

            methodLastStartedAt.set(method, Date.now());
            return task();
        });

    methodQueueChains.set(method, resultPromise.then(() => undefined, () => undefined));
    return resultPromise;
}

function parseRawAmount(amount?: string) {
    if (!amount) return 0n;
    try {
        return BigInt(amount);
    } catch {
        return 0n;
    }
}

function accountKeyToString(key: RpcAccountKey | undefined) {
    if (!key) return '';
    return typeof key === 'string' ? key : (key.pubkey || '');
}

function getAccountKeys(transaction: RpcParsedTransaction) {
    return (transaction.transaction?.message?.accountKeys || []).map(accountKeyToString).filter(Boolean);
}

function getFeePayer(transaction: RpcParsedTransaction) {
    return getAccountKeys(transaction)[0] || '';
}

function detectBurn(transaction: RpcParsedTransaction) {
    return (transaction.transaction?.message?.instructions || []).some((instruction) => {
        const type = instruction.parsed?.type?.toLowerCase();
        return type === 'burn' || type === 'burnchecked';
    });
}

function buildTokenTransfers(transaction: RpcParsedTransaction, trackedAddress: string): ParsedTokenTransfer[] {
    const preBalances = transaction.meta?.preTokenBalances || [];
    const postBalances = transaction.meta?.postTokenBalances || [];
    const trackedMint = [...preBalances, ...postBalances].some((balance) => balance.mint === trackedAddress) ? trackedAddress : null;
    const relevantMints = trackedMint
        ? [trackedMint]
        : [...new Set([...preBalances, ...postBalances].map((balance) => balance.mint).filter(Boolean))];
    const transfers: ParsedTokenTransfer[] = [];

    for (const mint of relevantMints) {
        const ownerState = new Map<string, { delta: bigint; decimals: number }>();

        for (const balance of preBalances) {
            if (balance.mint !== mint || !balance.owner) continue;
            const current = ownerState.get(balance.owner) || { delta: 0n, decimals: balance.uiTokenAmount?.decimals ?? 0 };
            ownerState.set(balance.owner, {
                delta: current.delta - parseRawAmount(balance.uiTokenAmount?.amount),
                decimals: balance.uiTokenAmount?.decimals ?? current.decimals
            });
        }

        for (const balance of postBalances) {
            if (balance.mint !== mint || !balance.owner) continue;
            const current = ownerState.get(balance.owner) || { delta: 0n, decimals: balance.uiTokenAmount?.decimals ?? 0 };
            ownerState.set(balance.owner, {
                delta: current.delta + parseRawAmount(balance.uiTokenAmount?.amount),
                decimals: balance.uiTokenAmount?.decimals ?? current.decimals
            });
        }

        const receivers = [...ownerState.entries()]
            .filter(([, state]) => state.delta > 0n)
            .map(([owner, state]) => ({ owner, remaining: state.delta, decimals: state.decimals }))
            .sort((left, right) => Number(right.remaining - left.remaining));
        const senders = [...ownerState.entries()]
            .filter(([, state]) => state.delta < 0n)
            .map(([owner, state]) => ({ owner, remaining: -state.delta, decimals: state.decimals }))
            .sort((left, right) => Number(right.remaining - left.remaining));

        while (receivers.length > 0 && senders.length > 0) {
            const receiver = receivers[0];
            const sender = senders[0];
            const rawAmount = receiver.remaining < sender.remaining ? receiver.remaining : sender.remaining;
            const decimals = receiver.decimals || sender.decimals || 0;

            transfers.push({
                mint,
                tokenAmount: Number(rawAmount) / Math.pow(10, decimals),
                fromUserAccount: sender.owner,
                toUserAccount: receiver.owner
            });

            receiver.remaining -= rawAmount;
            sender.remaining -= rawAmount;
            if (receiver.remaining === 0n) receivers.shift();
            if (sender.remaining === 0n) senders.shift();
        }

        for (const sender of senders) {
            if (sender.remaining === 0n) continue;
            transfers.push({
                mint,
                tokenAmount: Number(sender.remaining) / Math.pow(10, sender.decimals || 0),
                fromUserAccount: sender.owner
            });
        }
    }

    return transfers.filter((transfer) => transfer.tokenAmount > 0);
}

function buildNativeTransfers(transaction: RpcParsedTransaction): ParsedNativeTransfer[] {
    const accountKeys = getAccountKeys(transaction);
    const preBalances = transaction.meta?.preBalances || [];
    const postBalances = transaction.meta?.postBalances || [];
    const feePayer = getFeePayer(transaction);
    const deltas = accountKeys.map((account, index) => ({
        account,
        delta: BigInt(postBalances[index] ?? 0) - BigInt(preBalances[index] ?? 0)
    }));
    const receivers = deltas
        .filter((entry) => entry.delta > 0n)
        .map((entry) => ({ account: entry.account, remaining: entry.delta }))
        .sort((left, right) => Number(right.remaining - left.remaining));
    const senders = deltas
        .filter((entry) => entry.delta < 0n)
        .map((entry) => ({ account: entry.account, remaining: -entry.delta }))
        .sort((left, right) => Number(right.remaining - left.remaining));
    const transfers: ParsedNativeTransfer[] = [];

    while (receivers.length > 0 && senders.length > 0) {
        const receiver = receivers[0];
        const sender = senders[0];
        const lamports = receiver.remaining < sender.remaining ? receiver.remaining : sender.remaining;
        const amount = Number(lamports) / 1e9;
        const ignoreDustFee = sender.account === feePayer && amount < 0.001;

        if (!ignoreDustFee) {
            transfers.push({
                amount,
                fromUserAccount: sender.account,
                toUserAccount: receiver.account
            });
        }

        receiver.remaining -= lamports;
        sender.remaining -= lamports;
        if (receiver.remaining === 0n) receivers.shift();
        if (sender.remaining === 0n) senders.shift();
    }

    return transfers.filter((transfer) => transfer.amount > 0);
}

function hasCounterAssetChange(transaction: RpcParsedTransaction, trackedAddress: string, feePayer: string) {
    const balances = [...(transaction.meta?.preTokenBalances || []), ...(transaction.meta?.postTokenBalances || [])];
    const counterMintDeltas = new Map<string, bigint>();

    for (const balance of transaction.meta?.preTokenBalances || []) {
        if (balance.owner !== feePayer || balance.mint === trackedAddress) continue;
        counterMintDeltas.set(balance.mint, (counterMintDeltas.get(balance.mint) || 0n) - parseRawAmount(balance.uiTokenAmount?.amount));
    }

    for (const balance of transaction.meta?.postTokenBalances || []) {
        if (balance.owner !== feePayer || balance.mint === trackedAddress) continue;
        counterMintDeltas.set(balance.mint, (counterMintDeltas.get(balance.mint) || 0n) + parseRawAmount(balance.uiTokenAmount?.amount));
    }

    if ([...counterMintDeltas.values()].some((delta) => delta !== 0n)) {
        return true;
    }

    return balances.some((balance) => balance.owner === feePayer && balance.mint !== trackedAddress);
}

function classifyTransaction(args: {
    transaction: RpcParsedTransaction;
    trackedAddress: string;
    tokenTransfers: ParsedTokenTransfer[];
    nativeTransfers: ParsedNativeTransfer[];
}) {
    const { transaction, trackedAddress, tokenTransfers, nativeTransfers } = args;
    if (detectBurn(transaction) || tokenTransfers.some((transfer) => transfer.mint === trackedAddress && !transfer.toUserAccount)) {
        return 'BURN' as const;
    }

    const feePayer = getFeePayer(transaction);
    const feePayerTrackedTransfer = tokenTransfers.some((transfer) => transfer.mint === trackedAddress && (transfer.fromUserAccount === feePayer || transfer.toUserAccount === feePayer));
    const feePayerNativeTransfer = nativeTransfers.some((transfer) => transfer.amount >= 0.001 && (transfer.fromUserAccount === feePayer || transfer.toUserAccount === feePayer));

    if (feePayerTrackedTransfer && (feePayerNativeTransfer || hasCounterAssetChange(transaction, trackedAddress, feePayer))) {
        return 'SWAP' as const;
    }

    return 'TRANSFER' as const;
}

function describeTransaction(type: ParsedAddressTransaction['type']) {
    if (type === 'BURN') return 'burned tokens';
    if (type === 'SWAP') return 'swap activity';
    return 'transfer activity';
}

function normalizeParsedTransaction(trackedAddress: string, transaction: RpcParsedTransaction): ParsedAddressTransaction | null {
    const signature = transaction.transaction?.signatures?.[0];
    if (!signature || transaction.meta?.err) {
        return null;
    }

    const tokenTransfers = buildTokenTransfers(transaction, trackedAddress);
    const nativeTransfers = buildNativeTransfers(transaction);
    const feePayer = getFeePayer(transaction);
    const type = classifyTransaction({ transaction, trackedAddress, tokenTransfers, nativeTransfers });

    return {
        signature,
        slot: transaction.slot || 0,
        timestamp: transaction.blockTime || 0,
        feePayer,
        type,
        description: describeTransaction(type),
        tokenTransfers,
        nativeTransfers
    };
}

async function fetchJsonWithTimeout(input: RequestInfo | URL, init: RequestInit = {}, timeoutMs = RPC_TIMEOUT_MS) {
    const controller = new AbortController();
    const timeoutId = globalThis.setTimeout(() => controller.abort(), timeoutMs);

    try {
        return await fetch(input, {
            ...init,
            signal: controller.signal
        });
    } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') {
            throw new Error(`Request timed out after ${Math.round(timeoutMs / 1000)}s`);
        }
        throw error;
    } finally {
        globalThis.clearTimeout(timeoutId);
    }
}

async function rpcCall<T>(url: string, method: string, params: unknown): Promise<T> {
    const normalizedParams = getProviderRpcParams(method, params, url);
    let lastError: unknown = null;
    const timeoutMs = getMethodTimeoutMs(method);
    const retryLimit = getProviderRetryLimit(method);

    for (let attempt = 0; attempt <= retryLimit; attempt += 1) {
        try {
            const response = await fetchJsonWithTimeout(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    jsonrpc: '2.0',
                    id: `atlaix-${method}`,
                    method,
                    params: normalizedParams
                })
            }, timeoutMs);

            if (!response.ok) {
                let message = '';
                try {
                    message = await response.text();
                } catch {
                    message = '';
                }
                throw rpcError(response.status, message);
            }

            const payload = await response.json() as RpcPayload<T>;
            if (payload.error) {
                throw new Error(payload.error.message || 'Solana RPC error');
            }

            return payload.result as T;
        } catch (error) {
            lastError = error;
            const status = getRpcErrorStatus(error);
            if (!isRetryableStatus(status) || attempt >= retryLimit) {
                break;
            }

            await delay(getRetryDelayMs(status, attempt));
        }
    }

    throw lastError instanceof Error ? lastError : new Error('Solana RPC call failed');
}

async function tryRpcProviders<T>(method: string, params: unknown): Promise<T> {
    if (isMethodCoolingDown(method)) {
        throw new Error(`Solana RPC request skipped during cooldown after rate limit for ${method}`);
    }

    let lastError: unknown = null;
    const orderedProviders = (() => {
        if (method === 'getTransactionsForAddress') {
            return [HELIUS_ENDPOINT].filter(Boolean) as string[];
        }

        if (method === 'getTransaction') {
            return [ALCHEMY_ENDPOINT, HELIUS_ENDPOINT, PUBLIC_ENDPOINT].filter(Boolean) as string[];
        }

        if (method === 'getAsset' || method === 'getTokenAccounts') {
            return [HELIUS_ENDPOINT, ALCHEMY_ENDPOINT, PUBLIC_ENDPOINT].filter(Boolean) as string[];
        }

        if (method === 'getSignaturesForAddress') {
            return [HELIUS_ENDPOINT, ALCHEMY_ENDPOINT].filter(Boolean) as string[];
        }

        return RPC_ENDPOINTS;
    })();
    const prioritizedProviders = [
        ...orderedProviders.filter((url) => !isEndpointCoolingDown(url)),
        ...orderedProviders.filter((url) => isEndpointCoolingDown(url))
    ];

    for (const url of prioritizedProviders) {
        try {
            return await rpcCall<T>(url, method, params);
        } catch (error) {
            lastError = error;
            markEndpointCooldown(url, error);
            warnProviderFailure(method, url, error);
        }
    }

    markMethodCooldown(method, lastError);

    throw lastError instanceof Error ? lastError : new Error(`All providers failed for ${method}`);
}

export const SolanaProvider = {
    async rpc<T>(method: string, params: unknown): Promise<T> {
        const cacheKey = getRequestCacheKey(method, params);
        const policy = getMethodPolicy(method);
        const cached = rpcResponseCache.get(cacheKey);

        if (cached && cached.expiresAt > Date.now()) {
            return cached.value as T;
        }

        const inflight = inflightRpcRequests.get(cacheKey);
        if (inflight) {
            return inflight as Promise<T>;
        }

        const request = enqueueRpcByMethod(method, async () => {
            const value = await tryRpcProviders<T>(method, params);
            if (policy.cacheTtlMs > 0) {
                rpcResponseCache.set(cacheKey, {
                    expiresAt: Date.now() + policy.cacheTtlMs,
                    value
                });
            }
            return value;
        });

        inflightRpcRequests.set(cacheKey, request as Promise<unknown>);

        try {
            return await request;
        } finally {
            inflightRpcRequests.delete(cacheKey);
        }
    },

    async getParsedAddressTransactions(address: string, beforeSignature?: string, limit = 100): Promise<ParsedAddressTransaction[]> {
        const signatures = await this.rpc<Array<{ signature: string }>>('getSignaturesForAddress', [
            address,
            {
                limit,
                commitment: 'finalized',
                ...(beforeSignature ? { before: beforeSignature } : {})
            }
        ]);

        const normalized: ParsedAddressTransaction[] = [];
        const signatureValues = signatures.map((entry) => entry.signature).filter(Boolean);

        for (let index = 0; index < signatureValues.length; index += TX_BATCH_SIZE) {
            const chunk = signatureValues.slice(index, index + TX_BATCH_SIZE);
            const settled = await Promise.allSettled(
                chunk.map((signature) => this.rpc<RpcParsedTransaction>('getTransaction', [
                    signature,
                    {
                        commitment: 'finalized',
                        encoding: 'jsonParsed',
                        maxSupportedTransactionVersion: 0
                    }
                ]))
            );

            for (const result of settled) {
                if (result.status !== 'fulfilled' || !result.value) continue;
                const entry = normalizeParsedTransaction(address, result.value);
                if (entry) normalized.push(entry);
            }
        }

        return normalized;
    }
};
