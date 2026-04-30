// Atlaix: Intelligence service module for Atlaix data workflows.

import { SolanaProvider } from './SolanaProvider';
import { fetchAlchemyRpc } from './ProviderGateway';

// Define the Activity Interface
export interface RealActivity {
    type: 'Buy' | 'Sell' | 'Add Liq' | 'Remove Liq' | 'Transfer' | 'Burn';
    val: string;
    desc: string;
    time: string;
    color: string;
    usd: string;
    hash: string;
    wallet: string;
    tag: string;
}

const mapChainToAlchemyNetwork = (chain: string) => {
    switch (chain.toLowerCase()) {
        case 'ethereum': return 'eth-mainnet';
        case 'base': return 'base-mainnet';
        case 'arbitrum': return 'arb-mainnet';
        case 'polygon': return 'polygon-mainnet';
        case 'optimism': return 'opt-mainnet';
        default: return 'eth-mainnet';
    }
};

const getTimeAgo = (timestamp: number) => {
    const seconds = Math.floor((Date.now() - timestamp) / 1000);
    if (seconds < 60) return `${seconds}s ago`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
    return `${Math.floor(seconds / 86400)}d ago`;
};

export const ChainActivityService = {

    /**
     * Fetch activity using scalable on-chain providers.
     */
    getTokenActivity: async (tokenAddress: string, chain: string, priceUsd: number, pairAddress?: string): Promise<RealActivity[]> => {
        if (chain.toLowerCase() === 'solana') {
            return ChainActivityService.getSolanaActivity(tokenAddress, priceUsd);
        } else {
            return ChainActivityService.getEVMActivity(tokenAddress, chain, priceUsd, pairAddress);
        }
    },

    /**
     * EVM Implementation using Alchemy Enhanced API
     */
    getEVMActivity: async (tokenAddress: string, chain: string, priceUsd: number, pairAddress?: string): Promise<RealActivity[]> => {
        const network = mapChainToAlchemyNetwork(chain);
        if (chain.toLowerCase() === 'bsc') return [];

        // Normalize Pair Address for comparison
        const pairAddr = pairAddress ? pairAddress.toLowerCase() : '';

        try {
            const response = await fetchAlchemyRpc(
                network,
                {
                    jsonrpc: "2.0",
                    id: 1,
                    method: "alchemy_getAssetTransfers",
                    params: [
                        {
                            fromBlock: "0x0",
                            toBlock: "latest",
                            contractAddresses: [tokenAddress],
                            category: ["external", "erc20"],
                            withMetadata: true,
                            excludeZeroValue: true,
                            maxCount: "0x64", // Limit 100
                            order: "desc"
                        }
                    ]
                }
            );

            if (!response.ok) return [];
            const data = await response.json();
            const transfers = data.result?.transfers || [];

            const activities: RealActivity[] = [];
            const deadAddresses = [
                '0x0000000000000000000000000000000000000000',
                '0x000000000000000000000000000000000000dead'
            ];

            for (const tx of transfers) {
                const val = parseFloat(tx.value);
                const usdValue = val * priceUsd;
                const to = (tx.to || '').toLowerCase();
                const from = (tx.from || '').toLowerCase();
                const timestamp = new Date(tx.metadata.blockTimestamp).getTime();

                // 1. Burn Detection
                if (deadAddresses.includes(to)) {
                    activities.push({
                        type: 'Burn',
                        val: val.toFixed(2),
                        desc: 'burned tokens',
                        time: getTimeAgo(timestamp),
                        color: 'text-primary-orange',
                        usd: `$${usdValue.toLocaleString(undefined, { maximumFractionDigits: 0 })}`,
                        hash: tx.hash,
                        wallet: from,
                        tag: 'Burner'
                    });
                    continue;
                }

                // 2. Whale Detection (> $500k) - ALWAYS takes precedence for On-Chain Feed, 
                // but we might want to also label it as Buy/Sell for the detailed view.
                // For now, if it's huge, we treat it as Whale event first. 
                // User requirement: "Whales... as proposed".
                if (usdValue >= 500000) {
                    activities.push({
                        type: 'Transfer', // Typed as transfer but tagged Whale
                        val: val.toFixed(2),
                        desc: 'Whale Transfer',
                        time: getTimeAgo(timestamp),
                        color: 'text-purple-500',
                        usd: `$${usdValue.toLocaleString(undefined, { maximumFractionDigits: 0 })}`,
                        hash: tx.hash,
                        wallet: from,
                        tag: 'Whale'
                    });
                    continue;
                }

                // 3. Buy/Sell/Transfer
                // Buy: Pair -> User (User receives tokens)
                // Sell: User -> Pair (User sends tokens)
                let type: RealActivity['type'] = 'Transfer';
                let desc = 'transferred';
                let color = 'text-primary-blue';

                if (pairAddr) {
                    if (from === pairAddr) {
                        type = 'Buy';
                        desc = 'bought on DEX';
                        color = 'text-primary-green';
                    } else if (to === pairAddr) {
                        type = 'Sell';
                        desc = 'sold on DEX';
                        color = 'text-primary-red';
                    }
                }

                activities.push({
                    type,
                    val: val.toFixed(2),
                    desc,
                    time: getTimeAgo(timestamp),
                    color,
                    usd: `$${usdValue.toLocaleString(undefined, { maximumFractionDigits: 0 })}`,
                    hash: tx.hash,
                    wallet: type === 'Buy' ? to : from, // For Buy, show who bought (to). For Sell/Transfer, show who sent.
                    tag: type
                });
            }

            return activities;

        } catch (e) {
            console.error("[ChainActivity] EVM Fetch Error", e);
            return [];
        }
    },

    /**
     * Solana implementation using normalized Alchemy-backed RPC history.
     */
    getSolanaActivity: async (mint: string, priceUsd: number): Promise<RealActivity[]> => {
        try {
            const transactions = await SolanaProvider.getParsedAddressTransactions(mint);
            if (!Array.isArray(transactions)) return [];

            const activities: RealActivity[] = [];

            for (const tx of transactions) {
                const timestamp = (tx.timestamp || 0) * 1000;
                if (!timestamp) continue;

                const txType = tx.type;
                const signature = tx.signature;

                // --- BURN ---
                if (txType === 'BURN') {
                    const transfer = (tx.tokenTransfers || []).find((t: any) => t.mint === mint);
                    const amount = transfer ? transfer.tokenAmount : 0;
                    const usdValue = amount * priceUsd;

                    activities.push({
                        type: 'Burn',
                        val: amount.toFixed(2),
                        desc: 'burned tokens',
                        time: getTimeAgo(timestamp),
                        color: 'text-primary-orange',
                        usd: `$${usdValue.toLocaleString(undefined, { maximumFractionDigits: 0 })}`,
                        hash: signature,
                        wallet: transfer ? transfer.fromUserAccount : 'Unknown',
                        tag: 'Burner'
                    });
                    continue;
                }

                // --- SWAP (Buy/Sell) ---
                if (txType === 'SWAP') {
                    const transfer = (tx.tokenTransfers || []).find((t: any) => t.mint === mint);
                    if (transfer) {
                        const amount = transfer.tokenAmount;
                        const usdValue = amount * priceUsd;

                        const user = tx.feePayer;
                        const isOut = transfer.fromUserAccount === user;

                        const type = isOut ? 'Sell' : 'Buy';
                        const color = isOut ? 'text-primary-red' : 'text-primary-green';

                        activities.push({
                            type,
                            val: amount.toFixed(2),
                            desc: isOut ? 'sold on DEX' : 'bought on DEX',
                            time: getTimeAgo(timestamp),
                            color,
                            usd: `$${usdValue.toLocaleString(undefined, { maximumFractionDigits: 0 })}`,
                            hash: signature,
                            wallet: user,
                            tag: type
                        });
                        continue;
                    }
                }

                // --- TRANSFER (Whale check) ---
                if (txType === 'TRANSFER') {
                    const transfers = (tx.tokenTransfers || []).filter((t: any) => t.mint === mint);
                    for (const t of transfers) {
                        const amount = t.tokenAmount;
                        const usdValue = amount * priceUsd;

                        if (usdValue >= 500000) {
                            activities.push({
                                type: 'Transfer',
                                val: amount.toFixed(2),
                                desc: 'Whale Transfer',
                                time: getTimeAgo(timestamp),
                                color: 'text-purple-500',
                                usd: `$${usdValue.toLocaleString(undefined, { maximumFractionDigits: 0 })}`,
                                hash: signature,
                                wallet: t.fromUserAccount,
                                tag: 'Whale'
                            });
                        } else {
                            // Standard Transfer
                            activities.push({
                                type: 'Transfer',
                                val: amount.toFixed(2),
                                desc: 'transferred',
                                time: getTimeAgo(timestamp),
                                color: 'text-primary-blue',
                                usd: `$${usdValue.toLocaleString(undefined, { maximumFractionDigits: 0 })}`,
                                hash: signature,
                                wallet: t.fromUserAccount,
                                tag: 'Transfer'
                            });
                        }
                    }
                }
            }

            return activities;

        } catch (e) {
            console.error("[ChainActivity] Solana Fetch Error", e);
            return [];
        }
    }
};
