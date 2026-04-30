// Atlaix: Shared utility helpers for Atlaix application behavior.
import { ChainType } from '../services/ChainRouter';

export interface SupportedChainOption {
    id: ChainType;
    name: string;
    symbol: string;
    isAggregate?: boolean;
}

export const SUPPORTED_WALLET_CHAINS: SupportedChainOption[] = [
    { id: 'All Chains', name: 'All Chains', symbol: 'ALL', isAggregate: true },
    { id: 'Ethereum', name: 'Ethereum', symbol: 'ETH' },
    { id: 'Solana', name: 'Solana', symbol: 'SOL' },
    { id: 'Base', name: 'Base', symbol: 'BASE' },
    { id: 'BSC', name: 'Binance Smart Chain', symbol: 'BSC' },
    { id: 'Arbitrum', name: 'Arbitrum', symbol: 'ARB' },
    { id: 'Optimism', name: 'Optimism', symbol: 'OP' },
    { id: 'Polygon', name: 'Polygon', symbol: 'MATIC' },
    { id: 'Avalanche', name: 'Avalanche', symbol: 'AVAX' }
];

export const EVM_WALLET_CHAINS = SUPPORTED_WALLET_CHAINS.filter(chain => chain.id !== 'Solana');

export const PROFILE_CHAIN_OPTIONS: ChainType[] = SUPPORTED_WALLET_CHAINS.map(chain => chain.id);

export const normalizeWalletChain = (value: string | null | undefined): ChainType => {
    const matched = SUPPORTED_WALLET_CHAINS.find(chain => chain.id.toLowerCase() === (value || '').toLowerCase());
    return matched?.id || 'All Chains';
};
