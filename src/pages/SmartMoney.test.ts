// Regression coverage for shared Smart Money wallet behavior.
import { describe, expect, it } from 'vitest';
import { SavedWallet } from '../types';
import { mergeSmartMoneyWallets } from './SmartMoney';

const wallet = (patch: Partial<SavedWallet>): SavedWallet => ({
    addr: '0x0000000000000000000000000000000000000001',
    name: 'Wallet',
    categories: ['Smart Money'],
    timestamp: 1,
    qualification: {
        score: 70,
        qualified: true,
        reasons: ['Qualified'],
        evaluatedAt: 1,
        metrics: {
            netWorthUsd: 100000,
            winRate: 60,
            pnlPercent: 20,
            activePositions: 4,
            profitablePositions: 3
        }
    },
    ...patch
});

describe('mergeSmartMoneyWallets', () => {
    it('keeps backend-approved shared wallets and ignores local qualified wallets', () => {
        const shared = wallet({ addr: '0x1111111111111111111111111111111111111111', name: 'Shared Alpha' });
        const local = wallet({ addr: '0x2222222222222222222222222222222222222222', name: 'Local Alpha' });

        const merged = mergeSmartMoneyWallets([shared], [local]);

        expect(merged.map((entry) => entry.addr)).toEqual([shared.addr]);
    });

    it('dedupes shared wallets and keeps the strongest backend qualification score', () => {
        const shared = wallet({
            addr: '0x3333333333333333333333333333333333333333',
            name: 'Shared Wallet',
            qualification: {
                ...wallet({}).qualification!,
                score: 72
            }
        });
        const local = wallet({
            addr: '0x3333333333333333333333333333333333333333',
            name: 'Local Wallet',
            qualification: {
                ...wallet({}).qualification!,
                score: 91
            }
        });

        const merged = mergeSmartMoneyWallets([shared], [local]);

        expect(merged).toHaveLength(1);
        expect(merged[0].qualification?.score).toBe(72);
        expect(merged[0].categories).toContain('Smart Money');
    });
});
