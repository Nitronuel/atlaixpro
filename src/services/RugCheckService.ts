// Intelligence service module for Atlaix data workflows.

export interface RugCheckReport {
    tokenProgram: string;
    tokenType: string;
    risks: {
        name: string;
        value: string;
        level: string;
        description: string;
        score: number;
    }[];
    score: number; // 0 is best, higher is worse (Wait, RugCheck score: Lower is better? Need to verify. Usually risk score.)
    // RugCheck documentation or sample output says "score": 100 for a bad token? 
    // Sample output showed 100.
    // Let's assume standard risk score (0 safe, 100 risky).
    markets?: {
        pubkey: string;
        marketType: string;
        mintA: string;
        mintB: string;
        mintLP: string;
        liquidityA: string;
        liquidityB: string;
        lp: {
            base: string;
            quote: string;
            lpLocked: number; // % Locked? Or amount?
            lpLockedPct: number; // % Locked (0-100)
            lpBurnedPct: number; // % Burned (0-100)
            tokenSupply: number;
            locks?: {
                amount: number;
                unlockTime: number; // Timestamp (ms or s?)
            }[];
        };
    }[];
    // Top level fields sometimes differ, checking "summary" endpoint vs "report"
    // The previous sample output was from /report/summary.
    // Sample: { "tokenProgram":..., "risks": [...], "score": 100, "markets": [...] }
}

export class RugCheckService {
    private static BASE_URL = 'https://api.rugcheck.xyz/v1';

    static async fetchTokenReport(mintAddress: string): Promise<RugCheckReport | null> {
        try {
            const response = await fetch(`${this.BASE_URL}/tokens/${mintAddress}/report/summary`);
            if (!response.ok) {
                console.warn(`RugCheck API Error: ${response.status} ${response.statusText}`);
                return null;
            }
            return await response.json();
        } catch (e) {
            console.error('RugCheck fetch failed:', e);
            return null;
        }
    }
}
