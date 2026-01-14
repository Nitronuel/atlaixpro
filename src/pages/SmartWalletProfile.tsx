import React from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
    ArrowLeft, Copy, ExternalLink, ShieldCheck,
    Share2, Info, Wallet, TrendingUp, Clock,
    ArrowUpRight, ArrowDownRight, Activity
} from 'lucide-react';

const MOCK_POSITIONS = [
    { id: 1, symbol: 'LINK', name: 'Chainlink', position: '$500k', size: '33%', entry: '$10', current: '$15', pnl: '+$250k', pnlPercent: '+50%', score: 'High', image: 'https://assets.coingecko.com/coins/images/877/small/chainlink-new-logo.png' },
    { id: 2, symbol: 'ETH', name: 'Ethereum', position: '$1.2M', size: '45%', entry: '$2200', current: '$3100', pnl: '+$400k', pnlPercent: '+41%', score: 'High', image: 'https://assets.coingecko.com/coins/images/279/small/ethereum.png' },
    { id: 3, symbol: 'PEPE', name: 'Pepe', position: '$300k', size: '12%', entry: '$0.000001', current: '$0.000003', pnl: '+$600k', pnlPercent: '+200%', score: 'Medium', image: 'https://assets.coingecko.com/coins/images/29850/small/pepe-token.jpeg' },
    { id: 4, symbol: 'USDC', name: 'USD Coin', position: '$150k', size: '10%', entry: '$1.00', current: '$1.00', pnl: '$0', pnlPercent: '0%', score: 'Low', image: 'https://assets.coingecko.com/coins/images/6319/small/USD_Coin_icon.png' },
];

const OVERVIEW_CARDS = [
    { title: 'Total trades', value: '150', icon: Activity, color: 'text-[#EAECEF]' },
    { title: 'Hit rate', value: '75%', icon: ShieldCheck, color: 'text-green-400' },
    { title: 'Total PnL', value: '$1.5M', icon: TrendingUp, color: 'text-green-400' },
    { title: 'Avg entry timing', value: 'Early', icon: Clock, color: 'text-[#EAECEF]' },
    { title: 'Avg hold duration', value: '45 days', icon: Clock, color: 'text-[#EAECEF]' },
    { title: 'Main chain used', value: 'Ethereum', icon: Wallet, color: 'text-[#EAECEF]' },
];

