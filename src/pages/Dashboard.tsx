import React, { useState, useRef, useEffect, useMemo } from 'react';
import { Activity, Zap, TrendingUp, ShieldCheck, Search, ChevronRight, ChevronLeft, Info, RefreshCw } from 'lucide-react';
import { MarketCoin } from '../types';
import { DatabaseService } from '../services/DatabaseService';
import { AlphaGauntletService } from '../services/AlphaGauntletService';
import { useNavigate } from 'react-router-dom';

interface DashboardProps {
    // onTokenSelect prop removed as we use routing
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

export const Dashboard: React.FC<DashboardProps> = () => {
    const [timeFrame, setTimeFrame] = useState('12H');
    const [searchQuery, setSearchQuery] = useState('');
    const navigate = useNavigate();

    // Search Suggestions State
    const [suggestions, setSuggestions] = useState<MarketCoin[]>([]);
    const [showSuggestions, setShowSuggestions] = useState(false);


    // Pagination State
    const [currentPage, setCurrentPage] = useState(1);
    const itemsPerPage = 20;

    // Sorting State - Default is null (Neutral/Algorithm Rank)
    const [sortConfig, setSortConfig] = useState<{ key: string; direction: 'asc' | 'desc' } | null>(null);

    // Data & System State
    const [marketData, setMarketData] = useState<MarketCoin[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [lastUpdated, setLastUpdated] = useState<Date>(new Date());
    const [searchError, setSearchError] = useState<string>('');

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
            coin.ticker.toLowerCase().includes(query) ||
            coin.name.toLowerCase().includes(query) ||
            coin.address.toLowerCase().includes(query)
        ).slice(0, 5) : [];

        setSuggestions(localMatches);

        // 2. Debounced Global Search
        const timer = setTimeout(async () => {
            try {
                // Only search global if query is long enough to be meaningful
                if (query.length < 2) return;

                const globalResults = await DatabaseService.searchGlobalPairs(query);

                // Merge: Local first, then unique Global
                const existingAddrs = new Set(localMatches.map(c => c.address.toLowerCase()));
                const uniqueGlobal = globalResults.filter(c => !existingAddrs.has(c.address.toLowerCase()));

                // Combine
                let combined = [...localMatches, ...uniqueGlobal];

                // Sort by Market Cap (High to Low)
                combined.sort((a, b) => parseCurrency(b.cap) - parseCurrency(a.cap));

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
            if (!force && marketData.length === 0) {
                const cached = DatabaseService.getCachedMarketData();
                if (cached?.data.length) {
                    setMarketData(cached.data);
                    setLastUpdated(new Date());
                    setIsLoading(false);
                }

                const hydrated = await DatabaseService.getInitialMarketData();
                if (hydrated.data.length) {
                    setMarketData(hydrated.data);
                    setLastUpdated(new Date());
                    setIsLoading(false);
                }

                const response = await DatabaseService.getMarketData(true, false);
                setMarketData(response.data);
                setLastUpdated(new Date());
                return;
            }

            const response = await DatabaseService.getMarketData(force, partial);
            setMarketData(response.data);
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
        return () => clearInterval(interval);
    }, [timeFrame]);

    const handleTokenNavigation = (token: MarketCoin | string) => {
        const identifier = typeof token === 'string' ? token : (token.address || token.ticker);
        if (identifier) {
            navigate(`/token/${identifier}`);
        }
    };

    const handleSearchSubmit = () => {
        if (!searchQuery.trim()) return;

        if (suggestions.length > 0) {
            handleTokenNavigation(suggestions[0]);
        } else {
            setSearchError("Token not available");
        }
    };

    const getChange = (coin: MarketCoin) => coin.h24;

    const alphaEvents = useMemo(() => AlphaGauntletService.getOverviewEvents(marketData), [marketData]);
    const alphaEventMap = useMemo(() => {
        const events = new Map<string, typeof alphaEvents[number]>();
        alphaEvents.forEach(event => events.set(event.token.address || event.token.ticker, event));
        return events;
    }, [alphaEvents]);
    const overviewTokens = useMemo(() => alphaEvents.map(event => event.token), [alphaEvents]);

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

    const sortedData = useMemo(() => {
        let data = [...overviewTokens];
        if (!sortConfig) return data; // Neutral state returns data as-is (Hot Score sorted from service)

        return data.sort((a, b) => {
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
                if (key === 'alphaScore') return alphaEventMap.get(item.address || item.ticker)?.score || 0;
                return 0;
            };

            const aVal = getValue(a);
            const bVal = getValue(b);

            if (typeof aVal === 'string' && typeof bVal === 'string') {
                return direction === 'asc' ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
            }
            return direction === 'asc' ? (aVal as number) - (bVal as number) : (bVal as number) - (aVal as number);
        });
    }, [overviewTokens, sortConfig, alphaEventMap]);

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
            riskCount: 0
        };

