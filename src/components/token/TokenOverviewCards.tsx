import React from 'react';
import { EnrichedTokenData } from '../../types';
import { formatCompactNumber } from '../../utils/format';

interface TokenOverviewCardsProps {
    data: EnrichedTokenData | null;
}

export const TokenOverviewCards: React.FC<TokenOverviewCardsProps> = ({ data }) => {
    if (!data) return null;

    // Real Data Extraction
    const totalTxns = (data.txns?.h24.buys || 0) + (data.txns?.h24.sells || 0);
    const fdv = data.fdv || 0;
    const liquidity = data.liquidity?.usd || 0;
    const volume24h = data.volume?.h24 || 0;
    const priceChange24h = data.priceChange?.h24 || 0;

    // Tax Formatting
    const taxString = data.tax ? `${data.tax.buy}% / ${data.tax.sell}%` : 'Unknown';

    // Pair Age Calculation
    const getPairAge = (timestamp?: number) => {
        if (!timestamp) return 'N/A';
        const diff = Date.now() - timestamp;
        const days = Math.floor(diff / (1000 * 60 * 60 * 24));
        if (days > 0) return `${days} Days`;
        const hours = Math.floor(diff / (1000 * 60 * 60));
        return `${hours} Hours`;
    };

    // Volume Splits (Estimated based on Txn Ratio)
    const buyRatio = totalTxns > 0 ? (data.txns?.h24.buys || 0) / totalTxns : 0.5;
    const buyVolume = volume24h * buyRatio;
    const sellVolume = volume24h * (1 - buyRatio);
    const netVolume = buyVolume - sellVolume;

    const cards = [
        {
            title: 'Transactions (24h)',
            value: totalTxns.toLocaleString(),
            color: 'text-text-light'
        },
        {
            title: 'LP Pools',
            value: data.poolCount ? `${data.poolCount} Active` : '1 Active',
            color: 'text-text-light'
        },
        {
            title: 'Active Wallets (24h)',
            value: data.activeWallets24h ? data.activeWallets24h.toLocaleString() : 'N/A',
            color: 'text-text-light'
        },
        {
            title: 'Buy Volume (24h)',
            value: formatCompactNumber(buyVolume, '$'),
            color: 'text-text-light'
        },
        {
            title: 'Sell Volume (24h)',
            value: formatCompactNumber(sellVolume, '$'),
            color: 'text-text-light'
        },
        {
            title: 'Net Volume Delta',
            value: `${netVolume > 0 ? '+' : ''}${formatCompactNumber(netVolume, '$')}`,
            color: netVolume >= 0 ? 'text-primary-green' : 'text-primary-red'
        },
        {
            title: 'Holders',
            value: data.holders ? data.holders.toLocaleString() : 'N/A',
            color: 'text-text-light'
        }
    ];

    return (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 w-full">
            {cards.map((card, index) => (
                <div key={index} className="bg-card border border-border/50 rounded-xl p-3 flex flex-col justify-center gap-0.5 shadow-sm hover:border-border transition-colors min-h-[90px]">
                    <span className="text-text-medium text-[9px] md:text-[10px] font-medium uppercase tracking-wider whitespace-nowrap">{card.title}</span>
                    <span className={`text-sm md:text-base font-bold ${card.color} tracking-tight`}>
                        {card.value}
                    </span>
                </div>
            ))}
        </div>
    );
};
