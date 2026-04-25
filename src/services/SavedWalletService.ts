import { SavedWallet, WalletCategory } from '../types';
import { WalletStats } from '../hooks/useWalletPortfolio';
import { SmartMoneyQualificationService } from './SmartMoneyQualificationService';
import { DatabaseService } from './DatabaseService';

const STORAGE_KEY = 'atlaix_saved_wallets';

const persistWallets = (wallets: SavedWallet[]) => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(wallets));
};

const withLegacyMigration = (wallet: any): SavedWallet => ({
    ...wallet,
    categories: wallet.categories || (wallet.category ? [wallet.category] : []),
    autoTracked: wallet.autoTracked || false,
    autoPromotedToSmartMoney: wallet.autoPromotedToSmartMoney || false
});

const buildAutoTrackedName = (addr: string) => `Tracked ${addr.slice(0, 6)}...${addr.slice(-4)}`;

export const SavedWalletService = {
    getWallets: (): SavedWallet[] => {
        try {
            const data = localStorage.getItem(STORAGE_KEY);
            const parsed = data ? JSON.parse(data) : [];
            return parsed.map((w: any) => withLegacyMigration(w));
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
                lastPnl: existingIndex !== -1 ? wallets[existingIndex].lastPnl : undefined,
                qualification: existingIndex !== -1 ? wallets[existingIndex].qualification : undefined,
                autoTracked: existingIndex !== -1 ? wallets[existingIndex].autoTracked : false,
                autoPromotedToSmartMoney: existingIndex !== -1 ? wallets[existingIndex].autoPromotedToSmartMoney : false
            };

            if (existingIndex !== -1) {
                wallets[existingIndex] = newWallet;
            } else {
                wallets.push(newWallet);
            }

            persistWallets(wallets);
            return newWallet;
        } catch (e) {
            console.error("Failed to save wallet", e);
            throw e;
        }
    },

    ensureTrackedWallet: (addr: string, name?: string) => {
        try {
            const wallets = SavedWalletService.getWallets();
            const existingIndex = wallets.findIndex(w => w.addr.toLowerCase() === addr.toLowerCase());

            if (existingIndex !== -1) {
                if (!wallets[existingIndex].name?.trim()) {
                    wallets[existingIndex] = {
                        ...wallets[existingIndex],
                        name: name?.trim() || buildAutoTrackedName(addr)
                    };
                    persistWallets(wallets);
                }
                return wallets[existingIndex];
            }

            const wallet: SavedWallet = {
                addr,
                name: name?.trim() || buildAutoTrackedName(addr),
                categories: [],
                timestamp: Date.now(),
                autoTracked: true,
                autoPromotedToSmartMoney: false
            };

            wallets.push(wallet);
            persistWallets(wallets);
            return wallet;
        } catch (e) {
            console.error("Failed to ensure tracked wallet", e);
            throw e;
        }
    },

    updateWalletStats: (addr: string, stats: { bal?: string, win?: string, pnl?: string }, walletStats?: WalletStats) => {
        try {
            const wallets = SavedWalletService.getWallets();
            const index = wallets.findIndex(w => w.addr.toLowerCase() === addr.toLowerCase());

            if (index !== -1) {
                const qualification = walletStats ? SmartMoneyQualificationService.evaluate(walletStats) : wallets[index].qualification;
                const existingCategories = wallets[index].categories || [];
                const nextCategories: WalletCategory[] = qualification?.qualified && !existingCategories.includes('Smart Money')
                    ? [...existingCategories, 'Smart Money']
                    : existingCategories;
                const nextBalance = stats.bal || wallets[index].lastBalance;
                const nextWinRate = stats.win || wallets[index].lastWinRate;
                const nextPnl = stats.pnl || wallets[index].lastPnl;
                const qualificationChanged = JSON.stringify(wallets[index].qualification || null) !== JSON.stringify(qualification || null);
                const categoriesChanged = JSON.stringify(existingCategories) !== JSON.stringify(nextCategories);
                const hasChanged =
                    wallets[index].lastBalance !== nextBalance ||
                    wallets[index].lastWinRate !== nextWinRate ||
                    wallets[index].lastPnl !== nextPnl ||
                    qualificationChanged ||
                    categoriesChanged ||
                    (qualification?.qualified ? true : wallets[index].autoPromotedToSmartMoney) !== wallets[index].autoPromotedToSmartMoney;

                if (!hasChanged) {
                    return false;
                }

                wallets[index] = {
                    ...wallets[index],
                    lastBalance: nextBalance,
                    lastWinRate: nextWinRate,
                    lastPnl: nextPnl,
                    qualification,
                    categories: nextCategories,
                    autoPromotedToSmartMoney: qualification?.qualified ? true : wallets[index].autoPromotedToSmartMoney
                };
                persistWallets(wallets);

                if (qualification?.qualified) {
                    DatabaseService.upsertSmartMoneyWallet(wallets[index]).catch((error) => {
                        console.warn('Smart money sync skipped:', error instanceof Error ? error.message : error);
                    });
                }

                return true;
            }
        } catch (e) {
            console.error("Failed to update wallet stats", e);
        }

        return false;
    },

    deleteWallet: (addr: string) => {
        try {
            const wallets = SavedWalletService.getWallets();
            const filtered = wallets.filter(w => w.addr.toLowerCase() !== addr.toLowerCase());
            persistWallets(filtered);
        } catch (e) {
            console.error("Failed to delete wallet", e);
        }
    },

    getWallet: (addr: string): SavedWallet | undefined => {
        const wallets = SavedWalletService.getWallets();
        return wallets.find(w => w.addr.toLowerCase() === addr.toLowerCase());
    },

    getSmartMoneyWallets: (): SavedWallet[] => {
        return SavedWalletService.getWallets()
            .filter(wallet => wallet.qualification?.qualified || wallet.categories.includes('Smart Money'))
            .sort((a, b) => (b.qualification?.score || 0) - (a.qualification?.score || 0));
    }
};
