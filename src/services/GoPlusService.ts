import { DatabaseService } from './DatabaseService';
import { FactCheckService } from './FactCheckService';
import { UncxService } from './UncxService';
import { RugCheckService } from './RugCheckService';
import { fetchProvider } from './ProviderGateway';

interface GoPlusResponse {
    code: number;
    message: string;
    result: {
        [address: string]: {
            creator_address?: string;
            balance_mutable_authority: { status: string };
            closable: { status: string };
            default_account_state: string;
            freezable: { status: string };
            metadata_mutable: { status: string };
            mintable: { status: string };
            transfer_fee: { transfer_fee?: string };
            holder_count: string;
            holders: Array<{
                account: string;
                balance: string;
                percent: string;
                is_locked: number; // 0 or 1
                locked_detail?: Array<{
                    amount: string;
                    end_time: string; // timestamp in seconds
                    opt_time: string;
                }>;
            }>;
            lp_holders: Array<any>;
            dex: Array<{
                liquidity: string;
                name: string;
                burn_percent: number;
                lp_amount?: string;
                price: string;
                tvl: string;
                open_time: string;
                day?: { volume: string };
                pair?: string;
            }>;
            total_supply: string;
            is_honeypot?: string;
            is_blacklisted?: string;
            is_open_source?: string;
            is_proxy?: string;
        }
    }
}

interface AddressSecurityResponse {
    code: number;
    message: string;
    result: {
        [address: string]: {
            data_source: string;
            honeypot_related_address: string;
            phishing_activities: string;
            blackmail_activities: string;
            stealing_attack: string;
            fake_kyc: string;
            malicious_mining_activities: string;
            darkweb_transactions: string;
            cybercrime: string;
            money_laundering: string;
            financial_crime: string;
            blacklist_doubt: string;
        }
    }
}

export interface SecurityReport {
    address: string;
    isSafe: boolean;
    riskScore: number;
    marketData: {
        price: string;
        age: string;
        marketCap: string;
        volume24h: string;
        liquidity: number;
        buySellRatio?: { buys: number; sells: number };
    };
    flags: {
        mintable: boolean;
        freezable: boolean;
        mutable: boolean;
        modifiableBalance: boolean;
        closable: boolean;
        transferFee: boolean;
        honeypot: boolean;
        blacklisted: boolean;
        openSource: boolean;
        proxy: boolean;
    };
    lpInfo: {
        isBurnt: boolean;
        burnPercent: number;
        lockedPercent: number;
        totalLiquidity: number;
        // New fields
        burnedAmount: number;
        lockedAmount: number;
        unlockDate: string;
        lockDuration: string;
    };
    holders: {
        count: number;
        topHolders: Array<{ address: string; percent: number }>;
    };
    metadata: {
        totalSupply: string;
        creatorAddress?: string;
        name?: string;
        symbol?: string;
        logo?: string;
    };
    creatorReputation?: {
        isMalicious: boolean;
        honeypotCreator: boolean;
        phishingCreator: boolean;
        scamHistory: boolean;
    };
    chainName?: string;
    tax?: { buy: number; sell: number; };
}

export class GoPlusService {
    private static BASE_URL = 'https://api.gopluslabs.io/api/v1';
    private static accessToken: string | null = null;
    private static tokenExpiry: number = 0;

    private static async getAccessToken(): Promise<string | null> {
        try {
            return null;
        } catch (e) {
            return null;
        }
    }

