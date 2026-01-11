import React, { useState, useRef, useEffect } from 'react';
import { Search, Zap, ShieldAlert, Trash2, Rocket, Wallet, ChevronDown, TrendingUp, Radar, FolderKanban, Calendar as CalendarIcon, AlertTriangle } from 'lucide-react';
import { CustomCalendar } from '../components/ui/CustomCalendar';

declare var ApexCharts: any;

interface DetectionProps {
    onSearch: (token: string) => void;
}

export const Detection: React.FC<DetectionProps> = ({ onSearch }) => {
    const [query, setQuery] = useState('');
    const [timeFilter, setTimeFilter] = useState('24H');
    const [activeFilter, setActiveFilter] = useState<string | null>(null);
    const [feedChain, setFeedChain] = useState('All Chains');
    const [eventType, setEventType] = useState('All Events');
    const [severity, setSeverity] = useState('All Severity');

    const [showDateRangeModal, setShowDateRangeModal] = useState(false);
    const [dateRange, setDateRange] = useState<{ from: Date | null, to: Date | null }>({ from: null, to: null });
    const [activeDateInput, setActiveDateInput] = useState<'from' | 'to' | null>(null);

    const buttonRefs = useRef<{ [key: string]: HTMLButtonElement | null }>({});
    const chartRef = useRef<HTMLDivElement>(null);
    const chartInstance = useRef<any>(null);

    const toggleFilter = (filterName: string) => {
        if (filterName === 'timerange') {
            setShowDateRangeModal(true);
            setActiveFilter(null);
            return;
        }
        setActiveFilter(activeFilter === filterName ? null : filterName);
    };

    const handleDateSelect = (date: Date) => {
        if (activeDateInput === 'from') {
            setDateRange(prev => ({ ...prev, from: date }));
            setActiveDateInput(null);
        } else if (activeDateInput === 'to') {
            setDateRange(prev => ({ ...prev, to: date }));
            setActiveDateInput(null);
        }
    };

    const formatDate = (date: Date | null) => {
        if (!date) return 'Select Date';
        return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    };

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

    useEffect(() => {
        if (chartRef.current && typeof ApexCharts !== 'undefined') {
            const options = {
                series: [
                    { name: 'Market Risk', data: [30, 35, 40, 38, 45, 50, 55, 52, 48, 50, 55, 60] },
                    { name: 'Smart Money Flow', data: [20, 25, 30, 45, 60, 55, 65, 70, 80, 85, 82, 88] },
                ],
                chart: { type: 'area', height: 320, background: 'transparent', toolbar: { show: false }, zoom: { enabled: false } },
                colors: ['#EB5757', '#2F80ED'],
                fill: { type: 'gradient', gradient: { shadeIntensity: 1, opacityFrom: 0.4, opacityTo: 0.05, stops: [0, 100] } },
                stroke: { curve: 'smooth', width: 2 },
                dataLabels: { enabled: false },
                xaxis: { categories: ['00:00', '02:00', '04:00', '06:00', '08:00', '10:00', '12:00', '14:00', '16:00', '18:00', '20:00', '22:00'], labels: { style: { colors: '#8F96A3', fontSize: '10px', fontFamily: 'Inter' } }, axisBorder: { show: false }, axisTicks: { show: false } },
                yaxis: { show: true, labels: { style: { colors: '#8F96A3', fontFamily: 'Inter' } } },
                grid: { borderColor: '#2A2E33', strokeDashArray: 4 },
                theme: { mode: 'dark' },
                legend: { show: false }
            };
            if (chartInstance.current) chartInstance.current.destroy();
            chartInstance.current = new ApexCharts(chartRef.current, options);
            chartInstance.current.render();
        }
        return () => { if (chartInstance.current) { chartInstance.current.destroy(); chartInstance.current = null; } };
    }, []);

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (query.trim()) onSearch(query);
    };

    const detectionEvents = [
        { type: 'Whale Buy Detected', icon: <FolderKanban size={18} />, time: '2m ago', desc: 'Major accumulation in a single transaction block.', token: '$PEPE', amt: '837 ETH', color: 'primary-red' },
        { type: 'Smart Money Accumulation', icon: <Zap size={18} />, time: '12m ago', desc: '9 high win-rate wallets entered positions.', token: '$BRETT', amt: 'Multi-sig', color: 'primary-yellow' },
        { type: 'Sniper Bot Swarm', icon: <Search size={18} />, time: '15s ago', desc: 'High frequency automated buys detected at launch.', token: '$MOG', amt: 'N/A', color: 'primary-red' },
        { type: 'Liquidity Removal', icon: <Trash2 size={18} />, time: '5m ago', desc: 'Developer wallet removed significant LP.', token: '$SCAM', amt: '30 SOL', color: 'primary-red' },
        { type: 'New Token Launch', icon: <Rocket size={18} />, time: '1m ago', desc: 'Contract deployed and verified on-chain.', token: '$NEW', amt: 'Launch', color: 'primary-green' },
    ];

    const eventOptions = ['All Events', 'New Token Launch', 'Whale Buy Detected', 'Liquidity Removal', 'Smart Money Accumulation', 'Sniper Bot Swarm'];
    const severityOptions = ['All Severity', 'High', 'Medium', 'Low'];

    return (
        <div className="flex flex-col gap-6 relative overflow-visible">
            <div className="bg-card border border-border rounded-2xl p-6 md:p-8 flex flex-col gap-4 w-full shadow-sm">
                <div>
                    <h2 className="text-xl md:text-2xl font-bold text-text-light">Detect Specific Token Anomalies</h2>
                    <p className="text-text-medium text-sm md:text-base leading-relaxed mt-1">
                        Enter a contract address to scan for real-time whale movements, smart money signals, and critical risk alerts for a specific asset.
                    </p>
                </div>
                <form onSubmit={handleSubmit} className="flex gap-3 mt-2 w-full">
                    <div className="flex-1 bg-[#111315] border border-border rounded-xl flex items-center px-4 transition-colors focus-within:border-primary-green/50">
                        <Search className="text-text-medium mr-2" size={20} />
                        <input
                            type="text"
                            className="bg-transparent border-none text-text-light outline-none w-full py-3.5 text-[0.95rem] placeholder-text-dark"
                            placeholder="Enter a token address or paste link..."
                            value={query}
                            onChange={(e) => setQuery(e.target.value)}
                        />
                    </div>
                    <button type="submit" className="bg-primary-green text-main font-bold px-8 rounded-xl hover:bg-primary-green-darker transition-colors shadow-lg whitespace-nowrap">
                        Search
                    </button>
                </form>
            </div>

            <div className="bg-card border border-border rounded-2xl overflow-visible shadow-sm">
                <div className="grid grid-cols-1 lg:grid-cols-[1fr_250px]">
                    <div className="p-6">
                        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-6">
                            <h3 className="card-title mb-0">Global Detection Chart</h3>
                            <div className="flex gap-2">
                                {['1H', '4H', '12H', '24H'].map(tf => (
                                    <button
                                        key={tf}
                                        className={`px-3 py-1 text-xs font-semibold rounded-full border transition-all ${timeFilter === tf ? 'bg-card-hover border-primary-green text-primary-green' : 'bg-transparent border-border text-text-medium hover:text-text-light'}`}
                                        onClick={() => setTimeFilter(tf)}
                                    >{tf}</button>
                                ))}
                            </div>
                        </div>
                        <div ref={chartRef} className="w-full min-h-[320px]"></div>
                    </div>

                    <div className="border-t lg:border-t-0 lg:border-l border-border p-6 bg-card-hover/20">
                        <h3 className="card-title text-base font-bold">Quick Actions</h3>
                        <div className="flex flex-col gap-2">
                            {[
                                { icon: <ShieldAlert size={18} className="text-text-medium" />, label: 'Create Smart Alert' },
                                { icon: <Wallet size={18} className="text-text-medium" />, label: 'Track Wallet' },
                                { icon: <Radar size={18} className="text-text-medium" />, label: 'Run SafeScan' },
                                { icon: <TrendingUp size={18} className="text-text-medium" />, label: 'View Top Gainers' },
                            ].map((action, i) => (
                                <button key={i} className="flex items-center gap-2 p-3 text-sm font-medium text-text-medium hover:bg-card-hover hover:text-text-light rounded-lg text-left transition-all">
                                    {action.icon} {action.label}
                                </button>
                            ))}
                        </div>
                    </div>
                </div>
            </div>

            <div className="relative z-50 flex flex-col gap-4">
                <div className="flex items-center justify-between">
                    <h3 className="text-lg font-bold">Detection Feed</h3>
                    <div className="flex items-center gap-2 px-2.5 py-1 rounded-full bg-primary-green/10 border border-primary-green/30 text-primary-green text-xs font-bold uppercase tracking-wide shadow-sm">
                        <div className="w-1.5 h-1.5 rounded-full bg-primary-green animate-pulse"></div> Live Radar
                    </div>
                </div>
                <div className="flex items-center gap-3 overflow-x-auto custom-scrollbar pb-3 px-1">
                    <div className="filter-wrapper relative flex-shrink-0">
                        <button className={`filter-pill ${activeFilter === 'feedChain' ? 'active' : ''}`} onClick={() => toggleFilter('feedChain')} ref={el => (buttonRefs.current['feedChain'] = el)}>
                            {feedChain} <ChevronDown size={14} />
                        </button>
                        {activeFilter === 'feedChain' && (
                            <div className="filter-popup" style={getDropdownStyle('feedChain')}>
                                {['All Chains', 'Solana', 'Ethereum', 'BNB Chain'].map(c => (
                                    <div key={c} className="filter-list-item" onClick={() => { setFeedChain(c); setActiveFilter(null); }}>{c}</div>
                                ))}
                            </div>
                        )}
                    </div>
                    <div className="filter-wrapper relative flex-shrink-0">
                        <button className={`filter-pill ${activeFilter === 'severity' ? 'active' : ''}`} onClick={() => toggleFilter('severity')} ref={el => (buttonRefs.current['severity'] = el)}>
                            <AlertTriangle size={14} /> {severity} <ChevronDown size={14} />
                        </button>
                        {activeFilter === 'severity' && (
                            <div className="filter-popup" style={getDropdownStyle('severity')}>
                                {severityOptions.map(s => (
                                    <div key={s} className="filter-list-item" onClick={() => { setSeverity(s); setActiveFilter(null); }}>{s}</div>
                                ))}
                            </div>
                        )}
                    </div>
                    <div className="filter-wrapper relative flex-shrink-0">
                        <button className={`filter-pill ${activeFilter === 'event' ? 'active' : ''}`} onClick={() => toggleFilter('event')} ref={el => (buttonRefs.current['event'] = el)}>
                            {eventType} <ChevronDown size={14} />
                        </button>
                        {activeFilter === 'event' && (
                            <div className="filter-popup" style={getDropdownStyle('event')}>
                                {eventOptions.map(e => (
                                    <div key={e} className="filter-list-item" onClick={() => { setEventType(e); setActiveFilter(null); }}>{e}</div>
                                ))}
                            </div>
                        )}
                    </div>
                    <div className="filter-wrapper relative flex-shrink-0">
                        <button className="filter-pill" onClick={() => toggleFilter('timerange')}>
                            <CalendarIcon size={14} /> Time Range
                        </button>
                    </div>
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 relative z-10 w-full">
                {detectionEvents.map((event, idx) => (
                    <div key={idx} className="bg-card border border-border rounded-xl flex overflow-hidden group hover:border-text-medium transition-colors shadow-md h-full">
                        <div className={`w-1.5 shrink-0 bg-${event.color}`}></div>
                        <div className="flex-1 p-5 flex flex-col justify-between gap-3">
                            <div>
                                <div className="flex justify-between items-start mb-2">
                                    <div className={`flex items-center gap-2 font-bold text-xs text-${event.color} uppercase tracking-wide`}>
                                        {event.icon} {event.type.split(' ').slice(0, 2).join(' ')}
                                    </div>
                                    <span className="text-[10px] text-text-dark font-mono whitespace-nowrap">{event.time}</span>
                                </div>
                                <p className="text-sm text-text-light font-medium leading-snug line-clamp-2">
                                    {event.desc}
                                </p>
                            </div>
                            <div className="flex justify-between items-center pt-3 border-t border-border/50 mt-auto">
                                <span className="text-text-light font-bold text-sm bg-card-hover px-2 py-0.5 rounded border border-border">{event.token}</span>
                                <span className="text-text-light font-bold text-sm">{event.amt}</span>
                            </div>
                        </div>
                    </div>
                ))}
            </div>

            <div className="flex justify-center mt-4">
                <button className="text-text-medium hover:text-text-light text-sm font-bold uppercase tracking-widest transition-all">
                    Load Older Radar Data
                </button>
            </div>

            {showDateRangeModal && (
                <div className="fixed inset-0 bg-black/80 z-[2000] flex items-center justify-center backdrop-blur-sm p-4 animate-fade-in">
                    <div className="bg-[#111315] border border-border rounded-xl p-6 w-full max-w-sm shadow-2xl relative" onClick={(e) => e.stopPropagation()}>
                        <h3 className="text-lg font-bold mb-4">Select Date Range</h3>
                        {activeDateInput ? (
                            <div className="flex flex-col items-center">
                                <div className="w-full flex justify-between items-center mb-4">
                                    <button className="text-xs font-bold text-text-medium hover:text-text-light flex items-center gap-1" onClick={() => setActiveDateInput(null)}>
                                        <ChevronDown size={14} className="rotate-90" /> Back
                                    </button>
                                    <span className="text-sm font-semibold text-primary-green">Select {activeDateInput === 'from' ? 'Start' : 'End'} Date</span>
                                </div>
                                <CustomCalendar onSelect={handleDateSelect} onCancel={() => setActiveDateInput(null)} />
                            </div>
                        ) : (
                            <>
                                <div className="flex gap-4 mb-6">
                                    <div className="flex-1">
                                        <label className="text-[10px] uppercase font-bold text-text-medium mb-1.5 block">From</label>
                                        <div className="bg-card border border-border rounded-lg p-3 cursor-pointer hover:border-text-medium transition-colors text-sm text-text-light" onClick={() => setActiveDateInput('from')}>
                                            {formatDate(dateRange.from)}
                                        </div>
                                    </div>
                                    <div className="flex-1">
                                        <label className="text-[10px] uppercase font-bold text-text-medium mb-1.5 block">To</label>
                                        <div className="bg-card border border-border rounded-lg p-3 cursor-pointer hover:border-text-medium transition-colors text-sm text-text-light" onClick={() => setActiveDateInput('to')}>
                                            {formatDate(dateRange.to)}
                                        </div>
                                    </div>
                                </div>
                                <div className="flex gap-3">
                                    <button className="flex-1 py-3 bg-transparent border border-border rounded-lg font-bold text-sm hover:bg-card-hover transition-colors text-text-medium" onClick={() => setShowDateRangeModal(false)}>Cancel</button>
                                    <button className="flex-1 py-3 bg-primary-green rounded-lg font-bold text-sm text-[#111] hover:bg-primary-green-darker transition-colors" onClick={() => setShowDateRangeModal(false)}>Apply</button>
                                </div>
                            </>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
};