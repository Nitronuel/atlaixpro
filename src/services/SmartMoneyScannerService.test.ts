import { describe, expect, it } from 'vitest';
import { SmartMoneyScannerInternals } from './SmartMoneyScannerService';
import type { PortfolioData } from './ChainRouter';

describe('SmartMoneyScannerService metrics', () => {
    it('calculates win rate, weighted pnl, capital efficiency, and average buy from enriched token pnl', () => {
        const portfolio: PortfolioData = {
            netWorth: '$1,900.00',
            providerUsed: 'Cache',
            chainIcon: '',
            timestamp: Date.now(),
            recentActivity: [],
            assets: [
                {
                    symbol: 'AAA',
                    address: '0xaaa',
                    balance: '100',
                    value: '$1,500.00',
                    price: '$15.00',
                    currentPrice: 15,
                    logo: '',
                    rawValue: 1500,
                    avgBuy: '$10.00',
                    pnl: '+50.00%',
                    pnlPercent: 50
                },
                {
                    symbol: 'BBB',
                    address: '0xbbb',
                    balance: '100',
                    value: '$400.00',
                    price: '$4.00',
                    currentPrice: 4,
                    logo: '',
                    rawValue: 400,
                    avgBuy: '$5.00',
                    pnl: '-20.00%',
                    pnlPercent: -20
                },
                {
                    symbol: 'DUST',
                    address: '0xdust',
                    balance: '1',
                    value: '$0.25',
                    price: '$0.25',
                    currentPrice: 0.25,
                    logo: '',
                    rawValue: 0.25
                }
            ]
        };

        const metrics = SmartMoneyScannerInternals.buildWalletMetricsFromPortfolio(portfolio);

        expect(metrics.tradesAnalyzed).toBe(2);
        expect(metrics.winningTrades).toBe(1);
        expect(metrics.losingTrades).toBe(1);
        expect(metrics.winRatePct).toBe(50);
        expect(metrics.pnlPct).toBeCloseTo(26.67, 1);
        expect(metrics.capitalEfficiency).toBeCloseTo(26.67, 1);
        expect(metrics.avgBuyUsd).toBeCloseTo(750, 0);
        expect(metrics.stats.winRate).toBe('50%');
        expect(metrics.stats.totalPnL).toBe('+26.67%');
    });
});
