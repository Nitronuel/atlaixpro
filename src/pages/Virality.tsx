import React, { useState, useRef, useEffect } from 'react';
import { Search } from 'lucide-react';

declare var ApexCharts: any;

export const Virality: React.FC = () => {
    const timelineRef = useRef<HTMLDivElement>(null);
    const chartInstance = useRef<any>(null);
    const [searchQuery, setSearchQuery] = useState('');
    const [timeFilter, setTimeFilter] = useState('1D');

    useEffect(() => {
        if (timelineRef.current && typeof ApexCharts !== 'undefined') {
            let categories: string[] = [];
            let d1: number[] = [], d2: number[] = [];

            if(timeFilter === '1H') {
                categories = Array.from({length: 12}, (_, i) => `${i*5}m`); 
                d1 = categories.map(() => Math.floor(30 + Math.random() * 20));
                d2 = categories.map(() => Math.floor(40 + Math.random() * 30));
            } else if (timeFilter === '1D') {
                categories = Array.from({length: 24}, (_, i) => `${i}:00`);
                d1 = categories.map(() => Math.floor(30 + Math.random() * 20));
                d2 = categories.map(() => Math.floor(40 + Math.random() * 30));
            } else { 
                categories = ['Week 1', 'Week 2', 'Week 3', 'Week 4'];
                d1 = categories.map(() => Math.floor(30 + Math.random() * 20));
                d2 = categories.map(() => Math.floor(40 + Math.random() * 30));
            }

            const options = {
                series: [
                    { name: 'Social Velocity', data: d1 },
                    { name: 'KOL Amp', data: d2 }
                ],
                chart: { type: 'line', height: 280, background: 'transparent', toolbar: { show: false }, zoom: { enabled: false } },
                colors: ['#F2C94C', '#EB5757', '#9B51E0', '#2AF598'],
                stroke: { curve: 'smooth', width: 2 },
                xaxis: { categories: categories, labels: { style: { colors: '#8F96A3', fontSize: '10px', fontFamily: 'Inter' } }, axisBorder: { show: false }, axisTicks: { show: false }, tickAmount: 5 },
                yaxis: { show: true, labels: { style: { colors: '#8F96A3', fontFamily: 'Inter' } } },
                grid: { show: true, borderColor: '#2A2E33', strokeDashArray: 4, xaxis: { lines: { show: false } } },
                theme: { mode: 'dark' },
                legend: { position: 'top', horizontalAlign: 'left', labels: { colors: '#EAECEF', fontFamily: 'Inter' } }
            };
            
            if (chartInstance.current) { chartInstance.current.destroy(); }
            chartInstance.current = new ApexCharts(timelineRef.current, options);
            chartInstance.current.render();
        }
        return () => { if (chartInstance.current) { chartInstance.current.destroy(); chartInstance.current = null; } };
    }, [timeFilter]);

    const centerToken = { name: searchQuery || '$WIF', img: 'https://cryptologos.cc/logos/dogwifhat-wif-logo.png' };
    const narratives = [
        { name: 'AI', color: '#2F80ED', top: 20, left: 20 },
        { name: 'Meme', color: '#EB5757', top: 25, left: 80 },
        { name: 'RWA', color: '#F2C94C', top: 75, left: 15 },
        { name: 'DePin', color: '#9B51E0', top: 80, left: 75 },
    ];

    return (
        <div className="flex flex-col gap-6">
            <div className="bg-card border border-border rounded-2xl p-6 md:p-8 flex flex-col justify-center gap-4 w-full shadow-sm mb-2">
                <div className="flex gap-3 w-full">
                    <div className="flex-1 bg-[#111315] border border-border rounded-xl flex items-center px-4 transition-colors focus-within:border-primary-green/50">
                        <Search className="text-text-medium mr-2" size={20} />
                        <input type="text" className="bg-transparent border-none text-text-light outline-none w-full py-3.5 text-[0.95rem] placeholder-text-dark" placeholder="Enter a token or paste link..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} />
                    </div>
                    <button className="bg-primary-green text-main font-bold px-8 rounded-xl hover:bg-primary-green-darker transition-colors shadow-lg whitespace-nowrap">Search</button>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-[2fr_1fr] gap-6">
                <div className="flex flex-col gap-6">
                    <div className="bg-card border border-border rounded-2xl overflow-hidden flex flex-col">
                        <div className="p-6 pb-2"><h3 className="text-lg font-semibold">Top Viral Tokens</h3></div>
                        <div className="overflow-x-auto w-full">
                            <table className="w-full text-sm">
                                <thead className="bg-card-hover">
                                    <tr>
                                        <th className="px-4 py-3 text-left font-medium text-text-medium text-xs">Token</th>
                                        <th className="px-4 py-3 text-left font-medium text-text-medium text-xs">Viral Score</th>
                                        <th className="px-4 py-3 text-left font-medium text-text-medium text-xs">Social Vel.</th>
                                        <th className="px-4 py-3 text-left font-medium text-text-medium text-xs">Time</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {[
                                        {t:'$WIF', s:92, v:'Very High', time:'7 min', c:'bg-primary-green'}, 
                                        {t:'$BONK', s:87, v:'Extreme', time:'18 min', c:'bg-primary-green-light'}, 
                                        {t:'$MOODENG', s:80, v:'High', time:'3 min', c:'bg-primary-yellow'}
                                    ].map((row, i) => (
                                        <tr key={i} className="border-b border-border last:border-0 hover:bg-card-hover/50">
                                            <td className="px-4 py-4 font-bold">{row.t}</td>
                                            <td className="px-4 py-4">
                                                <div className="w-4/5 h-1.5 bg-[#2A2E33] rounded-full overflow-hidden">
                                                    <div className={`h-full rounded-full ${row.c}`} style={{width: `${row.s}%`}}></div>
                                                </div>
                                            </td>
                                            <td className="px-4 py-4 text-sm">{row.v}</td>
                                            <td className="px-4 py-4 text-sm text-text-medium">{row.time}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>

                    <div className="bg-card border border-border rounded-2xl p-6">
                        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-4">
                            <h3 className="text-lg font-semibold">Virality Trend Graph</h3>
                            <div className="flex gap-1.5 flex-wrap">
                                {['1H', '6H', '12H', '1D', '1W', '1M'].map(tf => (
                                    <button key={tf} className={`px-3 py-1 text-xs font-semibold rounded-full border transition-all ${timeFilter === tf ? 'bg-card-hover border-primary-green text-primary-green' : 'bg-transparent border-border text-text-medium hover:text-text-light'}`} onClick={() => setTimeFilter(tf)}>{tf}</button>
                                ))}
                            </div>
                        </div>
                        <div ref={timelineRef} className="w-full min-h-[300px]"></div>
                    </div>

                    <div className="bg-card border border-border rounded-2xl p-6">
                        <h3 className="text-lg font-semibold mb-3">AI-Generated Signal</h3>
                        <p className="text-text-light text-[0.95rem] leading-relaxed">
                            Mentions up <strong>220%</strong> in the last hour. Meme activity is picking up. Two whale tweets + several KOLs mentioned it. Linked to <strong className="text-primary-green">"Solana memes"</strong> narrative.
                        </p>
                    </div>
                </div>

                <div className="flex flex-col gap-6">
                    <div className="bg-card border border-border rounded-2xl p-6">
                        <h3 className="text-lg font-semibold mb-6">Narrative Map</h3>
                        <div className="relative w-full h-[340px] bg-[#111315] rounded-xl overflow-hidden border border-border/30">
                            <svg className="absolute inset-0 w-full h-full pointer-events-none z-0">
                                {narratives.map((n, i) => (
                                    <line key={i} x1="50%" y1="50%" x2={`${n.left}%`} y2={`${n.top}%`} stroke={n.color} strokeWidth="1.5" strokeDasharray="4 4" opacity="0.3" />
                                ))}
                            </svg>
                            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-20 flex flex-col items-center justify-center animate-fade-in">
                                <div className="w-16 h-16 md:w-20 md:h-20 rounded-full bg-card shadow-[0_0_30px_rgba(38,211,86,0.15)] flex items-center justify-center overflow-hidden p-1 relative z-20">
                                    <img src={centerToken.img} alt={centerToken.name} className="w-full h-full rounded-full object-cover" onError={(e) => e.currentTarget.src='https://via.placeholder.com/64'} />
                                </div>
                            </div>
                            {narratives.map((n, i) => (
                                <div key={i} className="absolute transform -translate-x-1/2 -translate-y-1/2 z-10 flex flex-col items-center cursor-pointer group hover:z-30 transition-all duration-300" style={{ top: `${n.top}%`, left: `${n.left}%` }}>
                                    <div className="rounded-full w-14 h-14 md:w-16 md:h-16 flex items-center justify-center text-center p-1 shadow-lg transition-all duration-300 group-hover:scale-110 relative z-10 backdrop-blur-sm" style={{ backgroundColor: n.color, boxShadow: `0 0 20px ${n.color}50` }}>
                                        <span className="text-xs md:text-sm font-bold leading-tight" style={{ color: '#ffffff', textShadow: '0 1px 3px rgba(0,0,0,0.6)' }}>{n.name}</span>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>

                    <div className="bg-card border border-border rounded-2xl p-6">
                        <h3 className="text-lg font-semibold mb-4">Related Viral Candidates</h3>
                        <div className="flex flex-col gap-3">
                            <div className="flex justify-between items-center py-4 border-b border-border">
                                <div><div className="text-[10px] text-text-medium uppercase mb-1">VIRAL SCORE</div><div className="font-semibold">$BONK</div></div>
                                <div className="text-right"><div className="text-[10px] text-text-medium uppercase mb-1">VIRAL SCORE</div><div className="font-bold text-lg">87</div></div>
                            </div>
                            <div className="flex justify-between items-center py-4">
                                <div><div className="text-[10px] text-text-medium uppercase mb-1">VIRAL SCORE</div><div className="font-semibold">$POPCAT</div></div>
                                <div className="text-right"><div className="text-[10px] text-text-medium uppercase mb-1">VIRAL SCORE</div><div className="font-bold text-lg">76</div></div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};