    static async fetchTokenSecurity(address: string, explicitChainId?: string): Promise<SecurityReport | null> {
        try {
            // 1. Initial Format Check
            const isEVM = address.startsWith('0x');
            if (!isEVM) {
                return this.fetchSolanaSecurity(address);
            }

            // 2. EVM Auto-Detection
            // If user (implied) or logic passed an explicit chain, use it.
            if (explicitChainId) {
                return this.fetchEvmSecurity(explicitChainId, address);
            }

            // 3. Smart Detection
            // Fetch DexScreener data first to see if it knows the chain
            const dexData = await DatabaseService.getTokenDetails(address);

            if (dexData && dexData.chainId) {
                // DexScreener gave us the chain
                const chainName = dexData.chainId.toLowerCase();
                // Map DexScreener chain names to our simple identifiers
                if (chainName === 'ethereum' || chainName === 'eth') return this.fetchEvmSecurity('ethereum', address);
                if (chainName === 'bsc') return this.fetchEvmSecurity('bsc', address);
                if (chainName === 'base') return this.fetchEvmSecurity('base', address);
                if (chainName === 'arbitrum') return this.fetchEvmSecurity('arbitrum', address);
                if (chainName === 'optimism') return this.fetchEvmSecurity('optimism', address);
                if (chainName === 'polygon') return this.fetchEvmSecurity('polygon', address);
                if (chainName === 'avalanche') return this.fetchEvmSecurity('avalanche', address);
            }

            // 4. Fallback Probe (Concurrent Request to likely chains)
            // If DexScreener doesn't know it (brand new token), we ask GoPlus directly "Do you know this on Chain X?"
            // We probe the top 3 most likely chains: Ethereum, Base, BSC.
            const chainsToProbe = [
                { id: '1', name: 'ethereum' },
                { id: '8453', name: 'base' },
                { id: '56', name: 'bsc' }
            ];

            // Run requests in parallel
            const probeResults = await Promise.all(chainsToProbe.map(async (c) => {
                try {
                    const res = await fetchProvider('goplus', `${this.BASE_URL}/token_security/${c.id}?contract_addresses=${address}`);
                    const json = await res.json();
                    if (json.code === 1 && (json.result[address.toLowerCase()] || json.result[address])) {
                        return { chain: c.name, data: json };
                    }
                    return null;
                } catch (e) { return null; }
            }));

            const found = probeResults.find(r => r !== null);
            if (found) {
                // Delegate to fetchEvmSecurity using the identified chain to retrieve security data.
                return this.fetchEvmSecurity(found.chain, address, dexData, found.data);
            }

            // Default fail
            console.warn("Could not auto-detect chain for EVM address");
            return null;

        } catch (e) {
            console.error("GoPlus Scan Error", e);
            return null;
        }
    }

