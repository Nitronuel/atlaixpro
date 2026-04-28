import React, { useEffect, useMemo, useState } from 'react';
import { Activity, CheckCircle, Clock3, Loader2, Play, Plus, RefreshCw, Search, Trash2, Wallet, XCircle, Zap } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import {
    SmartMoneyScannerService,
    type SmartMoneyScannerChain,
    type TokenScanJob,
    type WalletScanJob
} from '../services/SmartMoneyScannerService';

const CHAIN_OPTIONS: Array<{ id: SmartMoneyScannerChain; label: string }> = [
    { id: 'eth', label: 'Ethereum' },
    { id: 'solana', label: 'Solana' },
    { id: 'base', label: 'Base' },
    { id: 'bsc', label: 'BNB Chain' },
    { id: 'polygon', label: 'Polygon' },
    { id: 'arbitrum', label: 'Arbitrum' },
    { id: 'optimism', label: 'Optimism' }
];

const STATUS_LABEL: Record<string, string> = {
    queued: 'Queued',
    discovering: 'Discovering',
    ready: 'Ready',
    scanning: 'Scanning',
    completed: 'Completed',
    failed: 'Failed',
    qualified: 'Qualified',
    tracked: 'Tracked',
    already_tracked: 'Already tracked'
};

const shorten = (value: string) => value.length > 14 ? `${value.slice(0, 6)}...${value.slice(-4)}` : value;

const statusTone = (status: string) => {
    if (status === 'qualified' || status === 'completed') return 'border-primary-green/20 bg-primary-green/10 text-primary-green';
    if (status === 'failed') return 'border-primary-red/20 bg-primary-red/10 text-primary-red';
    if (status === 'scanning' || status === 'discovering') return 'border-primary-yellow/20 bg-primary-yellow/10 text-primary-yellow';
    return 'border-border bg-card text-[#A6B4CF]';
};

const statusIcon = (status: string) => {
    if (status === 'qualified' || status === 'completed') return <CheckCircle size={14} />;
    if (status === 'failed') return <XCircle size={14} />;
    if (status === 'scanning' || status === 'discovering') return <Loader2 size={14} className="animate-spin" />;
    return <Clock3 size={14} />;
};

const sourceLabel = (job: WalletScanJob) => {
    if (job.discoverySource === 'early_buy_swap' || job.source === 'moralis-swaps') return 'Early buy';
    if (job.discoverySource === 'transfer_recipient' || job.source === 'alchemy-transfers') return 'Early transfer';
    return 'Unknown';
};

const confidenceTone = (confidence?: WalletScanJob['intelligenceConfidence'] | WalletScanJob['confidence']) => (
    confidence === 'high'
        ? 'border-primary-green/20 bg-primary-green/10 text-primary-green'
        : confidence === 'medium'
            ? 'border-primary-yellow/20 bg-primary-yellow/10 text-primary-yellow'
            : 'border-border bg-card text-[#A6B4CF]'
);

const DECISION_LABEL: Record<string, string> = {
    qualified: 'Qualified',
    watchlist: 'Watchlist',
    needs_review: 'Review',
    rejected: 'Rejected'
};

const WALLET_TYPE_LABEL: Record<string, string> = {
    early_accumulator: 'Early accumulator',
    consistent_profitable_trader: 'Profitable trader',
    high_conviction_holder: 'Conviction holder',
    whale_capital_wallet: 'Whale capital',
    needs_review: 'Needs review',
    unknown: 'Unknown'
};

const decisionTone = (decision?: WalletScanJob['decision']) => {
    if (decision === 'qualified') return 'border-primary-green/20 bg-primary-green/10 text-primary-green';
    if (decision === 'watchlist') return 'border-primary-yellow/20 bg-primary-yellow/10 text-primary-yellow';
    if (decision === 'rejected') return 'border-primary-red/20 bg-primary-red/10 text-primary-red';
    return 'border-border bg-card text-[#A6B4CF]';
};

const formatCurrencyValue = (value?: number | null, fallback?: string) => {
    if (typeof value === 'number' && Number.isFinite(value)) {
        return value.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
    }
    return fallback || '-';
};

