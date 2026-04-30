// Atlaix: Intelligence service module for Atlaix data workflows.
import { SmartMoneyQualification } from '../types';
import { WalletStats } from '../hooks/useWalletPortfolio';

const parseCurrency = (value?: string): number => {
    if (!value) return 0;
    const cleaned = value.replace(/[$,]/g, '').trim();
    const match = cleaned.match(/^([+-]?\d+(?:\.\d+)?)([KMBT])?$/i);
    if (!match) return Number.parseFloat(cleaned) || 0;

    const amount = Number.parseFloat(match[1]);
    const suffix = (match[2] || '').toUpperCase();
    const multiplierMap: Record<string, number> = {
        K: 1_000,
        M: 1_000_000,
        B: 1_000_000_000,
        T: 1_000_000_000_000
    };

    return amount * (multiplierMap[suffix] || 1);
};

const parsePercent = (value?: string): number => {
    if (!value) return 0;
    return Number.parseFloat(value.replace('%', '').trim()) || 0;
};

const parseCount = (value?: string | number): number => {
    if (typeof value === 'number') return value;
    if (!value) return 0;
    return Number.parseInt(value, 10) || 0;
};

const roundScore = (value: number) => Math.max(0, Math.min(100, Math.round(value)));

export const SmartMoneyQualificationService = {
    evaluate(stats: WalletStats): SmartMoneyQualification {
        const netWorthUsd = parseCurrency(stats.netWorth);
        const winRate = parsePercent(stats.winRate);
        const pnlPercent = parsePercent(stats.totalPnL);
        const activePositions = parseCount(stats.activePositions);
        const profitablePositions = parseCount(stats.profitableTrader);

        let score = 0;
        const reasons: string[] = [];

        if (netWorthUsd >= 100_000) {
            score += 25;
            reasons.push(`Strong capital base with ${stats.netWorth} in tracked value`);
        } else if (netWorthUsd >= 25_000) {
            score += 18;
            reasons.push(`Healthy capital base with ${stats.netWorth} in tracked value`);
        } else if (netWorthUsd >= 10_000) {
            score += 10;
            reasons.push(`Meets the minimum balance bar at ${stats.netWorth}`);
        }

        if (winRate >= 75) {
            score += 25;
            reasons.push(`High win rate at ${stats.winRate}`);
        } else if (winRate >= 60) {
            score += 18;
            reasons.push(`Solid win rate at ${stats.winRate}`);
        } else if (winRate >= 50) {
            score += 10;
        }

        if (pnlPercent >= 50) {
            score += 25;
            reasons.push(`Exceptional realized PnL at ${stats.totalPnL}`);
        } else if (pnlPercent >= 20) {
            score += 18;
            reasons.push(`Positive realized PnL at ${stats.totalPnL}`);
        } else if (pnlPercent >= 10) {
            score += 10;
        }

        if (activePositions >= 8) {
            score += 15;
            reasons.push(`${activePositions} active positions provide a strong sample size`);
        } else if (activePositions >= 4) {
            score += 10;
            reasons.push(`${activePositions} active positions provide enough activity to assess`);
        } else if (activePositions >= 2) {
            score += 5;
        }

        if (profitablePositions >= 5) {
            score += 10;
            reasons.push(`${profitablePositions} profitable positions support consistency`);
        } else if (profitablePositions >= 3) {
            score += 7;
            reasons.push(`${profitablePositions} profitable positions support a positive edge`);
        } else if (profitablePositions >= 1) {
            score += 3;
        }

        if (pnlPercent < 0) score -= 15;
        if (winRate > 0 && winRate < 35) score -= 10;
        if (netWorthUsd > 0 && netWorthUsd < 2_500) score -= 10;

        const normalizedScore = roundScore(score);
        const meetsHardCriteria =
            netWorthUsd >= 100_000 &&
            winRate >= 55 &&
            pnlPercent >= 10 &&
            activePositions >= 3 &&
            profitablePositions >= 2;

        return {
            score: normalizedScore,
            qualified: meetsHardCriteria && normalizedScore >= 65,
            reasons: reasons.slice(0, 4),
            evaluatedAt: Date.now(),
            metrics: {
                netWorthUsd,
                winRate,
                pnlPercent,
                activePositions,
                profitablePositions
            }
        };
    }
};
