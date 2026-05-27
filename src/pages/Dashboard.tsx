// Route-level product screen for the Atlaix application.
import React, { useState, useRef, useEffect, useMemo } from 'react';
import { Activity, Zap, TrendingUp, Search, ChevronRight, ChevronLeft, Info, RefreshCw, SlidersHorizontal, X, RotateCcw, BarChart3 } from 'lucide-react';
import type { AlphaGauntletEventType, MarketCoin } from '../types';
import { DatabaseService } from '../services/DatabaseService';
import type { ChainDexVolume } from '../services/DatabaseService';
import { AlphaGauntletService } from '../services/AlphaGauntletService';
import { useNavigate } from 'react-router-dom';
import { isExcludedAlphaToken } from '../utils/tokenFilters';
import { SECTOR_FILTER_OPTIONS, classifyTokenSector } from '../utils/sectorClassification';

interface DashboardProps {
    // onTokenSelect prop removed as we use routing
}

interface FeedScrollRailFrame {
    active: boolean;
    headerActive: boolean;
    left: number;
    width: number;
    scrollWidth: number;
}

// Helper to parse currency strings into numbers for sorting
const parseCurrency = (val: string | number) => {
    if (typeof val === 'number') return val;
    if (!val) return 0;

    // Check for negative sign before stripping characters
    const isNegative = val.toString().includes('-');

    let clean = val.toString().replace(/[$,]/g, '');
    let multiplier = 1;
    if (clean.includes('T')) multiplier = 1e12;
    else if (clean.includes('B')) multiplier = 1e9;
    else if (clean.includes('M')) multiplier = 1e6;
    else if (clean.includes('K')) multiplier = 1e3;

    // Remove suffixes and percentage signs
    clean = clean.replace(/[TBMK%+\-]/g, '');

    let result = parseFloat(clean) * multiplier;
    return isNegative ? -result : result;
};

interface FeedFilters {
    visibleCount: string;
    chain: string;
    sector: string;
    eventType: string;
    marketCapMin: string;
    marketCapMax: string;
    liquidityMin: string;
    liquidityMax: string;
    priceChangeMin: string;
    priceChangeMax: string;
    volumeMin: string;
    volumeMax: string;
}

const DEFAULT_FEED_FILTERS: FeedFilters = {
    visibleCount: 'all',
    chain: 'all',
    sector: 'all',
    eventType: 'all',
    marketCapMin: '',
    marketCapMax: '',
    liquidityMin: '',
    liquidityMax: '',
    priceChangeMin: '',
    priceChangeMax: '',
    volumeMin: '',
    volumeMax: ''
};

const MIN_FEED_VOLUME_24H_USD = 100000;
const MIN_FEED_LIQUIDITY_USD = 100000;
const FEED_ORDER_STORAGE_KEY = 'atlaix-live-alpha-feed-order-v1';

type FeedOrderState = {
    orderByKey: Record<string, number>;
    nextOrder: number;
};

const parseFilterNumber = (value: string) => {
    if (!value.trim()) return null;
    const parsed = Number(value.replace(/[$,%\s,]/g, ''));
    return Number.isFinite(parsed) ? parsed : null;
};

const getTokenKey = (coin: MarketCoin) =>
    `${coin.chain || 'unknown'}:${coin.address || coin.pairAddress || coin.ticker}`.toLowerCase();

const loadFeedOrderState = (): FeedOrderState => {
    if (typeof window === 'undefined') return { orderByKey: {}, nextOrder: 0 };

    try {
        const raw = window.localStorage.getItem(FEED_ORDER_STORAGE_KEY);
        if (!raw) return { orderByKey: {}, nextOrder: 0 };

        const parsed = JSON.parse(raw) as Partial<FeedOrderState>;
        if (!parsed.orderByKey || typeof parsed.orderByKey !== 'object') {
            return { orderByKey: {}, nextOrder: 0 };
        }

        const maxOrder = Object.values(parsed.orderByKey)
            .filter((value): value is number => Number.isFinite(value))
            .reduce((max, value) => Math.max(max, value), -1);

        return {
            orderByKey: parsed.orderByKey,
            nextOrder: Number.isFinite(parsed.nextOrder) ? Math.max(parsed.nextOrder || 0, maxOrder + 1) : maxOrder + 1
        };
    } catch {
        return { orderByKey: {}, nextOrder: 0 };
    }
};

const saveFeedOrderState = (state: FeedOrderState) => {
    if (typeof window === 'undefined') return;

    try {
        window.localStorage.setItem(FEED_ORDER_STORAGE_KEY, JSON.stringify(state));
    } catch {
        // Ignore private-mode and quota errors.
    }
};

const FilterSelect = ({
    label,
    value,
    onChange,
    options
}: {
    label: string;
    value: string;
    onChange: (value: string) => void;
    options: Array<{ value: string; label: string }>;
}) => (
    <div className="grid gap-2 md:grid-cols-[220px_minmax(0,1fr)] md:items-center">
        <div className="text-sm font-bold text-text-medium">{label}</div>
        <select
            value={value}
            onChange={(event) => onChange(event.target.value)}
            className="h-10 w-full appearance-none rounded-lg border border-border bg-[#111315] px-4 text-sm font-bold text-text-light outline-none transition-colors hover:border-text-medium focus:border-primary-green/50"
        >
            {options.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
            ))}
        </select>
    </div>
);

const FilterRange = ({
    label,
    minKey,
    maxKey,
    suffix,
    filters,
    onChange
}: {
    label: string;
    minKey: keyof FeedFilters;
    maxKey: keyof FeedFilters;
    suffix: string;
    filters: FeedFilters;
    onChange: (key: keyof FeedFilters, value: string) => void;
}) => (
    <div className="grid gap-2 md:grid-cols-[220px_minmax(0,1fr)] md:items-center">
        <div className="text-sm font-bold text-text-medium">{label}</div>
        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
            <label className="relative">
                <input
                    value={filters[minKey]}
                    onChange={(event) => onChange(minKey, event.target.value)}
                    inputMode="decimal"
                    placeholder="Min"
                    className="h-10 w-full rounded-lg border border-border bg-[#111315] px-4 pr-8 text-sm font-bold text-text-light outline-none placeholder-text-dark transition-colors focus:border-primary-green/50"
                />
                <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs font-black text-text-medium">{suffix}</span>
            </label>
            <span className="text-text-dark">-</span>
            <label className="relative">
                <input
                    value={filters[maxKey]}
                    onChange={(event) => onChange(maxKey, event.target.value)}
                    inputMode="decimal"
                    placeholder="Max"
                    className="h-10 w-full rounded-lg border border-border bg-[#111315] px-4 pr-8 text-sm font-bold text-text-light outline-none placeholder-text-dark transition-colors focus:border-primary-green/50"
                />
                <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs font-black text-text-medium">{suffix}</span>
            </label>
        </div>
    </div>
);

const registerFeedOrder = (tokens: MarketCoin[], current: FeedOrderState): FeedOrderState => {
    if (!tokens.length) return current;

    let changed = false;
    let nextOrder = current.nextOrder;
    const orderByKey = { ...current.orderByKey };

    tokens.forEach((coin) => {
        const key = getTokenKey(coin);
        if (orderByKey[key] !== undefined) return;

        orderByKey[key] = nextOrder;
        nextOrder += 1;
        changed = true;
    });

    return changed ? { orderByKey, nextOrder } : current;
};

const mergeStableFeedData = (incoming: MarketCoin[], current: MarketCoin[], preserveMissing = false) => {
    if (!incoming.length) return current;
    if (!current.length) return incoming;

    const incomingByKey = new Map<string, MarketCoin>();
    incoming.forEach((coin) => incomingByKey.set(getTokenKey(coin), coin));

    const stableRows: MarketCoin[] = [];
    current.forEach((coin) => {
        const key = getTokenKey(coin);
        const updated = incomingByKey.get(key);
        if (!updated) {
            if (preserveMissing) stableRows.push(coin);
            return;
        }

        stableRows.push(updated);
        incomingByKey.delete(key);
    });

    return [...stableRows, ...incomingByKey.values()];
};

const meetsFeedVolumeMinimum = (coin: MarketCoin) =>
    parseCurrency(coin.volume24h) >= MIN_FEED_VOLUME_24H_USD;

const meetsFeedLiquidityMinimum = (coin: MarketCoin) =>
    parseCurrency(coin.liquidity) >= MIN_FEED_LIQUIDITY_USD;

const isLiveAlphaEligible = (coin: MarketCoin) =>
    !isExcludedAlphaToken(coin) &&
    meetsFeedVolumeMinimum(coin) &&
    meetsFeedLiquidityMinimum(coin);

const CHAIN_DEX_VOLUME_IDS = ['solana', 'ethereum', 'base', 'bsc', 'polygon', 'arbitrum'];

