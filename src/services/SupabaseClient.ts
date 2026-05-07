// Shared browser Supabase client for authenticated user workflows.
import { createClient } from '@supabase/supabase-js';
import { APP_CONFIG } from '../config';

export const hasAuthSupabaseConfig = Boolean(APP_CONFIG.supabaseUrl && APP_CONFIG.supabaseAnonKey);

export const authSupabase = hasAuthSupabaseConfig
    ? createClient(APP_CONFIG.supabaseUrl, APP_CONFIG.supabaseAnonKey, {
        auth: {
            persistSession: true,
            autoRefreshToken: true,
            detectSessionInUrl: true
        }
    })
    : null;

