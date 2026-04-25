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

export function getBackendAlchemyKey() {
    return readProcessEnv('ALCHEMY_API_KEY');
}

export async function fetchProvider(provider: ProviderName, url: string, init: ProviderFetchInit = {}) {
    if (IS_BROWSER) {
        const body = typeof init.body === 'string' ? init.body : init.body ? String(init.body) : undefined;

        return fetch(apiUrl(`/api/providers/${provider}`), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                url,
                method: init.method || 'GET',
                headers: copySafeHeaders(init.headers),
                body
            })
        });
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
        return fetch(apiUrl('/api/providers/alchemy-rpc'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ network, payload })
        });
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
