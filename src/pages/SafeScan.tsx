// Atlaix: Route-level product screen for the Atlaix application.
import React, { useState } from 'react';
import { CheckCircle2, Copy, Loader2, ShieldCheck } from 'lucide-react';
import { ForensicBundleSection } from '../components/safe-scan/ForensicBundleSection';
import { SafeScanService, type AlchemyHubChain, type ForensicBundleReport } from '../services/SafeScanService';
import { ALCHEMY_HUB_CHAINS } from '../services/forensics/alchemy-hub-chains';
import { GoPlusService, type SecurityReport } from '../services/GoPlusService';

const shortenAddress = (value: string) => `${value.slice(0, 4)}...${value.slice(-4)}`;

const formatUsd = (value: number | null | undefined) => {
    if (value === null || value === undefined || !Number.isFinite(value)) return 'N/A';
    return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
        maximumFractionDigits: value >= 1000 ? 0 : 2
    }).format(value);
};

const formatPct = (value: number | null | undefined) => {
    if (value === null || value === undefined || !Number.isFinite(value)) return 'N/A';
    return `${value.toFixed(value >= 10 ? 1 : 2)}%`;
};

const scanSecurityChain = (chain: AlchemyHubChain) => {
    if (chain === 'eth') return 'ethereum';
    return chain;
};

const statusTone = (safe: boolean | null) => {
    if (safe === null) return 'border-border bg-card-hover text-[#8FA0BF]';
    return safe
        ? 'border-primary-green/20 bg-primary-green/10 text-primary-green'
        : 'border-primary-red/20 bg-primary-red/10 text-primary-red';
};

const FlagRow: React.FC<{ label: string; value: string; safe: boolean | null }> = ({ label, value, safe }) => (
    <div className="flex items-center justify-between gap-3 border-b border-border/70 py-3 last:border-b-0">
        <div className="flex min-w-0 items-center gap-2 text-sm font-semibold text-[#A6B4CF]">
            <CheckCircle2 size={17} className="shrink-0 text-[#8FA0BF]" />
            <span className="truncate">{label}</span>
        </div>
        <span className={`rounded-md px-3 py-1 text-[11px] font-black uppercase ${statusTone(safe)}`}>
            {value}
        </span>
    </div>
);

