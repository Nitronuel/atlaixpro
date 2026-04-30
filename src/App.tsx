// Atlaix: Application router and lazy-loaded product surface registration.
import React, { Suspense, lazy, useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import { Layout } from './components/layout/Layout';
import { AuthScreen } from './pages/Auth';

const Dashboard = lazy(async () => ({ default: (await import('./pages/Dashboard')).Dashboard }));
const TokenDetails = lazy(async () => ({ default: (await import('./pages/TokenDetails')).TokenDetails }));
const Heatmap = lazy(async () => ({ default: (await import('./pages/Heatmap')).Heatmap }));
const Detection = lazy(async () => ({ default: (await import('./pages/Detection')).Detection }));
const TokenDetection = lazy(async () => ({ default: (await import('./pages/TokenDetection')).TokenDetection }));
const AiAssistant = lazy(async () => ({ default: (await import('./pages/AiAssistant')).AiAssistant }));
const WalletTracking = lazy(async () => ({ default: (await import('./pages/WalletTracking')).WalletTracking }));
const SafeScan = lazy(async () => ({ default: (await import('./pages/SafeScan')).SafeScan }));
const SmartAlerts = lazy(async () => ({ default: (await import('./pages/SmartAlerts')).SmartAlerts }));
const SmartMoney = lazy(async () => ({ default: (await import('./pages/SmartMoney')).SmartMoney }));
const SmartMoneyScanner = lazy(async () => ({ default: (await import('./pages/SmartMoneyScanner')).SmartMoneyScanner }));
const SmartWalletProfile = lazy(async () => ({ default: (await import('./pages/SmartWalletProfile')).SmartWalletProfile }));
const TokenSmartMoney = lazy(async () => ({ default: (await import('./pages/TokenSmartMoney')).TokenSmartMoney }));

// Placeholder components for views not yet implemented
const PlaceholderView = ({ title }: { title: string }) => (
    <div className="flex flex-col items-center justify-center h-full min-h-[50vh] text-center p-6 animate-fade-in">
        <h2 className="text-2xl font-bold mb-2 text-text-light">{title}</h2>
        <p className="text-text-medium">This feature is coming soon.</p>
    </div>
);

const RouteSkeleton = () => (
    <div className="flex min-h-[50vh] items-center justify-center p-6 text-center animate-fade-in">
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-border bg-card px-8 py-10">
            <div className="h-10 w-10 rounded-full border-2 border-primary-green/40 border-t-primary-green animate-spin" />
            <div className="text-sm font-medium uppercase tracking-[0.24em] text-text-medium">Loading view</div>
        </div>
    </div>
);

// We need a wrapper to hold the Auth State since BrowserRouter is at the top level
function AppContent() {
    const [isAuthenticated, setIsAuthenticated] = useState(false);
    const navigate = useNavigate();

    const handleLogin = () => {
        setIsAuthenticated(true);
        navigate('/dashboard');
    };

    const handleLogout = () => {
        setIsAuthenticated(false);
        navigate('/dashboard');
    };

    const handleAuthRequest = () => {
        navigate('/auth');
    };

    // We pass a dummy 'currentView' to Layout because we will update Layout 
    // to ignore it and use useLocation() instead.
    return (
        <Routes>
            <Route path="/auth" element={<AuthScreen onLogin={handleLogin} onSkip={() => navigate('/dashboard')} />} />

            <Route path="/*" element={
                <Layout
                    isAuthenticated={isAuthenticated}
                    onLogin={handleAuthRequest}
                    onLogout={handleLogout}
                    currentView="overview" // Placeholder, Layout determines active via URL
                    onViewChange={(view) => {
                        // Map view enum to routes for legacy generic calls if any
                        const routes: Record<string, string> = {
                            'overview': '/dashboard',

                            'heatmap': '/heatmap',
                            'sentiment': '/sentiment',
                            'detection': '/detection',
                            'ai-assistant': '/ai-assistant',
                            'wallet-tracking': '/wallet',
                            'safe-scan': '/safe-scan',
                            'settings': '/settings',
                            'smart-money': '/smart-money',
                            'smart-money-scanner': '/smart-money-scanner',
                            'smart-alerts': '/smart-alerts'
                        };
                        if (routes[view]) navigate(routes[view]);
                    }}
                >
                    <Suspense fallback={<RouteSkeleton />}>
                        <Routes>
                            <Route path="/" element={<Navigate to="/dashboard" replace />} />
                            <Route path="/dashboard" element={<Dashboard />} />
                            <Route path="/token/:address" element={<TokenDetails />} />


                            <Route path="/heatmap" element={<Heatmap />} />
                            <Route path="/sentiment" element={<PlaceholderView title="Sentiment Intelligence" />} />

                            <Route path="/detection" element={<Detection />} />
                            <Route path="/detection/token/:query" element={<TokenDetection />} />

                            <Route path="/ai-assistant" element={<AiAssistant />} />

                            <Route path="/wallet" element={<WalletTracking />} />
                            <Route path="/wallet/:address" element={<WalletTracking />} />

                            <Route path="/safe-scan" element={<SafeScan />} />
                            <Route path="/alchemy-hub" element={<Navigate to="/safe-scan" replace />} />

                            <Route path="/smart-money" element={<SmartMoney />} />
                            <Route path="/smart-money-scanner" element={<SmartMoneyScanner />} />
                            <Route path="/smart-money/:address" element={<SmartWalletProfile />} />
                            <Route path="/token-smart-money/:address" element={<TokenSmartMoney />} />
                            <Route path="/smart-alerts" element={<SmartAlerts />} />
                            <Route path="/settings" element={<PlaceholderView title="Settings" />} />
                        </Routes>
                    </Suspense>
                </Layout>
            } />
        </Routes>
    );
}

export default function App() {
    return (
        <BrowserRouter>
            <AppContent />
        </BrowserRouter>
    );
}
