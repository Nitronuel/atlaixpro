export type ViewState =
    | 'auth'
    | 'overview'
    | 'token-details'
    | 'kol-feed'
    | 'heatmap'
    | 'sentiment'
    | 'detection'
    | 'token-detection'
    | 'virality'
    | 'chatbot'
    | 'wallet-tracking'
    | 'smart-money'
    | 'safe-scan'
    | 'custom-alerts'
    | 'settings';

export type WalletCategory = 'Smart Money' | 'Whale' | 'Sniper' | 'Fresh Wallet' | 'Early Buyer';

export interface SavedWallet {
    addr: string;
    name: string;
    categories: WalletCategory[];
    timestamp: number;
    lastBalance?: string;
    lastWinRate?: string;
    lastPnl?: string;
}

export interface Wallet {
    id: number;
    addr: string;
    tag: string;
    bal: string;
    pnl: string;
    win: string;
    tokens: number;
    time: string;
    type: 'whale' | 'smart' | 'sniper';
}

export interface MarketCoin {
    id: number;
    name: string;
    ticker: string;
    price: string;
    h1: string;
    h24: string;
    d7: string;
    cap: string;
    liquidity: string;
    volume24h: string;
    dexBuys: string;
    dexSells: string;
    dexFlow: number;
    netFlow: string;
    smartMoney: string;
    smartMoneySignal: 'Inflow' | 'Outflow' | 'Neutral';
    signal: 'Volume Spike' | 'Accumulation' | 'Breakout' | 'Dump' | 'None';
    riskLevel: 'Low' | 'Medium' | 'High';
    age: string;
    createdTimestamp: number;
    img: string;
    trend: 'Bullish' | 'Bearish';
    chain: string;
    address?: string;
    pairAddress?: string;
}

export interface Post {
    id: number;
    user: string;
    handle: string;
    avatar: string;
    time: string;
    content: string;
    sentiment: 'Bullish' | 'Bearish' | 'Neutral';
    likes: number;
    retweets: number;
    replies: number;
    smart: boolean;
    platform: 'twitter' | 'telegram';
    aiInsight?: string;
    aiExpanded: boolean;
}

export interface WalletData {
    id: number | string;
    addr: string;
    tag: string;
    bal: string;
    pnl: string;
    win: string;
    tokens: number;
    time: string;
    type: string;
    categories?: WalletCategory[];
}

export interface EnrichedTokenData {
    pairAddress: string;
    baseToken: { address: string; name: string; symbol: string };
    priceUsd: string;
    liquidity: { usd: number };
    fdv: number;
    volume: { h24: number; m5: number; h1: number; h6: number };
    priceChange: { m5: number; h1: number; h6: number; h24: number };
    info: { imageUrl?: string; websites?: any[]; socials?: any[] };
    chainId: string;
    dexId: string;
    url: string;
}
