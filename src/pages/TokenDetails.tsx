// Route-level product screen for the Atlaix application.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    Activity,
    ArrowLeft,
    Bell,
    ChevronDown,
    Copy,
    Droplets,
    Maximize2,
    Radar,
    RefreshCw,
    Scan,
    Shield,
    Users,
    X,
    Zap
} from 'lucide-react';
import { DatabaseService } from '../services/DatabaseService';
import { ChainActivityService, RealActivity } from '../services/ChainActivityService';
import { MoralisService } from '../services/MoralisService';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { EnrichedTokenData } from '../types';
import { SolanaRpcService } from '../services/SolanaRpcService';
import { formatCompactNumber } from '../utils/format';

const MIN_DISPLAY_ACTIVITY_USD = 1000;

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

const parseActivityUsd = (value?: string) => {
    if (!value) return 0;
    const numeric = Number(value.replace(/[^0-9.-]/g, ''));
    return Number.isFinite(numeric) ? Math.abs(numeric) : 0;
};

const clampPercent = (value: number) => Math.min(Math.max(value, 0), 100);

const formatPercent = (value?: number) => {
    if (value === undefined || !Number.isFinite(value)) return 'N/A';
    return `${clampPercent(value).toFixed(value >= 10 ? 1 : 2)}%`;
};

const getHolderDistribution = (topHolders?: Array<{ address: string; percent: number }>) => {
    const holders = (topHolders || [])
        .map((holder) => ({ ...holder, percent: clampPercent(Number(holder.percent) || 0) }))
        .filter((holder) => holder.percent > 0)
        .sort((a, b) => b.percent - a.percent);
    const top10 = holders.length
        ? holders.slice(0, 10).reduce((sum, holder) => sum + holder.percent, 0)
        : undefined;
    const top50 = holders.length
        ? holders.slice(0, 50).reduce((sum, holder) => sum + holder.percent, 0)
        : undefined;
    const rest = top50 === undefined ? undefined : Math.max(0, 100 - top50);

    return {
        availableCount: holders.length,
        top10,
        top50,
        rest
    };
};

const polarToCartesian = (centerX: number, centerY: number, radius: number, angleInDegrees: number) => {
    const angleInRadians = ((angleInDegrees - 90) * Math.PI) / 180;
    return {
        x: centerX + radius * Math.cos(angleInRadians),
        y: centerY + radius * Math.sin(angleInRadians)
    };
};

