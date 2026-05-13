// Forensic backend workflow for local intelligence services.
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { URL } from 'node:url';
import { LocalDurableForensicsQueue } from './forensics-queue';
import {
    discoverSmartScannerEarlyBuyers,
    isLikelyEvmAddress,
    isLikelySolanaAddress,
    isSmartScannerChain
} from './smart-money-scanner-discovery';
import { ImpactfulTokenActivityStore } from './impactful-token-activity';

const PORT = Number(process.env.PORT || process.env.FORENSICS_PORT || 3101);
const HOST = process.env.HOST || '0.0.0.0';
const queue = new LocalDurableForensicsQueue(resolve(process.cwd()));

function loadEnvFile(filename: string, override = false) {
    const filepath = resolve(process.cwd(), filename);
    if (!existsSync(filepath)) {
        return;
    }

    const lines = readFileSync(filepath, 'utf8').split(/\r?\n/);
    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) {
            continue;
        }

        const separatorIndex = trimmed.indexOf('=');
        if (separatorIndex <= 0) {
            continue;
        }

        const key = trimmed.slice(0, separatorIndex).trim();
        const rawValue = trimmed.slice(separatorIndex + 1).trim();
        const value = rawValue.replace(/^['"]|['"]$/g, '');

        if (override || !process.env[key]) {
            process.env[key] = value;
        }
    }
}

loadEnvFile('.env');
loadEnvFile('.env.local', true);

const LEGACY_BACKEND_ENV_MAP: Record<string, string> = {
    VITE_MORALIS_KEY: 'MORALIS_API_KEY',
    VITE_ALCHEMY_KEY: 'ALCHEMY_API_KEY',
    VITE_HELIUS_KEY: 'HELIUS_API_KEY',
    VITE_GOPLUS_KEY: 'GOPLUS_KEY',
    VITE_GOPLUS_SECRET: 'GOPLUS_SECRET'
};

for (const [legacyKey, backendKey] of Object.entries(LEGACY_BACKEND_ENV_MAP)) {
    if (!process.env[backendKey] && process.env[legacyKey]) {
        process.env[backendKey] = process.env[legacyKey];
    }
}

const { analyzeForensicToken } = await import('../src/services/forensics/engine');
const { analyzeAlchemyHubToken } = await import('../src/services/forensics/alchemy-hub');
const { analyzeAlchemyHubEvmToken } = await import('../src/services/forensics/alchemy-hub-evm');
const { fetchMoralisTopHolders } = await import('../src/services/forensics/moralis-top-holders');
const { getAlchemyHubChain, getAlchemyHubScanDepth, isEvmChain } = await import('../src/services/forensics/alchemy-hub-chains');
const { DetectionEngineRunner } = await import('./detection-engine-runner');
const { DetectionSnapshotStore } = await import('./detection-snapshot-store');
const { DetectionOutcomeTracker } = await import('./detection-outcome-tracker');
const { DatabaseService } = await import('../src/services/DatabaseService');
const { ChainRouter } = await import('../src/services/ChainRouter');
const { SmartMoneyQualificationService } = await import('../src/services/SmartMoneyQualificationService');
const { validateWalletAddress } = await import('../src/utils/wallet');
const { SmartAlertRunner } = await import('./smart-alert-runner');
const detectionEngine = new DetectionEngineRunner();
const smartAlertRunner = new SmartAlertRunner();

const PROVIDER_TIMEOUT_MS = 18_000;
const PROVIDER_ALLOWED_HOSTS = new Set([
    'deep-index.moralis.io',
    'solana-gateway.moralis.io',
    'api.gopluslabs.io'
]);
const PUBLIC_PROXY_ROUTES = [
    {
        prefix: '/api/dexscreener',
        target: 'https://api.dexscreener.com',
        methods: new Set(['GET'])
    },
    {
        prefix: '/api/graph',
        target: 'https://api.thegraph.com',
        methods: new Set(['GET', 'POST'])
    },
    {
        prefix: '/api/solana-public',
        target: 'https://api.mainnet-beta.solana.com',
        methods: new Set(['POST'])
    }
] as const;

const CHAIN_DEX_VOLUME_LABELS: Record<string, string> = {
    solana: 'Solana',
    ethereum: 'Ethereum',
    base: 'Base',
    bsc: 'BSC',
    polygon: 'Polygon',
    arbitrum: 'Arbitrum',
    avalanche: 'Avalanche',
    optimism: 'OP Mainnet',
    ton: 'TON',
    sui: 'Sui'
};

type AssistantNotification = {
    id: string;
    title: string;
    body: string;
    tone: 'bullish' | 'bearish' | 'neutral' | 'risk';
    href?: string;
    timestamp: number;
};

type AssistantChatAction = {
    label: string;
    href: string;
    kind?: 'navigate' | 'draft' | 'confirmable';
    confirmationRequired?: boolean;
    payload?: unknown;
};

type AssistantProvider = {
    configured: boolean;
    model: string | null;
    mode: 'model-ready' | 'local-tool-router';
};

type AssistantConversationMessage = {
    role?: string;
    text?: string;
};

type AssistantToolName =
    | 'conversation'
    | 'get_token_deep_brief'
    | 'get_wallet_deep_brief'
    | 'get_platform_updates'
    | 'get_detection_updates'
    | 'run_safe_scan'
    | 'prepare_alert_setup'
    | 'get_token_activity'
    | 'get_token_overview'
    | 'get_smart_alert_status';

type AssistantToolRequest = {
    tool: AssistantToolName;
    address?: string;
    chain?: string;
    query?: string;
    responseStyle?: 'brief' | 'detailed';
};

const getAssistantProvider = (): AssistantProvider => {
    const model = readEnv('OPENROUTER_MODEL') || null;
    const configured = Boolean(readEnv('OPENROUTER_API_KEY') && model);
    return {
        configured,
        model,
        mode: configured ? 'model-ready' : 'local-tool-router'
    };
};

