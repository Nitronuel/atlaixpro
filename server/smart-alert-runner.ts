import { createClient } from '@supabase/supabase-js';
import type { AlphaGauntletEvent, MarketCoin } from '../src/types';
import { AlphaGauntletService } from '../src/services/AlphaGauntletService';
import { DatabaseService } from '../src/services/DatabaseService';
import {
    evaluateSmartAlertRule,
    getThresholdKindForCondition,
    normalizeSmartAlertCondition,
    type SmartAlertCondition,
    type SmartAlertMarketSnapshot,
    type SmartAlertRuleSnapshot,
    type SmartAlertThresholdKind,
    type SmartAlertType
} from './smart-alert-evaluator';

type SmartAlertRuleRow = SmartAlertRuleSnapshot & {
    token_address: string | null;
    threshold_kind: SmartAlertThresholdKind | string | null;
    enabled: boolean;
    trigger_count: number | null;
    metadata?: SmartAlertRuleMetadata | null;
    created_at?: string | null;
    last_checked_at?: string | null;
};

type LinkedAlertConditionMetadata = {
    id: string;
    alertType: SmartAlertType;
    condition: SmartAlertCondition;
    thresholdKind: SmartAlertThresholdKind;
    threshold: string;
    label: string;
    status?: 'pending' | 'met' | 'expired' | 'error';
    metAt?: string | null;
    observedValue?: string | null;
    baselineValue?: number | null;
    lastError?: string | null;
};

type SmartAlertRuleMetadata = {
    alertMode?: 'single' | 'linked';
    token?: {
        address?: string;
        pairAddress?: string | null;
        chainId?: string;
        name?: string;
        symbol?: string;
    } | null;
    matchLogic?: 'all';
    timeWindowMinutes?: number | null;
    expirationMinutes?: number | null;
    expiresAt?: string | null;
    status?: 'active' | 'paused' | 'completed' | 'expired';
    conditions?: LinkedAlertConditionMetadata[];
    completedAt?: string | null;
    expiredAt?: string | null;
};

type SmartAlertStatus = {
    enabled: boolean;
    running: boolean;
    lastRunStartedAt: string | null;
    lastRunCompletedAt: string | null;
    lastRunStatus: 'idle' | 'success' | 'error';
    lastError: string;
    intervalMs: number;
    batchSize: number;
    rulesChecked: number;
    triggersCreated: number;
};

type AlchemyAssetTransfer = {
    hash?: string;
    from?: string;
    to?: string;
    value?: number | string | null;
    rawContract?: {
        value?: string | null;
        decimal?: string | number | null;
    } | null;
};

type AlchemyRpcResponse<T> = {
    result?: T;
    error?: {
        message?: string;
    };
};

type AlchemyAssetTransferResponse = {
    transfers?: AlchemyAssetTransfer[];
};

const ALERT_RULE_COLUMNS = [
    'id',
    'user_id',
    'alert_type',
    'target',
    'chain_id',
    'token_address',
    'condition',
    'threshold_kind',
    'threshold',
    'trigger_label',
    'cooldown_minutes',
    'enabled',
    'last_checked_at',
    'last_triggered_at',
    'baseline_value',
    'trigger_count',
    'metadata',
    'created_at'
].join(',');

const LEGACY_ALERT_RULE_COLUMNS = ALERT_RULE_COLUMNS
    .split(',')
    .filter((column) => column !== 'metadata')
    .join(',');

const readEnv = (...keys: string[]) => {
    for (const key of keys) {
        const value = process.env[key]?.trim();
        if (value) return value;
    }
    return '';
};

const readNumberEnv = (key: string, fallback: number) => {
    const value = Number(process.env[key]);
    return Number.isFinite(value) && value > 0 ? value : fallback;
};

const readBooleanEnv = (key: string, fallback: boolean) => {
    const value = process.env[key]?.trim().toLowerCase();
    if (value === 'true') return true;
    if (value === 'false') return false;
    return fallback;
};

const parseMetric = (value: string | number | undefined | null) => {
    if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
    const raw = String(value || '').replace(/[$,%+\s]/g, '').toUpperCase();
    const parsed = Number.parseFloat(raw);
    if (!Number.isFinite(parsed)) return 0;
    const signed = raw.startsWith('-') ? -Math.abs(parsed) : parsed;
    if (raw.includes('T')) return signed * 1e12;
    if (raw.includes('B')) return signed * 1e9;
    if (raw.includes('M')) return signed * 1e6;
    if (raw.includes('K')) return signed * 1e3;
    return signed;
};

const normalizeText = (value: string | undefined | null) => String(value || '').trim().toLowerCase();

