import { APP_CONFIG } from '../../config';
import { isEvmChain, type AlchemyHubChain } from './alchemy-hub-chains';

export type MoralisTopHolder = {
    wallet: string;
    rawBalance: string;
    percentage: number | null;
};

const MORALIS_TIMEOUT_MS = 18_000;
const EVM_MORALIS_CHAIN_BY_ID: Record<Exclude<AlchemyHubChain, 'solana'>, string> = {
    eth: 'eth',
    base: 'base',
    bsc: 'bsc',
    polygon: 'polygon',
    arbitrum: 'arbitrum',
    optimism: 'optimism'
};

function isLikelySolanaAddress(value: string) {
    return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value.trim());
}

function isLikelyEvmAddress(value: string) {
    return /^0x[a-fA-F0-9]{40}$/.test(value.trim());
}

function normalizeWallet(value: string, chain: AlchemyHubChain) {
    const trimmed = value.trim();
    return isEvmChain(chain) ? trimmed.toLowerCase() : trimmed;
}

function readString(record: Record<string, unknown>, keys: string[]) {
    for (const key of keys) {
        const value = record[key];
        if (typeof value === 'string' && value.trim()) return value.trim();
        if (typeof value === 'number' && Number.isFinite(value)) return String(value);
        if (typeof value === 'bigint') return value.toString();
    }
    return '';
}

function readNumber(record: Record<string, unknown>, keys: string[]) {
    for (const key of keys) {
        const value = record[key];
        if (typeof value === 'number' && Number.isFinite(value)) return value;
        if (typeof value === 'string' && value.trim()) {
            const numeric = Number(value);
            if (Number.isFinite(numeric)) return numeric;
        }
    }
    return null;
}

function extractHolderRows(payload: unknown): unknown[] {
    if (Array.isArray(payload)) return payload;
    if (!payload || typeof payload !== 'object') return [];

    const record = payload as Record<string, unknown>;
    for (const key of ['result', 'holders', 'data', 'items', 'owners']) {
        const value = record[key];
        if (Array.isArray(value)) return value;
        if (value && typeof value === 'object') {
            const nested = extractHolderRows(value);
            if (nested.length) return nested;
        }
    }

    return [];
}

function extractCursor(payload: unknown) {
    if (!payload || typeof payload !== 'object') return '';
    const cursor = (payload as Record<string, unknown>).cursor;
    return typeof cursor === 'string' ? cursor : '';
}

async function fetchJsonWithTimeout(url: string) {
    if (!APP_CONFIG.moralisKey) {
        throw new Error('Moralis API key is not configured on the backend.');
    }

    const controller = new AbortController();
    const timeoutId = globalThis.setTimeout(() => controller.abort(), MORALIS_TIMEOUT_MS);
    try {
        const response = await fetch(url, {
            headers: {
                accept: 'application/json',
                'X-API-Key': APP_CONFIG.moralisKey
            },
            signal: controller.signal
        });
        const text = await response.text();
        const payload = text ? JSON.parse(text) : {};

        if (!response.ok) {
            const message = typeof payload?.message === 'string'
                ? payload.message
                : typeof payload?.error === 'string'
                    ? payload.error
                    : `Moralis top-holder request failed with status ${response.status}.`;
            throw new Error(message);
        }

        return payload;
    } finally {
        globalThis.clearTimeout(timeoutId);
    }
}

function buildMoralisTopHolderUrls(tokenAddress: string, chain: AlchemyHubChain, limit: number) {
    const encodedToken = encodeURIComponent(tokenAddress);
    const pageLimit = Math.max(1, Math.min(limit, 100));

    if (chain === 'solana') {
        return [
            `https://solana-gateway.moralis.io/token/mainnet/${encodedToken}/top-holders?limit=${pageLimit}`,
            `https://solana-gateway.moralis.io/token/mainnet/${encodedToken}/holders?limit=${pageLimit}`
        ];
    }

    const moralisChain = EVM_MORALIS_CHAIN_BY_ID[chain];
    return [
        `https://deep-index.moralis.io/api/v2.2/erc20/${encodedToken}/owners?chain=${moralisChain}&limit=${pageLimit}&order=DESC`,
        `https://deep-index.moralis.io/api/v2.2/erc20/${encodedToken}/holders?chain=${moralisChain}&limit=${pageLimit}`
    ];
}

async function fetchPagedMoralisRows(baseUrl: string, limit: number) {
    const rows: unknown[] = [];
    let cursor = '';
    let page = 0;

    while (rows.length < limit && page < Math.ceil(limit / 100)) {
        const url = new URL(baseUrl);
        if (cursor) {
            url.searchParams.set('cursor', cursor);
        }

        const payload = await fetchJsonWithTimeout(url.toString());
        rows.push(...extractHolderRows(payload));
        cursor = extractCursor(payload);
        page += 1;
        if (!cursor) break;
    }

    return rows;
}

function normalizeRows(rows: unknown[], chain: AlchemyHubChain, limit: number): MoralisTopHolder[] {
    const holders = new Map<string, MoralisTopHolder>();

    for (const row of rows) {
        if (!row || typeof row !== 'object') continue;
        const record = row as Record<string, unknown>;
        const wallet = normalizeWallet(readString(record, [
            'owner_address',
            'wallet_address',
            'holder_address',
            'holderAddress',
            'ownerAddress',
            'walletAddress',
            'tokenAccountOwner',
            'associatedTokenAddressOwner',
            'owner',
            'wallet',
            'holder',
            'address'
        ]), chain);
        const isValid = chain === 'solana' ? isLikelySolanaAddress(wallet) : isLikelyEvmAddress(wallet);
        if (!isValid) continue;

        const rawBalance = readString(record, [
            'balance',
            'amount',
            'value',
            'tokenBalance',
            'rawBalance',
            'token_balance',
            'amount_raw',
            'raw_amount',
            'balanceFormatted',
            'balance_formatted'
        ]);
        const percentage = readNumber(record, [
            'percentage',
            'percent',
            'share',
            'balance_percentage',
            'ownership_percentage'
        ]);

        if (!holders.has(wallet)) {
            holders.set(wallet, {
                wallet,
                rawBalance: rawBalance || '0',
                percentage
            });
        }
    }

    return [...holders.values()].slice(0, limit);
}

export async function fetchMoralisTopHolders(
    tokenAddress: string,
    chain: AlchemyHubChain,
    limit = 200
): Promise<MoralisTopHolder[]> {
    const urls = buildMoralisTopHolderUrls(tokenAddress, chain, limit);
    const errors: string[] = [];

    for (const url of urls) {
        try {
            const holders = normalizeRows(await fetchPagedMoralisRows(url, limit), chain, limit);
            if (holders.length) return holders;
        } catch (error) {
            errors.push(error instanceof Error ? error.message : 'Unknown Moralis error.');
        }
    }

    throw new Error(errors[0] || 'Moralis did not return top holders for this token.');
}
