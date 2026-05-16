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
    | 'unsupported_capability'
    | 'get_token_deep_brief'
    | 'get_wallet_deep_brief'
    | 'get_platform_updates'
    | 'get_detection_updates'
    | 'get_detection_filtered'
    | 'explain_detection_admission'
    | 'run_safe_scan'
    | 'prepare_alert_setup'
    | 'prepare_detection_alert'
    | 'prepare_linked_alert'
    | 'get_token_activity'
    | 'open_token_details'
    | 'compare_tokens'
    | 'get_token_holders'
    | 'watch_token_activity'
    | 'get_token_overview'
    | 'get_smart_alert_status';

type AssistantToolRequest = {
    tool: AssistantToolName;
    address?: string;
    chain?: string;
    query?: string;
    responseStyle?: 'brief' | 'detailed';
    eventIntent?: 'accumulation' | 'performance' | 'moving';
    eventType?: string;
    severity?: string;
    scoreMin?: number;
    timeWindow?: string;
    alertMode?: string;
};

type AssistantScoredTokenCandidate = {
    token: any;
    score: number;
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
    'cap', 'liquidity', 'volume', 'this', 'that', 'yes', 'it', 'its', 'one', 'talking',
    'can', 'you', 'search', 'find', 'called', 'named', 'known', 'as', 'look', 'lookup', 'up',
    'detected', 'detection', 'engine', 'event', 'events', 'signals', 'signal', 'updates',
    'recent', 'latest', 'newest', 'from', 'in', 'with', 'score', 'scores', 'severity',
    'data', 'right', 'now', 'worth', 'value', 'valuation', 'fdv', 'fully', 'diluted',
    'circulating', 'supply', 'much', 'big', 'large', 'small', 'high', 'low', 'total'
]);

const cleanAssistantTokenQuery = (value: string) => value
    .replace(/\$([a-zA-Z0-9]+)/g, '$1')
    .replace(/[^a-zA-Z0-9\s.-]/g, ' ')
    .split(/\s+/)
    .filter((word) => word && !TOKEN_QUERY_STOP_WORDS.has(word.toLowerCase()))
    .join(' ')
    .trim();

const sanitizeAssistantTokenLookupQuery = (value: string) => {
    const raw = String(value || '').trim();
    if (!raw) return '';
    const address = extractAssistantAddress(raw);
    if (address) return address;

    const cashtag = raw.match(/\$([a-zA-Z][a-zA-Z0-9]{1,15})\b/)?.[1];
    if (cashtag) return cashtag;

    const compactMetricQuestion = raw.match(/\b(?:market\s*cap|mcap|price|liquidity|volume|fdv|valuation|worth|value)\s+(?:of|for|on|in)?\s+([a-zA-Z0-9$.-]{2,32})\b/i)?.[1]
        || raw.match(/\b([a-zA-Z0-9$.-]{2,32})\s+(?:market\s*cap|mcap|price|liquidity|volume|fdv|valuation|worth|value)\b/i)?.[1];
    if (compactMetricQuestion) return cleanAssistantTokenQuery(compactMetricQuestion);

    return cleanAssistantTokenQuery(raw);
};

const extractAssistantTokenQuery = (message: string, history: AssistantConversationMessage[] = []) => {
    const address = extractAssistantAddress(message);
    if (address) return address;

    const cashtag = message.match(/\$([a-zA-Z][a-zA-Z0-9]{1,15})\b/)?.[1];
    if (cashtag) return cashtag;

    const directPatterns = [
        /\b(?:tell\s+me\s+about|show\s+me|explain)\s+(?:the\s+)?(?:detected\s+)?(?:events?|detections?|signals?)\s+(?:in|for|on|about)\s+([a-zA-Z0-9$.-]{2,32})\b/i,
        /\b(?:detected\s+)?(?:events?|detections?|signals?)\s+(?:in|for|on|about)\s+([a-zA-Z0-9$.-]{2,32})\b/i,
        /\bdetection(?:\s+engine)?\s+(?:events?|signals?|context|updates?)\s+(?:in|for|on|about)\s+([a-zA-Z0-9$.-]{2,32})\b/i,
        /\b(?:token|coin)\s+(?:called|named|known\s+as)\s+([a-zA-Z0-9$.-]{2,32})\b/i,
        /\b(?:search|find|lookup|look\s+up)\s+(?:for\s+)?(?:the\s+)?(?:token|coin)?\s*(?:called|named)?\s+([a-zA-Z0-9$.-]{2,32})\b/i,
        /\b(?:price|details|overview|market\s*cap|liquidity|volume|performing|performance|moving|move|doing)\s+(?:of|for|on)?\s+(.+?)(?:\?|$)/i,
        /\bhow\s+(?:is|are)\s+(.+?)\s+(?:performing|doing|moving)(?:\s+today)?\??$/i,
        /\b(?:tell me about|show me)\s+(.+?)(?:\?|$)/i
    ];

    for (const pattern of directPatterns) {
        const match = message.match(pattern)?.[1];
        const cleaned = sanitizeAssistantTokenLookupQuery(match || '');
        if (cleaned) return cleaned;
    }

    const cleanedMessage = sanitizeAssistantTokenLookupQuery(message);
    if (cleanedMessage && !/\b(yes|that|this|it)\b/i.test(message)) return cleanedMessage;

    for (const item of [...history].reverse()) {
        if (item.role === 'assistant') continue;
        const prior = extractAssistantAddress(String(item.text || '')) || extractAssistantTokenQuery(String(item.text || ''), []);
        if (prior) return prior;
    }

    return '';
};

const extractRecentAssistantTokenFromContext = (history: AssistantConversationMessage[] = []) => {
    for (const item of [...history].reverse()) {
        if (item.role !== 'user') continue;
        const explicitToken = extractAssistantTokenQuery(String(item.text || ''), []);
        if (explicitToken) {
            return /^[a-z0-9$.-]{2,15}$/i.test(explicitToken) ? explicitToken.toUpperCase() : explicitToken;
        }
    }

    const tokenMentions: string[] = [];
    const patterns = [
        /\bAtlaix Brief:\s+.+?\(([A-Z0-9$.-]{2,32})\)/g,
        /\b([A-Z][A-Z0-9$.-]{1,31})\s+\(([A-Z][A-Z0-9$.-]{1,31})\)\s+on\b/g,
        /\b\d+\.\s+([A-Z0-9$.-]{2,32}):\s+/g,
        /\b([A-Z0-9$.-]{2,32}):\s+(?:Market Stress|Accumulation|Distribution|Recovery|Liquidity Event|Thin Liquidity Risk|Unusual Activity|Conflicting Signals|Volume Spike)/g,
        /\b([A-Z0-9$.-]{2,32})\s+(?:detection|detections|detected|events|signals|risk|risky|liquidity|price|volume)\b/g
    ];

    for (const item of [...history].reverse()) {
        const text = String(item.text || '');
        for (const pattern of patterns) {
            pattern.lastIndex = 0;
            for (const match of text.matchAll(pattern)) {
                const token = cleanAssistantTokenQuery(match[2] || match[1] || '');
                const lower = token.toLowerCase();
                const looksLikeMetric = /^\$?\d/.test(token) || token.includes('.') || /\b(k|m|b|t)\b/i.test(token);
                if (token && !looksLikeMetric && !TOKEN_QUERY_STOP_WORDS.has(lower)) tokenMentions.push(token);
            }
        }
        if (tokenMentions.length) return tokenMentions[0];
    }

    return '';
};

const isAssistantBroadDetectionQuery = (message: string) => {
    const lower = message.toLowerCase();
    const mentionsDetection = /\b(detection|detections?|detected|events?|signals?|admitted|newest|latest|recent)\b/.test(lower);
    const broadScope = /\b(newest|latest|recent|all|high|medium|low|severity|score|today|24h|last hour|past hour|bsc|bnb|solana|base|ethereum|polygon|chain|chains)\b/.test(lower);
    return mentionsDetection && broadScope && !hasExplicitAssistantTokenQuery(message);
};

const hasExplicitAssistantTokenQuery = (message: string) =>
    Boolean(
        extractAssistantAddress(message) ||
        message.match(/\$[a-zA-Z][a-zA-Z0-9]{1,15}\b/) ||
        message.match(/\b(?:token|coin)\s+(?:called|named|known\s+as)\s+[a-zA-Z0-9$.-]{2,32}\b/i) ||
        message.match(/\b(?:search|find|lookup|look\s+up)\s+(?:for\s+)?(?:the\s+)?(?:token|coin)?\s*(?:called|named)?\s+[a-zA-Z0-9$.-]{2,32}\b/i) ||
        message.match(/\b(?:detected\s+)?(?:events?|detections?|signals?)\s+(?:in|for|on|about)\s+[a-zA-Z0-9$.-]{2,32}\b/i)
    );

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

const scoreAssistantTokenCandidate = (token: any, normalizedQuery: string) => {
    const ticker = String(token.ticker || '').toLowerCase();
    const name = String(token.name || '').toLowerCase();
    const address = String(token.address || '').toLowerCase();
    const liquidity = parseAssistantMarketNumber(token.liquidity);
    const volume = parseAssistantMarketNumber(token.volume24h);
    const marketCap = parseAssistantMarketNumber(token.cap);

    let score = 0;
    if (ticker === normalizedQuery) score += 1000;
    if (name === normalizedQuery) score += 900;
    if (address === normalizedQuery) score += 850;
    if (ticker.split(/[^a-z0-9]+/).includes(normalizedQuery)) score += 500;
    if (name.split(/[^a-z0-9]+/).includes(normalizedQuery)) score += 420;
    if (ticker.startsWith(normalizedQuery)) score += 260;
    if (name.startsWith(normalizedQuery)) score += 220;
    if (ticker.includes(normalizedQuery)) score += 140;
    if (name.includes(normalizedQuery)) score += 80;
    if (liquidity > 0) score += Math.min(80, Math.log10(liquidity + 1) * 10);
    if (volume > 0) score += Math.min(60, Math.log10(volume + 1) * 8);
    if (marketCap > 0) score += Math.min(50, Math.log10(marketCap + 1) * 6);
    if (!ticker.includes(normalizedQuery) && !name.includes(normalizedQuery) && address !== normalizedQuery) score -= 250;
    return score;
};

const assistantTokenFromDetectionEvent = (event: any) => {
    const token = event?.token || {};
    if (!token?.ticker && !token?.name && !token?.address) return null;

    return {
        name: token.name || token.ticker || 'Unknown Token',
        ticker: token.ticker || token.name || 'TOKEN',
        address: token.address || token.pairAddress || '',
        pairAddress: token.pairAddress,
        chain: token.chain || 'unknown',
        price: token.price || '$0',
        h24: token.h24 || `${Number(event?.metrics?.priceChange24h || 0).toFixed(2)}%`,
        volume24h: token.volume24h || compactUsd(Number(event?.metrics?.volume24h || 0)),
        liquidity: token.liquidity || compactUsd(Number(event?.metrics?.liquidity || 0)),
        cap: token.cap || compactUsd(Number(event?.metrics?.marketCap || 0))
    };
};

const getAssistantTokenCandidates = async (query: string, chain?: string): Promise<AssistantScoredTokenCandidate[]> => {
    const trimmed = query.trim();
    if (!trimmed) return [];

    const [searchResults, detectionFeed] = await Promise.all([
        DatabaseService.searchGlobalPairs(trimmed).catch(() => []),
        DetectionSnapshotStore.getFeed().catch(async () => DatabaseService.fetchDetectionEvents().catch(() => []))
    ]);
    const normalizedChain = chain ? chain.toLowerCase() : '';
    const normalizedQuery = trimmed.replace(/^\$/, '').toLowerCase();
    const chainMatches = (token: any) => {
        if (!normalizedChain) return true;
        const tokenChain = String(token.chain || '').toLowerCase();
        return tokenChain === normalizedChain || normalizeAssistantChainLabel(tokenChain).toLowerCase() === normalizeAssistantChainLabel(chain).toLowerCase();
    };
    const detectionTokens = (detectionFeed || [])
        .map(assistantTokenFromDetectionEvent)
        .filter(Boolean);
    const candidateMap = new Map<string, any>();
    for (const token of [...searchResults, ...detectionTokens]) {
        const key = `${String(token?.chain || '').toLowerCase()}:${String(token?.address || token?.pairAddress || token?.ticker || token?.name || '').toLowerCase()}`;
        if (!candidateMap.has(key)) candidateMap.set(key, token);
    }

    const mergedResults = [...candidateMap.values()];
    const chainFiltered = mergedResults.filter(chainMatches);
    const candidates = chainFiltered.length ? chainFiltered : mergedResults;

    return candidates
        .map((token: any) => ({
            token,
            score: scoreAssistantTokenCandidate(token, normalizedQuery)
        }))
        .filter((candidate) => candidate.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, 5);
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

    return (await getAssistantTokenCandidates(trimmed, chain))[0]?.token || null;
};