const ALCHEMY_NETWORK_BY_CHAIN: Record<string, string> = {
    eth: 'eth-mainnet',
    ethereum: 'eth-mainnet',
    base: 'base-mainnet',
    arbitrum: 'arb-mainnet',
    polygon: 'polygon-mainnet',
    matic: 'polygon-mainnet',
    optimism: 'opt-mainnet',
    opt: 'opt-mainnet'
};

const getAlchemyNetwork = (chain?: string | null) => ALCHEMY_NETWORK_BY_CHAIN[normalizeText(chain)] || '';

const toHexQuantity = (value: number) => `0x${Math.max(0, Math.floor(value)).toString(16)}`;

const parseHexQuantity = (value: string | undefined | null) => {
    if (!value) return 0;
    const parsed = Number.parseInt(value, 16);
    return Number.isFinite(parsed) ? parsed : 0;
};

const parseRawTokenDecimal = (value: string | number | null | undefined) => {
    if (typeof value === 'number') return Number.isFinite(value) ? value : 18;
    if (!value) return 18;
    const normalized = String(value);
    const parsed = normalized.startsWith('0x') ? Number.parseInt(normalized, 16) : Number.parseInt(normalized, 10);
    return Number.isFinite(parsed) ? parsed : 18;
};

const parseAlchemyTransferAmount = (transfer: AlchemyAssetTransfer) => {
    const directValue = Number(transfer.value);
    if (Number.isFinite(directValue) && directValue > 0) return directValue;

    const rawValue = transfer.rawContract?.value;
    if (!rawValue) return 0;

    const rawAmount = Number(BigInt(rawValue));
    const decimals = parseRawTokenDecimal(transfer.rawContract?.decimal);
    return Number.isFinite(rawAmount) ? rawAmount / (10 ** decimals) : 0;
};

const tokenMatchesRule = (coin: MarketCoin, rule: SmartAlertRuleRow) => {
    const tokenAddress = normalizeText(rule.token_address);
    if (tokenAddress) {
        return normalizeText(coin.address) === tokenAddress || normalizeText(coin.pairAddress) === tokenAddress;
    }

    const target = normalizeText(rule.target);
    if (!target || target === 'any token') return true;

    return normalizeText(coin.ticker) === target ||
        normalizeText(coin.name) === target ||
        normalizeText(coin.address) === target ||
        normalizeText(coin.pairAddress) === target;
};

const coinToSnapshot = (coin: MarketCoin): SmartAlertMarketSnapshot => {
    const buyVolume = parseMetric(coin.buyVolume24h);
    const sellVolume = parseMetric(coin.sellVolume24h);
    const whaleUsd = Math.max(Math.abs(parseMetric(coin.netFlow)), buyVolume, sellVolume);

    return {
        tokenLabel: coin.ticker || coin.name,
        tokenAddress: coin.address || coin.pairAddress || coin.ticker,
        priceUsd: parseMetric(coin.price),
        volume24hUsd: parseMetric(coin.volume24h),
        liquidityUsd: parseMetric(coin.liquidity),
        whaleUsd,
        whaleSide: coin.smartMoneySignal === 'Outflow' || sellVolume > buyVolume ? 'sell' : 'buy',
        riskSeverity: coin.riskLevel
    };
};

const dexPairToSnapshot = (pair: any, fallbackAddress: string): SmartAlertMarketSnapshot => {
    const buyVolume = parseMetric(pair?.volume?.h24);

    return {
        tokenLabel: pair?.baseToken?.symbol || pair?.baseToken?.name || fallbackAddress,
        tokenAddress: pair?.baseToken?.address || fallbackAddress,
        priceUsd: parseMetric(pair?.priceUsd),
        volume24hUsd: parseMetric(pair?.volume?.h24),
        liquidityUsd: parseMetric(pair?.liquidity?.usd),
        whaleUsd: buyVolume,
        whaleSide: 'buy',
        riskSeverity: null
    };
};

const getWhaleLookbackBlock = (rule: SmartAlertRuleRow, latestBlock: number) => {
    if (!rule.last_checked_at) return Math.max(0, latestBlock - 300);

    const lastCheckedAt = new Date(rule.last_checked_at).getTime();
    if (!Number.isFinite(lastCheckedAt)) return Math.max(0, latestBlock - 300);

    const elapsedSeconds = Math.max(60, (Date.now() - lastCheckedAt) / 1000);
    const blockEstimate = Math.ceil(elapsedSeconds / 12) + 20;
    return Math.max(0, latestBlock - Math.min(Math.max(blockEstimate, 25), 7_200));
};