const SafeScanSummary: React.FC<{
    report: ForensicBundleReport;
    securityReport: SecurityReport | null;
}> = ({ report, securityReport }) => {
    const market = securityReport?.marketData;
    const lp = securityReport?.lpInfo;
    const flags = securityReport?.flags;
    const buys = market?.buySellRatio?.buys ?? 0;
    const sells = market?.buySellRatio?.sells ?? 0;
    const totalTrades = buys + sells;
    const buyPct = totalTrades ? (buys / totalTrades) * 100 : 0;
    const sellPct = totalTrades ? 100 - buyPct : 0;
    const clusterLiquidityRatio = lp?.totalLiquidity
        ? (report.supplyAttribution.estimatedCombinedValueUsd || report.supplyAttribution.estimatedClusterValueUsd || 0) / lp.totalLiquidity
        : null;
    const lpSafe = lp ? lp.burnPercent + lp.lockedPercent >= 80 : null;
    const drainSupported = Boolean(lp?.totalLiquidity);

    const fraudRows = [
        { label: 'Honeypot Detection', value: flags ? (flags.honeypot ? 'FAILED' : 'PASSED') : 'UNKNOWN', safe: flags ? !flags.honeypot : null },
        { label: 'Mint Function', value: flags ? (flags.mintable ? 'ENABLED' : 'DISABLED') : 'UNKNOWN', safe: flags ? !flags.mintable : null },
        { label: 'Transfer Pausable', value: flags ? (flags.freezable ? 'YES' : 'NO') : 'UNKNOWN', safe: flags ? !flags.freezable : null },
        { label: 'Mutable Metadata', value: flags ? (flags.mutable ? 'YES' : 'NO') : 'UNKNOWN', safe: flags ? !flags.mutable : null },
        { label: 'Transfer Fee', value: flags ? (flags.transferFee ? 'YES' : 'NONE') : 'UNKNOWN', safe: flags ? !flags.transferFee : null },
        { label: 'Blacklist Function', value: flags ? (flags.blacklisted ? 'PRESENT' : 'NONE') : 'UNKNOWN', safe: flags ? !flags.blacklisted : null },
        { label: 'Modifiable Balance', value: flags ? (flags.modifiableBalance ? 'YES' : 'NO') : 'UNKNOWN', safe: flags ? !flags.modifiableBalance : null },
        { label: 'Closable Accounts', value: flags ? (flags.closable ? 'YES' : 'NO') : 'UNKNOWN', safe: flags ? !flags.closable : null },
        { label: 'Proxy Contract', value: flags ? (flags.proxy ? 'YES' : 'NO') : 'UNKNOWN', safe: flags ? !flags.proxy : null }
    ];

    return (
        <div className="flex flex-col gap-6">
            <div className="grid gap-6 xl:grid-cols-3">
                <section className="rounded-2xl border border-border bg-card p-6">
                    <h3 className="mb-7 text-xl font-black text-text-light">Token Overview</h3>
                    <div className="space-y-4">
                        {[
                            ['Price', market?.price || 'N/A'],
                            ['Age', market?.age || (report.launchTimestamp ? new Date(report.launchTimestamp).toLocaleDateString() : 'N/A')],
                            ['Market Cap', market?.marketCap || 'N/A'],
                            ['Holders', securityReport?.holders.count?.toLocaleString() || 'N/A'],
                            ['24h Volume', market?.volume24h || 'N/A'],
                            ['Liquidity', formatUsd(lp?.totalLiquidity)]
                        ].map(([label, value]) => (
                            <div key={label} className="flex items-center justify-between gap-4">
                                <span className="text-base font-medium text-[#A6B4CF]">{label}</span>
                                <span className={`text-base font-black ${label === 'Liquidity' ? 'text-primary-green' : 'text-text-light'}`}>{value}</span>
                            </div>
                        ))}
                    </div>
                    <div className="mt-8">
                        <div className="mb-3 flex items-center justify-between text-xs font-black uppercase">
                            <span className="text-primary-green">Buy {Math.round(buyPct)}%</span>
                            <span className="text-primary-red">Sell {Math.round(sellPct)}%</span>
                        </div>
                        <div className="h-2 overflow-hidden rounded-full bg-primary-red">
                            <div className="h-full bg-primary-green" style={{ width: `${totalTrades ? buyPct : 50}%` }} />
                        </div>
                        <div className="mt-3 text-center text-xs text-[#8FA0BF]">
                            {totalTrades ? `${buys.toLocaleString()} Buys / ${sells.toLocaleString()} Sells (24h)` : 'DEX trade split unavailable'}
                        </div>
                    </div>
                </section>

                <section className="flex min-h-[360px] flex-col rounded-2xl border border-border bg-card p-6">
                    <h3 className="mb-7 text-xl font-black text-text-light">LP Risk Scanner</h3>
                    <div className="space-y-5">
                        <div>
                            <div className="mb-2 flex items-center justify-between gap-4">
                                <span className="text-[#A6B4CF]">Liquidity Locked</span>
                                <span className="font-black text-text-light">{formatUsd(lp?.lockedAmount)} <span className="text-primary-yellow">({formatPct(lp?.lockedPercent)})</span></span>
                            </div>
                            <div className="h-2 rounded-full bg-primary-yellow" style={{ width: `${Math.max(4, lp?.lockedPercent || 0)}%` }} />
                        </div>
                        <div>
                            <div className="mb-2 flex items-center justify-between gap-4">
                                <span className="text-[#A6B4CF]">Liquidity Burned</span>
                                <span className="font-black text-text-light">{formatUsd(lp?.burnedAmount)} <span className="text-primary-green">({formatPct(lp?.burnPercent)})</span></span>
                            </div>
                            <div className="h-2 rounded-full bg-primary-green" style={{ width: `${Math.max(4, lp?.burnPercent || 0)}%` }} />
                        </div>
                        <div className="grid gap-3 rounded-xl border border-border bg-[#16181A] p-4 sm:grid-cols-2">
                            <div>
                                <div className="mb-3 text-[11px] font-black uppercase tracking-[0.18em] text-[#8FA0BF]">Lock Duration</div>
                                <div className="text-base font-black text-text-light">{lp?.lockDuration || 'Unknown'}</div>
                            </div>
                            <div>
                                <div className="mb-3 text-[11px] font-black uppercase tracking-[0.18em] text-[#8FA0BF]">Unlock Date</div>
                                <div className="text-base font-black text-text-light">{lp?.unlockDate || 'Unknown Date'}</div>
                            </div>
                        </div>
                    </div>
                    <div className="mt-auto rounded-xl border border-border bg-[#16181A] p-4">
                        <div className="flex items-center justify-between gap-4">
                            <div>
                                <div className={lpSafe ? 'font-black text-primary-green' : 'font-black text-primary-red'}>
                                    LP STATUS: {lpSafe ? 'SECURE' : 'RISKY'}
                                </div>
                                <div className="mt-1 text-sm font-semibold text-text-light">
                                    {lpSafe ? 'Majority of LP is locked or burnt' : 'LP lock or burn coverage is low'}
                                </div>
                            </div>
                        <span className={`rounded-md px-4 py-2 text-xs font-black uppercase ${statusTone(lpSafe)}`}>
                                {lpSafe === null ? 'Unknown' : lpSafe ? 'Safe' : 'Risk'}
                            </span>
                        </div>
                    </div>
                </section>

                <section className="rounded-2xl border border-border bg-card p-6">
                    <div className="mb-6 flex items-center justify-between gap-4">
                        <h3 className="text-xl font-black text-text-light">Drain Risk</h3>
                        <span className={`rounded-md px-4 py-2 text-xs font-black uppercase ${drainSupported ? statusTone((clusterLiquidityRatio || 0) < 0.65) : 'border-border bg-card-hover text-[#8FA0BF]'}`}>
                            {drainSupported ? 'Active' : 'Unavailable'}
                        </span>
                    </div>
                    <div className="grid gap-4 md:grid-cols-[1fr_1.3fr]">
                        <div className="grid gap-4">
                            <div className="rounded-xl border border-border bg-[#16181A] p-5">
                                <div className="mb-3 text-[11px] font-black uppercase tracking-[0.18em] text-[#8FA0BF]">Cluster Supply Value</div>
                                <div className="text-2xl font-black text-text-light">{formatUsd(report.supplyAttribution.estimatedCombinedValueUsd)}</div>
                                <div className="mt-2 text-sm text-[#A6B4CF]">{formatPct(report.supplyAttribution.combinedCoordinatedPct)} coordinated supply</div>
                            </div>
                            <div className="rounded-xl border border-border bg-[#16181A] p-5">
                                <div className="mb-3 text-[11px] font-black uppercase tracking-[0.18em] text-[#8FA0BF]">Live Liquidity</div>
                                <div className="text-2xl font-black text-text-light">{formatUsd(lp?.totalLiquidity)}</div>
                            </div>
                        </div>
                        <div className="flex min-h-[250px] flex-col items-center justify-center rounded-xl border border-border bg-[#16181A]">
                            <div className="mb-5 text-center text-[11px] font-black uppercase tracking-[0.3em] text-[#8FA0BF]">Cluster/Liquidity Ratio</div>
                            <div className="flex h-24 w-24 items-center justify-center rounded-full border-[10px] border-card-hover bg-card text-2xl font-black text-[#A6B4CF]">
                                {clusterLiquidityRatio === null ? 'N/A' : `${Math.round(clusterLiquidityRatio * 100)}%`}
                            </div>
                        </div>
                    </div>
                    <div className="mt-6 rounded-xl border border-border bg-[#16181A] p-5 text-base leading-7 text-[#A6B4CF]">
                        {drainSupported
                            ? 'Drain risk compares clustered holder value against live liquidity to estimate whether coordinated wallets could overwhelm available exit liquidity.'
                            : 'Drain risk is only available when liquidity and forensic cluster valuation are available for this token.'}
                    </div>
                </section>
            </div>

            <section className="rounded-2xl border border-border bg-card p-6">
                <h3 className="mb-7 text-xl font-black text-text-light">Fraud Detection</h3>
                <div className="grid gap-x-8 md:grid-cols-2">
                    {fraudRows.map((row) => (
                        <FlagRow key={row.label} {...row} />
                    ))}
                </div>
            </section>
        </div>
    );
};

