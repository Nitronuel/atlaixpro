import React from 'react';
import { Loader2 } from 'lucide-react';
import { WalletStats } from '../../hooks/useWalletPortfolio';

interface WalletStatsGridProps {
    stats: WalletStats;
    loading: boolean;
}

export const WalletStatsGrid: React.FC<WalletStatsGridProps> = ({ stats, loading }) => {
    return (
        <div className="w-full grid grid-cols-2 gap-3">
            <div className="bg-main/50 rounded-lg p-3">
                <div className="text-[10px] text-text-dark font-bold uppercase mb-1">Win Rate</div>
                <div className="text-lg font-bold text-primary-green">
                    {loading ? <Loader2 className="animate-spin text-primary-green" size={20} /> : stats.winRate}
                </div>
            </div>
            <div className="bg-main/50 rounded-lg p-3">
                <div className="text-[10px] text-text-dark font-bold uppercase mb-1">Total PnL</div>
                <div className={`text-lg font-bold ${loading ? '' : stats.totalPnL.includes('+') ? 'text-primary-green' : stats.totalPnL.includes('-') ? 'text-primary-red' : 'text-text-light'}`}>
                    {loading ? <Loader2 className="animate-spin text-primary-green" size={20} /> : stats.totalPnL}
                </div>
            </div>
            <div className="bg-main/50 rounded-lg p-3">
                <div className="text-[10px] text-text-dark font-bold uppercase mb-1">Net Worth</div>
                <div className="text-sm font-bold text-text-light truncate" title={stats.netWorth}>
                    {loading ? <Loader2 className="animate-spin text-text-light" size={16} /> : stats.netWorth}
                </div>
            </div>
            <div className="bg-main/50 rounded-lg p-3">
                <div className="text-[10px] text-text-dark font-bold uppercase mb-1">Active Pos</div>
                <div className="text-lg font-bold text-text-light">
                    {loading ? <Loader2 className="animate-spin text-text-light" size={20} /> : stats.activePositions}
                </div>
            </div>
            <div className="bg-main/50 rounded-lg p-3">
                <div className="text-[10px] text-text-dark font-bold uppercase mb-1">Profitable Trades</div>
                <div className={`text-lg font-bold ${loading ? '' : parseInt(stats.profitableTrader) > 0 ? 'text-primary-green' : 'text-text-light'}`}>
                    {loading ? <Loader2 className="animate-spin text-text-light" size={20} /> : stats.profitableTrader}
                </div>
            </div>
            <div className="bg-main/50 rounded-lg p-3">
                <div className="text-[10px] text-text-dark font-bold uppercase mb-1">Avg Hold Time</div>
                <div className="text-lg font-bold text-text-light">
                    {loading ? <Loader2 className="animate-spin text-text-light" size={20} /> : stats.avgHoldTime}
                </div>
            </div>
        </div>
    );
};
