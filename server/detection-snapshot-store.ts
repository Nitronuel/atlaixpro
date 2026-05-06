import { createClient } from '@supabase/supabase-js';
import type { AlphaGauntletEvent, MarketCoin } from '../src/types';

const SNAPSHOT_TABLE = 'detected_token_snapshots';
const MAX_FEED_EVENTS = 200;
let supabaseClient: any | null | undefined;
let supabaseAvailable = true;
let hasWarned = false;

const readEnv = (...keys: string[]) => {
    for (const key of keys) {
        const value = process.env[key]?.trim();
        if (value) return value;
    }
    return '';
};

const warnOnce = (message: string) => {
    if (hasWarned) return;
    hasWarned = true;
    console.warn(message);
};

const getSupabase = () => {
    if (!supabaseAvailable) return null;
    if (supabaseClient !== undefined) return supabaseClient;

    const url = readEnv('SUPABASE_URL', 'VITE_SUPABASE_URL');
    const key = readEnv('SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_SERVICE_KEY', 'SUPABASE_ANON_KEY', 'VITE_SUPABASE_ANON_KEY');
    supabaseClient = url && key
        ? createClient(url, key, {
            auth: {
                persistSession: false,
                autoRefreshToken: false
            }
        })
        : null;

    return supabaseClient;
};

export const getDetectionKey = (event: AlphaGauntletEvent) => {
    const tokenKey = event.token.address || event.token.ticker;
    return [
        event.token.chain.toLowerCase(),
        tokenKey.toLowerCase(),
        event.eventType.toLowerCase()
    ].join(':');
};

const parseMetric = (value: string | number | undefined) => {
    if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
    const raw = String(value || '').replace(/[$,%+\s]/g, '').toUpperCase();
    const parsed = Number.parseFloat(raw);
    if (!Number.isFinite(parsed)) return 0;
    if (raw.includes('T')) return parsed * 1e12;
    if (raw.includes('B')) return parsed * 1e9;
    if (raw.includes('M')) return parsed * 1e6;
    if (raw.includes('K')) return parsed * 1e3;
    return raw.includes('-') ? -parsed : parsed;
};

const toIso = (timestamp: number) => new Date(Number(timestamp) || Date.now()).toISOString();

const eventToRow = (event: AlphaGauntletEvent, firstDetectedAt?: string) => {
    const token = event.token;
    const detectionKey = getDetectionKey(event);
    const preservedDetectedAt = firstDetectedAt ? new Date(firstDetectedAt).getTime() : event.detectedAt;
    const stableEvent = {
        ...event,
        detectedAt: preservedDetectedAt || event.detectedAt
    };

    return {
        detection_key: detectionKey,
        chain: token.chain.toLowerCase(),
        token_address: token.address || token.ticker,
        pair_address: token.pairAddress || null,
        ticker: token.ticker,
        name: token.name,
        image_url: token.img || null,
        price: token.price,
        price_change_1h: parseMetric(token.h1),
        price_change_24h: parseMetric(token.h24),
        volume_24h: event.metrics?.volume24h || parseMetric(token.volume24h),
        liquidity: event.metrics?.liquidity || parseMetric(token.liquidity),
        market_cap: event.metrics?.marketCap || parseMetric(token.cap),
        buys_24h: parseMetric(token.dexBuys),
        sells_24h: parseMetric(token.dexSells),
        buy_volume_24h: event.metrics?.buyVolume24h || parseMetric(token.buyVolume24h),
        sell_volume_24h: event.metrics?.sellVolume24h || parseMetric(token.sellVolume24h),
        score: event.score,
        severity: event.severity,
        event_type: event.eventType,
        triggers: event.triggers,
        summary: event.summary,
        metrics: event.metrics || {},
        first_detected_at: firstDetectedAt || toIso(event.detectedAt),
        last_refreshed_at: new Date().toISOString(),
        last_provider_status: 'ok',
        raw_event: stableEvent
    };
};

