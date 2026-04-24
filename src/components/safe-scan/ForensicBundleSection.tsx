import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
    Activity,
    AlertCircle,
    Clock3,
    Loader2,
    Minus,
    Plus,
    Radar,
    ShieldAlert,
    SlidersHorizontal,
    Sparkles,
    Users
} from 'lucide-react';
import { ForensicBundleReport } from '../../services/ForensicBundleService';
import { buildForensicGraphLayout } from './forensicGraphLayout';
import type { ForensicGraphLayoutStyle } from './forensicGraphLayout';

type Props = {
    contract: string;
    isSupported: boolean;
    loading: boolean;
    error: string | null;
    report: ForensicBundleReport | null;
    graphLayoutStyle?: ForensicGraphLayoutStyle;
};

const formatPct = (value: number | null | undefined) => {
    if (value === null || value === undefined || !Number.isFinite(value)) return 'N/A';
    return `${value.toFixed(2)}%`;
};

const formatUsd = (value: number | null) => {
    if (value === null || !Number.isFinite(value)) return 'N/A';
    return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
        maximumFractionDigits: value >= 1000 ? 0 : 2
    }).format(value);
};

const formatTokenAmount = (
    value: string | number | bigint | null | undefined,
    decimals = 0
) => {
    if (value === null || value === undefined) return 'N/A';

    try {
        const normalized = typeof value === 'bigint' ? value : BigInt(String(value));
        if (decimals <= 0) {
            return normalized.toLocaleString('en-US');
        }

        const negative = normalized < 0n;
        const absolute = negative ? -normalized : normalized;
        const divisor = 10n ** BigInt(decimals);
        const whole = absolute / divisor;
        const fraction = absolute % divisor;
        const precision = whole > 0n ? 4 : 6;
        const fractionText = fraction
            .toString()
            .padStart(decimals, '0')
            .slice(0, Math.min(decimals, precision))
            .replace(/0+$/, '');

        const wholeText = whole.toLocaleString('en-US');
        const sign = negative ? '-' : '';
        return fractionText ? `${sign}${wholeText}.${fractionText}` : `${sign}${wholeText}`;
    } catch {
        const numeric = Number(value);
        if (!Number.isFinite(numeric)) return String(value);
        return new Intl.NumberFormat('en-US', {
            maximumFractionDigits: Math.max(2, Math.min(decimals, 6))
        }).format(numeric);
    }
};

const shortenAddress = (value: string) => `${value.slice(0, 4)}...${value.slice(-4)}`;

const formatForensicError = (value: string) => {
    if (/\b429\b|too many requests|compute units per second/i.test(value)) {
        return 'Solana forensic providers are rate-limiting this scan right now. Retry in a moment and the reduced-mode safeguards should keep the report from hard-failing.';
    }

    if (/\b503\b|unable to complete request at this time|temporarily unavailable/i.test(value)) {
        return 'The Solana forensic providers were temporarily unavailable during this scan. Retry shortly and the engine will resume the deeper launch-window checks.';
    }

    return value;
};

const tierTone = (tier: string) => {
    if (tier === 'TIER_1') return 'bg-primary-red/15 text-primary-red border border-primary-red/20';
    if (tier === 'TIER_2') return 'bg-primary-yellow/15 text-primary-yellow border border-primary-yellow/20';
    return 'bg-primary-green/15 text-primary-green border border-primary-green/20';
};

const tierRiskLabel = (tier: string) => {
    if (tier === 'TIER_1') return 'High Risk';
    if (tier === 'TIER_2') return 'Elevated';
    return 'Watchlist';
};

const CLUSTER_PALETTE = ['#4CC9F0', '#8B5CF6', '#F59E0B', '#10B981', '#EC4899', '#F97316', '#22D3EE', '#A3E635'];
const ALCHEMY_CLUSTER_PALETTE = ['#F97316', '#EC4899', '#8B5CF6', '#4CC9F0', '#10B981', '#F59E0B', '#22D3EE', '#A3E635'];

