import { ChainRouter, type ChainType } from './ChainRouter';
import { SavedWalletService } from './SavedWalletService';
import { SmartMoneyQualificationService } from './SmartMoneyQualificationService';
import {
    classifySmartMoneyWallet,
    type SmartMoneyDecision,
    type SmartMoneyDiscoverySource,
    type SmartMoneyIntelligenceConfidence,
    type SmartMoneyNumericMetrics,
    type SmartMoneyProcessStatus,
    type SmartMoneyReasonCode,
    type SmartMoneyRiskFlag,
    type SmartMoneyScoreBreakdown,
    type SmartMoneyWalletType
} from './SmartMoneyWalletClassifier';
import { APP_CONFIG } from '../config';
import type { WalletStats } from '../hooks/useWalletPortfolio';
import type { SmartMoneyQualification } from '../types';
import { createClient } from '@supabase/supabase-js';

export type SmartMoneyScannerChain = 'solana' | 'eth' | 'base' | 'bsc' | 'polygon' | 'arbitrum' | 'optimism';
export type TokenJobStatus = 'queued' | 'discovering' | 'ready' | 'scanning' | 'completed' | 'failed';
export type WalletJobStatus = 'queued' | 'scanning' | 'qualified' | 'failed' | 'already_tracked' | 'tracked';

export type EarlyBuyer = {
    wallet: string;
    firstSeenAt: string | null;
    txHash: string | null;
    amountRaw: string;
    usdValue?: number;
    pairAddress?: string | null;
    exchange?: string | null;
    source?: 'moralis-swaps' | 'alchemy-transfers';
    confidence?: 'high' | 'low';
};

export type TokenScanJob = {
    id: string;
    tokenAddress: string;
    chain: SmartMoneyScannerChain;
    status: TokenJobStatus;
    createdAt: number;
    updatedAt: number;
    limit: number;
    buyersFound: number;
    walletsQueued: number;
    walletsScanned: number;
    qualifiedCount: number;
    failedCount: number;
    error?: string;
};

export type WalletScanJob = {
    id: string;
    tokenJobId: string;
    wallet: string;
    sourceToken: string;
    chain: SmartMoneyScannerChain;
    status: WalletJobStatus;
    createdAt: number;
    updatedAt: number;
    firstSeenAt: string | null;
    txHash: string | null;
    netWorth?: string;
    winRate?: string;
    pnl?: string;
    activePositions?: number | string;
    profitablePositions?: string;
    score?: number;
    qualification?: SmartMoneyQualification;
    buyerUsdValue?: number;
    pairAddress?: string | null;
    exchange?: string | null;
    source?: 'moralis-swaps' | 'alchemy-transfers';
    confidence?: 'high' | 'low';
    error?: string;
} & Partial<SmartMoneyNumericMetrics & SmartMoneyScoreBreakdown> & {
    processStatus?: SmartMoneyProcessStatus;
    decision?: SmartMoneyDecision;
    walletType?: SmartMoneyWalletType;
    intelligenceConfidence?: SmartMoneyIntelligenceConfidence;
    discoverySource?: SmartMoneyDiscoverySource;
    sourceTokenSymbol?: string | null;
    sourceTokenName?: string | null;
    firstBuyUsd?: number | null;
    firstBuyAmountRaw?: string | null;
    firstSeenTx?: string | null;
    reasonCodes?: SmartMoneyReasonCode[];
    riskFlags?: SmartMoneyRiskFlag[];
    decisionSummary?: string;
    savedToTracker?: boolean;
    actionTaken?: 'none' | 'saved' | 'tracked' | 'ignored';
};

type WalletScanMetrics = SmartMoneyNumericMetrics & {
    stats: WalletStats;
};

type ScannerState = {
    tokenJobs: TokenScanJob[];
    walletJobs: WalletScanJob[];
};

const STORAGE_KEY = 'atlaix-smart-money-scanner';
const DEFAULT_LIMIT = 100;
const PNL_ASSET_VALUE_FLOOR_USD = 1;
const PNL_ASSET_BATCH_SIZE = 4;
const hasSupabaseConfig = Boolean(APP_CONFIG.supabaseUrl && APP_CONFIG.supabaseAnonKey);
const supabase = hasSupabaseConfig
    ? createClient(APP_CONFIG.supabaseUrl, APP_CONFIG.supabaseAnonKey, {
        auth: {
            persistSession: false,
            autoRefreshToken: false
        }
    })
    : null;