const compactUsd = (value: number | null | undefined) => {
    const numeric = Number(value || 0);
    if (!Number.isFinite(numeric) || numeric <= 0) return '$0';
    if (numeric >= 1_000_000_000) return `$${(numeric / 1_000_000_000).toFixed(2)}B`;
    if (numeric >= 1_000_000) return `$${(numeric / 1_000_000).toFixed(2)}M`;
    if (numeric >= 1_000) return `$${(numeric / 1_000).toFixed(2)}K`;
    return `$${numeric.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
};

const inferAssistantChain = (message: string, address: string) => {
    const lower = message.toLowerCase();
    if (lower.includes('solana') || lower.includes('pump')) return 'solana';
    if (lower.includes('bsc') || lower.includes('bnb')) return 'bsc';
    if (lower.includes('base')) return 'base';
    if (lower.includes('polygon')) return 'polygon';
    if (lower.includes('ethereum') || lower.includes('eth')) return 'ethereum';
    return isLikelyEvmAddress(address) ? 'ethereum' : 'solana';
};

const extractAssistantAddress = (message: string) => {
    const evm = message.match(/0x[a-fA-F0-9]{40}/)?.[0];
    if (evm) return evm;

    const solana = message.match(/\b[1-9A-HJ-NP-Za-km-z]{32,44}\b/)?.[0];
    return solana || '';
};

const getRecentAssistantAddress = (messages: AssistantConversationMessage[] = []) => {
    for (const message of [...messages].reverse()) {
        const found = extractAssistantAddress(String(message.text || ''));
        if (found) return found;
    }
    return '';
};

const TOKEN_QUERY_STOP_WORDS = new Set([
    'what', 'is', 'the', 'current', 'price', 'of', 'coin', 'token', 'please', 'pls',
    'show', 'me', 'tell', 'about', 'for', 'on', 'chain', 'details', 'overview', 'market',
    'cap', 'liquidity', 'volume', 'this', 'that', 'yes', 'it', 'one', 'talking'
]);

const cleanAssistantTokenQuery = (value: string) => value
    .replace(/\$([a-zA-Z0-9]+)/g, '$1')
    .replace(/[^a-zA-Z0-9\s.-]/g, ' ')
    .split(/\s+/)
    .filter((word) => word && !TOKEN_QUERY_STOP_WORDS.has(word.toLowerCase()))
    .join(' ')
    .trim();

const extractAssistantTokenQuery = (message: string, history: AssistantConversationMessage[] = []) => {
    const address = extractAssistantAddress(message);
    if (address) return address;

    const directPatterns = [
        /\b(?:price|details|overview|market\s*cap|liquidity|volume)\s+(?:of|for|on)?\s+(.+?)(?:\?|$)/i,
        /\b(?:tell me about|show me)\s+(.+?)(?:\?|$)/i
    ];

    for (const pattern of directPatterns) {
        const match = message.match(pattern)?.[1];
        const cleaned = cleanAssistantTokenQuery(match || '');
        if (cleaned) return cleaned;
    }

    const cleanedMessage = cleanAssistantTokenQuery(message);
    if (cleanedMessage && !/\b(yes|that|this|it)\b/i.test(message)) return cleanedMessage;

    for (const item of [...history].reverse()) {
        if (item.role === 'assistant') continue;
        const prior = extractAssistantAddress(String(item.text || '')) || extractAssistantTokenQuery(String(item.text || ''), []);
        if (prior) return prior;
    }

    return '';
};

const normalizeAssistantChainLabel = (chain: string | undefined) => {
    const lower = String(chain || '').toLowerCase();
    if (lower === 'bsc') return 'BNB Chain';
    if (lower === 'eth' || lower === 'ethereum') return 'Ethereum';
    if (lower === 'sol' || lower === 'solana') return 'Solana';
    return chain || 'Unknown Chain';
};

const parseAssistantMarketNumber = (value: string | number | undefined) => {
    if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
    const raw = String(value || '').replace(/[$,%+\s,]/g, '').toUpperCase();
    const parsed = Number.parseFloat(raw);
    if (!Number.isFinite(parsed)) return 0;
    if (raw.includes('T')) return parsed * 1e12;
    if (raw.includes('B')) return parsed * 1e9;
    if (raw.includes('M')) return parsed * 1e6;
    if (raw.includes('K')) return parsed * 1e3;
    return parsed;
};

const formatAssistantPrice = (value: string | number | undefined) => {
    const numeric = parseAssistantMarketNumber(value);
    if (!Number.isFinite(numeric) || numeric <= 0) return String(value || 'unavailable');
    if (numeric < 0.000001) return `$${numeric.toExponential(2)}`;
    if (numeric < 1) return `$${numeric.toFixed(8).replace(/0+$/, '').replace(/\.$/, '')}`;
    return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
        maximumFractionDigits: 6
    }).format(numeric);
};

const formatAssistantCurrencyThreshold = (value: number) => {
    if (!Number.isFinite(value) || value <= 0) return '';
    if (value < 0.000001) return `$${value.toExponential(2)}`;
    if (value < 1) return `$${value.toFixed(8).replace(/0+$/, '').replace(/\.$/, '')}`;
    return `$${value.toFixed(value >= 100 ? 2 : 6).replace(/0+$/, '').replace(/\.$/, '')}`;
};

const extractAssistantAlertPercent = (message: string) => {
    const match = message.match(/(-?\d+(?:\.\d+)?)\s*%/);
    return match ? Math.abs(Number(match[1])) : null;
};

const extractAssistantAlertIntent = async (
    message: string,
    tokenQuery: string,
    chain: string
) => {
    const lower = message.toLowerCase();
    const percent = extractAssistantAlertPercent(message);
    const token = tokenQuery ? await resolveAssistantTokenOverview(tokenQuery, chain) : null;
    const currentPrice = parseAssistantMarketNumber((token as any)?.price);
    const isDown = /\b(down|drops?|falls?|decrease|decreases|below|under)\b/.test(lower);
    const isUp = /\b(up|rises?|increase|increases|above|over|pumps?)\b/.test(lower);

    let alertType = 'price-target';
    let condition: 'above' | 'below' | 'changes_by_percent' | 'buy_above' | 'sell_above' | 'buy_or_sell_above' = isDown ? 'below' : 'above';
    let thresholdKind: 'currency' | 'percent' = 'currency';
    let threshold = '';

    if (/\bvolume\b/.test(lower)) {
        alertType = 'volume';
    } else if (/\bliquidity\b/.test(lower)) {
        alertType = 'liquidity';
    } else if (/\bwhale\b|\bbuy\b|\bsell\b/.test(lower) && /\$?\d/.test(message) && !/\bprice\b/.test(lower)) {
        alertType = 'whale';
        condition = lower.includes('sell') ? 'sell_above' : lower.includes('buy') ? 'buy_above' : 'buy_or_sell_above';
    }

    const currencyMatch = message.match(/\$?\d+(?:\.\d+)?\s*[kKmMbB]?/);
    if (percent !== null && alertType === 'price-target' && currentPrice > 0 && (isUp || isDown || lower.includes('current price'))) {
        const multiplier = isDown ? 1 - (percent / 100) : 1 + (percent / 100);
        threshold = formatAssistantCurrencyThreshold(currentPrice * multiplier);
        condition = isDown ? 'below' : 'above';
    } else if (percent !== null && alertType !== 'whale') {
        alertType = alertType === 'price-target' ? 'price-move' : alertType;
        condition = 'changes_by_percent';
        thresholdKind = 'percent';
        threshold = String(percent);
    } else if (currencyMatch) {
        threshold = currencyMatch[0].trim();
    }

    if (!threshold) {
        threshold = alertType === 'whale' ? '$50K' : alertType === 'volume' ? '$1M' : alertType === 'liquidity' ? '$100K' : '$0';
    }

    return {
        token,
        alertType,
        condition,
        thresholdKind,
        threshold,
        percent,
        direction: isDown ? 'down' : isUp ? 'up' : ''
    };
};

const pairToAssistantToken = (pair: any) => {
    if (!pair) return null;
    const token = pair.baseToken || {};
    return {
        name: token.name || 'Unknown Token',
        ticker: token.symbol || 'TOKEN',
        address: token.address || '',
        pairAddress: pair.pairAddress,
        chain: pair.chainId || 'unknown',
        price: pair.priceUsd ? `$${pair.priceUsd}` : '$0',
        h24: `${Number(pair.priceChange?.h24 || 0).toFixed(2)}%`,
        volume24h: compactUsd(Number(pair.volume?.h24 || 0)),
        liquidity: compactUsd(Number(pair.liquidity?.usd || 0)),
        cap: compactUsd(Number(pair.marketCap || pair.fdv || 0))
    };
};

const resolveAssistantTokenOverview = async (query: string, chain?: string) => {
    const trimmed = query.trim();
    if (!trimmed) return null;

    const isAddress = isLikelyEvmAddress(trimmed) || isLikelySolanaAddress(trimmed);
    if (isAddress) {
        const pair = await DatabaseService.getTokenDetails(trimmed, chain);
        const tokenFromPair = pairToAssistantToken(pair);
        if (tokenFromPair) return tokenFromPair;
    }

    const searchResults = await DatabaseService.searchGlobalPairs(trimmed);
    const normalizedChain = chain ? chain.toLowerCase() : '';
    const preferred = searchResults.find((token: any) => {
        if (!normalizedChain) return true;
        const tokenChain = String(token.chain || '').toLowerCase();
        return tokenChain === normalizedChain || normalizeAssistantChainLabel(tokenChain).toLowerCase() === normalizeAssistantChainLabel(chain).toLowerCase();
    }) || searchResults[0];

    return preferred || null;
};

const eventTokenHref = (event: any) => {
    const token = event?.token || {};
    const address = token.address || token.pairAddress || token.ticker || '';
    if (!address) return '/detection';
    const params = new URLSearchParams({
        source: 'detection',
        severity: event.severity || 'Medium',
        eventType: event.eventType || 'Unusual Activity',
        score: String(event.score || 0),
        detectedAt: String(event.detectedAt || Date.now())
    });
    return `/detection/token/${encodeURIComponent(address)}?${params.toString()}`;
};

const formatAssistantDetectionLine = (event: any) => {
    const token = event?.token || {};
    const label = token.ticker || token.name || 'Unknown token';
    const volume = compactUsd(event?.metrics?.volume24h);
    const liquidity = compactUsd(event?.metrics?.liquidity);
    return `${label}: ${event.eventType || 'Detection'} (${event.severity || 'Medium'}) with score ${event.score || 0}. 24h volume ${volume}, liquidity ${liquidity}.`;
};

type AssistantEntityResolution = {
    kind: 'token' | 'wallet' | 'unknown';
    confidence: 'high' | 'medium' | 'low';
    query: string;
    address?: string;
    chain?: string;
    token?: any;
    candidates?: any[];
    reason?: string;
};

const normalizeAssistantChainId = (chain?: string) => {
    const lower = String(chain || '').trim().toLowerCase();
    if (!lower) return '';
    if (lower === 'eth') return 'ethereum';
    if (lower === 'sol') return 'solana';
    if (lower === 'bnb' || lower === 'binance') return 'bsc';
    return lower;
};

const toAlchemyAssistantChain = (chain?: string, address?: string): 'solana' | 'eth' | 'base' | 'bsc' | 'polygon' | 'arbitrum' | 'optimism' => {
    const normalized = normalizeAssistantChainId(chain || (address ? inferAssistantChain('', address) : ''));
    if (normalized === 'ethereum') return 'eth';
    if (normalized === 'base') return 'base';
    if (normalized === 'bsc') return 'bsc';
    if (normalized === 'polygon') return 'polygon';
    if (normalized === 'arbitrum') return 'arbitrum';
    if (normalized === 'optimism') return 'optimism';
    return 'solana';
};

const toPortfolioChain = (chain?: string, address?: string) => {
    const normalized = normalizeAssistantChainId(chain);
    if (normalized === 'solana') return 'Solana';
    if (normalized === 'bsc') return 'BSC';
    if (normalized === 'base') return 'Base';
    if (normalized === 'polygon') return 'Polygon';
    if (normalized === 'arbitrum') return 'Arbitrum';
    if (normalized === 'optimism') return 'Optimism';
    if (normalized === 'avalanche') return 'Avalanche';
    if (normalized === 'ethereum') return 'Ethereum';
    return address && isLikelyEvmAddress(address) ? 'All Chains' : 'Solana';
};

const safeAssistantText = (value: unknown, fallback = 'unavailable') => {
    const text = String(value ?? '').trim();
    return text || fallback;
};

const pctLabel = (value: unknown) => {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return safeAssistantText(value);
    return `${numeric >= 0 ? '+' : ''}${numeric.toFixed(2)}%`;
};

const withAssistantTimeout = async <T>(promise: Promise<T>, timeoutMs: number, fallback: T): Promise<T> => {
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    try {
        return await Promise.race([
            promise,
            new Promise<T>((resolve) => {
                timeoutId = setTimeout(() => resolve(fallback), timeoutMs);
            })
        ]);
    } finally {
        if (timeoutId) clearTimeout(timeoutId);
    }
};

const matchesAssistantTokenEvent = (event: any, addressOrQuery: string, chain?: string) => {
    const query = String(addressOrQuery || '').toLowerCase();
    if (!query) return false;
    const token = event?.token || {};
    const normalizedChain = normalizeAssistantChainId(chain);
    const eventChain = normalizeAssistantChainId(token.chain);
    if (normalizedChain && eventChain && normalizedChain !== eventChain) return false;

    return [
        token.address,
        token.pairAddress,
        token.ticker,
        token.name
    ].filter(Boolean).some((value) => String(value).toLowerCase() === query || String(value).toLowerCase().includes(query));
};

const resolveAssistantEntity = async (
    query: string,
    chain?: string,
    preferredKind?: 'token' | 'wallet'
): Promise<AssistantEntityResolution> => {
    const trimmed = query.trim();
    if (!trimmed) {
        return { kind: 'unknown', confidence: 'low', query, reason: 'No entity query was provided.' };
    }

    const normalizedChain = normalizeAssistantChainId(chain);
    const isAddress = isLikelyEvmAddress(trimmed) || isLikelySolanaAddress(trimmed);

    if (preferredKind === 'wallet' && isAddress) {
        return {
            kind: 'wallet',
            confidence: 'high',
            query: trimmed,
            address: trimmed,
            chain: normalizedChain || inferAssistantChain('', trimmed)
        };
    }

    const token = await withAssistantTimeout(resolveAssistantTokenOverview(trimmed, normalizedChain), 8_000, null);
    if (token) {
        return {
            kind: 'token',
            confidence: token.address ? 'high' : 'medium',
            query: trimmed,
            address: token.address || (isAddress ? trimmed : ''),
            chain: normalizeAssistantChainId(token.chain || normalizedChain || (isAddress ? inferAssistantChain('', trimmed) : '')),
            token
        };
    }

    if (isAddress) {
        return {
            kind: preferredKind === 'wallet' ? 'wallet' : 'token',
            confidence: preferredKind === 'wallet' ? 'high' : 'medium',
            query: trimmed,
            address: trimmed,
            chain: normalizedChain || inferAssistantChain('', trimmed),
            reason: preferredKind === 'wallet'
                ? 'Address matched wallet format.'
                : 'Address matched token format, but no market pair was found yet.'
        };
    }

    const candidates = await withAssistantTimeout(DatabaseService.searchGlobalPairs(trimmed).catch(() => []), 6_000, []);
    if (candidates.length) {
        const preferred = candidates[0];
        return {
            kind: 'token',
            confidence: candidates.length === 1 ? 'high' : 'medium',
            query: trimmed,
            address: preferred.address,
            chain: normalizeAssistantChainId(preferred.chain),
            token: preferred,
            candidates
        };
    }

    return { kind: 'unknown', confidence: 'low', query: trimmed, reason: 'No matching token or wallet was found in the accessible app data.' };
};

const getAssistantDetectionContext = async (addressOrQuery: string, chain?: string) => {
    const normalizedChain = normalizeAssistantChainId(chain);
    if (addressOrQuery && normalizedChain) {
        const event = await DetectionSnapshotStore.getToken(normalizedChain, addressOrQuery).catch(() => null);
        if (event) return [event];
    }

    const feed = await DetectionSnapshotStore.getFeed().catch(async () => DatabaseService.fetchDetectionEvents());
    return (feed || []).filter((event: any) => matchesAssistantTokenEvent(event, addressOrQuery, normalizedChain)).slice(0, 5);
};

const getAssistantSafeScanSummary = async (address: string, chain: string) => {
    if (!address) return null;
    try {
        const selectedChain = toAlchemyAssistantChain(chain, address);
        const report = isEvmChain(selectedChain)
            ? await analyzeAlchemyHubEvmToken(address, selectedChain, { depth: 'balanced', holderSeeds: [], seedOnly: true })
            : await analyzeAlchemyHubToken(address, { depth: 'balanced', holderSeeds: [], seedOnly: true });

        return {
            report,
            riskLevel: report?.bundleIntelligence?.riskLevel || 'unknown',
            confidence: report?.bundleIntelligence?.confidence || 'unknown',
            coordinatedSupplyPct: Number(report?.supplyAttribution?.combinedCoordinatedPct || 0),
            top10Pct: Number(report?.holderConcentration?.top10Pct || 0),
            reasons: Array.isArray(report?.bundleIntelligence?.reasons) ? report.bundleIntelligence.reasons.slice(0, 4) : [],
            highlights: Array.isArray(report?.evidenceHighlights) ? report.evidenceHighlights.slice(0, 4) : []
        };
    } catch (error) {
        return {
            error: error instanceof Error ? error.message : 'Safe Scan context is unavailable.'
        };
    }
};

const summarizeAssistantLiquidity = (token: any, detectionEvents: any[]) => {
    const liquidityUsd = parseAssistantMarketNumber(token?.liquidity);
    const marketCapUsd = parseAssistantMarketNumber(token?.cap);
    const volumeUsd = parseAssistantMarketNumber(token?.volume24h);
    const lpRatio = marketCapUsd > 0 ? liquidityUsd / marketCapUsd : 0;
    const latestLiquidityDelta = detectionEvents
        .flatMap((event: any) => Array.isArray(event?.snapshotDeltas) ? event.snapshotDeltas : [])
        .find((delta: any) => Number.isFinite(Number(delta?.liquidityChangePct)));

    let quality = 'thin or unknown';
    if (liquidityUsd >= 1_000_000) quality = 'deep';
    else if (liquidityUsd >= 250_000) quality = 'healthy';
    else if (liquidityUsd >= 50_000) quality = 'moderate';
    else if (liquidityUsd > 0) quality = 'thin';

    const notes = [
        `Liquidity is ${safeAssistantText(token?.liquidity, '$0')}, which looks ${quality} for this market context.`,
        marketCapUsd > 0 && liquidityUsd > 0 ? `Liquidity-to-market-cap is about ${(lpRatio * 100).toFixed(2)}%.` : '',
        volumeUsd > 0 && liquidityUsd > 0 ? `24h volume is ${(volumeUsd / liquidityUsd).toFixed(2)}x current liquidity.` : '',
        latestLiquidityDelta ? `Recent liquidity delta: ${pctLabel(latestLiquidityDelta.liquidityChangePct)} over ${latestLiquidityDelta.window}.` : ''
    ].filter(Boolean);

    return { liquidityUsd, marketCapUsd, volumeUsd, quality, notes };
};

const buildTokenDeepBrief = async (query: string, chain: string, message: string, history: AssistantConversationMessage[] = []) => {
    const resolution = await resolveAssistantEntity(query, chain, 'token');
    if (resolution.kind !== 'token') {
        return {
            answer: [
                `I could not resolve "${query}" as a token from the app data I can access.`,
                resolution.reason || 'Try a contract address, ticker, or exact token name from Atlaix.'
            ].join('\n'),
            tool: 'get_token_deep_brief',
            data: { resolution },
            actions: [
                { label: 'Open Detection Engine', href: '/detection', kind: 'navigate' },
                { label: 'Open Safe Scan', href: '/safe-scan', kind: 'navigate' }
            ]
        };
    }

    const token = resolution.token || await withAssistantTimeout(resolveAssistantTokenOverview(resolution.address || query, resolution.chain), 8_000, null);
    const tokenAddress = resolution.address || token?.address || query;
    const tokenChain = normalizeAssistantChainId(resolution.chain || chain || token?.chain || inferAssistantChain(message, tokenAddress));
    const [detectionEvents, activities, safeScan] = await Promise.all([
        withAssistantTimeout(getAssistantDetectionContext(tokenAddress || query, tokenChain), 6_000, []),
        tokenAddress ? withAssistantTimeout(ImpactfulTokenActivityStore.getActivities(tokenChain, tokenAddress).catch(() => []), 5_000, []) : Promise.resolve([]),
        tokenAddress ? withAssistantTimeout(getAssistantSafeScanSummary(tokenAddress, tokenChain), 12_000, { error: 'Safe Scan context timed out before the brief was ready.' }) : Promise.resolve(null)
    ]);

    const liquidity = summarizeAssistantLiquidity(token, detectionEvents);
    const recentEvents = detectionEvents.slice(0, 3);
    const recentActivities = activities.slice(0, 4);
    const riskReasons = Array.isArray((safeScan as any)?.reasons) ? (safeScan as any).reasons : [];
    const safeError = (safeScan as any)?.error;
    const highSeverityEvent = recentEvents.find((event: any) => event?.severity === 'High');
    const riskLevel = (safeScan as any)?.riskLevel || token?.riskLevel || 'unknown';
    const confidenceBits = [
        token ? 'market data' : '',
        recentEvents.length ? 'detection context' : '',
        recentActivities.length ? 'activity timeline' : '',
        safeScan && !safeError ? 'Safe Scan context' : ''
    ].filter(Boolean);
    const confidence = confidenceBits.length >= 3 ? 'High' : confidenceBits.length >= 2 ? 'Medium' : 'Low';

    const interpretation = highSeverityEvent
        ? `Interpretation: mixed-to-risky. The strongest caution is a High severity ${highSeverityEvent.eventType || 'detection'} signal, so I would treat momentum claims carefully until the risk context improves.`
        : riskLevel && /high|critical/i.test(String(riskLevel))
            ? `Interpretation: risk-first. The scan context is elevated, so price action should be weighed against holder and supply quality before trusting the move.`
            : recentEvents.some((event: any) => /Accumulation|Recovery/i.test(String(event?.eventType)))
                ? `Interpretation: constructive but still needs confirmation. Detection context points to interest building, and liquidity/activity should be watched for follow-through.`
                : `Interpretation: watchable, but not conclusive. I can summarize the available data, but I do not see enough strong recent app signals to call it cleanly bullish or bearish.`;

    const tokenLabel = `${token?.name || token?.ticker || 'Token'}${token?.ticker ? ` (${token.ticker})` : ''}`;
    const answer = [
        `Atlaix Brief: ${tokenLabel}`,
        '',
        'Current read',
        `${tokenLabel} is on ${normalizeAssistantChainLabel(tokenChain)} at ${formatAssistantPrice(token?.price)}. 24h move: ${safeAssistantText(token?.h24)}. Volume: ${safeAssistantText(token?.volume24h, '$0')}. Liquidity: ${safeAssistantText(token?.liquidity, '$0')}. Market cap: ${safeAssistantText(token?.cap, '$0')}.`,
        '',
        'Liquidity and market quality',
        ...liquidity.notes,
        '',
        'Recent activity',
        recentEvents.length
            ? recentEvents.map((event: any, index: number) => `${index + 1}. ${formatAssistantDetectionLine(event)}`).join('\n')
            : 'No matching Detection Engine event is currently stored for this token.',
        recentActivities.length
            ? recentActivities.map((activity: any, index: number) => `${index + 1}. ${activity.title}: ${activity.description} (${compactUsd(activity.usdValue)}).`).join('\n')
            : 'No reportable whale/impact activity is currently stored for this token.',
        '',
        'Risk picture',
        safeError
            ? `Safe Scan context is unavailable right now: ${safeError}`
            : safeScan
                ? `Risk level: ${(safeScan as any).riskLevel} with ${(safeScan as any).confidence} confidence. Coordinated supply estimate: ${Number((safeScan as any).coordinatedSupplyPct || 0).toFixed(2)}%. Top 10 holders: ${Number((safeScan as any).top10Pct || 0).toFixed(2)}%.`
                : 'Safe Scan context was not available for this token.',
        riskReasons.length ? `Main risk reasons: ${riskReasons.join(' ')}` : '',
        '',
        interpretation,
        `Confidence: ${confidence}. Based on ${confidenceBits.length ? confidenceBits.join(', ') : 'limited accessible app data'}.`,
        '',
        'Suggested next moves',
        'Open the token page for chart context, run or review Safe Scan for holder/supply risk, and set an alert if you want Atlaix to watch liquidity, price, or whale movement.'
    ].filter((line) => line !== '').join('\n');

    const params = new URLSearchParams({ address: tokenAddress, chain: tokenChain });
    const safeScanChain = toAlchemyAssistantChain(tokenChain, tokenAddress);
    return {
        answer,
        tool: 'get_token_deep_brief',
        data: {
            resolution,
            token,
            detectionEvents: recentEvents,
            activities: recentActivities,
            safeScan: safeScan && !safeError ? {
                riskLevel: (safeScan as any).riskLevel,
                confidence: (safeScan as any).confidence,
                coordinatedSupplyPct: (safeScan as any).coordinatedSupplyPct,
                top10Pct: (safeScan as any).top10Pct
            } : null,
            confidence
        },
        actions: [
            { label: 'Open Token Details', href: tokenAddress ? `/token/${encodeURIComponent(tokenAddress)}` : '/dashboard', kind: 'navigate' },
            { label: 'Open Detection View', href: tokenAddress ? `/detection/token/${encodeURIComponent(tokenAddress)}?${params.toString()}` : '/detection', kind: 'navigate' },
            { label: 'Run Safe Scan', href: `/safe-scan?${new URLSearchParams({ address: tokenAddress, chain: safeScanChain, autoScan: '1' }).toString()}`, kind: 'draft', confirmationRequired: true },
            { label: 'Set Alert', href: `/smart-alerts?${new URLSearchParams({ address: tokenAddress, chain: tokenChain, setup: '1' }).toString()}`, kind: 'draft', confirmationRequired: true }
        ] as AssistantChatAction[]
    };
};

const buildWalletDeepBrief = async (address: string, chain: string) => {
    const resolution = await resolveAssistantEntity(address, chain, 'wallet');
    if (!resolution.address) {
        return {
            answer: 'I can analyze a wallet, but I need a valid EVM or Solana wallet address first.',
            tool: 'get_wallet_deep_brief',
            data: { resolution },
            actions: [{ label: 'Open Wallet Tracker', href: '/wallet', kind: 'navigate' }]
        };
    }

    const portfolioChain = toPortfolioChain(resolution.chain || chain, resolution.address);
    try {
        const [portfolio, smartWallets] = await Promise.all([
            ChainRouter.fetchPortfolio(portfolioChain, resolution.address, false),
            DatabaseService.fetchSmartMoneyWallets().catch(() => [])
        ]);
        const matchedSmartWallet = smartWallets.find((wallet: any) => String(wallet.addr || '').toLowerCase() === resolution.address!.toLowerCase());
        const topAssets = (portfolio.assets || []).slice(0, 5);
        const activePositions = (portfolio.assets || []).filter((asset: any) => Number(asset.rawValue || 0) > 1).length;
        const profitableAssets = (portfolio.assets || []).filter((asset: any) => Number(asset.pnlPercent || 0) > 0).length;

        const answer = [
            `Wallet Brief: ${resolution.address}`,
            '',
            'Current read',
            `Tracked value: ${portfolio.netWorth || '$0'} across ${activePositions} active position${activePositions === 1 ? '' : 's'} on ${portfolioChain}.`,
            matchedSmartWallet
                ? `Smart Money status: tracked as ${Array.isArray(matchedSmartWallet.categories) ? matchedSmartWallet.categories.join(', ') : 'Smart Money'}.`
                : 'Smart Money status: not currently listed in the global smart-money wallet set.',
            '',
            'Top holdings',
            topAssets.length
                ? topAssets.map((asset: any, index: number) => `${index + 1}. ${asset.symbol || 'TOKEN'}: ${asset.value || '$0'} (${asset.balance || '0'} tokens).`).join('\n')
                : 'No priced holdings were returned by the accessible portfolio providers.',
            '',
            'Behavior read',
            `${profitableAssets} position${profitableAssets === 1 ? '' : 's'} currently show positive PnL where PnL is available. Recent activity data is ${portfolio.recentActivity?.length ? 'available' : 'not currently populated'} in this wallet view.`,
            '',
            'Suggested next moves',
            'Open the wallet profile, track the wallet if it matters to you, or inspect the top token positions one by one for liquidity and risk.'
        ].join('\n');

        return {
            answer,
            tool: 'get_wallet_deep_brief',
            data: { resolution, portfolio, smartWallet: matchedSmartWallet || null },
            actions: [
                { label: 'Open Wallet', href: `/wallet/${encodeURIComponent(resolution.address)}?chain=${encodeURIComponent(portfolioChain)}`, kind: 'navigate' },
                { label: 'Track Wallet', href: `/wallet/${encodeURIComponent(resolution.address)}?chain=${encodeURIComponent(portfolioChain)}`, kind: 'confirmable', confirmationRequired: true }
            ] as AssistantChatAction[]
        };
    } catch (error) {
        return {
            answer: `I found the wallet address, but the portfolio providers could not return a clean wallet brief right now. ${error instanceof Error ? error.message : ''}`.trim(),
            tool: 'get_wallet_deep_brief',
            data: { resolution },
            actions: [{ label: 'Open Wallet Tracker', href: `/wallet/${encodeURIComponent(resolution.address)}?chain=${encodeURIComponent(portfolioChain)}`, kind: 'navigate' }]
        };
    }
};

const buildPlatformUpdateBrief = async () => {
    const [events, smartStatus, marketResponse] = await Promise.all([
        DetectionSnapshotStore.getFeed().catch(async () => DatabaseService.fetchDetectionEvents()),
        Promise.resolve(smartAlertRunner.getStatus()),
        DatabaseService.getMarketData(false, true).catch(() => null)
    ]);
    const topEvents = (events || []).slice(0, 6);
    const highSeverity = topEvents.filter((event: any) => event?.severity === 'High').length;
    const topMarketTokens = (marketResponse?.data || []).slice(0, 5);

    return {
        answer: [
            'Atlaix Platform Update',
            '',
            'Detection Engine',
            topEvents.length
                ? `There are ${topEvents.length} recent detection highlights in the current feed, including ${highSeverity} High severity item${highSeverity === 1 ? '' : 's'}.`
                : 'No current detection events are available from the local feed.',
            ...topEvents.slice(0, 4).map((event: any, index: number) => `${index + 1}. ${formatAssistantDetectionLine(event)}`),
            '',
            'Market watchlist',
            topMarketTokens.length
                ? topMarketTokens.map((token: any, index: number) => `${index + 1}. ${token.name || token.ticker}: ${token.h24} over 24h, ${token.volume24h} volume, ${token.liquidity} liquidity.`).join('\n')
                : 'Market data is not currently available from the app cache.',
            '',
            'Smart Alerts',
            `Runner: ${smartStatus.enabled ? 'enabled' : 'disabled'}. Last run: ${smartStatus.lastRunStatus || 'not run yet'}. Rules checked: ${smartStatus.rulesChecked || 0}. Triggers created: ${smartStatus.triggersCreated || 0}.`,
            smartStatus.lastError ? `Latest alert issue: ${smartStatus.lastError}` : '',
            '',
            'Suggested next moves',
            'Review high-severity Detection Engine events first, then set alerts for tokens where liquidity or whale movement matters.'
        ].filter(Boolean).join('\n'),
        tool: 'get_platform_updates',
        data: { events: topEvents, smartStatus, market: topMarketTokens },
        actions: [
            { label: 'Open Detection Engine', href: '/detection', kind: 'navigate' },
            { label: 'Open Smart Alerts', href: '/smart-alerts', kind: 'navigate' },
            { label: 'Open Overview', href: '/dashboard', kind: 'navigate' }
        ] as AssistantChatAction[]
    };
};

const loadAssistantNotifications = async (): Promise<AssistantNotification[]> => {
    const events = await DetectionSnapshotStore.getFeed().catch(async () => DatabaseService.fetchDetectionEvents());
    const notifications: AssistantNotification[] = (events || []).slice(0, 6).map((event: any, index: number) => ({
        id: `detection-${event?.token?.address || event?.token?.ticker || index}-${event?.detectedAt || index}`,
        title: `${event?.token?.ticker || event?.token?.name || 'Token'} ${event?.eventType || 'Detection'}`,
        body: `${event?.severity || 'Medium'} severity, score ${event?.score || 0}. ${event?.summary || formatAssistantDetectionLine(event)}`,
        tone: event?.eventType === 'Distribution' || event?.eventType === 'Market Stress'
            ? 'bearish'
            : event?.severity === 'High'
                ? 'risk'
                : event?.eventType === 'Accumulation' || event?.eventType === 'Recovery'
                    ? 'bullish'
                    : 'neutral',
        href: eventTokenHref(event),
        timestamp: Number(event?.detectedAt || Date.now())
    }));

    const smartStatus = smartAlertRunner.getStatus();
    if (smartStatus.lastRunStatus || smartStatus.lastError) {
        notifications.unshift({
            id: `smart-alert-status-${smartStatus.lastRunCompletedAt || smartStatus.lastRunStartedAt || 'pending'}`,
            title: 'Smart Alerts status',
            body: smartStatus.lastError
                ? `Latest alert evaluation needs attention: ${smartStatus.lastError}`
                : `Latest alert run ${smartStatus.lastRunStatus || 'is pending'} after checking ${smartStatus.rulesChecked || 0} rules.`,
            tone: smartStatus.lastError ? 'risk' : 'neutral',
            href: '/smart-alerts',
            timestamp: smartStatus.lastRunCompletedAt ? new Date(smartStatus.lastRunCompletedAt).getTime() : Date.now()
        });
    }

    return notifications.slice(0, 8);
};

const summarizeSafeScanReport = (report: any) => {
    const intelligence = report?.bundleIntelligence || {};
    const attribution = report?.supplyAttribution || {};
    const holder = report?.holderConcentration || {};
    const highlights = Array.isArray(report?.evidenceHighlights) ? report.evidenceHighlights.slice(0, 3) : [];
    const reasons = Array.isArray(intelligence.reasons) ? intelligence.reasons.slice(0, 3) : [];

    return [
        `Safe Scan completed for ${report?.tokenSymbol || report?.tokenName || 'this token'}.`,
        `Risk level: ${intelligence.riskLevel || 'unknown'} with ${intelligence.confidence || 'unknown'} confidence.`,
        `Coordinated supply estimate: ${Number(attribution.combinedCoordinatedPct || 0).toFixed(2)}%. Top 10 holders: ${Number(holder.top10Pct || 0).toFixed(2)}%.`,
        reasons.length ? `Main reasons: ${reasons.join(' ')}` : '',
        highlights.length ? `Evidence highlights: ${highlights.map((item: any) => item.title).join(', ')}.` : ''
    ].filter(Boolean).join('\n');
};

const buildAssistantSystemPrompt = () => [
    'You are the Atlaix in-app AI assistant router.',
    'Choose exactly one approved tool for the user request.',
    'You cannot modify source code, change app architecture, access secrets, run shell commands, or invent app data.',
    'Write actions must be confirmation-first. For alerts, choose prepare_alert_setup, not a direct save.',
    'Return only valid JSON with keys: tool, address, chain, query, responseStyle.',
    'Approved tools: conversation, get_token_deep_brief, get_wallet_deep_brief, get_platform_updates, get_detection_updates, run_safe_scan, prepare_alert_setup, get_token_activity, get_token_overview, get_smart_alert_status.',
    'Use get_token_deep_brief for broad token questions, token addresses, performance, liquidity, recent events, deep analysis, or "tell me everything" requests.',
    'Use get_wallet_deep_brief for wallet analysis, holdings, portfolio, PnL, smart-money, or wallet behavior questions.',
    'Use get_platform_updates for broad Atlaix updates, today updates, market summaries, or "what should I pay attention to" requests.',
    'Use get_token_overview for current price, token details, market cap, liquidity, volume, or overview questions.',
    'Use run_safe_scan only when the user asks for scan, safety, risk, security, or forensic analysis.',
    'Use get_detection_updates for Detection Engine, new updates, admitted tokens, market events, or alpha events.',
    'Use prepare_alert_setup for alerts, notifications, watching a token, or thresholds.',
    'Use get_token_activity for whale buys, whale sells, wallet movements, token impact timeline, or activity.',
    'Use get_smart_alert_status for existing alert runner/status questions.',
    'Use conversation for casual chat, capability questions, or unclear requests.'
].join('\n');

const buildAssistantChatPrompt = () => [
    'You are Atlaix AI, a warm, sharp, conversational assistant inside the Atlaix crypto intelligence platform.',
    'Answer normal questions directly first. Be chatty when the user is casual, concise when they are operational, and never sound like a rigid command menu.',
    'Use plain text with no emoji and no decorative formatting.',
    'When it is natural, connect the conversation back to useful Atlaix capabilities: Detection Engine updates, Safe Scan token risk summaries, token activity/whale movement review, and Smart Alert preparation.',
    'Do not force Atlaix features into every answer. Use a light touch: one helpful bridge is enough when relevant.',
    'You cannot modify source code, change system architecture, access secrets, run shell commands, or silently change saved app state.',
    'For anything that would change app state, explain the next confirmation step instead of claiming you completed it.',
    `Current date: ${new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'Africa/Lagos' })}.`
].join('\n');

const parseAssistantToolRequest = (raw: string): AssistantToolRequest | null => {
    try {
        const cleaned = raw.trim().replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();
        const parsed = JSON.parse(cleaned);
        const allowed = new Set<AssistantToolName>([
            'conversation',
            'get_token_deep_brief',
            'get_wallet_deep_brief',
            'get_platform_updates',
            'get_detection_updates',
            'run_safe_scan',
            'prepare_alert_setup',
            'get_token_activity',
            'get_token_overview',
            'get_smart_alert_status'
        ]);
        if (!allowed.has(parsed.tool)) return null;
        return {
            tool: parsed.tool,
            address: typeof parsed.address === 'string' ? parsed.address : undefined,
            chain: typeof parsed.chain === 'string' ? parsed.chain : undefined,
            query: typeof parsed.query === 'string' ? parsed.query : undefined,
            responseStyle: parsed.responseStyle === 'detailed' ? 'detailed' : 'brief'
        };
    } catch {
        return null;
    }
};

const chooseAssistantToolWithModel = async (
    message: string,
    history: AssistantConversationMessage[]
): Promise<AssistantToolRequest | null> => {
    const apiKey = readEnv('OPENROUTER_API_KEY');
    if (!apiKey) return null;

    const model = readEnv('OPENROUTER_MODEL');
    if (!model) return null;

    const baseUrl = readEnv('OPENROUTER_BASE_URL') || 'https://openrouter.ai/api/v1';
    const historyText = history.slice(-8).map((item) => `${item.role || 'user'}: ${item.text || ''}`).join('\n');

    const response = await fetchWithTimeout(`${baseUrl.replace(/\/+$/, '')}/chat/completions`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
            'HTTP-Referer': 'http://localhost:3000',
            'X-Title': 'Atlaix AI Assistant'
        },
        body: JSON.stringify({
            model,
            temperature: 0,
            response_format: { type: 'json_object' },
            messages: [
                { role: 'system', content: buildAssistantSystemPrompt() },
                { role: 'user', content: `Recent conversation:\n${historyText || 'none'}\n\nCurrent request:\n${message}` }
            ]
        })
    }, 15_000);

    if (!response.ok) {
        throw new Error(`OpenRouter request failed with ${response.status}.`);
    }

    const payload = await response.json();
    const content = payload?.choices?.[0]?.message?.content;
    return typeof content === 'string' ? parseAssistantToolRequest(content) : null;
};

const chooseAssistantToolLocally = (message: string, history: AssistantConversationMessage[] = []): AssistantToolRequest => {
    const lower = message.toLowerCase();
    const address = extractAssistantAddress(message) || (/\b(that|this)\s+token\b/i.test(message) ? getRecentAssistantAddress(history) : '');

    if (/\b(wallet|holdings|portfolio|pnl|win rate|smart money wallet|track this wallet|analy[sz]e this wallet)\b/.test(lower)) {
        return {
            tool: 'get_wallet_deep_brief',
            address,
            chain: address ? inferAssistantChain(message, address) : undefined,
            query: address || extractAssistantTokenQuery(message, history)
        };
    }

    if (/\b(today'?s?|daily|platform|overall|what changed|what should i pay attention|market update|comprehensive updates?|update brief)\b/.test(lower) && !address) {
        return { tool: 'get_platform_updates' };
    }

    if (/\bsafe scan\b|\bscan\b|\brisk\b|\bsecurity\b|\bforensic\b|\bscam\b|\brug\b|\bhoneypot\b|\baudit\b|\bsketchy\b/.test(lower)) {
        return { tool: 'run_safe_scan', address, chain: address ? inferAssistantChain(message, address) : undefined };
    }

    if (/\bactivity\b|\bwhale\b|\bbuy\b|\bsell\b|\bwallet movement\b|\btimeline\b/.test(lower)) {
        return { tool: 'get_token_activity', address, chain: address ? inferAssistantChain(message, address) : undefined };
    }

    if (/\balert\b|\bnotify\b|\bwatch\b/.test(lower)) {
        return { tool: 'prepare_alert_setup', address, query: extractAssistantTokenQuery(message, history), chain: address ? inferAssistantChain(message, address) : undefined };
    }

    if (address && /\b(token|tell|about|perform|performance|liquidity|recent|event|deep|analysis|analy[sz]e|everything|full information|what.*know)\b/.test(lower)) {
        return {
            tool: 'get_token_deep_brief',
            address,
            query: address,
            chain: inferAssistantChain(message, address),
            responseStyle: 'detailed'
        };
    }

    if (/\b(deep|analysis|analy[sz]e|performing|performance|recent events?|what happened|full information|everything|tell me about|what do you know)\b/.test(lower)) {
        return {
            tool: 'get_token_deep_brief',
            address,
            query: address || extractAssistantTokenQuery(message, history),
            chain: address ? inferAssistantChain(message, address) : undefined,
            responseStyle: 'detailed'
        };
    }

    if (/\bprice\b|\bmarket\s*cap\b|\bliquidity\b|\bvolume\b|\boverview\b|\btoken details\b|\bdetails\b/.test(lower)) {
        return {
            tool: /\bliquidity\b|\bvolume\b|\bmarket\s*cap\b/.test(lower) ? 'get_token_deep_brief' : 'get_token_overview',
            address,
            query: extractAssistantTokenQuery(message, history),
            chain: lower.includes('solana') ? 'solana' : address ? inferAssistantChain(message, address) : undefined
        };
    }

    if (/\b(yes|yeah|yep|correct|that token|this token|the token)\b/.test(lower)) {
        const priorTokenQuery = extractAssistantTokenQuery('', history);
        const priorWasTokenOverview = history.some((item) =>
            item.role !== 'assistant' &&
            /\bprice\b|\bmarket\s*cap\b|\bliquidity\b|\bvolume\b|\boverview\b|\btoken details\b|\bdetails\b/i.test(String(item.text || ''))
        );
        if (priorWasTokenOverview && priorTokenQuery) {
            return {
                tool: 'get_token_overview',
                query: priorTokenQuery,
                chain: lower.includes('solana') ? 'solana' : undefined
            };
        }
    }

    if (/\bdetection\b|\bupdate\b|\bnew\b|\bengine\b|\balpha\b/.test(lower)) {
        return { tool: 'get_detection_updates' };
    }

    if (/\balert status\b|\bsmart alert status\b|\brunner\b/.test(lower)) {
        return { tool: 'get_smart_alert_status' };
    }

    return { tool: 'conversation' };
};

const chooseAssistantTool = async (message: string, history: AssistantConversationMessage[] = []) => {
    const localChoice = chooseAssistantToolLocally(message, history);
    if (localChoice.tool !== 'conversation') return localChoice;
    return localChoice;
};

const generateAssistantConversation = async (message: string, history: AssistantConversationMessage[] = []) => {
    const apiKey = readEnv('OPENROUTER_API_KEY');
    const model = readEnv('OPENROUTER_MODEL');
    if (!apiKey || !model) return null;

    const baseUrl = readEnv('OPENROUTER_BASE_URL') || 'https://openrouter.ai/api/v1';
    const recentMessages = history.slice(-10).map((item) => ({
        role: item.role === 'assistant' ? 'assistant' : 'user',
        content: String(item.text || '').slice(0, 1500)
    }));

    const response = await fetchWithTimeout(`${baseUrl.replace(/\/+$/, '')}/chat/completions`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
            'HTTP-Referer': 'http://localhost:3000',
            'X-Title': 'Atlaix AI Assistant'
        },
        body: JSON.stringify({
            model,
            temperature: 0.55,
            messages: [
                { role: 'system', content: buildAssistantChatPrompt() },
                ...recentMessages,
                { role: 'user', content: message }
            ]
        })
    }, 15_000);

    if (!response.ok) {
        throw new Error(`OpenRouter chat failed with ${response.status}.`);
    }

    const payload = await response.json();
    const content = payload?.choices?.[0]?.message?.content;
    return typeof content === 'string' && content.trim() ? content.trim() : null;
};

const buildLocalConversationResponse = (message: string) => {
    const lower = message.toLowerCase();
    if (/\b(today|date|day)\b/.test(lower)) {
        const today = new Date().toLocaleDateString('en-US', {
            weekday: 'long',
            year: 'numeric',
            month: 'long',
            day: 'numeric',
            timeZone: 'Africa/Lagos'
        });
        return `Today is ${today}. If you are checking market context for the day, I can also pull the latest Detection Engine updates or help you run a Safe Scan on a token.`;
    }

    if (/\bhello\b|\bhi\b|\bhey\b/.test(lower)) {
        return 'Hey. I am here. You can talk to me normally, and when the conversation touches tokens, wallets, alerts, or risk, I can help turn that into an Atlaix action like a Safe Scan, Detection Engine review, token activity check, or alert setup.';
    }

    return 'I can talk through that with you. I am best when I can connect the conversation to Atlaix data too, so if this is about a token, wallet movement, risk, or alerts, send me the address or the goal and I will help you move from question to action.';
};

const normalizeAssistantText = (text: string) => text
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/[\u{1F300}-\u{1FAFF}]/gu, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/[ \t]+\n/g, '\n')
    .trim();

const buildAssistantResponse = async (message: string, history: AssistantConversationMessage[] = []) => {
    const request = await chooseAssistantTool(message, history);
    const address = request.address || extractAssistantAddress(message) || getRecentAssistantAddress(history);
    const chain = request.chain || (address ? inferAssistantChain(message, address) : '');
    const actions: AssistantChatAction[] = [];

    if (request.tool === 'get_token_deep_brief') {
        const tokenQuery = request.query || address || extractAssistantTokenQuery(message, history);
        if (!tokenQuery) {
            return {
                answer: 'I can build a full Atlaix token brief, but I need a token contract address, ticker, or name first.',
                tool: 'token_deep_brief_needs_query',
                actions: [
                    { label: 'Open Detection Engine', href: '/detection', kind: 'navigate' },
                    { label: 'Open Safe Scan', href: '/safe-scan', kind: 'navigate' }
                ]
            };
        }

        return buildTokenDeepBrief(tokenQuery, chain, message, history);
    }

    if (request.tool === 'get_wallet_deep_brief') {
        const walletAddress = address || request.query || extractAssistantAddress(message);
        return buildWalletDeepBrief(walletAddress, chain);
    }

    if (request.tool === 'get_platform_updates') {
        return buildPlatformUpdateBrief();
    }

    if (request.tool === 'run_safe_scan') {
        if (!address) {
            return {
                answer: 'I can run a Safe Scan, but I need the token contract address first. Send the address and, if you know it, the chain.',
                tool: 'safe_scan_needs_address',
                actions: [{ label: 'Open Safe Scan', href: '/safe-scan' }]
            };
        }

        const safeScanChain = toAlchemyAssistantChain(chain, address);
        const report = isEvmChain(safeScanChain)
            ? await analyzeAlchemyHubEvmToken(address, safeScanChain, { depth: 'balanced', holderSeeds: [], seedOnly: true })
            : await analyzeAlchemyHubToken(address, { depth: 'balanced', holderSeeds: [], seedOnly: true });

        actions.push({
            label: 'Open Safe Scan',
            href: `/safe-scan?${new URLSearchParams({ address, chain: safeScanChain, autoScan: '1' }).toString()}`
        });

        return {
            answer: summarizeSafeScanReport(report),
            tool: 'run_safe_scan',
            data: {
                tokenAddress: address,
                chain: safeScanChain,
                tokenSymbol: report?.tokenSymbol,
                riskLevel: report?.bundleIntelligence?.riskLevel,
                confidence: report?.bundleIntelligence?.confidence
            },
            actions
        };
    }

    if (request.tool === 'get_detection_updates') {
        const events = await DetectionSnapshotStore.getFeed().catch(async () => DatabaseService.fetchDetectionEvents());
        const topEvents = (events || []).slice(0, 5);
        actions.push({ label: 'Open Detection Engine', href: '/detection' });

        if (!topEvents.length) {
            return {
                answer: 'I checked the Detection Engine, but there are no current detection events available from the local feed.',
                tool: 'detection_updates',
                actions
            };
        }

        return {
            answer: [
                `I found ${topEvents.length} recent Detection Engine updates:`,
                ...topEvents.map((event: any, index: number) => `${index + 1}. ${formatAssistantDetectionLine(event)}`)
            ].join('\n'),
            tool: 'detection_updates',
            data: {
                events: topEvents.map((event: any) => ({
                    token: event?.token?.ticker || event?.token?.name,
                    eventType: event?.eventType,
                    severity: event?.severity,
                    score: event?.score,
                    href: eventTokenHref(event)
                }))
            },
            actions
        };
    }

    if (request.tool === 'get_token_activity') {
        if (!address) {
            return {
                answer: 'I can check token activity, but I need the token contract address first.',
                tool: 'token_activity_needs_address',
                actions: [{ label: 'Open Detection Engine', href: '/detection' }]
            };
        }

        const activities = await ImpactfulTokenActivityStore.getActivities(chain, address);
        actions.push({ label: 'Open Token Detection', href: `/detection/token/${encodeURIComponent(address)}` });

        if (!activities.length) {
            return {
                answer: 'I checked the token activity cache, but no reportable token impact events are stored for that address yet.',
                tool: 'get_token_activity',
                actions
            };
        }

        return {
            answer: [
                `I found ${activities.length} reportable token impact event${activities.length === 1 ? '' : 's'} for this token:`,
                ...activities.slice(0, 5).map((activity, index) => `${index + 1}. ${activity.title}: ${activity.description} (${compactUsd(activity.usdValue)}).`)
            ].join('\n'),
            tool: 'get_token_activity',
            data: {
                tokenAddress: address,
                chain,
                activities: activities.slice(0, 5).map((activity) => ({
                    title: activity.title,
                    description: activity.description,
                    usdValue: activity.usdValue,
                    severity: activity.severity,
                    detectedAt: activity.detectedAt
                }))
            },
            actions
        };
    }

    if (request.tool === 'get_token_overview') {
        const tokenQuery = request.query || address || extractAssistantTokenQuery(message, history);
        if (!tokenQuery) {
            return {
                answer: 'I can check token price and overview data, but I need the token symbol, name, or contract address first.',
                tool: 'token_overview_needs_query',
                actions: [{ label: 'Open Overview', href: '/dashboard' }]
            };
        }

        const token = await resolveAssistantTokenOverview(tokenQuery, chain);
        if (!token) {
            return {
                answer: `I could not find a current Atlaix token listing for "${tokenQuery}". Try the contract address or the exact ticker shown in the app.`,
                tool: 'get_token_overview',
                actions: [
                    { label: 'Open Overview', href: '/dashboard' },
                    { label: 'Open Detection Engine', href: '/detection' }
                ]
            };
        }

        const tokenAddress = token.address || tokenQuery;
        const tokenHref = token.address
            ? `/token/${encodeURIComponent(token.address)}`
            : `/detection/token/${encodeURIComponent(tokenQuery)}`;

        return {
            answer: [
                `${token.name || token.ticker} (${token.ticker}) is currently priced at ${formatAssistantPrice(token.price)} on ${normalizeAssistantChainLabel(token.chain)}.`,
                `24h change: ${token.h24 || 'unavailable'}. 24h volume: ${token.volume24h || '$0'}. Liquidity: ${token.liquidity || '$0'}. Market cap: ${token.cap || '$0'}.`
            ].join('\n'),
            tool: 'get_token_overview',
            data: {
                token: token.ticker,
                name: token.name,
                address: tokenAddress,
                chain: token.chain,
                price: token.price,
                change24h: token.h24,
                volume24h: token.volume24h,
                liquidity: token.liquidity,
                marketCap: token.cap
            },
            actions: [
                { label: 'Open Token Details', href: tokenHref },
                { label: 'Open Overview', href: '/dashboard' }
            ]
        };
    }

    if (request.tool === 'get_smart_alert_status') {
        const status = smartAlertRunner.getStatus();
        return {
            answer: [
                `Smart Alerts are ${status.enabled ? 'enabled' : 'disabled'}.`,
                `Last run status: ${status.lastRunStatus || 'not run yet'}.`,
                `Rules checked: ${status.rulesChecked || 0}. Triggers created: ${status.triggersCreated || 0}.`,
                status.lastError ? `Latest error: ${status.lastError}` : ''
            ].filter(Boolean).join('\n'),
            tool: 'get_smart_alert_status',
            data: status,
            actions: [{ label: 'Open Smart Alerts', href: '/smart-alerts' }]
        };
    }

    if (request.tool === 'prepare_alert_setup') {
        const tokenQuery = request.query || address || extractAssistantTokenQuery(message, history);
        const alertIntent = await extractAssistantAlertIntent(message, tokenQuery, chain);
        const token = alertIntent.token as any;
        const alertAddress = address || token?.address || tokenQuery;
        const alertChain = chain || token?.chain || '';
        const params = new URLSearchParams();
        if (alertAddress) params.set('address', alertAddress);
        if (alertChain) params.set('chain', alertChain);
        params.set('setup', '1');
        params.set('type', alertIntent.alertType);
        params.set('condition', alertIntent.condition);
        params.set('thresholdKind', alertIntent.thresholdKind);
        params.set('threshold', alertIntent.threshold);

        const href = `/smart-alerts?${params.toString()}`;
        const tokenLabel = token?.ticker || token?.name || (alertAddress ? 'this token' : '');
        const currentPrice = token?.price ? formatAssistantPrice(token.price) : '';
        const targetLine = alertIntent.thresholdKind === 'currency'
            ? `${alertIntent.condition === 'below' ? 'below' : 'above'} ${alertIntent.threshold}`
            : `by ${alertIntent.threshold}%`;

        return {
            answer: alertAddress
                ? [
                    `I prepared a Smart Alert draft for ${tokenLabel || 'that token'}${currentPrice ? ` using the current price ${currentPrice}` : ''}.`,
                    `Trigger: price ${targetLine}. Open Smart Alerts, review the setup, then confirm it there. I will not save it silently.`
                ].join('\n')
                : 'I can help set up an alert. Send the token address and condition, or open Smart Alerts to choose the alert type.',
            tool: 'alert_setup',
            actions: [{ label: 'Open Smart Alerts', href }]
        };
    }

    if (request.tool === 'conversation') {
        try {
            const modelAnswer = await generateAssistantConversation(message, history);
            if (modelAnswer) {
                return {
                    answer: normalizeAssistantText(modelAnswer),
                    tool: 'conversation'
                };
            }
        } catch (error) {
            console.warn('[AiAssistant] model conversation unavailable; using local chat fallback', error instanceof Error ? error.message : error);
        }

        return {
            answer: buildLocalConversationResponse(message),
            tool: 'conversation'
        };
    }

    if (/\bhello\b|\bhi\b|\bhey\b/i.test(message)) {
        return {
            answer: 'Hey. I can help you read Detection Engine updates, run Safe Scan summaries, inspect token activity, and prepare Smart Alert setup links. I will ask for confirmation before anything that changes saved app state.',
            tool: 'conversation'
        };
    }

    return {
        answer: 'I can help with Atlaix workflows like “show detection updates”, “run a safe scan on this token”, or “help me set an alert for this address”. The model provider is not connected yet, so I am using the safe local tool router for now.',
        tool: 'conversation'
    };
};

async function fetchChainDexVolume(chain: string) {
    const chainId = chain.toLowerCase().replace(/[^a-z0-9-]/g, '');
    const chainLabel = CHAIN_DEX_VOLUME_LABELS[chainId];
    if (!chainId || !chainLabel) return null;

    const url = `https://api.llama.fi/overview/dexs/${encodeURIComponent(chainLabel)}?excludeTotalDataChart=true&excludeTotalDataChartBreakdown=true`;
    const providerResponse = await fetchWithTimeout(url, {
        headers: {
            accept: 'application/json',
            'user-agent': 'Atlaix/1.0'
        }
    }, 12_000);

    if (!providerResponse.ok) return null;

    const payload = await providerResponse.json() as { total24h?: number; change_1d?: number };
    const volume = Number(payload.total24h || 0);
    if (!Number.isFinite(volume) || volume <= 0) return null;

    return {
        chain: chainLabel,
        chainId,
        volume,
        change1d: Number.isFinite(Number(payload.change_1d)) ? Number(payload.change_1d) : null,
        source: 'defillama'
    };
}

