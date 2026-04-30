// Regression coverage for forensic intelligence behavior.
import { describe, expect, it } from 'vitest';
import { buildBundleIntelligence, calculateRetentionPct, classifyExitPressure } from './bundle-intelligence';

describe('bundle intelligence classification', () => {
    it('calculates lightweight retention from acquired and current balances', () => {
        expect(calculateRetentionPct(1000n, 720n)).toBe(72);
        expect(calculateRetentionPct(1000n, 1500n)).toBe(100);
        expect(calculateRetentionPct(0n, 100n)).toBeNull();
    });

    it('classifies exit pressure from retention', () => {
        expect(classifyExitPressure(80)).toBe('low');
        expect(classifyExitPressure(45)).toBe('medium');
        expect(classifyExitPressure(12)).toBe('high');
        expect(classifyExitPressure(null)).toBe('unknown');
    });

    it('labels low-concentration retained coordination as operational', () => {
        const result = buildBundleIntelligence({
            walletsInvolved: 4,
            supplyControlledPct: 0.8,
            retentionPct: 92,
            inferredBundleCount: 0,
            insiderClusterCount: 0,
            tier1EvidenceCount: 0,
            tier2EvidenceCount: 0,
            coverageLevel: 'full'
        });

        expect(result.detected).toBe(true);
        expect(result.type).toBe('operational');
        expect(result.riskLevel).toBe('low');
    });

    it('labels linked meaningful concentration as suspicious', () => {
        const result = buildBundleIntelligence({
            walletsInvolved: 12,
            supplyControlledPct: 8.5,
            retentionPct: 64,
            inferredBundleCount: 2,
            insiderClusterCount: 0,
            tier1EvidenceCount: 0,
            tier2EvidenceCount: 2,
            coverageLevel: 'full'
        });

        expect(result.type).toBe('suspicious');
        expect(result.riskLevel).toBe('medium');
        expect(result.confidence).toBe('high');
    });

    it('labels concentrated low-retention insider activity as exploitative', () => {
        const result = buildBundleIntelligence({
            walletsInvolved: 20,
            supplyControlledPct: 18,
            retentionPct: 12,
            inferredBundleCount: 5,
            insiderClusterCount: 2,
            tier1EvidenceCount: 1,
            tier2EvidenceCount: 3,
            deployerLinkedPct: 2,
            coverageLevel: 'full'
        });

        expect(result.type).toBe('exploitative');
        expect(result.riskLevel).toBe('high');
        expect(result.exitPressure).toBe('high');
    });
});
