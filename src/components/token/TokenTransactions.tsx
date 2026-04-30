// Atlaix: Reusable interface component for Atlaix product workflows.
import React from 'react';
import { RealActivity } from '../../services/ChainActivityService';
import { EnrichedTokenData } from '../../types';

interface TokenTransactionsProps {
    activityFeed: RealActivity[];
    enrichedData: EnrichedTokenData | null;
    isRealData: boolean;
}

export const TokenTransactions: React.FC<TokenTransactionsProps> = ({ activityFeed, enrichedData, isRealData }) => {
    // Left Col: High Signal Only
    const highSignalEvents = activityFeed.filter(a => ['Burn', 'Whale', 'Add Liq', 'Remove Liq'].includes(a.tag || a.type));

    // Right Col: Market Interactions (Everything else: Buys, Sells, Transfers)
    // We also exclude Whales from here to avoid duplication if user strictly wants separation, 
    // OR we can include everything. User said "wallet interactions... populated with buys, sells and transfer".
    // I will include ALL market interactions here.
    const marketEvents = activityFeed.filter(a => ['Buy', 'Sell', 'Transfer'].includes(a.type) && a.tag !== 'Burn');

    return (
        <div className="contents xl:flex xl:flex-row gap-6 w-full h-[600px]">
            {/* On-Chain Activity (High Signal) */}
            <div className="flex-1 min-w-0 bg-card border border-border rounded-xl p-4 h-full flex flex-col order-3 lg:order-none">
                <div className="flex justify-between items-center mb-5">
                    <h3 className="text-sm font-bold text-text-light uppercase tracking-wide">On-Chain Activity</h3>
                </div>

                <div className="flex flex-col flex-grow overflow-y-auto custom-scrollbar">
                    {highSignalEvents.length === 0 ? (
                        <div className="text-center text-text-dark text-xs py-10">No major whale or burn events recently.</div>
                    ) : (
                        highSignalEvents.slice(0, 20).map((item, i) => (
                            <div key={i} className={`flex items-center justify-between py-4 border-b border-border/50 last:border-0 hover:bg-card-hover/20 transition-colors`}>
                                <div>
                                    <div className={`font-bold text-sm ${item.color} mb-0.5`}>{item.tag || item.type}</div>
                                    <div className="text-xs text-text-medium">
                                        <span className="font-bold text-text-light">{item.val} {enrichedData?.baseToken.symbol}</span> {item.desc}
                                    </div>
                                </div>
                                <div className="flex flex-col items-end">
                                    <div className="text-xs font-bold text-text-light">{item.usd}</div>
                                    <div className="text-[10px] text-text-dark font-mono font-medium whitespace-nowrap">{item.time}</div>
                                </div>
                            </div>
                        ))
                    )}
                </div>
            </div>

            {/* Wallet Interactions (Market) */}
            <div className="flex-1 min-w-0 bg-card border border-border rounded-xl p-4 h-full flex flex-col order-4 lg:order-none">
                <div className="flex justify-between items-center mb-6">
                    <h3 className="text-sm font-bold text-text-light uppercase tracking-wide">Wallet Interactions</h3>
                </div>
                <div className="overflow-x-auto flex-grow custom-scrollbar pb-2">
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="text-left text-xs text-text-dark uppercase tracking-wider border-b border-border">
                                <th className="pb-4 pl-2 font-bold w-[15%]">Action</th>
                                <th className="pb-4 font-bold w-[25%]">Amount</th>
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
                                    <td className="py-4 text-text-medium font-medium text-xs whitespace-nowrap">{row.time}</td>
                                    <td className="py-4">
                                        <div className="flex flex-col">
                                            <span className="font-mono text-primary-blue cursor-pointer hover:underline text-xs">
                                                {row.wallet.slice(0, 6)}...{row.wallet.slice(-4)}
                                            </span>
                                        </div>
                                    </td>
                                    <td className="py-4 text-right pr-2">
                                        <button className="px-3 py-1 bg-card border border-border text-text-medium text-[10px] font-bold rounded hover:bg-card-hover hover:text-text-light transition-all uppercase">
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
