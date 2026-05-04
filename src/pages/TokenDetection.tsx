// Route-level token scan screen for the Atlaix application.
import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Activity, AlertTriangle, ArrowLeft, Bell, Check, Copy, RefreshCw, Search, Shield, Wallet } from 'lucide-react';
import { ChainActivityService } from '../services/ChainActivityService';
import { DatabaseService } from '../services/DatabaseService';
import { ImpactfulActivity, ImpactfulActivityService } from '../services/ImpactfulActivityService';
import { MarketCoin } from '../types';

type TokenSnapshot = {
    name: string;
    symbol: string;
    address: string;
    pairAddress?: string;
    chain: string;
    dex?: string;
    imageUrl: string;
    price: string;
    priceChange24h: number;
    priceChange1h: number;
    volume24h: number;
    liquidity: number;
    marketCap: number;
    buys24h: number;
    sells24h: number;
    poolCount: number;
    activeWallets24h: number;
    pairCreatedAt?: number;
    url?: string;
};

const UNKNOWN_LOGO = 'https://ui-avatars.com/api/?name=TOKEN&background=111827&color=fff';

const formatCurrency = (value: number | string | undefined, compact = true) => {
    const amount = Number(value || 0);
    if (!Number.isFinite(amount) || amount <= 0) return '$0';

    return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
        notation: compact ? 'compact' : 'standard',
        maximumFractionDigits: amount < 1 ? 8 : 2
    }).format(amount);
};

const formatPrice = (value: number | string | undefined) => {
    const amount = Number(value || 0);
    if (!Number.isFinite(amount) || amount <= 0) return '$0';
    if (amount < 0.000001) return `$${amount.toExponential(2)}`;
    if (amount < 1) return `$${amount.toFixed(8).replace(/0+$/, '').replace(/\.$/, '')}`;
    return formatCurrency(amount, false);
};

const formatPercent = (value: number | undefined) => {
    const amount = Number(value || 0);
    return `${amount >= 0 ? '+' : ''}${amount.toFixed(2)}%`;
};

const shortAddress = (address?: string) => {
    if (!address) return 'Unknown address';
    if (address.length <= 16) return address;
    return `${address.slice(0, 6)}...${address.slice(-6)}`;
};

const getAge = (timestamp?: number) => {
    if (!timestamp) return 'Unknown';
    const seconds = Math.floor((Date.now() - timestamp) / 1000);
    if (seconds < 60) return `${seconds}s`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
    return `${Math.floor(seconds / 86400)}d`;
};