function json(response: import('node:http').ServerResponse, status: number, body: unknown) {
    response.writeHead(status, {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type'
    });
    response.end(JSON.stringify(body));
}

function normalizeAddress(value: string) {
    return value.trim();
}

function normalizeWalletAddressForStorage(value: string) {
    const trimmed = value.trim();
    return trimmed.startsWith('0x') ? trimmed.toLowerCase() : trimmed;
}

function getWalletScanChain(walletType: 'evm' | 'solana' | null, requestedChain?: string) {
    if (walletType === 'solana') return 'Solana';
    const chain = String(requestedChain || '').trim();
    if (!chain || chain.toLowerCase() === 'solana') return 'All Chains';
    return chain;
}

function normalizeText(value: string | undefined | null) {
    return String(value || '').trim().toLowerCase();
}

function compactMetric(value: string | number | undefined | null) {
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    const raw = String(value || '').replace(/[$,%+\s]/g, '').toUpperCase();
    const parsed = Number.parseFloat(raw);
    if (!Number.isFinite(parsed)) return null;
    const signed = raw.startsWith('-') ? -Math.abs(parsed) : parsed;
    if (raw.includes('T')) return signed * 1e12;
    if (raw.includes('B')) return signed * 1e9;
    if (raw.includes('M')) return signed * 1e6;
    if (raw.includes('K')) return signed * 1e3;
    return signed;
}

