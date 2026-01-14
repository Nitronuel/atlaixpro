import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    Search, Filter, ChevronDown, ArrowUpRight, ArrowDownRight,
    Wallet, Clock, Zap, TrendingUp, Activity, ExternalLink,
    ChevronRight, Shield, AlertTriangle, Layers
} from 'lucide-react';

// --- Mock Data ---

const MOCK_INFLOWS = [
    { id: 1, ticker: 'ETH', name: 'Ethereum', amount: '$1.2M', count: 25, change: '+12%', type: 'net-inflow', image: 'https://assets.coingecko.com/coins/images/279/small/ethereum.png' },
    { id: 2, ticker: 'SOL', name: 'Solana', amount: '$850k', count: 42, change: '+8%', type: 'net-inflow', image: 'https://assets.coingecko.com/coins/images/4128/small/solana.png' },
    { id: 3, ticker: 'LINK', name: 'Chainlink', amount: '$420k', count: 18, change: '+15%', type: 'net-inflow', image: 'https://assets.coingecko.com/coins/images/877/small/chainlink-new-logo.png' },
    { id: 4, ticker: 'ONDO', name: 'Ondo', amount: '$310k', count: 12, change: '+5%', type: 'net-inflow', image: 'https://assets.coingecko.com/coins/images/17926/small/ondo.png' },
];

const MOCK_OUTFLOWS = [
    { id: 1, ticker: 'USDC', name: 'USD Coin', amount: '$1.5M', count: 55, change: '-5%', type: 'outflow', image: 'https://assets.coingecko.com/coins/images/6319/small/USD_Coin_icon.png' },
    { id: 2, ticker: 'PEPE', name: 'Pepe', amount: '$900k', count: 32, change: '-12%', type: 'outflow', image: 'https://assets.coingecko.com/coins/images/29850/small/pepe-token.jpeg' },
    { id: 3, ticker: 'WIF', name: 'dogwifhat', amount: '$600k', count: 28, change: '-8%', type: 'outflow', image: 'https://assets.coingecko.com/coins/images/33566/small/dogwifhat.jpeg' },
    { id: 4, ticker: 'ARB', name: 'Arbitrum', amount: '$250k', count: 15, change: '-3%', type: 'outflow', image: 'https://assets.coingecko.com/coins/images/16547/small/arbitrum.png' },
];

const TRENDING_WALLETS = [
    { id: 1, address: '0x7a...9f2b', tag: 'Smart Money', winRate: '78%', pnl: '+$133.9k', score: 92, volume: '$2.4M' },
    { id: 2, address: '0x3c...1a8d', tag: 'Smart Money', winRate: '82%', pnl: '+$450.2k', score: 88, volume: '$5.1M' },
    { id: 3, address: '0x9b...4e1c', tag: 'Smart Money', winRate: '65%', pnl: '+$89.5k', score: 85, volume: '$1.2M' },
    { id: 4, address: '0x2d...8f3a', tag: 'Smart Money', winRate: '90%', pnl: '+$67.1k', score: 81, volume: '$850k' },
    { id: 5, address: '0x1f...5e9b', tag: 'Smart Money', winRate: '72%', pnl: '+$210.5k', score: 79, volume: '$3.5M' },
];

const RECENT_EVENTS = [
    { id: 1, type: 'buy', wallet: 'Whale...9f2b', token: 'ETH', amount: '$125k', time: '2 mins ago' },
    { id: 2, type: 'sell', wallet: 'Smart...1a8d', token: 'PEPE', amount: '$45k', time: '5 mins ago' },
    { id: 3, type: 'buy', wallet: 'Sniper...8f3a', token: 'MOG', amount: '$12k', time: '8 mins ago' },
    { id: 4, type: 'buy', wallet: 'Whale...5e9b', token: 'SOL', amount: '$250k', time: '12 mins ago' },
    { id: 5, type: 'sell', wallet: 'Early...4e1c', token: 'WIF', amount: '$85k', time: '15 mins ago' },
    { id: 6, type: 'buy', wallet: 'Smart...1a8d', token: 'LINK', amount: '$60k', time: '22 mins ago' },
];