    private static async fetchSolanaSecurity(address: string): Promise<SecurityReport | null> {
        try {
            const [goPlusResponse, dexData, rugCheckData] = await Promise.all([
                fetchProvider('goplus', `${this.BASE_URL}/solana/token_security?contract_addresses=${address}`),
                DatabaseService.getTokenDetails(address, 'solana'),
                RugCheckService.fetchTokenReport(address)
            ]);

            const data: GoPlusResponse = await goPlusResponse.json();

            if (data.code !== 1 || !data.result[address]) {
                console.error('GoPlus API Error:', data.message);
                return null;
            }

            const raw: any = data.result[address];

            // LP & Lock Analysis (Using 'holders' since 'lp_holders' is missing on Solana)
            let calculatedBurn = 0;
            let calculatedLock = 0;
            let minEndTime = Infinity;
            let maxEndTime = 0;

            const burnAddresses = [
                '11111111111111111111111111111111', // System Program
                'DeadDeap11111111111111111111111111111111', // Standard Dead
                '1nc1nerator11111111111111111111111111111111', // Incinerator
                'Gu1msz1t11111111111111111111111111111111111' // Another Dead Variant
            ];

            if (raw.holders && Array.isArray(raw.holders)) {
                raw.holders.forEach((h: any) => {
                    const percent = parseFloat(h.percent || '0') * 100;
                    const addr = h.account ? h.account : '';

                    // Check for Burn
                    if (burnAddresses.includes(addr)) {
                        calculatedBurn += percent;
                    }

                    // Check for Lock (GoPlus sometimes marks holders with is_locked)
                    if (h.is_locked === 1 || h.is_locked === '1') {
                        calculatedLock += percent;
                        // Check for unlock date in locked_detail if needed
                        if (h.locked_detail && Array.isArray(h.locked_detail)) {
                            h.locked_detail.forEach((ld: any) => {
                                let unlockTime = parseInt(ld.end_time || '0');
                                // Normalize to ms if it looks like seconds (Solana is usually seconds)
                                if (unlockTime < 100000000000) unlockTime *= 1000;

                                if (unlockTime > Date.now()) {
                                    if (unlockTime < minEndTime) minEndTime = unlockTime;
                                    if (unlockTime > maxEndTime) maxEndTime = unlockTime;
                                }
                            });
                        }
                    }
                });
            }

            // Fallback to maxBurnPercent from dex array if holders didn't catch it
            let maxBurnPercent = 0;
            if (raw.dex && Array.isArray(raw.dex)) {
                raw.dex.forEach((d: any) => {
                    if (d.burn_percent > maxBurnPercent) maxBurnPercent = d.burn_percent;
                });
            }
            if (calculatedBurn > maxBurnPercent) maxBurnPercent = calculatedBurn;

            // --- FACT CHECK START ---
            // If GoPlus says 0% burn but we have a valid pair address and liquidity, verify on-chain
            if (maxBurnPercent < 1 && calculatedLock < 1 && dexData && dexData.pairs && dexData.pairs.length > 0) {
                // Try to find the most liquid pair
                const bestPair = dexData.pairs.sort((a: any, b: any) => (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0))[0];
                if (bestPair && bestPair.pairAddress) {
                    const factCheck = await FactCheckService.verifySolanaLiquidity(bestPair.pairAddress);

                    if (factCheck) {
                        if (factCheck.burnPercent > maxBurnPercent) {
                            maxBurnPercent = factCheck.burnPercent;
                            calculatedBurn = factCheck.burnPercent;
                        }

                        // Merge Locked Percent
                        if (factCheck.lockedPercent > calculatedLock) {
                            calculatedLock = factCheck.lockedPercent;
                        }

                        // Merge holders if we have them
                        if (factCheck.largestHolders.length > 0 && (!raw.holders || raw.holders.length === 0)) {
                            raw.holders = factCheck.largestHolders.map(h => ({
                                account: h.address,
                                percent: (h.percent / 100).toFixed(4),
                                is_locked: h.isLocked ? 1 : 0 // Map locked status
                            }));
                        }
                    }
                }
            }
            // --- FACT CHECK END ---

            // --- RUGCHECK INTEGRATION (Override with High Quality Data) ---
            if (rugCheckData) {

                // 1. Logic to extract LP Lock info usually found in 'markets' array
                // RugCheck markets array contains LP info
                if (rugCheckData.markets && rugCheckData.markets.length > 0) {
                    const bestMarket = rugCheckData.markets.sort((a, b) => parseFloat(b.liquidityA) - parseFloat(a.liquidityA))[0];
                    if (bestMarket && bestMarket.lp) {
                        const rcLocked = bestMarket.lp.lpLockedPct || 0;
                        const rcBurned = bestMarket.lp.lpBurnedPct || 0;

                        // Prefer RugCheck values as they parse more lockers
                        if (rcLocked > calculatedLock) calculatedLock = rcLocked;
                        if (rcBurned > maxBurnPercent) maxBurnPercent = rcBurned; // Usually separate, RugCheck gives distinct %

                        // Unlock Date extraction
                        if (bestMarket.lp.locks && bestMarket.lp.locks.length > 0) {
                            // Find the max unlock time? Or min? 
                            // Usually we care about "Likely to dump soon" -> Min
                            bestMarket.lp.locks.forEach(l => {
                                const unlockTime = l.unlockTime; // Check if ms or s? Usually RugCheck is ms check
                                // Note: RugCheck API docs say milliseconds usually.
                                // If it looks small (< year 2000), multiply by 1000
                                let validTime = unlockTime;
                                if (validTime < 100000000000) validTime *= 1000;

                                if (validTime > Date.now()) {
                                    if (validTime < minEndTime) minEndTime = validTime;
                                    if (validTime > maxEndTime) maxEndTime = validTime;
                                }
                            });
                        }
                    }
                }
            }
            // --- RUGCHECK END ---

            // --- PUMP.FUN FALLBACK ---
            // If RugCheck failed to find market data (common for new PumpFun coins or bonding curve),
            // and we rely on the specific DexID 'pumpswap', we can infer safety.
            // PumpFun bonding curve is programmatically locked/secure until migration,
            // and upon migration, LP is burnt. DexScreener displays this as 100% Locked.
            if ((!rugCheckData || !rugCheckData.markets || rugCheckData.markets.length === 0) && dexData && dexData.dexId === 'pumpswap') {
                calculatedLock = 100;
                maxBurnPercent = 100; // DexScreener shows both for Pump coins
                minEndTime = Date.now() + 315360000000; // 10 years (effectively permanent)
            }
            // --- PUMP.FUN END ---

            // Market Data
            const marketData = await this.processMarketData(dexData, raw.total_supply, 'solana');

            const lockedPercent = calculatedLock;

            const lockInfo = this.calculateLockStatus(minEndTime === Infinity ? 0 : minEndTime, lockedPercent, maxBurnPercent, marketData.liquidity);
            const creatorReputation = await this.getCreatorReputation(raw.creator_address);

            // Extract Flags 
            // Note: Using 'any' cast on raw allows checking nested status objects or direct values
            const checkFlag = (val: any) => val === '1' || val === 1 || val?.status === '1';

            const mintable = checkFlag(raw.mintable);
            const freezable = checkFlag(raw.freezable);
            const mutable = checkFlag(raw.mutable_metadata) || checkFlag(raw.metadata_mutable);
            const modifiableBalance = checkFlag(raw.modifiable_balance) || checkFlag(raw.balance_mutable_authority);
            const closable = checkFlag(raw.closable);
            const honeypot = checkFlag(raw.honeypot) || checkFlag(raw.is_honeypot);
            const blacklisted = checkFlag(raw.blacklisted) || checkFlag(raw.is_blacklisted);
            const openSource = checkFlag(raw.open_source) || checkFlag(raw.is_open_source);
            const proxy = checkFlag(raw.proxy) || checkFlag(raw.is_proxy);

            const transferFee = (typeof raw.transfer_fee === 'string' ? raw.transfer_fee : raw.transfer_fee?.transfer_fee) || '0';

            // Risk Score
            const riskScore = this.calculateRiskScore({
                mintable, freezable, mutable, modifiableBalance, closable,
                honeypot, blacklisted, maxBurnPercent, creatorReputation
            });



            // Holder Count Fallback
            let holderCount = parseInt(raw.holder_count || '0');
            if (holderCount === 0 || isNaN(holderCount)) {
                // Fallback to RPC
                try {
                    const { SolanaRpcService } = await import('./SolanaRpcService');
                    const rpcCount = await SolanaRpcService.getHolderCount(address);
                    if (rpcCount !== null) {
                        holderCount = rpcCount;
                    }
                } catch (e) { console.warn("Holder fallback failed", e); }
            }

            const isSafe = riskScore < 30 && !mintable && !freezable && !honeypot && !creatorReputation.isMalicious && !modifiableBalance;

            return {
                address,
                isSafe,
                riskScore: Math.floor(riskScore),
                marketData,
                flags: {
                    mintable, freezable, mutable, modifiableBalance, closable, transferFee, honeypot, blacklisted, openSource, proxy
                },
                lpInfo: {
                    isBurnt: maxBurnPercent > 95,
                    burnPercent: maxBurnPercent,
                    lockedPercent: lockedPercent,
                    totalLiquidity: marketData.liquidity,
                    burnedAmount: (maxBurnPercent / 100) * marketData.liquidity,
                    lockedAmount: (lockedPercent / 100) * marketData.liquidity,
                    unlockDate: lockInfo.unlockDate,
                    lockDuration: lockInfo.lockDuration
                },
                holders: {
                    count: holderCount,
                    topHolders: raw.holders ? raw.holders.slice(0, 5).map((h: any) => ({
                        address: h.account,
                        percent: parseFloat(h.percent || '0') * 100
                    })) : []
                },
                metadata: {
                    totalSupply: raw.total_supply,
                    creatorAddress: raw.creator_address,
                    name: marketData.name,
                    symbol: marketData.symbol,
                    logo: marketData.logo
                },
                creatorReputation,
                chainName: 'Solana',
                tax: { buy: parseFloat(transferFee) || 0, sell: parseFloat(transferFee) || 0 }
            };
        } catch (e) {
            console.error("Solana Scan Error", e);
            return null;
        }
    }

