// Supabase-backed authentication state for Atlaix.
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { Session, User } from '@supabase/supabase-js';
import { ProfileService, ProfileUpdate, UserProfile } from '../services/ProfileService';
import { authSupabase, hasAuthSupabaseConfig } from '../services/SupabaseClient';

interface AuthContextValue {
    user: User | null;
    session: Session | null;
    profile: UserProfile | null;
    loading: boolean;
    profileError: string | null;
    signIn: (email: string, password: string) => Promise<void>;
    signUp: (email: string, password: string, displayName?: string) => Promise<{ needsEmailConfirmation: boolean }>;
    signInWithGoogle: () => Promise<void>;
    signOut: () => Promise<void>;
    resetPassword: (email: string) => Promise<void>;
    updateProfile: (update: ProfileUpdate) => Promise<void>;
    refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const requireSupabase = () => {
    if (!authSupabase) {
        throw new Error('Sign in is temporarily unavailable. Please try again later.');
    }
    return authSupabase;
};

const getDisplayName = (user: User) => {
    const metadata = user.user_metadata || {};
    return String(metadata.display_name || metadata.full_name || metadata.name || user.email?.split('@')[0] || 'Atlaix User');
};

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [session, setSession] = useState<Session | null>(null);
    const [user, setUser] = useState<User | null>(null);
    const [profile, setProfile] = useState<UserProfile | null>(null);
    const [loading, setLoading] = useState(true);
    const [profileError, setProfileError] = useState<string | null>(null);

    const loadProfile = useCallback(async (nextUser: User | null) => {
        if (!nextUser) {
            setProfile(null);
            setProfileError(null);
            return;
        }

        try {
            const ensured = await ProfileService.ensureProfile({
                id: nextUser.id,
                email: nextUser.email || '',
                displayName: getDisplayName(nextUser)
            });
            setProfile(ensured);
            setProfileError(null);
        } catch (error: any) {
            setProfile(null);
            setProfileError(error?.message || 'Profile could not be loaded.');
        }
    }, []);

    useEffect(() => {
        let mounted = true;

        if (!authSupabase) {
            setLoading(false);
            return;
        }

        authSupabase.auth.getSession().then(async ({ data }) => {
            if (!mounted) return;
            const nextSession = data.session;
            setSession(nextSession);
            setUser(nextSession?.user || null);
            await loadProfile(nextSession?.user || null);
            if (mounted) setLoading(false);
        }).catch((error) => {
            console.error('Auth session load failed', error);
            if (mounted) setLoading(false);
        });

        const { data: listener } = authSupabase.auth.onAuthStateChange((_event, nextSession) => {
            setSession(nextSession);
            setUser(nextSession?.user || null);
            loadProfile(nextSession?.user || null);
        });

        return () => {
            mounted = false;
            listener.subscription.unsubscribe();
        };
    }, [loadProfile]);

    const signIn = useCallback(async (email: string, password: string) => {
        const supabase = requireSupabase();
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
    }, []);

    const signUp = useCallback(async (email: string, password: string, displayName?: string) => {
        const supabase = requireSupabase();
        const { data, error } = await supabase.auth.signUp({
            email,
            password,
            options: {
                data: { display_name: displayName || email.split('@')[0] },
                emailRedirectTo: `${window.location.origin}/dashboard`
            }
        });
        if (error) throw error;
        return { needsEmailConfirmation: Boolean(data.user && !data.session) };
    }, []);

    const signInWithGoogle = useCallback(async () => {
        const supabase = requireSupabase();
        const { error } = await supabase.auth.signInWithOAuth({
            provider: 'google',
            options: { redirectTo: `${window.location.origin}/dashboard` }
        });
        if (error) throw error;
    }, []);

    const signOut = useCallback(async () => {
        const supabase = requireSupabase();
        const { error } = await supabase.auth.signOut();
        if (error) throw error;
        setProfile(null);
    }, []);

    const resetPassword = useCallback(async (email: string) => {
        const supabase = requireSupabase();
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
            redirectTo: `${window.location.origin}/login`
        });
        if (error) throw error;
    }, []);

    const refreshProfile = useCallback(async () => {
        await loadProfile(user);
    }, [loadProfile, user]);

    const updateProfile = useCallback(async (update: ProfileUpdate) => {
        if (!user) throw new Error('You need to be signed in to update your profile.');
        const nextProfile = await ProfileService.updateProfile(user.id, update);
        setProfile(nextProfile);
    }, [user]);

    const value = useMemo<AuthContextValue>(() => ({
        user,
        session,
        profile,
        loading,
        profileError: hasAuthSupabaseConfig ? profileError : 'Account access is temporarily unavailable.',
        signIn,
        signUp,
        signInWithGoogle,
        signOut,
        resetPassword,
        updateProfile,
        refreshProfile
    }), [loading, profile, profileError, refreshProfile, resetPassword, session, signIn, signInWithGoogle, signOut, signUp, updateProfile, user]);

    return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = () => {
    const context = useContext(AuthContext);
    if (!context) throw new Error('useAuth must be used inside AuthProvider');
    return context;
};
