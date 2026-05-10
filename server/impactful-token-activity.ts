import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createClient } from '@supabase/supabase-js';

type WatchedToken = {
    chain: string;
    tokenAddress: string;
    pairAddress?: string;
    priceUsd: number;
    liquidityUsd: number;
    expiresAt: number;
    webhookConfigured?: boolean;
    webhookError?: string;
};

export type ImpactfulTokenActivity = {
    id: string;
    chain: string;
    tokenAddress: string;
    type: string;
    severity: 'Critical' | 'High' | 'Signal';
    title: string;
    description: string;
    usdValue: number;
    tokenAmount: number;
    wallet: string;
    txHash: string;
    detectedAt: number;
    source?: string;
};

type ActivityCandidate = {
    tokenAddress: string;
    from: string;
    to: string;
    amount: number;
    txHash: string;
    category: string;
    timestamp: number;
    asset?: string;
    direction?: 'inbound' | 'outbound' | 'unknown';
    eventName?: string;
    methodName?: string;
};

type PersistedState = {
    watchedTokens: WatchedToken[];
    tokenActivities: Array<{
        key: string;
        savedAt: number;
        activities: ImpactfulTokenActivity[];
    }>;
};

const watchedTokens = new Map<string, WatchedToken>();
const tokenActivities = new Map<string, ImpactfulTokenActivity[]>();
const tokenActivitySavedAt = new Map<string, number>();
const MAX_EVENTS_PER_TOKEN = 100;
const WATCH_TTL_MS = 2 * 60 * 60 * 1000;
const MIN_WATCH_MS = 5 * 60 * 1000;
const MAX_WATCH_MS = 24 * 60 * 60 * 1000;
const WHALE_TRADE_MIN_USD = 100_000;
const LARGE_WALLET_MOVEMENT_MIN_USD = 500_000;
const DATA_DIR = resolve(process.cwd(), 'data', 'token-activity');
const STATE_FILE = resolve(DATA_DIR, 'state.json');
const ALCHEMY_NOTIFY_API = 'https://dashboard.alchemy.com/api';
let persistTimer: ReturnType<typeof setTimeout> | null = null;
let supabaseClient: any | null | undefined;
let supabaseAvailable = true;
let hasWarnedAboutSupabase = false;

const CHAIN_TO_ALCHEMY_NETWORK: Record<string, string> = {
    ethereum: 'ETH_MAINNET',
    eth: 'ETH_MAINNET',
    base: 'BASE_MAINNET',
    arbitrum: 'ARB_MAINNET',
    polygon: 'MATIC_MAINNET',
    optimism: 'OPT_MAINNET',
    solana: 'SOLANA_MAINNET',
    bsc: 'BNB_MAINNET',
    binance: 'BNB_MAINNET'
};

const CHAIN_TO_WEBHOOK_ID_ENV: Record<string, string[]> = {
    ethereum: ['ALCHEMY_ETHEREUM_ADDRESS_WEBHOOK_ID', 'ALCHEMY_ADDRESS_WEBHOOK_ID'],
    eth: ['ALCHEMY_ETHEREUM_ADDRESS_WEBHOOK_ID', 'ALCHEMY_ADDRESS_WEBHOOK_ID'],
    base: ['ALCHEMY_BASE_ADDRESS_WEBHOOK_ID', 'ALCHEMY_ADDRESS_WEBHOOK_ID'],
    arbitrum: ['ALCHEMY_ARBITRUM_ADDRESS_WEBHOOK_ID', 'ALCHEMY_ADDRESS_WEBHOOK_ID'],
    polygon: ['ALCHEMY_POLYGON_ADDRESS_WEBHOOK_ID', 'ALCHEMY_ADDRESS_WEBHOOK_ID'],
    optimism: ['ALCHEMY_OPTIMISM_ADDRESS_WEBHOOK_ID', 'ALCHEMY_ADDRESS_WEBHOOK_ID'],
    solana: ['ALCHEMY_SOLANA_ADDRESS_WEBHOOK_ID', 'ALCHEMY_ADDRESS_WEBHOOK_ID'],
    bsc: ['ALCHEMY_BNB_ADDRESS_WEBHOOK_ID', 'ALCHEMY_ADDRESS_WEBHOOK_ID']
};

const DEAD_ADDRESSES = new Set([
    '0x0000000000000000000000000000000000000000',
    '0x000000000000000000000000000000000000dead'
]);