const hashString = (value: string) => {
    let hash = 2166136261;
    for (let index = 0; index < value.length; index += 1) {
        hash ^= value.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const AttributionRing: React.FC<{
    label: string;
    value: number;
    accent: string;
    glow: string;
}> = ({ label, value, accent, glow }) => {
    const radius = 28;
    const stroke = 8;
    const normalizedValue = clamp(value, 0, 100);
    const circumference = 2 * Math.PI * radius;
    const dashOffset = circumference - (normalizedValue / 100) * circumference;

    return (
        <div className="group flex min-w-0 flex-col items-center px-2 py-2 text-center transition-transform duration-300 hover:-translate-y-0.5">
            <div className="relative mx-auto mb-3 flex h-[84px] w-[84px] items-center justify-center rounded-full bg-[radial-gradient(circle_at_center,rgba(255,255,255,0.04),rgba(255,255,255,0.01)_58%,transparent_72%)]">
                <svg width="84" height="84" viewBox="0 0 84 84" className="-rotate-90 overflow-visible">
                    <circle
                        cx="42"
                        cy="42"
                        r={radius}
                        fill="none"
                        stroke="rgba(255,255,255,0.08)"
                        strokeWidth={stroke}
                    />
                    <circle
                        cx="42"
                        cy="42"
                        r={radius}
                        fill="none"
                        stroke={accent}
                        strokeWidth={stroke}
                        strokeLinecap="round"
                        strokeDasharray={circumference}
                        strokeDashoffset={dashOffset}
                        style={{
                            transition: 'stroke-dashoffset 500ms ease',
                            filter: `drop-shadow(0 0 12px ${glow})`
                        }}
                    />
                </svg>
                <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-center">
                    <div className="text-[16px] font-extrabold tracking-tight text-text-light">
                        {Math.round(normalizedValue)}%
                    </div>
                </div>
            </div>
            <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-text-medium">
                {label}
            </div>
        </div>
    );
};

export const ForensicBundleSection: React.FC<Props> = ({
    contract,
    isSupported,
    loading,
    error,
    report,
    graphLayoutStyle = 'standard'
}) => {
    const tokenDecimals = report?.tokenDecimals ?? 0;
    const [expandedClusters, setExpandedClusters] = useState<Record<string, boolean>>({});
    const [selectedWallet, setSelectedWallet] = useState<string | null>(null);
    const [graphZoom, setGraphZoom] = useState(1.2);
    const [graphPan, setGraphPan] = useState({ x: 0, y: 0 });
    const [hoveredWallet, setHoveredWallet] = useState<string | null>(null);
    const graphContainerRef = useRef<HTMLDivElement | null>(null);
    const graphPointerState = useRef<{ active: boolean; lastX: number; lastY: number; moved: boolean; dragDistance: number }>({
        active: false,
        lastX: 0,
        lastY: 0,
        moved: false,
        dragDistance: 0
    });

    const toggleCluster = (clusterId: string) => {
        setExpandedClusters((current) => ({
            ...current,
            [clusterId]: !current[clusterId]
        }));
    };

    const clampZoom = (value: number) => clamp(value, 0.65, 1.85);
    const adjustGraphZoom = (delta: number) => {
        setGraphZoom((current) => clampZoom(Number((current + delta).toFixed(2))));
    };

    const handleGraphWheel = (event: React.WheelEvent<HTMLDivElement>) => {
        event.preventDefault();
        event.stopPropagation();
        const intensity = Math.abs(event.deltaY) > 40 ? 0.12 : 0.08;
        adjustGraphZoom(event.deltaY < 0 ? intensity : -intensity);
    };

    useEffect(() => {
        const container = graphContainerRef.current;
        if (!container) return;

        const handleWheel = (event: WheelEvent) => {
            event.preventDefault();
            event.stopPropagation();
            const delta = event.deltaY < 0 ? 0.08 : -0.08;
            setGraphZoom((current) => clampZoom(Number((current + delta).toFixed(2))));
        };

        container.addEventListener('wheel', handleWheel, { passive: false });
        return () => {
            container.removeEventListener('wheel', handleWheel);
        };
    }, []);

    const graphLayout = useMemo(() => {
        if (!report) return null;
        return buildForensicGraphLayout({
            graph: report.ecosystemGraph,
            includeNetworkLinked: true,
            focusClusterId: null,
            layoutStyle: graphLayoutStyle,
            width: 1280,
            height: 760
        });
    }, [graphLayoutStyle, report]);

    const selectedNode = selectedWallet
        ? graphLayout?.nodes.find((node) => node.walletAddress === selectedWallet) ?? null
        : null;
    const selectedConnections = graphLayout && selectedNode
        ? graphLayout.edges.filter((edge) => edge.sourceWallet === selectedNode.walletAddress || edge.targetWallet === selectedNode.walletAddress)
        : [];
    const alchemyClusterColorById = useMemo(() => {
        if (graphLayoutStyle !== 'cluster-packed' || !report) return new Map<string, string>();
        return new Map(report.ecosystemGraph.clusters.map((cluster, index) => [
            cluster.clusterId,
            ALCHEMY_CLUSTER_PALETTE[index % ALCHEMY_CLUSTER_PALETTE.length]
        ]));
    }, [graphLayoutStyle, report]);
    const graphLegendItems = useMemo(() => {
        if (graphLayoutStyle === 'cluster-packed' && report) {
            const clusterItems = report.ecosystemGraph.clusters.slice(0, 3).map((cluster, index) => [
                ALCHEMY_CLUSTER_PALETTE[index % ALCHEMY_CLUSTER_PALETTE.length],
                cluster.clusterName || `Cluster ${index + 1}`
            ]);

            return [
                ...clusterItems,
                ['#87B8FF', 'Funding sources'],
                ['#90A9D8', 'Independent wallets'],
                ['rgba(123, 135, 148, 0.9)', 'Funding links'],
                ['rgba(242, 201, 76, 0.9)', 'Transfer links']
            ];
        }

        return [
            ['#EF4444', 'Insider cluster'],
            ['#38BDF8', 'Other clusters'],
            ['#64748B', 'Neutral wallets'],
            ['rgba(242, 201, 76, 0.9)', 'Transfer links'],
            ['rgba(86, 204, 242, 0.9)', 'Launch links'],
            ['rgba(123, 135, 148, 0.9)', 'Funding links']
        ];
    }, [graphLayoutStyle, report]);
    const supplyAttributionConfig = useMemo(() => {
        if (!report) {
            return {
                title: 'Supply attribution breakdown',
                description: 'A modern view of how supply is distributed across linked wallets, launch-window actors, and the remaining float.',
                items: []
            };
        }

        if (graphLayoutStyle === 'cluster-packed') {
            return {
                title: 'Alchemy supply map',
                description: 'A cleaner Alchemy-focused view of clustered holder supply, connected wallet flow, concentration, and remaining circulating float.',
                items: [
                    {
                        label: 'Cluster-held',
                        value: report.supplyAttribution.clusteredPct,
                        accent: '#F97316',
                        glow: 'rgba(249,115,22,0.35)'
                    },
                    {
                        label: 'Connected network',
                        value: report.supplyAttribution.combinedCoordinatedPct,
                        accent: '#EC4899',
                        glow: 'rgba(236,72,153,0.35)'
                    },
                    {
                        label: 'Top 10 holders',
                        value: report.holderConcentration.top10Pct,
                        accent: '#8B5CF6',
                        glow: 'rgba(139,92,246,0.35)'
                    },
                    {
                        label: 'Top 20 holders',
                        value: report.holderConcentration.top20Pct,
                        accent: '#4CC9F0',
                        glow: 'rgba(76,201,240,0.34)'
                    },
                    {
                        label: 'Remaining float',
                        value: report.supplyAttribution.remainingPct,
                        accent: '#10B981',
                        glow: 'rgba(16,185,129,0.3)'
                    }
                ]
            };
        }

        return {
            title: 'Supply attribution breakdown',
            description: 'A modern view of how supply is distributed across linked wallets, launch-window actors, and the remaining float.',
            items: [
                { label: 'Deployer-linked', value: report.supplyAttribution.deployerLinkedPct, accent: '#5EF38C', glow: 'rgba(94,243,140,0.35)' },
                { label: 'Block-zero wallets', value: report.supplyAttribution.blockZeroPct, accent: '#FFD166', glow: 'rgba(255,209,102,0.35)' },
                { label: 'Sniper-window wallets', value: report.supplyAttribution.sniperPct, accent: '#FF7A59', glow: 'rgba(255,122,89,0.35)' },
                { label: 'Confirmed clusters', value: report.supplyAttribution.clusteredPct, accent: '#6FDBFF', glow: 'rgba(111,219,255,0.35)' },
                { label: 'Remaining circulating', value: report.supplyAttribution.remainingPct, accent: '#5EF38C', glow: 'rgba(94,243,140,0.28)' }
            ]
        };
    }, [graphLayoutStyle, report]);

    const clusterColor = (clusterId: string | null, clusterName?: string | null) => {
        if (!clusterId) return '#64748B';
        if (graphLayoutStyle === 'cluster-packed') {
            return alchemyClusterColorById.get(clusterId) ?? ALCHEMY_CLUSTER_PALETTE[hashString(clusterId) % ALCHEMY_CLUSTER_PALETTE.length];
        }
        if (clusterName === 'Insider Cluster') return '#EF4444';
        return CLUSTER_PALETTE[hashString(clusterId) % CLUSTER_PALETTE.length];
    };

    const nodeColor = (node: { clusterId: string | null; role: string; label?: string | null }) => {
        if (!node.clusterId) return '#7B8FBA';
        return clusterColor(node.clusterId, node.label);
    };

    const nodeFillColor = (node: { clusterId: string | null; role: string; label?: string | null; zone?: 'clustered' | 'outer' }) => {
        if (!node.clusterId) {
            return node.role === 'network_linked' ? '#87B8FF' : '#90A9D8';
        }
        const color = clusterColor(node.clusterId, node.label);
        if (color === '#EF4444') return '#FF7B7B';
        if (color === '#4CC9F0') return '#88E7FF';
        if (color === '#8B5CF6') return '#BF96FF';
        if (color === '#F59E0B') return '#FFD166';
        if (color === '#10B981') return '#57F2BE';
        if (color === '#EC4899') return '#FF8CC8';
        if (color === '#F97316') return '#FFB068';
        if (color === '#22D3EE') return '#8BEFFF';
        if (color === '#A3E635') return '#DAFF7A';
        return node.zone === 'outer' ? '#6B8CB4' : '#84A4CA';
    };

    const nodeStrokeColor = (node: { clusterId: string | null; role: string; label?: string | null }) => {
        if (!node.clusterId) {
            return node.role === 'network_linked' ? 'rgba(156, 211, 255, 0.95)' : 'rgba(185, 204, 255, 0.76)';
        }
        return clusterColor(node.clusterId, node.label);
    };

    const nodeGlowColor = (node: { clusterId: string | null; role: string; label?: string | null }) => {
        if (!node.clusterId) {
            return node.role === 'network_linked' ? 'rgba(117, 188, 255, 0.42)' : 'rgba(164, 188, 255, 0.28)';
        }
        const color = clusterColor(node.clusterId, node.label);
        if (color === '#EF4444') return 'rgba(255,104,104,0.5)';
        if (color === '#4CC9F0') return 'rgba(104,231,255,0.5)';
        if (color === '#8B5CF6') return 'rgba(180,128,255,0.46)';
        if (color === '#F59E0B') return 'rgba(255,190,71,0.5)';
        if (color === '#10B981') return 'rgba(70,238,182,0.46)';
        if (color === '#EC4899') return 'rgba(255,105,185,0.46)';
        return 'rgba(180, 198, 255, 0.28)';
    };

    const edgeColor = (type: string) => {
        if (type === 'transfer') return 'rgba(255, 220, 108, 0.92)';
        if (type === 'launch') return 'rgba(112, 218, 255, 0.94)';
        return 'rgba(210, 221, 238, 0.82)';
    };

    const edgeGlowColor = (type: string) => {
        if (type === 'transfer') return 'rgba(255, 208, 84, 0.22)';
        if (type === 'launch') return 'rgba(90, 206, 255, 0.24)';
        return 'rgba(148, 163, 184, 0.18)';
    };

    const isNodeInteractionTarget = (target: EventTarget | null) => {
        return target instanceof Element && !!target.closest('[data-graph-node="true"]');
    };

    const handleGraphPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
        if (isNodeInteractionTarget(event.target)) {
            graphPointerState.current.active = false;
            graphPointerState.current.moved = false;
            graphPointerState.current.dragDistance = 0;
            return;
        }

        graphPointerState.current = {
            active: true,
            lastX: event.clientX,
            lastY: event.clientY,
            moved: false,
            dragDistance: 0
        };
        event.currentTarget.setPointerCapture(event.pointerId);
    };

    const handleGraphPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
        if (!graphPointerState.current.active) return;
        const dx = event.clientX - graphPointerState.current.lastX;
        const dy = event.clientY - graphPointerState.current.lastY;
        if (dx === 0 && dy === 0) return;
        graphPointerState.current.lastX = event.clientX;
        graphPointerState.current.lastY = event.clientY;
        graphPointerState.current.dragDistance += Math.hypot(dx, dy);
        if (graphPointerState.current.dragDistance < 6) {
            return;
        }
        graphPointerState.current.moved = true;
        setGraphPan((current) => ({
            x: current.x + dx,
            y: current.y + dy
        }));
    };

    const handleGraphPointerEnd = () => {
        graphPointerState.current.active = false;
        graphPointerState.current.dragDistance = 0;
    };

    const selectedCluster = selectedNode?.clusterId
        ? report?.ecosystemGraph.clusters.find((cluster) => cluster.clusterId === selectedNode.clusterId) ?? null
        : null;

    return (
        <div className="flex flex-col gap-6">
        <section className="bg-card border border-border rounded-2xl p-6 md:p-8">
            <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4 mb-6">
                <div>
                    <div className="text-[10px] uppercase tracking-[0.24em] font-bold text-primary-green mb-2">
                        Advanced Forensic Analysis
                    </div>
                    <h3 className="text-xl font-bold text-text-light mb-2">Bundle and coordinated-wallet intelligence</h3>
                    <p className="text-sm text-text-medium max-w-3xl leading-relaxed">
                        This layer extends Safe Scan with sampled launch-window forensics, wallet-link clustering, block-zero and sniper detection, and coordinated supply attribution.
                    </p>
                </div>
                {report ? (
                    <div className="bg-card-hover/40 border border-border rounded-xl px-4 py-3 text-sm min-w-[220px]">
                        <div className="text-text-medium mb-1">Last analysis</div>
                        <div className="text-text-light font-bold">{new Date(report.analysisTimestamp).toLocaleString()}</div>
                    </div>
                ) : null}
            </div>

            {!isSupported ? (
                <div className="bg-card-hover/20 border border-border rounded-2xl p-6 flex items-start gap-4">
                    <div className="w-11 h-11 rounded-xl bg-card-hover/20 text-text-medium flex items-center justify-center flex-shrink-0">
                        <Clock3 size={20} />
                    </div>
                    <div>
                        <div className="text-text-light font-bold mb-1">This feature is coming soon</div>
                        <p className="text-sm text-text-medium leading-relaxed">
                            Advanced forensic bundle analysis will be added for non-Solana assets in a later release. Current Safe Scan checks still ran normally for <span className="font-mono text-text-light">{contract}</span>.
                        </p>
                    </div>
                </div>
            ) : null}

            {isSupported && loading ? (
                <div className="bg-card-hover/20 border border-border rounded-2xl p-6 flex items-start gap-4">
                    <div className="w-11 h-11 rounded-xl bg-card-hover/20 text-text-medium flex items-center justify-center flex-shrink-0">
                        <Loader2 size={20} className="animate-spin" />
                    </div>
                    <div>
                        <div className="text-text-light font-bold mb-1">Running Solana forensic analysis</div>
                        <p className="text-sm text-text-medium leading-relaxed">
                            We’re reconstructing the sampled launch window, decoding early buyer flow, tracing funding and transfer links, and attributing coordinated supply.
                        </p>
                    </div>
                </div>
            ) : null}

            {isSupported && !loading && error ? (
                <div className="bg-primary-red/5 border border-primary-red/15 rounded-2xl p-6 flex items-start gap-4">
                    <div className="w-11 h-11 rounded-xl bg-card-hover/20 text-text-medium flex items-center justify-center flex-shrink-0">
                        <AlertCircle size={20} />
                    </div>
                    <div>
                        <div className="text-primary-red font-bold mb-1">Forensic analysis could not complete</div>
                        <p className="text-sm text-text-medium leading-relaxed">{formatForensicError(error)}</p>
                    </div>
                </div>
            ) : null}

            {isSupported && !loading && !error && report ? (
                <div className="flex flex-col gap-6">
                    <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
                        <div className="bg-card-hover/20 border border-border rounded-2xl p-5">
                            <div className="flex items-center gap-2 text-text-medium text-sm mb-3">
                                <Radar size={16} className="text-text-medium" />
                                Coordinated supply
                            </div>
                            <div className="text-3xl font-extrabold text-text-light mb-1">
                                {formatPct(report.supplyAttribution.combinedCoordinatedPct)}
                            </div>
                            <div className="text-xs text-text-medium">
                                Estimated value {formatUsd(report.supplyAttribution.estimatedCombinedValueUsd)}
                            </div>
                        </div>

                        <div className="bg-card-hover/20 border border-border rounded-2xl p-5">
                            <div className="flex items-center gap-2 text-text-medium text-sm mb-3">
                                <Activity size={16} className="text-text-medium" />
                                Launch buyers
                            </div>
                            <div className="text-3xl font-extrabold text-text-light mb-1">
                                {report.launchSummary.launchBuyerCount}
                            </div>
                            <div className="text-xs text-text-medium">
                                Earliest observed slot {report.launchSummary.earliestObservedSlot ?? 'N/A'}
                            </div>
                        </div>

                        <div className="bg-card-hover/20 border border-border rounded-2xl p-5">
                            <div className="flex items-center gap-2 text-text-medium text-sm mb-3">
                                <Users size={16} className="text-text-medium" />
                                Wallet clusters
                            </div>
                            <div className="text-3xl font-extrabold text-text-light mb-1">
                                {report.walletClusters.length}
                            </div>
                            <div className="text-xs text-text-medium">
                                Top 10 holders control {formatPct(report.holderConcentration.top10Pct)}
                            </div>
                        </div>

                        <div className="bg-card-hover/20 border border-border rounded-2xl p-5">
                            <div className="flex items-center gap-2 text-text-medium text-sm mb-3">
                                <ShieldAlert size={16} className="text-text-medium" />
                                Cluster-held value
                            </div>
                            <div className="text-3xl font-extrabold text-text-light mb-1">
                                {formatUsd(report.supplyAttribution.estimatedClusterValueUsd)}
                            </div>
                            <div className="text-xs text-text-medium">
                                Cluster share {formatPct(report.supplyAttribution.clusteredPct)}
                            </div>
                        </div>
                    </div>

                    <div className="bg-card-hover/10 border border-border rounded-[28px] p-6 md:p-7">
                        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between mb-6">
                            <div>
                                <div className="flex items-center gap-2 mb-2">
                                    <Sparkles size={16} className="text-text-medium" />
                                    <h4 className="font-bold text-lg">{supplyAttributionConfig.title}</h4>
                                </div>
                                <p className="text-sm text-text-medium leading-relaxed max-w-3xl">
                                    {supplyAttributionConfig.description}
                                </p>
                            </div>
                            {graphLayoutStyle === 'cluster-packed' ? (
                                <div className="grid min-w-[260px] grid-cols-2 gap-2 rounded-2xl border border-border bg-card/60 p-3 text-sm">
                                    <div>
                                        <div className="text-[10px] uppercase tracking-wide text-text-medium">Clusters</div>
                                        <div className="text-text-light font-extrabold">{report.walletClusters.length}</div>
                                    </div>
                                    <div>
                                        <div className="text-[10px] uppercase tracking-wide text-text-medium">Wallets</div>
                                        <div className="text-text-light font-extrabold">{report.ecosystemGraph.nodes.length}</div>
                                    </div>
                                    <div className="col-span-2 h-2 overflow-hidden rounded-full bg-white/10">
                                        <div
                                            className="h-full rounded-full bg-primary-green"
                                            style={{ width: `${clamp(report.supplyAttribution.combinedCoordinatedPct, 0, 100)}%` }}
                                        />
                                    </div>
                                    <div className="col-span-2 text-xs text-text-medium">
                                        {formatPct(report.supplyAttribution.combinedCoordinatedPct)} connected supply mapped by Alchemy.
                                    </div>
                                </div>
                            ) : null}
                        </div>
                        <div className="grid grid-cols-2 gap-y-5 md:grid-cols-5 md:gap-x-2 md:gap-y-0">
                            {supplyAttributionConfig.items.map((item) => (
                                <AttributionRing
                                    key={item.label}
                                    label={item.label}
                                    value={item.value}
                                    accent={item.accent}
                                    glow={item.glow}
                                />
                            ))}
                        </div>
                    </div>
                </div>
            ) : null}
        </section>

        {isSupported && !loading && !error && report ? (
            <section className="bg-card border border-border rounded-[28px] p-5 md:p-6 overflow-hidden">
                        <div className="flex flex-col xl:flex-row xl:items-start xl:justify-between gap-4 mb-5">
                            <div>
                                <div className="text-[10px] uppercase tracking-[0.24em] font-bold text-primary-green mb-2">
                                    Ecosystem Graph
                                </div>
                                <h4 className="font-bold text-xl text-text-light mb-2">Interactive cluster ecosystem map</h4>
                                <p className="text-sm text-text-medium max-w-3xl leading-relaxed">
                                    Cluster cores, network-linked wallets, sniper entrants, and deployer-linked nodes are arranged into a visual investigation surface. Select a node or focus a cluster to inspect relationships in context.
                                </p>
                            </div>
                        </div>

                        <div className="grid grid-cols-1 2xl:grid-cols-[minmax(0,1fr)_330px] gap-5 items-start">
                            <div className="min-w-0 rounded-[24px] border border-border bg-card overflow-hidden">
                                <div className="grid grid-cols-1 md:grid-cols-3 gap-3 px-5 py-4 border-b border-border bg-card-hover/10">
                                    <div className="rounded-2xl border border-border bg-card-hover/20 px-4 py-3">
                                        <div className="text-[10px] uppercase tracking-[0.18em] text-text-medium mb-1">Clustered wallets</div>
                                        <div className="text-2xl font-extrabold text-text-light">{graphLayout?.clusteredWalletCount ?? 0}</div>
                                        <div className="text-xs text-text-medium mt-1">Wallets anchored to confirmed clusters</div>
                                    </div>
                                    <div className="rounded-2xl border border-border bg-card-hover/20 px-4 py-3">
                                        <div className="text-[10px] uppercase tracking-[0.18em] text-text-medium mb-1">Non-clustered wallets</div>
                                        <div className="text-2xl font-extrabold text-text-light">{graphLayout?.nonClusteredWalletCount ?? 0}</div>
                                        <div className="text-xs text-text-medium mt-1">Wallets left outside the confirmed cluster zone</div>
                                    </div>
                                    <div className="rounded-2xl border border-border bg-card-hover/20 px-4 py-3">
                                        <div className="text-[10px] uppercase tracking-[0.18em] text-text-medium mb-1">Wallet balance ratio</div>
                                        <div className="text-2xl font-extrabold text-text-light">
                                            {(graphLayout?.clusteredWalletCount ?? 0)}:{Math.max(1, graphLayout?.nonClusteredWalletCount ?? 0)}
                                        </div>
                                        <div className="text-xs text-text-medium mt-1">Visual ratio of clustered to non-clustered holders in this graph</div>
                                    </div>
                                </div>

                                <div className="flex justify-end px-5 py-4 border-b border-border bg-card-hover/20">
                                        <div className="flex items-center gap-3 text-sm">
                                            <div className="flex items-center gap-2 text-text-medium">
                                                <SlidersHorizontal size={15} className="text-text-medium" />
                                                Zoom
                                            </div>
                                            <button
                                                type="button"
                                                onClick={() => adjustGraphZoom(-0.1)}
                                                className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-border bg-card-hover/30 text-text-light transition-colors hover:bg-card-hover/55"
                                                aria-label="Zoom out graph"
                                            >
                                                <Minus size={15} />
                                            </button>
                                            <input
                                                type="range"
                                                min={0.65}
                                                max={1.85}
                                                step={0.05}
                                                value={graphZoom}
                                                onChange={(event) => setGraphZoom(clampZoom(Number(event.target.value)))}
                                                className="w-36 accent-[#56CCF2]"
                                            />
                                            <button
                                                type="button"
                                                onClick={() => adjustGraphZoom(0.1)}
                                                className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-border bg-card-hover/30 text-text-light transition-colors hover:bg-card-hover/55"
                                                aria-label="Zoom in graph"
                                            >
                                                <Plus size={15} />
                                            </button>
                                            <span className="text-text-light font-semibold w-10 text-right">{Math.round(graphZoom * 100)}%</span>
                                        </div>
                                    </div>

                                {graphLayout && graphLayout.nodes.length ? (
                                    <div
                                        ref={graphContainerRef}
                                        className="overflow-hidden cursor-grab active:cursor-grabbing touch-none bg-black"
                                        style={{ overscrollBehavior: 'contain' }}
                                        onWheel={handleGraphWheel}
                                        onPointerDown={handleGraphPointerDown}
                                        onPointerMove={handleGraphPointerMove}
                                        onPointerUp={handleGraphPointerEnd}
                                        onPointerLeave={handleGraphPointerEnd}
                                        onPointerCancel={handleGraphPointerEnd}
                                    >
                                        <div className="w-full bg-black">
                                            <svg viewBox={`0 0 ${graphLayout.width} ${graphLayout.height}`} className="block w-full h-[440px] sm:h-[520px] lg:h-[640px]" role="img" aria-label="Cluster ecosystem graph">
                                                <defs>
                                                    <radialGradient id="graph-bg-glow" cx="50%" cy="50%" r="75%">
                                                        <stop offset="0%" stopColor="rgba(79, 205, 255, 0.18)" />
                                                        <stop offset="42%" stopColor="rgba(79, 205, 255, 0.08)" />
                                                        <stop offset="100%" stopColor="rgba(0,0,0,0)" />
                                                    </radialGradient>
                                                    <radialGradient id="bubble-core" cx="35%" cy="30%" r="75%">
                                                        <stop offset="0%" stopColor="rgba(255,255,255,0.64)" />
                                                        <stop offset="22%" stopColor="rgba(255,255,255,0.24)" />
                                                        <stop offset="100%" stopColor="rgba(255,255,255,0)" />
                                                    </radialGradient>
                                                    <radialGradient id="bubble-shadow-core" cx="48%" cy="55%" r="80%">
                                                        <stop offset="0%" stopColor="rgba(15,23,42,0.0)" />
                                                        <stop offset="65%" stopColor="rgba(8,15,26,0.07)" />
                                                        <stop offset="100%" stopColor="rgba(2,6,23,0.2)" />
                                                    </radialGradient>
                                                    <filter id="softGlow">
                                                        <feGaussianBlur stdDeviation="14" result="blur" />
                                                        <feMerge>
                                                            <feMergeNode in="blur" />
                                                            <feMergeNode in="SourceGraphic" />
                                                        </feMerge>
                                                    </filter>
                                                    <filter id="edgeGlow">
                                                        <feGaussianBlur stdDeviation="2.2" result="blur" />
                                                        <feMerge>
                                                            <feMergeNode in="blur" />
                                                            <feMergeNode in="SourceGraphic" />
                                                        </feMerge>
                                                    </filter>
                                                </defs>
                                                <rect x="0" y="0" width={graphLayout.width} height={graphLayout.height} fill="#000000" />
                                                <circle cx={graphLayout.width / 2} cy={graphLayout.height / 2} r="352" fill="url(#graph-bg-glow)" />
                                                {[...Array(4)].map((_, index) => (
                                                    <ellipse key={index} cx={graphLayout.width / 2} cy={graphLayout.height / 2} rx={250 + index * 85} ry={145 + index * 58} fill="none" stroke="rgba(151, 180, 255, 0.05)" strokeDasharray="4 10" />
                                                ))}
                                                <g transform={`translate(${graphPan.x} ${graphPan.y}) translate(${graphLayout.width / 2} ${graphLayout.height / 2}) scale(${graphZoom}) translate(${-graphLayout.width / 2} ${-graphLayout.height / 2})`}>
                                                    {graphLayout.groups.map((group) => {
                                                        const haloRadius = group.hullRadius;
                                                        const shouldShowClusterLabel = selectedNode?.clusterId === group.clusterId;
                                                        if (!shouldShowClusterLabel) return null;
                                                        return (
                                                            <g key={group.clusterId}>
                                                                <text x={group.x} y={group.y - haloRadius - 10} textAnchor="middle" fill="rgba(255,255,255,0.94)" fontSize="13" fontWeight="700">{group.clusterName}</text>
                                                                <text x={group.x} y={group.y - haloRadius + 5} textAnchor="middle" fill="rgba(148,163,184,0.95)" fontSize="10">{group.walletCount} wallets · {formatPct(group.supplyHeldPct)}</text>
                                                            </g>
                                                        );
                                                    })}
                                                    {graphLayout.edges.map((edge) => {
                                                        const source = graphLayout.nodeMap.get(edge.sourceWallet);
                                                        const target = graphLayout.nodeMap.get(edge.targetWallet);
                                                        if (!source || !target) return null;
                                                        const active = selectedNode && (selectedNode.walletAddress === edge.sourceWallet || selectedNode.walletAddress === edge.targetWallet);
                                                        const faded = selectedNode && !active;
                                                        const dx = target.x - source.x;
                                                        const dy = target.y - source.y;
                                                        const distance = Math.hypot(dx, dy);
                                                        const normalX = distance ? -dy / distance : 0;
                                                        const normalY = distance ? dx / distance : 0;
                                                        const curve = clamp(distance * 0.11, 16, 52);
                                                        const midX = (source.x + target.x) / 2 + normalX * curve;
                                                        const midY = (source.y + target.y) / 2 + normalY * curve;
                                                        const path = `M ${source.x} ${source.y} Q ${midX} ${midY} ${target.x} ${target.y}`;
                                                        const bothClustered = source.zone === 'clustered' && target.zone === 'clustered';
                                                        const outerOnly = source.zone === 'outer' && target.zone === 'outer';
                                                        const baseOpacity = faded ? 0.08 : active ? 0.96 : bothClustered ? 0.34 : outerOnly ? 0.18 : 0.26;
                                                        const coreOpacity = faded ? 0.14 : active ? 0.98 : bothClustered ? 0.82 : outerOnly ? 0.42 : 0.64;
                                                        const coreWidth = active ? 2.2 : bothClustered ? Math.max(0.62, edge.strengthScore * 0.38) : Math.max(0.72, edge.strengthScore * 0.42);
                                                        const glowWidth = active ? 4.8 : bothClustered ? Math.max(2.1, edge.strengthScore * 0.88) : Math.max(1.7, edge.strengthScore * 0.76);
                                                        return (
                                                            <g key={edge.edgeId}>
                                                                <path d={path} fill="none" stroke={edgeGlowColor(edge.relationshipType)} strokeWidth={glowWidth} strokeOpacity={baseOpacity} strokeLinecap="round" filter="url(#edgeGlow)" />
                                                                <path d={path} fill="none" stroke={edgeColor(edge.relationshipType)} strokeWidth={coreWidth} strokeOpacity={coreOpacity} strokeLinecap="round" />
                                                            </g>
                                                        );
                                                    })}
                                                    {graphLayout.nodes.map((node) => {
                                                        const active = selectedNode?.walletAddress === node.walletAddress;
                                                        const hovered = hoveredWallet === node.walletAddress;
                                                        const muted = selectedNode && !active && !selectedConnections.some((edge) => edge.sourceWallet === node.walletAddress || edge.targetWallet === node.walletAddress);
                                                        const labelVisible = active || hovered || node.currentHoldingsPct >= 2.5 || (node.zone === 'clustered' && node.clusterRank === 0);
                                                        const rimColor = nodeStrokeColor(node);
                                                        const shellColor = nodeGlowColor(node);
                                                        const fillColor = nodeFillColor(node);
                                                        return (
                                                            <g
                                                                key={node.walletAddress}
                                                                data-graph-node="true"
                                                                onPointerDown={(event) => {
                                                                    event.stopPropagation();
                                                                    graphPointerState.current.active = false;
                                                                    graphPointerState.current.moved = false;
                                                                    graphPointerState.current.dragDistance = 0;
                                                                }}
                                                                onClick={(event) => {
                                                                    event.stopPropagation();
                                                                    if (graphPointerState.current.moved) {
                                                                        graphPointerState.current.moved = false;
                                                                        return;
                                                                    }
                                                                    setSelectedWallet(node.walletAddress);
                                                                }}
                                                                onMouseEnter={() => setHoveredWallet(node.walletAddress)}
                                                                onMouseLeave={() => setHoveredWallet(null)}
                                                                className="cursor-pointer"
                                                            >
                                                                <circle cx={node.x} cy={node.y} r={active ? node.radius + 16 : hovered ? node.radius + 11 : node.radius + 8} fill={shellColor} fillOpacity={muted ? 0.08 : node.zone === 'outer' ? 0.24 : 0.34} filter="url(#softGlow)" />
                                                                <circle cx={node.x} cy={node.y} r={node.radius} fill={fillColor} fillOpacity={muted ? 0.6 : 1} stroke={active ? '#ffffff' : rimColor} strokeOpacity={active ? 0.99 : hovered ? 0.98 : node.clusterId ? 0.96 : 0.82} strokeWidth={active ? 2.6 : hovered ? 2.1 : node.clusterId ? 1.9 : 1.5} />
                                                                <circle cx={node.x} cy={node.y} r={node.radius * 0.96} fill={fillColor} fillOpacity={muted ? 0.22 : node.clusterId ? 0.36 : 0.3} />
                                                                <circle cx={node.x} cy={node.y} r={node.radius * 0.94} fill="url(#bubble-shadow-core)" fillOpacity={muted ? 0.08 : 0.26} />
                                                                <circle cx={node.x} cy={node.y} r={node.radius * 0.9} fill="url(#bubble-core)" fillOpacity={muted ? 0.12 : node.clusterId ? 0.34 : 0.24} />
                                                                <circle cx={node.x - (node.radius * 0.28)} cy={node.y - (node.radius * 0.3)} r={Math.max(1.45, node.radius * 0.14)} fill="rgba(255,255,255,0.8)" />
                                                                {labelVisible ? (
                                                                    <>
                                                                        <rect x={node.x - (node.zone === 'outer' ? 52 : 46)} y={node.y + node.radius + 10} width={node.zone === 'outer' ? 104 : 92} height="20" rx="10" fill={node.zone === 'outer' ? 'rgba(18,27,37,0.88)' : 'rgba(8,16,24,0.9)'} stroke="rgba(255,255,255,0.08)" />
                                                                        <text x={node.x} y={node.y + node.radius + 24} textAnchor="middle" fill="#F8FAFC" fontSize="10" fontWeight="600">{shortenAddress(node.walletAddress)}</text>
                                                                    </>
                                                                ) : null}
                                                            </g>
                                                        );
                                                    })}
                                                </g>
                                            </svg>
                                        </div>
                                    </div>
                                ) : (
                                    <p className="text-sm text-text-medium p-5">No graph data was emitted for this run.</p>
                                )}
                            </div>

                            <div className="min-w-0 space-y-4">
                                <div className="bg-card rounded-[24px] border border-border p-5">
                                    <div className="text-text-light font-semibold mb-4">Graph legend</div>
                                    <div className="grid grid-cols-2 gap-3 text-sm">
                                        {graphLegendItems.map(([color, label], index) => (
                                            <div key={`${label}-${index}`} className="flex items-center gap-2 text-text-medium">
                                                <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: color }} />
                                                <span>{label}</span>
                                            </div>
                                        ))}
                                    </div>
                                </div>

                                <div className="bg-card rounded-[24px] border border-border p-5">
                                    <div className="text-text-light font-semibold mb-2">Wallet inspector</div>
                                    {selectedNode ? (
                                        <div className="space-y-3 text-sm">
                                            <div className="font-mono text-text-light break-all">{selectedNode.walletAddress}</div>
                                            <div className="grid grid-cols-2 gap-3">
                                                <div className="rounded-xl border border-border bg-card-hover/20 p-3">
                                                    <div className="text-[10px] uppercase tracking-wide text-text-medium mb-1">Role</div>
                                                    <div className="text-text-light font-semibold capitalize">{selectedNode.role.replace('_', ' ')}</div>
                                                </div>
                                                <div className="rounded-xl border border-border bg-card-hover/20 p-3">
                                                    <div className="text-[10px] uppercase tracking-wide text-text-medium mb-1">Supply share</div>
                                                    <div className="text-text-light font-semibold">{formatPct(selectedNode.currentHoldingsPct)}</div>
                                                </div>
                                            </div>
                                            <div className="rounded-xl border border-border bg-card-hover/20 p-3">
                                                <div className="text-[10px] uppercase tracking-wide text-text-medium mb-1">Current holdings</div>
                                                <div className="text-text-light font-semibold">{formatTokenAmount(selectedNode.currentHoldingsTokens, tokenDecimals)}</div>
                                            </div>
                                            <div className="text-text-medium leading-relaxed">{selectedNode.flagReason}</div>
                                            <div className="rounded-xl border border-border bg-card-hover/10 p-3">
                                                <div className="text-[10px] uppercase tracking-wide text-text-medium mb-1">Cluster context</div>
                                                <div className="text-text-light text-sm">
                                                    {selectedCluster
                                                        ? `${selectedCluster.clusterName} controls ${formatPct(selectedCluster.supplyHeldPct)} across ${selectedCluster.walletCount} wallets.`
                                                        : 'This wallet is visible in the graph but is not part of a confirmed cluster core.'}
                                                </div>
                                            </div>
                                        </div>
                                    ) : (
                                        <div className="text-sm text-text-medium">Select a node to inspect it.</div>
                                    )}
                                </div>

                                <div className="bg-card rounded-[24px] border border-border p-5">
                                    <div className="text-text-light font-semibold mb-3">Connected wallets</div>
                                    {selectedConnections.length ? (
                                        <div className="space-y-2.5">
                                            {selectedConnections.slice(0, 8).map((edge) => {
                                                const peer = edge.sourceWallet === selectedNode?.walletAddress ? edge.targetWallet : edge.sourceWallet;
                                                return (
                                                    <button
                                                        key={edge.edgeId}
                                                        type="button"
                                                        className="w-full text-left px-3.5 py-3 rounded-2xl border border-border bg-card-hover/20 hover:bg-card-hover/40 transition-colors"
                                                        onClick={() => setSelectedWallet(peer)}
                                                    >
                                                        <div className="flex items-center justify-between gap-3">
                                                            <div>
                                                                <div className="text-text-light font-mono text-sm">{shortenAddress(peer)}</div>
                                                                <div className="text-text-medium text-xs mt-1">{edge.displayLabel}</div>
                                                            </div>
                                                            <span className="text-[10px] uppercase tracking-wide text-text-medium">{edge.relationshipType}</span>
                                                        </div>
                                                    </button>
                                                );
                                            })}
                                        </div>
                                    ) : (
                                        <div className="text-sm text-text-medium">No visible graph links for the selected wallet.</div>
                                    )}
                                </div>
                            </div>
                        </div>
            </section>
        ) : null}

        {isSupported && !loading && !error && report ? (
            <section className="bg-card-hover/10 border border-border rounded-2xl p-6 min-w-0">
                            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-5">
                                <div>
                                    <div className="text-[10px] uppercase tracking-[0.22em] font-bold text-primary-green mb-2">
                                        Confirmed Coordinated Clusters
                                    </div>
                                    <h4 className="font-bold text-lg text-text-light">Cluster intelligence table</h4>
                                </div>
                                <div className="rounded-2xl border border-border bg-card px-4 py-3 text-sm">
                                    <div className="text-text-medium">Clusters found</div>
                                    <div className="text-text-light font-extrabold text-xl">{report.walletClusters.length}</div>
                                </div>
                            </div>
                            {report.walletClusters.length ? (
                                <div className="rounded-[24px] border border-border overflow-hidden bg-[linear-gradient(180deg,rgba(12,17,22,0.98),rgba(10,16,21,0.96))]">
                                    <div className="hidden lg:block border-b border-border bg-white/[0.02]">
                                        <div className="grid w-max min-w-full grid-cols-[240px_88px_110px_260px_110px_84px] gap-0 px-4 py-3">
                                            <div className="pr-4 text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400">Cluster</div>
                                            <div className="px-3 text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400 text-right">Wallets</div>
                                            <div className="px-3 text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400 text-right">Supply Held</div>
                                            <div className="px-3 text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400 text-right">Combined Balance</div>
                                            <div className="px-3 text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400 text-center">Risk</div>
                                            <div className="pl-3 text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400 text-right">Action</div>
                                        </div>
                                    </div>
                                    {report.walletClusters.map((cluster) => {
                                        const expanded = !!expandedClusters[cluster.clusterId];
                                        return (
                                            <div key={cluster.clusterId} className="border-t border-border first:border-t-0">
                                                <div
                                                    className="hidden lg:grid lg:w-max lg:min-w-full lg:grid-cols-[240px_88px_110px_260px_110px_84px] gap-0 px-4 py-3.5 items-center hover:bg-white/[0.02] transition-colors cursor-pointer"
                                                    onClick={() => toggleCluster(cluster.clusterId)}
                                                    role="button"
                                                    tabIndex={0}
                                                    onKeyDown={(event) => {
                                                        if (event.key === 'Enter' || event.key === ' ') {
                                                            event.preventDefault();
                                                            toggleCluster(cluster.clusterId);
                                                        }
                                                    }}
                                                >
                                                    <div className="min-w-0 pr-4">
                                                        <div className="text-[14px] text-text-light font-semibold truncate leading-tight">{cluster.clusterName}</div>
                                                        <div className="text-[11px] text-text-medium mt-1 uppercase tracking-[0.16em] leading-tight">{cluster.userEvidenceLabel}</div>
                                                    </div>
                                                    <div className="px-3 text-right text-[14px] text-text-light font-semibold">{cluster.walletCount}</div>
                                                    <div className="px-3 text-right text-[14px] text-text-light font-semibold">{formatPct(cluster.supplyHeldPct)}</div>
                                                    <div className="px-3 text-right">
                                                        <div className="text-[14px] text-text-light font-semibold leading-tight">{formatTokenAmount(cluster.supplyHeldTokens, tokenDecimals)}</div>
                                                    </div>
                                                    <div className="px-3 text-center">
                                                        <span className={`inline-flex min-w-[76px] justify-center px-1.5 py-1 rounded-md text-[9px] font-bold uppercase tracking-wide ${tierTone(cluster.evidenceTier)}`}>
                                                            {tierRiskLabel(cluster.evidenceTier)}
                                                        </span>
                                                    </div>
                                                    <div className="pl-3 text-right">
                                                        <button
                                                            type="button"
                                                            className="text-primary-green font-semibold text-[13px] hover:text-text-light transition-colors"
                                                            onClick={(event) => {
                                                                event.stopPropagation();
                                                                toggleCluster(cluster.clusterId);
                                                            }}
                                                        >
                                                            {expanded ? 'Close' : 'Inspect'}
                                                        </button>
                                                    </div>
                                                </div>

                                                <div
                                                    className="lg:hidden px-5 py-4 hover:bg-white/[0.02] transition-colors cursor-pointer"
                                                    onClick={() => toggleCluster(cluster.clusterId)}
                                                    role="button"
                                                    tabIndex={0}
                                                    onKeyDown={(event) => {
                                                        if (event.key === 'Enter' || event.key === ' ') {
                                                            event.preventDefault();
                                                            toggleCluster(cluster.clusterId);
                                                        }
                                                    }}
                                                >
                                                    <div className="flex items-start justify-between gap-3 mb-4">
                                                        <div className="min-w-0">
                                                            <div className="text-text-light font-semibold">{cluster.clusterName}</div>
                                                            <div className="text-xs text-text-medium mt-1 uppercase tracking-[0.14em]">{cluster.userEvidenceLabel}</div>
                                                        </div>
                                                        <button
                                                            type="button"
                                                            className="text-primary-green font-semibold text-sm hover:text-text-light transition-colors"
                                                            onClick={(event) => {
                                                                event.stopPropagation();
                                                                toggleCluster(cluster.clusterId);
                                                            }}
                                                        >
                                                            {expanded ? 'Close' : 'Inspect'}
                                                        </button>
                                                    </div>
                                                    <div className="grid grid-cols-3 gap-2.5">
                                                        <div className="rounded-xl border border-border bg-card px-3 py-2.5">
                                                            <div className="text-[10px] uppercase tracking-[0.16em] text-slate-400 mb-1">Wallets</div>
                                                            <div className="text-text-light font-bold">{cluster.walletCount}</div>
                                                        </div>
                                                        <div className="rounded-xl border border-border bg-card px-3 py-2.5">
                                                            <div className="text-[10px] uppercase tracking-[0.16em] text-slate-400 mb-1">Supply Held</div>
                                                            <div className="text-text-light font-bold">{formatPct(cluster.supplyHeldPct)}</div>
                                                        </div>
                                                        <div className="rounded-xl border border-border bg-card px-3 py-2.5">
                                                            <div className="text-[10px] uppercase tracking-[0.16em] text-slate-400 mb-1">Risk</div>
                                                            <span className={`inline-flex min-w-0 w-full justify-center px-2 py-1 rounded-md text-[9px] font-bold uppercase tracking-wide ${tierTone(cluster.evidenceTier)}`}>
                                                                {tierRiskLabel(cluster.evidenceTier)}
                                                            </span>
                                                        </div>
                                                        <div className="rounded-xl border border-border bg-card px-3 py-2.5 col-span-3">
                                                            <div className="text-[10px] uppercase tracking-[0.16em] text-slate-400 mb-1">Combined Balance</div>
                                                            <div className="text-text-light font-bold">{formatTokenAmount(cluster.supplyHeldTokens, tokenDecimals)}</div>
                                                        </div>
                                                    </div>
                                                </div>

                                                {expanded ? (
                                                    <div className="border-t border-border bg-[#0B1218] px-3 py-3 sm:px-4 sm:py-4">
                                                        <div className="overflow-x-auto">
                                                            <table className="w-full min-w-[430px] sm:min-w-[560px] lg:min-w-[720px] table-fixed text-[12px] sm:text-[13px] lg:text-sm">
                                                                <colgroup>
                                                                    <col className="w-[110px] sm:w-[140px] lg:w-[180px]" />
                                                                    <col className="w-[78px] sm:w-[96px] lg:w-[120px]" />
                                                                    <col className="w-[112px] sm:w-[150px] lg:w-[190px]" />
                                                                    <col />
                                                                </colgroup>
                                                                <thead>
                                                                    <tr className="text-left text-text-medium border-b border-border">
                                                                        <th className="pb-2.5 pr-2 sm:pr-3 lg:pr-4 text-[11px] sm:text-[12px] font-semibold">Wallet</th>
                                                                        <th className="pb-2.5 px-2 sm:px-3 lg:px-4 text-[11px] sm:text-[12px] font-semibold text-right">Supply share</th>
                                                                        <th className="pb-2.5 px-2 sm:px-3 lg:px-4 text-[11px] sm:text-[12px] font-semibold text-right">Current holdings</th>
                                                                        <th className="pb-2.5 pl-2 sm:pl-3 lg:pl-4 text-[11px] sm:text-[12px] font-semibold">Why flagged</th>
                                                                    </tr>
                                                                </thead>
                                                                <tbody>
                                                                    {cluster.walletDetails.slice(0, 8).map((wallet) => (
                                                                        <tr key={wallet.walletAddress} className="border-b border-border last:border-0">
                                                                            <td className="py-2.5 pr-2 sm:pr-3 lg:pr-4 text-text-light font-mono text-[11px] sm:text-[12px] lg:text-[13px] whitespace-nowrap">{shortenAddress(wallet.walletAddress)}</td>
                                                                            <td className="py-2.5 px-2 sm:px-3 lg:px-4 text-text-light text-[11px] sm:text-[12px] lg:text-[13px] text-right whitespace-nowrap">{formatPct(wallet.currentHoldingsPct)}</td>
                                                                            <td className="py-2.5 px-2 sm:px-3 lg:px-4 text-text-light text-[11px] sm:text-[12px] lg:text-[13px] text-right whitespace-nowrap">{formatTokenAmount(wallet.currentHoldingsTokens, tokenDecimals)}</td>
                                                                            <td className="py-2.5 pl-2 sm:pl-3 lg:pl-4 text-text-medium text-[11px] sm:text-[12px] lg:text-[13px] leading-relaxed align-top">{wallet.flagReason}</td>
                                                                        </tr>
                                                                    ))}
                                                                </tbody>
                                                            </table>
                                                        </div>
                                                    </div>
                                                ) : null}
                                            </div>
                                        );
                                    })}
                                </div>
                            ) : (
                                <p className="text-sm text-text-medium">
                                    No confirmed coordinated clusters were emitted for this sampled launch window.
                                </p>
                            )}
                    </section>
        ) : null}
        </div>
    );
};