        let bullishCount = 0;
        let totalProcessed = 0;
        let totalMarketVolume = 0;

        marketData.forEach(coin => {
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

        const tokensByFlow = [...marketData].sort((a, b) => parseCurrency(b.netFlow) - parseCurrency(a.netFlow));
        const topToken = tokensByFlow[0] || null;

        const chainStats: Record<string, number> = {
            'solana': 0, 'ethereum': 0, 'bsc': 0, 'base': 0
        };

        marketData.forEach(coin => {
            const chainKey = coin.chain.toLowerCase();
            const volume = parseCurrency(coin.volume24h);

            if (chainKey.includes('sol')) chainStats['solana'] += volume;
            else if (chainKey.includes('eth')) chainStats['ethereum'] += volume;
            else if (chainKey.includes('bsc') || chainKey.includes('bnb')) chainStats['bsc'] += volume;
            else if (chainKey.includes('base')) chainStats['base'] += volume;
        });

        let bestChain = "Ethereum";
        let maxChainVol = -1;

        Object.entries(chainStats).forEach(([chain, vol]) => {
            if (vol > maxChainVol) {
                maxChainVol = vol;
                bestChain = chain.charAt(0).toUpperCase() + chain.slice(1);
            }
        });

        if (bestChain === 'Bsc') bestChain = 'BSC';

        return {
            sentimentScore,
            sentimentLabel,
            topInflowToken: topToken,
            bestChain,
            bestChainFlow: maxChainVol,
            riskCount: 0
        };

    }, [marketData]);

    const totalPages = Math.max(1, Math.ceil(sortedData.length / itemsPerPage));
    const paginatedData = useMemo(() => {
        const start = (currentPage - 1) * itemsPerPage;
        return sortedData.slice(start, start + itemsPerPage);
    }, [sortedData, currentPage]);

    const handleNextPage = () => { if (currentPage < totalPages) setCurrentPage(p => p + 1); };
    const handlePrevPage = () => { if (currentPage > 1) setCurrentPage(p => p - 1); };

    const maxAbsFlow = useMemo(() => {
        if (overviewTokens.length === 0) return 0;
        return Math.max(...overviewTokens.map(c => Math.abs(parseCurrency(c.netFlow))));
    }, [overviewTokens]);

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

    const getTokenKey = (coin: MarketCoin, context: string) =>
        coin.address || coin.pairAddress || `${context}-${coin.chain}-${coin.ticker}-${coin.name}`;

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

