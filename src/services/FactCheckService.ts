
import { SolanaRpcService } from './SolanaRpcService';

export interface FactCheckResult {
    lpMint: string | null;
    burnPercent: number;
    lockedPercent: number; // Added field
    isBurned: boolean;
    largestHolders: { address: string; amount: number; uiAmount: number; percent: number; isLocked?: boolean }[];
}

export class FactCheckService {

    // Known Solana Burn Addresses
    private static BURN_ADDRESSES = [
        '11111111111111111111111111111111', // System Program
        'DeadDeap11111111111111111111111111111111', // Standard Dead
        '1nc1nerator11111111111111111111111111111111', // Incinerator
        'Gu1msz1t11111111111111111111111111111111111' // Another Dead Variant
    ];

    // Known Solana Locker Programs
    private static LOCKER_PROGRAMS = [
        'strmRqUCoQwB2FmvteYvc5n3H5vL1MaC7wrdq1dJ8Qy', // Streamflow
        'p1exdMJcjVao65QdewkaZRUnU6VPSXhus9n2GzWfh98', // Team Finance
        'PinK71d15Qed4V92cZg6tq4C345w139k46dCaaE3cxa', // PinkSale Locker
        'Locp422075586617066861218844510065094250325', // UNCX (Legacy/Placeholder - need to confirm)
        '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8', // Raydium V4 (Self-Held)
        'CPMMoo8L3FKEzbYdesnHb69EsoQDghyqEEbYCM9N3h75', // Raydium CPMM (Self-Held)
        // Add other known locker program IDs here
    ];

    static async verifySolanaLiquidity(pairAddress: string): Promise<FactCheckResult | null> {
        try {
            // 1. Get LP Mint Address from Pair (Raydium V4 assumed for now)
            const lpMint = await SolanaRpcService.getLpMintFromRaydium(pairAddress);
            if (!lpMint) {
                console.warn(`Could not extract LP Mint from pair ${pairAddress}`);
                return null;
            }

            // 2. Get Total Supply of LP Token
            const totalSupply = await SolanaRpcService.getTokenSupply(lpMint);
            if (totalSupply <= 0) return null;

            // 3. Get Largest Holders
            const holders = await SolanaRpcService.getTokenLargestAccounts(lpMint);

            // 4. Calculate Burn and Locks
            let burnedAmount = 0;
            let lockedAmount = 0;

            // We need to check owners for the top holders to detect locks
            // Limiting to top 5 to avoid API rate limits on sequential calls
            const topHoldersToCheck = holders.slice(0, 5);

            // Map specific amounts
            const parsedHolders = [];

            for (const h of holders) {
                const amount = parseFloat(h.uiAmountString || h.uiAmount || '0');
                const isBurn_ = this.BURN_ADDRESSES.includes(h.address);

                let isLocked_ = false;

                // Only check owner if it's a significant holder and not already a burn address
                if (!isBurn_ && topHoldersToCheck.includes(h)) {
                    // 1. Get the Wallet/PDA that owns the tokens
                    const walletAddress = await SolanaRpcService.getTokenAccountOwner(h.address);

                    if (walletAddress) {
                        // 2. Get the Program that owns that Wallet/PDA (e.g. Streamflow Program)
                        const ownerProgram = await SolanaRpcService.getAccountOwner(walletAddress);

                        // Wallet and program info retrieved for lock detection

                        if (ownerProgram && this.LOCKER_PROGRAMS.includes(ownerProgram)) {
                            isLocked_ = true;
                            lockedAmount += amount;
                        }
                    }
                }

                if (isBurn_) {
                    burnedAmount += amount;
                }

                parsedHolders.push({
                    address: h.address,
                    amount: amount,
                    uiAmount: amount,
                    percent: (amount / totalSupply) * 100,
                    isLocked: isLocked_
                });
            }

            const burnPercent = (burnedAmount / totalSupply) * 100;
            const lockedPercent = (lockedAmount / totalSupply) * 100;

            return {
                lpMint,
                burnPercent,
                isBurned: burnPercent > 95,
                lockedPercent, // New field to be added to interface
                largestHolders: parsedHolders
            };

        } catch (e) {
            console.error('Fact Check failed:', e);
            return null;
        }
    }
}
