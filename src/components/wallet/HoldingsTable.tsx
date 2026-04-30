// Reusable interface component for Atlaix product workflows.
import React, { useState } from 'react';
import { RefreshCw, ChevronDown, ChevronUp } from 'lucide-react';
import { PortfolioData } from '../../services/ChainRouter';
import { useNavigate } from 'react-router-dom';

interface HoldingsTableProps {
    portfolioData: PortfolioData | null;
    loading: boolean;
    chain: string;
    timeFilter: 'ALL' | '1D' | '1W' | '1M' | '>1M';
    onRefresh?: () => void;
}

export const HoldingsTable: React.FC<HoldingsTableProps> = ({ portfolioData, loading, chain, timeFilter, onRefresh }) => {
    const navigate = useNavigate();
    const [visibleCount, setVisibleCount] = useState(20);
    const [showDust, setShowDust] = useState(false);

    return (
        <div className="bg-card border border-border rounded-xl overflow-hidden flex flex-col">
            <div className="p-6 border-b border-border flex justify-between items-center">
                <h3 className="font-bold text-lg text-text-light">Current Holdings</h3>
                <div className="flex gap-2">
                    <button
                        className="p-1.5 bg-card hover:bg-card-hover border border-border rounded-lg text-text-medium hover:text-text-light transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        onClick={onRefresh}
                        disabled={!onRefresh || loading}
                        title={onRefresh ? 'Refresh wallet data' : 'Refresh unavailable'}
                    >
                        <RefreshCw size={16} className={loading ? "animate-spin" : ""} />
                    </button>
                </div>
            </div>

            <div className="overflow-x-auto">
                <table className="w-full text-sm">
                    <thead className="bg-card-hover/50 text-xs text-text-dark uppercase font-bold">
                        <tr>
                            <th className="px-6 py-3 text-left">Asset</th>
                            <th className="px-6 py-3 text-right">Balance</th>
                            <th className="px-6 py-3 text-right">Value (USD)</th>

                            <th className="px-6 py-3 text-right">{timeFilter === 'ALL' ? 'Total PnL' : 'Period PnL'}</th>
                            <th className="px-6 py-3 text-right">Time Held</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-border/50">
                        {loading ? (
                            <tr>
                                <td colSpan={5} className="py-12 text-center text-text-medium">
                                    <div className="flex flex-col items-center gap-3">
                                        <RefreshCw className="animate-spin text-primary-green" size={24} />
                                        <span>Scanning Blockchain...</span>
                                    </div>
                                </td>
                            </tr>
                        ) : !portfolioData || portfolioData.assets.length === 0 ? (
                            <tr>
                                <td colSpan={5} className="py-12 text-center text-text-medium">No assets found on this chain.</td>
                            </tr>
                        ) : (
                            portfolioData.assets
                                .filter(a => showDust || a.rawValue > 1)
                                // Removed time filtering -> Now we show ALL assets with their Period PnL
                                .sort((a, b) => {
                                    if (timeFilter !== 'ALL') {
                                        // Sort by PnL Percent if period filter is active? Or keep Value?
                                        // Maintain Value as primary sort key; consider implementing secondary sorting if required.
                                        return b.rawValue - a.rawValue;
                                    }
                                    return b.rawValue - a.rawValue;
                                })
                                .slice(0, visibleCount)
                                .map((asset, i) => {
                                    const buyTime = (asset as any).buyTime || 0;
                                    const isNew = buyTime > 0 && (Date.now() - buyTime) < 24 * 60 * 60 * 1000;
                                    const timeAgo = buyTime ? (() => {
                                        const diff = Date.now() - buyTime;
                                        const days = Math.floor(diff / (24 * 60 * 60 * 1000));
                                        if (days === 0) {
                                            const hours = Math.floor(diff / (60 * 60 * 1000));
                                            return `${hours}h ago`;
                                        }
                                        return `${days}d ago`;
                                    })() : '';

                                    return (
                                        <tr
                                            key={i}
                                            className="hover:bg-card-hover/20 transition-colors cursor-pointer group"
                                            onClick={() => navigate(`/token/${asset.address || asset.symbol}`)}
                                            title={`View ${asset.symbol} details`}
                                        >
                                            <td className="px-6 py-4">
                                                <div className="flex items-center gap-3">
                                                    <div className="relative">
                                                        <img src={asset.logo} alt={asset.symbol} className="w-8 h-8 rounded-full bg-main border border-border" onError={(e) => e.currentTarget.src = 'https://via.placeholder.com/32'} />
                                                        {asset.chainLogo && (
                                                            <img
                                                                src={asset.chainLogo}
                                                                alt={asset.chain || 'Chain'}
                                                                title={asset.chain}
                                                                className="absolute -bottom-1 -right-1 w-3.5 h-3.5 rounded-full border border-card bg-card object-contain"
                                                            />
                                                        )}
                                                    </div>
                                                    <div>
                                                        <div className="flex items-center gap-2">
                                                            <div className="font-bold text-text-light group-hover:text-primary-green transition-colors">{asset.symbol}</div>
                                                            {isNew && <span className="text-[9px] bg-primary-green text-main font-bold px-1.5 py-0.5 rounded animate-pulse">NEW</span>}
                                                        </div>
                                                        <div className="text-[10px] text-text-medium flex gap-1">
                                                            {asset.chain || chain}
                                                        </div>
                                                    </div>
                                                </div>
                                            </td>
                                            <td className="px-6 py-4 text-right font-medium text-text-light">{asset.balance}</td>
                                            <td className="px-6 py-4 text-right font-bold text-text-light">{asset.value}</td>
                                            <td className="px-6 py-4 text-right">
                                                {asset.rawValue <= 1 ? (
                                                    <span className="text-text-dark text-xs">N/A</span>
                                                ) : asset.pnl === 'Loading...' ? (
                                                    <span className="text-text-medium text-xs flex items-center justify-end gap-1">
                                                        <RefreshCw size={10} className="animate-spin" /> Calc...
                                                    </span>
                                                ) : asset.pnl === 'N/A' ? (
                                                    <span className="text-text-dark text-xs">N/A</span>
                                                ) : asset.pnl ? (
                                                    <div className="flex flex-col items-end">
                                                        <span className={`font-bold ${asset.pnlPercent && asset.pnlPercent >= 0 ? 'text-primary-green' : 'text-primary-red'}`}>
                                                            {asset.pnl}
                                                        </span>
                                                        {timeFilter !== 'ALL' && (
                                                            <span className="text-[10px] text-text-medium scale-90 origin-right opacity-70">
                                                                {timeFilter}
                                                            </span>
                                                        )}
                                                    </div>
                                                ) : (
                                                    <span className="text-text-dark text-xs">Simulated</span>
                                                )}

                                            </td>
                                            <td className="px-6 py-4 text-right text-xs font-medium text-text-medium">
                                                {timeAgo || <span className="text-text-dark/50">-</span>}
                                            </td>
                                        </tr>
                                    );
                                })
                        )}
                        {portfolioData && portfolioData.assets.some(a => a.rawValue <= 1) && (
                            <tr>
                                <td colSpan={5} className="py-1">
                                    <button
                                        onClick={() => setShowDust(!showDust)}
                                        className="w-full py-3 flex items-center justify-center gap-2 text-xs font-bold text-text-medium hover:text-text-light hover:bg-card-hover/10 transition-colors"
                                    >
                                        {showDust ? (
                                            <>Hide Small Balances <ChevronUp size={14} /></>
                                        ) : (
                                            <>Show Small Balances <ChevronDown size={14} /></>
                                        )}
                                    </button>
                                </td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>

            {portfolioData && portfolioData.assets.length > visibleCount && (
                <div className="p-4 border-t border-border flex justify-center">
                    <button
                        className="text-xs font-bold text-text-medium hover:text-text-light transition-colors"
                        onClick={() => setVisibleCount(prev => prev + 10)}
                    >
                        Load More Assets
                    </button>
                </div>
            )}
        </div>
    );
};
