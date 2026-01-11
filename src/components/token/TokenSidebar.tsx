import React, { useState } from 'react';
import { Copy, Globe, ExternalLink, Scan, Zap, Wallet, Bell, Radar } from 'lucide-react';
import { EnrichedTokenData } from '../../types';

interface TokenSidebarProps {
    data: EnrichedTokenData | null;
    loading: boolean;
    className?: string;
}

const SocialIcon = ({ type }: { type: string }) => {
    const t = type.toLowerCase();
    if (t === 'twitter') {
        return (
            <svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14">
                <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
            </svg>
        );
    }
    if (t === 'telegram') {
        return (
            <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16">
                <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 11.944 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z" />
            </svg>
        );
    }
    if (t === 'discord') {
        return (
            <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16">
                <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994.021-.041.001-.09-.041-.106a13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.23 10.23 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.086 2.157 2.419 0 1.334-.947 2.419-2.157 2.419zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.086 2.157 2.419 0 1.334-.946 2.419-2.157 2.419z" />
            </svg>
        );
    }
    if (t === 'reddit') {
        return (
            <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16">
                <path d="M12 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0zm5.01 4.744c.688 0 1.25.561 1.25 1.249a1.25 1.25 0 0 1-2.498.056l-2.597-.547-.8 3.747c1.824.07 3.48.632 4.674 1.488.308-.309.73-.491 1.207-.491.968 0 1.754.786 1.754 1.754 0 .716-.435 1.333-1.01 1.614a3.111 3.111 0 0 1 .042.52c0 2.694-3.13 4.87-7.004 4.87-3.874 0-7.004-2.176-7.004-4.87 0-.183.015-.366.043-.534A1.748 1.748 0 0 1 4.028 12c0-.968.786-1.754 1.754-1.754.463 0 .898.196 1.207.49 1.207-.883 2.878-1.43 4.744-1.487l.885-4.182a.342.342 0 0 1 .14-.197.35.35 0 0 1 .238-.042l2.906.617a1.214 1.214 0 0 1 1.108-.701zM9.25 12C8.561 12 8 12.562 8 13.25c0 .687.561 1.248 1.25 1.248.687 0 1.248-.561 1.248-1.249 1.249.688 0 1.249-.561 1.249-1.249 0-.687-.561-1.25-1.249-1.25zm5.5 0c-.687 0-1.248.561-1.248 1.25 0 .687.561 1.248 1.249 1.248.688 0 1.249-.561 1.249-1.249 0-.687-.561-1.25-1.249-1.25zm-5.466 3.99a.327.327 0 0 0-.231.094.33.33 0 0 0 0 .463c.842.842 2.484.913 2.961.913.477 0 2.105-.056 2.961-.913a.361.361 0 0 0 .029-.463.33.33 0 0 0-.464 0c-.547.533-1.684.73-2.512.73-.828 0-1.979-.196-2.512-.73a.326.326 0 0 0-.232-.095z" />
            </svg>
        );
    }
    return <Globe size={16} />;
};