const getRelevantWhaleTransfer = (
    transfers: AlchemyAssetTransfer[],
    pairAddress: string,
    condition: SmartAlertCondition | string,
    priceUsd: number
) => {
    const normalizedPair = normalizeText(pairAddress);
    const normalizedCondition = normalizeSmartAlertCondition(String(condition));

    return transfers
        .map((transfer) => {
            const fromPair = normalizeText(transfer.from) === normalizedPair;
            const toPair = normalizeText(transfer.to) === normalizedPair;
            const side = fromPair ? 'buy' as const : toPair ? 'sell' as const : null;
            const amount = parseAlchemyTransferAmount(transfer);
            const usd = amount * priceUsd;
            return { transfer, side, usd };
        })
        .filter((item) => item.side && Number.isFinite(item.usd) && item.usd > 0)
        .filter((item) => normalizedCondition === 'buy_or_sell_above' ||
            (normalizedCondition === 'buy_above' && item.side === 'buy') ||
            (normalizedCondition === 'sell_above' && item.side === 'sell'))
        .sort((a, b) => b.usd - a.usd)[0] || null;
};

const fetchDexPairForAddress = async (address: string, chain?: string | null) => {
    let response: Response;
    try {
        response = await fetchWithTimeout(`https://api.dexscreener.com/latest/dex/tokens/${encodeURIComponent(address)}`);
    } catch (error) {
        console.warn('[SmartAlerts] DexScreener token lookup failed', {
            address,
            chain,
            error: formatRuleCheckError(error)
        });
        return null;
    }

    if (!response.ok) return null;

    let payload: { pairs?: any[] };
    try {
        payload = await response.json() as { pairs?: any[] };
    } catch {
        return null;
    }
    const pairs = Array.isArray(payload.pairs) ? payload.pairs : [];
    const normalizedAddress = normalizeText(address);
    const normalizedChain = normalizeText(chain);
    const matchingPairs = pairs.filter((pair) => {
        const addressMatches =
            normalizeText(pair?.baseToken?.address) === normalizedAddress ||
            normalizeText(pair?.quoteToken?.address) === normalizedAddress ||
            normalizeText(pair?.pairAddress) === normalizedAddress;
        const chainMatches = !normalizedChain || normalizeText(pair?.chainId) === normalizedChain;
        return addressMatches && chainMatches;
    });

    const candidates = matchingPairs.length ? matchingPairs : pairs.filter((pair) => !normalizedChain || normalizeText(pair?.chainId) === normalizedChain);
    return candidates.sort((a, b) => Number(b?.liquidity?.usd || 0) - Number(a?.liquidity?.usd || 0))[0] || null;
};

const fetchAlchemyWhaleSnapshot = async (
    rule: SmartAlertRuleRow,
    pair: any,
    tokenAddress: string
): Promise<SmartAlertMarketSnapshot | null> => {
    if (rule.alert_type !== 'Whale') return null;

    const chain = rule.chain_id || rule.metadata?.token?.chainId || pair?.chainId;
    if (!getAlchemyNetwork(chain)) return null;

    const pairAddress = pair?.pairAddress || rule.metadata?.token?.pairAddress;
    const priceUsd = parseMetric(pair?.priceUsd);
    if (!pairAddress || !priceUsd) return null;

    try {
        const latestBlockHex = await fetchAlchemyRpc<string>(chain, 'eth_blockNumber', []);
        const latestBlock = parseHexQuantity(latestBlockHex);
        if (!latestBlock) return null;

        const transferResponse = await fetchAlchemyRpc<AlchemyAssetTransferResponse>(
            chain,
            'alchemy_getAssetTransfers',
            [{
                fromBlock: toHexQuantity(getWhaleLookbackBlock(rule, latestBlock)),
                toBlock: 'latest',
                category: ['erc20'],
                contractAddresses: [tokenAddress],
                withMetadata: false,
                excludeZeroValue: true,
                maxCount: '0x3e8'
            }]
        );
        const transfers = Array.isArray(transferResponse?.transfers) ? transferResponse.transfers : [];
        const relevant = getRelevantWhaleTransfer(transfers, pairAddress, rule.condition, priceUsd);
        if (!relevant) {
            return {
                ...dexPairToSnapshot(pair, tokenAddress),
                whaleUsd: 0,
                whaleSide: normalizeSmartAlertCondition(String(rule.condition)) === 'sell_above' ? 'sell' : 'buy'
            };
        }

        return {
            ...dexPairToSnapshot(pair, tokenAddress),
            eventId: relevant.transfer.hash || `${normalizeText(relevant.transfer.from)}:${normalizeText(relevant.transfer.to)}:${Math.round(relevant.usd)}`,
            whaleUsd: relevant.usd,
            whaleSide: relevant.side
        };
    } catch (error) {
        console.warn('[SmartAlerts] Alchemy whale transfer lookup failed', {
            ruleId: rule.id,
            tokenAddress,
            chain,
            error: formatRuleCheckError(error)
        });
        return null;
    }
};

