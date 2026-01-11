/// <reference types="vite/client" />

interface ImportMetaEnv {
    readonly VITE_MORALIS_KEY: string
    readonly VITE_ALCHEMY_KEY: string
    readonly VITE_GOPLUS_KEY: string
    readonly VITE_GOPLUS_SECRET: string
    readonly VITE_SUPABASE_URL: string
    readonly VITE_SUPABASE_ANON_KEY: string
    readonly VITE_SUPABASE_SERVICE_KEY: string
    readonly VITE_HELIUS_API_KEY: string
}

interface ImportMeta {
    readonly env: ImportMetaEnv
}
