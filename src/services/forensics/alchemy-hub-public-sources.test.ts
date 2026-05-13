// Regression coverage for forensic intelligence behavior.
import { describe, expect, it } from 'vitest';
import { buildCoordinatedWalletUnion, buildWeakLinkedWalletUnion, classifySolanaConnector, filterPublicSolanaFundingEdges } from './alchemy-hub';

describe('lite Solana public source filtering', () => {
    it('keeps low-degree private connector candidates risk eligible', () => {
        const decision = classifySolanaConnector(
            'PrivateSource111111111111111111111111111111',
            2,
            4
        );

        expect(decision.riskEligible).toBe(true);
        expect(decision.decisionClass).toBe('risk_eligible');
    });

    it('downgrades high-degree shared sources to context only', () => {
        const decision = classifySolanaConnector(
            'NoisySource1111111111111111111111111111111',
            12,
            4
        );

        expect(decision.riskEligible).toBe(false);
        expect(decision.decisionClass).toBe('high_degree_noisy');
    });

    it('removes public funding endpoints from clustering edges without removing wallets', () => {
        const publicSource = 'PublicExchange111111111111111111111111111';
        const trackedWallet = 'TrackedWallet111111111111111111111111111';
        const decisions = new Map([
            [publicSource, {
                address: publicSource,
                excluded: true,
                category: 'program_owned' as const,
                reason: 'Public source excluded from cluster scoring.'
            }]
        ]);

        const result = filterPublicSolanaFundingEdges([
            {
                sourceWallet: publicSource,
                targetWallet: trackedWallet,
                lamports: 1_000_000n,
                count: 1
            },
            {
                sourceWallet: 'PrivateSource111111111111111111111111111111',
                targetWallet: trackedWallet,
                lamports: 2_000_000n,
                count: 1
            }
        ], decisions);

        expect(result.edges).toHaveLength(1);
        expect(result.edges[0].sourceWallet).toContain('PrivateSource');
        expect(result.excludedConnectors).toHaveLength(1);
    });

    it('removes high-fanout funding sources from clustering edges', () => {
        const edges = Array.from({ length: 6 }, (_, index) => ({
            sourceWallet: 'HotWallet11111111111111111111111111111111',
            targetWallet: `TrackedWallet${index}111111111111111111111111`,
            lamports: 1_000_000n,
            count: 1
        }));

        const result = filterPublicSolanaFundingEdges(edges, new Map(), 4);

        expect(result.edges).toHaveLength(0);
        expect(result.excludedConnectors[0].decisionClass).toBe('high_degree_noisy');
    });

    it('keeps shared connector-only wallets out of confirmed coordinated supply', () => {
        const confirmed = buildCoordinatedWalletUnion({
            walletClusters: []
        });
        const weak = buildWeakLinkedWalletUnion({
            confirmedWallets: confirmed,
            connectorEdges: [
                {
                    from: 'HolderA111111111111111111111111111111111',
                    to: 'HolderB111111111111111111111111111111111',
                    riskEligible: true
                }
            ],
            secondHopConnectorEdges: []
        });

        expect(confirmed).toEqual([]);
        expect(weak).toEqual([
            'HolderA111111111111111111111111111111111',
            'HolderB111111111111111111111111111111111'
        ]);
    });

    it('counts only proven cluster wallets as confirmed coordinated supply', () => {
        const confirmed = buildCoordinatedWalletUnion({
            walletClusters: [
                {
                    clusterId: 'cluster-1',
                    clusterName: 'Confirmed Cluster',
                    evidenceTier: 'TIER_1',
                    userEvidenceLabel: 'Proven Connection',
                    walletCount: 2,
                    supplyHeldPct: 4,
                    supplyHeldTokens: '4000000',
                    whyGrouped: 'Direct funding link.',
                    corroboratingSignals: ['direct funding'],
                    wallets: ['HolderA111111111111111111111111111111111', 'HolderB111111111111111111111111111111111'],
                    walletDetails: []
                }
            ],
            connectorEdges: [
                {
                    from: 'HolderC111111111111111111111111111111111',
                    to: 'HolderD111111111111111111111111111111111',
                    riskEligible: true
                }
            ],
            secondHopConnectorEdges: []
        });

        expect(confirmed).toEqual([
            'HolderA111111111111111111111111111111111',
            'HolderB111111111111111111111111111111111'
        ]);
    });
});
