import React from 'react';

interface TokenChartProps {
    chainId: string;
    pairAddress: string;
}

export const TokenChart: React.FC<TokenChartProps> = ({ chainId, pairAddress }) => {
    const getChartUrl = (cId: string, pAddr: string) => {
        return `https://dexscreener.com/${cId}/${pAddr}?embed=1&theme=dark&trades=0&info=0`;
    };

    return (
        <div className="bg-card border border-border rounded-xl overflow-hidden shadow-sm flex flex-col h-[500px] lg:h-[600px] relative w-full">
            <div className="absolute inset-0 bg-main z-0 flex items-center justify-center text-text-medium">
                Loading Chart...
            </div>
            <iframe
                src={getChartUrl(chainId || 'ethereum', pairAddress || '')}
                style={{ width: '100%', height: '100%', border: '0', position: 'relative', zIndex: 10 }}
                title="Token Chart"
                allow="clipboard-write"
                allowFullScreen
            ></iframe>
        </div>
    );
};
