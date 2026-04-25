import { describe, expect, it, vi } from 'vitest';
import {
    discoverMoralisEvmEarlyBuyers,
    discoverMoralisSolanaEarlyBuyers,
    normalizeMoralisSwapBuyer
} from './smart-money-scanner-discovery';

const token = '0x1111111111111111111111111111111111111111';
const walletA = '0x2222222222222222222222222222222222222222';
const walletB = '0x3333333333333333333333333333333333333333';

const jsonResponse = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' }
});

describe('smart-money-scanner-discovery', () => {
    it('normalizes Moralis EVM buy swaps into high-confidence buyers', () => {
        const buyer = normalizeMoralisSwapBuyer({
            walletAddress: walletA,
            transactionHash: '0xabc',
            blockTimestamp: '2026-04-25T10:00:00.000Z',
            transactionType: 'buy',
            exchangeName: 'Uniswap v2',
            pairAddress: '0x4444444444444444444444444444444444444444',
            totalValueUsd: 1250,
            bought: {
                tokenAddress: token,
                amountRaw: '5000000000000000000'
            }
        }, token, 'eth');

        expect(buyer).toMatchObject({
            wallet: walletA,
            firstSeenAt: '2026-04-25T10:00:00.000Z',
            txHash: '0xabc',
            amountRaw: '5000000000000000000',
            usdValue: 1250,
            source: 'moralis-swaps',
            confidence: 'high',
            exchange: 'Uniswap v2'
        });
    });

    it('rejects swaps where the target token is the sold side', () => {
        const buyer = normalizeMoralisSwapBuyer({
            walletAddress: walletA,
            transactionType: 'sell',
            sold: {
                tokenAddress: token,
                amountRaw: '5000000000000000000'
            }
        }, token, 'eth');

        expect(buyer).toBeNull();
    });

    it('dedupes wallets and paginates Moralis EVM swaps', async () => {
        const fetcher = vi.fn()
            .mockResolvedValueOnce(jsonResponse({
                cursor: 'next-page',
                result: [
                    {
                        walletAddress: walletA,
                        transactionHash: '0xfirst',
                        blockTimestamp: '2026-04-25T10:00:00.000Z',
                        transactionType: 'buy',
                        bought: { tokenAddress: token, amountRaw: '1' }
                    },
                    {
                        walletAddress: walletA,
                        transactionHash: '0xduplicate',
                        blockTimestamp: '2026-04-25T10:01:00.000Z',
                        transactionType: 'buy',
                        bought: { tokenAddress: token, amountRaw: '2' }
                    }
                ]
            }))
            .mockResolvedValueOnce(jsonResponse({
                cursor: null,
                result: [
                    {
                        walletAddress: walletB,
                        transactionHash: '0xsecond',
                        blockTimestamp: '2026-04-25T10:02:00.000Z',
                        transactionType: 'buy',
                        bought: { tokenAddress: token, amountRaw: '3' }
                    }
                ]
            }));

        const buyers = await discoverMoralisEvmEarlyBuyers(token, 'eth', 2, {
            fetcher,
            moralisKey: 'test-key'
        });

        expect(buyers.map((buyer) => buyer.wallet)).toEqual([walletA, walletB]);
        expect(fetcher).toHaveBeenCalledTimes(2);
        expect(String(fetcher.mock.calls[0][0])).toContain('transactionTypes=buy');
        expect(String(fetcher.mock.calls[1][0])).toContain('cursor=next-page');
    });

    it('normalizes Solana swap buyers from Moralis payloads', async () => {
        const solanaToken = 'So11111111111111111111111111111111111111112';
        const solanaWallet = '7YgPSpD6xBRcXwvB4ZRoN5pN2h5K4LS3KU43mNq3XoHq';
        const fetcher = vi.fn().mockResolvedValueOnce(jsonResponse({
            result: [{
                walletAddress: solanaWallet,
                signature: '5sig',
                timestamp: '2026-04-25T11:00:00.000Z',
                transactionType: 'buy',
                bought: {
                    mint: solanaToken,
                    amountRaw: '1000000'
                }
            }]
        }));

        const buyers = await discoverMoralisSolanaEarlyBuyers(solanaToken, 1, {
            fetcher,
            moralisKey: 'test-key'
        });

        expect(buyers).toHaveLength(1);
        expect(buyers[0]).toMatchObject({
            wallet: solanaWallet,
            txHash: '5sig',
            source: 'moralis-swaps',
            confidence: 'high'
        });
    });
});
