export type AlchemyHubChain = 'solana' | 'eth' | 'base' | 'bsc' | 'polygon' | 'arbitrum' | 'optimism';
export type AlchemyHubScanDepth = 'balanced' | 'deep';

export const ALCHEMY_HUB_CHAINS: Array<{ id: AlchemyHubChain; label: string; kind: 'solana' | 'evm' }> = [
    { id: 'solana', label: 'Solana', kind: 'solana' },
    { id: 'eth', label: 'Ethereum', kind: 'evm' },
    { id: 'base', label: 'Base', kind: 'evm' },
    { id: 'bsc', label: 'BNB Chain', kind: 'evm' },
    { id: 'polygon', label: 'Polygon', kind: 'evm' },
    { id: 'arbitrum', label: 'Arbitrum', kind: 'evm' },
    { id: 'optimism', label: 'Optimism', kind: 'evm' }
];

export const EVM_ALCHEMY_NETWORK_BY_CHAIN: Record<Exclude<AlchemyHubChain, 'solana'>, string> = {
    eth: 'eth-mainnet',
    base: 'base-mainnet',
    bsc: 'bnb-mainnet',
    polygon: 'polygon-mainnet',
    arbitrum: 'arb-mainnet',
    optimism: 'opt-mainnet'
};

export function getAlchemyHubChain(id: string | null | undefined) {
    return ALCHEMY_HUB_CHAINS.find((chain) => chain.id === id) ?? ALCHEMY_HUB_CHAINS[0];
}

export function isEvmChain(chain: AlchemyHubChain): chain is Exclude<AlchemyHubChain, 'solana'> {
    return chain !== 'solana';
}

export function getAlchemyHubScanDepth(value: string | null | undefined): AlchemyHubScanDepth {
    return value === 'deep' ? 'deep' : 'balanced';
}
