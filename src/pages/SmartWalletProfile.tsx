import React, { useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
    ArrowLeft, Copy, ExternalLink, Wallet, TrendingUp, Clock,
    Activity, RefreshCw, ShieldCheck, Loader2
} from 'lucide-react';
import { useWalletPortfolio, WalletStats } from '../hooks/useWalletPortfolio';
import { detectWalletAddressType, validateWalletAddress } from '../utils/wallet';
import { SavedWalletService } from '../services/SavedWalletService';
import { DatabaseService } from '../services/DatabaseService';
import { SmartMoneyQualificationService } from '../services/SmartMoneyQualificationService';

const getWalletChain = (walletAddress: string) => {
    return detectWalletAddressType(walletAddress) === 'solana' ? 'Solana' : 'All Chains';
};

const getExplorerLink = (walletAddress: string) => {
    return detectWalletAddressType(walletAddress) === 'solana'
        ? `https://solscan.io/account/${walletAddress}`
        : `https://debank.com/profile/${walletAddress}`;
};

const formatJoinedDate = (timestamp?: number) => {
    if (!timestamp) return 'Recently added';
    return new Date(timestamp).toLocaleDateString('en-GB', {
        day: '2-digit',
        month: 'short',
        year: 'numeric'
    });
};

const getPositionScore = (pnlPercent?: number) => {
    if ((pnlPercent || 0) >= 25) return 'High';
    if ((pnlPercent || 0) > 0) return 'Medium';
    return 'Low';
};

const buildOverviewCards = (stats: WalletStats, qualificationScore: number, dominantChain: string) => ([
    { title: 'Smart score', value: `${qualificationScore}/100`, icon: ShieldCheck, color: 'text-green-400' },
    { title: 'Win rate', value: stats.winRate, icon: TrendingUp, color: stats.winRate.includes('N/A') ? 'text-[#EAECEF]' : 'text-green-400' },
    { title: 'Total PnL', value: stats.totalPnL, icon: TrendingUp, color: stats.totalPnL.includes('+') ? 'text-green-400' : stats.totalPnL.includes('-') ? 'text-red-400' : 'text-[#EAECEF]' },
    { title: 'Net worth', value: stats.netWorth, icon: Wallet, color: 'text-[#EAECEF]' },
    { title: 'Avg hold', value: stats.avgHoldTime, icon: Clock, color: 'text-[#EAECEF]' },
    { title: 'Main chain', value: dominantChain, icon: Activity, color: 'text-[#EAECEF]' },
]);