function formatUsd(value: number) {
    return value.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

function buildWalletStats(portfolio: any, assetsWithPnl: any[]) {
    const assets = Array.isArray(portfolio?.assets) ? portfolio.assets : [];
    const totalHoldingsValue = assets.reduce((sum: number, asset: any) => sum + Number(asset.rawValue || 0), 0);
    const validAssets = assetsWithPnl.filter((asset) => asset.pnlPercent !== undefined && asset.avgBuy !== 'N/A');
    const winningAssets = validAssets.filter((asset) => Number(asset.pnlPercent || 0) > 0);
    const activePositions = assets.filter((asset: any) => Number(asset.rawValue || 0) > 1).length;

    let totalPnlPercent = 0;
    let pnlPrefix = '';

    if (validAssets.length > 0) {
        let totalCostBasis = 0;
        let totalCurrentValueForPnl = 0;

        validAssets.forEach((asset) => {
            const rawValue = Number(asset.rawValue || 0);
            const pnlPercent = Number(asset.pnlPercent || 0);
            const cost = rawValue / (1 + (pnlPercent / 100));
            totalCostBasis += cost;
            totalCurrentValueForPnl += rawValue;
        });

        const totalPnlValue = totalCurrentValueForPnl - totalCostBasis;
        totalPnlPercent = totalCostBasis > 0 ? (totalPnlValue / totalCostBasis) * 100 : 0;
        pnlPrefix = totalPnlValue >= 0 ? '+' : '';
    }

    return {
        winRate: validAssets.length > 0 ? `${Math.round((winningAssets.length / validAssets.length) * 100)}%` : 'N/A',
        totalPnL: validAssets.length > 0 ? `${pnlPrefix}${totalPnlPercent.toFixed(2)}%` : 'N/A',
        netWorth: formatUsd(totalHoldingsValue),
        activePositions,
        profitableTrader: winningAssets.length.toString(),
        avgHoldTime: 'N/A'
    };
}

async function scanSmartMoneyWallet(walletAddress: string, requestedChain?: string) {
    const validation = validateWalletAddress(walletAddress);
    if (!validation.isValid) {
        throw new Error(validation.error || 'Enter a valid EVM or Solana wallet address.');
    }

    const normalizedAddress = normalizeWalletAddressForStorage(validation.normalizedAddress);
    const chain = getWalletScanChain(validation.type, requestedChain);

    if (await DatabaseService.isSmartMoneyWalletExcluded(normalizedAddress)) {
        return {
            wallet: null,
            excluded: true,
            qualified: false,
            message: 'This wallet is excluded from Smart Money promotion.'
        };
    }

    const portfolio = await ChainRouter.fetchPortfolio(chain, normalizedAddress, true);
    const candidateAssets = (portfolio.assets || [])
        .filter((asset: any) => Number(asset.rawValue || 0) > 1 && Number(asset.currentPrice || 0) > 0)
        .slice(0, 8);

    const assetsWithPnl = await Promise.all(candidateAssets.map(async (asset: any) => {
        try {
            let assetChain = asset.chain || chain;
            if (assetChain === 'All Chains' || !assetChain) {
                assetChain = String(asset.address || '').startsWith('0x') ? 'Ethereum' : 'Solana';
            }

            const pnl = await ChainRouter.fetchTokenPnL(assetChain, normalizedAddress, asset.address, Number(asset.currentPrice || 0), 'ALL');
            return { ...asset, ...pnl };
        } catch {
            return { ...asset, avgBuy: 'N/A', pnl: 'N/A', pnlPercent: undefined };
        }
    }));

    const stats = buildWalletStats(portfolio, assetsWithPnl);
    const qualification = SmartMoneyQualificationService.evaluate(stats);
    const wallet = {
        addr: normalizedAddress,
        name: `Tracked ${normalizedAddress.slice(0, 6)}...${normalizedAddress.slice(-4)}`,
        categories: qualification.qualified ? ['Smart Money' as const] : [],
        timestamp: Date.now(),
        lastBalance: stats.netWorth,
        lastWinRate: stats.winRate,
        lastPnl: stats.totalPnL,
        qualification,
        autoTracked: false,
        autoPromotedToSmartMoney: qualification.qualified
    };

    if (qualification.qualified) {
        await DatabaseService.upsertSmartMoneyWallet(wallet);
    }

    return {
        wallet,
        excluded: false,
        qualified: qualification.qualified,
        portfolio: {
            netWorth: portfolio.netWorth,
            assetCount: portfolio.assets?.length || 0,
            providerUsed: portfolio.providerUsed,
            timestamp: portfolio.timestamp
        }
    };
}

function normalizeTokenLookup(coin: any, source = 'market-cache') {
    return {
        address: coin.address || coin.pairAddress || '',
        pairAddress: coin.pairAddress || null,
        chainId: String(coin.chain || '').toLowerCase(),
        name: coin.name || coin.ticker || 'Unknown token',
        symbol: coin.ticker || coin.name || 'TOKEN',
        priceUsd: compactMetric(coin.price),
        change24h: compactMetric(coin.h24),
        volume24h: compactMetric(coin.volume24h),
        liquidityUsd: compactMetric(coin.liquidity),
        riskLevel: coin.riskLevel || null,
        imageUrl: coin.img || null,
        source
    };
}

async function lookupDexscreenerToken(address: string, chain: string) {
    const providerResponse = await fetchWithTimeout(`https://api.dexscreener.com/latest/dex/tokens/${encodeURIComponent(address)}`, {}, 10_000);
    if (!providerResponse.ok) return null;
    const payload = await providerResponse.json() as { pairs?: any[] };
    const pairs = Array.isArray(payload.pairs) ? payload.pairs : [];
    const selectedPair = chain
        ? pairs.find((pair) => normalizeText(pair.chainId) === normalizeText(chain)) || pairs[0]
        : pairs[0];
    if (!selectedPair) return null;
    const base = selectedPair.baseToken || {};
    return {
        address: base.address || address,
        pairAddress: selectedPair.pairAddress || null,
        chainId: selectedPair.chainId || chain || '',
        name: base.name || base.symbol || 'Unknown token',
        symbol: base.symbol || base.name || 'TOKEN',
        priceUsd: compactMetric(selectedPair.priceUsd),
        change24h: compactMetric(selectedPair.priceChange?.h24),
        volume24h: compactMetric(selectedPair.volume?.h24),
        liquidityUsd: compactMetric(selectedPair.liquidity?.usd),
        riskLevel: null,
        imageUrl: selectedPair.info?.imageUrl || null,
        source: 'dexscreener'
    };
}

async function readJsonBody(request: import('node:http').IncomingMessage) {
    const chunks: Buffer[] = [];
    for await (const chunk of request) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    const raw = Buffer.concat(chunks).toString('utf8');
    return raw ? JSON.parse(raw) : {};
}

async function readRawBody(request: import('node:http').IncomingMessage) {
    const chunks: Buffer[] = [];
    for await (const chunk of request) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
}

function readEnv(...keys: string[]) {
    for (const key of keys) {
        const value = process.env[key]?.trim();
        if (value) return value;
    }
    return '';
}

async function fetchWithTimeout(input: RequestInfo | URL, init: RequestInit = {}, timeoutMs = PROVIDER_TIMEOUT_MS) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
        return await fetch(input, {
            ...init,
            signal: controller.signal
        });
    } finally {
        clearTimeout(timeoutId);
    }
}

