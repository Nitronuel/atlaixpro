// Route-level product screen for the Atlaix application.
import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    Search, Filter, ChevronDown,
    Wallet, Activity, Layers, Play
} from 'lucide-react';
import { SavedWalletService } from '../services/SavedWalletService';
import { DatabaseService } from '../services/DatabaseService';
import { SavedWallet } from '../types';
import { ChainRouter } from '../services/ChainRouter';
import { ChainActivityService } from '../services/ChainActivityService';
import { detectWalletAddressType } from '../utils/wallet';
import { formatCompactNumber } from '../utils/format';

interface SmartTokenAggregate {
    id: string;
    ticker: string;
    name: string;
    amount: string;
    count: number;
    image: string;
}

interface SmartWalletEvent {
    id: string;
    type: 'buy' | 'sell';
    wallet: string;
    token: string;
    amount: string;
    time: string;
}

const STABLE_TOKEN_SYMBOLS = new Set(['USDC', 'USDT', 'DAI', 'USDE', 'FDUSD', 'USDS', 'TUSD']);

const shortenWallet = (wallet: string) => `${wallet.slice(0, 6)}...${wallet.slice(-4)}`;

const parseUsd = (value: string) => {
    const numeric = Number.parseFloat(value.replace(/[$,]/g, '').trim());
    return Number.isFinite(numeric) ? numeric : 0;
};

const getWalletChain = (walletAddress: string) => {
    return detectWalletAddressType(walletAddress) === 'solana' ? 'Solana' : 'All Chains';
};

const getEventAgeSeconds = (timeLabel: string) => {
    const normalized = timeLabel.toLowerCase().trim();
    const match = normalized.match(/(\d+)\s*([smhd])/);
    if (!match) return Number.MAX_SAFE_INTEGER;
    const value = Number.parseInt(match[1], 10);
    const unit = match[2];
    if (unit === 's') return value;
    if (unit === 'm') return value * 60;
    if (unit === 'h') return value * 3600;
    return value * 86400;
};

