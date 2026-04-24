import { APP_CONFIG } from '../../config';
import type {
    EvidenceTier,
    ForensicBundleReport,
    ForensicGraphCluster,
    ForensicGraphEdge,
    ForensicGraphNode,
    ForensicWalletCluster,
    LargestAccount,
    MintSignature,
    ParsedInstruction,
    ParsedTokenBalance,
    ParsedTransaction,
    TokenMetadata
} from './types';

const TOKEN_PROGRAM_ID = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const MAX_TOKEN_ACCOUNTS = 220;
const MAX_RENDER_WALLETS = 170;
const HOLDER_HISTORY_WALLETS = 70;
const HOLDER_HISTORY_SIGNATURE_LIMIT = 10;
const FIRST_HOP_CONNECTOR_LIMIT = 22;
const CONNECTOR_HISTORY_WALLETS = 30;
const CONNECTOR_HISTORY_SIGNATURE_LIMIT = 8;
const TOKEN_RECENT_SIGNATURE_LIMIT = 42;
const RPC_TIMEOUT_MS = 14_000;
const DEXSCREENER_TIMEOUT_MS = 6_000;

type AlchemyRpcPayload<T> = {
    result?: T;
    error?: {
        message?: string;
    };
};

type AlchemyTokenAmount = {
    amount?: string;
    decimals?: number;
};

type AlchemyParsedTokenAccount = {
    pubkey: string;
    account?: {
        data?: {
            parsed?: {
                info?: {
                    owner?: string;
                    tokenAmount?: AlchemyTokenAmount;
                };
            };
        };
    };
};

type AlchemyProgramAccountsResponse = {
    value?: AlchemyParsedTokenAccount[];
    pageKey?: string;
};

type AlchemyDasTokenAccount = {
    address?: string;
    owner?: string;
    amount?: string | number;
    mint?: string;
};

type AlchemyGetTokenAccountsResponse = {
    token_accounts?: AlchemyDasTokenAccount[];
    limit?: number;
    total?: number;
    cursor?: string | null;
};

const ALCHEMY_ENDPOINT = APP_CONFIG.alchemyKey
    ? `https://solana-mainnet.g.alchemy.com/v2/${APP_CONFIG.alchemyKey}`
    : '';

function isLikelySolanaAddress(value: string) {
    const trimmed = value.trim();
    return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(trimmed);
}

function parseRawAmount(amount?: string) {
    if (!amount) return 0n;
    try {
        return BigInt(amount);
    } catch {
        return 0n;
    }
}

function parseBigIntLike(value: string | number | bigint | null | undefined) {
    if (typeof value === 'bigint') return value;
    if (typeof value === 'number') {
        if (!Number.isFinite(value)) return 0n;
        return BigInt(Math.trunc(value));
    }
    if (typeof value === 'string') return parseRawAmount(value);
    return 0n;
}

function dedupe<T>(values: T[]) {
    return [...new Set(values)];
}

function round(value: number, digits = 2) {
    const factor = 10 ** digits;
    return Math.round(value * factor) / factor;
}

function calculatePct(rawAmount: bigint, totalSupply: bigint) {
    if (totalSupply <= 0n || rawAmount <= 0n) return 0;
    return Number((rawAmount * 100000000n) / totalSupply) / 1000000;
}

function walletShort(address: string) {
    return `${address.slice(0, 4)}...${address.slice(-4)}`;
}

function getTxHash(transaction: ParsedTransaction) {
    return transaction.transaction?.signatures?.[0] || '';
}

async function fetchJsonWithTimeout(input: RequestInfo | URL, init: RequestInit = {}, timeoutMs = RPC_TIMEOUT_MS) {
    const controller = new AbortController();
    const timeoutId = globalThis.setTimeout(() => controller.abort(), timeoutMs);

    try {
        return await fetch(input, {
            ...init,
            signal: controller.signal
        });
    } finally {
        globalThis.clearTimeout(timeoutId);
    }
}

async function alchemyRpc<T>(method: string, params: unknown): Promise<T> {
    if (!ALCHEMY_ENDPOINT) {
        throw new Error('Alchemy Hub is not configured because the Alchemy key is missing.');
    }

    const response = await fetchJsonWithTimeout(ALCHEMY_ENDPOINT, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            jsonrpc: '2.0',
            id: `alchemy-hub-${method}`,
            method,
            params
        })
    });

    if (!response.ok) {
        const message = await response.text().catch(() => '');
        throw new Error(message || `Alchemy RPC ${method} failed with status ${response.status}`);
    }

    const payload = await response.json() as AlchemyRpcPayload<T>;
    if (payload.error) {
        throw new Error(payload.error.message || `Alchemy RPC ${method} failed.`);
    }

    return payload.result as T;
}

async function mapWithConcurrency<T, R>(items: T[], concurrency: number, worker: (item: T) => Promise<R>) {
    const queue = [...items];
    const results: R[] = [];
    const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
        while (queue.length) {
            const item = queue.shift() as T;
            results.push(await worker(item));
        }
    });
    await Promise.all(runners);
    return results;
}

