// Forensic analysis helper for SafeScan intelligence workflows.
import { APP_CONFIG } from '../../config';
import { buildBundleIntelligence, calculateRetentionPct } from './bundle-intelligence';
import type { AlchemyHubScanDepth } from './alchemy-hub-chains';
import type {
    EvidenceTier,
    ForensicBundleReport,
    ForensicGraphCluster,
    ForensicGraphEdge,
    ForensicGraphNode,
    ForensicWalletCluster
} from './types';
import { EVM_ALCHEMY_NETWORK_BY_CHAIN, type AlchemyHubChain } from './alchemy-hub-chains';
import type { MoralisTopHolder } from './moralis-top-holders';

type EvmChain = Exclude<AlchemyHubChain, 'solana'>;

const RPC_TIMEOUT_MS = 14_000;
const DEXSCREENER_TIMEOUT_MS = 6_000;
const TRANSFER_PAGE_LIMIT = 6;
const TOKEN_TRANSFER_PAGE_SIZE = '0x3e8';
const MAX_TRACKED_WALLETS = 300;
const MAX_BALANCE_WALLETS = 440;
const FUNDING_HISTORY_WALLETS = 140;
const FUNDING_TRANSFER_LIMIT = '0x28';
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
const LAUNCH_COHORT_BLOCK_SPAN = 3;
const LAUNCH_COHORT_LAST_OFFSET = LAUNCH_COHORT_BLOCK_SPAN - 1;
const MAX_RISK_ELIGIBLE_SHARED_FUNDER_WALLETS = 4;
const EVM_TOKEN0_SELECTOR = '0x0dfe1681';
const EVM_TOKEN1_SELECTOR = '0xd21220a7';

const KNOWN_EVM_PUBLIC_CONNECTORS: Partial<Record<EvmChain, Record<string, string>>> = {
    eth: {
        '0x7a250d5630b4cf539739df2c5dacb4c659f2488d': 'Uniswap V2 Router',
        '0xe592427a0aece92de3edee1f18e0157c05861564': 'Uniswap V3 SwapRouter',
        '0xef1c6e67703c7bd7107eed8303fbe6ec2554bf6b': 'Uniswap Universal Router',
        '0x1111111254eeb25477b68fb85ed929f73a960582': '1inch Aggregation Router',
        '0xdef1c0ded9bec7f1a1670819833240f027b25eff': '0x Exchange Proxy',
        '0x9008d19f58aabd9ed0d60971565aa8510560ab41': 'CoW Protocol Settlement',
        '0xdef171fe48cf0115b1d80b88dc8eab59176fee57': 'ParaSwap Augustus'
    },
    base: {
        '0x2626664c2603336e57b271c5c0b26f421741e481': 'Uniswap V3 SwapRouter',
        '0x6ff5693b99212da76ad316178a184ab56d299b43': 'Uniswap Universal Router',
        '0x198ef79f1f515f02dfe9e3115ed9fc07183f02fc': '1inch Aggregation Router'
    },
    bsc: {
        '0x10ed43c718714eb63d5aa57b78b54704e256024e': 'PancakeSwap V2 Router',
        '0x13f4ea83d0bd40e75c8222255bc855a974568dd4': 'PancakeSwap V3 Router',
        '0x1111111254eeb25477b68fb85ed929f73a960582': '1inch Aggregation Router'
    }
};

type AlchemyHubEvmLimits = {
    transferPageLimit: number;
    maxTrackedWallets: number;
    maxBalanceWallets: number;
    fundingHistoryWallets: number;
    fundingTransferLimit: string;
};

const EVM_LIMITS: Record<AlchemyHubScanDepth, AlchemyHubEvmLimits> = {
    balanced: {
        transferPageLimit: TRANSFER_PAGE_LIMIT,
        maxTrackedWallets: MAX_TRACKED_WALLETS,
        maxBalanceWallets: MAX_BALANCE_WALLETS,
        fundingHistoryWallets: FUNDING_HISTORY_WALLETS,
        fundingTransferLimit: FUNDING_TRANSFER_LIMIT
    },
    deep: {
        transferPageLimit: 32,
        maxTrackedWallets: 1200,
        maxBalanceWallets: 4000,
        fundingHistoryWallets: 1000,
        fundingTransferLimit: '0xa0'
    }
};

type AlchemyHubEvmAnalysisOptions = {
    depth?: AlchemyHubScanDepth;
    holderSeeds?: MoralisTopHolder[];
    seedOnly?: boolean;
};

type AlchemyRpcPayload<T> = {
    result?: T;
    error?: {
        message?: string;
    };
};

type AlchemyTokenMetadata = {
    name?: string | null;
    symbol?: string | null;
    decimals?: number | null;
    logo?: string | null;
};