const eventToSnapshot = (event: AlphaGauntletEvent): SmartAlertMarketSnapshot => ({
    ...coinToSnapshot(event.token),
    alphaEvent: event.eventType,
    tokenLabel: event.token.ticker || event.token.name,
    tokenAddress: event.token.address || event.token.pairAddress || event.token.ticker
});

const coinToAlphaSnapshot = (coin: MarketCoin, event: AlphaGauntletEvent | null): SmartAlertMarketSnapshot => ({
    ...coinToSnapshot(coin),
    alphaEvent: event?.eventType || null,
    tokenLabel: coin.ticker || coin.name,
    tokenAddress: coin.address || coin.pairAddress || coin.ticker
});

const getMetadataExpirationTime = (metadata: SmartAlertRuleMetadata | null | undefined) => {
    if (!metadata?.expiresAt) return null;
    const timestamp = new Date(metadata.expiresAt).getTime();
    return Number.isFinite(timestamp) ? timestamp : null;
};

const formatRuleCheckError = (error: unknown) => {
    const message = error instanceof Error ? error.message : String(error || '');
    const lowered = message.toLowerCase();

    if (
        lowered.includes('fetch failed') ||
        lowered.includes('timeout') ||
        lowered.includes('timed out') ||
        lowered.includes('econnreset') ||
        lowered.includes('network') ||
        lowered.includes('aborted')
    ) {
        return 'Market data provider was temporarily unavailable while checking this alert.';
    }

    return message || 'Smart Alert check failed.';
};

const fetchWithTimeout = async (url: string, timeoutMs = 8_000, init?: RequestInit) => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
        return await fetch(url, { ...init, signal: controller.signal });
    } finally {
        clearTimeout(timeout);
    }
};

const fetchAlchemyRpc = async <T>(chain: string | null | undefined, method: string, params: unknown[]): Promise<T | null> => {
    const network = getAlchemyNetwork(chain);
    const apiKey = readEnv('ALCHEMY_API_KEY', 'VITE_ALCHEMY_KEY', 'VITE_ALCHEMY_API_KEY');
    if (!network || !apiKey) return null;

    const response = await fetchWithTimeout(`https://${network}.g.alchemy.com/v2/${apiKey}`, 10_000, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            jsonrpc: '2.0',
            id: `smart-alert-${method}`,
            method,
            params
        })
    });
    if (!response.ok) return null;

    const payload = await response.json() as AlchemyRpcResponse<T>;
    if (payload.error) throw new Error(payload.error.message || `Alchemy ${method} failed.`);
    return payload.result ?? null;
};

export class SmartAlertRunner {
    private timer: ReturnType<typeof setInterval> | null = null;
    private inFlight = false;
    private supabaseClient: any | null | undefined;
    private supabaseAvailable = true;
    private hasWarnedAboutSupabase = false;
    private status: SmartAlertStatus;

    constructor() {
        this.status = {
            enabled: readBooleanEnv('SMART_ALERTS_ENABLED', true),
            running: false,
            lastRunStartedAt: null,
            lastRunCompletedAt: null,
            lastRunStatus: 'idle',
            lastError: '',
            intervalMs: readNumberEnv('SMART_ALERTS_INTERVAL_MS', 60_000),
            batchSize: readNumberEnv('SMART_ALERTS_BATCH_SIZE', 100),
            rulesChecked: 0,
            triggersCreated: 0
        };
    }

    start() {
        if (!this.status.enabled || this.timer) return;

        setTimeout(() => {
            this.runNow().catch((error) => {
                console.warn('[SmartAlerts] initial run failed', error);
            });
        }, readNumberEnv('SMART_ALERTS_INITIAL_DELAY_MS', 10_000));

        this.timer = setInterval(() => {
            this.runNow().catch((error) => {
                console.warn('[SmartAlerts] scheduled run failed', error);
            });
        }, this.status.intervalMs);
    }

    getStatus() {
        return { ...this.status };
    }

