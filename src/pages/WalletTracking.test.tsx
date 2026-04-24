import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WalletTracking } from './WalletTracking';
import { SavedWalletService } from '../services/SavedWalletService';

const mockUseWalletPortfolio = vi.fn();

vi.mock('../hooks/useWalletPortfolio', () => ({
    useWalletPortfolio: (...args: unknown[]) => mockUseWalletPortfolio(...args)
}));

const LocationDisplay = () => {
    const location = useLocation();
    return <div data-testid="location-display">{location.pathname}{location.search}</div>;
};

describe('WalletTracking page', () => {
    beforeEach(() => {
        localStorage.clear();
        mockUseWalletPortfolio.mockReturnValue({
            loading: false,
            portfolioData: {
                netWorth: '$123.00',
                assets: [],
                recentActivity: [],
                providerUsed: 'Moralis',
                chainIcon: '',
                timestamp: Date.now()
            },
            walletStats: {
                winRate: 'N/A',
                totalPnL: 'N/A',
                netWorth: '$123.00',
                activePositions: 0,
                profitableTrader: '0',
                avgHoldTime: 'N/A'
            },
            refreshPortfolio: vi.fn()
        });
    });

    it('shows an error for invalid wallet search input', async () => {
        const user = userEvent.setup();

        render(
            <MemoryRouter initialEntries={['/wallet']}>
                <Routes>
                    <Route path="/wallet" element={<WalletTracking />} />
                </Routes>
            </MemoryRouter>
        );

        await user.type(screen.getByPlaceholderText('Search wallet address...'), '0x123');
        await user.click(screen.getByRole('button', { name: 'Track' }));

        expect(screen.getByText(/valid EVM or Solana wallet address/i)).toBeInTheDocument();
    });

    it('shows an error when a wallet route contains an invalid address', () => {
        render(
            <MemoryRouter initialEntries={['/wallet/not-a-wallet']}>
                <Routes>
                    <Route path="/wallet/:address" element={<WalletTracking />} />
                </Routes>
            </MemoryRouter>
        );

        expect(screen.getByText(/valid EVM or Solana wallet address/i)).toBeInTheDocument();
    });

    it('hides simulated trending wallet cards', () => {
        render(
            <MemoryRouter initialEntries={['/wallet']}>
                <Routes>
                    <Route path="/wallet" element={<WalletTracking />} />
                </Routes>
            </MemoryRouter>
        );

        expect(screen.getByText(/temporarily hidden until it is backed by real wallet telemetry/i)).toBeInTheDocument();
    });

    it('tracks a Solana wallet from search and lands on the Solana profile route', async () => {
        const user = userEvent.setup();
        const solanaWallet = '68VzUdiSmH2yiRZbNm9MCkqND2bNRJmpAQwRjoLEPg6B';

        render(
            <MemoryRouter initialEntries={['/wallet']}>
                <Routes>
                    <Route path="/wallet" element={<><WalletTracking /><LocationDisplay /></>} />
                    <Route path="/wallet/:address" element={<><WalletTracking /><LocationDisplay /></>} />
                </Routes>
            </MemoryRouter>
        );

        await user.type(screen.getByPlaceholderText('Search wallet address...'), solanaWallet);
        await user.click(screen.getByRole('button', { name: 'Track' }));

        expect(screen.getByTestId('location-display')).toHaveTextContent(`/wallet/${solanaWallet}?chain=Solana`);
        expect(screen.getByText(solanaWallet)).toBeInTheDocument();
    });

    it('opens a saved Solana wallet from the watchlist with a Solana chain query', async () => {
        const user = userEvent.setup();
        const solanaWallet = '68VzUdiSmH2yiRZbNm9MCkqND2bNRJmpAQwRjoLEPg6B';

        SavedWalletService.saveWallet(solanaWallet, 'Alpha Sol', ['Smart Money']);

        render(
            <MemoryRouter initialEntries={['/wallet']}>
                <Routes>
                    <Route path="/wallet" element={<><WalletTracking /><LocationDisplay /></>} />
                    <Route path="/wallet/:address" element={<><WalletTracking /><LocationDisplay /></>} />
                </Routes>
            </MemoryRouter>
        );

        await user.click(screen.getByText('Alpha Sol'));

        expect(screen.getByTestId('location-display')).toHaveTextContent(`/wallet/${solanaWallet}?chain=Solana`);
    });

    it('renders Solana holdings on the wallet profile page', () => {
        const solanaWallet = '68VzUdiSmH2yiRZbNm9MCkqND2bNRJmpAQwRjoLEPg6B';
        mockUseWalletPortfolio.mockReturnValue({
            loading: false,
            portfolioData: {
                netWorth: '$13,662.61',
                assets: [
                    {
                        symbol: 'USDC',
                        address: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
                        balance: '13,669.4471 USDC',
                        value: '$13,662.61',
                        price: '$0.9995',
                        currentPrice: 0.9995,
                        logo: 'https://example.com/usdc.png',
                        rawValue: 13662.61,
                        chain: 'Solana',
                        chainLogo: 'https://example.com/sol.png',
                        pnl: 'N/A',
                        avgBuy: 'N/A'
                    }
                ],
                recentActivity: [],
                providerUsed: 'Moralis',
                chainIcon: '',
                timestamp: Date.now()
            },
            walletStats: {
                winRate: 'N/A',
                totalPnL: 'N/A',
                netWorth: '$13,662.61',
                activePositions: 1,
                profitableTrader: '0',
                avgHoldTime: 'N/A'
            },
            refreshPortfolio: vi.fn()
        });

        render(
            <MemoryRouter initialEntries={[`/wallet/${solanaWallet}?chain=Solana`]}>
                <Routes>
                    <Route path="/wallet/:address" element={<WalletTracking />} />
                </Routes>
            </MemoryRouter>
        );

        expect(screen.getByText('USDC')).toBeInTheDocument();
        expect(screen.getByText('13,669.4471 USDC')).toBeInTheDocument();
        expect(screen.getAllByText('$13,662.61').length).toBeGreaterThan(0);
        expect(screen.getAllByText('Solana').length).toBeGreaterThan(0);
    });

    it('auto-promotes qualifying tracked wallets into smart money', async () => {
        const solanaWallet = '68VzUdiSmH2yiRZbNm9MCkqND2bNRJmpAQwRjoLEPg6B';
        mockUseWalletPortfolio.mockReturnValue({
            loading: false,
            portfolioData: {
                netWorth: '$145,000.00',
                assets: [],
                recentActivity: [],
                providerUsed: 'Moralis',
                chainIcon: '',
                timestamp: Date.now()
            },
            walletStats: {
                winRate: '68%',
                totalPnL: '+32.5%',
                netWorth: '$145,000.00',
                activePositions: 6,
                profitableTrader: '4',
                avgHoldTime: '12 Days'
            },
            refreshPortfolio: vi.fn()
        });

        render(
            <MemoryRouter initialEntries={[`/wallet/${solanaWallet}?chain=Solana`]}>
                <Routes>
                    <Route path="/wallet/:address" element={<WalletTracking />} />
                </Routes>
            </MemoryRouter>
        );

        const savedWallet = SavedWalletService.getWallet(solanaWallet);
        expect(savedWallet).toBeDefined();
        expect(savedWallet?.categories).toContain('Smart Money');
        expect(savedWallet?.qualification?.qualified).toBe(true);
    });
});
