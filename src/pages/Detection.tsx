// Route-level product screen for the Atlaix application.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronDown, RefreshCw, Search, ShieldAlert } from 'lucide-react';
import { AlphaGauntletEvent, AlphaGauntletEventType } from '../types';
import { AlphaGauntletService } from '../services/AlphaGauntletService';
import { DatabaseService } from '../services/DatabaseService';
import { ImpactfulActivityService } from '../services/ImpactfulActivityService';

type DetectionCategory = Exclude<AlphaGauntletEventType, 'Market Stress'>;

const CATEGORY_CONFIG: Array<{
    type: DetectionCategory;
    title: string;
    description: string;
}> = [
    {
        type: 'Accumulation',
        title: 'Accumulation',
        description: 'Tokens showing qualified buy pressure, volume expansion, or wallet build-up.'
    },
    {
        type: 'Distribution',
        title: 'Distribution',
        description: 'Tokens with qualified sell pressure or weakening holder-side activity.'
    },
    {
        type: 'Recovery',
        title: 'Recovery',
        description: 'Tokens rebounding after stress with enough activity to pass the detection gate.'
    },
    {
        type: 'Liquidity Event',
        title: 'Liquidity Event',
        description: 'Tokens admitted because liquidity structure changed in a meaningful way.'
    },
    {
        type: 'Unusual Activity',
        title: 'Unusual Activity',
        description: 'Tokens that qualified through abnormal activity without a more specific category.'
    }
];

const CHAIN_OPTIONS = ['All Chains', 'Solana', 'Ethereum', 'BNB Chain'];
const TABLE_BATCH_SIZE = 5;
const AUTO_REFRESH_INTERVAL_MS = 60000;
const AUTO_WATCH_LIMIT = 50;
const ONE_HOUR_MS = 60 * 60 * 1000;
const ONE_DAY_MS = 24 * ONE_HOUR_MS;