export const SafeScan: React.FC = () => {
    const [contract, setContract] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [report, setReport] = useState<ForensicBundleReport | null>(null);
    const [securityReport, setSecurityReport] = useState<SecurityReport | null>(null);
    const [chain, setChain] = useState<AlchemyHubChain>('solana');

    const normalizedContract = contract.trim();
    const isSupported = SafeScanService.isSupported(normalizedContract, chain);
    const chainLabel = ALCHEMY_HUB_CHAINS.find((option) => option.id === chain)?.label ?? 'Chain';

    const handleScan = async () => {
        const tokenAddress = contract.trim();
        if (!tokenAddress) return;

        setLoading(true);
        setError(null);
        setReport(null);
        setSecurityReport(null);

        try {
            const [nextReport, nextSecurity] = await Promise.all([
                SafeScanService.analyzeToken(tokenAddress, chain),
                GoPlusService.fetchTokenSecurity(tokenAddress, scanSecurityChain(chain)).catch(() => null)
            ]);
            setReport(nextReport);
            setSecurityReport(nextSecurity);
        } catch (nextError) {
            setError(nextError instanceof Error ? nextError.message : 'Safe Scan analysis failed.');
        } finally {
            setLoading(false);
        }
    };

    const resetScan = () => {
        setContract('');
        setError(null);
        setReport(null);
        setSecurityReport(null);
        setLoading(false);
        setChain('solana');
    };

    if (!report) {
        return (
            <div className="flex min-h-[60vh] flex-col items-center justify-center px-4">
                <div className="w-full max-w-[760px]">
                    <form
                        onSubmit={(event) => {
                            event.preventDefault();
                            void handleScan();
                        }}
                        className="mb-10 flex w-full flex-col gap-4 lg:flex-row"
                    >
                        <select
                            value={chain}
                            onChange={(event) => setChain(event.target.value as AlchemyHubChain)}
                            disabled={loading}
                            className="rounded-xl border border-border bg-[#16181A] px-4 py-3.5 text-base font-semibold text-text-light outline-none transition-colors focus:border-primary-green/60 disabled:opacity-60"
                            aria-label="Select blockchain"
                        >
                            {ALCHEMY_HUB_CHAINS.map((option) => (
                                <option key={option.id} value={option.id}>
                                    {option.label}
                                </option>
                            ))}
                        </select>
                        <div className="flex-1 rounded-xl border border-border bg-[#16181A] px-4 transition-colors focus-within:border-primary-green/60">
                            <input
                                type="text"
                                className="w-full bg-transparent py-3.5 text-base text-text-light outline-none placeholder:text-text-dark"
                                placeholder="Enter Token Contract Address"
                                value={contract}
                                onChange={(event) => {
                                    const nextValue = event.target.value;
                                    setContract(nextValue);
                                    if (nextValue.trim().startsWith('0x') && chain === 'solana') {
                                        setChain('eth');
                                    }
                                }}
                                disabled={loading}
                            />
                        </div>
                        <button
                            type="submit"
                            disabled={loading || !isSupported}
                            className="flex min-w-[180px] items-center justify-center gap-2 rounded-xl bg-primary-green px-8 py-3 font-bold text-main transition-colors hover:bg-primary-green-darker disabled:cursor-not-allowed disabled:bg-card-hover disabled:text-text-medium"
                        >
                            {loading && <Loader2 size={18} className="animate-spin" />}
                            {loading ? 'Scanning...' : 'Safe Scan'}
                        </button>
                    </form>

                    {normalizedContract && !isSupported && (
                        <div className="mb-4 rounded-xl border border-primary-red/20 bg-primary-red/8 px-4 py-3 text-sm text-primary-red">
                            {chain === 'solana'
                                ? 'Solana scans require a valid Solana token address.'
                                : 'EVM scans require a valid 0x token contract address for the selected chain.'}
                        </div>
                    )}

                    {error && (
                        <div className="mb-4 rounded-xl border border-primary-red/20 bg-primary-red/8 px-4 py-3 text-sm text-primary-red">
                            {error}
                        </div>
                    )}

                    <div className="rounded-[30px] border border-border bg-card p-10 text-center shadow-[0_20px_50px_rgba(0,0,0,0.28)]">
                        <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-full border border-border bg-card-hover/30 text-text-medium">
                            {loading ? <Loader2 size={34} className="animate-spin" /> : <ShieldCheck size={34} />}
                        </div>
                        <h2 className="mb-3 text-4xl font-black tracking-tight text-text-light">
                            Security & Risk Analysis
                        </h2>
                        <p className="mx-auto max-w-[540px] text-lg leading-9 text-[#9AA8C7]">
                            Scan any token for honeypots, liquidity risks, malicious code, and bundled clusters.
                        </p>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="flex flex-col gap-6 animate-fade-in">
            <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
                <div className="min-w-0">
                    <div className="mb-3 flex flex-wrap items-center gap-3">
                        <div className="rounded-full border border-primary-green/20 bg-primary-green/10 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.24em] text-primary-green">
                            {report.tokenSymbol}
                        </div>
                        <div className="rounded-full border border-border bg-card px-3 py-1 text-[11px] font-bold uppercase tracking-[0.24em] text-[#8FA0BF]">
                            {chainLabel}
                        </div>
                    </div>
                    <div className="mb-2 flex min-w-0 flex-wrap items-center gap-4">
                        <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-full border border-border bg-card text-lg font-black text-primary-green">
                            {securityReport?.metadata.logo ? (
                                <img src={securityReport.metadata.logo} alt="" className="h-full w-full object-cover" />
                            ) : (
                                report.tokenSymbol.slice(0, 2).toUpperCase()
                            )}
                        </div>
                        <div className="min-w-0">
                            <h2 className="text-4xl font-black tracking-tight text-text-light">{report.tokenName}</h2>
                            <div className="mt-1 text-2xl font-semibold text-[#8FA0BF]">({report.tokenSymbol})</div>
                        </div>
                        <span className={`rounded-md px-4 py-2 text-xs font-black uppercase ${statusTone(securityReport ? securityReport.isSafe : null)}`}>
                            {securityReport ? (securityReport.isSafe ? 'Safe' : 'Risk') : 'Checking'}
                        </span>
                    </div>
                    <div className="flex flex-wrap items-center gap-3 text-sm text-[#A6B4CF]">
                        <button
                            onClick={() => navigator.clipboard.writeText(report.tokenAddress)}
                            className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 font-mono transition-colors hover:border-border/70 hover:text-text-light"
                        >
                            {shortenAddress(report.tokenAddress)}
                            <Copy size={14} />
                        </button>
                        <span>Updated {new Date(report.analysisTimestamp).toLocaleString()}</span>
                    </div>
                </div>

                <div className="flex flex-wrap gap-3">
                    <button
                        onClick={resetScan}
                        className="rounded-xl bg-primary-green px-5 py-2.5 text-sm font-bold text-main transition-colors hover:bg-primary-green-darker"
                    >
                        New Safe Scan
                    </button>
                </div>
            </div>

            <SafeScanSummary report={report} securityReport={securityReport} />

            <ForensicBundleSection
                contract={report.tokenAddress}
                isSupported
                loading={false}
                error={null}
                report={report}
                graphLayoutStyle="cluster-packed"
            />
        </div>
    );
};

export default SafeScan;