const EVENT_FILTER_OPTIONS: Array<{ value: 'all' | AlphaGauntletEventType; label: string }> = [
    { value: 'all', label: 'All Events' },
    { value: 'Accumulation', label: 'Accumulation' },
    { value: 'Potential Accumulation', label: 'Potential Accumulation' },
    { value: 'Momentum Breakout', label: 'Momentum Breakout' },
    { value: 'Overextended Momentum', label: 'Overextended Momentum' },
    { value: 'Distribution', label: 'Distribution' },
    { value: 'Potential Distribution', label: 'Potential Distribution' },
    { value: 'Market Stress', label: 'Market Stress' },
    { value: 'Possible Wash Trading', label: 'Possible Wash Trading' },
    { value: 'Deep Liquidity Structure', label: 'Deep Liquidity Structure' },
    { value: 'Thin Liquidity Risk', label: 'Thin Liquidity Risk' },
    { value: 'Flow Imbalance', label: 'Flow Imbalance' },
    { value: 'Conflicting Signals', label: 'Conflicting Signals' },
    { value: 'Recovery', label: 'Recovery' },
    { value: 'Recovery Attempt', label: 'Recovery Attempt' },
    { value: 'Confirmed Recovery', label: 'Confirmed Recovery' },
    { value: 'Liquidity Event', label: 'Liquidity Event' },
    { value: 'Unusual Activity', label: 'Unusual Activity' }
];

const EVENT_BADGE_STYLE = 'border-border bg-card-hover text-text-medium';

const classifyFeedSector = (coin: MarketCoin) => {
    return classifyTokenSector(coin).primarySector;
};

const getFeedSectorLabel = (coin: MarketCoin) => {
    return classifyTokenSector(coin).label;
};

const getFeedEventLabel = (coin: MarketCoin, eventType?: AlphaGauntletEventType) => {
    if (eventType) return eventType;
    if (coin.signal && coin.signal !== 'None') return coin.signal;
    return 'None';
};

const getInitialItemsPerPage = () => {
    if (typeof window === 'undefined') return 16;

    if (window.innerWidth <= 640) return 8;
    if (window.innerWidth <= 1180) return 14;
    return 16;
};

const getStartupRefreshDelay = () => {
    if (typeof window === 'undefined') return 2500;

    if (window.innerWidth <= 640) return 30000;
    if (window.innerWidth <= 1180) return 8000;
    return 1800;
};

const getSecondaryDataDelay = () => {
    if (typeof window === 'undefined') return 2500;

    if (window.innerWidth <= 640) return 12000;
    if (window.innerWidth <= 1180) return 5000;
    return 1200;
};

const runWhenIdle = (callback: () => void) => {
    if (typeof window !== 'undefined' && typeof window.requestIdleCallback === 'function') {
        window.requestIdleCallback(callback, { timeout: 3000 });
        return;
    }

    window.setTimeout(callback, 0);
};