let supabaseScannerAvailable = hasSupabaseConfig;
let supabaseScannerIntelligenceColumnsAvailable = true;
let warnedAboutScannerSupabase = false;
let warnedAboutScannerIntelligenceSchema = false;

function now() {
    return Date.now();
}

function buildId(prefix: string) {
    return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function readState(): ScannerState {
    try {
        const raw = window.localStorage.getItem(STORAGE_KEY);
        if (!raw) return { tokenJobs: [], walletJobs: [] };
        const parsed = JSON.parse(raw) as Partial<ScannerState>;
        return {
            tokenJobs: Array.isArray(parsed.tokenJobs) ? parsed.tokenJobs : [],
            walletJobs: Array.isArray(parsed.walletJobs) ? parsed.walletJobs.map(normalizeWalletJob) : []
        };
    } catch {
        return { tokenJobs: [], walletJobs: [] };
    }
}

function writeState(state: ScannerState) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    window.dispatchEvent(new CustomEvent('smart-money-scanner:update'));
}

function warnScannerSupabaseOnce(message: string) {
    if (warnedAboutScannerSupabase) return;
    warnedAboutScannerSupabase = true;
    console.warn(message);
}

function warnScannerIntelligenceSchemaOnce(message: string) {
    if (warnedAboutScannerIntelligenceSchema) return;
    warnedAboutScannerIntelligenceSchema = true;
    console.warn(message);
}

function canUseSupabaseScanner() {
    return Boolean(supabase && supabaseScannerAvailable);
}

function mapTokenJobRow(row: any): TokenScanJob {
    return {
        id: row.id,
        tokenAddress: row.token_address,
        chain: row.chain,
        status: row.status,
        createdAt: row.created_at_ms,
        updatedAt: row.updated_at_ms,
        limit: row.scan_limit ?? row.limit,
        buyersFound: row.buyers_found,
        walletsQueued: row.wallets_queued,
        walletsScanned: row.wallets_scanned,
        qualifiedCount: row.qualified_count,
        failedCount: row.failed_count,
        error: row.error || undefined
    };
}

function mapWalletJobRow(row: any): WalletScanJob {
    return normalizeWalletJob({
        id: row.id,
        tokenJobId: row.token_job_id,
        wallet: row.wallet,
        sourceToken: row.source_token,
        chain: row.chain,
        status: row.status,
        createdAt: row.created_at_ms,
        updatedAt: row.updated_at_ms,
        firstSeenAt: row.first_seen_at,
        txHash: row.tx_hash,
        netWorth: row.net_worth || undefined,
        winRate: row.win_rate || undefined,
        pnl: row.pnl || undefined,
        activePositions: row.active_positions ?? undefined,
        profitablePositions: row.profitable_positions || undefined,
        score: row.score ?? undefined,
        qualification: row.qualification || undefined,
        buyerUsdValue: row.buyer_usd_value ?? undefined,
        pairAddress: row.pair_address,
        exchange: row.exchange,
        source: row.source,
        confidence: row.confidence,
        error: row.error || undefined,
        processStatus: row.process_status,
        decision: row.decision,
        walletType: row.wallet_type,
        intelligenceConfidence: row.intelligence_confidence,
        discoverySource: row.discovery_source,
        sourceTokenSymbol: row.source_token_symbol,
        sourceTokenName: row.source_token_name,
        firstBuyUsd: row.first_buy_usd === null ? null : Number(row.first_buy_usd),
        firstBuyAmountRaw: row.first_buy_amount_raw,
        firstSeenTx: row.first_seen_tx,
        netWorthUsd: row.net_worth_usd === null ? null : Number(row.net_worth_usd),
        realizedPnlUsd: row.realized_pnl_usd === null ? null : Number(row.realized_pnl_usd),
        unrealizedPnlUsd: row.unrealized_pnl_usd === null ? null : Number(row.unrealized_pnl_usd),
        totalPnlUsd: row.total_pnl_usd === null ? null : Number(row.total_pnl_usd),
        pnlPct: row.pnl_pct === null ? null : Number(row.pnl_pct),
        winRatePct: row.win_rate_pct === null ? null : Number(row.win_rate_pct),
        capitalEfficiency: row.capital_efficiency === null ? null : Number(row.capital_efficiency),
        avgBuyUsd: row.avg_buy_usd === null ? null : Number(row.avg_buy_usd),
        tradesAnalyzed: row.trades_analyzed ?? null,
        winningTrades: row.winning_trades ?? null,
        losingTrades: row.losing_trades ?? null,
        tokensTraded: row.tokens_traded ?? null,
        daysActive: row.days_active === null ? null : Number(row.days_active),
        lastActiveAt: row.last_active_at,
        scoreTotal: row.score_total ?? null,
        scoreProfitability: row.score_profitability ?? null,
        scoreConsistency: row.score_consistency ?? null,
        scoreTiming: row.score_timing ?? null,
        scoreCapitalEfficiency: row.score_capital_efficiency ?? null,
        scoreRiskAdjusted: row.score_risk_adjusted ?? null,
        reasonCodes: row.reason_codes || undefined,
        riskFlags: row.risk_flags || undefined,
        decisionSummary: row.decision_summary,
        savedToTracker: row.saved_to_tracker ?? undefined,
        actionTaken: row.action_taken
    });
}

