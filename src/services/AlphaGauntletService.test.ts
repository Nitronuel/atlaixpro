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

    it('does not classify sell-count pressure as distribution when price and USD flow are positive', () => {
        const event = AlphaGauntletService.qualifyToken(buildCoin({
            ticker: 'AI',
            h1: '8.96%',
            h24: '46.91%',
            cap: '$58.61M',
            liquidity: '$1.78M',
            volume24h: '$975.28K',
            dexBuys: '2845',
            dexSells: '4127',
            buyVolume24h: '$495.00K',
            sellVolume24h: '$484.00K',
            netFlow: '+$11.00K'
        }));

        expect(event).not.toBeNull();
        expect(event?.eventType).not.toBe('Distribution');
        expect(['Recovery', 'Unusual Activity', 'Accumulation', 'Liquidity Event']).toContain(event?.eventType);
    });

    it('does not keep plain distribution when sell counts conflict with strong recovery momentum', () => {
        const event = AlphaGauntletService.qualifyToken(buildCoin({
            ticker: 'AI',
            h1: '8.96%',
            h24: '46.91%',
            cap: '$16.60M',
            liquidity: '$1.78M',
            volume24h: '$975.28K',
            dexBuys: '2845',
            dexSells: '4127',
            buyVolume24h: '$398.00K',
            sellVolume24h: '$577.00K',
            netFlow: '-$179.00K'
        }));

        expect(event).not.toBeNull();
        expect(event?.eventType).toBe('Recovery');
    });

    it('keeps true distribution when sell pressure has negative price and negative USD flow', () => {
        const event = AlphaGauntletService.qualifyToken(buildCoin({
            h1: '-4.50%',
            h24: '-8.00%',
            cap: '$8.00M',
            liquidity: '$900.00K',
            dexBuys: '1600',
            dexSells: '3600',
            buyVolume24h: '$320.00K',
            sellVolume24h: '$820.00K',
            netFlow: '-$500.00K'
        }));

        expect(event).not.toBeNull();
        expect(event?.eventType).toBe('Distribution');
    });
});