const normalizeAddress = (value = '') => value.trim().toLowerCase();

const tokenKey = (chain: string, address: string) => `${chain.toLowerCase()}:${normalizeAddress(address)}`;

const compactUsd = (value: number) => {
    if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
    if (value >= 1_000) return `$${(value / 1_000).toFixed(1)}K`;
    return `$${Math.round(value).toLocaleString()}`;
};

const readEnv = (...keys: string[]) => {
    for (const key of keys) {
        const value = process.env[key]?.trim();
        if (value) return value;
    }
    return '';
};

const warnSupabaseOnce = (message: string) => {
    if (hasWarnedAboutSupabase) return;
    hasWarnedAboutSupabase = true;
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

const formatSupabaseError = (error: any) => {
    const parts = [
        error?.message,
        error?.details ? `details: ${error.details}` : '',
        error?.hint ? `hint: ${error.hint}` : '',
        error?.code ? `code: ${error.code}` : ''
    ].filter(Boolean);

    return parts.join(' | ') || 'Unknown Supabase error';
};

const toIso = (timestamp: number) => new Date(Number(timestamp) || Date.now()).toISOString();

const eventKey = (chain: string, tokenAddress: string, event: ImpactfulTokenActivity) => {
    const id = event.id || event.txHash;
    return `${chain.toLowerCase()}:${normalizeAddress(tokenAddress)}:${id}`;
};

const toSupabaseRow = (chain: string, tokenAddress: string, event: ImpactfulTokenActivity) => {
    const normalizedChain = chain.toLowerCase();
    const normalizedTokenAddress = normalizeAddress(tokenAddress);
    const id = event.id || event.txHash;

    return {
        event_key: eventKey(normalizedChain, normalizedTokenAddress, event),
        chain: normalizedChain,
        token_address: normalizedTokenAddress,
        event_id: id,
        tx_hash: event.txHash || id,
        event_type: event.type,
        severity: event.severity,
        title: event.title,
        description: event.description,
        usd_value: Number(event.usdValue || 0),
        token_amount: Number(event.tokenAmount || 0),
        wallet: event.wallet || '',
        detected_at: toIso(event.detectedAt),
        raw_event: {
            ...event,
            chain: normalizedChain,
            tokenAddress: normalizedTokenAddress
        }
    };
};

const fromSupabaseRow = (row: any): ImpactfulTokenActivity => {
    const raw = row.raw_event || {};

    return {
        id: String(raw.id || row.event_id || row.event_key),
        chain: String(raw.chain || row.chain || ''),
        tokenAddress: normalizeAddress(raw.tokenAddress || row.token_address || ''),
        type: raw.type || row.event_type,
        severity: raw.severity || row.severity,
        title: raw.title || row.title,
        description: raw.description || row.description || '',
        usdValue: Number(raw.usdValue ?? row.usd_value ?? 0),
        tokenAmount: Number(raw.tokenAmount ?? row.token_amount ?? 0),
        wallet: raw.wallet || row.wallet || '',
        txHash: raw.txHash || row.tx_hash || '',
        detectedAt: raw.detectedAt ? Number(raw.detectedAt) : new Date(row.detected_at || row.saved_at || Date.now()).getTime(),
        source: raw.source
    };
};

const normalizeLegacyActivity = (activity: ImpactfulTokenActivity): ImpactfulTokenActivity => {
    const normalizedTitle = activity.title.toLowerCase();
    const detectionTypeByTitle = (() => {
        if (normalizedTitle === 'seller dominance') return 'Sell-Side Flow';
        if (normalizedTitle === 'buyer dominance') return 'Buy-Side Flow';
        if (normalizedTitle.includes('admission')) return 'Detection Event';
        if (normalizedTitle.includes('liquidity')) return 'Liquidity Event';
        if (normalizedTitle === 'volume expansion') return 'Market Event';
        return '';
    })();
    const normalizedType = detectionTypeByTitle && activity.source === 'detection-engine'
        ? detectionTypeByTitle
        : activity.type;

    if (
        normalizedTitle === 'volume expansion' &&
        /\bin 24h market volume\.?$/i.test(activity.description)
    ) {
        return {
            ...activity,
            type: normalizedType,
            description: activity.description.replace(/\bin 24h market volume\.?$/i, 'in latest 24h volume. Prior 24h baseline is still warming up.')
        };
    }

    return normalizedType === activity.type ? activity : { ...activity, type: normalizedType };
};

const isReportableActivity = (activity: ImpactfulTokenActivity) => {
    const title = activity.title.toLowerCase();
    const type = activity.type.toLowerCase();
    const usdValue = Number(activity.usdValue || 0);

    if (title === 'large wallet movement') {
        return usdValue >= LARGE_WALLET_MOVEMENT_MIN_USD;
    }

    if (title === 'whale buy' || title === 'whale sell' || type === 'whale buy' || type === 'whale sell') {
        return usdValue >= WHALE_TRADE_MIN_USD;
    }

    return true;
};

const normalizeActivityList = (activities: ImpactfulTokenActivity[]) =>
    activities.map(normalizeLegacyActivity).filter(isReportableActivity);

const persistStateNow = () => {
    if (persistTimer) {
        clearTimeout(persistTimer);
        persistTimer = null;
    }

    mkdirSync(DATA_DIR, { recursive: true });
    const payload: PersistedState = {
        watchedTokens: [...watchedTokens.values()],
        tokenActivities: [...tokenActivities.entries()].map(([key, activities]) => ({
            key,
            savedAt: tokenActivitySavedAt.get(key) || Date.now(),
            activities
        }))
    };
    writeFileSync(STATE_FILE, JSON.stringify(payload));
};

const persistState = () => {
    if (persistTimer) return;
    persistTimer = setTimeout(() => {
        persistStateNow();
    }, 750);
};

const loadState = () => {
    if (!existsSync(STATE_FILE)) return;

    try {
        const payload = JSON.parse(readFileSync(STATE_FILE, 'utf8')) as PersistedState;
        const now = Date.now();

        for (const watch of payload.watchedTokens || []) {
            if (watch.expiresAt > now) {
                watchedTokens.set(tokenKey(watch.chain, watch.tokenAddress), watch);
            }
        }

        for (const record of payload.tokenActivities || []) {
            tokenActivities.set(record.key, normalizeActivityList(record.activities || []).slice(0, MAX_EVENTS_PER_TOKEN));
            tokenActivitySavedAt.set(record.key, record.savedAt || now);
        }
    } catch {
        // Ignore malformed cache state and rebuild from fresh runtime data.
    }
};

loadState();

const cleanupExpiredWatches = () => {
    const now = Date.now();
    let changed = false;

    for (const [key, token] of watchedTokens.entries()) {
        if (token.expiresAt <= now) {
            watchedTokens.delete(key);
            changed = true;
        }
    }

    if (changed) persistState();
};

const getThresholds = (watch: WatchedToken) => {
    const liquidityThreshold = watch.liquidityUsd > 0 ? watch.liquidityUsd * 0.005 : 0;
    const whaleThreshold = Math.max(WHALE_TRADE_MIN_USD, liquidityThreshold || WHALE_TRADE_MIN_USD);
    const liquidityEventThreshold = Math.max(5_000, watch.liquidityUsd * 0.02);

    return {
        whaleThreshold,
        liquidityEventThreshold
    };
};

const isLiquidityKeyword = (candidate: ActivityCandidate) => {
    const text = `${candidate.eventName || ''} ${candidate.methodName || ''} ${candidate.category || ''} ${candidate.asset || ''}`;
    return /\bliquidity\b|\baddliquidity\b|\bremoveliquidity\b|\bmint\b|\bburn\b|\blp\b/i.test(text);
};

const classifyCandidate = (watch: WatchedToken, candidate: ActivityCandidate): ImpactfulTokenActivity | null => {
    const from = normalizeAddress(candidate.from);
    const to = normalizeAddress(candidate.to);
    const pair = normalizeAddress(watch.pairAddress);
    const usdValue = candidate.amount * watch.priceUsd;
    const thresholds = getThresholds(watch);
    const liquidityContext = Boolean(pair && (from === pair || to === pair) && isLiquidityKeyword(candidate));

    if (!candidate.amount || !Number.isFinite(candidate.amount)) return null;

    if (DEAD_ADDRESSES.has(to)) {
        const critical = usdValue >= thresholds.whaleThreshold * 3 || candidate.amount >= 1_000_000;
        return {
            id: `${candidate.txHash}:burn`,
            chain: watch.chain,
            tokenAddress: watch.tokenAddress,
            type: 'Burn',
            severity: critical ? 'High' : 'Signal',
            title: 'Token Burn',
            description: `${compactUsd(usdValue)} worth of tokens was burned.`,
            usdValue,
            tokenAmount: candidate.amount,
            wallet: from,
            txHash: candidate.txHash,
            detectedAt: candidate.timestamp
        };
    }

    if (DEAD_ADDRESSES.has(from)) {
        return {
            id: `${candidate.txHash}:mint`,
            chain: watch.chain,
            tokenAddress: watch.tokenAddress,
            type: 'Mint',
            severity: 'Critical',
            title: 'Token Mint',
            description: `${compactUsd(usdValue)} worth of new tokens was minted.`,
            usdValue,
            tokenAmount: candidate.amount,
            wallet: to,
            txHash: candidate.txHash,
            detectedAt: candidate.timestamp
        };
    }

    if (liquidityContext && to === pair && usdValue >= thresholds.liquidityEventThreshold) {
        return {
            id: `${candidate.txHash}:liquidity-added`,
            chain: watch.chain,
            tokenAddress: watch.tokenAddress,
            type: 'Liquidity Added',
            severity: usdValue >= thresholds.liquidityEventThreshold * 3 ? 'High' : 'Signal',
            title: 'Liquidity Added',
            description: `${compactUsd(usdValue)} in token-side liquidity moved into the primary pair.`,
            usdValue,
            tokenAmount: candidate.amount,
            wallet: from,
            txHash: candidate.txHash,
            detectedAt: candidate.timestamp
        };
    }

    if (liquidityContext && from === pair && usdValue >= thresholds.liquidityEventThreshold) {
        return {
            id: `${candidate.txHash}:liquidity-removed`,
            chain: watch.chain,
            tokenAddress: watch.tokenAddress,
            type: 'Liquidity Removed',
            severity: usdValue >= thresholds.liquidityEventThreshold * 2 ? 'Critical' : 'High',
            title: 'Liquidity Removed',
            description: `${compactUsd(usdValue)} in token-side liquidity moved out of the primary pair.`,
            usdValue,
            tokenAmount: candidate.amount,
            wallet: to,
            txHash: candidate.txHash,
            detectedAt: candidate.timestamp
        };
    }

    if (pair && from === pair && usdValue >= thresholds.whaleThreshold) {
        return {
            id: `${candidate.txHash}:buy`,
            chain: watch.chain,
            tokenAddress: watch.tokenAddress,
            type: 'Whale Buy',
            severity: usdValue >= thresholds.whaleThreshold * 3 ? 'High' : 'Signal',
            title: 'Whale Buy',
            description: `${compactUsd(usdValue)} buy detected from the primary liquidity pair.`,
            usdValue,
            tokenAmount: candidate.amount,
            wallet: to,
            txHash: candidate.txHash,
            detectedAt: candidate.timestamp
        };
    }

    if (pair && to === pair && usdValue >= thresholds.whaleThreshold) {
        return {
            id: `${candidate.txHash}:sell`,
            chain: watch.chain,
            tokenAddress: watch.tokenAddress,
            type: 'Whale Sell',
            severity: usdValue >= thresholds.whaleThreshold * 3 ? 'Critical' : 'High',
            title: 'Whale Sell',
            description: `${compactUsd(usdValue)} sell detected into the primary liquidity pair.`,
            usdValue,
            tokenAmount: candidate.amount,
            wallet: from,
            txHash: candidate.txHash,
            detectedAt: candidate.timestamp
        };
    }

    if (/ownership|blacklist|whitelist|pause|unpause|tax|fee|mint/i.test(`${candidate.eventName || ''} ${candidate.methodName || ''}`)) {
        return {
            id: `${candidate.txHash}:contract-risk`,
            chain: watch.chain,
            tokenAddress: watch.tokenAddress,
            type: 'Critical Contract Event',
            severity: 'Critical',
            title: 'Contract Risk Event',
            description: `Sensitive contract activity detected: ${candidate.eventName || candidate.methodName || 'contract state change'}.`,
            usdValue,
            tokenAmount: candidate.amount,
            wallet: from || to,
            txHash: candidate.txHash,
            detectedAt: candidate.timestamp
        };
    }

    if (usdValue >= LARGE_WALLET_MOVEMENT_MIN_USD) {
        return {
            id: `${candidate.txHash}:transfer`,
            chain: watch.chain,
            tokenAddress: watch.tokenAddress,
            type: 'Large Wallet Movement',
            severity: usdValue >= thresholds.whaleThreshold * 5 ? 'High' : 'Signal',
            title: 'Large Wallet Movement',
            description: `${compactUsd(usdValue)} moved between wallets.`,
            usdValue,
            tokenAmount: candidate.amount,
            wallet: from,
            txHash: candidate.txHash,
            detectedAt: candidate.timestamp
        };
    }

    return null;
};

const parseAmount = (activity: any) => {
    const rawValue = activity?.rawContract?.rawValue;
    const decimals = Number(activity?.rawContract?.decimals ?? activity?.erc20Metadata?.decimals ?? 18);

    if (rawValue && /^0x/i.test(String(rawValue))) {
        const value = Number(BigInt(rawValue));
        return value / Math.pow(10, Number.isFinite(decimals) ? decimals : 18);
    }

    return Number(activity?.value ?? activity?.amount ?? 0);
};

const extractCandidates = (payload: any): ActivityCandidate[] => {
    const activityItems = payload?.event?.activity || payload?.activity || payload?.event?.data?.activity || [];
    if (!Array.isArray(activityItems)) return [];

    return activityItems.map((activity: any) => ({
        tokenAddress: normalizeAddress(activity?.rawContract?.address || activity?.contractAddress || activity?.asset || activity?.address || ''),
        from: activity?.fromAddress || activity?.from || '',
        to: activity?.toAddress || activity?.to || '',
        amount: parseAmount(activity),
        txHash: activity?.hash || activity?.transactionHash || '',
        category: activity?.category || '',
        timestamp: activity?.metadata?.blockTimestamp ? new Date(activity.metadata.blockTimestamp).getTime() : Date.now(),
        asset: activity?.asset,
        direction: activity?.direction || 'unknown',
        eventName: activity?.eventName || activity?.event || activity?.log?.eventName,
        methodName: activity?.methodName || activity?.functionName || activity?.method
    })).filter((candidate) => candidate.tokenAddress && candidate.txHash);
};

const mergeActivities = (chain: string, tokenAddress: string, incoming: ImpactfulTokenActivity[]) => {
    const key = tokenKey(chain, tokenAddress);
    const existing = normalizeActivityList(tokenActivities.get(key) || []);
    const activityMap = new Map<string, ImpactfulTokenActivity>();

    [...existing, ...normalizeActivityList(incoming)].forEach((event) => {
        const eventKey = event.id || event.txHash;
        const previous = activityMap.get(eventKey);

        activityMap.set(eventKey, previous
            ? { ...previous, ...event, detectedAt: Math.min(previous.detectedAt, event.detectedAt) }
            : event
        );
    });

    const merged = [...activityMap.values()]
        .sort((a, b) => b.detectedAt - a.detectedAt)
        .slice(0, MAX_EVENTS_PER_TOKEN);

    tokenActivities.set(key, merged);
    tokenActivitySavedAt.set(key, Date.now());
    persistState();
    return merged;
};

const trimSupabaseActivities = async (chain: string, tokenAddress: string) => {
    const supabase = getSupabase();
    if (!supabase) return;

    const { data, error } = await supabase
        .from('token_impact_events')
        .select('event_key')
        .eq('chain', chain.toLowerCase())
        .eq('token_address', normalizeAddress(tokenAddress))
        .order('detected_at', { ascending: false })
        .range(MAX_EVENTS_PER_TOKEN, MAX_EVENTS_PER_TOKEN + 99);

    if (error) throw error;

    const staleKeys = (data || []).map((row: any) => row.event_key).filter(Boolean);
    if (staleKeys.length === 0) return;

    const { error: deleteError } = await supabase
        .from('token_impact_events')
        .delete()
        .in('event_key', staleKeys);

    if (deleteError) throw deleteError;
};

const persistSupabaseActivities = async (chain: string, tokenAddress: string, activities: ImpactfulTokenActivity[]) => {
    const supabase = getSupabase();
    if (!supabase || activities.length === 0) return;

    const rows: any[] = activities.map((activity) => toSupabaseRow(chain, tokenAddress, activity));
    const { error } = await supabase
        .from('token_impact_events')
        .upsert(rows, { onConflict: 'event_key' });

    if (error) throw error;

    await trimSupabaseActivities(chain, tokenAddress);
};

const storeActivities = (chain: string, tokenAddress: string, incoming: ImpactfulTokenActivity[]) => {
    const merged = mergeActivities(chain, tokenAddress, incoming);

    persistSupabaseActivities(chain, tokenAddress, incoming).catch((error) => {
        if (/Failed to fetch|fetch failed|network/i.test(error?.message || '')) {
            supabaseAvailable = false;
        }

        warnSupabaseOnce(`Supabase token impact event sync failed: ${formatSupabaseError(error)}. Apply supabase/token_impact_events.sql if the table is missing.`);
    });

    return merged;
};

const fetchSupabaseActivities = async (chain: string, tokenAddress: string) => {
    const supabase = getSupabase();
    if (!supabase) return null;

    const { data, error } = await supabase
        .from('token_impact_events')
        .select('*')
        .eq('chain', chain.toLowerCase())
        .eq('token_address', normalizeAddress(tokenAddress))
        .order('detected_at', { ascending: false })
        .limit(MAX_EVENTS_PER_TOKEN);

    if (error) throw error;

    const rows = (data || []) as any[];
    const activities = normalizeActivityList(rows.map(fromSupabaseRow));
    const key = tokenKey(chain, tokenAddress);
    tokenActivities.set(key, activities);
    const newestSavedAt = rows[0]?.saved_at ? new Date(rows[0].saved_at).getTime() : Date.now();
    tokenActivitySavedAt.set(key, activities.length ? newestSavedAt : (tokenActivitySavedAt.get(key) || 0));
    persistState();

    return activities;
};

const getWebhookId = (chain: string) => {
    const keys = CHAIN_TO_WEBHOOK_ID_ENV[chain.toLowerCase()] || ['ALCHEMY_ADDRESS_WEBHOOK_ID'];
    return readEnv(...keys);
};

const getAlchemyNetwork = (chain: string) => CHAIN_TO_ALCHEMY_NETWORK[chain.toLowerCase()] || '';

const addAddressesToAlchemyWebhook = async (watch: WatchedToken) => {
    const token = readEnv('ALCHEMY_NOTIFY_TOKEN', 'ALCHEMY_AUTH_TOKEN');
    if (!token) return { configured: false, error: 'ALCHEMY_NOTIFY_TOKEN is not configured.' };

    const webhookId = getWebhookId(watch.chain);
    if (!webhookId) return { configured: false, error: 'Alchemy address webhook id is not configured for this chain.' };

    const addresses = [...new Set([watch.tokenAddress, watch.pairAddress].filter(Boolean).map((address) => normalizeAddress(address)))];
    if (addresses.length === 0) return { configured: false, error: 'No addresses are available for webhook watching.' };

    const response = await fetch(`${ALCHEMY_NOTIFY_API}/update-webhook-addresses`, {
        method: 'PATCH',
        headers: {
            'Content-Type': 'application/json',
            'X-Alchemy-Token': token
        },
        body: JSON.stringify({
            webhook_id: webhookId,
            addresses_to_add: addresses,
            addresses_to_remove: []
        })
    });

    if (!response.ok) {
        const text = await response.text();
        return { configured: false, error: text.slice(0, 240) || `Alchemy webhook update failed with ${response.status}.` };
    }

    return { configured: true, webhookId, addresses };
};

const createAlchemyAddressWebhook = async (input: { chain: string; webhookUrl: string; name?: string; addresses?: string[] }) => {
    const token = readEnv('ALCHEMY_NOTIFY_TOKEN', 'ALCHEMY_AUTH_TOKEN');
    if (!token) throw new Error('ALCHEMY_NOTIFY_TOKEN is not configured.');

    const network = getAlchemyNetwork(input.chain);
    if (!network) throw new Error(`Alchemy Notify network is not configured for chain "${input.chain}".`);

    const response = await fetch(`${ALCHEMY_NOTIFY_API}/create-webhook`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-Alchemy-Token': token
        },
        body: JSON.stringify({
            network,
            webhook_type: 'ADDRESS_ACTIVITY',
            webhook_url: input.webhookUrl,
            name: input.name || `Atlaix ${network} Impact Activity`,
            addresses: input.addresses || []
        })
    });

    const text = await response.text();
    if (!response.ok) {
        throw new Error(text.slice(0, 240) || `Alchemy webhook creation failed with ${response.status}.`);
    }

    return text ? JSON.parse(text) : {};
};