function tokenJobPayload(job: TokenScanJob) {
    return {
        id: job.id,
        token_address: job.tokenAddress,
        chain: job.chain,
        status: job.status,
        created_at_ms: job.createdAt,
        updated_at_ms: job.updatedAt,
        scan_limit: job.limit,
        buyers_found: job.buyersFound,
        wallets_queued: job.walletsQueued,
        wallets_scanned: job.walletsScanned,
        qualified_count: job.qualifiedCount,
        failed_count: job.failedCount,
        error: job.error || null
    };
}

function walletJobPayload(job: WalletScanJob) {
    return {
        id: job.id,
        token_job_id: job.tokenJobId,
        wallet: job.wallet,
        source_token: job.sourceToken,
        chain: job.chain,
        status: job.status,
        created_at_ms: job.createdAt,
        updated_at_ms: job.updatedAt,
        first_seen_at: job.firstSeenAt,
        tx_hash: job.txHash,
        net_worth: job.netWorth || null,
        win_rate: job.winRate || null,
        pnl: job.pnl || null,
        active_positions: job.activePositions === undefined ? null : String(job.activePositions),
        profitable_positions: job.profitablePositions || null,
        score: job.score ?? null,
        qualification: job.qualification || null,
        buyer_usd_value: job.buyerUsdValue ?? null,
        pair_address: job.pairAddress || null,
        exchange: job.exchange || null,
        source: job.source || null,
        confidence: job.confidence || null,
        error: job.error || null
    };
}

function walletJobPayloadWithIntelligence(job: WalletScanJob) {
    return {
        ...walletJobPayload(job),
        process_status: job.processStatus || null,
        decision: job.decision || null,
        wallet_type: job.walletType || null,
        intelligence_confidence: job.intelligenceConfidence || null,
        discovery_source: job.discoverySource || null,
        source_token_symbol: job.sourceTokenSymbol || null,
        source_token_name: job.sourceTokenName || null,
        first_buy_usd: job.firstBuyUsd ?? job.buyerUsdValue ?? null,
        first_buy_amount_raw: job.firstBuyAmountRaw || null,
        first_seen_tx: job.firstSeenTx || job.txHash || null,
        net_worth_usd: job.netWorthUsd ?? null,
        realized_pnl_usd: job.realizedPnlUsd ?? null,
        unrealized_pnl_usd: job.unrealizedPnlUsd ?? null,
        total_pnl_usd: job.totalPnlUsd ?? null,
        pnl_pct: job.pnlPct ?? null,
        win_rate_pct: job.winRatePct ?? null,
        capital_efficiency: job.capitalEfficiency ?? null,
        avg_buy_usd: job.avgBuyUsd ?? null,
        trades_analyzed: job.tradesAnalyzed ?? null,
        winning_trades: job.winningTrades ?? null,
        losing_trades: job.losingTrades ?? null,
        tokens_traded: job.tokensTraded ?? null,
        days_active: job.daysActive ?? null,
        last_active_at: job.lastActiveAt || null,
        score_total: job.scoreTotal ?? job.score ?? null,
        score_profitability: job.scoreProfitability ?? null,
        score_consistency: job.scoreConsistency ?? null,
        score_timing: job.scoreTiming ?? null,
        score_capital_efficiency: job.scoreCapitalEfficiency ?? null,
        score_risk_adjusted: job.scoreRiskAdjusted ?? job.score ?? null,
        reason_codes: job.reasonCodes || null,
        risk_flags: job.riskFlags || null,
        decision_summary: job.decisionSummary || null,
        saved_to_tracker: job.savedToTracker ?? null,
        action_taken: job.actionTaken || null
    };
}

