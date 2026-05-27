// Route-level token scan screen for the Atlaix application.
import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Activity, AlertTriangle, ArrowLeft, Bell, Copy, ExternalLink, RefreshCw, Search, Shield, ShieldAlert } from 'lucide-react';
import { ChainActivityService } from '../services/ChainActivityService';
import { DatabaseService } from '../services/DatabaseService';
import { enrichDetectionEvent } from '../services/detection/DetectionEventPresenter';
import { ImpactfulActivity, ImpactfulActivityService } from '../services/ImpactfulActivityService';
import { AlphaGauntletEvent, MarketCoin } from '../types';

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
    buyVolume24h?: number;
    sellVolume24h?: number;
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

const copyToClipboard = async (value: string) => {
    if (!value) return false;

    try {
        if (navigator.clipboard?.writeText) {
            await navigator.clipboard.writeText(value);
            return true;
        }
    } catch {
        // Fall through to the textarea fallback for browsers that block clipboard writes.
    }

    try {
        const textarea = document.createElement('textarea');
        textarea.value = value;
        textarea.setAttribute('readonly', '');
        textarea.style.position = 'fixed';
        textarea.style.left = '-9999px';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        const copied = document.execCommand('copy');
        document.body.removeChild(textarea);
        return copied;
    } catch {
        return false;
    }
};

const getAge = (timestamp?: number) => {
    if (!timestamp) return 'Unknown';
    const seconds = Math.floor((Date.now() - timestamp) / 1000);
    if (seconds < 60) return `${seconds}s`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
    return `${Math.floor(seconds / 86400)}d`;
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

const getSafeScanChain = (chain?: string) => {
    if (!chain) return 'solana';
    if (chain === 'ethereum') return 'eth';
    return chain;
};

const parseMarketValue = (value: string | number | undefined) => {
    if (typeof value === 'number') return value;
    if (!value) return 0;

    const raw = value.toString().replace(/[$,\s]/g, '').toUpperCase();
    const parsed = Number.parseFloat(raw);
    if (!Number.isFinite(parsed)) return 0;

    if (raw.includes('T')) return parsed * 1_000_000_000_000;
    if (raw.includes('B')) return parsed * 1_000_000_000;
    if (raw.includes('M')) return parsed * 1_000_000;
    if (raw.includes('K')) return parsed * 1_000;
    return parsed;
};

const toFormattedMarketValue = (value: number) => formatCurrency(value);

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

const toSnapshotFromPair = (pair: any): TokenSnapshot => {
    const buys24h = Number(pair?.txns?.h24?.buys || 0);
    const sells24h = Number(pair?.txns?.h24?.sells || 0);
    const totalTxns = buys24h + sells24h;
    const volume24h = Number(pair?.volume?.h24 || 0);
    const buyVolume24h = Number(pair?.volume?.h24Buy ?? pair?.volume?.buy ?? pair?.volume?.buys ?? 0) || (totalTxns > 0 ? volume24h * (buys24h / totalTxns) : 0);
    const sellVolume24h = Number(pair?.volume?.h24Sell ?? pair?.volume?.sell ?? pair?.volume?.sells ?? 0) || Math.max(0, volume24h - buyVolume24h);

    return {
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
        volume24h,
        liquidity: Number(pair?.liquidity?.usd || 0),
        marketCap: Number(pair?.marketCap || pair?.fdv || 0),
        buys24h,
        sells24h,
        poolCount: Number(pair?.poolCount || 1),
        activeWallets24h: Number(pair?.activeWallets24h || pair?.boosts?.active || pair?.makers || 0),
        buyVolume24h,
        sellVolume24h,
        pairCreatedAt: pair?.pairCreatedAt,
        url: pair?.url
    };
};

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
    volume24h: parseMarketValue(coin.volume24h),
    liquidity: parseMarketValue(coin.liquidity),
    marketCap: parseMarketValue(coin.cap),
    buys24h: Number(coin.dexBuys || 0),
    sells24h: Number(coin.dexSells || 0),
    poolCount: 1,
    activeWallets24h: coin.activeWallets24h || 0,
    buyVolume24h: parseMarketValue(coin.buyVolume24h) || undefined,
    sellVolume24h: parseMarketValue(coin.sellVolume24h) || undefined,
    pairCreatedAt: coin.createdTimestamp
});

