import React, { useRef, useState } from 'react';
import { Shield, Loader2, Copy, CheckCircle, AlertTriangle, HelpCircle, ShieldAlert } from 'lucide-react';
import { GoPlusService, SecurityReport } from '../services/GoPlusService';
import { DatabaseService } from '../services/DatabaseService';
import { ForensicBundleReport, ForensicBundleService } from '../services/ForensicBundleService';
import { ForensicBundleSection } from '../components/safe-scan/ForensicBundleSection';

const FORENSIC_SLOW_SCAN_MS = 25_000;
const FORENSIC_HARD_TIMEOUT_MS = 5 * 60_000;

const DrainRatioRing: React.FC<{
    value: number | null;
    toneClass: string;
    stroke: string;
    glow: string;
}> = ({ value, toneClass, stroke, glow }) => {
    const normalizedValue = value === null || !Number.isFinite(value) ? 0 : Math.max(0, Math.min(100, value));
    const radius = 34;
    const strokeWidth = 8;
    const circumference = 2 * Math.PI * radius;
    const dashOffset = circumference - (normalizedValue / 100) * circumference;

    return (
        <div className="relative flex h-[104px] w-[104px] items-center justify-center">
            <svg width="104" height="104" viewBox="0 0 104 104" className="-rotate-90 overflow-visible">
                <circle cx="52" cy="52" r={radius} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth={strokeWidth} />
                <circle
                    cx="52"
                    cy="52"
                    r={radius}
                    fill="none"
                    stroke={stroke}
                    strokeWidth={strokeWidth}
                    strokeLinecap="round"
                    strokeDasharray={circumference}
                    strokeDashoffset={dashOffset}
                    style={{
                        transition: 'stroke-dashoffset 500ms ease',
                        filter: `drop-shadow(0 0 10px ${glow})`
                    }}
                />
            </svg>
            <div className="absolute inset-0 flex items-center justify-center">
                <div className={`text-xl font-extrabold ${toneClass}`}>{value !== null ? `${Math.round(normalizedValue)}%` : 'N/A'}</div>
            </div>
        </div>
    );
};