const formatDateTime = (timestamp?: number) => {
    if (!timestamp) return 'unknown time';
    return new Intl.DateTimeFormat('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    }).format(new Date(timestamp));
};

const getTimeAgo = (timestamp?: number) => {
    if (!timestamp) return 'Just now';
    const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
    if (seconds < 60) return `${seconds}s ago`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
    return `${Math.floor(seconds / 86400)}d ago`;
};

const parsePrice = (price: string) => {
    if (price.includes('e')) return Number(price.replace('$', '')) || 0;
    return Number(price.replace(/[$,]/g, '')) || 0;
};

const normalizeChain = (chain?: string) => {
    if (!chain) return 'Unknown Chain';
    const map: Record<string, string> = {
        bsc: 'BNB Chain',
        binance: 'BNB Chain',
        eth: 'Ethereum',
        ethereum: 'Ethereum',
        solana: 'Solana',
        base: 'Base',
        polygon: 'Polygon',
        arbitrum: 'Arbitrum',
        optimism: 'Optimism'
    };
    return map[chain.toLowerCase()] || chain.charAt(0).toUpperCase() + chain.slice(1);
};

const toSnapshotFromPair = (pair: any): TokenSnapshot => ({
    name: pair?.baseToken?.name || 'Unknown Token',
    symbol: pair?.baseToken?.symbol || 'TOKEN',
    address: pair?.baseToken?.address || '',
    pairAddress: pair?.pairAddress,
    chain: pair?.chainId || 'unknown',
    dex: pair?.dexId,
    imageUrl: pair?.info?.imageUrl || `https://ui-avatars.com/api/?name=${encodeURIComponent(pair?.baseToken?.symbol || 'TOKEN')}&background=111827&color=fff`,
    price: formatPrice(pair?.priceUsd),
    priceChange24h: Number(pair?.priceChange?.h24 || 0),
    priceChange1h: Number(pair?.priceChange?.h1 || 0),
    volume24h: Number(pair?.volume?.h24 || 0),
    liquidity: Number(pair?.liquidity?.usd || 0),
    marketCap: Number(pair?.marketCap || pair?.fdv || 0),
    buys24h: Number(pair?.txns?.h24?.buys || 0),
    sells24h: Number(pair?.txns?.h24?.sells || 0),
    poolCount: Number(pair?.poolCount || 1),
    activeWallets24h: Number(pair?.activeWallets24h || pair?.boosts?.active || pair?.makers || 0),
    pairCreatedAt: pair?.pairCreatedAt,
    url: pair?.url
});

const toSnapshotFromMarketCoin = (coin: MarketCoin): TokenSnapshot => ({
    name: coin.name,
    symbol: coin.ticker,
    address: coin.address || '',
    pairAddress: coin.pairAddress,
    chain: coin.chain,
    imageUrl: coin.img || UNKNOWN_LOGO,
    price: coin.price,
    priceChange24h: Number(String(coin.h24).replace('%', '')) || 0,
    priceChange1h: Number(String(coin.h1).replace('%', '')) || 0,
    volume24h: 0,
    liquidity: 0,
    marketCap: 0,
    buys24h: Number(coin.dexBuys || 0),
    sells24h: Number(coin.dexSells || 0),
    poolCount: 1,
    activeWallets24h: coin.activeWallets24h || 0,
    pairCreatedAt: coin.createdTimestamp
});

const severityStyles = (severity: ImpactfulActivity['severity']) => {
    if (severity === 'Critical') return {
        bar: 'bg-primary-red',
        label: 'text-primary-red border-primary-red/30 bg-primary-red/10'
    };
    if (severity === 'High') return {
        bar: 'bg-primary-yellow',
        label: 'text-primary-yellow border-primary-yellow/30 bg-primary-yellow/10'
    };
    return {
        bar: 'bg-primary-green',
        label: 'text-primary-green border-primary-green/30 bg-primary-green/10'
    };
};

const mergeActivities = (incoming: ImpactfulActivity[], existing: ImpactfulActivity[] = []) => {
    const activityMap = new Map<string, ImpactfulActivity>();

    [...existing, ...incoming].forEach((event) => {
        const key = event.txHash || event.id;
        const previous = activityMap.get(key);

        activityMap.set(key, previous
            ? { ...previous, ...event, detectedAt: Math.min(previous.detectedAt, event.detectedAt) }
            : event
        );
    });

    return [...activityMap.values()]
        .sort((a, b) => b.detectedAt - a.detectedAt)
        .slice(0, 9);
};

const getCachedDetectedAt = (activities: ImpactfulActivity[], txHash: string, fallback: number) => {
    return activities.find((activity) => activity.txHash === txHash || activity.id === txHash)?.detectedAt || fallback;
};

const buildDetectionContextActivities = (
    resolved: TokenSnapshot,
    input: {
        eventType?: string | null;
        severity?: string | null;
        score?: string | null;
        detectedAt?: string | null;
        cachedActivity?: ImpactfulActivity[];
    }
): ImpactfulActivity[] => {
    const detectedAt = Number(input.detectedAt || 0) || Date.now();
    const cachedActivity = input.cachedActivity || [];
    const severity = input.severity === 'High' || input.severity === 'Medium' ? input.severity : 'Signal';
    const score = Number(input.score || 0);
    const activities: ImpactfulActivity[] = [];
    const buySellTotal = resolved.buys24h + resolved.sells24h;
    const buyRatio = buySellTotal > 0 ? resolved.buys24h / buySellTotal : 0;
    const sellRatio = buySellTotal > 0 ? resolved.sells24h / buySellTotal : 0;
    const valueBasis = Math.max(resolved.volume24h, resolved.liquidity, resolved.marketCap * 0.01);
    const pairCreatedAt = resolved.pairCreatedAt || detectedAt;

    if (resolved.pairCreatedAt) {
        activities.push({
            id: `timeline-pair-created-${resolved.address}`,
            type: 'Liquidity Added',
            severity: 'Signal',
            title: 'Trading Pair Created',
            description: `${resolved.symbol} became tradable on ${normalizeChain(resolved.chain)}${resolved.dex ? ` via ${resolved.dex}` : ''} on ${formatDateTime(resolved.pairCreatedAt)}.`,
            usdValue: resolved.liquidity,
            tokenAmount: 0,
            wallet: resolved.pairAddress || resolved.address,
            txHash: `timeline-pair-created-${resolved.address}`,
            detectedAt: getCachedDetectedAt(cachedActivity, `timeline-pair-created-${resolved.address}`, resolved.pairCreatedAt),
            source: 'recent-scan'
        });
    }

    if (resolved.liquidity > 0) {
        activities.push({
            id: `timeline-liquidity-established-${resolved.address}`,
            type: 'Liquidity Added',
            severity: resolved.liquidity >= 100_000 ? 'High' : 'Signal',
            title: 'Liquidity Established',
            description: `${formatCurrency(resolved.liquidity)} current liquidity is available across ${resolved.poolCount.toLocaleString()} tracked pool${resolved.poolCount === 1 ? '' : 's'}.`,
            usdValue: resolved.liquidity,
            tokenAmount: 0,
            wallet: resolved.pairAddress || resolved.address,
            txHash: `timeline-liquidity-established-${resolved.address}`,
            detectedAt: getCachedDetectedAt(cachedActivity, `timeline-liquidity-established-${resolved.address}`, pairCreatedAt),
            source: 'recent-scan'
        });
    }

    if (input.eventType) {
        const txHash = `detection-${resolved.address}`;
        activities.push({
            id: `detection-${resolved.address}-${input.eventType}-${detectedAt}`,
            type: input.eventType,
            severity: severity === 'Medium' ? 'High' : severity,
            title: `${input.eventType} Admission`,
            description: `${resolved.symbol} entered the Detection Engine as ${input.eventType}${score ? ` with score ${score}` : ''}.`,
            usdValue: valueBasis,
            tokenAmount: 0,
            wallet: resolved.pairAddress || resolved.address,
            txHash,
            detectedAt: getCachedDetectedAt(cachedActivity, txHash, detectedAt),
            source: 'recent-scan'
        });
    }

    if (resolved.volume24h >= 5_000 && buyRatio >= 0.62) {
        const txHash = `derived-buy-pressure-${resolved.address}`;
        activities.push({
            id: txHash,
            type: 'Whale Buy',
            severity: buyRatio >= 0.75 ? 'High' : 'Signal',
            title: 'Qualified Buy Pressure',
            description: `${resolved.buys24h.toLocaleString()} buys vs ${resolved.sells24h.toLocaleString()} sells in the latest 24h market data.`,
            usdValue: resolved.volume24h * buyRatio,
            tokenAmount: 0,
            wallet: resolved.pairAddress || resolved.address,
            txHash,
            detectedAt: getCachedDetectedAt(cachedActivity, txHash, detectedAt),
            source: 'recent-scan'
        });
    }

    if (resolved.volume24h >= 5_000 && sellRatio >= 0.62) {
        const txHash = `derived-sell-pressure-${resolved.address}`;
        activities.push({
            id: txHash,
            type: 'Whale Sell',
            severity: sellRatio >= 0.75 ? 'Critical' : 'High',
            title: 'Qualified Sell Pressure',
            description: `${resolved.sells24h.toLocaleString()} sells vs ${resolved.buys24h.toLocaleString()} buys in the latest 24h market data.`,
            usdValue: resolved.volume24h * sellRatio,
            tokenAmount: 0,
            wallet: resolved.pairAddress || resolved.address,
            txHash,
            detectedAt: getCachedDetectedAt(cachedActivity, txHash, detectedAt),
            source: 'recent-scan'
        });
    }

    if (Math.abs(resolved.priceChange24h) >= 10) {
        const positive = resolved.priceChange24h > 0;
        const txHash = `derived-price-move-${resolved.address}`;
        activities.push({
            id: txHash,
            type: positive ? 'Whale Buy' : 'Whale Sell',
            severity: Math.abs(resolved.priceChange24h) >= 25 ? 'High' : 'Signal',
            title: positive ? 'Major Pump Event' : 'Major Dump Event',
            description: `${resolved.symbol} moved ${formatPercent(resolved.priceChange24h)} over 24h with ${formatCurrency(resolved.volume24h)} volume.`,
            usdValue: resolved.volume24h,
            tokenAmount: 0,
            wallet: resolved.pairAddress || resolved.address,
            txHash,
            detectedAt: getCachedDetectedAt(cachedActivity, txHash, detectedAt),
            source: 'recent-scan'
        });
    }

    if (resolved.volume24h >= 25_000) {
        const txHash = `derived-volume-spike-${resolved.address}`;
        activities.push({
            id: txHash,
            type: 'Whale Transfer',
            severity: resolved.volume24h >= 250_000 ? 'High' : 'Signal',
            title: 'Major Volume Event',
            description: `${resolved.symbol} produced ${formatCurrency(resolved.volume24h)} in 24h volume after launching ${getAge(resolved.pairCreatedAt)} ago.`,
            usdValue: resolved.volume24h,
            tokenAmount: 0,
            wallet: resolved.pairAddress || resolved.address,
            txHash,
            detectedAt: getCachedDetectedAt(cachedActivity, txHash, detectedAt),
            source: 'recent-scan'
        });
    }

    if (resolved.liquidity > 0 && resolved.volume24h / resolved.liquidity >= 2) {
        const txHash = `derived-liquidity-turnover-${resolved.address}`;
        activities.push({
            id: txHash,
            type: 'Liquidity Added',
            severity: resolved.volume24h / resolved.liquidity >= 5 ? 'High' : 'Signal',
            title: 'High Liquidity Turnover',
            description: `24h volume is ${(resolved.volume24h / resolved.liquidity).toFixed(1)}x current liquidity, indicating meaningful pool activity.`,
            usdValue: resolved.volume24h,
            tokenAmount: 0,
            wallet: resolved.pairAddress || resolved.address,
            txHash,
            detectedAt: getCachedDetectedAt(cachedActivity, txHash, detectedAt),
            source: 'recent-scan'
        });
    }

    return activities.slice(0, 8);
};

const ONE_HOUR_MS = 60 * 60 * 1000;
const TWO_HOURS_MS = 2 * ONE_HOUR_MS;
const ONE_DAY_MS = 24 * ONE_HOUR_MS;
const RECENT_ACTIVITY_TIMEOUT_MS = 18_000;
const TIMELINE_PAGE_SIZE = 9;

const withTimeout = async <T,>(task: Promise<T>, timeoutMs: number, fallback: T): Promise<T> => {
    let timeoutId: number | undefined;

    try {
        return await Promise.race([
            task,
            new Promise<T>((resolve) => {
                timeoutId = window.setTimeout(() => resolve(fallback), timeoutMs);
            })
        ]);
    } finally {
        if (timeoutId) window.clearTimeout(timeoutId);
    }
};

export const TokenDetection: React.FC = () => {
    const { query } = useParams<{ query: string }>();
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    const tokenQuery = useMemo(() => decodeURIComponent(query || '').trim(), [query]);
    const isDetectionToken = searchParams.get('source') === 'detection';
    const detectionSeverity = searchParams.get('severity');
    const detectionEventType = searchParams.get('eventType');
    const detectionScore = searchParams.get('score');
    const detectionDetectedAt = searchParams.get('detectedAt');
    const initialWatchTtlMs = isDetectionToken && detectionSeverity === 'High' ? ONE_DAY_MS : ONE_HOUR_MS;

    const [token, setToken] = useState<TokenSnapshot | null>(null);
    const [activity, setActivity] = useState<ImpactfulActivity[]>([]);
    const [visibleActivityCount, setVisibleActivityCount] = useState(TIMELINE_PAGE_SIZE);
    const [loading, setLoading] = useState(true);
    const [activityLoading, setActivityLoading] = useState(false);
    const [watchStatus, setWatchStatus] = useState('');
    const [error, setError] = useState('');

    const registerWatch = async (resolved: TokenSnapshot, ttlMs: number, label: string) => {
        if (!resolved.address) return;

        await ImpactfulActivityService.watchToken({
            chain: resolved.chain,
            tokenAddress: resolved.address,
            pairAddress: resolved.pairAddress,
            priceUsd: parsePrice(resolved.price),
            liquidityUsd: resolved.liquidity,
            ttlMs
        });
        setWatchStatus(label);
    };

    const loadToken = async () => {
        setLoading(true);
        setActivityLoading(true);
        setError('');
        setActivity([]);
        setVisibleActivityCount(TIMELINE_PAGE_SIZE);

        try {
            if (!tokenQuery) {
                setToken(null);
                setError('Enter a token address or symbol to run a detection scan.');
                return;
            }

            let pair = await DatabaseService.getTokenDetails(tokenQuery);
            let fallbackCoin: MarketCoin | null = null;

            if (!pair) {
                const results = await DatabaseService.searchGlobalPairs(tokenQuery);
                fallbackCoin = results[0] || null;

                if (fallbackCoin?.address) {
                    pair = await DatabaseService.getTokenDetails(fallbackCoin.address, fallbackCoin.chain);
                }
            }

            const resolved = pair ? toSnapshotFromPair(pair) : fallbackCoin ? toSnapshotFromMarketCoin(fallbackCoin) : null;

            if (!resolved) {
                setToken(null);
                setError('No real token information was found for this scan.');
                return;
            }

            setToken(resolved);
            setLoading(false);

            if (resolved.address) {
                const priceUsd = parsePrice(resolved.price);
                const cachedActivity = await ImpactfulActivityService.getWebhookActivities(resolved.chain, resolved.address);
                const derivedActivity = buildDetectionContextActivities(resolved, {
                    eventType: detectionEventType,
                    severity: detectionSeverity,
                    score: detectionScore,
                    detectedAt: detectionDetectedAt,
                    cachedActivity
                });

                setActivity((current) => mergeActivities(derivedActivity, mergeActivities(cachedActivity, current)));

                try {
                    await registerWatch(
                        resolved,
                        initialWatchTtlMs,
                        initialWatchTtlMs === ONE_DAY_MS ? 'Webhook watch: 24h high-severity detection token' : 'Webhook watch: 1h token scan'
                    );

                    const recentEvents = await withTimeout(
                        ChainActivityService.getTokenActivity(resolved.address, resolved.chain, priceUsd, resolved.pairAddress),
                        RECENT_ACTIVITY_TIMEOUT_MS,
                        []
                    );
                    const recentActivity = ImpactfulActivityService.fromRecentChainActivity(recentEvents, resolved.liquidity);
                    const cachedRecentActivity = await ImpactfulActivityService.cacheActivities(
                        resolved.chain,
                        resolved.address,
                        mergeActivities(recentActivity, derivedActivity)
                    );
                    setActivity((current) => mergeActivities(cachedRecentActivity.length ? cachedRecentActivity : mergeActivities(recentActivity, derivedActivity), current));
                } catch (activityError) {
                    console.warn('Token impact timeline scan failed', activityError);
                    setActivity((current) => mergeActivities(derivedActivity, current));
                }
            }
        } catch (err) {
            console.error('Token detection lookup failed', err);
            setToken(null);
            setError('Unable to load real token information right now.');
        } finally {
            setLoading(false);
            setActivityLoading(false);
        }
    };

    useEffect(() => {
        loadToken();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [tokenQuery]);

    useEffect(() => {
        if (!token?.address) return;

        let cancelled = false;
        const pollWebhookActivity = async () => {
            const webhookActivity = await ImpactfulActivityService.getWebhookActivities(token.chain, token.address);
            if (!cancelled && webhookActivity.length > 0) {
                setActivity((current) => mergeActivities(webhookActivity, current));
            }
        };

        const interval = window.setInterval(pollWebhookActivity, 15000);
        return () => {
            cancelled = true;
            window.clearInterval(interval);
        };
    }, [token?.address, token?.chain]);

    useEffect(() => {
        if (!token?.address) return;

        let cancelled = false;
        let attempts = 0;
        let interval = 0;

        const pollRecentImpact = async () => {
            attempts += 1;
            const priceUsd = parsePrice(token.price);
            const recentEvents = await ChainActivityService.getTokenActivity(token.address, token.chain, priceUsd, token.pairAddress);
            const recentActivity = ImpactfulActivityService.fromRecentChainActivity(recentEvents, token.liquidity);

            if (!cancelled && recentActivity.length > 0) {
                setActivity((current) => mergeActivities(recentActivity, current));
            }

            if (attempts >= 3) {
                window.clearInterval(interval);
            }
        };

        interval = window.setInterval(pollRecentImpact, 30000);
        return () => {
            cancelled = true;
            window.clearInterval(interval);
        };
    }, [token?.address, token?.chain, token?.liquidity, token?.pairAddress, token?.price]);

    const metrics = [
        { label: 'Price', value: token?.price || '$0', change: token?.priceChange24h },
        { label: 'Volume (24h)', value: formatCurrency(token?.volume24h) },
        { label: 'Liquidity', value: formatCurrency(token?.liquidity) },
        { label: 'Market Cap', value: formatCurrency(token?.marketCap) },
        { label: '24h Buys', value: (token?.buys24h || 0).toLocaleString() },
        { label: '24h Sells', value: (token?.sells24h || 0).toLocaleString() },
        { label: 'Pools', value: (token?.poolCount || 0).toLocaleString() },
        { label: 'Age', value: getAge(token?.pairCreatedAt) }
    ];
    const visibleActivity = activity.slice(0, visibleActivityCount);
    const hasMoreActivity = visibleActivityCount < activity.length;

    return (
        <div className="space-y-6 pb-10">
            <div className="flex flex-col gap-4">
                <button onClick={() => navigate('/detection')} className="flex items-center gap-2 text-text-medium hover:text-text-light transition-colors w-fit text-sm font-medium">
                    <ArrowLeft size={18} /> Back to Global Detection
                </button>

                <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-2">
                    <div className="flex flex-col gap-1.5">
                        <div className="flex items-center gap-3">
                            <img
                                src={token?.imageUrl || UNKNOWN_LOGO}
                                alt={token ? `${token.symbol} logo` : 'Token logo'}
                                className="w-10 h-10 rounded-full border border-border bg-card object-cover"
                            />
                            <div className="min-w-0">
                                <h2 className="text-2xl font-bold flex items-center gap-2 min-w-0">
                                    <span className="truncate">{loading ? 'Loading token...' : token?.name || tokenQuery || 'Token Scan'}</span>
                                    {token?.symbol && <span className="text-text-medium text-sm font-medium shrink-0">({token.symbol})</span>}
                                </h2>
                                <p className="text-sm text-text-medium">{token ? `${normalizeChain(token.chain)}${token.dex ? ` / ${token.dex}` : ''}` : 'Resolving live token data'}</p>
                            </div>
                        </div>

                        <div className="flex flex-wrap items-center gap-3 text-text-medium text-sm ml-1 mt-1">
                            <button
                                className="flex items-center gap-1.5 bg-card/50 px-2.5 py-1 rounded-lg border border-border/50 transition-colors hover:border-border group/copy"
                                disabled={!token?.address}
                                onClick={() => token?.address && navigator.clipboard.writeText(token.address)}
                            >
                                <span className="font-mono text-xs">{shortAddress(token?.address || tokenQuery)}</span>
                                <Copy size={12} className="text-text-medium group-hover/copy:text-white transition-colors" />
                            </button>

                            {token?.pairAddress && (
                                <>
                                    <div className="h-1 w-1 rounded-full bg-border"></div>
                                    <span className="font-mono text-xs">Pair {shortAddress(token.pairAddress)}</span>
                                </>
                            )}

                            <div className="h-1 w-1 rounded-full bg-border"></div>
                            <div className="flex items-center gap-2 px-2 py-0.5 rounded border border-primary-green/20 bg-primary-green/5">
                                <span className="relative flex h-2 w-2">
                                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary-green opacity-75"></span>
                                    <span className="relative inline-flex rounded-full h-2 w-2 bg-primary-green"></span>
                                </span>
                                <span className="text-[10px] font-bold uppercase tracking-wide text-primary-green">Live Data</span>
                            </div>
                        </div>
                    </div>

                    <button
                        onClick={loadToken}
                        className="inline-flex items-center gap-2 bg-card border border-border text-text-light font-bold px-5 py-2 rounded-lg hover:border-primary-green transition-colors text-xs uppercase tracking-wide"
                    >
                        <RefreshCw size={15} /> Refresh
                    </button>
                </div>
            </div>

            {error && (
                <div className="bg-primary-red/10 border border-primary-red/30 text-primary-red rounded-xl p-4 flex items-center gap-3">
                    <AlertTriangle size={18} />
                    <span className="text-sm font-semibold">{error}</span>
                </div>
            )}

            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 w-full">
                {metrics.map((item, index) => (
                    <div key={index} className="bg-card border border-border/50 rounded-xl p-3 flex flex-col justify-center gap-0.5 shadow-sm hover:border-border transition-colors min-h-[90px]">
                        <span className="text-text-medium text-[9px] md:text-[10px] font-medium uppercase tracking-wider whitespace-nowrap">{item.label}</span>
                        <div className="flex items-center gap-2 min-w-0">
                            <span className="text-sm md:text-base font-bold text-text-light tracking-tight truncate">{loading ? '...' : item.value}</span>
                            {item.change !== undefined && !loading && (
                                <span className={`text-xs font-bold shrink-0 ${item.change >= 0 ? 'text-primary-green' : 'text-primary-red'}`}>
                                    {formatPercent(item.change)}
                                </span>
                            )}
                        </div>
                    </div>
                ))}
            </div>

            <div className="grid grid-cols-1 xl:grid-cols-[1fr_300px] gap-6">
                <div className="bg-card border border-border rounded-2xl p-6">
                    <div className="flex justify-between items-center mb-4">
                        <h3 className="font-bold text-lg">Token Detection Chart</h3>
                        <span className="text-xs font-bold uppercase tracking-wide text-text-medium">Preview</span>
                    </div>
                    <div className="w-full min-h-[350px] rounded-xl border border-dashed border-border bg-main/40 flex items-center justify-center text-center p-8">
                        <div>
                            <Search size={28} className="mx-auto mb-3 text-text-medium" />
                            <p className="text-text-light font-bold">Chart not available</p>
                            <p className="text-text-medium text-sm mt-1">Real chart data can be connected here later.</p>
                        </div>
                    </div>
                </div>

                <div className="bg-card border border-border rounded-2xl p-6">
                    <h3 className="font-bold text-lg mb-6">Token Actions</h3>
                    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-1 gap-3">
                        <button
                            onClick={() => token && registerWatch(token, TWO_HOURS_MS, 'Webhook watch: 2h tracked token')}
                            className="flex items-center gap-3 p-4 bg-transparent border border-border hover:border-primary-green rounded-xl transition-all group text-left"
                        >
                            <Check size={20} className="text-primary-green" />
                            <span className="font-bold text-sm text-text-light group-hover:text-primary-green">Track This Token</span>
                        </button>
                        <button className="flex items-center gap-3 p-4 bg-transparent border border-border hover:border-text-light rounded-xl transition-all group text-left">
                            <Wallet size={20} className="text-text-medium group-hover:text-text-light" />
                            <span className="font-bold text-sm text-text-medium group-hover:text-text-light">Track Creator Wallet</span>
                        </button>
                        <button className="flex items-center gap-3 p-4 bg-transparent border border-border hover:border-text-light rounded-xl transition-all group text-left">
                            <Shield size={20} className="text-text-medium group-hover:text-text-light" />
                            <span className="font-bold text-sm text-text-medium group-hover:text-text-light">Run SafeScan</span>
                        </button>
                        <button className="flex items-center gap-3 p-4 bg-transparent border border-border hover:border-text-light rounded-xl transition-all group text-left">
                            <Bell size={20} className="text-text-medium group-hover:text-text-light" />
                            <span className="font-bold text-sm text-text-medium group-hover:text-text-light">Create Alerts</span>
                        </button>
                    </div>
                </div>
            </div>

            <div>
                <div className="mb-4 flex flex-col gap-2 pl-1 sm:flex-row sm:items-center sm:justify-between">
                    <h3 className="font-bold text-lg">Token Impact Timeline</h3>
                    {activityLoading && (
                        <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-primary-green">
                            <RefreshCw size={14} className="animate-spin" />
                            Detection updating
                        </div>
                    )}
                </div>
                {watchStatus && <div className="mb-3 text-xs font-bold uppercase tracking-wide text-primary-green">{watchStatus}</div>}
                {activity.length > 0 ? (
                    <>
                        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
                            {visibleActivity.map((event, index) => (
                                <div key={`${event.id}-${index}`} className="bg-card border border-border rounded-xl flex overflow-hidden group hover:border-text-medium transition-colors shadow-md h-full">
                                    <div className={`w-1.5 shrink-0 ${severityStyles(event.severity).bar}`}></div>
                                    <div className="flex-1 p-5 flex flex-col justify-between gap-3">
                                        <div>
                                            <div className="flex justify-between items-start mb-2">
                                                <div className="flex items-center gap-2 font-bold text-xs text-text-light uppercase tracking-wide">
                                                    <Activity size={16} /> {event.title}
                                                </div>
                                                <span className="text-[10px] text-text-dark font-mono whitespace-nowrap">{getTimeAgo(event.detectedAt)}</span>
                                            </div>
                                            <p className="text-sm text-text-light font-medium leading-snug line-clamp-2">{event.description}</p>
                                        </div>
                                        <div className="flex justify-between items-center pt-3 border-t border-border/50 mt-auto gap-3">
                                            <span className="text-text-medium font-bold text-xs truncate">{token?.symbol || tokenQuery}</span>
                                            <div className="flex items-center gap-2">
                                                <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase ${severityStyles(event.severity).label}`}>
                                                    {event.source === 'recent-scan' ? 'Recent' : event.severity}
                                                </span>
                                                <span className="text-text-light font-bold text-sm whitespace-nowrap">{formatCurrency(event.usdValue)}</span>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                        {hasMoreActivity && (
                            <button
                                onClick={() => setVisibleActivityCount((current) => Math.min(current + TIMELINE_PAGE_SIZE, activity.length))}
                                className="mt-4 w-full rounded-lg border border-dashed border-border bg-card py-3 text-xs font-bold uppercase tracking-wide text-text-medium hover:border-primary-green/50 hover:text-primary-green transition-colors"
                            >
                                See More
                            </button>
                        )}
                    </>
                ) : (
                    <div className="bg-card border border-border rounded-xl p-6 text-text-medium">
                        {activityLoading
                            ? 'Loading cached impact data and updating recent activity...'
                            : 'No impactful activity was found in the cached timeline yet. Live webhook-qualified events will appear here when they pass the impact gate.'}
                    </div>
                )}
            </div>
        </div>
    );
};
