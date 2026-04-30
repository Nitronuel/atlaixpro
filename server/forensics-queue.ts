// Atlaix: Local queue management for asynchronous forensic scan jobs.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ForensicBundleReport } from '../src/services/forensics/types';

export type ForensicJobState = 'queued' | 'running' | 'completed' | 'failed';
export type ForensicJobStage =
    | 'queued'
    | 'cache_hit'
    | 'retrying'
    | 'hydrating_inputs'
    | 'history_reconstruction'
    | 'wallet_enrichment'
    | 'graph_expansion'
    | 'cluster_scoring'
    | 'report_materialization'
    | 'completed'
    | 'failed';

export type ForensicJob = {
    id: string;
    tokenAddress: string;
    status: ForensicJobState;
    stage: ForensicJobStage;
    createdAt: string;
    updatedAt: string;
    error: string | null;
    attemptCount: number;
    nextRunAt: string | null;
    report: ForensicBundleReport | null;
};

type PersistedForensicRecord = {
    tokenAddress: string;
    savedAt: string;
    report: ForensicBundleReport;
};

type PersistedQueueState = {
    jobs: ForensicJob[];
};

type QueueStats = {
    queuedJobs: number;
    runningJobs: number;
    cachedJobs: number;
    failedJobs: number;
    backend: 'local_durable';
};

const MAX_COMPLETED_CACHE = 60;
const MAX_RETRIES = 3;
const POLL_INTERVAL_MS = 500;

function nowIso() {
    return new Date().toISOString();
}

function normalizeAddress(value: string) {
    return value.trim();
}

function isTransientError(error: unknown) {
    const message = error instanceof Error ? error.message : String(error || '');
    return /\b429\b|too many requests|timeout|timed out|temporar|503|network|etimedout|econnreset|rate limit/i.test(message);
}

function getRetryDelayMs(attemptCount: number) {
    return Math.min(30_000, 1_500 * 2 ** Math.max(0, attemptCount - 1));
}

export class LocalDurableForensicsQueue {
    private readonly queueDir: string;
    private readonly cacheDir: string;
    private readonly queueFile: string;
    private readonly jobs = new Map<string, ForensicJob>();
    private processorActive = false;
    private pollTimer: NodeJS.Timeout | null = null;
    private readonly activeTokens = new Set<string>();

    constructor(private readonly cwd: string) {
        this.queueDir = resolve(cwd, 'data', 'forensics-queue');
        this.cacheDir = resolve(cwd, 'data', 'forensics-cache');
        this.queueFile = resolve(this.queueDir, 'jobs.json');
        mkdirSync(this.queueDir, { recursive: true });
        mkdirSync(this.cacheDir, { recursive: true });
        this.load();
    }

    start(processor: (tokenAddress: string, stage: (nextStage: ForensicJobStage) => void) => Promise<ForensicBundleReport>) {
        if (this.processorActive) {
            return;
        }

        this.processorActive = true;
        this.pollTimer = globalThis.setInterval(() => {
            void this.tick(processor);
        }, POLL_INTERVAL_MS);
        void this.tick(processor);
    }

    stop() {
        this.processorActive = false;
        if (this.pollTimer) {
            globalThis.clearInterval(this.pollTimer);
            this.pollTimer = null;
        }
    }

    getStats(): QueueStats {
        const jobs = [...this.jobs.values()];
        return {
            queuedJobs: jobs.filter((job) => job.status === 'queued').length,
            runningJobs: jobs.filter((job) => job.status === 'running').length,
            cachedJobs: jobs.filter((job) => job.status === 'completed').length,
            failedJobs: jobs.filter((job) => job.status === 'failed').length,
            backend: 'local_durable'
        };
    }

    enqueue(job: ForensicJob) {
        this.jobs.set(job.id, job);
        this.compactCompletedJobs();
        this.persist();
        return job;
    }

    getJob(jobId: string) {
        const job = this.jobs.get(jobId);
        if (!job) return null;
        if (job.status === 'completed' && !job.report) {
            job.report = this.readPersistedReport(job.tokenAddress)?.report || null;
        }
        return job;
    }