async function syncTokenJob(job: TokenScanJob) {
    if (!canUseSupabaseScanner()) return;
    const { error } = await supabase!
        .from('smart_money_scan_jobs')
        .upsert(tokenJobPayload(job), { onConflict: 'id' });
    if (error) {
        warnScannerSupabaseOnce(`Smart Money scanner Supabase sync skipped: ${error.message}`);
        supabaseScannerAvailable = false;
    }
}

async function syncWalletJobs(jobs: WalletScanJob[]) {
    if (!jobs.length || !canUseSupabaseScanner()) return;
    const payloadBuilder = supabaseScannerIntelligenceColumnsAvailable ? walletJobPayloadWithIntelligence : walletJobPayload;
    const { error } = await supabase!
        .from('smart_money_scan_wallets')
        .upsert(jobs.map(payloadBuilder), { onConflict: 'id' });
    if (error) {
        if (supabaseScannerIntelligenceColumnsAvailable && /column|schema cache|PGRST204/i.test(error.message)) {
            supabaseScannerIntelligenceColumnsAvailable = false;
            warnScannerIntelligenceSchemaOnce(`Smart Money scanner is syncing legacy wallet fields only. Run supabase/smart_money_scanner.sql to store the new intelligence columns: ${error.message}`);
            const fallback = await supabase!
                .from('smart_money_scan_wallets')
                .upsert(jobs.map(walletJobPayload), { onConflict: 'id' });
            if (!fallback.error) return;
            warnScannerSupabaseOnce(`Smart Money scanner wallet sync skipped: ${fallback.error.message}`);
            supabaseScannerAvailable = false;
            return;
        }
        warnScannerSupabaseOnce(`Smart Money scanner wallet sync skipped: ${error.message}`);
        supabaseScannerAvailable = false;
    }
}

async function deleteCompletedFromSupabase(tokenJobIds: string[]) {
    if (!tokenJobIds.length || !canUseSupabaseScanner()) return;
    const { error } = await supabase!
        .from('smart_money_scan_jobs')
        .delete()
        .in('id', tokenJobIds);
    if (error) {
        warnScannerSupabaseOnce(`Smart Money scanner cleanup skipped: ${error.message}`);
        supabaseScannerAvailable = false;
    }
}

function scannerChainToPortfolioChain(chain: SmartMoneyScannerChain): ChainType {
    const map: Record<SmartMoneyScannerChain, ChainType> = {
        solana: 'Solana',
        eth: 'Ethereum',
        base: 'Base',
        bsc: 'BSC',
        polygon: 'Polygon',
        arbitrum: 'Arbitrum',
        optimism: 'Optimism'
    };
    return map[chain];
}

function normalizeWalletJob(job: WalletScanJob): WalletScanJob {
    const classification = classifySmartMoneyWallet({
        status: job.status,
        source: job.source,
        confidence: job.confidence,
        buyerUsdValue: job.buyerUsdValue ?? job.firstBuyUsd ?? null,
        score: job.score,
        qualification: job.qualification,
        netWorthUsd: job.netWorthUsd,
        realizedPnlUsd: job.realizedPnlUsd,
        unrealizedPnlUsd: job.unrealizedPnlUsd,
        totalPnlUsd: job.totalPnlUsd,
        pnlPct: job.pnlPct,
        winRatePct: job.winRatePct,
        capitalEfficiency: job.capitalEfficiency,
        avgBuyUsd: job.avgBuyUsd,
        tradesAnalyzed: job.tradesAnalyzed,
        winningTrades: job.winningTrades,
        losingTrades: job.losingTrades,
        tokensTraded: job.tokensTraded,
        daysActive: job.daysActive,
        lastActiveAt: job.lastActiveAt
    });

    return {
        ...job,
        firstBuyUsd: job.firstBuyUsd ?? job.buyerUsdValue ?? null,
        firstBuyAmountRaw: job.firstBuyAmountRaw ?? null,
        firstSeenTx: job.firstSeenTx ?? job.txHash ?? null,
        ...classification,
        decision: job.decision ?? classification.decision,
        walletType: job.walletType ?? classification.walletType,
        intelligenceConfidence: job.intelligenceConfidence ?? classification.intelligenceConfidence,
        reasonCodes: job.reasonCodes ?? classification.reasonCodes,
        riskFlags: job.riskFlags ?? classification.riskFlags,
        decisionSummary: job.decisionSummary ?? classification.decisionSummary
    };
}

function formatCurrency(value: number) {
    return value.toLocaleString('en-US', {
        style: 'currency',
        currency: 'USD',
        maximumFractionDigits: 2
    });
}

