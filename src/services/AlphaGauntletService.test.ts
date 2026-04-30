import { describe, expect, it } from 'vitest';
import { AlphaGauntletService } from './AlphaGauntletService';
import { MarketCoin } from '../types';

const buildCoin = (overrides: Partial<MarketCoin> = {}): MarketCoin => ({
    id: 1,
    name: 'Test Alpha',
    ticker: 'ALPHA',
    price: '$0.01',
    h1: '2.50%',
    h24: '18.00%',
    d7: '24.00%',
    cap: '$30.00M',
    liquidity: '$1.20M',
    volume24h: '$3.50M',
    dexBuys: '2500',
    dexSells: '1600',
    dexFlow: 61,
    netFlow: '+$380.00K',
    smartMoney: '$0.00',
    smartMoneySignal: 'Neutral',
    signal: 'Volume Spike',
    riskLevel: 'Low',
    age: '2 Days',
    createdTimestamp: Date.now() - 48 * 60 * 60 * 1000,
    img: '',
    trend: 'Bullish',
    chain: 'ethereum',
    address: '0x0000000000000000000000000000000000000001',
    pairAddress: '0x0000000000000000000000000000000000000002',
    ...overrides
});

describe('AlphaGauntletService', () => {
    it('qualifies active larger tokens even when LP to FDV is below ten percent', () => {
        const event = AlphaGauntletService.qualifyToken(buildCoin());

        expect(event).not.toBeNull();
        expect(event?.score).toBeGreaterThanOrEqual(AlphaGauntletService.OVERVIEW_THRESHOLD);
        expect(event?.triggers).toContain('Volume Spike');
    });

    it('still rejects tokens without enough market structure', () => {
        const event = AlphaGauntletService.qualifyToken(buildCoin({
            cap: '$250.00K',
            liquidity: '$20.00K',
            volume24h: '$30.00K',
            dexBuys: '15',
            dexSells: '8'
        }));

        expect(event).toBeNull();
    });
});