type AlchemyTokenBalanceResponse = {
    tokenBalances?: Array<{
        contractAddress?: string;
        tokenBalance?: string | null;
        error?: string | null;
    }>;
};

type AlchemyTransfer = {
    blockNum?: string;
    hash?: string;
    from?: string;
    to?: string;
    value?: number | string | null;
    asset?: string | null;
    category?: string;
    metadata?: {
        blockTimestamp?: string;
    };
    rawContract?: {
        address?: string;
        value?: string | null;
        decimal?: string | null;
    };
};

type AssetTransferResponse = {
    transfers?: AlchemyTransfer[];
    pageKey?: string;
};

type TransferEdge = {
    sourceWallet: string;
    targetWallet: string;
    amount: bigint;
    count: number;
};

type PublicEvmConnectorDecision = {
    address: string;
    excluded: boolean;
    category: 'known_public_infra' | 'token_contract' | 'dex_pool_or_pair';
    reason: string;
};

type FundingEdge = {
    sourceWallet: string;
    targetWallet: string;
    amountWei: bigint;
    count: number;
};

type SharedFunderEdge = {
    from: string;
    to: string;
    funder: string;
    strength: number;
    decisionClass: 'risk_eligible' | 'high_degree_noisy';
    riskEligible: boolean;
    reason: string;
};

type SharedFunderEdgeResult = {
    edges: SharedFunderEdge[];
    excludedFunders: string[];
};

type GraphFundingLinkCandidate = Pick<ForensicGraphEdge, 'sourceWallet' | 'targetWallet' | 'relationshipType' | 'displayLabel' | 'strengthScore'> & {
    priority: number;
};

function isLikelyEvmAddress(value: string) {
    return /^0x[a-fA-F0-9]{40}$/.test(value.trim());
}

function normalizeAddress(value: string) {
    return value.trim().toLowerCase();
}

function parseBlockNum(value?: string) {
    if (!value) return null;
    const parsed = Number.parseInt(value, value.startsWith('0x') ? 16 : 10);
    return Number.isFinite(parsed) ? parsed : null;
}

