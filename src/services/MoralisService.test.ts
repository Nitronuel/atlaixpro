// Regression coverage for intelligence service behavior.
import { describe, expect, it } from 'vitest';
import { normalizeWalletBalancePayload } from './MoralisService';

describe('normalizeWalletBalancePayload', () => {
    it('uses amountRaw for Solana balances so SPL holdings are not scaled twice', () => {
        const normalized = normalizeWalletBalancePayload({
            mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
            symbol: 'USDC',
            name: 'USD Coin',
            amountRaw: '11892512361',
            amount: '11892.512361',
            decimals: 6,
            possibleSpam: false,
            isVerifiedContract: true
        }, true);

        expect(normalized.balance).toBe('11892512361');
        expect(normalized.decimals).toBe(6);
        expect(normalized.possible_spam).toBe(false);
        expect(normalized.verified_contract).toBe(true);
    });

    it('keeps EVM balances on the native raw balance field', () => {
        const normalized = normalizeWalletBalancePayload({
            token_address: '0xabc',
            symbol: 'TEST',
            name: 'Test Token',
            balance: '1000000',
            decimals: 6,
            possible_spam: false,
            verified_contract: true
        }, false);

        expect(normalized.balance).toBe('1000000');
        expect(normalized.decimals).toBe(6);
    });
});
