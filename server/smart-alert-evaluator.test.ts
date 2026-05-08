import { describe, expect, it } from 'vitest';
import {
    evaluateSmartAlertRule,
    parseAlertThreshold,
    type SmartAlertRuleSnapshot
} from './smart-alert-evaluator';

const buildRule = (overrides: Partial<SmartAlertRuleSnapshot> = {}): SmartAlertRuleSnapshot => ({
    id: 'rule-1',
    user_id: 'user-1',
    alert_type: 'Price',
    target: 'SOL',
    chain_id: 'solana',
    condition: 'above',
    threshold_kind: 'currency',
    threshold: '$200',
    trigger_label: 'SOL price above $200',
    cooldown_minutes: 60,
    last_triggered_at: null,
    baseline_value: null,
    ...overrides
});

describe('Smart Alert evaluator', () => {
    it('parses compact currency thresholds', () => {
        expect(parseAlertThreshold('$50K', 'currency')).toBe(50_000);
        expect(parseAlertThreshold('$1.5M', 'currency')).toBe(1_500_000);
        expect(parseAlertThreshold('250000', 'currency')).toBe(250_000);
    });

    it('parses percent thresholds', () => {
        expect(parseAlertThreshold('20%', 'percent')).toBe(20);
        expect(parseAlertThreshold('7.5', 'percent')).toBe(7.5);
        expect(Number.isNaN(parseAlertThreshold('2x', 'percent'))).toBe(true);
    });

    it('matches price above and below thresholds', () => {
        expect(evaluateSmartAlertRule(buildRule(), { tokenLabel: 'SOL', priceUsd: 225 }).shouldTrigger).toBe(true);
        expect(evaluateSmartAlertRule(buildRule({ condition: 'below', threshold: '$180' }), { tokenLabel: 'SOL', priceUsd: 175 }).shouldTrigger).toBe(true);
        expect(evaluateSmartAlertRule(buildRule({ condition: 'below', threshold: '$180' }), { tokenLabel: 'SOL', priceUsd: 225 }).shouldTrigger).toBe(false);
    });

    it('establishes a baseline before evaluating percentage changes', () => {
        const result = evaluateSmartAlertRule(
            buildRule({
                alert_type: 'Volume',
                condition: 'changes_by_percent',
                threshold_kind: 'percent',
                threshold: '20%'
            }),
            { tokenLabel: 'SOL', volume24hUsd: 1_000_000 }
        );

        expect(result.shouldTrigger).toBe(false);
        expect(result.nextBaselineValue).toBe(1_000_000);
        expect(result.message).toContain('baseline was established');
    });

    it('matches percentage changes from the stored baseline', () => {
        const result = evaluateSmartAlertRule(
            buildRule({
                alert_type: 'Liquidity',
                condition: 'changes_by_percent',
                threshold_kind: 'percent',
                threshold: '25%',
                baseline_value: 100_000
            }),
            { tokenLabel: 'SOL', liquidityUsd: 130_000 }
        );

        expect(result.shouldTrigger).toBe(true);
        expect(result.observedValue).toBe('+30.0%');
        expect(result.nextBaselineValue).toBe(130_000);
    });

    it('matches alpha and risk exact conditions', () => {
        expect(evaluateSmartAlertRule(
            buildRule({ alert_type: 'Alpha', condition: 'event_is', threshold_kind: 'event', threshold: 'Liquidity Event' }),
            { tokenLabel: 'SOL', alphaEvent: 'Liquidity Event' }
        ).shouldTrigger).toBe(true);

        expect(evaluateSmartAlertRule(
            buildRule({ alert_type: 'Risk', condition: 'severity_is', threshold_kind: 'severity', threshold: 'High' }),
            { tokenLabel: 'SOL', riskSeverity: 'High' }
        ).shouldTrigger).toBe(true);
    });

    it('does not suppress matches based on previous trigger time', () => {
        const now = new Date('2026-05-07T10:00:00.000Z');
        const result = evaluateSmartAlertRule(
            buildRule({ last_triggered_at: '2026-05-07T09:30:00.000Z', cooldown_minutes: 60 }),
            { tokenLabel: 'SOL', priceUsd: 225 },
            now
        );

        expect(result.shouldTrigger).toBe(true);
        expect(result.message).toContain('triggered');
    });
});
