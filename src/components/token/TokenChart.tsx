// Reusable interface component for Atlaix product workflows.
import React, { useEffect, useState } from 'react';

interface TokenChartProps {
    chainId: string;
    pairAddress: string;
}

export const TokenChart: React.FC<TokenChartProps> = ({ chainId, pairAddress }) => {
    const [chartTheme, setChartTheme] = useState<'light' | 'dark'>(() => {
        if (typeof document === 'undefined') return 'light';
        return document.documentElement.dataset.atlaixTheme === 'dark' || document.documentElement.style.colorScheme === 'dark' ? 'dark' : 'light';
    });

    useEffect(() => {
        if (typeof document === 'undefined') return;
        const updateChartTheme = () => {
            setChartTheme(document.documentElement.dataset.atlaixTheme === 'dark' || document.documentElement.style.colorScheme === 'dark' ? 'dark' : 'light');
        };
        updateChartTheme();
        const observer = new MutationObserver(updateChartTheme);
        observer.observe(document.documentElement, { attributes: true, attributeFilter: ['style', 'data-atlaix-theme'] });
        return () => observer.disconnect();
    }, []);

    const getChartUrl = (cId: string, pAddr: string) => {
        const params = new URLSearchParams({
            embed: '1',
            theme: chartTheme,
            chartTheme,
            trades: '0',
            info: '0',
            loadChartSettings: '0'
        });
        return `https://dexscreener.com/${cId}/${pAddr}?${params.toString()}`;
    };

    const setCredentiallessFrame = (node: HTMLIFrameElement | null) => {
        node?.setAttribute('credentialless', '');
    };

    return (
        <div className="bg-card border border-border rounded-xl overflow-hidden shadow-sm flex flex-col h-[500px] lg:h-[600px] relative w-full">
            <div className="absolute inset-0 bg-main z-0 flex items-center justify-center text-text-medium">
                Loading Chart...
            </div>
            <iframe
                key={`${pairAddress}-${chartTheme}`}
                src={getChartUrl(chainId || 'ethereum', pairAddress || '')}
                className={`token-dex-chart-frame ${chartTheme === 'light' ? 'is-light-mode' : ''}`}
                ref={setCredentiallessFrame}
                style={{ width: '100%', height: '100%', border: '0', position: 'relative', zIndex: 10 }}
                title="Token Chart"
                allow="clipboard-write"
                allowFullScreen
            ></iframe>
        </div>
    );
};
