import React, { useState, useRef, useEffect, useMemo } from 'react';
import { Activity, Zap, TrendingUp, ShieldCheck, Search, ChevronRight, ChevronLeft, Info, RefreshCw } from 'lucide-react';
import { MarketCoin } from '../types';
import { DatabaseService } from '../services/DatabaseService';
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

    // Pagination State
    const [currentPage, setCurrentPage] = useState(1);
    const itemsPerPage = 20;

    // Sorting State - Default is null (Neutral/Algorithm Rank)
    const [sortConfig, setSortConfig] = useState<{ key: string; direction: 'asc' | 'desc' } | null>(null);

    // Data & System State
    const [marketData, setMarketData] = useState<MarketCoin[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [lastUpdated, setLastUpdated] = useState<Date>(new Date());

    // Load Data Function
    const loadData = async (force: boolean = false) => {
        if (marketData.length === 0 || force) setIsLoading(true);
        try {
            const response = await DatabaseService.getMarketData(force, false);
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
            loadData(false);
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
        if (searchQuery.trim()) {
            handleTokenNavigation(searchQuery);
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

    const sortedData = useMemo(() => {
        let data = [...marketData];
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
                return 0;
            };

            const aVal = getValue(a);
            const bVal = getValue(b);

            if (typeof aVal === 'string' && typeof bVal === 'string') {
                return direction === 'asc' ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
            }
            return direction === 'asc' ? (aVal as number) - (bVal as number) : (bVal as number) - (aVal as number);
        });
    }, [marketData, sortConfig]);

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

    const totalPages = Math.ceil(sortedData.length / itemsPerPage);
    const paginatedData = useMemo(() => {
        const start = (currentPage - 1) * itemsPerPage;
        return sortedData.slice(start, start + itemsPerPage);
    }, [sortedData, currentPage]);

    const handleNextPage = () => { if (currentPage < totalPages) setCurrentPage(p => p + 1); };
    const handlePrevPage = () => { if (currentPage > 1) setCurrentPage(p => p - 1); };

    const maxAbsFlow = useMemo(() => {
        if (marketData.length === 0) return 0;
        return Math.max(...marketData.map(c => Math.abs(parseCurrency(c.netFlow))));
    }, [marketData]);

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

    const getChainIcon = (chain: string) => {
        switch (chain) {
            case 'bitcoin': return 'https://cryptologos.cc/logos/bitcoin-btc-logo.png';
            case 'ethereum': return 'https://cryptologos.cc/logos/ethereum-eth-logo.png';
            case 'solana': return 'https://cryptologos.cc/logos/solana-sol-logo.png';
            case 'bsc': return 'https://cryptologos.cc/logos/bnb-bnb-logo.png';
            case 'base': return 'https://cryptologos.cc/logos/ethereum-eth-logo.png';
            case 'xrp': return 'https://cryptologos.cc/logos/xrp-xrp-logo.png';
            default: return 'https://via.placeholder.com/20';
        }
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
                    <div className="flex-1 bg-main border border-border rounded-lg flex items-center px-4 py-2.5 transition-all focus-within:border-primary-green/50">
                        <input
                            type="text"
                            className="bg-transparent border-none text-text-light outline-none w-full text-[0.95rem] placeholder-text-dark"
                            placeholder="search token name or past CA"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && handleSearchSubmit()}
                        />
                    </div>
                    <button
                        className="bg-primary-green text-main w-11 h-11 md:w-14 md:h-11 rounded-lg flex-shrink-0 flex items-center justify-center hover:bg-primary-green-darker transition-colors shadow-md"
                        onClick={handleSearchSubmit}
                    >
                        <Search size={20} strokeWidth={2.5} />
                    </button>
                </div>
            </div>

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
                                Showing {paginatedData.length} of {sortedData.length}
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
                            <div className="text-sm font-bold text-text-medium">Scanning for Alpha Signals...</div>
                        </div>
                    ) : (
                        <table className="data-table">
                            <thead>
                                <tr>
                                    <SortHeader label="Chain Token" sortKey="ticker" minWidth="150px" />
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
                                    const changeVal = getChange(coin);
                                    const flowVal = parseCurrency(coin.netFlow);
                                    const absFlow = Math.abs(flowVal);
                                    const flowPercent = maxAbsFlow > 0 ? (absFlow / maxAbsFlow) * 100 : 0;
                                    const isPositiveFlow = !coin.netFlow.includes('-');
                                    const flowColor = isPositiveFlow ? 'bg-primary-green' : 'bg-primary-red';
                                    const flowTextColor = isPositiveFlow ? 'text-primary-green' : 'text-primary-red';

                                    return (
                                        <tr
                                            key={coin.id}
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
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">

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
        </div>
    );
};