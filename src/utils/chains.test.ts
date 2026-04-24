import { describe, expect, it } from 'vitest';
import { PROFILE_CHAIN_OPTIONS, normalizeWalletChain } from './chains';

describe('chain utilities', () => {
    it('normalizes supported chain values from URLs', () => {
        expect(normalizeWalletChain('base')).toBe('Base');
        expect(normalizeWalletChain('ALL CHAINS')).toBe('All Chains');
        expect(normalizeWalletChain('unknown')).toBe('All Chains');
    });

    it('keeps wallet profile chain options aligned with supported chains', () => {
        expect(PROFILE_CHAIN_OPTIONS).toContain('Optimism');
        expect(PROFILE_CHAIN_OPTIONS).toContain('Polygon');
        expect(PROFILE_CHAIN_OPTIONS).toContain('Avalanche');
        expect(PROFILE_CHAIN_OPTIONS).toContain('Solana');
    });
});