function walletShort(address: string) {
    return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function dedupe<T>(values: T[]) {
    return [...new Set(values)];
}

function round(value: number, digits = 2) {
    const factor = 10 ** digits;
    return Math.round(value * factor) / factor;
}

function parseHexQuantity(value: string | null | undefined) {
    if (!value || value === '0x') return 0n;
    try {
        return BigInt(value);
    } catch {
        return 0n;
    }
}

function parseAddressFromEthCall(result: string | null | undefined) {
    const normalized = (result || '').toLowerCase();
    if (!/^0x[0-9a-f]{64}$/.test(normalized)) return '';
    return normalizeAddress(`0x${normalized.slice(-40)}`);
}

function parseRawTokenAmount(transfer: AlchemyTransfer, decimals: number) {
    const raw = parseHexQuantity(transfer.rawContract?.value);
    if (raw > 0n) return raw;
    const numeric = Number(transfer.value || 0);
    if (!Number.isFinite(numeric) || numeric <= 0) return 0n;
    return BigInt(Math.trunc(numeric * (10 ** Math.min(decimals, 18))));
}

function calculatePct(rawAmount: bigint, totalSupply: bigint) {
    if (totalSupply <= 0n || rawAmount <= 0n) return 0;
    return Number((rawAmount * 100000000n) / totalSupply) / 1000000;
}

function toTokenNumber(rawAmount: bigint, decimals: number) {
    const divisor = 10 ** decimals;
    if (!Number.isFinite(divisor) || divisor <= 0) return Number(rawAmount);
    return Number(rawAmount) / divisor;
}

function classifyEvmSharedFunder(linkedWalletCount: number) {
    if (linkedWalletCount > MAX_RISK_ELIGIBLE_SHARED_FUNDER_WALLETS) {
        return {
            decisionClass: 'high_degree_noisy' as const,
            riskEligible: false,
            reason: `High-degree native funder touching ${linkedWalletCount} tracked holders; kept as context only.`
        };
    }

    return {
        decisionClass: 'high_degree_noisy' as const,
        riskEligible: false,
        reason: 'Shared external native funders are excluded from lite-scan clustering until provider labels confirm they are private wallets.'
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
    } finally {
        globalThis.clearTimeout(timeoutId);
    }
}

function evmEndpoint(chain: EvmChain) {
    if (!APP_CONFIG.alchemyKey) {
        throw new Error('Alchemy Hub EVM support is not configured because the Alchemy key is missing.');
    }
    return `https://${EVM_ALCHEMY_NETWORK_BY_CHAIN[chain]}.g.alchemy.com/v2/${APP_CONFIG.alchemyKey}`;
}

async function evmRpc<T>(chain: EvmChain, method: string, params: unknown[]): Promise<T> {
    const response = await fetchJsonWithTimeout(evmEndpoint(chain), {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            jsonrpc: '2.0',
            id: `alchemy-hub-evm-${method}`,
            method,
            params
        })
    });

    if (!response.ok) {
        const message = await response.text().catch(() => '');
        throw new Error(message || `Alchemy EVM RPC ${method} failed with status ${response.status}`);
    }

    const payload = await response.json() as AlchemyRpcPayload<T>;
    if (payload.error) {
        throw new Error(payload.error.message || `Alchemy EVM RPC ${method} failed.`);
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

async function fetchDexScreenerMarketData(chain: EvmChain, tokenAddress: string) {
    const dexChainById: Record<EvmChain, string> = {
        eth: 'ethereum',
        base: 'base',
        bsc: 'bsc',
        polygon: 'polygon',
        arbitrum: 'arbitrum',
        optimism: 'optimism'
    };

    try {
        const response = await fetchJsonWithTimeout(
            `https://api.dexscreener.com/tokens/v1/${dexChainById[chain]}/${tokenAddress}`,
            {},
            DEXSCREENER_TIMEOUT_MS
        );
        if (!response.ok) return { currentPriceUsd: null, marketCapUsd: null };

        const pairs = await response.json() as Array<{
            baseToken?: { address?: string };
            liquidity?: { usd?: number | null };
            priceUsd?: string | null;
            marketCap?: number | null;
            fdv?: number | null;
        }>;
        const normalized = normalizeAddress(tokenAddress);
        const candidate = pairs
            .filter((pair) => normalizeAddress(pair.baseToken?.address || '') === normalized)
            .sort((left, right) => (right.liquidity?.usd || 0) - (left.liquidity?.usd || 0))[0];

        const price = candidate?.priceUsd ? Number(candidate.priceUsd) : null;
        return {
            currentPriceUsd: price !== null && Number.isFinite(price) ? price : null,
            marketCapUsd: candidate?.marketCap || candidate?.fdv || null
        };
    } catch {
        return { currentPriceUsd: null, marketCapUsd: null };
    }
}

async function fetchEvmMetadata(chain: EvmChain, tokenAddress: string) {
    const [metadata, totalSupplyResult, dexFallback] = await Promise.all([
        evmRpc<AlchemyTokenMetadata>(chain, 'alchemy_getTokenMetadata', [tokenAddress]).catch(() => null),
        evmRpc<string>(chain, 'eth_call', [{
            to: tokenAddress,
            data: '0x18160ddd'
        }, 'latest']).catch(() => '0x0'),
        fetchDexScreenerMarketData(chain, tokenAddress)
    ]);

    const decimals = Number(metadata?.decimals || 18);
    return {
        name: metadata?.name || 'Unknown EVM Token',
        symbol: metadata?.symbol || 'UNKNOWN',
        decimals: Number.isFinite(decimals) ? decimals : 18,
        totalSupplyRaw: parseHexQuantity(totalSupplyResult),
        currentPriceUsd: dexFallback.currentPriceUsd,
        marketCapUsd: dexFallback.marketCapUsd,
        launchTimestamp: new Date().toISOString()
    };
}

async function fetchAssetTransfers(chain: EvmChain, params: Record<string, unknown>, maxPages = TRANSFER_PAGE_LIMIT) {
    const transfers: AlchemyTransfer[] = [];
    let pageKey: string | undefined;
    let page = 0;

    while (page < maxPages) {
        const result = await evmRpc<AssetTransferResponse>(chain, 'alchemy_getAssetTransfers', [{
            ...params,
            pageKey
        }]).catch(() => null);

        transfers.push(...(result?.transfers || []));
        if (!result?.pageKey || (result.transfers || []).length === 0) break;
        pageKey = result.pageKey;
        page += 1;
    }

    return transfers;
}

async function fetchTokenTransfers(chain: EvmChain, tokenAddress: string, maxPages = TRANSFER_PAGE_LIMIT) {
    return fetchAssetTransfers(chain, {
        fromBlock: '0x0',
        toBlock: 'latest',
        order: 'desc',
        category: ['erc20'],
        contractAddresses: [tokenAddress],
        withMetadata: true,
        excludeZeroValue: true,
        maxCount: TOKEN_TRANSFER_PAGE_SIZE
    }, maxPages);
}

async function fetchIncomingNativeTransfers(chain: EvmChain, wallet: string, maxCount = FUNDING_TRANSFER_LIMIT) {
    return fetchAssetTransfers(chain, {
        fromBlock: '0x0',
        toBlock: 'latest',
        order: 'desc',
        category: ['external', 'internal'],
        toAddress: wallet,
        withMetadata: true,
        excludeZeroValue: true,
        maxCount
    }, 1);
}

async function fetchBalances(chain: EvmChain, tokenAddress: string, wallets: string[]) {
    const entries = await mapWithConcurrency(wallets, 8, async (wallet) => {
        const result = await evmRpc<AlchemyTokenBalanceResponse>(chain, 'alchemy_getTokenBalances', [
            wallet,
            [tokenAddress]
        ]).catch(() => null);
        const balance = parseHexQuantity(result?.tokenBalances?.[0]?.tokenBalance);
        return [wallet, balance] as const;
    });

    return new Map(entries);
}

async function classifyEvmPublicConnectors(chain: EvmChain, tokenAddress: string, addresses: string[]) {
    const token = normalizeAddress(tokenAddress);
    const knownConnectors = KNOWN_EVM_PUBLIC_CONNECTORS[chain] || {};
    const uniqueAddresses = dedupe(addresses.map(normalizeAddress).filter(isLikelyEvmAddress));
    const entries = await mapWithConcurrency(uniqueAddresses, 8, async (address) => {
        if (address === token) {
            return [address, {
                address,
                excluded: true,
                category: 'token_contract',
                reason: 'Token contract address excluded from connector-based clustering.'
            } satisfies PublicEvmConnectorDecision] as const;
        }

        const knownLabel = knownConnectors[address];
        if (knownLabel) {
            return [address, {
                address,
                excluded: true,
                category: 'known_public_infra',
                reason: `${knownLabel} excluded as known public market infrastructure.`
            } satisfies PublicEvmConnectorDecision] as const;
        }

        const code = await evmRpc<string>(chain, 'eth_getCode', [address, 'latest']).catch(() => '0x');
        if (!code || code === '0x') return [address, null] as const;

        const [token0Result, token1Result] = await Promise.all([
            evmRpc<string>(chain, 'eth_call', [{ to: address, data: EVM_TOKEN0_SELECTOR }, 'latest']).catch(() => null),
            evmRpc<string>(chain, 'eth_call', [{ to: address, data: EVM_TOKEN1_SELECTOR }, 'latest']).catch(() => null)
        ]);
        const token0 = parseAddressFromEthCall(token0Result);
        const token1 = parseAddressFromEthCall(token1Result);
        if (token0 && token1 && (token0 === token || token1 === token)) {
            return [address, {
                address,
                excluded: true,
                category: 'dex_pool_or_pair',
                reason: 'DEX pair/pool contract excluded from token-transfer clustering.'
            } satisfies PublicEvmConnectorDecision] as const;
        }

        return [address, null] as const;
    });

    return new Map(entries.filter((entry): entry is [string, PublicEvmConnectorDecision] => Boolean(entry[1])));
}

function buildTransferEdges(transfers: AlchemyTransfer[], decimals: number, trackedWallets: Set<string>) {
    const edges = new Map<string, TransferEdge>();
    transfers.forEach((transfer) => {
        const sourceWallet = normalizeAddress(transfer.from || '');
        const targetWallet = normalizeAddress(transfer.to || '');
        if (
            !isLikelyEvmAddress(sourceWallet) ||
            !isLikelyEvmAddress(targetWallet) ||
            sourceWallet === ZERO_ADDRESS ||
            targetWallet === ZERO_ADDRESS ||
            sourceWallet === targetWallet ||
            !trackedWallets.has(sourceWallet) ||
            !trackedWallets.has(targetWallet)
        ) {
            return;
        }

        const key = [sourceWallet, targetWallet].sort().join(':');
        const current = edges.get(key) || {
            sourceWallet,
            targetWallet,
            amount: 0n,
            count: 0
        };
        current.amount += parseRawTokenAmount(transfer, decimals);
        current.count += 1;
        edges.set(key, current);
    });
    return [...edges.values()];
}

function filterPublicEvmTransferEdges(
    transferEdges: TransferEdge[],
    publicConnectorDecisions: Map<string, PublicEvmConnectorDecision>
) {
    const excludedByAddress = new Map<string, PublicEvmConnectorDecision>();
    const edges = transferEdges.filter((edge) => {
        const sourceDecision = publicConnectorDecisions.get(edge.sourceWallet);
        const targetDecision = publicConnectorDecisions.get(edge.targetWallet);
        const decision = sourceDecision || targetDecision;
        if (!decision?.excluded) return true;
        excludedByAddress.set(decision.address, decision);
        return false;
    });

    return { edges, excludedConnectors: [...excludedByAddress.values()] };
}

function buildFundingEdges(fundingTransfersByWallet: Map<string, AlchemyTransfer[]>, trackedWallets: Set<string>) {
    const edges = new Map<string, FundingEdge>();
    fundingTransfersByWallet.forEach((transfers, targetWallet) => {
        transfers.forEach((transfer) => {
            const sourceWallet = normalizeAddress(transfer.from || '');
            if (
                !isLikelyEvmAddress(sourceWallet) ||
                sourceWallet === ZERO_ADDRESS ||
                sourceWallet === targetWallet
            ) {
                return;
            }

            const key = `${sourceWallet}:${targetWallet}`;
            const current = edges.get(key) || {
                sourceWallet,
                targetWallet,
                amountWei: 0n,
                count: 0
            };
            current.amountWei += parseRawTokenAmount(transfer, 18);
            current.count += 1;
            edges.set(key, current);
        });
    });

    return [...edges.values()].filter((edge) => trackedWallets.has(edge.targetWallet));
}

function buildSharedFunderEdges(fundingEdges: FundingEdge[]): SharedFunderEdgeResult {
    const funderToWallets = new Map<string, Set<string>>();
    fundingEdges.forEach((edge) => {
        const wallets = funderToWallets.get(edge.sourceWallet) || new Set<string>();
        wallets.add(edge.targetWallet);
        funderToWallets.set(edge.sourceWallet, wallets);
    });

    const edges: SharedFunderEdge[] = [];
    const excludedFunders: string[] = [];
    funderToWallets.forEach((wallets, funder) => {
        const members = [...wallets];
        if (members.length < 2) return;
        const decision = classifyEvmSharedFunder(members.length);
        if (!decision.riskEligible) {
            excludedFunders.push(funder);
            return;
        }
        for (let index = 0; index < members.length; index += 1) {
            for (let inner = index + 1; inner < members.length; inner += 1) {
                edges.push({
                    from: members[index],
                    to: members[inner],
                    funder,
                    strength: Math.min(1, 0.42 + members.length * 0.08),
                    ...decision
                });
            }
        }
    });
    return { edges, excludedFunders };
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

function selectBestGraphFundingLinks(args: {
    trackedWallets: string[];
    fundingEdges: FundingEdge[];
    transferEdges: TransferEdge[];
    sharedFunderEdges: SharedFunderEdge[];
}) {
    const trackedWalletSet = new Set(args.trackedWallets);
    const bestByTarget = new Map<string, GraphFundingLinkCandidate>();

    const consider = (candidate: GraphFundingLinkCandidate) => {
        if (
            candidate.sourceWallet === candidate.targetWallet ||
            !trackedWalletSet.has(candidate.targetWallet) ||
            !isLikelyEvmAddress(candidate.sourceWallet)
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
            displayLabel: 'Native funding source',
            strengthScore: Math.min(1, 0.52 + edge.count * 0.12),
            priority: 4
        });
    });

    args.sharedFunderEdges.forEach((edge) => {
        const displayLabel = edge.riskEligible
            ? `Shared private funder ${walletShort(edge.funder)}`
            : `Context-only funder ${walletShort(edge.funder)}`;
        consider({
            sourceWallet: edge.funder,
            targetWallet: edge.from,
            relationshipType: 'funding',
            displayLabel,
            strengthScore: edge.strength,
            priority: edge.riskEligible ? 2 : -1
        });
        consider({
            sourceWallet: edge.funder,
            targetWallet: edge.to,
            relationshipType: 'funding',
            displayLabel,
            strengthScore: edge.strength,
            priority: edge.riskEligible ? 2 : -1
        });
    });

    args.transferEdges.forEach((edge) => {
        consider({
            sourceWallet: edge.sourceWallet,
            targetWallet: edge.targetWallet,
            relationshipType: 'transfer',
            displayLabel: 'ERC-20 transfer source',
            strengthScore: Math.min(1, 0.4 + edge.count * 0.1),
            priority: 1
        });
    });

    return [...bestByTarget.values()];
}

