import { createClient } from '@supabase/supabase-js';
import type { MarketCoin } from '../src/types';

const SNAPSHOT_TABLE = 'detection_pair_snapshots';
const LOCAL_MAX_SNAPSHOTS = 2500;
const DEFAULT_RETENTION_DAYS = 7;
const DEFAULT_MAX_ROWS = 50_000;

let supabaseClient: any | null | undefined;
let supabaseAvailable = true;
let hasWarned = false;
const localSnapshots: DetectionPairSnapshotRow[] = [];

export type DetectionPairSnapshotRow = {
    snapshot_key: string;
    chain: string;
    token_address: string;
    pair_address: string | null;
    dex_id?: string | null;
    base_symbol?: string | null;
    quote_symbol?: string | null;
    price_usd: number;
    liquidity_usd: number;
    market_cap: number;
    fdv: number;
    volume_5m?: number | null;
    volume_1h?: number | null;
    volume_6h?: number | null;
    volume_24h: number;
    buys_5m?: number | null;
    sells_5m?: number | null;
    buys_1h?: number | null;
    sells_1h?: number | null;
    buys_6h?: number | null;
    sells_6h?: number | null;
    buys_24h: number;
    sells_24h: number;
    price_change_5m?: number | null;
    price_change_1h?: number | null;
    price_change_6h?: number | null;
    price_change_24h?: number | null;
    boosts_active: number;
    has_profile: boolean;
    has_website: boolean;
    has_socials: boolean;
    source: 'dexscreener';
    raw_pair: Record<string, unknown>;
    captured_at?: string;
};

const readEnv = (...keys: string[]) => {
    for (const key of keys) {
        const value = process.env[key]?.trim();
        if (value) return value;
    }
    return '';
};