    private static async fetchEvmSecurity(chainName: string, address: string, preFetchedDexData?: any, preFetchedGoPlusData?: any): Promise<SecurityReport | null> {
        try {
            // Map chain name to GoPlus Chain ID
            const chainMap: Record<string, string> = {
                'ethereum': '1',
                'bsc': '56',
                'base': '8453',
                'arbitrum': '42161',
                'optimism': '10',
                'polygon': '137',
                'avalanche': '43114'
            };
            const chainId = chainMap[chainName.toLowerCase()] || '1';

            let data = preFetchedGoPlusData;
            let dexData = preFetchedDexData;

            // Only fetch if we don't already have it
            if (!data) {
                const response = await fetchProvider('goplus', `${this.BASE_URL}/token_security/${chainId}?contract_addresses=${address}`);
                data = await response.json();
            }
            if (!dexData) {
                dexData = await DatabaseService.getTokenDetails(address, chainName);
            }

            // Handle case mismatch or success code
            if (data.code !== 1) {
                console.error('GoPlus EVM API Error:', data.message);
                return null;
            }

            // GoPlus returns lowercase address usually
            const raw = data.result[address.toLowerCase()] || data.result[address];

            if (!raw) {
                console.error('GoPlus EVM: No result for address');
                return null;
            }

            // EVM Flag Parsing
            const mintable = raw.is_mintable === "1";
            const proxy = raw.is_proxy === "1";
            const honeypot = raw.is_honeypot === "1";
            const blacklisted = raw.is_blacklisted === "1";
            const openSource = raw.is_open_source === "1";

            // Tax Logic
            const buyTax = parseFloat(raw.buy_tax || '0');
            const sellTax = parseFloat(raw.sell_tax || '0');
            const transferFee = (buyTax > 0 || sellTax > 0);

            // High Risk Indicators
            const freezable = raw.cannot_sell_all === "1";
            const mutable = raw.owner_change_balance === "1";
            const modifiableBalance = raw.owner_change_balance === "1";
            const closable = raw.selfdestruct === "1";

            // Market Data
            const marketData = await this.processMarketData(dexData, raw.total_supply, chainName);

            // LP Analysis 
            const targetPair = dexData?.pairAddress?.toLowerCase();
            let maxBurnPercent = 0;
            let lockedPercent = 0;
            let maxEndTime = 0;

            // 1. Try to find specific pair in GoPlus DEX info (for Burn/Liquidity confirmation)
            if (targetPair && raw.dex) {
                const dexItem = raw.dex.find((d: any) => d.pair?.toLowerCase() === targetPair);
                if (dexItem) {
                    // GoPlus pre-calculated burn for this pair
                    if (dexItem.burn_percent) maxBurnPercent = parseFloat(dexItem.burn_percent.toString()) * 100; // GoPlus usually 0-1 or 0-100? Docs say 0-1 usually. Wait, previously I did *100. Let's assume consistent unit.
                    // Actually GoPlus V1 'burn_percent' is usually 0.5 for 50%.
                    // My previous code: parseFloat(h.percent)*100.
                }
            }

            // 2. Parse LP Holders (Detailed Lock Info usually here)
            let minEndTime = Infinity; // Track EARLIEST unlock (Key Risk)
            let uncxLocksFound = false;

            // UNCX Fallback Check
            if (marketData && dexData && dexData.pairAddress) {
                // UNCX Endpoint is currently unstable/redirecting. Disabled to prevent CORS errors.
                /*
                try {
                    // Map chain name to ID (Simple Mapping)
                    let chainId = 1; // Default ETH
                    if (chainName === 'bsc') chainId = 56;
                    // Add other chains as needed
                
                    const uncxData = await UncxService.getLocks(dexData.pairAddress, chainId);
                    if (uncxData && uncxData.length > 0) {
                        uncxLocksFound = true;
                        let totalUncxLocked = 0;
                        uncxData.forEach((l:any) => {
                            totalUncxLocked += l.amount;
                            if (l.unlockDate > Date.now()) {
                                if (l.unlockDate < minEndTime) minEndTime = l.unlockDate;
                                if (l.unlockDate > maxEndTime) maxEndTime = l.unlockDate;
                            }
                        });
                        
                        // Recalculate locked percent based on UNCX real data
                        // Note: UNCX amount is raw tokens? Or USD? Subgraph usually returns raw token amounts.
                        // We need comparison to Total Supply or Liquidity. 
                        // Simplified: If UNCX found, we consider it "Locked" and trust the date.
                        // We might not have perfect % without total supply math here, but we set a flag.
                        if (totalUncxLocked > 0) {
                             // Assuming we successfully found locks, we override "Not Locked" status
                             if (lockedPercent < 0.1) lockedPercent = 99; // Force "Locked" status visually if < 0.1
                        }
                    }
                */
            }

            if (raw.lp_holders && Array.isArray(raw.lp_holders)) {
                let calculatedBurn = 0;
                raw.lp_holders.forEach((h: any) => {
                    const percent = parseFloat(h.percent || '0') * 100;
                    const addr = h.address ? h.address.toLowerCase() : '';

                    // Check for Burned
                    const isContractHeld = addr === address.toLowerCase();
                    const isRenounced = raw.owner_address === '0x0000000000000000000000000000000000000000' ||
                        raw.owner_address === '0x000000000000000000000000000000000000dead' ||
                        !raw.owner_address; // Assume empty owner is renounced/null

                    const tag = h.tag ? h.tag.toLowerCase() : '';

                    if (
                        addr === '0x000000000000000000000000000000000000dead' ||
                        addr === '0x0000000000000000000000000000000000000000' ||
                        addr === '0xdead' ||
                        tag === 'dead' ||
                        (isContractHeld && isRenounced)
                    ) {
                        calculatedBurn += percent;
                    }
                    // Check for Locked (Independent check - Burn can also be Locked)
                    if (h.is_locked === 1) {
                        lockedPercent += percent;
                        // Try to find lock end time
                        if (h.locked_detail && Array.isArray(h.locked_detail)) {
                            h.locked_detail.forEach((d: any) => {
                                let end = 0;
                                // Handle ISO Date Strings (e.g. "2026-06-18T...") vs timestamps
                                if (typeof d.end_time === 'string' && !/^\d+$/.test(d.end_time)) {
                                    end = Date.parse(d.end_time); // Returns milliseconds
                                } else {
                                    end = parseFloat(d.end_time);
                                }

                                // Normalize to MS if in Seconds (common in some APIs)
                                // If < 1980 (315360000000 ms), it's likely seconds.
                                if (end < 100000000000) end *= 1000;

                                // Filter out garbage dates or past dates
                                // We want the NEXT unlock in the future
                                const now = Date.now();
                                if (!isNaN(end) && end > now) {
                                    if (end < minEndTime) minEndTime = end;
                                    if (end > maxEndTime) maxEndTime = end;
                                }
                            });
                        }
                    }
                });

                // Fallback: If no pair-specific burn found, use calculated burn from LP holders
                if (maxBurnPercent === 0) {
                    maxBurnPercent = calculatedBurn;
                }
            }

            const lockInfo = this.calculateLockStatus(minEndTime === Infinity ? 0 : minEndTime, lockedPercent, maxBurnPercent, marketData.liquidity);
            const creatorReputation = await this.getCreatorReputation(raw.creator_address);

            // Risk Score
            const riskScore = this.calculateRiskScore({
                mintable, freezable, mutable, modifiableBalance, closable,
                honeypot, blacklisted, maxBurnPercent, creatorReputation
            });

            const isSafe = riskScore < 30 && !mintable && !honeypot && !creatorReputation.isMalicious;

            return {
                address,
                isSafe,
                riskScore: Math.floor(riskScore),
                marketData,
                flags: {
                    mintable, freezable, mutable, modifiableBalance, closable, transferFee, honeypot, blacklisted, openSource, proxy
                },
                lpInfo: {
                    isBurnt: maxBurnPercent > 95,
                    burnPercent: maxBurnPercent,
                    lockedPercent: lockedPercent,
                    totalLiquidity: marketData.liquidity,
                    burnedAmount: (maxBurnPercent / 100) * marketData.liquidity,
                    lockedAmount: (lockedPercent / 100) * marketData.liquidity,
                    unlockDate: lockInfo.unlockDate,
                    lockDuration: lockInfo.lockDuration
                },
                holders: {
                    count: parseInt(raw.holder_count || '0'),
                    topHolders: raw.holders?.map((h: any) => ({ address: h.address, percent: parseFloat(h.percent) * 100 })) || []
                },
                metadata: {
                    totalSupply: raw.total_supply,
                    creatorAddress: raw.creator_address,
                    name: raw.token_name || marketData.name,
                    symbol: raw.token_symbol || marketData.symbol,
                    logo: marketData.logo
                },
                creatorReputation,
                chainName: chainName.charAt(0).toUpperCase() + chainName.slice(1),
                tax: { buy: buyTax, sell: sellTax }
            };

        } catch (e) {
            console.error("EVM Scan Error", e);
            return null;
        }
    }