const parseCurrencyValue = (value: string | number | undefined) => {
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

const getTimeAgo = (timestamp: number) => {
    const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
    if (seconds < 60) return `${seconds}s ago`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    return `${hours}h ago`;
};

const normalizeChain = (chain: string) => {
    const lower = chain.toLowerCase();
    if (lower === 'bsc') return 'BNB Chain';
    if (lower === 'eth' || lower === 'ethereum') return 'Ethereum';
    if (lower === 'sol' || lower === 'solana') return 'Solana';
    return chain || 'Unknown';
};

const getChainLogo = (chain: string) => {
    const normalized = normalizeChain(chain);
    if (normalized === 'Solana') return 'https://cryptologos.cc/logos/solana-sol-logo.png';
    if (normalized === 'Ethereum') return 'https://cryptologos.cc/logos/ethereum-eth-logo.png';
    if (normalized === 'BNB Chain') return 'https://cryptologos.cc/logos/bnb-bnb-logo.png';
    return '';
};

const severityClass = (severity: AlphaGauntletEvent['severity']) => {
    if (severity === 'High') return 'text-primary-red border-primary-red/30 bg-primary-red/10';
    if (severity === 'Medium') return 'text-primary-yellow border-primary-yellow/30 bg-primary-yellow/10';
    return 'text-primary-green border-primary-green/30 bg-primary-green/10';
};

const INFRASTRUCTURE_TOKEN_SYMBOLS = new Set([
    'WETH',
    'WBTC',
    'WBNB',
    'WSOL',
    'WAVAX',
    'WMATIC',
    'WPOL',
    'WFTM',
    'WTRX',
    'WCORE',
    'WSEI',
    'WBERA',
    'WROSE',
    'USDT',
    'USDC',
    'DAI',
    'FDUSD',
    'TUSD',
    'USDD',
    'USDE',
    'USDS',
    'PYUSD',
    'FRAX',
    'LUSD',
    'GUSD',
    'BUSD'
]);

const INFRASTRUCTURE_NAME_PATTERNS = [
    /\bwrapped\b/i,
    /\bwormhole\b/i,
    /\bbridged\b/i,
    /\bbridge\b/i,
    /\bbinance-peg\b/i,
    /\bpegged\b/i,
    /\bstablecoin\b/i,
    /\busd coin\b/i,
    /\btether\b/i,
    /\bdai stablecoin\b/i,
    /\bliquidity pool\b/i,
    /\blp token\b/i
];

const isInfrastructureToken = (event: AlphaGauntletEvent) => {
    const symbol = event.token.ticker?.trim().toUpperCase() || '';
    const name = event.token.name?.trim() || '';

    return INFRASTRUCTURE_TOKEN_SYMBOLS.has(symbol) ||
        INFRASTRUCTURE_NAME_PATTERNS.some((pattern) => pattern.test(name));
};

export const Detection: React.FC = () => {
    const navigate = useNavigate();
    const watchedTokenKeysRef = useRef<Set<string>>(new Set());
    const [events, setEvents] = useState<AlphaGauntletEvent[]>([]);
    const [loading, setLoading] = useState(true);
    const [tokenQuery, setTokenQuery] = useState('');
    const [chain, setChain] = useState('All Chains');
    const [visibleRows, setVisibleRows] = useState<Record<string, number>>({});

    useEffect(() => {
        let cancelled = false;
        let hasDisplayedEvents = false;
        let refreshInFlight = false;

        const applyEvents = (nextEvents: AlphaGauntletEvent[]) => {
            if (cancelled || nextEvents.length === 0) return false;
            hasDisplayedEvents = true;
            setEvents(nextEvents);
            return true;
        };

        const hydrateStoredEvents = async () => {
            try {
                const storedEvents = await DatabaseService.fetchDetectionEvents();
                applyEvents(storedEvents);
            } catch (error) {
                console.error('Global detection cache hydration error', error);
            }
        };

        const loadEvents = async (force = false) => {
            if (refreshInFlight) return;
            refreshInFlight = true;

            try {
                if (!cancelled && !hasDisplayedEvents) setLoading(true);
                const response = await DatabaseService.getMarketData(force, false);
                const qualifiedEvents = AlphaGauntletService.getDetectionEvents(response.data);

                if (!cancelled) {
                    if (qualifiedEvents.length > 0) {
                        applyEvents(qualifiedEvents);
                        DatabaseService.syncDetectionEvents(qualifiedEvents);
                    } else if (!hasDisplayedEvents) {
                        await hydrateStoredEvents();
                    }
                }
            } catch (error) {
                console.error('Global detection feed error', error);
            } finally {
                refreshInFlight = false;
                if (!cancelled) setLoading(false);
            }
        };

        hydrateStoredEvents().finally(() => loadEvents(true));
        const interval = setInterval(() => loadEvents(true), AUTO_REFRESH_INTERVAL_MS);

        return () => {
            cancelled = true;
            clearInterval(interval);
        };
    }, []);

    const refreshEvents = async () => {
        try {
            setLoading(true);
            const response = await DatabaseService.getMarketData(true, false);
            const qualifiedEvents = AlphaGauntletService.getDetectionEvents(response.data);

            if (qualifiedEvents.length > 0) {
                setEvents(qualifiedEvents);
                DatabaseService.syncDetectionEvents(qualifiedEvents);
                return;
            }

            const storedEvents = await DatabaseService.fetchDetectionEvents();
            setEvents(storedEvents);
        } catch (error) {
            console.error('Global detection refresh error', error);
        } finally {
            setLoading(false);
        }
    };

    const qualifiedEvents = useMemo(() => {
        return events.filter((event) => {
            const eventChain = normalizeChain(event.token.chain);
            const matchesCategory = CATEGORY_CONFIG.some((category) => category.type === event.eventType);
            const matchesChain = chain === 'All Chains' || eventChain === chain;
            const isDiscoveryToken = !isInfrastructureToken(event);

            return matchesCategory && matchesChain && isDiscoveryToken;
        });
    }, [chain, events]);

    const eventsByCategory = useMemo(() => {
        const grouped = new Map<DetectionCategory, AlphaGauntletEvent[]>();
        CATEGORY_CONFIG.forEach((category) => grouped.set(category.type, []));

        qualifiedEvents.forEach((event) => {
            const category = event.eventType as DetectionCategory;
            grouped.get(category)?.push(event);
        });

        grouped.forEach((categoryEvents) => categoryEvents.sort((a, b) => b.score - a.score));
        return grouped;
    }, [qualifiedEvents]);

    useEffect(() => {
        setVisibleRows({});
    }, [chain]);

    const handleTokenSearch = (event: React.FormEvent) => {
        event.preventDefault();
        const trimmedQuery = tokenQuery.trim();
        if (!trimmedQuery) return;

        navigate(`/detection/token/${encodeURIComponent(trimmedQuery)}`);
    };

    const populatedCategories = CATEGORY_CONFIG
        .map((category) => ({
            ...category,
            events: eventsByCategory.get(category.type) || []
        }))
        .filter((category) => category.events.length > 0);

    useEffect(() => {
        const watchCandidates = qualifiedEvents
            .filter((event) => event.token.address)
            .sort((a, b) => b.score - a.score)
            .slice(0, AUTO_WATCH_LIMIT);

        watchCandidates.forEach((event) => {
            const tokenAddress = event.token.address;
            if (!tokenAddress) return;

            const watchKey = `${event.token.chain.toLowerCase()}:${tokenAddress.toLowerCase()}`;
            if (watchedTokenKeysRef.current.has(watchKey)) return;
            watchedTokenKeysRef.current.add(watchKey);

            ImpactfulActivityService.watchToken({
                chain: event.token.chain,
                tokenAddress,
                pairAddress: event.token.pairAddress,
                priceUsd: parseCurrencyValue(event.token.price),
                liquidityUsd: event.metrics?.liquidity || parseCurrencyValue(event.token.liquidity),
                ttlMs: event.severity === 'High' ? ONE_DAY_MS : ONE_HOUR_MS
            });
        });
    }, [qualifiedEvents]);

    return (
        <div className="flex flex-col gap-6 animate-fade-in pb-8">
            <section className="flex flex-col gap-5">
                <div className="flex items-center justify-between gap-4">
                    <h2 className="text-2xl md:text-3xl font-bold text-text-light">Paste A Contract Address To Run A Token Scan</h2>
                    <button
                        onClick={refreshEvents}
                        className="w-fit flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-2 text-sm font-bold text-text-light hover:border-primary-green/50 hover:text-primary-green transition-colors"
                    >
                        <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
                        Refresh
                    </button>
                </div>

                <div className="flex flex-col lg:flex-row gap-3 rounded-xl border border-border bg-card p-4">
                    <form onSubmit={handleTokenSearch} className="flex flex-1 gap-3 min-w-0">
                    <div className="relative flex-1 min-w-0">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-text-medium" size={18} />
                        <input
                            value={tokenQuery}
                            onChange={(event) => setTokenQuery(event.target.value)}
                            placeholder="Search any token, symbol, or address..."
                            className="w-full rounded-lg border border-border bg-[#111315] py-2.5 pl-10 pr-4 text-sm text-text-light placeholder-text-dark outline-none focus:border-primary-green/50"
                        />
                    </div>
                    <button
                        type="submit"
                        className="shrink-0 rounded-lg bg-primary-green px-5 py-2.5 text-sm font-black text-main hover:bg-primary-green-darker transition-colors"
                    >
                        Search
                    </button>
                    </form>

                    <div className="grid grid-cols-1 gap-3 lg:flex">
                        <label className="relative">
                            <select
                                value={chain}
                                onChange={(event) => setChain(event.target.value)}
                                className="appearance-none w-full lg:w-[170px] rounded-lg border border-border bg-[#111315] px-3 py-2.5 pr-9 text-sm font-bold text-text-light outline-none focus:border-primary-green/50"
                            >
                                {CHAIN_OPTIONS.map((option) => <option key={option}>{option}</option>)}
                            </select>
                            <ChevronDown className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-text-medium" size={16} />
                        </label>
                    </div>
                </div>
            </section>

            <section className="grid grid-cols-1 2xl:grid-cols-2 gap-5">
                {loading && events.length === 0 ? (
                    <div className="rounded-xl border border-border bg-card p-8 text-center 2xl:col-span-2">
                        <RefreshCw className="mx-auto mb-3 animate-spin text-primary-green" size={28} />
                        <div className="text-sm font-bold text-text-light">Running detection engine qualification...</div>
                    </div>
                ) : populatedCategories.length === 0 ? (
                    <div className="rounded-xl border border-border bg-card p-8 text-center 2xl:col-span-2">
                        <div className="text-sm font-bold text-text-light">No admitted tokens match the active filters</div>
                        <div className="mt-1 text-xs text-text-medium">Tables will appear when a token qualifies for a detection category.</div>
                    </div>
                ) : populatedCategories.map((category) => {
                    return (
                        <div key={category.type} className="rounded-xl border border-border bg-card overflow-hidden">
                            <div className="border-b border-border px-5 py-4">
                                <div>
                                    <h3 className="text-lg font-bold text-text-light">{category.title}</h3>
                                    <p className="mt-1 text-sm text-text-medium">{category.description}</p>
                                </div>
                            </div>

                            <div className="overflow-hidden">
                                <table className="w-full table-fixed text-left">
                                    <colgroup>
                                        <col className="w-[64px]" />
                                        <col />
                                        <col className="w-[76px]" />
                                        <col className="w-[112px]" />
                                        <col className="w-[92px]" />
                                    </colgroup>
                                    <thead className="bg-[#111315] text-[11px] uppercase tracking-wide text-text-medium">
                                        <tr>
                                            <th className="px-4 py-3 font-bold">Chain</th>
                                            <th className="px-4 py-3 font-bold">Token</th>
                                            <th className="px-4 py-3 font-bold">Score</th>
                                            <th className="px-4 py-3 font-bold">Severity</th>
                                            <th className="px-4 py-3 font-bold text-right">Detected</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-border/70">
                                        {category.events.slice(0, visibleRows[category.type] || TABLE_BATCH_SIZE).map((event) => (
                                            <tr
                                                key={`${event.token.address || event.token.ticker}-${event.eventType}`}
                                                onClick={() => navigate(`/detection/token/${encodeURIComponent(event.token.address || event.token.ticker)}?source=detection&severity=${encodeURIComponent(event.severity)}&eventType=${encodeURIComponent(event.eventType)}&score=${encodeURIComponent(String(event.score))}&detectedAt=${encodeURIComponent(String(event.detectedAt))}`)}
                                                className="cursor-pointer hover:bg-[#1C1F22] transition-colors"
                                            >
                                                <td className="px-4 py-4">
                                                    {getChainLogo(event.token.chain) ? (
                                                        <img
                                                            src={getChainLogo(event.token.chain)}
                                                            alt={normalizeChain(event.token.chain)}
                                                            title={normalizeChain(event.token.chain)}
                                                            className="h-7 w-7 rounded-full border border-border bg-[#111315] object-cover p-0.5"
                                                        />
                                                    ) : (
                                                        <span
                                                            title={normalizeChain(event.token.chain)}
                                                            className="flex h-7 w-7 items-center justify-center rounded-full border border-border bg-[#111315] text-[10px] font-bold text-text-medium"
                                                        >
                                                            ?
                                                        </span>
                                                    )}
                                                </td>
                                                <td className="px-4 py-4 min-w-0">
                                                    <div className="flex items-center gap-3 min-w-0">
                                                        <img
                                                            src={event.token.img}
                                                            alt={event.token.ticker}
                                                            className="h-8 w-8 shrink-0 rounded-full border border-border bg-[#111315] object-cover"
                                                            onError={(imageEvent) => { imageEvent.currentTarget.style.display = 'none'; }}
                                                        />
                                                        <div className="min-w-0 max-w-[150px]">
                                                            <div className="truncate font-bold text-text-light" title={event.token.ticker}>{event.token.ticker}</div>
                                                            <div className="truncate text-xs text-text-medium" title={event.token.name}>{event.token.name}</div>
                                                        </div>
                                                    </div>
                                                </td>
                                                <td className="px-4 py-4">
                                                    <span className="font-mono text-sm font-bold text-primary-green">{event.score}</span>
                                                </td>
                                                <td className="px-4 py-4">
                                                    <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-bold ${severityClass(event.severity)}`}>
                                                        {event.severity}
                                                    </span>
                                                </td>
                                                <td className="px-4 py-4 text-right text-xs font-mono text-text-medium">{getTimeAgo(event.detectedAt)}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                            {category.events.length > (visibleRows[category.type] || TABLE_BATCH_SIZE) && (
                                <div className="border-t border-border bg-[#111315]/60 px-5 py-3">
                                    <button
                                        onClick={() => {
                                            setVisibleRows((current) => ({
                                                ...current,
                                                [category.type]: (current[category.type] || TABLE_BATCH_SIZE) + TABLE_BATCH_SIZE
                                            }));
                                        }}
                                        className="w-full rounded-lg border border-dashed border-border py-2 text-xs font-bold text-text-medium hover:border-primary-green/50 hover:text-primary-green transition-colors"
                                    >
                                        See More
                                    </button>
                                </div>
                            )}
                        </div>
                    );
                })}
            </section>
        </div>
    );
};