    async runNow() {
        if (!this.status.enabled || this.inFlight) return this.getStatus();

        this.inFlight = true;
        this.status.running = true;
        this.status.lastRunStartedAt = new Date().toISOString();
        this.status.lastError = '';

        try {
            const supabase = this.getSupabase();
            if (!supabase) {
                this.status.lastRunStatus = 'error';
                this.status.lastError = 'Supabase service-role credentials are not configured for Smart Alerts.';
                return this.getStatus();
            }

            const rules = await this.loadEnabledRules(supabase);
            if (!rules.length) {
                this.status.rulesChecked = 0;
                this.status.triggersCreated = 0;
                this.status.lastRunStatus = 'success';
                return this.getStatus();
            }

            let marketCoins: MarketCoin[] = [];
            let alphaEvents: AlphaGauntletEvent[] = [];
            let feedError = '';
            try {
                const response = await DatabaseService.getMarketData(true, false);
                marketCoins = response.data || [];
                alphaEvents = AlphaGauntletService.getDetectionEvents(marketCoins);
            } catch (error) {
                feedError = 'Market feed was temporarily unavailable; direct token checks continued where possible.';
                console.warn('[SmartAlerts] market feed unavailable; falling back to direct token checks', {
                    error: formatRuleCheckError(error)
                });
            }

            let triggersCreated = 0;
            let failedRules = 0;

            for (const rule of rules) {
                try {
                    const created = await this.evaluateRule(supabase, rule, marketCoins, alphaEvents);
                    triggersCreated += created;
                } catch (error) {
                    failedRules += 1;
                    const message = formatRuleCheckError(error);
                    console.warn('[SmartAlerts] rule check failed', {
                        ruleId: rule.id,
                        target: rule.target,
                        error: message
                    });

                    try {
                        await this.updateRuleEvaluation(supabase, rule, {
                            last_checked_at: new Date().toISOString(),
                            last_error: message
                        });
                    } catch (updateError) {
                        console.warn('[SmartAlerts] failed to save rule check error', {
                            ruleId: rule.id,
                            error: formatRuleCheckError(updateError)
                        });
                    }
                }
            }

            this.status.rulesChecked = rules.length;
            this.status.triggersCreated = triggersCreated;
            this.status.lastRunStatus = 'success';
            this.status.lastError = failedRules
                ? `${failedRules} alert${failedRules === 1 ? '' : 's'} could not be checked. Other alerts continued.`
                : feedError;
            return this.getStatus();
        } catch (error) {
            this.status.lastRunStatus = 'error';
            this.status.lastError = error instanceof Error ? error.message : 'Smart Alert runner failed.';
            console.warn('[SmartAlerts] run failed', error);
            return this.getStatus();
        } finally {
            this.status.lastRunCompletedAt = new Date().toISOString();
            this.status.running = false;
            this.inFlight = false;
        }
    }

    private getSupabase() {
        if (!this.supabaseAvailable) return null;
        if (this.supabaseClient !== undefined) return this.supabaseClient;

        const url = readEnv('SUPABASE_URL', 'VITE_SUPABASE_URL');
        const key = readEnv('SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_SERVICE_KEY');

        if (!url || !key) {
            this.warnSupabaseOnce('[SmartAlerts] Supabase service-role credentials are missing; saved alerts will not be evaluated.');
            this.supabaseClient = null;
            return this.supabaseClient;
        }

        this.supabaseClient = createClient(url, key, {
            auth: {
                persistSession: false,
                autoRefreshToken: false
            }
        });

        return this.supabaseClient;
    }

    private warnSupabaseOnce(message: string) {
        if (this.hasWarnedAboutSupabase) return;
        this.hasWarnedAboutSupabase = true;
        console.warn(message);
    }

    private async loadEnabledRules(supabase: any): Promise<SmartAlertRuleRow[]> {
        let { data, error } = await supabase
            .from('alert_rules')
            .select(ALERT_RULE_COLUMNS)
            .eq('enabled', true)
            .order('last_checked_at', { ascending: true, nullsFirst: true })
            .limit(this.status.batchSize);

        if (error?.code === '42703') {
            ({ data, error } = await supabase
                .from('alert_rules')
                .select(LEGACY_ALERT_RULE_COLUMNS)
                .eq('enabled', true)
                .order('last_checked_at', { ascending: true, nullsFirst: true })
                .limit(this.status.batchSize));
        }

        if (error) throw error;

        return (data || []).map((row: any) => {
            const condition = normalizeSmartAlertCondition(row.condition || 'above');
            return {
                ...row,
                condition,
                threshold_kind: row.threshold_kind || getThresholdKindForCondition(row.alert_type, condition),
                cooldown_minutes: Number(row.cooldown_minutes || 60),
                trigger_count: Number(row.trigger_count || 0),
                baseline_value: row.baseline_value === null || row.baseline_value === undefined ? null : Number(row.baseline_value)
            };
        });
    }

