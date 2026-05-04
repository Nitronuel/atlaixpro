import { describe, expect, it } from 'vitest';
import { classifyAlphaToken, isExcludedAlphaToken } from './tokenFilters';

describe('alpha token hygiene filters', () => {
    it('removes stablecoins from the alpha feed', () => {
        expect(classifyAlphaToken({ ticker: 'PYUSD', name: 'PayPal USD', chain: 'solana' })).toMatchObject({
            excluded: true,
            reason: 'stablecoin'
        });
        expect(isExcludedAlphaToken({ ticker: 'USDC', name: 'USD Coin', chain: 'base' })).toBe(true);
        expect(isExcludedAlphaToken({ ticker: 'JUPUSD', name: 'Jupiter USD', chain: 'solana' })).toBe(true);
    });

    it('removes wrapped and bridged major assets', () => {
        expect(classifyAlphaToken({ ticker: 'WETH', name: 'Wrapped Ether', chain: 'solana' })).toMatchObject({
            excluded: true,
            reason: 'wrapped'
        });
        expect(isExcludedAlphaToken({ ticker: 'WBTC', name: 'Wrapped BTC', chain: 'ethereum' })).toBe(true);
        expect(isExcludedAlphaToken({ ticker: 'cbBTC', name: 'Coinbase Wrapped BTC', chain: 'base' })).toBe(true);
        expect(isExcludedAlphaToken({ ticker: 'cbXRP', name: 'Coinbase Wrapped XRP', chain: 'base' })).toBe(true);
        expect(isExcludedAlphaToken({ ticker: 'cbMEGA', name: 'Coinbase Wrapped Mega', chain: 'base' })).toBe(true);
    });

    it('removes chain-native majors from discovery feeds', () => {
        expect(classifyAlphaToken({ ticker: 'ETH', name: 'Ethereum Token', chain: 'bsc' })).toMatchObject({
            excluded: true,
            reason: 'major_asset'
        });
        expect(isExcludedAlphaToken({ ticker: 'SOL', name: 'SOLANA', chain: 'bsc' })).toBe(true);
        expect(isExcludedAlphaToken({ ticker: 'SEI', name: 'SEI', chain: 'ethereum' })).toBe(true);
        expect(isExcludedAlphaToken({ ticker: 'TRX', name: 'TRON', chain: 'bsc' })).toBe(true);
        expect(isExcludedAlphaToken({ ticker: 'ARB', name: 'Arbitrum', chain: 'ethereum' })).toBe(true);
        expect(isExcludedAlphaToken({ ticker: 'ARBITRUM', name: 'Arbitrum', chain: 'bsc' })).toBe(true);
        expect(isExcludedAlphaToken({ ticker: 'BASE', name: 'Base', chain: 'base' })).toBe(true);
        expect(isExcludedAlphaToken({ ticker: 'OP', name: 'Optimism', chain: 'ethereum' })).toBe(true);
    });

    it('keeps regular narrative and meme tokens', () => {
        expect(isExcludedAlphaToken({ ticker: 'PENGU', name: 'Pudgy Penguins', chain: 'solana' })).toBe(false);
        expect(isExcludedAlphaToken({ ticker: 'PUMP', name: 'Pump', chain: 'solana' })).toBe(false);
        expect(isExcludedAlphaToken({ ticker: 'TROLL', name: 'TROLL', chain: 'solana' })).toBe(false);
        expect(isExcludedAlphaToken({ ticker: 'WOJAK', name: 'Wojak Coin', chain: 'ethereum' })).toBe(false);
        expect(isExcludedAlphaToken({ ticker: 'ORCA', name: 'Orca', chain: 'solana' })).toBe(false);
        expect(isExcludedAlphaToken({ ticker: 'Fartcoin', name: 'Fartcoin', chain: 'solana' })).toBe(false);
    });
});