const tokenDetailsHref = (tokenOrAddress: any, chain?: string, pairAddress?: string) => {
    const token = typeof tokenOrAddress === 'string' ? { address: tokenOrAddress, chain, pairAddress } : (tokenOrAddress || {});
    const address = token.address || token.tokenAddress || token.query || '';
    if (!address) return '/dashboard';

    const params = new URLSearchParams();
    const pair = token.pairAddress || pairAddress;
    const tokenChain = token.chain || chain;
    if (pair) params.set('pair', pair);
    if (tokenChain) params.set('chain', normalizeAssistantChainId(tokenChain));

    const suffix = params.toString();
    return `/token/${encodeURIComponent(address)}${suffix ? `?${suffix}` : ''}`;
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
    if (token.chain) params.set('chain', normalizeAssistantChainId(token.chain));
    if (token.pairAddress) params.set('pair', token.pairAddress);
    return `/detection/token/${encodeURIComponent(address)}?${params.toString()}`;
};

const assistantEventReference = (event: any) => ({
    token: event?.token?.ticker || event?.token?.name,
    eventType: event?.eventType,
    severity: event?.severity,
    score: event?.score,
    implication: explainAssistantDetectionImplication(event),
    href: eventTokenHref(event)
});

const getAssistantDetectionTimestamp = (event: any) => Number(event?.detectedAt || 0);

const sortAssistantDetectionEventsByFreshness = (events: any[]) => [...(events || [])].sort((a, b) => {
    const timeDelta = getAssistantDetectionTimestamp(b) - getAssistantDetectionTimestamp(a);
    if (timeDelta) return timeDelta;
    return Number(b?.score || 0) - Number(a?.score || 0);
});

const getDetectionFeedForAssistant = async () => {
    const events = await DetectionSnapshotStore.getFeed().catch(async () => DatabaseService.fetchDetectionEvents());
    return sortAssistantDetectionEventsByFreshness(events || []);
};

const normalizeAssistantDetectionEventType = (value: string | undefined) => {
    const lower = String(value || '').toLowerCase();
    if (!lower) return '';
    if (lower.includes('breakout') || lower.includes('momentum')) return lower.includes('overextended') ? 'Overextended Momentum' : 'Momentum Breakout';
    if (lower.includes('wash') || lower.includes('artificial')) return 'Possible Wash Trading';
    if (lower.includes('conflict')) return 'Conflicting Signals';
    if (lower.includes('flow imbalance')) return 'Flow Imbalance';
    if (lower.includes('potential') && lower.includes('accum')) return 'Potential Accumulation';
    if (lower.includes('accum')) return 'Accumulation';
    if (lower.includes('potential') && lower.includes('distrib')) return 'Potential Distribution';
    if (lower.includes('distrib')) return 'Distribution';
    if (lower.includes('stress')) return 'Market Stress';
    if (lower.includes('confirmed') && lower.includes('recover')) return 'Confirmed Recovery';
    if (lower.includes('recover')) return lower.includes('attempt') ? 'Recovery Attempt' : 'Recovery';
    if (lower.includes('confirmed') && lower.includes('liquid') && lower.includes('removed')) return 'Confirmed Liquidity Removed';
    if (lower.includes('confirmed') && lower.includes('liquid') && lower.includes('added')) return 'Confirmed Liquidity Added';
    if (lower.includes('thin') && lower.includes('liquid')) return 'Thin Liquidity Risk';
    if (lower.includes('deep') && lower.includes('liquid')) return 'Deep Liquidity Structure';
    if (lower.includes('liquid')) return 'Liquidity Event';
    if (lower.includes('unusual')) return 'Unusual Activity';
    if (lower.includes('volume')) return 'Volume Spike';
    return '';
};

const extractAssistantScoreMin = (message: string) => {
    const match = message.match(/\b(?:score|confidence)\s*(?:above|over|>=|at least|minimum|min)?\s*(\d{1,3})\b/i)
        || message.match(/\b(\d{1,3})\s*\+?\s*(?:score|confidence)\b/i);
    if (!match) return undefined;
    const score = Number(match[1]);
    return Number.isFinite(score) ? Math.max(0, Math.min(100, score)) : undefined;
};

const extractAssistantDetectionFilters = (message: string, request: AssistantToolRequest = { tool: 'get_detection_filtered' }) => {
    const lower = message.toLowerCase();
    const eventType = normalizeAssistantDetectionEventType(request.eventType || message);
    const severity = request.severity
        || (/\bhigh\b/.test(lower) ? 'High' : /\bmedium\b/.test(lower) ? 'Medium' : /\blow\b/.test(lower) ? 'Low' : '');
    const scoreMin = request.scoreMin ?? extractAssistantScoreMin(message);
    const chain = request.chain
        || (lower.includes('solana') ? 'solana'
            : lower.includes('base') ? 'base'
                : lower.includes('bsc') || lower.includes('bnb') ? 'bsc'
                    : lower.includes('ethereum') ? 'ethereum'
                        : '');
    const hours = lower.includes('last hour') || lower.includes('past hour') ? 1
        : lower.includes('today') || lower.includes('24h') || lower.includes('24 hours') ? 24
            : lower.includes('week') ? 24 * 7
                : undefined;

    return {
        eventType,
        severity,
        scoreMin,
        chain: normalizeAssistantChainId(chain),
        hours
    };
};

const assistantDetectionEventMatchesFilters = (event: any, filters: ReturnType<typeof extractAssistantDetectionFilters>) => {
    const eventType = String(event?.eventType || '').toLowerCase();
    const requestedType = String(filters.eventType || '').toLowerCase();
    const chain = normalizeAssistantChainId(event?.token?.chain);
    if (requestedType && !eventType.includes(requestedType.replace(/^potential\s+/, '')) && !requestedType.includes(eventType)) {
        if (!(requestedType.includes('volume') && assistantEventText(event).includes('volume'))) return false;
    }
    if (filters.severity && String(event?.severity || '').toLowerCase() !== filters.severity.toLowerCase()) return false;
    if (filters.chain && chain && chain !== filters.chain) return false;
    if (typeof filters.scoreMin === 'number' && Number(event?.score || 0) < filters.scoreMin) return false;
    if (filters.hours) {
        const detectedAt = Number(event?.detectedAt || 0);
        if (!detectedAt || Date.now() - detectedAt > filters.hours * 60 * 60 * 1000) return false;
    }
    return true;
};

const formatAssistantFreshnessLine = (events: any[]) => {
    const latest = Math.max(...events.map((event: any) => Number(event?.detectedAt || 0)).filter(Boolean), 0);
    if (!latest) return 'Freshness: no detection timestamp is available for these results.';
    const minutes = Math.max(0, Math.round((Date.now() - latest) / 60_000));
    if (minutes < 2) return 'Freshness: latest matching event is live from the last couple of minutes.';
    if (minutes < 60) return `Freshness: latest matching event is about ${minutes} minutes old.`;
    return `Freshness: latest matching event is about ${(minutes / 60).toFixed(1)} hours old.`;
};

const extractAssistantCompareTargets = (message: string, history: AssistantConversationMessage[] = []) => {
    const cashtags = [...message.matchAll(/\$([a-zA-Z][a-zA-Z0-9]{1,15})\b/g)].map((match) => match[1]);
    if (cashtags.length >= 2) return [...new Set(cashtags)].slice(0, 4);

    const cleaned = message
        .replace(/\b(compare|versus|vs\.?|against|which is better|between|token|tokens|coin|coins|please|show me|can you)\b/gi, ' ')
        .replace(/[?]/g, ' ');
    const parts = cleaned
        .split(/\s+(?:and|vs|versus|against)\s+|,/i)
        .map((part) => cleanAssistantTokenQuery(part))
        .filter((part) => part && !/\b(price|liquidity|volume|market cap|performance|better)\b/i.test(part));

    if (parts.length >= 2) return [...new Set(parts)].slice(0, 4);

    const recent = extractAssistantTokenQuery('', history);
    return recent && parts.length === 1 ? [recent, parts[0]] : parts;
};

const formatAssistantDetectionLine = (event: any) => {
    const token = event?.token || {};
    const label = token.ticker || token.name || 'Unknown token';
    const volume = compactUsd(event?.metrics?.volume24h);
    const liquidity = compactUsd(event?.metrics?.liquidity);
    return `${label}: ${event.eventType || 'Detection'} (${event.severity || 'Medium'}) with score ${event.score || 0}. 24h volume ${volume}, liquidity ${liquidity}.`;
};

const formatAssistantRelativeTime = (timestamp: number) => {
    const ageMs = Date.now() - Number(timestamp || 0);
    if (!Number.isFinite(ageMs) || ageMs < 0) return 'just now';
    const minutes = Math.round(ageMs / 60_000);
    if (minutes < 2) return 'just now';
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.round(minutes / 60);
    if (hours < 48) return `${hours}h ago`;
    return `${Math.round(hours / 24)}d ago`;
};

const formatAssistantDetectionDetailLine = (event: any) => {
    const base = formatAssistantDetectionLine(event);
    const summary = safeAssistantText(event?.summary, '').replace(/\s+/g, ' ').trim();
    const time = formatAssistantRelativeTime(getAssistantDetectionTimestamp(event));
    return summary ? `${base} Detected ${time}. ${summary}` : `${base} Detected ${time}.`;
};

const explainAssistantDetectionImplication = (event: any) => {
    const eventType = String(event?.eventType || '').toLowerCase();
    const severity = String(event?.severity || 'Medium');
    const token = event?.token || {};
    const label = token.ticker || token.name || 'This token';
    const liquidity = compactUsd(event?.metrics?.liquidity);
    const volume = compactUsd(event?.metrics?.volume24h);

    if (eventType.includes('accumulation')) {
        return `${label}: buyers or active wallets may be building interest. In plain terms, people may be quietly positioning, but it still needs confirmation from liquidity and price follow-through.`;
    }
    if (eventType.includes('distribution')) {
        return `${label}: selling pressure may be building. In plain terms, some holders may be reducing exposure, so chasing green candles can be riskier.`;
    }
    if (eventType.includes('stress')) {
        return `${label}: the market structure looks strained. In plain terms, price, liquidity, or volume behavior may be unstable, so risk is higher than normal.`;
    }
    if (eventType.includes('recovery')) {
        return `${label}: the token may be trying to recover after weakness. In plain terms, it is not automatically safe, but buyers may be returning.`;
    }
    if (eventType.includes('liquidity')) {
        return `${label}: liquidity changed enough to matter. In plain terms, it may become easier or harder to trade without moving price. Current liquidity: ${liquidity}, volume: ${volume}.`;
    }
    return `${label}: Atlaix detected unusual activity at ${severity} severity. In plain terms, something about trading, liquidity, or wallet behavior is worth checking before trusting the move.`;
};

