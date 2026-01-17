import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
    ArrowLeft, Copy, ExternalLink, ShieldCheck,
    Share2, Info, Wallet, TrendingUp, Clock,
    Activity, Bell, X, Zap
} from 'lucide-react';

const MOCK_HOLDERS = [
    { id: 1, address: '0xabc...123', tag: 'Whale', amount: '$80,250,000', pnl: '+$35.53%', entry: '$0.0006', time: 'Jan 15, 2023', pnlPositive: true },
    { id: 2, address: '0xdef...456', tag: 'Whale', amount: '$46,750,000', pnl: '+$36.87%', entry: '$0.0000', time: 'Jan 19, 2023', pnlPositive: true },
    { id: 3, address: '0xghi...789', tag: 'Smart', amount: '$12,500,000', pnl: '-5.20%', entry: '$0.0012', time: 'Feb 10, 2023', pnlPositive: false },
    { id: 4, address: '0xjkl...012', tag: 'Fresh', amount: '$5,250,000', pnl: '+$12.40%', entry: '$0.0009', time: 'Mar 05, 2023', pnlPositive: true },
];

const OVERVIEW_CARDS = [
    { title: 'Smart Money Score', value: '88', color: 'text-green-400', subColor: 'text-[#8F96A3]', bg: 'bg-[#1C1F22]', border: 'border-green-500/20' },
    { title: 'Total inflow', value: '$5M', color: 'text-[#EAECEF]', subColor: 'text-[#8F96A3]', bg: 'bg-[#111315]', border: 'border-[#2A2E33]' },
    { title: 'Total outflow', value: '$2M', color: 'text-red-400', subColor: 'text-[#8F96A3]', bg: 'bg-[#111315]', border: 'border-[#2A2E33]' }, // Highlighted as red in image
    { title: 'Net inflow', value: '+$3M', color: 'text-green-400', subColor: 'text-[#8F96A3]', bg: 'bg-[#111315]', border: 'border-[#2A2E33]' },
    { title: '% of smart wallets involved', value: '15%', color: 'text-[#EAECEF]', subColor: 'text-[#8F96A3]', bg: 'bg-[#111315]', border: 'border-[#2A2E33]' },
    { title: 'Whale concentration %', value: '40%', color: 'text-[#EAECEF]', subColor: 'text-[#8F96A3]', bg: 'bg-[#111315]', border: 'border-[#2A2E33]' },
];

