import React, { useState } from 'react';
import { Copy, Loader2, Network } from 'lucide-react';
import { ForensicBundleSection } from '../components/safe-scan/ForensicBundleSection';
import { AlchemyHubService, type AlchemyHubChain, type ForensicBundleReport } from '../services/AlchemyHubService';
import { ALCHEMY_HUB_CHAINS } from '../services/forensics/alchemy-hub-chains';

const shortenAddress = (value: string) => `${value.slice(0, 4)}...${value.slice(-4)}`;

export const AlchemyHub: React.FC = () => {
    const [contract, setContract] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [report, setReport] = useState<ForensicBundleReport | null>(null);
    const [chain, setChain] = useState<AlchemyHubChain>('solana');

    const normalizedContract = contract.trim();
    const isSupported = AlchemyHubService.isSupported(normalizedContract, chain);

    const handleScan = async () => {
        const tokenAddress = contract.trim();
        if (!tokenAddress) return;

        setLoading(true);
        setError(null);
        setReport(null);

        try {
            const nextReport = await AlchemyHubService.analyzeToken(tokenAddress, chain);
            setReport(nextReport);
        } catch (nextError) {
            setError(nextError instanceof Error ? nextError.message : 'Alchemy Hub analysis failed.');
        } finally {
            setLoading(false);
        }
    };

    const resetScan = () => {
        setContract('');
        setError(null);
        setReport(null);
        setLoading(false);
        setChain('solana');
    };

    if (!report) {
        return (
            <div className="flex min-h-[60vh] flex-col items-center justify-center px-4">
                <div className="w-full max-w-[760px]">
                    <form
                        onSubmit={(event) => {
                            event.preventDefault();
                            void handleScan();
                        }}
                        className="mb-10 flex w-full flex-col gap-4 lg:flex-row"
                    >
                        <select
                            value={chain}
                            onChange={(event) => setChain(event.target.value as AlchemyHubChain)}
                            disabled={loading}
                            className="rounded-xl border border-border bg-[#16181A] px-4 py-3.5 text-base font-semibold text-text-light outline-none transition-colors focus:border-primary-green/60 disabled:opacity-60"
                            aria-label="Select blockchain"
                        >
                            {ALCHEMY_HUB_CHAINS.map((option) => (
                                <option key={option.id} value={option.id}>
                                    {option.label}
                                </option>
                            ))}
                        </select>
                        <div className="flex-1 rounded-xl border border-border bg-[#16181A] px-4 transition-colors focus-within:border-primary-green/60">
                            <input
                                type="text"
                                className="w-full bg-transparent py-3.5 text-base text-text-light outline-none placeholder:text-text-dark"
                                placeholder="Enter Token Contract Address"
                                value={contract}
                                onChange={(event) => {
                                    const nextValue = event.target.value;
                                    setContract(nextValue);
                                    if (nextValue.trim().startsWith('0x') && chain === 'solana') {
                                        setChain('eth');
                                    }
                                }}
                                disabled={loading}
                            />
                        </div>
                        <button
                            type="submit"
                            disabled={loading || !isSupported}
                            className="flex min-w-[180px] items-center justify-center gap-2 rounded-xl bg-primary-green px-8 py-3 font-bold text-main transition-colors hover:bg-primary-green-darker disabled:cursor-not-allowed disabled:bg-card-hover disabled:text-text-medium"
                        >
                            {loading && <Loader2 size={18} className="animate-spin" />}
                            {loading ? 'Scanning...' : 'Alchemy Hub'}
                        </button>
                    </form>

                    {normalizedContract && !isSupported && (
                        <div className="mb-4 rounded-xl border border-primary-red/20 bg-primary-red/8 px-4 py-3 text-sm text-primary-red">
                            {chain === 'solana'
                                ? 'Solana scans require a valid Solana token address.'
                                : 'EVM scans require a valid 0x token contract address for the selected chain.'}
                        </div>
                    )}

                    {error && (
                        <div className="mb-4 rounded-xl border border-primary-red/20 bg-primary-red/8 px-4 py-3 text-sm text-primary-red">
                            {error}
                        </div>
                    )}

                    <div className="rounded-[30px] border border-border bg-card p-10 text-center shadow-[0_20px_50px_rgba(0,0,0,0.28)]">
                        <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-full border border-border bg-card-hover/30 text-text-medium">
                            {loading ? <Loader2 size={34} className="animate-spin" /> : <Network size={34} />}
                        </div>
                        <h2 className="mb-3 text-4xl font-black tracking-tight text-text-light">
                            {loading ? 'Building Alchemy map' : 'Alchemy Hub Intelligence'}
                        </h2>
                        <p className="mx-auto max-w-[540px] text-lg leading-9 text-[#9AA8C7]">
                            {loading
                                ? 'We are running the deep holder and funding-source pass. This can take several minutes, especially on Solana.'
                                : 'Run an Alchemy-first token holder map for Solana and EVM tokens using the same graph presentation as Safe Scan for a clearer wallet-cluster view.'}
                        </p>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="flex flex-col gap-6 animate-fade-in">
            <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
                <div className="min-w-0">
                    <div className="mb-3 flex flex-wrap items-center gap-3">
                        <div className="rounded-full border border-border bg-card px-3 py-1 text-[11px] font-bold uppercase tracking-[0.24em] text-[#8FA0BF]">
                            Alchemy Hub
                        </div>
                        <div className="rounded-full border border-primary-green/20 bg-primary-green/10 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.24em] text-primary-green">
                            {report.tokenSymbol}
                        </div>
                        <div className="rounded-full border border-border bg-card px-3 py-1 text-[11px] font-bold uppercase tracking-[0.24em] text-[#8FA0BF]">
                            {ALCHEMY_HUB_CHAINS.find((option) => option.id === chain)?.label ?? 'Chain'}
                        </div>
                        <div className="rounded-full border border-border bg-card px-3 py-1 text-[11px] font-bold uppercase tracking-[0.24em] text-[#8FA0BF]">
                            Deep scan
                        </div>
                    </div>
                    <h2 className="mb-2 text-4xl font-black tracking-tight text-text-light">{report.tokenName}</h2>
                    <div className="flex flex-wrap items-center gap-3 text-sm text-[#A6B4CF]">
                        <button
                            onClick={() => navigator.clipboard.writeText(report.tokenAddress)}
                            className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 font-mono transition-colors hover:border-border/70 hover:text-text-light"
                        >
                            {shortenAddress(report.tokenAddress)}
                            <Copy size={14} />
                        </button>
                        <span>Updated {new Date(report.analysisTimestamp).toLocaleString()}</span>
                    </div>
                </div>

                <div className="flex flex-wrap gap-3">
                    <button
                        onClick={resetScan}
                        className="rounded-xl bg-primary-green px-5 py-2.5 text-sm font-bold text-main transition-colors hover:bg-primary-green-darker"
                    >
                        New Alchemy Map
                    </button>
                </div>
            </div>

            <ForensicBundleSection
                contract={report.tokenAddress}
                isSupported
                loading={false}
                error={null}
                report={report}
                graphLayoutStyle="cluster-packed"
            />
        </div>
    );
};

export default AlchemyHub;