const buildAssistantDetectionBrief = (events: any[], detailed: boolean) => {
    const recentEvents = events || [];
    const visibleEvents = recentEvents.slice(0, detailed ? 12 : 7);
    const highSeverity = recentEvents.filter((event: any) => event?.severity === 'High').length;
    const mediumSeverity = recentEvents.filter((event: any) => event?.severity === 'Medium').length;
    const eventTypes = new Map<string, number>();

    for (const event of recentEvents) {
        const type = String(event?.eventType || 'Unusual Activity');
        eventTypes.set(type, (eventTypes.get(type) || 0) + 1);
    }

    const typeSummary = [...eventTypes.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([type, count]) => `${type}: ${count}`)
        .join(', ');

    return [
        `I found ${recentEvents.length} recent Detection Engine event${recentEvents.length === 1 ? '' : 's'} in the current feed.`,
        formatAssistantFreshnessLine(recentEvents),
        `Risk mix: ${highSeverity} High, ${mediumSeverity} Medium, ${Math.max(0, recentEvents.length - highSeverity - mediumSeverity)} lower/other severity.`,
        typeSummary ? `Main patterns: ${typeSummary}.` : '',
        '',
        detailed ? 'What those signals mean in plain English' : 'Recent highlights',
        ...visibleEvents.map((event: any, index: number) => detailed
            ? `${index + 1}. ${explainAssistantDetectionImplication(event)}`
            : `${index + 1}. ${formatAssistantDetectionLine(event)}`
        ),
        recentEvents.length > visibleEvents.length
            ? `I summarized the first ${visibleEvents.length}; there are ${recentEvents.length - visibleEvents.length} more current-feed events behind that.`
            : '',
        '',
        detailed
            ? 'Beginner takeaway: treat Detection events as attention signals, not buy or sell commands. High severity means slow down and check liquidity, holder concentration, wallet activity, and Safe Scan before making a decision.'
            : 'Ask me to explain further if you want the beginner-friendly meaning behind these events.'
    ].filter(Boolean).join('\n');
};

const assistantEventText = (event: any) => [
    event?.eventType,
    event?.summary,
    ...(Array.isArray(event?.triggers) ? event.triggers : [])
].filter(Boolean).join(' ').toLowerCase();

const getAssistantEventIntentLabel = (intent?: AssistantToolRequest['eventIntent']) => {
    if (intent === 'accumulation') return 'accumulation';
    if (intent === 'performance') return 'strong performance';
    if (intent === 'moving') return 'tokens moving now';
    return 'recent Detection Engine';
};

const filterAssistantEventsByIntent = (events: any[], intent?: AssistantToolRequest['eventIntent']) => {
    const sorted = [...(events || [])].sort((a, b) => {
        const scoreDelta = Number(b?.score || 0) - Number(a?.score || 0);
        if (scoreDelta) return scoreDelta;
        return Number(b?.detectedAt || 0) - Number(a?.detectedAt || 0);
    });

    if (intent === 'accumulation') {
        return sorted.filter((event) => /accumulat/.test(String(event?.eventType || '').toLowerCase()));
    }

    if (intent === 'performance') {
        return sorted.filter((event) => {
            const priceChange = Number(event?.metrics?.priceChange24h || parseAssistantMarketNumber(event?.token?.h24));
            const eventText = assistantEventText(event);
            return priceChange > 0 && !/distribution|sell-side|market stress/.test(eventText);
        }).sort((a, b) => {
            const priceDelta = Number(b?.metrics?.priceChange24h || parseAssistantMarketNumber(b?.token?.h24)) -
                Number(a?.metrics?.priceChange24h || parseAssistantMarketNumber(a?.token?.h24));
            if (priceDelta) return priceDelta;
            return Number(b?.score || 0) - Number(a?.score || 0);
        });
    }

    if (intent === 'moving') {
        return sorted.filter((event) => {
            const priceChange = Math.abs(Number(event?.metrics?.priceChange24h || parseAssistantMarketNumber(event?.token?.h24)));
            return priceChange >= 3 || Number(event?.score || 0) >= 60 || /unusual activity|volume|liquidity|market stress|accumulat|recovery/.test(assistantEventText(event));
        });
    }

    return sorted;
};

const formatAssistantActivityLine = (activity: any) => {
    const value = Number(activity?.usdValue || 0);
    const valueText = value > 0 ? ` (${compactUsd(value)})` : '';
    return `${activity?.title || activity?.type || 'Activity'}: ${activity?.description || 'Recent token activity detected.'}${valueText}.`;
};