async function fetchDexScreenerMarketData(tokenAddress: string) {
    try {
        const response = await fetchJsonWithTimeout(
            `https://api.dexscreener.com/tokens/v1/solana/${tokenAddress}`,
            {},
            DEXSCREENER_TIMEOUT_MS
        );

        if (!response.ok) {
            return { currentPriceUsd: null, marketCapUsd: null };
        }

        const pairs = await response.json() as Array<{
            baseToken?: { address?: string };
            liquidity?: { usd?: number | null };
            priceUsd?: string | null;
            marketCap?: number | null;
            fdv?: number | null;
        }>;

        const candidate = pairs
            .filter((pair) => pair.baseToken?.address === tokenAddress)
            .sort((left, right) => (right.liquidity?.usd || 0) - (left.liquidity?.usd || 0))[0];

        if (!candidate) {
            return { currentPriceUsd: null, marketCapUsd: null };
        }

        const price = candidate.priceUsd ? Number(candidate.priceUsd) : null;
        return {
            currentPriceUsd: price !== null && Number.isFinite(price) ? price : null,
            marketCapUsd: candidate.marketCap || candidate.fdv || null
        };
    } catch {
        return { currentPriceUsd: null, marketCapUsd: null };
    }
}

async function fetchTokenMetadata(tokenAddress: string): Promise<TokenMetadata> {
    const [asset, tokenSupply] = await Promise.all([
        alchemyRpc<any>('getAsset', {
            id: tokenAddress,
            displayOptions: {
                showFungible: true
            }
        }).catch(() => null),
        alchemyRpc<{ value?: { amount?: string; decimals?: number; uiAmountString?: string } }>('getTokenSupply', [
            tokenAddress,
            { commitment: 'finalized' }
        ]).catch(() => null)
    ]);

    const rawSupply =
        asset?.token_info?.supply ||
        asset?.token_info?.mint_supply ||
        asset?.token_info?.amount ||
        tokenSupply?.value?.amount ||
        '0';
    const rawDecimals =
        asset?.token_info?.decimals ||
        tokenSupply?.value?.decimals ||
        0;
    const providerPrice = typeof asset?.token_info?.price_info?.price_per_token === 'number'
        ? asset.token_info.price_info.price_per_token
        : null;
    const providerMarketCap = typeof asset?.token_info?.price_info?.total_price === 'number'
        ? asset.token_info.price_info.total_price
        : null;
    const dexFallback = providerPrice === null || providerMarketCap === null
        ? await fetchDexScreenerMarketData(tokenAddress)
        : { currentPriceUsd: null, marketCapUsd: null };

    return {
        address: tokenAddress,
        name: asset?.content?.metadata?.name || 'Unknown Token',
        symbol: asset?.content?.metadata?.symbol || asset?.token_info?.symbol || 'UNKNOWN',
        totalSupplyRaw: parseBigIntLike(rawSupply),
        decimals: Number(rawDecimals || 0),
        currentPriceUsd: providerPrice ?? dexFallback.currentPriceUsd,
        marketCapUsd: providerMarketCap ?? dexFallback.marketCapUsd,
        deployerAddress: '',
        launchTimestamp: new Date(asset?.created_at || Date.now()).toISOString()
    };
}

async function fetchTokenLargestAccounts(tokenAddress: string) {
    try {
        const result = await alchemyRpc<{ value?: LargestAccount[] }>('getTokenLargestAccounts', [
            tokenAddress,
            { commitment: 'finalized' }
        ]);
        return result?.value || [];
    } catch {
        return [];
    }
}

function normalizeDasTokenAccounts(entries: AlchemyDasTokenAccount[] | undefined) {
    return (entries || [])
        .map((entry) => ({
            address: String(entry.address || ''),
            owner: String(entry.owner || ''),
            amount: String(entry.amount || '0')
        }))
        .filter((entry) => entry.address && entry.owner && isLikelySolanaAddress(entry.owner));
}

async function fetchAlchemyMintAccountsViaDas(tokenAddress: string, limit = MAX_TOKEN_ACCOUNTS) {
    const accounts: Array<{ address: string; owner: string; amount: string }> = [];
    let cursor: string | null | undefined;
    let loops = 0;

    while (accounts.length < limit && loops < 6) {
        const result = await alchemyRpc<AlchemyGetTokenAccountsResponse>('getTokenAccounts', {
            mintAddress: tokenAddress,
            limit: Math.min(100, limit - accounts.length),
            cursor: cursor || undefined
        }).catch(() => null);

        const pageAccounts = normalizeDasTokenAccounts(result?.token_accounts);
        accounts.push(...pageAccounts);

        if (!result?.cursor || pageAccounts.length === 0) {
            break;
        }

        cursor = result.cursor;
        loops += 1;
    }

    return accounts.slice(0, limit);
}

async function fetchAlchemyMintAccountsViaProgramAccounts(tokenAddress: string, limit = MAX_TOKEN_ACCOUNTS) {
    const accounts: Array<{ address: string; owner: string; amount: string }> = [];
    let loops = 0;

    while (accounts.length < limit && loops < 2) {
        const result = await alchemyRpc<AlchemyProgramAccountsResponse>('getProgramAccounts', [
            TOKEN_PROGRAM_ID,
            {
                encoding: 'jsonParsed',
                filters: [
                    { dataSize: 165 },
                    {
                        memcmp: {
                            offset: 0,
                            bytes: tokenAddress
                        }
                    }
                ]
            }
        ]).catch(() => null);

        const value = result?.value || [];
        for (const entry of value) {
            const owner = entry.account?.data?.parsed?.info?.owner || '';
            const amount = entry.account?.data?.parsed?.info?.tokenAmount?.amount || '0';
            if (!owner || !isLikelySolanaAddress(owner)) continue;
            accounts.push({
                address: entry.pubkey,
                owner,
                amount
            });
            if (accounts.length >= limit) {
                break;
            }
        }

        if (value.length === 0) {
            break;
        }
        loops += 1;
    }

    return accounts;
}

