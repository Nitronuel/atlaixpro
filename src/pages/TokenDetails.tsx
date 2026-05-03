// Route-level product screen for the Atlaix application.
import React, { useEffect, useMemo, useState } from 'react';
import {
    Activity,
    ArrowLeft,
    Bell,
    ChevronDown,
    Copy,
    Droplets,
    ExternalLink,
    Maximize2,
    Radar,
    RefreshCw,
    Scan,
    Shield,
    Users,
    Wallet,
    X,
    Zap
} from 'lucide-react';
import { DatabaseService } from '../services/DatabaseService';
import { ChainActivityService, RealActivity } from '../services/ChainActivityService';
import { MoralisService } from '../services/MoralisService';
import { useParams, useNavigate } from 'react-router-dom';
import { EnrichedTokenData } from '../types';
import { SolanaRpcService } from '../services/SolanaRpcService';
import { formatCompactNumber } from '../utils/format';

const shortAddress = (value?: string, head = 6, tail = 5) => {
    if (!value) return 'N/A';
    if (value.length <= head + tail + 3) return value;
    return `${value.slice(0, head)}...${value.slice(-tail)}`;
};

const formatPrice = (value?: string | number) => {
    const numeric = typeof value === 'string' ? parseFloat(value) : value;
    if (!numeric || Number.isNaN(numeric)) return '$0';
    if (numeric < 0.01) return `$${numeric.toFixed(8).replace(/0+$/, '').replace(/\.$/, '')}`;
    return `$${numeric.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`;
};

const getAgeLabel = (timestamp?: number) => {
    if (!timestamp) return 'N/A';
    const diff = Math.max(0, Date.now() - timestamp);
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    if (days >= 1) return `${days}d`;
    const hours = Math.floor(diff / (1000 * 60 * 60));
    if (hours >= 1) return `${hours}h`;
    return `${Math.floor(diff / (1000 * 60))}m`;
};

const getActivityAccent = (item: RealActivity) => {
    if (item.type === 'Buy' || item.tag === 'Add Liq') return { bg: 'bg-primary-green/15', text: 'text-primary-green' };
    if (item.type === 'Sell' || item.tag === 'Remove Liq') return { bg: 'bg-primary-red/15', text: 'text-primary-red' };
    if (item.tag === 'Whale') return { bg: 'bg-primary-yellow/15', text: 'text-primary-yellow' };
    if (item.tag === 'Burn') return { bg: 'bg-purple-400/15', text: 'text-purple-400' };
    return { bg: 'bg-primary-blue/15', text: 'text-primary-blue' };
};

const getDexscreenerChartUrl = (chainId?: string, pairAddress?: string, compact = true) => {
    if (!chainId || !pairAddress) return '';
    const params = new URLSearchParams({
        embed: '1',
        theme: 'dark',
        trades: compact ? '0' : '1',
        info: compact ? '0' : '1'
    });
    return `https://dexscreener.com/${chainId}/${pairAddress}?${params.toString()}`;
};

