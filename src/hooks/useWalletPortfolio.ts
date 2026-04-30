// Wallet portfolio loading hook shared by wallet intelligence views.
import { useState, useEffect, useRef } from 'react';
import { ChainRouter, PortfolioData } from '../services/ChainRouter';
import { detectWalletAddressType } from '../utils/wallet';

export interface WalletStats {
    winRate: string;
    totalPnL: string;
    netWorth: string;
    activePositions: number | string;
    profitableTrader: string;
    avgHoldTime: string;
}

export const useWalletPortfolio = (
    address: string | undefined,
    chain: string,
    selectedWalletAddr: string | undefined,
    timeFilter: 'ALL' | '1D' | '1W' | '1M' | '>1M'
) => {
    const [loading, setLoading] = useState(!!(selectedWalletAddr || address));
    const [refreshKey, setRefreshKey] = useState(0);
    const [portfolioData, setPortfolioData] = useState<PortfolioData | null>(null);
    const [walletStats, setWalletStats] = useState<WalletStats>({
        winRate: 'N/A',
        totalPnL: 'N/A',
        netWorth: 'Loading...',
        activePositions: 0,
        profitableTrader: 'N/A',
        avgHoldTime: 'N/A'
    });

    const isInternalUpdate = useRef(false);
    const forceRefreshRef = useRef(false);

    useEffect(() => {
        isInternalUpdate.current = false;
    }, [address, selectedWalletAddr, chain]);

    // Detect chain helper (internal use)
    const detectChain = (addr: string) => {
        if (!addr) return null;
        const type = detectWalletAddressType(addr);
        if (type === 'solana') return 'Solana';
        if (type === 'evm') {
            if (chain === 'Solana') return 'All Chains'; // Reset if mismatch
            return 'Ethereum'; // Default for 0x if unspecified
        }
        return null;
    };

    // Main Data Fetching
    useEffect(() => {
        const fetchData = async () => {
            const walletAddr = selectedWalletAddr || address;

            if (walletAddr) {
                setLoading(true);
                // Reset stats on new fetch
                setWalletStats(prev => ({ ...prev, netWorth: 'Loading...' }));

                try {
                    // Logic Update:
                    // If 'All Chains' is selected, we let ChainRouter aggregate everything.
                    // If a specific chain (e.g. 'Ethereum') is selected, we might still want to fetch EVERYTHING
                    // and then filter on the client side, OR trust the router to return only that chain.
                    // 
                    // Challenge: If user selects 'Ethereum', ChainRouter.fetchPortfolio('Ethereum') returns ETH + ERC20s.
                    // If user selects 'All Chains', it aggregates.
                    // 
                    // Detection Override:
                    // If address is EVM but 'Solana' is selected -> Empty (Correct).
                    // If address is Solana but 'Ethereum' selected -> Empty (Correct).

                    let targetChain = chain;

                    // Smart Auto-Detection if mismatched or 'All Chains'
                    const detected = detectChain(walletAddr);
                    if (chain === 'All Chains' && detected) {
                        targetChain = detected === 'Ethereum' ? 'All Chains' : detected;
                    }
                    // If specific chain is selected, we trust the UI state, BUT we verify compatibility
                    else if (detected && detected !== 'All Chains') {
                        // If detected is Solana but target is Ethereum => mismatch
                        if (detected === 'Solana' && targetChain !== 'Solana') targetChain = 'Mismatch';
                        if (detected === 'Ethereum' && targetChain === 'Solana') targetChain = 'Mismatch';
                    }

                    if (targetChain === 'Mismatch') {
                        setPortfolioData({
                            netWorth: '$0.00',
                            assets: [],
                            recentActivity: [],
                            providerUsed: 'Cache',
                            chainIcon: '',
                            timestamp: Date.now()
                        });
                    } else {
                        const data = await ChainRouter.fetchPortfolio(targetChain, walletAddr, forceRefreshRef.current);
                        setPortfolioData(data);
                    }
                } catch (e) {
                    console.error("Failed to fetch wallet data", e);
                    setPortfolioData(null);
                    setWalletStats({
                        winRate: 'N/A',
                        totalPnL: 'N/A',
                        netWorth: 'N/A',
                        activePositions: 'N/A',
                        profitableTrader: 'N/A',
                        avgHoldTime: 'N/A'
                    });
                } finally {
                    forceRefreshRef.current = false;
                    setLoading(false);
                }
            }
        };
        fetchData();
    }, [address, selectedWalletAddr, chain, refreshKey]); // Re-fetch when these change

    // Reset PnL when timeFilter changes
    useEffect(() => {
        if (!portfolioData) return;

        setPortfolioData(prev => {
            if (!prev) return null;
            return {
                ...prev,
                assets: prev.assets.map(a => ({
                    ...a,
                    pnl: a.rawValue > 1.0 ? 'Loading...' : 'N/A', // Reset to loading to trigger batch
                    pnlPercent: undefined,
                    avgBuy: 'N/A'
                }))
            };
        });
    }, [timeFilter]);

    // Batched PnL Calculation
    useEffect(() => {
        let isMounted = true;
        const processPnLBatch = async () => {
            const walletAddr = selectedWalletAddr || address || '';
            if (!portfolioData || !walletAddr) return;

            const detectedChain = detectChain(walletAddr);
            const isSolana = chain === 'Solana' || detectedChain === 'Solana';

            // Preload Solana History (Optimisation)
            if (isSolana && !isInternalUpdate.current) {
                const solanaMints = portfolioData.assets
                    .filter(a => (a.chain === 'Solana' || !a.chain))
                    .map(a => a.address);

                if (solanaMints.length > 0) {
                    try {
                        const { SolanaRpcService } = await import('../services/SolanaRpcService');
                        await SolanaRpcService.preloadHistory(walletAddr, solanaMints);
                    } catch (e) { console.error("Preload failed", e); }
                }
            }
            if (isSolana) isInternalUpdate.current = true; // Mark done

            // Find NEXT asset that needs PnL
            // We prioritize assets with value > $10 to save API calls
            const batchAssets = portfolioData.assets
                .filter(a => (a.pnl === 'Loading...' || a.pnl === undefined) && a.rawValue > 1)
                .slice(0, 5); // Reduce batch size to prevent rate limits

            if (batchAssets.length === 0) return;

            await new Promise(r => setTimeout(r, 200)); // Small throttle
            if (!isMounted) return;

            try {
                const results = await Promise.all(batchAssets.map(async (asset) => {
                    try {
                        let targetChain = asset.chain || chain;
                        // Resolve chain for mixed assets
                        if (targetChain === 'All Chains' || !targetChain) {
                            if (asset.address.length > 40 && !asset.address.startsWith('0x')) targetChain = 'Solana';
                            else targetChain = 'Ethereum'; // Default assumption for now
                        }

                        const data = await ChainRouter.fetchTokenPnL(targetChain, walletAddr, asset.address, asset.currentPrice, timeFilter);
                        return { address: asset.address, data };
                    } catch (e) {
                        console.warn(`PnL Fetch failed for ${asset.symbol}`, e);
                        return { address: asset.address, data: { pnl: 'N/A', avgBuy: 'N/A' } };
                    }
                }));

                if (isMounted) {
                    setPortfolioData(prev => {
                        if (!prev) return null;
                        const updateMap = new Map();
                        results.forEach(r => updateMap.set(r.address, r.data));

                        // Check if we actually have changes to avoid loops
                        let hasChanges = false;
                        const newAssets = prev.assets.map(a => {
                            if (updateMap.has(a.address)) {
                                hasChanges = true;
                                return { ...a, ...updateMap.get(a.address) };
                            }
                            return a;
                        });

                        return hasChanges ? { ...prev, assets: newAssets } : prev;
                    });
                }
            } catch (e) {
                console.error("Queue Error", e);
            }
        };

        processPnLBatch();
        return () => { isMounted = false; };
    }, [portfolioData, chain, selectedWalletAddr, address, timeFilter]);

    // Stats Aggregation
    useEffect(() => {
        if (!portfolioData) return;

        if (portfolioData.assets.length === 0) {
            setWalletStats({
                winRate: 'N/A',
                totalPnL: 'N/A',
                netWorth: '$0.00',
                activePositions: 0,
                profitableTrader: 'N/A',
                avgHoldTime: 'N/A'
            });
            return;
        }

        const totalHoldingsValue = portfolioData.assets.reduce((sum, asset) => sum + (asset.rawValue || 0), 0);
        const formattedNetWorth = totalHoldingsValue.toLocaleString('en-US', { style: 'currency', currency: 'USD' });

        const validAssets = portfolioData.assets.filter(a => a.pnlPercent !== undefined && a.avgBuy !== 'N/A');

        let winRateVal = 0;
        let totalPnLPercent = 0;
        let pnlPrefix = '';

        if (validAssets.length > 0) {
            const winningAssets = validAssets.filter(a => (a.pnlPercent || 0) > 0);
            winRateVal = (winningAssets.length / validAssets.length) * 100;

            let totalCostBasis = 0;
            let totalCurrentValueForPnL = 0;

            validAssets.forEach(a => {
                const rawVal = a.rawValue;
                const pnlP = a.pnlPercent || 0;
                // Reverse calc cost basis: Cost = Value / (1 + PnL%)
                const cost = rawVal / (1 + (pnlP / 100));
                totalCostBasis += cost;
                totalCurrentValueForPnL += rawVal;
            });

            const totalPnLVal = totalCurrentValueForPnL - totalCostBasis;
            totalPnLPercent = totalCostBasis > 0 ? (totalPnLVal / totalCostBasis * 100) : 0;
            pnlPrefix = totalPnLVal >= 0 ? '+' : '';
        }

        const newWinStr = validAssets.length > 0 ? `${Math.round(winRateVal)}%` : 'N/A';
        const newPnlStr = validAssets.length > 0 ? `${pnlPrefix}${totalPnLPercent.toFixed(2)}%` : 'N/A';
        const activePos = portfolioData.assets.filter(a => a.rawValue > 1.0).length;
        const profitableCount = validAssets.filter(a => (a.pnlPercent || 0) > 0).length;

        // Calculate Real Average Hold Time
        const assetsWithBuyTime = validAssets.filter(a => (a as any).buyTime && (a as any).buyTime > 0);
        let avgHold = 'N/A';

        if (assetsWithBuyTime.length > 0) {
            const now = Date.now();
            const totalDuration = assetsWithBuyTime.reduce((sum, a) => sum + (now - ((a as any).buyTime || now)), 0);
            const avgDurationMs = totalDuration / assetsWithBuyTime.length;
            const days = Math.floor(avgDurationMs / (24 * 60 * 60 * 1000));

            if (days > 365) avgHold = `${(days / 365).toFixed(1)} Years`;
            else if (days > 30) avgHold = `${(days / 30).toFixed(1)} Months`;
            else if (days > 7) avgHold = `${(days / 7).toFixed(1)} Weeks`;
            else avgHold = `${days} Days`;
        }

        setWalletStats({
            winRate: newWinStr,
            totalPnL: newPnlStr,
            netWorth: formattedNetWorth,
            activePositions: activePos,
            profitableTrader: profitableCount.toString(),
            avgHoldTime: avgHold
        });

    }, [portfolioData]);

    const refreshPortfolio = () => {
        forceRefreshRef.current = true;
        setRefreshKey(prev => prev + 1);
    };

    return { loading, portfolioData, walletStats, setWalletStats, setPortfolioData, setLoading, refreshPortfolio };
};
