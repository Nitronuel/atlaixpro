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
    img: 'https://example.com/token.png',
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
        expect(event?.triggers).toContain('Elevated Volume');
        expect(event?.activityScore).toBeGreaterThan(0);
        expect(event?.confidence?.label).toMatch(/High|Medium|Low/);
        expect(event?.triggerDetails?.some((trigger) => trigger.label === 'Elevated Volume Relative to Liquidity')).toBe(true);
        expect(event?.summary).toContain('activity score');
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
        expect(['Recovery', 'Recovery Attempt', 'Momentum Breakout', 'Unusual Activity', 'Accumulation', 'Deep Liquidity Structure', 'Conflicting Signals']).toContain(event?.eventType);
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
        expect(['Recovery Attempt', 'Conflicting Signals']).toContain(event?.eventType);
    });

    it('does not call buy pressure accumulation before a twenty five percent move', () => {
        const event = AlphaGauntletService.qualifyToken(buildCoin({
            cap: '$4.00M',
            liquidity: '$1.10M',
            volume24h: '$900.00K',
            dexBuys: '2200',
            dexSells: '1200',
            buyVolume24h: '$620.00K',
            sellVolume24h: '$280.00K',
            netFlow: '+$340.00K',
            h24: '11.00%'
        }));

        expect(event).not.toBeNull();
        expect(event?.triggers).toContain('Deep Liquidity Structure');
        expect(event?.eventType).toBe('Deep Liquidity Structure');
    });

    it('keeps accumulation for confirmed forty percent buy-pressure moves', () => {
        const event = AlphaGauntletService.qualifyToken(buildCoin({
            cap: '$4.00M',
            liquidity: '$1.10M',
            volume24h: '$900.00K',
            dexBuys: '2200',
            dexSells: '1200',
            buyVolume24h: '$620.00K',
            sellVolume24h: '$280.00K',
            netFlow: '+$340.00K',
            h24: '44.00%'
        }));

        expect(event).not.toBeNull();
        expect(event?.eventType).toBe('Accumulation');
    });

    it('uses potential accumulation for twenty five to thirty nine percent buy-pressure moves', () => {
        const event = AlphaGauntletService.qualifyToken(buildCoin({
            cap: '$4.00M',
            liquidity: '$1.10M',
            volume24h: '$900.00K',
            dexBuys: '2200',
            dexSells: '1200',
            buyVolume24h: '$620.00K',
            sellVolume24h: '$280.00K',
            netFlow: '+$340.00K',
            h24: '30.00%'
        }));

        expect(event).not.toBeNull();
        expect(event?.eventType).toBe('Potential Accumulation');
    });

    it('does not claim holder growth when only transaction proxy data exists', () => {
        const event = AlphaGauntletService.qualifyToken(buildCoin({
            dexBuys: '4200',
            dexSells: '2600',
            activeWallets24h: undefined
        }));

        expect(event).not.toBeNull();
        expect(event?.triggers).not.toContain('Holder Growth Spike');
    });

    it('does not call sell pressure distribution before a fifteen percent move', () => {
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
        expect(event?.eventType).not.toBe('Distribution');
        expect(['Unusual Activity', 'Flow Imbalance']).toContain(event?.eventType);
    });

    it('keeps distribution for confirmed thirty percent sell-pressure moves', () => {
        const event = AlphaGauntletService.qualifyToken(buildCoin({
            h1: '-4.50%',
            h24: '-32.00%',
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

    it('uses potential distribution for fifteen to twenty nine percent sell-pressure moves', () => {
        const event = AlphaGauntletService.qualifyToken(buildCoin({
            h1: '-4.50%',
            h24: '-20.00%',
            cap: '$8.00M',
            liquidity: '$900.00K',
            dexBuys: '1600',
            dexSells: '3600',
            buyVolume24h: '$320.00K',
            sellVolume24h: '$820.00K',
            netFlow: '-$500.00K'
        }));

        expect(event).not.toBeNull();
        expect(event?.eventType).toBe('Potential Distribution');
    });

    it('does not create a momentum breakout for a plain ten percent move', () => {
        const event = AlphaGauntletService.qualifyToken(buildCoin({
            h1: '1.50%',
            h24: '10.00%',
            buyVolume24h: '$520.00K',
            sellVolume24h: '$420.00K',
            netFlow: '+$100.00K'
        }));

        expect(event).not.toBeNull();
        expect(event?.eventType).not.toBe('Momentum Breakout');
        expect(event?.triggers).not.toContain('Momentum Breakout');
    });

    it('creates momentum breakout for a twenty five percent move with buy support', () => {
        const event = AlphaGauntletService.qualifyToken(buildCoin({
            h1: '4.00%',
            h24: '27.00%',
            buyVolume24h: '$620.00K',
            sellVolume24h: '$500.00K',
            netFlow: '+$120.00K',
            liquidity: '$1.10M',
            volume24h: '$1.00M'
        }));

        expect(event).not.toBeNull();
        expect(event?.triggers).toContain('Momentum Breakout');
        expect(event?.eventType).toBe('Momentum Breakout');
    });

    it('flags overextended momentum when price is extreme and turnover is high', () => {
        const event = AlphaGauntletService.qualifyToken(buildCoin({
            h1: '18.00%',
            h24: '86.00%',
            cap: '$6.00M',
            liquidity: '$300.00K',
            volume24h: '$2.50M',
            dexBuys: '6200',
            dexSells: '4100',
            buyVolume24h: '$1.50M',
            sellVolume24h: '$1.00M',
            netFlow: '+$500.00K'
        }));

        expect(event).not.toBeNull();
        expect(event?.eventType).toBe('Overextended Momentum');
    });

    it('flags possible wash trading when high balanced activity barely moves price', () => {
        const event = AlphaGauntletService.qualifyToken(buildCoin({
            h1: '0.30%',
            h24: '1.80%',
            volume24h: '$4.00M',
            liquidity: '$1.00M',
            dexBuys: '5600',
            dexSells: '5400',
            buyVolume24h: '$2.02M',
            sellVolume24h: '$1.98M',
            netFlow: '+$40.00K'
        }));

        expect(event).not.toBeNull();
        expect(event?.eventType).toBe('Possible Wash Trading');
    });

    it('rejects weak no-logo token identities before they enter detection', () => {
        const event = AlphaGauntletService.qualifyToken(buildCoin({
            img: '',
            cap: '$900.00K',
            liquidity: '$140.00K',
            volume24h: '$300.00K'
        }));

        expect(event).toBeNull();
    });
});