function parseUsdValue(value?: string | number | null) {
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    if (!value || value === 'N/A') return null;
    const parsed = Number(value.replace(/[$,\s]/g, ''));
    return Number.isFinite(parsed) ? parsed : null;
}

async function enrichPortfolioWithTokenPnl(
    portfolio: Awaited<ReturnType<typeof ChainRouter.fetchPortfolio>>,
    walletAddress: string,
    fallbackChain: ChainType
): Promise<Awaited<ReturnType<typeof ChainRouter.fetchPortfolio>>> {
    const assets = [...(portfolio.assets || [])];
    const activeIndexes = assets
        .map((asset, index) => ({ asset, index }))
        .filter(({ asset }) => (asset.rawValue || 0) > PNL_ASSET_VALUE_FLOOR_USD)
        .sort((left, right) => (right.asset.rawValue || 0) - (left.asset.rawValue || 0));

    for (let start = 0; start < activeIndexes.length; start += PNL_ASSET_BATCH_SIZE) {
        const batch = activeIndexes.slice(start, start + PNL_ASSET_BATCH_SIZE);
        const results = await Promise.all(batch.map(async ({ asset, index }) => {
            try {
                const assetChain = asset.chain || fallbackChain;
                const targetChain = assetChain === 'All Chains' ? fallbackChain : assetChain;
                const pnl = await ChainRouter.fetchTokenPnL(
                    targetChain,
                    walletAddress,
                    asset.address,
                    asset.currentPrice,
                    'ALL'
                );
                return { index, pnl };
            } catch (error) {
                console.warn(`Smart Money scanner PnL fetch failed for ${asset.symbol}`, error);
                return { index, pnl: null };
            }
        }));

        results.forEach(({ index, pnl }) => {
            if (!pnl) return;
            assets[index] = {
                ...assets[index],
                pnl: pnl.pnl,
                pnlPercent: pnl.pnlPercent,
                avgBuy: pnl.avgBuy,
                buyTime: pnl.buyTime
            };
        });
    }

    return {
        ...portfolio,
        assets
    };
}

function buildWalletMetricsFromPortfolio(portfolio: Awaited<ReturnType<typeof ChainRouter.fetchPortfolio>>): WalletScanMetrics {
    const assets = portfolio.assets || [];
    const netWorth = assets.reduce((sum, asset) => sum + (asset.rawValue || 0), 0);
    const activeAssets = assets.filter((asset) => (asset.rawValue || 0) > PNL_ASSET_VALUE_FLOOR_USD);
    const pnlAssets = activeAssets.filter((asset) => typeof asset.pnlPercent === 'number');
    const winners = pnlAssets.filter((asset) => (asset.pnlPercent || 0) > 0);
    const losingTrades = pnlAssets.filter((asset) => (asset.pnlPercent || 0) <= 0).length;
    const winRate = pnlAssets.length ? `${Math.round((winners.length / pnlAssets.length) * 100)}%` : 'N/A';
    let totalCostBasis = 0;
    let totalCurrentValueForPnl = 0;

    pnlAssets.forEach((asset) => {
        const pnlPercent = asset.pnlPercent || 0;
        const avgBuyPrice = parseUsdValue(asset.avgBuy);
        const estimatedUnits = asset.currentPrice > 0 ? (asset.rawValue || 0) / asset.currentPrice : 0;
        const denominator = 1 + (pnlPercent / 100);
        const costBasis = avgBuyPrice !== null && estimatedUnits > 0
            ? avgBuyPrice * estimatedUnits
            : denominator > 0
                ? (asset.rawValue || 0) / denominator
                : 0;
        if (costBasis <= 0) return;
        totalCostBasis += costBasis;
        totalCurrentValueForPnl += asset.rawValue || 0;
    });

    const totalPnlUsd = totalCostBasis > 0 ? totalCurrentValueForPnl - totalCostBasis : null;
    const pnlAverage = totalCostBasis > 0 ? (totalPnlUsd! / totalCostBasis) * 100 : null;
    const winRatePct = pnlAssets.length ? (winners.length / pnlAssets.length) * 100 : null;

    return {
        stats: {
            netWorth: formatCurrency(netWorth),
            winRate,
            totalPnL: pnlAverage === null ? 'N/A' : `${pnlAverage >= 0 ? '+' : ''}${pnlAverage.toFixed(2)}%`,
            activePositions: activeAssets.length,
            profitableTrader: winners.length.toString(),
            avgHoldTime: 'N/A'
        },
        netWorthUsd: netWorth,
        totalPnlUsd,
        pnlPct: pnlAverage,
        winRatePct,
        capitalEfficiency: pnlAverage,
        avgBuyUsd: pnlAssets.length && totalCostBasis > 0 ? totalCostBasis / pnlAssets.length : null,
        tradesAnalyzed: pnlAssets.length,
        winningTrades: winners.length,
        losingTrades,
        tokensTraded: activeAssets.length
    };
}

