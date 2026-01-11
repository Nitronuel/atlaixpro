export const APP_CONFIG = {
    goplusAppKey: import.meta.env.VITE_GOPLUS_KEY || '',
    goplusAppSecret: import.meta.env.VITE_GOPLUS_SECRET || '',

    // 1. SUPABASE (The Vault)
    supabaseUrl: import.meta.env.VITE_SUPABASE_URL || '',

    // The "Public" Key (Safe for client-side reading)
    supabaseAnonKey: import.meta.env.VITE_SUPABASE_ANON_KEY || '',

    // The "Secret" Key (In a real app, this should only be on server/edge function)
    supabaseServiceKey: import.meta.env.VITE_SUPABASE_SERVICE_KEY || '',

    // 2. MORALIS (The Deep Dive Data)
    moralisKey: import.meta.env.VITE_MORALIS_KEY || '',

    // 3. ALCHEMY (Robust Fallback)
    alchemyKey: import.meta.env.VITE_ALCHEMY_KEY || '',

    // 4. HELIUS (Solana RPC)
    heliusKey: import.meta.env.VITE_HELIUS_API_KEY || ''
};
