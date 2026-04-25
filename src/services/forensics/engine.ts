import { APP_CONFIG } from '../../config';
import { SolanaProvider } from '../SolanaProvider';
import { fetchOrderedTransactionsForAddress, fetchRecentSignaturesForAddress } from './helius-history';
import type {
    BundleCandidate,
    BuyerEvent,
    ClusterEdge,
    EvidenceTier,
    ForensicBundleReport,
    ForensicEvidenceItem,
    ForensicGraphCluster,
    ForensicGraphEdge,
    ForensicGraphNode,
    ForensicWalletCluster,
    FundingEdge,
    JitoSignalSummary,
    JitoTipTransfer,
    LargestAccount,
    LaunchBuyer,
    MintSignature,
    MintTokenAccount,
    MintTransferEdge,
    ParsedAccountKey,
    ParsedInstruction,
    ParsedTokenBalance,
    ParsedTransaction,
    TokenMetadata,
    WalletFundingSource,
    WalletIdentity
} from './types';

const HTTP_TIMEOUT_MS = 8_000;
export const FORENSIC_MAX_TRACKED_HOPS = 4;
const MAX_FRONTIER_BY_HOP = [16, 12, 8, 6];
const HISTORY_LIMIT_BY_HOP = [20, 14, 10, 8];
const LAUNCH_SIGNATURE_PAGE_LIMIT = 8;
const LAUNCH_SIGNATURE_PAGE_SIZE = 40;
const RECENT_SIGNATURE_LIMIT = 25;
const TOP_HOLDER_SEED_COUNT = 28;
const LAUNCH_BUYER_LIMIT = 12;
const MAX_INDEPENDENT_GRAPH_WALLETS = 120;
const DEFAULT_JITO_TIP_ACCOUNTS = [
    '96gYZGLnJYVFmbjzopPSU6QiEV5fGqZNyN9nmNhvrZU5',
    'HFqU5x63VTqvQss8hp11i4wVV8bD44PvwucfZ2bU7gRe',
    'Cw8CFyM9FkoMi7K7Crf6HNQqf4uEMzpKw6QNghXLvLkY',
    'ADaUMid9yfUytqMBgopwjb2DTLSokTSzL1zt6iGPaS49',
    'DfXygSm4jCyNCybVYYK6DwvWqjKee8pbDmJGcLWNDXjh',
    'ADuUkR4vqLUMWXxW9gh6D6L8pMSawimctcNZ5pGwDcEt',
    'DttWaMuVvTiduZRnguLF7jNxTgiMBZ1hyAumKUiL2KRL',
    '3AVi9Tg9Uo68tJfuvoKvqKNWKkC5wPdSSdeBnizKZ6jT'
];
const BUY_LIKE_PROGRAM_HINTS = ['raydium', 'pump', 'jupiter', 'meteora', 'orca', 'amm', 'swap'];

type TxFingerprint = {
    programs: string[];
    computeUnitLimit: string | null;
    computeUnitPrice: string | null;
    signerCount: number;
    instructionTypes: string[];
};

type LaunchReconstruction = {
    recentSignatures: MintSignature[];
    launchSignatures: MintSignature[];
    usedHeliusHistory: boolean;
    heliusPageCount: number;
    degradedReason: string | null;
};

type ExpandedGraph = {
    transactions: ParsedTransaction[];
    hopDepthByWallet: Map<string, number>;
    fundingSources: Map<string, WalletFundingSource[]>;
    identities: Map<string, WalletIdentity>;
    hopWalletCounts: number[];
    trackedWallets: string[];
    usedWalletApi: boolean;
};

let cachedJitoTipAccounts: { fetchedAt: number; accounts: string[] } | null = null;

function delay(ms: number) {
    return new Promise((resolve) => globalThis.setTimeout(resolve, ms));
}

function isLikelySolanaAddress(value: string) {
    const trimmed = value.trim();
    return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(trimmed);
}

function isTrackableWalletAddress(value: string | null | undefined) {
    return typeof value === 'string' && isLikelySolanaAddress(value);
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
    return Number((rawAmount * 10000n) / totalSupply) / 100;
}

function strongestTier(tiers: EvidenceTier[]) {
    if (tiers.includes('TIER_1')) return 'TIER_1';
    if (tiers.includes('TIER_2')) return 'TIER_2';
    return 'TIER_3';
}

function getTierLabel(tier: EvidenceTier): ForensicWalletCluster['userEvidenceLabel'] {
    if (tier === 'TIER_1') return 'Proven Connection';
    if (tier === 'TIER_2') return 'Strong Indicator';
    return 'Moderate Signal';
}

function getLaunchBand(slot: number, earliestSlot: number | undefined): LaunchBuyer['launchBand'] {
    if (earliestSlot === undefined) return 'block_51_plus';
    const delta = slot - earliestSlot;
    if (delta <= 0) return 'block_0';
    if (delta <= 5) return 'block_1_5';
    if (delta <= 50) return 'block_6_50';
    return 'block_51_plus';
}

function walletShort(address: string) {
    return `${address.slice(0, 4)}...${address.slice(-4)}`;
}

function asAccountString(value: ParsedAccountKey | undefined) {
    if (!value) return '';
    return typeof value === 'string' ? value : value.pubkey || '';
}

function getSignerSet(transaction: ParsedTransaction) {
    const signerSet = new Set<string>();
    for (const key of transaction.transaction?.message?.accountKeys || []) {
        if (typeof key !== 'string' && key.pubkey && key.signer) {
            signerSet.add(key.pubkey);
        }
    }
    return signerSet;
}

function getInstructionPrograms(transaction: ParsedTransaction) {
    const instructionPrograms = (transaction.transaction?.message?.instructions || [])
        .map((instruction) => String(instruction.programId || instruction.program || '').toLowerCase())
        .filter(Boolean);
    const logPrograms = (transaction.meta?.logMessages || [])
        .map((entry) => entry.toLowerCase())
        .filter((entry) => entry.includes('program'));
    return dedupe([...instructionPrograms, ...logPrograms]);
}

function getBuyLikePrograms(transaction: ParsedTransaction) {
    return dedupe(
        getInstructionPrograms(transaction)
            .flatMap((program) => BUY_LIKE_PROGRAM_HINTS.filter((hint) => program.includes(hint)))
    );
}

function getAccountKeyAtIndex(transaction: ParsedTransaction, index: number | undefined) {
    if (index === undefined) return null;
    return asAccountString(transaction.transaction?.message?.accountKeys?.[index]) || null;
}

function buildTokenAccountOwners(mintAddress: string, transaction: ParsedTransaction) {
    const owners = new Map<string, string | null>();
    const balances = [
        ...(transaction.meta?.preTokenBalances || []),
        ...(transaction.meta?.postTokenBalances || [])
    ];

    for (const balance of balances) {
        if (balance.mint !== mintAddress) continue;
        const account = getAccountKeyAtIndex(transaction, balance.accountIndex);
        if (!account) continue;
        owners.set(account, balance.owner || null);
    }

    return owners;
}

function getTxHash(transaction: ParsedTransaction) {
    return transaction.transaction?.signatures?.[0] || '';
}

function extractBuyerEvents(mintAddress: string, transactions: ParsedTransaction[]) {
    return transactions.flatMap((transaction) => {
        const txHash = getTxHash(transaction);
        if (!txHash || transaction.meta?.err) return [];

        const preBalances = new Map<string, bigint>();
        const postBalances = new Map<string, bigint>();

        for (const balance of transaction.meta?.preTokenBalances || []) {
            if (!balance.owner || balance.mint !== mintAddress) continue;
            preBalances.set(balance.owner, parseRawAmount(balance.uiTokenAmount?.amount));
        }

        for (const balance of transaction.meta?.postTokenBalances || []) {
            if (!balance.owner || balance.mint !== mintAddress) continue;
            postBalances.set(balance.owner, parseRawAmount(balance.uiTokenAmount?.amount));
        }

        return [...postBalances.entries()]
            .map(([wallet, postAmount]) => {
                const preAmount = preBalances.get(wallet) || 0n;
                const delta = postAmount - preAmount;
                if (delta <= 0n) return null;
                return {
                    wallet,
                    amount: delta,
                    slot: transaction.slot,
                    txHash,
                    timestamp: transaction.blockTime
                        ? new Date(transaction.blockTime * 1000).toISOString()
                        : new Date().toISOString()
                } satisfies BuyerEvent;
            })
            .filter((event): event is BuyerEvent => event !== null);
    });
}

function extractFundingEdges(transactions: ParsedTransaction[]) {
    return transactions.flatMap((transaction) => {
        const txHash = getTxHash(transaction);
        if (!txHash || transaction.meta?.err) return [];

        return (transaction.transaction?.message?.instructions || []).flatMap((instruction) => {
            const type = instruction.parsed?.type || '';
            const info = instruction.parsed?.info || {};
            const sourceWallet = String(info.source || info.authority || info.from || '');
            const targetWallet = String(info.destination || info.to || '');
            const lamports = parseBigIntLike(info.lamports as string | number | bigint | undefined);
            const isTransfer = instruction.program === 'system' && type === 'transfer';

            if (!isTransfer || !sourceWallet || !targetWallet || sourceWallet === targetWallet || lamports <= 0n) {
                return [];
            }

            return [{
                sourceWallet,
                targetWallet,
                lamports,
                txHash,
                slot: transaction.slot
            } satisfies FundingEdge];
        });
    });
}