async function proxyPublicApiRequest(
    response: import('node:http').ServerResponse,
    request: import('node:http').IncomingMessage,
    requestUrl: URL,
    route: typeof PUBLIC_PROXY_ROUTES[number]
) {
    const method = (request.method || 'GET').toUpperCase();

    if (!route.methods.has(method as 'GET' | 'POST')) {
        json(response, 405, { error: 'Method is not allowed for this proxy route.' });
        return;
    }

    const upstreamPath = requestUrl.pathname.slice(route.prefix.length) || '/';
    const upstreamUrl = new URL(`${upstreamPath}${requestUrl.search}`, route.target);
    const headers = new Headers();
    const accept = request.headers.accept;
    const contentType = request.headers['content-type'];

    if (accept) headers.set('accept', Array.isArray(accept) ? accept.join(',') : accept);
    if (contentType) headers.set('content-type', Array.isArray(contentType) ? contentType[0] : contentType);
    headers.set('user-agent', 'Atlaix/1.0');

    if (route.prefix === '/api/solana-public') {
        headers.set('origin', 'https://explorer.solana.com');
    }

    const body = method === 'GET' ? undefined : await readRawBody(request);
    const providerResponse = await fetchWithTimeout(upstreamUrl, {
        method,
        headers,
        body
    });
    const text = await providerResponse.text();

    response.writeHead(providerResponse.status, {
        'Content-Type': providerResponse.headers.get('content-type') || 'application/json',
        'Access-Control-Allow-Origin': '*'
    });
    response.end(text);
}