const formatPercentValue = (value?: number | null, fallback?: string) => {
    if (typeof value === 'number' && Number.isFinite(value)) {
        return `${value >= 0 ? '+' : ''}${value.toFixed(1)}%`;
    }
    return fallback || '-';
};

const formatPlainPercent = (value?: number | null, fallback?: string) => {
    if (typeof value === 'number' && Number.isFinite(value)) return `${value.toFixed(0)}%`;
    return fallback || '-';
};

const StatTile: React.FC<{ label: string; value: string | number; icon: React.ReactNode }> = ({ label, value, icon }) => (
    <div className="rounded-2xl border border-border bg-card p-5">
        <div className="mb-3 flex items-center justify-between gap-3">
            <div className="text-xs font-bold uppercase tracking-[0.22em] text-text-medium">{label}</div>
            <div className="text-primary-green">{icon}</div>
        </div>
        <div className="text-3xl font-black text-text-light">{value}</div>
    </div>
);

export const SmartMoneyScanner: React.FC = () => {
    const navigate = useNavigate();
    const [tokenAddress, setTokenAddress] = useState('');
    const [chain, setChain] = useState<SmartMoneyScannerChain>('eth');
    const [limit, setLimit] = useState(100);
    const [state, setState] = useState(() => SmartMoneyScannerService.getState());
    const [error, setError] = useState<string | null>(null);
    const [activeJobId, setActiveJobId] = useState<string | null>(null);
    const [runningJobId, setRunningJobId] = useState<string | null>(null);

    useEffect(() => {
        let mounted = true;
        SmartMoneyScannerService.hydrateState().then((nextState) => {
            if (mounted) setState(nextState);
        });
        const unsubscribe = SmartMoneyScannerService.subscribe(() => {
            setState(SmartMoneyScannerService.getState());
        });
        return () => {
            mounted = false;
            unsubscribe();
        };
    }, []);

    const activeTokenJob = activeJobId
        ? state.tokenJobs.find((job) => job.id === activeJobId) || null
        : state.tokenJobs[0] || null;
    const activeWalletJobs = activeTokenJob
        ? state.walletJobs.filter((job) => job.tokenJobId === activeTokenJob.id)
        : [];

    const totals = useMemo(() => {
        const walletJobs = state.walletJobs;
        return {
            tokens: state.tokenJobs.length,
            queued: walletJobs.filter((job) => job.status === 'queued').length,
            scanned: walletJobs.filter((job) => ['qualified', 'tracked', 'failed', 'already_tracked'].includes(job.status)).length,
            qualified: walletJobs.filter((job) => job.status === 'qualified').length
        };
    }, [state]);

    const createJob = async () => {
        setError(null);
        try {
            const job = await SmartMoneyScannerService.createTokenJob(tokenAddress, chain, limit);
            setTokenAddress('');
            setActiveJobId(job.id);
            await SmartMoneyScannerService.discoverEarlyBuyers(job.id);
        } catch (nextError) {
            setError(nextError instanceof Error ? nextError.message : 'Could not start scanner job.');
        }
    };

    const runWalletQueue = async (job: TokenScanJob) => {
        if (runningJobId) return;
        setRunningJobId(job.id);
        setError(null);
        try {
            let scanned = 0;
            while (scanned < job.limit) {
                const result = await SmartMoneyScannerService.scanNextWallet(job.id);
                if (!result) break;
                scanned += 1;
            }
        } catch (nextError) {
            setError(nextError instanceof Error ? nextError.message : 'Wallet queue scan failed.');
        } finally {
            setRunningJobId(null);
        }
    };

    const retryDiscovery = async (job: TokenScanJob) => {
        setError(null);
        try {
            setActiveJobId(job.id);
            await SmartMoneyScannerService.discoverEarlyBuyers(job.id);
        } catch (nextError) {
            setError(nextError instanceof Error ? nextError.message : 'Could not retry discovery.');
        }
    };

    return (
        <div className="flex w-full max-w-[1600px] flex-col gap-6 pb-8 animate-fade-in">
            <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
                <div>
                    <div className="mb-2 text-xs font-bold uppercase tracking-[0.28em] text-primary-green">Automation</div>
                    <h2 className="text-3xl font-black tracking-tight text-text-light">Early Buyer Smart Money Scanner</h2>
                    <p className="mt-2 max-w-3xl text-base leading-7 text-text-medium">
                        Queue a token, discover early buyer wallets, track those wallets, and let the Smart Money rules decide which wallets deserve promotion.
                    </p>
                </div>
                <button
                    onClick={() => navigate('/smart-money')}
                    className="rounded-xl border border-border bg-card px-4 py-2.5 text-sm font-bold text-text-light transition-colors hover:border-primary-green/40"
                >
                    Back to Smart Money
                </button>
            </div>

            <form
                onSubmit={(event) => {
                    event.preventDefault();
                    void createJob();
                }}
                className="grid gap-3 rounded-2xl border border-border bg-card p-4 lg:grid-cols-[180px_140px_1fr_180px]"
            >
                <select
                    value={chain}
                    onChange={(event) => setChain(event.target.value as SmartMoneyScannerChain)}
                    className="rounded-xl border border-border bg-[#16181A] px-4 py-3 text-sm font-bold text-text-light outline-none focus:border-primary-green/60"
                >
                    {CHAIN_OPTIONS.map((option) => (
                        <option key={option.id} value={option.id}>{option.label}</option>
                    ))}
                </select>
                <select
                    value={limit}
                    onChange={(event) => setLimit(Number(event.target.value))}
                    className="rounded-xl border border-border bg-[#16181A] px-4 py-3 text-sm font-bold text-text-light outline-none focus:border-primary-green/60"
                >
                    <option value={50}>First 50</option>
                    <option value={100}>First 100</option>
                    <option value={200}>First 200</option>
                    <option value={300}>First 300</option>
                </select>
                <div className="rounded-xl border border-border bg-[#16181A] px-4 focus-within:border-primary-green/60">
                    <input
                        value={tokenAddress}
                        onChange={(event) => {
                            const value = event.target.value;
                            setTokenAddress(value);
                            if (value.trim().startsWith('0x') && chain === 'solana') {
                                setChain('eth');
                            }
                        }}
                        placeholder="Paste token contract address"
                        className="w-full bg-transparent py-3 text-sm text-text-light outline-none placeholder:text-text-dark"
                    />
                </div>
                <button
                    type="submit"
                    disabled={!tokenAddress.trim()}
                    className="flex items-center justify-center gap-2 rounded-xl bg-primary-green px-5 py-3 text-sm font-black text-main transition-colors hover:bg-primary-green-darker disabled:cursor-not-allowed disabled:bg-card-hover disabled:text-text-medium"
                >
                    <Plus size={17} />
                    Start Scan
                </button>
            </form>

            {error && (
                <div className="rounded-xl border border-primary-red/20 bg-primary-red/10 px-4 py-3 text-sm font-semibold text-primary-red">
                    {error}
                </div>
            )}

            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                <StatTile label="Token jobs" value={totals.tokens} icon={<Search size={20} />} />
                <StatTile label="Wallets queued" value={totals.queued} icon={<Clock3 size={20} />} />
                <StatTile label="Wallets scanned" value={totals.scanned} icon={<Activity size={20} />} />
                <StatTile label="Qualified" value={totals.qualified} icon={<Zap size={20} />} />
            </div>

            <div className="grid min-h-[520px] gap-6 xl:grid-cols-[420px_1fr]">
                <section className="rounded-2xl border border-border bg-card p-4">
                    <div className="mb-4 flex items-center justify-between gap-3">
                        <h3 className="text-lg font-black text-text-light">Token Queue</h3>
                        <button
                            onClick={() => void SmartMoneyScannerService.clearCompleted()}
                            className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-xs font-bold text-text-medium transition-colors hover:text-text-light"
                        >
                            <Trash2 size={14} />
                            Clear done
                        </button>
                    </div>
                    <div className="flex flex-col gap-3">
                        {state.tokenJobs.length ? state.tokenJobs.map((job) => (
                            <button
                                key={job.id}
                                onClick={() => setActiveJobId(job.id)}
                                className={`rounded-xl border p-4 text-left transition-colors ${activeTokenJob?.id === job.id ? 'border-primary-green/40 bg-primary-green/5' : 'border-border bg-[#16181A] hover:border-border/80'}`}
                            >
                                <div className="mb-3 flex items-center justify-between gap-3">
                                    <div className="font-mono text-sm font-bold text-text-light">{shorten(job.tokenAddress)}</div>
                                    <div className={`flex items-center gap-1.5 rounded-full border px-2 py-1 text-[11px] font-bold ${statusTone(job.status)}`}>
                                        {statusIcon(job.status)}
                                        {STATUS_LABEL[job.status]}
                                    </div>
                                </div>
                                <div className="grid grid-cols-3 gap-2 text-xs text-text-medium">
                                    <div><span className="block font-bold text-text-light">{job.buyersFound}</span>buyers</div>
                                    <div><span className="block font-bold text-text-light">{job.walletsScanned}</span>scanned</div>
                                    <div><span className="block font-bold text-primary-green">{job.qualifiedCount}</span>qualified</div>
                                </div>
                            </button>
                        )) : (
                            <div className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-text-medium">
                                No token scans yet.
                            </div>
                        )}
                    </div>
                </section>

                <section className="rounded-2xl border border-border bg-card p-4 min-w-0">
                    <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                        <div>
                            <h3 className="text-lg font-black text-text-light">Wallet Scan Queue</h3>
                            <p className="text-sm text-text-medium">
                                {activeTokenJob ? `${shorten(activeTokenJob.tokenAddress)} on ${CHAIN_OPTIONS.find((option) => option.id === activeTokenJob.chain)?.label}` : 'Select a token job to inspect wallets.'}
                            </p>
                        </div>
                        {activeTokenJob && (
                            <div className="flex flex-wrap gap-2">
                                <button
                                    onClick={() => void retryDiscovery(activeTokenJob)}
                                    disabled={activeTokenJob.status === 'discovering' || runningJobId === activeTokenJob.id}
                                    className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-xs font-bold text-text-light transition-colors hover:border-primary-green/40 disabled:opacity-50"
                                >
                                    <RefreshCw size={14} />
                                    Discover
                                </button>
                                <button
                                    onClick={() => void runWalletQueue(activeTokenJob)}
                                    disabled={runningJobId === activeTokenJob.id || !activeWalletJobs.some((job) => job.status === 'queued')}
                                    className="flex items-center gap-2 rounded-lg bg-primary-green px-3 py-2 text-xs font-black text-main transition-colors hover:bg-primary-green-darker disabled:bg-card-hover disabled:text-text-medium"
                                >
                                    {runningJobId === activeTokenJob.id ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
                                    Scan wallets
                                </button>
                            </div>
                        )}
                    </div>

                    <div className="overflow-x-auto">
                        <table className="w-full min-w-[1420px] border-separate border-spacing-y-2 text-left">
                            <thead>
                                <tr className="text-xs uppercase tracking-[0.18em] text-text-dark">
                                    <th className="px-3 py-2">Wallet</th>
                                    <th className="px-3 py-2">Decision</th>
                                    <th className="px-3 py-2">Wallet type</th>
                                    <th className="px-3 py-2">Confidence</th>
                                    <th className="px-3 py-2">Source token</th>
                                    <th className="px-3 py-2">Discovery source</th>
                                    <th className="px-3 py-2">Net worth</th>
                                    <th className="px-3 py-2">Win rate</th>
                                    <th className="px-3 py-2">PnL</th>
                                    <th className="px-3 py-2">Cap efficiency</th>
                                    <th className="px-3 py-2">Avg buy</th>
                                    <th className="px-3 py-2">Score</th>
                                    <th className="px-3 py-2">Action</th>
                                </tr>
                            </thead>
                            <tbody>
                                {activeWalletJobs.length ? activeWalletJobs.map((job) => (
                                    <tr key={job.id} className="bg-[#16181A] text-sm">
                                        <td className="rounded-l-xl px-3 py-3">
                                            <div className="font-mono font-bold text-text-light">{shorten(job.wallet)}</div>
                                            <div className="text-xs text-text-dark">{job.firstSeenAt ? new Date(job.firstSeenAt).toLocaleString() : 'Early transfer'}</div>
                                        </td>
                                        <td className="px-3 py-3">
                                            <div className={`inline-flex rounded-full border px-2 py-1 text-[11px] font-bold ${decisionTone(job.decision)}`}>
                                                {DECISION_LABEL[job.decision || 'needs_review'] || 'Review'}
                                            </div>
                                            <div className="mt-1 max-w-[220px] truncate text-xs text-text-dark" title={job.decisionSummary}>
                                                {job.decisionSummary || STATUS_LABEL[job.status]}
                                            </div>
                                        </td>
                                        <td className="px-3 py-3 text-text-medium">
                                            {WALLET_TYPE_LABEL[job.walletType || 'unknown'] || 'Unknown'}
                                        </td>
                                        <td className="px-3 py-3">
                                            <div className={`inline-flex rounded-full border px-2 py-1 text-[11px] font-bold ${confidenceTone(job.intelligenceConfidence || job.confidence)}`}>
                                                {(job.intelligenceConfidence || job.confidence || 'low').toUpperCase()}
                                            </div>
                                            <div className="mt-1 flex items-center gap-1.5 text-xs text-text-dark">
                                                {statusIcon(job.status)}
                                                {STATUS_LABEL[job.status]}
                                            </div>
                                        </td>
                                        <td className="px-3 py-3">
                                            <div className="font-mono text-xs font-bold text-text-light">{shorten(job.sourceToken)}</div>
                                            <div className="mt-1 text-xs text-text-dark">{job.chain.toUpperCase()}</div>
                                        </td>
                                        <td className="px-3 py-3">
                                            <div className={`inline-flex rounded-full border px-2 py-1 text-[11px] font-bold ${confidenceTone(job.confidence)}`}>
                                                {sourceLabel(job)}
                                            </div>
                                            <div className="mt-1 text-xs text-text-dark">
                                                {job.exchange || (job.firstBuyUsd || job.buyerUsdValue ? formatCurrencyValue(job.firstBuyUsd ?? job.buyerUsdValue) : '')}
                                            </div>
                                        </td>
                                        <td className="px-3 py-3 font-semibold text-text-light">{formatCurrencyValue(job.netWorthUsd, job.netWorth)}</td>
                                        <td className="px-3 py-3 text-text-medium">{formatPlainPercent(job.winRatePct, job.winRate)}</td>
                                        <td className="px-3 py-3 text-text-medium">{formatPercentValue(job.pnlPct, job.pnl)}</td>
                                        <td className="px-3 py-3 text-text-medium">{formatPercentValue(job.capitalEfficiency)}</td>
                                        <td className="px-3 py-3 text-text-medium">{formatCurrencyValue(job.avgBuyUsd)}</td>
                                        <td className="px-3 py-3">
                                            <div className="font-bold text-text-light">{job.scoreRiskAdjusted ?? job.scoreTotal ?? job.score ?? '-'}</div>
                                            <div className="text-xs text-text-dark">{job.tradesAnalyzed ?? 0} samples</div>
                                        </td>
                                        <td className="rounded-r-xl px-3 py-3">
                                            <button
                                                onClick={() => navigate(`/wallet/${job.wallet}`)}
                                                className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-xs font-bold text-text-light transition-colors hover:border-primary-green/40"
                                            >
                                                <Wallet size={14} />
                                                Open
                                            </button>
                                        </td>
                                    </tr>
                                )) : (
                                    <tr>
                                        <td colSpan={13} className="rounded-xl border border-dashed border-border px-4 py-12 text-center text-sm text-text-medium">
                                            Early buyers will appear here after discovery.
                                        </td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                </section>
            </div>
        </div>
    );
};

export default SmartMoneyScanner;