    findReusableJob(tokenAddress: string) {
        const normalizedToken = normalizeAddress(tokenAddress);
        const jobs = [...this.jobs.values()]
            .filter((job) => job.tokenAddress === normalizedToken)
            .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));

        return jobs.find((job) => job.status === 'queued' || job.status === 'running' || (job.status === 'completed' && Boolean(job.report || this.readPersistedReport(job.tokenAddress)?.report))) || null;
    }

    createQueuedJob(id: string, tokenAddress: string) {
        const persisted = this.readPersistedReport(tokenAddress);
        if (persisted?.report) {
            const job: ForensicJob = {
                id,
                tokenAddress,
                status: 'completed',
                stage: 'cache_hit',
                createdAt: nowIso(),
                updatedAt: persisted.savedAt,
                error: null,
                attemptCount: 0,
                nextRunAt: null,
                report: persisted.report
            };
            return this.enqueue(job);
        }

        return this.enqueue({
            id,
            tokenAddress,
            status: 'queued',
            stage: 'queued',
            createdAt: nowIso(),
            updatedAt: nowIso(),
            error: null,
            attemptCount: 0,
            nextRunAt: null,
            report: null
        });
    }

    writePersistedReport(tokenAddress: string, report: ForensicBundleReport) {
        const filepath = this.getCachePath(tokenAddress);
        const payload: PersistedForensicRecord = {
            tokenAddress,
            savedAt: nowIso(),
            report
        };
        writeFileSync(filepath, JSON.stringify(payload));
    }

    private getCachePath(tokenAddress: string) {
        return resolve(this.cacheDir, `${tokenAddress}.json`);
    }

    private readPersistedReport(tokenAddress: string) {
        const filepath = this.getCachePath(tokenAddress);
        if (!existsSync(filepath)) {
            return null;
        }

        try {
            return JSON.parse(readFileSync(filepath, 'utf8')) as PersistedForensicRecord;
        } catch {
            return null;
        }
    }

    private load() {
        if (!existsSync(this.queueFile)) {
            return;
        }

        try {
            const payload = JSON.parse(readFileSync(this.queueFile, 'utf8')) as PersistedQueueState;
            for (const job of payload.jobs || []) {
                const recoveredJob = job.status === 'running'
                    ? {
                        ...job,
                        status: 'queued' as const,
                        stage: 'retrying' as const,
                        error: 'Recovered after worker restart.',
                        nextRunAt: nowIso(),
                        updatedAt: nowIso()
                    }
                    : job;
                this.jobs.set(recoveredJob.id, recoveredJob);
            }
        } catch {
            // Ignore malformed queue file and rebuild from fresh state.
        }
    }

    private persist() {
        const payload: PersistedQueueState = {
            jobs: [...this.jobs.values()]
        };
        writeFileSync(this.queueFile, JSON.stringify(payload));
    }

    private compactCompletedJobs() {
        const completed = [...this.jobs.values()]
            .filter((job) => job.status === 'completed' || job.status === 'failed')
            .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
        const toDelete = completed.slice(MAX_COMPLETED_CACHE);
        for (const job of toDelete) {
            this.jobs.delete(job.id);
        }
    }

    private getNextRunnableJob() {
        const now = Date.now();
        return [...this.jobs.values()]
            .filter((job) => {
                if (job.status !== 'queued') return false;
                if (this.activeTokens.has(job.tokenAddress)) return false;
                if (!job.nextRunAt) return true;
                return Date.parse(job.nextRunAt) <= now;
            })
            .sort((left, right) => left.createdAt.localeCompare(right.createdAt))[0] || null;
    }

    private async tick(processor: (tokenAddress: string, stage: (nextStage: ForensicJobStage) => void) => Promise<ForensicBundleReport>) {
        if (!this.processorActive) {
            return;
        }

        const job = this.getNextRunnableJob();
        if (!job) {
            return;
        }

        this.activeTokens.add(job.tokenAddress);
        job.status = 'running';
        job.stage = 'hydrating_inputs';
        job.updatedAt = nowIso();
        job.error = null;
        job.nextRunAt = null;
        this.persist();

        try {
            const report = await processor(job.tokenAddress, (nextStage) => {
                job.stage = nextStage;
                job.updatedAt = nowIso();
                this.persist();
            });
            job.stage = 'report_materialization';
            job.updatedAt = nowIso();
            this.writePersistedReport(job.tokenAddress, report);
            job.status = 'completed';
            job.stage = 'completed';
            job.report = report;
            job.updatedAt = nowIso();
            job.error = null;
            this.compactCompletedJobs();
            this.persist();
        } catch (error) {
            job.attemptCount += 1;
            job.updatedAt = nowIso();
            job.report = null;
            const message = error instanceof Error ? error.message : 'Forensic analysis failed.';

            if (job.attemptCount < MAX_RETRIES && isTransientError(error)) {
                job.status = 'queued';
                job.stage = 'retrying';
                job.error = message;
                job.nextRunAt = new Date(Date.now() + getRetryDelayMs(job.attemptCount)).toISOString();
            } else {
                job.status = 'failed';
                job.stage = 'failed';
                job.error = message;
                job.nextRunAt = null;
            }

            this.compactCompletedJobs();
            this.persist();
        } finally {
            this.activeTokens.delete(job.tokenAddress);
        }
    }
}
