export type EvidenceTier = 'TIER_1' | 'TIER_2' | 'TIER_3';

export type ParsedInstruction = {
    program?: string;
    programId?: string;
    parsed?: {
        type?: string;
        info?: Record<string, unknown>;
    };
};

export type ParsedAccountKey =
    | string
    | {
        pubkey?: string;
        signer?: boolean;
        writable?: boolean;
    };

export type ParsedTokenBalance = {
    accountIndex: number;
    mint: string;
    owner?: string;
    uiTokenAmount?: {
        amount?: string;
        decimals?: number;
        uiAmount?: number | null;
        uiAmountString?: string;
    };
};

export type ParsedTransaction = {
    slot: number;
    blockTime: number | null;
    meta?: {
        err?: object | null;
        fee?: number;
        preBalances?: number[];
        postBalances?: number[];
        preTokenBalances?: ParsedTokenBalance[];
        postTokenBalances?: ParsedTokenBalance[];
        logMessages?: string[];
    };
    transaction?: {
        signatures?: string[];
        message?: {
            accountKeys?: ParsedAccountKey[];
            instructions?: ParsedInstruction[];
        };
    };
};

export type MintSignature = {
    signature: string;
    slot: number;
    blockTime: number | null;
};

export type MintTokenAccount = {
    address: string;
    mint: string;
    owner: string;
    amount: string | number;
};

export type LargestAccount = {
    address: string;
    amount: string;
    uiAmountString: string;
};

export type TokenMetadata = {
    address: string;
    name: string;
    symbol: string;
    totalSupplyRaw: bigint;
    decimals: number;
    currentPriceUsd: number | null;
    marketCapUsd: number | null;
    deployerAddress: string;
    launchTimestamp: string;
};

export type BuyerEvent = {
    wallet: string;
    amount: bigint;
    slot: number;
    txHash: string;
    timestamp: string;
};

export type LaunchBuyer = BuyerEvent & {
    acquisitionType: 'buy_like' | 'transfer_in' | 'internal_rebalance' | 'unknown';
    attributionBasis: 'source_account' | 'program_context' | 'fallback';
    sourceWallets: string[];
    sourceTokenAccounts: string[];
    programs: string[];
    launchBand: 'block_0' | 'block_1' | 'block_2' | 'block_3_plus';
};

export type ClusterEdge = {
    from: string;
    to: string;
    tier: EvidenceTier;
    label: string;
    reason: string;
    txHash?: string;
    score?: number;
    hopDistance?: number;
};

export type FundingEdge = {
    sourceWallet: string;
    targetWallet: string;
    lamports: bigint;
    txHash: string;
    slot: number;
};

export type MintTransferEdge = {
    sourceWallet: string;
    targetWallet: string;
    amount: bigint;
    txHash: string;
    slot: number;
};

export type JitoTipTransfer = {
    sourceWallet: string;
    tipAccount: string;
    lamports: bigint;
    txHash: string;
    slot: number;
};

export type JitoSignalSummary = {
    inferredEdges: ClusterEdge[];
    tippedBuyerWallets: string[];
    tippedTransactionCount: number;
    uniqueTipAccounts: string[];
};

export type WalletFundingSource = {
    walletAddress: string;
    sourceAddress: string;
    sourceLabel: string | null;
    confidence: 'high' | 'medium' | 'low';
};

export type WalletIdentity = {
    address: string;
    ownerType: 'exchange' | 'protocol' | 'smart_wallet' | 'unknown';
    label: string | null;
    isLikelyInstitutional: boolean;
};

export type BundleCandidate = {
    bundleId: string;
    wallets: string[];
    launchSlot: number;
    tier: EvidenceTier;
    confidenceScore: number;
    reasons: string[];
    supportingTxHashes: string[];
    blockZeroOverlap: string[];
};

export type ForensicWalletDetail = {
    walletAddress: string;
    currentHoldingsTokens: string;
    currentHoldingsPct: number;
    flagReason: string;
};

