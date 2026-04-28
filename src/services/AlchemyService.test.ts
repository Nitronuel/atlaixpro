import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./ProviderGateway', () => ({
    fetchAlchemyRpc: vi.fn(),
    getBackendAlchemyKey: () => 'test-key'
}));

const { fetchAlchemyRpc } = await import('./ProviderGateway');
const { AlchemyService } = await import('./AlchemyService');

describe('AlchemyService', () => {
    beforeEach(() => {
        vi.mocked(fetchAlchemyRpc).mockReset();
    });

    it('parses bulk token prices from Alchemy result data', async () => {
        vi.mocked(fetchAlchemyRpc).mockResolvedValueOnce(new Response(JSON.stringify({
            result: {
                data: [
                    {
                        address: '0x1111111111111111111111111111111111111111',
                        prices: [{ currency: 'usd', value: '1.25' }]
                    }
                ]
            }
        }), { status: 200 }));

        const result = await AlchemyService.getBulkPrices(['0x1111111111111111111111111111111111111111'], 'Ethereum');

        expect(result['0x1111111111111111111111111111111111111111']).toBe(1.25);
    });
});
