// Shared utility helpers for Atlaix application behavior.
import { ChainType } from '../services/ChainRouter';

const SOLANA_ADDRESS_REGEX = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const EVM_ADDRESS_REGEX = /^0x[a-fA-F0-9]{40}$/;

export interface WalletAddressValidation {
    isValid: boolean;
    type: 'evm' | 'solana' | null;
    normalizedAddress: string;
    error?: string;
}

export const isValidEvmAddress = (value: string) => EVM_ADDRESS_REGEX.test(value.trim());

export const isValidSolanaAddress = (value: string) => {
    const trimmed = value.trim();
    return SOLANA_ADDRESS_REGEX.test(trimmed) && !trimmed.startsWith('0x');
};

export const detectWalletAddressType = (value: string): WalletAddressValidation['type'] => {
    if (isValidEvmAddress(value)) return 'evm';
    if (isValidSolanaAddress(value)) return 'solana';
    return null;
};

export const validateWalletAddress = (value: string): WalletAddressValidation => {
    const normalizedAddress = value.trim();

    if (!normalizedAddress) {
        return {
            isValid: false,
            type: null,
            normalizedAddress,
            error: 'Enter a wallet address to continue.'
        };
    }

    const type = detectWalletAddressType(normalizedAddress);
    if (!type) {
        return {
            isValid: false,
            type: null,
            normalizedAddress,
            error: 'Enter a valid EVM or Solana wallet address.'
        };
    }

    return {
        isValid: true,
        type,
        normalizedAddress
    };
};

export const isChainCompatibleWithWallet = (chain: ChainType, walletType: WalletAddressValidation['type']) => {
    if (!walletType) return false;
    if (chain === 'All Chains') return walletType === 'evm';
    if (walletType === 'solana') return chain === 'Solana';
    return chain !== 'Solana';
};

export const getCompatibleDefaultChain = (walletType: WalletAddressValidation['type']): ChainType => {
    if (walletType === 'solana') return 'Solana';
    return 'All Chains';
};