    private getSnapshotsForRule(
        rule: SmartAlertRuleRow,
        marketCoins: MarketCoin[],
        alphaEvents: AlphaGauntletEvent[]
    ): SmartAlertMarketSnapshot[] {
        const chain = normalizeText(rule.chain_id);
        const coins = marketCoins
            .filter((coin) => !chain || normalizeText(coin.chain) === chain)
            .filter((coin) => tokenMatchesRule(coin, rule));

        if (rule.alert_type === 'Alpha') {
            const events = alphaEvents
                .filter((event) => !chain || normalizeText(event.token.chain) === chain)
                .filter((event) => tokenMatchesRule(event.token, rule));
            return events.map(eventToSnapshot);
        }

        return coins.map(coinToSnapshot);
    }

    private async getFallbackSnapshotForRule(rule: SmartAlertRuleRow): Promise<SmartAlertMarketSnapshot | null> {
        const tokenAddress = rule.token_address || rule.metadata?.token?.address || '';
        if (!tokenAddress) return null;

        const directPair = await fetchDexPairForAddress(tokenAddress, rule.chain_id || rule.metadata?.token?.chainId || undefined);
        if (directPair) {
            if (rule.alert_type === 'Alpha') {
                const coin = DatabaseService.transformPair(directPair);
                const event = AlphaGauntletService.qualifyToken(coin);
                return coinToAlphaSnapshot(coin, event);
            }

            const whaleSnapshot = await fetchAlchemyWhaleSnapshot(rule, directPair, tokenAddress);
            if (whaleSnapshot) return whaleSnapshot;

            return dexPairToSnapshot(directPair, tokenAddress);
        }

        let pair: any = null;
        try {
            pair = await DatabaseService.getTokenDetails(
                tokenAddress,
                rule.chain_id || rule.metadata?.token?.chainId || undefined,
                rule.metadata?.token?.pairAddress || undefined
            );
        } catch (error) {
            console.warn('[SmartAlerts] direct token detail lookup failed', {
                ruleId: rule.id,
                tokenAddress,
                error: formatRuleCheckError(error)
            });
        }

        if (!pair) return null;

        if (rule.alert_type === 'Alpha') {
            const coin = DatabaseService.transformPair(pair);
            const event = AlphaGauntletService.qualifyToken(coin);
            return coinToAlphaSnapshot(coin, event);
        }

        const whaleSnapshot = await fetchAlchemyWhaleSnapshot(rule, pair, tokenAddress);
        if (whaleSnapshot) return whaleSnapshot;

        return dexPairToSnapshot(pair, tokenAddress);
    }

    private async getEvaluationSnapshotsForRule(
        rule: SmartAlertRuleRow,
        marketCoins: MarketCoin[],
        alphaEvents: AlphaGauntletEvent[]
    ) {
        const directSnapshot = rule.token_address || rule.metadata?.token?.address
            ? await this.getFallbackSnapshotForRule(rule)
            : null;

        if (directSnapshot) return [directSnapshot];

        return this.getSnapshotsForRule(rule, marketCoins, alphaEvents);
    }

    private async evaluateRule(
        supabase: any,
        rule: SmartAlertRuleRow,
        marketCoins: MarketCoin[],
        alphaEvents: AlphaGauntletEvent[]
    ) {
        if (rule.metadata?.alertMode === 'linked') {
            return this.evaluateLinkedRule(supabase, rule, marketCoins, alphaEvents);
        }

        const now = new Date();
        const expiresAt = getMetadataExpirationTime(rule.metadata);
        if (rule.metadata?.status === 'expired' || (Number(rule.trigger_count || 0) === 0 && expiresAt !== null && now.getTime() >= expiresAt)) {
            await this.updateRuleEvaluation(supabase, rule, {
                enabled: false,
                last_checked_at: now.toISOString(),
                metadata: {
                    ...(rule.metadata || {}),
                    status: 'expired',
                    expiredAt: (rule.metadata || {}).expiredAt || now.toISOString()
                }
            });
            return 0;
        }

        const evaluationSnapshots = await this.getEvaluationSnapshotsForRule(rule, marketCoins, alphaEvents);

        if (!evaluationSnapshots.length) {
            await this.updateRuleEvaluation(supabase, rule, {
                last_checked_at: now.toISOString(),
                last_error: 'No live market snapshot was available for this alert token.'
            });
            return 0;
        }

        let triggersCreated = 0;
        let lastObservedValue: string | null = null;
        let lastObservedNumber: number | null = null;
        let nextBaselineValue: number | null = null;
        let lastError: string | null = null;

        for (const snapshot of evaluationSnapshots) {
            const result = evaluateSmartAlertRule(rule, snapshot, now);
            lastObservedValue = result.observedValue;
            lastObservedNumber = result.observedNumber;
            lastError = result.lastError;
            if (result.nextBaselineValue !== null) nextBaselineValue = result.nextBaselineValue;

            if (!result.shouldTrigger) continue;

            const inserted = await this.insertTrigger(supabase, rule, snapshot, result, now);
            if (inserted) triggersCreated += 1;

            await this.updateRuleEvaluation(supabase, rule, {
                last_triggered_at: now.toISOString(),
                trigger_count: Number(rule.trigger_count || 0) + triggersCreated,
                ...(result.nextBaselineValue !== null ? {
                    baseline_value: result.nextBaselineValue,
                    baseline_observed_at: now.toISOString()
                } : {})
            });

            if (normalizeText(rule.target) !== 'any token') break;
        }

        await this.updateRuleEvaluation(supabase, rule, {
            last_checked_at: now.toISOString(),
            last_observed_value: lastObservedValue,
            last_observed_at: now.toISOString(),
            last_error: lastError || null,
            ...(nextBaselineValue !== null ? {
                baseline_value: nextBaselineValue,
                baseline_observed_at: now.toISOString()
            } : {}),
            ...(lastObservedNumber !== null && normalizeSmartAlertCondition(rule.condition) !== 'changes_by_percent' ? {
                baseline_value: lastObservedNumber,
                baseline_observed_at: now.toISOString()
            } : {})
        });

        return triggersCreated;
    }

