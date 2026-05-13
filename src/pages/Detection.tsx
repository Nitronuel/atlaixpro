// Route-level product screen for the Atlaix application.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Check, ChevronDown, Filter, RefreshCw, Search, ShieldAlert } from 'lucide-react';
import { AlphaGauntletEvent } from '../types';
import { AlphaGauntletService } from '../services/AlphaGauntletService';
import { DatabaseService } from '../services/DatabaseService';
import { ImpactfulActivityService } from '../services/ImpactfulActivityService';
import { enrichDetectionEvent } from '../services/detection/DetectionEventPresenter';
import { buildDetectionTimelineCards } from '../services/detection/DetectionTimelinePresenter';
import { isExcludedAlphaToken } from '../utils/tokenFilters';

type GlobalTokenEvent = {
    id: string;
    source: AlphaGauntletEvent;
    title: string;
    description: string;
    usdValue: number;
    detectedAt: number;
    sentiment: 'bullish' | 'bearish' | 'neutral';
};

const CHAIN_OPTIONS = ['All Chains', 'Solana', 'Ethereum', 'BNB Chain'];
const AUTO_REFRESH_INTERVAL_MS = 60000;
const FULL_DISCOVERY_REFRESH_INTERVAL_MS = 5 * 60 * 1000;
const AUTO_WATCH_LIMIT = 50;
const ONE_HOUR_MS = 60 * 60 * 1000;
const ONE_DAY_MS = 24 * ONE_HOUR_MS;
const GLOBAL_EVENTS_CACHE_KEY = 'atlaix-global-events-cache';
const GLOBAL_EVENTS_CACHE_MAX_AGE_MS = 2 * 60 * 1000;

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

const eventSentimentAccentClass = (sentiment: GlobalTokenEvent['sentiment']) => {
    if (sentiment === 'bullish') return 'bg-primary-green';
    if (sentiment === 'bearish') return 'bg-primary-red';
    return 'bg-primary-yellow';
};

const eventSentimentLabelClass = (sentiment: GlobalTokenEvent['sentiment']) => {
    if (sentiment === 'bullish') return 'text-primary-green border-primary-green/30 bg-primary-green/10';
    if (sentiment === 'bearish') return 'text-primary-red border-primary-red/30 bg-primary-red/10';
    return 'text-primary-yellow border-primary-yellow/30 bg-primary-yellow/10';
};

const formatCompactUsd = (value: number) => {
    if (!Number.isFinite(value) || value <= 0) return '$0';
    return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
        notation: 'compact',
        maximumFractionDigits: 2
    }).format(value);
};

const buildGlobalTokenEvents = (event: AlphaGauntletEvent): GlobalTokenEvent[] => {
    const events = buildDetectionTimelineCards(event).map((card) => ({ ...card, source: event }));
    const valueBasis = Math.max(
        event.metrics.volume24h || 0,
        event.metrics.liquidity || 0,
        (event.metrics.marketCap || 0) * 0.01
    );
    const fallbackSentiment =
        event.eventType === 'Accumulation' || event.eventType === 'Recovery'
            ? 'bullish'
            : event.eventType === 'Distribution' || event.eventType === 'Market Stress'
                ? 'bearish'
                : 'neutral';

    return events.length ? events : [{
        id: `${getDetectionEventKey(event)}:activity`,
        source: event,
        title: fallbackSentiment === 'neutral' ? 'Activity Signal' : `${event.eventType} Signal`,
        description: `${event.token.ticker} remains active in global detection with a ${event.score} activity score.`,
        usdValue: valueBasis,
        detectedAt: event.detectedAt,
        sentiment: fallbackSentiment
    }];
};

const canUseLocalStorage = () => typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';

const getCachedGlobalEvents = (): GlobalTokenEvent[] => {
    if (!canUseLocalStorage()) return [];

    try {
        const raw = window.localStorage.getItem(GLOBAL_EVENTS_CACHE_KEY);
        if (!raw) return [];

        const parsed = JSON.parse(raw) as { data?: GlobalTokenEvent[]; timestamp?: number };
        if (!Array.isArray(parsed.data) || typeof parsed.timestamp !== 'number') return [];
        if (Date.now() - parsed.timestamp > GLOBAL_EVENTS_CACHE_MAX_AGE_MS) return [];

        return parsed.data;
    } catch {
        return [];
    }
};

