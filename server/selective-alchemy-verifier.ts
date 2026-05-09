import type { AlphaGauntletEvent } from '../src/types';

const EVM_NETWORK_BY_CHAIN: Record<string, string> = {
    ethereum: 'eth-mainnet',
    eth: 'eth-mainnet',
    base: 'base-mainnet',
    arbitrum: 'arb-mainnet',
    polygon: 'polygon-mainnet',
    optimism: 'opt-mainnet'
};

let callsThisProcess = 0;

const readEnv = (...keys: string[]) => {
    for (const key of keys) {
        const value = process.env[key]?.trim();
        if (value) return value;
    }
    return '';
};

const readBooleanEnv = (key: string, fallback: boolean) => {
    const value = process.env[key]?.trim().toLowerCase();
    if (value === 'true') return true;
    if (value === 'false') return false;
    return fallback;
};

const readNumberEnv = (key: string, fallback: number) => {
    const value = Number(process.env[key]);
    return Number.isFinite(value) && value > 0 ? value : fallback;
};

const shouldVerify = (event: AlphaGauntletEvent) => {
    if (!readBooleanEnv('DETECTION_ALCHEMY_VERIFY_ENABLED', false)) return false;
    if (!event.token.address) return false;
    if (callsThisProcess >= readNumberEnv('DETECTION_ALCHEMY_VERIFY_MAX_CALLS', 20)) return false;
    if (event.lane === 'Market Stress' || event.lane === 'Liquidity Risk') return true;
    if (event.severity === 'High' && (event.confidence?.score || 0) < 75) return true;
    return false;
};

const rpc = async <T>(network: string, method: string, params: unknown[]): Promise<T | null> => {
    const key = readEnv('ALCHEMY_API_KEY', 'VITE_ALCHEMY_KEY', 'VITE_ALCHEMY_API_KEY');
    if (!key) return null;
    callsThisProcess += 1;

    const response = await fetch(`https://${network}.g.alchemy.com/v2/${key}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: `detection-${method}`, method, params })
    });

    if (!response.ok) return null;
    const payload = await response.json() as { result?: T };
    return payload.result || null;
};

export const SelectiveAlchemyVerifier = {
    enrichEvents: async (events: AlphaGauntletEvent[]) => {
        const enriched: AlphaGauntletEvent[] = [];

        for (const event of events) {
            if (!shouldVerify(event)) {
                enriched.push(event);
                continue;
            }

            const network = EVM_NETWORK_BY_CHAIN[event.token.chain.toLowerCase()];
            if (!network) {
                enriched.push(event);
                continue;
            }

            try {
                const [code, metadata] = await Promise.all([
                    rpc<string>(network, 'eth_getCode', [event.token.address, 'latest']),
                    rpc<Record<string, unknown>>(network, 'alchemy_getTokenMetadata', [event.token.address])
                ]);

                const reasons = event.confidence?.reasons || [];
                const verifiedEvent: AlphaGauntletEvent = {
                    ...event,
                    confidence: event.confidence
                        ? {
                            ...event.confidence,
                            score: Math.min(100, event.confidence.score + (code && code !== '0x' ? 4 : 0) + (metadata ? 2 : 0)),
                            reasons: [
                                ...reasons,
                                code && code !== '0x' ? 'Alchemy verified contract bytecode exists.' : 'Alchemy contract bytecode check was inconclusive.',
                                metadata ? 'Alchemy token metadata was available.' : 'Alchemy token metadata was unavailable.'
                            ].slice(0, 5)
                        }
                        : event.confidence
                };
                enriched.push(verifiedEvent);
            } catch {
                enriched.push(event);
            }
        }

        return enriched;
    },

    getStats: () => ({
        enabled: readBooleanEnv('DETECTION_ALCHEMY_VERIFY_ENABLED', false),
        callsThisProcess,
        maxCallsThisProcess: readNumberEnv('DETECTION_ALCHEMY_VERIFY_MAX_CALLS', 20)
    })
};
