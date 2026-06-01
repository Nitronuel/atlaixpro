// Application router and lazy-loaded product surface registration.
import React, { Suspense, lazy } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import { Layout } from './components/layout/Layout';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { ProtectedRoute } from './components/auth/ProtectedRoute';

const AuthScreen = lazy(async () => ({ default: (await import('./pages/Auth')).AuthScreen }));
const Dashboard = lazy(async () => ({ default: (await import('./pages/Dashboard')).Dashboard }));
const TokenDetails = lazy(async () => ({ default: (await import('./pages/TokenDetails')).TokenDetails }));
const Heatmap = lazy(async () => ({ default: (await import('./pages/Heatmap')).Heatmap }));
const Sentiment = lazy(async () => ({ default: (await import('./pages/Sentiment')).Sentiment }));
const Detection = lazy(async () => ({ default: (await import('./pages/Detection')).Detection }));
const TokenDetection = lazy(async () => ({ default: (await import('./pages/TokenDetection')).TokenDetection }));
const AiAssistant = lazy(async () => ({ default: (await import('./pages/AiAssistant')).AiAssistant }));
const WalletTracking = lazy(async () => ({ default: (await import('./pages/WalletTracking')).WalletTracking }));
const SafeScan = lazy(async () => ({ default: (await import('./pages/SafefyScan')).SafefyScan }));
const SmartAlerts = lazy(async () => ({ default: (await import('./pages/SmartAlerts')).SmartAlerts }));
const SmartMoney = lazy(async () => ({ default: (await import('./pages/SmartMoney')).SmartMoney }));
const SmartWalletProfile = lazy(async () => ({ default: (await import('./pages/SmartWalletProfile')).SmartWalletProfile }));
const TokenSmartMoney = lazy(async () => ({ default: (await import('./pages/TokenSmartMoney')).TokenSmartMoney }));
const ProfileSettings = lazy(async () => ({ default: (await import('./pages/ProfileSettings')).ProfileSettings }));

const PlaceholderView = ({ title }: { title: string }) => (
    <div className="flex flex-col items-center justify-center h-full min-h-[50vh] text-center p-6 animate-fade-in">
        <h2 className="text-2xl font-bold mb-2 text-text-light">{title}</h2>
        <p className="text-text-medium">This workspace is not available yet.</p>
    </div>
);

const UnavailableView = () => (
    <div className="flex min-h-[58vh] flex-col items-center justify-center px-6 text-center animate-fade-in">
        <div className="max-w-md rounded-2xl border border-border bg-card px-8 py-10 shadow-sm">
            <h2 className="text-2xl font-black text-text-light">This page is unavailable.</h2>
            <p className="mt-3 text-sm font-semibold leading-6 text-text-medium">
                This workspace is temporarily disabled.
            </p>
        </div>
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

function AppContent() {
    const { user, profile, loading, signOut } = useAuth();
    const navigate = useNavigate();

    const handleLogout = async () => {
        await signOut();
        navigate('/dashboard', { replace: true });
    };

    const handleAuthRequest = () => {
        navigate('/login');
    };

    return (
        <Routes>
            <Route path="/auth" element={<Navigate to="/login" replace />} />
            <Route path="/login" element={<AuthScreen initialMode="login" />} />
            <Route path="/signup" element={<AuthScreen initialMode="signup" />} />
            <Route path="/reset-password" element={<AuthScreen initialMode="reset" />} />

            <Route path="/*" element={
                <Layout
                    isAuthenticated={Boolean(user)}
                    authLoading={loading}
                    profile={profile}
                    userEmail={user?.email || ''}
                    onLogin={handleAuthRequest}
                    onLogout={handleLogout}
                    currentView="overview"
                    onViewChange={(view) => {
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
                            <Route path="/sentiment" element={<Sentiment />} />

                            <Route path="/detection" element={<Detection />} />
                            <Route path="/detection/token/:query" element={<TokenDetection />} />

                            <Route path="/ai-assistant" element={<AiAssistant />} />

                            <Route path="/wallet" element={<WalletTracking />} />
                            <Route path="/wallet/:address" element={<WalletTracking />} />

                            <Route path="/safefy-scan" element={<Navigate to="/safe-scan" replace />} />
                            <Route path="/safe-scan" element={<SafeScan />} />
                            <Route path="/alchemy-hub" element={<Navigate to="/safe-scan" replace />} />

                            <Route path="/smart-money" element={<SmartMoney />} />
                            <Route path="/smart-money/:address" element={<SmartWalletProfile />} />
                            <Route path="/token-smart-money/:address" element={<TokenSmartMoney />} />
                            <Route path="/smart-alerts" element={<SmartAlerts />} />
                            <Route path="/settings" element={<ProtectedRoute><ProfileSettings /></ProtectedRoute>} />
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
            <AuthProvider>
                <AppContent />
            </AuthProvider>
        </BrowserRouter>
    );
}