function extractMintTransferEdges(mintAddress: string, transactions: ParsedTransaction[]) {
    return transactions.flatMap((transaction) => {
        const txHash = getTxHash(transaction);
        if (!txHash || transaction.meta?.err) return [];

        const owners = buildTokenAccountOwners(mintAddress, transaction);

        return (transaction.transaction?.message?.instructions || []).flatMap((instruction) => {
            const type = instruction.parsed?.type || '';
            if (!['transfer', 'transferChecked'].includes(type)) return [];

            const info = instruction.parsed?.info || {};
            const sourceTokenAccount = String(info.source || '');
            const targetTokenAccount = String(info.destination || '');
            const instructionMint = String(info.mint || '');
            if (!sourceTokenAccount || !targetTokenAccount) return [];
            if (instructionMint && instructionMint !== mintAddress && !owners.has(sourceTokenAccount) && !owners.has(targetTokenAccount)) {
                return [];
            }

            const sourceWallet = String(info.sourceOwner || '') || owners.get(sourceTokenAccount) || '';
            const targetWallet = String(info.destinationOwner || info.owner || '') || owners.get(targetTokenAccount) || '';
            const amount = parseBigIntLike(
                typeof info.amount === 'string'
                    ? info.amount
                    : typeof info.tokenAmount === 'object' && info.tokenAmount !== null && 'amount' in info.tokenAmount
                        ? (info.tokenAmount as { amount?: string }).amount
                        : undefined
            );

            if (!sourceWallet || !targetWallet || sourceWallet === targetWallet || amount <= 0n) {
                return [];
            }

            return [{
                sourceWallet,
                targetWallet,
                amount,
                txHash,
                slot: transaction.slot
            } satisfies MintTransferEdge];
        });
    });
}

function classifyLaunchBuyer(mintAddress: string, wallet: string, transaction: ParsedTransaction | undefined) {
    if (!transaction) {
        return {
            acquisitionType: 'unknown' as const,
            attributionBasis: 'fallback' as const,
            sourceWallets: [],
            sourceTokenAccounts: [],
            programs: []
        };
    }

    const owners = buildTokenAccountOwners(mintAddress, transaction);
    const signerSet = getSignerSet(transaction);
    const programs = getBuyLikePrograms(transaction);
    const transferSources: string[] = [];
    const transferAccounts: string[] = [];
    let acquisitionType: LaunchBuyer['acquisitionType'] = programs.length ? 'buy_like' : 'unknown';
    let attributionBasis: LaunchBuyer['attributionBasis'] = programs.length ? 'program_context' : 'fallback';

    for (const instruction of transaction.transaction?.message?.instructions || []) {
        const type = instruction.parsed?.type || '';
        if (!['transfer', 'transferChecked'].includes(type)) continue;
        const info = instruction.parsed?.info || {};
        const destination = String(info.destinationOwner || info.owner || '') || owners.get(String(info.destination || '')) || '';
        if (destination !== wallet) continue;
        const sourceWallet = String(info.sourceOwner || '') || owners.get(String(info.source || '')) || '';
        if (sourceWallet && sourceWallet !== wallet) {
            transferSources.push(sourceWallet);
            transferAccounts.push(String(info.source || ''));
            acquisitionType = programs.length ? 'buy_like' : 'transfer_in';
            attributionBasis = sourceWallet && signerSet.has(sourceWallet) ? 'source_account' : attributionBasis;
        } else if (sourceWallet === wallet) {
            acquisitionType = 'internal_rebalance';
            attributionBasis = 'source_account';
        }
    }

    return {
        acquisitionType,
        attributionBasis,
        sourceWallets: dedupe(transferSources),
        sourceTokenAccounts: dedupe(transferAccounts.filter(Boolean)),
        programs
    };
}

function extractTransactionFingerprint(transaction: ParsedTransaction): TxFingerprint {
    const programs = dedupe(
        (transaction.transaction?.message?.instructions || [])
            .map((instruction) => String(instruction.programId || instruction.program || '').toLowerCase())
            .filter(Boolean)
    );
    const instructionTypes = dedupe(
        (transaction.transaction?.message?.instructions || [])
            .map((instruction) => String(instruction.parsed?.type || '').toLowerCase())
            .filter(Boolean)
    );
    let computeUnitLimit: string | null = null;
    let computeUnitPrice: string | null = null;

    for (const instruction of transaction.transaction?.message?.instructions || []) {
        const info = instruction.parsed?.info || {};
        const type = String(instruction.parsed?.type || '').toLowerCase();
        if (type.includes('computeunitlimit') || 'units' in info) {
            computeUnitLimit = String((info as { units?: string | number }).units || '');
        }
        if (type.includes('computeunitprice') || 'microLamports' in info || 'micro_lamports' in info) {
            computeUnitPrice = String(
                (info as { microLamports?: string | number; micro_lamports?: string | number }).microLamports ||
                (info as { micro_lamports?: string | number }).micro_lamports ||
                ''
            );
        }
    }

    return {
        programs,
        computeUnitLimit: computeUnitLimit || null,
        computeUnitPrice: computeUnitPrice || null,
        signerCount: getSignerSet(transaction).size,
        instructionTypes
    };
}

export function extractJitoTipTransfers(transaction: ParsedTransaction, tipAccounts: string[]): JitoTipTransfer[] {
    const txHash = getTxHash(transaction);
    if (!txHash || transaction.meta?.err) return [];

    const tipAccountSet = new Set(tipAccounts);

    return (transaction.transaction?.message?.instructions || []).flatMap((instruction) => {
        const type = instruction.parsed?.type || '';
        const info = instruction.parsed?.info || {};
        const sourceWallet = String(info.source || info.authority || info.from || '');
        const tipAccount = String(info.destination || info.to || '');
        const lamports = parseBigIntLike(info.lamports as string | number | bigint | undefined);
        const isTransfer = instruction.program === 'system' && type === 'transfer';

        if (!isTransfer || !sourceWallet || !tipAccountSet.has(tipAccount) || lamports <= 0n) {
            return [];
        }

        return [{
            sourceWallet,
            tipAccount,
            lamports,
            txHash,
            slot: transaction.slot
        }];
    });
}

export function inferJitoLaunchSignals(args: {
    launchBuyers: LaunchBuyer[];
    transactions: ParsedTransaction[];
    tipAccounts: string[];
}): JitoSignalSummary {
    const { launchBuyers, transactions, tipAccounts } = args;
    const launchBuyerByTx = new Map<string, LaunchBuyer>();
    const launchBuyerByWallet = new Map<string, LaunchBuyer>();
    const txTipMap = new Map<string, JitoTipTransfer[]>();

    for (const buyer of launchBuyers) {
        launchBuyerByTx.set(buyer.txHash, buyer);
        launchBuyerByWallet.set(buyer.wallet, buyer);
    }

    for (const transaction of transactions) {
        const tips = extractJitoTipTransfers(transaction, tipAccounts);
        if (tips.length) {
            txTipMap.set(getTxHash(transaction), tips);
        }
    }

    const tippedBuyerWallets = dedupe(
        [...txTipMap.keys()]
            .map((txHash) => launchBuyerByTx.get(txHash)?.wallet || '')
            .filter(Boolean)
    );
    const inferredEdges: ClusterEdge[] = [];

    for (let index = 0; index < launchBuyers.length; index += 1) {
        for (let inner = index + 1; inner < launchBuyers.length; inner += 1) {
            const left = launchBuyers[index];
            const right = launchBuyers[inner];
            const leftTips = txTipMap.get(left.txHash) || [];
            const rightTips = txTipMap.get(right.txHash) || [];
            if (!leftTips.length || !rightTips.length) continue;

            const leftSources = dedupe(leftTips.map((tip) => tip.sourceWallet));
            const rightSources = dedupe(rightTips.map((tip) => tip.sourceWallet));
            const sharedTipWallets = leftSources.filter((wallet) => rightSources.includes(wallet));
            const leftTipAccounts = dedupe(leftTips.map((tip) => tip.tipAccount));
            const rightTipAccounts = dedupe(rightTips.map((tip) => tip.tipAccount));
            const sharedTipAccounts = leftTipAccounts.filter((wallet) => rightTipAccounts.includes(wallet));
            const leftTipLamports = dedupe(leftTips.map((tip) => tip.lamports.toString()));
            const rightTipLamports = dedupe(rightTips.map((tip) => tip.lamports.toString()));
            const matchingTipAmounts = leftTipLamports.filter((amount) => rightTipLamports.includes(amount));

            if (sharedTipWallets.length) {
                inferredEdges.push({
                    from: left.wallet,
                    to: right.wallet,
                    tier: 'TIER_1',
                    label: 'shared_jito_tip_wallet',
                    reason: `Both launch entries used the same Jito tip-paying wallet ${sharedTipWallets[0]}.`,
                    txHash: left.txHash,
                    score: 8
                });
            }

            if (left.slot === right.slot && (sharedTipWallets.length || sharedTipAccounts.length)) {
                inferredEdges.push({
                    from: left.wallet,
                    to: right.wallet,
                    tier: 'TIER_2',
                    label: 'same_slot_jito_router',
                    reason: 'Both launch entries tipped Jito in the same slot.',
                    txHash: left.txHash,
                    score: 6
                });
            }

            if (sharedTipAccounts.length) {
                inferredEdges.push({
                    from: left.wallet,
                    to: right.wallet,
                    tier: 'TIER_2',
                    label: 'shared_jito_tip_account',
                    reason: `Both launch entries paid into the same Jito tip account ${sharedTipAccounts[0]}.`,
                    txHash: left.txHash,
                    score: 5
                });
            }

            if (matchingTipAmounts.length) {
                inferredEdges.push({
                    from: left.wallet,
                    to: right.wallet,
                    tier: 'TIER_2',
                    label: 'matching_jito_tip_amount',
                    reason: `Both launch entries used the same Jito tip amount ${matchingTipAmounts[0]} lamports.`,
                    txHash: left.txHash,
                    score: 4
                });
            }
        }
    }

    return {
        inferredEdges,
        tippedBuyerWallets,
        tippedTransactionCount: txTipMap.size,
        uniqueTipAccounts: dedupe([...txTipMap.values()].flatMap((tips) => tips.map((tip) => tip.tipAccount)))
    };
}

