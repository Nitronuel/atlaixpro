// Atlaix: Reusable interface component for Atlaix product workflows.
import React from 'react';
import { Zap, Wallet as WalletIcon, AlertTriangle, X, Trash2, CheckCircle } from 'lucide-react';
import { WalletData, WalletCategory } from '../../types';
import { SavedWalletService } from '../../services/SavedWalletService';

interface WalletCardProps {
    wallet: WalletData;
    onClick: (w: WalletData) => void;
    onDelete?: () => void; // Optional callback after deletion
    selectedWalletAddr?: string;
    setDeleteConfirmId: (id: number | string | null) => void;
    deleteConfirmId: number | string | null;
    refreshWallets: () => void;
}

export const WalletCard: React.FC<WalletCardProps> = ({
    wallet: w,
    onClick,
    selectedWalletAddr,
    setDeleteConfirmId,
    deleteConfirmId,
    refreshWallets
}) => {

    // Helper to determine icon style
    const getIcon = () => {
        if (w.type === 'smart') return <Zap size={18} />;
        if (w.type === 'whale') return <WalletIcon size={18} />;
        if (w.type === 'sniper') return <AlertTriangle size={18} />;
        return <WalletIcon size={18} />;
    };

    const getIconStyle = () => {
        if (w.type === 'smart') return 'bg-primary-green/10 border-primary-green/30 text-primary-green';
        if (w.type === 'whale') return 'bg-primary-blue/10 border-primary-blue/30 text-primary-blue';
        if (w.type === 'sniper') return 'bg-primary-red/10 border-primary-red/30 text-primary-red';
        return 'bg-card border-border text-text-medium';
    };

    const handleDelete = (e: React.MouseEvent) => {
        e.stopPropagation();
        SavedWalletService.deleteWallet(w.addr);
        refreshWallets();
        setDeleteConfirmId(null);
    };

    return (
        <div
            className="bg-card border border-border rounded-xl p-5 hover:border-text-medium transition-all cursor-pointer group shadow-sm hover:shadow-md"
            onClick={() => onClick(w)}
        >
            <div className="flex justify-between items-start mb-4">
                <div className="flex items-center gap-2">
                    <div className={`w-10 h-10 rounded-full flex items-center justify-center border ${getIconStyle()}`}>
                        {getIcon()}
                    </div>
                    <div>
                        <div className="font-bold text-sm text-text-light">{w.tag}</div>
                        <div className="text-[10px] text-text-dark font-mono truncate w-24">{w.addr}</div>
                    </div>
                </div>
            </div>

            {/* Categories Tags */}
            <div className="flex flex-wrap gap-1 mb-3">
                {(w.categories || []).slice(0, 3).map(cat => (
                    <span key={cat} className="text-[10px] px-2 py-0.5 rounded-full bg-card border border-text-light/20 text-text-medium font-medium">
                        {cat}
                    </span>
                ))}
                {(w.categories || []).length > 3 && (
                    <span className="text-[10px] px-1.5 py-0.5 text-text-dark">+{(w.categories?.length || 0) - 3}</span>
                )}
            </div>

            <div className="grid grid-cols-3 gap-2 mb-4">
                <div>
                    <div className="text-[10px] text-text-dark font-bold uppercase">Balance</div>
                    <div className="text-base font-bold text-text-light">{w.bal}</div>
                </div>
                <div>
                    <div className="text-[10px] text-text-dark font-bold uppercase">Win Rate</div>
                    <div className="text-base font-bold text-text-light">{w.win}</div>
                </div>
                <div>
                    <div className="text-[10px] text-text-dark font-bold uppercase">PnL</div>
                    <div className={`text-base font-bold ${w.pnl.includes('+') ? 'text-primary-green' : w.pnl.includes('-') ? 'text-primary-red' : 'text-text-light'}`}>{w.pnl}</div>
                </div>
            </div>

            <div className="flex justify-between items-center text-xs text-text-medium border-t border-border/50 pt-3 h-9">
                {deleteConfirmId === w.id ? (
                    <div className="flex items-center justify-between w-full animate-in fade-in duration-200">
                        <span className="font-bold text-primary-red">Remove?</span>
                        <div className="flex gap-2">
                            <button
                                onClick={(e) => {
                                    e.stopPropagation();
                                    setDeleteConfirmId(null);
                                }}
                                className="p-1 hover:bg-card-hover rounded text-text-medium hover:text-text-light transition-colors"
                                title="Cancel"
                            >
                                <X size={14} />
                            </button>
                            <button
                                onClick={handleDelete}
                                className="p-1 bg-primary-red/10 hover:bg-primary-red/20 text-primary-red rounded transition-colors"
                                title="Confirm Delete"
                            >
                                <CheckCircle size={14} />
                            </button>
                        </div>
                    </div>
                ) : (
                    <>
                        <button
                            onClick={(e) => {
                                e.stopPropagation();
                                setDeleteConfirmId(w.id);
                            }}
                            className="text-text-medium hover:text-primary-red transition-colors flex items-center gap-1"
                            title="Remove from Watchlist"
                        >
                            <Trash2 size={14} />
                        </button>
                        <span className="text-[10px] px-3 py-1 rounded-full bg-card border border-text-light/20 text-text-medium font-medium group-hover:text-text-light group-hover:bg-card-hover transition-colors">
                            View Portfolio &rarr;
                        </span>
                    </>
                )}
            </div>
        </div>
    );
};