const rowToEvent = (row: any): AlphaGauntletEvent => {
    const raw = row.raw_event || {};
    const token = raw.token || {};
    const rawMetrics = raw.metrics || {};
    const coin: MarketCoin = {
        ...token,
        name: token.name || row.name || row.ticker,
        ticker: token.ticker || row.ticker,
        price: token.price || row.price || '$0',
        h1: token.h1 || `${Number(row.price_change_1h || 0).toFixed(2)}%`,
        h24: token.h24 || `${Number(row.price_change_24h || 0).toFixed(2)}%`,
        volume24h: token.volume24h || `$${Number(row.volume_24h || 0).toLocaleString()}`,
        liquidity: token.liquidity || `$${Number(row.liquidity || 0).toLocaleString()}`,
        cap: token.cap || `$${Number(row.market_cap || 0).toLocaleString()}`,
        dexBuys: token.dexBuys || String(Number(row.buys_24h || 0)),
        dexSells: token.dexSells || String(Number(row.sells_24h || 0)),
        buyVolume24h: token.buyVolume24h || `$${Number(row.buy_volume_24h || 0).toLocaleString()}`,
        sellVolume24h: token.sellVolume24h || `$${Number(row.sell_volume_24h || 0).toLocaleString()}`,
        img: token.img || row.image_url || '',
        chain: token.chain || row.chain,
        address: token.address || row.token_address,
        pairAddress: token.pairAddress || row.pair_address || undefined
    };

    return {
        token: coin,
        eventType: raw.eventType || row.event_type,
        triggers: raw.triggers || row.triggers || [],
        score: Number(raw.score ?? row.score ?? 0),
        scores: raw.scores || {
            marketStructure: 0,
            liquidityHealth: 0,
            activity: 0,
            eventStrength: 0,
            total: Number(row.score || 0)
        },
        severity: raw.severity || row.severity,
        summary: raw.summary || row.summary || '',
        detectedAt: raw.detectedAt || new Date(row.first_detected_at || row.last_refreshed_at || Date.now()).getTime(),
        metrics: {
            marketCap: Number(rawMetrics.marketCap ?? row.market_cap ?? 0),
            liquidity: Number(rawMetrics.liquidity ?? row.liquidity ?? 0),
            volume24h: Number(rawMetrics.volume24h ?? row.volume_24h ?? 0),
            holders: Number(rawMetrics.holders ?? 0),
            transactions24h: Number(rawMetrics.transactions24h ?? (Number(row.buys_24h || 0) + Number(row.sells_24h || 0))),
            ageHours: Number(rawMetrics.ageHours ?? 0),
            lpToMarketCapRatio: Number(rawMetrics.lpToMarketCapRatio ?? 0),
            buySellRatio: Number(rawMetrics.buySellRatio ?? 0),
            buyVolume24h: Number(rawMetrics.buyVolume24h ?? row.buy_volume_24h ?? 0),
            sellVolume24h: Number(rawMetrics.sellVolume24h ?? row.sell_volume_24h ?? 0),
            volumeFlowRatio: Number(rawMetrics.volumeFlowRatio ?? 0),
            priceChange24h: Number(rawMetrics.priceChange24h ?? row.price_change_24h ?? 0),
            netFlow: Number(rawMetrics.netFlow ?? 0)
        }
    };
};

export const DetectionSnapshotStore = {
    upsertEvents: async (events: AlphaGauntletEvent[]) => {
        const supabase = getSupabase();
        if (!supabase || events.length === 0) return events;

        try {
            const keys = events.map(getDetectionKey);
            const { data: existing } = await supabase
                .from(SNAPSHOT_TABLE)
                .select('detection_key, first_detected_at, raw_event')
                .in('detection_key', keys);

            const firstDetectedAtByKey = new Map<string, string>();
            (existing || []).forEach((row: any) => {
                const rawDetectedAt = Number(row.raw_event?.detectedAt || 0);
                const detectedAtIso = rawDetectedAt ? toIso(rawDetectedAt) : row.first_detected_at;
                if (row.detection_key && detectedAtIso) firstDetectedAtByKey.set(row.detection_key, detectedAtIso);
            });

            const rows = events.map((event) => eventToRow(event, firstDetectedAtByKey.get(getDetectionKey(event))));
            const { error } = await supabase
                .from(SNAPSHOT_TABLE)
                .upsert(rows, { onConflict: 'detection_key' });

            if (error) throw error;
            return rows.map(rowToEvent);
        } catch (error: any) {
            if (/Failed to fetch|fetch failed|network/i.test(error?.message || '')) {
                supabaseAvailable = false;
            }
            warnOnce(`Detection snapshot sync failed: ${error?.message || 'Unknown error'}. Apply supabase/detected_token_snapshots.sql if the table is missing.`);
            return events;
        }
    },

    getFeed: async (limit = MAX_FEED_EVENTS) => {
        const supabase = getSupabase();
        if (!supabase) return [];

        const { data, error } = await supabase
            .from(SNAPSHOT_TABLE)
            .select('*')
            .order('score', { ascending: false })
            .order('last_refreshed_at', { ascending: false })
            .limit(limit);

        if (error) throw error;
        return (data || []).map(rowToEvent);
    },

    getToken: async (chain: string, address: string) => {
        const supabase = getSupabase();
        if (!supabase) return null;

        const normalizedChain = chain.toLowerCase();
        const normalizedAddress = address.toLowerCase();
        const { data, error } = await supabase
            .from(SNAPSHOT_TABLE)
            .select('*')
            .eq('chain', normalizedChain)
            .or(`token_address.eq.${normalizedAddress},pair_address.eq.${normalizedAddress},ticker.ilike.${address}`)
            .order('score', { ascending: false })
            .limit(1);

        if (error) throw error;
        const row = data?.[0];
        return row ? rowToEvent(row) : null;
    }
};
