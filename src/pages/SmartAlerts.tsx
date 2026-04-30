// Atlaix: Route-level product screen for the Atlaix application.
import React, { useState } from 'react';
import {
    Bell, Zap, Activity, TrendingUp, ShieldCheck, Plus, X,
    CheckCircle2, AlertTriangle, Clock, Search, ChevronRight,
    Sparkles, Flame, Wallet, Eye, BrainCircuit
} from 'lucide-react';
import { AiInterpretationService, InterpretationResult } from '../services/AiInterpretationService';

export const SmartAlerts: React.FC = () => {
    const [alertInput, setAlertInput] = useState('');
    const [isProcessing, setIsProcessing] = useState(false);
    const [interpretation, setInterpretation] = useState<InterpretationResult | null>(null);
    const [showConfirmation, setShowConfirmation] = useState(false);
    const [successMessage, setSuccessMessage] = useState<string | null>(null);

    const suggestions = [
        { label: "Smart Money Buys", color: "text-primary-green border-primary-green/30 bg-transparent" },
        { label: "Whale Movements > $50k", color: "text-primary-green border-primary-green/30 bg-transparent" },
        { label: "Volume Spike > 300%", color: "text-primary-green border-primary-green/30 bg-transparent" },
        { label: "Score Drop < 50", color: "text-primary-green border-primary-green/30 bg-transparent" },
        { label: "Virality Surge", color: "text-primary-green border-primary-green/30 bg-transparent" },
        { label: "New ATH", color: "text-primary-green border-primary-green/30 bg-transparent" },
    ];

    const [activeAlerts, setActiveAlerts] = useState([
        { id: 1, trigger: "ETH Price > $3,500", type: "Price", status: true, lastTriggered: "2 hours ago" },
        { id: 2, trigger: "Wallet 0x8a...9f buys > 10 ETH", type: "Wallet", status: true, lastTriggered: "1 day ago" },
        { id: 3, trigger: "SOL Volume > $1B", type: "Volume", status: false, lastTriggered: "Never" },
    ]);

    const history = [
        { id: 1, title: "ETH Price Alert", time: "10:42 AM", desc: "ETH crossed $3,450", type: "price" },
        { id: 2, title: "Whale Watch", time: "09:15 AM", desc: "0x7d...2a moved $500k USDC", type: "wallet" },
        { id: 3, title: "Risk Scan", time: "Yesterday", desc: "Token PEPE2 detected high risk", type: "risk" },
        { id: 4, title: "Volume Spike", time: "Yesterday", desc: "BONK volume up 400%", type: "volume" },
        { id: 5, title: "Alpha Signal", time: "2 days ago", desc: "Wallet 0x3f...1b entered early", type: "signal" },
    ];

    const handleAnalyzeAlert = async () => {
        if (!alertInput.trim()) return;

        setIsProcessing(true);
        setSuccessMessage(null);
        try {
            const result = await AiInterpretationService.interpretAlert(alertInput);
            setInterpretation(result);
            setShowConfirmation(true);
        } catch (error) {
            console.error("AI Analysis failed", error);
        } finally {
            setIsProcessing(false);
        }
    };

    const handleConfirmAlert = () => {
        if (!interpretation) return;

        // Add to active alerts
        const newAlert = {
            id: Date.now(),
            trigger: interpretation.structured,
            type: "AI Smart",
            status: true,
            lastTriggered: "Just now"
        };
        setActiveAlerts([newAlert, ...activeAlerts]);

        setShowConfirmation(false);
        setAlertInput('');
        setInterpretation(null);
        setSuccessMessage("Alert successfully created");

        setTimeout(() => setSuccessMessage(null), 3000);
    };

    const handleRefine = () => {
        setShowConfirmation(false);
        // Keep input text for user to edit
    };

    return (
        <div className="flex flex-col gap-8 pb-10 animate-fade-in relative z-10 w-full max-w-7xl mx-auto">

            {/* --- Hero / Create Section --- */}
            <section className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-[#1a1d21] to-[#141619] border border-border/50 shadow-2xl p-6 md:p-8">
                {/* Background Decor */}
                <div className="absolute top-0 right-0 w-[300px] h-[300px] bg-primary-green/5 blur-[120px] rounded-full pointer-events-none -translate-y-1/2 translate-x-1/2"></div>
                <div className="absolute bottom-0 left-0 w-[200px] h-[200px] bg-primary-purple/5 blur-[100px] rounded-full pointer-events-none translate-y-1/3 -translate-x-1/3"></div>

                <div className="relative z-10 flex flex-col gap-6">
                    <div>
                        <h2 className="text-xl md:text-2xl font-bold text-text-light">
                            Create Smart Alert
                        </h2>
                        <p className="text-sm text-text-medium mt-2 max-w-2xl">
                            Describe any market condition, wallet activity, or token metric you want to track.
                            <span className="text-text-light font-medium"> Atlaix AI</span> will convert it into a precision trigger.
                        </p>
                    </div>

                    <div className="flex flex-col gap-4">
                        <div className="relative group">
                            <div className="relative bg-black/40 backdrop-blur-sm border border-border rounded-xl flex items-center p-2 transition-all shadow-inner">
                                <Search className="ml-3 text-text-medium transition-colors" size={22} />
                                <input
                                    type="text"
                                    disabled={isProcessing}
                                    className="w-full bg-transparent border-none outline-none text-text-light placeholder-text-dark px-4 py-2 text-sm disabled:opacity-50"
                                    placeholder="Alert me when bitcoin gets to $100,000"
                                    value={alertInput}
                                    onChange={(e) => setAlertInput(e.target.value)}
                                    onKeyDown={(e) => e.key === 'Enter' && handleAnalyzeAlert()}
                                />
                                <button
                                    onClick={handleAnalyzeAlert}
                                    disabled={!alertInput.trim() || isProcessing}
                                    className={`
                                        mr-1 bg-primary-green hover:bg-primary-green-darker text-main font-bold py-2.5 px-6 rounded-lg 
                                        transition-transform active:scale-95 shadow-lg shadow-primary-green/20 flex items-center gap-2
                                        disabled:opacity-50 disabled:cursor-not-allowed
                                    `}
                                >
                                    {isProcessing ? (
                                        <>
                                            <Sparkles className="animate-spin" size={16} />
                                            Analyzing...
                                        </>
                                    ) : (
                                        "Create"
                                    )}
                                </button>
                            </div>
                        </div>

                        {/* Success Message */}
                        {successMessage && (
                            <div className="flex items-center gap-2 text-primary-green bg-primary-green/10 border border-primary-green/20 p-3 rounded-xl animate-fade-in">
                                <CheckCircle2 size={18} />
                                <span className="text-sm font-bold">{successMessage}</span>
                            </div>
                        )}

                        {/* AI Confirmation Card */}
                        {showConfirmation && interpretation && (
                            <div className="bg-[#1a1c21] border border-primary-green/30 rounded-xl p-4 md:p-6 animate-fade-in shadow-xl shadow-black/50">
                                <div className="flex items-start gap-4">
                                    <div className="w-12 h-12 rounded-full bg-primary-green/10 border border-primary-green/20 flex items-center justify-center shrink-0">
                                        <span className="text-primary-green font-bold text-lg">AI</span>
                                    </div>
                                    <div className="flex-1">
                                        <h3 className="text-lg font-bold text-text-light mb-1">Is this what you meant?</h3>
                                        <p className="text-sm text-text-medium mb-4">
                                            Our AI interpreted your request as:
                                        </p>

                                        <div className="bg-black/40 border border-border p-3 rounded-lg mb-4">
                                            <code className="text-primary-green font-mono text-sm md:text-base whitespace-pre-wrap break-words block">
                                                {interpretation.structured}
                                            </code>
                                            {interpretation.details?.tokenAddress && (
                                                <div className="mt-2 pt-2 border-t border-white/10 flex items-center gap-2">
                                                    <span className="text-xs text-text-medium font-mono">CA:</span>
                                                    <code className="text-xs text-text-medium font-mono opacity-80 select-all break-all">
                                                        {interpretation.details.tokenAddress}
                                                    </code>
                                                </div>
                                            )}
                                        </div>

                                        <div className="flex flex-col sm:flex-row gap-3 items-center w-full">
                                            <button
                                                onClick={handleConfirmAlert}
                                                className="w-full sm:w-auto bg-primary-green hover:bg-primary-green-darker text-main font-bold py-2 px-6 rounded-lg transition-colors shadow-lg shadow-primary-green/10 text-center"
                                            >
                                                Confirm Alert
                                            </button>
                                            <button
                                                onClick={handleRefine}
                                                className="w-full sm:w-auto bg-transparent border border-border hover:border-text-light text-text-medium hover:text-text-light font-medium py-2 px-6 rounded-lg transition-colors text-center"
                                            >
                                                Refine Request
                                            </button>
                                            <button
                                                onClick={() => {
                                                    setShowConfirmation(false);
                                                    setAlertInput('');
                                                    setInterpretation(null);
                                                }}
                                                className="w-full sm:w-auto bg-transparent border border-border hover:border-primary-red/50 text-text-medium hover:text-primary-red font-medium py-2 px-6 rounded-lg transition-colors sm:ml-auto text-center"
                                            >
                                                Cancel Alert
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* Suggestion Chips - Only show when not confirming */}
                        {!showConfirmation && (
                            <div className="flex flex-wrap gap-2.5 mt-1">
                                <span className="text-xs font-bold text-text-dark uppercase tracking-wider py-1.5 mr-1 self-center">Try:</span>
                                {suggestions.map((chip, idx) => (
                                    <button
                                        key={idx}
                                        onClick={() => setAlertInput(chip.label)}
                                        className={`
                                            flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold border transition-all duration-300
                                            hover:scale-105 active:scale-95 hover:shadow-[0_0_10px_rgba(0,0,0,0.3)]
                                            ${chip.color}
                                        `}
                                    >
                                        {chip.label}
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            </section>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 md:gap-8 h-full">

                {/* --- Left Column: Suggested & Active --- */}
                <div className="lg:col-span-2 flex flex-col gap-8">

                    {/* Suggested Grid */}
                    <div className="flex flex-col gap-4">
                        <div className="flex items-center justify-between">
                            <h3 className="text-lg font-bold text-text-light flex items-center gap-2">
                                Trending Templates
                            </h3>
                            <button className="text-xs font-medium text-text-dark hover:text-text-light transition-colors">View All</button>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            {[
                                { title: "Bundle Wallet Liquidation", desc: "Detect simultaneous sells from linked wallets", icon: <AlertTriangle className="text-primary-green" />, query: "Alert me when linked wallets sell simultaneously" },
                                { title: "Rug Pull Detection", desc: "Liquidity removed > 80% or Mint authority enabled", icon: <ShieldCheck className="text-primary-green" />, query: "Alert me when liquidity is removed > 80%" },
                                { title: "DEX Whale Accumulation", desc: "Wallets >$1M balance buying >$50k in 1h", icon: <Wallet className="text-primary-green" />, query: "Alert me when a whale buys > $50k" },
                                { title: "Smart Money Early Entry", desc: "Top 1% profitable wallets enter new token", icon: <Sparkles className="text-primary-green" />, query: "Alert me when smart money buys a new token" }
                            ].map((card, i) => (
                                <div
                                    key={i}
                                    onClick={() => setAlertInput(card.query)}
                                    className="group bg-card hover:bg-card-hover border border-border hover:border-text-dark/50 p-5 rounded-xl cursor-pointer transition-all duration-300 relative overflow-hidden"
                                >
                                    <div className="flex items-start gap-4">
                                        <div className="p-3 rounded-lg bg-main border border-border/50 group-hover:scale-110 transition-transform duration-300">
                                            {card.icon}
                                        </div>
                                        <div>
                                            <h4 className="font-bold text-text-light text-sm group-hover:text-primary-green transition-colors">{card.title}</h4>
                                            <p className="text-xs text-text-medium mt-1 leading-relaxed">{card.desc}</p>
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* Active Alerts List */}
                    <div className="flex flex-col gap-4 flex-1">
                        <div className="flex items-center justify-between">
                            <h3 className="text-lg font-bold text-text-light flex items-center gap-2">
                                <Bell size={18} className="text-text-light" />
                                Active Alerts
                            </h3>
                            <button className="text-xs font-medium text-text-dark hover:text-text-light transition-colors flex items-center gap-1">
                                Manage All
                            </button>
                        </div>

                        <div className="bg-card border border-border rounded-xl overflow-hidden shadow-sm">
                            {activeAlerts.map((alert, i) => (
                                <div key={alert.id} className={`
                                    p-4 flex items-center justify-between gap-4 border-b border-border/50 last:border-0 hover:bg-card-hover/40 transition-colors
                                    ${!alert.status ? 'opacity-60 grayscale-[0.5]' : ''}
                                `}>
                                    <div className="flex items-center gap-4">
                                        <div className={`
                                            w-10 h-10 rounded-full flex items-center justify-center border
                                            ${alert.type === 'Price' ? 'bg-green-500/10 border-green-500/20 text-green-500' :
                                                alert.type === 'Wallet' ? 'bg-blue-500/10 border-blue-500/20 text-blue-500' :
                                                    'bg-purple-500/10 border-purple-500/20 text-purple-500'}
                                        `}>
                                            {alert.type === 'Price' ? <TrendingUp size={18} /> :
                                                alert.type === 'Wallet' ? <Wallet size={18} /> : <Activity size={18} />}
                                        </div>
                                        <div>
                                            <div className="font-bold text-sm text-text-light">{alert.trigger}</div>
                                            <div className="flex items-center gap-3 mt-1">
                                                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-main border border-border text-text-medium uppercase tracking-wider">{alert.type}</span>
                                                <span className="text-[10px] text-text-dark flex items-center gap-1">
                                                    <Clock size={10} /> Last: {alert.lastTriggered}
                                                </span>
                                            </div>
                                        </div>
                                    </div>

                                    <div className="flex items-center gap-4">
                                        <label className="relative inline-flex items-center cursor-pointer">
                                            <input type="checkbox" className="sr-only peer" checked={alert.status} readOnly />
                                            <div className="w-9 h-5 bg-main peer-focus:outline-none border border-text-dark/30 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-text-medium after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-primary-green peer-checked:after:bg-white peer-checked:border-primary-green"></div>
                                        </label>
                                        <button className="text-text-dark hover:text-primary-red transition-colors p-2 hover:bg-primary-red/10 rounded-lg">
                                            <X size={16} />
                                        </button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>

                </div>

                {/* --- Right Column: History --- */}
                <div className="flex flex-col gap-4">
                    <h3 className="text-lg font-bold text-text-light flex items-center gap-2">
                        <Clock size={18} className="text-text-medium" />
                        Trigger History
                    </h3>

                    <div className="bg-card border border-border rounded-xl p-0 max-h-[600px] overflow-hidden flex flex-col relative w-full">
                        {/* Timeline Line */}
                        <div className="absolute left-[27px] top-6 bottom-12 w-[2px] bg-border z-0"></div>

                        <div className="overflow-y-auto p-5 space-y-1 custom-scrollbar relative z-10">
                            {history.map((item, i) => (
                                <div key={i} className="flex gap-4 group">
                                    {/* Dot */}
                                    <div className={`
                                        w-3.5 h-3.5 rounded-full border-[3px] border-card shrink-0 mt-1.5 relative z-10 box-content
                                        ${i === 0 ? 'bg-primary-green shadow-[0_0_8px_rgba(38,211,86,0.6)]' : 'bg-text-dark'}
                                    `}></div>

                                    <div className="flex-1 pb-2 border-b border-border/30 last:border-0 group-hover:pl-1 transition-all">
                                        <div className="flex justify-between items-start">
                                            <h4 className="text-sm font-bold text-text-light leading-tight">{item.title}</h4>
                                            <span className="text-[10px] text-text-dark font-mono">{item.time}</span>
                                        </div>
                                        <p className="text-xs text-text-medium mt-1">{item.desc}</p>
                                        <button className="mt-2 text-[10px] font-bold text-primary-green flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                            View Details <ChevronRight size={10} />
                                        </button>
                                    </div>
                                </div>
                            ))}

                            {/* Empty State / Load More */}
                            <div className="flex justify-center pt-4 bg-card relative z-10">
                                <button className="text-xs text-text-dark hover:text-text-light transition-colors">Load older alerts</button>
                            </div>
                        </div>
                    </div>
                </div>

            </div>
        </div>
    );
};
