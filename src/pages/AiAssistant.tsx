// Route-level product screen for the Atlaix application.
import React from 'react';
import { Brain } from 'lucide-react';

interface Message {
    id: number;
    text: string;
    sender: 'user' | 'ai';
    type?: 'text' | 'rich-token' | 'rich-sentiment';
}

export const AiAssistant: React.FC = () => {
    return (
        <div className="flex flex-col h-[calc(100vh-140px)] max-w-4xl mx-auto">
            <div className="flex-1 flex flex-col items-center justify-center text-center p-6">
                <div className="w-16 h-16 rounded-full bg-gradient-to-br from-card to-card-hover border border-border flex items-center justify-center mb-6 text-text-light">
                    <Brain size={32} />
                </div>
                <h2 className="text-2xl font-bold mb-2">Atlaix Intelligence</h2>
                <p className="text-text-medium max-w-md leading-relaxed">
                    AI Assistant is not available in this workspace yet.
                </p>
            </div>
        </div>
    );
};
