import { describe, expect, it } from 'vitest';
import {
    detectWalletAddressType,
    getCompatibleDefaultChain,
    isChainCompatibleWithWallet,
    validateWalletAddress
} from './wallet';

describe('wallet utilities', () => {
    it('accepts valid EVM addresses', () => {
        const result = validateWalletAddress('0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045');

        expect(result.isValid).toBe(true);
        expect(result.type).toBe('evm');
        expect(result.normalizedAddress).toBe('0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045');
    });

    it('accepts valid Solana addresses', () => {
        const result = validateWalletAddress('5Q544fKrFoe6tsEbA46CAQKQUBvD8B2x32E1K3D8hoL4');

        expect(result.isValid).toBe(true);
        expect(result.type).toBe('solana');
    });

    it('rejects invalid addresses with a clear error', () => {
        const result = validateWalletAddress('0x123');

        expect(result.isValid).toBe(false);
        expect(result.type).toBeNull();
        expect(result.error).toContain('valid EVM or Solana');
    });

    it('detects compatibility between wallet type and chain', () => {
        expect(detectWalletAddressType('0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045')).toBe('evm');
        expect(isChainCompatibleWithWallet('Solana', 'evm')).toBe(false);
        expect(isChainCompatibleWithWallet('All Chains', 'evm')).toBe(true);
        expect(isChainCompatibleWithWallet('Solana', 'solana')).toBe(true);
        expect(getCompatibleDefaultChain('solana')).toBe('Solana');
    });
});
