import { createClient } from '@supabase/supabase-js';
import type { AlphaGauntletEvent } from '../src/types';
import { getDetectionKey } from './detection-snapshot-store';
import { DetectionPairSnapshotStore, DetectionPairSnapshotRow } from './detection-pair-snapshot-store';

const OUTCOME_TABLE = 'detection_outcomes';
const HORIZONS = [
    { label: '5m', ms: 5 * 60 * 1000 },
    { label: '15m', ms: 15 * 60 * 1000 },
    { label: '1h', ms: 60 * 60 * 1000 },
    { label: '6h', ms: 6 * 60 * 60 * 1000 },
    { label: '24h', ms: 24 * 60 * 60 * 1000 }
];

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
        ? createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
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

const pct = (current: number, previous: number) => {
    if (!Number.isFinite(current) || !Number.isFinite(previous) || previous <= 0) return null;
    return Math.round(((current - previous) / previous) * 10000) / 100;
};

const rowFromEvent = async (event: AlphaGauntletEvent, horizon: string, baseline: DetectionPairSnapshotRow) => {
    const detectedAt = new Date(event.detectedAt).toISOString();
    const currentTxns = event.metrics.transactions24h;
    const baselineTxns = Number(baseline.buys_24h || 0) + Number(baseline.sells_24h || 0);

    return {
        detection_key: getDetectionKey(event),
        chain: event.token.chain.toLowerCase(),
        token_address: (event.token.address || event.token.ticker).toLowerCase(),
        pair_address: event.token.pairAddress?.toLowerCase() || null,
        ticker: event.token.ticker,
        event_type: event.eventType,
        lane: event.lane || null,
        score: event.score,
        confidence_score: event.confidence?.score || null,
        detected_at: detectedAt,
        measured_at: new Date().toISOString(),
        horizon,
        price_return_pct: pct(parseMetric(event.token.price), Number(baseline.price_usd || 0)),
        liquidity_change_pct: pct(event.metrics.liquidity, Number(baseline.liquidity_usd || 0)),
        volume_change_pct: pct(event.metrics.volume24h, Number(baseline.volume_24h || 0)),
        transaction_change_pct: pct(currentTxns, baselineTxns),
        still_active: event.metrics.volume24h > 0 && event.metrics.liquidity > 0,
        raw_metrics: {
            baselineCapturedAt: baseline.captured_at,
            current: event.metrics,
            baseline: {
                priceUsd: baseline.price_usd,
                liquidityUsd: baseline.liquidity_usd,
                volume24h: baseline.volume_24h,
                transactions24h: baselineTxns
            }
        }
    };
};

export const DetectionOutcomeTracker = {
    recordDueOutcomes: async (events: AlphaGauntletEvent[]) => {
        const supabase = getSupabase();
        if (!supabase || !events.length) return 0;

        const now = Date.now();
        const rows: any[] = [];

        for (const event of events) {
            const tokenAddress = event.token.address;
            if (!tokenAddress || event.detectedAt > now) continue;

            const elapsed = now - event.detectedAt;
            for (const horizon of HORIZONS) {
                if (elapsed < horizon.ms) continue;
                const baseline = await DetectionPairSnapshotStore.getNearestSnapshotBefore(event.token.chain, tokenAddress, event.detectedAt + 60_000);
                if (!baseline) continue;
                rows.push(await rowFromEvent(event, horizon.label, baseline));
            }
        }

        if (!rows.length) return 0;

        try {
            const { error } = await supabase
                .from(OUTCOME_TABLE)
                .upsert(rows, { onConflict: 'detection_key,horizon' });

            if (error) throw error;
            return rows.length;
        } catch (error: any) {
            if (/Failed to fetch|fetch failed|network/i.test(error?.message || '')) {
                supabaseAvailable = false;
            }
            warnOnce(`Detection outcome sync failed: ${error?.message || 'Unknown error'}. Apply supabase/detection_outcomes.sql if the table is missing.`);
            return 0;
        }
    },

    getSignalQualitySummary: async () => {
        const supabase = getSupabase();
        if (!supabase) return { configured: false };

        const [events, outcomes] = await Promise.all([
            supabase.from('detected_token_snapshots').select('event_type, triggers, raw_event, score, last_refreshed_at').order('last_refreshed_at', { ascending: false }).limit(200),
            supabase.from(OUTCOME_TABLE).select('event_type, lane, horizon, price_return_pct, liquidity_change_pct, transaction_change_pct, score, confidence_score').order('measured_at', { ascending: false }).limit(500)
        ]);

        if (events.error) throw events.error;
        if (outcomes.error && !/does not exist|schema cache/i.test(outcomes.error.message || '')) throw outcomes.error;

        const byType: Record<string, number> = {};
        const triggers: Record<string, number> = {};
        for (const row of events.data || []) {
            byType[row.event_type] = (byType[row.event_type] || 0) + 1;
            for (const trigger of row.triggers || []) {
                triggers[trigger] = (triggers[trigger] || 0) + 1;
            }
        }

        const outcomeRows = outcomes.data || [];
        const outcomeByType: Record<string, { count: number; avgReturn: number; avgLiquidityChange: number }> = {};
        for (const row of outcomeRows) {
            const bucket = outcomeByType[row.event_type] || { count: 0, avgReturn: 0, avgLiquidityChange: 0 };
            bucket.count += 1;
            bucket.avgReturn += Number(row.price_return_pct || 0);
            bucket.avgLiquidityChange += Number(row.liquidity_change_pct || 0);
            outcomeByType[row.event_type] = bucket;
        }
        Object.values(outcomeByType).forEach((bucket) => {
            if (!bucket.count) return;
            bucket.avgReturn = Math.round((bucket.avgReturn / bucket.count) * 100) / 100;
            bucket.avgLiquidityChange = Math.round((bucket.avgLiquidityChange / bucket.count) * 100) / 100;
        });

        return {
            configured: true,
            eventSampleSize: events.data?.length || 0,
            outcomeSampleSize: outcomeRows.length,
            byType,
            triggers,
            outcomeByType
        };
    }
};