export const SmartWalletProfile: React.FC = () => {
    const { address = '' } = useParams();
    const navigate = useNavigate();
    const [sharedWalletName, setSharedWalletName] = useState('');
    const [sharedTimestamp, setSharedTimestamp] = useState<number | undefined>(undefined);
    const [copied, setCopied] = useState(false);
    const validation = validateWalletAddress(address);
    const chain = getWalletChain(address);

    const { loading, portfolioData, walletStats, refreshPortfolio } = useWalletPortfolio(
        validation.isValid ? address : undefined,
        chain,
        undefined,
        'ALL'
    );

    useEffect(() => {
        if (!validation.isValid) return;
        refreshPortfolio();
    }, [address]);

    useEffect(() => {
        const loadWalletMeta = async () => {
            if (!validation.isValid) return;

            const localWallet = SavedWalletService.getWallet(address);
            if (localWallet) {
                setSharedWalletName(localWallet.name);
                setSharedTimestamp(localWallet.timestamp);
            }

            const sharedWallets = await DatabaseService.fetchSmartMoneyWallets();
            const sharedWallet = sharedWallets.find((wallet) => wallet.addr.toLowerCase() === address.toLowerCase());
            if (sharedWallet) {
                setSharedWalletName(sharedWallet.name);
                setSharedTimestamp(sharedWallet.timestamp);
            }
        };

        loadWalletMeta();
    }, [address, validation.isValid]);

    const freshQualification = useMemo(() => SmartMoneyQualificationService.evaluate(walletStats), [walletStats]);

    const dominantChain = useMemo(() => {
        if (!portfolioData?.assets?.length) return chain;
        const counts = new Map<string, number>();
        portfolioData.assets.forEach((asset) => {
            const assetChain = asset.chain || chain;
            counts.set(assetChain, (counts.get(assetChain) || 0) + 1);
        });

        return Array.from(counts.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] || chain;
    }, [portfolioData, chain]);

    const overviewCards = useMemo(
        () => buildOverviewCards(walletStats, freshQualification.score, dominantChain),
        [walletStats, freshQualification.score, dominantChain]
    );

    const activePositions = useMemo(() => {
        if (!portfolioData?.assets?.length) return [];
        const totalValue = portfolioData.assets.reduce((sum, asset) => sum + asset.rawValue, 0);

        return [...portfolioData.assets]
            .filter((asset) => asset.rawValue > 1)
            .sort((a, b) => b.rawValue - a.rawValue)
            .map((asset) => ({
                ...asset,
                sizePercent: totalValue > 0 ? `${((asset.rawValue / totalValue) * 100).toFixed(1)}%` : '0%',
                score: getPositionScore(asset.pnlPercent)
            }));
    }, [portfolioData]);

    const handleCopy = async () => {
        try {
            await navigator.clipboard.writeText(address);
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1500);
        } catch {
            setCopied(false);
        }
    };

    if (!validation.isValid) {
        return (
            <div className="bg-[#111315] border border-[#2A2E33] rounded-2xl p-6 text-red-400">
                {validation.error}
            </div>
        );
    }

    return (
        <div className="flex flex-col gap-6 pb-8 animate-fade-in w-full max-w-[1600px] mx-auto">
            <div className="flex flex-col gap-6 bg-[#111315] border border-[#2A2E33] p-6 rounded-2xl">
                <div className="flex flex-col md:flex-row items-center gap-4 md:gap-8">
                    <div className="flex items-center gap-4 w-full md:w-auto">
                        <button
                            onClick={() => navigate(-1)}
                            className="p-2 hover:bg-[#1C1F22] rounded-lg text-[#8F96A3] hover:text-[#EAECEF] transition-colors"
                        >
                            <ArrowLeft size={20} />
                        </button>
                        <div className="w-12 h-12 rounded-full bg-gradient-to-br from-green-400/20 to-blue-500/20 border border-green-500/30 flex items-center justify-center shrink-0">
                            <Wallet size={24} className="text-primary-green" />
                        </div>
                        <div className="min-w-0">
                            <div className="text-sm text-[#8F96A3] font-medium mb-1">Smart Money Wallet</div>
                            <div className="flex items-center gap-3">
                                <h1 className="text-xl md:text-2xl font-bold text-[#EAECEF] truncate">
                                    {sharedWalletName || `Smart Wallet ${address.slice(0, 6)}...${address.slice(-4)}`}
                                </h1>
                                <button
                                    onClick={handleCopy}
                                    className="text-[#8F96A3] hover:text-[#EAECEF] transition-colors shrink-0"
                                    title="Copy wallet address"
                                >
                                    <Copy size={16} />
                                </button>
                                <a
                                    href={getExplorerLink(address)}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="text-[#8F96A3] hover:text-[#EAECEF] transition-colors shrink-0"
                                    title="Open in explorer"
                                >
                                    <ExternalLink size={16} />
                                </a>
                            </div>
                            <div className="text-xs text-[#8F96A3] font-mono mt-1 break-all">{address}</div>
                            {copied && <div className="text-[11px] text-green-400 mt-1">Wallet address copied</div>}
                        </div>
                    </div>

                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 md:gap-8 text-right w-full md:w-auto ml-auto">
                        <div className="flex flex-col items-end gap-1">
                            <span className="text-[10px] text-[#8F96A3] uppercase tracking-wider font-semibold">Score</span>
                            <span className="text-base font-bold text-green-400">{freshQualification.score}/100</span>
                        </div>
                        <div className="flex flex-col items-end gap-1">
                            <span className="text-[10px] text-[#8F96A3] uppercase tracking-wider font-semibold">Qualified</span>
                            <span className={`text-base font-bold ${freshQualification.qualified ? 'text-green-400' : 'text-red-400'}`}>
                                {freshQualification.qualified ? 'Yes' : 'No'}
                            </span>
                        </div>
                        <div className="flex flex-col items-end gap-1">
                            <span className="text-[10px] text-[#8F96A3] uppercase tracking-wider font-semibold">Refreshed</span>
                            <button
                                onClick={refreshPortfolio}
                                className="text-base font-bold text-[#EAECEF] flex items-center gap-2 hover:text-primary-green transition-colors"
                            >
                                {loading ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
                                Scan now
                            </button>
                        </div>
                        <div className="flex flex-col items-end gap-1">
                            <span className="text-[10px] text-[#8F96A3] uppercase tracking-wider font-semibold">Joined</span>
                            <span className="text-base font-bold text-[#EAECEF]">{formatJoinedDate(sharedTimestamp)}</span>
                        </div>
                    </div>
                </div>

                <div className="flex flex-wrap gap-2">
                    {freshQualification.reasons.length > 0 ? freshQualification.reasons.map((reason) => (
                        <span key={reason} className="text-xs px-3 py-1 rounded-full border border-green-500/20 bg-green-500/10 text-green-300">
                            {reason}
                        </span>
                    )) : (
                        <span className="text-xs px-3 py-1 rounded-full border border-[#2A2E33] bg-[#1C1F22] text-[#8F96A3]">
                            Awaiting enough trading context to explain this wallet.
                        </span>
                    )}
                </div>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
                {overviewCards.map((card, idx) => (
                    <div key={idx} className="bg-[#111315] border border-[#2A2E33] p-4 rounded-xl flex flex-col justify-between h-24 relative overflow-hidden group hover:border-[#363B41] transition-colors">
                        <div className="flex items-center justify-between z-10">
                            <span className="text-[10px] text-[#8F96A3] uppercase tracking-wider font-semibold">
                                {card.title}
                            </span>
                        </div>
                        <div className={`text-base font-bold ${card.color} z-10 truncate`} title={card.value}>{card.value}</div>
                        <card.icon
                            className="absolute -right-4 -bottom-4 text-[#1C1F22] group-hover:text-[#222529] transition-colors"
                            size={64}
                            strokeWidth={1}
                        />
                    </div>
                ))}
            </div>

            <div className="bg-[#111315] border border-[#2A2E33] rounded-2xl overflow-hidden flex flex-col">
                <div className="px-6 py-4 border-b border-[#2A2E33] flex items-center justify-between">
                    <h2 className="font-bold text-[#EAECEF] text-lg">Wallet Portfolio (Active Positions)</h2>
                    <div className="text-xs text-[#8F96A3]">
                        {loading ? 'Refreshing live wallet data...' : `${activePositions.length} active positions`}
                    </div>
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
                            {!loading && activePositions.length === 0 && (
                                <tr>
                                    <td colSpan={6} className="px-6 py-8 text-center text-[#8F96A3]">
                                        No active token positions were found for this wallet right now.
                                    </td>
                                </tr>
                            )}
                            {activePositions.map((pos) => (
                                <tr
                                    key={`${pos.chain}-${pos.address}`}
                                    className="hover:bg-[#1C1F22]/50 transition-colors group cursor-pointer"
                                    onClick={() => navigate(`/token/${pos.address}`)}
                                >
                                    <td className="px-6 py-4">
                                        <div className="flex items-center gap-3">
                                            <img src={pos.logo} alt={pos.symbol} className="w-8 h-8 rounded-full" />
                                            <div>
                                                <div className="font-bold text-[#EAECEF]">{pos.symbol}</div>
                                                <div className="text-xs text-[#8F96A3]">{pos.chain || dominantChain}</div>
                                            </div>
                                        </div>
                                    </td>
                                    <td className="px-6 py-4 text-right">
                                        <div className="font-bold text-[#EAECEF]">{pos.value}</div>
                                        <div className="text-xs text-[#8F96A3]">{pos.balance}</div>
                                    </td>
                                    <td className="px-6 py-4 text-right">
                                        <div className="font-bold text-[#EAECEF]">{pos.sizePercent}</div>
                                        <div className="text-xs text-[#8F96A3]">of portfolio</div>
                                    </td>
                                    <td className="px-6 py-4 text-right">
                                        <div className="flex items-center justify-end gap-1 text-[#EAECEF] font-bold">
                                            {pos.avgBuy || 'N/A'} <span className="text-[#5D6470] text-xs">vs</span> {pos.price}
                                        </div>
                                        <div className="text-xs text-[#8F96A3]">Entry vs current</div>
                                    </td>
                                    <td className="px-6 py-4 text-right">
                                        <div className={`font-bold ${String(pos.pnl || '').startsWith('+') ? 'text-green-400' : String(pos.pnl || '').startsWith('-') ? 'text-red-400' : 'text-[#EAECEF]'}`}>
                                            {pos.pnl || 'N/A'}
                                        </div>
                                        <div className={`text-xs ${String(pos.pnl || '').startsWith('+') ? 'text-green-500/70' : 'text-[#8F96A3]'}`}>
                                            {pos.pnlPercent !== undefined ? `${pos.pnlPercent.toFixed(2)}%` : 'PnL pending'}
                                        </div>
                                    </td>
                                    <td className="px-6 py-4 text-center">
                                        <span className={`inline-block px-3 py-1 rounded-full text-xs font-bold border ${
                                            pos.score === 'High' ? 'bg-green-500/10 text-green-400 border-green-500/20' :
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
