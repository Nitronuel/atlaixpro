import React, { useState, useRef, useEffect } from 'react';
import { Brain, Send } from 'lucide-react';

interface Message {
    id: number;
    text: string;
    sender: 'user' | 'ai';
    type?: 'text' | 'rich-token' | 'rich-sentiment';
}

export const Chatbot: React.FC = () => {
    const [messages, setMessages] = useState<Message[]>([]);
    const [input, setInput] = useState('');
    const [isTyping, setIsTyping] = useState(false);
    const endRef = useRef<HTMLDivElement>(null);

    const scrollToBottom = () => endRef.current?.scrollIntoView({ behavior: 'smooth' });
    useEffect(scrollToBottom, [messages, isTyping]);

    const handleSend = () => {
        if (!input.trim()) return;
        const userMsg: Message = { id: Date.now(), text: input, sender: 'user' };
        setMessages(p => [...p, userMsg]);
        setInput('');
        setIsTyping(true);

        setTimeout(() => {
            let type: Message['type'] = 'text';
            let text = "I've analyzed the market based on your request.";
            if (userMsg.text.toLowerCase().includes('bonk')) type = 'rich-token';
            else if (userMsg.text.toLowerCase().includes('sentiment')) type = 'rich-sentiment';
            
            setMessages(p => [...p, { id: Date.now() + 1, text, sender: 'ai', type }]);
            setIsTyping(false);
        }, 1500);
    };

    return (
        <div className="flex flex-col h-[calc(100vh-140px)] max-w-4xl mx-auto">
            {messages.length === 0 ? (
                <div className="flex-1 flex flex-col items-center justify-center text-center p-6">
                    <div className="w-16 h-16 rounded-full bg-gradient-to-br from-card to-card-hover border border-border flex items-center justify-center mb-6 text-text-light">
                        <Brain size={32} />
                    </div>
                    <h2 className="text-2xl font-bold mb-2">Atlaix Intelligence</h2>
                    <p className="text-text-medium mb-8">Ask me anything about tokens, wallets, or market trends.</p>
                    <div className="flex flex-wrap justify-center gap-3 w-full max-w-2xl">
                        {["Analyze $BONK sentiment", "Show me smart money flow for SOL", "Check $WIF for risks", "What's trending now?"].map((s, i) => (
                            <button 
                                key={i} 
                                onClick={() => setInput(s)}
                                className="px-5 py-3 bg-card border border-border rounded-full hover:border-primary-green hover:bg-card-hover transition-all text-sm font-medium"
                            >
                                {s}
                            </button>
                        ))}
                    </div>
                </div>
            ) : (
                <div className="flex-1 overflow-y-auto p-4 space-y-6">
                    {messages.map((msg) => (
                        <div key={msg.id} className={`flex gap-4 ${msg.sender === 'user' ? 'justify-end' : ''}`}>
                            {msg.sender === 'ai' && (
                                <div className="w-9 h-9 rounded-full bg-card border border-border flex items-center justify-center shrink-0">
                                    <Brain size={18} />
                                </div>
                            )}
                            <div className={`max-w-[80%] space-y-2`}>
                                {msg.text && (
                                    <div className={`p-4 rounded-xl text-sm leading-relaxed ${
                                        msg.sender === 'user' 
                                        ? 'bg-primary-purple text-white rounded-br-sm' 
                                        : 'bg-card border border-border text-text-light rounded-bl-sm'
                                    }`}>
                                        {msg.text}
                                    </div>
                                )}
                                {msg.type === 'rich-token' && (
                                    <div className="bg-[#0A0B0D] border border-border rounded-2xl p-6 w-full md:min-w-[400px]">
                                        <div className="text-sm text-text-medium mb-4">Token Analysis</div>
                                        <div className="bg-main rounded-xl p-5 mb-4">
                                            <div className="flex justify-between items-start mb-4">
                                                <div className="flex items-center gap-2 font-bold text-lg">
                                                    <img src="https://cryptologos.cc/logos/bonk1-bonk-logo.png" className="w-6 h-6 rounded-full" />
                                                    Bonk ($BONK)
                                                </div>
                                                <div className="bg-primary-green/10 text-primary-green px-2 py-1 rounded text-sm font-bold">+12.4%</div>
                                            </div>
                                            <div className="grid grid-cols-2 gap-4 text-sm">
                                                <div><div className="text-text-dark text-xs mb-1">Market Cap</div><div className="font-semibold">$1.42B</div></div>
                                                <div><div className="text-text-dark text-xs mb-1">Smart Money</div><div className="font-semibold text-primary-green">+2.4%</div></div>
                                            </div>
                                        </div>
                                        <p className="text-sm text-text-light mb-4 leading-relaxed">
                                            <strong className="text-white">Analysis:</strong> $BONK is showing strong <strong className="text-white">bullish divergence</strong> on the 4H chart.
                                        </p>
                                        <div className="flex gap-3">
                                            <button className="flex-1 bg-card-hover border border-border py-2 rounded-lg text-sm font-semibold hover:bg-border transition-colors">View Chart</button>
                                            <button className="flex-1 bg-card-hover border border-border py-2 rounded-lg text-sm font-semibold hover:bg-border transition-colors">Safe Scan</button>
                                        </div>
                                    </div>
                                )}
                            </div>
                            {msg.sender === 'user' && (
                                <div className="w-9 h-9 rounded-full bg-primary-purple flex items-center justify-center text-white font-bold text-xs shrink-0">U</div>
                            )}
                        </div>
                    ))}
                    {isTyping && (
                        <div className="flex gap-4">
                            <div className="w-9 h-9 rounded-full bg-card border border-border flex items-center justify-center shrink-0">
                                <Brain size={18} />
                            </div>
                            <div className="bg-card border border-border p-4 rounded-xl rounded-bl-sm flex gap-1 items-center h-12">
                                <div className="w-1.5 h-1.5 bg-text-medium rounded-full animate-bounce [animation-delay:-0.3s]"></div>
                                <div className="w-1.5 h-1.5 bg-text-medium rounded-full animate-bounce [animation-delay:-0.15s]"></div>
                                <div className="w-1.5 h-1.5 bg-text-medium rounded-full animate-bounce"></div>
                            </div>
                        </div>
                    )}
                    <div ref={endRef} />
                </div>
            )}
            
            <div className="mt-4 bg-card border border-border rounded-2xl p-3 flex items-center gap-3 shadow-lg">
                <input 
                    type="text" 
                    className="flex-1 bg-transparent border-none outline-none text-text-light placeholder-text-dark px-2"
                    placeholder="Ask Atlaix..."
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleSend()}
                />
                <button 
                    onClick={handleSend}
                    disabled={!input.trim()}
                    className="w-10 h-10 bg-primary-green rounded-lg flex items-center justify-center text-main hover:opacity-90 disabled:bg-border disabled:text-text-dark transition-all"
                >
                    <Send size={18} />
                </button>
            </div>
        </div>
    );
};