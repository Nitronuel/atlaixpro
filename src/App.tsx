import React, { useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import { Layout } from './components/layout/Layout';
import { AuthScreen } from './pages/Auth';
import { Dashboard } from './pages/Dashboard';
import { TokenDetails } from './pages/TokenDetails';
import { Heatmap } from './pages/Heatmap';
import { Detection } from './pages/Detection';
import { TokenDetection } from './pages/TokenDetection';
import { AiAssistant } from './pages/AiAssistant';
import { WalletTracking } from './pages/WalletTracking';
import { SafeScan } from './pages/SafeScan';
import { SmartAlerts } from './pages/SmartAlerts';
import { SmartMoney } from './pages/SmartMoney';
import { SmartWalletProfile } from './pages/SmartWalletProfile';
import { TokenSmartMoney } from './pages/TokenSmartMoney';
import { ViewState } from './types';

// Placeholder components for views not yet implemented
const PlaceholderView = ({ title }: { title: string }) => (
    <div className="flex flex-col items-center justify-center h-full min-h-[50vh] text-center p-6 animate-fade-in">
        <h2 className="text-2xl font-bold mb-2 text-text-light">{title}</h2>
        <p className="text-text-medium">This feature is coming soon.</p>
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
                            'virality': '/virality',
                            'ai-assistant': '/ai-assistant',
                            'wallet-tracking': '/wallet',
                            'safe-scan': '/safe-scan',
                            'settings': '/settings',
                            'smart-money': '/smart-money',
                            'smart-alerts': '/smart-alerts'
                        };
                        if (routes[view]) navigate(routes[view]);
                    }}
                >
                    <Routes>
                        <Route path="/" element={<Navigate to="/dashboard" replace />} />
                        <Route path="/dashboard" element={<Dashboard />} />
                        <Route path="/token/:address" element={<TokenDetails />} />


                        <Route path="/heatmap" element={<Heatmap />} />
                        <Route path="/sentiment" element={<PlaceholderView title="Sentiment Intelligence" />} />

                        <Route path="/detection" element={<Detection />} />
                        <Route path="/detection/token/:query" element={<TokenDetection />} />

                        <Route path="/virality" element={<PlaceholderView title="Virality Prediction" />} />
                        <Route path="/ai-assistant" element={<AiAssistant />} />

                        <Route path="/wallet" element={<WalletTracking />} />
                        <Route path="/wallet/:address" element={<WalletTracking />} />

                        <Route path="/safe-scan" element={<SafeScan />} />

                        <Route path="/smart-money" element={<SmartMoney />} />
                        <Route path="/smart-money/:address" element={<SmartWalletProfile />} />
                        <Route path="/token-smart-money/:address" element={<TokenSmartMoney />} />
                        <Route path="/smart-alerts" element={<SmartAlerts />} />
                        <Route path="/settings" element={<PlaceholderView title="Settings" />} />
                    </Routes>
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
