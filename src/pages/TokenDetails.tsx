import React, { useEffect, useState } from 'react';
import { ArrowLeft, RefreshCw } from 'lucide-react';
import { DatabaseService } from '../services/DatabaseService';
import { ChainActivityService, RealActivity } from '../services/ChainActivityService';
import { useParams, useNavigate } from 'react-router-dom';
import { EnrichedTokenData } from '../types';
import { TokenSidebar } from '../components/token/TokenSidebar';
import { TokenChart } from '../components/token/TokenChart';
import { TokenTransactions } from '../components/token/TokenTransactions';

export const TokenDetails: React.FC = () => {
    const { address } = useParams<{ address: string }>();
    const navigate = useNavigate();
    const [enrichedData, setEnrichedData] = useState<EnrichedTokenData | null>(null);
    const [loading, setLoading] = useState(true);
    const [activityFeed, setActivityFeed] = useState<RealActivity[]>([]);
    const [isRealData, setIsRealData] = useState(false);

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
                    setEnrichedData(data);
                    const price = parseFloat(data.priceUsd) || 0;

                    // Use ChainActivityService for scalable, filtered feed
                    const realActivity = await ChainActivityService.getTokenActivity(
                        data.baseToken.address,
                        data.chainId,
                        price,
                        data.pairAddress // Pass pair address for Buy/Sell detection
                    );

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
                    </div>
                    <TokenTransactions
                        activityFeed={activityFeed}
                        enrichedData={enrichedData}
                        isRealData={isRealData}
                    />
                </div>

                {/* Right Column (Sidebar) - Fixed 270px width */}
                <div className="contents lg:block lg:w-[270px] lg:shrink-0 h-full">
                    <TokenSidebar data={enrichedData} loading={loading} />
                </div>
            </div>
        </div>
    );
};