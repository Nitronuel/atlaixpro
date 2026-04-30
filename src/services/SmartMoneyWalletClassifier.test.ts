// Atlaix: Regression coverage for intelligence service behavior.
import { describe, expect, it } from 'vitest';
import { classifySmartMoneyWallet, mapDiscoverySource, parseCurrencyLike, parsePercentLike } from './SmartMoneyWalletClassifier';

describe('SmartMoneyWalletClassifier', () => {
    it('normalizes money and percent strings for legacy scanner rows', () => {
        expect(parseCurrencyLike('$145,200.50')).toBe(145200.5);
        expect(parseCurrencyLike('2.4M')).toBe(2_400_000);
        expect(parsePercentLike('+32.5%')).toBe(32.5);
        expect(parsePercentLike('N/A')).toBeNull();
    });

    it('maps discovery providers into user-facing source types', () => {
        expect(mapDiscoverySource('moralis-swaps')).toBe('early_buy_swap');
        expect(mapDiscoverySource('alchemy-transfers')).toBe('transfer_recipient');
        expect(mapDiscoverySource()).toBe('unknown');
    });

    it('qualifies a strong early buyer with enough performance evidence', () => {
        const result = classifySmartMoneyWallet({
            status: 'qualified',
            source: 'moralis-swaps',
            confidence: 'high',
            buyerUsdValue: 12_000,
            netWorthUsd: 180_000,
            pnlPct: 34,
            winRatePct: 68,
            tradesAnalyzed: 8,
            winningTrades: 6,
            losingTrades: 2,
            score: 78,
            qualification: {
                score: 78,
                qualified: true,
                reasons: [],
                evaluatedAt: Date.now(),
                metrics: {
                    netWorthUsd: 180_000,
                    winRate: 68,
                    pnlPercent: 34,
                    activePositions: 8,
                    profitablePositions: 6
                }
            }
        });

        expect(result.decision).toBe('qualified');
        expect(result.walletType).toBe('consistent_profitable_trader');
        expect(result.intelligenceConfidence).toBe('high');
        expect(result.reasonCodes).toContain('strong_capital_base');
        expect(result.reasonCodes).toContain('positive_pnl');
    });

    it('keeps transfer-only discovery on watchlist/review unless metrics justify promotion', () => {
        const result = classifySmartMoneyWallet({
            status: 'tracked',
            source: 'alchemy-transfers',
            confidence: 'low',
            netWorthUsd: 18_000,
            pnlPct: 6,
            winRatePct: 45,
            tradesAnalyzed: 2,
            winningTrades: 1,
            score: 42
        });

        expect(result.decision).toBe('needs_review');
        expect(result.intelligenceConfidence).toBe('medium');
        expect(result.riskFlags).toContain('transfer_only_discovery');
        expect(result.riskFlags).toContain('low_trade_sample');
    });

    it('rejects weak scanned wallets with clear negative performance', () => {
        const result = classifySmartMoneyWallet({
            status: 'tracked',
            netWorthUsd: 900,
            pnlPct: -18,
            winRatePct: 20,
            tradesAnalyzed: 5,
            winningTrades: 1,
            score: 15
        });

        expect(result.decision).toBe('rejected');
        expect(result.riskFlags).toEqual(expect.arrayContaining(['negative_pnl', 'low_win_rate', 'low_balance']));
    });
});
