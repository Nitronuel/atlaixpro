// Route guard for authenticated Atlaix workspaces.
import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';

const AuthLoading = () => (
    <div className="flex min-h-screen items-center justify-center bg-main text-text-light">
        <div className="flex flex-col items-center gap-3 rounded-lg border border-border bg-card px-8 py-10">
            <div className="h-10 w-10 rounded-full border-2 border-primary-green/40 border-t-primary-green animate-spin" />
            <div className="text-sm font-semibold uppercase tracking-[0.22em] text-text-medium">Checking session</div>
        </div>
    </div>
);

export const ProtectedRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const { user, loading } = useAuth();
    const location = useLocation();

    if (loading) return <AuthLoading />;
    if (!user) return <Navigate to="/login" replace state={{ from: location }} />;

    return <>{children}</>;
};