export const SafeScan: React.FC = () => {
    const [scanned, setScanned] = useState(false);
    const [loading, setLoading] = useState(false);
    const [contract, setContract] = useState('');
    const [report, setReport] = useState<SecurityReport | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [forensicReport, setForensicReport] = useState<ForensicBundleReport | null>(null);
    const [forensicLoading, setForensicLoading] = useState(false);
    const [forensicError, setForensicError] = useState<string | null>(null);
    const forensicRequestId = useRef(0);

    const normalizedContract = contract.trim();
    const forensicSupported = ForensicBundleService.isSupported(normalizedContract);

    const handleScan = async () => {
        const trimmedContract = contract.trim();
        if (trimmedContract === '') return;
        const currentForensicRequestId = ++forensicRequestId.current;

        setLoading(true);
        setError(null);
        setScanned(false);
        setReport(null);
        setForensicReport(null);
        setForensicError(null);
        setForensicLoading(false);

        try {
            // Parallel fetch: GoPlus for Security, DexScreener for Market Data
            const [goPlusResult, dexResult] = await Promise.all([
                GoPlusService.fetchTokenSecurity(trimmedContract),
                DatabaseService.getTokenDetails(trimmedContract)
            ]);

            if (goPlusResult) {
                // Merge Data: Overwrite GoPlus market data with DexScreener if available (usually more accurate/rich)
                if (dexResult) {
                    // DexScreener Price
                    const dexPrice = parseFloat(dexResult.priceUsd);
                    const dexLiq = dexResult.liquidity?.usd || 0;
                    const dexVol = dexResult.volume?.h24 || 0;
                    const dexFDV = dexResult.fdv || 0;
                    const dexBuys = dexResult.txns?.h24?.buys || 0;
                    const dexSells = dexResult.txns?.h24?.sells || 0;

                    // Calculate Age from Pair Creation
                    let dexAge = 'N/A';
                    if (dexResult.pairCreatedAt) {
                        const now = Date.now();
                        const created = dexResult.pairCreatedAt;
                        const diff = now - created;
                        const hours = Math.floor(diff / (1000 * 60 * 60));
                        const days = Math.floor(hours / 24);
                        const years = (days / 365).toFixed(1);

                        if (days > 365) dexAge = `${years} Years`;
                        else if (days > 30) dexAge = `${Math.floor(days / 30)} Months`;
                        else if (days >= 1) dexAge = `${days} Days`;
                        else dexAge = `${hours} Hours`;
                    }

                    // Override GoPlus market data
                    goPlusResult.marketData = {
                        price: dexPrice > 0 ? `$${dexPrice.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 10 })}` : goPlusResult.marketData.price,
                        age: dexAge !== 'N/A' ? dexAge : goPlusResult.marketData.age,
                        marketCap: dexFDV > 0 ? `$${dexFDV.toLocaleString(undefined, { maximumFractionDigits: 0 })}` : goPlusResult.marketData.marketCap,
                        volume24h: dexVol > 0 ? `$${dexVol.toLocaleString(undefined, { maximumFractionDigits: 0 })}` : goPlusResult.marketData.volume24h,
                        liquidity: dexLiq > 0 ? dexLiq : goPlusResult.marketData.liquidity,
                        buySellRatio: { buys: dexBuys, sells: dexSells }
                    };
                }

                setReport(goPlusResult);
                setScanned(true);
                const shouldRunForensics = ForensicBundleService.isSupported(trimmedContract);

                if (shouldRunForensics) {
                    setForensicLoading(true);
                    const slowScanTimer = window.setTimeout(() => {
                        if (forensicRequestId.current !== currentForensicRequestId) return;
                        console.info('[SafeScan] Solana forensic analysis is taking longer than usual but is still running.');
                    }, FORENSIC_SLOW_SCAN_MS);
                    const hardTimeoutTimer = window.setTimeout(() => {
                        if (forensicRequestId.current !== currentForensicRequestId) return;
                        setForensicLoading(false);
                        setForensicError('The backend forensic job is taking longer than expected. The core Safe Scan result is still valid, and retrying shortly should pick up any cached progress from the forensic worker.');
                    }, FORENSIC_HARD_TIMEOUT_MS);

                    void ForensicBundleService.analyzeToken(trimmedContract)
                        .then((nextReport) => {
                            if (forensicRequestId.current !== currentForensicRequestId) return;
                            setForensicReport(nextReport);
                            setForensicError(null);
                        })
                        .catch((err) => {
                            if (forensicRequestId.current !== currentForensicRequestId) return;
                            setForensicError(err instanceof Error ? err.message : 'Advanced forensic analysis failed.');
                        })
                        .finally(() => {
                            window.clearTimeout(slowScanTimer);
                            window.clearTimeout(hardTimeoutTimer);
                            if (forensicRequestId.current !== currentForensicRequestId) return;
                            setForensicLoading(false);
                        });
                }
            } else {
                setError('Could not fetch security data. Please check the address and try again. The token might be on a chain we do not support yet or simply invalid.');
            }
        } catch (err) {
            console.error(err);
            setError('An error occurred while scanning.');
        } finally {
            setLoading(false);
        }
    };

    if (!scanned) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[60vh] max-w-2xl mx-auto px-4">
                <div className="w-full max-w-[700px] flex flex-col gap-4">
                    <form onSubmit={(e) => { e.preventDefault(); handleScan(); }} className="flex gap-3 w-full">
                        <div className="flex-1 bg-[#16181A] border border-border rounded-xl flex items-center px-4 transition-colors focus-within:border-primary-green/50">
                            <input
                                type="text"
                                className="bg-transparent border-none text-text-light outline-none w-full py-3.5 text-base placeholder-text-dark"
                                placeholder="Enter Token Contract Address"
                                value={contract}
                                onChange={(e) => setContract(e.target.value)}
                                disabled={loading}
                            />
                        </div>
                        <button
                            type="submit"
                            className="bg-primary-green text-main font-bold py-3 px-8 rounded-xl hover:bg-primary-green-darker transition-colors shadow-lg whitespace-nowrap flex items-center gap-2"
                            disabled={loading}
                        >
                            {loading && <Loader2 className="animate-spin" size={20} />}
                            {loading ? 'Analyzing...' : 'Safe Scan'}
                        </button>
                    </form>
                    {error && <p className="text-primary-red text-sm font-medium animate-fade-in bg-primary-red/5 px-4 py-2 rounded-lg border border-primary-red/10 text-center">{error}</p>}
                </div>

                <div className="mt-10 bg-card border border-border rounded-2xl p-10 flex flex-col items-center text-center max-w-[480px] w-full">
                    {loading ? (
                        <>
                            <div className="w-[60px] h-[60px] text-text-medium mb-5 flex items-center justify-center">
                                <Loader2 size={60} strokeWidth={1.5} className="animate-spin" />
                            </div>
                            <h2 className="text-2xl font-bold mb-3">Loading, this may take a while</h2>
                            <p className="text-text-medium text-base leading-relaxed">
                                Safe Scan is still running the advanced forensic analysis. Please wait while we complete the full report before displaying the results.
                            </p>
                        </>
                    ) : (
                        <>
                            <div className="w-[60px] h-[60px] text-text-medium mb-5">
                                <Shield size={60} strokeWidth={1.5} />
                            </div>
                            <h2 className="text-2xl font-bold mb-3">Security & Risk Analysis</h2>
                            <p className="text-text-medium text-base leading-relaxed">Scan any token for honeypots, liquidity risks, malicious code, and get an AI-powered safety grade.</p>
                        </>
                    )}
                </div>
            </div>
        );
    }

    if (!report) return null;

    const formatUsd = (value: number | null | undefined) => {
        if (value === null || value === undefined || !Number.isFinite(value)) return 'N/A';
        return new Intl.NumberFormat('en-US', {
            style: 'currency',
            currency: 'USD',
            maximumFractionDigits: value >= 1000 ? 0 : 2
        }).format(value);
    };

    const buySell = report.marketData.buySellRatio || { buys: 0, sells: 0 };
    const totalTxns = buySell.buys + buySell.sells;
    const buyPercent = totalTxns > 0 ? (buySell.buys / totalTxns) * 100 : 50;
    const coordinatedValue = forensicReport?.supplyAttribution.estimatedCombinedValueUsd ?? null;
    const totalLiquidity = report.lpInfo.totalLiquidity || 0;
    const drainCoverageRatio = totalLiquidity > 0 && coordinatedValue !== null ? coordinatedValue / totalLiquidity : null;
    const drainRiskState = !forensicSupported
        ? 'unsupported'
        : forensicLoading
            ? 'loading'
            : forensicError
                ? 'error'
                : forensicReport && drainCoverageRatio !== null
                    ? drainCoverageRatio >= 1
                        ? 'critical'
                        : drainCoverageRatio >= 0.5
                            ? 'elevated'
                            : 'contained'
                    : 'pending';
    const drainRiskLabel = drainRiskState === 'critical'
        ? 'Critical'
        : drainRiskState === 'elevated'
            ? 'Elevated'
            : drainRiskState === 'contained'
                ? 'Contained'
                : drainRiskState === 'loading'
                    ? 'Analyzing'
                    : drainRiskState === 'unsupported'
                        ? 'Unavailable'
                        : drainRiskState === 'error'
                            ? 'Incomplete'
                            : 'Pending';
    const drainRiskTone = drainRiskState === 'critical'
        ? 'bg-primary-red/15 text-primary-red border border-primary-red/25'
        : drainRiskState === 'elevated'
            ? 'bg-primary-yellow/15 text-primary-yellow border border-primary-yellow/25'
            : drainRiskState === 'contained'
                ? 'bg-primary-green/15 text-primary-green border border-primary-green/25'
                : 'bg-card-hover text-text-medium border border-border/60';
    const drainRatioPercent = drainCoverageRatio !== null ? Math.min(100, Math.max(0, drainCoverageRatio * 100)) : null;
    const drainRatioToneClass = drainRiskState === 'critical'
        ? 'text-primary-red'
        : drainRiskState === 'elevated'
            ? 'text-primary-yellow'
            : drainRiskState === 'contained'
                ? 'text-primary-green'
                : 'text-text-medium';
    const drainRatioStroke = drainRiskState === 'critical'
        ? '#EB5757'
        : drainRiskState === 'elevated'
            ? '#F2C94C'
            : drainRiskState === 'contained'
                ? '#26D356'
                : '#6B7280';
    const drainRatioGlow = drainRiskState === 'critical'
        ? 'rgba(235,87,87,0.28)'
        : drainRiskState === 'elevated'
            ? 'rgba(242,201,76,0.28)'
            : drainRiskState === 'contained'
                ? 'rgba(38,211,86,0.28)'
                : 'rgba(107,114,128,0.18)';
    const drainRiskSection = (
        <div className="bg-card border border-border rounded-2xl p-6 flex flex-col h-full">
            <div className="flex items-start justify-between gap-4 mb-5">
                <div>
                    <h3 className="font-bold text-lg mb-1">Drain Risk</h3>
                </div>
                <span className={`px-2.5 py-1 rounded text-[10px] font-bold uppercase tracking-wide whitespace-nowrap ${drainRiskTone}`}>
                    {drainRiskLabel}
                </span>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_168px] gap-5 mb-5 items-stretch lg:items-start">
                <div className="grid grid-cols-2 lg:grid-cols-1 gap-4 min-w-0">
                    <div className="bg-card-hover/20 border border-border/60 rounded-xl p-4">
                        <div className="text-[10px] text-text-medium mb-1 font-bold uppercase tracking-wide">Cluster Supply Value</div>
                        <div className="text-lg font-bold text-text-light">{formatUsd(coordinatedValue)}</div>
                        <div className="text-xs text-text-medium mt-1">
                            {forensicReport ? `${forensicReport.supplyAttribution.combinedCoordinatedPct.toFixed(2)}% of supply` : 'Waiting for forensic supply attribution'}
                        </div>
                    </div>
                    <div className="bg-card-hover/20 border border-border/60 rounded-xl p-4">
                        <div className="text-[10px] text-text-medium mb-1 font-bold uppercase tracking-wide">Live Liquidity</div>
                        <div className="text-lg font-bold text-text-light">{formatUsd(totalLiquidity)}</div>
                    </div>
                </div>

                <div className="rounded-2xl border border-border bg-[linear-gradient(180deg,rgba(255,255,255,0.03),rgba(255,255,255,0.015))] px-4 py-5 flex min-h-[188px] flex-col items-center justify-center text-center self-stretch">
                    <div className="text-[10px] text-text-medium mb-3 font-bold uppercase tracking-[0.18em]">Cluster/Liquidity Ratio</div>
                    <DrainRatioRing
                        value={drainRatioPercent}
                        toneClass={drainRatioToneClass}
                        stroke={drainRatioStroke}
                        glow={drainRatioGlow}
                    />
                </div>
            </div>

            <div className="mt-auto bg-card-hover/30 border border-border rounded-xl p-4">
                {drainRiskState === 'loading' || drainRiskState === 'pending' ? (
                    <div className="text-sm text-text-medium">
                        Advanced forensic analysis is still running, so drain risk will appear once coordinated supply attribution is ready.
                    </div>
                ) : drainRiskState === 'unsupported' ? (
                    <div className="text-sm text-text-medium">
                        Drain risk is only available on chains where forensic cluster analysis is supported right now.
                    </div>
                ) : drainRiskState === 'error' ? (
                    <div className="text-sm text-text-medium">
                        We could not finish the coordinated-wallet analysis, so this drain-risk estimate is unavailable for the current scan.
                    </div>
                ) : drainRiskState === 'critical' ? (
                    <div className="flex items-start gap-3 text-sm">
                        <ShieldAlert size={18} className="text-text-medium mt-0.5 flex-shrink-0" />
                        <div>
                            <div className="text-primary-red font-bold mb-1">Cluster supply can overwhelm liquidity</div>
                            <div className="text-text-light">
                                Coordinated wallet value is at or above the current liquidity base, which means concentrated selling pressure could drain the pool quickly.
                            </div>
                        </div>
                    </div>
                ) : drainRiskState === 'elevated' ? (
                    <div className="flex items-start gap-3 text-sm">
                        <ShieldAlert size={18} className="text-text-medium mt-0.5 flex-shrink-0" />
                        <div>
                            <div className="text-primary-yellow font-bold mb-1">Cluster supply is heavy relative to liquidity</div>
                            <div className="text-text-light">
                                Coordinated holdings represent a large share of available exit liquidity, so a linked-wallet selloff could create sharp slippage and fast downside.
                            </div>
                        </div>
                    </div>
                ) : (
                    <div className="flex items-start gap-3 text-sm">
                        <CheckCircle size={18} className="text-text-medium mt-0.5 flex-shrink-0" />
                        <div>
                            <div className="text-primary-green font-bold mb-1">Liquidity currently covers coordinated supply better</div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );

    return (
        <div className="flex flex-col gap-6 animate-fade-in">
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-2">
                <div className="flex flex-col gap-1.5">
                    {/* Header: Logo, Name, Symbol */}
                    <a
                        href={`/token/${report.address}`}
                        className="flex items-center gap-3 group hover:opacity-80 transition-opacity"
                    >
                        {report.metadata?.logo ? (
                            <img
                                src={report.metadata.logo}
                                alt={report.metadata.name || 'Token Logo'}
                                className="w-10 h-10 rounded-full border border-border bg-card object-cover"
                            />
                        ) : (
                            <div className="w-10 h-10 rounded-full bg-card-hover/20 flex items-center justify-center text-text-medium border border-border">
                                <Shield size={20} />
                            </div>
                        )}
                        <div>
                            <h2 className="text-2xl font-bold flex items-center gap-2">
                                {report.metadata?.name || 'Unknown Token'}
                                <span className="text-text-medium text-lg font-medium">({report.metadata?.symbol || 'UNKNOWN'})</span>
                            </h2>
                        </div>
                    </a>

                    {/* Sub-Header: Address, Copy, Network, Risk Badge */}
                    <div className="flex items-center gap-3 text-text-medium text-sm ml-1 mt-1">
                        <div className="flex items-center gap-1.5 bg-card/50 px-2.5 py-1 rounded-lg border border-border/50 transition-colors hover:border-border cursor-pointer group/copy"
                            onClick={() => {
                                navigator.clipboard.writeText(report.address);
                            }}
                        >
                            <span className="font-mono text-xs">{report.address.slice(0, 4)}...{report.address.slice(-4)}</span>
                            <Copy size={12} className="text-text-medium group-hover/copy:text-white transition-colors" />
                        </div>

                        <div className="h-1 w-1 rounded-full bg-border"></div>
                        <span className="text-xs">{report.chainName || (report.address.startsWith('0x') ? 'EVM Chain' : 'Solana')}</span>
                        <div className="h-1 w-1 rounded-full bg-border"></div>

                        {report.isSafe ? (
                            <span className="bg-[rgba(38,211,86,0.1)] text-primary-green border border-[rgba(38,211,86,0.2)] px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wide flex items-center gap-1">
                                <Shield size={10} /> Safe
                            </span>
                        ) : (
                            <span className="bg-primary-red/10 text-primary-red border border-primary-red/20 px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wide flex items-center gap-1">
                                <Shield size={10} /> High Risk
                            </span>
                        )}
                    </div>
                </div>
                <button
                    className="bg-primary-green text-main font-bold px-5 py-2 rounded-lg hover:bg-primary-green-darker transition-colors text-xs uppercase tracking-wide"
                    onClick={() => {
                        setScanned(false);
                        setContract('');
                        setReport(null);
                        setError(null);
                        setForensicReport(null);
                        setForensicError(null);
                        setForensicLoading(false);
                    }}
                >
                    New Scan
                </button>
            </div >

            <div className="grid grid-cols-1 lg:grid-cols-2 2xl:grid-cols-3 gap-6">
                <div className="bg-card border border-border rounded-2xl p-6">
                    <h3 className="flex items-center gap-2 font-bold text-lg mb-5">Token Overview</h3>
                    <div className="flex flex-col gap-3">
                        {[
                            { l: 'Price', v: report.marketData.price },
                            { l: 'Age', v: report.marketData.age },
                            { l: 'Market Cap', v: report.marketData.marketCap },
                            { l: 'Holders', v: report.holders.count.toLocaleString() },
                            { l: '24h Volume', v: report.marketData.volume24h },
                        ].map((i, idx) => (
                            <div key={idx} className="flex justify-between items-center text-sm">
                                <span className="text-text-medium font-medium">{i.l}</span>
                                <span className="text-text-light font-bold">{i.v}</span>
                            </div>
                        ))}
                        <div className="flex justify-between items-center text-sm">
                            <span className="text-text-medium font-medium">Liquidity</span>
                            <span className="text-primary-green font-bold">${report.lpInfo.totalLiquidity.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</span>
                        </div>
                        <div className="mt-2">
                            <div className="flex justify-between text-[10px] font-bold mb-1 uppercase tracking-wide">
                                <span className="text-primary-green">Buy {buyPercent.toFixed(0)}%</span>
                                <span className="text-primary-red">Sell {(100 - buyPercent).toFixed(0)}%</span>
                            </div>
                            <div className="w-full h-1.5 bg-card-hover rounded-full overflow-hidden flex">
                                <div className="h-full bg-primary-green transition-all duration-500" style={{ width: `${buyPercent}%` }}></div>
                                <div className="h-full bg-primary-red transition-all duration-500" style={{ width: `${100 - buyPercent}%` }}></div>
                            </div>
                            <div className="text-[10px] text-text-medium mt-1 text-center">
                                {totalTxns > 0 ? `${buySell.buys} Buys / ${buySell.sells} Sells (24h)` : 'No transaction data'}
                            </div>
                        </div>
                    </div>
                </div>

                <div className="bg-card border border-border rounded-2xl p-6 flex flex-col h-full">
                    <h3 className="flex items-center gap-2 font-bold text-lg mb-5">LP Risk Scanner</h3>
                    <div className="flex flex-col gap-4 flex-grow">
                        <div className="flex flex-col gap-4">
                            {/* Liquidity Locked */}
                            <div>
                                <div className="flex justify-between items-center mb-1 text-sm">
                                    <div className="flex items-center gap-1.5">
                                        <div className="w-2 h-2 rounded-full bg-primary-yellow"></div>
                                        <span className="text-text-medium font-medium">Liquidity Locked</span>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <span className="text-text-light font-bold">${(report.lpInfo.lockedAmount || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
                                        <span className="text-primary-yellow text-xs font-bold">({report.lpInfo.lockedPercent.toFixed(2)}%)</span>
                                    </div>
                                </div>
                                <div className="w-full h-1.5 bg-[#2A2E33] rounded-full overflow-hidden">
                                    <div className="h-full bg-primary-yellow transition-all" style={{ width: `${Math.min(100, report.lpInfo.lockedPercent)}%` }}></div>
                                </div>
                            </div>

                            {/* Liquidity Burned */}
                            <div>
                                <div className="flex justify-between items-center mb-1 text-sm">
                                    <div className="flex items-center gap-1.5">
                                        <div className="w-2 h-2 rounded-full bg-primary-green"></div>
                                        <span className="text-text-medium font-medium">Liquidity Burned</span>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <span className="text-text-light font-bold">${(report.lpInfo.burnedAmount || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
                                        <span className="text-primary-green text-xs font-bold">({report.lpInfo.burnPercent.toFixed(2)}%)</span>
                                    </div>
                                </div>
                                <div className="w-full h-1.5 bg-[#2A2E33] rounded-full overflow-hidden">
                                    <div className="h-full bg-primary-green transition-all" style={{ width: `${Math.min(100, report.lpInfo.burnPercent)}%` }}></div>
                                </div>
                            </div>
                        </div>

                        <div className="grid grid-cols-2 gap-4 mt-2 p-3 bg-card-hover/20 rounded-xl border border-border/50">
                            <div>
                                <div className="text-[10px] text-text-medium mb-1 font-bold uppercase tracking-wide">Lock Duration</div>
                                <div className="font-bold text-sm text-text-light">{report.lpInfo.lockDuration || 'N/A'}</div>
                            </div>
                            <div className="text-right">
                                <div className="text-[10px] text-text-medium mb-1 font-bold uppercase tracking-wide">Unlock Date</div>
                                <div className="font-bold text-sm text-text-light">{report.lpInfo.unlockDate || 'N/A'}</div>
                            </div>
                        </div>
                        <div className="mt-auto bg-card-hover/30 border border-border rounded-xl p-4 flex justify-between items-center">
                            {(() => {
                                // Logic: Safe if burnt OR (locked + burnt > 1%)
                                const isLpSafe = report.lpInfo.isBurnt || (report.lpInfo.lockedPercent + report.lpInfo.burnPercent > 1);

                                return (
                                    <>
                                        <div>
                                            <div className={`${isLpSafe ? 'text-primary-green' : 'text-primary-red'} font-bold text-sm mb-0.5`}>
                                                LP STATUS: {isLpSafe ? 'SECURE' : 'CAUTION'}
                                            </div>
                                            <div className="text-text-light text-xs font-medium">
                                                {isLpSafe ? 'Majority of LP is locked or burnt' : 'LP is not fully burnt or locked'}
                                            </div>
                                        </div>
                                        <span className={`bg-${isLpSafe ? 'primary-green' : 'primary-red'}/15 text-${isLpSafe ? 'primary-green' : 'primary-red'} border border-${isLpSafe ? 'primary-green' : 'primary-red'}/30 px-2.5 py-1 rounded text-[10px] font-bold uppercase tracking-wide`}>
                                            {isLpSafe ? 'Safe' : 'Risk'}
                                        </span>
                                    </>
                                );
                            })()}
                        </div>
                    </div>
                </div>

                <div className="2xl:block hidden">
                    {drainRiskSection}
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="bg-card border border-border rounded-2xl p-6 2xl:col-span-2">
                    <h3 className="flex items-center gap-2 font-bold text-lg mb-5">Fraud Detection</h3>
                    <div className="grid grid-cols-1 2xl:grid-cols-2 2xl:gap-x-6">
                        {[
                            { label: 'Honeypot Detection', status: report.flags.honeypot ? 'Failed' : 'Passed', safe: !report.flags.honeypot },
                            { label: 'Blacklist Function', status: report.flags.blacklisted ? 'Detected' : 'None', safe: !report.flags.blacklisted },
                            { label: 'Mint Function', status: report.flags.mintable ? 'Enabled' : 'Disabled', safe: !report.flags.mintable },
                            { label: 'Modifiable Balance', status: report.flags.modifiableBalance ? 'Yes (Critical)' : 'No', safe: !report.flags.modifiableBalance },
                            { label: 'Transfer Pausable', status: report.flags.freezable ? 'Yes' : 'No', safe: !report.flags.freezable },
                            { label: 'Closable Accounts', status: report.flags.closable ? 'Yes' : 'No', safe: !report.flags.closable },
                            { label: 'Mutable Metadata', status: report.flags.mutable ? 'Yes' : 'No', safe: !report.flags.mutable },
                            { label: 'Proxy Contract', status: report.flags.proxy ? 'Yes' : 'No', safe: !report.flags.proxy },
                            { label: 'Transfer Fee', status: report.flags.transferFee ? 'Detected' : 'None', safe: !report.flags.transferFee }
                        ].map((item) => {
                            const isNA = item.status === 'N/A';
                            return (
                                <div key={item.label} className="flex justify-between items-center py-2.5 border-b border-border text-sm gap-3 2xl:last:border-b 2xl:[&:nth-last-child(-n+2)]:border-b-0">
                                    <div className="flex items-center gap-2 font-medium text-text-medium">
                                        {isNA ? (
                                            <HelpCircle size={16} className="text-text-medium opacity-50" />
                                        ) : item.safe ? (
                                            <CheckCircle size={16} className="text-text-medium" />
                                        ) : (
                                            <AlertTriangle size={16} className="text-text-medium" />
                                        )}
                                        <span>{item.label}</span>
                                    </div>
                                    <span className={`px-2.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wide whitespace-nowrap ${isNA
                                        ? 'bg-card-hover text-text-medium border border-border/50'
                                        : item.safe
                                            ? 'bg-[rgba(38,211,86,0.15)] text-primary-green'
                                            : 'bg-primary-red/15 text-primary-red'
                                        }`}>
                                        {item.status}
                                    </span>
                                </div>
                            );
                        })}
                    </div>
                </div>

                <div className="2xl:hidden block">
                    {drainRiskSection}
                </div>
            </div>

            <ForensicBundleSection
                contract={report.address}
                isSupported={forensicSupported}
                loading={forensicLoading}
                error={forensicError}
                report={forensicReport}
            />
        </div >
    );
};