    const SortHeader = ({ label, sortKey, minWidth }: { label: string, sortKey: string, minWidth?: string }) => {
        const active = sortConfig?.key === sortKey;
        const dir = sortConfig?.direction;

        return (
            <th
                className={sortKey === 'ticker' ? "sticky-col" : ""}
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

    return (
        <div className="flex flex-col gap-6 pb-16">
            <div className="bg-card border border-border rounded-xl p-3 md:p-5 shadow-lg relative z-40">
                <div className="flex flex-row items-center gap-2 w-full flex-nowrap">
                    <div className="flex-1 bg-main border border-border rounded-lg flex items-center px-4 py-2.5 transition-all focus-within:border-primary-green/50 relative">
                        <input
                            type="text"
                            className="bg-transparent border-none text-text-light outline-none w-full text-[0.95rem] placeholder-text-dark"
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
                                            key={getTokenKey(coin, 'suggestion')}
                                            className="flex items-center gap-3 px-4 py-3 hover:bg-card-hover cursor-pointer transition-colors border-b border-border/50 last:border-none"
                                            onClick={() => {
                                                handleTokenNavigation(coin);
                                                setSearchQuery('');
                                                setShowSuggestions(false);
                                            }}
                                        >
                                            <div className="w-10 h-10 rounded-full bg-main flex items-center justify-center shrink-0 border border-border">
                                                <img src={coin.img} alt={coin.ticker} className="w-7 h-7 rounded-full object-cover" onError={handleImageError} />
                                            </div>

                                            {/* Left: Ticker & Name */}
                                            <div className="flex flex-col min-w-[100px]">
                                                <span className="font-bold text-base text-text-light">{coin.ticker}</span>
                                                <span className="text-xs text-text-dark truncate max-w-[120px]">{coin.name}</span>
                                            </div>

                                            {/* Center: Market Cap */}
                                            <div className="flex flex-col items-end flex-1 px-3 border-r border-border/30 mr-3">
                                                <span className="text-[10px] text-text-dark uppercase tracking-wider">MCap</span>
                                                <span className="font-mono text-sm text-text-medium">{coin.cap}</span>
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
                        className="bg-primary-green text-main w-11 h-11 md:w-14 md:h-11 rounded-lg flex-shrink-0 flex items-center justify-center hover:bg-primary-green-darker transition-colors shadow-md"
                        onClick={handleSearchSubmit}
                        tabIndex={-1}
                    >
                        <Search size={20} strokeWidth={2.5} />
                    </button>
                </div>
            </div >

            <div className="bg-card border border-border rounded-xl p-3 md:p-5 overflow-visible shadow-sm relative z-30">
                <div className="flex flex-col gap-3 mb-4">
                    <div className="flex justify-between items-center">
                        <div className="flex items-center gap-3">
                            <h3 className="font-bold text-lg flex items-center gap-2">
                                Live Alpha Feed
                                <span className="relative flex h-2.5 w-2.5">
                                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary-green opacity-75"></span>
                                    <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-primary-green"></span>
                                </span>
                            </h3>
                            <button
                                onClick={() => loadData(true)}
                                className="p-1.5 rounded-lg bg-card-hover border border-border hover:text-primary-green transition-all"
                                title="Force Refresh"
                            >
                                <RefreshCw size={14} className={isLoading ? 'animate-spin' : ''} />
                            </button>
                        </div>
                        <div className="flex flex-col items-end">
                            <div className="text-xs text-text-medium font-mono">
                                Showing {paginatedData.length} of {sortedData.length} qualified
                            </div>
                            <div className="text-[10px] text-text-dark mt-0.5">
                                Last sync: {lastUpdated.toLocaleTimeString()}
                            </div>
                        </div>
                    </div>
                </div>

                <div className="overflow-x-auto overflow-y-auto max-h-[65vh] min-h-[400px] custom-scrollbar">
                    {isLoading && marketData.length === 0 ? (
                        <div className="w-full h-[400px] flex items-center justify-center flex-col gap-3">
                            <div className="w-8 h-8 border-2 border-primary-green border-t-transparent rounded-full animate-spin"></div>
                            <div className="text-sm font-bold text-text-medium">Running Alpha Gauntlet...</div>
                        </div>
                    ) : sortedData.length === 0 ? (
                        <div className="w-full h-[400px] flex items-center justify-center flex-col gap-2 text-center px-4">
                            <div className="text-sm font-bold text-text-light">No 80+ Alpha Gauntlet events yet</div>
                            <div className="text-xs text-text-medium max-w-md">
                                Tokens must pass market structure, activity triggers, classification, and scoring before reaching Overview.
                            </div>
                        </div>
                    ) : (
                        <table className="data-table">
                            <thead>
                                <tr>
                                    <SortHeader label="Chain Token" sortKey="ticker" minWidth="150px" />
                                    <SortHeader label="Alpha Score" sortKey="alphaScore" minWidth="105px" />
                                    <SortHeader label="Event" sortKey="ticker" minWidth="130px" />
                                    <SortHeader label="Price" sortKey="price" minWidth="100px" />
                                    <SortHeader label="Chg 24h" sortKey="change" minWidth="90px" />
                                    <SortHeader label="MCap" sortKey="cap" minWidth="100px" />
                                    <SortHeader label="DEX Volume" sortKey="volume" minWidth="110px" />
                                    <SortHeader label="Liquidity" sortKey="liquidity" minWidth="100px" />
                                    <SortHeader label="DEX Buys" sortKey="dexBuys" minWidth="90px" />
                                    <SortHeader label="DEX Sells" sortKey="dexSells" minWidth="90px" />
                                    <SortHeader label="DEX Flow" sortKey="netFlow" minWidth="140px" />
                                </tr>
                            </thead>
                            <tbody>
                                {paginatedData.map((coin) => {
                                    const alphaEvent = alphaEventMap.get(coin.address || coin.ticker);
                                    const changeVal = getChange(coin);
                                    const flowVal = parseCurrency(coin.netFlow);
                                    const absFlow = Math.abs(flowVal);
                                    const flowPercent = maxAbsFlow > 0 ? (absFlow / maxAbsFlow) * 100 : 0;
                                    const isPositiveFlow = !coin.netFlow.includes('-');
                                    const flowColor = isPositiveFlow ? 'bg-primary-green' : 'bg-primary-red';
                                    const flowTextColor = isPositiveFlow ? 'text-primary-green' : 'text-primary-red';

                                    return (
                                        <tr
                                            key={getTokenKey(coin, 'feed')}
                                            onClick={() => handleTokenNavigation(coin)}
                                            className="cursor-pointer hover:bg-card-hover/50 transition-colors"
                                        >
                                            <td className="sticky-col">
                                                <div className="flex items-center gap-2 w-[150px] max-w-[150px] overflow-hidden">
                                                    <div className="w-5 h-5 flex items-center justify-center bg-card-hover rounded-full border border-border/50 shrink-0">
                                                        <img src={getChainIcon(coin.chain)} alt={coin.chain} className="w-3.5 h-3.5 opacity-80" />
                                                    </div>
                                                    <img src={coin.img} alt={coin.name} width="24" height="24" className="rounded-full shrink-0 object-cover bg-card" onError={handleImageError} />
                                                    <div className="flex flex-col min-w-0 flex-1">
                                                        <div className="font-bold text-xs leading-none text-text-light truncate" title={coin.ticker}>{coin.ticker}</div>
                                                        <div className="text-[9px] text-text-dark font-medium leading-tight mt-0.5 truncate" title={coin.name}>{coin.name}</div>
                                                    </div>
                                                </div>
                                            </td>

                                            <td className="font-mono text-xs text-primary-green font-bold text-left">
                                                {alphaEvent?.score || 0}
                                            </td>
                                            <td className="text-left">
                                                <div className="flex flex-col gap-1 min-w-[120px]">
                                                    <span className="text-xs font-bold text-text-light">{alphaEvent?.eventType || 'Qualified'}</span>
                                                    <span className="text-[9px] text-text-dark truncate max-w-[120px]" title={alphaEvent?.triggers.join(', ')}>
                                                        {alphaEvent?.triggers[0] || coin.signal}
                                                    </span>
                                                </div>
                                            </td>
                                            <td className="font-mono text-xs text-text-light font-medium text-left">{coin.price}</td>
                                            <td className={`font-bold text-xs text-left ${getPercentColor(changeVal)}`}>{changeVal}</td>
                                            <td className="font-medium text-xs text-text-light text-left">{coin.cap}</td>
                                            <td className="text-xs font-medium text-text-light text-left">{coin.volume24h}</td>
                                            <td className="font-medium text-xs text-text-medium text-left">{coin.liquidity}</td>

                                            <td className="font-mono text-xs text-primary-green text-left">{coin.dexBuys}</td>
                                            <td className="font-mono text-xs text-primary-red text-left">{coin.dexSells}</td>

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
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    )}
                </div>

                <div className="mt-6 flex justify-between items-center border-t border-border pt-4">
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
            </div>

            <div className="w-full relative z-20">
                <h3 className="text-base font-bold mb-4 text-text-light">AI Market Pulse</h3>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 md:gap-4">

                    <div className="bg-card border border-border rounded-xl p-4 flex flex-col justify-center gap-1.5 shadow-sm">
                        <div className="flex items-center gap-1.5 text-xs font-medium text-text-medium mb-0.5 whitespace-nowrap overflow-hidden text-ellipsis">
                            <Activity size={14} className="text-text-medium" /> AI Sentiment
                        </div>
                        <div className="text-[10px] text-text-dark font-medium uppercase tracking-wide">Market Score</div>
                        <div className="text-base md:text-lg font-bold text-text-light flex items-center gap-2">
                            <div
                                className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-extrabold shadow-[0_0_10px_rgba(38,211,86,0.2)] ${marketPulse.sentimentScore >= 50 ? 'bg-primary-green text-main' : 'bg-primary-red text-white'}`}
                            >
                                {marketPulse.sentimentScore}
                            </div>
                            <span className="leading-tight text-sm truncate">{marketPulse.sentimentLabel}</span>
                        </div>
                    </div>

                    <div className="bg-card border border-border rounded-xl p-4 flex flex-col justify-center gap-1.5 shadow-sm">
                        <div className="flex items-center gap-1.5 text-xs font-medium text-text-medium mb-0.5 whitespace-nowrap overflow-hidden text-ellipsis">
                            <Zap size={14} className="text-text-medium" /> Smart Rotation
                        </div>
                        <div className="text-[10px] text-text-dark font-medium uppercase tracking-wide">Highest Vol Chain</div>
                        <div className="text-sm md:text-base font-bold text-text-light flex flex-wrap items-center gap-1.5">
                            {marketPulse.bestChain}
                            <span className="text-[9px] text-primary-green font-bold px-1.5 py-0.5 rounded bg-primary-green/10 whitespace-nowrap">
                                ${formatCompactCurrency(marketPulse.bestChainFlow)} Vol
                            </span>
                        </div>
                    </div>

                    <div className="bg-card border border-border rounded-xl p-4 flex flex-col justify-center gap-1.5 shadow-sm">
                        <div className="flex items-center gap-1.5 text-xs font-medium text-text-medium mb-0.5 whitespace-nowrap overflow-hidden text-ellipsis">
                            <TrendingUp size={14} className="text-text-medium" /> Top Inflow
                        </div>
                        <div className="flex flex-col xl:flex-row xl:justify-between xl:items-center w-full font-bold text-sm md:text-base gap-1 cursor-pointer hover:opacity-80 transition-opacity" onClick={() => marketPulse.topInflowToken && handleTokenNavigation(marketPulse.topInflowToken)}>
                            <span className="truncate">{marketPulse.topInflowToken?.ticker || "Scanning..."}</span>
                            <span className="text-primary-green text-xs md:text-sm whitespace-nowrap">
                                {marketPulse.topInflowToken?.netFlow || "$0"}
                            </span>
                        </div>
                        <div className="mt-0.5 flex justify-start">
                            <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${marketPulse.topInflowToken?.riskLevel === 'Low' ? 'bg-primary-green/10 text-primary-green' : 'bg-primary-yellow/10 text-primary-yellow'}`}>
                                {marketPulse.topInflowToken?.riskLevel || 'Low'} Risk
                            </span>
                        </div>
                    </div>

                    <div className="bg-card border border-border rounded-xl p-4 flex flex-col justify-center gap-1.5 shadow-sm">
                        <div className="flex items-center gap-1.5 text-xs font-medium text-text-medium mb-0.5 whitespace-nowrap overflow-hidden text-ellipsis">
                            <ShieldCheck size={14} className="text-primary-green" /> Risk Levels
                        </div>
                        <div className="text-sm md:text-lg font-bold text-primary-green">0 Critical Risks</div>
                        <button className="mt-1.5 w-full bg-primary-green/10 border border-primary-green/30 text-primary-green text-[9px] md:text-[10px] font-bold py-1.5 rounded hover:bg-primary-green hover:text-main transition-colors uppercase tracking-wide">
                            Check Alert
                        </button>
                    </div>
                </div>
            </div>
        </div >
    );
};