export const SmartMoney: React.FC = () => {
    const navigate = useNavigate();
    const [timeRange, setTimeRange] = useState('24h');
    const [chain, setChain] = useState('all');
    const [smartWallets, setSmartWallets] = useState<SavedWallet[]>([]);
    const [loadingWallets, setLoadingWallets] = useState(true);
    const [recentEvents, setRecentEvents] = useState<SmartWalletEvent[]>([]);
    const [topInflows, setTopInflows] = useState<SmartTokenAggregate[]>([]);
    const [topOutflows, setTopOutflows] = useState<SmartTokenAggregate[]>([]);

    useEffect(() => {
        const loadWallets = async () => {
            setLoadingWallets(true);
            const sharedWallets = await DatabaseService.fetchSmartMoneyWallets();
            const nextWallets = sharedWallets.length ? sharedWallets : SavedWalletService.getSmartMoneyWallets();
            setSmartWallets(nextWallets);
            setLoadingWallets(false);
        };

        loadWallets();
    }, []);

    useEffect(() => {
        const hydrateSmartMoneyPanels = async () => {
            if (!smartWallets.length) {
                setRecentEvents([]);
                setTopInflows([]);
                setTopOutflows([]);
                return;
            }

            const sampledWallets = smartWallets.slice(0, 8);
            const smartWalletSet = new Set(sampledWallets.map((wallet) => wallet.addr.toLowerCase()));

            const portfolioResults = await Promise.all(sampledWallets.map(async (wallet) => {
                try {
                    const portfolio = await ChainRouter.fetchPortfolio(getWalletChain(wallet.addr), wallet.addr);
                    return { wallet, portfolio };
                } catch {
                    return null;
                }
            }));

            const validPortfolios = portfolioResults.filter((entry): entry is NonNullable<typeof entry> => Boolean(entry));
            if (!validPortfolios.length) {
                setRecentEvents([]);
                setTopInflows([]);
                setTopOutflows([]);
                return;
            }

            const holdingMap = new Map<string, {
                ticker: string;
                name: string;
                totalUsd: number;
                walletSet: Set<string>;
                image: string;
                address: string;
                chain: string;
                currentPrice: number;
            }>();

            validPortfolios.forEach(({ wallet, portfolio }) => {
                portfolio.assets
                    .filter((asset) => asset.rawValue > 25)
                    .slice(0, 8)
                    .forEach((asset) => {
                        const key = `${(asset.chain || 'unknown').toLowerCase()}:${asset.address.toLowerCase()}`;
                        const existing = holdingMap.get(key);
                        if (existing) {
                            existing.totalUsd += asset.rawValue;
                            existing.walletSet.add(wallet.addr);
                            return;
                        }

                        holdingMap.set(key, {
                            ticker: asset.symbol,
                            name: asset.symbol,
                            totalUsd: asset.rawValue,
                            walletSet: new Set([wallet.addr]),
                            image: asset.logo,
                            address: asset.address,
                            chain: asset.chain || 'Ethereum',
                            currentPrice: asset.currentPrice,
                        });
                    });
            });

            const tokenCandidates = Array.from(holdingMap.values())
                .sort((a, b) => b.totalUsd - a.totalUsd)
                .slice(0, 8);

            setTopInflows(tokenCandidates
                .filter((token) => !STABLE_TOKEN_SYMBOLS.has(token.ticker.toUpperCase()))
                .slice(0, 4)
                .map((token) => ({
                    id: token.address,
                    ticker: token.ticker,
                    name: token.name,
                    amount: formatCompactNumber(token.totalUsd, '$', 1),
                    count: token.walletSet.size,
                    image: token.image
                })));

            const activityResults = await Promise.all(tokenCandidates.map(async (token) => {
                try {
                    const tokenDetails = await DatabaseService.getTokenDetails(token.address, token.chain.toLowerCase());
                    const activity = await ChainActivityService.getTokenActivity(
                        token.address,
                        token.chain,
                        token.currentPrice,
                        tokenDetails?.pairAddress
                    );

                    const smartEvents = activity.filter((event) => smartWalletSet.has(event.wallet.toLowerCase()));
                    return {
                        token,
                        tokenDetails,
                        smartEvents
                    };
                } catch {
                    return {
                        token,
                        tokenDetails: null,
                        smartEvents: []
                    };
                }
            }));

            const eventRows: SmartWalletEvent[] = activityResults.flatMap(({ smartEvents, token }) =>
                smartEvents
                    .filter((event) => event.type === 'Buy' || event.type === 'Sell')
                    .map((event, index) => ({
                        id: `${token.address}-${event.hash}-${index}`,
                        type: event.type === 'Buy' ? 'buy' : 'sell',
                        wallet: shortenWallet(event.wallet),
                        token: token.ticker,
                        amount: event.usd,
                        time: event.time
                    }))
            );

            eventRows.sort((a, b) => getEventAgeSeconds(a.time) - getEventAgeSeconds(b.time));
            setRecentEvents(eventRows.slice(0, 8));

            const outflowMap = new Map<string, {
                ticker: string;
                name: string;
                totalUsd: number;
                walletSet: Set<string>;
                image: string;
            }>();

            activityResults.forEach(({ token, smartEvents }) => {
                const sells = smartEvents.filter((event) => event.type === 'Sell');
                if (!sells.length) return;

                const totalUsd = sells.reduce((sum, event) => sum + parseUsd(event.usd), 0);
                const sellWallets = new Set(sells.map((event) => event.wallet.toLowerCase()));
                outflowMap.set(token.address, {
                    ticker: token.ticker,
                    name: token.name,
                    totalUsd,
                    walletSet: sellWallets,
                    image: token.image
                });
            });

            const resolvedOutflows = Array.from(outflowMap.values())
                .sort((a, b) => b.totalUsd - a.totalUsd)
                .slice(0, 4)
                .map((token) => ({
                    id: token.ticker,
                    ticker: token.ticker,
                    name: token.name,
                    amount: formatCompactNumber(token.totalUsd, '$', 1),
                    count: token.walletSet.size,
                    image: token.image
                }));

            setTopOutflows(resolvedOutflows);
        };

        hydrateSmartMoneyPanels();
    }, [smartWallets, timeRange, chain]);

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
                    <button
                        onClick={() => navigate('/smart-money-scanner')}
                        className="flex items-center gap-2 bg-primary-green hover:bg-primary-green-darker px-4 py-2 rounded-lg text-main text-sm font-black transition-colors shrink-0"
                    >
                        <Play size={16} />
                        <span>Scan</span>
                    </button>
                </div>
            </div>

            {/* --- Main Dashboard Content --- */}
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-12 gap-6">

                {/* --- Column 1: Trending Smart Wallets (Moved from Col 2) --- */}
                <div className="xl:col-span-4 flex flex-col gap-6">
                    <div className="bg-[#111315] border border-[#2A2E33] rounded-2xl overflow-hidden shadow-lg h-full">
                        <div className="px-5 py-4 border-b border-[#2A2E33] flex items-center justify-between">
                            <h3 className="font-bold text-[#EAECEF] flex items-center gap-2">
                                <Wallet size={18} className="text-primary-green" />
                                Trending Smart Wallets
                            </h3>
                        </div>
                        <div className="p-2 space-y-1">
                            {loadingWallets && (
                                <div className="p-4 text-sm text-[#8F96A3]">
                                    Loading shared smart money wallets...
                                </div>
                            )}
                            {!loadingWallets && smartWallets.length === 0 && (
                                <div className="p-4 text-sm text-[#8F96A3]">
                                    No wallets have qualified yet. Track wallets from Wallet Tracker and strong performers will appear here automatically.
                                </div>
                            )}
                            {smartWallets.map((wallet) => (
                                <div
                                    key={wallet.addr}
                                    onClick={() => navigate(`/smart-money/${wallet.addr}`)}
                                    className="p-3 hover:bg-[#1C1F22] rounded-xl transition-colors cursor-pointer group relative border-b border-[#2A2E33]/30 last:border-0"
                                >
                                    {/* Header: Avatar, Badge, Address, Button */}
                                    <div className="flex items-center justify-between mb-0.5">
                                        <div className="flex items-center gap-2.5">
                                            {/* Avatar Gradient */}
                                            <div className="w-7 h-7 rounded-full bg-gradient-to-br from-indigo-500 via-purple-500 to-pink-500 shadow-inner group-hover:scale-105 transition-transform"></div>

                                            <div className="flex flex-col gap-0.5">
                                                <span className="text-sm font-bold text-[#EAECEF] tracking-tight group-hover:text-primary-green transition-colors">{wallet.name}</span>
                                                <span className="text-[10px] text-[#8F96A3] font-mono">{wallet.addr}</span>
                                            </div>
                                        </div>

                                        <button className="px-3 py-1 rounded-lg bg-[#1C1F22] hover:bg-[#2A2E33] border border-[#3C414A] text-[#EAECEF] text-[9px] font-bold transition-colors opacity-0 group-hover:opacity-100">
                                            View
                                        </button>
                                    </div>

                                    {/* Stats Grid */}
                                    <div className="flex justify-between items-start pt-0 pl-10">
                                        <div className="flex flex-col text-left">
                                            <span className="text-[9px] text-[#8F96A3] font-medium mb-0.5 whitespace-nowrap">Win Rate</span>
                                            <span className="text-xs font-bold text-[#EAECEF]">{wallet.lastWinRate || 'N/A'}</span>
                                        </div>
                                        <div className="flex flex-col text-center">
                                            <span className="text-[9px] text-[#8F96A3] font-medium mb-0.5 whitespace-nowrap">Score</span>
                                            <span className="text-xs font-bold text-green-400">{wallet.qualification?.score || 0}/100</span>
                                        </div>
                                        <div className="flex flex-col text-center">
                                            <span className="text-[9px] text-[#8F96A3] font-medium mb-0.5 whitespace-nowrap">PnL</span>
                                            <span className="text-xs font-bold text-green-400">{wallet.lastPnl || 'N/A'}</span>
                                        </div>
                                        <div className="flex flex-col text-right">
                                            <span className="text-[9px] text-[#8F96A3] font-medium mb-0.5 whitespace-nowrap">Balance</span>
                                            <span className="text-xs font-bold text-[#EAECEF]">{wallet.lastBalance || 'N/A'}</span>
                                        </div>
                                    </div>
                                    {wallet.qualification?.reasons?.[0] && (
                                        <div className="pl-10 pt-2 text-[10px] text-[#8F96A3]">
                                            {wallet.qualification.reasons[0]}
                                        </div>
                                    )}
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
                <div className="xl:col-span-4 flex flex-col gap-6">
                    <div className="bg-[#111315] border border-[#2A2E33] rounded-2xl overflow-hidden shadow-lg h-full">
                        <div className="px-5 py-4 border-b border-[#2A2E33] flex items-center justify-between">
                            <h3 className="font-bold text-[#EAECEF] flex items-center gap-2">
                                <Activity size={18} className="text-primary-green" />
                                Smart Money Events
                            </h3>
                            <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse shadow-[0_0_8px_rgba(34,197,94,0.5)]"></div>
                        </div>
                        <div className="p-2 space-y-1">
                            {!loadingWallets && recentEvents.length === 0 && (
                                <div className="p-4 text-sm text-[#8F96A3]">
                                    No recent buy or sell activity has been confirmed from the current smart-wallet set yet.
                                </div>
                            )}
                            {recentEvents.map((event, i) => (
                                <div
                                    key={i}
                                    onClick={() => navigate(`/token-smart-money/${event.token}`)}
                                    className="p-3 hover:bg-[#1C1F22] rounded-xl transition-colors cursor-pointer group relative"
                                >
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
                <div className="sm:col-span-2 xl:col-span-4 grid grid-cols-1 sm:grid-cols-2 xl:flex xl:flex-col gap-6">
                    {/* Top Inflows */}
                    <section className="bg-[#111315] border border-[#2A2E33] rounded-2xl overflow-hidden flex flex-col">
                        <div className="px-6 py-4 border-b border-[#2A2E33] flex items-center justify-between">
                            <h2 className="font-bold text-[#EAECEF]">Smart Money Top Inflows</h2>
                        </div>

                        <div className="p-4 flex flex-col gap-2">
                            {!loadingWallets && topInflows.length === 0 && (
                                <div className="text-sm text-[#8F96A3]">
                                    Smart-money inflows will appear here once qualified wallets build overlapping token positions.
                                </div>
                            )}
                            {topInflows.map((token) => (
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
                            {!loadingWallets && topOutflows.length === 0 && (
                                <div className="text-sm text-[#8F96A3]">
                                    No recent smart-money sell pressure has been confirmed yet.
                                </div>
                            )}
                            {topOutflows.map((token) => (
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