export const TokenDetails: React.FC = () => {
    const { address } = useParams<{ address: string }>();
    const navigate = useNavigate();
    const [enrichedData, setEnrichedData] = useState<EnrichedTokenData | null>(null);
    const [loading, setLoading] = useState(true);
    const [activityFeed, setActivityFeed] = useState<RealActivity[]>([]);
    const [isRealData, setIsRealData] = useState(false);
    const [copied, setCopied] = useState(false);
    const [chartExpanded, setChartExpanded] = useState(false);
    const [visibleWalletRows, setVisibleWalletRows] = useState(8);
    const [compactChartLoaded, setCompactChartLoaded] = useState(false);

    const onBack = () => {
        navigate(-1);
    };

    useEffect(() => {
        const fetchData = async () => {
            if (!address) return;
            setLoading(true);

            try {
                const data = await DatabaseService.getTokenDetails(address);
                if (data) {
                    const enriched: EnrichedTokenData = {
                        ...data,
                        holders: 0,
                        totalSupply: 0,
                        pairCreatedAt: (data as any).pairCreatedAt || 0,
                        txns: (data as any).txns || { h24: { buys: 0, sells: 0 } },
                        tax: { buy: 0, sell: 0 }
                    };
                    setEnrichedData(enriched);

                    const mintAddress = data.baseToken.address;
                    const isSolana = data.chainId === 'solana';
                    let holders = 0;
                    let supply = 0;

                    const realActivity = await ChainActivityService.getTokenActivity(
                        mintAddress,
                        data.chainId,
                        parseFloat(data.priceUsd) || 0,
                        data.pairAddress
                    );

                    if (isSolana) {
                        const [h, s] = await Promise.all([
                            SolanaRpcService.getHolderCount(mintAddress),
                            SolanaRpcService.getTokenSupply(mintAddress)
                        ]);
                        holders = h || 0;
                        supply = s || 0;
                    } else {
                        try {
                            const metadata = await MoralisService.getTokenMetadata(mintAddress, data.chainId);
                            if (metadata) {
                                const decimals = metadata.decimals || 18;
                                supply = parseFloat(metadata.totalSupply) / Math.pow(10, decimals);
                            } else {
                                const price = parseFloat(data.priceUsd) || 0;
                                const fdv = data.fdv || 0;
                                if (price > 0 && fdv > 0) supply = fdv / price;
                            }
                        } catch (e) {
                            console.warn('EVM Supply Fetch Failed', e);
                        }
                    }

                    import('../services/GoPlusService').then(({ GoPlusService }) => {
                        GoPlusService.fetchTokenSecurity(mintAddress, data.chainId).then(security => {
                            if (security?.tax) {
                                setEnrichedData(prev => prev ? ({ ...prev, tax: security.tax }) : null);
                            }
                        }).catch(err => console.error('Tax Fetch Error', err));
                    });

                    setEnrichedData(prev => prev ? ({ ...prev, holders, totalSupply: supply }) : null);
                    setActivityFeed(realActivity);
                    setIsRealData(true);
                }
            } catch (e) {
                console.error('Failed to fetch details', e);
            } finally {
                setLoading(false);
            }
        };

        fetchData();
    }, [address]);

    useEffect(() => {
        setCompactChartLoaded(false);
    }, [enrichedData?.pairAddress]);

    const tokenSymbol = enrichedData?.baseToken.symbol || 'TOKEN';
    const imageUrl = enrichedData?.info?.imageUrl || `https://ui-avatars.com/api/?name=${tokenSymbol}&background=042f2e&color=fff`;
    const currentPrice = formatPrice(enrichedData?.priceUsd);
    const h24Change = enrichedData?.priceChange?.h24 || 0;
    const priceNumber = parseFloat(enrichedData?.priceUsd || '0') || 0;
    const high24 = priceNumber * (1 + Math.max(h24Change, 1) / 100);
    const low24 = priceNumber * (1 - Math.max(Math.abs(h24Change), 1) / 100);
    const buys = enrichedData?.txns?.h24.buys || 0;
    const sells = enrichedData?.txns?.h24.sells || 0;
    const totalTxns = buys + sells;
    const volume24h = enrichedData?.volume?.h24 || 0;
    const buyVolume = totalTxns > 0 ? volume24h * (buys / totalTxns) : volume24h / 2;
    const sellVolume = totalTxns > 0 ? volume24h * (sells / totalTxns) : volume24h / 2;
    const netVolume = buyVolume - sellVolume;
    const highSignalEvents = activityFeed.filter(item => ['Burn', 'Whale', 'Add Liq', 'Remove Liq'].includes(item.tag || item.type));
    const visibleHighSignalEvents = highSignalEvents.length ? highSignalEvents : activityFeed.slice(0, 6);
    const walletEvents = activityFeed.filter(item => ['Buy', 'Sell', 'Transfer'].includes(item.type));
    const copyAddress = () => {
        if (!enrichedData?.baseToken.address) return;
        navigator.clipboard.writeText(enrichedData.baseToken.address);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
    };

    if (loading && !enrichedData) {
        return (
            <div className="flex min-h-[60vh] flex-col items-center justify-center">
                <RefreshCw className="mb-4 animate-spin text-primary-green" size={40} />
                <div className="text-xl font-bold">Scanning Chain Data...</div>
            </div>
        );
    }

    return (
        <div className="relative flex flex-col gap-4 animate-fade-in pb-10">
            <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_top_left,rgba(0,209,255,0.09),transparent_32%),radial-gradient(circle_at_top_right,rgba(0,230,118,0.07),transparent_28%)]" />

            <div className="relative flex flex-col gap-1">
                <h1 className="text-2xl font-black text-text-light">Token Details</h1>
                <button onClick={onBack} className="flex w-fit items-center gap-2 text-sm font-medium text-text-medium transition-colors hover:text-text-light">
                    <ArrowLeft size={16} /> Back to Market
                </button>
            </div>

            <section className="relative overflow-hidden rounded-lg border border-border bg-card p-4">
                <div className="flex flex-col gap-5 xl:flex-row xl:items-center xl:justify-between">
                    <div className="flex min-w-0 flex-1 items-center gap-4">
                        <img
                            src={imageUrl}
                            alt={tokenSymbol}
                            className="h-16 w-16 shrink-0 rounded-full border border-primary-green/30 bg-card object-cover"
                            onError={(event) => { event.currentTarget.src = `https://ui-avatars.com/api/?name=${tokenSymbol}&background=042f2e&color=fff`; }}
                        />
                        <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                                <h2 className="truncate text-xl font-bold text-text-light">{enrichedData?.baseToken.name || 'Loading token'}</h2>
                                <span className="rounded border border-border bg-card-hover px-2 py-1 text-[10px] font-black uppercase text-text-light">{tokenSymbol}</span>
                                <span className="rounded border border-primary-blue/30 bg-primary-blue/10 px-2 py-1 text-[10px] font-black uppercase text-primary-blue">{enrichedData?.chainId || 'chain'}</span>
                            </div>
                            <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-text-medium">
                                <span className="font-bold capitalize text-text-light">{enrichedData?.chainId || 'Unknown'}</span>
                                <span className="h-1 w-1 rounded-full bg-text-dark" />
                                <span className="capitalize">{enrichedData?.dexId || 'DEX'}</span>
                            </div>
                            <button onClick={copyAddress} className="mt-3 flex max-w-full items-center gap-2 rounded-md border border-border bg-main/60 px-3 py-1.5 font-mono text-xs text-text-medium transition-colors hover:border-primary-green/40 hover:text-text-light">
                                <span className="truncate">{shortAddress(enrichedData?.baseToken.address, 12, 10)}</span>
                                <Copy size={13} />
                                {copied && <span className="font-sans text-[10px] font-bold text-primary-green">Copied</span>}
                            </button>
                        </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4 lg:grid-cols-4 xl:w-[680px]">
                        {[
                            { label: 'Price (USD)', value: currentPrice, large: true, change: h24Change },
                            { label: '24H High', value: formatPrice(high24) },
                            { label: '24H Low', value: formatPrice(low24) },
                            { label: '24H Volume', value: formatCompactNumber(volume24h, '$') }
                        ].map((metric, index) => (
                            <div key={metric.label} className={`border-border/70 ${index > 0 ? 'lg:border-l lg:pl-6' : ''}`}>
                                <div className="text-[10px] font-bold uppercase tracking-wide text-text-medium">{metric.label}</div>
                                <div className="mt-2 flex flex-wrap items-baseline gap-3">
                                    <span className={`${metric.large ? 'text-3xl' : 'text-lg'} font-bold text-text-light`}>{metric.value}</span>
                                    {typeof metric.change === 'number' && (
                                        <span className={`text-sm font-black ${metric.change >= 0 ? 'text-primary-green' : 'text-primary-red'}`}>
                                            {metric.change >= 0 ? '+' : ''}{metric.change.toFixed(2)}%
                                        </span>
                                    )}
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            </section>

            <section className="relative grid grid-cols-1 gap-4 xl:grid-cols-[1.15fr_1fr_248px]">
                <div className="overflow-hidden rounded-lg border border-border bg-card p-3">
                    <div className="relative h-[500px] overflow-hidden bg-main">
                        {!compactChartLoaded && (
                            <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-main">
                                <RefreshCw className="mb-3 animate-spin text-primary-green" size={24} />
                                <div className="text-sm font-bold text-text-light">Loading Dexscreener chart...</div>
                                <div className="mt-1 text-xs text-text-medium">Expand for the full chart workspace.</div>
                            </div>
                        )}
                        {getDexscreenerChartUrl(enrichedData?.chainId, enrichedData?.pairAddress, true) ? (
                            <iframe
                                key={enrichedData?.pairAddress}
                                src={getDexscreenerChartUrl(enrichedData?.chainId, enrichedData?.pairAddress, true)}
                                className={`h-full w-full transition-opacity duration-300 ${compactChartLoaded ? 'opacity-100' : 'opacity-0'}`}
                                title={`${tokenSymbol} Dexscreener chart`}
                                allow="clipboard-write"
                                onLoad={() => setCompactChartLoaded(true)}
                            />
                        ) : (
                            <div className="flex h-full items-center justify-center text-sm text-text-medium">
                                Chart is not available for this token yet.
                            </div>
                        )}
                        <div className="absolute inset-x-0 bottom-0 z-20 border-t border-border bg-card/95 p-3 backdrop-blur">
                        <button
                            onClick={() => setChartExpanded(true)}
                            className="flex w-full items-center justify-center gap-2 rounded-lg border border-primary-green/25 bg-primary-green/10 px-4 py-3 text-sm font-black text-primary-green transition-colors hover:bg-primary-green/15"
                        >
                            <Maximize2 size={16} />
                            See Full Chart
                        </button>
                        </div>
                    </div>
                </div>

                <div className="rounded-lg border border-border bg-card p-5">
                    <h3 className="mb-4 text-base font-bold text-text-light">Token Intelligence</h3>
                    <div className="divide-y divide-border/60 overflow-hidden rounded-lg border border-border/50">
                        {[
                            { icon: Droplets, label: 'LP Pools', value: enrichedData?.poolCount ? `${enrichedData.poolCount} Active` : '1 Active', valueClass: 'text-text-light' },
                            { icon: Users, label: 'Active Wallets', value: enrichedData?.activeWallets24h ? enrichedData.activeWallets24h.toLocaleString() : 'N/A', valueClass: 'text-text-light' },
                            { icon: Shield, label: 'Liquidity', value: formatCompactNumber(enrichedData?.liquidity?.usd, '$'), valueClass: 'text-text-light' },
                            { icon: Activity, label: 'Volume (24H)', value: formatCompactNumber(volume24h, '$'), valueClass: 'text-text-light' },
                            { icon: Zap, label: 'Net Volume Delta', value: `${netVolume >= 0 ? '+' : ''}${formatCompactNumber(netVolume, '$')}`, valueClass: netVolume >= 0 ? 'text-primary-green' : 'text-primary-red' },
                            { icon: Activity, label: 'Buy / Sell Volume', value: null, customValue: true, valueClass: 'text-text-light' },
                            { icon: Users, label: 'Holder Distribution', value: enrichedData?.holders ? enrichedData.holders.toLocaleString() : 'N/A', valueClass: 'text-text-light' },
                            { icon: Activity, label: 'Age', value: getAgeLabel(enrichedData?.pairCreatedAt), valueClass: 'text-text-light' }
                        ].map((item) => (
                            <div key={item.label} className="flex items-center justify-between gap-4 bg-main/20 px-3 py-3">
                                <div className="flex min-w-0 items-center gap-3">
                                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-card text-primary-green">
                                        <item.icon size={16} />
                                    </span>
                                    <span className="truncate text-sm font-medium text-text-light">{item.label}</span>
                                </div>
                                {item.customValue ? (
                                    <span className="shrink-0 text-sm font-bold">
                                        <span className="text-primary-green">{formatCompactNumber(buyVolume, '$')}</span>
                                        <span className="text-text-medium"> / </span>
                                        <span className="text-primary-red">{formatCompactNumber(sellVolume, '$')}</span>
                                    </span>
                                ) : (
                                    <span className={`shrink-0 text-sm font-bold ${item.valueClass}`}>{item.value}</span>
                                )}
                            </div>
                        ))}
                    </div>
                </div>

                <div className="rounded-lg border border-border bg-card p-5">
                    <h3 className="mb-4 text-base font-bold text-text-light">Quick Actions</h3>
                    <div className="grid gap-3">
                        {[
                            { icon: Scan, title: 'Risk Scan', subtitle: 'Identify threats' },
                            { icon: Radar, title: 'Detection', subtitle: 'AI pattern scan' },
                            { icon: Wallet, title: 'Tracking', subtitle: 'Wallet tracking' },
                            { icon: Bell, title: 'Alerts', subtitle: 'Smart alerts' }
                        ].map((action) => (
                            <button key={action.title} className="flex items-center gap-3 rounded-lg border border-border bg-main/50 p-3 text-left text-primary-green transition-colors hover:border-primary-green/40 hover:bg-card-hover">
                                <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary-green/10">
                                    <action.icon size={18} />
                                </span>
                                <span>
                                    <span className="block text-sm font-bold text-text-light">{action.title}</span>
                                    <span className="block text-xs text-text-medium">{action.subtitle}</span>
                                </span>
                            </button>
                        ))}
                        <a href={enrichedData?.url} target="_blank" rel="noopener noreferrer" className="mt-1 flex items-center justify-center gap-2 rounded-lg border border-primary-green/20 bg-primary-green/10 px-4 py-3 text-sm font-bold text-primary-green transition-colors hover:bg-primary-green/20">
                            Open Pair <ExternalLink size={15} />
                        </a>
                    </div>
                </div>
            </section>

            <section className="relative grid grid-cols-1 gap-4 xl:grid-cols-[0.85fr_1fr]">
                <div className="rounded-lg border border-border bg-card p-5">
                    <div className="mb-4 flex items-center justify-between gap-3">
                        <h3 className="text-base font-bold text-text-light">On-Chain Activity</h3>
                        <button className="flex items-center gap-2 rounded-md border border-border bg-main px-3 py-2 text-xs font-bold text-text-light">
                            All Events <ChevronDown size={14} />
                        </button>
                    </div>
                    <div className="relative flex flex-col gap-1">
                        {visibleHighSignalEvents.length === 0 ? (
                            <div className="rounded-lg border border-border bg-main/50 p-6 text-center text-sm text-text-medium">
                                No major activity found yet.
                            </div>
                        ) : visibleHighSignalEvents.slice(0, 7).map((item, index) => {
                            const accent = getActivityAccent(item);
                            return (
                                <div key={`${item.hash}-${index}`} className="flex items-start justify-between gap-4 border-b border-border/50 py-3 last:border-b-0">
                                    <div className="flex min-w-0 gap-3">
                                        <span className={`mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${accent.bg} ${accent.text}`}>
                                            <Activity size={15} />
                                        </span>
                                        <div className="min-w-0">
                                            <div className="flex flex-wrap items-center gap-2">
                                                <span className="font-bold text-text-light">{item.tag || item.type}</span>
                                                <span className="text-xs text-text-medium">{item.time}</span>
                                            </div>
                                            <div className="mt-1 truncate text-xs text-text-medium">
                                                {shortAddress(item.wallet)} {item.desc}
                                            </div>
                                        </div>
                                    </div>
                                    <span className={`shrink-0 text-sm font-bold ${accent.text}`}>{item.usd || item.val || '-'}</span>
                                </div>
                            );
                        })}
                    </div>
                    <button className="mt-4 w-full rounded-lg border border-border bg-main/60 py-2.5 text-sm font-bold text-text-light transition-colors hover:border-primary-green/50 hover:text-primary-green">
                        View All Activity
                    </button>
                </div>

                <div className="rounded-lg border border-border bg-card p-5">
                    <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                        <h3 className="text-base font-bold text-text-light">Wallet Interactions</h3>
                        <div className="flex gap-2">
                            <button className="flex items-center gap-2 rounded-md border border-border bg-main px-3 py-2 text-xs font-bold text-text-light">
                                All Actions <ChevronDown size={14} />
                            </button>
                            <button className="flex items-center gap-2 rounded-md border border-border bg-main px-3 py-2 text-xs font-bold text-text-light">
                                24H <ChevronDown size={14} />
                            </button>
                        </div>
                    </div>
                    <div className="overflow-x-auto">
                        <table className="w-full min-w-[620px] text-sm">
                            <thead>
                                <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-text-medium">
                                    <th className="pb-3 font-bold">Action</th>
                                    <th className="pb-3 font-bold">Amount</th>
                                    <th className="pb-3 font-bold">Time</th>
                                    <th className="pb-3 font-bold">Wallet</th>
                                    <th className="pb-3 text-right font-bold">Track</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-border/50">
                                {walletEvents.length === 0 ? (
                                    <tr>
                                        <td colSpan={5} className="py-8 text-center text-sm text-text-medium">
                                            Wallet activity will appear once recent buys, sells, or transfers are detected.
                                        </td>
                                    </tr>
                                ) : walletEvents.slice(0, visibleWalletRows).map((row, index) => (
                                    <tr key={`${row.hash}-${index}`} className="hover:bg-card-hover/30">
                                        <td className="py-3">
                                            <span className={`rounded px-2.5 py-1 text-[10px] font-black uppercase ${row.type === 'Buy' ? 'bg-primary-green/10 text-primary-green' : row.type === 'Sell' ? 'bg-primary-red/10 text-primary-red' : 'bg-primary-blue/10 text-primary-blue'}`}>
                                                {row.type}
                                            </span>
                                        </td>
                                        <td className="py-3 text-xs font-bold text-text-light">{row.val} {tokenSymbol}</td>
                                        <td className="py-3 text-xs text-text-medium">{row.time}</td>
                                        <td className="py-3 font-mono text-xs text-primary-blue">{shortAddress(row.wallet)}</td>
                                        <td className="py-3 text-right">
                                            <button className="rounded-md border border-border px-3 py-1 text-xs font-bold text-text-light transition-colors hover:border-primary-green/40 hover:text-primary-green">
                                                View
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                    {walletEvents.length > visibleWalletRows && (
                        <button
                            onClick={() => setVisibleWalletRows((current) => current + 8)}
                            className="mt-4 flex w-full items-center justify-center gap-2 rounded-lg py-2 text-sm font-bold text-text-light transition-colors hover:text-primary-green"
                        >
                            Show more <ChevronDown size={16} />
                        </button>
                    )}
                </div>
            </section>

            {chartExpanded && (
                <div className="fixed inset-0 z-[9999] bg-[#050B10]">
                    <div className="flex h-screen w-screen flex-col">
                        <div className="flex items-center justify-between border-b border-border bg-card px-5 py-4">
                            <div>
                                <div className="text-sm font-bold text-text-light">{tokenSymbol} Full Chart</div>
                                <div className="text-xs text-text-medium">Chart-only Dexscreener workspace</div>
                            </div>
                            <button
                                onClick={() => setChartExpanded(false)}
                                className="flex items-center gap-2 rounded-lg border border-border bg-main px-4 py-2 text-sm font-bold text-text-light transition-colors hover:border-primary-red/50 hover:text-primary-red"
                            >
                                <X size={18} />
                                Exit Full Screen
                            </button>
                        </div>
                        {enrichedData?.pairAddress ? (
                            <div className="relative min-h-0 flex-1">
                                <iframe
                                    src={getDexscreenerChartUrl(enrichedData.chainId || 'ethereum', enrichedData.pairAddress, true)}
                                    className="h-full w-full"
                                    title={`${tokenSymbol} full chart`}
                                    allow="clipboard-write"
                                    allowFullScreen
                                />
                                <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 flex h-11 items-center justify-center border-t border-border bg-[#050B10]" />
                            </div>
                        ) : (
                            <div className="flex flex-1 items-center justify-center text-text-medium">Full chart is not available for this token yet.</div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
};
