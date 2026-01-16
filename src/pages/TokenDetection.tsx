import React, { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Check, TrendingUp, AlertTriangle, Activity, Zap, Search, Wallet, Bell, Box, Flame } from 'lucide-react';

declare var ApexCharts: any;

export const TokenDetection: React.FC = () => {
    const { query } = useParams<{ query: string }>();
    const navigate = useNavigate();
    const token = query || 'Unknown Token';

    const chartRef = useRef<HTMLDivElement>(null);
    const chartInstance = useRef<any>(null);
    const [timeFrame, setTimeFrame] = useState('24H');

    useEffect(() => {
        if (chartRef.current && typeof ApexCharts !== 'undefined') {
            const options = {
                series: [
                    { name: 'Anomaly Score', data: [12, 15, 45, 52, 48, 60, 75, 82, 78, 85, 90, 88] },
                    { name: 'Smart Money Inflow', data: [5, 8, 12, 30, 45, 42, 55, 62, 58, 65, 70, 72] },
                    { name: 'Social Sentiment', data: [20, 22, 25, 28, 35, 40, 38, 45, 50, 52, 55, 58] }
                ],
                chart: { type: 'line', height: 350, background: 'transparent', toolbar: { show: false }, zoom: { enabled: false } },
                colors: ['#EB5757', '#26D356', '#F2C94C'],
                stroke: { curve: 'smooth', width: 2 },
                xaxis: {
                    categories: ['00:00', '02:00', '04:00', '06:00', '08:00', '10:00', '12:00', '14:00', '16:00', '18:00', '20:00', '22:00'],
                    labels: { style: { colors: '#8F96A3', fontSize: '10px', fontFamily: 'Inter' } },
                    axisBorder: { show: false }, axisTicks: { show: false }
                },
                yaxis: { show: true, labels: { style: { colors: '#8F96A3', fontFamily: 'Inter' } } },
                grid: { borderColor: '#2A2E33', strokeDashArray: 4 },
                theme: { mode: 'dark' },
                legend: { position: 'top', horizontalAlign: 'left' }
            };
            if (chartInstance.current) chartInstance.current.destroy();
            chartInstance.current = new ApexCharts(chartRef.current, options);
            chartInstance.current.render();
        }
        return () => { if (chartInstance.current) { chartInstance.current.destroy(); chartInstance.current = null; } };
    }, []);

    const eventFeed = [
        { title: 'Whale Activity', time: '2m ago', desc: 'Whale bought 87 ETH of this token.', icon: <Wallet size={16} />, color: 'primary-red', amount: '87 ETH' },
        { title: 'Smart Money', time: '5m ago', desc: 'Smart money is accumulating.', icon: <Zap size={16} />, color: 'primary-yellow', amount: 'Accumulating' },
        { title: 'LP Event', time: '12m ago', desc: 'LP removed: 30%.', icon: <Box size={16} />, color: 'primary-red', amount: '-30% LP' },
        { title: 'Risk Spike', time: '15m ago', desc: 'Risk score spiked from 25 → 72.', icon: <AlertTriangle size={16} />, color: 'primary-red', amount: 'Score: 72' },
        { title: 'Sentiment Surge', time: '20m ago', desc: 'Sentiment up 300%.', icon: <Activity size={16} />, color: 'primary-green', amount: '+300%' },
        { title: 'Social Trend', time: '22m ago', desc: 'Social trend surge detected.', icon: <Flame size={16} />, color: 'primary-yellow', amount: 'Trending' },
    ];



    return (
        <div className="space-y-6 pb-10">
            <div className="flex flex-col gap-4">
                <button onClick={() => navigate('/detection')} className="flex items-center gap-2 text-text-medium hover:text-text-light transition-colors w-fit">
                    <ArrowLeft size={20} /> Back to Global Radar
                </button>
                <div className="flex flex-col md:flex-row justify-between items-start md:items-end">
                    <div>
                        <h1 className="text-3xl font-bold mb-1">{token} Detection Radar</h1>
                        <div className="flex items-center gap-3 text-sm text-text-medium">
                            <span className="bg-[#2A2E33] px-2 py-0.5 rounded text-xs border border-border text-text-light">Solana</span>
                            <span className="font-mono">7ey...29a</span>
                        </div>
                    </div>
                    <div className="text-left md:text-right mt-4 md:mt-0">
                        <div className="text-3xl font-bold text-primary-green">$0.000241</div>
                        <div className="text-sm text-primary-green font-medium">+12.4% (24h)</div>
                    </div>
                </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 bg-card border border-border rounded-xl p-6">
                <div>
                    <div className="text-[10px] text-text-medium uppercase font-bold mb-1">Price</div>
                    <div className="text-lg font-bold text-text-light">$0.000241</div>
                </div>
                <div>
                    <div className="text-[10px] text-text-medium uppercase font-bold mb-1">Volume (24h)</div>
                    <div className="text-lg font-bold text-text-light">$4.2M</div>
                </div>
                <div>
                    <div className="text-[10px] text-text-medium uppercase font-bold mb-1">Liquidity</div>
                    <div className="text-lg font-bold text-text-light">$425K</div>
                </div>
                <div>
                    <div className="text-[10px] text-text-medium uppercase font-bold mb-1">Holder Avg Age</div>
                    <div className="text-lg font-bold text-text-light">4.2d</div>
                </div>
            </div>

            <div className="grid grid-cols-1 xl:grid-cols-[1fr_300px] gap-6">
                <div className="bg-card border border-border rounded-2xl p-6">
                    <div className="flex justify-between items-center mb-4">
                        <h3 className="font-bold text-lg">Token Detection Chart</h3>
                        <div className="flex gap-2">
                            {['1H', '4H', '12H', '24H'].map(tf => (
                                <button key={tf} className={`px-3 py-1 text-xs font-bold rounded border transition-all ${timeFrame === tf ? 'bg-primary-green/10 text-primary-green border-primary-green/30' : 'bg-transparent border-border text-text-medium hover:text-text-light'}`} onClick={() => setTimeFrame(tf)}>{tf}</button>
                            ))}
                        </div>
                    </div>
                    <div ref={chartRef} className="w-full min-h-[350px]"></div>
                </div>

                <div className="bg-card border border-border rounded-2xl p-6">
                    <h3 className="font-bold text-lg mb-6">Quick Actions</h3>
                    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-1 gap-3">
                        <button className="flex items-center gap-3 p-4 bg-transparent border border-border hover:border-primary-green rounded-xl transition-all group text-left">
                            <Check size={20} className="text-primary-green" />
                            <span className="font-bold text-sm text-text-light group-hover:text-primary-green">Track This Token</span>
                        </button>
                        <button className="flex items-center gap-3 p-4 bg-transparent border border-border hover:border-text-light rounded-xl transition-all group text-left">
                            <Wallet size={20} className="text-text-medium group-hover:text-text-light" />
                            <span className="font-bold text-sm text-text-medium group-hover:text-text-light">Track Creator Wallet</span>
                        </button>
                        <button className="flex items-center gap-3 p-4 bg-transparent border border-border hover:border-text-light rounded-xl transition-all group text-left">
                            <Activity size={20} className="text-text-medium group-hover:text-text-light" />
                            <span className="font-bold text-sm text-text-medium group-hover:text-text-light">Run SafeScan</span>
                        </button>
                        <button className="flex items-center gap-3 p-4 bg-transparent border border-border hover:border-text-light rounded-xl transition-all group text-left">
                            <Bell size={20} className="text-text-medium group-hover:text-text-light" />
                            <span className="font-bold text-sm text-text-medium group-hover:text-text-light">Create Alerts</span>
                        </button>
                    </div>
                </div>
            </div>

            <div>
                <h3 className="font-bold text-lg mb-4 pl-1">Token Event Feed</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
                    {eventFeed.map((e, i) => (
                        <div key={i} className="bg-card border border-border rounded-xl flex overflow-hidden group hover:border-text-medium transition-colors shadow-md h-full">
                            <div className={`w-1.5 shrink-0 bg-${e.color}`}></div>
                            <div className="flex-1 p-5 flex flex-col justify-between gap-3">
                                <div>
                                    <div className="flex justify-between items-start mb-2">
                                        <div className={`flex items-center gap-2 font-bold text-xs text-${e.color} uppercase tracking-wide`}>
                                            {e.icon} {e.title}
                                        </div>
                                        <span className="text-[10px] text-text-dark font-mono whitespace-nowrap">{e.time}</span>
                                    </div>
                                    <p className="text-sm text-text-light font-medium leading-snug line-clamp-2">{e.desc}</p>
                                </div>
                                <div className="flex justify-between items-center pt-3 border-t border-border/50 mt-auto">
                                    <span className="text-text-light font-bold text-sm bg-card-hover px-2 py-0.5 rounded border border-border">{token}</span>
                                    <span className="text-text-light font-bold text-sm">{e.amount}</span>
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            </div>


        </div>
    );
};