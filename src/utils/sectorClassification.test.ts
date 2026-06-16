import { describe, expect, it } from 'vitest';
import { classifyTokenSector, getSectorLabel } from './sectorClassification';

describe('provider-backed sector metadata', () => {
    it('does not infer sector from ticker or token name', () => {
        expect(classifyTokenSector({ ticker: 'AAA', name: 'Example Finance', chain: 'ethereum' })).toMatchObject({
            primarySector: 'unverified',
            label: 'Unverified',
            confidence: 'unverified'
        });
        expect(classifyTokenSector({ ticker: 'BBB', name: 'Example Animal Token', chain: 'bsc' })).toMatchObject({
            primarySector: 'unverified',
            label: 'Unverified',
            confidence: 'unverified'
        });
    });

    it('uses upstream category/tag/label metadata when a provider supplies it', () => {
        expect(classifyTokenSector({
            ticker: 'TOKEN',
            name: 'Provider Tagged Token',
            providerCategories: ['defi'],
            providerTags: ['perpetual futures'],
            providerLabels: ['dex']
        })).toMatchObject({
            primarySector: 'defi',
            label: 'DeFi',
            confidence: 'provider',
            source: 'provider'
        });
    });

    it('maps provider labels only into the supported user-facing taxonomy', () => {
        expect(classifyTokenSector({
            ticker: 'TOKEN',
            name: 'Token',
            sectorLabels: ['real-world-assets', 'tokenized credit']
        })).toMatchObject({
            primarySector: 'rwa',
            label: 'RWA',
            secondarySectors: []
        });
    });

    it('maps common CoinGecko category names and ids', () => {
        expect(classifyTokenSector({
            ticker: 'TOKEN',
            name: 'Token',
            providerCategories: ['Solana Meme']
        })).toMatchObject({
            primarySector: 'meme',
            label: 'Meme'
        });

        expect(classifyTokenSector({
            ticker: 'TOKEN',
            name: 'Token',
            providerCategories: ['gaming-gamefi']
        })).toMatchObject({
            primarySector: 'gaming',
            label: 'Gaming'
        });
    });

    it('does not expose raw DEX/pool labels as sectors', () => {
        expect(classifyTokenSector({
            ticker: 'TOKEN',
            name: 'Token',
            providerLabels: ['CLMM', 'V2', 'DYN']
        })).toMatchObject({
            primarySector: 'unverified',
            label: 'Unverified',
            confidence: 'unverified'
        });
    });

    it('uses provider launchpad metadata without token-specific overrides', () => {
        expect(classifyTokenSector({
            ticker: 'TOKEN',
            name: 'Launchpad Token',
            providerTags: ['solana meme launchpad']
        })).toMatchObject({
            primarySector: 'meme',
            label: 'Meme',
            confidence: 'provider'
        });
    });

    it('keeps the Unverified display label for missing provider evidence', () => {
        const result = classifyTokenSector({ ticker: 'ZXQ', name: 'ZXQ', chain: 'bsc' });
        expect(result.primarySector).toBe('unverified');
        expect(getSectorLabel(result.primarySector)).toBe('Unverified');
    });
});
