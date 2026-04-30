// Atlaix: Regression coverage for intelligence service behavior.
import { describe, expect, it } from 'vitest';
import { extractJitoTipTransfers, FORENSIC_MAX_TRACKED_HOPS, inferJitoLaunchSignals } from './ForensicBundleService';

const JITO_TIP_ACCOUNTS = [
    '96gYZGLnJYVFmbjzopPSU6QiEV5fGqZNyN9nmNhvrZU5'
];

describe('ForensicBundleService Jito inference', () => {
    it('keeps four-hop tracking as the engine cap', () => {
        expect(FORENSIC_MAX_TRACKED_HOPS).toBe(4);
    });

    it('extracts Jito tip transfers from system transfers into tip accounts', () => {
        const transaction = {
            slot: 101,
            blockTime: 1_710_000_000,
            meta: {
                err: null
            },
            transaction: {
                signatures: ['sig-1'],
                message: {
                    instructions: [
                        {
                            program: 'system',
                            parsed: {
                                type: 'transfer',
                                info: {
                                    source: 'Wallet111111111111111111111111111111111111',
                                    destination: JITO_TIP_ACCOUNTS[0],
                                    lamports: '250000'
                                }
                            }
                        }
                    ]
                }
            }
        };

        expect(extractJitoTipTransfers(transaction as any, JITO_TIP_ACCOUNTS)).toEqual([
            {
                sourceWallet: 'Wallet111111111111111111111111111111111111',
                tipAccount: JITO_TIP_ACCOUNTS[0],
                lamports: 250000n,
                txHash: 'sig-1',
                slot: 101
            }
        ]);
    });

    it('infers stronger Jito links for shared tip wallet and same-slot tipped routing', () => {
        const launchBuyers = [
            {
                wallet: 'Buyer1111111111111111111111111111111111111',
                amount: 100n,
                slot: 500,
                txHash: 'launch-a',
                timestamp: '2026-04-20T10:00:00.000Z',
                acquisitionType: 'buy_like',
                attributionBasis: 'program_context',
                sourceWallets: [],
                programs: ['raydium'],
                launchBand: 'block_0'
            },
            {
                wallet: 'Buyer2222222222222222222222222222222222222',
                amount: 120n,
                slot: 500,
                txHash: 'launch-b',
                timestamp: '2026-04-20T10:00:01.000Z',
                acquisitionType: 'buy_like',
                attributionBasis: 'program_context',
                sourceWallets: [],
                programs: ['raydium'],
                launchBand: 'block_0'
            }
        ];

        const transactions = [
            {
                slot: 500,
                blockTime: 1_710_000_000,
                meta: {
                    err: null
                },
                transaction: {
                    signatures: ['launch-a'],
                    message: {
                        instructions: [
                            {
                                program: 'system',
                                parsed: {
                                    type: 'transfer',
                                    info: {
                                        source: 'TipWallet111111111111111111111111111111111',
                                        destination: JITO_TIP_ACCOUNTS[0],
                                        lamports: '5000'
                                    }
                                }
                            }
                        ]
                    }
                }
            },
            {
                slot: 500,
                blockTime: 1_710_000_001,
                meta: {
                    err: null
                },
                transaction: {
                    signatures: ['launch-b'],
                    message: {
                        instructions: [
                            {
                                program: 'system',
                                parsed: {
                                    type: 'transfer',
                                    info: {
                                        source: 'TipWallet111111111111111111111111111111111',
                                        destination: JITO_TIP_ACCOUNTS[0],
                                        lamports: '5000'
                                    }
                                }
                            }
                        ]
                    }
                }
            }
        ];

        const signals = inferJitoLaunchSignals({
            launchBuyers: launchBuyers as any,
            transactions: transactions as any,
            tipAccounts: JITO_TIP_ACCOUNTS
        });

        expect(signals.tippedBuyerWallets).toEqual([
            'Buyer1111111111111111111111111111111111111',
            'Buyer2222222222222222222222222222222222222'
        ]);
        expect(signals.tippedTransactionCount).toBe(2);
        expect(signals.uniqueTipAccounts).toEqual(JITO_TIP_ACCOUNTS);
        expect(signals.inferredEdges.map((edge) => edge.label)).toEqual(expect.arrayContaining([
            'shared_jito_tip_wallet',
            'same_slot_jito_router',
            'shared_jito_tip_account',
            'matching_jito_tip_amount'
        ]));
    });
});
