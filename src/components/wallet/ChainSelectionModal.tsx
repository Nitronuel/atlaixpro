import React, { useState } from 'react';
import { X, Search } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

interface ChainSelectionModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSelectChain: (chain: string) => void;
}

export const ChainSelectionModal: React.FC<ChainSelectionModalProps> = ({ isOpen, onClose, onSelectChain }) => {
    const [searchTerm, setSearchTerm] = useState('');

    const chains = [
        { id: 'Ethereum', name: 'Ethereum', symbol: 'ETH' },
        { id: 'BSC', name: 'Binance Smart Chain', symbol: 'BSC' },
        { id: 'Base', name: 'Base', symbol: 'BASE' },
        { id: 'Arbitrum', name: 'Arbitrum', symbol: 'ARB' },
        { id: 'Optimism', name: 'Optimism', symbol: 'OP' },
        { id: 'Polygon', name: 'Polygon', symbol: 'MATIC' },
        { id: 'Avalanche', name: 'Avalanche', symbol: 'AVAX' },
    ];

    const filteredChains = chains.filter(c =>
        c.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        c.symbol.toLowerCase().includes(searchTerm.toLowerCase())
    );

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[9999] flex items-center justify-center p-4 animate-fade-in">
            <div className="bg-card border border-border rounded-xl w-full max-w-sm shadow-2xl overflow-hidden animate-zoom-in">
                <div className="p-4 border-b border-border flex justify-between items-center bg-card-hover/20">
                    <h3 className="font-bold text-lg text-text-light">Select Blockchain</h3>
                    <button
                        onClick={onClose}
                        className="text-text-medium hover:text-text-light transition-colors"
                    >
                        <X size={20} />
                    </button>
                </div>

                <div className="p-4 border-b border-border/50">
                    <div className="bg-main border border-border rounded-lg flex items-center px-3 py-2 focus-within:border-primary-green/50">
                        <Search className="text-text-medium mr-2" size={16} />
                        <input
                            type="text"
                            className="bg-transparent border-none text-text-light outline-none w-full text-sm placeholder-text-dark"
                            placeholder="Search chain..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            autoFocus
                        />
                    </div>
                </div>

                <div className="max-h-[300px] overflow-y-auto custom-scrollbar p-2">
                    <div className="flex flex-col gap-1">
                        {filteredChains.map((chain) => (
                            <button
                                key={chain.id}
                                onClick={() => onSelectChain(chain.id)}
                                className="flex items-center justify-between px-4 py-3 rounded-lg hover:bg-card-hover transition-colors group text-left"
                            >
                                <span className="font-medium text-text-light group-hover:text-primary-green transition-colors">{chain.name}</span>
                                <span className="text-xs text-text-medium px-2 py-0.5 rounded bg-main border border-border group-hover:border-primary-green/30">{chain.symbol}</span>
                            </button>
                        ))}
                        {filteredChains.length === 0 && (
                            <div className="text-center py-8 text-text-medium text-sm">
                                No chains found
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};