const findStoredDetectionCoin = async (query: string): Promise<{ coin: MarketCoin; event: AlphaGauntletEvent } | null> => {
    const normalizedQuery = query.toLowerCase();
    const serverEvents = await DatabaseService.fetchServerDetectionFeed();
    const cachedEvents = DatabaseService.getCachedDetectionEvents();
    const storedEvents = await DatabaseService.fetchDetectionEvents();
    const events = [...serverEvents, ...storedEvents, ...cachedEvents];

    const event = events.find((candidate) => {
        const address = candidate.token.address?.toLowerCase();
        const ticker = candidate.token.ticker?.toLowerCase();
        const pairAddress = candidate.token.pairAddress?.toLowerCase();
        return normalizedQuery === address || normalizedQuery === ticker || normalizedQuery === pairAddress;
    });

    const enriched = event ? enrichDetectionEvent(event) : null;
    return enriched ? { coin: enriched.token, event: enriched } : null;
};

const toMarketCoinFromSnapshot = (snapshot: TokenSnapshot): MarketCoin => {
    const totalTxns = snapshot.buys24h + snapshot.sells24h;
    const buyVolume24h = snapshot.buyVolume24h || (totalTxns > 0 ? snapshot.volume24h * (snapshot.buys24h / totalTxns) : 0);
    const sellVolume24h = snapshot.sellVolume24h || Math.max(0, snapshot.volume24h - buyVolume24h);
    const netFlow = buyVolume24h - sellVolume24h;

    return {
        id: 0,
        name: snapshot.name,
        ticker: snapshot.symbol,
        price: snapshot.price,
        h1: `${snapshot.priceChange1h.toFixed(2)}%`,
        h24: `${snapshot.priceChange24h.toFixed(2)}%`,
        d7: '0.00%',
        cap: toFormattedMarketValue(snapshot.marketCap),
        liquidity: toFormattedMarketValue(snapshot.liquidity),
        volume24h: toFormattedMarketValue(snapshot.volume24h),
        dexBuys: String(snapshot.buys24h),
        dexSells: String(snapshot.sells24h),
        buyVolume24h: toFormattedMarketValue(buyVolume24h),
        sellVolume24h: toFormattedMarketValue(sellVolume24h),
        dexFlow: totalTxns > 0 ? Math.round((snapshot.buys24h / totalTxns) * 100) : 50,
        netFlow: `${netFlow >= 0 ? '+' : '-'}${toFormattedMarketValue(Math.abs(netFlow))}`,
        smartMoney: netFlow > 0 ? 'Inflow' : 'Neutral',
        smartMoneySignal: netFlow > 50_000 ? 'Inflow' : netFlow < -50_000 ? 'Outflow' : 'Neutral',
        signal: snapshot.priceChange24h >= 12 ? 'Breakout' : snapshot.volume24h >= 1_000_000 ? 'Volume Spike' : 'None',
        riskLevel: snapshot.liquidity < 50_000 ? 'Medium' : 'Low',
        age: getAge(snapshot.pairCreatedAt),
        createdTimestamp: snapshot.pairCreatedAt || Date.now(),
        img: snapshot.imageUrl,
        trend: snapshot.priceChange24h >= 0 ? 'Bullish' : 'Bearish',
        chain: snapshot.chain,
        address: snapshot.address,
        pairAddress: snapshot.pairAddress,
        activeWallets24h: snapshot.activeWallets24h
    };
};

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

const WHALE_TRADE_MIN_USD = 100_000;
const LARGE_WALLET_MOVEMENT_MIN_USD = 500_000;

const isReportableTimelineActivity = (event: ImpactfulActivity) => {
    const title = event.title.toLowerCase();
    const type = event.type.toLowerCase();

    if (title === 'large wallet movement') {
        return event.usdValue >= LARGE_WALLET_MOVEMENT_MIN_USD;
    }

    if (title === 'whale buy' || title === 'whale sell' || type === 'whale buy' || type === 'whale sell') {
        return event.usdValue >= WHALE_TRADE_MIN_USD;
    }

    return true;
};

