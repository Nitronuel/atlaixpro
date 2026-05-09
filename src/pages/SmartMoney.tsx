// Route-level product screen for the Atlaix application.
import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    Search, Filter, ChevronDown,
    Wallet, Activity, Layers
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
    chain?: string;
}

interface SmartWalletEvent {
    id: string;
    type: 'buy' | 'sell';
    wallet: string;
    walletAddress: string;
    token: string;
    tokenAddress: string;
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

const CHAIN_FILTERS = [
    { id: 'all', label: 'All Chains' },
    { id: 'solana', label: 'Solana' },
    { id: 'ethereum', label: 'Ethereum' },
    { id: 'base', label: 'Base' }
];

export const mergeSmartMoneyWallets = (sharedWallets: SavedWallet[], localWallets: SavedWallet[]) => {
    const byAddress = new Map<string, SavedWallet>();

    [...sharedWallets, ...localWallets].forEach((wallet) => {
        const key = wallet.addr.toLowerCase();
        const existing = byAddress.get(key);
        if (!existing) {
            byAddress.set(key, wallet);
            return;
        }

        const existingScore = existing.qualification?.score || 0;
        const incomingScore = wallet.qualification?.score || 0;
        const bestQualification = incomingScore > existingScore ? wallet.qualification : existing.qualification;
        const categories = Array.from(new Set([...(existing.categories || []), ...(wallet.categories || [])]));

        byAddress.set(key, {
            ...existing,
            ...wallet,
            name: existing.name || wallet.name,
            categories,
            lastBalance: wallet.lastBalance || existing.lastBalance,
            lastWinRate: wallet.lastWinRate || existing.lastWinRate,
            lastPnl: wallet.lastPnl || existing.lastPnl,
            qualification: bestQualification,
            timestamp: Math.min(existing.timestamp || Date.now(), wallet.timestamp || Date.now()),
            autoPromotedToSmartMoney: existing.autoPromotedToSmartMoney || wallet.autoPromotedToSmartMoney
        });
    });

    return Array.from(byAddress.values())
        .filter((wallet) => wallet.qualification?.qualified || wallet.categories.includes('Smart Money'))
        .sort((a, b) => (b.qualification?.score || 0) - (a.qualification?.score || 0));
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
            const [sharedWallets, localWallets] = await Promise.all([
                DatabaseService.fetchSmartMoneyWallets(),
                Promise.resolve(SavedWalletService.getSmartMoneyWallets())
            ]);
            const nextWallets = mergeSmartMoneyWallets(sharedWallets, localWallets);
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
                    .filter((asset) => asset.rawValue > 25 && (chain === 'all' || (asset.chain || '').toLowerCase() === chain))
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
                    image: token.image,
                    chain: token.chain
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
                        walletAddress: event.wallet,
                        token: token.ticker,
                        tokenAddress: token.address,
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
                chain: string;
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
                    image: token.image,
                    chain: token.chain
                });
            });

            const resolvedOutflows = Array.from(outflowMap.values())
                .sort((a, b) => b.totalUsd - a.totalUsd)
                .slice(0, 4)
                .map((token) => ({
                    id: token.address,
                    ticker: token.ticker,
                    name: token.name,
                    amount: formatCompactNumber(token.totalUsd, '$', 1),
                    count: token.walletSet.size,
                    image: token.image,
                    chain: token.chain
                }));

            setTopOutflows(resolvedOutflows);
        };

        hydrateSmartMoneyPanels();
    }, [smartWallets, timeRange, chain]);

    return (
        <div className="flex flex-col gap-6 pb-8 animate-fade-in w-full max-w-[1600px] mx-auto">

            {/* --- Filter Bar --- */}
            <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 bg-card border border-border p-4 rounded-xl shadow-sm">
                <div className="flex items-center gap-2 overflow-x-auto w-full md:w-auto no-scrollbar">
                    {/* Chain Selector */}
                    <div className="relative group shrink-0">
                        <button
                            onClick={() => {
                                const currentIndex = CHAIN_FILTERS.findIndex((item) => item.id === chain);
                                setChain(CHAIN_FILTERS[(currentIndex + 1) % CHAIN_FILTERS.length].id);
                            }}
                            className="flex items-center gap-2 bg-main hover:bg-card-hover border border-border px-4 py-2 rounded-lg text-sm text-text-light font-medium transition-colors"
                        >
                            <Layers size={16} className="text-primary-green" />
                            {CHAIN_FILTERS.find((item) => item.id === chain)?.label || 'All Chains'}
                            <ChevronDown size={14} className="text-text-medium" />
                        </button>
                    </div>

                    {/* Time Range */}
                    <div className="flex bg-main border border-border rounded-lg p-1 shrink-0">
                        {['1h', '4h', '24h', '7d'].map((t) => (
                            <button
                                key={t}
                                onClick={() => setTimeRange(t)}
                                className={`px-3 py-1.5 rounded-md text-xs font-bold transition-all ${timeRange === t
                                    ? 'bg-card-hover text-text-light shadow-sm'
                                    : 'text-text-medium hover:text-text-light'
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
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-text-medium" size={16} />
                        <input
                            type="text"
                            placeholder="Search token..."
                            className="w-full bg-main border border-border rounded-lg pl-10 pr-4 py-2 text-sm text-text-light placeholder-text-dark focus:border-primary-green/50 focus:outline-none transition-colors"
                        />
                    </div>

                    {/* Filter Button */}
                    <button
                        onClick={() => {
                            setChain('all');
                            setTimeRange('24h');
                        }}
                        className="flex items-center gap-2 bg-main hover:bg-card-hover border border-border px-3 py-2 rounded-lg text-text-light text-sm font-medium transition-colors shrink-0"
                    >
                        <Filter size={16} />
                        <span className="hidden md:inline">Reset</span>
                    </button>
                </div>
            </div>

            {/* --- Main Dashboard Content --- */}
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-12 gap-6">

                {/* --- Column 1: Trending Smart Wallets (Moved from Col 2) --- */}
                <div className="xl:col-span-4 flex flex-col gap-6">
                    <div className="bg-card border border-border rounded-xl overflow-hidden shadow-sm h-full">
                        <div className="px-5 py-4 border-b border-border flex items-center justify-between">
                            <h3 className="font-bold text-text-light flex items-center gap-2">
                                <Wallet size={18} className="text-primary-green" />
                                Trending Smart Wallets
                            </h3>
                        </div>
                        <div className="p-2 space-y-1">
                            {loadingWallets && (
                                <div className="flex items-center gap-3 p-4 text-sm text-text-medium">
                                    <div className="h-4 w-4 rounded-full border-2 border-primary-green/40 border-t-primary-green animate-spin" />
                                    Loading smart wallets
                                </div>
                            )}
                            {!loadingWallets && smartWallets.length === 0 && (
                                <div className="p-4 text-sm text-text-medium">
                                    <div className="font-bold text-text-light">No qualified wallets yet</div>
                                    <div className="mt-1 text-xs">Track wallets from Wallet Tracker and strong performers will appear here automatically.</div>
                                </div>
                            )}
                            {smartWallets.map((wallet) => (
                                <div
                                    key={wallet.addr}
                                    onClick={() => navigate(`/smart-money/${wallet.addr}`)}
                                    className="p-3 hover:bg-card-hover/50 rounded-lg transition-colors cursor-pointer group relative border-b border-border/50 last:border-0"
                                >
                                    {/* Header: Avatar, Badge, Address, Button */}
                                    <div className="flex items-center justify-between mb-0.5">
                                        <div className="flex items-center gap-2.5">
                                            {/* Avatar Gradient */}
                                            <div className="w-7 h-7 rounded-full bg-card-hover border border-border flex items-center justify-center text-xs font-bold text-text-light">
                                                {wallet.name.slice(0, 1).toUpperCase()}
                                            </div>

                                            <div className="flex flex-col gap-0.5">
                                                <span className="text-sm font-bold text-text-light tracking-tight group-hover:text-primary-green transition-colors">{wallet.name}</span>
                                                <span className="text-xs text-text-medium font-mono">{wallet.addr}</span>
                                            </div>
                                        </div>

                                        <button
                                            onClick={(event) => {
                                                event.stopPropagation();
                                                navigate(`/smart-money/${wallet.addr}`);
                                            }}
                                            className="px-3 py-1 rounded-lg bg-main hover:bg-card-hover border border-border text-text-light text-xs font-bold transition-colors opacity-0 group-hover:opacity-100"
                                        >
                                            View
                                        </button>
                                    </div>

                                    {/* Stats Grid */}
                                    <div className="flex justify-between items-start pt-0 pl-10">
                                        <div className="flex flex-col text-left">
                                            <span className="text-xs text-text-medium font-medium mb-0.5 whitespace-nowrap">Win rate</span>
                                            <span className="text-xs font-bold text-text-light">{wallet.lastWinRate || 'No data'}</span>
                                        </div>
                                        <div className="flex flex-col text-center">
                                            <span className="text-xs text-text-medium font-medium mb-0.5 whitespace-nowrap">Score</span>
                                            <span className="text-xs font-bold text-green-400">{wallet.qualification?.score || 0}/100</span>
                                        </div>
                                        <div className="flex flex-col text-center">
                                            <span className="text-xs text-text-medium font-medium mb-0.5 whitespace-nowrap">PnL</span>
                                            <span className="text-xs font-bold text-green-400">{wallet.lastPnl || 'No data'}</span>
                                        </div>
                                        <div className="flex flex-col text-right">
                                            <span className="text-xs text-text-medium font-medium mb-0.5 whitespace-nowrap">Balance</span>
                                            <span className="text-xs font-bold text-text-light">{wallet.lastBalance || 'No data'}</span>
                                        </div>
                                    </div>
                                    {wallet.qualification?.reasons?.[0] && (
                                        <div className="pl-10 pt-2 text-xs text-text-medium">
                                            {wallet.qualification.reasons[0]}
                                        </div>
                                    )}
                                </div>
                            ))}
                        </div>
                        <div className="p-3 border-t border-border bg-main/30">
                            <button onClick={() => navigate('/wallet')} className="w-full py-2 text-xs font-bold text-text-medium hover:text-text-light transition-colors border border-dashed border-border hover:border-text-medium rounded-lg">
                                View Wallet Tracker
                            </button>
                        </div>
                    </div>
                </div>

                {/* --- Column 2: Recent Events Feed (Moved from Col 3) --- */}
                <div className="xl:col-span-4 flex flex-col gap-6">
                    <div className="bg-card border border-border rounded-xl overflow-hidden shadow-sm h-full">
                        <div className="px-5 py-4 border-b border-border flex items-center justify-between">
                            <h3 className="font-bold text-text-light flex items-center gap-2">
                                <Activity size={18} className="text-primary-green" />
                                Smart Money Events
                            </h3>
                            <span className="text-xs text-text-medium">Updates as wallets move</span>
                        </div>
                        <div className="p-2 space-y-1">
                            {!loadingWallets && recentEvents.length === 0 && (
                                <div className="p-4 text-sm text-text-medium">
                                    <div className="font-bold text-text-light">No recent activity</div>
                                    <div className="mt-1 text-xs">Buy and sell activity from qualified wallets will appear here.</div>
                                </div>
                            )}
                            {recentEvents.map((event, i) => (
                                <div
                                    key={i}
                                    onClick={() => navigate(`/token-smart-money/${event.tokenAddress}`)}
                                    className="p-3 hover:bg-card-hover/50 rounded-lg transition-colors cursor-pointer group relative"
                                >
                                    <div className={`absolute left-0 top-3 bottom-3 w-1 rounded-full ${event.type === 'buy' ? 'bg-green-500' : 'bg-red-500'}`}></div>

                                    <div className="flex flex-col gap-1 w-full pl-4">
                                        {/* Top Row: Tag + Token + Time */}
                                        <div className="flex items-center justify-between">
                                            <div className="flex items-center gap-2">
                                                <span className={`text-xs font-bold px-1.5 py-0.5 rounded ${event.type === 'buy' ? 'bg-green-500/10 text-green-400' : 'bg-red-500/10 text-red-400'
                                                    }`}>
                                                    {event.type === 'buy' ? 'Buy' : 'Sell'}
                                                </span>
                                                <span className="text-xs font-bold text-text-light">{event.token}</span>
                                            </div>
                                            <span className="text-xs text-text-dark">{event.time}</span>
                                        </div>

                                        {/* Bottom Row: Wallet + Amount */}
                                        <div className="flex items-center justify-between">
                                            <span className="text-xs text-text-medium">{event.wallet}</span>
                                            <span className="text-xs font-bold text-text-light">{event.amount}</span>
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                        <div className="p-3 border-t border-border bg-main/30">
                            <button onClick={() => navigate('/wallet')} className="w-full py-2 text-xs font-bold text-text-medium hover:text-text-light transition-colors border border-dashed border-border hover:border-text-medium rounded-lg">
                                View Wallet Activity
                            </button>
                        </div>
                    </div>
                </div>

                {/* --- Column 3: Inflows & Outflows (Moved from Col 1) --- */}
                <div className="sm:col-span-2 xl:col-span-4 grid grid-cols-1 sm:grid-cols-2 xl:flex xl:flex-col gap-6">
                    {/* Top Inflows */}
                    <section className="bg-card border border-border rounded-xl overflow-hidden flex flex-col shadow-sm">
                        <div className="px-6 py-4 border-b border-border flex items-center justify-between">
                            <h2 className="font-bold text-text-light">Smart Money Top Inflows</h2>
                        </div>

                        <div className="p-4 flex flex-col gap-2">
                            {!loadingWallets && topInflows.length === 0 && (
                                <div className="text-sm text-text-medium">
                                    <div className="font-bold text-text-light">No inflows yet</div>
                                    <div className="mt-1 text-xs">Overlapping positions from qualified wallets will appear here.</div>
                                </div>
                            )}
                            {topInflows.map((token) => (
                                <div key={token.id} onClick={() => navigate(`/token-smart-money/${token.id}`)} className="bg-main border border-border hover:border-green-500/30 px-3 py-2.5 rounded-lg transition-all cursor-pointer group flex items-center justify-between h-[64px]">
                                    {/* Left: Token Info */}
                                    <div className="flex items-center gap-3">
                                        <div className="w-8 h-8 rounded-full bg-card-hover flex items-center justify-center overflow-hidden border border-border">
                                            <img src={token.image} alt={token.ticker} className="w-full h-full object-cover" />
                                        </div>
                                        <div className="flex flex-col">
                                            <div className="font-bold text-text-light text-xs leading-none group-hover:text-green-400 transition-colors mb-1">{token.ticker}</div>
                                            <div className="text-xs text-text-medium font-semibold whitespace-nowrap">Net inflow</div>
                                        </div>
                                    </div>

                                    {/* Center: Amount & Wallets */}
                                    <div className="flex flex-col items-end mr-3 gap-0.5">
                                        <div className="font-bold text-text-light text-xs leading-none">{token.amount}</div>
                                        <div className="text-xs text-text-medium whitespace-nowrap"><span className="text-text-light font-medium">{token.count}</span> smart wallets</div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </section>

                    {/* Top Outflows */}
                    <section className="bg-card border border-border rounded-xl overflow-hidden flex flex-col shadow-sm">
                        <div className="px-6 py-4 border-b border-border flex items-center justify-between">
                            <h2 className="font-bold text-text-light">Smart Money Selling / Outflow</h2>
                        </div>

                        <div className="p-4 flex flex-col gap-2">
                            {!loadingWallets && topOutflows.length === 0 && (
                                <div className="text-sm text-text-medium">
                                    <div className="font-bold text-text-light">No sell pressure yet</div>
                                    <div className="mt-1 text-xs">Confirmed selling from qualified wallets will appear here.</div>
                                </div>
                            )}
                            {topOutflows.map((token) => (
                                <div key={token.id} onClick={() => navigate(`/token-smart-money/${token.id}`)} className="bg-main border border-border hover:border-red-500/30 px-3 py-2.5 rounded-lg transition-all cursor-pointer group flex items-center justify-between h-[64px]">
                                    {/* Left: Token Info */}
                                    <div className="flex items-center gap-3">
                                        <div className="w-8 h-8 rounded-full bg-card-hover flex items-center justify-center overflow-hidden border border-border">
                                            <img src={token.image} alt={token.ticker} className="w-full h-full object-cover" />
                                        </div>
                                        <div className="flex flex-col">
                                            <div className="font-bold text-text-light text-xs leading-none group-hover:text-red-400 transition-colors mb-1">{token.ticker}</div>
                                            <div className="text-xs text-text-medium font-semibold whitespace-nowrap">Net outflow</div>
                                        </div>
                                    </div>

                                    {/* Center: Amount & Wallets */}
                                    <div className="flex flex-col items-end mr-3 gap-0.5">
                                        <div className="font-bold text-text-light text-xs leading-none">{token.amount}</div>
                                        <div className="text-xs text-text-medium whitespace-nowrap"><span className="text-text-light font-medium">{token.count}</span> smart wallets</div>
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
