import type { ForensicBundleReport } from './ForensicBundleService';
import { getAlchemyHubChain, type AlchemyHubChain } from './forensics/alchemy-hub-chains';

type CacheRecord = {
    savedAt: number;
    report: ForensicBundleReport;
};

const CACHE_PREFIX = 'atlaix-alchemy-hub-report:';
const CACHE_TTL_MS = 3 * 60 * 1000;
const inFlightReportCache = new Map<string, Promise<ForensicBundleReport>>();

function isLikelySolanaAddress(value: string) {
    const trimmed = value.trim();
    return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(trimmed);
}

function isLikelyEvmAddress(value: string) {
    return /^0x[a-fA-F0-9]{40}$/.test(value.trim());
}

function cacheKey(tokenAddress: string, chain: AlchemyHubChain) {
    return `${CACHE_PREFIX}${chain}:${tokenAddress.toLowerCase()}`;
}

function readCachedReport(tokenAddress: string, chain: AlchemyHubChain) {
    try {
        const raw = window.localStorage.getItem(cacheKey(tokenAddress, chain));
        if (!raw) return null;
        const record = JSON.parse(raw) as CacheRecord;
        if ((Date.now() - record.savedAt) > CACHE_TTL_MS) {
            window.localStorage.removeItem(cacheKey(tokenAddress, chain));
            return null;
        }
        return record.report;
    } catch {
        return null;
    }
}

function writeCachedReport(tokenAddress: string, chain: AlchemyHubChain, report: ForensicBundleReport) {
    try {
        window.localStorage.setItem(cacheKey(tokenAddress, chain), JSON.stringify({
            savedAt: Date.now(),
            report
        } satisfies CacheRecord));
    } catch {
        // Cache is optional.
    }
}

async function fetchJson(input: RequestInfo | URL, init?: RequestInit) {
    const response = await fetch(input, init);
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
        throw new Error(
            typeof payload?.error === 'string'
                ? payload.error
                : `Alchemy Hub backend request failed with status ${response.status}.`
        );
    }
    return payload;
}

export { type ForensicBundleReport };
export type { AlchemyHubChain };

export const AlchemyHubService = {
    isSupported(tokenAddress: string, chain: AlchemyHubChain = 'solana') {
        return chain === 'solana'
            ? isLikelySolanaAddress(tokenAddress)
            : isLikelyEvmAddress(tokenAddress);
    },

    async analyzeToken(tokenAddress: string, chain: AlchemyHubChain = 'solana') {
        const normalizedAddress = tokenAddress.trim();
        const selectedChain = getAlchemyHubChain(chain).id;
        if (!this.isSupported(normalizedAddress, selectedChain)) {
            throw new Error(selectedChain === 'solana'
                ? 'Alchemy Hub Solana scans require a valid Solana token address.'
                : 'Alchemy Hub EVM scans require a valid 0x token contract address.');
        }

        const cached = readCachedReport(normalizedAddress, selectedChain);
        if (cached) {
            return cached;
        }

        const inflightKey = `${selectedChain}:${normalizedAddress.toLowerCase()}`;
        const inflight = inFlightReportCache.get(inflightKey);
        if (inflight) {
            return inflight;
        }

        const request = fetchJson('/api/forensics/alchemy-hub', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ tokenAddress: normalizedAddress, chain: selectedChain })
        })
            .then((payload) => {
                const report = payload.report as ForensicBundleReport | undefined;
                if (!report) {
                    throw new Error('Alchemy Hub backend did not return a report.');
                }
                writeCachedReport(normalizedAddress, selectedChain, report);
                return report;
            })
            .finally(() => {
                inFlightReportCache.delete(inflightKey);
            });

        inFlightReportCache.set(inflightKey, request);
        return request;
    }
};
