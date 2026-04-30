// Reusable interface component for Atlaix product workflows.
import React, { useState } from 'react';
import { X } from 'lucide-react';
import { SavedWalletService } from '../../services/SavedWalletService';
import { validateWalletAddress } from '../../utils/wallet';

interface AddWalletModalProps {
    onClose: () => void;
    onAdded: (address: string) => void;
}

export const AddWalletModal: React.FC<AddWalletModalProps> = ({ onClose, onAdded }) => {
    const [newWalletName, setNewWalletName] = useState('');
    const [newWalletAddress, setNewWalletAddress] = useState('');
    const [error, setError] = useState('');

    const handleAdd = () => {
        const validation = validateWalletAddress(newWalletAddress);
        const addr = validation.normalizedAddress;
        const name = newWalletName.trim() || 'Watched Wallet';

        if (!validation.isValid) {
            setError(validation.error || 'Enter a valid wallet address.');
            return;
        }

        SavedWalletService.saveWallet(addr, name, []);
        onAdded(addr);
        onClose();
    };

    return (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-fade-in">
            <div className="bg-card border border-border rounded-xl w-full max-w-md shadow-2xl overflow-hidden animate-zoom-in">
                <div className="p-4 border-b border-border flex justify-between items-center bg-card-hover/20">
                    <h3 className="font-bold text-lg text-text-light">Add New Wallet</h3>
                    <button
                        onClick={onClose}
                        className="text-text-medium hover:text-text-light transition-colors"
                    >
                        <X size={20} />
                    </button>
                </div>
                <div className="p-6 flex flex-col gap-4">
                    <div className="flex flex-col gap-1.5">
                        <label className="text-xs font-bold text-text-dark uppercase">Wallet Name</label>
                        <input
                            type="text"
                            className="bg-main border border-border rounded-lg p-3 text-text-light text-sm outline-none focus:border-primary-green transition-colors placeholder-text-dark"
                            placeholder="e.g. My Vault, Smart Tracker"
                            value={newWalletName}
                            onChange={(e) => setNewWalletName(e.target.value)}
                            autoFocus
                        />
                    </div>
                    <div className="flex flex-col gap-1.5">
                        <label className="text-xs font-bold text-text-dark uppercase">Wallet Address</label>
                        <input
                            type="text"
                            className="bg-main border border-border rounded-lg p-3 text-text-light text-sm outline-none focus:border-primary-green transition-colors placeholder-text-dark font-mono"
                            placeholder="0x... or Solana address"
                            value={newWalletAddress}
                            onChange={(e) => {
                                setNewWalletAddress(e.target.value);
                                if (error) setError('');
                            }}
                            onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
                        />
                        {error && <div className="text-xs text-primary-red">{error}</div>}
                    </div>
                </div>
                <div className="p-4 border-t border-border flex justify-end gap-3 bg-card-hover/10">
                    <button
                        onClick={onClose}
                        className="px-4 py-2 rounded-lg border border-border text-text-medium hover:text-text-light hover:bg-card-hover transition-colors font-medium text-sm"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={handleAdd}
                        disabled={!newWalletAddress.trim()}
                        className="px-4 py-2 rounded-lg bg-primary-green text-main font-bold hover:bg-primary-green-darker transition-colors disabled:opacity-50 disabled:cursor-not-allowed text-sm"
                    >
                        Add Wallet
                    </button>
                </div>
            </div>
        </div>
    );
};