async function fetchAlchemyMintAccounts(tokenAddress: string, limit = MAX_TOKEN_ACCOUNTS) {
    const dasAccounts = await fetchAlchemyMintAccountsViaDas(tokenAddress, limit);
    if (dasAccounts.length > 0) {
        return dasAccounts;
    }

    return fetchAlchemyMintAccountsViaProgramAccounts(tokenAddress, limit);
}

async function fetchParsedTransactions(signatures: string[]) {
    const deduped = dedupe(signatures.filter(Boolean));
    return mapWithConcurrency(deduped, 8, async (signature) => {
        try {
            return await alchemyRpc<ParsedTransaction>('getTransaction', [
                signature,
                {
                    commitment: 'finalized',
                    encoding: 'jsonParsed',
                    maxSupportedTransactionVersion: 0
                }
            ]);
        } catch {
            return null as ParsedTransaction | null;
        }
    }).then((entries) => entries.filter((entry): entry is ParsedTransaction => Boolean(entry)));
}

async function fetchRecentTokenTransactions(tokenAddress: string) {
    const signatures = await alchemyRpc<MintSignature[]>('getSignaturesForAddress', [
        tokenAddress,
        { limit: TOKEN_RECENT_SIGNATURE_LIMIT, commitment: 'finalized' }
    ]).catch(() => []);

    return fetchParsedTransactions(signatures.map((entry) => entry.signature));
}

async function fetchWalletTransactions(walletAddress: string, limit = HOLDER_HISTORY_SIGNATURE_LIMIT) {
    const signatures = await alchemyRpc<MintSignature[]>('getSignaturesForAddress', [
        walletAddress,
        { limit, commitment: 'finalized' }
    ]).catch(() => []);

    return fetchParsedTransactions(signatures.map((entry) => entry.signature));
}

function getInstructionInfo(instruction: ParsedInstruction | undefined) {
    return instruction?.parsed?.info || {};
}

function buildWalletCounterpartyMap(
    transactionsByWallet: Map<string, ParsedTransaction[]>,
    trackedWallets: Set<string>
) {
    const byWallet = new Map<string, Map<string, { lamports: bigint; count: number }>>();

    for (const [wallet, transactions] of transactionsByWallet.entries()) {
        const walletMap = byWallet.get(wallet) || new Map<string, { lamports: bigint; count: number }>();

        for (const transaction of transactions) {
            for (const instruction of transaction.transaction?.message?.instructions || []) {
                const info = getInstructionInfo(instruction);
                const sourceWallet = String(info.source || info.authority || info.from || '');
                const targetWallet = String(info.destination || info.to || '');
                const lamports = parseBigIntLike(info.lamports as string | number | bigint | undefined);
                const isTransfer = instruction.program === 'system' && instruction.parsed?.type === 'transfer';

                if (!isTransfer || lamports <= 0n) continue;

                let counterparty = '';
                if (sourceWallet === wallet && targetWallet && !trackedWallets.has(targetWallet)) {
                    counterparty = targetWallet;
                } else if (targetWallet === wallet && sourceWallet && !trackedWallets.has(sourceWallet)) {
                    counterparty = sourceWallet;
                }

                if (!counterparty || !isLikelySolanaAddress(counterparty)) continue;

                const current = walletMap.get(counterparty) || { lamports: 0n, count: 0 };
                current.lamports += lamports;
                current.count += 1;
                walletMap.set(counterparty, current);
            }
        }

        byWallet.set(wallet, walletMap);
    }

    return byWallet;
}

function rankFirstHopConnectors(
    walletCounterparties: Map<string, Map<string, { lamports: bigint; count: number }>>,
    trackedWallets: Set<string>
) {
    const connectorToTracked = new Map<string, Set<string>>();
    const connectorStats = new Map<string, { lamports: bigint; count: number }>();

    for (const [wallet, counterparties] of walletCounterparties.entries()) {
        for (const [counterparty, stats] of counterparties.entries()) {
            if (trackedWallets.has(counterparty)) continue;

            const members = connectorToTracked.get(counterparty) || new Set<string>();
            members.add(wallet);
            connectorToTracked.set(counterparty, members);

            const current = connectorStats.get(counterparty) || { lamports: 0n, count: 0 };
            current.lamports += stats.lamports;
            current.count += stats.count;
            connectorStats.set(counterparty, current);
        }
    }

    return [...connectorToTracked.entries()]
        .map(([connector, wallets]) => ({
            connector,
            walletCount: wallets.size,
            lamports: connectorStats.get(connector)?.lamports || 0n,
            count: connectorStats.get(connector)?.count || 0
        }))
        .sort((left, right) => {
            if (right.walletCount !== left.walletCount) return right.walletCount - left.walletCount;
            if (right.count !== left.count) return right.count - left.count;
            return Number((right.lamports - left.lamports) / 1_000_000n);
        });
}