export type ForensicWalletCluster = {
    clusterId: string;
    clusterName: string;
    evidenceTier: EvidenceTier;
    userEvidenceLabel: 'Proven Connection' | 'Strong Indicator' | 'Moderate Signal';
    walletCount: number;
    supplyHeldPct: number;
    supplyHeldTokens: string;
    whyGrouped: string;
    corroboratingSignals: string[];
    wallets: string[];
    walletDetails: ForensicWalletDetail[];
};

export type ForensicEvidenceItem = {
    title: string;
    tier: EvidenceTier;
    description: string;
    txHash?: string;
};

export type ForensicGraphNode = {
    walletAddress: string;
    label: string;
    clusterId: string | null;
    role: 'cluster_core' | 'network_linked' | 'distribution_recipient' | 'suspicious_holder' | 'deployer_linked' | 'sniper' | 'block_zero' | 'independent';
    currentHoldingsTokens: string;
    currentHoldingsPct: number;
    flagReason: string;
};

export type ForensicGraphEdge = {
    edgeId: string;
    sourceWallet: string;
    targetWallet: string;
    relationshipType: 'funding' | 'transfer' | 'launch' | 'distribution';
    displayLabel: string;
    strengthScore: number;
};

export type ForensicGraphCluster = {
    clusterId: string;
    clusterName: string;
    walletCount: number;
    supplyHeldPct: number;
    tier: EvidenceTier;
};

export type BundleIntelligence = {
    detected: boolean;
    type: 'none' | 'operational' | 'suspicious' | 'exploitative';
    riskLevel: 'low' | 'medium' | 'high';
    confidence: 'low' | 'medium' | 'high';
    walletsInvolved: number;
    supplyControlledPct: number;
    retentionPct: number | null;
    exitPressure: 'low' | 'medium' | 'high' | 'unknown';
    reasons: string[];
};

export type ForensicBundleReport = {
    tokenAddress: string;
    tokenName: string;
    tokenSymbol: string;
    tokenDecimals: number;
    analysisTimestamp: string;
    launchTimestamp: string;
    implementationMode: 'live';
    launchSummary: {
        earliestObservedSlot: number | null;
        launchBuyerCount: number;
        blockZeroWallets: string[];
        sniperWallets: string[];
        launchBands: {
            block0Wallets: number;
            block15Wallets: number;
            block650Wallets: number;
            block51PlusWallets: number;
        };
    };
    supplyAttribution: {
        deployerLinkedPct: number;
        blockZeroPct: number;
        sniperPct: number;
        clusteredPct: number;
        networkLinkedPct: number;
        remainingPct: number;
        combinedCoordinatedPct: number;
        estimatedClusterValueUsd: number | null;
        estimatedCombinedValueUsd: number | null;
    };
    holderConcentration: {
        top10Pct: number;
        top20Pct: number;
    };
    bundleInsights: {
        inferredBundleCount: number;
        blockZeroBundleClusterCount: number;
        maxTrackedHops: number;
        trackedHopDepth: number;
        evidenceByTier: {
            tier1: number;
            tier2: number;
            tier3: number;
        };
    };
    bundleIntelligence: BundleIntelligence;
    scanStats: {
        walletsExpanded: number;
        transactionsDecoded: number;
        hopWalletCounts: number[];
        usedHeliusHistory: boolean;
        usedWalletApi: boolean;
        historySource: 'helius_ordered' | 'signature_paging';
        coverageLevel: 'full' | 'degraded_history' | 'degraded_enrichment' | 'degraded_history_and_enrichment';
    };
    walletClusters: ForensicWalletCluster[];
    ecosystemGraph: {
        nodes: ForensicGraphNode[];
        edges: ForensicGraphEdge[];
        clusters: ForensicGraphCluster[];
    };
    evidenceHighlights: ForensicEvidenceItem[];
    notes: string[];
};