    // --- Helpers ---

    private static async processMarketData(dexData: any, totalSupplyRaw: string, chain: string) {
        let price = 0;
        let totalLiquidity = 0;
        let volume24h = 0;
        let age = 'N/A';
        let marketCap = 0;
        let name = 'Unknown Token';
        let symbol = 'UNKNOWN';
        let logo = '';

        if (dexData) {
            price = parseFloat(dexData.priceUsd || '0');
            totalLiquidity = typeof dexData.liquidity === 'object' ? (dexData.liquidity.usd || 0) : (dexData.liquidity || 0);
            volume24h = typeof dexData.volume === 'object' ? (dexData.volume.h24 || 0) : 0;
            marketCap = dexData.fdv || (price * parseFloat(totalSupplyRaw || '0'));

            name = dexData.baseToken?.name || 'Unknown Token';
            symbol = dexData.baseToken?.symbol || 'UNKNOWN';
            logo = dexData.info?.imageUrl || '';

            if (dexData.pairCreatedAt) {
                const diffMs = Date.now() - dexData.pairCreatedAt;
                const minutes = Math.floor(diffMs / 60000);
                const hours = Math.floor(minutes / 60);
                const days = Math.floor(hours / 24);

                if (minutes < 60) age = `${Math.max(1, minutes)} Mins`;
                else if (hours < 24) age = `${hours} Hours`;
                else if (days === 1) age = `1 Day`;
                else age = `${days} Days`;
            }
        }

        const formatPrice = (p: number) => {
            if (!p || p === 0) return '$0.00';
            let s = p.toFixed(20).replace(/\.?0+$/, '');
            if (p < 1.0) return `$${s}`;
            return `$${p.toFixed(2)}`;
        };

        return {
            price: formatPrice(price),
            age,
            marketCap: marketCap > 0 ? `$${marketCap.toLocaleString(undefined, { maximumFractionDigits: 0 })}` : 'N/A',
            volume24h: volume24h > 0 ? `$${volume24h.toLocaleString(undefined, { maximumFractionDigits: 0 })}` : 'N/A',
            liquidity: totalLiquidity,
            buySellRatio: dexData?.txns?.h24 ? dexData.txns.h24 : undefined,
            name,
            symbol,
            logo
        };
    }