export const TokenSidebar: React.FC<TokenSidebarProps> = ({ data, loading, className }) => {
    const [copied, setCopied] = useState(false);

    const handleCopy = () => {
        if (data?.baseToken.address) {
            navigator.clipboard.writeText(data.baseToken.address);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        }
    };

    if (loading || !data) {
        return (
            <div className={`bg-card border border-border rounded-xl p-6 h-full flex items-center justify-center order-1 lg:order-none ${className || ''}`}>
                <div className="animate-pulse flex flex-col items-center gap-2">
                    <div className="w-16 h-16 bg-border/30 rounded-full"></div>
                    <div className="w-32 h-6 bg-border/30 rounded"></div>
                    <div className="w-24 h-4 bg-border/20 rounded"></div>
                </div>
            </div>
        );
    }

    const currentPrice = data ? `$${parseFloat(data.priceUsd).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 6 })}` : '$0.00';
    const priceChangeValue = data?.priceChange?.h24 ?? 0;
    const priceChange = `${priceChangeValue.toFixed(2)}%`;
    const isPositive = priceChangeValue >= 0;
    const fdv = data ? `$${(data.fdv || 0).toLocaleString()}` : 'N/A';
    const liq = data ? `$${(data.liquidity?.usd || 0).toLocaleString()}` : 'N/A';
    const vol = data ? `$${(data.volume?.h24 || 0).toLocaleString()}` : 'N/A';
    const imageUrl = data?.info?.imageUrl || `https://ui-avatars.com/api/?name=${data.baseToken.symbol}&background=random`;

    return (
        <div className={`contents lg:flex lg:flex-col gap-4 h-full ${className || ''}`}>
            {/* Top Card: Info & Stats */}
            <div className="bg-card border border-border rounded-xl flex flex-col shrink-0 overflow-hidden order-1 lg:order-none">
                {/* Header / Top Section */}
                <div className="p-5 border-b border-border bg-card-hover/5">
                    <div className="flex items-start gap-4">
                        <img
                            src={imageUrl}
                            className="w-16 h-16 rounded-full border-2 border-border shadow-lg object-cover"
                            onError={(e) => e.currentTarget.src = 'https://via.placeholder.com/64'}
                            alt={data.baseToken.name}
                        />
                        <div className="flex flex-col flex-1 min-w-0">
                            <div className="flex items-start justify-between w-full">
                                <div className="flex flex-col min-w-0">
                                    <h1 className="text-lg font-extrabold text-text-light tracking-tight truncate mr-2" title={data.baseToken.name}>{data.baseToken.name}</h1>
                                    <span className="text-sm font-mono text-text-medium font-semibold">{data.baseToken.symbol}</span>
                                </div>
                                <span className="bg-[#2F80ED]/10 text-[#2F80ED] text-[9px] font-bold px-1 py-[2px] rounded border border-[#2F80ED]/30 uppercase tracking-wide whitespace-nowrap">{data.chainId}</span>
                            </div>
                        </div>
                    </div>



                    <div
                        className="flex items-center gap-2 bg-main px-3 py-2 rounded-lg border border-border cursor-pointer hover:border-text-medium transition-colors group mt-4 w-full justify-between"
                        onClick={handleCopy}
                    >
                        <span className="font-mono text-xs text-text-medium group-hover:text-text-light transition-colors truncate">
                            {data.baseToken.address}
                        </span>
                        <div className="flex items-center">
                            {copied ? <span className="text-primary-green text-[10px] font-bold animate-fade-in mr-2">Copied</span> : null}
                            <Copy size={12} className="text-text-medium group-hover:text-text-light" />
                        </div>
                    </div>
                </div>

                {/* Price Section */}
                <div className="p-5 border-b border-border flex flex-col gap-1">
                    <div className="text-[10px] font-bold text-text-medium uppercase tracking-wider">Price USD</div>
                    <div className="flex items-baseline gap-2 flex-wrap">
                        <div className="text-xl font-extrabold text-text-light tracking-tight">{currentPrice}</div>
                        <div className={`text-xs font-bold px-1.5 py-0.5 rounded ${isPositive ? 'text-primary-green bg-primary-green/10' : 'text-primary-red bg-primary-red/10'}`}>
                            {priceChange}
                        </div>
                    </div>
                </div>

                {/* Stats Grid */}
                <div className="p-5 grid grid-cols-2 gap-y-4 gap-x-4 border-b border-border">
                    <div className="flex flex-col">
                        <span className="text-[10px] font-bold text-text-medium uppercase tracking-wider">Market Cap</span>
                        <span className="text-xs font-bold text-text-light">{fdv}</span>
                    </div>
                    <div className="flex flex-col">
                        <span className="text-[10px] font-bold text-text-medium uppercase tracking-wider">Liquidity</span>
                        <span className="text-xs font-bold text-text-light">{liq}</span>
                    </div>
                    <div className="flex flex-col col-span-2">
                        <span className="text-[10px] font-bold text-text-medium uppercase tracking-wider">Volume (24h)</span>
                        <span className="text-xs font-bold text-text-light">{vol}</span>
                    </div>
                </div>

                {/* Performance Grid */}
                <div className="p-5">
                    <div className="text-xs font-bold text-text-medium uppercase tracking-wider mb-2">Performance</div>
                    <div className="grid grid-cols-4 gap-2">
                        {[
                            { label: '5M', val: data?.priceChange?.m5 },
                            { label: '1H', val: data?.priceChange?.h1 },
                            { label: '6H', val: data?.priceChange?.h6 },
                            { label: '24H', val: data?.priceChange?.h24 },
                        ].map((item, i) => {
                            const pos = (item.val || 0) >= 0;
                            return (
                                <div key={i} className={`flex flex-col items-center justify-center p-2 rounded bg-main/50 border border-border/50`}>
                                    <span className="text-[9px] font-bold text-text-medium uppercase tracking-wider leading-none mb-1">{item.label}</span>
                                    <span className={`text-[10px] sm:text-xs font-bold leading-none ${pos ? 'text-primary-green' : 'text-primary-red'}`}>
                                        {item.val !== undefined ? item.val.toFixed(2) : '0.0'}%
                                    </span>
                                </div>
                            );
                        })}
                    </div>
                </div>

                <div className="p-5 border-t border-border flex flex-col gap-3">
                    <div className="text-[10px] font-bold text-text-medium uppercase tracking-wider">Socials</div>
                    <div className="flex gap-2 flex-wrap">
                        {data?.info?.websites?.map((w: any, i: number) => (
                            <a key={i} href={w.url} target="_blank" rel="noopener noreferrer" className="flex-1 min-w-[32px] h-8 flex items-center justify-center rounded-lg bg-border/50 text-text-medium hover:bg-card-hover hover:text-white transition-all"><Globe size={16} /></a>
                        ))}
                        {data?.info?.socials?.map((s: any, i: number) => (
                            <a key={i} href={s.url} target="_blank" rel="noopener noreferrer" className="flex-1 min-w-[32px] h-8 flex items-center justify-center rounded-lg bg-border/50 text-text-medium hover:bg-card-hover hover:text-white transition-all capitalize" title={s.type}>
                                <SocialIcon type={s.type} />
                            </a>
                        ))}
                        <a href={data?.url} target="_blank" rel="noopener noreferrer" className="flex-1 min-w-[32px] h-8 flex items-center justify-center rounded-lg bg-border/50 text-text-medium hover:bg-card-hover hover:text-white transition-all" title="View Pair">
                            <ExternalLink size={16} />
                        </a>
                    </div>
                </div>
            </div>

            {/* Bottom Card: Quick Actions & Trade */}
            <div className="bg-card border border-border rounded-xl p-5 flex flex-col shrink-0 order-5 lg:order-none">
                <div className="text-[10px] font-bold text-text-medium uppercase tracking-wider mb-3">Quick Actions</div>
                <div className="grid grid-cols-2 gap-3">
                    <button className="aspect-square bg-card-hover hover:bg-border border border-border rounded-xl p-3 flex flex-col items-center justify-center gap-2 transition-colors group">
                        <Scan size={24} className="text-text-medium group-hover:text-primary-green transition-colors" />
                        <span className="text-[10px] font-bold text-text-light">Risk Scan</span>
                    </button>
                    <button className="aspect-square bg-card-hover hover:bg-border border border-border rounded-xl p-3 flex flex-col items-center justify-center gap-2 transition-colors group">
                        <Radar size={24} className="text-text-medium group-hover:text-primary-yellow transition-colors" />
                        <span className="text-[10px] font-bold text-text-light">Detection</span>
                    </button>
                    <button className="aspect-square bg-card-hover hover:bg-border border border-border rounded-xl p-3 flex flex-col items-center justify-center gap-2 transition-colors group">
                        <Wallet size={24} className="text-text-medium group-hover:text-primary-blue transition-colors" />
                        <span className="text-[10px] font-bold text-text-light">Tracking</span>
                    </button>
                    <button className="aspect-square bg-card-hover hover:bg-border border border-border rounded-xl p-3 flex flex-col items-center justify-center gap-2 transition-colors group">
                        <Bell size={24} className="text-text-medium group-hover:text-primary-red transition-colors" />
                        <span className="text-[10px] font-bold text-text-light">Alerts</span>
                    </button>
                </div>

                <a
                    href={data?.url}
                    target="_blank"
                    className="mt-4 bg-primary-green/10 border border-primary-green/20 rounded-xl p-3 flex items-center justify-center gap-2 hover:bg-primary-green/20 transition-all cursor-pointer font-bold text-primary-green uppercase text-sm"
                >
                    Trade on {data?.dexId || 'DEX'}
                </a>
            </div>
        </div>
    );
};