const describeDonutSlice = (
    centerX: number,
    centerY: number,
    outerRadius: number,
    innerRadius: number,
    startAngle: number,
    endAngle: number
) => {
    const outerStart = polarToCartesian(centerX, centerY, outerRadius, endAngle);
    const outerEnd = polarToCartesian(centerX, centerY, outerRadius, startAngle);
    const innerStart = polarToCartesian(centerX, centerY, innerRadius, startAngle);
    const innerEnd = polarToCartesian(centerX, centerY, innerRadius, endAngle);
    const largeArcFlag = endAngle - startAngle <= 180 ? '0' : '1';
    return [
        `M ${outerStart.x} ${outerStart.y}`,
        `A ${outerRadius} ${outerRadius} 0 ${largeArcFlag} 0 ${outerEnd.x} ${outerEnd.y}`,
        `L ${innerStart.x} ${innerStart.y}`,
        `A ${innerRadius} ${innerRadius} 0 ${largeArcFlag} 1 ${innerEnd.x} ${innerEnd.y}`,
        'Z'
    ].join(' ');
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

const getSafeScanChain = (chainId?: string) => {
    if (!chainId) return 'solana';
    if (chainId === 'ethereum') return 'eth';
    return chainId;
};

export const TokenDetails: React.FC = () => {
    const { address } = useParams<{ address: string }>();
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    const preferredPairAddress = searchParams.get('pair') || undefined;
    const preferredChain = searchParams.get('chain') || undefined;
    const [enrichedData, setEnrichedData] = useState<EnrichedTokenData | null>(null);
    const [loading, setLoading] = useState(true);
    const [activityFeed, setActivityFeed] = useState<RealActivity[]>([]);
    const [isRealData, setIsRealData] = useState(false);
    const [copied, setCopied] = useState(false);
    const [chartExpanded, setChartExpanded] = useState(false);
    const [visibleWalletRows, setVisibleWalletRows] = useState(8);
    const [visibleHolderRows, setVisibleHolderRows] = useState(10);
    const [marketPanelTab, setMarketPanelTab] = useState<'activity' | 'holders'>('holders');
    const [compactChartLoaded, setCompactChartLoaded] = useState(false);
    const [activityRefreshing, setActivityRefreshing] = useState(false);
    const lastActivityLoadKeyRef = useRef('');

    const onBack = () => {
        navigate(-1);
    };

    const loadTokenActivity = useCallback(async (tokenData: EnrichedTokenData) => {
        const activityKey = [
            tokenData.chainId,
            tokenData.baseToken.address,
            tokenData.pairAddress || '',
            tokenData.priceUsd || ''
        ].join(':').toLowerCase();

        setActivityRefreshing(true);

        try {
            const latestActivity = await ChainActivityService.getTokenActivity(
                tokenData.baseToken.address,
                tokenData.chainId,
                parseFloat(tokenData.priceUsd) || 0,
                tokenData.pairAddress
            );
            setActivityFeed(latestActivity);
            setVisibleWalletRows(8);
            setIsRealData(true);
            lastActivityLoadKeyRef.current = activityKey;
        } catch (error) {
            console.error('Failed to load token activity', error);
        } finally {
            setActivityRefreshing(false);
        }
    }, []);

    useEffect(() => {
        const fetchData = async () => {
            if (!address) return;
            setLoading(true);
            setActivityFeed([]);
            setVisibleWalletRows(8);
            setVisibleHolderRows(10);
            lastActivityLoadKeyRef.current = '';

            try {
                const data = await DatabaseService.getTokenDetails(address, preferredChain, preferredPairAddress);
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
                    let activeWallets24h = data.activeWallets24h || 0;
                    let topHolders: EnrichedTokenData['topHolders'] = [];

                    if (isSolana) {
                        const [h, s, largestAccounts] = await Promise.all([
                            SolanaRpcService.getHolderCount(mintAddress),
                            SolanaRpcService.getTokenSupply(mintAddress),
                            SolanaRpcService.getTokenLargestAccounts(mintAddress)
                        ]);
                        holders = h || 0;
                        supply = s || 0;
                        topHolders = supply > 0
                            ? largestAccounts.map((account: any) => ({
                                address: String(account.address || ''),
                                amount: Number(account.uiAmount ?? account.amount) || 0,
                                percent: ((Number(account.uiAmount ?? account.amount) || 0) / supply) * 100
                            })).filter((holder: { address: string; percent: number }) => holder.address && holder.percent > 0)
                            : [];
                    } else {
                        try {
                            const [metadata, holderInsights, activeWalletCount] = await Promise.all([
                                MoralisService.getTokenMetadata(mintAddress, data.chainId),
                                MoralisService.getTokenHolderInsights(mintAddress, data.chainId),
                                MoralisService.getTokenActiveWallets24h(mintAddress, data.chainId)
                            ]);
                            if (metadata) {
                                const decimals = metadata.decimals || 18;
                                supply = parseFloat(metadata.totalSupply) / Math.pow(10, decimals);
                            } else {
                                const price = parseFloat(data.priceUsd) || 0;
                                const fdv = data.fdv || 0;
                                if (price > 0 && fdv > 0) supply = fdv / price;
                            }

                            if (holderInsights?.holderCount) {
                                holders = holderInsights.holderCount;
                                topHolders = holderInsights.topHolders;
                            }

                            if (activeWalletCount !== null && activeWalletCount !== undefined) {
                                activeWallets24h = activeWalletCount;
                            }
                        } catch (e) {
                            console.warn('EVM token intelligence fetch failed', e);
                        }
                    }

                    import('../services/GoPlusService').then(({ GoPlusService }) => {
                        GoPlusService.fetchTokenSecurity(mintAddress, data.chainId).then(security => {
                            if (security?.tax) {
                                setEnrichedData(prev => prev ? ({ ...prev, tax: security.tax }) : null);
                            }
                        }).catch(err => console.error('Tax Fetch Error', err));
                    });

                    setEnrichedData(prev => prev ? ({ ...prev, holders, totalSupply: supply, activeWallets24h, topHolders }) : null);
                }
            } catch (e) {
                console.error('Failed to fetch details', e);
            } finally {
                setLoading(false);
            }
        };

        fetchData();
    }, [address, preferredChain, preferredPairAddress]);

    useEffect(() => {
        setCompactChartLoaded(false);
    }, [enrichedData?.pairAddress]);

    useEffect(() => {
        if (!enrichedData?.baseToken.address) return;
        if (marketPanelTab !== 'activity') return;

        const activityKey = [
            enrichedData.chainId,
            enrichedData.baseToken.address,
            enrichedData.pairAddress || '',
            enrichedData.priceUsd || ''
        ].join(':').toLowerCase();

        if (lastActivityLoadKeyRef.current === activityKey) return;
        void loadTokenActivity(enrichedData);
    }, [enrichedData?.baseToken.address, enrichedData?.chainId, enrichedData?.pairAddress, enrichedData?.priceUsd, loadTokenActivity, marketPanelTab]);

    const tokenSymbol = enrichedData?.baseToken.symbol || 'TOKEN';
    const imageUrl = enrichedData?.info?.imageUrl || `https://ui-avatars.com/api/?name=${tokenSymbol}&background=042f2e&color=fff`;
    const currentPrice = formatPrice(enrichedData?.priceUsd);
    const marketCap = enrichedData?.marketCap || enrichedData?.fdv || 0;
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
    const displayedActivity = activityFeed
        .filter(item => parseActivityUsd(item.usd) >= MIN_DISPLAY_ACTIVITY_USD);
    const walletEvents = displayedActivity.filter(item => ['Buy', 'Sell'].includes(item.type));
    const topHolderRows = (enrichedData?.topHolders || [])
        .map((holder) => {
            const percent = clampPercent(Number(holder.percent) || 0);
            const totalSupply = enrichedData?.totalSupply || 0;
            const rawAmount = Number(holder.amount);
            const amount = Number.isFinite(rawAmount) && (!totalSupply || rawAmount <= totalSupply * 1.05)
                ? rawAmount
                : (totalSupply * percent) / 100;
            return {
                address: holder.address,
                percent,
                amount,
                valueUsd: amount * priceNumber
            };
        })
        .filter((holder) => holder.address)
        .sort((a, b) => b.percent - a.percent);
    const holderDistribution = getHolderDistribution(enrichedData?.topHolders);
    const top10Pct = holderDistribution.top10 ?? 0;
    const top11To50Pct = Math.max(0, (holderDistribution.top50 ?? 0) - top10Pct);
    const restHolderPct = holderDistribution.rest ?? (holderDistribution.availableCount ? Math.max(0, 100 - top10Pct - top11To50Pct) : 100);
    const holderDistributionRows = [
        {
            label: 'Top 10',
            value: holderDistribution.top10,
            segmentValue: top10Pct,
            color: '#FF5C35',
            labelPosition: 'right-0 top-2 text-right'
        },
        {
            label: 'Top 50',
            value: holderDistribution.top50,
            segmentValue: top11To50Pct,
            color: '#16D7FF',
            labelPosition: 'left-0 bottom-8 text-left'
        },
        {
            label: 'Rest',
            value: holderDistribution.rest,
            segmentValue: restHolderPct,
            color: '#32F06A',
            labelPosition: 'right-1 bottom-3 text-right'
        }
    ];
    const holderDonutSegments = (() => {
        if (!holderDistribution.availableCount) return [];
        const gapDegrees = 8;
        let cursor = -42;
        return holderDistributionRows.flatMap((row) => {
            const rawSpan = (clampPercent(row.segmentValue) / 100) * 360;
            if (rawSpan <= 0) return [];
            const segmentGap = Math.min(gapDegrees, Math.max(2, rawSpan * 0.32));
            const visibleSpan = Math.max(0, rawSpan - segmentGap);
            const startAngle = cursor + segmentGap / 2;
            const endAngle = startAngle + visibleSpan;
            cursor += rawSpan;
            if (visibleSpan <= 0) return [];
            return [{
                ...row,
                path: describeDonutSlice(70, 70, 48, 29, startAngle, endAngle)
            }];
        });
    })();
    const tokenAddress = enrichedData?.baseToken.address || address || '';
    const tokenChain = enrichedData?.chainId || preferredChain || 'solana';
    const tokenPair = enrichedData?.pairAddress || preferredPairAddress || '';
    const quickActions = [
        {
            icon: Scan,
            title: 'Safe Scan',
            subtitle: 'Identify threats',
            path: `/safe-scan?${new URLSearchParams({
                address: tokenAddress,
                chain: getSafeScanChain(tokenChain)
            }).toString()}`
        },
        {
            icon: Radar,
            title: 'Detection',
            subtitle: 'AI pattern scan',
            path: `/detection/token/${encodeURIComponent(tokenAddress)}?${new URLSearchParams({
                chain: tokenChain,
                ...(tokenPair ? { pair: tokenPair } : {})
            }).toString()}`
        },
        {
            icon: Bell,
            title: 'Alerts',
            subtitle: 'Smart alerts',
            path: `/smart-alerts?${new URLSearchParams({
                address: tokenAddress,
                chain: tokenChain
            }).toString()}`
        }
    ];
    const tokenIntelligencePanel = (
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
    );
    const holderDistributionPanel = (
        <div className="rounded-lg border border-border bg-card p-5">
            <div className="mb-2 flex items-center justify-between gap-3">
                <h3 className="text-base font-bold text-text-light">Holder Distribution</h3>
                <span className="text-xs font-bold text-text-medium">{enrichedData?.holders ? enrichedData.holders.toLocaleString() : 'N/A'}</span>
            </div>
            <div className="relative mx-auto h-[178px] max-w-[250px]">
                <div className="absolute inset-x-0 top-6 mx-auto h-[138px] w-[138px]">
                    <svg viewBox="0 0 140 140" className="h-full w-full overflow-visible drop-shadow-[0_0_26px_rgba(22,215,255,0.20)]" role="img" aria-label="Holder distribution chart">
                        <circle cx="70" cy="70" r="38.5" fill="none" stroke="rgba(148,163,184,0.10)" strokeWidth="19" />
                        {holderDonutSegments.map((segment) => (
                            <path
                                key={segment.label}
                                d={segment.path}
                                fill={segment.color}
                            />
                        ))}
                        <circle cx="70" cy="70" r="30" fill="#181C20" stroke="rgba(255,255,255,0.07)" />
                    </svg>
                    <div className="absolute inset-0 grid place-items-center text-center">
                        <div>
                            <div className="text-[10px] font-black uppercase text-text-medium">Holders</div>
                            <div className="text-base font-black text-text-light">{holderDistribution.availableCount || '-'}</div>
                        </div>
                    </div>
                </div>
                {holderDistributionRows.map((row) => (
                    <div key={row.label} className={`absolute ${row.labelPosition}`}>
                        <div className="text-xs font-black" style={{ color: row.color }}>{formatPercent(row.value)}</div>
                        <div className="text-[9px] font-bold uppercase tracking-wide text-text-medium">{row.label}</div>
                    </div>
                ))}
            </div>
        </div>
    );
    const copyAddress = () => {
        if (!enrichedData?.baseToken.address) return;
        navigator.clipboard.writeText(enrichedData.baseToken.address);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
    };

    const refreshActivity = async () => {
        if (!enrichedData?.baseToken.address) return;
        lastActivityLoadKeyRef.current = '';
        await loadTokenActivity(enrichedData);
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

                    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5 xl:w-[780px]">
                        {[
                            { label: 'Price (USD)', value: currentPrice, large: true, change: h24Change },
                            { label: 'Market Cap', value: formatCompactNumber(marketCap, '$') },
                            { label: '24H High', value: formatPrice(high24) },
                            { label: '24H Low', value: formatPrice(low24) },
                            { label: '24H Volume', value: formatCompactNumber(volume24h, '$') }
                        ].map((metric, index) => (
                            <div key={metric.label} className={`min-w-0 border-border/70 ${index > 0 ? 'lg:border-l lg:pl-5' : ''}`}>
                                <div className="text-[10px] font-bold uppercase tracking-wide text-text-medium">{metric.label}</div>
                                <div className="mt-2 flex flex-wrap items-baseline gap-x-2 gap-y-1">
                                    <span className={`${metric.large ? 'text-2xl lg:text-[26px]' : 'text-base lg:text-lg'} min-w-0 break-words font-bold leading-tight text-text-light`}>{metric.value}</span>
                                    {typeof metric.change === 'number' && (
                                        <span className={`text-xs font-black ${metric.change >= 0 ? 'text-primary-green' : 'text-primary-red'}`}>
                                            {metric.change >= 0 ? '+' : ''}{metric.change.toFixed(2)}%
                                        </span>
                                    )}
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            </section>

            <section className="relative grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_248px]">
                <div className="overflow-hidden rounded-lg border border-border bg-card p-3">
                    <div className="relative h-[500px] overflow-hidden bg-main">
                        {!compactChartLoaded && (
                            <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-main">
                                <RefreshCw className="mb-3 animate-spin text-primary-green" size={24} />
                                <div className="text-sm font-bold text-text-light">Loading chart...</div>
                            </div>
                        )}
                        {getDexscreenerChartUrl(enrichedData?.chainId, enrichedData?.pairAddress, true) ? (
                            <iframe
                                key={enrichedData?.pairAddress}
                                src={getDexscreenerChartUrl(enrichedData?.chainId, enrichedData?.pairAddress, true)}
                                className={`h-full w-full transition-opacity duration-300 ${compactChartLoaded ? 'opacity-100' : 'opacity-0'}`}
                                title={`${tokenSymbol} token chart`}
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
                    <h3 className="mb-4 text-base font-bold text-text-light">Quick Actions</h3>
                    <div className="grid gap-3">
                        {quickActions.map((action) => (
                            <button
                                key={action.title}
                                onClick={() => navigate(action.path)}
                                disabled={!tokenAddress}
                                className="flex items-center gap-3 rounded-lg border border-border bg-main/50 p-3 text-left text-primary-green transition-colors hover:border-primary-green/40 hover:bg-card-hover disabled:cursor-not-allowed disabled:opacity-60"
                            >
                                <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary-green/10">
                                    <action.icon size={18} />
                                </span>
                                <span>
                                    <span className="block text-sm font-bold text-text-light">{action.title}</span>
                                    <span className="block text-xs text-text-medium">{action.subtitle}</span>
                                </span>
                            </button>
                        ))}
                    </div>
                </div>
            </section>

            <section className="relative grid grid-cols-1 gap-4 xl:grid-cols-[minmax(320px,0.82fr)_minmax(0,2.1fr)]">
                <div className="grid gap-4">
                    {tokenIntelligencePanel}
                    {holderDistributionPanel}
                </div>

                <div className="atlaix-folder-shell">
                        <div className="mb-0 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                            <div className="min-w-0">
                                <div className="atlaix-folder-strip">
                                {[
                                    { id: 'activity' as const, label: 'On Chain Activities' },
                                    { id: 'holders' as const, label: 'Top Holders' }
                                ].map((tab, index) => {
                                    const active = marketPanelTab === tab.id;
                                    return (
                                        <button
                                            key={tab.id}
                                            onClick={() => setMarketPanelTab(tab.id)}
                                            className={`atlaix-folder-tab ${active ? 'is-active' : 'is-idle'} ${index === 0 ? 'is-first' : ''}`}
                                        >
                                            <span className="atlaix-folder-label">{tab.label}</span>
                                        </button>
                                    );
                                })}
                                </div>
                            </div>
                            {marketPanelTab === 'activity' && (
                                <div className="flex gap-2 sm:pb-2">
                                    <button
                                        onClick={refreshActivity}
                                        disabled={activityRefreshing}
                                        className="flex h-9 w-9 items-center justify-center rounded-md border border-border bg-main text-text-light transition-colors hover:border-primary-green/50 hover:text-primary-green disabled:cursor-not-allowed disabled:opacity-60"
                                        title="Refresh activity"
                                    >
                                        <RefreshCw size={14} className={activityRefreshing ? 'animate-spin' : ''} />
                                    </button>
                                    <span className="flex items-center gap-2 rounded-md border border-border bg-main px-3 py-2 text-xs font-bold text-text-light">
                                        All Actions
                                    </span>
                                    <span className="flex items-center gap-2 rounded-md border border-border bg-main px-3 py-2 text-xs font-bold text-text-light">
                                        24H
                                    </span>
                                </div>
                            )}
                        </div>
                    <div className="atlaix-folder-panel">
                    <div className="atlaix-folder-accent" />
                    {marketPanelTab === 'activity' ? (
                        <>
                            <div className="overflow-x-auto">
                                <table className="w-full min-w-[720px] text-sm">
                                    <thead>
                                        <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-text-medium">
                                            <th className="pb-3 font-bold">Action</th>
                                            <th className="pb-3 font-bold">Amount</th>
                                            <th className="pb-3 font-bold">Cost</th>
                                            <th className="pb-3 font-bold">Time</th>
                                            <th className="pb-3 font-bold">Wallet</th>
                                            <th className="pb-3 text-right font-bold">Track</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-border/50">
                                        {walletEvents.length === 0 ? (
                                            <tr>
                                                <td colSpan={6} className="py-8 text-center text-sm text-text-medium">
                                                    {activityRefreshing ? 'Loading on-chain activities...' : 'Buy and sell activity will appear as it is detected.'}
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
                                                <td className="py-3 text-xs font-bold text-text-light">{row.usd || '-'}</td>
                                                <td className="py-3 text-xs text-text-medium">{row.time}</td>
                                                <td className="py-3 font-mono text-xs text-primary-blue">{shortAddress(row.wallet)}</td>
                                                <td className="py-3 text-right">
                                                    <button
                                                        onClick={() => navigate(`/wallet/${encodeURIComponent(row.wallet)}?chain=${encodeURIComponent(tokenChain)}`)}
                                                        className="rounded-md border border-border px-3 py-1 text-xs font-bold text-text-light transition-colors hover:border-primary-green/40 hover:text-primary-green"
                                                    >
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
                        </>
                    ) : (
                        <>
                            <div className="overflow-x-auto rounded-lg border border-border/70">
                                <div className="min-w-[920px]">
                                    <div className="grid grid-cols-[70px_minmax(0,1fr)_150px_130px_130px_150px] gap-3 border-b border-border bg-main/60 px-4 py-3 text-[11px] font-black uppercase tracking-wide text-text-medium">
                                        <span>Rank</span>
                                        <span>Wallet</span>
                                        <span className="text-right">Amount</span>
                                        <span className="text-right">Value</span>
                                        <span className="text-right">Supply</span>
                                        <span className="text-right">Action</span>
                                    </div>
                                    <div className="divide-y divide-border/50">
                                        {topHolderRows.length === 0 ? (
                                            <div className="px-4 py-10 text-center text-sm text-text-medium">
                                                Top holder data is not available for this token yet.
                                            </div>
                                        ) : topHolderRows.slice(0, visibleHolderRows).map((holder, index) => (
                                            <div key={`${holder.address}-${index}`} className="grid grid-cols-[70px_minmax(0,1fr)_150px_130px_130px_150px] items-center gap-3 px-4 py-3 transition-colors hover:bg-card-hover/30">
                                                <div className="flex items-center gap-2">
                                                    <span className="flex h-7 w-7 items-center justify-center rounded-md border border-primary-green/25 bg-primary-green/10 text-xs font-black text-primary-green">
                                                        {index + 1}
                                                    </span>
                                                </div>
                                                <div className="min-w-0">
                                                    <div className="font-mono text-xs font-bold text-text-light">{shortAddress(holder.address, 8, 6)}</div>
                                                    <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-main">
                                                        <div
                                                            className={`h-full rounded-full ${holder.percent >= 10 ? 'bg-primary-red' : 'bg-primary-green'}`}
                                                            style={{ width: `${Math.max(3, holder.percent)}%` }}
                                                        />
                                                    </div>
                                                </div>
                                                <div className="text-right text-xs font-black text-text-light">
                                                    {formatCompactNumber(holder.amount)}
                                                </div>
                                                <div className="text-right text-xs font-black text-text-light">
                                                    {formatCompactNumber(holder.valueUsd, '$')}
                                                </div>
                                                <div className={`text-right text-sm font-black ${holder.percent >= 10 ? 'text-primary-red' : 'text-text-light'}`}>
                                                    {formatPercent(holder.percent)}
                                                </div>
                                                <div className="text-right">
                                                    <button
                                                        onClick={() => navigate(`/wallet/${encodeURIComponent(holder.address)}?chain=${encodeURIComponent(tokenChain)}`)}
                                                        className="rounded-md border border-border px-3 py-1 text-xs font-bold text-text-light transition-colors hover:border-primary-green/40 hover:text-primary-green"
                                                    >
                                                        Inspect
                                                    </button>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            </div>
                            {topHolderRows.length > visibleHolderRows && (
                                <button
                                    onClick={() => setVisibleHolderRows((current) => current + 10)}
                                    className="mt-4 flex w-full items-center justify-center gap-2 rounded-lg py-2 text-sm font-bold text-text-light transition-colors hover:text-primary-green"
                                >
                                    Show more holders <ChevronDown size={16} />
                                </button>
                            )}
                        </>
                    )}
                    </div>
                </div>
            </section>

            {chartExpanded && (
                <div className="fixed inset-0 z-[9999] bg-[#050B10]">
                    <div className="flex h-screen w-screen flex-col">
                        <div className="flex items-center justify-between border-b border-border bg-card px-5 py-4">
                            <div>
                                <div className="text-sm font-bold text-text-light">{tokenSymbol} Full Chart</div>
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
