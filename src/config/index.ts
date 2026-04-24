const env = ((typeof import.meta !== 'undefined' && (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env) || {}) as Record<string, string | undefined>;
const processEnv = (typeof process !== 'undefined' ? process.env : {}) as Record<string, string | undefined>;

const readEnv = (...values: Array<string | undefined>) => {
    for (const value of values) {
        const trimmed = value?.trim();
        if (trimmed) return trimmed;
    }
    return '';
};

export const APP_CONFIG = {
    goplusAppKey: readEnv(env.VITE_GOPLUS_KEY, processEnv.VITE_GOPLUS_KEY),
    goplusAppSecret: readEnv(env.VITE_GOPLUS_SECRET, processEnv.VITE_GOPLUS_SECRET),

    // 1. SUPABASE (The Vault)
    supabaseUrl: readEnv(env.VITE_SUPABASE_URL, processEnv.VITE_SUPABASE_URL),

    // The "Public" Key (Safe for client-side reading)
    supabaseAnonKey: readEnv(env.VITE_SUPABASE_ANON_KEY, processEnv.VITE_SUPABASE_ANON_KEY),

    // 2. MORALIS (The Deep Dive Data)
    moralisKey: readEnv(env.VITE_MORALIS_KEY, processEnv.VITE_MORALIS_KEY),

    // 2.5 HELIUS (Solana-first forensic RPC)
    heliusKey: readEnv(env.VITE_HELIUS_KEY, processEnv.VITE_HELIUS_KEY, processEnv.HELIUS_API_KEY),

    // 3. ALCHEMY (Robust Fallback)
    alchemyKey: readEnv(env.VITE_ALCHEMY_KEY, processEnv.VITE_ALCHEMY_KEY)
};
