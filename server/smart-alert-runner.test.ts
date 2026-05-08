import { afterEach, describe, expect, it, vi } from 'vitest';
import { SmartAlertRunner } from './smart-alert-runner';

const restoreEnv = (key: string, value: string | undefined) => {
    if (value === undefined) {
        delete process.env[key];
        return;
    }
    process.env[key] = value;
};

describe('SmartAlertRunner', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('reports a clear backend configuration error when service-role credentials are missing', async () => {
        const previousUrl = process.env.SUPABASE_URL;
        const previousViteUrl = process.env.VITE_SUPABASE_URL;
        const previousServiceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;
        const previousServiceKey = process.env.SUPABASE_SERVICE_KEY;

        delete process.env.SUPABASE_URL;
        delete process.env.VITE_SUPABASE_URL;
        delete process.env.SUPABASE_SERVICE_ROLE_KEY;
        delete process.env.SUPABASE_SERVICE_KEY;

        const runner = new SmartAlertRunner();
        const status = await runner.runNow();

        expect(status.lastRunStatus).toBe('error');
        expect(status.lastError).toContain('Supabase service-role credentials');

        restoreEnv('SUPABASE_URL', previousUrl);
        restoreEnv('VITE_SUPABASE_URL', previousViteUrl);
        restoreEnv('SUPABASE_SERVICE_ROLE_KEY', previousServiceRole);
        restoreEnv('SUPABASE_SERVICE_KEY', previousServiceKey);
    });

    it('clears a stale rule error after a successful market evaluation', async () => {
        const updates: Record<string, unknown>[] = [];
        const fakeSupabase = {
            from: () => ({
                update: (patch: Record<string, unknown>) => {
                    updates.push(patch);
                    return {
                        eq: async () => ({ error: null })
                    };
                },
                insert: () => ({
                    select: async () => ({ data: [], error: null })
                })
            })
        };
        const runner = new SmartAlertRunner();
        const rule = {
            id: 'rule-1',
            user_id: 'user-1',
            alert_type: 'Price',
            target: 'ELIEN',
            chain_id: 'ethereum',
            token_address: '0xC7e4254a72169fdf7a2E080462724f2F642dAF7e',
            condition: 'changes_by_percent',
            threshold_kind: 'percent',
            threshold: '30%',
            trigger_label: 'Elien Musk price moves by 30%',
            cooldown_minutes: 60,
            enabled: true,
            last_triggered_at: null,
            baseline_value: 0.002239,
            trigger_count: 0,
            metadata: { alertMode: 'single' },
            created_at: '2026-05-08T00:00:00.000Z'
        };
        const coin = {
            id: 1,
            name: 'Elien Musk',
            ticker: 'ELIEN',
            price: '$0.00245',
            h1: '0%',
            h24: '0%',
            d7: '0%',
            cap: '$0',
            liquidity: '$100K',
            volume24h: '$50K',
            dexBuys: '0',
            dexSells: '0',
            dexFlow: 0,
            netFlow: '$0',
            smartMoney: '$0',
            smartMoneySignal: 'Neutral',
            signal: 'None',
            riskLevel: 'Low',
            age: '1d',
            createdTimestamp: 0,
            img: '',
            trend: 'Bullish',
            chain: 'ethereum',
            address: '0xC7e4254a72169fdf7a2E080462724f2F642dAF7e'
        };

        await (runner as any).evaluateRule(fakeSupabase, rule, [coin], []);

        expect(updates.some((patch) => Object.prototype.hasOwnProperty.call(patch, 'last_error') && patch.last_error === null)).toBe(true);
    });

    it('prefers direct contract market data for contract-specific alerts', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => ({
            ok: true,
            json: async () => ({
                pairs: [{
                    chainId: 'ethereum',
                    pairAddress: '0xpair',
                    baseToken: {
                        address: '0xC7e4254a72169fdf7a2E080462724f2F642dAF7e',
                        symbol: 'ELIEN',
                        name: 'Elien Musk'
                    },
                    priceUsd: '5',
                    volume: { h24: '1000' },
                    liquidity: { usd: '10000' }
                }]
            })
        })));

        const updates: Record<string, unknown>[] = [];
        const fakeSupabase = {
            from: () => ({
                update: (patch: Record<string, unknown>) => {
                    updates.push(patch);
                    return {
                        eq: async () => ({ error: null })
                    };
                },
                insert: () => ({
                    select: async () => ({ data: [{ id: 'trigger-1' }], error: null })
                })
            })
        };
        const runner = new SmartAlertRunner();
        const rule = {
            id: 'rule-2',
            user_id: 'user-1',
            alert_type: 'Price',
            target: 'ELIEN',
            chain_id: 'ethereum',
            token_address: '0xC7e4254a72169fdf7a2E080462724f2F642dAF7e',
            condition: 'above',
            threshold_kind: 'currency',
            threshold: '$2',
            trigger_label: 'Elien Musk price above $2',
            cooldown_minutes: 60,
            enabled: true,
            last_triggered_at: null,
            baseline_value: null,
            trigger_count: 0,
            metadata: { alertMode: 'single' },
            created_at: '2026-05-08T00:00:00.000Z'
        };
        const broadFeedCoin = {
            id: 1,
            name: 'Elien Musk',
            ticker: 'ELIEN',
            price: '$1',
            h1: '0%',
            h24: '0%',
            d7: '0%',
            cap: '$0',
            liquidity: '$100K',
            volume24h: '$50K',
            dexBuys: '0',
            dexSells: '0',
            dexFlow: 0,
            netFlow: '$0',
            smartMoney: '$0',
            smartMoneySignal: 'Neutral',
            signal: 'None',
            riskLevel: 'Low',
            age: '1d',
            createdTimestamp: 0,
            img: '',
            trend: 'Bullish',
            chain: 'ethereum',
            address: '0xC7e4254a72169fdf7a2E080462724f2F642dAF7e'
        };

        await (runner as any).evaluateRule(fakeSupabase, rule, [broadFeedCoin], []);

        expect(updates.some((patch) => patch.last_observed_value === '$5' && patch.last_error === null)).toBe(true);
        expect(updates.some((patch) => patch.enabled === false && (patch.metadata as any)?.status === 'completed')).toBe(true);
    });

    it('treats a reachable token with no current Alpha event as waiting instead of failed', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => ({
            ok: true,
            json: async () => ({
                pairs: [{
                    chainId: 'ethereum',
                    pairAddress: '0xpair',
                    baseToken: {
                        address: '0xC7e4254a72169fdf7a2E080462724f2F642dAF7e',
                        symbol: 'ELIEN',
                        name: 'Elien Musk'
                    },
                    priceUsd: '0.003',
                    txns: { h24: { buys: 12, sells: 10 } },
                    volume: { h24: 12000 },
                    priceChange: { h1: 1, h6: 3, h24: 4 },
                    liquidity: { usd: 90000 },
                    fdv: 400000,
                    pairCreatedAt: Date.now() - 48 * 60 * 60 * 1000
                }]
            })
        })));

        const updates: Record<string, unknown>[] = [];
        const fakeSupabase = {
            from: () => ({
                update: (patch: Record<string, unknown>) => {
                    updates.push(patch);
                    return {
                        eq: async () => ({ error: null })
                    };
                },
                insert: () => ({
                    select: async () => ({ data: [], error: null })
                })
            })
        };
        const runner = new SmartAlertRunner();
        const rule = {
            id: 'rule-3',
            user_id: 'user-1',
            alert_type: 'Alpha',
            target: 'Elien Musk',
            chain_id: 'ethereum',
            token_address: '0xC7e4254a72169fdf7a2E080462724f2F642dAF7e',
            condition: 'event_is',
            threshold_kind: 'event',
            threshold: 'Accumulation',
            trigger_label: 'Elien Musk appears with Accumulation',
            cooldown_minutes: 60,
            enabled: true,
            last_triggered_at: null,
            baseline_value: null,
            trigger_count: 0,
            metadata: { alertMode: 'single' },
            created_at: '2026-05-08T00:00:00.000Z'
        };

        await (runner as any).evaluateRule(fakeSupabase, rule, [], []);

        expect(updates.some((patch) => patch.last_checked_at && patch.last_error === null)).toBe(true);
        expect(updates.some((patch) => patch.last_error === 'No live market snapshot was available for this alert token.')).toBe(false);
    });

    it('uses Alchemy transfers to infer whale buy and sell size from the DEX pair direction', async () => {
        const previousAlchemyKey = process.env.ALCHEMY_API_KEY;
        process.env.ALCHEMY_API_KEY = 'test-key';

        const pairAddress = '0x0000000000000000000000000000000000000abc';
        const tokenAddress = '0xC7e4254a72169fdf7a2E080462724f2F642dAF7e';
        const walletAddress = '0x0000000000000000000000000000000000000def';
        vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
            if (String(url).includes('dexscreener.com')) {
                return {
                    ok: true,
                    json: async () => ({
                        pairs: [{
                            chainId: 'ethereum',
                            pairAddress,
                            baseToken: {
                                address: tokenAddress,
                                symbol: 'ELIEN',
                                name: 'Elien Musk'
                            },
                            priceUsd: '10',
                            volume: { h24: '1000' },
                            liquidity: { usd: '10000' }
                        }]
                    })
                };
            }

            const body = JSON.parse(String(init?.body || '{}'));
            if (body.method === 'eth_blockNumber') {
                return {
                    ok: true,
                    json: async () => ({ result: '0x100' })
                };
            }

            return {
                ok: true,
                json: async () => ({
                    result: {
                        transfers: [{
                            hash: '0xbuy',
                            from: pairAddress,
                            to: walletAddress,
                            value: 250,
                            rawContract: { decimal: '18', value: '0x0' }
                        }, {
                            hash: '0xsell',
                            from: walletAddress,
                            to: pairAddress,
                            value: 150,
                            rawContract: { decimal: '18', value: '0x0' }
                        }]
                    }
                })
            };
        }));

        const inserts: Record<string, unknown>[] = [];
        const updates: Record<string, unknown>[] = [];
        const fakeSupabase = {
            from: () => ({
                update: (patch: Record<string, unknown>) => {
                    updates.push(patch);
                    return {
                        eq: async () => ({ error: null })
                    };
                },
                insert: (patch: Record<string, unknown>) => {
                    inserts.push(patch);
                    return {
                        select: async () => ({ data: [{ id: 'trigger-1' }], error: null })
                    };
                }
            })
        };
        const runner = new SmartAlertRunner();
        const baseRule = {
            id: 'rule-4',
            user_id: 'user-1',
            alert_type: 'Whale',
            target: 'Elien Musk',
            chain_id: 'ethereum',
            token_address: tokenAddress,
            threshold_kind: 'currency',
            threshold: '$1000',
            trigger_label: 'Whale activity above $1000 on Elien Musk',
            cooldown_minutes: 60,
            enabled: true,
            last_triggered_at: null,
            baseline_value: null,
            trigger_count: 0,
            metadata: { alertMode: 'single', token: { address: tokenAddress, pairAddress, chainId: 'ethereum' } },
            created_at: '2026-05-08T00:00:00.000Z'
        };

        await (runner as any).evaluateRule(fakeSupabase, { ...baseRule, condition: 'buy_above' }, [], []);
        await (runner as any).evaluateRule(fakeSupabase, { ...baseRule, id: 'rule-5', condition: 'sell_above' }, [], []);

        expect(inserts.some((patch) => patch.observed_value === '$2,500')).toBe(true);
        expect(inserts.some((patch) => patch.observed_value === '$1,500')).toBe(true);
        expect(updates.some((patch) => patch.last_observed_value === '$2,500' && patch.last_error === null)).toBe(true);
        expect(updates.some((patch) => patch.last_observed_value === '$1,500' && patch.last_error === null)).toBe(true);

        restoreEnv('ALCHEMY_API_KEY', previousAlchemyKey);
    });
});
