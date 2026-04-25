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
const { getAlchemyHubChain, getAlchemyHubScanDepth, isEvmChain } = await import('../src/services/forensics/alchemy-hub-chains');

const PROVIDER_TIMEOUT_MS = 18_000;
const PROVIDER_ALLOWED_HOSTS = new Set([
    'deep-index.moralis.io',
    'solana-gateway.moralis.io',
    'api.gopluslabs.io'
]);

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

const server = createServer(async (request, response) => {
    const method = request.method || 'GET';
    const requestUrl = new URL(request.url || '/', `http://${request.headers.host || `127.0.0.1:${PORT}`}`);

    if (method === 'OPTIONS') {
        json(response, 204, {});
        return;
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
