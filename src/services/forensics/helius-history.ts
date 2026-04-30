// Forensic analysis helper for SafeScan intelligence workflows.
import { APP_CONFIG } from '../../config';
import type { MintSignature, ParsedTransaction } from './types';

const HELIUS_RPC_TIMEOUT_MS = 12_000;
const MAX_FULL_PAGE_SIZE = 100;
const MAX_SIGNATURE_PAGE_SIZE = 1000;

type HeliusTransactionDetails = 'full' | 'signatures';
type HeliusSortOrder = 'asc' | 'desc';

type HeliusHistoryEnvelope<T> = {
    data?: T[];
    transactions?: T[];
    paginationToken?: string | null;
};

type HeliusHistoryOptions = {
    address: string;
    limit: number;
    sortOrder: HeliusSortOrder;
    transactionDetails: HeliusTransactionDetails;
    paginationToken?: string;
};

type HeliusHistoryPage<T> = {
    items: T[];
    paginationToken: string | null;
};

type HeliusHistoryResult<T> = {
    items: T[];
    pageCount: number;
    usedHelius: boolean;
};

function getHeliusRpcUrl() {
    if (!APP_CONFIG.heliusKey) return null;
    return `https://mainnet.helius-rpc.com/?api-key=${APP_CONFIG.heliusKey}`;
}

async function fetchJsonWithTimeout(url: string, init: RequestInit, timeoutMs: number) {
    const controller = new AbortController();
    const timeoutId = globalThis.setTimeout(() => controller.abort(), timeoutMs);

    try {
        return await fetch(url, {
            ...init,
            signal: controller.signal
        });
    } finally {
        globalThis.clearTimeout(timeoutId);
    }
}

async function heliusRpcPage<T>({
    address,
    limit,
    sortOrder,
    transactionDetails,
    paginationToken
}: HeliusHistoryOptions): Promise<HeliusHistoryPage<T>> {
    const heliusUrl = getHeliusRpcUrl();
    if (!heliusUrl) {
        return { items: [], paginationToken: null };
    }

    const pageSize = transactionDetails === 'full'
        ? Math.min(limit, MAX_FULL_PAGE_SIZE)
        : Math.min(limit, MAX_SIGNATURE_PAGE_SIZE);

    const response = await fetchJsonWithTimeout(heliusUrl, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            jsonrpc: '2.0',
            id: `atlaix-getTransactionsForAddress-${transactionDetails}`,
            method: 'getTransactionsForAddress',
            params: [
                address,
                {
                    limit: pageSize,
                    sortOrder,
                    transactionDetails,
                    encoding: 'jsonParsed',
                    maxSupportedTransactionVersion: 0,
                    ...(paginationToken ? { paginationToken } : {})
                }
            ]
        })
    }, HELIUS_RPC_TIMEOUT_MS);

    if (!response.ok) {
        const body = await response.text().catch(() => '');
        throw new Error(body || `Helius history request failed with status ${response.status}.`);
    }

    const payload = await response.json() as {
        result?: HeliusHistoryEnvelope<T> | T[];
        error?: { message?: string };
    };

    if (payload.error?.message) {
        throw new Error(payload.error.message);
    }

    const result = payload.result;
    if (Array.isArray(result)) {
        return {
            items: result,
            paginationToken: null
        };
    }

    return {
        items: result?.data || result?.transactions || [],
        paginationToken: result?.paginationToken || null
    };
}

async function fetchHistoryPages<T>(
    options: Omit<HeliusHistoryOptions, 'paginationToken'> & { maxPages?: number }
): Promise<HeliusHistoryResult<T>> {
    const items: T[] = [];
    let paginationToken: string | undefined;
    let pageCount = 0;
    const maxPages = options.maxPages ?? 4;

    while (items.length < options.limit && pageCount < maxPages) {
        const page = await heliusRpcPage<T>({
            ...options,
            limit: options.limit - items.length,
            paginationToken
        });
        pageCount += 1;
        items.push(...page.items);

        if (!page.paginationToken || page.items.length === 0) {
            break;
        }

        paginationToken = page.paginationToken;
    }

    return {
        items: items.slice(0, options.limit),
        pageCount,
        usedHelius: pageCount > 0 && items.length > 0
    };
}

export async function fetchOrderedTransactionsForAddress(address: string, limit: number) {
    return await fetchHistoryPages<ParsedTransaction>({
        address,
        limit,
        sortOrder: 'asc',
        transactionDetails: 'full',
        maxPages: 4
    });
}

export async function fetchRecentSignaturesForAddress(address: string, limit: number) {
    const result = await fetchHistoryPages<MintSignature>({
        address,
        limit,
        sortOrder: 'desc',
        transactionDetails: 'signatures',
        maxPages: 2
    });

    return {
        ...result,
        items: result.items
            .filter((entry) => Boolean(entry?.signature))
            .map((entry) => ({
                signature: entry.signature,
                slot: entry.slot,
                blockTime: entry.blockTime
            }))
    };
}