    private async evaluateLinkedRule(
        supabase: any,
        rule: SmartAlertRuleRow,
        marketCoins: MarketCoin[],
        alphaEvents: AlphaGauntletEvent[]
    ) {
        const now = new Date();
        const metadata = rule.metadata || {};
        const conditions = Array.isArray(metadata.conditions) ? metadata.conditions : [];

        if (!conditions.length || metadata.status === 'completed' || metadata.status === 'expired') {
            await this.updateRuleEvaluation(supabase, rule, {
                last_checked_at: now.toISOString()
            });
            return 0;
        }

        const createdAt = new Date((rule as any).created_at || now.toISOString()).getTime();
        if (metadata.timeWindowMinutes && Number.isFinite(createdAt) && now.getTime() - createdAt > metadata.timeWindowMinutes * 60_000) {
            await this.updateRuleEvaluation(supabase, rule, {
                last_checked_at: now.toISOString(),
                metadata: {
                    ...metadata,
                    status: 'expired',
                    conditions: conditions.map((condition) => condition.status === 'met' ? condition : { ...condition, status: 'expired' })
                }
            });
            return 0;
        }

        const evaluationSnapshots = await this.getEvaluationSnapshotsForRule(rule, marketCoins, alphaEvents);
        if (!evaluationSnapshots.length) {
            await this.updateRuleEvaluation(supabase, rule, {
                last_checked_at: now.toISOString(),
                last_error: 'No live market snapshot was available for this linked alert token.'
            });
            return 0;
        }

        const snapshot = evaluationSnapshots[0];
        let triggersCreated = 0;
        let lastObservedValue: string | null = null;
        let lastError: string | null = null;

        const nextConditions = [];
        for (const condition of conditions) {
            if (condition.status === 'met') {
                nextConditions.push(condition);
                continue;
            }

            const conditionRule: SmartAlertRuleSnapshot = {
                id: `${rule.id}:${condition.id}`,
                user_id: rule.user_id,
                alert_type: condition.alertType,
                target: rule.target,
                chain_id: rule.chain_id,
                condition: condition.condition,
                threshold_kind: condition.thresholdKind,
                threshold: condition.threshold,
                trigger_label: condition.label,
                cooldown_minutes: rule.cooldown_minutes,
                last_triggered_at: null,
                baseline_value: condition.baselineValue ?? null
            };
            const result = evaluateSmartAlertRule(conditionRule, snapshot, now);
            lastObservedValue = result.observedValue;
            lastError = result.lastError;

            const nextCondition: LinkedAlertConditionMetadata = {
                ...condition,
                observedValue: result.observedValue,
                lastError: result.lastError,
                ...(result.nextBaselineValue !== null ? { baselineValue: result.nextBaselineValue } : {})
            };

            if (result.shouldTrigger) {
                nextCondition.status = 'met';
                nextCondition.metAt = now.toISOString();
                const inserted = await this.insertLinkedTrigger(supabase, rule, snapshot, {
                    title: 'Partial target met',
                    message: `${condition.label} met for ${snapshot.tokenLabel || rule.target}.`,
                    observedValue: result.observedValue,
                    threshold: condition.threshold,
                    dedupeKey: `${rule.id}:${condition.id}:partial`,
                    metadata: {
                        eventType: 'partial_met',
                        conditionId: condition.id,
                        tokenLabel: snapshot.tokenLabel || null,
                        tokenAddress: snapshot.tokenAddress || null,
                        completedConditions: nextConditions.filter((item) => item.status === 'met').length + 1,
                        totalConditions: conditions.length,
                        evaluatedAt: now.toISOString()
                    }
                }, now);
                if (inserted) triggersCreated += 1;
            }

            nextConditions.push(nextCondition);
        }

        const completedConditions = nextConditions.filter((condition) => condition.status === 'met').length;
        const allConditionsMet = completedConditions === nextConditions.length;
        let nextMetadata: SmartAlertRuleMetadata = {
            ...metadata,
            status: allConditionsMet ? 'completed' : 'active',
            conditions: nextConditions,
            ...(allConditionsMet ? { completedAt: now.toISOString() } : {})
        };

        if (allConditionsMet) {
            const inserted = await this.insertLinkedTrigger(supabase, rule, snapshot, {
                title: 'Linked alert triggered',
                message: `All ${nextConditions.length} linked conditions were met for ${snapshot.tokenLabel || rule.target}.`,
                observedValue: lastObservedValue,
                threshold: `${nextConditions.length} conditions`,
                dedupeKey: `${rule.id}:linked-complete`,
                metadata: {
                    eventType: 'linked_triggered',
                    tokenLabel: snapshot.tokenLabel || null,
                    tokenAddress: snapshot.tokenAddress || null,
                    completedConditions,
                    totalConditions: nextConditions.length,
                    evaluatedAt: now.toISOString()
                }
            }, now);
            if (inserted) triggersCreated += 1;
        }

        await this.updateRuleEvaluation(supabase, rule, {
            last_checked_at: now.toISOString(),
            last_observed_value: lastObservedValue,
            last_observed_at: now.toISOString(),
            last_error: lastError || null,
            metadata: nextMetadata,
            ...(allConditionsMet ? {
                last_triggered_at: now.toISOString(),
                trigger_count: Number(rule.trigger_count || 0) + triggersCreated
            } : triggersCreated ? {
                trigger_count: Number(rule.trigger_count || 0) + triggersCreated
            } : {})
        });

        return triggersCreated;
    }

