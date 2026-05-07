// Vite environment type declarations for the frontend runtime.
/// <reference types="vite/client" />

interface ImportMetaEnv {
    readonly VITE_SUPABASE_URL: string
    readonly VITE_SUPABASE_ANON_KEY: string
    readonly SUPABASE_URL: string
    readonly SUPABASE_ANON_KEY: string
    readonly VITE_API_BASE_URL: string
}

interface ImportMeta {
    readonly env: ImportMetaEnv
}

declare const __ATLAIX_PUBLIC_SUPABASE_URL__: string
declare const __ATLAIX_PUBLIC_SUPABASE_ANON_KEY__: string