function extractFundingEdges(transactions: ParsedTransaction[], trackedWallets: Set<string>) {
    const edges = new Map<string, { sourceWallet: string; targetWallet: string; lamports: bigint; count: number }>();

    for (const transaction of transactions) {
        for (const instruction of transaction.transaction?.message?.instructions || []) {
            const info = getInstructionInfo(instruction);
            const sourceWallet = String(info.source || info.authority || info.from || '');
            const targetWallet = String(info.destination || info.to || '');
            const lamports = parseBigIntLike(info.lamports as string | number | bigint | undefined);
            const isTransfer = instruction.program === 'system' && instruction.parsed?.type === 'transfer';

            if (!isTransfer || !sourceWallet || !targetWallet || sourceWallet === targetWallet || lamports <= 0n) {
                continue;
            }

            if (!trackedWallets.has(sourceWallet) || !trackedWallets.has(targetWallet)) {
                continue;
            }

            const key = [sourceWallet, targetWallet].sort().join(':');
            const current = edges.get(key) || {
                sourceWallet,
                targetWallet,
                lamports: 0n,
                count: 0
            };
            current.lamports += lamports;
            current.count += 1;
            edges.set(key, current);
        }
    }

    return [...edges.values()];
}

function collectOwnerDeltas(mintAddress: string, transaction: ParsedTransaction) {
    const deltas = new Map<string, bigint>();

    const applyBalance = (balance: ParsedTokenBalance, direction: 1 | -1) => {
        if (balance.mint !== mintAddress || !balance.owner) return;
        deltas.set(
            balance.owner,
            (deltas.get(balance.owner) || 0n) + (parseRawAmount(balance.uiTokenAmount?.amount) * BigInt(direction))
        );
    };

    for (const balance of transaction.meta?.preTokenBalances || []) {
        applyBalance(balance, -1);
    }
    for (const balance of transaction.meta?.postTokenBalances || []) {
        applyBalance(balance, 1);
    }

    return deltas;
}

function extractMintTransferEdges(mintAddress: string, transactions: ParsedTransaction[], trackedWallets: Set<string>) {
    const edges = new Map<string, { sourceWallet: string; targetWallet: string; amount: bigint; count: number }>();

    for (const transaction of transactions) {
        const deltas = collectOwnerDeltas(mintAddress, transaction);
        const senders = [...deltas.entries()]
            .filter(([, amount]) => amount < 0n)
            .map(([wallet, amount]) => ({ wallet, remaining: -amount }))
            .sort((left, right) => Number(right.remaining - left.remaining));
        const receivers = [...deltas.entries()]
            .filter(([, amount]) => amount > 0n)
            .map(([wallet, amount]) => ({ wallet, remaining: amount }))
            .sort((left, right) => Number(right.remaining - left.remaining));

        while (senders.length > 0 && receivers.length > 0) {
            const sender = senders[0];
            const receiver = receivers[0];
            const transferred = sender.remaining < receiver.remaining ? sender.remaining : receiver.remaining;
            if (transferred <= 0n) break;

            if (trackedWallets.has(sender.wallet) && trackedWallets.has(receiver.wallet) && sender.wallet !== receiver.wallet) {
                const key = [sender.wallet, receiver.wallet].sort().join(':');
                const current = edges.get(key) || {
                    sourceWallet: sender.wallet,
                    targetWallet: receiver.wallet,
                    amount: 0n,
                    count: 0
                };
                current.amount += transferred;
                current.count += 1;
                edges.set(key, current);
            }

            sender.remaining -= transferred;
            receiver.remaining -= transferred;
            if (sender.remaining === 0n) senders.shift();
            if (receiver.remaining === 0n) receivers.shift();
        }
    }

    return [...edges.values()];
}

function buildSharedConnectorEdges(
    transactionsByWallet: Map<string, ParsedTransaction[]>,
    trackedWallets: Set<string>
) {
    const connectorToTracked = new Map<string, Set<string>>();

    for (const [trackedWallet, transactions] of transactionsByWallet.entries()) {
        for (const transaction of transactions) {
            for (const instruction of transaction.transaction?.message?.instructions || []) {
                const info = getInstructionInfo(instruction);
                const sourceWallet = String(info.source || info.authority || info.from || '');
                const targetWallet = String(info.destination || info.to || '');
                const isTransfer = instruction.program === 'system' && instruction.parsed?.type === 'transfer';
                if (!isTransfer) continue;

                const connector =
                    sourceWallet === trackedWallet && targetWallet && !trackedWallets.has(targetWallet)
                        ? targetWallet
                        : targetWallet === trackedWallet && sourceWallet && !trackedWallets.has(sourceWallet)
                            ? sourceWallet
                            : null;
                if (!connector) continue;

                const current = connectorToTracked.get(connector) || new Set<string>();
                current.add(trackedWallet);
                connectorToTracked.set(connector, current);
            }
        }
    }

    const edges: Array<{ from: string; to: string; connector: string; strength: number }> = [];
    for (const [connector, wallets] of connectorToTracked.entries()) {
        const members = [...wallets];
        if (members.length < 2) continue;
        for (let index = 0; index < members.length; index += 1) {
            for (let inner = index + 1; inner < members.length; inner += 1) {
                edges.push({
                    from: members[index],
                    to: members[inner],
                    connector,
                    strength: Math.min(1, 0.4 + members.length * 0.09)
                });
            }
        }
    }
    return edges;
}

