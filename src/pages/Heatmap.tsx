import React from 'react';
import { Activity } from 'lucide-react';

export const Heatmap: React.FC = () => {
    return (
        <div className="flex flex-col items-center justify-center h-full min-h-[50vh] text-center p-6 animate-fade-in">
            <div className="w-16 h-16 bg-card border border-border rounded-2xl flex items-center justify-center mb-6 text-text-medium shadow-sm">
                <Activity size={32} />
            </div>
            <h2 className="text-2xl font-bold mb-2 text-text-light">Token Heatmap</h2>
            <p className="text-text-medium max-w-xs leading-relaxed">This feature is currently under construction and will be available in the next update.</p>
        </div>
    );
};