// Backend-backed Smart Money workflows. The browser can keep personal watchlists,
// but global Smart Money qualification is decided by the server.
import { APP_CONFIG } from '../config';
import { SavedWallet } from '../types';

const apiUrl = (path: string) => APP_CONFIG.apiBaseUrl
    ? `${APP_CONFIG.apiBaseUrl.replace(/\/$/, '')}${path}`
    : path;

const fetchJson = async <T>(path: string, init?: RequestInit): Promise<T> => {
    const response = await fetch(apiUrl(path), {
        ...init,
        headers: {
            'Content-Type': 'application/json',
            ...(init?.headers || {})
        }
    });
    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
        throw new Error(payload?.error || 'Smart Money request failed.');
    }

    return payload as T;
};

export const SmartMoneyService = {
    listWallets: async (): Promise<SavedWallet[]> => {
        const payload = await fetchJson<{ wallets?: SavedWallet[] }>('/api/smart-money/wallets');
        return payload.wallets || [];
    },

    scanWallet: async (walletAddress: string, chain?: string) => {
        return fetchJson<{
            wallet: SavedWallet | null;
            excluded: boolean;
            qualified: boolean;
            message?: string;
        }>('/api/smart-money/track-wallet', {
            method: 'POST',
            body: JSON.stringify({ walletAddress, chain })
        });
    },

    excludeWallet: async (walletAddress: string, reason?: string) => {
        return fetchJson<{ walletAddress: string; excluded: boolean }>('/api/smart-money/exclude-wallet', {
            method: 'POST',
            body: JSON.stringify({ walletAddress, reason })
        });
    }
};