function buildSecondHopConnectorEdges(
    walletCounterparties: Map<string, Map<string, { lamports: bigint; count: number }>>,
    connectorTransactionsByWallet: Map<string, ParsedTransaction[]>,
    trackedWallets: Set<string>
) {
    const connectorToTracked = new Map<string, Set<string>>();
    for (const [wallet, counterparties] of walletCounterparties.entries()) {
        for (const connector of counterparties.keys()) {
            if (!trackedWallets.has(connector)) {
                const current = connectorToTracked.get(connector) || new Set<string>();
                current.add(wallet);
                connectorToTracked.set(connector, current);
            }
        }
    }

    const secondHopSourceToTracked = new Map<string, Set<string>>();
    for (const [connector, transactions] of connectorTransactionsByWallet.entries()) {
        const trackedMembers = connectorToTracked.get(connector);
        if (!trackedMembers || trackedMembers.size === 0) continue;

        for (const transaction of transactions) {
            for (const instruction of transaction.transaction?.message?.instructions || []) {
                const info = getInstructionInfo(instruction);
                const sourceWallet = String(info.source || info.authority || info.from || '');
                const targetWallet = String(info.destination || info.to || '');
                const isTransfer = instruction.program === 'system' && instruction.parsed?.type === 'transfer';
                if (!isTransfer) continue;

                const secondHopCounterparty =
                    sourceWallet === connector && targetWallet && !trackedWallets.has(targetWallet)
                        ? targetWallet
                        : targetWallet === connector && sourceWallet && !trackedWallets.has(sourceWallet)
                            ? sourceWallet
                            : '';
                if (!secondHopCounterparty || secondHopCounterparty === connector || !isLikelySolanaAddress(secondHopCounterparty)) {
                    continue;
                }

                const current = secondHopSourceToTracked.get(secondHopCounterparty) || new Set<string>();
                trackedMembers.forEach((wallet) => current.add(wallet));
                secondHopSourceToTracked.set(secondHopCounterparty, current);
            }
        }
    }

    const edges: Array<{ from: string; to: string; source: string; strength: number }> = [];
    for (const [source, wallets] of secondHopSourceToTracked.entries()) {
        const members = [...wallets];
        if (members.length < 2) continue;

        for (let index = 0; index < members.length; index += 1) {
            for (let inner = index + 1; inner < members.length; inner += 1) {
                edges.push({
                    from: members[index],
                    to: members[inner],
                    source,
                    strength: Math.min(0.72, 0.28 + members.length * 0.06)
                });
            }
        }
    }

    return edges;
}

function buildComponents(wallets: string[], edges: Array<{ from: string; to: string }>) {
    const parent = new Map<string, string>();
    wallets.forEach((wallet) => parent.set(wallet, wallet));

    const find = (wallet: string): string => {
        const next = parent.get(wallet) || wallet;
        if (next === wallet) return wallet;
        const root = find(next);
        parent.set(wallet, root);
        return root;
    };

    const union = (left: string, right: string) => {
        const leftRoot = find(left);
        const rightRoot = find(right);
        if (leftRoot !== rightRoot) {
            parent.set(rightRoot, leftRoot);
        }
    };

    edges.forEach((edge) => union(edge.from, edge.to));

    const groups = new Map<string, string[]>();
    wallets.forEach((wallet) => {
        const root = find(wallet);
        const current = groups.get(root) || [];
        current.push(wallet);
        groups.set(root, current);
    });

    return [...groups.values()].filter((group) => group.length >= 2);
}

function strongestTier(tiers: EvidenceTier[]) {
    if (tiers.includes('TIER_1')) return 'TIER_1';
    if (tiers.includes('TIER_2')) return 'TIER_2';
    return 'TIER_3';
}

function tierLabel(tier: EvidenceTier): ForensicWalletCluster['userEvidenceLabel'] {
    if (tier === 'TIER_1') return 'Proven Connection';
    if (tier === 'TIER_2') return 'Strong Indicator';
    return 'Moderate Signal';
}

function buildCoordinatedWalletUnion(args: {
    walletClusters: ForensicWalletCluster[];
    fundingEdges: Array<{ sourceWallet: string; targetWallet: string }>;
    transferEdges: Array<{ sourceWallet: string; targetWallet: string }>;
    connectorEdges: Array<{ from: string; to: string }>;
    secondHopConnectorEdges: Array<{ from: string; to: string }>;
}) {
    return dedupe([
        ...args.walletClusters.flatMap((cluster) => cluster.wallets),
        ...args.fundingEdges.flatMap((edge) => [edge.sourceWallet, edge.targetWallet]),
        ...args.transferEdges.flatMap((edge) => [edge.sourceWallet, edge.targetWallet]),
        ...args.connectorEdges.flatMap((edge) => [edge.from, edge.to]),
        ...args.secondHopConnectorEdges.flatMap((edge) => [edge.from, edge.to])
    ]);
}

type GraphFundingLinkCandidate = Pick<ForensicGraphEdge, 'sourceWallet' | 'targetWallet' | 'relationshipType' | 'displayLabel' | 'strengthScore'> & {
    priority: number;
};