function providerErrorMessage(provider: string, status: number, text: string) {
    const details = text.trim().slice(0, 240);
    return details || `${provider} request failed with status ${status}`;
}

async function proxyProviderRequest(
    response: import('node:http').ServerResponse,
    provider: 'moralis' | 'goplus',
    body: { url?: string; method?: string; headers?: Record<string, string>; body?: string }
) {
    const target = body.url ? new URL(body.url) : null;
    if (!target || target.protocol !== 'https:' || !PROVIDER_ALLOWED_HOSTS.has(target.hostname)) {
        json(response, 400, { error: 'Provider URL is not allowed.' });
        return;
    }

    const method = (body.method || 'GET').toUpperCase();
    if (!['GET', 'POST'].includes(method)) {
        json(response, 400, { error: 'Provider method is not allowed.' });
        return;
    }

    const headers = new Headers();
    const safeHeaders = body.headers || {};
    for (const [key, value] of Object.entries(safeHeaders)) {
        const normalizedKey = key.toLowerCase();
        if (normalizedKey === 'accept' || normalizedKey === 'content-type') {
            headers.set(key, value);
        }
    }

    if (provider === 'moralis') {
        const moralisKey = readEnv('MORALIS_API_KEY');
        if (!moralisKey) {
            json(response, 500, { error: 'Moralis API key is not configured on the backend.' });
            return;
        }
        headers.set('X-API-Key', moralisKey);
        headers.set('accept', headers.get('accept') || 'application/json');
    }

    const providerResponse = await fetchWithTimeout(target, {
        method,
        headers,
        body: method === 'GET' ? undefined : body.body
    });
    const text = await providerResponse.text();

    response.writeHead(providerResponse.status, {
        'Content-Type': providerResponse.headers.get('content-type') || 'application/json',
        'Access-Control-Allow-Origin': '*'
    });
    response.end(providerResponse.ok ? text : JSON.stringify({ error: providerErrorMessage(provider, providerResponse.status, text) }));
}