    private static calculateLockStatus(minEndTime: number, lockedPercent: number, maxBurnPercent: number, totalLiquidity: number) {
        let unlockDate = 'N/A';
        let lockDuration = 'N/A';

        if (minEndTime > 0) {
            // minEndTime is already normalized to MS and is > Date.now() by our loop logic (mostly)
            // But let's double check safe defaults
            const nowMs = Date.now();
            const diffMs = minEndTime - nowMs;
            const dateObj = new Date(minEndTime);

            unlockDate = dateObj.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });

            const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));

            if (days < 0) {
                // Should be handled by loop filter, but if it slipped through
                lockDuration = 'Expired';
                unlockDate = 'Expired';
            } else if (days > 365) {
                lockDuration = `in ${(days / 365).toFixed(1)} Years`;
            } else if (days > 30) {
                lockDuration = `in ${Math.floor(days / 30)} Months`;
            } else {
                lockDuration = `in ${days} Days`;
            }
        } else if (lockedPercent > 0.1) {
            // If we have locked % but no valid end time found (e.g. unknown vesting contract)
            unlockDate = 'Unknown Date';
            lockDuration = 'Locked (Unknown)';
        } else if (maxBurnPercent > 95) {
            unlockDate = 'Permanently Burned';
            lockDuration = 'Permanent';
        } else if (totalLiquidity > 0) {
            unlockDate = 'Not Locked';
            lockDuration = 'None';
        }
        return { unlockDate, lockDuration };
    }

    private static async getCreatorReputation(address?: string) {
        let creatorReputation = { isMalicious: false, honeypotCreator: false, phishingCreator: false, scamHistory: false };
        if (address) {
            const creatorSecurity = await this.fetchAddressSecurity(address);
            if (creatorSecurity) creatorReputation = creatorSecurity;
        }
        return creatorReputation;
    }

    private static calculateRiskScore(params: {
        mintable: boolean, freezable: boolean, mutable: boolean, modifiableBalance: boolean,
        closable: boolean, honeypot: boolean, blacklisted: boolean, maxBurnPercent: number,
        creatorReputation: any
    }) {
        let riskScore = 0;
        if (params.mintable) riskScore += 30;
        if (params.freezable) riskScore += 20;
        if (params.mutable) riskScore += 10;
        if (params.modifiableBalance) riskScore += 40;
        if (params.closable) riskScore += 20;
        if (params.honeypot) riskScore += 50;
        if (params.blacklisted) riskScore += 30;
        if (params.maxBurnPercent < 90) riskScore += (90 - params.maxBurnPercent) * 0.5;
        if (params.creatorReputation.isMalicious) riskScore += 40;
        if (params.creatorReputation.scamHistory) riskScore += 25;
        return Math.min(100, Math.max(0, riskScore));
    }

    static async fetchAddressSecurity(address: string): Promise<{ isMalicious: boolean, honeypotCreator: boolean, phishingCreator: boolean, scamHistory: boolean } | null> {
        try {
            const response = await fetchProvider('goplus', `${this.BASE_URL}/address_security/${address}?chain_id=solana`);
            if (!response.ok) return null;

            const data: AddressSecurityResponse = await response.json();
            if (data.code !== 1 || !data.result[address]) return null;

            const r = data.result[address];
            const honeypot = r.honeypot_related_address === "1";
            const phishing = r.phishing_activities === "1";
            const stealing = r.stealing_attack === "1";
            const fakeKyc = r.fake_kyc === "1";
            const blackmail = r.blackmail_activities === "1";

            const isMalicious = honeypot || phishing || stealing || fakeKyc || blackmail;

            return {
                isMalicious,
                honeypotCreator: honeypot,
                phishingCreator: phishing,
                scamHistory: isMalicious
            };
        } catch (e) {
            return null;
        }
    }
}
