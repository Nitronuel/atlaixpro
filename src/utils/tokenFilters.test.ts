import { describe, expect, it } from 'vitest';
import { classifyAlphaToken, filterAlphaTokens, hasQualityTokenMetadata, isExcludedAlphaToken } from './tokenFilters';

const verifiedImage = 'https://assets.example.com/token.png';

describe('alpha token hygiene filters', () => {
    it('removes stablecoins from the alpha feed', () => {
        expect(classifyAlphaToken({ ticker: 'PYUSD', name: 'PayPal USD', chain: 'solana' })).toMatchObject({
            excluded: true,
            reason: 'stablecoin'
        });
        expect(isExcludedAlphaToken({ ticker: 'USDC', name: 'USD Coin', chain: 'base' })).toBe(true);
        expect(isExcludedAlphaToken({ ticker: 'JUPUSD', name: 'Jupiter USD', chain: 'solana' })).toBe(true);
        expect(isExcludedAlphaToken({ ticker: 'USDF0', name: 'USDF0', chain: 'ethereum' })).toBe(true);
        expect(isExcludedAlphaToken({ ticker: 'USD0++', name: 'Usual USD', chain: 'ethereum' })).toBe(true);
        expect(isExcludedAlphaToken({ ticker: 'AUSD', name: 'AUSD', chain: 'base' })).toBe(true);
        expect(isExcludedAlphaToken({ ticker: 'GHO', name: 'GHO Stablecoin', chain: 'ethereum' })).toBe(true);
        expect(isExcludedAlphaToken({ ticker: 'EURC', name: 'Euro Coin', chain: 'base' })).toBe(true);
    });

    it('removes wrapped and bridged major assets', () => {
        expect(classifyAlphaToken({ ticker: 'WETH', name: 'Wrapped Ether', chain: 'solana' })).toMatchObject({
            excluded: true,
            reason: 'wrapped'
        });
        expect(isExcludedAlphaToken({ ticker: 'WBTC', name: 'Wrapped BTC', chain: 'ethereum' })).toBe(true);
        expect(isExcludedAlphaToken({ ticker: 'cbBTC', name: 'Coinbase Wrapped BTC', chain: 'base' })).toBe(true);
        expect(isExcludedAlphaToken({ ticker: 'cbXRP', name: 'Coinbase Wrapped XRP', chain: 'base' })).toBe(true);
        expect(isExcludedAlphaToken({ ticker: 'cbMEGA', name: 'Coinbase Wrapped Mega', chain: 'base' })).toBe(true);
    });

    it('removes chain-native majors from discovery feeds', () => {
        expect(classifyAlphaToken({ ticker: 'ETH', name: 'Ethereum Token', chain: 'bsc' })).toMatchObject({
            excluded: true,
            reason: 'major_asset'
        });
        expect(isExcludedAlphaToken({ ticker: 'SOL', name: 'SOLANA', chain: 'bsc' })).toBe(true);
        expect(isExcludedAlphaToken({ ticker: 'SEI', name: 'SEI', chain: 'ethereum' })).toBe(true);
        expect(isExcludedAlphaToken({ ticker: 'TRX', name: 'TRON', chain: 'bsc' })).toBe(true);
        expect(isExcludedAlphaToken({ ticker: 'ARB', name: 'Arbitrum', chain: 'ethereum' })).toBe(true);
        expect(isExcludedAlphaToken({ ticker: 'ARBITRUM', name: 'Arbitrum', chain: 'bsc' })).toBe(true);
        expect(isExcludedAlphaToken({ ticker: 'BASE', name: 'Base', chain: 'base' })).toBe(true);
        expect(isExcludedAlphaToken({ ticker: 'OP', name: 'Optimism', chain: 'ethereum' })).toBe(true);
    });

    it('keeps regular narrative and meme tokens', () => {
        expect(isExcludedAlphaToken({ ticker: 'PENGU', name: 'Pudgy Penguins', chain: 'solana', img: verifiedImage })).toBe(false);
        expect(isExcludedAlphaToken({ ticker: 'PUMP', name: 'Pump', chain: 'solana', img: verifiedImage })).toBe(false);
        expect(isExcludedAlphaToken({ ticker: 'TROLL', name: 'TROLL', chain: 'solana', img: verifiedImage })).toBe(false);
        expect(isExcludedAlphaToken({ ticker: 'WOJAK', name: 'Wojak Coin', chain: 'ethereum', img: verifiedImage })).toBe(false);
        expect(isExcludedAlphaToken({ ticker: 'ORCA', name: 'Orca', chain: 'solana', img: verifiedImage })).toBe(false);
        expect(isExcludedAlphaToken({ ticker: 'Fartcoin', name: 'Fartcoin', chain: 'solana', img: verifiedImage })).toBe(false);
    });

    it('removes weak metadata and placeholder-logo tokens from the feed', () => {
        expect(hasQualityTokenMetadata({ ticker: 'WO', name: 'FIFAWorldCupCoin', chain: 'solana' })).toBe(false);
        expect(hasQualityTokenMetadata({
            ticker: 'GA',
            name: 'Google AI',
            chain: 'solana',
            img: 'https://ui-avatars.com/api/?name=GA&background=random&color=fff'
        })).toBe(false);
        expect(hasQualityTokenMetadata({
            ticker: 'ALPHA',
            name: 'ALPHA',
            chain: 'solana',
            img: 'https://assets.example.com/placeholder-alpha.png'
        })).toBe(false);
        expect(filterAlphaTokens([{
            id: 1,
            name: 'Google AI',
            ticker: 'GA',
            price: '$0.01',
            h1: '0%',
            h24: '0%',
            d7: '0%',
            cap: '$100K',
            liquidity: '$120K',
            volume24h: '$4M',
            dexBuys: '100',
            dexSells: '90',
            dexFlow: 52,
            netFlow: '$10K',
            smartMoney: 'Neutral',
            smartMoneySignal: 'Neutral',
            signal: 'None',
            riskLevel: 'Low',
            age: '1 Day',
            createdTimestamp: Date.now(),
            img: 'https://ui-avatars.com/api/?name=GA&background=random&color=fff',
            trend: 'Bullish',
            chain: 'solana',
            address: 'ga-address'
        }])).toHaveLength(0);
    });
});