function selectCounterparty(edge: FundingEdge | MintTransferEdge, wallet: string) {
    if ('sourceWallet' in edge && edge.sourceWallet === wallet) return edge.targetWallet;
    if ('targetWallet' in edge && edge.targetWallet === wallet) return edge.sourceWallet;
    return '';
}

async function fetchJsonWithTimeout(input: RequestInfo | URL, init: RequestInit = {}, timeoutMs = HTTP_TIMEOUT_MS) {
    const controller = new AbortController();
    const timeoutId = globalThis.setTimeout(() => controller.abort(), timeoutMs);
    try {
        return await fetch(input, { ...init, signal: controller.signal });
    } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') {
            throw new Error(`Request timed out after ${Math.round(timeoutMs / 1000)}s`);
        }
        throw error;
    } finally {
        globalThis.clearTimeout(timeoutId);
    }
}

async function mapWithConcurrency<T, R>(args: {
    items: T[];
    concurrency: number;
    delayMs?: number;
    worker: (item: T) => Promise<R>;
}) {
    const { items, concurrency, delayMs = 0, worker } = args;
    const results: R[] = [];

    for (let index = 0; index < items.length; index += concurrency) {
        const chunk = items.slice(index, index + concurrency);
        const settled = await Promise.allSettled(chunk.map((item) => worker(item)));
        results.push(
            ...settled.flatMap((result) => result.status === 'fulfilled' ? [result.value] : [])
        );
        if (delayMs > 0 && index + concurrency < items.length) {
            await delay(delayMs);
        }
    }

    return results;
}

async function fetchDexScreenerMarketData(tokenAddress: string) {
    try {
        const response = await fetchJsonWithTimeout(`https://api.dexscreener.com/tokens/v1/solana/${tokenAddress}`, {
            headers: { Accept: 'application/json' }
        });
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

async function fetchJitoTipAccounts() {
    if (cachedJitoTipAccounts && (Date.now() - cachedJitoTipAccounts.fetchedAt) < 30 * 60 * 1000) {
        return cachedJitoTipAccounts.accounts;
    }

    try {
        const response = await fetchJsonWithTimeout('https://mainnet.block-engine.jito.wtf/api/v1/getTipAccounts', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                jsonrpc: '2.0',
                id: 'atlaix-jito-tip-accounts',
                method: 'getTipAccounts',
                params: []
            })
        }, 5_000);

        if (!response.ok) {
            throw new Error(`Jito request failed: ${response.status}`);
        }

        const payload = await response.json() as { result?: unknown };
        const accounts = Array.isArray(payload.result)
            ? payload.result.filter((value): value is string => typeof value === 'string' && value.length > 0)
            : [];
        cachedJitoTipAccounts = {
            fetchedAt: Date.now(),
            accounts: accounts.length ? accounts : DEFAULT_JITO_TIP_ACCOUNTS
        };
    } catch {
        cachedJitoTipAccounts = {
            fetchedAt: Date.now(),
            accounts: DEFAULT_JITO_TIP_ACCOUNTS
        };
    }

    return cachedJitoTipAccounts.accounts;
}

async function fetchTokenMetadata(tokenAddress: string) {
    const [assetResult, tokenSupplyResult] = await Promise.allSettled([
        SolanaProvider.rpc<any>('getAsset', { id: tokenAddress }),
        SolanaProvider.rpc<{ value?: { amount?: string; decimals?: number } }>('getTokenSupply', [
            tokenAddress,
            { commitment: 'finalized' }
        ])
    ]);

    const asset = assetResult.status === 'fulfilled' ? assetResult.value : null;
    const tokenInfo = asset?.token_info || asset?.tokenInfo || {};
    const rawSupply = tokenInfo?.supply ?? tokenInfo?.total_supply ?? (tokenSupplyResult.status === 'fulfilled'
        ? tokenSupplyResult.value?.value?.amount
        : undefined);
    const rawDecimals = tokenInfo?.decimals ?? (tokenSupplyResult.status === 'fulfilled'
        ? tokenSupplyResult.value?.value?.decimals
        : undefined);
    const providerPrice = tokenInfo?.price_info?.price_per_token ?? tokenInfo?.priceInfo?.pricePerToken ?? null;
    const providerMarketCap = providerPrice !== null && rawSupply !== undefined && rawDecimals !== undefined
        ? (Number(rawSupply) / 10 ** Number(rawDecimals)) * providerPrice
        : null;
    const dexFallback = providerPrice === null || providerMarketCap === null
        ? await fetchDexScreenerMarketData(tokenAddress)
        : { currentPriceUsd: null, marketCapUsd: null };
    const deployer =
        asset?.authorities?.find((authority: any) => authority.scopes?.includes('full'))?.address ||
        asset?.creators?.find((creator: any) => creator.verified)?.address ||
        asset?.mint_extensions?.metadata_pointer?.authority ||
        'Unknown';

    return {
        address: tokenAddress,
        name: asset?.content?.metadata?.name || 'Unknown Token',
        symbol: asset?.content?.metadata?.symbol || 'UNKNOWN',
        totalSupplyRaw: parseBigIntLike(rawSupply),
        decimals: Number(rawDecimals || 0),
        currentPriceUsd: providerPrice ?? dexFallback.currentPriceUsd,
        marketCapUsd: providerMarketCap ?? dexFallback.marketCapUsd,
        deployerAddress: deployer,
        launchTimestamp: new Date(asset?.created_at || Date.now()).toISOString()
    } satisfies TokenMetadata;
}

async function fetchTokenLargestAccounts(tokenAddress: string) {
    try {
        const result = await SolanaProvider.rpc<{ value?: LargestAccount[] }>('getTokenLargestAccounts', [
            tokenAddress,
            { commitment: 'finalized' }
        ]);
        return result?.value || [];
    } catch {
        return [];
    }
}

async function fetchMintTokenAccounts(tokenAddress: string, limit = 320) {
    try {
        const result = await SolanaProvider.rpc<{ token_accounts?: MintTokenAccount[] }>('getTokenAccounts', {
            mintAddress: tokenAddress,
            limit,
            options: {
                showZeroBalance: false
            }
        });
        return result?.token_accounts || [];
    } catch {
        return [];
    }
}

