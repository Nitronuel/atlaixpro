import React, { useState } from 'react';

interface AuthScreenProps {
    onLogin: () => void;
    onSkip?: () => void;
}

export const AuthScreen: React.FC<AuthScreenProps> = ({ onLogin, onSkip }) => {
    const [mode, setMode] = useState<'login' | 'signup'>('login');

    return (
        <div className="min-h-screen flex flex-col items-center justify-center p-6 bg-main animate-fade-in text-center relative">
            {onSkip && (
                <div className="absolute top-6 right-6">
                    <button onClick={onSkip} className="text-text-medium hover:text-text-light font-bold text-sm transition-colors flex items-center gap-1 group">
                        Skip for now <span className="group-hover:translate-x-1 transition-transform">&rarr;</span>
                    </button>
                </div>
            )}

            <div className="flex items-center gap-3 text-3xl font-bold mb-2">
                <img 
                    src="./logo.png" 
                    alt="Atlaix Logo" 
                    className="w-12 h-12 object-contain" 
                    onError={(e) => (e.currentTarget.style.display = 'none')}
                />
                Atlaix
            </div>
            <p className="text-text-medium mb-12">Anticipating Trends Ahead of the Market...</p>
            
            <div className="flex w-full max-w-sm border-b border-border mb-8">
                <button 
                    className={`flex-1 pb-4 text-sm font-semibold border-b-2 transition-colors ${mode === 'login' ? 'border-primary-green text-text-light' : 'border-transparent text-text-dark hover:text-text-medium'}`}
                    onClick={() => setMode('login')}
                >
                    Log In
                </button>
                <button 
                    className={`flex-1 pb-4 text-sm font-semibold border-b-2 transition-colors ${mode === 'signup' ? 'border-primary-green text-text-light' : 'border-transparent text-text-dark hover:text-text-medium'}`}
                    onClick={() => setMode('signup')}
                >
                    Sign Up
                </button>
            </div>

            <form className="w-full max-w-sm" onSubmit={(e) => { e.preventDefault(); onLogin(); }}>
                <h1 className="text-3xl font-bold mb-8">{mode === 'login' ? 'Welcome Back!' : 'Create Account'}</h1>
                <div className="space-y-4">
                    <input type="text" className="w-full bg-card border border-border rounded-lg p-4 text-text-light focus:outline-none focus:border-primary-green transition-colors" placeholder="Username" />
                    <input type="password" className="w-full bg-card border border-border rounded-lg p-4 text-text-light focus:outline-none focus:border-primary-green transition-colors" placeholder="Password" />
                    {mode === 'signup' && (
                        <input type="password" className="w-full bg-card border border-border rounded-lg p-4 text-text-light focus:outline-none focus:border-primary-green transition-colors" placeholder="Confirm Password" />
                    )}
                    <button type="submit" className="w-full py-4 bg-primary-green text-main font-bold rounded-lg hover:bg-primary-green-light transition-colors mt-4">
                        {mode === 'login' ? 'Login' : 'Get Started'}
                    </button>
                </div>
                <p className="text-text-medium mt-6 text-sm">
                    {mode === 'login' ? "Don't have an account? " : "Already have an account? "}
                    <span className="text-primary-green-light font-semibold cursor-pointer hover:underline" onClick={() => setMode(mode === 'login' ? 'signup' : 'login')}>
                        {mode === 'login' ? 'Register' : 'Login here'}
                    </span>
                </p>
            </form>
            
            <button className="mt-8 w-14 h-14 rounded-full bg-card border border-border flex items-center justify-center hover:bg-card-hover transition-colors" onClick={onLogin}>
                <svg width="24" height="24" viewBox="0 0 24 24"><path fill="#fff" d="M12.48 10.92v3.28h7.84c-.24 1.84-.853 3.187-1.787 4.133-1.147 1.147-2.933 2.4-6.053 2.4-4.827 0-8.6-3.893-8.6-8.72s3.773-8.72 8.6-8.72c2.6 0 4.507 1.027 5.907 2.347l2.307-2.307C18.747 1.44 16.133 0 12.48 0 5.867 0 .533 5.347.533 12S5.867 24 12.48 24c3.44 0 6.373-1.133 8.573-3.293 2.253-2.253 2.947-5.733 2.947-8.547 0-.853-.053-1.693-.16-2.48h-11.36z"/></svg>
            </button>
        </div>
    );
};