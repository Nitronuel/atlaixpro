// Atlaix: Regression coverage for intelligence service behavior.
import { describe, expect, it } from 'vitest';
import { SmartMoneyQualificationService } from './SmartMoneyQualificationService';

describe('SmartMoneyQualificationService', () => {
    it('qualifies wallets that meet the smart money thresholds', () => {
        const result = SmartMoneyQualificationService.evaluate({
            winRate: '68%',
            totalPnL: '+32.5%',
            netWorth: '$145,000.00',
            activePositions: 6,
            profitableTrader: '4',
            avgHoldTime: '12 Days'
        });

        expect(result.qualified).toBe(true);
        expect(result.score).toBeGreaterThanOrEqual(65);
        expect(result.reasons.length).toBeGreaterThan(0);
    });

    it('rejects wallets that do not meet the smart money thresholds', () => {
        const result = SmartMoneyQualificationService.evaluate({
            winRate: '12%',
            totalPnL: '+1.5%',
            netWorth: '$1,200.00',
            activePositions: 1,
            profitableTrader: '1',
            avgHoldTime: 'N/A'
        });

        expect(result.qualified).toBe(false);
        expect(result.score).toBeLessThan(65);
    });
});