async function fetchJson(input: RequestInfo | URL, init?: RequestInit) {
    const url = typeof input === 'string' && input.startsWith('/api/') && APP_CONFIG.apiBaseUrl
        ? `${APP_CONFIG.apiBaseUrl.replace(/\/$/, '')}${input}`
        : input;
    const response = await fetch(url, init);
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
        throw new Error(typeof payload?.error === 'string' ? payload.error : `Scanner request failed with status ${response.status}.`);
    }
    return payload;
}

export const SmartMoneyScannerInternals = {
    buildWalletMetricsFromPortfolio,
    parseUsdValue
};

export const SmartMoneyScannerService = {
    defaultLimit: DEFAULT_LIMIT,

    subscribe(callback: () => void) {
        window.addEventListener('smart-money-scanner:update', callback);
        window.addEventListener('storage', callback);
        return () => {
            window.removeEventListener('smart-money-scanner:update', callback);
            window.removeEventListener('storage', callback);
        };
    },

    getState: readState,

    async hydrateState() {
        if (!canUseSupabaseScanner()) return readState();
        try {
            const [{ data: tokenRows, error: tokenError }, { data: walletRows, error: walletError }] = await Promise.all([
                supabase!
                    .from('smart_money_scan_jobs')
                    .select('*')
                    .order('created_at_ms', { ascending: false })
                    .limit(50),
                supabase!
                    .from('smart_money_scan_wallets')
                    .select('*')
                    .order('created_at_ms', { ascending: false })
                    .limit(1000)
            ]);

            if (tokenError || walletError) {
                throw tokenError || walletError;
            }

            const state = {
                tokenJobs: (tokenRows || []).map(mapTokenJobRow),
                walletJobs: (walletRows || []).map(mapWalletJobRow)
            };
            writeState(state);
            return state;
        } catch (error) {
            warnScannerSupabaseOnce(`Smart Money scanner is using local storage fallback: ${error instanceof Error ? error.message : 'Supabase read failed.'}`);
            supabaseScannerAvailable = false;
            return readState();
        }
    },

    async clearCompleted() {
        const state = readState();
        const activeTokenIds = new Set(state.tokenJobs
            .filter((job) => job.status !== 'completed' && job.status !== 'failed')
            .map((job) => job.id));
        const completedTokenIds = state.tokenJobs
            .filter((job) => job.status === 'completed' || job.status === 'failed')
            .map((job) => job.id);
        writeState({
            tokenJobs: state.tokenJobs.filter((job) => job.status !== 'completed' && job.status !== 'failed'),
            walletJobs: state.walletJobs.filter((job) => activeTokenIds.has(job.tokenJobId))
        });
        await deleteCompletedFromSupabase(completedTokenIds);
    },

    async createTokenJob(tokenAddress: string, chain: SmartMoneyScannerChain, limit = DEFAULT_LIMIT) {
        const trimmed = tokenAddress.trim();
        if (!trimmed) throw new Error('Enter a token contract address.');

        const state = readState();
        const job: TokenScanJob = {
            id: buildId('token'),
            tokenAddress: trimmed,
            chain,
            status: 'queued',
            createdAt: now(),
            updatedAt: now(),
            limit,
            buyersFound: 0,
            walletsQueued: 0,
            walletsScanned: 0,
            qualifiedCount: 0,
            failedCount: 0
        };

        writeState({
            ...state,
            tokenJobs: [job, ...state.tokenJobs]
        });
        await syncTokenJob(job);

        return job;
    },

    async discoverEarlyBuyers(tokenJobId: string) {
        const state = readState();
        const job = state.tokenJobs.find((entry) => entry.id === tokenJobId);
        if (!job) throw new Error('Token scan job was not found.');

        const discoveringJob = { ...job, status: 'discovering' as TokenJobStatus, updatedAt: now(), error: undefined };
        writeState({
            ...state,
            tokenJobs: state.tokenJobs.map((entry) => entry.id === tokenJobId ? discoveringJob : entry)
        });

        try {
            const payload = await fetchJson('/api/smart-money-scanner/early-buyers', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    tokenAddress: job.tokenAddress,
                    chain: job.chain,
                    limit: job.limit
                })
            }) as { buyers?: EarlyBuyer[] };

            const current = readState();
            const existingWallets = new Set(SavedWalletService.getWallets().map((wallet) => wallet.addr.toLowerCase()));
            const existingJobs = new Set(current.walletJobs.map((walletJob) => `${walletJob.chain}:${walletJob.wallet.toLowerCase()}`));
            const buyers = (payload.buyers || []).slice(0, job.limit);
            const walletJobs: WalletScanJob[] = buyers
                .filter((buyer) => buyer.wallet)
                .filter((buyer) => {
                    const key = `${job.chain}:${buyer.wallet.toLowerCase()}`;
                    if (existingJobs.has(key)) return false;
                    existingJobs.add(key);
                    return true;
                })
                .map((buyer) => normalizeWalletJob({
                    id: buildId('wallet'),
                    tokenJobId: job.id,
                    wallet: buyer.wallet,
                    sourceToken: job.tokenAddress,
                    chain: job.chain,
                    status: existingWallets.has(buyer.wallet.toLowerCase()) ? 'already_tracked' : 'queued',
                    createdAt: now(),
                    updatedAt: now(),
                    firstSeenAt: buyer.firstSeenAt,
                    txHash: buyer.txHash,
                    buyerUsdValue: buyer.usdValue,
                    firstBuyUsd: buyer.usdValue ?? null,
                    firstBuyAmountRaw: buyer.amountRaw,
                    firstSeenTx: buyer.txHash,
                    pairAddress: buyer.pairAddress,
                    exchange: buyer.exchange,
                    source: buyer.source,
                    confidence: buyer.confidence,
                    savedToTracker: existingWallets.has(buyer.wallet.toLowerCase()),
                    actionTaken: existingWallets.has(buyer.wallet.toLowerCase()) ? 'tracked' : 'none'
                }));

            const readyJob: TokenScanJob = {
                ...job,
                status: 'ready',
                updatedAt: now(),
                buyersFound: buyers.length,
                walletsQueued: walletJobs.filter((walletJob) => walletJob.status === 'queued').length,
                walletsScanned: walletJobs.filter((walletJob) => walletJob.status === 'already_tracked').length
            };

            writeState({
                tokenJobs: current.tokenJobs.map((entry) => entry.id === job.id ? readyJob : entry),
                walletJobs: [...walletJobs, ...current.walletJobs]
            });
            await Promise.all([
                syncTokenJob(readyJob),
                syncWalletJobs(walletJobs)
            ]);

            return readyJob;
        } catch (error) {
            const failedState = readState();
            writeState({
                ...failedState,
                tokenJobs: failedState.tokenJobs.map((entry) => entry.id === job.id
                    ? {
                        ...entry,
                        status: 'failed',
                        updatedAt: now(),
                        error: error instanceof Error ? error.message : 'Could not discover early buyers.'
                    }
                    : entry)
            });
            const failedJob = readState().tokenJobs.find((entry) => entry.id === job.id);
            if (failedJob) await syncTokenJob(failedJob);
            throw error;
        }
    },

    async scanNextWallet(tokenJobId: string) {
        const state = readState();
        const walletJob = state.walletJobs.find((entry) => entry.tokenJobId === tokenJobId && entry.status === 'queued');
        if (!walletJob) return null;

        writeState({
            ...state,
            tokenJobs: state.tokenJobs.map((entry) => entry.id === tokenJobId ? { ...entry, status: 'scanning', updatedAt: now() } : entry),
            walletJobs: state.walletJobs.map((entry) => entry.id === walletJob.id ? { ...entry, status: 'scanning', updatedAt: now() } : entry)
        });

        try {
            const portfolioChain = scannerChainToPortfolioChain(walletJob.chain);
            const portfolio = await ChainRouter.fetchPortfolio(portfolioChain, walletJob.wallet, true);
            const enrichedPortfolio = await enrichPortfolioWithTokenPnl(portfolio, walletJob.wallet, portfolioChain);
            const metrics = buildWalletMetricsFromPortfolio(enrichedPortfolio);
            const stats = metrics.stats;
            const qualification = SmartMoneyQualificationService.evaluate(stats);
            const trackedWallet = SavedWalletService.ensureTrackedWallet(
                walletJob.wallet,
                `Early buyer ${walletJob.wallet.slice(0, 6)}...${walletJob.wallet.slice(-4)}`
            );
            SavedWalletService.saveWallet(
                trackedWallet.addr,
                trackedWallet.name,
                Array.from(new Set([...(trackedWallet.categories || []), 'Early Buyer']))
            );
            SavedWalletService.updateWalletStats(walletJob.wallet, {
                bal: stats.netWorth,
                win: stats.winRate,
                pnl: stats.totalPnL
            }, stats);

            const nextStatus: WalletJobStatus = qualification.qualified ? 'qualified' : 'tracked';
            const classification = classifySmartMoneyWallet({
                ...metrics,
                status: nextStatus,
                source: walletJob.source,
                confidence: walletJob.confidence,
                buyerUsdValue: walletJob.buyerUsdValue ?? walletJob.firstBuyUsd ?? null,
                score: qualification.score,
                qualification
            });
            const current = readState();
            const nextWalletJobs = current.walletJobs.map((entry) => entry.id === walletJob.id
                ? {
                    ...entry,
                    ...classification,
                    status: nextStatus,
                    updatedAt: now(),
                    netWorth: stats.netWorth,
                    winRate: stats.winRate,
                    pnl: stats.totalPnL,
                    activePositions: stats.activePositions,
                    profitablePositions: stats.profitableTrader,
                    score: qualification.score,
                    qualification,
                    savedToTracker: true,
                    actionTaken: qualification.qualified ? 'saved' as const : 'tracked' as const
                }
                : entry);
            const jobWallets = nextWalletJobs.filter((entry) => entry.tokenJobId === tokenJobId);
            const remainingQueued = jobWallets.some((entry) => entry.status === 'queued' || entry.status === 'scanning');
            const qualifiedCount = jobWallets.filter((entry) => entry.status === 'qualified').length;
            const failedCount = jobWallets.filter((entry) => entry.status === 'failed').length;
            const walletsScanned = jobWallets.filter((entry) => ['qualified', 'tracked', 'failed', 'already_tracked'].includes(entry.status)).length;

            writeState({
                tokenJobs: current.tokenJobs.map((entry) => entry.id === tokenJobId
                    ? {
                        ...entry,
                        status: remainingQueued ? 'scanning' : 'completed',
                        updatedAt: now(),
                        walletsScanned,
                        qualifiedCount,
                        failedCount
                    }
                    : entry),
                walletJobs: nextWalletJobs
            });
            const nextTokenJob = readState().tokenJobs.find((entry) => entry.id === tokenJobId);
            const nextWalletJob = readState().walletJobs.find((entry) => entry.id === walletJob.id);
            await Promise.all([
                nextTokenJob ? syncTokenJob(nextTokenJob) : Promise.resolve(),
                nextWalletJob ? syncWalletJobs([nextWalletJob]) : Promise.resolve()
            ]);

            return walletJob;
        } catch (error) {
            const current = readState();
            const nextWalletJobs = current.walletJobs.map((entry) => entry.id === walletJob.id
                ? {
                    ...entry,
                    status: 'failed' as WalletJobStatus,
                    updatedAt: now(),
                    error: error instanceof Error ? error.message : 'Wallet performance scan failed.'
                }
                : entry);
            const jobWallets = nextWalletJobs.filter((entry) => entry.tokenJobId === tokenJobId);
            const failedCount = jobWallets.filter((entry) => entry.status === 'failed').length;
            const walletsScanned = jobWallets.filter((entry) => ['qualified', 'tracked', 'failed', 'already_tracked'].includes(entry.status)).length;
            const remainingQueued = jobWallets.some((entry) => entry.status === 'queued' || entry.status === 'scanning');

            writeState({
                tokenJobs: current.tokenJobs.map((entry) => entry.id === tokenJobId
                    ? {
                        ...entry,
                        status: remainingQueued ? 'scanning' : 'completed',
                        updatedAt: now(),
                        walletsScanned,
                        failedCount
                    }
                    : entry),
                walletJobs: nextWalletJobs
            });
            const nextTokenJob = readState().tokenJobs.find((entry) => entry.id === tokenJobId);
            const nextWalletJob = readState().walletJobs.find((entry) => entry.id === walletJob.id);
            await Promise.all([
                nextTokenJob ? syncTokenJob(nextTokenJob) : Promise.resolve(),
                nextWalletJob ? syncWalletJobs([nextWalletJob]) : Promise.resolve()
            ]);
            return walletJob;
        }
    }
};
