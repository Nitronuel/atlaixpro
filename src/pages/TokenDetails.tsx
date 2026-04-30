// Atlaix: Route-level product screen for the Atlaix application.
import React, { useEffect, useState } from 'react';
import { ArrowLeft, RefreshCw, Zap } from 'lucide-react';
import { DatabaseService } from '../services/DatabaseService';
import { AlphaGauntletService } from '../services/AlphaGauntletService';
import { ChainActivityService, RealActivity } from '../services/ChainActivityService';
import { MoralisService } from '../services/MoralisService';
import { useParams, useNavigate } from 'react-router-dom';
import { AlphaGauntletEvent, EnrichedTokenData, MarketCoin } from '../types';
import { TokenSidebar } from '../components/token/TokenSidebar';
import { TokenChart } from '../components/token/TokenChart';
import { SolanaRpcService } from '../services/SolanaRpcService';
import { TokenTransactions } from '../components/token/TokenTransactions';
import { TokenOverviewCards } from '../components/token/TokenOverviewCards';

export const TokenDetails: React.FC = () => {
    const { address } = useParams<{ address: string }>();
    const navigate = useNavigate();
    const [enrichedData, setEnrichedData] = useState<EnrichedTokenData | null>(null);
    const [loading, setLoading] = useState(true);
    const [activityFeed, setActivityFeed] = useState<RealActivity[]>([]);
    const [isRealData, setIsRealData] = useState(false);
    const [alphaEvent, setAlphaEvent] = useState<AlphaGauntletEvent | null>(null);

    const onBack = () => {
        navigate(-1);
    };

    useEffect(() => {
        const fetchData = async () => {
            if (!address) return;
            setLoading(true);

            try {
                const data = await DatabaseService.getTokenDetails(address);
                if (data) {
                    // Start basic data
                    const enriched: EnrichedTokenData = {
                        ...data,
                        holders: 0,
                        totalSupply: 0,
                        pairCreatedAt: (data as any).pairCreatedAt || 0,
                        txns: (data as any).txns || { h24: { buys: 0, sells: 0 } },
                        tax: { buy: 0, sell: 0 } // Default for now
                    };
                    setEnrichedData(enriched);

                    // Fetch Logic: Parallel execution for speed
                    // 1. Get Holders (RPC)
                    // 2. Get Supply (RPC)
                    // 3. Activity Feed (ChainActivityService)

                    const mintAddress = data.baseToken.address;
                    const isSolana = data.chainId === 'solana';

                    let holders = 0;
                    let supply = 0;
                    let realActivity: any[] = [];

                    // ACTIVITY FEED (Universal)
                    realActivity = await ChainActivityService.getTokenActivity(
                        mintAddress,
                        data.chainId,
                        parseFloat(data.priceUsd) || 0,
                        data.pairAddress
                    );

                    // CHAIN SPECIFIC METADATA
                    if (isSolana) {
                        // Solana: Use RPC
                        const [h, s] = await Promise.all([
                            SolanaRpcService.getHolderCount(mintAddress),
                            SolanaRpcService.getTokenSupply(mintAddress)
                        ]);
                        holders = h || 0;
                        supply = s || 0;
                    } else {
                        // EVM / Other: Use Moralis
                        try {
                            const metadata = await MoralisService.getTokenMetadata(mintAddress, data.chainId);
                            if (metadata) {
                                // Adjust for decimals
                                const decimals = metadata.decimals || 18;
                                supply = parseFloat(metadata.totalSupply) / Math.pow(10, decimals);
                            } else {
                                // Fallback if API fails
                                const price = parseFloat(data.priceUsd) || 0;
                                const fdv = data.fdv || 0;
                                if (price > 0 && fdv > 0) supply = fdv / price;
                            }
                        } catch (e) {
                            console.warn("EVM Supply Fetch Failed", e);
                        }
                    }

                    // SECURITY CHECK (Tax / Honeypot) - Parallel execution
                    // Note: This is an async update to the state to show data as it comes in
                    import('../services/GoPlusService').then(({ GoPlusService }) => {
                        GoPlusService.fetchTokenSecurity(mintAddress, data.chainId).then(security => {
                            if (security && security.tax) {
                                setEnrichedData(prev => prev ? ({
                                    ...prev,
                                    tax: security.tax
                                }) : null);
                            }
                        }).catch(err => console.error("Tax Fetch Error", err));
                    });

                    setEnrichedData(prev => prev ? ({ ...prev, holders, totalSupply: supply }) : null);

                    const buys = enriched.txns?.h24?.buys || 0;
                    const sells = enriched.txns?.h24?.sells || 0;
                    const totalTxns = buys + sells;
                    const flowRatio = totalTxns > 0 ? buys / totalTxns : 0.5;
                    const netFlow = enriched.volume.h24 * (flowRatio - 0.5);
                    const marketCoin: MarketCoin = {
                        id: 0,
                        name: enriched.baseToken.name,
                        ticker: enriched.baseToken.symbol,
                        price: `$${(parseFloat(enriched.priceUsd) || 0).toPrecision(6)}`,
                        h1: `${enriched.priceChange?.h1 || 0}%`,
                        h24: `${enriched.priceChange?.h24 || 0}%`,
                        d7: `${enriched.priceChange?.h6 || 0}%`,
                        cap: `$${enriched.fdv || 0}`,
                        liquidity: `$${enriched.liquidity?.usd || 0}`,
                        volume24h: `$${enriched.volume?.h24 || 0}`,
                        dexBuys: `${buys}`,
                        dexSells: `${sells}`,
                        dexFlow: Math.round(flowRatio * 100),
                        netFlow: `${netFlow >= 0 ? '+' : '-'}$${Math.abs(netFlow)}`,
                        smartMoney: 'Neutral',
                        smartMoneySignal: netFlow > 50000 ? 'Inflow' : netFlow < -50000 ? 'Outflow' : 'Neutral',
                        signal: 'None',
                        riskLevel: 'Low',
                        age: 'Live',
                        createdTimestamp: enriched.pairCreatedAt || Date.now(),
                        img: enriched.info?.imageUrl || '',
                        trend: (enriched.priceChange?.h24 || 0) >= 0 ? 'Bullish' : 'Bearish',
                        chain: enriched.chainId,
                        address: enriched.baseToken.address,
                        pairAddress: enriched.pairAddress,
                        activeWallets24h: holders || Math.round(totalTxns * 0.65)
                    };
                    setAlphaEvent(AlphaGauntletService.qualifyToken(marketCoin));

                    // We now strictly use the real activity feed (filtered for Whales/Burns)
                    // We do NOT fall back to simulation because users want high-signal data.
                    setActivityFeed(realActivity);
                    setIsRealData(true);
                }
            } catch (e) {
                console.error("Failed to fetch details", e);
            } finally {
                setLoading(false);
            }
        };

        fetchData();
    }, [address]);

    if (loading && !enrichedData) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[60vh]">
                <RefreshCw className="animate-spin text-primary-green mb-4" size={40} />
                <div className="text-xl font-bold">Scanning Chain Data...</div>
            </div>
        );
    }

    return (
        <div className="flex flex-col gap-4 animate-fade-in pb-10 h-full">
            <button onClick={onBack} className="flex items-center gap-2 text-text-medium hover:text-text-light w-fit transition-colors font-medium mb-2">
                <ArrowLeft size={18} /> Back to Market
            </button>

            <div className="flex flex-col lg:flex-row gap-6 h-full">
                {/* Left Column (Chart + Transactions) - Flexible width */}
                <div className="contents lg:flex-1 lg:flex lg:flex-col gap-6 min-w-0">
                    <div className="order-2 lg:order-none w-full">
                        <TokenChart
                            chainId={enrichedData?.chainId || 'ethereum'}
                            pairAddress={enrichedData?.pairAddress || ''}
                        />
                        <div className="mt-4">
                            <TokenOverviewCards data={enrichedData} />
                        </div>
                    </div>
                    <TokenTransactions
                        activityFeed={activityFeed}
                        enrichedData={enrichedData}
                        isRealData={isRealData}
                    />
                    <div className="bg-card border border-border rounded-xl p-5 shadow-sm">
                        <div className="flex items-center justify-between gap-3 mb-4">
                            <h3 className="text-base font-bold text-text-light flex items-center gap-2">
                                <Zap size={16} className="text-primary-green" /> Alpha Gauntlet Timeline
                            </h3>
                            {alphaEvent && (
                                <span className="text-xs font-bold text-primary-green bg-primary-green/10 border border-primary-green/30 rounded-full px-2.5 py-1">
                                    Score {alphaEvent.score}
                                </span>
                            )}
                        </div>
                        {alphaEvent ? (
                            <div className="border-l border-primary-green/40 pl-4">
                                <div className="text-xs font-bold text-primary-green uppercase tracking-wide">{alphaEvent.eventType}</div>
                                <div className="text-sm text-text-light font-medium mt-1">{alphaEvent.summary}</div>
                                <div className="flex flex-wrap gap-1.5 mt-3">
                                    {alphaEvent.triggers.map(trigger => (
                                        <span key={trigger} className="text-[10px] text-text-medium bg-card-hover border border-border rounded px-2 py-1">
                                            {trigger}
                                        </span>
                                    ))}
                                </div>
                            </div>
                        ) : (
                            <div className="text-sm text-text-medium">
                                This token has not passed the v1 market gate and activity trigger requirements yet.
                            </div>
                        )}
                    </div>
                </div>

                {/* Right Column (Sidebar) - Fixed 300px width */}
                <div className="contents lg:block lg:w-[300px] lg:shrink-0 h-full">
                    <TokenSidebar data={enrichedData} loading={loading} />
                </div>
            </div>
        </div>
    );
};