const setCachedGlobalEvents = (events: GlobalTokenEvent[]) => {
    if (!canUseLocalStorage() || events.length === 0) return;

    try {
        window.localStorage.setItem(GLOBAL_EVENTS_CACHE_KEY, JSON.stringify({
            data: events,
            timestamp: Date.now()
        }));
    } catch {
        // Ignore storage quota and privacy mode errors.
    }
};

const isInfrastructureToken = (event: AlphaGauntletEvent) => {
    return isExcludedAlphaToken(event.token);
};

const getDetectionEventKey = (event: AlphaGauntletEvent) => {
    const tokenKey = event.token.address || event.token.ticker;
    return [
        event.token.chain.toLowerCase(),
        tokenKey.toLowerCase(),
        event.eventType.toLowerCase()
    ].join(':');
};

export const Detection: React.FC = () => {
    const navigate = useNavigate();
    const watchedTokenKeysRef = useRef<Set<string>>(new Set());
    const activeDetectedAtRef = useRef<Map<string, number>>(new Map());
    const eventFilterRef = useRef<HTMLDivElement | null>(null);
    const [events, setEvents] = useState<AlphaGauntletEvent[]>([]);
    const [loading, setLoading] = useState(true);
    const [tokenQuery, setTokenQuery] = useState('');
    const [chain, setChain] = useState('All Chains');
    const [eventFilterOpen, setEventFilterOpen] = useState(false);
    const [selectedEventTypes, setSelectedEventTypes] = useState<string[]>([]);
    const [cachedGlobalEvents, setCachedGlobalEventsState] = useState<GlobalTokenEvent[]>(() => getCachedGlobalEvents());

    const stabilizeEvents = (nextEvents: AlphaGauntletEvent[], replaceActiveSet = true) => {
        const activeKeys = new Set<string>();

        const stableEvents = nextEvents.map((event) => {
            const key = getDetectionEventKey(event);
            activeKeys.add(key);

            const detectedAt = activeDetectedAtRef.current.get(key) || event.detectedAt;
            activeDetectedAtRef.current.set(key, detectedAt);

            return enrichDetectionEvent({
                ...event,
                detectedAt
            });
        });

        if (replaceActiveSet) {
            activeDetectedAtRef.current.forEach((_, key) => {
                if (!activeKeys.has(key)) {
                    activeDetectedAtRef.current.delete(key);
                }
            });
        }

        return stableEvents;
    };

    useEffect(() => {
        let cancelled = false;
        let hasDisplayedEvents = false;
        let refreshInFlight = false;
        let lastFullRefreshAt = 0;

        const applyEvents = (nextEvents: AlphaGauntletEvent[], replaceActiveSet = true) => {
            if (cancelled || nextEvents.length === 0) return null;
            hasDisplayedEvents = true;
            const stableEvents = stabilizeEvents(nextEvents, replaceActiveSet);
            setEvents(stableEvents);
            return stableEvents;
        };

        const hydrateStoredEvents = async () => {
            try {
                const serverEvents = await DatabaseService.fetchServerDetectionFeed();
                if (serverEvents.length) {
                    applyEvents(serverEvents, false);
                    return true;
                }

                const cachedEvents = DatabaseService.getCachedDetectionEvents();
                applyEvents(cachedEvents, false);

                const storedEvents = await DatabaseService.fetchDetectionEvents();
                applyEvents(storedEvents, false);
                return storedEvents.length > 0 || cachedEvents.length > 0;
            } catch (error) {
                console.error('Global detection cache hydration error', error);
                return false;
            }
        };

        const loadEvents = async (force = false) => {
            if (refreshInFlight) return;
            refreshInFlight = true;
            if (force) lastFullRefreshAt = Date.now();

            try {
                if (!cancelled && !hasDisplayedEvents) setLoading(true);
                const serverEvents = await DatabaseService.fetchServerDetectionFeed();
                if (!cancelled && serverEvents.length > 0) {
                    applyEvents(serverEvents, false);
                    return;
                }

                const response = await DatabaseService.getMarketData(force, !force);
                const qualifiedEvents = AlphaGauntletService.getDetectionEvents(response.data);

                if (!cancelled) {
                    if (qualifiedEvents.length > 0) {
                        const stableEvents = applyEvents(qualifiedEvents);
                        if (stableEvents) {
                            DatabaseService.syncDetectionEvents(stableEvents);
                        }
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

        hydrateStoredEvents().then((hydrated) => {
            if (!hydrated) {
                loadEvents(true);
            }
        });
        const interval = setInterval(() => {
            const shouldRunFullDiscovery = Date.now() - lastFullRefreshAt >= FULL_DISCOVERY_REFRESH_INTERVAL_MS;
            loadEvents(shouldRunFullDiscovery);
        }, AUTO_REFRESH_INTERVAL_MS);

        return () => {
            cancelled = true;
            clearInterval(interval);
        };
    }, []);

    const refreshEvents = async () => {
        try {
            setLoading(true);
            await DatabaseService.runServerDetection();
            const serverEvents = await DatabaseService.fetchServerDetectionFeed();
            if (serverEvents.length > 0) {
                setEvents(stabilizeEvents(serverEvents, false));
                return;
            }

            const response = await DatabaseService.getMarketData(true, false);
            const qualifiedEvents = AlphaGauntletService.getDetectionEvents(response.data);

            if (qualifiedEvents.length > 0) {
                const stableEvents = stabilizeEvents(qualifiedEvents);
                setEvents(stableEvents);
                DatabaseService.syncDetectionEvents(stableEvents);
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
            const matchesChain = chain === 'All Chains' || eventChain === chain;
            const isDiscoveryToken = !isInfrastructureToken(event);

            return matchesChain && isDiscoveryToken;
        });
    }, [chain, events]);

    const handleTokenSearch = (event: React.FormEvent) => {
        event.preventDefault();
        const trimmedQuery = tokenQuery.trim();
        if (!trimmedQuery) return;

        navigate(`/detection/token/${encodeURIComponent(trimmedQuery)}`);
    };

    const recentGlobalEvents = useMemo(() => {
        return [...qualifiedEvents]
            .flatMap(buildGlobalTokenEvents)
            .sort((a, b) => {
                if (b.detectedAt !== a.detectedAt) return b.detectedAt - a.detectedAt;
                return b.source.score - a.source.score;
            })
            .slice(0, 36);
    }, [qualifiedEvents]);

    useEffect(() => {
        if (recentGlobalEvents.length === 0) return;
        setCachedGlobalEvents(recentGlobalEvents);
        setCachedGlobalEventsState(recentGlobalEvents);
    }, [recentGlobalEvents]);

    const globalEventsToRender = recentGlobalEvents.length > 0 ? recentGlobalEvents : cachedGlobalEvents;
    const eventTypeOptions = useMemo(() => {
        return (Array.from(new Set(globalEventsToRender.map((globalEvent) => String(globalEvent.title || '')))) as string[])
            .filter(Boolean)
            .sort((a, b) => a.localeCompare(b));
    }, [globalEventsToRender]);
    const activeEventTypeSet = useMemo(() => new Set(selectedEventTypes), [selectedEventTypes]);
    const visibleGlobalEvents = useMemo(() => {
        if (activeEventTypeSet.size === 0) return globalEventsToRender;
        return globalEventsToRender.filter((globalEvent) => activeEventTypeSet.has(globalEvent.title));
    }, [activeEventTypeSet, globalEventsToRender]);
    const activeFilterCount = selectedEventTypes.length;

    useEffect(() => {
        if (eventTypeOptions.length === 0 || selectedEventTypes.length === 0) return;
        const optionSet = new Set(eventTypeOptions);
        const validSelections = selectedEventTypes.filter((eventType) => optionSet.has(eventType));
        if (validSelections.length !== selectedEventTypes.length) {
            setSelectedEventTypes(validSelections);
        }
    }, [eventTypeOptions, selectedEventTypes]);

    useEffect(() => {
        if (!eventFilterOpen) return;

        const handleClickOutside = (event: MouseEvent) => {
            if (!eventFilterRef.current?.contains(event.target as Node)) {
                setEventFilterOpen(false);
            }
        };

        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [eventFilterOpen]);

    const toggleEventType = (eventType: string) => {
        setSelectedEventTypes((current) => (
            current.includes(eventType)
                ? current.filter((selectedType) => selectedType !== eventType)
                : [...current, eventType]
        ));
    };

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

                <div className="flex flex-wrap justify-end gap-3">
                    <div ref={eventFilterRef} className="relative">
                        <button
                            type="button"
                            onClick={() => setEventFilterOpen((isOpen) => !isOpen)}
                            className={`w-fit flex items-center gap-2 rounded-lg border px-4 py-2 text-sm font-bold transition-colors ${activeFilterCount > 0
                                ? 'border-primary-green/50 bg-primary-green/10 text-primary-green'
                                : 'border-border bg-card text-text-light hover:border-primary-green/50 hover:text-primary-green'
                            }`}
                        >
                            <Filter size={16} />
                            Filter
                            {activeFilterCount > 0 && (
                                <span className="rounded-full bg-primary-green px-1.5 py-0.5 text-[10px] font-black text-main">
                                    {activeFilterCount}
                                </span>
                            )}
                        </button>

                        {eventFilterOpen && (
                            <div className="absolute right-0 z-30 mt-2 w-[min(320px,calc(100vw-2rem))] overflow-hidden rounded-xl border border-border bg-[#171A1D] shadow-2xl">
                                <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
                                    <div>
                                        <div className="text-sm font-black text-text-light">Event types</div>
                                        <div className="text-xs text-text-medium">Choose what appears in the feed</div>
                                    </div>
                                    {activeFilterCount > 0 && (
                                        <button
                                            type="button"
                                            onClick={() => setSelectedEventTypes([])}
                                            className="text-xs font-bold text-primary-green hover:text-primary-green-darker"
                                        >
                                            Clear
                                        </button>
                                    )}
                                </div>
                                <div className="max-h-72 overflow-y-auto p-2">
                                    {eventTypeOptions.length === 0 ? (
                                        <div className="px-3 py-6 text-center text-xs font-bold text-text-medium">
                                            No event types available yet
                                        </div>
                                    ) : (
                                        eventTypeOptions.map((eventType) => {
                                            const selected = activeEventTypeSet.has(eventType);
                                            return (
                                                <button
                                                    key={eventType}
                                                    type="button"
                                                    onClick={() => toggleEventType(eventType)}
                                                    className="flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2.5 text-left text-sm font-bold text-text-light transition-colors hover:bg-card"
                                                >
                                                    <span className="min-w-0 truncate">{eventType}</span>
                                                    <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded border ${selected ? 'border-primary-green bg-primary-green text-main' : 'border-border text-transparent'}`}>
                                                        <Check size={13} strokeWidth={3} />
                                                    </span>
                                                </button>
                                            );
                                        })
                                    )}
                                </div>
                            </div>
                        )}
                    </div>
                    <button
                        onClick={refreshEvents}
                        className="w-fit flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-2 text-sm font-bold text-text-light hover:border-primary-green/50 hover:text-primary-green transition-colors"
                    >
                        <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
                        Refresh
                    </button>
                </div>
            </section>

            <section className="rounded-xl border border-border bg-card overflow-hidden">
                    <div className="border-b border-border px-5 py-4">
                        <div className="flex items-center justify-between gap-3">
                            <div>
                                <h3 className="text-lg font-bold text-text-light">Events</h3>
                                <p className="mt-1 text-sm text-text-medium">Latest activity across detected tokens.</p>
                            </div>
                        </div>
                    </div>
                    <div className="p-3 sm:p-4">
                        {loading && globalEventsToRender.length === 0 ? (
                            <div className="rounded-lg border border-border bg-[#1C1F22] p-8 text-center">
                                <RefreshCw className="mx-auto mb-3 animate-spin text-primary-green" size={28} />
                                <div className="text-sm font-bold text-text-light">Waiting for token events...</div>
                            </div>
                        ) : globalEventsToRender.length === 0 ? (
                            <div className="rounded-lg border border-border bg-[#1C1F22] p-8 text-center">
                                <div className="text-sm font-bold text-text-light">No global events yet</div>
                                <div className="mt-1 text-xs text-text-medium">Events will appear when detected tokens show activity.</div>
                            </div>
                        ) : visibleGlobalEvents.length === 0 ? (
                            <div className="rounded-lg border border-border bg-[#1C1F22] p-8 text-center">
                                <div className="text-sm font-bold text-text-light">No events match this filter</div>
                                <button
                                    type="button"
                                    onClick={() => setSelectedEventTypes([])}
                                    className="mt-2 text-xs font-bold text-primary-green hover:text-primary-green-darker"
                                >
                                    Clear filters
                                </button>
                            </div>
                        ) : (
                            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 2xl:grid-cols-3">
                                {visibleGlobalEvents.map((globalEvent) => {
                                    const event = globalEvent.source;
                                    return (
                                    <button
                                        key={globalEvent.id}
                                        onClick={() => navigate(`/detection/token/${encodeURIComponent(event.token.address || event.token.ticker)}?source=detection&severity=${encodeURIComponent(event.severity)}&eventType=${encodeURIComponent(event.eventType)}&score=${encodeURIComponent(String(event.score))}&detectedAt=${encodeURIComponent(String(event.detectedAt))}`)}
                                        className="group flex w-full overflow-hidden rounded-xl border border-border bg-[#1C1F22] text-left shadow-sm transition-colors hover:border-text-medium"
                                    >
                                        <div className={`w-1.5 shrink-0 ${eventSentimentAccentClass(globalEvent.sentiment)}`}></div>
                                        <div className="flex min-h-[128px] flex-1 flex-col justify-between p-3.5">
                                            <div>
                                                <div className="flex items-start justify-between gap-3">
                                                    <div className="flex min-w-0 items-center gap-2 text-[10px] font-black uppercase text-text-light">
                                                        <ShieldAlert size={13} className="shrink-0 text-text-light" />
                                                        <span className="truncate">{globalEvent.title}</span>
                                                    </div>
                                                    <span className="shrink-0 text-[10px] font-mono text-text-medium">{getTimeAgo(globalEvent.detectedAt)}</span>
                                                </div>
                                                <p className="mt-3 line-clamp-2 text-xs font-bold leading-snug text-text-light">
                                                    {globalEvent.description}
                                                </p>
                                            </div>
                                            <div className="mt-3 flex items-center justify-between gap-3 border-t border-border/60 pt-2.5">
                                                <div className="flex min-w-0 items-center gap-2">
                                                    <img
                                                        src={event.token.img}
                                                        alt={event.token.ticker}
                                                        title={event.token.name}
                                                        className="h-5 w-5 shrink-0 rounded-full border border-border bg-[#111315] object-cover"
                                                        onError={(imageEvent) => { imageEvent.currentTarget.style.display = 'none'; }}
                                                    />
                                                    <span className="truncate text-[11px] font-black text-text-medium" title={event.token.name}>
                                                        {event.token.ticker}
                                                    </span>
                                                </div>
                                                <div className="flex shrink-0 items-center gap-2">
                                                    <span className={`rounded-full border px-2 py-0.5 text-[9px] font-bold uppercase ${eventSentimentLabelClass(globalEvent.sentiment)}`}>
                                                        {globalEvent.sentiment}
                                                    </span>
                                                    <span className="font-mono text-[11px] font-black text-text-light">
                                                        {formatCompactUsd(globalEvent.usdValue)}
                                                    </span>
                                                </div>
                                            </div>
                                        </div>
                                    </button>
                                    );
                                })}
                            </div>
                        )}
                    </div>
            </section>
        </div>
    );
};
