import React, { useState, useRef, useEffect } from 'react';

declare var ApexCharts: any;

export const Sentiment: React.FC = () => {
    const [analyzed, setAnalyzed] = useState(false);
    const [contract, setContract] = useState('');
    const [timeFilter, setTimeFilter] = useState('1D');
    const chartRef = useRef<HTMLDivElement>(null);
    const chartInstance = useRef<any>(null);

    useEffect(() => {
        if (analyzed && chartRef.current && typeof ApexCharts !== 'undefined') {
            let categories: string[] = [];
            let d1: number[] = [], d2: number[] = [], d3: number[] = [], d4: number[] = [];

            if (timeFilter === '1H') { 
                categories = Array.from({length: 12}, (_, i) => `${i*5}m`); 
                d1 = categories.map(() => Math.floor(20 + Math.random() * 40)); 
                d2 = categories.map(() => Math.floor(10 + Math.random() * 30)); 
                d3 = categories.map(() => Math.floor(5 + Math.random() * 20)); 
                d4 = categories.map(() => Math.floor(Math.random() * 25)); 
            } else if (timeFilter === '1D') { 
                categories = Array.from({length: 24}, (_, i) => `${i}:00`); 
                d1 = categories.map(() => Math.floor(40 + Math.random() * 40)); 
                d2 = categories.map(() => Math.floor(30 + Math.random() * 30)); 
                d3 = categories.map(() => Math.floor(10 + Math.random() * 20)); 
                d4 = categories.map(() => Math.floor(5 + Math.random() * 25)); 
            } else { 
                categories = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']; 
                d1 = categories.map(() => Math.floor(50 + Math.random() * 30)); 
                d2 = categories.map(() => Math.floor(40 + Math.random() * 20)); 
                d3 = categories.map(() => Math.floor(20 + Math.random() * 20)); 
                d4 = categories.map(() => Math.floor(10 + Math.random() * 20)); 
            }

            const options = {
                series: [
                    { name: 'Trend Spikes', data: d1 }, 
                    { name: 'KOL Tweets', data: d2 }, 
                    { name: 'Whale Mentions', data: d3 }, 
                    { name: 'FUD Spikes', data: d4 }
                ],
                chart: { type: 'line', height: 280, background: 'transparent', toolbar: { show: false }, zoom: { enabled: false } },
                colors: ['#26D356', '#9B51E0', '#2F80ED', '#EB5757'], 
                stroke: { curve: 'smooth', width: 2 },
                dataLabels: { enabled: false },
                xaxis: { categories: categories, labels: { style: { colors: '#8F96A3', fontSize: '10px', fontFamily: 'Inter' } }, axisBorder: { show: false }, axisTicks: { show: false }, tickAmount: 5 },
                yaxis: { show: true, labels: { style: { colors: '#8F96A3', fontFamily: 'Inter' } } },
                grid: { show: true, borderColor: '#2A2E33', strokeDashArray: 4, xaxis: { lines: { show: false } } },
                theme: { mode: 'dark' },
                legend: { position: 'top', horizontalAlign: 'left', labels: { colors: '#EAECEF', fontFamily: 'Inter' } }
            };

            if (chartInstance.current) { chartInstance.current.destroy(); }
            chartInstance.current = new ApexCharts(chartRef.current, options);
            chartInstance.current.render();
        }
        return () => { if (chartInstance.current) { chartInstance.current.destroy(); chartInstance.current = null; } };
    }, [analyzed, timeFilter]);

    if (!analyzed) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[60vh] p-4">
                <div className="w-full max-w-lg text-center">
                    <h2 className="text-2xl font-bold mb-6">Sentiment Analysis</h2>
                    <div className="bg-main border border-border rounded-xl p-1 mb-4 flex items-center">
                        <input type="text" className="w-full bg-transparent p-4 text-text-light outline-none" placeholder="Enter Token Contract Address" value={contract} onChange={(e) => setContract(e.target.value)} />
                    </div>
                    <button className="w-full py-4 bg-primary-green text-main font-bold rounded-xl hover:bg-primary-green-darker transition-colors" onClick={() => { if(contract) setAnalyzed(true); }}>
                        Analyze Sentiment
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div className="space-y-6">
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                <div>
                    <h2 className="text-2xl font-bold flex items-center gap-3">
                        Solana (SOL) 
                        <span className="text-xs bg-[rgba(38,211,86,0.1)] text-primary-green px-2 py-0.5 rounded font-semibold">Active</span>
                    </h2>
                    <p className="text-text-medium text-sm mt-1">Contract: {contract}</p>
                </div>
                <button className="px-4 py-2 border border-border rounded-lg text-sm font-medium hover:text-text-light hover:border-text-light transition-colors" onClick={() => setAnalyzed(false)}>Change Token</button>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-[1fr_2fr] gap-6">
                <div className="bg-card border border-border rounded-2xl p-6 flex flex-col items-center justify-center text-center">
                    <h3 className="text-lg font-semibold w-full text-left mb-4">Sentiment Score</h3>
                    <div className="relative w-40 h-40 flex items-center justify-center">
                        <svg width="160" height="160" viewBox="0 0 100 100" className="transform -rotate-90">
                            <circle cx="50" cy="50" r="45" stroke="#222529" strokeWidth="10" fill="none" />
                            <circle cx="50" cy="50" r="45" stroke="#26D356" strokeWidth="10" fill="none" strokeDasharray="220 283" strokeLinecap="round" />
                        </svg>
                        <div className="absolute text-4xl font-extrabold">74</div>
                    </div>
                    <div className="mt-4 text-sm text-text-medium">Driven by high social volume & KOL mentions</div>
                </div>

                <div className="bg-card border border-border rounded-2xl p-6">
                    <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-4 gap-4">
                        <h3 className="text-lg font-semibold">Prediction Over Time</h3>
                        <div className="flex gap-1.5 flex-wrap">
                            {['1H', '6H', '12H', '1D', '1W', '1M'].map(tf => (
                                <button key={tf} className={`px-3 py-1 text-xs font-semibold rounded-full border transition-all ${timeFilter === tf ? 'bg-card-hover border-primary-green text-primary-green' : 'bg-transparent border-border text-text-medium hover:text-text-light hover:border-text-light'}`} onClick={() => setTimeFilter(tf)}>{tf}</button>
                            ))}
                        </div>
                    </div>
                    <div ref={chartRef} className="w-full min-h-[280px]"></div>
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="bg-card border border-border rounded-2xl p-6">
                    <h3 className="text-lg font-semibold mb-4">Narrative Keywords</h3>
                    <div className="flex flex-wrap gap-3">
                        {['Solana meme', 'Breakout soon', 'Smart money accumulation', 'Airdrop rumors', 'Whale entry'].map(k => (
                            <span key={k} className="bg-[#222529] border border-border px-4 py-2 rounded-lg text-sm text-text-light">{k}</span>
                        ))}
                    </div>
                </div>

                <div className="bg-card border border-border rounded-2xl overflow-hidden flex flex-col">
                    <div className="p-6 pb-2">
                        <h3 className="text-lg font-semibold">KOL Sentiment</h3>
                    </div>
                    <div className="overflow-x-auto w-full">
                        <table className="w-full text-sm">
                            <thead className="bg-card-hover">
                                <tr>
                                    <th className="px-6 py-3 text-left font-medium text-text-medium text-xs">Source</th>
                                    <th className="px-3 py-3 text-left font-medium text-text-medium text-xs">Followers</th>
                                    <th className="px-3 py-3 text-left font-medium text-text-medium text-xs">Sentiment</th>
                                    <th className="px-6 py-3 text-right font-medium text-text-medium text-xs">Link</th>
                                </tr>
                            </thead>
                            <tbody>
                                {[
                                    {name:'CryptoCapo_', followers:'503k', sent:'Bullish', color:'green'}, 
                                    {name:'K A L E O', followers:'613k', sent:'Neutral', color:'yellow'}, 
                                    {name:'Solomon', followers:'243k', sent:'Bullish', color:'green'}
                                ].map((k,i) => (
                                    <tr key={i} className="border-b border-border last:border-0 hover:bg-card-hover/50">
                                        <td className="px-6 py-3 font-semibold">{k.name}</td>
                                        <td className="px-3 py-3 text-text-medium">{k.followers}</td>
                                        <td className="px-3 py-3">
                                            <span className={`px-2 py-1 rounded text-[10px] uppercase font-bold border ${k.sent === 'Bullish' ? 'bg-[rgba(38,211,86,0.15)] text-primary-green border-[rgba(38,211,86,0.3)]' : 'bg-[rgba(242,201,76,0.15)] text-primary-yellow border-[rgba(242,201,76,0.3)]'}`}>{k.sent}</span>
                                        </td>
                                        <td className="px-6 py-3 text-right text-primary-blue text-xs cursor-pointer hover:underline">View</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                    <div className="p-6 pt-4 mt-auto">
                        <button className="w-full py-2.5 bg-card border border-dashed border-border rounded-xl text-text-medium text-sm hover:bg-card-hover hover:text-text-light hover:border-text-light transition-all">See More</button>
                    </div>
                </div>
            </div>
        </div>
    );
};