const getActivityMergeKey = (event: ImpactfulActivity) => {
    if (event.title.toLowerCase() === 'volume expansion') return 'semantic:volume-expansion';
    return event.txHash || event.id;
};

const mergeActivities = (incoming: ImpactfulActivity[], existing: ImpactfulActivity[] = []) => {
    const activityMap = new Map<string, ImpactfulActivity>();

    [...existing, ...incoming].filter(isReportableTimelineActivity).forEach((event) => {
        const key = getActivityMergeKey(event);
        const previous = activityMap.get(key);

        activityMap.set(key, previous
            ? { ...previous, ...event, detectedAt: Math.min(previous.detectedAt, event.detectedAt) }
            : event
        );
    });

    return [...activityMap.values()]
        .filter(isReportableTimelineActivity)
        .sort((a, b) => b.detectedAt - a.detectedAt)
        .slice(0, 9);
};

const ONE_HOUR_MS = 60 * 60 * 1000;
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
    const initialWatchTtlMs = isDetectionToken && detectionSeverity === 'High' ? ONE_DAY_MS : ONE_HOUR_MS;

    const [token, setToken] = useState<TokenSnapshot | null>(null);
    const [activity, setActivity] = useState<ImpactfulActivity[]>([]);
    const [visibleActivityCount, setVisibleActivityCount] = useState(TIMELINE_PAGE_SIZE);
    const [loading, setLoading] = useState(true);
    const [activityLoading, setActivityLoading] = useState(false);
    const [watchStatus, setWatchStatus] = useState('');
    const [error, setError] = useState('');
    const [detectionEvent, setDetectionEvent] = useState<AlphaGauntletEvent | null>(null);
    const [copyState, setCopyState] = useState<'idle' | 'copied' | 'error'>('idle');

    const handleCopyAddress = async () => {
        const address = token?.address || tokenQuery;
        const copied = await copyToClipboard(address);
        setCopyState(copied ? 'copied' : 'error');
        window.setTimeout(() => setCopyState('idle'), 1800);
    };

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
        setDetectionEvent(null);
        setVisibleActivityCount(TIMELINE_PAGE_SIZE);

        try {
            if (!tokenQuery) {
                setToken(null);
                setError('Enter a token address or symbol to run a detection scan.');
                return;
            }

            const storedDetection = isDetectionToken ? await findStoredDetectionCoin(tokenQuery) : null;
            if (storedDetection?.event) setDetectionEvent(storedDetection.event);
            let fallbackCoin: MarketCoin | null = storedDetection?.coin || null;
            let pair = fallbackCoin
                ? await withTimeout(
                    DatabaseService.getTokenDetails(fallbackCoin.address || tokenQuery, fallbackCoin.chain, fallbackCoin.pairAddress),
                    6000,
                    null
                )
                : await DatabaseService.getTokenDetails(tokenQuery);

            if (!pair && !fallbackCoin) {
                const results = await DatabaseService.searchGlobalPairs(tokenQuery);
                fallbackCoin = results[0] || null;

                if (fallbackCoin?.address) {
                    pair = await withTimeout(
                        DatabaseService.getTokenDetails(fallbackCoin.address, fallbackCoin.chain, fallbackCoin.pairAddress),
                        6000,
                        null
                    );
                }
            }

            const resolved = pair ? toSnapshotFromPair(pair) : fallbackCoin ? toSnapshotFromMarketCoin(fallbackCoin) : null;

            if (!resolved) {
                setToken(null);
                setError(isDetectionToken
                    ? 'This detection is still warming up. Try again shortly.'
                    : 'No real token information was found for this scan.'
                );
                return;
            }

            setToken(resolved);
            setLoading(false);

            if (resolved.address) {
                const priceUsd = parsePrice(resolved.price);
                const localCachedActivity = ImpactfulActivityService.getCachedActivities(resolved.chain, resolved.address);
                if (localCachedActivity.length) {
                    setActivity(localCachedActivity.filter(isReportableTimelineActivity));
                    setActivityLoading(false);
                }

                const cachedActivity = await ImpactfulActivityService.getWebhookActivities(resolved.chain, resolved.address);
                setActivity((current) => mergeActivities(cachedActivity, current));

                try {
                    await registerWatch(
                        resolved,
                        initialWatchTtlMs,
                        initialWatchTtlMs === ONE_DAY_MS ? 'Tracking for 24 hours.' : 'Tracking this token for new activity.'
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
                        recentActivity
                    );
                    setActivity((current) => mergeActivities(cachedRecentActivity.length ? cachedRecentActivity : recentActivity, current));
                } catch (activityError) {
                    console.warn('Token impact timeline scan failed', activityError);
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
    const tokenAddress = token?.address || '';
    const tokenChain = token?.chain || searchParams.get('chain') || 'solana';
    const tokenDetailsUrl = tokenAddress
        ? `/token/${encodeURIComponent(tokenAddress)}?${new URLSearchParams({
            ...(token?.pairAddress ? { pair: token.pairAddress } : {}),
            chain: tokenChain
        }).toString()}`
        : '';

    return (
        <div className="space-y-6 pb-10">
            <div className="flex flex-col gap-4">
                <button onClick={() => navigate('/detection')} className="flex items-center gap-2 text-text-medium hover:text-text-light transition-colors w-fit text-sm font-medium">
                    <ArrowLeft size={18} /> Back to Detection Engine
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
                                type="button"
                                className="token-contract-address-pill flex items-center gap-1.5 bg-card/50 px-2.5 py-1 rounded-lg border border-border/50 transition-colors hover:border-border disabled:cursor-not-allowed disabled:opacity-60 group/copy"
                                disabled={!(token?.address || tokenQuery)}
                                onClick={handleCopyAddress}
                                title={copyState === 'copied' ? 'Copied contract address' : copyState === 'error' ? 'Copy failed' : 'Copy contract address'}
                                aria-label="Copy contract address"
                            >
                                <span className="font-mono text-xs">{shortAddress(token?.address || tokenQuery)}</span>
                                <Copy size={12} className={`${copyState === 'copied' ? 'text-primary-green' : copyState === 'error' ? 'text-primary-red' : 'text-text-medium group-hover/copy:text-white'} transition-colors`} />
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
                                    <span className="relative inline-flex rounded-full h-2 w-2 bg-primary-green"></span>
                                </span>
                                <span className="text-[10px] font-bold uppercase tracking-wide text-primary-green">Live Data</span>
                            </div>
                            {isDetectionToken && detectionEventType && (
                                <>
                                    <div className="h-1 w-1 rounded-full bg-border"></div>
                                    <span className="token-detection-event-pill rounded border border-border bg-card/50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-text-medium">
                                        Admitted as {detectionEvent?.lane || detectionEventType}
                                    </span>
                                </>
                            )}
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
                    <div key={index} className="green-corner-card bg-card border border-border/50 rounded-xl p-3 flex flex-col justify-center gap-0.5 shadow-sm hover:border-border transition-colors min-h-[90px]">
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
                <div className="green-corner-card bg-card border border-border rounded-2xl p-6">
                    <div className="flex justify-between items-center mb-4">
                        <h3 className="font-bold text-lg">Token Detection Chart</h3>
                        <span className="text-xs font-bold uppercase tracking-wide text-text-medium">Market Chart</span>
                    </div>
                    <div className="w-full min-h-[350px] rounded-xl border border-dashed border-border bg-main/40 flex items-center justify-center text-center p-8">
                        <div>
                            <Search size={28} className="mx-auto mb-3 text-text-medium" />
                            <p className="text-text-light font-bold">Chart not available</p>
                            <p className="text-text-medium text-sm mt-1">Chart data is unavailable for this token.</p>
                        </div>
                    </div>
                </div>

                <div className="green-corner-card bg-card border border-border rounded-2xl p-6">
                    <h3 className="font-bold text-lg mb-6">Quick Actions</h3>
                    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-1 gap-3">
                        <button
                            onClick={() => tokenDetailsUrl && navigate(tokenDetailsUrl)}
                            disabled={!tokenDetailsUrl}
                            className="flex items-center gap-3 p-4 bg-transparent border border-border hover:border-text-light rounded-xl transition-all group text-left disabled:cursor-not-allowed disabled:opacity-50"
                        >
                            <ExternalLink size={20} className="text-text-medium group-hover:text-text-light" />
                            <span className="font-bold text-sm text-text-medium group-hover:text-text-light">Token Details</span>
                        </button>
                        <button
                            onClick={() => navigate(`/safe-scan?${new URLSearchParams({ address: tokenAddress, chain: getSafeScanChain(tokenChain), autoScan: '1' }).toString()}`)}
                            disabled={!tokenAddress}
                            className="flex items-center gap-3 p-4 bg-transparent border border-border hover:border-text-light rounded-xl transition-all group text-left disabled:cursor-not-allowed disabled:opacity-50"
                        >
                            <Shield size={20} className="text-text-medium group-hover:text-text-light" />
                            <span className="font-bold text-sm text-text-medium group-hover:text-text-light">Run Safe Scan</span>
                        </button>
                        <button
                            onClick={() => navigate(`/smart-alerts?${new URLSearchParams({ address: tokenAddress, chain: tokenChain }).toString()}`)}
                            disabled={!tokenAddress}
                            className="flex items-center gap-3 p-4 bg-transparent border border-border hover:border-text-light rounded-xl transition-all group text-left disabled:cursor-not-allowed disabled:opacity-50"
                        >
                            <Bell size={20} className="text-text-medium group-hover:text-text-light" />
                            <span className="font-bold text-sm text-text-medium group-hover:text-text-light">Create Alert</span>
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
                                <div key={`${event.id}-${index}`} className="detection-event-card group flex w-full overflow-hidden rounded-xl border border-border bg-[#1C1F22] text-left shadow-sm transition-colors hover:border-text-medium">
                                    <div className="flex min-h-[128px] flex-1 flex-col justify-between p-3.5">
                                        <div>
                                            <div className="flex items-start justify-between gap-3">
                                                <div className="flex min-w-0 items-center gap-2 text-[10px] font-black uppercase text-text-light">
                                                    <ShieldAlert size={13} className="shrink-0 text-text-light" />
                                                    <span className="truncate">{event.title}</span>
                                                </div>
                                                <span className="shrink-0 text-[10px] font-mono text-text-medium">{getTimeAgo(event.detectedAt)}</span>
                                            </div>
                                            <p className="mt-3 line-clamp-2 text-xs font-bold leading-snug text-text-light">{event.description}</p>
                                        </div>
                                        <div className="mt-3 flex items-center justify-between gap-3 border-t border-border/60 pt-2.5">
                                            <div className="flex min-w-0 items-center gap-2">
                                                {token?.imageUrl && (
                                                    <img
                                                        src={token.imageUrl}
                                                        alt={token.symbol}
                                                        title={token.name}
                                                        className="h-5 w-5 shrink-0 rounded-full border border-border bg-[#111315] object-cover"
                                                        onError={(imageEvent) => { imageEvent.currentTarget.style.display = 'none'; }}
                                                    />
                                                )}
                                                <span className="truncate text-[11px] font-black text-text-medium" title={token?.name || tokenQuery}>
                                                    {token?.symbol || tokenQuery}
                                                </span>
                                            </div>
                                            <div className="flex shrink-0 items-center gap-2">
                                                <span className={`rounded-full border px-2 py-0.5 text-[9px] font-bold uppercase ${severityStyles(event.severity).label}`}>
                                                    {event.severity}
                                                </span>
                                                <span className="font-mono text-[11px] font-black text-text-light">
                                                    {formatCurrency(event.usdValue)}
                                                </span>
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
                    <div className="green-corner-card bg-card border border-border rounded-xl p-6 text-text-medium">
                        {activityLoading
                            ? 'Loading recent token activity...'
                            : 'No major activity has been detected yet. New major activity will appear here as it is found.'}
                    </div>
                )}
            </div>
        </div>
    );
};