async function proxyAlchemyRpc(
    response: import('node:http').ServerResponse,
    body: { network?: string; payload?: unknown }
) {
    const network = String(body.network || '');
    if (!/^[a-z0-9-]+$/.test(network)) {
        json(response, 400, { error: 'Alchemy network is not allowed.' });
        return;
    }

    const alchemyKey = readEnv('ALCHEMY_API_KEY');
    if (!alchemyKey) {
        json(response, 500, { error: 'Alchemy API key is not configured on the backend.' });
        return;
    }

    const providerResponse = await fetchWithTimeout(`https://${network}.g.alchemy.com/v2/${alchemyKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body.payload || {})
    });
    const text = await providerResponse.text();

    response.writeHead(providerResponse.status, {
        'Content-Type': providerResponse.headers.get('content-type') || 'application/json',
        'Access-Control-Allow-Origin': '*'
    });
    response.end(providerResponse.ok ? text : JSON.stringify({ error: providerErrorMessage('Alchemy', providerResponse.status, text) }));
}

async function proxySolanaRpc(response: import('node:http').ServerResponse, provider: 'helius' | 'alchemy', payload: unknown) {
    const key = provider === 'helius'
        ? readEnv('HELIUS_API_KEY')
        : readEnv('ALCHEMY_API_KEY');

    if (!key) {
        json(response, 500, { error: `${provider === 'helius' ? 'Helius' : 'Alchemy'} API key is not configured on the backend.` });
        return;
    }

    const target = provider === 'helius'
        ? `https://mainnet.helius-rpc.com/?api-key=${key}`
        : `https://solana-mainnet.g.alchemy.com/v2/${key}`;

    const providerResponse = await fetchWithTimeout(target, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload || {})
    });
    const text = await providerResponse.text();

    response.writeHead(providerResponse.status, {
        'Content-Type': providerResponse.headers.get('content-type') || 'application/json',
        'Access-Control-Allow-Origin': '*'
    });
    response.end(providerResponse.ok ? text : JSON.stringify({ error: providerErrorMessage(provider, providerResponse.status, text) }));
}

queue.start(async (tokenAddress, stage) => {
    stage('history_reconstruction');
    const report = await analyzeForensicToken(tokenAddress);
    stage(report.scanStats.usedWalletApi ? 'cluster_scoring' : 'graph_expansion');
    return report;
});

detectionEngine.start();
smartAlertRunner.start();