    private async insertTrigger(
        supabase: any,
        rule: SmartAlertRuleRow,
        snapshot: SmartAlertMarketSnapshot,
        result: ReturnType<typeof evaluateSmartAlertRule>,
        now: Date
    ) {
        const { data, error } = await supabase
            .from('alert_triggers')
            .insert({
                alert_rule_id: rule.id,
                user_id: rule.user_id,
                alert_type: rule.alert_type,
                title: `${rule.alert_type} Alert`,
                message: result.message,
                observed_value: result.observedValue,
                threshold: rule.threshold,
                source: 'smart-alert-runner',
                dedupe_key: result.dedupeKey,
                metadata: {
                    tokenLabel: snapshot.tokenLabel || null,
                    tokenAddress: snapshot.tokenAddress || null,
                    condition: normalizeSmartAlertCondition(rule.condition),
                    thresholdKind: rule.threshold_kind,
                    evaluatedAt: now.toISOString()
                },
                created_at: now.toISOString()
            })
            .select('id');

        if (error?.code === '23505') return false;
        if (error) throw error;
        return Boolean(data && data.length > 0);
    }

    private async insertLinkedTrigger(
        supabase: any,
        rule: SmartAlertRuleRow,
        snapshot: SmartAlertMarketSnapshot,
        event: {
            title: string;
            message: string;
            observedValue: string | null;
            threshold: string | null;
            dedupeKey: string;
            metadata: Record<string, unknown>;
        },
        now: Date
    ) {
        const { data, error } = await supabase
            .from('alert_triggers')
            .insert({
                alert_rule_id: rule.id,
                user_id: rule.user_id,
                alert_type: rule.alert_type,
                title: event.title,
                message: event.message,
                observed_value: event.observedValue,
                threshold: event.threshold,
                source: 'smart-alert-runner',
                dedupe_key: event.dedupeKey,
                metadata: event.metadata,
                created_at: now.toISOString()
            })
            .select('id');

        if (error?.code === '23505') return false;
        if (error) throw error;
        return Boolean(data && data.length > 0);
    }

    private async updateRuleEvaluation(supabase: any, rule: SmartAlertRuleRow, patch: Record<string, unknown>) {
        const { error } = await supabase
            .from('alert_rules')
            .update(patch)
            .eq('id', rule.id);

        if (error) throw error;
    }
}