const buildAssistantEventIntentBrief = async (
    events: any[],
    intent?: AssistantToolRequest['eventIntent'],
    detailed = false
) => {
    const matchingEvents = filterAssistantEventsByIntent(events, intent);
    const visibleEvents = matchingEvents.slice(0, detailed ? 8 : 5);
    const label = getAssistantEventIntentLabel(intent);

    if (!visibleEvents.length) {
        return [
            `I checked the stored Detection Engine feed, but I do not see current ${label} events in the available snapshot.`,
            'Try opening Detection Engine for the full feed, or ask about a specific token and I can search its event context directly.'
        ].join('\n');
    }

    const activityByToken = new Map<string, any[]>();
    await Promise.all(visibleEvents.map(async (event) => {
        const token = event?.token || {};
        const tokenAddress = token.address || token.pairAddress || '';
        const tokenChain = normalizeAssistantChainId(token.chain);
        const key = `${tokenChain}:${String(tokenAddress || token.ticker || '').toLowerCase()}`;
        if (!tokenAddress || !tokenChain || activityByToken.has(key)) return;
        const activities = await withAssistantTimeout(
            ImpactfulTokenActivityStore.getActivities(tokenChain, tokenAddress).catch(() => []),
            2_500,
            []
        );
        activityByToken.set(key, activities.slice(0, 2));
    }));

    const lines = visibleEvents.flatMap((event: any, index: number) => {
        const token = event?.token || {};
        const label = token.ticker || token.name || 'Unknown token';
        const tokenAddress = token.address || token.pairAddress || '';
        const tokenChain = normalizeAssistantChainId(token.chain);
        const activityKey = `${tokenChain}:${String(tokenAddress || token.ticker || '').toLowerCase()}`;
        const activities = activityByToken.get(activityKey) || [];
        const priceMove = safeAssistantText(token.h24 || `${Number(event?.metrics?.priceChange24h || 0).toFixed(2)}%`, 'unknown');
        const baseLine = `${index + 1}. ${label}: ${event.eventType || 'Detection'} (${event.severity || 'Medium'}, score ${event.score || 0}). 24h move ${priceMove}, volume ${compactUsd(event?.metrics?.volume24h)}, liquidity ${compactUsd(event?.metrics?.liquidity)}.`;
        const meaningLine = `   Why it matters: ${explainAssistantDetectionImplication(event)}`;
        const activityLines = activities.length
            ? activities.map((activity: any) => `   Event feed: ${formatAssistantActivityLine(activity)}`)
            : [`   Event feed: ${safeAssistantText(event.summary, 'No separate wallet-impact activity is stored yet, so this read is based on the Detection Engine event metrics.')}`];
        return [baseLine, meaningLine, ...(detailed ? activityLines : activityLines.slice(0, 1))];
    });

    return [
        `I found ${matchingEvents.length} ${label} event${matchingEvents.length === 1 ? '' : 's'} in the stored Detection Engine feed.`,
        `Here are the token-level reads with recent event-feed context:`,
        '',
        ...lines,
        matchingEvents.length > visibleEvents.length ? `I showed the top ${visibleEvents.length} by score; ${matchingEvents.length - visibleEvents.length} more matching events are available in the feed.` : '',
        '',
        'Beginner takeaway: these are attention signals. Accumulation and performance events can be constructive, but they still need liquidity, holder quality, and follow-through before you trust the move.'
    ].filter(Boolean).join('\n');
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

const buildAssistantTimeoutResponse = (message: string) => ({
    answer: buildLocalConversationResponse(message),
    tool: 'conversation'
});

const buildUnsupportedCapabilityResponse = () => ({
    answer: [
        'I am not yet able to help you do that from inside Atlaix.',
        'Very soon, in upcoming updates, I will be able to assist with carrying out that kind of task. For now, I can still help with token research, Safe Scan risk checks, Detection Engine updates, wallet reads, token activity, and Smart Alert preparation.',
        'Let us steer this back into something I can do safely: send me a token, wallet, or alert goal and I will help from there.'
    ].join('\n'),
    tool: 'unsupported_capability',
    actions: [
        { label: 'Open Safe Scan', href: '/safe-scan', kind: 'navigate' },
        { label: 'Open Detection Engine', href: '/detection', kind: 'navigate' },
        { label: 'Open Smart Alerts', href: '/smart-alerts', kind: 'navigate' }
    ] satisfies AssistantChatAction[]
});

const isUnsupportedAssistantCapabilityRequest = (message: string) => {
    const lower = message.toLowerCase();
    const asksToAct = /\b(can you|please|help me|i want you to|make|create|build|edit|change|delete|remove|deploy|redeploy|publish|push|commit|merge|open a pr|run|execute|install|connect|withdraw|swap|buy|sell|trade|send|transfer|bridge|stake|unstake|claim|airdrop|mint)\b/.test(lower);
    const outOfProductScope = /\b(source code|codebase|backend|frontend|database schema|migration|env|secret|api key|deployment|netlify|railway|supabase table|github|pull request|terminal|shell|server file|wallet transaction|private key|seed phrase|sign transaction|connect wallet|login to|password|email|telegram|discord|twitter|x account|post on|send message|dm\b)\b/.test(lower);
    const tradingAction = /\b(buy|sell|swap|trade|transfer|send|bridge|withdraw|deposit|stake|unstake|claim|mint)\b/.test(lower) && /\b(token|coin|crypto|eth|sol|usdc|wallet|funds?)\b/.test(lower);

    return (asksToAct && outOfProductScope) || tradingAction;
};

const getAssistantDetectionEventKey = (event: any) => {
    const token = event?.token || {};
    return [
        normalizeAssistantChainId(token.chain),
        String(token.address || token.pairAddress || token.ticker || '').toLowerCase(),
        String(event?.eventType || '').toLowerCase()
    ].join(':');
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

    const candidates = await withAssistantTimeout(getAssistantTokenCandidates(trimmed, normalizedChain), 8_000, []);
    const topCandidate = candidates[0];
    const secondCandidate = candidates[1];
    const strongExactMatch = Boolean(topCandidate && topCandidate.score >= 850);
    const strongFuzzyMatch = Boolean(topCandidate && topCandidate.score >= 500);
    const ambiguousMatch = Boolean(
        topCandidate &&
        secondCandidate &&
        topCandidate.score < 850 &&
        secondCandidate.score >= topCandidate.score - 60
    );

    if (topCandidate && (strongExactMatch || (strongFuzzyMatch && !ambiguousMatch))) {
        const token = topCandidate.token;
        return {
            kind: 'token',
            confidence: strongExactMatch && token.address ? 'high' : 'medium',
            query: trimmed,
            address: token.address || (isAddress ? trimmed : ''),
            chain: normalizeAssistantChainId(token.chain || normalizedChain || (isAddress ? inferAssistantChain('', trimmed) : '')),
            token,
            candidates: candidates.map((candidate) => candidate.token)
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

    if (candidates.length) {
        return {
            kind: 'unknown',
            confidence: 'low',
            query: trimmed,
            reason: ambiguousMatch
                ? 'I found multiple possible token matches and need the user to choose the right one.'
                : 'I found possible token matches, but none were strong enough to safely use automatically.',
            candidates: candidates.map((candidate) => candidate.token)
        };
    }

    return { kind: 'unknown', confidence: 'low', query: trimmed, reason: 'No matching token or wallet was found in the accessible app data.' };
};

const getAssistantDetectionContext = async (addressOrQuery: string, chain?: string) => {
    const normalizedChain = normalizeAssistantChainId(chain);
    const feed = await getDetectionFeedForAssistant();
    const matchingFeedEvents = (feed || []).filter((event: any) => matchesAssistantTokenEvent(event, addressOrQuery, normalizedChain));

    if (addressOrQuery && normalizedChain) {
        const event = await DetectionSnapshotStore.getToken(normalizedChain, addressOrQuery).catch(() => null);
        if (event) {
            const key = getAssistantDetectionEventKey(event);
            const extraEvents = matchingFeedEvents.filter((item: any) => getAssistantDetectionEventKey(item) !== key);
            return [event, ...extraEvents].slice(0, 5);
        }
    }

    return matchingFeedEvents.slice(0, 5);
};

const getAssistantSafeScanSummary = async (address: string, chain: string) => {
    if (!address) return null;
    try {
        const selectedChain = toAlchemyAssistantChain(chain, address);
        const report = isEvmChain(selectedChain)
            ? await analyzeAlchemyHubEvmToken(address, selectedChain, { depth: 'balanced', holderSeeds: [], seedOnly: true })
            : await analyzeAlchemyHubToken(address, { depth: 'balanced', holderSeeds: [], seedOnly: true });

        const intelligence = (report as any)?.bundleIntelligence || {};
        return {
            report,
            riskLevel: intelligence.riskLevel || 'unknown',
            confidence: intelligence.confidence || 'unknown',
            coordinatedSupplyPct: Number(report?.supplyAttribution?.combinedCoordinatedPct || 0),
            top10Pct: Number(report?.holderConcentration?.top10Pct || 0),
            reasons: Array.isArray(intelligence.reasons) ? intelligence.reasons.slice(0, 4) : [],
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

const isAssistantStanceQuestion = (message: string) =>
    /\b(bullish|bearish|buy|sell|long|short|ape|entry|good idea|should i|worth it|conviction|thoughts?|take|opinion|risk|risky|safe|danger|dangerous)\b/i.test(message);

const buildAssistantTokenStance = (
    message: string,
    token: any,
    liquidity: ReturnType<typeof summarizeAssistantLiquidity>,
    recentEvents: any[],
    safeScan: any,
    safeError: string | undefined
) => {
    const asksRisk = /\b(risk|risky|safe|danger|dangerous)\b/i.test(message);
    const priceChange = parseAssistantMarketNumber(token?.h24);
    const eventText = recentEvents.map((event: any) => `${event?.eventType || ''} ${event?.severity || ''}`).join(' ').toLowerCase();
    const hasHighRiskEvent = recentEvents.some((event: any) => event?.severity === 'High' || /stress|thin liquidity|distribution|sell|conflicting/.test(String(event?.eventType || '').toLowerCase()));
    const hasConstructiveEvent = recentEvents.some((event: any) => /accumulation|recovery|breakout|buy/.test(String(event?.eventType || '').toLowerCase()));
    const scanRisk = String(safeScan?.riskLevel || '').toLowerCase();
    const scanIsElevated = !safeError && /high|critical|elevated/.test(scanRisk);

    if (asksRisk) {
        if (hasHighRiskEvent || scanIsElevated || priceChange < -10) {
            return [
                `Short take: yes, ${token?.ticker || token?.name || 'this token'} currently looks risk-elevated from the available Atlaix data.`,
                `Why: ${recentEvents[0]?.eventType ? `the leading Detection signal is ${recentEvents[0].eventType} (${recentEvents[0].severity || 'Medium'})` : 'the token context is not clean'}${priceChange < -10 ? `, and it is down ${safeAssistantText(token?.h24)} over 24h` : ''}.`,
                'Plain English: this is a caution setup. I would not treat it as clean until the chart, liquidity, and holder/supply context improve.'
            ];
        }

        return [
            `Short take: I do not see a major risk flag for ${token?.ticker || token?.name || 'this token'} from the available Atlaix data, but the evidence is not complete.`,
            recentEvents.length ? `Why: Detection context is ${recentEvents.map((event: any) => `${event.eventType} (${event.severity})`).join(', ')}.` : 'Why: I do not see a token-specific Detection event in the current feed.',
            'Plain English: not an automatic red flag, but still verify chart and holder context before trusting it.'
        ];
    }

    if (hasHighRiskEvent || scanIsElevated) {
        return [
            `Short take: I would not call ${token?.ticker || token?.name || 'this token'} cleanly bullish from the available Atlaix data.`,
            `Why: ${priceChange > 0 ? `it is up ${safeAssistantText(token?.h24)} over 24h, but ` : ''}${recentEvents[0]?.eventType ? `the strongest current signal is ${recentEvents[0].eventType} (${recentEvents[0].severity || 'Medium'})` : 'the detection context is not clean'}, and liquidity/volume conditions need caution.`,
            'Plain English: it may still move, but this is not a comfortable green-light setup. I would want chart confirmation, holder risk, and liquidity stability before trusting the bullish case.'
        ];
    }

    if (priceChange > 0 && hasConstructiveEvent && liquidity.liquidityUsd >= 250_000) {
        return [
            `Short take: ${token?.ticker || token?.name || 'this token'} has a constructive read, but I would still treat it as watchlist-bullish rather than blindly bullish.`,
            `Why: price is up ${safeAssistantText(token?.h24)}, liquidity is ${safeAssistantText(token?.liquidity, '$0')}, and Detection has ${recentEvents[0]?.eventType || 'constructive'} context.`,
            'Plain English: there is something to watch, but confirmation still matters.'
        ];
    }

    return [
        `Short take: I do not have enough clean evidence to be strongly bullish or bearish on ${token?.ticker || token?.name || 'this token'}.`,
        eventText ? `Why: the current Detection context is ${recentEvents.map((event: any) => `${event.eventType} (${event.severity})`).join(', ')}.` : 'Why: I do not see enough token-specific Detection context yet.',
        'Plain English: interesting, but not decisive.'
    ];
};

const formatAssistantTokenCandidate = (token: any, index: number) => {
    const chain = normalizeAssistantChainLabel(token?.chain);
    const address = token?.address ? ` Address: ${token.address}.` : '';
    return `${index + 1}. ${token?.name || 'Unknown Token'} (${token?.ticker || 'TOKEN'}) on ${chain}. Liquidity ${safeAssistantText(token?.liquidity, '$0')}, volume ${safeAssistantText(token?.volume24h, '$0')}, market cap ${safeAssistantText(token?.cap, '$0')}.${address}`;
};

const buildTokenDeepBrief = async (query: string, chain: string, message: string, history: AssistantConversationMessage[] = []) => {
    const resolution = await resolveAssistantEntity(query, chain, 'token');
    if (resolution.kind !== 'token') {
        const candidates = Array.isArray(resolution.candidates) ? resolution.candidates.slice(0, 5) : [];
        if (candidates.length) {
            return {
                answer: [
                    `I found more than one possible match for "${query}", so I do not want to guess wrong.`,
                    '',
                    'Best matches:',
                    ...candidates.map(formatAssistantTokenCandidate),
                    '',
                    'Send the contract address, chain, or the exact option you mean and I will open the full brief.'
                ].join('\n'),
                tool: 'get_token_deep_brief',
                data: { resolution, candidates },
                actions: [
                    { label: 'Open Detection Engine', href: '/detection', kind: 'navigate' },
                    { label: 'Open Safe Scan', href: '/safe-scan', kind: 'navigate' }
                ]
            };
        }

        return {
            answer: [
                `I could not find a clean token match for "${query}" in the data I can reach right now.`,
                resolution.reason || 'Send me the contract address, ticker, or exact token name and I will try again.'
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
    const stanceLines = isAssistantStanceQuestion(message)
        ? buildAssistantTokenStance(message, token, liquidity, recentEvents, safeScan, safeError)
        : [];
    const answer = [
        ...stanceLines,
        stanceLines.length ? '' : '',
        `Atlaix Brief: ${tokenLabel}`,
        '',
        'Here is what I am seeing',
        `${tokenLabel} is on ${normalizeAssistantChainLabel(tokenChain)} at ${formatAssistantPrice(token?.price)}. 24h move: ${safeAssistantText(token?.h24)}. Volume: ${safeAssistantText(token?.volume24h, '$0')}. Liquidity: ${safeAssistantText(token?.liquidity, '$0')}. Market cap: ${safeAssistantText(token?.cap, '$0')}.`,
        '',
        'Liquidity and market quality',
        ...liquidity.notes,
        '',
        'Recent activity',
        recentEvents.length
            ? recentEvents.map((event: any, index: number) => `${index + 1}. ${formatAssistantDetectionLine(event)}`).join('\n')
            : 'I do not see a matching Detection Engine event stored for this token yet.',
        recentActivities.length
            ? recentActivities.map((activity: any, index: number) => `${index + 1}. ${activity.title}: ${activity.description} (${compactUsd(activity.usdValue)}).`).join('\n')
            : 'I do not see stored whale or impact activity for this token yet.',
        '',
        'Risk picture',
        safeError
            ? `I could not pull Safe Scan context right now: ${safeError}`
            : safeScan
                ? `Risk level: ${(safeScan as any).riskLevel} with ${(safeScan as any).confidence} confidence. Coordinated supply estimate: ${Number((safeScan as any).coordinatedSupplyPct || 0).toFixed(2)}%. Top 10 holders: ${Number((safeScan as any).top10Pct || 0).toFixed(2)}%.`
                : 'Safe Scan context is not available for this token yet.',
        riskReasons.length ? `Main risk reasons: ${riskReasons.join(' ')}` : '',
        '',
        interpretation,
        `Confidence: ${confidence}. Based on ${confidenceBits.length ? confidenceBits.join(', ') : 'limited accessible app data'}.`,
        '',
        'What I would do next',
        'Open the token page for chart context, run Safe Scan for holder and supply risk, and set an alert if you want me to help keep an eye on liquidity, price, or whale movement.'
    ].filter((line) => line !== '').join('\n');

    const params = new URLSearchParams({ address: tokenAddress, chain: tokenChain });
    const safeScanChain = toAlchemyAssistantChain(tokenChain, tokenAddress);
    const responseData = {
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
    };
    const groundedAnswer = await generateAssistantGroundedAnswer({
        message,
        history,
        tool: 'get_token_deep_brief',
        data: responseData,
        draftAnswer: answer
    }).catch((error) => {
        console.warn('[AiAssistant] grounded token brief unavailable; using fallback draft', error instanceof Error ? error.message : error);
        return null;
    });

    return {
        answer: groundedAnswer || answer,
        tool: 'get_token_deep_brief',
        data: responseData,
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
            answer: 'I can take a look at that wallet. Send me a valid EVM or Solana wallet address first.',
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
            'Here is what I am seeing',
            `Tracked value: ${portfolio.netWorth || '$0'} across ${activePositions} active position${activePositions === 1 ? '' : 's'} on ${portfolioChain}.`,
            matchedSmartWallet
                ? `Smart Money status: tracked as ${Array.isArray(matchedSmartWallet.categories) ? matchedSmartWallet.categories.join(', ') : 'Smart Money'}.`
                : 'Smart Money status: I do not see it in the global smart-money wallet set yet.',
            '',
            'Top holdings',
            topAssets.length
                ? topAssets.map((asset: any, index: number) => `${index + 1}. ${asset.symbol || 'TOKEN'}: ${asset.value || '$0'} (${asset.balance || '0'} tokens).`).join('\n')
                : 'The accessible portfolio providers did not return priced holdings for this wallet yet.',
            '',
            'Behavior read',
            `${profitableAssets} position${profitableAssets === 1 ? '' : 's'} currently show positive PnL where PnL is available. Recent activity data is ${portfolio.recentActivity?.length ? 'available' : 'not currently populated'} in this wallet view.`,
            '',
            'What I would do next',
            'Open the wallet profile, track it if it matters to you, or inspect the top positions one by one for liquidity and risk.'
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
            answer: `I found the wallet address, but the portfolio providers could not give me a clean wallet brief right now. ${error instanceof Error ? error.message : ''}`.trim(),
            tool: 'get_wallet_deep_brief',
            data: { resolution },
            actions: [{ label: 'Open Wallet Tracker', href: `/wallet/${encodeURIComponent(resolution.address)}?chain=${encodeURIComponent(portfolioChain)}`, kind: 'navigate' }]
        };
    }
};

const buildPlatformUpdateBrief = async () => {
    const [events, smartStatus, marketResponse] = await Promise.all([
        getDetectionFeedForAssistant(),
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
            'What I would do next',
            'Start with the high-severity Detection Engine events, then set alerts for tokens where liquidity or whale movement matters.'
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
    const events = await getDetectionFeedForAssistant();
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
    'You are the Atlaix in-app AI assistant router. Be calm, friendly, and helpful while choosing the right tool.',
    'Choose exactly one approved tool for the user request. Do this quietly and do not expose routing logic to the user.',
    'You cannot modify source code, change app architecture, access secrets, run shell commands, or invent app data.',
    'Write actions must be confirmation-first. For alerts, choose prepare_alert_setup, not a direct save.',
    'Return only valid JSON with keys: tool, address, chain, query, responseStyle, eventType, severity, scoreMin, timeWindow, alertMode.',
    'Approved tools: conversation, get_token_deep_brief, get_wallet_deep_brief, get_platform_updates, get_detection_updates, get_detection_filtered, explain_detection_admission, run_safe_scan, prepare_alert_setup, prepare_detection_alert, prepare_linked_alert, get_token_activity, open_token_details, compare_tokens, get_token_holders, watch_token_activity, get_token_overview, get_smart_alert_status.',
    'If the request includes a cashtag like $PENGU, ticker, token name, or token address, treat it as a token request unless the user clearly asks about the whole platform.',
    'Separate the entity from the intent. For "what is the market cap of kishu?", query must be "kishu", not "kishu market cap". For "how much is KISHU worth?", query must be "KISHU".',
    'Use get_token_deep_brief for broad token questions, token addresses, performance, liquidity, recent events, deep analysis, or "tell me everything" requests.',
    'Use get_wallet_deep_brief for wallet analysis, holdings, portfolio, PnL, smart-money, or wallet behavior questions.',
    'Use get_platform_updates for broad Atlaix updates, today updates, market summaries, or "what should I pay attention to" requests.',
    'Use get_token_overview for current price, token details, market cap, liquidity, volume, or overview questions.',
    'Use run_safe_scan only when the user asks for scan, safety, risk, security, or forensic analysis.',
    'Use get_detection_updates for Detection Engine, new updates, admitted tokens, market events, or alpha events.',
    'Use get_detection_filtered for filtered Detection Engine requests by event type, severity, chain, score, or time window.',
    'Use explain_detection_admission when the user asks why a token qualified, was admitted, or received a detection score.',
    'Use prepare_alert_setup for alerts, notifications, watching a token, or thresholds.',
    'Use prepare_detection_alert for alerts about detection event types, score, severity, accumulation, distribution, or risk events.',
    'Use prepare_linked_alert when the user asks for an alert requiring multiple conditions at once.',
    'Use get_token_activity for whale buys, whale sells, wallet movements, token impact timeline, or activity.',
    'Use open_token_details when the user wants to open, view, or navigate to a token page.',
    'Use compare_tokens when the user asks to compare two or more tokens.',
    'Use get_token_holders for holder distribution, top holders, holder concentration, or ownership questions.',
    'Use watch_token_activity when the user asks to monitor or watch a token activity feed.',
    'Use get_smart_alert_status for existing alert runner/status questions.',
    'Use conversation for casual chat, capability questions, or unclear requests.',
    'Examples:',
    '{"tool":"get_token_deep_brief","query":"pengu","responseStyle":"detailed"} for "can you search for the token called pengu?"',
    '{"tool":"get_token_deep_brief","query":"PENGU","responseStyle":"detailed"} for "how is $PENGU performing today?"',
    '{"tool":"get_token_overview","query":"kishu","responseStyle":"brief"} for "what is the market cap of kishu?"',
    '{"tool":"get_token_overview","query":"KISHU","responseStyle":"brief"} for "how much is KISHU worth?"',
    '{"tool":"run_safe_scan","address":"0x...","responseStyle":"detailed"} for "scan this token for risk 0x..."',
    '{"tool":"get_detection_updates","responseStyle":"brief"} for "what should I pay attention to today?"'
].join('\n');

const buildAssistantChatPrompt = () => [
    'You are Atlaix AI, a friendly, sharp, conversational assistant inside the Atlaix crypto intelligence platform.',
    'Sound like a helpful teammate, not a compliance notice or command menu. Be relaxed, plain-spoken, and lightly conversational.',
    'Answer normal questions directly first. If the user is casual, be warm and easygoing. If they are operational, stay concise but still human.',
    'When data is missing, say it gently and offer the most useful next step instead of sounding like a hard error.',
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
            'unsupported_capability',
            'get_token_deep_brief',
            'get_wallet_deep_brief',
            'get_platform_updates',
            'get_detection_updates',
            'get_detection_filtered',
            'explain_detection_admission',
            'run_safe_scan',
            'prepare_alert_setup',
            'prepare_detection_alert',
            'prepare_linked_alert',
            'get_token_activity',
            'open_token_details',
            'compare_tokens',
            'get_token_holders',
            'watch_token_activity',
            'get_token_overview',
            'get_smart_alert_status'
        ]);
        if (!allowed.has(parsed.tool)) return null;
        return {
            tool: parsed.tool,
            address: typeof parsed.address === 'string' ? parsed.address : undefined,
            chain: typeof parsed.chain === 'string' ? parsed.chain : undefined,
            query: typeof parsed.query === 'string' ? sanitizeAssistantTokenLookupQuery(parsed.query) || parsed.query : undefined,
            responseStyle: parsed.responseStyle === 'detailed' ? 'detailed' : 'brief',
            eventType: typeof parsed.eventType === 'string' ? parsed.eventType : undefined,
            severity: typeof parsed.severity === 'string' ? parsed.severity : undefined,
            scoreMin: Number.isFinite(Number(parsed.scoreMin)) && Number(parsed.scoreMin) > 0 ? Number(parsed.scoreMin) : undefined,
            timeWindow: typeof parsed.timeWindow === 'string' ? parsed.timeWindow : undefined,
            alertMode: typeof parsed.alertMode === 'string' ? parsed.alertMode : undefined
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
    if (isUnsupportedAssistantCapabilityRequest(message)) {
        return { tool: 'unsupported_capability' };
    }

    const lower = message.toLowerCase();
    const address = extractAssistantAddress(message) || (/\b(that|this)\s+token\b/i.test(message) ? getRecentAssistantAddress(history) : '');
    const tokenQuery = extractAssistantTokenQuery(message, history);
    const hasExplicitTokenQuery = hasExplicitAssistantTokenQuery(message);
    const hasTokenSpecificIntent = /\b(search|find|lookup|look up|called|named|performing|performance|moving|move|doing|price|market\s*cap|liquidity|volume|overview|details|deep|analysis|analy[sz]e|what happened|recent events?)\b/.test(lower);
    const hasTokenQuery = Boolean(address || hasExplicitTokenQuery || (tokenQuery && hasTokenSpecificIntent));
    const refersToPriorToken = /\b(this|that|it|its|the)\s+(?:token|coin|one|event|events|detection|detections|signal|signals|liquidity|price|volume|market\s*cap)\b/i.test(message)
        || /\b(it|this|that)\s+(?:risky|safe|bullish|bearish|good|bad|worth|strong|weak)\b/i.test(message)
        || /\b(explain|mean|means|plain english|break it down|what about)\b/i.test(message) && /\b(it|its|this|that)\b/i.test(message)
        || (isAssistantStanceQuestion(message) && /\b(it|this|that)\b/i.test(message));
    const contextTokenQuery = refersToPriorToken ? extractRecentAssistantTokenFromContext(history) : '';
    const effectiveTokenQuery = address || tokenQuery || contextTokenQuery;
    const hasDetectionEventQuestion = /\b(detected|detection|detections?|events?|signals?|admitted|qualified|score|severity)\b/.test(lower);

    if (/\b(compare|versus|vs\.?|against|which\s+(?:one|token|coin)\s+is\s+better)\b/.test(lower)) {
        return { tool: 'compare_tokens', query: message, responseStyle: 'detailed' };
    }

    if (isAssistantBroadDetectionQuery(message)) {
        const filters = extractAssistantDetectionFilters(message);
        return {
            tool: 'get_detection_filtered',
            responseStyle: 'detailed',
            eventType: filters.eventType,
            severity: filters.severity,
            scoreMin: filters.scoreMin,
            chain: filters.chain,
            timeWindow: filters.hours ? `${filters.hours}h` : undefined
        };
    }

    if (contextTokenQuery && /\b(price|market\s*cap|mcap|overview|details?)\b/.test(lower) && !/\b(liquidity|volume|thoughts?|bullish|bearish|risk|risky|explain|mean|plain english|break it down)\b/.test(lower)) {
        return {
            tool: 'get_token_overview',
            query: contextTokenQuery,
            responseStyle: 'detailed'
        };
    }

    if (contextTokenQuery && /\b(explain|mean|means|plain english|break it down|what does|why does|why is|what about)\b/.test(lower)) {
        return {
            tool: /\b(liquidity|price|volume|market\s*cap|thoughts?|bullish|bearish|risk|risky)\b/.test(lower)
                ? 'get_token_deep_brief'
                : 'get_detection_filtered',
            query: contextTokenQuery,
            responseStyle: 'detailed'
        };
    }

    if (/\b(why|how)\b/.test(lower) && /\b(qualified|qualifies|admitted|entered|score|scored|accepted|allowed into|detection)\b/.test(lower)) {
        return {
            tool: 'explain_detection_admission',
            address,
            query: effectiveTokenQuery,
            chain: address ? inferAssistantChain(message, address) : undefined,
            responseStyle: 'detailed'
        };
    }

    if (hasDetectionEventQuestion && effectiveTokenQuery && !isAssistantBroadDetectionQuery(message) && !/\b(most recent|latest|updates?|whole platform|all tokens|all events|overall)\b/.test(lower)) {
        const filters = extractAssistantDetectionFilters(message);
        return {
            tool: 'get_detection_filtered',
            address,
            query: effectiveTokenQuery,
            responseStyle: 'detailed',
            eventType: filters.eventType,
            severity: filters.severity,
            scoreMin: filters.scoreMin,
            chain: address ? inferAssistantChain(message, address) : filters.chain,
            timeWindow: filters.hours ? `${filters.hours}h` : undefined
        };
    }

    if (contextTokenQuery && isAssistantStanceQuestion(message)) {
        return {
            tool: 'get_token_deep_brief',
            query: contextTokenQuery,
            responseStyle: 'detailed'
        };
    }

    if (contextTokenQuery && /\b(risk|risky|safe|danger|bullish|bearish|liquidity|volume)\b/.test(lower)) {
        return {
            tool: 'get_token_deep_brief',
            query: contextTokenQuery,
            responseStyle: 'detailed'
        };
    }

    if (contextTokenQuery && /\b(what does|mean|means|implication|interpret|explain|risk|concern|should i|is this|for the token)\b/.test(lower)) {
        return {
            tool: 'get_detection_filtered',
            query: contextTokenQuery,
            responseStyle: 'detailed'
        };
    }

    if (/\b(holders?|holder distribution|top holders?|ownership|concentration|supply distribution)\b/.test(lower)) {
        return {
            tool: 'get_token_holders',
            address,
            query: effectiveTokenQuery,
            chain: address ? inferAssistantChain(message, address) : undefined,
            responseStyle: 'detailed'
        };
    }

    if (/\b(open|go to|take me to|show me|view)\b/.test(lower) && /\b(token details|token page|details page|chart page)\b/.test(lower)) {
        return {
            tool: 'open_token_details',
            address,
            query: effectiveTokenQuery,
            chain: address ? inferAssistantChain(message, address) : undefined
        };
    }

    if (/\b(alert|notify|notification)\b/.test(lower) && /\b(and|plus|both|linked|combined|together)\b/.test(lower)) {
        return {
            tool: 'prepare_linked_alert',
            address,
            query: effectiveTokenQuery,
            chain: address ? inferAssistantChain(message, address) : undefined,
            alertMode: 'linked'
        };
    }

    if (/\b(alert|notify|notification)\b/.test(lower) && /\b(detection|accumulat\w*|distribut\w*|severity|score|risk|market stress|recovery|liquidity event)\b/.test(lower)) {
        const filters = extractAssistantDetectionFilters(message);
        return {
            tool: 'prepare_detection_alert',
            address,
            query: effectiveTokenQuery,
            chain: address ? inferAssistantChain(message, address) : filters.chain,
            eventType: filters.eventType,
            severity: filters.severity,
            scoreMin: filters.scoreMin
        };
    }

    if (/\b(watch|monitor|keep an eye on|track)\b/.test(lower) && /\b(activity|whale|buys?|sells?|movement|token)\b/.test(lower)) {
        return {
            tool: 'watch_token_activity',
            address,
            query: effectiveTokenQuery,
            chain: address ? inferAssistantChain(message, address) : undefined,
            responseStyle: 'detailed'
        };
    }

    if (/\b(wallet|holdings|portfolio|pnl|win rate|smart money wallet|track this wallet|analy[sz]e this wallet)\b/.test(lower)) {
        return {
            tool: 'get_wallet_deep_brief',
            address,
            chain: address ? inferAssistantChain(message, address) : undefined,
            query: address || tokenQuery
        };
    }

    if (!hasExplicitTokenQuery && /\b(tokens?|coins?)\b/.test(lower) && /\b(accumulat\w*|buy pressure|buyer|net inflow)\b/.test(lower)) {
        return { tool: 'get_detection_updates', responseStyle: 'detailed', eventIntent: 'accumulation' };
    }

    if (!hasExplicitTokenQuery && /\b(tokens?|coins?)\b/.test(lower) && /\b(performing well|best performing|strong performers|gainers|doing well)\b/.test(lower)) {
        return { tool: 'get_detection_updates', responseStyle: 'detailed', eventIntent: 'performance' };
    }

    if (!hasExplicitTokenQuery && /\b(tokens?|coins?)\b/.test(lower) && /\b(moving|move|active|unusual activity)\b/.test(lower)) {
        return { tool: 'get_detection_updates', responseStyle: 'detailed', eventIntent: 'moving' };
    }

    if (!hasExplicitTokenQuery && /\b(tokens?|coins?|events?|detections?|admitted)\b/.test(lower) && /\b(high|medium|low|score|confidence|above|over|last hour|past hour|today|24h|solana|base|bsc|bnb|ethereum|accumulat\w*|distribut\w*|market stress|recovery|liquidity|volume spike|unusual)\b/.test(lower)) {
        const filters = extractAssistantDetectionFilters(message);
        return {
            tool: 'get_detection_filtered',
            responseStyle: 'detailed',
            eventType: filters.eventType,
            severity: filters.severity,
            scoreMin: filters.scoreMin,
            chain: filters.chain,
            timeWindow: filters.hours ? `${filters.hours}h` : undefined
        };
    }

    if (hasTokenQuery && hasTokenSpecificIntent) {
        return {
            tool: /\b(price|overview|details)\b/.test(lower) && !/\b(performing|performance|moving|move|doing|today|deep|analysis|analy[sz]e|what happened|recent events?)\b/.test(lower) ? 'get_token_overview' : 'get_token_deep_brief',
            address,
            query: effectiveTokenQuery,
            chain: address ? inferAssistantChain(message, address) : undefined,
            responseStyle: 'detailed'
        };
    }

    if (/\b(today'?s?|daily|platform|overall|what changed|what should i pay attention|market update|comprehensive updates?|update brief)\b/.test(lower) && !hasTokenQuery) {
        return { tool: 'get_platform_updates' };
    }

    if (/\bsafe scan\b|\bscan\b|\brisk\b|\bsecurity\b|\bforensic\b|\bscam\b|\brug\b|\bhoneypot\b|\baudit\b|\bsketchy\b/.test(lower)) {
        return { tool: 'run_safe_scan', address, chain: address ? inferAssistantChain(message, address) : undefined };
    }

    if (/\bactivity\b|\bwhale\b|\bbuy\b|\bsell\b|\bwallet movement\b|\btimeline\b/.test(lower)) {
        return { tool: 'get_token_activity', address, chain: address ? inferAssistantChain(message, address) : undefined };
    }

    if (/\balert\b|\bnotify\b|\bwatch\b/.test(lower)) {
        return { tool: 'prepare_alert_setup', address, query: tokenQuery, chain: address ? inferAssistantChain(message, address) : undefined };
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
            query: effectiveTokenQuery,
            chain: address ? inferAssistantChain(message, address) : undefined,
            responseStyle: 'detailed'
        };
    }

    if (/\bprice\b|\bmarket\s*cap\b|\bliquidity\b|\bvolume\b|\boverview\b|\btoken details\b|\bdetails\b/.test(lower)) {
        return {
            tool: /\b(price|market\s*cap|mcap|overview|details?)\b/.test(lower) && !/\b(liquidity|volume)\b/.test(lower)
                ? 'get_token_overview'
                : 'get_token_deep_brief',
            address,
            query: effectiveTokenQuery,
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

    if (/\bdetection\b|\bupdate\b|\bnew\b|\bengine\b|\balpha\b|\bhidden\b|\brecent events?\b/.test(lower)) {
        return {
            tool: 'get_detection_updates',
            responseStyle: /\b(explain|further|beginner|simple|plain|hidden|all)\b/.test(lower) ? 'detailed' : 'brief'
        };
    }

    if (/\b(explain further|explain more|what does that mean|break it down|beginner|simple terms|plain english)\b/.test(lower)) {
        const recentAssistantText = history.slice(-4).map((item) => item.text || '').join(' ').toLowerCase();
        if (recentAssistantText.includes('detection engine') || recentAssistantText.includes('detection_updates')) {
            return { tool: 'get_detection_updates', responseStyle: 'detailed' };
        }
    }

    if (/\balert status\b|\bsmart alert status\b|\brunner\b/.test(lower)) {
        return { tool: 'get_smart_alert_status' };
    }

    return { tool: 'conversation' };
};

const chooseAssistantTool = async (message: string, history: AssistantConversationMessage[] = []) => {
    const localChoice = chooseAssistantToolLocally(message, history);
    if (localChoice.tool === 'unsupported_capability') return localChoice;

    const explicitTokenQuery = extractAssistantAddress(message) || message.match(/\$([a-zA-Z][a-zA-Z0-9]{1,15})\b/)?.[1] || (hasExplicitAssistantTokenQuery(message) ? extractAssistantTokenQuery(message, []) : '');
    if (localChoice.eventIntent && !explicitTokenQuery) return localChoice;
    if (localChoice.query && /\b(it|its|this|that|what about|plain english|break it down)\b/i.test(message)) {
        return localChoice;
    }
    if (localChoice.tool === 'get_token_deep_brief' && localChoice.query && isAssistantStanceQuestion(message)) {
        return localChoice;
    }
    if ([
        'get_detection_filtered',
        'explain_detection_admission',
        'prepare_detection_alert',
        'prepare_linked_alert',
        'open_token_details',
        'compare_tokens',
        'get_token_holders',
        'watch_token_activity'
    ].includes(localChoice.tool)) return localChoice;

    try {
        const modelChoice = await chooseAssistantToolWithModel(message, history);
        if (modelChoice) {
            const localExplicitQuery = String(localChoice.query || localChoice.address || explicitTokenQuery || '').toLowerCase();
            const modelExplicitQuery = String(modelChoice.query || modelChoice.address || '').replace(/^\$/, '').toLowerCase();
            const modelChoseTokenTool = modelChoice.tool === 'get_token_deep_brief' || modelChoice.tool === 'get_token_overview' || modelChoice.tool === 'get_token_activity';
            if (localChoice.eventIntent && (modelChoice.tool === 'conversation' || modelChoice.tool === 'get_detection_updates' || modelChoice.tool === 'get_platform_updates')) {
                return localChoice;
            }
            const modelUsedDifferentExplicitToken =
                Boolean(explicitTokenQuery) &&
                Boolean(localExplicitQuery) &&
                Boolean(modelExplicitQuery) &&
                modelExplicitQuery !== localExplicitQuery &&
                !modelExplicitQuery.includes(localExplicitQuery);
            const modelMissedExplicitToken =
                Boolean(explicitTokenQuery) &&
                localChoice.tool !== 'conversation' &&
                (modelChoice.tool === 'conversation' || modelChoice.tool === 'get_platform_updates' || modelChoice.tool === 'get_detection_updates');
            const modelOverrodeLocalTokenContext =
                modelChoseTokenTool &&
                Boolean(localExplicitQuery) &&
                Boolean(modelExplicitQuery) &&
                modelExplicitQuery !== localExplicitQuery &&
                (
                    (!modelExplicitQuery.includes(localExplicitQuery) && !localExplicitQuery.includes(modelExplicitQuery)) ||
                    (modelExplicitQuery.includes(localExplicitQuery) && modelExplicitQuery.length > localExplicitQuery.length + 12)
                );

            if (modelMissedExplicitToken || modelUsedDifferentExplicitToken || modelOverrodeLocalTokenContext) {
                return localChoice;
            }

            if (explicitTokenQuery && modelChoseTokenTool) {
                if (localChoice.tool === 'get_token_deep_brief' && (modelChoice.tool === 'get_token_overview' || modelChoice.tool === 'get_token_activity')) {
                    return localChoice;
                }

                const explicitIsAddress = isLikelyEvmAddress(explicitTokenQuery) || isLikelySolanaAddress(explicitTokenQuery);
                return {
                    ...modelChoice,
                    address: explicitIsAddress ? explicitTokenQuery : undefined,
                    query: explicitTokenQuery,
                    chain: explicitIsAddress ? (modelChoice.chain || localChoice.chain) : modelChoice.chain
                };
            }

            if (!modelChoice.query && !modelChoice.address && (localChoice.query || localChoice.address)) {
                return {
                    ...modelChoice,
                    address: localChoice.address,
                    query: localChoice.query,
                    chain: modelChoice.chain || localChoice.chain
                };
            }

            return modelChoice;
        }
    } catch (error) {
        console.warn('[AiAssistant] model router unavailable; using local router fallback', error instanceof Error ? error.message : error);
    }

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

const generateAssistantGroundedAnswer = async ({
    message,
    history,
    tool,
    data,
    draftAnswer
}: {
    message: string;
    history: AssistantConversationMessage[];
    tool: string;
    data: unknown;
    draftAnswer: string;
}) => {
    const apiKey = readEnv('OPENROUTER_API_KEY');
    const model = readEnv('OPENROUTER_MODEL');
    if (!apiKey || !model) return null;

    const baseUrl = readEnv('OPENROUTER_BASE_URL') || 'https://openrouter.ai/api/v1';
    const recentMessages = history.slice(-8).map((item) => ({
        role: item.role === 'assistant' ? 'assistant' : 'user',
        content: String(item.text || '').slice(0, 1200)
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
            temperature: 0.35,
            messages: [
                {
                    role: 'system',
                    content: [
                        'You are Atlaix AI. Answer like a sharp crypto intelligence analyst using only the provided Atlaix data.',
                        'First understand the user question. If they ask for one metric, answer that metric directly in the first sentence.',
                        'If they ask for a take, give the take first, then the evidence.',
                        'Do not sound like a template. Do not list every field unless the user asked for a full brief.',
                        'Preserve exact numbers from the data. Do not invent facts, prices, safety claims, or trading advice.',
                        'Keep answers concise by default: 2-5 short paragraphs or a compact list only when useful.',
                        'Use plain text, no markdown tables, no emojis.'
                    ].join('\n')
                },
                ...recentMessages,
                {
                    role: 'user',
                    content: [
                        `Current user question: ${message}`,
                        `Selected Atlaix tool: ${tool}`,
                        `Structured Atlaix data:\n${JSON.stringify(data, null, 2).slice(0, 9000)}`,
                        `Fallback draft answer:\n${draftAnswer.slice(0, 4000)}`,
                        'Write the best user-facing answer now.'
                    ].join('\n\n')
                }
            ]
        })
    }, 18_000);

    if (!response.ok) {
        throw new Error(`OpenRouter grounded answer failed with ${response.status}.`);
    }

    const payload = await response.json();
    const content = payload?.choices?.[0]?.message?.content;
    return typeof content === 'string' && content.trim() ? normalizeAssistantText(content.trim()) : null;
};

const buildLocalConversationResponse = (message: string) => {
    const lower = message.toLowerCase();
    if (/\b(bit\s*coin|bitcoin|btc|coin|token)\b/.test(lower) && /\b(up|rise|pump|going|today|price|green|bull|bullish|bear|bearish|drop|down)\b/.test(lower)) {
        return [
            'I can help think through it, but I would not call a 10% move from vibes alone.',
            'For a real read, I need live context: current price action, liquidity, volume, recent detection signals, and any whale movement. If you mean BTC, ask me for a BTC overview or give me the exact token/contract and I will pull the Atlaix data I can reach.'
        ].join('\n');
    }

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

const getAssistantRequestTokenQuery = (
    request: AssistantToolRequest,
    message: string,
    history: AssistantConversationMessage[],
    fallbackAddress = ''
) => sanitizeAssistantTokenLookupQuery(request.query || fallbackAddress || extractAssistantTokenQuery(message, history));

const buildAssistantResponse = async (message: string, history: AssistantConversationMessage[] = []) => {
    const request = await chooseAssistantTool(message, history);
    const explicitAddress = request.address || extractAssistantAddress(message);
    const address = explicitAddress || getRecentAssistantAddress(history);
    const chain = request.chain || (explicitAddress ? inferAssistantChain(message, explicitAddress) : '');
    const actions: AssistantChatAction[] = [];

    if (request.tool === 'unsupported_capability') {
        return buildUnsupportedCapabilityResponse();
    }

    if (request.tool === 'get_token_deep_brief') {
        const tokenQuery = getAssistantRequestTokenQuery(request, message, history, address);
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

    if (request.tool === 'open_token_details') {
        const tokenQuery = getAssistantRequestTokenQuery(request, message, history, address);
        if (!tokenQuery) {
            return {
                answer: 'I can open a token details page, but I need the token address, ticker, or name first.',
                tool: 'open_token_details_needs_query',
                actions: [{ label: 'Open Overview', href: '/dashboard', kind: 'navigate' }]
            };
        }

        const resolution = await resolveAssistantEntity(tokenQuery, chain, 'token');
        if (resolution.kind !== 'token' || !resolution.token) {
            const candidates = Array.isArray(resolution.candidates) ? resolution.candidates.slice(0, 5) : [];
            return {
                answer: candidates.length
                    ? [
                        `I found a few possible matches for "${tokenQuery}". Pick the exact token so I do not open the wrong page.`,
                        '',
                        ...candidates.map(formatAssistantTokenCandidate)
                    ].join('\n')
                    : `I could not find a token details page for "${tokenQuery}" yet. Try the contract address or exact ticker.`,
                tool: 'open_token_details',
                data: {
                    candidates: candidates.map((token: any) => ({
                        token: token?.ticker || token?.name,
                        href: tokenDetailsHref(token)
                    }))
                },
                actions: [{ label: 'Open Overview', href: '/dashboard', kind: 'navigate' }]
            };
        }

        const href = tokenDetailsHref(resolution.token, resolution.chain);
        return {
            answer: `I found ${resolution.token.name || resolution.token.ticker}. Use the token details link to inspect the chart, holders, Detection context, and quick actions.`,
            tool: 'open_token_details',
            data: { token: { ...resolution.token, href } },
            actions: [{ label: 'Open Token Details', href, kind: 'navigate' }]
        };
    }

    if (request.tool === 'compare_tokens') {
        const targets = extractAssistantCompareTargets(request.query || message, history);
        if (targets.length < 2) {
            return {
                answer: 'I can compare tokens, but I need at least two tickers, names, or addresses. For example: compare $SOL and $ETH.',
                tool: 'compare_tokens_needs_targets',
                actions: [{ label: 'Open Overview', href: '/dashboard', kind: 'navigate' }]
            };
        }

        const resolved = await Promise.all(targets.slice(0, 4).map(async (target) => ({
            target,
            resolution: await resolveAssistantEntity(target, chain, 'token')
        })));
        const tokens = resolved
            .map(({ target, resolution }) => ({ target, token: resolution.token, resolution }))
            .filter((item) => item.resolution.kind === 'token' && item.token);

        if (tokens.length < 2) {
            return {
                answer: [
                    'I could not resolve enough tokens to compare safely.',
                    ...resolved.map(({ target, resolution }) => `${target}: ${resolution.reason || resolution.kind}`)
                ].join('\n'),
                tool: 'compare_tokens',
                actions: [{ label: 'Open Detection Engine', href: '/detection', kind: 'navigate' }]
            };
        }

        const lines = tokens.map(({ token }, index) => {
            const liquidity = parseAssistantMarketNumber(token?.liquidity);
            const volume = parseAssistantMarketNumber(token?.volume24h);
            const cap = parseAssistantMarketNumber(token?.cap);
            const volumeToLiquidity = liquidity > 0 ? `${(volume / liquidity).toFixed(2)}x liquidity` : 'volume/liquidity unavailable';
            return `${index + 1}. ${token?.ticker || token?.name}: 24h ${safeAssistantText(token?.h24)}, volume ${safeAssistantText(token?.volume24h, '$0')}, liquidity ${safeAssistantText(token?.liquidity, '$0')}, market cap ${safeAssistantText(token?.cap, '$0')}, ${volumeToLiquidity}${cap > 0 && liquidity > 0 ? `, liquidity/cap ${(liquidity / cap * 100).toFixed(2)}%` : ''}.`;
        });

        return {
            answer: [
                `I compared ${tokens.length} tokens using the latest Atlaix market snapshot I can reach:`,
                '',
                ...lines,
                '',
                'For a decision, I would weigh liquidity depth and volume quality before chasing the largest 24h move.'
            ].join('\n'),
            tool: 'compare_tokens',
            data: {
                tokens: tokens.map(({ token }) => ({
                    token: token?.ticker || token?.name,
                    name: token?.name,
                    chain: token?.chain,
                    href: tokenDetailsHref(token)
                }))
            },
            actions: tokens.map(({ token }) => ({
                label: `Open ${token?.ticker || token?.name}`,
                href: tokenDetailsHref(token),
                kind: 'navigate' as const
            }))
        };
    }

    if (request.tool === 'get_token_holders') {
        const tokenQuery = getAssistantRequestTokenQuery(request, message, history, address);
        if (!tokenQuery) {
            return {
                answer: 'I can take you to holder distribution, but I need the token address, ticker, or name first.',
                tool: 'token_holders_needs_query',
                actions: [{ label: 'Open Detection Engine', href: '/detection', kind: 'navigate' }]
            };
        }

        const resolution = await resolveAssistantEntity(tokenQuery, chain, 'token');
        if (resolution.kind !== 'token' || !resolution.token) {
            return {
                answer: `I could not resolve "${tokenQuery}" to a single token. Send the contract address or exact chain and I will open the holder view.`,
                tool: 'get_token_holders',
                actions: [{ label: 'Open Overview', href: '/dashboard', kind: 'navigate' }]
            };
        }

        const href = `${tokenDetailsHref(resolution.token, resolution.chain)}${tokenDetailsHref(resolution.token, resolution.chain).includes('?') ? '&' : '?'}panel=holders`;
        return {
            answer: `I found ${resolution.token.name || resolution.token.ticker}. The holder distribution lives on the token details page, alongside top-holder concentration and supply context.`,
            tool: 'get_token_holders',
            data: { token: { ...resolution.token, href } },
            actions: [{ label: 'Open Holder Distribution', href, kind: 'navigate' }]
        };
    }

    if (request.tool === 'get_detection_filtered') {
        const allEvents = await getDetectionFeedForAssistant();
        const filters = extractAssistantDetectionFilters(message, request);
        const tokenQuery = sanitizeAssistantTokenLookupQuery(request.query || address || (/(\bthis\b|\bthat\b|\bit\b|\bthe token\b)/i.test(message) ? extractRecentAssistantTokenFromContext(history) : ''));
        const tokenEvents = tokenQuery
            ? await withAssistantTimeout(getAssistantDetectionContext(tokenQuery, chain || filters.chain), 6_000, [])
            : [];
        const sourceEvents = tokenQuery ? tokenEvents : allEvents;
        const matches = (sourceEvents || []).filter((event: any) => assistantDetectionEventMatchesFilters(event, filters));
        const visible = matches.slice(0, 10);
        const filterLabel = [
            tokenQuery ? `${tokenQuery}` : '',
            filters.eventType || '',
            filters.severity ? `${filters.severity} severity` : '',
            typeof filters.scoreMin === 'number' ? `score ${filters.scoreMin}+` : '',
            filters.chain ? normalizeAssistantChainLabel(filters.chain) : '',
            filters.hours ? `last ${filters.hours}h` : ''
        ].filter(Boolean).join(', ') || 'current Detection Engine filters';
        const primaryEvent = visible[0];
        const tokenActionHref = primaryEvent ? eventTokenHref(primaryEvent) : '/detection';

        return {
            answer: visible.length
                ? [
                    `I found ${matches.length} matching Detection Engine event${matches.length === 1 ? '' : 's'} for ${filterLabel}.`,
                    formatAssistantFreshnessLine(matches),
                    '',
                    ...visible.map((event: any, index: number) => `${index + 1}. ${formatAssistantDetectionDetailLine(event)} ${explainAssistantDetectionImplication(event)}`)
                ].join('\n')
                : tokenQuery
                    ? `I checked the current Detection Engine feed for "${tokenQuery}", but I do not see matching detected events for that token yet. Try the exact contract address or chain if there are multiple tokens with that name.`
                    : `I did not find matching Detection Engine events for ${filterLabel} in the current feed.`,
            tool: 'get_detection_filtered',
            data: {
                totalEvents: allEvents?.length || 0,
                tokenScopedEvents: tokenEvents.length,
                matchingEvents: matches.length,
                filters,
                query: tokenQuery,
                events: visible.map(assistantEventReference)
            },
            actions: [
                { label: primaryEvent ? 'Open Token Detection' : 'Open Detection Engine', href: tokenActionHref, kind: 'navigate' }
            ]
        };
    }

    if (request.tool === 'explain_detection_admission') {
        const tokenQuery = getAssistantRequestTokenQuery(request, message, history, address);
        if (!tokenQuery) {
            return {
                answer: 'I can explain why a token was admitted, but I need the token ticker, name, or address first.',
                tool: 'explain_detection_admission_needs_query',
                actions: [{ label: 'Open Detection Engine', href: '/detection', kind: 'navigate' }]
            };
        }

        const contextEvents = await getAssistantDetectionContext(tokenQuery, chain);
        const event = contextEvents[0];
        if (!event) {
            return {
                answer: `I could not find a stored Detection Engine admission for "${tokenQuery}" in the current feed. It may have aged out, failed quality gates, or need the exact contract/chain.`,
                tool: 'explain_detection_admission',
                actions: [{ label: 'Open Detection Engine', href: '/detection', kind: 'navigate' }]
            };
        }

        const token = event?.token || {};
        return {
            answer: [
                `${token.ticker || token.name || tokenQuery} was admitted because Atlaix classified it as ${event.eventType || 'a detection event'} with ${event.severity || 'Medium'} severity and score ${event.score || 0}.`,
                explainAssistantDetectionImplication(event),
                `Market context: 24h volume ${compactUsd(event?.metrics?.volume24h)}, liquidity ${compactUsd(event?.metrics?.liquidity)}, market cap ${compactUsd(event?.metrics?.marketCap)}.`,
                event.summary ? `Feed note: ${event.summary}` : '',
                'This is not a buy signal by itself; it is a quality-gated reason to inspect the token details, liquidity, holders, and follow-through.'
            ].filter(Boolean).join('\n'),
            tool: 'explain_detection_admission',
            data: { events: [assistantEventReference(event)] },
            actions: [
                { label: 'Open Detection View', href: eventTokenHref(event), kind: 'navigate' },
                { label: 'Open Token Details', href: tokenDetailsHref(token), kind: 'navigate' }
            ]
        };
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
                riskLevel: (report as any)?.bundleIntelligence?.riskLevel,
                confidence: (report as any)?.bundleIntelligence?.confidence
            },
            actions
        };
    }

    if (request.tool === 'get_detection_updates') {
        const events = await getDetectionFeedForAssistant();
        const allEvents = events || [];
        const detailed = request.responseStyle === 'detailed';
        const topEvents = allEvents.slice(0, detailed ? 12 : 7);
        actions.push({ label: 'Open Detection Engine', href: '/detection' });

        if (!topEvents.length) {
            return {
                answer: 'I checked the Detection Engine, but there are no current detection events available from the local feed.',
                tool: 'detection_updates',
                actions
            };
        }

        if (request.eventIntent) {
            return {
                answer: await buildAssistantEventIntentBrief(allEvents, request.eventIntent, detailed),
                tool: 'detection_updates',
                data: {
                    totalEvents: allEvents.length,
                    eventIntent: request.eventIntent,
                    events: filterAssistantEventsByIntent(allEvents, request.eventIntent).slice(0, detailed ? 8 : 5).map((event: any) => ({
                        token: event?.token?.ticker || event?.token?.name,
                        eventType: event?.eventType,
                        severity: event?.severity,
                        score: event?.score,
                        implication: explainAssistantDetectionImplication(event),
                        href: eventTokenHref(event)
                    }))
                },
                actions
            };
        }

        return {
            answer: buildAssistantDetectionBrief(allEvents, detailed),
            tool: 'detection_updates',
            data: {
                totalEvents: allEvents.length,
                events: topEvents.map((event: any) => ({
                    token: event?.token?.ticker || event?.token?.name,
                    eventType: event?.eventType,
                    severity: event?.severity,
                    score: event?.score,
                    implication: detailed ? explainAssistantDetectionImplication(event) : undefined,
                    href: eventTokenHref(event)
                }))
            },
            actions
        };
    }

    if (request.tool === 'get_token_activity') {
        let activityAddress = address;
        let activityChain = chain;
        const tokenQuery = getAssistantRequestTokenQuery(request, message, history);
        if (!activityAddress && tokenQuery) {
            const resolution = await resolveAssistantEntity(tokenQuery, chain, 'token');
            activityAddress = resolution.address || resolution.token?.address || '';
            activityChain = normalizeAssistantChainId(resolution.chain || resolution.token?.chain || chain);
            if (!activityAddress && resolution.candidates?.length) {
                return {
                    answer: [
                        `I found multiple possible matches for "${tokenQuery}", so I need the exact token before checking activity.`,
                        '',
                        'Best matches:',
                        ...resolution.candidates.slice(0, 5).map(formatAssistantTokenCandidate)
                    ].join('\n'),
                    tool: 'token_activity_needs_token_choice',
                    data: { resolution },
                    actions: [{ label: 'Open Detection Engine', href: '/detection' }]
                };
            }
        }

        if (!activityAddress) {
            return {
                answer: 'I can check token activity, but I need the token contract address first.',
                tool: 'token_activity_needs_address',
                actions: [{ label: 'Open Detection Engine', href: '/detection' }]
            };
        }

        const activities = await ImpactfulTokenActivityStore.getActivities(activityChain, activityAddress);
        actions.push({ label: 'Open Token Detection', href: `/detection/token/${encodeURIComponent(activityAddress)}` });

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
                chain: activityChain,
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

    if (request.tool === 'watch_token_activity') {
        const tokenQuery = getAssistantRequestTokenQuery(request, message, history, address);
        if (!tokenQuery) {
            return {
                answer: 'I can help monitor token activity, but I need the token address, ticker, or name first.',
                tool: 'watch_token_activity_needs_query',
                actions: [{ label: 'Open Detection Engine', href: '/detection', kind: 'navigate' }]
            };
        }

        const resolution = await resolveAssistantEntity(tokenQuery, chain, 'token');
        if (resolution.kind !== 'token' || !resolution.token) {
            return {
                answer: `I could not resolve "${tokenQuery}" to a single token yet. Send the exact contract address and chain to start from the live token detection view.`,
                tool: 'watch_token_activity',
                actions: [{ label: 'Open Detection Engine', href: '/detection', kind: 'navigate' }]
            };
        }

        const token = resolution.token;
        const params = new URLSearchParams({ source: 'assistant-watch' });
        if (token.chain || resolution.chain) params.set('chain', normalizeAssistantChainId(token.chain || resolution.chain));
        if (token.pairAddress) params.set('pair', token.pairAddress);
        const href = `/detection/token/${encodeURIComponent(token.address || token.pairAddress || token.ticker)}?${params.toString()}`;
        const alertHref = `/smart-alerts?${new URLSearchParams({
            setup: '1',
            address: token.address || tokenQuery,
            chain: normalizeAssistantChainId(token.chain || resolution.chain),
            type: 'alpha'
        }).toString()}`;

        return {
            answer: `Open the token detection view for ${token.name || token.ticker} to monitor live detection context, wallet activity, and market movement. I am not silently creating a saved alert; use Smart Alerts if you want persistent notifications.`,
            tool: 'watch_token_activity',
            data: { token: { ...token, href } },
            actions: [
                { label: 'Open Token Detection', href, kind: 'navigate' },
                { label: 'Prepare Smart Alert', href: alertHref, kind: 'navigate' }
            ]
        };
    }

    if (request.tool === 'get_token_overview') {
        const tokenQuery = getAssistantRequestTokenQuery(request, message, history, address);
        if (!tokenQuery) {
            return {
                answer: 'I can check token price and overview data, but I need the token symbol, name, or contract address first.',
                tool: 'token_overview_needs_query',
                actions: [{ label: 'Open Overview', href: '/dashboard' }]
            };
        }

        const resolution = await resolveAssistantEntity(tokenQuery, chain, 'token');
        const token = resolution.token;
        if (resolution.kind !== 'token' || !token) {
            const candidates = Array.isArray(resolution.candidates) ? resolution.candidates.slice(0, 5) : [];
            if (candidates.length) {
                return {
                    answer: [
                        `I found multiple possible matches for "${tokenQuery}", so I need one more detail before giving the price.`,
                        '',
                        'Best matches:',
                        ...candidates.map(formatAssistantTokenCandidate),
                        '',
                        'Send the contract address, chain, or exact option and I will continue.'
                    ].join('\n'),
                    tool: 'get_token_overview',
                    data: { resolution, candidates },
                    actions: [
                        { label: 'Open Overview', href: '/dashboard' },
                        { label: 'Open Detection Engine', href: '/detection' }
                    ]
                };
            }

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
            ? tokenDetailsHref(token, resolution.chain)
            : `/detection/token/${encodeURIComponent(tokenQuery)}`;

        const responseData = {
            token: token.ticker,
            name: token.name,
            address: tokenAddress,
            chain: token.chain,
            price: token.price,
            change24h: token.h24,
            volume24h: token.volume24h,
            liquidity: token.liquidity,
            marketCap: token.cap
        };
        const tokenLabel = `${token.name || token.ticker} (${token.ticker})`;
        const chainLabel = normalizeAssistantChainLabel(token.chain);
        let draftAnswer = [
            `${tokenLabel} is currently priced at ${formatAssistantPrice(token.price)} on ${chainLabel}.`,
            `24h change: ${token.h24 || 'unavailable'}. 24h volume: ${token.volume24h || '$0'}. Liquidity: ${token.liquidity || '$0'}. Market cap: ${token.cap || '$0'}.`
        ].join('\n');

        if (/\bmarket\s*cap\b|\bmcap\b/i.test(message)) {
            draftAnswer = `${tokenLabel}'s market cap is ${token.cap || '$0'}. For context, it is trading at ${formatAssistantPrice(token.price)} on ${chainLabel}, with ${token.volume24h || '$0'} in 24h volume and ${token.liquidity || '$0'} liquidity.`;
        } else if (/\bprice\b/i.test(message)) {
            draftAnswer = `${tokenLabel} is trading at ${formatAssistantPrice(token.price)} on ${chainLabel}. Its 24h move is ${token.h24 || 'unavailable'}, with ${token.volume24h || '$0'} volume and ${token.liquidity || '$0'} liquidity.`;
        } else if (/\boverview\b|\bdetails?\b/i.test(message)) {
            draftAnswer = `${tokenLabel} is on ${chainLabel} at ${formatAssistantPrice(token.price)}. Market cap is ${token.cap || '$0'}, liquidity is ${token.liquidity || '$0'}, 24h volume is ${token.volume24h || '$0'}, and the 24h move is ${token.h24 || 'unavailable'}.`;
        }
        const groundedAnswer = await generateAssistantGroundedAnswer({
            message,
            history,
            tool: 'get_token_overview',
            data: responseData,
            draftAnswer
        }).catch((error) => {
            console.warn('[AiAssistant] grounded token overview unavailable; using fallback draft', error instanceof Error ? error.message : error);
            return null;
        });

        return {
            answer: groundedAnswer || draftAnswer,
            tool: 'get_token_overview',
            data: responseData,
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

    if (request.tool === 'prepare_detection_alert' || request.tool === 'prepare_linked_alert') {
        const tokenQuery = getAssistantRequestTokenQuery(request, message, history, address);
        const filters = extractAssistantDetectionFilters(message, request);
        const params = new URLSearchParams();
        let alertType = filters.severity && !filters.eventType ? 'risk' : 'alpha';
        let condition = filters.severity && !filters.eventType ? 'severity_is' : 'event_is';
        let thresholdKind = filters.severity && !filters.eventType ? 'severity' : 'event';
        let threshold = filters.severity && !filters.eventType ? filters.severity : (filters.eventType || 'Accumulation');

        if (typeof filters.scoreMin === 'number' && !filters.eventType && !filters.severity) {
            alertType = 'alpha';
            condition = 'event_is';
            thresholdKind = 'event';
            threshold = 'Unusual Activity';
        }

        let resolvedToken: any = null;
        if (tokenQuery) {
            const resolution = await resolveAssistantEntity(tokenQuery, chain || filters.chain, 'token');
            if (resolution.kind === 'token' && resolution.token) {
                resolvedToken = resolution.token;
                params.set('address', resolution.token.address || tokenQuery);
                params.set('chain', normalizeAssistantChainId(resolution.token.chain || resolution.chain));
            }
        }
        if (!params.has('chain') && (chain || filters.chain)) params.set('chain', normalizeAssistantChainId(chain || filters.chain));

        params.set('setup', '1');
        params.set('type', alertType);
        params.set('condition', condition);
        params.set('thresholdKind', thresholdKind);
        params.set('threshold', threshold);
        if (request.tool === 'prepare_linked_alert') {
            params.set('alertMode', 'linked');
            params.set('linked', '1');
        }

        const href = `/smart-alerts?${params.toString()}`;
        const subject = resolvedToken?.ticker || resolvedToken?.name || (tokenQuery ? tokenQuery : 'matching tokens');
        return {
            answer: request.tool === 'prepare_linked_alert'
                ? [
                    `I prepared a linked Smart Alert draft for ${subject}.`,
                    `First condition: ${condition.replace(/_/g, ' ')} ${threshold}. Add or confirm the second condition in Smart Alerts before saving.`
                ].join('\n')
                : [
                    `I prepared a Detection-based Smart Alert draft for ${subject}.`,
                    `Trigger: ${condition.replace(/_/g, ' ')} ${threshold}. Open Smart Alerts, review it, then confirm there. I will not save it silently.`
                ].join('\n'),
            tool: request.tool,
            data: { token: resolvedToken, filters, href },
            actions: [{ label: 'Open Smart Alerts', href, kind: 'navigate' }]
        };
    }

    if (request.tool === 'prepare_alert_setup') {
        const tokenQuery = getAssistantRequestTokenQuery(request, message, history, address);
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
            const result = await withAssistantTimeout(
                buildAssistantResponse(message, history),
                22_000,
                buildAssistantTimeoutResponse(message)
            );
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
