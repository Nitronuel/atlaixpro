// Forensic analysis helper for SafeScan intelligence workflows.
import type { BundleIntelligence } from './types';

export function calculateRetentionPct(acquiredRaw: bigint, currentRaw: bigint) {
    if (acquiredRaw <= 0n) return null;
    const boundedCurrent = currentRaw > acquiredRaw ? acquiredRaw : currentRaw;
    return Number((boundedCurrent * 10000n) / acquiredRaw) / 100;
}

export function classifyExitPressure(retentionPct: number | null): BundleIntelligence['exitPressure'] {
    if (retentionPct === null || !Number.isFinite(retentionPct)) return 'unknown';
    if (retentionPct >= 70) return 'low';
    if (retentionPct >= 30) return 'medium';
    return 'high';
}

function pushUnique(reasons: string[], reason: string) {
    if (!reasons.includes(reason)) reasons.push(reason);
}

export function buildBundleIntelligence(args: {
    walletsInvolved: number;
    supplyControlledPct: number;
    retentionPct: number | null;
    inferredBundleCount: number;
    insiderClusterCount: number;
    tier1EvidenceCount: number;
    tier2EvidenceCount: number;
    deployerLinkedPct?: number;
    coverageLevel?: 'full' | 'degraded_history' | 'degraded_enrichment' | 'degraded_history_and_enrichment';
}): BundleIntelligence {
    const {
        walletsInvolved,
        supplyControlledPct,
        retentionPct,
        inferredBundleCount,
        insiderClusterCount,
        tier1EvidenceCount,
        tier2EvidenceCount,
        deployerLinkedPct = 0,
        coverageLevel = 'full'
    } = args;
    const detected = walletsInvolved > 0 || inferredBundleCount > 0 || insiderClusterCount > 0;
    const exitPressure = classifyExitPressure(retentionPct);

    if (!detected) {
        return {
            detected: false,
            type: 'none',
            riskLevel: 'low',
            confidence: coverageLevel === 'full' ? 'medium' : 'low',
            walletsInvolved: 0,
            supplyControlledPct: 0,
            retentionPct,
            exitPressure,
            reasons: ['No coordinated block 0-2 wallet activity cleared the current detection threshold.']
        };
    }

    let riskScore = 0;
    if (supplyControlledPct >= 15) riskScore += 3;
    else if (supplyControlledPct >= 5) riskScore += 2;
    else if (supplyControlledPct >= 1) riskScore += 1;
    if (exitPressure === 'high') riskScore += 3;
    else if (exitPressure === 'medium') riskScore += 1;
    if (tier1EvidenceCount > 0) riskScore += 2;
    if (tier2EvidenceCount > 0) riskScore += 1;
    if (insiderClusterCount > 0) riskScore += 1;
    if (deployerLinkedPct >= 1) riskScore += 2;

    const type: BundleIntelligence['type'] =
        riskScore >= 5 ? 'exploitative' :
        riskScore >= 2 ? 'suspicious' :
        'operational';
    const riskLevel: BundleIntelligence['riskLevel'] =
        type === 'exploitative' ? 'high' :
        type === 'suspicious' ? 'medium' :
        'low';

    const evidencePoints = [
        walletsInvolved >= 2,
        supplyControlledPct > 0,
        retentionPct !== null,
        inferredBundleCount > 0,
        insiderClusterCount > 0,
        tier1EvidenceCount > 0 || tier2EvidenceCount > 0
    ].filter(Boolean).length;
    const confidence: BundleIntelligence['confidence'] =
        coverageLevel.includes('degraded') && evidencePoints < 4 ? 'low' :
        evidencePoints >= 4 ? 'high' :
        evidencePoints >= 2 ? 'medium' :
        'low';

    const reasons: string[] = [];
    if (walletsInvolved > 0) {
        pushUnique(reasons, `${walletsInvolved} wallet${walletsInvolved === 1 ? '' : 's'} entered during the first three launch blocks.`);
    }
    if (supplyControlledPct > 0) {
        pushUnique(reasons, `Linked wallets currently control ${supplyControlledPct.toFixed(2)}% of supply.`);
    }
    if (insiderClusterCount > 0) {
        pushUnique(reasons, `${insiderClusterCount} insider cluster${insiderClusterCount === 1 ? '' : 's'} connect multiple early wallets.`);
    } else if (inferredBundleCount > 0) {
        pushUnique(reasons, `${inferredBundleCount} bundle candidate${inferredBundleCount === 1 ? '' : 's'} matched timing or wallet-link evidence.`);
    }
    if (retentionPct !== null) {
        pushUnique(reasons, `Bundle retention is ${retentionPct.toFixed(2)}%, with ${exitPressure} exit pressure.`);
    }
    if (tier1EvidenceCount > 0) {
        pushUnique(reasons, 'Strong wallet-link evidence was found through funding or transfer relationships.');
    } else if (tier2EvidenceCount > 0) {
        pushUnique(reasons, 'Moderate wallet-link evidence connects part of the bundle cohort.');
    }
    if (!reasons.length) {
        pushUnique(reasons, 'Coordinated launch activity was detected, but supporting evidence is limited.');
    }

    return {
        detected,
        type,
        riskLevel,
        confidence,
        walletsInvolved,
        supplyControlledPct,
        retentionPct,
        exitPressure,
        reasons: reasons.slice(0, 4)
    };
}