async function fetchParsedTransactions(signatures: string[]) {
    const deduped = dedupe(signatures.filter(Boolean));
    return mapWithConcurrency({
        items: deduped,
        concurrency: 8,
        delayMs: 20,
        worker: async (signature) => {
            try {
                return await SolanaProvider.rpc<ParsedTransaction>('getTransaction', [
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
        }
    }).then((transactions) => transactions.filter((entry): entry is ParsedTransaction => Boolean(entry)));
}

async function fetchTransactionsForAddressViaHelius(address: string, limit: number, before?: string) {
    void before;
    try {
        const result = await fetchOrderedTransactionsForAddress(address, limit);
        return {
            transactions: result.items,
            pageCount: result.pageCount
        };
    } catch {
        return {
            transactions: [] as ParsedTransaction[],
            pageCount: 0
        };
    }
}

async function reconstructLaunchWindow(tokenAddress: string): Promise<LaunchReconstruction> {
    const heliusTransactions = await fetchTransactionsForAddressViaHelius(tokenAddress, 120);
    if (heliusTransactions.transactions.length) {
        const heliusRecentSignatures = await fetchRecentSignaturesForAddress(tokenAddress, RECENT_SIGNATURE_LIMIT).catch(() => ({
            items: [] as MintSignature[]
        }));
        const recentSignatures = heliusRecentSignatures.items.length
            ? heliusRecentSignatures.items
            : heliusTransactions.transactions.slice(-RECENT_SIGNATURE_LIMIT).map((entry) => ({
                signature: getTxHash(entry),
                slot: entry.slot,
                blockTime: entry.blockTime
            }));
        const launchSignatures = heliusTransactions.transactions.slice(0, 120).map((entry) => ({
            signature: getTxHash(entry),
            slot: entry.slot,
            blockTime: entry.blockTime
        }));
        return {
            recentSignatures,
            launchSignatures,
            usedHeliusHistory: true,
            heliusPageCount: heliusTransactions.pageCount,
            degradedReason: null
        };
    }

    const recentSignatures = await SolanaProvider.rpc<MintSignature[]>('getSignaturesForAddress', [
        tokenAddress,
        { limit: RECENT_SIGNATURE_LIMIT, commitment: 'finalized' }
    ]);

    const scanned: MintSignature[] = [...recentSignatures];
    let before = recentSignatures[recentSignatures.length - 1]?.signature;

    for (let pageIndex = 0; pageIndex < LAUNCH_SIGNATURE_PAGE_LIMIT; pageIndex += 1) {
        if (!before) break;
        const page = await SolanaProvider.rpc<MintSignature[]>('getSignaturesForAddress', [
            tokenAddress,
            {
                limit: LAUNCH_SIGNATURE_PAGE_SIZE,
                commitment: 'finalized',
                before
            }
        ]);
        if (!page.length) break;
        scanned.push(...page);
        before = page[page.length - 1]?.signature;
        if (page.length < LAUNCH_SIGNATURE_PAGE_SIZE) break;
    }

    const launchSignatures = [...new Map(scanned.map((entry) => [entry.signature, entry] as const)).values()]
        .sort((left, right) => left.slot - right.slot)
        .slice(0, 160);

    return {
        recentSignatures,
        launchSignatures,
        usedHeliusHistory: false,
        heliusPageCount: 0,
        degradedReason: 'Helius ordered history was unavailable or returned no launch slice for this token.'
    };
}

async function walletApiGet<T>(path: string) {
    if (!APP_CONFIG.heliusKey) return null;
    const response = await fetchJsonWithTimeout(`https://api.helius.xyz${path}${path.includes('?') ? '&' : '?'}api-key=${APP_CONFIG.heliusKey}`);
    if (!response.ok) return null;
    return await response.json() as T;
}

async function fetchWalletFundingSources(wallets: string[]) {
    const fundingMap = new Map<string, WalletFundingSource[]>();
    const uniqueWallets = dedupe(wallets.filter(Boolean));
    let usedWalletApi = false;

    const results = await mapWithConcurrency({
        items: uniqueWallets,
        concurrency: 4,
        delayMs: 25,
        worker: async (wallet) => {
            try {
                const payload = await walletApiGet<any>(`/v0/addresses/${wallet}/funded-by`);
                if (!payload) return { wallet, sources: [] as WalletFundingSource[] };
                usedWalletApi = true;

                const candidates = [
                    payload,
                    ...(Array.isArray(payload?.sources) ? payload.sources : []),
                    ...(Array.isArray(payload?.data) ? payload.data : [])
                ].filter(Boolean);

                const sources = candidates.flatMap((entry) => {
                    const sourceAddress = String(
                        entry?.sourceAddress ||
                        entry?.source_address ||
                        entry?.funder ||
                        entry?.address ||
                        ''
                    );

                    if (!sourceAddress || sourceAddress === wallet) return [];

                    return [{
                        walletAddress: wallet,
                        sourceAddress,
                        sourceLabel: entry?.label || entry?.name || null,
                        confidence: (entry?.confidence || 'medium') as WalletFundingSource['confidence']
                    }];
                });

                return { wallet, sources };
            } catch {
                return { wallet, sources: [] as WalletFundingSource[] };
            }
        }
    });

    for (const result of results) {
        fundingMap.set(result.wallet, dedupe(result.sources));
    }

    return { fundingMap, usedWalletApi };
}

async function fetchWalletIdentities(wallets: string[]) {
    const identityMap = new Map<string, WalletIdentity>();
    const uniqueWallets = dedupe(wallets.filter(Boolean));
    let usedWalletApi = false;

    const results = await mapWithConcurrency({
        items: uniqueWallets,
        concurrency: 4,
        delayMs: 20,
        worker: async (wallet) => {
            try {
                const payload = await walletApiGet<any>(`/v0/addresses/${wallet}/identity`);
                if (!payload) {
                    return {
                        address: wallet,
                        ownerType: 'unknown' as const,
                        label: null,
                        isLikelyInstitutional: false
                    };
                }

                usedWalletApi = true;
                const ownerTypeText = String(payload?.ownerType || payload?.owner_type || '').toLowerCase();
                const ownerType =
                    ownerTypeText.includes('exchange') ? 'exchange' :
                    ownerTypeText.includes('protocol') ? 'protocol' :
                    ownerTypeText.includes('smart') ? 'smart_wallet' :
                    'unknown';

                return {
                    address: wallet,
                    ownerType,
                    label: payload?.name || payload?.label || null,
                    isLikelyInstitutional: ownerType === 'exchange' || ownerType === 'protocol'
                } satisfies WalletIdentity;
            } catch {
                return {
                    address: wallet,
                    ownerType: 'unknown' as const,
                    label: null,
                    isLikelyInstitutional: false
                };
            }
        }
    });

    for (const identity of results) {
        identityMap.set(identity.address, identity);
    }

    return { identityMap, usedWalletApi };
}

async function fetchWalletHistory(walletAddress: string, limit: number) {
    if (!isTrackableWalletAddress(walletAddress)) {
        return [];
    }

    const heliusTransactions = await fetchTransactionsForAddressViaHelius(walletAddress, limit);
    if (heliusTransactions.transactions.length) {
        return heliusTransactions.transactions;
    }

    try {
        const signatures = await SolanaProvider.rpc<MintSignature[]>('getSignaturesForAddress', [
            walletAddress,
            { limit, commitment: 'finalized' }
        ]);
        return fetchParsedTransactions(signatures.map((entry) => entry.signature));
    } catch {
        return [];
    }
}

async function expandTrackedGraph(args: {
    tokenAddress: string;
    seedWallets: string[];
    tokenAccounts: MintTokenAccount[];
    initialTransactions: ParsedTransaction[];
    initialFundingSources: Map<string, WalletFundingSource[]>;
    initialIdentities: Map<string, WalletIdentity>;
}) {
    const { tokenAddress, seedWallets, tokenAccounts, initialTransactions, initialFundingSources, initialIdentities } = args;
    const hopDepthByWallet = new Map<string, number>();
    const trackedWallets = new Set<string>();
    const transactionMap = new Map<string, ParsedTransaction>();
    const fundingSources = new Map(initialFundingSources);
    const identities = new Map(initialIdentities);
    const tokenAccountOwners = new Set(tokenAccounts.map((account) => account.owner).filter(isTrackableWalletAddress));
    const hopWalletCounts: number[] = [];
    let usedWalletApi = false;

    for (const wallet of seedWallets.filter(isTrackableWalletAddress)) {
        hopDepthByWallet.set(wallet, 0);
        trackedWallets.add(wallet);
    }

    for (const transaction of initialTransactions) {
        const txHash = getTxHash(transaction);
        if (txHash) transactionMap.set(txHash, transaction);
    }

    let frontier = dedupe(seedWallets).filter(isTrackableWalletAddress);

    for (let hop = 1; hop <= FORENSIC_MAX_TRACKED_HOPS; hop += 1) {
        if (!frontier.length) break;

        const limit = HISTORY_LIMIT_BY_HOP[hop - 1] || 8;
        const histories = await mapWithConcurrency({
            items: frontier,
            concurrency: 4,
            delayMs: 25,
            worker: async (wallet) => ({ wallet, transactions: await fetchWalletHistory(wallet, limit) })
        });

        const candidateScores = new Map<string, { score: number; sources: string[] }>();

        for (const history of histories) {
            for (const transaction of history.transactions) {
                const txHash = getTxHash(transaction);
                if (txHash) transactionMap.set(txHash, transaction);
            }

            const fundingEdges = extractFundingEdges(history.transactions);
            const transferEdges = extractMintTransferEdges(tokenAddress, history.transactions);

            for (const edge of [...fundingEdges, ...transferEdges]) {
                const counterparty = selectCounterparty(edge, history.wallet);
                if (!isTrackableWalletAddress(counterparty) || trackedWallets.has(counterparty)) continue;
                if (!tokenAccountOwners.has(counterparty) && hop >= 3) continue;
                const score = 'lamports' in edge ? 4 : 3;
                const current = candidateScores.get(counterparty) || { score: 0, sources: [] };
                current.score += score;
                current.sources.push(history.wallet);
                candidateScores.set(counterparty, current);
            }
        }

        const frontierFunding = await fetchWalletFundingSources(frontier);
        const frontierIdentities = await fetchWalletIdentities(
            frontierFunding.fundingMap.size
                ? [...frontierFunding.fundingMap.values()].flatMap((entries) => entries.map((entry) => entry.sourceAddress))
                : []
        );
        usedWalletApi = usedWalletApi || frontierFunding.usedWalletApi || frontierIdentities.usedWalletApi;

        for (const [wallet, sources] of frontierFunding.fundingMap.entries()) {
            fundingSources.set(wallet, sources);
            for (const source of sources) {
                if (!isTrackableWalletAddress(source.sourceAddress) || trackedWallets.has(source.sourceAddress)) continue;
                const current = candidateScores.get(source.sourceAddress) || { score: 0, sources: [] };
                current.score += source.confidence === 'high' ? 5 : 3;
                current.sources.push(wallet);
                candidateScores.set(source.sourceAddress, current);
            }
        }

        for (const [address, identity] of frontierIdentities.identityMap.entries()) {
            identities.set(address, identity);
        }

        const nextFrontier = [...candidateScores.entries()]
            .map(([wallet, summary]) => ({
                wallet,
                score: summary.score + (summary.sources.length >= 2 ? 2 : 0),
                supportingWallets: dedupe(summary.sources)
            }))
            .filter((entry) => {
                if (!isTrackableWalletAddress(entry.wallet)) return false;
                const identity = identities.get(entry.wallet);
                if (identity?.ownerType === 'exchange' && entry.score < 7) return false;
                return entry.score >= 4;
            })
            .sort((left, right) => right.score - left.score)
            .slice(0, MAX_FRONTIER_BY_HOP[hop - 1] || 6)
            .map((entry) => entry.wallet);

        hopWalletCounts.push(nextFrontier.length);

        for (const wallet of nextFrontier) {
            hopDepthByWallet.set(wallet, hop);
            trackedWallets.add(wallet);
        }

        frontier = nextFrontier;
    }

    return {
        transactions: [...transactionMap.values()],
        hopDepthByWallet,
        fundingSources,
        identities,
        hopWalletCounts,
        trackedWallets: [...trackedWallets],
        usedWalletApi
    } satisfies ExpandedGraph;
}

function pairKey(left: string, right: string) {
    return [left, right].sort().join(':');
}

function makeEdge(args: {
    from: string;
    to: string;
    tier: EvidenceTier;
    label: string;
    reason: string;
    txHash?: string;
    score?: number;
    hopDistance?: number;
}) {
    return args satisfies ClusterEdge;
}

function collectSharedFundingEdges(wallets: string[], fundingSources: Map<string, WalletFundingSource[]>) {
    const bySource = new Map<string, string[]>();
    const edges: ClusterEdge[] = [];

    for (const wallet of wallets) {
        for (const source of fundingSources.get(wallet) || []) {
            const existing = bySource.get(source.sourceAddress) || [];
            existing.push(wallet);
            bySource.set(source.sourceAddress, existing);
        }
    }

    for (const [sourceWallet, fundedWallets] of bySource.entries()) {
        const uniqueWallets = dedupe(fundedWallets);
        if (uniqueWallets.length < 2) continue;
        for (let index = 0; index < uniqueWallets.length; index += 1) {
            for (let inner = index + 1; inner < uniqueWallets.length; inner += 1) {
                edges.push(makeEdge({
                    from: uniqueWallets[index],
                    to: uniqueWallets[inner],
                    tier: 'TIER_1',
                    label: 'shared_funded_by_source',
                    reason: `Both wallets were funded by ${sourceWallet} according to Helius Wallet API enrichment.`,
                    score: 8
                }));
            }
        }
    }

    return edges;
}

function buildBundleCandidates(args: {
    launchBuyers: LaunchBuyer[];
    launchTransactions: ParsedTransaction[];
    fundingSources: Map<string, WalletFundingSource[]>;
    fundingEdges: FundingEdge[];
    mintTransferEdges: MintTransferEdge[];
    blockZeroWallets: string[];
    tipAccounts: string[];
}) {
    const { launchBuyers, launchTransactions, fundingSources, fundingEdges, mintTransferEdges, blockZeroWallets, tipAccounts } = args;
    const fingerprints = new Map(
        launchTransactions
            .map((transaction) => [getTxHash(transaction), extractTransactionFingerprint(transaction)] as const)
            .filter(([txHash]) => Boolean(txHash))
    );
    const jitoSignals = inferJitoLaunchSignals({
        launchBuyers,
        transactions: launchTransactions,
        tipAccounts
    });
    const jitoEdgesByPair = new Map<string, ClusterEdge[]>();
    for (const edge of jitoSignals.inferredEdges) {
        const key = pairKey(edge.from, edge.to);
        const existing = jitoEdgesByPair.get(key) || [];
        existing.push(edge);
        jitoEdgesByPair.set(key, existing);
    }

    const bundleCandidates: BundleCandidate[] = [];

    for (let index = 0; index < launchBuyers.length; index += 1) {
        for (let inner = index + 1; inner < launchBuyers.length; inner += 1) {
            const left = launchBuyers[index];
            const right = launchBuyers[inner];
            const reasons: string[] = [];
            let score = 0;

            if (left.slot === right.slot) {
                score += 2;
                reasons.push('same_launch_slot');
            } else if (Math.abs(left.slot - right.slot) <= 2) {
                score += 1;
                reasons.push('near_launch_slot');
            }

            if (left.launchBand === right.launchBand && left.launchBand === 'block_0') {
                score += 2;
                reasons.push('same_block_zero_band');
            }

            const sharedPrograms = left.programs.filter((program) => right.programs.includes(program));
            if (sharedPrograms.length) {
                score += 1;
                reasons.push(`shared_router:${sharedPrograms[0]}`);
            }

            const sharedSourceWallets = left.sourceWallets.filter((wallet) => right.sourceWallets.includes(wallet));
            if (sharedSourceWallets.length) {
                score += 5;
                reasons.push(`shared_source_wallet:${sharedSourceWallets[0]}`);
            }

            const leftFundingSources = (fundingSources.get(left.wallet) || []).map((entry) => entry.sourceAddress);
            const rightFundingSources = (fundingSources.get(right.wallet) || []).map((entry) => entry.sourceAddress);
            const sharedFundingSources = leftFundingSources.filter((wallet) => rightFundingSources.includes(wallet));
            if (sharedFundingSources.length) {
                score += 4;
                reasons.push(`shared_funded_by:${sharedFundingSources[0]}`);
            }

            const relatedFunding = fundingEdges.some((edge) =>
                (edge.sourceWallet === left.wallet && edge.targetWallet === right.wallet) ||
                (edge.sourceWallet === right.wallet && edge.targetWallet === left.wallet)
            );
            if (relatedFunding) {
                score += 4;
                reasons.push('direct_funding_link');
            }

            const relatedMintTransfer = mintTransferEdges.some((edge) =>
                (edge.sourceWallet === left.wallet && edge.targetWallet === right.wallet) ||
                (edge.sourceWallet === right.wallet && edge.targetWallet === left.wallet)
            );
            if (relatedMintTransfer) {
                score += 4;
                reasons.push('direct_token_transfer');
            }

            const leftFingerprint = fingerprints.get(left.txHash);
            const rightFingerprint = fingerprints.get(right.txHash);
            if (leftFingerprint && rightFingerprint) {
                if (leftFingerprint.computeUnitPrice && leftFingerprint.computeUnitPrice === rightFingerprint.computeUnitPrice) {
                    score += 2;
                    reasons.push('matching_compute_unit_price');
                }
                if (leftFingerprint.computeUnitLimit && leftFingerprint.computeUnitLimit === rightFingerprint.computeUnitLimit) {
                    score += 1;
                    reasons.push('matching_compute_unit_limit');
                }
                if (
                    leftFingerprint.instructionTypes.join(':') === rightFingerprint.instructionTypes.join(':') &&
                    leftFingerprint.instructionTypes.length > 0
                ) {
                    score += 2;
                    reasons.push('matching_instruction_order');
                }
            }

            const jitoPairEdges = jitoEdgesByPair.get(pairKey(left.wallet, right.wallet)) || [];
            if (jitoPairEdges.length) {
                score += jitoPairEdges.reduce((sum, edge) => sum + (edge.score || 0), 0);
                reasons.push(...jitoPairEdges.map((edge) => edge.label));
            }

            if (score < 4) continue;

            const tier: EvidenceTier =
                reasons.includes('direct_funding_link') || reasons.includes('direct_token_transfer') || reasons.some((entry) => entry.startsWith('shared_source_wallet'))
                    ? 'TIER_1'
                    : score >= 11
                        ? 'TIER_2'
                        : 'TIER_3';

            bundleCandidates.push({
                bundleId: `bundle-${left.slot}-${pairKey(left.wallet, right.wallet)}`,
                wallets: [left.wallet, right.wallet],
                launchSlot: Math.min(left.slot, right.slot),
                tier,
                confidenceScore: score,
                reasons: dedupe(reasons),
                supportingTxHashes: dedupe([left.txHash, right.txHash]),
                blockZeroOverlap: [left.wallet, right.wallet].filter((wallet) => blockZeroWallets.includes(wallet))
            });
        }
    }

    const merged = new Map<string, BundleCandidate>();
    for (const candidate of bundleCandidates) {
        const key = candidate.wallets.slice().sort().join(':');
        const existing = merged.get(key);
        if (!existing || candidate.confidenceScore > existing.confidenceScore) {
            merged.set(key, candidate);
        }
    }

    return {
        bundleCandidates: [...merged.values()],
        jitoSignals
    };
}

function buildClusterGraph(args: {
    metadata: TokenMetadata;
    launchBuyers: LaunchBuyer[];
    fundingEdges: FundingEdge[];
    mintTransferEdges: MintTransferEdge[];
    fundingSources: Map<string, WalletFundingSource[]>;
    bundleCandidates: BundleCandidate[];
    hopDepthByWallet: Map<string, number>;
    tokenAccounts: MintTokenAccount[];
    blockZeroWallets: string[];
    sniperWallets: string[];
}) {
    const {
        metadata,
        launchBuyers,
        fundingEdges,
        mintTransferEdges,
        fundingSources,
        bundleCandidates,
        hopDepthByWallet,
        tokenAccounts,
        blockZeroWallets,
        sniperWallets
    } = args;
    const balancesByWallet = new Map<string, bigint>();
    const buyers = launchBuyers.map((buyer) => buyer.wallet);
    const buyerSet = new Set(buyers);
    const candidateWallets = dedupe([
        ...buyers,
        ...tokenAccounts
            .slice()
            .sort((left, right) => Number(parseBigIntLike(right.amount) - parseBigIntLike(left.amount)))
            .map((account) => account.owner)
            .slice(0, TOP_HOLDER_SEED_COUNT),
        ...[...hopDepthByWallet.keys()]
    ]);
    const candidateSet = new Set(candidateWallets);

    for (const account of tokenAccounts) {
        balancesByWallet.set(account.owner, (balancesByWallet.get(account.owner) || 0n) + parseBigIntLike(account.amount));
    }

    const edgeMap = new Map<string, ClusterEdge>();
    const pushEdge = (edge: ClusterEdge) => {
        if (!candidateSet.has(edge.from) || !candidateSet.has(edge.to) || edge.from === edge.to) return;
        const key = `${pairKey(edge.from, edge.to)}:${edge.label}`;
        const existing = edgeMap.get(key);
        if (!existing || (edge.score || 0) > (existing.score || 0)) {
            edgeMap.set(key, edge);
        }
    };

    for (const edge of fundingEdges) {
        if (!candidateSet.has(edge.sourceWallet) || !candidateSet.has(edge.targetWallet)) continue;
        pushEdge(makeEdge({
            from: edge.sourceWallet,
            to: edge.targetWallet,
            tier: 'TIER_1',
            label: 'direct_funding',
            reason: `SOL funding transfer observed between ${walletShort(edge.sourceWallet)} and ${walletShort(edge.targetWallet)}.`,
            txHash: edge.txHash,
            score: 8,
            hopDistance: Math.max(hopDepthByWallet.get(edge.sourceWallet) || 0, hopDepthByWallet.get(edge.targetWallet) || 0)
        }));
    }

    for (const edge of mintTransferEdges) {
        if (!candidateSet.has(edge.sourceWallet) || !candidateSet.has(edge.targetWallet)) continue;
        pushEdge(makeEdge({
            from: edge.sourceWallet,
            to: edge.targetWallet,
            tier: 'TIER_1',
            label: 'direct_token_transfer',
            reason: `Direct ${metadata.symbol} transfer observed between both wallets.`,
            txHash: edge.txHash,
            score: 8,
            hopDistance: Math.max(hopDepthByWallet.get(edge.sourceWallet) || 0, hopDepthByWallet.get(edge.targetWallet) || 0)
        }));
    }

    for (const edge of collectSharedFundingEdges(candidateWallets, fundingSources)) {
        pushEdge(edge);
    }

    for (const candidate of bundleCandidates) {
        pushEdge(makeEdge({
            from: candidate.wallets[0],
            to: candidate.wallets[1],
            tier: candidate.tier,
            label: 'bundle_candidate',
            reason: `Bundle candidate scored ${candidate.confidenceScore} from ${candidate.reasons.join(', ')}.`,
            txHash: candidate.supportingTxHashes[0],
            score: candidate.confidenceScore
        }));
    }

    for (let index = 0; index < launchBuyers.length; index += 1) {
        for (let inner = index + 1; inner < launchBuyers.length; inner += 1) {
            const left = launchBuyers[index];
            const right = launchBuyers[inner];
            if (left.slot === right.slot && left.programs.some((program) => right.programs.includes(program))) {
                pushEdge(makeEdge({
                    from: left.wallet,
                    to: right.wallet,
                    tier: 'TIER_3',
                    label: 'same_slot_router',
                    reason: `Both wallets entered in slot ${left.slot} through the same launch router.`,
                    txHash: left.txHash,
                    score: 4
                }));
            }
        }
    }

    const edges = [...edgeMap.values()];
    const qualifyingEdges = edges.filter((edge) => edge.tier !== 'TIER_3' || (edge.score || 0) >= 4);
    const parents = new Map(candidateWallets.map((wallet) => [wallet, wallet]));

    const find = (wallet: string): string => {
        const parent = parents.get(wallet) || wallet;
        if (parent === wallet) return wallet;
        const root = find(parent);
        parents.set(wallet, root);
        return root;
    };

    const union = (left: string, right: string) => {
        const leftRoot = find(left);
        const rightRoot = find(right);
        if (leftRoot !== rightRoot) {
            parents.set(rightRoot, leftRoot);
        }
    };

    for (const edge of qualifyingEdges) {
        union(edge.from, edge.to);
    }

    const components = new Map<string, string[]>();
    for (const wallet of candidateWallets) {
        const root = find(wallet);
        const entry = components.get(root) || [];
        entry.push(wallet);
        components.set(root, entry);
    }

    const walletClusters: ForensicWalletCluster[] = [];
    const clusterGraphClusters: ForensicGraphCluster[] = [];
    let clusterIndex = 0;

    for (const members of components.values()) {
        if (members.length < 2) continue;
        const memberSet = new Set(members);
        const componentEdges = qualifyingEdges.filter((edge) => memberSet.has(edge.from) && memberSet.has(edge.to));
        const strongest = strongestTier(componentEdges.map((edge) => edge.tier));
        if (strongest === 'TIER_3' && members.length < 3) continue;

        const supplyHeldTokens = members.reduce((sum, wallet) => sum + (balancesByWallet.get(wallet) || 0n), 0n);
        const supplyHeldPct = calculatePct(supplyHeldTokens, metadata.totalSupplyRaw);
        const containsBlockZero = members.filter((wallet) => blockZeroWallets.includes(wallet));
        const containsSnipers = members.filter((wallet) => sniperWallets.includes(wallet));
        const isDeployerCluster = members.includes(metadata.deployerAddress);
        const clusterId = `cluster-${++clusterIndex}`;
        const clusterName = isDeployerCluster
            ? 'Deployer-Linked Cluster'
            : containsBlockZero.length >= 2
                ? 'Block Zero Bundle Cluster'
                : containsSnipers.length >= 2
                    ? 'Sniper Coordination Cluster'
                    : `Launch Coordination Cluster ${clusterIndex}`;
        const dominantReasons = dedupe(componentEdges.map((edge) => edge.label)).slice(0, 4);

        walletClusters.push({
            clusterId,
            clusterName,
            evidenceTier: strongest,
            userEvidenceLabel: getTierLabel(strongest),
            walletCount: members.length,
            supplyHeldPct,
            supplyHeldTokens: supplyHeldTokens.toString(),
            whyGrouped: componentEdges[0]?.reason || 'Wallets share multiple launch and funding signals.',
            corroboratingSignals: dominantReasons,
            wallets: members,
            walletDetails: members
                .map((wallet) => ({
                    walletAddress: wallet,
                    currentHoldingsTokens: (balancesByWallet.get(wallet) || 0n).toString(),
                    currentHoldingsPct: calculatePct(balancesByWallet.get(wallet) || 0n, metadata.totalSupplyRaw),
                    flagReason: componentEdges.find((edge) => edge.from === wallet || edge.to === wallet)?.reason || 'Cluster-linked'
                }))
                .sort((left, right) => right.currentHoldingsPct - left.currentHoldingsPct)
        });

        clusterGraphClusters.push({
            clusterId,
            clusterName,
            walletCount: members.length,
            supplyHeldPct,
            tier: strongest
        });
    }

    const clusterIdByWallet = new Map<string, string>();
    for (const cluster of walletClusters) {
        for (const wallet of cluster.wallets) {
            clusterIdByWallet.set(wallet, cluster.clusterId);
        }
    }

    const networkLinkedWallets = dedupe(
        qualifyingEdges.flatMap((edge) => [edge.from, edge.to])
    ).filter((wallet) => !clusterIdByWallet.has(wallet) && (buyerSet.has(wallet) || balancesByWallet.has(wallet)));

    const independentWallets = [...balancesByWallet.entries()]
        .filter(([wallet, holdings]) => holdings > 0n && !clusterIdByWallet.has(wallet) && !networkLinkedWallets.includes(wallet))
        .sort((left, right) => {
            if (left[1] === right[1]) return 0;
            return left[1] > right[1] ? -1 : 1;
        })
        .slice(0, MAX_INDEPENDENT_GRAPH_WALLETS)
        .map(([wallet]) => wallet);

    const graphNodes: ForensicGraphNode[] = dedupe([
        ...walletClusters.flatMap((cluster) => cluster.wallets),
        ...networkLinkedWallets,
        ...independentWallets
    ]).map((wallet) => {
        const clusterId = clusterIdByWallet.get(wallet) || null;
        const holdings = balancesByWallet.get(wallet) || 0n;
        const role =
            wallet === metadata.deployerAddress ? 'deployer_linked' :
            blockZeroWallets.includes(wallet) ? 'block_zero' :
            sniperWallets.includes(wallet) ? 'sniper' :
            clusterId ? 'cluster_core' :
            networkLinkedWallets.includes(wallet) ? 'network_linked' :
            'independent';

        return {
            walletAddress: wallet,
            label: walletClusters.find((cluster) => cluster.clusterId === clusterId)?.clusterName || walletShort(wallet),
            clusterId,
            role,
            currentHoldingsTokens: holdings.toString(),
            currentHoldingsPct: calculatePct(holdings, metadata.totalSupplyRaw),
            flagReason: walletClusters.find((cluster) => cluster.clusterId === clusterId)?.whyGrouped
                || (networkLinkedWallets.includes(wallet)
                    ? 'Observed in expanded forensic network.'
                    : 'Independent holder outside the confirmed cluster set.')
        };
    });

    const graphEdges: ForensicGraphEdge[] = qualifyingEdges
        .filter((edge) => graphNodes.some((node) => node.walletAddress === edge.from) && graphNodes.some((node) => node.walletAddress === edge.to))
        .map((edge, index) => ({
            edgeId: `edge-${index + 1}`,
            sourceWallet: edge.from,
            targetWallet: edge.to,
            relationshipType:
                edge.label.includes('fund') ? 'funding' :
                edge.label.includes('transfer') ? 'transfer' :
                edge.label.includes('bundle') || edge.label.includes('slot') ? 'launch' :
                'distribution',
            displayLabel: edge.label.replace(/_/g, ' '),
            strengthScore: edge.score || (edge.tier === 'TIER_1' ? 8 : edge.tier === 'TIER_2' ? 6 : 4)
        }));

    return {
        walletClusters: walletClusters.sort((left, right) => right.supplyHeldPct - left.supplyHeldPct),
        graphNodes,
        graphEdges,
        graphClusters: clusterGraphClusters,
        networkLinkedWallets,
        evidenceTierCounts: {
            tier1: edges.filter((edge) => edge.tier === 'TIER_1').length,
            tier2: edges.filter((edge) => edge.tier === 'TIER_2').length,
            tier3: edges.filter((edge) => edge.tier === 'TIER_3').length
        }
    };
}

function buildEvidenceHighlights(args: {
    clusters: ForensicWalletCluster[];
    bundleCandidates: BundleCandidate[];
    blockZeroWallets: string[];
    sniperWallets: string[];
    jitoSignals: JitoSignalSummary;
    trackedHopDepth: number;
}) {
    const { clusters, bundleCandidates, blockZeroWallets, sniperWallets, jitoSignals, trackedHopDepth } = args;
    const highlights: ForensicEvidenceItem[] = [
        {
            title: 'Bundle candidate detection',
            tier: bundleCandidates.some((candidate) => candidate.tier === 'TIER_1')
                ? 'TIER_1'
                : bundleCandidates.some((candidate) => candidate.tier === 'TIER_2')
                    ? 'TIER_2'
                    : 'TIER_3',
            description: bundleCandidates.length
                ? `${bundleCandidates.length} inferred bundle candidate${bundleCandidates.length === 1 ? '' : 's'} were found across the launch cohort.`
                : 'No qualifying bundle candidates were emitted from the current launch sample.'
        },
        {
            title: 'Block-zero cluster coverage',
            tier: blockZeroWallets.length >= 2 ? 'TIER_2' : 'TIER_3',
            description: `${blockZeroWallets.length} wallet${blockZeroWallets.length === 1 ? '' : 's'} were observed at block zero and checked against cluster evidence.`
        },
        {
            title: 'Sniper window activity',
            tier: sniperWallets.length >= 2 ? 'TIER_2' : 'TIER_3',
            description: `${sniperWallets.length} wallet${sniperWallets.length === 1 ? '' : 's'} entered within five slots of the first observed launch buyer.`
        },
        {
            title: 'Jito-linked routing',
            tier: jitoSignals.inferredEdges.some((edge) => edge.tier === 'TIER_1')
                ? 'TIER_1'
                : jitoSignals.inferredEdges.length
                    ? 'TIER_2'
                    : 'TIER_3',
            description: jitoSignals.tippedBuyerWallets.length
                ? `${jitoSignals.tippedBuyerWallets.length} launch wallet${jitoSignals.tippedBuyerWallets.length === 1 ? '' : 's'} used Jito tip paths in the sampled landed transactions.`
                : 'No launch transactions in the sample showed a Jito tip payment.'
        },
        {
            title: 'Relationship hop tracking',
            tier: trackedHopDepth >= 4 ? 'TIER_2' : 'TIER_3',
            description: `The relationship graph expanded out to ${trackedHopDepth} hop${trackedHopDepth === 1 ? '' : 's'} for this scan.`
        }
    ];

    if (clusters.length) {
        highlights.unshift({
            title: 'Confirmed wallet clusters',
            tier: clusters[0].evidenceTier,
            description: `${clusters.length} coordinated wallet cluster${clusters.length === 1 ? '' : 's'} were confirmed in the forensic graph.`
        });
    }

    return highlights;
}

export async function analyzeForensicToken(tokenAddress: string): Promise<ForensicBundleReport> {
    const normalizedAddress = tokenAddress.trim();
    if (!isLikelySolanaAddress(normalizedAddress)) {
        throw new Error('The provided value is not a valid Solana contract address.');
    }

    const [metadata, largestAccounts, tokenAccounts, launchReconstruction, jitoTipAccounts] = await Promise.all([
        fetchTokenMetadata(normalizedAddress),
        fetchTokenLargestAccounts(normalizedAddress),
        fetchMintTokenAccounts(normalizedAddress),
        reconstructLaunchWindow(normalizedAddress),
        fetchJitoTipAccounts()
    ]);

    const [recentTransactions, launchTransactions] = await Promise.all([
        fetchParsedTransactions(launchReconstruction.recentSignatures.slice(0, RECENT_SIGNATURE_LIMIT).map((entry) => entry.signature)),
        fetchParsedTransactions(launchReconstruction.launchSignatures.map((entry) => entry.signature))
    ]);

    const rawLaunchEvents = extractBuyerEvents(normalizedAddress, launchTransactions).sort((left, right) => left.slot - right.slot);
    const fallbackLaunchEvents = extractBuyerEvents(normalizedAddress, recentTransactions).sort((left, right) => left.slot - right.slot);
    const effectiveLaunchEvents = rawLaunchEvents.length ? rawLaunchEvents : fallbackLaunchEvents;
    const effectiveLaunchTransactions = rawLaunchEvents.length ? launchTransactions : recentTransactions;
    const earliestSlot = effectiveLaunchEvents[0]?.slot;

    const launchBuyers = effectiveLaunchEvents
        .slice(0, 80)
        .map((event) => {
            const transaction = effectiveLaunchTransactions.find((entry) => getTxHash(entry) === event.txHash);
            const classification = classifyLaunchBuyer(normalizedAddress, event.wallet, transaction);
            return {
                ...event,
                ...classification,
                launchBand: getLaunchBand(event.slot, earliestSlot)
            } satisfies LaunchBuyer;
        })
        .filter((buyer) => buyer.acquisitionType !== 'internal_rebalance');

    const includedLaunchBuyers = dedupe(launchBuyers.map((buyer) => buyer.wallet))
        .map((wallet) => launchBuyers.find((buyer) => buyer.wallet === wallet))
        .filter((buyer): buyer is LaunchBuyer => Boolean(buyer))
        .slice(0, LAUNCH_BUYER_LIMIT);

    const blockZeroWallets = includedLaunchBuyers
        .filter((buyer) => earliestSlot !== undefined && buyer.slot === earliestSlot)
        .map((buyer) => buyer.wallet);
    const sniperWallets = includedLaunchBuyers
        .filter((buyer) => earliestSlot !== undefined && buyer.slot <= earliestSlot + 4)
        .map((buyer) => buyer.wallet);
    const topHolderWallets = tokenAccounts
        .slice()
        .sort((left, right) => Number(parseBigIntLike(right.amount) - parseBigIntLike(left.amount)))
        .map((account) => account.owner)
        .filter((wallet, index, wallets) => wallets.indexOf(wallet) === index)
        .slice(0, TOP_HOLDER_SEED_COUNT);
    const seedWallets = dedupe([
        ...includedLaunchBuyers.map((buyer) => buyer.wallet),
        ...topHolderWallets,
        metadata.deployerAddress
    ]).filter(isTrackableWalletAddress);

    const [{ fundingMap, usedWalletApi: usedWalletFundingApi }, { identityMap, usedWalletApi: usedWalletIdentityApi }] = await Promise.all([
        fetchWalletFundingSources(seedWallets),
        fetchWalletIdentities(seedWallets)
    ]);

    const expandedGraph = await expandTrackedGraph({
        tokenAddress: normalizedAddress,
        seedWallets,
        tokenAccounts,
        initialTransactions: [...launchTransactions, ...recentTransactions],
        initialFundingSources: fundingMap,
        initialIdentities: identityMap
    });

    const allTransactions = [...new Map(
        [...effectiveLaunchTransactions, ...recentTransactions, ...expandedGraph.transactions]
            .map((transaction) => [getTxHash(transaction), transaction] as const)
            .filter(([txHash]) => Boolean(txHash))
    ).values()];
    const allFundingEdges = extractFundingEdges(allTransactions);
    const allMintTransferEdges = extractMintTransferEdges(normalizedAddress, allTransactions);
    const { bundleCandidates, jitoSignals } = buildBundleCandidates({
        launchBuyers: includedLaunchBuyers,
        launchTransactions: effectiveLaunchTransactions,
        fundingSources: expandedGraph.fundingSources,
        fundingEdges: allFundingEdges,
        mintTransferEdges: allMintTransferEdges,
        blockZeroWallets,
        tipAccounts: jitoTipAccounts
    });
    const clusterGraph = buildClusterGraph({
        metadata,
        launchBuyers: includedLaunchBuyers,
        fundingEdges: allFundingEdges,
        mintTransferEdges: allMintTransferEdges,
        fundingSources: expandedGraph.fundingSources,
        bundleCandidates,
        hopDepthByWallet: expandedGraph.hopDepthByWallet,
        tokenAccounts,
        blockZeroWallets,
        sniperWallets
    });
    const balancesByWallet = new Map<string, bigint>();
    for (const account of tokenAccounts) {
        balancesByWallet.set(account.owner, (balancesByWallet.get(account.owner) || 0n) + parseBigIntLike(account.amount));
    }

    const deployerLinkedWallets = dedupe(tokenAccounts
        .filter((account) => account.owner === metadata.deployerAddress)
        .map((account) => account.owner));
    const clusteredWallets = dedupe(clusterGraph.walletClusters.flatMap((cluster) => cluster.wallets));
    const networkLinkedWallets = clusterGraph.networkLinkedWallets;
    const sumWalletBalances = (wallets: string[]) => wallets.reduce((sum, wallet) => sum + (balancesByWallet.get(wallet) || 0n), 0n);
    const deployerRaw = sumWalletBalances(deployerLinkedWallets);
    const blockZeroRaw = sumWalletBalances(blockZeroWallets);
    const sniperRaw = sumWalletBalances(sniperWallets);
    const clusteredRaw = sumWalletBalances(clusteredWallets);
    const networkRaw = sumWalletBalances(networkLinkedWallets);
    const coordinatedWallets = dedupe([
        ...deployerLinkedWallets,
        ...blockZeroWallets,
        ...sniperWallets,
        ...clusteredWallets,
        ...networkLinkedWallets
    ]);
    const coordinatedRaw = sumWalletBalances(coordinatedWallets);
    const remainingRaw = metadata.totalSupplyRaw > coordinatedRaw ? metadata.totalSupplyRaw - coordinatedRaw : 0n;
    const divisor = 10 ** metadata.decimals;
    const toUsd = (amount: bigint) =>
        metadata.currentPriceUsd === null
            ? null
            : round((Number(amount) / divisor) * metadata.currentPriceUsd, 2);
    const top10Pct = largestAccounts
        .slice(0, 10)
        .reduce((sum, account) => sum + calculatePct(parseRawAmount(account.amount), metadata.totalSupplyRaw), 0);
    const top20Pct = largestAccounts
        .slice(0, 20)
        .reduce((sum, account) => sum + calculatePct(parseRawAmount(account.amount), metadata.totalSupplyRaw), 0);
    const trackedHopDepth = Math.max(0, ...expandedGraph.hopWalletCounts
        .map((count, index) => count > 0 ? index + 1 : 0));
    const blockZeroBundleClusterCount = clusterGraph.walletClusters.filter((cluster) =>
        cluster.wallets.filter((wallet) => blockZeroWallets.includes(wallet)).length >= 2
    ).length;
    const coverageLevel = launchReconstruction.usedHeliusHistory
        ? ((expandedGraph.usedWalletApi || usedWalletFundingApi || usedWalletIdentityApi)
            ? 'full'
            : 'degraded_enrichment')
        : ((expandedGraph.usedWalletApi || usedWalletFundingApi || usedWalletIdentityApi)
            ? 'degraded_history'
            : 'degraded_history_and_enrichment');

    return {
        tokenAddress: normalizedAddress,
        tokenName: metadata.name,
        tokenSymbol: metadata.symbol,
        tokenDecimals: metadata.decimals,
        analysisTimestamp: new Date().toISOString(),
        launchTimestamp: metadata.launchTimestamp,
        implementationMode: 'live',
        launchSummary: {
            earliestObservedSlot: earliestSlot || null,
            launchBuyerCount: includedLaunchBuyers.length,
            blockZeroWallets: dedupe(blockZeroWallets),
            sniperWallets: dedupe(sniperWallets),
            launchBands: {
                block0Wallets: includedLaunchBuyers.filter((buyer) => buyer.launchBand === 'block_0').length,
                block15Wallets: includedLaunchBuyers.filter((buyer) => buyer.launchBand === 'block_1_5').length,
                block650Wallets: includedLaunchBuyers.filter((buyer) => buyer.launchBand === 'block_6_50').length,
                block51PlusWallets: includedLaunchBuyers.filter((buyer) => buyer.launchBand === 'block_51_plus').length
            }
        },
        supplyAttribution: {
            deployerLinkedPct: calculatePct(deployerRaw, metadata.totalSupplyRaw),
            blockZeroPct: calculatePct(blockZeroRaw, metadata.totalSupplyRaw),
            sniperPct: calculatePct(sniperRaw, metadata.totalSupplyRaw),
            clusteredPct: calculatePct(clusteredRaw, metadata.totalSupplyRaw),
            networkLinkedPct: calculatePct(networkRaw, metadata.totalSupplyRaw),
            remainingPct: calculatePct(remainingRaw, metadata.totalSupplyRaw),
            combinedCoordinatedPct: calculatePct(coordinatedRaw, metadata.totalSupplyRaw),
            estimatedClusterValueUsd: toUsd(clusteredRaw),
            estimatedCombinedValueUsd: toUsd(coordinatedRaw)
        },
        holderConcentration: {
            top10Pct: round(top10Pct, 2),
            top20Pct: round(top20Pct, 2)
        },
        bundleInsights: {
            inferredBundleCount: bundleCandidates.length,
            blockZeroBundleClusterCount,
            maxTrackedHops: FORENSIC_MAX_TRACKED_HOPS,
            trackedHopDepth,
            evidenceByTier: clusterGraph.evidenceTierCounts
        },
        scanStats: {
            walletsExpanded: expandedGraph.trackedWallets.length,
            transactionsDecoded: allTransactions.length,
            hopWalletCounts: expandedGraph.hopWalletCounts,
            usedHeliusHistory: launchReconstruction.usedHeliusHistory,
            usedWalletApi: expandedGraph.usedWalletApi || usedWalletFundingApi || usedWalletIdentityApi,
            historySource: launchReconstruction.usedHeliusHistory ? 'helius_ordered' : 'signature_paging',
            coverageLevel
        },
        walletClusters: clusterGraph.walletClusters,
        ecosystemGraph: {
            nodes: clusterGraph.graphNodes,
            edges: clusterGraph.graphEdges,
            clusters: clusterGraph.graphClusters
        },
        evidenceHighlights: buildEvidenceHighlights({
            clusters: clusterGraph.walletClusters,
            bundleCandidates,
            blockZeroWallets,
            sniperWallets,
            jitoSignals,
            trackedHopDepth
        }),
        notes: [
            APP_CONFIG.heliusKey
                ? 'This forensic engine is running in Helius-first mode where supported, with fallback Solana RPC used for resilience.'
                : 'This forensic engine is using fallback Solana RPC only, so bundle and cluster attribution may be weaker without Helius.',
            launchReconstruction.usedHeliusHistory
                ? `Launch reconstruction used Helius getTransactionsForAddress for ordered historical coverage across ${launchReconstruction.heliusPageCount} page${launchReconstruction.heliusPageCount === 1 ? '' : 's'}.`
                : `Launch reconstruction used signature paging and decoded transaction sampling because ordered Helius history was not available for this run.${launchReconstruction.degradedReason ? ` ${launchReconstruction.degradedReason}` : ''}`,
            expandedGraph.usedWalletApi || usedWalletFundingApi || usedWalletIdentityApi
                ? 'Wallet API enrichment contributed funded-by and identity signals to cluster scoring.'
                : 'Wallet API enrichment was unavailable, so cluster scoring relied on on-chain transaction evidence only.',
            `Relationship expansion was capped at ${FORENSIC_MAX_TRACKED_HOPS} hops and reached ${trackedHopDepth || 0} hop${trackedHopDepth === 1 ? '' : 's'} in this run.`,
            bundleCandidates.length
                ? `${bundleCandidates.length} inferred bundle candidate${bundleCandidates.length === 1 ? '' : 's'} were scored across the launch cohort, with ${blockZeroBundleClusterCount} block-zero-linked cluster${blockZeroBundleClusterCount === 1 ? '' : 's'}.`
                : 'No qualifying bundle candidates cleared the evidence thresholds in this launch sample.',
            jitoSignals.tippedBuyerWallets.length
                ? `Jito tip analysis linked ${jitoSignals.tippedBuyerWallets.length} launch wallet${jitoSignals.tippedBuyerWallets.length === 1 ? '' : 's'} to tipped execution patterns.`
                : 'No launch transactions in the analyzed sample paid into the live Jito tip-account set.',
            rawLaunchEvents.length === 0
                ? 'The engine fell back to recent decoded transactions because the reconstructed launch slice produced no positive buyer events.'
                : 'The engine used reconstructed launch history instead of only recent token activity.'
        ]
    };
}
