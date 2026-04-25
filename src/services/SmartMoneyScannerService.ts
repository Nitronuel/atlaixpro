import { ChainRouter, type ChainType } from './ChainRouter';
import { SavedWalletService } from './SavedWalletService';
import { SmartMoneyQualificationService } from './SmartMoneyQualificationService';
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
};

type ScannerState = {
    tokenJobs: TokenScanJob[];
    walletJobs: WalletScanJob[];
};

const STORAGE_KEY = 'atlaix-smart-money-scanner';
const DEFAULT_LIMIT = 100;
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
let warnedAboutScannerSupabase = false;

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
            walletJobs: Array.isArray(parsed.walletJobs) ? parsed.walletJobs : []
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
    return {
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
        error: row.error || undefined
    };
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
    const { error } = await supabase!
        .from('smart_money_scan_wallets')
        .upsert(jobs.map(walletJobPayload), { onConflict: 'id' });
    if (error) {
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

function formatCurrency(value: number) {
    return value.toLocaleString('en-US', {
        style: 'currency',
        currency: 'USD',
        maximumFractionDigits: 2
    });
}

function buildWalletStatsFromPortfolio(portfolio: Awaited<ReturnType<typeof ChainRouter.fetchPortfolio>>): WalletStats {
    const assets = portfolio.assets || [];
    const netWorth = assets.reduce((sum, asset) => sum + (asset.rawValue || 0), 0);
    const activeAssets = assets.filter((asset) => (asset.rawValue || 0) > 1);
    const pnlAssets = activeAssets.filter((asset) => typeof asset.pnlPercent === 'number');
    const winners = pnlAssets.filter((asset) => (asset.pnlPercent || 0) > 0);
    const winRate = pnlAssets.length ? `${Math.round((winners.length / pnlAssets.length) * 100)}%` : 'N/A';
    const pnlAverage = pnlAssets.length
        ? pnlAssets.reduce((sum, asset) => sum + (asset.pnlPercent || 0), 0) / pnlAssets.length
        : null;

    return {
        netWorth: formatCurrency(netWorth),
        winRate,
        totalPnL: pnlAverage === null ? 'N/A' : `${pnlAverage >= 0 ? '+' : ''}${pnlAverage.toFixed(2)}%`,
        activePositions: activeAssets.length,
        profitableTrader: winners.length.toString(),
        avgHoldTime: 'N/A'
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
                .map((buyer) => ({
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
                    pairAddress: buyer.pairAddress,
                    exchange: buyer.exchange,
                    source: buyer.source,
                    confidence: buyer.confidence
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
            const portfolio = await ChainRouter.fetchPortfolio(scannerChainToPortfolioChain(walletJob.chain), walletJob.wallet, true);
            const stats = buildWalletStatsFromPortfolio(portfolio);
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
            const current = readState();
            const nextWalletJobs = current.walletJobs.map((entry) => entry.id === walletJob.id
                ? {
                    ...entry,
                    status: nextStatus,
                    updatedAt: now(),
                    netWorth: stats.netWorth,
                    winRate: stats.winRate,
                    pnl: stats.totalPnL,
                    activePositions: stats.activePositions,
                    profitablePositions: stats.profitableTrader,
                    score: qualification.score,
                    qualification
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
