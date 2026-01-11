import { SavedWallet, WalletCategory } from '../types';

const STORAGE_KEY = 'atlaix_saved_wallets';

export const SavedWalletService = {
    getWallets: (): SavedWallet[] => {
        try {
            const data = localStorage.getItem(STORAGE_KEY);
            // Migration: If old format (single category) exists, convert it? 
            // For now, simple parse. Since interface changed, old data might look like { category: '...' }
            // We should safely handle that in UI or migration here. 
            // Ideally wipe or migrate, but let's just parse.
            const parsed = data ? JSON.parse(data) : [];
            return parsed.map((w: any) => ({
                ...w,
                categories: w.categories || (w.category ? [w.category] : [])
            }));
        } catch (e) {
            console.error("Failed to load saved wallets", e);
            return [];
        }
    },

    saveWallet: (addr: string, name: string, categories: WalletCategory[]) => {
        try {
            const wallets = SavedWalletService.getWallets();
            const existingIndex = wallets.findIndex(w => w.addr.toLowerCase() === addr.toLowerCase());

            const newWallet: SavedWallet = {
                addr,
                name,
                categories,
                timestamp: existingIndex !== -1 ? wallets[existingIndex].timestamp : Date.now(),
                lastBalance: existingIndex !== -1 ? wallets[existingIndex].lastBalance : undefined,
                lastWinRate: existingIndex !== -1 ? wallets[existingIndex].lastWinRate : undefined,
                lastPnl: existingIndex !== -1 ? wallets[existingIndex].lastPnl : undefined
            };

            if (existingIndex !== -1) {
                wallets[existingIndex] = newWallet;
            } else {
                wallets.push(newWallet);
            }

            localStorage.setItem(STORAGE_KEY, JSON.stringify(wallets));
            return newWallet;
        } catch (e) {
            console.error("Failed to save wallet", e);
            throw e;
        }
    },

    updateWalletStats: (addr: string, stats: { bal?: string, win?: string, pnl?: string }) => {
        try {
            const wallets = SavedWalletService.getWallets();
            const index = wallets.findIndex(w => w.addr.toLowerCase() === addr.toLowerCase());

            if (index !== -1) {
                wallets[index] = {
                    ...wallets[index],
                    lastBalance: stats.bal || wallets[index].lastBalance,
                    lastWinRate: stats.win || wallets[index].lastWinRate,
                    lastPnl: stats.pnl || wallets[index].lastPnl
                };
                localStorage.setItem(STORAGE_KEY, JSON.stringify(wallets));
            }
        } catch (e) {
            console.error("Failed to update wallet stats", e);
        }
    },

    deleteWallet: (addr: string) => {
        try {
            const wallets = SavedWalletService.getWallets();
            const filtered = wallets.filter(w => w.addr.toLowerCase() !== addr.toLowerCase());
            localStorage.setItem(STORAGE_KEY, JSON.stringify(filtered));
        } catch (e) {
            console.error("Failed to delete wallet", e);
        }
    },

    getWallet: (addr: string): SavedWallet | undefined => {
        const wallets = SavedWalletService.getWallets();
        return wallets.find(w => w.addr.toLowerCase() === addr.toLowerCase());
    }
};
