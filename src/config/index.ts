// Centralized browser configuration for provider keys and endpoints.
const env = ((typeof import.meta !== 'undefined' && (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env) || {}) as Record<string, string | undefined>;
const processEnv = (typeof process !== 'undefined' ? process.env : {}) as Record<string, string | undefined>;
const isBrowser = typeof window !== 'undefined';

const readEnv = (...values: Array<string | undefined>) => {
    for (const value of values) {
        const trimmed = value?.trim();
        if (trimmed) return trimmed;
    }
    return '';
};

const readBackendEnv = (...values: Array<string | undefined>) => isBrowser ? '' : readEnv(...values);

const readUrlEnv = (...values: Array<string | undefined>) => {
    const value = readEnv(...values);
    const normalized = value.replace(/^[A-Z0-9_]+=https?:\/\//i, (match) => match.slice(match.indexOf('http')));
    return normalized.replace(/\/+$/, '');
};

export const APP_CONFIG = {
    goplusAppKey: readBackendEnv(processEnv.GOPLUS_KEY),
    goplusAppSecret: readBackendEnv(processEnv.GOPLUS_SECRET),

    // 1. SUPABASE (The Vault)
    supabaseUrl: readEnv(env.VITE_SUPABASE_URL, processEnv.VITE_SUPABASE_URL),

    // The "Public" Key (Safe for client-side reading)
    supabaseAnonKey: readEnv(env.VITE_SUPABASE_ANON_KEY, processEnv.VITE_SUPABASE_ANON_KEY),

    // Optional production backend origin, e.g. https://atlaix-backend.up.railway.app
    apiBaseUrl: readUrlEnv(env.VITE_API_BASE_URL, processEnv.VITE_API_BASE_URL),

    // 2. MORALIS (The Deep Dive Data)
    moralisKey: readBackendEnv(processEnv.MORALIS_API_KEY),

    // 2.5 HELIUS (Solana-first forensic RPC)
    heliusKey: readBackendEnv(processEnv.HELIUS_API_KEY),

    // 3. ALCHEMY (Robust Fallback)
    alchemyKey: readBackendEnv(processEnv.ALCHEMY_API_KEY)
};
