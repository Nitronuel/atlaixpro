import React, { useState, useRef, useEffect } from 'react';
import { Search, ChevronDown, Zap, ArrowLeft, Globe, Clock, Plus, CheckCircle, X } from 'lucide-react';
import { SavedWalletService } from '../services/SavedWalletService';
import { SavedWallet, WalletCategory, WalletData } from '../types';
import { useNavigate, useSearchParams, useParams } from 'react-router-dom';
import { useWalletPortfolio } from '../hooks/useWalletPortfolio';
import { AddWalletModal } from '../components/wallet/AddWalletModal';
import { ChainSelectionModal } from '../components/wallet/ChainSelectionModal';
import { WalletStatsGrid } from '../components/wallet/WalletStatsGrid';
import { HoldingsTable } from '../components/wallet/HoldingsTable';
import { WalletCard } from '../components/wallet/WalletCard';

export const WalletTracking: React.FC = () => {
    const { address } = useParams<{ address: string }>();
    const navigate = useNavigate();
    const viewMode = address ? 'profile' : 'dashboard';

    // UI State
    const [searchQuery, setSearchQuery] = useState('');
    const [savedWallets, setSavedWallets] = useState<SavedWallet[]>([]);
    const [activeFilter, setActiveFilter] = useState<string | null>(null);
    const [searchParams] = useSearchParams();
    const [chain, setChain] = useState(searchParams.get('chain') || 'All Chains');
    const [walletType, setWalletType] = useState('Smart Money');
    const [timeFilter, setTimeFilter] = useState<'ALL' | '1D' | '1W' | '1M' | '>1M'>('ALL');

    // Sync chain from URL if it changes
    useEffect(() => {
        const urlChain = searchParams.get('chain');
        if (urlChain && urlChain !== chain) {
            setChain(urlChain);
        }
    }, [searchParams]);

    // Modal State
    const [showAddModal, setShowAddModal] = useState(false);
    const [showChainModal, setShowChainModal] = useState(false);
    const [pendingAddress, setPendingAddress] = useState<string | null>(null);
    const [deleteConfirmId, setDeleteConfirmId] = useState<number | string | null>(null);

    // Edit Profile State
    const [isEditing, setIsEditing] = useState(false);
    const [editName, setEditName] = useState('');
    const [selectedCategories, setSelectedCategories] = useState<WalletCategory[]>([]);

    const buttonRefs = useRef<{ [key: string]: HTMLButtonElement | null }>({});
    const searchInputRef = useRef<HTMLInputElement>(null);

    // Load saved wallets
    useEffect(() => {
        setSavedWallets(SavedWalletService.getWallets());
    }, []);

    // Helper: Restore wallet meta if we are viewing a saved wallet
    const existingWallet = address ? SavedWalletService.getWallet(address) : null;
    useEffect(() => {
        if (existingWallet) {
            setEditName(existingWallet.name);
            setSelectedCategories(existingWallet.categories);
        } else {
            setEditName('');
            setSelectedCategories(['Smart Money']);
        }
        setIsEditing(false);
        // FIX: Only reset time filter if the ADDRESS changes, not on every render
        // setTimeFilter('ALL'); 
    }, [address]); // Only run when navigating to a new address

    // Use Custom Hook for Data
    const { loading, portfolioData, walletStats } = useWalletPortfolio(address, chain, undefined, timeFilter);

    const toggleFilter = (name: string) => setActiveFilter(activeFilter === name ? null : name);

    // Dropdown Position Helper
    const getDropdownStyle = (key: string) => {
        const button = buttonRefs.current[key];
        if (!button) return {};
        const rect = button.getBoundingClientRect();
        return {
            position: 'fixed' as const,
            top: `${rect.bottom + 8}px`,
            left: `${rect.left}px`,
            zIndex: 9999,
            minWidth: `${rect.width}px`
        };
    };

    // Close dropdowns on click outside
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (activeFilter) {
                const target = event.target as Element;
                if (!target.closest('.filter-wrapper') && !target.closest('.filter-popup')) {
                    setActiveFilter(null);
                }
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [activeFilter]);

    const handleTrack = (addrInput?: string) => {
        const target = addrInput || searchQuery.trim();
        if (!target) return;

        // Check if it's an EVM address
        if (target.startsWith('0x') && target.length === 42) {
            setPendingAddress(target);
            setShowChainModal(true);
            return;
        }

        navigate(`/wallet/${target}`);
        setSearchQuery('');
    };

    const handleChainSelect = (selectedChain: string) => {
        if (!pendingAddress) return;

        setChain(selectedChain);
        setShowChainModal(false);
        navigate(`/wallet/${pendingAddress}?chain=${selectedChain}`);
        setPendingAddress(null);
        setSearchQuery('');
    };

    const handleSaveWallet = () => {
        if (!address || !editName.trim()) return;
        SavedWalletService.saveWallet(address, editName, selectedCategories);
        setSavedWallets(SavedWalletService.getWallets());
        setIsEditing(false);
    };

    const handleDeleteWallet = () => {
        if (!address) return;
        SavedWalletService.deleteWallet(address);
        setSavedWallets(SavedWalletService.getWallets());
        navigate('/wallet');
    };

    const toggleCategory = (cat: WalletCategory) => {
        setSelectedCategories(prev => prev.includes(cat) ? prev.filter(c => c !== cat) : [...prev, cat]);
    };

    // Hardcoded Trending Wallets (simulated)
    const trendingWallets: WalletData[] = [
        { id: 't1', addr: '0x7a...9b2c', tag: 'Smart Money', bal: '$2.4M', pnl: '+450%', win: '85%', tokens: 0, time: 'Active 2h ago', type: 'whale', categories: ['Smart Money', 'Early'] },
        { id: 't2', addr: '0x3f...8a1d', tag: 'Smart Money', bal: '$4.2M', pnl: '+120%', win: '-', tokens: 0, time: 'Active 5m ago', type: 'whale', categories: ['Whale', 'Hodler'] },
        { id: 't3', addr: '0x9c...2e4f', tag: 'Smart Money', bal: '$850K', pnl: '+800%', win: '60%', tokens: 0, time: 'Active 1m ago', type: 'whale', categories: ['Sniper', 'Degen'] },
        { id: 't4', addr: '0xb2...5d3a', tag: 'Smart Money', bal: '$1.2M', pnl: '+300%', win: '90%', tokens: 0, time: 'Active 10m ago', type: 'whale', categories: ['Insider', 'Fresh'] },
        { id: 't5', addr: '0x1d...4f8b', tag: 'Smart Money', bal: '$1.5M', pnl: '+150%', win: '70%', tokens: 0, time: 'Active 3h ago', type: 'whale', categories: ['Smart Money', 'Whale'] },
        { id: 't6', addr: '0x5e...7c9a', tag: 'Smart Money', bal: '$3.1M', pnl: '+220%', win: '75%', tokens: 0, time: 'Active 1h ago', type: 'whale', categories: ['Copy Trade', 'High Vol'] }
    ];

    const getDisplayWallets = (): WalletData[] => {
        return savedWallets.map((w, i) => ({
            id: i,
            addr: w.addr,
            tag: w.name,
            bal: w.lastBalance || '-',
            pnl: w.lastPnl || '-',
            win: w.lastWinRate || '-',
            tokens: 0,
            time: 'Saved',
            type: (w.categories && w.categories.includes('Whale')) ? 'whale' :
                (w.categories && w.categories.includes('Sniper')) ? 'sniper' :
                    (w.categories && w.categories.includes('Smart Money')) ? 'smart' : 'default',
            categories: w.categories || []
        }));
    };

    // Helper for Button Label
    const getTimeLabel = (t: string) => {
        switch (t) {
            case 'ALL': return 'All Time';
            case '1D': return 'Last 24h';
            case '1W': return 'Last 7d';
            case '1M': return 'Last 30d';
            case '>1M': return '> 30d';
            default: return 'All Time';
        }
    };

    return (
        <div className="flex flex-col gap-6 pb-10">
            {viewMode === 'dashboard' ? (
                <>
                    {/* Dashboard Header */}
                    <div className="bg-card border border-border rounded-xl p-6 flex flex-col gap-4 shadow-sm">
                        <div className="flex flex-col md:flex-row gap-4 justify-between items-start md:items-center">
                            <div>
                                <p className="text-text-medium text-sm mt-1">Track wallet's assets, performance and history</p>
                            </div>
                            <div className="flex gap-2 w-full md:w-auto">
                                <div className="flex-1 md:w-80 bg-[#111315] border border-border rounded-lg flex items-center px-3 py-2.5 focus-within:border-primary-green/50">
                                    <Search className="text-text-medium mr-2" size={18} />
                                    <input
                                        ref={searchInputRef}
                                        type="text"
                                        className="bg-transparent border-none text-text-light outline-none w-full text-sm placeholder-text-dark"
                                        placeholder="Search wallet address..."
                                        value={searchQuery}
                                        onChange={(e) => setSearchQuery(e.target.value)}
                                        onKeyDown={(e) => e.key === 'Enter' && handleTrack()}
                                    />
                                </div>
                                <button className="bg-primary-green text-main font-bold px-4 py-2 rounded-lg hover:bg-primary-green-darker transition-colors whitespace-nowrap text-sm" onClick={() => handleTrack()}>Track</button>
                            </div>
                        </div>
                    </div>

                    {/* Filters */}
                    <div className="flex items-center gap-3 overflow-x-auto custom-scrollbar pb-1">
                        <div className="filter-wrapper relative flex-shrink-0">
                            <button ref={el => (buttonRefs.current['chain'] = el)} className={`filter-pill ${activeFilter === 'chain' ? 'active' : ''}`} onClick={() => toggleFilter('chain')}>
                                <Globe size={16} /> {chain} <ChevronDown size={14} />
                            </button>
                            {activeFilter === 'chain' && (
                                <div className="filter-popup" style={getDropdownStyle('chain')}>
                                    {['All Chains', 'Ethereum', 'Solana', 'BSC', 'Base'].map(c => (
                                        <div key={c} className="filter-list-item" onClick={() => { setChain(c); setActiveFilter(null); }}>{c}</div>
                                    ))}
                                </div>
                            )}
                        </div>
                        <div className="filter-wrapper relative flex-shrink-0">
                            <button ref={el => (buttonRefs.current['type'] = el)} className={`filter-pill ${activeFilter === 'type' ? 'active' : ''}`} onClick={() => toggleFilter('type')}>
                                <Zap size={16} /> {walletType} <ChevronDown size={14} />
                            </button>
                            {activeFilter === 'type' && (
                                <div className="filter-popup" style={getDropdownStyle('type')}>
                                    {['All Types', 'Smart Money', 'Whale', 'Sniper', 'Fresh Wallet'].map(t => (
                                        <div key={t} className="filter-list-item" onClick={() => { setWalletType(t); setActiveFilter(null); }}>{t}</div>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Watchlist */}
                    <div>
                        <h2 className="text-lg font-bold text-text-light mb-4">Watchlist</h2>
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                            {getDisplayWallets().map(w => (
                                <WalletCard
                                    key={w.id}
                                    wallet={w}
                                    onClick={(wallet) => navigate(`/wallet/${wallet.addr}`)}
                                    setDeleteConfirmId={setDeleteConfirmId}
                                    deleteConfirmId={deleteConfirmId}
                                    refreshWallets={() => setSavedWallets(SavedWalletService.getWallets())}
                                />
                            ))}
                            {/* Add Wallet Card */}
                            <div onClick={() => setShowAddModal(true)} className="bg-card/50 border border-border border-dashed rounded-xl p-5 flex flex-col items-center justify-center gap-3 cursor-pointer hover:bg-card hover:border-primary-green/50 transition-all min-h-[160px] group">
                                <div className="w-12 h-12 rounded-full bg-main border border-border flex items-center justify-center group-hover:border-primary-green/30 group-hover:scale-110 transition-all">
                                    <Plus className="text-text-medium group-hover:text-primary-green" size={24} />
                                </div>
                                <span className="text-sm font-bold text-text-medium group-hover:text-text-light">Add New Wallet</span>
                            </div>
                        </div>
                    </div>

                    {/* Trending Wallets */}
                    <div className="mt-8">
                        <h2 className="text-lg font-bold text-text-light mb-4">Trending Wallets</h2>
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                            {trendingWallets.map(w => (
                                <WalletCard
                                    key={w.id}
                                    wallet={w}
                                    onClick={() => handleTrack(w.addr)}
                                    setDeleteConfirmId={setDeleteConfirmId}
                                    deleteConfirmId={deleteConfirmId}
                                    refreshWallets={() => { }}
                                />
                            ))}
                        </div>
                    </div>
                </>
            ) : (
                <>
                    {/* Profile Header */}
                    <div className="flex justify-between items-center mb-6">
                        <button onClick={() => navigate('/wallet')} className="flex items-center gap-2 text-text-medium hover:text-text-light w-fit transition-colors font-bold text-sm">
                            <ArrowLeft size={16} /> Back to Wallets
                        </button>
                        <div className="flex gap-2 relative">
                            <div className="filter-wrapper relative">
                                <button ref={el => (buttonRefs.current['time'] = el)} className={`filter-pill ${activeFilter === 'time' ? 'active' : ''}`} onClick={() => toggleFilter('time')}>
                                    <Clock size={16} /> {getTimeLabel(timeFilter)} <ChevronDown size={14} />
                                </button>
                                {activeFilter === 'time' && (
                                    <div className="filter-popup" style={getDropdownStyle('time')}>
                                        {['ALL', '1D', '1W', '1M', '>1M'].map(t => (
                                            <div key={t} className="filter-list-item" onClick={() => { setTimeFilter(t as any); setActiveFilter(null); }}>
                                                {getTimeLabel(t)}
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                            <div className="filter-wrapper relative">
                                <button ref={el => (buttonRefs.current['profileChain'] = el)} className={`filter-pill ${activeFilter === 'profileChain' ? 'active' : ''}`} onClick={() => toggleFilter('profileChain')}>
                                    <Globe size={16} /> {chain} <ChevronDown size={14} />
                                </button>
                                {activeFilter === 'profileChain' && (
                                    <div className="filter-popup" style={getDropdownStyle('profileChain')}>
                                        {['All Chains', 'Ethereum', 'Base', 'BSC', 'Polygon'].map(c => (
                                            <div key={c} className={`filter-list-item ${chain === c ? 'bg-primary-green/10 text-primary-green' : ''}`} onClick={() => { setChain(c); setActiveFilter(null); }}>{c}</div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-[300px_1fr] gap-6">
                        <div className="flex flex-col gap-6">
                            {/* Wallet Info Card */}
                            <div className="bg-card border border-border rounded-xl p-6 flex flex-col items-center">
                                {isEditing ? (
                                    <div className="w-full mb-6 flex flex-col gap-3 animate-in fade-in zoom-in-95 duration-200">
                                        <div className="flex flex-col gap-1">
                                            <label className="text-xs font-bold text-text-dark">Wallet Name</label>
                                            <input type="text" className="bg-main border border-border rounded p-2 text-text-light text-sm outline-none" value={editName} onChange={(e) => setEditName(e.target.value)} placeholder="e.g. Alpha Wallet" />
                                        </div>
                                        <div className="flex flex-col gap-2">
                                            <label className="text-xs font-bold text-text-dark">Categories</label>
                                            <div className="flex flex-wrap gap-2">
                                                {['Smart Money', 'Whale', 'Sniper', 'Fresh Wallet', 'Early Buyer'].map((c) => (
                                                    <button key={c} onClick={() => toggleCategory(c as WalletCategory)} className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all ${selectedCategories.includes(c as WalletCategory) ? 'bg-primary-green text-main' : 'bg-transparent border border-border text-text-medium'}`}>{c}</button>
                                                ))}
                                            </div>
                                        </div>
                                        <div className="flex gap-2 mt-2">
                                            <button onClick={handleSaveWallet} className="flex-1 bg-primary-green text-main font-bold py-1.5 rounded text-xs">Save Profile</button>
                                            <button onClick={() => setIsEditing(false)} className="flex-1 bg-card border border-border text-text-medium py-1.5 rounded text-xs">Cancel</button>
                                        </div>
                                    </div>
                                ) : (
                                    <>
                                        <h2 className="text-xl font-bold text-text-light mb-1">{existingWallet?.name || 'Tracked Wallet'}</h2>
                                        <div className="flex flex-wrap justify-center gap-1.5 mb-2 px-4">
                                            {selectedCategories.length > 0 ? selectedCategories.map(cat => (
                                                <span key={cat} className="text-[10px] px-2 py-0.5 rounded border border-primary-green/30 bg-primary-green/10 text-primary-green">{cat}</span>
                                            )) : <span className="text-[10px] px-2 py-0.5 rounded border border-border text-text-medium bg-main">Uncategorized</span>}
                                        </div>
                                        <div className="flex items-center gap-2 bg-main px-3 py-1.5 rounded-lg border border-border mb-4 max-w-full">
                                            <span className="font-mono text-xs text-text-medium truncate">{address}</span>
                                            <CheckCircle size={12} className="text-primary-green flex-shrink-0" />
                                        </div>
                                        <div className="flex gap-2 mb-6 w-full">
                                            <button onClick={() => setIsEditing(true)} className="flex-1 bg-card hover:bg-card-hover border border-border text-text-light font-bold py-1.5 rounded text-xs transition-colors">Edit Profile</button>
                                            {existingWallet && (
                                                <button onClick={handleDeleteWallet} className="px-3 bg-card hover:bg-main border border-border text-text-medium rounded transition-colors" title="Stop Tracking"><X size={16} /></button>
                                            )}
                                        </div>
                                    </>
                                )}
                                <WalletStatsGrid stats={walletStats} loading={loading} />
                            </div>

                            {/* Net Worth Chart Placeholder - Keeping structure simple, chart can be its own component later */}
                            <div className="bg-card border border-border rounded-xl p-6">
                                <div className="flex justify-between items-center mb-4">
                                    <h3 className="font-bold text-text-light">Net Worth</h3>
                                    <span className="text-xs text-text-medium bg-main px-2 py-0.5 rounded border border-border">{chain}</span>
                                </div>
                                <div className="text-2xl font-bold text-text-light mb-1">
                                    {portfolioData ? portfolioData.netWorth : walletStats.netWorth || 'Loading...'}
                                </div>
                                <div className="w-full min-h-[150px] flex items-center justify-center text-text-dark text-xs bg-main/30 rounded border border-border/10">
                                    Chart Area
                                </div>
                            </div>
                        </div>

                        {/* Holdings Table */}
                        <HoldingsTable portfolioData={portfolioData} loading={loading} chain={chain} timeFilter={timeFilter} />
                    </div>
                </>
            )}

            {showAddModal && <AddWalletModal onClose={() => setShowAddModal(false)} onAdded={(addr) => navigate(`/wallet/${addr}`)} />}

            <ChainSelectionModal
                isOpen={showChainModal}
                onClose={() => { setShowChainModal(false); setPendingAddress(null); }}
                onSelectChain={handleChainSelect}
            />
        </div>
    );
};