// Interactive SVG Chart with hover states
const InteractiveSmartMoneyChart = () => {
    const [activePoint, setActivePoint] = useState<any>(null);
    const [mousePos, setMousePos] = useState({ x: 0, y: 0 });
    const containerRef = React.useRef<HTMLDivElement>(null);

    // Generate stable data
    const data = React.useMemo(() => {
        const points = [];
        const width = 800;
        const now = new Date();
        for (let i = 0; i <= 100; i++) {
            const x = (i / 100) * width;
            // Smooth waves
            const inflow = 50 + Math.sin(i * 0.1) * 30 + Math.sin(i * 0.3) * 10;
            const outflow = 50 + Math.cos(i * 0.1) * 30 + Math.cos(i * 0.2) * 15;

            points.push({
                x,
                inflow, // Y coordinate for inflow (0-100 scale ideally, mapped later)
                outflow,
                time: new Date(now.getTime() - (100 - i) * 60000 * 15).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                inflowVal: Math.abs(inflow * 10000).toFixed(0),
                outflowVal: Math.abs(outflow * 8000).toFixed(0),
                net: (inflow - outflow) * 500
            });
        }
        return points;
    }, []);

    const handleMouseMove = (e: React.MouseEvent) => {
        if (!containerRef.current) return;
        const rect = containerRef.current.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;

        // Constrain X
        const boundedX = Math.max(0, Math.min(x, rect.width));

        // Find nearest point
        // Assuming width is handled via viewBox scaling, we need to map mouse X to data index
        // ViewBox width is 800.
        // Screen width might differ, so we project.
        const scaleX = 800 / rect.width;
        const svgX = boundedX * scaleX;

        const index = Math.min(data.length - 1, Math.max(0, Math.round((svgX / 800) * (data.length - 1))));
        setActivePoint(data[index]);
        setMousePos({ x: boundedX, y });
    };

    const handleMouseLeave = () => {
        setActivePoint(null);
    };

    // Create SVG paths
    const inflowPath = data.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${200 - p.inflow}`).join(' ');
    // Close area for gradient
    const inflowArea = `${inflowPath} L ${data[data.length - 1].x} 200 L 0 200 Z`;

    const outflowPath = data.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${200 - p.outflow}`).join(' ');
    const outflowArea = `${outflowPath} L ${data[data.length - 1].x} 200 L 0 200 Z`;

    return (
        <div
            ref={containerRef}
            className="w-full h-[300px] relative overflow-hidden cursor-crosshair group select-none"
            onMouseMove={handleMouseMove}
            onMouseLeave={handleMouseLeave}
        >
            {/* Legend */}
            <div className="absolute top-4 right-4 flex gap-4 text-[10px] uppercase font-bold text-[#8F96A3] z-10 pointer-events-none">
                <div className="flex items-center gap-1"><div className="w-2 h-2 rounded-full bg-green-400"></div> Inflow</div>
                <div className="flex items-center gap-1"><div className="w-2 h-2 rounded-full bg-red-400"></div> Outflow</div>
            </div>

            <svg viewBox="0 0 800 200" className="w-full h-full" preserveAspectRatio="none">
                <defs>
                    <linearGradient id="gradGreen" x1="0%" y1="0%" x2="0%" y2="100%">
                        <stop offset="0%" stopColor="#4ADE80" stopOpacity="0.2" />
                        <stop offset="100%" stopColor="#4ADE80" stopOpacity="0" />
                    </linearGradient>
                    <linearGradient id="gradRed" x1="0%" y1="0%" x2="0%" y2="100%">
                        <stop offset="0%" stopColor="#F87171" stopOpacity="0.2" />
                        <stop offset="100%" stopColor="#F87171" stopOpacity="0" />
                    </linearGradient>
                </defs>

                {/* Grid Lines */}
                <line x1="0" y1="50" x2="800" y2="50" stroke="#2A2E33" strokeDasharray="4 4" />
                <line x1="0" y1="100" x2="800" y2="100" stroke="#2A2E33" strokeDasharray="4 4" />
                <line x1="0" y1="150" x2="800" y2="150" stroke="#2A2E33" strokeDasharray="4 4" />

                {/* Areas */}
                <path d={inflowArea} fill="url(#gradGreen)" />
                <path d={outflowArea} fill="url(#gradRed)" />

                {/* Lines */}
                <path d={inflowPath} fill="none" stroke="#4ADE80" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                <path d={outflowPath} fill="none" stroke="#F87171" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" opacity="0.8" />

                {/* Active State Elements (Rendered in SVG space) */}
                {activePoint && (
                    <>
                        {/* Crosshair Line */}
                        <line
                            x1={activePoint.x} y1="0"
                            x2={activePoint.x} y2="200"
                            stroke="#EAECEF" strokeWidth="1" strokeDasharray="4 4" opacity="0.5"
                        />
                        {/* Points intersections */}
                        <circle cx={activePoint.x} cy={200 - activePoint.inflow} r="4" fill="#111315" stroke="#4ADE80" strokeWidth="2" />
                        <circle cx={activePoint.x} cy={200 - activePoint.outflow} r="4" fill="#111315" stroke="#F87171" strokeWidth="2" />
                    </>
                )}
            </svg>

            {/* Tooltip (HTML overlay) */}
            {activePoint && (
                <div
                    className="absolute z-20 bg-[#1C1F22]/95 backdrop-blur border border-[#3C414A] p-3 rounded-lg shadow-xl text-xs pointer-events-none"
                    style={{
                        left: mousePos.x,
                        top: 20, // Keep tooltip at top to avoid cursor obstruction
                        transform: `translateX(${mousePos.x > containerRef.current!.getBoundingClientRect().width / 2 ? '-100%' : '10px'})`
                    }}
                >
                    <div className="text-[#8F96A3] font-mono mb-2 border-b border-[#2A2E33] pb-1">
                        {activePoint.time}
                    </div>
                    <div className="space-y-1">
                        <div className="flex justify-between gap-4">
                            <span className="text-green-400 font-bold">Inflow:</span>
                            <span className="text-[#EAECEF] font-mono">${(Number(activePoint.inflowVal) / 1000).toFixed(1)}k</span>
                        </div>
                        <div className="flex justify-between gap-4">
                            <span className="text-red-400 font-bold">Outflow:</span>
                            <span className="text-[#EAECEF] font-mono">${(Number(activePoint.outflowVal) / 1000).toFixed(1)}k</span>
                        </div>
                        <div className="flex justify-between gap-4 pt-1 mt-1 border-t border-[#2A2E33/50]">
                            <span className="text-blue-400 font-bold">Net:</span>
                            <span className={`font-mono ${activePoint.net >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                                {activePoint.net >= 0 ? '+' : ''}${(activePoint.net / 1000).toFixed(1)}k
                            </span>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export const TokenSmartMoney: React.FC = () => {
    const { address } = useParams();
    const navigate = useNavigate();

    return (
        <div className="flex flex-col gap-6 pb-12 animate-fade-in w-full max-w-[1600px] mx-auto p-4 sm:p-6">

            {/* Header - Back Button Only */}
            <div className="flex items-center gap-4">
                <button onClick={() => navigate(-1)} className="p-2 hover:bg-[#2A2E33] rounded-lg transition-colors flex items-center gap-2 text-[#8F96A3] hover:text-[#EAECEF]">
                    <ArrowLeft size={20} />
                    <span className="text-sm font-bold">Back</span>
                </button>
            </div>

            {/* Summary Cards */}
            <div className="bg-[#111315] border border-[#2A2E33] p-6 rounded-xl">
                <h2 className="text-[#EAECEF] font-bold mb-4">Smart Money Summary</h2>
                <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-4">
                    {OVERVIEW_CARDS.map((card, idx) => (
                        <div key={idx} className={`p-4 rounded-xl flex flex-col justify-between min-h-[110px] ${card.bg} border ${card.border}`}>
                            <div className="flex items-start justify-between mb-2">
                                <span className={`text-[10px] uppercase tracking-wider font-semibold ${card.subColor} leading-tight`}>
                                    {card.title}
                                </span>
                            </div>
                            <div className={`text-lg font-bold ${card.color} truncate`} title={card.value}>{card.value}</div>
                        </div>
                    ))}
                </div>
            </div>

            {/* Chart Section */}
            <div className="bg-[#111315] border border-[#2A2E33] p-6 rounded-xl min-h-[400px]">
                <div className="flex justify-between items-center mb-6">
                    <h2 className="text-[#EAECEF] font-bold">Smart Money Chart</h2>
                </div>
                <InteractiveSmartMoneyChart />
            </div>


            {/* Bottom Row: Holders List & Alerts */}
            <div className="grid grid-cols-1 xl:grid-cols-10 gap-6">
                {/* Holders List (7/10 width) */}
                <div className="xl:col-span-7 bg-[#111315] border border-[#2A2E33] rounded-xl overflow-hidden flex flex-col">
                    <div className="px-6 py-4 border-b border-[#2A2E33]">
                        <h2 className="font-bold text-[#EAECEF]">Smart Money Holders List</h2>
                    </div>
                    <div className="overflow-x-auto">
                        <table className="w-full">
                            <thead className="bg-[#1C1F22] text-[#8F96A3] text-xs font-semibold uppercase tracking-wider">
                                <tr>
                                    <th className="px-6 py-3 text-left">Wallet address</th>
                                    <th className="px-6 py-3 text-right">Amount held</th>
                                    <th className="px-6 py-3 text-right">PnL %</th>
                                    <th className="px-6 py-3 text-right">Entry price</th>
                                    <th className="px-6 py-3 text-right">Time of first purchase</th>
                                    <th className="px-6 py-3 text-right"></th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-[#2A2E33]">
                                {MOCK_HOLDERS.map((h) => (
                                    <tr key={h.id} className="hover:bg-[#1C1F22]/50 transition-colors">
                                        <td className="px-6 py-4 flex items-center gap-2">
                                            <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-purple-500 to-blue-500"></div>
                                            <span className="text-[#EAECEF] font-mono text-sm">{h.address}</span>
                                        </td>
                                        <td className="px-6 py-4 text-right text-[#EAECEF] font-bold text-sm">{h.amount}</td>
                                        <td className="px-6 py-4 text-right">
                                            <span className={`px-2 py-1 rounded text-xs font-bold ${h.pnlPositive ? 'bg-green-500/10 text-green-400' : 'bg-red-500/10 text-red-400'}`}>
                                                {h.pnl}
                                            </span>
                                        </td>
                                        <td className="px-6 py-4 text-right text-[#8F96A3] font-mono">{h.entry}</td>
                                        <td className="px-6 py-4 text-right text-[#EAECEF] font-mono text-sm">{h.time}</td>
                                        <td className="px-6 py-4 text-right">
                                            <button className="text-xs border border-[#2A2E33] text-[#8F96A3] hover:text-[#EAECEF] hover:border-[#8F96A3] px-3 py-1.5 rounded transition-all">
                                                View Wallet
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>

                {/* Alerts (3/10 width) */}
                <div className="xl:col-span-3 bg-[#111315] border border-[#2A2E33] rounded-xl p-6 flex flex-col gap-4 h-fit">
                    <h2 className="font-bold text-[#EAECEF] mb-2">Smart Money Alerts</h2>

                    <button className="w-full bg-[#1C1F22] hover:bg-[#2A2E33] border border-[#2A2E33] text-[#EAECEF] py-3 rounded-lg transition-colors text-sm text-center">
                        Alert me when smart money buys this token
                    </button>
                    <button className="w-full bg-[#1C1F22] hover:bg-[#2A2E33] border border-[#2A2E33] text-[#EAECEF] py-3 rounded-lg transition-colors text-sm text-center">
                        Alert me when $ wallets enter at once
                    </button>

                    {/* Featured Alert Button */}
                    <button className="w-full bg-gradient-to-r from-gray-800 to-gray-900 border border-[#2A2E33] text-[#EAECEF] py-4 rounded-lg transition-colors text-sm text-center">
                        Alert me when inflow spikes
                    </button>
                </div>
            </div>
        </div>
    );
};