export const Dashboard: React.FC<DashboardProps> = () => {
    const [timeFrame, setTimeFrame] = useState('12H');
    const [searchQuery, setSearchQuery] = useState('');
    const navigate = useNavigate();

    // Search Suggestions State
    const [suggestions, setSuggestions] = useState<MarketCoin[]>([]);
    const [showSuggestions, setShowSuggestions] = useState(false);


    // Pagination State
    const [currentPage, setCurrentPage] = useState(1);
    const itemsPerPage = getInitialItemsPerPage();

    // Sorting State - Default is null (Neutral/Algorithm Rank)
    const [sortConfig, setSortConfig] = useState<{ key: string; direction: 'asc' | 'desc' } | null>(null);

    // Data & System State
    const [marketData, setMarketData] = useState<MarketCoin[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [lastUpdated, setLastUpdated] = useState<Date>(new Date());
    const [searchError, setSearchError] = useState<string>('');
    const [showFeedFilters, setShowFeedFilters] = useState(false);
    const [feedFilters, setFeedFilters] = useState<FeedFilters>(DEFAULT_FEED_FILTERS);
    const [draftFeedFilters, setDraftFeedFilters] = useState<FeedFilters>(DEFAULT_FEED_FILTERS);
    const [chainVolumeSlide, setChainVolumeSlide] = useState(0);
    const [chainDexVolumes, setChainDexVolumes] = useState<ChainDexVolume[]>([]);
    const [feedOrderState, setFeedOrderState] = useState<FeedOrderState>(() => loadFeedOrderState());
    const [feedScrollRailFrame, setFeedScrollRailFrame] = useState<FeedScrollRailFrame>({
        active: false,
        headerActive: false,
        left: 0,
        width: 0,
        scrollWidth: 0
    });
    const marketDataRef = useRef<MarketCoin[]>([]);
    const feedTableSectionRef = useRef<HTMLDivElement | null>(null);
    const feedTableScrollerRef = useRef<HTMLDivElement | null>(null);
    const feedFixedHeaderRef = useRef<HTMLDivElement | null>(null);
    const syncingFeedScrollRef = useRef(false);
    const startupRefreshTimerRef = useRef<number | null>(null);

    useEffect(() => {
        marketDataRef.current = marketData;
    }, [marketData]);

    const applyStableMarketData = (nextData: MarketCoin[], stableBase?: MarketCoin[], preserveMissing = false) => {
        setMarketData((current) => {
            const base = stableBase || current;
            const merged = mergeStableFeedData(nextData, base, preserveMissing).filter(isLiveAlphaEligible);

            setFeedOrderState((currentOrder) => {
                const nextOrder = registerFeedOrder(merged, currentOrder);
                if (nextOrder !== currentOrder) saveFeedOrderState(nextOrder);
                return nextOrder;
            });

            return merged;
        });
    };

    const scheduleStartupRefresh = (hydratedFeed: MarketCoin[]) => {
        if (startupRefreshTimerRef.current !== null) {
            window.clearTimeout(startupRefreshTimerRef.current);
        }

        startupRefreshTimerRef.current = window.setTimeout(() => {
            startupRefreshTimerRef.current = null;
            runWhenIdle(() => {
                void (async () => {
                    try {
                        const response = await DatabaseService.getMarketData(true, true);
                        applyStableMarketData(response.data, hydratedFeed);
                        setLastUpdated(new Date());
                    } catch (e) {
                        console.error("DB refresh error", e);
                    }
                })();
            });
        }, getStartupRefreshDelay());
    };

    // Live Search Filter Effect
    // Live Search Filter Effect
    useEffect(() => {
        setSearchError(''); // Clear error on typing
        if (!searchQuery.trim()) {
            setSuggestions([]);
            return;
        }

        const query = searchQuery.toLowerCase();

        // 1. Instant Local Search from Market Data
        const localMatches = marketData ? marketData.filter(coin =>
            isLiveAlphaEligible(coin) &&
            (
                coin.ticker.toLowerCase().includes(query) ||
                coin.name.toLowerCase().includes(query) ||
                coin.address.toLowerCase().includes(query)
            )
        ).slice(0, 5) : [];

        setSuggestions(localMatches);

        // 2. Debounced Global Search
        const timer = setTimeout(async () => {
            try {
                // Only search global if query is long enough to be meaningful
                if (query.length < 2) return;

                const globalResults = await DatabaseService.searchGlobalPairs(query);

                // Merge: Local first, then unique Global
                const existingPairs = new Set(localMatches.map(c => (c.pairAddress || c.address || '').toLowerCase()));
                const uniqueGlobal = globalResults.filter(c =>
                    !existingPairs.has((c.pairAddress || c.address || '').toLowerCase()) &&
                    isLiveAlphaEligible(c)
                );

                // Combine
                let combined = [...localMatches, ...uniqueGlobal];

                // Sort by pair liquidity first so duplicate token pairs are easier to compare.
                combined.sort((a, b) => {
                    const liquidityDiff = parseCurrency(b.liquidity) - parseCurrency(a.liquidity);
                    if (liquidityDiff !== 0) return liquidityDiff;
                    return parseCurrency(b.cap) - parseCurrency(a.cap);
                });

                // Set suggestions
                setSuggestions(combined.slice(0, 10));
            } catch (e) {
                console.error("Global search error:", e);
            }
        }, 300); // 300ms debounce

        return () => clearTimeout(timer);
    }, [searchQuery, marketData]);

    // Load Data Function
    const loadData = async (force: boolean = false, partial: boolean = false) => {
        if (force) setIsLoading(true);

        try {
            if (!force && marketDataRef.current.length === 0) {
                let hasHydratedFeed = false;
                let hydratedFeed: MarketCoin[] = [];
                const cached = DatabaseService.getCachedMarketData();
                if (cached?.data.length) {
                    hydratedFeed = cached.data;
                    applyStableMarketData(cached.data, []);
                    setLastUpdated(new Date());
                    setIsLoading(false);
                    hasHydratedFeed = true;
                }

                const persistedTokens = await DatabaseService.fetchFromSupabase();
                if (persistedTokens.length) {
                    hydratedFeed = persistedTokens;
                    applyStableMarketData(persistedTokens);
                    setLastUpdated(new Date());
                    setIsLoading(false);
                    hasHydratedFeed = true;
                } else if (!hasHydratedFeed) {
                    const hydrated = await DatabaseService.getInitialMarketData();
                    if (hydrated.data.length) {
                        hydratedFeed = hydrated.data;
                        applyStableMarketData(hydrated.data);
                        setLastUpdated(new Date());
                        hasHydratedFeed = true;
                    }
                    setIsLoading(false);
                }

                if (!hasHydratedFeed) {
                    setLastUpdated(new Date());
                }

                if (hasHydratedFeed) {
                    scheduleStartupRefresh(hydratedFeed);
                    return;
                }

                const response = await DatabaseService.getMarketData(true, false);
                applyStableMarketData(response.data, []);
                setLastUpdated(new Date());
                return;
            }

            const response = await DatabaseService.getMarketData(force, partial);
            applyStableMarketData(response.data, undefined, partial && !force);
            setLastUpdated(new Date());
        } catch (e) {
            console.error("DB Error", e);
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        loadData();
        const interval = setInterval(() => {
            if (typeof document !== 'undefined' && document.hidden) {
                return;
            }
            loadData(false, true);
        }, 15000);
        return () => {
            clearInterval(interval);
            if (startupRefreshTimerRef.current !== null) {
                window.clearTimeout(startupRefreshTimerRef.current);
                startupRefreshTimerRef.current = null;
            }
        };
    }, [timeFrame]);

    useEffect(() => {
        let cancelled = false;
        let interval: number | null = null;
        let initialTimer: number | null = null;

        const loadChainDexVolumes = async () => {
            const volumes = await DatabaseService.getChainDexVolumes(CHAIN_DEX_VOLUME_IDS);
            if (!cancelled && volumes.length) {
                setChainDexVolumes(volumes);
            }
        };

        initialTimer = window.setTimeout(() => {
            runWhenIdle(() => {
                void loadChainDexVolumes();
                interval = window.setInterval(loadChainDexVolumes, 5 * 60 * 1000);
            });
        }, getSecondaryDataDelay());

        return () => {
            cancelled = true;
            if (initialTimer !== null) window.clearTimeout(initialTimer);
            if (interval !== null) window.clearInterval(interval);
        };
    }, []);

    const handleTokenNavigation = (token: MarketCoin | string) => {
        const identifier = typeof token === 'string' ? token : (token.address || token.ticker);
        if (identifier) {
            const params = typeof token === 'string' || !token.pairAddress
                ? ''
                : `?pair=${encodeURIComponent(token.pairAddress)}&chain=${encodeURIComponent(token.chain)}`;
            navigate(`/token/${identifier}${params}`);
        }
    };

    const handleSearchSubmit = () => {
        if (!searchQuery.trim()) return;

        if (suggestions.length > 0) {
            handleTokenNavigation(suggestions[0]);
        } else {
            setSearchError("No matching token found.");
        }
    };

    const getChange = (coin: MarketCoin) => coin.h24;

    // Sorting Handler - Implements Tri-State (Desc -> Asc -> Neutral)
    const handleSort = (key: string, specificDirection?: 'asc' | 'desc') => {
        if (specificDirection) {
            setSortConfig({ key, direction: specificDirection });
        } else {
            // Cycle: Default -> Desc -> Asc -> Default
            if (sortConfig?.key === key) {
                if (sortConfig.direction === 'desc') {
                    setSortConfig({ key, direction: 'asc' });
                } else {
                    setSortConfig(null); // Return to neutral (default algorithm sort)
                }
            } else {
                setSortConfig({ key, direction: 'desc' }); // New column starts descending (High to Low)
            }
        }
        setCurrentPage(1); // Reset to first page on sort change
    };

    const chainOptions = useMemo(() => {
        return Array.from(new Set(marketData.map((coin) => coin.chain).filter(Boolean))).sort();
    }, [marketData]);

    const activeFilterCount = useMemo(() => {
        return Object.entries(feedFilters).filter(([key, value]) => {
            const defaultValue = DEFAULT_FEED_FILTERS[key as keyof FeedFilters];
            return value !== defaultValue && value !== '';
        }).length;
    }, [feedFilters]);

    const filteredData = useMemo(() => {
        return marketData.filter((coin) => {
            if (!isLiveAlphaEligible(coin)) return false;
            if (feedFilters.chain !== 'all' && coin.chain !== feedFilters.chain) return false;
            if (feedFilters.sector !== 'all' && classifyFeedSector(coin) !== feedFilters.sector) return false;

            if (feedFilters.eventType !== 'all') {
                const event = AlphaGauntletService.qualifyToken(coin);
                if (event?.eventType !== feedFilters.eventType) return false;
            }

            const marketCap = parseCurrency(coin.cap);
            const liquidity = parseCurrency(coin.liquidity);
            const volume = parseCurrency(coin.volume24h);
            const priceChange = parseFloat(coin.h24.replace(/[%+,]/g, ''));

            const marketCapMin = parseFilterNumber(feedFilters.marketCapMin);
            const marketCapMax = parseFilterNumber(feedFilters.marketCapMax);
            const liquidityMin = parseFilterNumber(feedFilters.liquidityMin);
            const liquidityMax = parseFilterNumber(feedFilters.liquidityMax);
            const volumeMin = parseFilterNumber(feedFilters.volumeMin);
            const volumeMax = parseFilterNumber(feedFilters.volumeMax);
            const priceChangeMin = parseFilterNumber(feedFilters.priceChangeMin);
            const priceChangeMax = parseFilterNumber(feedFilters.priceChangeMax);

            if (marketCapMin !== null && marketCap < marketCapMin) return false;
            if (marketCapMax !== null && marketCap > marketCapMax) return false;
            if (liquidityMin !== null && liquidity < liquidityMin) return false;
            if (liquidityMax !== null && liquidity > liquidityMax) return false;
            if (volumeMin !== null && volume < volumeMin) return false;
            if (volumeMax !== null && volume > volumeMax) return false;
            if (priceChangeMin !== null && priceChange < priceChangeMin) return false;
            if (priceChangeMax !== null && priceChange > priceChangeMax) return false;

            return true;
        });
    }, [feedFilters, marketData]);

    useEffect(() => {
        setCurrentPage(1);
    }, [feedFilters]);

    const sortedData = useMemo(() => {
        let data = [...filteredData];
        if (!sortConfig) {
            data.sort((a, b) => {
                const aOrder = feedOrderState.orderByKey[getTokenKey(a)] ?? Number.MAX_SAFE_INTEGER;
                const bOrder = feedOrderState.orderByKey[getTokenKey(b)] ?? Number.MAX_SAFE_INTEGER;
                if (aOrder !== bOrder) return aOrder - bOrder;
                return getTokenKey(a).localeCompare(getTokenKey(b));
            });

            const limit = feedFilters.visibleCount === 'all' ? data.length : Number(feedFilters.visibleCount);
            return data.slice(0, Number.isFinite(limit) ? limit : data.length);
        }

        data = data.sort((a, b) => {
            const { key, direction } = sortConfig;

            const getValue = (item: MarketCoin) => {
                if (key === 'createdTimestamp') return item.createdTimestamp;
                // Handle change specifically to parse percentage
                if (key === 'change') return parseFloat(item.h24.replace(/[%+,]/g, ''));
                if (key === 'ticker') return item.ticker;
                if (key === 'price') return parseCurrency(item.price);
                if (key === 'cap') return parseCurrency(item.cap);
                if (key === 'liquidity') return parseCurrency(item.liquidity);
                if (key === 'volume') return parseCurrency(item.volume24h);
                if (key === 'dexBuys') return parseCurrency(item.dexBuys);
                if (key === 'dexSells') return parseCurrency(item.dexSells);
                if (key === 'netFlow') return parseCurrency(item.netFlow);
                if (key === 'sector') return getFeedSectorLabel(item);
                return 0;
            };

            const aVal = getValue(a);
            const bVal = getValue(b);

            if (typeof aVal === 'string' && typeof bVal === 'string') {
                return direction === 'asc' ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
            }
            return direction === 'asc' ? (aVal as number) - (bVal as number) : (bVal as number) - (aVal as number);
        });

        const limit = feedFilters.visibleCount === 'all' ? data.length : Number(feedFilters.visibleCount);
        return data.slice(0, Number.isFinite(limit) ? limit : data.length);
    }, [feedFilters.visibleCount, feedOrderState.orderByKey, filteredData, sortConfig]);

    useEffect(() => {
        if (typeof window === 'undefined') return;

        const snapshot = {
            generatedAt: Date.now(),
            total: sortedData.length,
            filters: feedFilters,
            sort: sortConfig,
            tokens: sortedData.slice(0, 500).map((coin) => ({
                ...(() => {
                    const sector = classifyTokenSector(coin);
                    return {
                        name: coin.name,
                        ticker: coin.ticker,
                        chain: coin.chain,
                        address: coin.address || '',
                        pairAddress: coin.pairAddress || '',
                        price: coin.price,
                        change24h: coin.h24,
                        marketCap: coin.cap,
                        dexVolume: coin.volume24h,
                        liquidity: coin.liquidity,
                        dexBuys: coin.dexBuys,
                        dexSells: coin.dexSells,
                        netFlow: coin.netFlow,
                        sector: sector.label,
                        sectorId: sector.primarySector,
                        sectorConfidence: sector.confidence,
                        secondarySectors: sector.secondarySectors,
                        sectorReasons: sector.reasons,
                        sectorSource: sector.source,
                        eventType: AlphaGauntletService.qualifyToken(coin)?.eventType || coin.signal || 'Unusual Activity'
                    };
                })()
            }))
        };

        (window as any).__ATLAIX_LIVE_ALPHA_FEED__ = snapshot;
        try {
            window.localStorage.setItem('atlaix-live-alpha-feed-snapshot-v1', JSON.stringify(snapshot));
        } catch {
            // This cache only helps the assistant answer current dashboard questions.
        }
    }, [feedFilters, sortConfig, sortedData]);

    useEffect(() => {
        const total = Math.max(1, Math.ceil(sortedData.length / itemsPerPage));
        if (currentPage > total) {
            setCurrentPage(total);
        }
    }, [currentPage, itemsPerPage, sortedData.length]);

    // AI Market Pulse Logic
    const formatCompactCurrency = (num: number) => {
        if (Math.abs(num) >= 1000000000) return (num / 1000000000).toFixed(1) + 'B';
        if (Math.abs(num) >= 1000000) return (num / 1000000).toFixed(1) + 'M';
        if (Math.abs(num) >= 1000) return (num / 1000).toFixed(1) + 'K';
        return num.toFixed(0);
    };

    const marketPulse = useMemo(() => {
        if (!marketData.length) return {
            sentimentScore: 50,
            sentimentLabel: "Neutral",
            topInflowToken: null,
            bestChain: "Ethereum",
            bestChainFlow: 0,
            totalOnchainVolume: 0,
            topChainVolumes: [],
            riskCount: 0
        };

        const alphaMarketData = marketData.filter(isLiveAlphaEligible);
        let bullishCount = 0;
        let totalProcessed = 0;
        let totalMarketVolume = 0;

        alphaMarketData.forEach(coin => {
            const h24 = parseFloat(coin.h24.replace(/[%+,]/g, ''));
            const volume = parseCurrency(coin.volume24h);
            if (h24 > 0) bullishCount++;
            totalMarketVolume += volume;
            totalProcessed++;
        });

        const bullRatio = totalProcessed > 0 ? bullishCount / totalProcessed : 0.5;
        const volumeFactor = Math.min(totalMarketVolume / 50000000, 1) * 10;

        let sentimentScore = Math.round((bullRatio * 80) + 10 + volumeFactor);
        if (sentimentScore > 98) sentimentScore = 98;
        if (sentimentScore < 5) sentimentScore = 5;

        let sentimentLabel = "Neutral";
        if (sentimentScore >= 75) sentimentLabel = "Extreme Greed";
        else if (sentimentScore >= 60) sentimentLabel = "Bullish";
        else if (sentimentScore <= 25) sentimentLabel = "Extreme Fear";
        else if (sentimentScore <= 40) sentimentLabel = "Bearish";

        const topToken = alphaMarketData.reduce<MarketCoin | null>((best, coin) => {
            if (!best) return coin;
            return parseCurrency(coin.netFlow) > parseCurrency(best.netFlow) ? coin : best;
        }, null);

        const chainStats: Record<string, number> = {};

        alphaMarketData.forEach(coin => {
            const chainKey = coin.chain.toLowerCase();
            const volume = parseCurrency(coin.volume24h);
            let normalizedChain = chainKey || 'unknown';

            if (chainKey.includes('sol')) normalizedChain = 'solana';
            else if (chainKey.includes('eth')) normalizedChain = 'ethereum';
            else if (chainKey.includes('bsc') || chainKey.includes('bnb')) normalizedChain = 'bsc';
            else if (chainKey.includes('base')) normalizedChain = 'base';

            chainStats[normalizedChain] = (chainStats[normalizedChain] || 0) + volume;
        });

        let bestChain = "Ethereum";
        let maxChainVol = -1;
        const formatChainLabel = (chain: string) => {
            if (chain === 'bsc') return 'BSC';
            return chain.charAt(0).toUpperCase() + chain.slice(1);
        };

        const localTopChainVolumes = Object.entries(chainStats)
            .map(([chain, volume]) => ({ chain: formatChainLabel(chain), volume }))
            .filter((item) => item.volume > 0)
            .sort((a, b) => b.volume - a.volume)
            .slice(0, 6);

        const topChainVolumes = chainDexVolumes.length
            ? chainDexVolumes
                .filter((item) => item.volume > 0)
                .sort((a, b) => b.volume - a.volume)
                .slice(0, 6)
            : localTopChainVolumes;

        Object.entries(chainStats).forEach(([chain, vol]) => {
            if (vol > maxChainVol) {
                maxChainVol = vol;
                bestChain = formatChainLabel(chain);
            }
        });

        return {
            sentimentScore,
            sentimentLabel,
            topInflowToken: topToken,
            bestChain,
            bestChainFlow: maxChainVol,
            totalOnchainVolume: topChainVolumes.reduce((total, item) => total + item.volume, 0) || totalMarketVolume,
            topChainVolumes,
            riskCount: 0
        };

    }, [chainDexVolumes, marketData]);

    const chainVolumeSlideCount = Math.max(1, marketPulse.topChainVolumes.length);

    useEffect(() => {
        if (chainVolumeSlideCount <= 1) return;

        const interval = window.setInterval(() => {
            setChainVolumeSlide((current) => (current + 1) % chainVolumeSlideCount);
        }, 3500);

        return () => window.clearInterval(interval);
    }, [chainVolumeSlideCount]);

    useEffect(() => {
        if (chainVolumeSlide >= chainVolumeSlideCount) {
            setChainVolumeSlide(0);
        }
    }, [chainVolumeSlide, chainVolumeSlideCount]);

    const visibleChainVolumePair = useMemo(() => {
        const volumes = marketPulse.topChainVolumes;
        if (!volumes.length) return [];

        const current = volumes[chainVolumeSlide % volumes.length];
        const next = volumes.length > 1 ? volumes[(chainVolumeSlide + 1) % volumes.length] : null;
        return next ? [current, next] : [current];
    }, [chainVolumeSlide, marketPulse.topChainVolumes]);

    const totalPages = Math.max(1, Math.ceil(sortedData.length / itemsPerPage));
    const paginatedData = useMemo(() => {
        const start = (currentPage - 1) * itemsPerPage;
        return sortedData.slice(start, start + itemsPerPage);
    }, [sortedData, currentPage, itemsPerPage]);

    const handleNextPage = () => { if (currentPage < totalPages) setCurrentPage(p => p + 1); };
    const handlePrevPage = () => { if (currentPage > 1) setCurrentPage(p => p - 1); };

    const maxAbsFlow = useMemo(() => {
        if (paginatedData.length === 0) return 0;
        return Math.max(...paginatedData.map(c => Math.abs(parseCurrency(c.netFlow))));
    }, [paginatedData]);

    const syncFeedHorizontalScroll = (source: HTMLDivElement | null) => {
        if (!source || syncingFeedScrollRef.current) return;

        syncingFeedScrollRef.current = true;
        const nextScrollLeft = source.scrollLeft;
        [feedTableScrollerRef.current, feedFixedHeaderRef.current].forEach((target) => {
            if (target && target !== source) {
                target.scrollLeft = nextScrollLeft;
            }
        });
        window.requestAnimationFrame(() => {
            syncingFeedScrollRef.current = false;
        });
    };

    const updateFeedScrollRailFrame = () => {
        const section = feedTableSectionRef.current;
        const tableScroller = feedTableScrollerRef.current;

        if (!section || !tableScroller) {
            setFeedScrollRailFrame((current) => current.active
                ? { active: false, headerActive: false, left: 0, width: 0, scrollWidth: 0 }
                : current
            );
            return;
        }

        const sectionRect = section.getBoundingClientRect();
        const scrollerRect = tableScroller.getBoundingClientRect();
        const canScrollX = tableScroller.scrollWidth > tableScroller.clientWidth;
        const nextFrame: FeedScrollRailFrame = {
            active: canScrollX && sectionRect.top < window.innerHeight - 56 && sectionRect.bottom > 88,
            headerActive: sectionRect.top < 0 && sectionRect.bottom > 120,
            left: Math.round(scrollerRect.left),
            width: Math.round(scrollerRect.width),
            scrollWidth: tableScroller.scrollWidth
        };

        setFeedScrollRailFrame((current) => (
            current.active === nextFrame.active &&
            current.headerActive === nextFrame.headerActive &&
            current.left === nextFrame.left &&
            current.width === nextFrame.width &&
            current.scrollWidth === nextFrame.scrollWidth
                ? current
                : nextFrame
        ));

        if (feedFixedHeaderRef.current) {
            feedFixedHeaderRef.current.scrollLeft = tableScroller.scrollLeft;
        }
    };

    const handleFeedTableHorizontalScroll = () => {
        syncFeedHorizontalScroll(feedTableScrollerRef.current);
    };

    const handleFeedFixedHeaderScroll = () => {
        syncFeedHorizontalScroll(feedFixedHeaderRef.current);
    };

    useEffect(() => {
        updateFeedScrollRailFrame();

        const tableScroller = feedTableScrollerRef.current;
        const pageScroller = tableScroller?.closest('main');
        const resizeObserver = typeof ResizeObserver !== 'undefined'
            ? new ResizeObserver(updateFeedScrollRailFrame)
            : null;

        if (resizeObserver && feedTableSectionRef.current) resizeObserver.observe(feedTableSectionRef.current);
        if (resizeObserver && tableScroller) resizeObserver.observe(tableScroller);

        window.addEventListener('resize', updateFeedScrollRailFrame);
        window.addEventListener('scroll', updateFeedScrollRailFrame, { passive: true });
        pageScroller?.addEventListener('scroll', updateFeedScrollRailFrame, { passive: true });

        return () => {
            resizeObserver?.disconnect();
            window.removeEventListener('resize', updateFeedScrollRailFrame);
            window.removeEventListener('scroll', updateFeedScrollRailFrame);
            pageScroller?.removeEventListener('scroll', updateFeedScrollRailFrame);
        };
    }, [currentPage, paginatedData.length, sortedData.length]);

    // Color logic for change percentage
    const getPercentColor = (val: string) => {
        const num = parseFloat(val.replace(/[%+,]/g, ''));
        // Using !important to override the specific CSS selector .data-table td
        if (num > 0) return '!text-primary-green';
        if (num < 0) return '!text-primary-red';
        return 'text-text-light';
    };

    const handleImageError = (e: React.SyntheticEvent<HTMLImageElement, Event>) => {
        e.currentTarget.src = 'https://cryptologos.cc/logos/bitcoin-btc-logo.png';
        e.currentTarget.style.filter = 'grayscale(100%) opacity(0.5)';
    };

    const getRenderTokenKey = (coin: MarketCoin, context: string) =>
        coin.pairAddress || coin.address || `${context}-${coin.chain}-${coin.ticker}-${coin.name}`;

    const getChainIcon = (chain: string) => {
        const normalized = (chain || '').toLowerCase();

        const icons: Record<string, string> = {
            bitcoin: `
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none">
                    <circle cx="12" cy="12" r="12" fill="#F7931A"/>
                    <path fill="#FFF" d="M17.288 10.291c.24-1.59-.974-2.45-2.64-3.03l.54-2.153-1.315-.33-.525 2.107c-.345-.087-.705-.167-1.064-.25l.526-2.127-1.32-.33-.54 2.165c-.285-.067-.565-.132-.84-.2l-1.815-.45-.35 1.407s.975.225.955.236c.535.136.63.486.615.766l-1.477 5.92c-.075.166-.24.406-.614.314.015.02-.96-.24-.96-.24l-.66 1.51 1.71.426.93.242-.54 2.19 1.32.327.54-2.17c.36.1.705.19 1.05.273l-.51 2.154 1.32.33.545-2.19c2.24.427 3.93.257 4.64-1.774.57-1.637-.03-2.58-1.217-3.196.854-.193 1.5-.76 1.68-1.93h.01zm-3.01 4.22c-.404 1.64-3.157.75-4.05.53l.72-2.9c.896.23 3.757.67 3.33 2.37zm.41-4.24c-.37 1.49-2.662.735-3.405.55l.654-2.64c.744.18 3.137.524 2.75 2.084v.006z"/>
                </svg>
            `,
            ethereum: `
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none">
                    <circle cx="12" cy="12" r="12" fill="#1E1E1E"/>
                    <path fill="#8A92B2" d="M12.056 2 4.69 12.223l7.365 4.354 7.365-4.35L12.056 2z"/>
                    <path fill="#62688F" d="M12.056 2v14.576l7.365-4.353L12.056 2z"/>
                    <path fill="#C1CCF0" d="M11.944 17.97 4.58 13.62 11.943 22l7.37-8.38-7.372 4.35h.003z"/>
                    <path fill="#8A92B2" d="M12.056 22v-4.03l7.365-4.35L12.056 22z"/>
                </svg>
            `,
            solana: `
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none">
                    <defs>
                        <linearGradient id="solana-g" x1="2" y1="2" x2="22" y2="22" gradientUnits="userSpaceOnUse">
                            <stop stop-color="#00FFA3"/>
                            <stop offset="1" stop-color="#DC1FFF"/>
                        </linearGradient>
                    </defs>
                    <circle cx="12" cy="12" r="12" fill="#0B0F14"/>
                    <path fill="url(#solana-g)" d="m18.876 16.031-2.962 3.139a.92.92 0 0 1-.673.285H4.46a.438.438 0 0 1-.321-.72l2.965-3.139A.92.92 0 0 1 7.758 15h10.782a.438.438 0 0 1 .336.72Zm-2.962-6.335a.92.92 0 0 0-.673-.286H4.46a.438.438 0 0 0-.321.72l2.965 3.139a.92.92 0 0 0 .654.286H18.54a.438.438 0 0 0 .336-.72l-2.962-3.139ZM4.46 6.723h10.781a.92.92 0 0 0 .673-.286l2.962-3.139a.438.438 0 0 0-.336-.72H7.758a.92.92 0 0 0-.654.286L4.139 5.003a.438.438 0 0 0 .321.72Z"/>
                </svg>
            `,
            bsc: `
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none">
                    <circle cx="12" cy="12" r="12" fill="#F3BA2F"/>
                    <path fill="#111827" d="M16.624 13.92 19.3415 16.6354 11.9885 23.9884 4.6355 16.6364 7.353 13.92l4.6355 4.6595 4.6356-4.6595Zm4.6366-4.6366L24 12l-2.7154 2.7164L18.5682 12l2.6924-2.7164Zm-9.272.001 2.7163 2.6914-2.7164 2.7174v-.001L9.2721 12l2.7164-2.7154Zm-9.2722-.001L5.4088 12l-2.6914 2.6924L0 12l2.7164-2.7164ZM11.9885.0115l7.353 7.329-2.7174 2.7154-4.6356-4.6356-4.6355 4.6595-2.7174-2.7154 7.353-7.353Z"/>
                </svg>
            `,
            xrp: `
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none">
                    <circle cx="12" cy="12" r="12" fill="#111827"/>
                    <path fill="#FFF" d="M5.52 5.955A3.521 3.521 0 0 0 1.996 9.48v.558A2.12 2.12 0 0 1 0 12.157l.03.562-.03.561a2.12 2.12 0 0 1 1.996 2.121v1.948a3.69 3.69 0 0 0 3.68 3.696v-1.123a2.56 2.56 0 0 1-2.557-2.558v-1.963a3.239 3.239 0 0 0-1.42-2.682 3.26 3.26 0 0 0 1.42-2.682V9.48A2.412 2.412 0 0 1 5.52 7.078h.437V5.955Zm12.538 0v1.123h.437a2.39 2.39 0 0 1 2.386 2.401v.558a3.26 3.26 0 0 0 1.42 2.682 3.239 3.239 0 0 0-1.42 2.682v1.963a2.56 2.56 0 0 1-2.557 2.558v1.123a3.69 3.69 0 0 0 3.68-3.696V15.4A2.12 2.12 0 0 1 24 13.281l-.03-.562.03-.561a2.12 2.12 0 0 1-1.996-2.12V9.478a3.518 3.518 0 0 0-3.509-3.524ZM6.253 10.478l3.478 3.259a3.393 3.393 0 0 0 4.553 0l3.478-3.26h-1.669l-2.65 2.464a2.133 2.133 0 0 1-2.886 0L7.922 10.478Zm5.606 4.884a3.36 3.36 0 0 0-2.128.886l-3.493 3.274h1.668l2.667-2.495a2.133 2.133 0 0 1 2.885 0l2.65 2.495h1.67l-3.494-3.274a3.36 3.36 0 0 0-2.425-.886Z"/>
                </svg>
            `,
            base: `
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none">
                    <rect x="4" y="4" width="16" height="16" rx="2" fill="#0052FF"/>
                </svg>
            `
        };

        const svg = icons[normalized] ?? icons.ethereum;
        return `data:image/svg+xml;utf8,${encodeURIComponent(svg.replace(/\\s+/g, ' ').trim())}`;
    };

    const SortHeader = ({
        label,
        sortKey,
        minWidth,
        className = ''
    }: {
        label: string;
        sortKey: string;
        minWidth?: string;
        className?: string;
    }) => {
        const active = sortConfig?.key === sortKey;
        const dir = sortConfig?.direction;

        return (
            <th
                className={`${sortKey === 'ticker' ? "sticky-col" : ""} ${className}`.trim()}
                style={minWidth ? { minWidth } : { minWidth: '100px' }}
            >
                <div
                    className={`flex items-center gap-1.5 cursor-pointer group select-none justify-start`}
                    onClick={() => handleSort(sortKey)}
                    title="Click header to cycle: High -> Low -> Neutral"
                >
                    <div className={`flex items-center gap-1 whitespace-nowrap ${active ? 'text-text-light' : ''}`}>
                        {label.includes('Volume') || label.includes('Liquidity') || label.includes('MCap') || label.includes('Buys') || label.includes('Sells') ? <Info size={12} className="text-text-dark" /> : null}
                        {label}
                    </div>
                    <div className="flex flex-col gap-[2px]">
                        {/* Up Arrow (Ascending - Low to High) */}
                        <svg width="8" height="5" viewBox="0 0 8 5" fill="currentColor"
                            className={`transition-colors cursor-pointer hover:text-primary-green ${active && dir === 'asc' ? 'text-primary-green' : 'text-text-dark'}`}
                            onClick={(e) => { e.stopPropagation(); handleSort(sortKey, 'asc'); }}>
                            <path d="M4 0L8 5H0L4 0Z" />
                        </svg>
                        {/* Down Arrow (Descending - High to Low) */}
                        <svg width="8" height="5" viewBox="0 0 8 5" fill="currentColor"
                            className={`transition-colors cursor-pointer hover:text-primary-green ${active && dir === 'desc' ? 'text-primary-green' : 'text-text-dark'}`}
                            onClick={(e) => { e.stopPropagation(); handleSort(sortKey, 'desc'); }}>
                            <path d="M4 5L0 0H8L4 5Z" />
                        </svg>
                    </div>
                </div>
            </th>
        );
    };

    const updateDraftFilter = (key: keyof FeedFilters, value: string) => {
        setDraftFeedFilters((current) => ({ ...current, [key]: value }));
    };

    const openFeedFilterMenu = () => {
        setDraftFeedFilters(feedFilters);
        setShowFeedFilters(true);
    };

    const resetFeedFilters = () => {
        setDraftFeedFilters(DEFAULT_FEED_FILTERS);
        setFeedFilters(DEFAULT_FEED_FILTERS);
        setShowFeedFilters(false);
        setCurrentPage(1);
    };

    const applyFeedFilters = () => {
        setFeedFilters(draftFeedFilters);
        setShowFeedFilters(false);
        setCurrentPage(1);
    };

    const aiMarketPulseSection = (
        <section className="min-w-0 relative z-20">
            <div className="mb-1.5 flex items-center gap-2 md:mb-2">
                <h3 className="text-sm font-black text-text-light">AI Market Pulse</h3>
                <span className="h-1.5 w-1.5 rounded-full bg-primary-green" />
            </div>
            <div className="grid grid-cols-2 gap-1.5 md:grid-cols-4 md:gap-2">
                <div className="green-corner-card min-h-[68px] rounded-lg border border-border bg-card px-2.5 py-2 shadow-sm md:min-h-[64px] md:px-3 md:py-2.5">
                    <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                            <div className="flex items-center gap-1.5 text-xs font-medium text-text-medium">
                                <Activity size={14} className="text-text-medium" />
                                <span className="truncate">AI Sentiment</span>
                            </div>
                            <div className="mt-1.5 flex items-center gap-2">
                                <div
                                    className={`h-5 w-5 rounded-full flex items-center justify-center text-[10px] font-extrabold shadow-[0_0_10px_rgba(38,211,86,0.2)] ${marketPulse.sentimentScore >= 50 ? 'bg-primary-green text-main' : 'bg-primary-red text-white'}`}
                                >
                                    {marketPulse.sentimentScore}
                                </div>
                                <span className="truncate text-sm font-black text-text-light">{marketPulse.sentimentLabel}</span>
                            </div>
                        </div>
                        <div className="hidden h-8 w-1 shrink-0 rounded-full bg-primary-green/70 sm:block" />
                    </div>
                </div>

                <div className="green-corner-card min-h-[68px] rounded-lg border border-border bg-card px-2.5 py-2 shadow-sm md:min-h-[64px] md:px-3 md:py-2.5">
                    <div className="flex min-w-0 items-start justify-between gap-3">
                        <div className="min-w-0">
                            <div className="flex items-center gap-1.5 text-xs font-medium text-text-medium">
                                <Zap size={14} className="text-text-medium" />
                                <span className="truncate">Smart Rotation</span>
                            </div>
                            <div className="mt-1.5 grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-1 md:flex md:flex-row md:items-center md:gap-2">
                                <span className="max-w-full truncate text-sm font-black text-text-light md:text-base">{marketPulse.bestChain}</span>
                                <span className="shrink-0 rounded bg-primary-green/10 px-1.5 py-0.5 text-[10px] font-black text-primary-green md:px-2 md:py-1">
                                    ${formatCompactCurrency(marketPulse.bestChainFlow)} Vol
                                </span>
                            </div>
                        </div>
                    </div>
                </div>

                <div
                    className="green-corner-card min-h-[68px] cursor-pointer rounded-lg border border-border bg-card px-2.5 py-2 shadow-sm transition-colors hover:border-text-medium md:min-h-[64px] md:px-3 md:py-2.5"
                    onClick={() => marketPulse.topInflowToken && handleTokenNavigation(marketPulse.topInflowToken)}
                >
                    <div className="flex min-w-0 items-start justify-between gap-3">
                        <div className="min-w-0">
                            <div className="flex items-center gap-1.5 text-xs font-medium text-text-medium">
                                <TrendingUp size={14} className="text-text-medium" />
                                <span className="truncate">Top Inflow</span>
                            </div>
                            <div className="mt-1.5 grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-1 md:flex md:flex-row md:items-center md:justify-between md:gap-3">
                                <span className="max-w-full truncate text-sm font-black text-text-light md:text-base">{marketPulse.topInflowToken?.ticker || "Scanning..."}</span>
                                <span className="shrink-0 text-xs font-black text-primary-green md:text-sm">
                                    {marketPulse.topInflowToken?.netFlow || "$0"}
                                </span>
                            </div>
                        </div>
                    </div>
                </div>

                <div className="green-corner-card min-h-[68px] overflow-hidden rounded-lg border border-border bg-card px-2.5 py-2 shadow-sm md:min-h-[64px] md:px-3 md:py-2.5">
                    <div className="flex h-full min-w-0 flex-col justify-center">
                        <div className="flex min-w-0 items-center gap-1.5 text-xs font-medium text-text-medium">
                            <BarChart3 size={14} className="text-text-medium" />
                            <span className="truncate">24h DEX Volume</span>
                        </div>
                        <div key={chainVolumeSlide} className="mt-1 grid min-w-0 gap-0.5 animate-fade-in md:mt-1.5 md:flex md:items-baseline md:gap-3">
                            <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-baseline gap-1 md:flex md:justify-start md:gap-2">
                                <span className="min-w-0 truncate text-sm font-black text-text-light md:text-base">
                                    {visibleChainVolumePair[0]?.chain || 'Scanning'}
                                </span>
                                <span className="shrink-0 text-xs font-black text-primary-green md:text-sm">
                                    ${formatCompactCurrency(visibleChainVolumePair[0]?.volume || 0)}
                                </span>
                            </div>
                            {visibleChainVolumePair[1] && (
                                <div className="hidden min-w-0 items-baseline gap-1.5 opacity-45 md:flex md:justify-start">
                                    <span className="min-w-0 truncate text-xs font-black text-text-light">
                                        {visibleChainVolumePair[1].chain}
                                    </span>
                                    <span className="shrink-0 font-mono text-[10px] font-bold text-primary-green md:text-[10px]">
                                        ${formatCompactCurrency(visibleChainVolumePair[1].volume)}
                                    </span>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </section>
    );

    return (
        <div className="flex flex-col gap-6 pb-16">
            {aiMarketPulseSection}

            <div className="relative z-40 flex justify-end">
                <div className="flex w-full flex-row items-center gap-2 flex-nowrap md:max-w-[560px]">
                    <div className="flex-1 bg-[#111315] border border-border rounded-lg flex items-center px-3 py-2 transition-all focus-within:border-primary-green/50 relative shadow-sm">
                        <input
                            type="text"
                            className="bg-transparent border-none text-text-light outline-none w-full text-sm placeholder-text-dark"
                            placeholder="search token name or past CA"
                            value={searchQuery}
                            onChange={(e) => {
                                setSearchQuery(e.target.value);
                                setShowSuggestions(true);
                            }}
                            onFocus={() => {
                                if (searchQuery.trim()) setShowSuggestions(true);
                            }}
                            onBlur={() => {
                                // Small delay to allow click event to register
                                setTimeout(() => setShowSuggestions(false), 200);
                            }}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                    handleSearchSubmit();
                                    setShowSuggestions(false);
                                }
                            }}
                        />

                        {/* Search Suggestions Dropdown */}
                        {showSuggestions && suggestions.length > 0 && (
                            <div className="absolute top-full left-0 right-0 mt-2 bg-card border border-border rounded-lg shadow-xl overflow-hidden z-[60]">
                                <div className="max-h-[300px] overflow-y-auto custom-scrollbar">
                                    {suggestions.map((coin) => (
                                        <div
                                            key={getRenderTokenKey(coin, 'suggestion')}
                                            className="flex items-center gap-3 px-4 py-3 hover:bg-card-hover cursor-pointer transition-colors border-b border-border/50 last:border-none"
                                            onClick={() => {
                                                handleTokenNavigation(coin);
                                                setSearchQuery('');
                                                setShowSuggestions(false);
                                            }}
                                        >
                                            <div className="w-10 h-10 rounded-full bg-main flex items-center justify-center shrink-0 border border-border">
                                                <img src={coin.img} alt={coin.ticker} loading="lazy" decoding="async" className="w-7 h-7 rounded-full object-cover" onError={handleImageError} />
                                            </div>

                                            {/* Left: Ticker & Name */}
                                            <div className="flex flex-col min-w-[100px]">
                                                <span className="font-bold text-base text-text-light">{coin.ticker}</span>
                                                <span className="text-xs text-text-dark truncate max-w-[120px]">{coin.name}</span>
                                            </div>

                                            {/* Center: Pair quality metrics */}
                                            <div className="grid grid-cols-2 gap-4 flex-1 px-3 border-r border-border/30 mr-3">
                                                <div className="flex flex-col items-end">
                                                    <span className="text-[10px] text-text-dark uppercase tracking-wider">MCap</span>
                                                    <span className="font-mono text-sm text-text-medium">{coin.cap}</span>
                                                </div>
                                                <div className="flex flex-col items-end">
                                                    <span className="text-[10px] text-text-dark uppercase tracking-wider">Liq</span>
                                                    <span className="font-mono text-sm font-bold text-primary-green">{coin.liquidity}</span>
                                                </div>
                                            </div>

                                            {/* Right: Price & Change */}
                                            <div className="flex flex-col items-end min-w-[80px]">
                                                <span className="font-mono text-sm text-text-light">{coin.price}</span>
                                                <span className={`text-xs font-bold ${getPercentColor(coin.h24)}`}>{coin.h24}</span>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
                        {searchError && (
                            <div className="absolute top-full mt-2 right-0 bg-primary-red/10 border border-primary-red text-primary-red text-xs px-3 py-1.5 rounded font-bold backdrop-blur-md z-50">
                                {searchError}
                            </div>
                        )}
                    </div>
                    <button
                        className="bg-primary-green text-main h-10 w-10 rounded-lg flex-shrink-0 flex items-center justify-center hover:bg-primary-green-darker transition-colors shadow-md"
                        onClick={handleSearchSubmit}
                        tabIndex={-1}
                    >
                        <Search size={18} strokeWidth={2.5} />
                    </button>
                </div>
            </div>

            <div ref={feedTableSectionRef} className="relative z-30 -mx-4 overflow-visible border-y border-border bg-card/80 shadow-sm xl:-mx-6">
                <div className="flex flex-col gap-3 px-4 py-4 md:px-6">
                    <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                        <div className="flex items-center justify-between gap-3">
                            <h3 className="font-bold text-lg flex items-center gap-2">
                                Live Alpha Feed
                                <span className="rounded border border-primary-green/20 bg-primary-green/10 px-2 py-0.5 text-xs font-bold text-primary-green">Live</span>
                            </h3>
                            <button
                                onClick={() => loadData(true)}
                                className="p-1.5 rounded-lg bg-card-hover border border-border hover:text-primary-green transition-all"
                                title="Force Refresh"
                            >
                                <RefreshCw size={14} className={isLoading ? 'animate-spin' : ''} />
                            </button>
                        </div>
                        <div className="flex items-center justify-between gap-3 md:justify-end">
                            <button
                                onClick={openFeedFilterMenu}
                                className={`inline-flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-lg border px-3 text-xs font-bold transition-colors sm:h-10 sm:gap-2 sm:px-4 sm:text-sm ${activeFilterCount > 0
                                    ? 'border-primary-green/50 bg-primary-green/10 text-primary-green'
                                    : 'border-border bg-card-hover text-text-light hover:border-text-medium'
                                    }`}
                            >
                                <SlidersHorizontal size={14} className="sm:h-4 sm:w-4" />
                                <span>Filters</span>
                                {activeFilterCount > 0 && (
                                    <span className="rounded-full bg-primary-green px-1.5 py-0.5 text-[10px] font-black text-main">
                                        {activeFilterCount}
                                    </span>
                                )}
                            </button>
                            <div className="flex min-w-0 flex-col items-end">
                                <div className="text-xs text-text-medium font-mono">
                                    Showing {paginatedData.length} of {sortedData.length}
                                </div>
                                <div className="text-[10px] text-text-dark mt-0.5 truncate">
                                    Last sync: {lastUpdated.toLocaleTimeString()}
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                <div className="live-alpha-table-shell custom-scrollbar min-h-[400px]">
                    {isLoading && marketData.length === 0 ? (
                        <div className="w-full h-[400px] flex items-center justify-center flex-col gap-3">
                            <div className="w-8 h-8 border-2 border-primary-green border-t-transparent rounded-full animate-spin"></div>
                            <div className="text-sm font-bold text-text-medium">Loading detected tokens...</div>
                        </div>
                    ) : (
                        <div
                            ref={feedTableScrollerRef}
                            onScroll={handleFeedTableHorizontalScroll}
                            className="live-alpha-table-viewport custom-scrollbar"
                        >
                            <table className="data-table live-alpha-table">
                                <thead>
                                    <tr>
                                        <SortHeader label="Chain Token" sortKey="ticker" minWidth="190px" />
                                        <th style={{ minWidth: '170px' }}>
                                            <div className="flex items-center gap-1.5 whitespace-nowrap text-left">
                                                <Info size={12} className="text-text-dark" />
                                                Event
                                            </div>
                                        </th>
                                        <SortHeader label="Price" sortKey="price" minWidth="110px" className="mobile-feed-secondary" />
                                        <SortHeader label="Chg 24h" sortKey="change" minWidth="100px" />
                                        <SortHeader label="MCap" sortKey="cap" minWidth="120px" className="mobile-feed-secondary" />
                                        <SortHeader label="DEX Volume" sortKey="volume" minWidth="130px" className="mobile-feed-secondary" />
                                        <SortHeader label="Liquidity" sortKey="liquidity" minWidth="120px" className="mobile-feed-secondary" />
                                        <SortHeader label="DEX Buys" sortKey="dexBuys" minWidth="105px" className="mobile-feed-secondary" />
                                        <SortHeader label="DEX Sells" sortKey="dexSells" minWidth="105px" className="mobile-feed-secondary" />
                                        <SortHeader label="DEX Flow" sortKey="netFlow" minWidth="150px" />
                                        <SortHeader label="Sector" sortKey="sector" minWidth="120px" />
                                    </tr>
                                </thead>
                                <tbody>
                                    {paginatedData.map((coin) => {
                                        const changeVal = getChange(coin);
                                        const flowVal = parseCurrency(coin.netFlow);
                                        const absFlow = Math.abs(flowVal);
                                        const flowPercent = maxAbsFlow > 0 ? (absFlow / maxAbsFlow) * 100 : 0;
                                        const isPositiveFlow = !coin.netFlow.includes('-');
                                        const flowColor = isPositiveFlow ? 'bg-primary-green' : 'bg-primary-red';
                                        const flowTextColor = isPositiveFlow ? 'text-primary-green' : 'text-primary-red';
                                        const event = AlphaGauntletService.qualifyToken(coin);
                                        const eventLabel = getFeedEventLabel(coin, event?.eventType);
                                        const sector = classifyTokenSector(coin);
                                        const sectorLabel = sector.label;
                                        const sectorTitle = `${sectorLabel}${sector.confidence === 'provider' ? ' (from provider metadata)' : ''}${sector.reasons.length ? ` - ${sector.reasons.join('; ')}` : ''}`;

                                        return (
                                            <tr
                                                key={getRenderTokenKey(coin, 'feed')}
                                                onClick={() => handleTokenNavigation(coin)}
                                                className="cursor-pointer hover:bg-card-hover/50 transition-colors"
                                            >
                                                <td className="sticky-col">
                                                    <div className="flex items-center gap-2 w-[170px] max-w-[170px] overflow-hidden">
                                                        <div className="w-5 h-5 flex items-center justify-center bg-card-hover rounded-full border border-border/50 shrink-0">
                                                            <img src={getChainIcon(coin.chain)} alt={coin.chain} loading="lazy" decoding="async" className="w-3.5 h-3.5 opacity-80" />
                                                        </div>
                                                        <img src={coin.img} alt={coin.name} width="24" height="24" loading="lazy" decoding="async" className="rounded-full shrink-0 object-cover bg-card" onError={handleImageError} />
                                                        <div className="flex flex-col min-w-0 flex-1">
                                                            <div className="font-bold text-xs leading-none text-text-light truncate" title={coin.ticker}>{coin.ticker}</div>
                                                            <div className="text-[9px] text-text-dark font-medium leading-tight mt-0.5 truncate" title={coin.name}>{coin.name}</div>
                                                        </div>
                                                    </div>
                                                </td>

                                                <td className="text-left">
                                                    <div className="flex w-[160px] max-w-[160px] items-start">
                                                        <span className={`inline-flex max-w-full items-center rounded-full border px-2 py-0.5 text-[10px] font-black uppercase leading-tight ${EVENT_BADGE_STYLE}`}>
                                                            <span className="truncate" title={eventLabel}>{eventLabel}</span>
                                                        </span>
                                                    </div>
                                                </td>

                                                <td className="mobile-feed-secondary font-mono text-xs text-text-light font-medium text-left">{coin.price}</td>
                                                <td className={`font-bold text-xs text-left ${getPercentColor(changeVal)}`}>{changeVal}</td>
                                                <td className="mobile-feed-secondary font-medium text-xs text-text-light text-left">{coin.cap}</td>
                                                <td className="mobile-feed-secondary text-xs font-medium text-text-light text-left">{coin.volume24h}</td>
                                                <td className="mobile-feed-secondary font-medium text-xs text-text-medium text-left">{coin.liquidity}</td>

                                                <td className="mobile-feed-secondary font-mono text-xs text-primary-green text-left">{coin.dexBuys}</td>
                                                <td className="mobile-feed-secondary font-mono text-xs text-primary-red text-left">{coin.dexSells}</td>

                                                <td className="text-left">
                                                    <div className="flex items-center justify-start gap-2 w-full">
                                                        <span className={`font-bold text-xs font-mono w-[60px] text-left ${flowTextColor}`}>
                                                            {coin.netFlow}
                                                        </span>
                                                        <div className="w-16 h-1.5 bg-card-hover rounded-full overflow-hidden shrink-0">
                                                            <div
                                                                className={`h-full rounded-full ${flowColor}`}
                                                                style={{ width: `${flowPercent}%` }}
                                                            />
                                                        </div>
                                                    </div>
                                                </td>

                                                <td className="text-left">
                                                    <span className="inline-flex max-w-[104px] items-center rounded-full border border-border bg-card-hover px-2 py-0.5 text-[10px] font-black uppercase leading-tight text-text-medium">
                                                        <span className="truncate" title={sectorTitle}>{sectorLabel}</span>
                                                    </span>
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>

                <div className="flex items-center justify-between border-t border-border px-4 py-4 md:px-6">
                    <button
                        onClick={handlePrevPage}
                        disabled={currentPage === 1}
                        className={`flex items-center gap-2 px-4 py-2 bg-transparent border border-border rounded-lg transition-all font-bold text-sm ${currentPage === 1
                            ? 'opacity-0 pointer-events-none'
                            : 'text-text-medium hover:border-text-medium hover:bg-card-hover hover:text-text-light cursor-pointer'
                            }`}
                    >
                        <ChevronLeft size={16} /> Previous
                    </button>

                    <span className="text-xs font-medium text-text-medium">
                        Page {currentPage} of {totalPages}
                    </span>

                    <button
                        onClick={handleNextPage}
                        disabled={currentPage >= totalPages}
                        className={`flex items-center gap-2 px-4 py-2 bg-transparent border border-border rounded-lg transition-all font-bold text-sm ${currentPage >= totalPages
                            ? 'opacity-50 cursor-not-allowed'
                            : 'text-text-medium hover:border-text-medium hover:bg-card-hover hover:text-text-light cursor-pointer'
                            }`}
                    >
                        Next Page <ChevronRight size={16} />
                    </button>
                </div>
                <div
                    ref={feedFixedHeaderRef}
                    onScroll={handleFeedFixedHeaderScroll}
                    className={`live-alpha-fixed-header custom-scrollbar ${feedScrollRailFrame.headerActive ? 'is-active' : ''}`}
                    style={{
                        left: `${feedScrollRailFrame.left}px`,
                        width: `${feedScrollRailFrame.width}px`
                    }}
                    aria-hidden={!feedScrollRailFrame.headerActive}
                >
                    <table className="data-table live-alpha-table">
                        <thead>
                            <tr>
                                <SortHeader label="Chain Token" sortKey="ticker" minWidth="190px" />
                                <th style={{ minWidth: '170px' }}>
                                    <div className="flex items-center gap-1.5 whitespace-nowrap text-left">
                                        <Info size={12} className="text-text-dark" />
                                        Event
                                    </div>
                                </th>
                                <SortHeader label="Price" sortKey="price" minWidth="110px" className="mobile-feed-secondary" />
                                <SortHeader label="Chg 24h" sortKey="change" minWidth="100px" />
                                <SortHeader label="MCap" sortKey="cap" minWidth="120px" className="mobile-feed-secondary" />
                                <SortHeader label="DEX Volume" sortKey="volume" minWidth="130px" className="mobile-feed-secondary" />
                                <SortHeader label="Liquidity" sortKey="liquidity" minWidth="120px" className="mobile-feed-secondary" />
                                <SortHeader label="DEX Buys" sortKey="dexBuys" minWidth="105px" className="mobile-feed-secondary" />
                                <SortHeader label="DEX Sells" sortKey="dexSells" minWidth="105px" className="mobile-feed-secondary" />
                                <SortHeader label="DEX Flow" sortKey="netFlow" minWidth="150px" />
                                <SortHeader label="Sector" sortKey="sector" minWidth="120px" />
                            </tr>
                        </thead>
                    </table>
                </div>
            </div>

            {showFeedFilters && (
                <div className="fixed inset-0 z-[1400] flex items-center justify-center bg-black/70 px-3 py-6 backdrop-blur-sm">
                    <div className="flex max-h-[92vh] w-full max-w-[760px] flex-col overflow-hidden rounded-2xl border border-border bg-[#1C1F22] shadow-[0_30px_120px_rgba(0,0,0,0.65)]">
                        <div className="flex items-center justify-between border-b border-border px-5 py-4 md:px-7">
                            <h2 className="text-xl font-black text-text-light">Filters</h2>
                            <button
                                onClick={() => setShowFeedFilters(false)}
                                className="rounded-lg p-2 text-text-medium transition-colors hover:bg-card-hover hover:text-text-light"
                                aria-label="Close filters"
                            >
                                <X size={22} />
                            </button>
                        </div>

                        <div className="custom-scrollbar flex-1 overflow-y-auto px-5 py-5 md:px-7">
                            <div className="flex flex-col gap-5">
                                <FilterSelect
                                    label="Visible Coin Range"
                                    value={draftFeedFilters.visibleCount}
                                    onChange={(value) => updateDraftFilter('visibleCount', value)}
                                    options={[
                                        { value: 'all', label: 'Show All' },
                                        { value: '20', label: 'Show 20' },
                                        { value: '50', label: 'Show 50' },
                                        { value: '100', label: 'Show 100' }
                                    ]}
                                />
                                <FilterSelect
                                    label="Networks"
                                    value={draftFeedFilters.chain}
                                    onChange={(value) => updateDraftFilter('chain', value)}
                                    options={[
                                        { value: 'all', label: 'All Networks' },
                                        ...chainOptions.map((chain) => ({ value: chain, label: chain }))
                                    ]}
                                />
                                <FilterSelect
                                    label="Sector"
                                    value={draftFeedFilters.sector}
                                    onChange={(value) => updateDraftFilter('sector', value)}
                                    options={SECTOR_FILTER_OPTIONS}
                                />
                                <FilterSelect
                                    label="Event Type"
                                    value={draftFeedFilters.eventType}
                                    onChange={(value) => updateDraftFilter('eventType', value)}
                                    options={EVENT_FILTER_OPTIONS}
                                />
                                <FilterRange label="Market Cap" minKey="marketCapMin" maxKey="marketCapMax" suffix="$" filters={draftFeedFilters} onChange={updateDraftFilter} />
                                <FilterRange label="Liquidity" minKey="liquidityMin" maxKey="liquidityMax" suffix="$" filters={draftFeedFilters} onChange={updateDraftFilter} />
                                <FilterRange label="Price Change (24h)" minKey="priceChangeMin" maxKey="priceChangeMax" suffix="%" filters={draftFeedFilters} onChange={updateDraftFilter} />
                                <FilterRange label="Volume (24h)" minKey="volumeMin" maxKey="volumeMax" suffix="$" filters={draftFeedFilters} onChange={updateDraftFilter} />
                            </div>
                        </div>

                        <div className="flex items-center justify-between gap-3 border-t border-border px-5 py-4 md:px-7">
                            <button
                                onClick={resetFeedFilters}
                                className="inline-flex items-center gap-2 rounded-lg px-2 py-2 text-sm font-black text-primary-green transition-colors hover:bg-primary-green/10"
                            >
                                <RotateCcw size={16} />
                                Reset
                            </button>
                            <button
                                onClick={applyFeedFilters}
                                className="rounded-lg bg-primary-green px-8 py-3 text-sm font-black text-main transition-colors hover:bg-primary-green-darker"
                            >
                                Apply
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div >
    );
};