function selectBestGraphFundingLinks(args: {
    trackedWallets: string[];
    fundingEdges: Array<{ sourceWallet: string; targetWallet: string; count: number }>;
    transferEdges: Array<{ sourceWallet: string; targetWallet: string; count: number }>;
    connectorEdges: Array<{ from: string; to: string; connector: string; strength: number }>;
    secondHopConnectorEdges: Array<{ from: string; to: string; source: string; strength: number }>;
}) {
    const trackedWalletSet = new Set(args.trackedWallets);
    const bestByTarget = new Map<string, GraphFundingLinkCandidate>();

    const consider = (candidate: GraphFundingLinkCandidate) => {
        if (
            candidate.sourceWallet === candidate.targetWallet ||
            !trackedWalletSet.has(candidate.targetWallet) ||
            !isLikelySolanaAddress(candidate.sourceWallet)
        ) {
            return;
        }

        const existing = bestByTarget.get(candidate.targetWallet);
        if (
            !existing ||
            candidate.priority > existing.priority ||
            (candidate.priority === existing.priority && candidate.strengthScore > existing.strengthScore)
        ) {
            bestByTarget.set(candidate.targetWallet, candidate);
        }
    };

    args.fundingEdges.forEach((edge) => {
        consider({
            sourceWallet: edge.sourceWallet,
            targetWallet: edge.targetWallet,
            relationshipType: 'funding',
            displayLabel: 'Direct funding source',
            strengthScore: Math.min(1, 0.56 + edge.count * 0.12),
            priority: 4
        });
    });

    const connectorLinks = new Map<string, GraphFundingLinkCandidate>();
    const addConnectorLink = (
        sourceWallet: string,
        targetWallet: string,
        displayLabel: string,
        strengthScore: number,
        priority: number
    ) => {
        const key = `${sourceWallet}:${targetWallet}:${displayLabel}`;
        const existing = connectorLinks.get(key);
        if (!existing || strengthScore > existing.strengthScore) {
            connectorLinks.set(key, {
                sourceWallet,
                targetWallet,
                relationshipType: 'funding',
                displayLabel,
                strengthScore,
                priority
            });
        }
    };

    args.connectorEdges.forEach((edge) => {
        addConnectorLink(edge.connector, edge.from, `Shared funder ${walletShort(edge.connector)}`, edge.strength, 2);
        addConnectorLink(edge.connector, edge.to, `Shared funder ${walletShort(edge.connector)}`, edge.strength, 2);
    });

    args.secondHopConnectorEdges.forEach((edge) => {
        addConnectorLink(edge.source, edge.from, `2-hop funding source ${walletShort(edge.source)}`, edge.strength, 1);
        addConnectorLink(edge.source, edge.to, `2-hop funding source ${walletShort(edge.source)}`, edge.strength, 1);
    });

    connectorLinks.forEach(consider);

    args.transferEdges.forEach((edge) => {
        consider({
            sourceWallet: edge.sourceWallet,
            targetWallet: edge.targetWallet,
            relationshipType: 'transfer',
            displayLabel: 'Transfer source',
            strengthScore: Math.min(1, 0.38 + edge.count * 0.1),
            priority: 0
        });
    });

    return [...bestByTarget.values()];
}

