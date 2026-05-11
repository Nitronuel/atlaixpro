// Route-level authentication screen for Atlaix accounts.
import React, { useEffect, useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { AlertCircle, CheckCircle, Mail } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';

type AuthMode = 'login' | 'signup' | 'reset';

interface AuthScreenProps {
    initialMode?: AuthMode;
}

const formatAuthError = (value: unknown, fallback = 'Authentication could not complete. Please try again.') => {
    const message = value instanceof Error ? value.message : String(value || '');
    if (!message) return fallback;
    console.warn('[Auth] Sign-in flow error', value);
    if (/invalid login|invalid credentials|email.*password|password.*email/i.test(message)) return 'Email or password is incorrect.';
    if (/already registered|already exists|user already/i.test(message)) return 'An account already exists for this email.';
    if (/rate limit|too many|over email send rate/i.test(message)) return 'Too many attempts. Please wait a moment and try again.';
    if (/quota|setitem|storage|localstorage|sessionstorage/i.test(message)) {
        return 'We could not finish signing you in on this browser. Refresh the page and try again.';
    }
    if (/supabase|api|provider|configured|configuration|network|fetch|server|database|endpoint|auth-token|jwt|token/i.test(message)) return fallback;
    if (message.length > 120 || /['"`{}()[\]]|failed to execute|typeerror|referenceerror|syntaxerror/i.test(message)) return fallback;
    return message;
};

export const AuthScreen: React.FC<AuthScreenProps> = ({ initialMode = 'login' }) => {
    const [mode, setMode] = useState<AuthMode>(initialMode);
    const [email, setEmail] = useState('');
    const [displayName, setDisplayName] = useState('');
    const [password, setPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const [message, setMessage] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const { user, loading, profileError, signIn, signUp, resetPassword, signInWithGoogle } = useAuth();
    const navigate = useNavigate();
    const location = useLocation();
    const from = (location.state as { from?: { pathname?: string } } | null)?.from?.pathname || '/dashboard';

    useEffect(() => {
        setMode(initialMode);
        setMessage(null);
        setError(null);
    }, [initialMode]);

    if (!loading && user) {
        return <Navigate to={from} replace />;
    }

    const handleSubmit = async (event: React.FormEvent) => {
        event.preventDefault();
        setSubmitting(true);
        setMessage(null);
        setError(null);

        try {
            if (!email.trim()) throw new Error('Enter your email address.');

            if (mode === 'reset') {
                await resetPassword(email.trim());
                setMessage('Password reset email sent. Check your inbox.');
                return;
            }

            if (password.length < 6) throw new Error('Password must be at least 6 characters.');

            if (mode === 'signup') {
                if (password !== confirmPassword) throw new Error('Passwords do not match.');
                const result = await signUp(email.trim(), password, displayName.trim());
                if (result.needsEmailConfirmation) {
                    setMessage('Account created. Check your email to confirm your login.');
                } else {
                    navigate('/dashboard', { replace: true });
                }
                return;
            }

            await signIn(email.trim(), password);
            navigate(from, { replace: true });
        } catch (err) {
            setError(formatAuthError(err));
        } finally {
            setSubmitting(false);
        }
    };

    const handleGoogle = async () => {
        setSubmitting(true);
        setError(null);
        try {
            await signInWithGoogle();
        } catch (err) {
            setError(formatAuthError(err, 'Google sign-in could not start. Please try again.'));
            setSubmitting(false);
        }
    };

    const title = mode === 'login' ? 'Welcome back' : mode === 'signup' ? 'Create account' : 'Reset password';
    const buttonText = mode === 'login' ? 'Log in' : mode === 'signup' ? 'Create account' : 'Send reset email';

    return (
        <div className="relative flex min-h-screen flex-col items-center justify-center bg-main p-6 text-center text-text-light animate-fade-in">
            <div className="mb-2 flex items-center gap-3 text-3xl font-bold">
                <img
                    src="/logo.png"
                    alt="Atlaix Logo"
                    className="h-12 w-12 rounded-xl object-contain"
                    onError={(event) => (event.currentTarget.style.display = 'none')}
                />
                Atlaix
            </div>
            <p className="mb-12 text-text-medium">Anticipating Trends Ahead of the Market...</p>

            <div className="mb-8 flex w-full max-w-sm border-b border-border">
                <button
                    type="button"
                    className={`flex-1 border-b-2 pb-4 text-sm font-semibold transition-colors ${mode === 'login' ? 'border-primary-green text-text-light' : 'border-transparent text-text-dark hover:text-text-medium'}`}
                    onClick={() => setMode('login')}
                >
                    Sign in
                </button>
                <button
                    type="button"
                    className={`flex-1 border-b-2 pb-4 text-sm font-semibold transition-colors ${mode === 'signup' ? 'border-primary-green text-text-light' : 'border-transparent text-text-dark hover:text-text-medium'}`}
                    onClick={() => setMode('signup')}
                >
                    Create account
                </button>
            </div>

            <form className="w-full max-w-sm" onSubmit={handleSubmit}>
                <h1 className="mb-8 text-3xl font-bold">
                    {title}{mode === 'login' ? '!' : ''}
                </h1>

                <div className="space-y-4">
                    {mode === 'signup' && (
                        <input
                            type="text"
                            value={displayName}
                            onChange={(event) => setDisplayName(event.target.value)}
                            className="w-full rounded-lg border border-border bg-card p-4 text-text-light transition-colors focus:border-primary-green focus:outline-none"
                            placeholder="Display name"
                            autoComplete="name"
                        />
                    )}

                    <input
                        type="email"
                        value={email}
                        onChange={(event) => setEmail(event.target.value)}
                        className="w-full rounded-lg border border-border bg-card p-4 text-text-light transition-colors focus:border-primary-green focus:outline-none"
                        placeholder="Email"
                        autoComplete="email"
                    />

                    {mode !== 'reset' && (
                        <input
                            type="password"
                            value={password}
                            onChange={(event) => setPassword(event.target.value)}
                            className="w-full rounded-lg border border-border bg-card p-4 text-text-light transition-colors focus:border-primary-green focus:outline-none"
                            placeholder="Password"
                            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                        />
                    )}

                    {mode === 'signup' && (
                        <input
                            type="password"
                            value={confirmPassword}
                            onChange={(event) => setConfirmPassword(event.target.value)}
                            className="w-full rounded-lg border border-border bg-card p-4 text-text-light transition-colors focus:border-primary-green focus:outline-none"
                            placeholder="Confirm Password"
                            autoComplete="new-password"
                        />
                    )}

                    {(error || profileError) && (
                        <div className="flex items-start gap-2 rounded-lg border border-primary-red/30 bg-primary-red/10 p-3 text-left text-sm text-primary-red">
                            <AlertCircle size={17} className="mt-0.5 shrink-0" />
                            <span>{error || profileError}</span>
                        </div>
                    )}

                    {message && (
                        <div className="flex items-start gap-2 rounded-lg border border-primary-green/30 bg-primary-green/10 p-3 text-left text-sm text-primary-green">
                            <CheckCircle size={17} className="mt-0.5 shrink-0" />
                            <span>{message}</span>
                        </div>
                    )}

                    <button
                        type="submit"
                        disabled={submitting}
                        className="mt-4 w-full rounded-lg bg-primary-green py-4 font-bold text-main transition-colors hover:bg-primary-green-light disabled:cursor-not-allowed disabled:opacity-60"
                    >
                        {submitting ? 'Working...' : buttonText}
                    </button>
                </div>

                <div className="mt-6 flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-sm text-text-medium">
                    {mode !== 'reset' ? (
                        <button type="button" className="font-semibold hover:text-primary-green-light" onClick={() => setMode('reset')}>
                            Forgot password?
                        </button>
                    ) : (
                        <button type="button" className="font-semibold hover:text-primary-green-light" onClick={() => setMode('login')}>
                            Back to login
                        </button>
                    )}

                    <span>
                        {mode === 'login' ? "Don't have an account? " : mode === 'signup' ? 'Already have an account? ' : ''}
                        {mode !== 'reset' && (
                            <button
                                type="button"
                                className="font-semibold text-primary-green-light hover:underline"
                                onClick={() => setMode(mode === 'login' ? 'signup' : 'login')}
                            >
                                {mode === 'login' ? 'Create account' : 'Sign in instead'}
                            </button>
                        )}
                    </span>
                </div>
            </form>

            {mode !== 'reset' && (
                <button
                    type="button"
                    className="mt-8 flex h-14 w-14 items-center justify-center rounded-full border border-border bg-card transition-colors hover:bg-card-hover disabled:cursor-not-allowed disabled:opacity-60"
                    onClick={handleGoogle}
                    disabled={submitting}
                    aria-label="Continue with Google"
                    title="Continue with Google"
                >
                    <Mail size={22} className="text-text-light" />
                </button>
            )}
        </div>
    );
};
