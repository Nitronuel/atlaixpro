// Atlaix: Shared TypeScript contracts for market, wallet, token, and Alpha Gauntlet data.
export type ViewState =
    | 'auth'
    | 'overview'
    | 'token-details'
    | 'kol-feed'
    | 'heatmap'
    | 'sentiment'
    | 'detection'
    | 'token-detection'
    | 'ai-assistant'
    | 'wallet-tracking'
    | 'smart-money'
    | 'smart-money-scanner'
    | 'safe-scan'
    | 'smart-alerts'
    | 'settings';

export type WalletCategory = 'Smart Money' | 'Whale' | 'Sniper' | 'Fresh Wallet' | 'Early Buyer' | 'Hodler' | 'Degen' | 'Insider' | 'Fresh' | 'Copy Trade' | 'High Vol' | 'Early';

export interface SmartMoneyQualification {
    score: number;
    qualified: boolean;
    reasons: string[];
    evaluatedAt: number;
    metrics: {
        netWorthUsd: number;
        winRate: number;
        pnlPercent: number;
        activePositions: number;
        profitablePositions: number;
    };
}

export interface SavedWallet {
    addr: string;
    name: string;
    categories: WalletCategory[];
    timestamp: number;
    lastBalance?: string;
    lastWinRate?: string;
    lastPnl?: string;
    qualification?: SmartMoneyQualification;
    autoTracked?: boolean;
    autoPromotedToSmartMoney?: boolean;
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
    activeWallets24h?: number;
}

export type AlphaGauntletEventType =
    | 'Accumulation'
    | 'Distribution'
    | 'Market Stress'
    | 'Recovery'
    | 'Liquidity Event'
    | 'Unusual Activity';

export type AlphaGauntletTrigger =
    | 'Volume Spike'
    | 'Transaction Spike'
    | 'Strong Buy Pressure'
    | 'Strong Sell Pressure'
    | 'Liquidity Added'
    | 'Liquidity Removed'
    | 'Holder Growth Spike'
    | 'Price Dump'
    | 'Price Recovery'
    | 'Abnormal Large Trades';

export interface AlphaGauntletScores {
    marketStructure: number;
    liquidityHealth: number;
    activity: number;
    eventStrength: number;
    total: number;
}

export interface AlphaGauntletEvent {
    token: MarketCoin;
    eventType: AlphaGauntletEventType;
    triggers: AlphaGauntletTrigger[];
    score: number;
    scores: AlphaGauntletScores;
    severity: 'High' | 'Medium' | 'Low';
    summary: string;
    detectedAt: number;
    metrics: {
        marketCap: number;
        liquidity: number;
        volume24h: number;
        holders: number;
        transactions24h: number;
        ageHours: number;
        lpToMarketCapRatio: number;
        buySellRatio: number;
        priceChange24h: number;
        netFlow: number;
    };
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
    holders?: number;
    totalSupply?: number;
    pairCreatedAt?: number;
    txns?: { h24: { buys: number; sells: number } };
    tax?: { buy: number; sell: number };
    poolCount?: number;
    activeWallets24h?: number;
}