const readNumberEnv = (key: string, fallback: number) => {
    const value = Number(process.env[key]);
    return Number.isFinite(value) && value > 0 ? value : fallback;
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

const normalize = (value = '') => value.trim().toLowerCase();

export const getPairSnapshotKey = (coin: MarketCoin) => {
    const tokenKey = coin.address || coin.ticker;
    return [normalize(coin.chain), normalize(tokenKey), normalize(coin.pairAddress || '') || 'primary'].join(':');
};

const coinToSnapshot = (coin: MarketCoin): DetectionPairSnapshotRow | null => {
    const tokenAddress = coin.address || coin.ticker;
    if (!coin.chain || !tokenAddress) return null;

    return {
        snapshot_key: getPairSnapshotKey(coin),
        chain: normalize(coin.chain),
        token_address: normalize(tokenAddress),
        pair_address: coin.pairAddress ? normalize(coin.pairAddress) : null,
        base_symbol: coin.ticker,
        quote_symbol: null,
        price_usd: parseMetric(coin.price),
        liquidity_usd: parseMetric(coin.liquidity),
        market_cap: parseMetric(coin.cap),
        fdv: parseMetric(coin.cap),
        volume_1h: null,
        volume_24h: parseMetric(coin.volume24h),
        buys_24h: parseMetric(coin.dexBuys),
        sells_24h: parseMetric(coin.dexSells),
        price_change_1h: parseMetric(coin.h1),
        price_change_24h: parseMetric(coin.h24),
        boosts_active: 0,
        has_profile: Boolean(coin.img),
        has_website: false,
        has_socials: false,
        source: 'dexscreener',
        raw_pair: {
            name: coin.name,
            ticker: coin.ticker,
            signal: coin.signal,
            riskLevel: coin.riskLevel,
            activeWallets24h: coin.activeWallets24h || null
        },
        captured_at: new Date().toISOString()
    };
};

const pushLocal = (rows: DetectionPairSnapshotRow[]) => {
    localSnapshots.push(...rows);
    if (localSnapshots.length > LOCAL_MAX_SNAPSHOTS) {
        localSnapshots.splice(0, localSnapshots.length - LOCAL_MAX_SNAPSHOTS);
    }
};

export const DetectionPairSnapshotStore = {
    insertCoinSnapshots: async (coins: MarketCoin[]) => {
        const rows = coins
            .map(coinToSnapshot)
            .filter((row): row is DetectionPairSnapshotRow => Boolean(row));

        if (!rows.length) return [];

        const supabase = getSupabase();
        if (!supabase) {
            pushLocal(rows);
            return rows;
        }

        try {
            const { error } = await supabase
                .from(SNAPSHOT_TABLE)
                .insert(rows);

            if (error) throw error;
            pushLocal(rows);
            return rows;
        } catch (error: any) {
            if (/Failed to fetch|fetch failed|network/i.test(error?.message || '')) {
                supabaseAvailable = false;
            }
            warnOnce(`Detection pair snapshot sync failed: ${error?.message || 'Unknown error'}. Apply supabase/detection_pair_snapshots.sql if the table is missing.`);
            pushLocal(rows);
            return rows;
        }
    },

    getRecentSnapshots: async (chain: string, tokenAddress: string, limit = 50) => {
        const normalizedChain = normalize(chain);
        const normalizedAddress = normalize(tokenAddress);
        const supabase = getSupabase();

        if (!supabase) {
            return localSnapshots
                .filter((row) => row.chain === normalizedChain && row.token_address === normalizedAddress)
                .sort((a, b) => new Date(b.captured_at || 0).getTime() - new Date(a.captured_at || 0).getTime())
                .slice(0, limit);
        }

        const { data, error } = await supabase
            .from(SNAPSHOT_TABLE)
            .select('*')
            .eq('chain', normalizedChain)
            .eq('token_address', normalizedAddress)
            .order('captured_at', { ascending: false })
            .limit(limit);

        if (error) throw error;
        return data || [];
    },

    getNearestSnapshotBefore: async (chain: string, tokenAddress: string, beforeTimestamp: number) => {
        const normalizedChain = normalize(chain);
        const normalizedAddress = normalize(tokenAddress);
        const beforeIso = new Date(beforeTimestamp).toISOString();
        const supabase = getSupabase();

        if (!supabase) {
            return localSnapshots
                .filter((row) => row.chain === normalizedChain && row.token_address === normalizedAddress && String(row.captured_at || '') <= beforeIso)
                .sort((a, b) => new Date(b.captured_at || 0).getTime() - new Date(a.captured_at || 0).getTime())[0] || null;
        }

        const { data, error } = await supabase
            .from(SNAPSHOT_TABLE)
            .select('*')
            .eq('chain', normalizedChain)
            .eq('token_address', normalizedAddress)
            .lte('captured_at', beforeIso)
            .order('captured_at', { ascending: false })
            .limit(1);

        if (error) throw error;
        return data?.[0] || null;
    },

    pruneOldSnapshots: async (options: { retentionDays?: number; maxRows?: number } = {}) => {
        const retentionDays = Math.max(1, Math.round(options.retentionDays || readNumberEnv('DETECTION_PAIR_SNAPSHOT_RETENTION_DAYS', DEFAULT_RETENTION_DAYS)));
        const maxRows = Math.max(1000, Math.round(options.maxRows || readNumberEnv('DETECTION_PAIR_SNAPSHOT_MAX_ROWS', DEFAULT_MAX_ROWS)));
        const supabase = getSupabase();

        const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
        for (let index = localSnapshots.length - 1; index >= 0; index -= 1) {
            const capturedAt = new Date(localSnapshots[index].captured_at || 0).getTime();
            if (!capturedAt || capturedAt < cutoff) localSnapshots.splice(index, 1);
        }
        if (localSnapshots.length > LOCAL_MAX_SNAPSHOTS) {
            localSnapshots.splice(0, localSnapshots.length - LOCAL_MAX_SNAPSHOTS);
        }

        if (!supabase) return 0;

        try {
            const { data, error } = await supabase.rpc('prune_detection_pair_snapshots', {
                retention_days: retentionDays,
                max_rows: maxRows
            });

            if (!error) return Number(data || 0);

            const cutoffIso = new Date(cutoff).toISOString();
            const fallback = await supabase
                .from(SNAPSHOT_TABLE)
                .delete()
                .lt('captured_at', cutoffIso);

            if (fallback.error) throw fallback.error;
            return 0;
        } catch (error: any) {
            warnOnce(`Detection pair snapshot prune failed: ${error?.message || 'Unknown error'}. Apply supabase/detection_pair_snapshots.sql to enable automatic pruning.`);
            return 0;
        }
    }
};
