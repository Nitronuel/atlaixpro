// Intelligence service module for Atlaix data workflows.
import { APP_CONFIG } from '../config';

type ProviderName = 'moralis' | 'goplus';

type ProviderFetchInit = Omit<RequestInit, 'body'> & {
    body?: BodyInit | null;
};

const IS_BROWSER = typeof window !== 'undefined';

function readProcessEnv(...keys: string[]) {
    if (typeof process === 'undefined') return '';
    for (const key of keys) {
        const value = process.env?.[key]?.trim();
        if (value) return value;
    }
    return '';
}

function copySafeHeaders(headers?: HeadersInit) {
    const source = new Headers(headers);
    const safe: Record<string, string> = {};

    for (const [key, value] of source.entries()) {
        const normalizedKey = key.toLowerCase();
        if (normalizedKey === 'accept' || normalizedKey === 'content-type') {
            safe[key] = value;
        }
    }

    return safe;
}

function apiUrl(path: string) {
    return APP_CONFIG.apiBaseUrl
        ? `${APP_CONFIG.apiBaseUrl.replace(/\/$/, '')}${path}`
        : path;
}

function localBackendApiUrl(path: string) {
    if (APP_CONFIG.apiBaseUrl || !IS_BROWSER || typeof window === 'undefined') return '';
    const hostname = window.location.hostname;
    if (hostname !== 'localhost' && hostname !== '127.0.0.1') return '';
    return `http://127.0.0.1:3101${path}`;
}

async function retryLocalBackend(path: string, init: RequestInit, primaryResponse: Response) {
    const fallbackUrl = localBackendApiUrl(path);
    if (!fallbackUrl || primaryResponse.status !== 404) return primaryResponse;

    try {
        return await fetch(fallbackUrl, init);
    } catch {
        return primaryResponse;
    }
}

export function getBackendAlchemyKey() {
    return readProcessEnv('ALCHEMY_API_KEY', 'VITE_ALCHEMY_KEY', 'VITE_ALCHEMY_API_KEY');
}

export async function fetchProvider(provider: ProviderName, url: string, init: ProviderFetchInit = {}) {
    if (IS_BROWSER) {
        const body = typeof init.body === 'string' ? init.body : init.body ? String(init.body) : undefined;
        const path = `/api/providers/${provider}`;
        const requestInit = {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                url,
                method: init.method || 'GET',
                headers: copySafeHeaders(init.headers),
                body
            })
        };

        const response = await fetch(apiUrl(path), requestInit);
        return retryLocalBackend(path, requestInit, response);
    }

    const headers = new Headers(init.headers);

    if (provider === 'moralis') {
        const key = readProcessEnv('MORALIS_API_KEY');
        if (key) headers.set('X-API-Key', key);
        headers.set('accept', headers.get('accept') || 'application/json');
    }

    return fetch(url, {
        ...init,
        headers
    });
}

export async function fetchAlchemyRpc(network: string, payload: unknown) {
    if (IS_BROWSER) {
        const path = '/api/providers/alchemy-rpc';
        const requestInit = {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ network, payload })
        };
        const response = await fetch(apiUrl(path), requestInit);
        return retryLocalBackend(path, requestInit, response);
    }

    const key = getBackendAlchemyKey();
    if (!key) {
        throw new Error('Alchemy API key is not configured.');
    }

    return fetch(`https://${network}.g.alchemy.com/v2/${key}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });
}
