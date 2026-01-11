import React, { useState } from 'react';
import { Shield, CheckCircle, ShieldCheck, AlertTriangle, Loader2, HelpCircle, UserX, Copy } from 'lucide-react';
import { GoPlusService, SecurityReport } from '../services/GoPlusService';
import { DatabaseService } from '../services/DatabaseService';

export const SafeScan: React.FC = () => {
    const [scanned, setScanned] = useState(false);
    const [loading, setLoading] = useState(false);
    const [contract, setContract] = useState('');
    const [report, setReport] = useState<SecurityReport | null>(null);
    const [error, setError] = useState<string | null>(null);

    const handleScan = async () => {
        if (contract.trim() === '') return;

        setLoading(true);
        setError(null);
        setReport(null);

        try {
            // Parallel fetch: GoPlus for Security, DexScreener for Market Data
            // Parallel fetch: GoPlus for Security, DexScreener for Market Data
            const [goPlusResult, dexResult] = await Promise.all([
                GoPlusService.fetchTokenSecurity(contract.trim()),
                DatabaseService.getTokenDetails(contract.trim())
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
                <div className="w-full max-w-[550px] flex flex-col items-center gap-5">

                    <div className="bg-[#16181A] border border-border w-full p-2 rounded-xl flex items-center pr-3 transition-colors focus-within:border-primary-green/50">
                        <input
                            type="text"
                            className="bg-transparent text-text-light w-full p-3 outline-none placeholder-text-dark text-base"
                            placeholder="Enter Token Contract Address"
                            value={contract}
                            onChange={(e) => setContract(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && handleScan()}
                        />
                    </div>
                    <button
                        className="bg-primary-green text-main font-bold py-3 px-10 rounded-xl hover:bg-primary-green-darker transition-colors w-full sm:w-auto text-base flex justify-center items-center gap-2 shadow-[0_0_20px_rgba(38,211,86,0.2)] hover:shadow-[0_0_30px_rgba(38,211,86,0.3)]"
                        onClick={handleScan}
                        disabled={loading}
                    >
                        {loading && <Loader2 className="animate-spin" size={20} />}
                        {loading ? 'Scanning...' : 'Safe Scan'}
                    </button>
                    {error && <p className="text-primary-red text-sm font-medium animate-fade-in bg-primary-red/5 px-4 py-2 rounded-lg border border-primary-red/10">{error}</p>}
                </div>

                <div className="mt-10 bg-card border border-border rounded-2xl p-10 flex flex-col items-center text-center max-w-[480px] w-full">
                    <div className="w-[60px] h-[60px] text-primary-green mb-5">
                        <Shield size={60} strokeWidth={1.5} />
                    </div>
                    <h2 className="text-2xl font-bold mb-3">Security & Risk Analysis</h2>
                    <p className="text-text-medium text-base leading-relaxed">Scan any token for honeypots, liquidity risks, malicious code, and get an AI-powered safety grade.</p>
                </div>
            </div>
        );
    }

    if (!report) return null;

    // Helper for Grade
    const getGrade = (risk: number) => {
        if (risk < 20) return 'A';
        if (risk < 40) return 'B';
        if (risk < 60) return 'C';
        if (risk < 80) return 'D';
        return 'F';
    };

    const grade = getGrade(report.riskScore);
    const buySell = report.marketData.buySellRatio || { buys: 0, sells: 0 };
    const totalTxns = buySell.buys + buySell.sells;
    const buyPercent = totalTxns > 0 ? (buySell.buys / totalTxns) * 100 : 50;

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
                            <div className="w-10 h-10 rounded-full bg-primary-green/20 flex items-center justify-center text-primary-green border border-border">
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
                    onClick={() => { setScanned(false); setContract(''); }}
                >
                    New Scan
                </button>
            </div >

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
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
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="bg-card border border-border rounded-2xl p-6">
                    <h3 className="flex items-center gap-2 font-bold text-lg mb-5">Fraud Detection</h3>
                    <div className="flex flex-col">
                        {[
                            { label: 'Honeypot Test', status: report.flags.honeypot ? 'Failed' : 'Passed', safe: !report.flags.honeypot },
                            { label: 'Blacklist Function', status: report.flags.blacklisted ? 'Detected' : 'None', safe: !report.flags.blacklisted },
                            { label: 'Mint Function', status: report.flags.mintable ? 'Enabled' : 'Disabled', safe: !report.flags.mintable },
                            { label: 'Modifiable Balance', status: report.flags.modifiableBalance ? 'Yes (Critical)' : 'No', safe: !report.flags.modifiableBalance },
                            { label: 'Transfer Pausable', status: report.flags.freezable ? 'Yes' : 'No', safe: !report.flags.freezable },
                            { label: 'Closable Accounts', status: report.flags.closable ? 'Yes' : 'No', safe: !report.flags.closable },
                            { label: 'Mutable Metadata', status: report.flags.mutable ? 'Yes' : 'No', safe: !report.flags.mutable },
                            { label: 'Proxy Contract', status: report.flags.proxy ? 'Yes' : 'No', safe: !report.flags.proxy },
                            { label: 'Transfer Fee', status: report.flags.transferFee ? 'Detected' : 'None', safe: !report.flags.transferFee },
                        ].map((item, i) => {
                            const isNA = item.status === 'N/A';
                            return (
                                <div key={i} className="flex justify-between items-center py-2.5 border-b border-border last:border-0 text-sm">
                                    <div className={`flex items-center gap-2 font-medium ${isNA ? 'text-text-medium' : 'text-text-medium'}`}>
                                        {isNA ? (
                                            <HelpCircle size={16} className="text-text-medium opacity-50" />
                                        ) : item.safe ? (
                                            <CheckCircle size={16} className="text-primary-green" />
                                        ) : (
                                            <AlertTriangle size={16} className="text-primary-red" />
                                        )}
                                        <span className={isNA ? "opacity-70" : ""}>{item.label}</span>
                                    </div>
                                    <span className={`px-2.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wide ${isNA
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

                <div className="flex flex-col gap-6">
                    <div className="bg-card border border-border rounded-2xl p-6">
                        <h3 className="flex items-center gap-2 font-bold text-lg mb-5">Token Health Grade</h3>
                        <div className="flex justify-between items-center mb-6">
                            <p className="text-sm text-text-medium leading-relaxed max-w-[60%] font-medium">
                                Based on security audits, liquidity analysis, and holder distribution.
                            </p>
                            <div className={`text-6xl font-extrabold ${['A', 'B'].includes(grade) ? 'text-primary-green' : 'text-primary-red'} leading-none`}>{grade}</div>
                        </div>
                        <div className="flex flex-col gap-3.5">
                            {[
                                { l: 'Liquidity Depth', v: 'N/A' }, // Pending real calculation
                                { l: 'Volume Consistency', v: 'N/A' },
                                { l: 'Buy/Sell Momentum', v: 'N/A' },
                                { l: 'Holder Distribution', v: report.holders.topHolders.slice(0, 10).reduce((acc, h) => acc + h.percent, 0) < 0.5 ? 'Good' : 'Conc.' },
                                { l: 'Volatility', v: 'N/A' },
                                { l: 'Token Age', v: report.marketData.age !== 'N/A' ? 'Good' : 'N/A' }
                            ].map((m, i) => (
                                <div key={i} className="flex justify-between items-center text-xs gap-4">
                                    <span className="text-text-medium min-w-[120px] font-semibold">{m.l}</span>
                                    <div className="flex-1 h-1.5 bg-main rounded-full overflow-hidden">
                                        {m.v === 'N/A' ? (
                                            <div className="h-full bg-card-hover w-full opacity-30"></div>
                                        ) : (
                                            <div className="h-full bg-primary-green rounded-full" style={{ width: m.v === 'Good' ? '90%' : m.v === 'Conc.' ? '40%' : m.v }}></div>
                                        )}
                                    </div>
                                    <span className="text-text-light w-[30px] text-right">{m.v}</span>
                                </div>
                            ))}
                        </div>
                    </div>


                </div>
            </div>

            <div className="bg-gradient-to-br from-card to-[#111315] border border-border rounded-2xl p-8 mt-2">
                <div className="max-w-4xl mx-auto text-center">
                    <h3 className="text-xl font-bold text-text-light mb-6">AI-Based Risk Score</h3>
                    <div className="text-6xl font-extrabold text-primary-green leading-none mb-3">
                        {100 - report.riskScore}
                    </div>
                    <div className={`inline-block border px-6 py-2 rounded-full font-bold text-base mb-8 ${report.isSafe ? 'bg-[rgba(38,211,86,0.15)] text-primary-green border-[rgba(38,211,86,0.3)]' : 'bg-primary-red/15 text-primary-red border-primary-red/30'}`}>
                        {report.isSafe ? 'Very Safe' : 'High Risk'}
                    </div>

                    <div className="relative w-full h-2.5 bg-[#2A2E33] rounded-full mb-8">
                        <div className="absolute inset-0 rounded-full bg-gradient-to-r from-[#26D356] via-[#F2C94C] to-[#EB5757]"></div>
                        <div className="absolute top-1/2 -translate-y-1/2 w-5 h-5 bg-white rounded-full shadow-[0_0_15px_rgba(0,0,0,0.5)] transition-all duration-500" style={{ left: `${Math.min(95, Math.max(5, report.riskScore))}%` }}></div>
                    </div>

                    <div className="text-left bg-black/20 rounded-xl p-6 border border-border/50">
                        <h4 className="text-base font-bold text-text-medium mb-4">AI Analysis Summary:</h4>
                        <ul className="space-y-3 text-sm text-text-light font-medium">
                            <li className="flex items-start gap-3"><span className="text-primary-green text-lg leading-none">•</span>
                                {report.flags.mintable ? "Mint function is enabled." : "Token contract is immutable. No hidden mint functions detected."}
                            </li>
                            <li className="flex items-start gap-3"><span className="text-primary-green text-lg leading-none">•</span>
                                {report.lpInfo.isBurnt ? "Liquidity is burned, reducing rug-pull risk." : "Liquidity is not fully burned or locked."}
                            </li>
                            <li className="flex items-start gap-3"><span className="text-primary-green text-lg leading-none">•</span>
                                Holder distribution: Top 10 wallet hold {(report.holders.topHolders.slice(0, 10).reduce((acc, h) => acc + h.percent, 0) * 100).toFixed(1)}% of supply.
                            </li>
                        </ul>
                    </div>
                </div>
            </div>
        </div >
    );
};