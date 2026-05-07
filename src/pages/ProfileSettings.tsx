// Account profile settings for authenticated Atlaix users.
import React, { useEffect, useState } from 'react';
import { AlertCircle, Check, Shield, User, WalletCards } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';

const CHAIN_OPTIONS = [
    { value: 'solana', label: 'Solana' },
    { value: 'ethereum', label: 'Ethereum' },
    { value: 'base', label: 'Base' },
    { value: 'bsc', label: 'BSC' }
];

export const ProfileSettings: React.FC = () => {
    const { user, profile, profileError, updateProfile, refreshProfile } = useAuth();
    const [displayName, setDisplayName] = useState('');
    const [preferredChain, setPreferredChain] = useState('solana');
    const [saving, setSaving] = useState(false);
    const [status, setStatus] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        setDisplayName(profile?.display_name || '');
        setPreferredChain(profile?.preferred_chain || 'solana');
    }, [profile]);

    const handleSubmit = async (event: React.FormEvent) => {
        event.preventDefault();
        setSaving(true);
        setStatus(null);
        setError(null);

        try {
            await updateProfile({
                display_name: displayName.trim() || 'Atlaix User',
                preferred_chain: preferredChain
            });
            setStatus('Profile updated.');
        } catch (err: any) {
            setError(err?.message || 'Could not update profile.');
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="mx-auto max-w-5xl space-y-5">
            {profileError && (
                <div className="flex items-start gap-3 rounded-lg border border-primary-yellow/30 bg-primary-yellow/10 p-4 text-sm text-primary-yellow">
                    <AlertCircle size={18} className="mt-0.5 shrink-0" />
                    <div>
                        <div className="font-bold text-text-light">Profile storage needs attention</div>
                        <div className="mt-1 text-primary-yellow">{profileError}</div>
                    </div>
                </div>
            )}

            <section className="grid gap-4 lg:grid-cols-[1.15fr_0.85fr]">
                <form onSubmit={handleSubmit} className="rounded-lg border border-border bg-card p-5">
                    <div className="mb-5 flex items-center gap-3">
                        <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary-green/10 text-primary-green">
                            <User size={20} />
                        </span>
                        <div>
                            <h2 className="text-lg font-bold text-text-light">Profile</h2>
                            <p className="text-sm text-text-medium">Manage the identity used across your Atlaix workspace.</p>
                        </div>
                    </div>

                    <div className="space-y-4">
                        <label className="block">
                            <span className="mb-2 block text-xs font-bold uppercase tracking-[0.16em] text-text-dark">Display name</span>
                            <input
                                value={displayName}
                                onChange={(event) => setDisplayName(event.target.value)}
                                className="w-full rounded-lg border border-border bg-main px-4 py-3 text-text-light outline-none transition-colors focus:border-primary-green"
                                placeholder="Atlaix User"
                            />
                        </label>

                        <label className="block">
                            <span className="mb-2 block text-xs font-bold uppercase tracking-[0.16em] text-text-dark">Email</span>
                            <input
                                value={user?.email || ''}
                                disabled
                                className="w-full rounded-lg border border-border bg-main/60 px-4 py-3 text-text-medium outline-none"
                            />
                        </label>

                        <label className="block">
                            <span className="mb-2 block text-xs font-bold uppercase tracking-[0.16em] text-text-dark">Preferred chain</span>
                            <select
                                value={preferredChain}
                                onChange={(event) => setPreferredChain(event.target.value)}
                                className="w-full rounded-lg border border-border bg-main px-4 py-3 text-text-light outline-none transition-colors focus:border-primary-green"
                            >
                                {CHAIN_OPTIONS.map((chain) => (
                                    <option key={chain.value} value={chain.value}>{chain.label}</option>
                                ))}
                            </select>
                        </label>
                    </div>

                    <div className="mt-5 flex flex-wrap items-center gap-3">
                        <button
                            type="submit"
                            disabled={saving}
                            className="rounded-lg bg-primary-green px-5 py-3 text-sm font-bold text-main transition-colors hover:bg-primary-green-light disabled:cursor-not-allowed disabled:opacity-60"
                        >
                            {saving ? 'Saving...' : 'Save profile'}
                        </button>
                        <button
                            type="button"
                            onClick={refreshProfile}
                            className="rounded-lg border border-border px-5 py-3 text-sm font-bold text-text-medium transition-colors hover:border-primary-green hover:text-text-light"
                        >
                            Refresh
                        </button>
                        {status && <span className="flex items-center gap-2 text-sm font-semibold text-primary-green"><Check size={16} />{status}</span>}
                        {error && <span className="text-sm font-semibold text-primary-red">{error}</span>}
                    </div>
                </form>

                <aside className="space-y-4">
                    <div className="rounded-lg border border-border bg-card p-5">
                        <div className="mb-4 flex items-center gap-3">
                            <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary-purple/20 text-primary-purple">
                                <Shield size={20} />
                            </span>
                            <div>
                                <h2 className="text-lg font-bold text-text-light">Access</h2>
                                <p className="text-sm text-text-medium">Current workspace permission level.</p>
                            </div>
                        </div>
                        <div className="space-y-3 text-sm">
                            <div className="flex items-center justify-between border-b border-border/60 pb-3">
                                <span className="text-text-medium">Plan</span>
                                <span className="rounded bg-primary-green/10 px-2 py-1 text-xs font-bold uppercase text-primary-green">{profile?.plan || 'free'}</span>
                            </div>
                            <div className="flex items-center justify-between">
                                <span className="text-text-medium">Role</span>
                                <span className="font-bold capitalize text-text-light">{profile?.role || 'user'}</span>
                            </div>
                        </div>
                    </div>

                    <div className="rounded-lg border border-border bg-card p-5">
                        <div className="mb-3 flex items-center gap-3">
                            <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary-blue/15 text-primary-blue">
                                <WalletCards size={20} />
                            </span>
                            <h2 className="text-lg font-bold text-text-light">Next Personalization</h2>
                        </div>
                        <div className="space-y-2 text-sm text-text-medium">
                            <div>Watchlists, saved filters, alerts, tracked wallets, and recent tokens now have a database schema ready for user-owned storage.</div>
                        </div>
                    </div>
                </aside>
            </section>
        </div>
    );
};

