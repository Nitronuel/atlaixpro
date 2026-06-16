import type { MarketCoin } from '../types';

export const UNVERIFIED_SECTOR_ID = 'unverified';
export const UNVERIFIED_SECTOR_LABEL = 'Unverified';

export const SECTOR_FILTER_OPTIONS = [
    { value: 'all', label: 'All Sectors' },
    { value: 'ai', label: 'AI' },
    { value: 'meme', label: 'Meme' },
    { value: 'rwa', label: 'RWA' },
    { value: 'layer-1', label: 'Layer 1' },
    { value: 'defi', label: 'DeFi' },
    { value: 'gaming', label: 'Gaming' },
    { value: 'depin', label: 'DePIN' },
    { value: 'infra', label: 'Infrastructure' },
    { value: UNVERIFIED_SECTOR_ID, label: UNVERIFIED_SECTOR_LABEL }
];

export type SectorClassificationInput = Partial<MarketCoin> & {
    sector?: string;
    sectorLabels?: string[];
    providerCategories?: string[];
    providerTags?: string[];
    providerLabels?: string[];
};

export type SectorClassification = {
    primarySector: string;
    label: string;
    secondarySectors: string[];
    confidence: 'provider' | 'unverified';
    reasons: string[];
    source: string;
};

const normalizeProviderLabel = (value: unknown) => {
    const text = String(value || '')
        .replace(/[_-]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

    if (!text) return '';
    return text
        .split(' ')
        .map((part) => {
            if (part.length <= 3 && /^[a-z0-9]+$/i.test(part)) return part.toUpperCase();
            return part.charAt(0).toUpperCase() + part.slice(1).toLowerCase();
        })
        .join(' ');
};

const normalizeProviderId = (value: string) =>
    value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || UNVERIFIED_SECTOR_ID;

const approvedProviderSectorAliases: Record<string, { id: string; label: string }> = {
    ai: { id: 'ai', label: 'AI' },
    'artificial-intelligence': { id: 'ai', label: 'AI' },
    'artificial-intelligence-ai': { id: 'ai', label: 'AI' },
    'ai-agents': { id: 'ai', label: 'AI' },
    'ai-agent': { id: 'ai', label: 'AI' },
    'ai-agent-launchpad': { id: 'ai', label: 'AI' },
    'ai-applications': { id: 'ai', label: 'AI' },
    'ai-framework': { id: 'ai', label: 'AI' },
    'ai-meme': { id: 'ai', label: 'AI' },
    'ai-meme-coins': { id: 'ai', label: 'AI' },
    meme: { id: 'meme', label: 'Meme' },
    memes: { id: 'meme', label: 'Meme' },
    'meme-token': { id: 'meme', label: 'Meme' },
    'meme-tokens': { id: 'meme', label: 'Meme' },
    'solana-meme': { id: 'meme', label: 'Meme' },
    'solana-meme-coins': { id: 'meme', label: 'Meme' },
    'base-meme': { id: 'meme', label: 'Meme' },
    'base-meme-coins': { id: 'meme', label: 'Meme' },
    'bitcoin-meme': { id: 'meme', label: 'Meme' },
    'ton-meme': { id: 'meme', label: 'Meme' },
    'ton-meme-coins': { id: 'meme', label: 'Meme' },
    'sui-meme': { id: 'meme', label: 'Meme' },
    'tron-meme': { id: 'meme', label: 'Meme' },
    'chinese-meme': { id: 'meme', label: 'Meme' },
    'ip-meme': { id: 'meme', label: 'Meme' },
    'desci-meme': { id: 'meme', label: 'Meme' },
    'parody-meme': { id: 'meme', label: 'Meme' },
    'parody-meme-coins': { id: 'meme', label: 'Meme' },
    'country-themed-meme': { id: 'meme', label: 'Meme' },
    'country-themed-meme-coins': { id: 'meme', label: 'Meme' },
    'dog-themed': { id: 'meme', label: 'Meme' },
    'cat-themed': { id: 'meme', label: 'Meme' },
    'meme-launchpad': { id: 'meme', label: 'Meme' },
    'solana-meme-launchpad': { id: 'meme', label: 'Meme' },
    launchpad: { id: 'meme', label: 'Meme' },
    pumpfun: { id: 'meme', label: 'Meme' },
    'pump-fun': { id: 'meme', label: 'Meme' },
    pumpswap: { id: 'meme', label: 'Meme' },
    'pump-swap': { id: 'meme', label: 'Meme' },
    letsbonk: { id: 'meme', label: 'Meme' },
    'lets-bonk': { id: 'meme', label: 'Meme' },
    moonshot: { id: 'meme', label: 'Meme' },
    rwa: { id: 'rwa', label: 'RWA' },
    'real-world-assets': { id: 'rwa', label: 'RWA' },
    'real-world-assets-rwa': { id: 'rwa', label: 'RWA' },
    'tokenized-assets': { id: 'rwa', label: 'RWA' },
    'tokenized-treasury': { id: 'rwa', label: 'RWA' },
    'rwa-protocol': { id: 'rwa', label: 'RWA' },
    'layer-1': { id: 'layer-1', label: 'Layer 1' },
    'layer-1-l1': { id: 'layer-1', label: 'Layer 1' },
    'layer-1-blockchain': { id: 'layer-1', label: 'Layer 1' },
    'smart-contract-platform': { id: 'layer-1', label: 'Layer 1' },
    'smart-contract-platforms': { id: 'layer-1', label: 'Layer 1' },
    l1: { id: 'layer-1', label: 'Layer 1' },
    defi: { id: 'defi', label: 'DeFi' },
    'de-fi': { id: 'defi', label: 'DeFi' },
    'decentralized-finance-defi': { id: 'defi', label: 'DeFi' },
    'decentralized-exchange': { id: 'defi', label: 'DeFi' },
    dex: { id: 'defi', label: 'DeFi' },
    exchange: { id: 'defi', label: 'DeFi' },
    yield: { id: 'defi', label: 'DeFi' },
    lending: { id: 'defi', label: 'DeFi' },
    gaming: { id: 'gaming', label: 'Gaming' },
    'gaming-gamefi': { id: 'gaming', label: 'Gaming' },
    gamefi: { id: 'gaming', label: 'Gaming' },
    'gaming-blockchains': { id: 'gaming', label: 'Gaming' },
    'gaming-platform': { id: 'gaming', label: 'Gaming' },
    'gaming-marketplace': { id: 'gaming', label: 'Gaming' },
    'gaming-utility-token': { id: 'gaming', label: 'Gaming' },
    'gaming-governance-token': { id: 'gaming', label: 'Gaming' },
    'on-chain-gaming': { id: 'gaming', label: 'Gaming' },
    'play-to-earn': { id: 'gaming', label: 'Gaming' },
    metaverse: { id: 'gaming', label: 'Gaming' },
    depin: { id: 'depin', label: 'DePIN' },
    'decentralized-physical-infrastructure-network-depin': { id: 'depin', label: 'DePIN' },
    'physical-infrastructure': { id: 'depin', label: 'DePIN' },
    infra: { id: 'infra', label: 'Infrastructure' },
    infrastructure: { id: 'infra', label: 'Infrastructure' },
    oracle: { id: 'infra', label: 'Infrastructure' },
    bridge: { id: 'infra', label: 'Infrastructure' },
    interoperability: { id: 'infra', label: 'Infrastructure' }
};

const resolveApprovedProviderSector = (value: string) => {
    const normalized = normalizeProviderId(value);
    return approvedProviderSectorAliases[normalized] || null;
};

const collectProviderLabels = (token: SectorClassificationInput) => {
    const values = [
        token.sector,
        ...(token.sectorLabels || []),
        ...(token.providerCategories || []),
        ...(token.providerTags || []),
        ...(token.providerLabels || [])
    ];

    return [...new Set(values.map(normalizeProviderLabel).filter(Boolean))];
};

export const classifyTokenSector = (token: SectorClassificationInput): SectorClassification => {
    const labels = collectProviderLabels(token);
    const approvedLabels = labels
        .map((label) => ({ raw: label, sector: resolveApprovedProviderSector(label) }))
        .filter((item): item is { raw: string; sector: { id: string; label: string } } => Boolean(item.sector));
    const [primary, ...secondary] = approvedLabels;

    if (!primary) {
        return {
            primarySector: UNVERIFIED_SECTOR_ID,
            label: UNVERIFIED_SECTOR_LABEL,
            secondarySectors: [],
            confidence: 'unverified',
            reasons: labels.length
                ? ['Upstream labels were present, but none matched the supported sector taxonomy.']
                : ['No sector/category/tag label was provided by the upstream market data source.'],
            source: 'none'
        };
    }

    return {
        primarySector: primary.sector.id,
        label: primary.sector.label,
        secondarySectors: [...new Set(secondary.map((item) => item.sector.label))],
        confidence: 'provider',
        reasons: [`Sector label supplied by upstream market data: ${primary.raw}.`],
        source: 'provider'
    };
};

export const getSectorLabel = (sector: string) => {
    if (!sector || sector === UNVERIFIED_SECTOR_ID) return UNVERIFIED_SECTOR_LABEL;
    return approvedProviderSectorAliases[normalizeProviderId(sector)]?.label || normalizeProviderLabel(sector);
};
