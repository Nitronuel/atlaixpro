// Intelligence service module for Atlaix data workflows.
import { extractJitoTipTransfers, FORENSIC_MAX_TRACKED_HOPS, inferJitoLaunchSignals } from './forensics/engine';
import type { ForensicBundleReport } from './forensics/types';
export type {
    ForensicGraphCluster,
    ForensicGraphEdge,
    ForensicGraphNode
} from './forensics/types';

type CacheRecord = {
    savedAt: number;
    report: ForensicBundleReport;
};

const CACHE_PREFIX = 'atlaix-forensic-report:';
const CACHE_INDEX_KEY = 'atlaix-forensic-report:index';
const CACHE_TTL_MS = 5 * 60 * 1000;
const CACHE_MAX_ITEMS = 12;
const JOB_POLL_INTERVAL_MS = 2_000;
const JOB_TIMEOUT_MS = 8 * 60 * 1000;
const inFlightReportCache = new Map<string, Promise<ForensicBundleReport>>();

function isLikelySolanaAddress(value: string) {
    const trimmed = value.trim();
    return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(trimmed);
}

function readCachedReport(tokenAddress: string) {
    try {
        const raw = window.localStorage.getItem(`${CACHE_PREFIX}${tokenAddress}`);
        if (!raw) return null;
        const record = JSON.parse(raw) as CacheRecord;
        if ((Date.now() - record.savedAt) > CACHE_TTL_MS) {
            window.localStorage.removeItem(`${CACHE_PREFIX}${tokenAddress}`);
            return null;
        }
        return record.report;
    } catch {
        return null;
    }
}

function pruneCacheIndex(index: string[]) {
    const seen = new Set<string>();
    const ordered = index.filter((address) => {
        if (!address || seen.has(address)) return false;
        seen.add(address);
        return true;
    });

    if (ordered.length <= CACHE_MAX_ITEMS) {
        return ordered;
    }

    const removed = ordered.slice(CACHE_MAX_ITEMS);
    for (const address of removed) {
        window.localStorage.removeItem(`${CACHE_PREFIX}${address}`);
    }

    return ordered.slice(0, CACHE_MAX_ITEMS);
}

function writeCachedReport(tokenAddress: string, report: ForensicBundleReport) {
    try {
        const cacheKey = `${CACHE_PREFIX}${tokenAddress}`;
        const currentIndex = JSON.parse(window.localStorage.getItem(CACHE_INDEX_KEY) || '[]') as string[];
        const nextIndex = pruneCacheIndex([tokenAddress, ...currentIndex.filter((address) => address !== tokenAddress)]);

        window.localStorage.setItem(cacheKey, JSON.stringify({
            savedAt: Date.now(),
            report
        } satisfies CacheRecord));
        window.localStorage.setItem(CACHE_INDEX_KEY, JSON.stringify(nextIndex));
    } catch {
        // Browser cache is optional.
    }
}

async function fetchJson(input: RequestInfo | URL, init?: RequestInit) {
    const response = await fetch(input, init);
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
        throw new Error(
            typeof payload?.error === 'string'
                ? payload.error
                : `Forensic backend request failed with status ${response.status}.`
        );
    }
    return payload;
}

function wait(ms: number) {
    return new Promise((resolve) => globalThis.setTimeout(resolve, ms));
}

async function runBackendForensicJob(tokenAddress: string) {
    const startPayload = await fetchJson('/api/forensics/jobs', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ tokenAddress })
    }) as { jobId?: string; status?: string };

    const jobId = startPayload.jobId;
    if (!jobId) {
        throw new Error('Forensic backend did not return a job id.');
    }

    const startedAt = Date.now();

    while ((Date.now() - startedAt) < JOB_TIMEOUT_MS) {
        const payload = await fetchJson(`/api/forensics/jobs/${jobId}`) as {
            status?: string;
            error?: string | null;
            report?: ForensicBundleReport | null;
        };

        if (payload.status === 'completed' && payload.report) {
            return payload.report;
        }

        if (payload.status === 'failed') {
            throw new Error(payload.error || 'Forensic backend job failed.');
        }

        await wait(JOB_POLL_INTERVAL_MS);
    }

    throw new Error('Forensic backend job timed out before completion.');
}

export { extractJitoTipTransfers, FORENSIC_MAX_TRACKED_HOPS, inferJitoLaunchSignals };
export type { ForensicBundleReport };

export const ForensicBundleService = {
    isSupported(tokenAddress: string) {
        return isLikelySolanaAddress(tokenAddress);
    },

    async analyzeToken(tokenAddress: string) {
        const normalizedAddress = tokenAddress.trim();
        if (!this.isSupported(normalizedAddress)) {
            throw new Error('Advanced forensic analysis is currently available for Solana token addresses only.');
        }

        const cached = readCachedReport(normalizedAddress);
        if (cached) {
            return cached;
        }

        const inflight = inFlightReportCache.get(normalizedAddress);
        if (inflight) {
            return inflight;
        }

        const request = runBackendForensicJob(normalizedAddress)
            .then((report) => {
                writeCachedReport(normalizedAddress, report);
                return report;
            })
            .finally(() => {
                inFlightReportCache.delete(normalizedAddress);
            });

        inFlightReportCache.set(normalizedAddress, request);
        return request;
    }
};