const server = createServer(async (request, response) => {
    const method = request.method || 'GET';
    const requestUrl = new URL(request.url || '/', `http://${request.headers.host || `127.0.0.1:${PORT}`}`);

    if (method === 'OPTIONS') {
        json(response, 204, {});
        return;
    }

    if (method === 'GET' && requestUrl.pathname === '/api/chain-dex-volumes') {
        try {
            const requestedChains = (requestUrl.searchParams.get('chains') || 'solana,ethereum,base,bsc,polygon,arbitrum')
                .split(',')
                .map((chain) => chain.trim().toLowerCase())
                .filter(Boolean)
                .slice(0, 10);
            const chains = [...new Set(requestedChains)];
            const volumes = (await Promise.all(chains.map((chain) => fetchChainDexVolume(chain))))
                .filter((item): item is NonNullable<typeof item> => Boolean(item))
                .sort((a, b) => b.volume - a.volume);

            json(response, 200, {
                volumes,
                generatedAt: new Date().toISOString()
            });
            return;
        } catch (error) {
            json(response, 502, {
                error: error instanceof Error ? error.message : 'Could not load chain DEX volumes.'
            });
            return;
        }
    }

    const publicProxyRoute = PUBLIC_PROXY_ROUTES.find((route) => requestUrl.pathname.startsWith(route.prefix));
    if (publicProxyRoute) {
        try {
            await proxyPublicApiRequest(response, request, requestUrl, publicProxyRoute);
            return;
        } catch (error) {
            json(response, 502, { error: error instanceof Error ? error.message : 'Public API proxy failed.' });
            return;
        }
    }

    if (method === 'POST' && requestUrl.pathname === '/api/providers/moralis') {
        try {
            await proxyProviderRequest(response, 'moralis', await readJsonBody(request));
            return;
        } catch (error) {
            json(response, 500, { error: error instanceof Error ? error.message : 'Moralis proxy failed.' });
            return;
        }
    }

    if (method === 'POST' && requestUrl.pathname === '/api/providers/goplus') {
        try {
            await proxyProviderRequest(response, 'goplus', await readJsonBody(request));
            return;
        } catch (error) {
            json(response, 500, { error: error instanceof Error ? error.message : 'GoPlus proxy failed.' });
            return;
        }
    }

    if (method === 'POST' && requestUrl.pathname === '/api/providers/alchemy-rpc') {
        try {
            await proxyAlchemyRpc(response, await readJsonBody(request));
            return;
        } catch (error) {
            json(response, 500, { error: error instanceof Error ? error.message : 'Alchemy proxy failed.' });
            return;
        }
    }

    if (method === 'POST' && requestUrl.pathname === '/api/providers/solana-helius') {
        try {
            await proxySolanaRpc(response, 'helius', await readJsonBody(request));
            return;
        } catch (error) {
            json(response, 500, { error: error instanceof Error ? error.message : 'Helius proxy failed.' });
            return;
        }
    }

    if (method === 'POST' && requestUrl.pathname === '/api/providers/solana-alchemy') {
        try {
            await proxySolanaRpc(response, 'alchemy', await readJsonBody(request));
            return;
        } catch (error) {
            json(response, 500, { error: error instanceof Error ? error.message : 'Solana Alchemy proxy failed.' });
            return;
        }
    }

    if (method === 'GET' && requestUrl.pathname === '/api/detection/status') {
        json(response, 200, detectionEngine.getStatus());
        return;
    }

    if (method === 'GET' && requestUrl.pathname === '/api/smart-alerts/status') {
        json(response, 200, smartAlertRunner.getStatus());
        return;
    }

    if (method === 'GET' && requestUrl.pathname === '/api/smart-money/wallets') {
        try {
            const wallets = await DatabaseService.fetchSmartMoneyWallets();
            json(response, 200, {
                wallets,
                generatedAt: new Date().toISOString(),
                source: 'backend'
            });
            return;
        } catch (error) {
            json(response, 500, {
                error: error instanceof Error ? error.message : 'Could not load Smart Money wallets.'
            });
            return;
        }
    }

    if (method === 'POST' && requestUrl.pathname === '/api/smart-money/track-wallet') {
        try {
            const body = await readJsonBody(request) as { walletAddress?: string; chain?: string };
            const result = await scanSmartMoneyWallet(String(body.walletAddress || ''), body.chain);
            json(response, 200, result);
            return;
        } catch (error) {
            json(response, 400, {
                error: error instanceof Error ? error.message : 'Could not scan Smart Money wallet.'
            });
            return;
        }
    }

    if (method === 'POST' && requestUrl.pathname === '/api/smart-money/exclude-wallet') {
        try {
            const body = await readJsonBody(request) as { walletAddress?: string; reason?: string };
            const validation = validateWalletAddress(String(body.walletAddress || ''));
            if (!validation.isValid) {
                json(response, 400, { error: validation.error || 'Enter a valid wallet address.' });
                return;
            }

            const walletAddress = normalizeWalletAddressForStorage(validation.normalizedAddress);
            await DatabaseService.excludeSmartMoneyWallet(walletAddress, body.reason);
            json(response, 200, {
                walletAddress,
                excluded: true
            });
            return;
        } catch (error) {
            json(response, 400, {
                error: error instanceof Error ? error.message : 'Could not exclude Smart Money wallet.'
            });
            return;
        }
    }

    if (method === 'POST' && requestUrl.pathname === '/api/smart-alerts/run') {
        const status = await smartAlertRunner.runNow();
        json(response, 200, status);
        return;
    }

    if (method === 'GET' && requestUrl.pathname === '/api/smart-alerts/token-lookup') {
        try {
            const address = normalizeAddress(requestUrl.searchParams.get('address') || '');
            const chain = normalizeText(requestUrl.searchParams.get('chain') || '');

            if (!address) {
                json(response, 400, { error: 'Enter a token contract address.' });
                return;
            }

            const providerToken = await lookupDexscreenerToken(address, chain);
            if (providerToken) {
                json(response, 200, { token: providerToken });
                return;
            }

            const marketResponse = await DatabaseService.getMarketData(true, false);
            const marketCoins = marketResponse.data || [];
            const cachedMatch = marketCoins.find((coin: any) => {
                const addressMatches = normalizeText(coin.address) === normalizeText(address) ||
                    normalizeText(coin.pairAddress) === normalizeText(address);
                const chainMatches = !chain || normalizeText(coin.chain) === chain;
                return addressMatches && chainMatches;
            });

            if (cachedMatch) {
                json(response, 200, { token: normalizeTokenLookup(cachedMatch) });
                return;
            }

            json(response, 404, { error: 'Token was not found in the current market feed or Dexscreener.' });
            return;
        } catch (error) {
            json(response, 500, {
                error: error instanceof Error ? error.message : 'Could not look up token.'
            });
            return;
        }
    }

    if (method === 'GET' && requestUrl.pathname === '/api/detection/feed') {
        try {
            const events = await DetectionSnapshotStore.getFeed();
            json(response, 200, {
                events,
                generatedAt: new Date().toISOString(),
                status: detectionEngine.getStatus()
            });
            return;
        } catch (error) {
            const fallbackEvents = await DatabaseService.fetchDetectionEvents();
            json(response, 200, {
                events: fallbackEvents,
                generatedAt: new Date().toISOString(),
                fallback: true,
                warning: error instanceof Error ? error.message : 'Shared detection snapshot feed is unavailable.',
                status: detectionEngine.getStatus()
            });
            return;
        }
    }

    if (method === 'GET' && requestUrl.pathname === '/api/detection/signal-quality') {
        try {
            const summary = await DetectionOutcomeTracker.getSignalQualitySummary();
            json(response, 200, {
                summary,
                generatedAt: new Date().toISOString()
            });
            return;
        } catch (error) {
            json(response, 500, {
                error: error instanceof Error ? error.message : 'Could not load detection signal quality.'
            });
            return;
        }
    }

    if (method === 'GET' && requestUrl.pathname.startsWith('/api/detection/token/')) {
        try {
            const parts = requestUrl.pathname.split('/').filter(Boolean);
            const chain = parts[3] || '';
            const tokenAddress = parts[4] || '';
            const event = await DetectionSnapshotStore.getToken(chain, tokenAddress);

            json(response, event ? 200 : 404, {
                event,
                generatedAt: new Date().toISOString()
            });
            return;
        } catch (error) {
            const parts = requestUrl.pathname.split('/').filter(Boolean);
            const chain = (parts[3] || '').toLowerCase();
            const tokenAddress = (parts[4] || '').toLowerCase();
            const fallbackEvents = await DatabaseService.fetchDetectionEvents();
            const event = fallbackEvents.find((candidate: any) => {
                return candidate.token?.chain?.toLowerCase() === chain &&
                    [candidate.token?.address, candidate.token?.pairAddress, candidate.token?.ticker]
                        .filter(Boolean)
                        .map((value: string) => value.toLowerCase())
                        .includes(tokenAddress);
            }) || null;

            json(response, event ? 200 : 404, {
                event,
                generatedAt: new Date().toISOString(),
                fallback: true,
                warning: error instanceof Error ? error.message : 'Shared token snapshot is unavailable.'
            });
            return;
        }
    }

    if (method === 'POST' && requestUrl.pathname === '/api/detection/run') {
        const status = await detectionEngine.runNow();
        json(response, 200, status);
        return;
    }

    if (method === 'GET' && requestUrl.pathname === '/api/ai-assistant/notifications') {
        try {
            const notifications = await loadAssistantNotifications();
            json(response, 200, {
                notifications,
                provider: getAssistantProvider(),
                generatedAt: new Date().toISOString()
            });
            return;
        } catch (error) {
            json(response, 500, {
                error: error instanceof Error ? error.message : 'Could not load assistant notifications.'
            });
            return;
        }
    }

    if (method === 'POST' && requestUrl.pathname === '/api/ai-assistant/chat') {
        try {
            const body = await readJsonBody(request) as { message?: string; history?: AssistantConversationMessage[] };
            const message = String(body.message || '').trim();
            if (!message) {
                json(response, 400, { error: 'message is required.' });
                return;
            }

            const history = Array.isArray(body.history) ? body.history.slice(-12) : [];
            const result = await buildAssistantResponse(message, history);
            json(response, 200, {
                id: randomUUID(),
                role: 'assistant',
                createdAt: new Date().toISOString(),
                provider: getAssistantProvider(),
                ...result
            });
            return;
        } catch (error) {
            json(response, 500, {
                error: error instanceof Error ? error.message : 'The assistant could not complete that request.'
            });
            return;
        }
    }

    if (method === 'POST' && requestUrl.pathname === '/api/token-activity/watch') {
        try {
            const watch = await ImpactfulTokenActivityStore.watchToken(await readJsonBody(request));
            json(response, 200, {
                watch,
                stats: ImpactfulTokenActivityStore.getWatchStats()
            });
            return;
        } catch (error) {
            json(response, 400, {
                error: error instanceof Error ? error.message : 'Could not watch token activity.'
            });
            return;
        }
    }

    if (method === 'POST' && requestUrl.pathname === '/api/token-activity/alchemy-webhook') {
        try {
            const result = ImpactfulTokenActivityStore.ingestAlchemyWebhook(await readJsonBody(request));
            json(response, 200, result);
            return;
        } catch (error) {
            json(response, 400, {
                error: error instanceof Error ? error.message : 'Could not ingest Alchemy webhook.'
            });
            return;
        }
    }

    if (method === 'POST' && requestUrl.pathname === '/api/token-activity/cache') {
        try {
            const body = await readJsonBody(request) as { chain?: string; tokenAddress?: string; activities?: any[] };
            const chain = String(body.chain || '').toLowerCase();
            const tokenAddress = normalizeAddress(body.tokenAddress || '');

            if (!chain || !tokenAddress || !Array.isArray(body.activities)) {
                json(response, 400, { error: 'chain, tokenAddress, and activities are required.' });
                return;
            }

            const activities = ImpactfulTokenActivityStore.cacheActivities(chain, tokenAddress, body.activities);
            json(response, 200, {
                activities,
                stats: ImpactfulTokenActivityStore.getWatchStats()
            });
            return;
        } catch (error) {
            json(response, 400, {
                error: error instanceof Error ? error.message : 'Could not cache token activity.'
            });
            return;
        }
    }

    if (method === 'POST' && requestUrl.pathname === '/api/token-activity/create-alchemy-webhook') {
        try {
            const body = await readJsonBody(request) as { chain?: string; webhookUrl?: string; name?: string; addresses?: string[] };
            const result = await ImpactfulTokenActivityStore.createAlchemyWebhook({
                chain: String(body.chain || ''),
                webhookUrl: String(body.webhookUrl || ''),
                name: body.name,
                addresses: Array.isArray(body.addresses) ? body.addresses : []
            });
            json(response, 200, result);
            return;
        } catch (error) {
            json(response, 400, {
                error: error instanceof Error ? error.message : 'Could not create Alchemy webhook.'
            });
            return;
        }
    }

    if (method === 'GET' && requestUrl.pathname.startsWith('/api/token-activity/')) {
        const parts = requestUrl.pathname.split('/').filter(Boolean);
        const chain = parts[2] || '';
        const tokenAddress = parts[3] || '';
        const activities = await ImpactfulTokenActivityStore.getActivities(chain, tokenAddress);
        const metadata = ImpactfulTokenActivityStore.getActivityMetadata(chain, tokenAddress);

        json(response, 200, {
            activities,
            savedAt: metadata.savedAt,
            expiresAt: metadata.expiresAt,
            maxEvents: metadata.maxEvents,
            version: metadata.version,
            source: ImpactfulTokenActivityStore.getActivitySource(),
            count: activities.length,
            stats: ImpactfulTokenActivityStore.getWatchStats()
        });
        return;
    }

    if (method === 'POST' && requestUrl.pathname === '/api/forensics/jobs') {
        try {
            const body = await readJsonBody(request) as { tokenAddress?: string };
            const tokenAddress = normalizeAddress(body.tokenAddress || '');

            if (!tokenAddress || !isLikelySolanaAddress(tokenAddress)) {
                json(response, 400, { error: 'A valid Solana token address is required.' });
                return;
            }

            const reusableJob = queue.findReusableJob(tokenAddress);
            const job = reusableJob || queue.createQueuedJob(randomUUID(), tokenAddress);
            json(response, 202, {
                jobId: job.id,
                status: job.status,
                stage: job.stage,
                tokenAddress: job.tokenAddress
            });
            return;
        } catch (error) {
            json(response, 500, {
                error: error instanceof Error ? error.message : 'Could not start forensic job.'
            });
            return;
        }
    }

    if (method === 'POST' && requestUrl.pathname === '/api/forensics/alchemy-hub') {
        try {
            const body = await readJsonBody(request) as { tokenAddress?: string; chain?: string; depth?: string };
            const tokenAddress = normalizeAddress(body.tokenAddress || '');
            const selectedChain = getAlchemyHubChain(body.chain).id;
            const selectedDepth = getAlchemyHubScanDepth(body.depth);

            if (!tokenAddress || (selectedChain === 'solana' && !isLikelySolanaAddress(tokenAddress))) {
                json(response, 400, { error: 'A valid Solana token address is required for Solana scans.' });
                return;
            }

            if (isEvmChain(selectedChain) && !isLikelyEvmAddress(tokenAddress)) {
                json(response, 400, { error: 'A valid 0x token contract address is required for EVM scans.' });
                return;
            }

            const report = isEvmChain(selectedChain)
                ? await analyzeAlchemyHubEvmToken(tokenAddress, selectedChain, { depth: selectedDepth })
                : await analyzeAlchemyHubToken(tokenAddress, { depth: selectedDepth });
            json(response, 200, { report });
            return;
        } catch (error) {
            json(response, 500, {
                error: error instanceof Error ? error.message : 'Could not build Alchemy Hub map.'
            });
            return;
        }
    }

    if (method === 'POST' && requestUrl.pathname === '/api/forensics/safe-scan') {
        try {
            const body = await readJsonBody(request) as { tokenAddress?: string; chain?: string };
            const tokenAddress = normalizeAddress(body.tokenAddress || '');
            const selectedChain = getAlchemyHubChain(body.chain).id;

            if (!tokenAddress || (selectedChain === 'solana' && !isLikelySolanaAddress(tokenAddress))) {
                json(response, 400, { error: 'A valid Solana token address is required for Solana scans.' });
                return;
            }

            if (isEvmChain(selectedChain) && !isLikelyEvmAddress(tokenAddress)) {
                json(response, 400, { error: 'A valid 0x token contract address is required for EVM scans.' });
                return;
            }

            const holderSeeds = await fetchMoralisTopHolders(tokenAddress, selectedChain, 300);
            const report = isEvmChain(selectedChain)
                ? await analyzeAlchemyHubEvmToken(tokenAddress, selectedChain, { depth: 'balanced', holderSeeds, seedOnly: true })
                : await analyzeAlchemyHubToken(tokenAddress, { depth: 'balanced', holderSeeds, seedOnly: true });

            json(response, 200, {
                report,
                holderSeedCount: holderSeeds.length
            });
            return;
        } catch (error) {
            json(response, 500, {
                error: error instanceof Error ? error.message : 'Could not build Safe Scan map.'
            });
            return;
        }
    }

    if (method === 'POST' && requestUrl.pathname === '/api/smart-money-scanner/early-buyers') {
        try {
            const body = await readJsonBody(request) as { tokenAddress?: string; chain?: string; limit?: number };
            const tokenAddress = normalizeAddress(body.tokenAddress || '');
            const selectedChain = String(body.chain || '').toLowerCase();
            const limit = Math.max(10, Math.min(Number(body.limit || 100), 300));

            if (!isSmartScannerChain(selectedChain)) {
                json(response, 400, { error: 'Select a supported scanner network.' });
                return;
            }

            if (selectedChain === 'solana' && !isLikelySolanaAddress(tokenAddress)) {
                json(response, 400, { error: 'A valid Solana token address is required.' });
                return;
            }

            if (selectedChain !== 'solana' && !isLikelyEvmAddress(tokenAddress)) {
                json(response, 400, { error: 'A valid 0x token contract address is required.' });
                return;
            }

            const buyers = await discoverSmartScannerEarlyBuyers(tokenAddress, selectedChain, limit);

            json(response, 200, {
                tokenAddress,
                chain: selectedChain,
                buyers,
                discoverySource: buyers[0]?.source || 'none'
            });
            return;
        } catch (error) {
            json(response, 500, {
                error: error instanceof Error ? error.message : 'Could not discover early buyers.'
            });
            return;
        }
    }

    if (method === 'GET' && requestUrl.pathname.startsWith('/api/forensics/jobs/')) {
        const jobId = requestUrl.pathname.split('/').pop() || '';
        const job = queue.getJob(jobId);

        if (!job) {
            json(response, 404, { error: 'Forensic job not found.' });
            return;
        }

        json(response, 200, {
            jobId: job.id,
            tokenAddress: job.tokenAddress,
            status: job.status,
            stage: job.stage,
            createdAt: job.createdAt,
            updatedAt: job.updatedAt,
            error: job.error,
            report: job.report
        });
        return;
    }

    if (method === 'GET' && (requestUrl.pathname === '/api/forensics/health' || requestUrl.pathname === '/health')) {
        const stats = queue.getStats();
        json(response, 200, {
            ok: true,
            ...stats
        });
        return;
    }

    json(response, 404, { error: 'Not found.' });
});

server.listen(PORT, HOST, () => {
    console.log(`[ForensicsServer] listening on http://${HOST}:${PORT}`);
});