export const SmartMoney: React.FC = () => {
    const navigate = useNavigate();
    const [timeRange, setTimeRange] = useState('24h');
    const [chain, setChain] = useState('all');

    return (
        <div className="flex flex-col gap-6 pb-8 animate-fade-in w-full max-w-[1600px] mx-auto">

            {/* --- Filter Bar --- */}
            <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 bg-[#111315] border border-[#2A2E33] p-4 rounded-xl shadow-md">
                <div className="flex items-center gap-2 overflow-x-auto w-full md:w-auto no-scrollbar">
                    {/* Chain Selector */}
                    <div className="relative group shrink-0">
                        <button className="flex items-center gap-2 bg-[#1C1F22] hover:bg-[#222529] border border-[#2A2E33] px-4 py-2 rounded-lg text-sm text-[#EAECEF] font-medium transition-colors">
                            <Layers size={16} className="text-primary-green" />
                            All Chains
                            <ChevronDown size={14} className="text-[#8F96A3]" />
                        </button>
                    </div>

                    {/* Time Range */}
                    <div className="flex bg-[#1C1F22] border border-[#2A2E33] rounded-lg p-1 shrink-0">
                        {['1h', '4h', '24h', '7d'].map((t) => (
                            <button
                                key={t}
                                onClick={() => setTimeRange(t)}
                                className={`px-3 py-1.5 rounded-md text-xs font-bold transition-all ${timeRange === t
                                    ? 'bg-[#2A2E33] text-[#EAECEF] shadow-sm'
                                    : 'text-[#8F96A3] hover:text-[#EAECEF]'
                                    }`}
                            >
                                {t}
                            </button>
                        ))}
                    </div>
                </div>

                <div className="flex items-center gap-3 w-full md:w-auto">
                    {/* Search */}
                    <div className="relative flex-1 md:w-64">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-[#8F96A3]" size={16} />
                        <input
                            type="text"
                            placeholder="Search token..."
                            className="w-full bg-[#1C1F22] border border-[#2A2E33] rounded-lg pl-10 pr-4 py-2 text-sm text-[#EAECEF] placeholder-[#5D6470] focus:border-primary-green/50 focus:outline-none transition-colors"
                        />
                    </div>

                    {/* Filter Button */}
                    <button className="flex items-center gap-2 bg-[#1C1F22] hover:bg-[#222529] border border-[#2A2E33] px-3 py-2 rounded-lg text-[#EAECEF] text-sm font-medium transition-colors shrink-0">
                        <Filter size={16} />
                        <span className="hidden md:inline">Filters</span>
                    </button>
                </div>
            </div>

            {/* --- Main Dashboard Content --- */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">

                {/* --- Column 1: Trending Smart Wallets (Moved from Col 2) --- */}
                <div className="lg:col-span-4 flex flex-col gap-6">
                    <div className="bg-[#111315] border border-[#2A2E33] rounded-2xl overflow-hidden shadow-lg h-full">
                        <div className="px-5 py-4 border-b border-[#2A2E33] flex items-center justify-between">
                            <h3 className="font-bold text-[#EAECEF] flex items-center gap-2">
                                <Wallet size={18} className="text-primary-green" />
                                Trending Smart Wallets
                            </h3>
                        </div>
                        <div className="p-2 space-y-1">
                            {TRENDING_WALLETS.map((wallet) => (
                                <div
                                    key={wallet.id}
                                    onClick={() => navigate(`/smart-money/${wallet.address}`)}
                                    className="px-3 py-4 hover:bg-[#1C1F22] rounded-xl transition-colors cursor-pointer group"
                                >
                                    <div className="flex items-start gap-3 mb-2">
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center justify-between mb-2">
                                                <span className="text-xs font-bold text-white bg-green-500/10 px-1.5 rounded">{wallet.tag}</span>
                                                <span className="text-xs text-[#5D6470]">{wallet.address}</span>
                                            </div>
                                            <div className="grid grid-cols-3 items-center text-xs">
                                                <div className="text-left">
                                                    <span className="text-[#8F96A3]">Win: <span className="text-[#EAECEF] font-semibold">{wallet.winRate}</span></span>
                                                </div>
                                                <div className="text-center">
                                                    <span className="text-[#8F96A3]">Vol: <span className="text-[#EAECEF] font-semibold">{wallet.volume}</span></span>
                                                </div>
                                                <div className="text-right">
                                                    <span className="text-[#8F96A3]">PnL: <span className="text-green-400 font-semibold">{wallet.pnl}</span></span>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                    <div className="w-full bg-[#2A2E33] h-1 rounded-full overflow-hidden">
                                        <div className="bg-green-500 h-full" style={{ width: `${wallet.score}%` }}></div>
                                    </div>
                                </div>
                            ))}
                        </div>
                        <div className="p-3 border-t border-[#2A2E33] bg-[#1C1F22]/50">
                            <button className="w-full py-2 text-xs font-bold text-[#8F96A3] hover:text-[#EAECEF] transition-colors border border-dashed border-[#2A2E33] hover:border-[#5D6470] rounded-lg">
                                View Leaderboard
                            </button>
                        </div>
                    </div>
                </div>

                {/* --- Column 2: Recent Events Feed (Moved from Col 3) --- */}
                <div className="lg:col-span-4 flex flex-col gap-6">
                    <div className="bg-[#111315] border border-[#2A2E33] rounded-2xl overflow-hidden shadow-lg h-full">
                        <div className="px-5 py-4 border-b border-[#2A2E33] flex items-center justify-between">
                            <h3 className="font-bold text-[#EAECEF] flex items-center gap-2">
                                <Activity size={18} className="text-primary-green" />
                                Smart Money Events
                            </h3>
                            <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse shadow-[0_0_8px_rgba(34,197,94,0.5)]"></div>
                        </div>
                        <div className="p-2 space-y-1">
                            {RECENT_EVENTS.map((event, i) => (
                                <div key={i} className="p-3 hover:bg-[#1C1F22] rounded-xl transition-colors cursor-pointer group relative">
                                    <div className={`absolute left-0 top-3 bottom-3 w-1 rounded-full ${event.type === 'buy' ? 'bg-green-500' : 'bg-red-500'}`}></div>

                                    <div className="flex flex-col gap-1 w-full pl-4">
                                        {/* Top Row: Tag + Token + Time */}
                                        <div className="flex items-center justify-between">
                                            <div className="flex items-center gap-2">
                                                <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${event.type === 'buy' ? 'bg-green-500/10 text-green-400' : 'bg-red-500/10 text-red-400'
                                                    }`}>
                                                    {event.type === 'buy' ? 'BUY' : 'SELL'}
                                                </span>
                                                <span className="text-xs font-bold text-[#EAECEF]">{event.token}</span>
                                            </div>
                                            <span className="text-xs text-[#5D6470]">{event.time}</span>
                                        </div>

                                        {/* Bottom Row: Wallet + Amount */}
                                        <div className="flex items-center justify-between">
                                            <span className="text-xs text-[#8F96A3]">{event.wallet}</span>
                                            <span className="text-xs font-bold text-[#EAECEF]">{event.amount}</span>
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                        <div className="p-3 border-t border-[#2A2E33] bg-[#1C1F22]/50">
                            <button className="w-full py-2 text-xs font-bold text-[#8F96A3] hover:text-[#EAECEF] transition-colors border border-dashed border-[#2A2E33] hover:border-[#5D6470] rounded-lg">
                                View All Events
                            </button>
                        </div>
                    </div>
                </div>

                {/* --- Column 3: Inflows & Outflows (Moved from Col 1) --- */}
                <div className="lg:col-span-4 flex flex-col gap-6">
                    {/* Top Inflows */}
                    <section className="bg-[#111315] border border-[#2A2E33] rounded-2xl overflow-hidden flex flex-col">
                        <div className="px-6 py-4 border-b border-[#2A2E33] flex items-center justify-between">
                            <h2 className="font-bold text-[#EAECEF]">Smart Money Top Inflows</h2>
                        </div>

                        <div className="p-4 flex flex-col gap-2">
                            {MOCK_INFLOWS.map((token) => (
                                <div key={token.id} className="bg-[#1C1F22] border border-[#2A2E33] hover:border-green-500/30 px-3 py-2.5 rounded-xl transition-all cursor-pointer group flex items-center justify-between h-[64px]">
                                    {/* Left: Token Info */}
                                    <div className="flex items-center gap-3">
                                        <div className="w-8 h-8 rounded-full bg-[#2A2E33] flex items-center justify-center overflow-hidden border border-[#363B41]">
                                            <img src={token.image} alt={token.ticker} className="w-full h-full object-cover" />
                                        </div>
                                        <div className="flex flex-col">
                                            <div className="font-bold text-[#EAECEF] text-xs leading-none group-hover:text-green-400 transition-colors mb-1">{token.ticker}</div>
                                            <div className="text-[10px] text-[#8F96A3] uppercase tracking-wider font-semibold whitespace-nowrap">Net Inflow</div>
                                        </div>
                                    </div>

                                    {/* Center: Amount & Wallets */}
                                    <div className="flex flex-col items-end mr-3 gap-0.5">
                                        <div className="font-bold text-[#EAECEF] text-xs leading-none">{token.amount}</div>
                                        <div className="text-[10px] text-[#8F96A3] whitespace-nowrap"><span className="text-white font-medium">{token.count}</span> smart wallets</div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </section>

                    {/* Top Outflows */}
                    <section className="bg-[#111315] border border-[#2A2E33] rounded-2xl overflow-hidden flex flex-col">
                        <div className="px-6 py-4 border-b border-[#2A2E33] flex items-center justify-between">
                            <h2 className="font-bold text-[#EAECEF]">Smart Money Selling / Outflow</h2>
                        </div>

                        <div className="p-4 flex flex-col gap-2">
                            {MOCK_OUTFLOWS.map((token) => (
                                <div key={token.id} className="bg-[#1C1F22] border border-[#2A2E33] hover:border-red-500/30 px-3 py-2.5 rounded-xl transition-all cursor-pointer group flex items-center justify-between h-[64px]">
                                    {/* Left: Token Info */}
                                    <div className="flex items-center gap-3">
                                        <div className="w-8 h-8 rounded-full bg-[#2A2E33] flex items-center justify-center overflow-hidden border border-[#363B41]">
                                            <img src={token.image} alt={token.ticker} className="w-full h-full object-cover" />
                                        </div>
                                        <div className="flex flex-col">
                                            <div className="font-bold text-[#EAECEF] text-xs leading-none group-hover:text-red-400 transition-colors mb-1">{token.ticker}</div>
                                            <div className="text-[10px] text-[#8F96A3] uppercase tracking-wider font-semibold whitespace-nowrap">Net Outflow</div>
                                        </div>
                                    </div>

                                    {/* Center: Amount & Wallets */}
                                    <div className="flex flex-col items-end mr-3 gap-0.5">
                                        <div className="font-bold text-[#EAECEF] text-xs leading-none">{token.amount}</div>
                                        <div className="text-[10px] text-[#8F96A3] whitespace-nowrap"><span className="text-white font-medium">{token.count}</span> smart wallets</div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </section>
                </div>

            </div>
        </div>
    );
};
