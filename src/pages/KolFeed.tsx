import React, { useState, useRef, useEffect } from 'react';
import { User, SortDesc, TrendingUp, Zap, Target, Brain, Heart, Repeat, MessageSquare, Twitter, Send, Wallet, ShieldCheck, ChevronDown } from 'lucide-react';

interface Influencer {
    name: string;
    score: number;
    wallet: boolean;
}

const DiscordIcon = ({ size = 18 }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
        <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994.021-.041.001-.09-.041-.106a13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.23 10.23 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.086 2.157 2.419 0 1.334-.947 2.419-2.157 2.419zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.086 2.157 2.419 0 1.334-.946 2.419-2.157 2.419z"/>
    </svg>
);

export const KolFeed: React.FC = () => {
    const [highEngagement, setHighEngagement] = useState(true);
    const [activeFilter, setActiveFilter] = useState<string | null>(null);
    const [profileModalOpen, setProfileModalOpen] = useState(false);
    const [selectedInfluencer, setSelectedInfluencer] = useState<Influencer | null>(null);
    const [expandedPosts, setExpandedPosts] = useState<Record<number, boolean>>({});
    const [followerRange, setFollowerRange] = useState(2);
    
    const [selectedPlatform, setSelectedPlatform] = useState('All');
    const [selectedTier, setSelectedTier] = useState('All');
    const [selectedNarrative, setSelectedNarrative] = useState('All');
    const [selectedEngagement, setSelectedEngagement] = useState('All');
    const [selectedSentiment, setSelectedSentiment] = useState('All');

    const buttonRefs = useRef<{ [key: string]: HTMLButtonElement | null }>({});

    const platformOptions = ['All', 'Telegram', 'X', 'Reddit', 'Discord'];
    const tierOptions = ['All', 'Micro influencer', 'Macro influencer', 'Mega influencer', 'Smart money influencer', 'Researcher and analyst'];
    const narrativeOptions = ['All', 'RWA', 'Meme', 'AI', 'DePin'];
    const engagementOptions = ['All', 'Organic', 'Viral', 'Paid/Promo', 'Controversial'];
    const sentimentOptions = ['All', 'Bullish', 'Bearish', 'Neutral'];

    const toggleAI = (id: number) => { setExpandedPosts(prev => ({...prev, [id]: !prev[id]})); };
    const openProfile = (user: Influencer) => { setSelectedInfluencer(user); setProfileModalOpen(true); };
    const toggleFilter = (filterName: string) => { setActiveFilter(activeFilter === filterName ? null : filterName); };
    
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

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => { 
            if (activeFilter) {
                const target = event.target as Element;
                if (!target.closest('.filter-wrapper') && !target.closest('.filter-popup')) {
                    setActiveFilter(null);
                }
            }
        };
        const handleScroll = () => { if (activeFilter) setActiveFilter(null); };
        document.addEventListener('mousedown', handleClickOutside);
        window.addEventListener('scroll', handleScroll, true);
        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
            window.removeEventListener('scroll', handleScroll, true);
        };
    }, [activeFilter]);

    const getTierText = () => (!selectedTier || selectedTier === 'All') ? 'Influencer Tier' : selectedTier.split(' ')[0];

    return (
        <div className="relative overflow-visible">
             <div className="mb-6 relative z-50">
                <div className="flex items-center gap-3 overflow-x-auto custom-scrollbar pb-3 px-1">
                    <div className="filter-wrapper relative flex-shrink-0">
                         <button ref={el => (buttonRefs.current['platform'] = el)} className={`filter-pill ${activeFilter === 'platform' ? 'active' : ''}`} onClick={() => toggleFilter('platform')}>
                            {selectedPlatform === 'All' ? 'Platform' : selectedPlatform} <ChevronDown size={14} />
                         </button>
                         {activeFilter === 'platform' && (
                            <div className="filter-popup" style={getDropdownStyle('platform')}>
                                {platformOptions.map(p => (
                                    <div key={p} className={`filter-list-item ${selectedPlatform === p ? 'selected' : ''}`} onClick={() => { setSelectedPlatform(p); setActiveFilter(null); }}>{p}</div>
                                ))}
                            </div>
                         )}
                    </div>
                    <div className="filter-wrapper relative flex-shrink-0">
                         <button ref={el => (buttonRefs.current['followers'] = el)} className={`filter-pill ${activeFilter === 'followers' ? 'active' : ''}`} onClick={() => toggleFilter('followers')}>
                            <User size={14} /> Followers
                         </button>
                         {activeFilter === 'followers' && (
                            <div className="filter-popup complex" style={getDropdownStyle('followers')}>
                                <div className="font-bold mb-3 text-sm text-text-light">Min Followers</div>
                                <div className="w-full px-1">
                                    <input type="range" className="w-full" min="0" max="3" step="1" value={followerRange} onChange={(e) => setFollowerRange(parseInt(e.target.value))} />
                                    <div className="mt-2 text-center text-primary-green font-bold text-base">{(['100', '1k', '10k', '100k >'])[followerRange]} +</div>
                                </div>
                            </div>
                         )}
                    </div>
                    <div className="filter-wrapper relative flex-shrink-0">
                         <button ref={el => (buttonRefs.current['tier'] = el)} className={`filter-pill ${activeFilter === 'tier' ? 'active' : ''}`} onClick={() => toggleFilter('tier')}>
                            <SortDesc size={14} /> {getTierText()}
                         </button>
                         {activeFilter === 'tier' && (
                            <div className="filter-popup" style={{...getDropdownStyle('tier'), minWidth: '200px'}}>
                                {tierOptions.map(t => (
                                    <div key={t} className={`filter-list-item ${selectedTier === t ? 'selected' : ''}`} onClick={() => {setSelectedTier(t); setActiveFilter(null);}}>{t}</div>
                                ))}
                            </div>
                         )}
                    </div>
                    <div className="filter-wrapper relative flex-shrink-0">
                         <button ref={el => (buttonRefs.current['narrative'] = el)} className={`filter-pill ${activeFilter === 'narrative' ? 'active' : ''}`} onClick={() => toggleFilter('narrative')}>
                            <TrendingUp size={14} /> {selectedNarrative === 'All' ? 'Narrative' : selectedNarrative}
                         </button>
                         {activeFilter === 'narrative' && (
                            <div className="filter-popup" style={getDropdownStyle('narrative')}>
                                {narrativeOptions.map(n => (
                                    <div key={n} className={`filter-list-item ${selectedNarrative === n ? 'selected' : ''}`} onClick={() => {setSelectedNarrative(n); setActiveFilter(null);}}>{n}</div>
                                ))}
                            </div>
                         )}
                    </div>
                    <div className="filter-wrapper relative flex-shrink-0">
                         <button ref={el => (buttonRefs.current['engagement'] = el)} className={`filter-pill ${activeFilter === 'engagement' ? 'active' : ''}`} onClick={() => toggleFilter('engagement')}>
                            <Zap size={14} /> {selectedEngagement === 'All' ? 'Engagement' : selectedEngagement}
                         </button>
                         {activeFilter === 'engagement' && (
                            <div className="filter-popup" style={getDropdownStyle('engagement')}>
                                {engagementOptions.map(e => (
                                    <div key={e} className={`filter-list-item ${selectedEngagement === e ? 'selected' : ''}`} onClick={() => {setSelectedEngagement(e); setActiveFilter(null);}}>{e}</div>
                                ))}
                            </div>
                         )}
                    </div>
                    <div className="filter-wrapper relative flex-shrink-0">
                         <button ref={el => (buttonRefs.current['sentiment'] = el)} className={`filter-pill ${activeFilter === 'sentiment' ? 'active' : ''}`} onClick={() => toggleFilter('sentiment')}>
                            <Target size={14} /> {selectedSentiment === 'All' ? 'Sentiment' : selectedSentiment}
                         </button>
                         {activeFilter === 'sentiment' && (
                            <div className="filter-popup" style={getDropdownStyle('sentiment')}>
                                {sentimentOptions.map(s => (
                                    <div key={s} className={`filter-list-item ${selectedSentiment === s ? 'selected' : ''}`} onClick={() => {setSelectedSentiment(s); setActiveFilter(null);}}>{s}</div>
                                ))}
                            </div>
                         )}
                    </div>
                    
                    <div className={`ml-auto flex items-center gap-2.5 cursor-pointer bg-card px-3 py-1.5 rounded-lg border border-border flex-shrink-0 ${highEngagement ? 'border-primary-green' : ''}`} onClick={() => setHighEngagement(!highEngagement)}>
                        <div className={`w-9 h-5 rounded-full relative transition-colors ${highEngagement ? 'bg-[#1B3D28] border border-primary-green' : 'bg-card-hover border border-border'}`}>
                            <div className={`absolute top-[1.5px] w-3.5 h-3.5 rounded-full transition-transform ${highEngagement ? 'bg-primary-green left-[18px]' : 'bg-text-medium left-[2px]'}`}></div>
                        </div>
                        <span className={`text-xs font-semibold ${highEngagement ? 'text-text-light' : 'text-text-medium'}`}>Real-Time</span>
                    </div>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-[2fr_1fr] gap-6 mb-8 relative z-10">
                <div className="flex flex-col gap-5">
                    <div className="bg-card border border-border rounded-xl p-5 hover:border-text-dark transition-colors flex flex-col gap-4 shadow-sm">
                        <div className="flex items-start justify-between">
                            <div className="flex gap-3">
                                <img src="https://i.pravatar.cc/150?u=1" className="w-10 h-10 rounded-full object-cover border border-border cursor-pointer" onClick={() => openProfile({name: '@cryptoGuru', score: 74, wallet: true})} />
                                <div className="flex flex-col">
                                    <h4 className="text-base font-bold text-text-light flex items-center gap-1.5 cursor-pointer hover:text-primary-blue" onClick={() => openProfile({name: '@cryptoGuru', score: 74, wallet: true})}>
                                        @cryptoGuru <Twitter size={14} className="text-white fill-white" />
                                    </h4>
                                    <p className="text-[10px] text-text-dark font-medium">215K followers • 2m ago</p>
                                </div>
                            </div>
                            <div className="flex flex-col items-end gap-1.5">
                                <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-[rgba(38,211,86,0.15)] text-primary-green border border-[rgba(38,211,86,0.3)] uppercase">Bullish</span>
                            </div>
                        </div>
                        <div className="text-[0.95rem] leading-relaxed text-text-light">
                            $SOL looks incredibly strong here. Breaking out of the falling wedge pattern. Targets $180 soon. Accumulation is massive!
                        </div>
                        <button className="flex items-center gap-1.5 text-primary-blue border border-primary-blue/30 rounded px-2.5 py-1.5 text-[10px] font-bold w-fit hover:bg-primary-blue/10 transition-colors" onClick={() => toggleAI(1)}>
                            <Brain size={12} /> {expandedPosts[1] ? 'Hide AI Insight' : 'View AI Insight'}
                        </button>
                        {expandedPosts[1] && (
                            <div className="bg-primary-blue/5 border border-primary-blue/20 rounded-lg p-3 text-sm animate-fade-in">
                                <div className="flex items-center gap-1.5 text-primary-blue font-bold mb-2 text-xs"><Brain size={14} /> AI Analysis</div>
                                <div className="mb-2 font-medium text-text-light text-xs leading-relaxed">Signal detects strong accumulation divergence on the 4H chart. Sentiment aligns with broader L1 rotation narrative.</div>
                                <div className="flex gap-2 flex-wrap">
                                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-main border border-border text-text-medium flex items-center gap-1 font-bold"><Zap size={10} className="text-primary-yellow" /> Virality: 92/100</span>
                                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-main border border-border text-text-medium flex items-center gap-1 font-bold"><ShieldCheck size={10} className="text-primary-green" /> Credibility: High</span>
                                </div>
                            </div>
                        )}
                        <div className="flex items-center justify-between pt-3 border-t border-border mt-1">
                            <div className="flex gap-5">
                                <div className="flex items-center gap-1.5 text-text-dark text-xs font-bold cursor-pointer hover:text-text-medium"><Heart size={14} /> 1.2k</div>
                                <div className="flex items-center gap-1.5 text-text-dark text-xs font-bold cursor-pointer hover:text-text-medium"><Repeat size={14} /> 500</div>
                                <div className="flex items-center gap-1.5 text-text-dark text-xs font-bold cursor-pointer hover:text-text-medium"><MessageSquare size={14} /> 84</div>
                            </div>
                            <span className="text-xs text-text-medium font-bold cursor-pointer hover:text-text-light hover:underline">Open Post</span>
                        </div>
                    </div>

                    <div className="bg-card border border-border rounded-xl p-5 hover:border-text-dark transition-colors flex flex-col gap-4 shadow-sm">
                        <div className="flex items-start justify-between">
                            <div className="flex gap-3">
                                <img src="https://i.pravatar.cc/150?u=2" className="w-10 h-10 rounded-full object-cover border border-border cursor-pointer" onClick={() => openProfile({name: 'Whale Alerts', score: 92, wallet: false})} />
                                <div className="flex flex-col">
                                    <h4 className="text-base font-bold text-text-light flex items-center gap-1.5 cursor-pointer" onClick={() => openProfile({name: 'Whale Alerts', score: 92, wallet: false})}>
                                        Whale Alerts <Send size={14} className="text-[#0088cc]" />
                                    </h4>
                                    <p className="text-[10px] text-text-dark font-medium">850K subs • 15m ago</p>
                                </div>
                            </div>
                            <div className="flex flex-col items-end gap-1.5">
                                <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-[rgba(235,87,87,0.15)] text-primary-red border border-[rgba(235,87,87,0.3)] uppercase">Alert</span>
                            </div>
                        </div>
                        <div className="text-[0.95rem] leading-relaxed text-text-light">
                            🚨 25,000 $ETH ($82M) transferred from #Binance to Unknown Wallet.
                        </div>
                        <div className="flex items-center justify-between pt-3 border-t border-border mt-1">
                            <div className="flex gap-5">
                                <div className="flex items-center gap-1.5 text-text-dark text-xs font-bold cursor-pointer hover:text-text-medium"><Heart size={14} /> 2.1k</div>
                                <div className="flex items-center gap-1.5 text-text-dark text-xs font-bold cursor-pointer hover:text-text-medium"><Repeat size={14} /> 1.2k</div>
                                <div className="flex items-center gap-1.5 text-text-dark text-xs font-bold cursor-pointer hover:text-text-medium"><MessageSquare size={14} /> 156</div>
                            </div>
                            <span className="text-xs text-text-medium font-bold cursor-pointer hover:text-text-light hover:underline">View Transaction</span>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};