export async function analyzeAlchemyHubToken(tokenAddress: string): Promise<ForensicBundleReport> {
    const normalizedAddress = tokenAddress.trim();
    if (!isLikelySolanaAddress(normalizedAddress)) {
        throw new Error('The provided value is not a valid Solana contract address.');
    }

    const [metadata, largestAccounts, mintAccounts, tokenTransactions] = await Promise.all([
        fetchTokenMetadata(normalizedAddress),
        fetchTokenLargestAccounts(normalizedAddress),
        fetchAlchemyMintAccounts(normalizedAddress),
        fetchRecentTokenTransactions(normalizedAddress)
    ]);

    const balancesByWallet = new Map<string, bigint>();
    for (const account of mintAccounts) {
        balancesByWallet.set(account.owner, (balancesByWallet.get(account.owner) || 0n) + parseBigIntLike(account.amount));
    }

    const trackedWallets = [...balancesByWallet.entries()]
        .sort((left, right) => Number(right[1] - left[1]))
        .slice(0, MAX_RENDER_WALLETS)
        .map(([wallet]) => wallet);
    const trackedWalletSet = new Set(trackedWallets);

    const holderHistoryWallets = trackedWallets.slice(0, HOLDER_HISTORY_WALLETS);
    const holderTransactions = await mapWithConcurrency(holderHistoryWallets, 8, async (wallet) => ({
        wallet,
        transactions: await fetchWalletTransactions(wallet)
    }));
    const holderTransactionsByWallet = new Map(holderTransactions.map((entry) => [entry.wallet, entry.transactions]));
    const walletCounterparties = buildWalletCounterpartyMap(holderTransactionsByWallet, trackedWalletSet);
    const firstHopConnectors = rankFirstHopConnectors(walletCounterparties, trackedWalletSet)
        .slice(0, FIRST_HOP_CONNECTOR_LIMIT);
    const connectorHistoryWallets = firstHopConnectors
        .filter((entry) => entry.walletCount >= 2 || entry.count >= 2)
        .slice(0, CONNECTOR_HISTORY_WALLETS)
        .map((entry) => entry.connector);
    const connectorTransactions = await mapWithConcurrency(connectorHistoryWallets, 6, async (wallet) => ({
        wallet,
        transactions: await fetchWalletTransactions(wallet, CONNECTOR_HISTORY_SIGNATURE_LIMIT)
    }));
    const connectorTransactionsByWallet = new Map(connectorTransactions.map((entry) => [entry.wallet, entry.transactions]));

    const allTransactions = [
        ...tokenTransactions,
        ...holderTransactions.flatMap((entry) => entry.transactions),
        ...connectorTransactions.flatMap((entry) => entry.transactions)
    ];
    const txMap = new Map<string, ParsedTransaction>();
    allTransactions.forEach((transaction) => {
        const txHash = getTxHash(transaction);
        if (txHash) {
            txMap.set(txHash, transaction);
        }
    });
    const uniqueTransactions = [...txMap.values()];

    const fundingEdges = extractFundingEdges(uniqueTransactions, trackedWalletSet);
    const transferEdges = extractMintTransferEdges(normalizedAddress, uniqueTransactions, trackedWalletSet);
    const connectorEdges = buildSharedConnectorEdges(holderTransactionsByWallet, trackedWalletSet);
    const secondHopConnectorEdges = buildSecondHopConnectorEdges(
        walletCounterparties,
        connectorTransactionsByWallet,
        trackedWalletSet
    );

    const componentEdges = [
        ...fundingEdges.map((edge) => ({ from: edge.sourceWallet, to: edge.targetWallet })),
        ...transferEdges.map((edge) => ({ from: edge.sourceWallet, to: edge.targetWallet })),
        ...connectorEdges.map((edge) => ({ from: edge.from, to: edge.to })),
        ...secondHopConnectorEdges.map((edge) => ({ from: edge.from, to: edge.to }))
    ];
    const components = buildComponents(trackedWallets, componentEdges);

    const clusterIdByWallet = new Map<string, string>();
    const walletClusters: ForensicWalletCluster[] = components.map((wallets, index) => {
        const clusterId = `alchemy-cluster-${index + 1}`;
        wallets.forEach((wallet) => clusterIdByWallet.set(wallet, clusterId));
        const supplyRaw = wallets.reduce((sum, wallet) => sum + (balancesByWallet.get(wallet) || 0n), 0n);
        const evidenceTiers: EvidenceTier[] = [];
        const corroboratingSignals: string[] = [];
        const directFundingEdges = fundingEdges.filter((edge) => wallets.includes(edge.sourceWallet) && wallets.includes(edge.targetWallet));
        const directTransferEdges = transferEdges.filter((edge) => wallets.includes(edge.sourceWallet) && wallets.includes(edge.targetWallet));
        const sharedConnectors = connectorEdges.filter((edge) => wallets.includes(edge.from) && wallets.includes(edge.to));
        const sharedSecondHopSources = secondHopConnectorEdges.filter((edge) => wallets.includes(edge.from) && wallets.includes(edge.to));

        if (directFundingEdges.length >= 2) {
            evidenceTiers.push('TIER_1');
            corroboratingSignals.push(`${directFundingEdges.length} direct funding links`);
        } else if (directFundingEdges.length === 1) {
            evidenceTiers.push('TIER_2');
            corroboratingSignals.push('1 direct funding link');
        }
        if (sharedConnectors.length) {
            evidenceTiers.push('TIER_2');
            corroboratingSignals.push(`${dedupe(sharedConnectors.map((edge) => edge.connector)).length} shared connector wallets`);
        }
        if (sharedSecondHopSources.length) {
            evidenceTiers.push('TIER_2');
            corroboratingSignals.push(`${dedupe(sharedSecondHopSources.map((edge) => edge.source)).length} shared 2-hop funding sources`);
        }
        if (directTransferEdges.length) {
            evidenceTiers.push('TIER_2');
            corroboratingSignals.push(`${directTransferEdges.length} direct token transfer links`);
        }
        if (!evidenceTiers.length) {
            evidenceTiers.push('TIER_3');
        }

        const tier = strongestTier(evidenceTiers);
        const reason = directFundingEdges.length >= 2
            ? 'This holder group is tied together by multiple direct funding edges in the recent Alchemy history window.'
            : sharedConnectors.length
                ? 'This holder group repeatedly converges through shared connector wallets in recent history.'
                : sharedSecondHopSources.length
                    ? 'This holder group shares second-hop funding sources discovered through connector-wallet expansion.'
                : directTransferEdges.length
                    ? 'This holder group is linked by recent direct token-transfer behavior.'
                    : 'This holder group forms a bounded component inside the Alchemy holder graph.';

        return {
            clusterId,
            clusterName: `Alchemy Cluster ${index + 1}`,
            evidenceTier: tier,
            userEvidenceLabel: tierLabel(tier),
            walletCount: wallets.length,
            supplyHeldPct: calculatePct(supplyRaw, metadata.totalSupplyRaw),
            supplyHeldTokens: supplyRaw.toString(),
            whyGrouped: reason,
            corroboratingSignals,
            wallets,
            walletDetails: wallets.map((wallet) => ({
                walletAddress: wallet,
                currentHoldingsTokens: (balancesByWallet.get(wallet) || 0n).toString(),
                currentHoldingsPct: calculatePct(balancesByWallet.get(wallet) || 0n, metadata.totalSupplyRaw),
                flagReason: reason
            }))
        };
    });

    const clusterWalletUnion = dedupe(walletClusters.flatMap((cluster) => cluster.wallets));
    const coordinatedWalletUnion = buildCoordinatedWalletUnion({
        walletClusters,
        fundingEdges,
        transferEdges,
        connectorEdges,
        secondHopConnectorEdges
    });
    const sumWalletBalances = (wallets: string[]) =>
        wallets.reduce((sum, wallet) => sum + (balancesByWallet.get(wallet) || 0n), 0n);
    const clusteredRaw = sumWalletBalances(clusterWalletUnion);
    const coordinatedRaw = sumWalletBalances(coordinatedWalletUnion);
    const divisor = 10 ** metadata.decimals;
    const toUsd = (amount: bigint) =>
        metadata.currentPriceUsd === null
            ? null
            : round((Number(amount) / divisor) * metadata.currentPriceUsd, 2);

    const graphNodes: ForensicGraphNode[] = trackedWallets.map((wallet) => {
        const amount = balancesByWallet.get(wallet) || 0n;
        const clusterId = clusterIdByWallet.get(wallet) || null;
        return {
            walletAddress: wallet,
            label: walletShort(wallet),
            clusterId,
            role: clusterId ? 'cluster_core' : 'independent',
            currentHoldingsTokens: amount.toString(),
            currentHoldingsPct: calculatePct(amount, metadata.totalSupplyRaw),
            flagReason: clusterId
                ? 'Included in the bounded Alchemy cluster map.'
                : 'Visible as an independent top holder outside the current Alchemy cluster threshold.'
        };
    });

    const graphFundingLinks = selectBestGraphFundingLinks({
        trackedWallets,
        fundingEdges,
        transferEdges,
        connectorEdges,
        secondHopConnectorEdges
    });
    const graphNodeAddresses = new Set(graphNodes.map((node) => node.walletAddress));
    const graphSourceNodes: ForensicGraphNode[] = dedupe(graphFundingLinks.map((edge) => edge.sourceWallet))
        .filter((wallet) => !graphNodeAddresses.has(wallet))
        .map((wallet) => ({
            walletAddress: wallet,
            label: walletShort(wallet),
            clusterId: null,
            role: 'network_linked',
            currentHoldingsTokens: '0',
            currentHoldingsPct: 0,
            flagReason: 'Funding source linked to one or more visible holders.'
        }));

    graphSourceNodes.forEach((node) => graphNodeAddresses.add(node.walletAddress));

    const graphEdges: ForensicGraphEdge[] = graphFundingLinks
        .filter((edge) => graphNodeAddresses.has(edge.sourceWallet) && graphNodeAddresses.has(edge.targetWallet))
        .map((edge, index) => ({
            edgeId: `alchemy-funding-source-${index + 1}`,
            sourceWallet: edge.sourceWallet,
            targetWallet: edge.targetWallet,
            relationshipType: edge.relationshipType,
            displayLabel: edge.displayLabel,
            strengthScore: edge.strengthScore
        }));

    const graphClusters: ForensicGraphCluster[] = walletClusters.map((cluster) => ({
        clusterId: cluster.clusterId,
        clusterName: cluster.clusterName,
        walletCount: cluster.walletCount,
        supplyHeldPct: cluster.supplyHeldPct,
        tier: cluster.evidenceTier
    }));

    const top10Pct = largestAccounts
        .slice(0, 10)
        .reduce((sum, account) => sum + calculatePct(parseRawAmount(account.amount), metadata.totalSupplyRaw), 0);
    const top20Pct = largestAccounts
        .slice(0, 20)
        .reduce((sum, account) => sum + calculatePct(parseRawAmount(account.amount), metadata.totalSupplyRaw), 0);

    return {
        tokenAddress: normalizedAddress,
        tokenName: metadata.name,
        tokenSymbol: metadata.symbol,
        tokenDecimals: metadata.decimals,
        analysisTimestamp: new Date().toISOString(),
        launchTimestamp: metadata.launchTimestamp,
        implementationMode: 'live',
        launchSummary: {
            earliestObservedSlot: tokenTransactions[0]?.slot || null,
            launchBuyerCount: 0,
            blockZeroWallets: [],
            sniperWallets: [],
            launchBands: {
                block0Wallets: 0,
                block15Wallets: 0,
                block650Wallets: 0,
                block51PlusWallets: 0
            }
        },
        supplyAttribution: {
            deployerLinkedPct: 0,
            blockZeroPct: 0,
            sniperPct: 0,
            clusteredPct: calculatePct(clusteredRaw, metadata.totalSupplyRaw),
            networkLinkedPct: 0,
            remainingPct: calculatePct(metadata.totalSupplyRaw > coordinatedRaw ? metadata.totalSupplyRaw - coordinatedRaw : 0n, metadata.totalSupplyRaw),
            combinedCoordinatedPct: calculatePct(coordinatedRaw, metadata.totalSupplyRaw),
            estimatedClusterValueUsd: toUsd(clusteredRaw),
            estimatedCombinedValueUsd: toUsd(coordinatedRaw)
        },
        holderConcentration: {
            top10Pct: round(top10Pct, 2),
            top20Pct: round(top20Pct, 2)
        },
        bundleInsights: {
            inferredBundleCount: 0,
            blockZeroBundleClusterCount: 0,
            maxTrackedHops: 2,
            trackedHopDepth: 2,
            evidenceByTier: {
                tier1: walletClusters.filter((cluster) => cluster.evidenceTier === 'TIER_1').length,
                tier2: walletClusters.filter((cluster) => cluster.evidenceTier === 'TIER_2').length,
                tier3: walletClusters.filter((cluster) => cluster.evidenceTier === 'TIER_3').length
            }
        },
        scanStats: {
            walletsExpanded: trackedWallets.length,
            transactionsDecoded: uniqueTransactions.length,
            hopWalletCounts: [
                trackedWallets.length,
                firstHopConnectors.length,
                connectorHistoryWallets.length
            ],
            usedHeliusHistory: false,
            usedWalletApi: false,
            historySource: 'signature_paging',
            coverageLevel: mintAccounts.length > 0 ? 'full' : 'degraded_history'
        },
        walletClusters,
        ecosystemGraph: {
            nodes: [...graphNodes, ...graphSourceNodes],
            edges: graphEdges,
            clusters: graphClusters
        },
        evidenceHighlights: [],
        notes: [
            'Alchemy Hub runs on a separate Alchemy-first cluster-map engine from Bubble Maps and Safe Scan.',
            'It uses Alchemy account scans, recent holder history, and bounded 2-hop connector discovery to build the map.',
            'Safe Scan remains the deeper multi-hop forensic engine when you need full launch and bundle attribution.'
        ]
    };
}
