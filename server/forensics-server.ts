import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { URL } from 'node:url';
import { LocalDurableForensicsQueue } from './forensics-queue';

const PORT = Number(process.env.FORENSICS_PORT || 3101);
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

const { analyzeForensicToken } = await import('../src/services/forensics/engine');
const { analyzeAlchemyHubToken } = await import('../src/services/forensics/alchemy-hub');
const { analyzeAlchemyHubEvmToken } = await import('../src/services/forensics/alchemy-hub-evm');
const { getAlchemyHubChain, isEvmChain } = await import('../src/services/forensics/alchemy-hub-chains');

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

function isLikelySolanaAddress(value: string) {
    const trimmed = value.trim();
    return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(trimmed);
}

function isLikelyEvmAddress(value: string) {
    return /^0x[a-fA-F0-9]{40}$/.test(value.trim());
}

async function readJsonBody(request: import('node:http').IncomingMessage) {
    const chunks: Buffer[] = [];
    for await (const chunk of request) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    const raw = Buffer.concat(chunks).toString('utf8');
    return raw ? JSON.parse(raw) : {};
}

queue.start(async (tokenAddress, stage) => {
    stage('history_reconstruction');
    const report = await analyzeForensicToken(tokenAddress);
    stage(report.scanStats.usedWalletApi ? 'cluster_scoring' : 'graph_expansion');
    return report;
});

const server = createServer(async (request, response) => {
    const method = request.method || 'GET';
    const requestUrl = new URL(request.url || '/', `http://${request.headers.host || `127.0.0.1:${PORT}`}`);

    if (method === 'OPTIONS') {
        json(response, 204, {});
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

            const report = isEvmChain(selectedChain)
                ? await analyzeAlchemyHubEvmToken(tokenAddress, selectedChain)
                : await analyzeAlchemyHubToken(tokenAddress);
            json(response, 200, { report });
            return;
        } catch (error) {
            json(response, 500, {
                error: error instanceof Error ? error.message : 'Could not build Alchemy Hub map.'
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

    if (method === 'GET' && requestUrl.pathname === '/api/forensics/health') {
        const stats = queue.getStats();
        json(response, 200, {
            ok: true,
            ...stats
        });
        return;
    }

    json(response, 404, { error: 'Not found.' });
});

server.listen(PORT, '127.0.0.1', () => {
    console.log(`[ForensicsServer] listening on http://127.0.0.1:${PORT}`);
});
