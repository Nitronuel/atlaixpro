import { MarketCoin } from '../types';

export interface TokenFilterInput {
    symbol?: string;
    ticker?: string;
    name?: string;
    chain?: string;
    chainId?: string;
    address?: string;
}

export interface TokenExclusion {
    excluded: boolean;
    reason?: 'stablecoin' | 'wrapped' | 'major_asset' | 'infrastructure' | 'denylist';
}

const STABLECOIN_SYMBOLS = new Set([
    'USDC', 'USDT', 'DAI', 'BUSD', 'TUSD', 'USDS', 'USDE', 'FDUSD', 'FRAX', 'LUSD',
    'GUSD', 'USDP', 'USDD', 'PYUSD', 'USD1', 'USDL', 'EURC', 'EURS', 'SUSD', 'MIM',
    'DOLA', 'CRVUSD', 'GHO', 'USDB', 'USDX', 'USDR', 'USDY', 'USDM', 'USDA', 'CUSD',
    'CEUR', 'JUSD', 'JUPUSD'
]);

const MAJOR_ASSET_SYMBOLS = new Set([
    'BTC', 'ETH', 'SOL', 'BNB', 'XRP', 'TRX', 'ADA', 'AVAX', 'MATIC', 'POL', 'SUI',
    'SEI', 'ARB', 'OP', 'TON', 'DOT', 'LINK', 'LTC', 'BCH', 'ATOM', 'APT', 'NEAR',
    'INJ', 'FIL', 'ETC', 'BASE', 'TRON', 'ARBITRUM', 'OPTIMISM', 'POLYGON',
    'ETHEREUM', 'BITCOIN', 'SOLANA', 'AVALANCHE'
]);

const WRAPPED_MAJOR_SYMBOLS = new Set([
    'WBTC', 'WETH', 'WSOL', 'WBNB', 'WAVAX', 'WMATIC', 'WPOL', 'WFTM', 'WTRX', 'WCORE',
    'WSEI', 'WBERA', 'WROSE', 'WONE', 'WGLMR', 'WASTR', 'WCELO', 'WETH.E', 'BTCB',
    'RENBTC', 'TBTC', 'HBTC', 'SBTC', 'CBBTC', 'CBETH', 'CBXRP', 'CBADA', 'CBSOL',
    'CBMEGA', 'SOETH', 'SOBTC', 'AXLETH', 'AXLBTC', 'AXLUSDC', 'WHETH', 'WHBTC'
]);

const LIQUID_STAKING_SYMBOLS = new Set([
    'STETH', 'WSTETH', 'RETH', 'SFRXETH', 'FRXETH', 'METH', 'EZETH', 'WEETH', 'OSETH',
    'SWETH', 'ANKRETH', 'BETH', 'WBETH', 'MSTETH', 'MSOL', 'JITOSOL', 'JUPSOL',
    'BSOL', 'INF', 'JSOL', 'STSOL', 'SCNSOL', 'LAINESOL'
]);

const DENYLIST_ADDRESSES = new Set<string>([]);

const WRAPPED_NAME_PATTERNS = [
    /\bwrapped\b/i,
    /\bcoinbase wrapped\b/i,
    /\bbridged\b/i,
    /\bbridge\b/i,
    /\bwormhole\b/i,
    /\bbinance-peg\b/i,
    /\bbinance peg\b/i,
    /\bpegged\b/i,
    /\bportal\b/i,
    /\bwrapped ether\b/i,
    /\bwrapped btc\b/i,
    /\bwrapped bitcoin\b/i
];

const STABLE_NAME_PATTERNS = [
    /\bstablecoin\b/i,
    /\busd coin\b/i,
    /\btether\b/i,
    /\bpaypal usd\b/i,
    /\bdai stable/i,
    /\busd stable/i,
    /\bstable usd\b/i
];

const INFRASTRUCTURE_NAME_PATTERNS = [
    /\bliquid staking\b/i,
    /\bstaked ether\b/i,
    /\bstaked sol\b/i,
    /\blp token\b/i,
    /\bliquidity pool\b/i
];

const normalizeSymbol = (value?: string) => (value || '').trim().toUpperCase().replace(/\s+/g, '');
const normalizeName = (value?: string) => (value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ');

const MAJOR_ASSET_NAMES = new Set([
    'bitcoin',
    'ethereum',
    'ether',
    'solana',
    'bnb',
    'binance coin',
    'binance smart chain',
    'tron',
    'arbitrum',
    'base',
    'optimism',
    'polygon',
    'avalanche',
    'sui',
    'sei',
    'ton',
    'the open network',
    'cardano',
    'xrp',
    'ripple',
    'polkadot',
    'chainlink',
    'litecoin',
    'bitcoin cash',
    'cosmos',
    'aptos',
    'near protocol',
    'injective',
    'filecoin',
    'ethereum classic'
]);

export const classifyAlphaToken = (token: TokenFilterInput): TokenExclusion => {
    const symbol = normalizeSymbol(token.symbol || token.ticker);
    const name = (token.name || '').trim();
    const normalizedName = normalizeName(name);
    const address = (token.address || '').trim().toLowerCase();

    if (address && DENYLIST_ADDRESSES.has(address)) {
        return { excluded: true, reason: 'denylist' };
    }

    if (!symbol) return { excluded: false };

    if (STABLECOIN_SYMBOLS.has(symbol) || STABLE_NAME_PATTERNS.some((pattern) => pattern.test(name))) {
        return { excluded: true, reason: 'stablecoin' };
    }

    if (
        WRAPPED_MAJOR_SYMBOLS.has(symbol) ||
        LIQUID_STAKING_SYMBOLS.has(symbol) ||
        WRAPPED_NAME_PATTERNS.some((pattern) => pattern.test(name))
    ) {
        return { excluded: true, reason: 'wrapped' };
    }

    if (/^(CB|AXL|WH|WORMHOLE|SO)(BTC|ETH|SOL|BNB|XRP|ADA|AVAX|MATIC|POL|USDC|USDT)$/i.test(symbol)) {
        return { excluded: true, reason: 'wrapped' };
    }

    if (/^W(BTC|ETH|SOL|BNB|AVAX|MATIC|POL|FTM|TRX|SEI|ROSE|ONE|CELO)$/i.test(symbol)) {
        return { excluded: true, reason: 'wrapped' };
    }

    if (MAJOR_ASSET_SYMBOLS.has(symbol) || MAJOR_ASSET_NAMES.has(normalizedName)) {
        return { excluded: true, reason: 'major_asset' };
    }

    if (INFRASTRUCTURE_NAME_PATTERNS.some((pattern) => pattern.test(name))) {
        return { excluded: true, reason: 'infrastructure' };
    }

    return { excluded: false };
};

export const isExcludedAlphaToken = (token: TokenFilterInput) => classifyAlphaToken(token).excluded;

export const filterAlphaTokens = <T extends MarketCoin>(tokens: T[]): T[] =>
    tokens.filter((token) => !isExcludedAlphaToken(token));