export const ImpactfulTokenActivityStore = {
    watchToken: async (input: {
        chain?: string;
        tokenAddress?: string;
        pairAddress?: string;
        priceUsd?: number;
        liquidityUsd?: number;
        ttlMs?: number;
        configureWebhook?: boolean;
    }) => {
        const chain = String(input.chain || '').toLowerCase() || 'ethereum';
        const tokenAddress = normalizeAddress(input.tokenAddress);

        if (!tokenAddress) {
            throw new Error('Token address is required.');
        }

        const previous = watchedTokens.get(tokenKey(chain, tokenAddress));
        const watch: WatchedToken = {
            ...previous,
            chain,
            tokenAddress,
            pairAddress: input.pairAddress || previous?.pairAddress,
            priceUsd: Number(input.priceUsd ?? previous?.priceUsd ?? 0),
            liquidityUsd: Number(input.liquidityUsd ?? previous?.liquidityUsd ?? 0),
            expiresAt: Date.now() + Math.min(Math.max(Number(input.ttlMs || WATCH_TTL_MS), MIN_WATCH_MS), MAX_WATCH_MS)
        };

        if (input.configureWebhook !== false) {
            try {
                const result = await addAddressesToAlchemyWebhook(watch);
                watch.webhookConfigured = result.configured;
                watch.webhookError = result.error;
            } catch (error) {
                watch.webhookConfigured = false;
                watch.webhookError = error instanceof Error ? error.message : 'Alchemy webhook configuration failed.';
            }
        }

        watchedTokens.set(tokenKey(chain, tokenAddress), watch);
        persistState();
        return watch;
    },

    cacheActivities: (chain: string, tokenAddress: string, activities: ImpactfulTokenActivity[]) => {
        cleanupExpiredWatches();
        return storeActivities(chain, tokenAddress, activities);
    },

    getActivities: async (chain: string, tokenAddress: string) => {
        cleanupExpiredWatches();
        try {
            const supabaseActivities = await fetchSupabaseActivities(chain, tokenAddress);
            if (supabaseActivities) return supabaseActivities;
        } catch (error) {
            if (/Failed to fetch|fetch failed|network/i.test(error instanceof Error ? error.message : '')) {
                supabaseAvailable = false;
            }

            warnSupabaseOnce(`Supabase token impact event read failed: ${formatSupabaseError(error)}. Falling back to local token activity cache.`);
        }

        return normalizeActivityList(tokenActivities.get(tokenKey(chain, tokenAddress)) || []);
    },

    getActivitySource: () => {
        return supabaseAvailable && getSupabase() ? 'supabase' : 'local-fallback';
    },

    getActivityMetadata: (chain: string, tokenAddress: string) => {
        cleanupExpiredWatches();
        const key = tokenKey(chain, tokenAddress);
        const savedAt = tokenActivitySavedAt.get(key) || 0;
        const activities = normalizeActivityList(tokenActivities.get(key) || []);

        return {
            savedAt,
            expiresAt: 0,
            maxEvents: MAX_EVENTS_PER_TOKEN,
            version: activities.map((activity) => activity.id || activity.txHash).join('|')
        };
    },

    ingestAlchemyWebhook: (payload: unknown) => {
        cleanupExpiredWatches();
        const candidates = extractCandidates(payload);
        const admitted: ImpactfulTokenActivity[] = [];

        for (const candidate of candidates) {
            for (const watch of watchedTokens.values()) {
                const tokenMatches = normalizeAddress(watch.tokenAddress) === candidate.tokenAddress;
                const pairMatches = Boolean(watch.pairAddress && normalizeAddress(watch.pairAddress) === candidate.tokenAddress);
                if (!tokenMatches && !pairMatches) continue;

                const normalizedCandidate = pairMatches ? { ...candidate, tokenAddress: normalizeAddress(watch.tokenAddress) } : candidate;
                const event = classifyCandidate(watch, normalizedCandidate);
                if (!event) continue;

                storeActivities(watch.chain, watch.tokenAddress, [event]);
                admitted.push(event);
            }
        }

        return {
            received: candidates.length,
            admitted
        };
    },

    createAlchemyWebhook: createAlchemyAddressWebhook,

    getWatchStats: () => {
        cleanupExpiredWatches();
        return {
            watchedTokens: watchedTokens.size,
            storedActivityTokens: tokenActivities.size,
            durableCache: STATE_FILE
        };
    }
};