export const SmartWalletProfile: React.FC = () => {
    const { address } = useParams();
    const navigate = useNavigate();

    return (
        <div className="flex flex-col gap-6 pb-8 animate-fade-in w-full max-w-[1600px] mx-auto">

            {/* --- Header Section --- */}
            <div className="flex flex-col gap-6 bg-[#111315] border border-[#2A2E33] p-6 rounded-2xl">
                <div className="flex items-center gap-4">
                    <button
                        onClick={() => navigate(-1)}
                        className="p-2 hover:bg-[#1C1F22] rounded-lg text-[#8F96A3] hover:text-[#EAECEF] transition-colors"
                    >
                        <ArrowLeft size={20} />
                    </button>
                    <div className="w-12 h-12 rounded-full bg-gradient-to-br from-green-400/20 to-blue-500/20 border border-green-500/30 flex items-center justify-center">
                        <Wallet size={24} className="text-primary-green" />
                    </div>
                    <div>
                        <div className="text-sm text-[#8F96A3] font-medium mb-1">Smart Money Wallet</div>
                        <div className="flex items-center gap-3">
                            <h1 className="text-2xl font-bold text-[#EAECEF]">{address || '0xabc...123'}</h1>

                            <button className="text-[#8F96A3] hover:text-[#EAECEF] transition-colors"><Copy size={16} /></button>
                            <button className="text-[#8F96A3] hover:text-[#EAECEF] transition-colors"><ExternalLink size={16} /></button>
                        </div>
                    </div>

                    <div className="ml-auto grid grid-cols-4 gap-8 text-right">
                        <div className="flex flex-col items-end gap-1">
                            <span className="text-[10px] text-[#8F96A3] uppercase tracking-wider font-semibold flex items-center gap-1">Score</span>
                            <span className="text-lg font-bold text-green-400">92</span>
                        </div>
                        <div className="flex flex-col items-end gap-1">
                            <span className="text-[10px] text-[#8F96A3] uppercase tracking-wider font-semibold flex items-center gap-1">Profit</span>
                            <span className="text-lg font-bold text-green-400">+$1.5M</span>
                        </div>
                        <div className="flex flex-col items-end gap-1">
                            <span className="text-[10px] text-[#8F96A3] uppercase tracking-wider font-semibold flex items-center gap-1">Win Rate</span>
                            <span className="text-lg font-bold text-green-400">85%</span>
                        </div>
                        <div className="flex flex-col items-end gap-1">
                            <span className="text-[10px] text-[#8F96A3] uppercase tracking-wider font-semibold">Joined</span>
                            <span className="text-lg font-bold text-[#EAECEF]">15/01/2023</span>
                        </div>
                    </div>
                </div>
            </div>

            {/* --- Overview Cards --- */}
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
                {OVERVIEW_CARDS.map((card, idx) => (
                    <div key={idx} className="bg-[#111315] border border-[#2A2E33] p-4 rounded-xl flex flex-col justify-between h-24 relative overflow-hidden group hover:border-[#363B41] transition-colors">
                        <div className="flex items-center justify-between z-10">
                            <span className="text-[10px] text-[#8F96A3] uppercase tracking-wider font-semibold flex items-center gap-1">
                                {card.title}
                            </span>
                        </div>
                        <div className={`text-base font-bold ${card.color} z-10`}>{card.value}</div>

                        {/* Background Icon decoration */}
                        <card.icon
                            className="absolute -right-4 -bottom-4 text-[#1C1F22] group-hover:text-[#222529] transition-colors"
                            size={64}
                            strokeWidth={1}
                        />
                    </div>
                ))}
            </div>

            {/* --- Wallet Portfolio --- */}
            <div className="bg-[#111315] border border-[#2A2E33] rounded-2xl overflow-hidden flex flex-col">
                <div className="px-6 py-4 border-b border-[#2A2E33] flex items-center justify-between">
                    <h2 className="font-bold text-[#EAECEF] text-lg">Wallet Portfolio (Active Positions)</h2>
                </div>

                <div className="overflow-x-auto">
                    <table className="w-full">
                        <thead className="bg-[#1C1F22] text-[#8F96A3] text-xs font-semibold uppercase tracking-wider">
                            <tr>
                                <th className="px-6 py-3 text-left">Token</th>
                                <th className="px-6 py-3 text-right">Position</th>
                                <th className="px-6 py-3 text-right">% of Portfolio</th>
                                <th className="px-6 py-3 text-right">Entry vs Current</th>
                                <th className="px-6 py-3 text-right">Unrealized PnL</th>
                                <th className="px-6 py-3 text-center">Score</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-[#2A2E33]">
                            {MOCK_POSITIONS.map((pos) => (
                                <tr key={pos.id} className="hover:bg-[#1C1F22]/50 transition-colors group">
                                    <td className="px-6 py-4">
                                        <div className="flex items-center gap-3">
                                            <img src={pos.image} alt={pos.symbol} className="w-8 h-8 rounded-full" />
                                            <div>
                                                <div className="font-bold text-[#EAECEF]">{pos.symbol}</div>
                                                <div className="text-xs text-[#8F96A3]">{pos.name}</div>
                                            </div>
                                        </div>
                                    </td>
                                    <td className="px-6 py-4 text-right">
                                        <div className="font-bold text-[#EAECEF]">{pos.position}</div>
                                        <div className="text-xs text-[#8F96A3]">Position size</div>
                                    </td>
                                    <td className="px-6 py-4 text-right">
                                        <div className="font-bold text-[#EAECEF]">{pos.size}</div>
                                        <div className="text-xs text-[#8F96A3]">of portfolio</div>
                                    </td>
                                    <td className="px-6 py-4 text-right">
                                        <div className="flex items-center justify-end gap-1 text-[#EAECEF] font-bold">
                                            {pos.entry} <span className="text-[#5D6470] text-xs">vs</span> {pos.current}
                                        </div>
                                        <div className="text-xs text-[#8F96A3]">Entry vs current</div>
                                    </td>
                                    <td className="px-6 py-4 text-right">
                                        <div className={`font-bold ${pos.pnl.startsWith('+') ? 'text-green-400' : 'text-[#EAECEF]'}`}>{pos.pnl}</div>
                                        <div className={`text-xs ${pos.pnl.startsWith('+') ? 'text-green-500/70' : 'text-[#8F96A3]'}`}>{pos.pnlPercent}</div>
                                    </td>
                                    <td className="px-6 py-4 text-center">
                                        <span className={`inline-block px-3 py-1 rounded-full text-xs font-bold border ${pos.score === 'High' ? 'bg-green-500/10 text-green-400 border-green-500/20' :
                                            pos.score === 'Medium' ? 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20' :
                                                'bg-red-500/10 text-red-400 border-red-500/20'
                                            }`}>
                                            {pos.score}
                                        </span>
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
