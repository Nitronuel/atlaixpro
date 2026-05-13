// Reusable interface component for Atlaix product workflows.
import React from 'react';
import { useNavigate } from 'react-router-dom';
import { RealActivity } from '../../services/ChainActivityService';
import { EnrichedTokenData } from '../../types';

interface TokenTransactionsProps {
    activityFeed: RealActivity[];
    enrichedData: EnrichedTokenData | null;
    isRealData: boolean;
}

export const TokenTransactions: React.FC<TokenTransactionsProps> = ({ activityFeed, enrichedData, isRealData }) => {
    const navigate = useNavigate();
    const marketEvents = activityFeed.filter(a => ['Buy', 'Sell', 'Transfer'].includes(a.type) && a.tag !== 'Burn');

    return (
        <div className="w-full h-[600px]">
            <div className="min-w-0 bg-card border border-border rounded-xl p-4 h-full flex flex-col">
                <div className="flex justify-between items-center mb-6">
                    <h3 className="text-sm font-bold text-text-light uppercase tracking-wide">Wallet Interactions</h3>
                </div>
                <div className="overflow-x-auto flex-grow custom-scrollbar pb-2">
                    <table className="w-full min-w-[720px] text-sm">
                        <thead>
                            <tr className="text-left text-xs text-text-dark uppercase tracking-wider border-b border-border">
                                <th className="pb-4 pl-2 font-bold w-[15%]">Action</th>
                                <th className="pb-4 font-bold w-[25%]">Amount</th>
                                <th className="pb-4 font-bold w-[15%]">Cost</th>
                                <th className="pb-4 font-bold w-[15%]">Time</th>
                                <th className="pb-4 font-bold w-[25%]">Wallet</th>
                                <th className="pb-4 text-right pr-2 font-bold w-[20%]">Track</th>
                            </tr>
                        </thead>
                        <tbody>
                            {marketEvents.slice(0, 50).map((row, i) => (
                                <tr key={i} className="border-b border-border/50 last:border-0 hover:bg-card-hover/40 transition-colors">
                                    <td className="py-4 pl-2">
                                        <span className={`px-2.5 py-1 rounded-md text-[10px] font-bold uppercase tracking-wide 
                                            ${row.type === 'Buy' ? 'bg-primary-green/10 text-primary-green' :
                                                row.type === 'Sell' ? 'bg-primary-red/10 text-primary-red' :
                                                    row.tag === 'Whale' ? 'bg-purple-500/10 text-purple-500' :
                                                        'bg-primary-blue/10 text-primary-blue'
                                            }`}>
                                            {row.type}
                                        </span>
                                    </td>
                                    <td className="py-4 font-bold text-text-light text-xs">{row.val} {enrichedData?.baseToken.symbol}</td>
                                    <td className="py-4 font-bold text-text-light text-xs">{row.usd || '-'}</td>
                                    <td className="py-4 text-text-medium font-medium text-xs whitespace-nowrap">{row.time}</td>
                                    <td className="py-4">
                                        <div className="flex flex-col">
                                            <span className="font-mono text-primary-blue cursor-pointer hover:underline text-xs">
                                                {row.wallet.slice(0, 6)}...{row.wallet.slice(-4)}
                                            </span>
                                        </div>
                                    </td>
                                    <td className="py-4 text-right pr-2">
                                        <button
                                            onClick={() => row.wallet && navigate(`/wallet/${encodeURIComponent(row.wallet)}`)}
                                            disabled={!row.wallet}
                                            className="px-3 py-1 bg-card border border-border text-text-medium text-[10px] font-bold rounded hover:bg-card-hover hover:text-text-light transition-all uppercase disabled:cursor-not-allowed disabled:opacity-50"
                                        >
                                            View
                                        </button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
};
