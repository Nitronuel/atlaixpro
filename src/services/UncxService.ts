// Intelligence service module for Atlaix data workflows.
export const UncxService = {
    // UNCX Subgraph URLs
    // Hosted Service URLs (Proxied via The Graph Gateway if needed, or direct decentralized query)
    // Using widely available Public/Gateway endpoints for mainnets

    // Note: The Graph hosted service is sunsetting but many legacy subgraphs are still there.
    // We will use the direct decentralized query URLs or specific public endpoints.
    // For now, using these known endpoints from UNCX docs.

    // V2 Lockers
    // V2 Lockers
    V2_ETH: '/api/graph/subgraphs/name/uncx-network/univ2-liquidity-locking',
    V2_BSC: 'https://api.thegraph.com/subgraphs/name/uncx-network/pancakeswap-v2-liquidity-locking',
    // V3 Lockers
    V3_ETH: 'https://api.thegraph.com/subgraphs/name/uncx-network/v3-liquidity-locking-base', // Often base logic shared

    getSubgraphUrl: (chainId: number, isV3: boolean = false) => {
        // Simple mapping for demonstration. Expand as needed.
        if (!isV3) {
            if (chainId === 1) return UncxService.V2_ETH;
            if (chainId === 56) return UncxService.V2_BSC;
        }
        return '';
    },

    getLocks: async (pairAddress: string, chainId: number) => {
        try {
            const v2Url = UncxService.getSubgraphUrl(chainId, false);
            if (!v2Url) return null;

            // GraphQL Query for V2 Locks
            const query = `
            {
                locks(where: { pair: "${pairAddress.toLowerCase()}" }) {
                    id
                    amount
                    unlockDate
                    owner
                }
            }
            `;

            const response = await fetch(v2Url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ query })
            });

            const data = await response.json();
            if (data.data && data.data.locks && data.data.locks.length > 0) {
                return data.data.locks.map((l: any) => ({
                    amount: parseFloat(l.amount),
                    unlockDate: parseInt(l.unlockDate) * 1000, // Normalize to ms
                    isLocked: true
                }));
            }
            return null;

        } catch (e) {
            console.error("UNCX Fetch Error:", e);
            return null;
        }
    }
};