export async function analyzeAlchemyHubEvmToken(tokenAddress: string, chain: EvmChain, options: AlchemyHubEvmAnalysisOptions = {}): Promise<ForensicBundleReport> {
    const normalizedAddress = normalizeAddress(tokenAddress);
    const depth = options.depth === 'deep' ? 'deep' : 'balanced';
    const limits = EVM_LIMITS[depth];
    const holderSeedLimit = options.seedOnly && options.holderSeeds?.length
        ? options.holderSeeds.length
        : null;
    const maxBalanceWallets = holderSeedLimit ?? limits.maxBalanceWallets;
    const maxTrackedWallets = holderSeedLimit ? Math.min(250, holderSeedLimit) : limits.maxTrackedWallets;
    const fundingHistoryLimit = holderSeedLimit ? Math.min(100, holderSeedLimit) : limits.fundingHistoryWallets;
    if (!isLikelyEvmAddress(normalizedAddress)) {
        throw new Error('A valid EVM token contract address is required.');
    }

    const [metadata, tokenTransfers] = await Promise.all([
        fetchEvmMetadata(chain, normalizedAddress),
        fetchTokenTransfers(chain, normalizedAddress, limits.transferPageLimit)
    ]);

    const transferWallets = dedupe(tokenTransfers.flatMap((transfer) => [
        normalizeAddress(transfer.from || ''),
        normalizeAddress(transfer.to || '')
    ]).filter((wallet) => isLikelyEvmAddress(wallet) && wallet !== ZERO_ADDRESS));
    const moralisWallets = dedupe((options.holderSeeds || [])
        .map((seed) => normalizeAddress(seed.wallet))
        .filter((wallet) => isLikelyEvmAddress(wallet) && wallet !== ZERO_ADDRESS));

    const candidateWallets = (options.seedOnly && moralisWallets.length
        ? moralisWallets
        : dedupe([...moralisWallets, ...transferWallets])
    ).slice(0, maxBalanceWallets);
    const balancesByWallet = await fetchBalances(chain, normalizedAddress, candidateWallets);
    const trackedWallets = [...balancesByWallet.entries()]
        .filter(([, balance]) => balance > 0n)
        .sort((left, right) => left[1] === right[1] ? 0 : left[1] > right[1] ? -1 : 1)
        .slice(0, maxTrackedWallets)
        .map(([wallet]) => wallet);
    const trackedWalletSet = new Set(trackedWallets);

    const fundingWallets = trackedWallets.slice(0, fundingHistoryLimit);
    const fundingEntries = await mapWithConcurrency(fundingWallets, 6, async (wallet) => ({
        wallet,
        transfers: await fetchIncomingNativeTransfers(chain, wallet, limits.fundingTransferLimit)
    }));
    const fundingTransfersByWallet = new Map(fundingEntries.map((entry) => [entry.wallet, entry.transfers]));

    const transferEdgeCandidates = buildTransferEdges(tokenTransfers, metadata.decimals, trackedWalletSet);
    const transferConnectorCandidates = dedupe(transferEdgeCandidates.flatMap((edge) => [edge.sourceWallet, edge.targetWallet]));
    const publicConnectorDecisions = await classifyEvmPublicConnectors(chain, normalizedAddress, transferConnectorCandidates);
    const transferEdgeResult = filterPublicEvmTransferEdges(transferEdgeCandidates, publicConnectorDecisions);
    const transferEdges = transferEdgeResult.edges;
    const fundingEdges = buildFundingEdges(fundingTransfersByWallet, trackedWalletSet);
    const sharedFunderResult = buildSharedFunderEdges(fundingEdges);
    const sharedFunderEdges = sharedFunderResult.edges;
    const excludedConnectorCount = sharedFunderResult.excludedFunders.length + transferEdgeResult.excludedConnectors.length;
    const componentEdges = [
        ...transferEdges.map((edge) => ({ from: edge.sourceWallet, to: edge.targetWallet })),
        ...sharedFunderEdges.filter((edge) => edge.riskEligible).map((edge) => ({ from: edge.from, to: edge.to }))
    ];
    const components = buildComponents(trackedWallets, componentEdges);

    const clusterIdByWallet = new Map<string, string>();
    const walletClusters: ForensicWalletCluster[] = components.map((wallets, index) => {
        const clusterId = `evm-cluster-${index + 1}`;
        wallets.forEach((wallet) => clusterIdByWallet.set(wallet, clusterId));
        const supplyRaw = wallets.reduce((sum, wallet) => sum + (balancesByWallet.get(wallet) || 0n), 0n);
        const directTransferEdges = transferEdges.filter((edge) => wallets.includes(edge.sourceWallet) && wallets.includes(edge.targetWallet));
        const sharedFunders = sharedFunderEdges.filter((edge) => edge.riskEligible && wallets.includes(edge.from) && wallets.includes(edge.to));
        const evidenceTiers: EvidenceTier[] = [];
        const corroboratingSignals: string[] = [];

        if (directTransferEdges.length >= 2) {
            evidenceTiers.push('TIER_1');
            corroboratingSignals.push(`${directTransferEdges.length} ERC-20 transfer links`);
        } else if (directTransferEdges.length === 1) {
            evidenceTiers.push('TIER_2');
            corroboratingSignals.push('1 ERC-20 transfer link');
        }
        if (sharedFunders.length) {
            evidenceTiers.push('TIER_2');
            corroboratingSignals.push(`${dedupe(sharedFunders.map((edge) => edge.funder)).length} private-candidate shared native funder${dedupe(sharedFunders.map((edge) => edge.funder)).length === 1 ? '' : 's'}`);
        }
        if (!evidenceTiers.length) evidenceTiers.push('TIER_3');

        const tier = strongestTier(evidenceTiers);
        const reason = directTransferEdges.length
            ? 'These wallets have recently transferred this token between each other, suggesting coordinated holder activity.'
            : sharedFunders.length
                ? 'Multiple wallets appear to have been funded by the same private source wallet.'
                : 'These wallets form a connected holder group based on transfer and funding relationships.';

        return {
            clusterId,
            clusterName: `Holder Cluster ${index + 1}`,
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
    const coordinatedWalletUnion = dedupe([
        ...clusterWalletUnion,
        ...transferEdges.flatMap((edge) => [edge.sourceWallet, edge.targetWallet]),
        ...sharedFunderEdges.flatMap((edge) => [edge.from, edge.to])
    ]).filter((wallet) => trackedWalletSet.has(wallet));
    const sumWalletBalances = (wallets: string[]) =>
        wallets.reduce((sum, wallet) => sum + (balancesByWallet.get(wallet) || 0n), 0n);
    const clusteredRaw = sumWalletBalances(clusterWalletUnion);
    const coordinatedRaw = sumWalletBalances(coordinatedWalletUnion);
    const toUsd = (amount: bigint) =>
        metadata.currentPriceUsd === null
            ? null
            : round(toTokenNumber(amount, metadata.decimals) * metadata.currentPriceUsd, 2);

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
                ? 'This wallet is part of a connected holder cluster.'
                : 'This wallet is a major holder but is not strongly linked to the detected clusters.'
        };
    });

    const graphFundingLinks = selectBestGraphFundingLinks({
        trackedWallets,
        fundingEdges,
        transferEdges,
        sharedFunderEdges
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
            flagReason: 'Funding or transfer source linked to one or more visible EVM holders.'
        }));

    graphSourceNodes.forEach((node) => graphNodeAddresses.add(node.walletAddress));

    const graphEdges: ForensicGraphEdge[] = graphFundingLinks
        .filter((edge) => graphNodeAddresses.has(edge.sourceWallet) && graphNodeAddresses.has(edge.targetWallet))
        .map((edge, index) => ({
            edgeId: `evm-funding-source-${index + 1}`,
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

    const topBalances = [...balancesByWallet.values()]
        .filter((balance) => balance > 0n)
        .sort((left, right) => left === right ? 0 : left > right ? -1 : 1);
    const top10Pct = topBalances.slice(0, 10).reduce((sum, balance) => sum + calculatePct(balance, metadata.totalSupplyRaw), 0);
    const top20Pct = topBalances.slice(0, 20).reduce((sum, balance) => sum + calculatePct(balance, metadata.totalSupplyRaw), 0);
    const transfersByBlock = tokenTransfers
        .map((transfer) => ({ transfer, blockNumber: parseBlockNum(transfer.blockNum) }))
        .filter((entry): entry is { transfer: AlchemyTransfer; blockNumber: number } => entry.blockNumber !== null)
        .sort((left, right) => left.blockNumber - right.blockNumber);
    const earliestTransfer = transfersByBlock[0]?.transfer;
    const earliestBlock = transfersByBlock[0]?.blockNumber ?? null;
    const launchWindowTransfers = earliestBlock === null
        ? []
        : transfersByBlock.filter((entry) =>
            entry.blockNumber >= earliestBlock &&
            entry.blockNumber <= earliestBlock + LAUNCH_COHORT_LAST_OFFSET
        );
    const launchWindowWallets = dedupe(launchWindowTransfers
        .map((entry) => normalizeAddress(entry.transfer.to || ''))
        .filter((wallet) => isLikelyEvmAddress(wallet) && wallet !== ZERO_ADDRESS));
    const launchWindowWalletSet = new Set(launchWindowWallets);
    const launchWindowRaw = launchWindowWallets.reduce((sum, wallet) => sum + (balancesByWallet.get(wallet) || 0n), 0n);
    const launchWindowAcquiredRaw = launchWindowTransfers.reduce((sum, entry) => sum + parseRawTokenAmount(entry.transfer, metadata.decimals), 0n);
    const blockZeroBundleClusterCount = walletClusters.filter((cluster) =>
        cluster.wallets.filter((wallet) => launchWindowWalletSet.has(wallet)).length >= 2
    ).length;
    const evidenceByTier = {
        tier1: walletClusters.filter((cluster) => cluster.evidenceTier === 'TIER_1').length,
        tier2: walletClusters.filter((cluster) => cluster.evidenceTier === 'TIER_2').length,
        tier3: walletClusters.filter((cluster) => cluster.evidenceTier === 'TIER_3').length
    };
    const coverageLevel = trackedWallets.length > 0 ? 'full' : 'degraded_history';
    const bundleIntelligence = buildBundleIntelligence({
        walletsInvolved: launchWindowWallets.length,
        supplyControlledPct: calculatePct(launchWindowRaw, metadata.totalSupplyRaw),
        retentionPct: calculateRetentionPct(launchWindowAcquiredRaw, launchWindowRaw),
        inferredBundleCount: 0,
        insiderClusterCount: blockZeroBundleClusterCount,
        tier1EvidenceCount: evidenceByTier.tier1,
        tier2EvidenceCount: evidenceByTier.tier2,
        coverageLevel
    });

    return {
        tokenAddress: normalizedAddress,
        tokenName: metadata.name,
        tokenSymbol: metadata.symbol,
        tokenDecimals: metadata.decimals,
        analysisTimestamp: new Date().toISOString(),
        launchTimestamp: earliestTransfer?.metadata?.blockTimestamp || metadata.launchTimestamp,
        implementationMode: 'live',
        launchSummary: {
            earliestObservedSlot: earliestBlock,
            launchBuyerCount: launchWindowWallets.length,
            blockZeroWallets: launchWindowWallets,
            sniperWallets: launchWindowWallets,
            launchBands: {
                block0Wallets: earliestBlock === null
                    ? 0
                    : dedupe(launchWindowTransfers
                        .filter((entry) => entry.blockNumber === earliestBlock)
                        .map((entry) => normalizeAddress(entry.transfer.to || ''))
                        .filter((wallet) => isLikelyEvmAddress(wallet) && wallet !== ZERO_ADDRESS)).length,
                block15Wallets: earliestBlock === null
                    ? 0
                    : dedupe(launchWindowTransfers
                        .filter((entry) => entry.blockNumber > earliestBlock)
                        .map((entry) => normalizeAddress(entry.transfer.to || ''))
                        .filter((wallet) => isLikelyEvmAddress(wallet) && wallet !== ZERO_ADDRESS)).length,
                block650Wallets: 0,
                block51PlusWallets: 0
            }
        },
        supplyAttribution: {
            deployerLinkedPct: 0,
            blockZeroPct: calculatePct(launchWindowRaw, metadata.totalSupplyRaw),
            sniperPct: calculatePct(launchWindowRaw, metadata.totalSupplyRaw),
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
            blockZeroBundleClusterCount,
            maxTrackedHops: 1,
            trackedHopDepth: 1,
            evidenceByTier
        },
        bundleIntelligence,
        scanStats: {
            walletsExpanded: trackedWallets.length,
            transactionsDecoded: tokenTransfers.length + [...fundingTransfersByWallet.values()].reduce((sum, transfers) => sum + transfers.length, 0),
            hopWalletCounts: [trackedWallets.length, dedupe(fundingEdges.map((edge) => edge.sourceWallet)).length],
            usedHeliusHistory: false,
            usedWalletApi: false,
            historySource: 'signature_paging',
            coverageLevel
        },
        walletClusters,
        ecosystemGraph: {
            nodes: [...graphNodes, ...graphSourceNodes],
            edges: graphEdges,
            clusters: graphClusters
        },
        evidenceHighlights: [],
        notes: [
            options.holderSeeds?.length
                ? `Safe Scan seeded the EVM scan with ${options.holderSeeds.length} indexed top holders before running the ${chain} cluster pass.`
                : `Safe Scan used the ${chain} EVM cluster engine in ${depth} mode for this token.`,
            earliestBlock === null
                ? 'The EVM transfer sample did not include a usable launch block, so block 0-2 bundle-wallet attribution was unavailable.'
                : `Block 0-2 bundle-wallet attribution focused on transfers from block ${earliestBlock} through ${earliestBlock + LAUNCH_COHORT_LAST_OFFSET}.`,
            excludedConnectorCount
                ? `Excluded ${excludedConnectorCount} EVM public connector${excludedConnectorCount === 1 ? '' : 's'} from clustering and graph links, including shared external funders, known routers, token contracts, or DEX pair/pool contracts.`
                : 'No EVM public connector candidates were excluded in this run.',
            `It checked ${candidateWallets.length} balance candidates, expanded ${trackedWallets.length} holders, and traced funding for ${fundingWallets.length} wallets.`,
            options.seedOnly
                ? 'Safe Scan limits EVM balance candidates to indexed top-holder wallets, then verifies live balances, token-transfer links, and native funding-source mapping.'
                : 'EVM clustering is built from bounded ERC-20 transfer history, current candidate balances, and native funding-source links.',
            options.holderSeeds?.length
                ? 'Indexed holder coverage improves candidate selection before Safe Scan verifies live balances and wallet relationships.'
                : 'Holder coverage is approximate because this path derives candidates from recent transfer history rather than a full holder-index export.'
        ]
    };
}
