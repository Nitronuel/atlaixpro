import React, { useEffect, useMemo, useRef, useState } from 'react';
import { forceCenter, forceCollide, forceLink, forceManyBody, forceSimulation, forceX, forceY } from 'd3-force';
import {
    Copy,
    GitBranch,
    Info,
    Loader2,
    Lock,
    Network,
    Radar,
    Search,
    Shield,
    ShieldAlert,
    Users,
    Wallet,
    XCircle
} from 'lucide-react';
import {
    getInsightXNetworkLabel,
    INSIGHTX_NETWORKS,
    isLikelyInsightXAddress,
    SafefyScanService,
    type InsightXBundlers,
    type InsightXEndpointResult,
    type InsightXInsiders,
    type InsightXLabel,
    type InsightXNetwork,
    type InsightXOverview,
    type InsightXScannerResponse,
    type InsightXSnipers,
    type InsightXWalletEntry,
    type DetectedTokenNetwork,
    type LiveTokenLiquidity,
    type SafefyScanReport
} from '../services/SafefyScanService';

const formatNumber = (value: unknown, fallback = 'N/A') => {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return fallback;
    return new Intl.NumberFormat('en-US', { maximumFractionDigits: numeric >= 100 ? 0 : 2 }).format(numeric);
};

const formatPct = (value: unknown, fallback = 'N/A') => {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return fallback;
    const normalized = numeric > 0 && numeric <= 1 ? numeric * 100 : numeric;
    return `${normalized.toFixed(normalized >= 10 ? 1 : 2)}%`;
};

const formatPercent = (value: number, fallback = 'N/A') => {
    if (!Number.isFinite(value)) return fallback;
    return `${value.toFixed(value >= 10 ? 1 : 2)}%`;
};

const formatCompact = (value: unknown) => {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return 'N/A';
    return new Intl.NumberFormat('en-US', {
        notation: 'compact',
        maximumFractionDigits: 2
    }).format(numeric);
};

const formatCurrencyCompact = (value: unknown) => {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return 'N/A';
    return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
        notation: 'compact',
        maximumFractionDigits: numeric >= 100 ? 2 : 4
    }).format(numeric);
};

const shortenAddress = (value = '') => {
    if (!value) return 'N/A';
    return value.length > 14 ? `${value.slice(0, 6)}...${value.slice(-5)}` : value;
};

const toDate = (value: unknown) => {
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric <= 0) return 'Unknown';
    const ms = numeric < 10_000_000_000 ? numeric * 1000 : numeric;
    return new Date(ms).toLocaleString();
};

const formatAgeOrDate = (value: unknown) => {
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric <= 0) return 'Unknown';

    const ageSeconds = numeric >= 1_000_000_000
        ? Math.max(0, (Date.now() - (numeric < 10_000_000_000 ? numeric * 1000 : numeric)) / 1000)
        : numeric;

    const days = Math.floor(ageSeconds / 86400);
    if (days >= 1) return `${formatNumber(days)}d`;
    const hours = Math.floor(ageSeconds / 3600);
    if (hours >= 1) return `${formatNumber(hours)}h`;
    const minutes = Math.floor(ageSeconds / 60);
    return minutes >= 1 ? `${formatNumber(minutes)}m` : `${formatNumber(ageSeconds)}s`;
};

const endpointTone = (status: InsightXEndpointResult['status']) => {
    if (status === 'available') return 'border-primary-green/25 bg-primary-green/10 text-primary-green';
    if (status === 'unsupported' || status === 'missing') return 'border-primary-yellow/30 bg-primary-yellow/10 text-[#8A6A00]';
    return 'border-primary-red/25 bg-primary-red/10 text-primary-red';
};

const riskTone = (score: number | null) => {
    if (score === null) return 'border-border bg-card-hover text-text-medium';
    if (score >= 80) return 'border-primary-green/25 bg-primary-green/10 text-primary-green';
    if (score >= 55) return 'border-primary-yellow/30 bg-primary-yellow/10 text-[#8A6A00]';
    return 'border-primary-red/25 bg-primary-red/10 text-primary-red';
};

const riskLabel = (score: number | null) => {
    if (score === null) return 'Unknown';
    if (score >= 80) return 'Lower Risk';
    if (score >= 55) return 'Watch Closely';
    return 'High Risk';
};

const getDrainRiskPenalty = (clusterBalance: number | null, liquidity: LiveTokenLiquidity | null) => {
    const liquidityDepth = Number(liquidity?.tokenLiquidity);
    if (clusterBalance === null || !Number.isFinite(liquidityDepth) || liquidityDepth <= 0) return 0;

    const liquidityShare = (clusterBalance / liquidityDepth) * 100;
    if (liquidityShare >= 500) return 12;
    if (liquidityShare >= 250) return 9;
    if (liquidityShare >= 100) return 6;
    if (liquidityShare >= 50) return 3;
    return 0;
};

const Card: React.FC<{ children: React.ReactNode; className?: string }> = ({ children, className = '' }) => (
    <section className={`rounded-[24px] border border-border bg-card p-5 shadow-sm ${className}`}>
        {children}
    </section>
);

const SectionHeader: React.FC<{ icon: React.ReactNode; title: string; eyebrow?: string; action?: React.ReactNode }> = ({ icon, title, eyebrow, action }) => (
    <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-primary-green/20 bg-primary-green/10 text-primary-green">
                {icon}
            </span>
            <div className="min-w-0">
                {eyebrow ? <div className="text-[11px] font-black uppercase tracking-[0.18em] text-text-dark">{eyebrow}</div> : null}
                <h2 className="truncate text-lg font-black text-text-light">{title}</h2>
            </div>
        </div>
        {action}
    </div>
);

const EmptyBlock: React.FC<{ title: string; body: string }> = ({ title, body }) => (
    <div className="rounded-2xl border border-dashed border-border bg-card-hover/40 p-5 text-sm text-text-medium">
        <div className="mb-1 font-black text-text-light">{title}</div>
        {body}
    </div>
);

const StatusPill: React.FC<{ result?: InsightXEndpointResult; label?: string }> = ({ result, label }) => (
    <span className={`rounded-full border px-3 py-1 text-[11px] font-black uppercase tracking-[0.12em] ${endpointTone(result?.status || 'missing')}`}>
        {label || result?.status?.replace('_', ' ') || 'missing'}
    </span>
);

const MetricCard: React.FC<{ label: string; value: React.ReactNode; detail?: React.ReactNode; tone?: string }> = ({ label, value, detail, tone = 'text-text-light' }) => (
    <div className="rounded-2xl border border-border bg-card-hover/45 p-4">
        <div className="mb-2 text-[11px] font-black uppercase tracking-[0.16em] text-text-dark">{label}</div>
        <div className={`text-2xl font-black ${tone}`}>{value}</div>
        {detail ? <div className="mt-2 text-sm font-semibold text-text-medium">{detail}</div> : null}
    </div>
);

const getEndpointData = <T,>(result?: InsightXEndpointResult<T>) => result?.status === 'available' ? result.data : null;

const getWalletAddressValue = (entry: any) => {
    if (typeof entry === 'string') return entry.trim();
    return String(entry?.address ?? entry?.wallet ?? entry?.owner ?? entry?.account ?? '').trim();
};

const getBalanceValue = (entry: any) => Number(entry?.balance ?? entry?.amount ?? entry?.token_balance);

const getSupplyPercentField = (entry: any) => entry?.percentage ?? entry?.pct ?? entry?.supply_pct ?? entry?.total_pct;

const formatReportedSupplyPercent = (value: unknown, fallback = 'N/A') => {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? formatPercent(numeric) : fallback;
};

const normalizePercentValue = (value: unknown) => {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return null;
    return numeric > 0 && numeric <= 1 ? numeric * 100 : numeric;
};

const formatSupplyShare = (entry: any, totalSupply?: number | null) => {
    const balance = getBalanceValue(entry);
    const supply = Number(totalSupply);
    if (Number.isFinite(balance) && Number.isFinite(supply) && supply > 0) {
        return formatPercent((balance / supply) * 100);
    }
    return formatReportedSupplyPercent(getSupplyPercentField(entry));
};

const getClusterSupplyBalance = (cluster: any) => {
    const directBalance = Number(
        cluster?.balance
        ?? cluster?.amount
        ?? cluster?.token_balance
        ?? cluster?.total_balance
        ?? cluster?.cluster_balance
        ?? cluster?.supply_balance
    );
    if (Number.isFinite(directBalance) && directBalance > 0) return directBalance;

    const members = getClusterMembers(cluster);
    const summedBalance = members.reduce((total: number, member: any) => {
        const balance = getBalanceValue(member);
        return Number.isFinite(balance) && balance > 0 ? total + balance : total;
    }, 0);
    return summedBalance > 0 ? summedBalance : null;
};

const formatClusterSupplyShare = (cluster: any, totalSupply?: number | null) => {
    const balance = getClusterSupplyBalance(cluster);
    const supply = Number(totalSupply);
    if (balance !== null && Number.isFinite(supply) && supply > 0) {
        return formatPercent((balance / supply) * 100);
    }
    return formatReportedSupplyPercent(getSupplyPercentField(cluster));
};

const formatWalletGroupSupplyShare = (rows: InsightXWalletEntry[], totalSupply?: number | null, fallback?: unknown) => {
    const supply = Number(totalSupply);
    if (Number.isFinite(supply) && supply > 0) {
        const balance = rows.reduce((total, row) => {
            const value = getBalanceValue(row);
            return Number.isFinite(value) && value > 0 ? total + value : total;
        }, 0);

        if (balance > 0 || rows.length > 0) {
            return formatPercent((balance / supply) * 100);
        }
    }

    return formatReportedSupplyPercent(fallback);
};

const getWalletGroupSupplyBalance = (rows: InsightXWalletEntry[], totalSupply?: number | null, fallback?: unknown) => {
    const balance = rows.reduce((total, row) => {
        const value = getBalanceValue(row);
        return Number.isFinite(value) && value > 0 ? total + value : total;
    }, 0);
    if (balance > 0) return balance;

    const supply = Number(totalSupply);
    const fallbackPercent = normalizePercentValue(fallback);
    if (Number.isFinite(supply) && supply > 0 && fallbackPercent !== null) {
        return (supply * fallbackPercent) / 100;
    }

    return null;
};

const formatCreatorSupplyShare = (scanner: InsightXScannerResponse | null, fallback?: unknown) => {
    const creatorBalance = Number(scanner?.results?.advanced?.creator?.balance);
    const totalSupply = Number(scanner?.token?.total_supply);
    if (Number.isFinite(creatorBalance) && creatorBalance >= 0 && Number.isFinite(totalSupply) && totalSupply > 0) {
        return formatPercent((creatorBalance / totalSupply) * 100);
    }

    return formatReportedSupplyPercent(fallback);
};

const collectClusterList = (data: any) => {
    if (!data) return [];
    if (Array.isArray(data)) return data;
    if (Array.isArray(data.clusters)) return data.clusters;
    if (Array.isArray(data.data)) return data.data;
    return [];
};

const getClusterMembers = (cluster: any) => Array.isArray(cluster?.members)
    ? cluster.members
    : Array.isArray(cluster?.wallets)
        ? cluster.wallets
        : Array.isArray(cluster?.cluster_addresses)
            ? cluster.cluster_addresses
            : Array.isArray(cluster?.addresses)
                ? cluster.addresses
                : Array.isArray(cluster?.holders)
                    ? cluster.holders
                    : [];

const getMemberAddress = (member: any) => String(member?.address || member?.wallet || member || '').toLowerCase();

const getTotalClusterSupplyBalance = (clusters: any, totalSupply?: number | null, fallback?: unknown) => {
    const seen = new Set<string>();
    const totalBalance = collectClusterList(clusters).reduce((clusterTotal: number, cluster: any) => {
        const members = getClusterMembers(cluster);
        const memberTotal = members.reduce((memberSum: number, member: any) => {
            const address = getWalletAddressValue(member).toLowerCase();
            if (address && seen.has(address)) return memberSum;
            if (address) seen.add(address);

            const balance = getBalanceValue(member);
            return Number.isFinite(balance) && balance > 0 ? memberSum + balance : memberSum;
        }, 0);

        if (memberTotal > 0) return clusterTotal + memberTotal;

        const clusterBalance = getClusterSupplyBalance(cluster);
        return clusterBalance !== null ? clusterTotal + clusterBalance : clusterTotal;
    }, 0);

    if (totalBalance > 0) return totalBalance;

    const supply = Number(totalSupply);
    const fallbackPercent = normalizePercentValue(fallback);
    if (Number.isFinite(supply) && supply > 0 && fallbackPercent !== null) {
        return (supply * fallbackPercent) / 100;
    }

    return null;
};

const formatTotalClusterSupplyShare = (clusters: any, totalSupply?: number | null, fallback?: unknown) => {
    const supply = Number(totalSupply);
    if (Number.isFinite(supply) && supply > 0) {
        const totalBalance = getTotalClusterSupplyBalance(clusters);
        if (totalBalance > 0) {
            return formatPercent((totalBalance / supply) * 100);
        }
    }

    return formatReportedSupplyPercent(fallback);
};

const labelMapFrom = (labels: InsightXLabel[] | null) => {
    const map = new Map<string, InsightXLabel>();
    (labels || []).forEach((label) => map.set(label.address.toLowerCase(), label));
    return map;
};

const collectLabels = (data: unknown): InsightXLabel[] => {
    if (Array.isArray(data)) return data as InsightXLabel[];
    const payload = data as any;
    if (Array.isArray(payload?.labels)) return payload.labels;
    if (Array.isArray(payload?.data)) return payload.data;
    if (Array.isArray(payload?.items)) return payload.items;
    return [];
};

const uniqueWalletRows = (rows: InsightXWalletEntry[] = []) => {
    const byAddress = new Map<string, InsightXWalletEntry>();

    rows.forEach((row) => {
        const address = getWalletAddressValue(row);
        if (!address) {
            return;
        }

        const key = address.toLowerCase();
        const existing = byAddress.get(key);
        if (!existing) {
            byAddress.set(key, { ...row, address });
            return;
        }

        const existingBalance = getBalanceValue(existing);
        const nextBalance = getBalanceValue(row);
        const base = Number.isFinite(nextBalance) && (!Number.isFinite(existingBalance) || nextBalance > existingBalance)
            ? { ...existing, ...row, address }
            : { ...row, ...existing, address };
        byAddress.set(key, {
            ...base,
            reasons: [...new Set([...(existing.reasons || []), ...(row.reasons || [])])],
            tags: [...new Set([...(existing.tags || []), ...(row.tags || [])])]
        });
    });

    return [...byAddress.values()];
};

const enrichWalletRows = (rows: InsightXWalletEntry[] = [], labels: Map<string, InsightXLabel>) =>
    uniqueWalletRows(rows).map((row) => {
        const address = getWalletAddressValue(row);
        const label = address ? labels.get(address.toLowerCase()) : undefined;
        return {
            ...row,
            address: address || row.address,
            label: label?.label || row.label,
            tags: label?.tags || row.tags,
            smart_contract: label?.smart_contract ?? row.smart_contract
        };
    });

const atlasPalette = ['#B02CFF', '#18C8FF', '#F97316', '#FFE600', '#12D69E', '#EF4BFF', '#6F8CFF', '#FF4FA3'];

const hashString = (value: string) => value.split('').reduce((hash, char) => ((hash << 5) - hash + char.charCodeAt(0)) | 0, 0);

const hexToRgba = (hex: string, alpha: number) => {
    const normalized = hex.replace('#', '');
    const value = normalized.length === 3
        ? normalized.split('').map((char) => `${char}${char}`).join('')
        : normalized;
    const parsed = Number.parseInt(value, 16);
    if (!Number.isFinite(parsed)) return `rgba(109,127,168,${alpha})`;
    const r = (parsed >> 16) & 255;
    const g = (parsed >> 8) & 255;
    const b = parsed & 255;
    return `rgba(${r},${g},${b},${alpha})`;
};

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

const ATLAS_MIN_ZOOM = 0.25;
const ATLAS_MAX_ZOOM = 4.2;

const atlasNodeFill = (node: any) => node.clustered
    ? hexToRgba(node.color, 0.48)
    : 'url(#atlas-muted-bubble)';

const atlasNodeStroke = (node: any, active: boolean) => {
    if (active) return '#FFFFFF';
    return node.clustered ? node.color : '#556889';
};

const atlasNodeGlow = (node: any, active: boolean, muted: boolean) => {
    if (muted) return 0.015;
    if (active) return 0.24;
    return node.clustered ? 0.09 : 0.045;
};

const readAtlasHolders = (atlas: any) => {
    const source = Array.isArray(atlas?.holders)
        ? atlas.holders
        : Array.isArray(atlas?.nodes)
            ? atlas.nodes
            : Array.isArray(atlas?.graph?.nodes)
                ? atlas.graph.nodes
                : [];

    return source.map((holder: any, index: number) => ({
        ...holder,
        id: Number.isFinite(Number(holder?.id)) ? Number(holder.id) : index,
        rank: index + 1,
        address: String(holder?.address || holder?.wallet || holder?.id || index),
        tags: Array.isArray(holder?.tags) ? holder.tags.filter(Boolean) : [],
        label: holder?.label || holder?.name || null
    }));
};

const readAtlasLinks = (atlas: any) => {
    const directLinks = Array.isArray(atlas?.links)
        ? atlas.links
        : Array.isArray(atlas?.edges)
            ? atlas.edges
            : Array.isArray(atlas?.graph?.links)
                ? atlas.graph.links
                : [];
    const relationshipLinks = Array.isArray(atlas?.relationships)
        ? atlas.relationships.flatMap((relationship: any) =>
            Array.isArray(relationship?.links)
                ? relationship.links.map((link: any) => ({ ...link, assetSymbol: relationship?.symbol, assetName: relationship?.name }))
                : []
        )
        : [];

    return [...directLinks, ...relationshipLinks].map((link: any, index: number) => ({
        ...link,
        id: `${link?.source ?? link?.from}-${link?.target ?? link?.to}-${index}`,
        source: Number(link?.source ?? link?.from),
        target: Number(link?.target ?? link?.to),
        strength: Number(link?.forward || 0) + Number(link?.backward || 0) || 1,
        bidirectional: Number(link?.forward || 0) > 0 && Number(link?.backward || 0) > 0
    })).filter((link: any) => Number.isFinite(link.source) && Number.isFinite(link.target));
};

const buildAtlasLayout = (holders: any[], links: any[]) => {
    const visibleHolders = holders.slice(0, 250);
    if (!visibleHolders.length) {
        return {
            nodes: [],
            links: [],
            allLinks: [],
            components: [],
            topComponents: [],
            bounds: null
        };
    }
    const visibleIds = new Set(visibleHolders.map((holder) => holder.id));
    const visibleLinks = links.filter((link) => visibleIds.has(link.source) && visibleIds.has(link.target)).slice(0, 1200);
    const parent = new Map<number, number>();
    const degree = new Map<number, number>();

    visibleHolders.forEach((holder) => parent.set(holder.id, holder.id));

    const find = (id: number): number => {
        const current = parent.get(id) ?? id;
        if (current === id) return id;
        const root = find(current);
        parent.set(id, root);
        return root;
    };

    const join = (left: number, right: number) => {
        const leftRoot = find(left);
        const rightRoot = find(right);
        if (leftRoot !== rightRoot) parent.set(rightRoot, leftRoot);
    };

    visibleLinks.forEach((link) => {
        join(link.source, link.target);
        degree.set(link.source, (degree.get(link.source) ?? 0) + link.strength);
        degree.set(link.target, (degree.get(link.target) ?? 0) + link.strength);
    });

    const componentMembers = new Map<number, any[]>();
    visibleHolders.forEach((holder) => {
        const root = find(holder.id);
        const members = componentMembers.get(root) ?? [];
        members.push(holder);
        componentMembers.set(root, members);
    });

    const components = [...componentMembers.entries()]
        .map(([root, members]) => ({ root, members, size: members.length, totalDegree: members.reduce((sum, holder) => sum + (degree.get(holder.id) ?? 0), 0) }))
        .sort((left, right) => (right.size + right.totalDegree * 0.2) - (left.size + left.totalDegree * 0.2));
    const componentRank = new Map(components.map((component, index) => [component.root, index]));
    const componentColor = (root: number) => {
        const rank = componentRank.get(root) ?? 0;
        const size = componentMembers.get(root)?.length ?? 1;
        if (size <= 1) return '#6D7FA8';
        return atlasPalette[rank % atlasPalette.length];
    };

    const clusterCenters = new Map<number, { x: number; y: number }>();
    components.forEach((component, index) => {
        if (component.size <= 1) return null;
        if (index === 0) {
            clusterCenters.set(component.root, { x: 660, y: 360 });
            return null;
        }
        const angle = -0.78 + index * 1.12;
        const radius = index < 6 ? 285 : 390;
        clusterCenters.set(component.root, {
            x: 650 + Math.cos(angle) * radius,
            y: 390 + Math.sin(angle) * radius * 0.74
        });
        return null;
    });

    const positioned = visibleHolders.map((holder, index) => {
        const root = find(holder.id);
        const component = componentMembers.get(root) ?? [holder];
        const rank = componentRank.get(root) ?? 0;
        const isClustered = component.length > 1;
        const seed = Math.abs(hashString(`${holder.address}:${holder.id}`));
        const holderDegree = degree.get(holder.id) ?? 0;
        const contract = holder.tags.some((tag: string) => /contract|pair|exchange|lp/i.test(tag));
        const rankRadius = 18 - Math.sqrt(holder.rank) * 0.62;
        const nodeRadius = clamp(rankRadius + Math.sqrt(holderDegree) * 0.5 + (contract ? 4 : 0), 5.4, contract ? 24 : 21);
        const center = isClustered ? clusterCenters.get(root) ?? { x: 650, y: 390 } : { x: 650, y: 390 };
        const localIndex = component.findIndex((entry) => entry.id === holder.id);
        const angle = isClustered
            ? (localIndex / Math.max(component.length, 1)) * Math.PI * 2 + (seed % 90) / 100
            : (index / Math.max(visibleHolders.length, 1)) * Math.PI * 2 + (seed % 90) / 100;
        const orbit = isClustered
            ? Math.max(48, Math.sqrt(component.length) * 16 + (seed % 55))
            : 300 + (seed % 230);
        return {
            ...holder,
            x: center.x + Math.cos(angle) * orbit,
            y: center.y + Math.sin(angle) * orbit * 0.7,
            radius: nodeRadius,
            color: componentColor(root),
            componentRoot: root,
            visualGroup: `${root}:${rank}`,
            clustered: isClustered,
            degree: holderDegree
        };
    });

    const simulationLinks = visibleLinks.map((link) => ({ source: link.source, target: link.target, strength: link.strength }));
    const simulation = forceSimulation(positioned as any[])
        .force('link', forceLink(simulationLinks).id((node: any) => node.id).distance((link: any) => {
            const source = link.source as any;
            const target = link.target as any;
            const sameComponent = source.componentRoot === target.componentRoot;
            return sameComponent ? 54 + Math.max(source.radius, target.radius) * 0.7 : 112;
        }).strength((link: any) => {
            const source = link.source as any;
            const target = link.target as any;
            return source.componentRoot === target.componentRoot ? 0.055 : 0.018;
        }))
        .force('charge', forceManyBody().strength((node: any) => node.clustered ? -38 - node.radius * 4.5 : -64 - node.radius * 5.2))
        .force('collide', forceCollide((node: any) => node.radius + (node.clustered ? 9 : 11)).strength(1).iterations(5))
        .force('x', forceX((node: any) => (clusterCenters.get(node.componentRoot)?.x ?? 650)).strength((node: any) => node.clustered ? 0.045 : 0.018))
        .force('y', forceY((node: any) => (clusterCenters.get(node.componentRoot)?.y ?? 390)).strength((node: any) => node.clustered ? 0.045 : 0.018))
        .force('center', forceCenter(650, 390))
        .stop();

    for (let index = 0; index < 360; index += 1) {
        simulation.tick();
    }

    const bounds = positioned.reduce((acc, node) => ({
        minX: Math.min(acc.minX, node.x - node.radius),
        maxX: Math.max(acc.maxX, node.x + node.radius),
        minY: Math.min(acc.minY, node.y - node.radius),
        maxY: Math.max(acc.maxY, node.y + node.radius)
    }), { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity });
    const nodeById = new Map(positioned.map((node) => [node.id, node]));
    const allRenderLinks = visibleLinks
        .map((link) => ({ ...link, sourceNode: nodeById.get(link.source), targetNode: nodeById.get(link.target) }))
        .filter((link) => link.sourceNode && link.targetNode);

    return {
        nodes: positioned,
        links: allRenderLinks,
        allLinks: allRenderLinks,
        components,
        topComponents: components.filter((component) => component.size > 1).slice(0, 8),
        bounds
    };
};

const getAtlasFitView = (nodes: any[], bounds: any, viewportWidth = 1200, viewportHeight = 760) => {
    if (!nodes.length || !bounds) return { scale: 1, x: 0, y: 0 };

    const graphWidth = Math.max(1, bounds.maxX - bounds.minX);
    const graphHeight = Math.max(1, bounds.maxY - bounds.minY);
    const usableWidth = Math.max(760, viewportWidth - 170);
    const usableHeight = Math.max(560, viewportHeight - 140);
    const fitScale = clamp(Math.min(usableWidth / graphWidth, usableHeight / graphHeight), 0.55, 1.35);
    const focusNodes = nodes.filter((node: any) => node.degree > 0 || node.clustered || node.rank <= 25);
    const centerNodes = focusNodes.length >= 6 ? focusNodes : nodes;
    const totalWeight = centerNodes.reduce((sum: number, node: any) => sum + Math.max(1, node.degree) + node.radius * 0.4 + (node.rank <= 25 ? 3 : 0), 0);
    const focusX = centerNodes.reduce((sum: number, node: any) => sum + node.x * (Math.max(1, node.degree) + node.radius * 0.4 + (node.rank <= 25 ? 3 : 0)), 0) / totalWeight;
    const focusY = centerNodes.reduce((sum: number, node: any) => sum + node.y * (Math.max(1, node.degree) + node.radius * 0.4 + (node.rank <= 25 ? 3 : 0)), 0) / totalWeight;

    return {
        scale: fitScale,
        x: (viewportWidth / 2) / fitScale - focusX,
        y: (viewportHeight / 2) / fitScale - focusY
    };
};

const buildAtlasVisualGroups = (clusters: any) => {
    const groupByAddress = new Map<string, { key: string; color: string; index: number; size: number }>();
    collectClusterList(clusters).forEach((cluster: any, index) => {
        const members = getClusterMembers(cluster);
        const color = atlasPalette[index % atlasPalette.length];
        const key = String(cluster?.id || cluster?.cluster_id || cluster?.name || cluster?.tag || `cluster-${index + 1}`);
        members.forEach((member: any) => {
            const address = getMemberAddress(member);
            if (address) {
                groupByAddress.set(address, { key, color, index, size: members.length });
            }
        });
    });
    return groupByAddress;
};

const getLockedLiquidityRows = (scanner: InsightXScannerResponse | null) => {
    const advanced = scanner?.results?.advanced || {};
    const liquidity = Array.isArray(advanced.locked_liquidity) ? advanced.locked_liquidity : [];
    return liquidity
        .map((pool: any) => {
            const lockPct = Number(pool?.total_locked);
            const lock = Array.isArray(pool?.locks)
                ? pool.locks.find((item: any) => Number(item?.percentage) > 0)
                : null;
            return {
                dex: String(pool?.dex || 'Liquidity pool'),
                pair: String(pool?.pair_address || ''),
                lockedValue: Number.isFinite(lockPct) && lockPct > 0 ? formatPct(lockPct) : lock ? formatPct(lock.percentage) : '',
                lockType: lock?.type ? String(lock.type) : ''
            };
        })
        .filter((pool) => pool.lockedValue || pool.pair)
        .sort((a, b) => {
            const aLocked = Number.parseFloat(a.lockedValue.replace('%', '')) || 0;
            const bLocked = Number.parseFloat(b.lockedValue.replace('%', '')) || 0;
            return bLocked - aLocked;
        });
};

const LiquidityLockSummary: React.FC<{ scanner: InsightXScannerResponse | null }> = ({ scanner }) => {
    const rows = getLockedLiquidityRows(scanner).filter((row) => row.lockedValue);

    return (
        <div className="rounded-2xl border border-border bg-card-hover/45 p-4">
            <div className="mb-3 flex items-center gap-2">
                <Lock size={16} className="text-primary-green" />
                <div className="text-[11px] font-black uppercase tracking-[0.16em] text-text-dark">Liquidity pool lock</div>
            </div>
            {rows.length ? (
                <div className="grid gap-2">
                    {rows.slice(0, 3).map((row, index) => (
                        <div key={`${row.pair}-${index}`} className="flex items-center justify-between gap-3 rounded-xl border border-border bg-card px-3 py-3">
                            <div className="min-w-0">
                                <div className="truncate text-sm font-black text-text-light">{row.dex}</div>
                                <div className="mt-1 truncate font-mono text-xs text-text-medium">{shortenAddress(row.pair)}</div>
                            </div>
                            <div className="text-right">
                                <div className="text-lg font-black text-primary-green">{row.lockedValue}</div>
                                {row.lockType ? <div className="text-[10px] font-black uppercase text-text-dark">{row.lockType}</div> : null}
                            </div>
                        </div>
                    ))}
                </div>
            ) : (
                <div className="text-sm font-semibold leading-6 text-text-medium">
                    No locked liquidity pool was reported for this token.
                </div>
            )}
        </div>
    );
};

const drainRiskTone = (value: number | null) => {
    if (value === null) return 'border-border bg-card-hover/45 text-text-light';
    if (value >= 100) return 'border-primary-red/30 bg-primary-red/10 text-primary-red';
    if (value >= 50) return 'border-[#F59E0B]/30 bg-[#F59E0B]/10 text-[#B45309]';
    return 'border-primary-green/25 bg-primary-green/10 text-primary-green';
};

const drainRiskLabel = (value: number | null) => {
    if (value === null) return 'Liquidity unavailable';
    if (value >= 100) return 'Cluster supply can exceed live liquidity';
    if (value >= 50) return 'High liquidity pressure';
    return 'Below live liquidity';
};

const DrainRiskSummary: React.FC<{
    clusterBalance: number | null;
    totalSupply?: number | null;
    liquidity: LiveTokenLiquidity | null;
    loading: boolean;
    error: string | null;
    className?: string;
}> = ({ clusterBalance, totalSupply, liquidity, loading, error, className = '' }) => {
    const liquidityDepth = liquidity?.tokenLiquidity ?? null;
    const clusterSupplyShare = clusterBalance !== null && Number(totalSupply) > 0
        ? (clusterBalance / Number(totalSupply)) * 100
        : null;
    const clusterValueUsd = clusterBalance !== null && liquidity?.tokenPriceUsd
        ? clusterBalance * liquidity.tokenPriceUsd
        : null;
    const liquidityValueUsd = liquidity?.liquidityUsd ?? null;
    const liquidityShare = clusterBalance !== null && liquidityDepth !== null && liquidityDepth > 0
        ? (clusterBalance / liquidityDepth) * 100
        : null;
    const tone = drainRiskTone(liquidityShare);

    return (
        <div className={`rounded-2xl border p-4 ${tone} ${className}`}>
            <div className="mb-3 flex items-center justify-between gap-3">
                <div>
                    <div className="text-[11px] font-black uppercase tracking-[0.16em]">Drain risk</div>
                    <div className="mt-1 text-sm font-bold">{drainRiskLabel(liquidityShare)}</div>
                </div>
                {loading ? <Loader2 size={18} className="shrink-0 animate-spin" /> : null}
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
                <div>
                    <div className="text-[10px] font-black uppercase tracking-[0.14em] opacity-70">Cluster held supply</div>
                    <div className="mt-1 text-lg font-black text-text-light">{formatCurrencyCompact(clusterValueUsd)}</div>
                    <div className="mt-1 text-xs font-black text-text-medium">{clusterSupplyShare !== null ? `${formatPercent(clusterSupplyShare)} of supply` : 'N/A of supply'}</div>
                </div>
                <div>
                    <div className="text-[10px] font-black uppercase tracking-[0.14em] opacity-70">Live liquidity</div>
                    <div className="mt-1 text-lg font-black text-text-light">{formatCurrencyCompact(liquidityValueUsd)}</div>
                </div>
                <div>
                    <div className="text-[10px] font-black uppercase tracking-[0.14em] opacity-70">Liquidity held</div>
                    <div className="mt-1 text-lg font-black text-text-light">{liquidityShare !== null ? formatPercent(liquidityShare) : 'N/A'}</div>
                </div>
            </div>
            {error || loading || !liquidity ? (
                <div className="mt-3 text-xs font-semibold leading-5 text-text-medium">
                    {error || (loading ? 'Checking live pool depth...' : 'No live token-side liquidity was found for this token.')}
                </div>
            ) : null}
        </div>
    );
};

const WalletTable: React.FC<{ rows: InsightXWalletEntry[]; empty: string; totalSupply?: number | null }> = ({ rows, empty, totalSupply }) => {
    if (!rows.length) {
        return <EmptyBlock title="No wallet rows" body={empty} />;
    }

    return (
        <div className="overflow-x-auto">
            <table className="w-full min-w-[680px] text-left text-sm">
                <thead>
                    <tr className="border-b border-border text-[11px] font-black uppercase tracking-[0.14em] text-text-dark">
                        <th className="py-3 pr-4">Wallet</th>
                        <th className="py-3 pr-4">Label</th>
                        <th className="py-3 pr-4">Balance</th>
                        <th className="py-3 pr-4">Supply</th>
                        <th className="py-3">Evidence</th>
                    </tr>
                </thead>
                <tbody className="divide-y divide-border/70">
                    {rows.slice(0, 12).map((row, index) => (
                        <tr key={`${row.address || index}-${index}`} className="align-top">
                            <td className="py-3 pr-4 font-mono text-xs font-bold text-text-light">{shortenAddress(row.address)}</td>
                            <td className="py-3 pr-4">
                                <div className="font-bold text-text-light">{row.label || (row.smart_contract ? 'Smart contract' : 'Unlabeled')}</div>
                                {row.tags?.length ? <div className="mt-1 text-xs text-text-medium">{row.tags.slice(0, 3).join(', ')}</div> : null}
                            </td>
                            <td className="py-3 pr-4 font-semibold text-text-medium">{formatCompact(row.balance)}</td>
                            <td className="py-3 pr-4 font-black text-text-light">{formatSupplyShare(row, totalSupply)}</td>
                            <td className="py-3 text-xs text-text-medium">{row.reasons?.length ? row.reasons.join(', ') : row.slot ? `Slot ${row.slot}` : 'Detected relationship'}</td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
};

const ScannerPanel: React.FC<{ scanner: InsightXScannerResponse | null; result?: InsightXEndpointResult<InsightXScannerResponse> }> = ({ scanner, result }) => {
    const advanced = scanner?.results?.advanced || {};
    const simple = scanner?.results?.simple;
    const securityTone = (state: 'safe' | 'risk' | 'unknown') => {
        if (state === 'safe') return 'border-primary-green/20 bg-primary-green/10 text-primary-green';
        if (state === 'risk') return 'border-primary-red/25 bg-primary-red/10 text-primary-red';
        return 'border-border bg-card text-text-medium';
    };
    const booleanFlag = (value: unknown, safeWhen: boolean) => {
        if (value === true) return { label: 'Yes', state: safeWhen ? 'safe' : 'risk' } as const;
        if (value === false) return { label: 'No', state: safeWhen ? 'risk' : 'safe' } as const;
        return { label: 'Unknown', state: 'unknown' } as const;
    };
    const honeypotScore = Number(advanced.honeypot?.score);
    const honeypotFlag = Number.isFinite(honeypotScore)
        ? { label: advanced.honeypot?.message || `Score ${honeypotScore}`, state: honeypotScore <= 0 ? 'safe' : 'risk' } as const
        : { label: advanced.honeypot?.message || 'Unknown', state: 'unknown' } as const;
    const taxValue = advanced.tax
        ? advanced.tax.pct !== undefined
            ? formatPct(advanced.tax.pct)
            : `Buy ${formatPct(advanced.tax.buy)} / Sell ${formatPct(advanced.tax.sell)}`
        : 'Unknown';
    const taxNumeric = Number(advanced.tax?.pct ?? advanced.tax?.buy ?? advanced.tax?.sell);
    const flags = [
        ['Honeypot', honeypotFlag.label, honeypotFlag.state],
        ['Renounced', booleanFlag(advanced.renounced, true).label, booleanFlag(advanced.renounced, true).state],
        ['Mintable', advanced.mintable === true ? 'Enabled' : advanced.mintable === false ? 'Disabled' : 'Unknown', advanced.mintable === false ? 'safe' : advanced.mintable === true ? 'risk' : 'unknown'],
        ['Freezable', booleanFlag(advanced.freezable, false).label, booleanFlag(advanced.freezable, false).state],
        ['Drainable', booleanFlag(advanced.drainable, false).label, booleanFlag(advanced.drainable, false).state],
        ['Pausable', booleanFlag(advanced.pausable, false).label, booleanFlag(advanced.pausable, false).state],
        ['Verified', booleanFlag(advanced.verified, true).label, booleanFlag(advanced.verified, true).state],
        ['Proxy contract', booleanFlag(advanced.proxy_contract, false).label, booleanFlag(advanced.proxy_contract, false).state],
        ['Tax', taxValue, Number.isFinite(taxNumeric) ? taxNumeric <= 10 ? 'safe' : 'risk' : 'unknown']
    ];

    return (
        <Card>
            <SectionHeader icon={<Shield size={19} />} title="Security Scanner" eyebrow="Contract checks" action={<StatusPill result={result} />} />
            {!scanner ? (
                <EmptyBlock title="Scanner unavailable" body={result?.error || 'No scanner report was returned for this token.'} />
            ) : (
                <div className="space-y-4">
                    {simple?.reasons?.length ? (
                        <div className="rounded-2xl border border-border bg-card-hover/40 p-4">
                            <div className="mb-3 text-[11px] font-black uppercase tracking-[0.16em] text-text-dark">Score reasons</div>
                            <div className="grid gap-2">
                                {simple.reasons.slice(0, 6).map((reason) => (
                                    <div key={reason} className="flex gap-2 text-sm font-semibold text-text-medium">
                                        <Info size={16} className="mt-0.5 shrink-0 text-primary-green" />
                                        <span>{reason}</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    ) : null}
                    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                        {flags.map(([label, value, state]) => (
                            <div key={String(label)} className="flex items-center justify-between gap-3 rounded-xl border border-border bg-card-hover/35 px-3 py-3">
                                <span className="min-w-0 truncate text-sm font-bold text-text-medium">{label}</span>
                                <span className={`shrink-0 rounded-full border px-2.5 py-1 text-[10px] font-black uppercase ${securityTone(state as 'safe' | 'risk' | 'unknown')}`}>
                                    {String(value)}
                                </span>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </Card>
    );
};

const ManipulationPanel: React.FC<{
    overview: InsightXOverview | null;
    snipers: InsightXSnipers | null;
    bundlers: InsightXBundlers | null;
    insiders: InsightXInsiders | null;
    labels: Map<string, InsightXLabel>;
    totalSupply?: number | null;
    tokenPriceUsd?: number | null;
}> = ({ overview, snipers, bundlers, insiders, labels, totalSupply, tokenPriceUsd }) => {
    const sniperRows = enrichWalletRows(snipers?.snipers || [], labels);
    const bundlerRows = enrichWalletRows(bundlers?.bundlers || [], labels);
    const insiderRows = enrichWalletRows(insiders?.insiders || [], labels);
    const [tab, setTab] = useState<'bundlers' | 'snipers' | 'insiders'>('bundlers');
    const rows = tab === 'bundlers' ? bundlerRows : tab === 'snipers' ? sniperRows : insiderRows;
    const bundlerSupply = formatWalletGroupSupplyShare(bundlerRows, totalSupply, bundlers?.total_bundlers_pct ?? overview?.bundlers_pct);
    const sniperSupply = formatWalletGroupSupplyShare(sniperRows, totalSupply, snipers?.total_sniper_pct ?? overview?.snipers_pct);
    const insiderSupply = formatWalletGroupSupplyShare(insiderRows, totalSupply, insiders?.total_insiders_pct ?? overview?.insiders_pct);
    const priceUsd = Number(tokenPriceUsd);
    const usdValue = (balance: number | null) => balance !== null && Number.isFinite(priceUsd) && priceUsd > 0
        ? formatCurrencyCompact(balance * priceUsd)
        : 'N/A';
    const bundlerUsd = usdValue(getWalletGroupSupplyBalance(bundlerRows, totalSupply, bundlers?.total_bundlers_pct ?? overview?.bundlers_pct));
    const sniperUsd = usdValue(getWalletGroupSupplyBalance(sniperRows, totalSupply, snipers?.total_sniper_pct ?? overview?.snipers_pct));
    const insiderUsd = usdValue(getWalletGroupSupplyBalance(insiderRows, totalSupply, insiders?.total_insiders_pct ?? overview?.insiders_pct));

    return (
        <Card>
            <SectionHeader icon={<Radar size={19} />} title="Launch Manipulation Intelligence" eyebrow="Bundlers, snipers, insiders" />
            <div className="mb-5 grid gap-3 md:grid-cols-3">
                <MetricCard label="Bundlers" value={<><div>{bundlerSupply}</div><div className="mt-1 text-base font-black text-text-medium">{bundlerUsd}</div></>} detail={`${formatNumber(bundlerRows.length)} wallet interaction`} />
                <MetricCard label="Snipers" value={<><div>{sniperSupply}</div><div className="mt-1 text-base font-black text-text-medium">{sniperUsd}</div></>} detail={`${formatNumber(sniperRows.length)} wallet interaction`} />
                <MetricCard label="Insiders" value={<><div>{insiderSupply}</div><div className="mt-1 text-base font-black text-text-medium">{insiderUsd}</div></>} detail={`${formatNumber(insiderRows.length)} wallet interaction`} />
            </div>
            <div className="mb-4 flex flex-wrap gap-2">
                {(['bundlers', 'snipers', 'insiders'] as const).map((item) => (
                    <button
                        key={item}
                        type="button"
                        onClick={() => setTab(item)}
                        className={`min-h-11 rounded-full border px-4 text-sm font-black capitalize transition-colors ${tab === item ? 'border-primary-green bg-primary-green text-main' : 'border-border bg-card-hover text-text-medium hover:text-text-light'}`}
                    >
                        {item}
                    </button>
                ))}
            </div>
            <WalletTable rows={rows} empty="This endpoint returned no detailed wallets or is unsupported for the selected network." totalSupply={totalSupply} />
        </Card>
    );
};

const ClusterPanel: React.FC<{ clusters: any; labels: Map<string, InsightXLabel>; totalSupply?: number | null }> = ({ clusters, labels, totalSupply }) => {
    const clusterList = collectClusterList(clusters);
    const [expandedCluster, setExpandedCluster] = useState<string | null>(null);
    const getClusterKey = (cluster: any, index: number) => String(cluster?.id || cluster?.cluster_id || cluster?.name || cluster?.tag || index);
    const clusterTags = (cluster: any) => Array.isArray(cluster?.tags)
        ? cluster.tags.filter(Boolean).join(', ')
        : cluster?.type || cluster?.reason || 'Relationship cluster';
    return (
        <Card>
            <SectionHeader icon={<GitBranch size={19} />} title="Cluster Explorer" eyebrow="Related holder groups" />
            {!clusterList.length ? (
                <EmptyBlock title="No clusters returned" body="No cluster groups were returned for this token, or no related holders were detected." />
            ) : (
                <div>
                    <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                        <div>
                            <div className="text-[11px] font-black uppercase tracking-[0.18em] text-primary-green">Detected holder clusters</div>
                            <div className="mt-1 text-sm font-semibold text-text-medium">Click Inspect to reveal the wallets inside a holder group.</div>
                        </div>
                        <div className="rounded-2xl border border-border bg-card-hover px-4 py-3 text-sm">
                            <div className="text-text-medium">Clusters found</div>
                            <div className="text-xl font-black text-text-light">{formatNumber(clusterList.length)}</div>
                        </div>
                    </div>

                    <div className="overflow-hidden rounded-[24px] border border-border bg-card-hover/25">
                        <div className="hidden border-b border-border bg-card-hover/50 lg:block">
                            <div className="grid min-w-full grid-cols-[minmax(260px,1.4fr)_110px_130px_minmax(220px,1fr)_100px] px-5 py-3">
                                <div className="text-[11px] font-black uppercase tracking-[0.16em] text-text-dark">Cluster</div>
                                <div className="text-right text-[11px] font-black uppercase tracking-[0.16em] text-text-dark">Wallets</div>
                                <div className="text-right text-[11px] font-black uppercase tracking-[0.16em] text-text-dark">Supply held</div>
                                <div className="text-right text-[11px] font-black uppercase tracking-[0.16em] text-text-dark">Evidence</div>
                                <div className="text-right text-[11px] font-black uppercase tracking-[0.16em] text-text-dark">Action</div>
                            </div>
                        </div>

                        {clusterList.slice(0, 24).map((cluster: any, index) => {
                            const clusterKey = getClusterKey(cluster, index);
                            const expanded = expandedCluster === clusterKey;
                            const members = getClusterMembers(cluster);
                            return (
                                <div key={clusterKey} className="border-t border-border first:border-t-0">
                                    <div
                                        className={`hidden cursor-pointer grid-cols-[minmax(260px,1.4fr)_110px_130px_minmax(220px,1fr)_100px] items-center px-5 py-4 transition-colors lg:grid ${expanded ? 'bg-primary-green/5' : 'hover:bg-card-hover/45'}`}
                                        role="button"
                                        tabIndex={0}
                                        onClick={() => setExpandedCluster(expanded ? null : clusterKey)}
                                        onKeyDown={(event) => {
                                            if (event.key === 'Enter' || event.key === ' ') {
                                                event.preventDefault();
                                                setExpandedCluster(expanded ? null : clusterKey);
                                            }
                                        }}
                                    >
                                        <div className="min-w-0 pr-4">
                                            <div className="truncate text-base font-black text-text-light">{cluster?.name || cluster?.tag || `Cluster ${index + 1}`}</div>
                                            <div className="mt-1 truncate text-xs font-semibold uppercase tracking-[0.14em] text-text-medium">{clusterTags(cluster)}</div>
                                        </div>
                                        <div className="px-3 text-right text-sm font-black text-text-light">{formatNumber(members.length)}</div>
                                        <div className="px-3 text-right text-sm font-black text-primary-green">{formatClusterSupplyShare(cluster, totalSupply)}</div>
                                        <div className="truncate px-3 text-right text-xs font-semibold text-text-medium">{clusterTags(cluster)}</div>
                                        <div className="pl-3 text-right">
                                            <button
                                                type="button"
                                                onClick={(event) => {
                                                    event.stopPropagation();
                                                    setExpandedCluster(expanded ? null : clusterKey);
                                                }}
                                                className="text-sm font-black text-primary-green transition-colors hover:text-primary-green-darker"
                                            >
                                                {expanded ? 'Close' : 'Inspect'}
                                            </button>
                                        </div>
                                    </div>

                                    <div
                                        className={`cursor-pointer px-5 py-4 transition-colors lg:hidden ${expanded ? 'bg-primary-green/5' : 'hover:bg-card-hover/45'}`}
                                        role="button"
                                        tabIndex={0}
                                        onClick={() => setExpandedCluster(expanded ? null : clusterKey)}
                                        onKeyDown={(event) => {
                                            if (event.key === 'Enter' || event.key === ' ') {
                                                event.preventDefault();
                                                setExpandedCluster(expanded ? null : clusterKey);
                                            }
                                        }}
                                    >
                                        <div className="mb-4 flex items-start justify-between gap-3">
                                            <div className="min-w-0">
                                                <div className="truncate text-base font-black text-text-light">{cluster?.name || cluster?.tag || `Cluster ${index + 1}`}</div>
                                                <div className="mt-1 truncate text-xs font-semibold uppercase tracking-[0.14em] text-text-medium">{clusterTags(cluster)}</div>
                                            </div>
                                            <button
                                                type="button"
                                                onClick={(event) => {
                                                    event.stopPropagation();
                                                    setExpandedCluster(expanded ? null : clusterKey);
                                                }}
                                                className="text-sm font-black text-primary-green"
                                            >
                                                {expanded ? 'Close' : 'Inspect'}
                                            </button>
                                        </div>
                                        <div className="grid grid-cols-3 gap-2">
                                            <div className="rounded-xl border border-border bg-card px-3 py-2">
                                                <div className="text-[10px] font-black uppercase tracking-[0.14em] text-text-dark">Wallets</div>
                                                <div className="mt-1 font-black text-text-light">{formatNumber(members.length)}</div>
                                            </div>
                                            <div className="rounded-xl border border-border bg-card px-3 py-2">
                                                <div className="text-[10px] font-black uppercase tracking-[0.14em] text-text-dark">Supply</div>
                                                <div className="mt-1 font-black text-primary-green">{formatClusterSupplyShare(cluster, totalSupply)}</div>
                                            </div>
                                            <div className="rounded-xl border border-border bg-card px-3 py-2">
                                                <div className="text-[10px] font-black uppercase tracking-[0.14em] text-text-dark">Rank</div>
                                                <div className="mt-1 font-black text-text-light">#{index + 1}</div>
                                            </div>
                                        </div>
                                    </div>

                                    {expanded ? (
                                        <div className="border-t border-border bg-card/60 px-4 py-4">
                                            {!members.length ? (
                                                <EmptyBlock title="No wallets in this cluster" body="The cluster summary did not include wallet members for this group." />
                                            ) : (
                                                <div className="overflow-x-auto">
                                                    <table className="w-full min-w-[720px] text-left text-sm">
                                                        <thead>
                                                            <tr className="border-b border-border text-[11px] font-black uppercase tracking-[0.14em] text-text-dark">
                                                                <th className="py-3 pr-4">Wallet</th>
                                                                <th className="py-3 pr-4">Label</th>
                                                                <th className="py-3 pr-4 text-right">Balance</th>
                                                                <th className="py-3 pr-4 text-right">Supply</th>
                                                                <th className="py-3">Evidence</th>
                                                            </tr>
                                                        </thead>
                                                        <tbody className="divide-y divide-border/70">
                                                            {members.slice(0, 40).map((member: any, memberIndex: number) => {
                                                                const address = String(member?.address || member?.wallet || member || '');
                                                                const label = labels.get(address.toLowerCase());
                                                                const evidence = Array.isArray(member?.reasons)
                                                                    ? member.reasons.join(', ')
                                                                    : Array.isArray(member?.tags)
                                                                        ? member.tags.join(', ')
                                                                        : member?.type || member?.role || member?.reason || clusterTags(cluster);
                                                                return (
                                                                    <tr key={`${address}-${memberIndex}`} className="align-top">
                                                                        <td className="py-3 pr-4">
                                                                            <button
                                                                                type="button"
                                                                                onClick={() => navigator.clipboard?.writeText(address)}
                                                                                className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-2 font-mono text-xs font-bold text-text-light transition-colors hover:border-primary-green/30 hover:text-primary-green"
                                                                            >
                                                                                {shortenAddress(address)}
                                                                                <Copy size={13} />
                                                                            </button>
                                                                        </td>
                                                                        <td className="py-3 pr-4">
                                                                            <div className="font-bold text-text-light">{label?.label || member?.label || (label?.smart_contract || member?.smart_contract ? 'Smart contract' : 'Unlabeled')}</div>
                                                                            {(label?.tags || member?.tags)?.length ? <div className="mt-1 text-xs text-text-medium">{(label?.tags || member?.tags).slice(0, 3).join(', ')}</div> : null}
                                                                        </td>
                                                                        <td className="py-3 pr-4 text-right font-semibold text-text-medium">{formatCompact(member?.balance ?? member?.amount ?? member?.token_balance)}</td>
                                                                        <td className="py-3 pr-4 text-right font-black text-text-light">{formatSupplyShare(member, totalSupply)}</td>
                                                                        <td className="py-3 text-xs leading-5 text-text-medium">{evidence}</td>
                                                                    </tr>
                                                                );
                                                            })}
                                                        </tbody>
                                                    </table>
                                                </div>
                                            )}
                                        </div>
                                    ) : null}
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}
        </Card>
    );
};

const LiquidityAndHoldersPanel: React.FC<{ scanner: InsightXScannerResponse | null; labels: Map<string, InsightXLabel> }> = ({ scanner, labels }) => {
    const advanced = scanner?.results?.advanced || {};
    const holders = Array.isArray(advanced.top_holders) ? advanced.top_holders : [];
    return (
        <Card>
            <SectionHeader icon={<Users size={19} />} title="Top Holders" eyebrow="Largest balances" />
            {!holders.length ? (
                <EmptyBlock title="No holder rows" body="No top holder details were returned for this scan." />
            ) : (
                <WalletTable rows={enrichWalletRows(holders, labels)} empty="No top holders returned." totalSupply={scanner?.token?.total_supply} />
            )}
        </Card>
    );
};

const AtlasPanel: React.FC<{ atlas: any; timestamps: unknown; clusters: any }> = ({ atlas, timestamps, clusters }) => {
    const holders = useMemo(() => readAtlasHolders(atlas), [atlas]);
    const links = useMemo(() => readAtlasLinks(atlas), [atlas]);
    const layout = useMemo(() => buildAtlasLayout(holders, links), [holders, links]);
    const visualGroups = useMemo(() => buildAtlasVisualGroups(clusters), [clusters]);
    const hasRelatedGroups = visualGroups.size > 0;
    const chartRef = useRef<HTMLDivElement | null>(null);
    const [chartSize, setChartSize] = useState({ width: 1200, height: 760 });
    const [selectedNodeId, setSelectedNodeId] = useState<number | null>(null);
    const [atlasView, setAtlasView] = useState({ scale: 1, x: 0, y: 0 });
    const [dragStart, setDragStart] = useState<{ pointerId: number; x: number; y: number; viewX: number; viewY: number } | null>(null);
    const [hoveredNodeId, setHoveredNodeId] = useState<number | null>(null);
    const [addressSearch, setAddressSearch] = useState('');
    const displayNodes = useMemo(() => layout.nodes.map((node: any) => {
        const visualGroup = visualGroups.get(node.address.toLowerCase());
        return visualGroup
            ? {
                ...node,
                color: visualGroup.color,
                visualGroup: visualGroup.key,
                visualGroupIndex: visualGroup.index,
                visualGroupSize: visualGroup.size,
                atlasComponentRoot: node.componentRoot,
                clustered: true
            }
            : {
                ...node,
                color: hasRelatedGroups ? '#6D7FA8' : node.color,
                visualGroup: hasRelatedGroups ? `atlas-context-${node.id}` : node.visualGroup,
                visualGroupIndex: null,
                visualGroupSize: hasRelatedGroups ? 1 : node.clustered ? layout.nodes.filter((entry: any) => entry.componentRoot === node.componentRoot).length : 1,
                clustered: hasRelatedGroups ? false : node.clustered
            };
    }), [hasRelatedGroups, layout.nodes, visualGroups]);
    const displayNodeById = useMemo(() => new Map(displayNodes.map((node: any) => [node.id, node])), [displayNodes]);
    const selectedNode = displayNodes.find((node) => node.id === selectedNodeId) ?? null;
    const hoveredNode = displayNodes.find((node) => node.id === hoveredNodeId) ?? null;
    const activeNode = selectedNode ?? hoveredNode;
    const activeNeighborIds = useMemo(() => {
        if (!activeNode) return new Set<number>();
        const next = new Set<number>([activeNode.id]);
        layout.links.forEach((link: any) => {
            if (link.source === activeNode.id) next.add(link.target);
            if (link.target === activeNode.id) next.add(link.source);
        });
        return next;
    }, [activeNode, layout.links]);
    const timestampList = Array.isArray(timestamps) ? timestamps : Array.isArray((timestamps as any)?.timestamps) ? (timestamps as any).timestamps : [];
    const snapshotTime = atlas?.snapshot?.timestamp || atlas?.snapshot?.created_at;
    const tokenLabel = [atlas?.token?.symbol, atlas?.network?.name].filter(Boolean).join(' on ');
    const filteredNodes = useMemo(() => {
        const query = addressSearch.trim().toLowerCase();
        if (!query) return displayNodes;
        return displayNodes.filter((node) =>
            node.address.toLowerCase().includes(query)
            || String(node.label || '').toLowerCase().includes(query)
            || node.tags.join(' ').toLowerCase().includes(query)
        );
    }, [addressSearch, displayNodes]);
    const visualClusterCount = hasRelatedGroups
        ? new Set(displayNodes.filter((node: any) => node.visualGroupIndex !== null).map((node: any) => node.visualGroup)).size
        : layout.topComponents.length;
    const atlasViewport = useMemo(() => {
        const height = 760;
        const width = clamp((chartSize.width / Math.max(chartSize.height, 1)) * height, 900, 1400);
        return { width, height };
    }, [chartSize.height, chartSize.width]);
    const fitView = useMemo(
        () => getAtlasFitView(displayNodes, layout.bounds, atlasViewport.width, atlasViewport.height),
        [atlasViewport.height, atlasViewport.width, displayNodes, layout.bounds]
    );

    useEffect(() => {
        const chart = chartRef.current;
        if (!chart) return undefined;

        const updateSize = () => {
            setChartSize({
                width: Math.max(1, chart.clientWidth),
                height: Math.max(1, chart.clientHeight)
            });
        };
        updateSize();

        if (typeof ResizeObserver === 'undefined') return undefined;
        const observer = new ResizeObserver(updateSize);
        observer.observe(chart);
        return () => observer.disconnect();
    }, []);

    useEffect(() => {
        setAtlasView(fitView);
        setSelectedNodeId(null);
        setHoveredNodeId(null);
    }, [fitView.scale, fitView.x, fitView.y]);

    const setZoom = (nextScale: number) => {
        setAtlasView((current) => ({
            ...current,
            scale: Math.max(ATLAS_MIN_ZOOM, Math.min(ATLAS_MAX_ZOOM, nextScale))
        }));
    };

    useEffect(() => {
        const chart = chartRef.current;
        if (!chart || !layout.nodes.length) return undefined;

        const handleWheel = (event: WheelEvent) => {
            event.preventDefault();

            const rect = chart.getBoundingClientRect();
            const pointerX = ((event.clientX - rect.left) / Math.max(rect.width, 1)) * atlasViewport.width;
            const pointerY = ((event.clientY - rect.top) / Math.max(rect.height, 1)) * atlasViewport.height;
            const zoomFactor = event.deltaY > 0 ? 0.9 : 1.1;

            setAtlasView((current) => {
                const nextScale = Math.max(ATLAS_MIN_ZOOM, Math.min(ATLAS_MAX_ZOOM, current.scale * zoomFactor));
                const worldX = (pointerX - current.x) / current.scale;
                const worldY = (pointerY - current.y) / current.scale;

                return {
                    scale: nextScale,
                    x: pointerX - worldX * nextScale,
                    y: pointerY - worldY * nextScale
                };
            });
        };

        chart.addEventListener('wheel', handleWheel, { passive: false });
        return () => chart.removeEventListener('wheel', handleWheel);
    }, [atlasViewport.height, atlasViewport.width, layout.nodes.length]);

    const resetAtlasView = () => {
        setAtlasView(fitView);
        setSelectedNodeId(null);
        setHoveredNodeId(null);
    };

    return (
        <Card>
            <SectionHeader
                icon={<Network size={19} />}
                title="Holder's Graph"
                eyebrow={tokenLabel || 'Snapshots and relationships'}
                action={snapshotTime ? <span className="rounded-full border border-border bg-card-hover px-3 py-1.5 text-xs font-bold text-text-medium">Snapshot {toDate(snapshotTime)}</span> : null}
            />
            <div className="grid gap-5 2xl:grid-cols-[minmax(0,1fr)_430px]">
                <div ref={chartRef} className="relative min-h-[720px] overflow-hidden rounded-2xl border border-[#2A3144] bg-[#030611] shadow-[inset_0_0_80px_rgba(15,23,42,0.92)]">
                    {layout.nodes.length ? (
                        <>
                            <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_40%,rgba(54,72,112,0.23),transparent_45%),radial-gradient(circle_at_20%_80%,rgba(176,44,255,0.12),transparent_28%),linear-gradient(180deg,rgba(255,255,255,0.03),transparent_30%)]" />
                            <div className="absolute left-4 top-4 z-10 flex flex-wrap items-center gap-2">
                                <span className="rounded-xl border border-white/10 bg-[#151827]/88 px-3 py-2 text-xs font-black text-text-light shadow-lg backdrop-blur">
                                    Top {formatNumber(layout.nodes.length)} holders
                                </span>
                                <span className="rounded-xl border border-white/10 bg-[#151827]/88 px-3 py-2 text-xs font-black text-text-medium shadow-lg backdrop-blur">
                                    {formatNumber(visualClusterCount)} clusters
                                </span>
                                <span className="rounded-xl border border-white/10 bg-[#151827]/88 px-3 py-2 text-xs font-black text-text-medium shadow-lg backdrop-blur">
                                    {formatNumber(layout.links.length)} links
                                </span>
                                <span className="rounded-xl border border-white/10 bg-[#151827]/88 px-3 py-2 text-xs font-black text-text-medium shadow-lg backdrop-blur">
                                    {Math.round(atlasView.scale * 100)}%
                                </span>
                            </div>
                            <div className="absolute right-4 top-1/2 z-10 flex -translate-y-1/2 flex-col overflow-hidden rounded-2xl border border-white/30 bg-[#151827]/95 shadow-xl backdrop-blur">
                                <button type="button" onClick={() => setZoom(atlasView.scale * 1.18)} className="grid h-11 w-11 place-items-center border-b border-white/20 text-xl font-black text-white transition-colors hover:bg-white/18 hover:text-white" aria-label="Zoom in">+</button>
                                <button type="button" onClick={() => setZoom(atlasView.scale / 1.18)} className="grid h-11 w-11 place-items-center border-b border-white/20 text-xl font-black text-white transition-colors hover:bg-white/18 hover:text-white" aria-label="Zoom out">-</button>
                                <button type="button" onClick={resetAtlasView} className="grid h-11 w-11 place-items-center text-[10px] font-black uppercase text-white transition-colors hover:bg-white/18 hover:text-white" aria-label="Reset map view">Fit</button>
                            </div>
                            <svg
                                viewBox={`0 0 ${atlasViewport.width} ${atlasViewport.height}`}
                                className={`relative z-[1] h-full min-h-[720px] w-full ${dragStart ? 'cursor-grabbing' : 'cursor-grab'}`}
                                role="img"
                                aria-label="Atlas wallet relationship bubble map"
                                style={{ touchAction: 'none' }}
                                onClick={() => setSelectedNodeId(null)}
                                onPointerDown={(event) => {
                                    event.currentTarget.setPointerCapture(event.pointerId);
                                    setDragStart({ pointerId: event.pointerId, x: event.clientX, y: event.clientY, viewX: atlasView.x, viewY: atlasView.y });
                                }}
                                onPointerMove={(event) => {
                                    if (!dragStart || dragStart.pointerId !== event.pointerId) return;
                                    setAtlasView((current) => ({
                                        ...current,
                                        x: dragStart.viewX + (event.clientX - dragStart.x) / current.scale,
                                        y: dragStart.viewY + (event.clientY - dragStart.y) / current.scale
                                    }));
                                }}
                                onPointerUp={(event) => {
                                    if (dragStart?.pointerId === event.pointerId) setDragStart(null);
                                }}
                                onPointerCancel={() => setDragStart(null)}
                            >
                                <defs>
                                    <filter id="atlas-node-glow" x="-60%" y="-60%" width="220%" height="220%">
                                        <feGaussianBlur stdDeviation="4.5" result="blur" />
                                        <feMerge>
                                            <feMergeNode in="blur" />
                                            <feMergeNode in="SourceGraphic" />
                                        </feMerge>
                                    </filter>
                                    <radialGradient id="atlas-muted-bubble" cx="35%" cy="25%" r="70%">
                                        <stop offset="0%" stopColor="#D6E5FF" stopOpacity="0.48" />
                                        <stop offset="55%" stopColor="#4C5F89" stopOpacity="0.34" />
                                        <stop offset="100%" stopColor="#172036" stopOpacity="0.76" />
                                    </radialGradient>
                                </defs>
                                <g transform={`translate(${atlasView.x} ${atlasView.y}) scale(${atlasView.scale})`}>
                                    <g>
                                    {layout.links.map((link: any) => {
                                        const source = displayNodeById.get(link.source) ?? link.sourceNode;
                                        const target = displayNodeById.get(link.target) ?? link.targetNode;
                                        const active = activeNode ? source.id === activeNode.id || target.id === activeNode.id : false;
                                        const related = activeNode ? source.visualGroup === activeNode.visualGroup && target.visualGroup === activeNode.visualGroup : false;
                                        const muted = activeNode && !active && !related;
                                        const midX = (source.x + target.x) / 2;
                                        const midY = (source.y + target.y) / 2 - Math.min(34, Math.abs(source.x - target.x) * 0.06);
                                        return (
                                            <path
                                                key={link.id}
                                                d={`M ${source.x.toFixed(1)} ${source.y.toFixed(1)} Q ${midX.toFixed(1)} ${midY.toFixed(1)} ${target.x.toFixed(1)} ${target.y.toFixed(1)}`}
                                                fill="none"
                                                stroke={active ? '#F8FAFC' : '#D8E2F4'}
                                                strokeOpacity={muted ? 0.08 : active ? 0.82 : related ? 0.42 : 0.28}
                                                strokeWidth={active ? 1.75 : Math.min(1.45, 0.5 + link.strength * 0.18)}
                                                strokeLinecap="round"
                                            />
                                        );
                                    })}
                                    </g>
                                    <g>
                                    {displayNodes.map((node: any) => {
                                        const active = selectedNode?.id === node.id;
                                        const hovered = hoveredNodeId === node.id;
                                        const directNeighbor = activeNeighborIds.has(node.id);
                                        const related = activeNode && node.visualGroup === activeNode.visualGroup;
                                        const muted = activeNode && !active && !hovered && !directNeighbor && !related;
                                        const emphasized = active || hovered || directNeighbor;
                                        const stroke = atlasNodeStroke(node, emphasized);
                                        return (
                                            <g
                                                key={node.id}
                                                className="cursor-pointer"
                                                onMouseEnter={() => setHoveredNodeId(node.id)}
                                                onMouseLeave={() => setHoveredNodeId(null)}
                                                onClick={(event) => {
                                                    event.stopPropagation();
                                                    setSelectedNodeId(node.id);
                                                }}
                                            >
                                                <circle cx={node.x} cy={node.y} r={node.radius + (directNeighbor ? 8 : 6)} fill={node.color} opacity={atlasNodeGlow(node, emphasized, Boolean(muted))} filter="url(#atlas-node-glow)" />
                                                <circle cx={node.x} cy={node.y} r={node.radius} fill={atlasNodeFill(node)} fillOpacity={muted ? 0.18 : directNeighbor ? 0.82 : node.clustered ? 0.58 : 0.72} stroke={stroke} strokeOpacity={muted ? 0.22 : emphasized ? 1 : 0.92} strokeWidth={active ? 3 : hovered ? 2.55 : directNeighbor ? 2.35 : node.clustered ? 2.1 : 1.55} />
                                                <circle cx={node.x - node.radius * 0.28} cy={node.y - node.radius * 0.32} r={Math.max(1.6, node.radius * 0.2)} fill="#FFFFFF" opacity={muted ? 0.03 : directNeighbor ? 0.22 : node.clustered ? 0.18 : 0.12} />
                                                {(active || hovered || directNeighbor || node.rank <= 4) ? (
                                                    <text x={node.x} y={node.y + node.radius + 13} textAnchor="middle" fill={muted ? 'rgba(148,163,184,0.28)' : 'rgba(226,232,240,0.86)'} fontSize="10" fontWeight="800">
                                                        #{node.rank}
                                                    </text>
                                                ) : null}
                                            </g>
                                        );
                                    })}
                                    </g>
                                </g>
                            </svg>
                            {selectedNode ? (
                                <div className="absolute bottom-4 left-4 z-10 w-[min(330px,calc(100%-32px))] rounded-2xl border border-white/10 bg-[#171A29]/92 p-4 shadow-2xl backdrop-blur">
                                    <div className="mb-3 flex items-start justify-between gap-3">
                                        <div className="min-w-0">
                                            <div className="text-xs font-black uppercase tracking-[0.14em] text-text-medium">#{selectedNode.rank} holder</div>
                                            <div className="mt-1 truncate text-sm font-black text-text-light">{selectedNode.label || shortenAddress(selectedNode.address)}</div>
                                        </div>
                                        <button type="button" onClick={() => navigator.clipboard?.writeText(selectedNode.address)} className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-white/10 bg-white/5 text-text-medium transition-colors hover:text-primary-green" aria-label="Copy selected wallet address">
                                            <Copy size={14} />
                                        </button>
                                    </div>
                                    <div className="grid grid-cols-3 gap-2 text-center">
                                        <div className="rounded-xl bg-white/5 px-2 py-2">
                                            <div className="text-[10px] font-bold uppercase text-text-dark">Links</div>
                                            <div className="text-sm font-black text-text-light">{formatNumber(selectedNode.degree)}</div>
                                        </div>
                                        <div className="rounded-xl bg-white/5 px-2 py-2">
                                            <div className="text-[10px] font-bold uppercase text-text-dark">Group</div>
                                            <div className="text-sm font-black text-text-light">{selectedNode.clustered ? formatNumber(displayNodes.filter((node: any) => node.visualGroup === selectedNode.visualGroup).length) : 'Solo'}</div>
                                        </div>
                                        <div className="rounded-xl bg-white/5 px-2 py-2">
                                            <div className="text-[10px] font-bold uppercase text-text-dark">Type</div>
                                            <div className="truncate text-sm font-black text-text-light">{selectedNode.tags[0] || 'wallet'}</div>
                                        </div>
                                    </div>
                                </div>
                            ) : null}
                        </>
                    ) : (
                        <div className="flex h-full min-h-[720px] items-center justify-center p-5">
                            <EmptyBlock title="Atlas snapshot unavailable" body="No graph nodes were returned for this token. If this is a new token, Atlas may not have a snapshot yet." />
                        </div>
                    )}
                </div>
                <div className="min-w-0 overflow-hidden rounded-2xl border border-border bg-card-hover/30" onClick={() => setSelectedNodeId(null)}>
                    <div className="border-b border-border px-4 py-4">
                        <div className="text-xs font-black uppercase tracking-[0.16em] text-text-dark">Address List</div>
                        <div className="mt-1 text-sm font-semibold text-text-medium">Ranked holders and cluster colors</div>
                        <label className="mt-4 flex h-11 items-center gap-2 rounded-xl border border-border bg-card px-3 text-sm text-text-medium">
                            <Search size={16} />
                            <input
                                type="search"
                                value={addressSearch}
                                onChange={(event) => setAddressSearch(event.target.value)}
                                placeholder="Search wallet or label"
                                className="min-w-0 flex-1 bg-transparent font-semibold text-text-light outline-none placeholder:text-text-dark"
                            />
                        </label>
                    </div>
                    <div className="max-h-[620px] overflow-y-auto">
                        {filteredNodes.slice(0, 120).map((node: any) => {
                            const active = selectedNode?.id === node.id;
                            const hovered = hoveredNodeId === node.id;
                            return (
                                <button
                                    type="button"
                                    key={node.id}
                                    onClick={(event) => {
                                        event.stopPropagation();
                                        setSelectedNodeId(node.id);
                                    }}
                                    onMouseEnter={() => setHoveredNodeId(node.id)}
                                    onMouseLeave={() => setHoveredNodeId(null)}
                                    className={`grid w-full grid-cols-[36px_minmax(0,1fr)_62px] items-center gap-3 border-b border-border/70 px-4 py-3 text-left transition-colors ${active ? 'bg-primary-green/10' : hovered ? 'bg-card-hover/70' : 'hover:bg-card-hover/60'}`}
                                >
                                    <span className="text-xs font-black text-text-dark">#{node.rank}</span>
                                    <span className="min-w-0">
                                        <span className="flex items-center gap-2">
                                            <span className="h-3 w-3 shrink-0 rounded-full border-2" style={{ backgroundColor: hexToRgba(node.color, node.clustered ? 0.32 : 0.18), borderColor: node.color, boxShadow: node.clustered ? `0 0 12px ${hexToRgba(node.color, 0.45)}` : 'none' }} />
                                            <span className="truncate text-sm font-black text-text-light">{node.label || shortenAddress(node.address)}</span>
                                        </span>
                                        <span className="mt-1 block truncate text-xs font-semibold text-text-medium">{node.tags.slice(0, 3).join(', ') || 'wallet'}</span>
                                    </span>
                                    <span className="text-right text-xs font-black text-text-medium">{node.degree ? `${formatNumber(node.degree)} links` : 'solo'}</span>
                                </button>
                            );
                        })}
                    </div>
                    <div className="grid grid-cols-3 gap-px border-t border-border bg-border text-center">
                        <div className="bg-card px-2 py-3">
                            <div className="text-lg font-black text-text-light">{formatNumber(holders.length)}</div>
                            <div className="text-[10px] font-black uppercase text-text-dark">Nodes</div>
                        </div>
                        <div className="bg-card px-2 py-3">
                            <div className="text-lg font-black text-text-light">{formatNumber(links.length)}</div>
                            <div className="text-[10px] font-black uppercase text-text-dark">Links</div>
                        </div>
                        <div className="bg-card px-2 py-3">
                            <div className="text-lg font-black text-text-light">{formatNumber(timestampList.length)}</div>
                            <div className="text-[10px] font-black uppercase text-text-dark">History</div>
                        </div>
                    </div>
                </div>
            </div>
        </Card>
    );
};

export const SafefyScan: React.FC = () => {
    const [address, setAddress] = useState('');
    const [network, setNetwork] = useState<InsightXNetwork>('sol');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [report, setReport] = useState<SafefyScanReport | null>(null);
    const [liveLiquidity, setLiveLiquidity] = useState<LiveTokenLiquidity | null>(null);
    const [liquidityLoading, setLiquidityLoading] = useState(false);
    const [liquidityError, setLiquidityError] = useState<string | null>(null);
    const [detectedNetwork, setDetectedNetwork] = useState<DetectedTokenNetwork | null>(null);
    const [detectingNetwork, setDetectingNetwork] = useState(false);

    const normalizedAddress = address.trim();
    const addressSupported = !normalizedAddress || isLikelyInsightXAddress(normalizedAddress, network);
    const scanner = getEndpointData<InsightXScannerResponse>(report?.endpoints.scanner);
    const overview = getEndpointData<InsightXOverview>(report?.endpoints.overview);
    const snipers = getEndpointData<InsightXSnipers>(report?.endpoints.snipers);
    const bundlers = getEndpointData<InsightXBundlers>(report?.endpoints.bundlers);
    const insiders = getEndpointData<InsightXInsiders>(report?.endpoints.insiders);
    const clustersData = getEndpointData<any>(report?.endpoints.clusters);
    const atlas = getEndpointData(report?.endpoints.atlasLatest);
    const atlasTimestamps = getEndpointData(report?.endpoints.atlasTimestamps);
    const labels = collectLabels(getEndpointData<any>(report?.endpoints.labels));
    const labelsByAddress = useMemo(() => labelMapFrom(labels), [labels]);
    const score = Number(scanner?.results?.simple?.score ?? NaN);
    const normalizedScore = Number.isFinite(score) ? score : null;
    const tokenTotalSupply = scanner?.token?.total_supply;
    const clusterSupplyBalance = getTotalClusterSupplyBalance(clustersData, tokenTotalSupply, overview?.cluster_pct);
    const clusterSupplyUsd = clusterSupplyBalance !== null && liveLiquidity?.tokenPriceUsd
        ? clusterSupplyBalance * liveLiquidity.tokenPriceUsd
        : null;
    const drainRiskPenalty = getDrainRiskPenalty(clusterSupplyBalance, liveLiquidity);
    const adjustedScore = normalizedScore !== null ? Math.max(0, normalizedScore - drainRiskPenalty) : null;
    useEffect(() => {
        if (!normalizedAddress || loading) {
            setDetectedNetwork(null);
            setDetectingNetwork(false);
            return;
        }
        const canDetect = /^0x[a-fA-F0-9]{40}$/.test(normalizedAddress)
            || /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(normalizedAddress)
            || normalizedAddress.length > 44;
        if (!canDetect) {
            setDetectedNetwork(null);
            setDetectingNetwork(false);
            return;
        }

        let cancelled = false;
        const timer = window.setTimeout(() => {
            setDetectingNetwork(true);
            SafefyScanService.detectTokenNetwork(normalizedAddress)
                .then((detection) => {
                    if (cancelled) return;
                    setDetectedNetwork(detection);
                    if (detection && detection.network !== network) {
                        setNetwork(detection.network);
                    }
                })
                .catch(() => {
                    if (!cancelled) setDetectedNetwork(null);
                })
                .finally(() => {
                    if (!cancelled) setDetectingNetwork(false);
                });
        }, 350);

        return () => {
            cancelled = true;
            window.clearTimeout(timer);
        };
    }, [normalizedAddress, loading]);

    useEffect(() => {
        if (!report) {
            setLiveLiquidity(null);
            setLiquidityError(null);
            setLiquidityLoading(false);
            return;
        }

        let cancelled = false;
        setLiquidityLoading(true);
        setLiquidityError(null);
        setLiveLiquidity(null);

        SafefyScanService.getLiveTokenLiquidity(report.network, report.address)
            .then((liquidity) => {
                if (!cancelled) setLiveLiquidity(liquidity);
            })
            .catch((nextError) => {
                if (!cancelled) {
                    setLiquidityError(nextError instanceof Error ? nextError.message : 'Live liquidity is unavailable.');
                }
            })
            .finally(() => {
                if (!cancelled) setLiquidityLoading(false);
            });

        return () => {
            cancelled = true;
        };
    }, [report]);

    const handleScan = async (event?: React.FormEvent) => {
        event?.preventDefault();
        if (!normalizedAddress || !addressSupported) return;

        setLoading(true);
        setError(null);
        try {
            const nextReport = await SafefyScanService.scanToken(network, normalizedAddress);
            setReport(nextReport);
        } catch (nextError) {
            setError(nextError instanceof Error ? nextError.message : 'Safety Scan failed.');
        } finally {
            setLoading(false);
        }
    };

    const reset = () => {
        setReport(null);
        setError(null);
        setLiveLiquidity(null);
        setLiquidityError(null);
        setDetectedNetwork(null);
        setDetectingNetwork(false);
        setAddress('');
        setNetwork('sol');
    };

    if (!report) {
        return (
            <div className="flex min-h-[calc(100vh-180px)] flex-col items-center gap-12 pt-14 animate-fade-in">
                <form onSubmit={handleScan} className="grid w-full max-w-[950px] gap-5 px-2 md:grid-cols-[170px_minmax(0,1fr)_220px]">
                    <label className="sr-only" htmlFor="safefy-network-empty">Network</label>
                    <select
                        id="safefy-network-empty"
                        value={network}
                        onChange={(event) => setNetwork(event.target.value as InsightXNetwork)}
                        disabled={loading}
                        className="min-h-16 rounded-2xl border border-border bg-card-hover px-5 text-lg font-black text-text-light outline-none transition-colors focus:border-primary-green/60 disabled:opacity-60"
                    >
                        {INSIGHTX_NETWORKS.map((item) => (
                            <option key={item.id} value={item.id}>{item.label}</option>
                        ))}
                    </select>
                    <label className="sr-only" htmlFor="safefy-address-empty">Token address</label>
                    <div className="flex min-h-16 items-center gap-3 rounded-2xl border border-border bg-card-hover px-5 transition-colors focus-within:border-primary-green/60">
                        <Search size={20} className="shrink-0 text-text-medium" />
                        <input
                            id="safefy-address-empty"
                            type="text"
                            value={address}
                            onChange={(event) => setAddress(event.target.value)}
                            placeholder="Enter Token Contract Address"
                            disabled={loading}
                            className="w-full bg-transparent text-lg font-semibold text-text-light outline-none placeholder:text-text-dark disabled:opacity-60"
                        />
                    </div>
                    <button
                        type="submit"
                        disabled={loading || !normalizedAddress || !addressSupported}
                        className="inline-flex min-h-16 items-center justify-center gap-2 rounded-2xl bg-primary-green px-8 text-base font-black text-main transition-colors hover:bg-primary-green-darker disabled:cursor-not-allowed disabled:bg-card-hover disabled:text-text-medium"
                    >
                        {loading ? <Loader2 size={20} className="animate-spin" /> : <Shield size={20} />}
                        {loading ? 'Scanning...' : 'Safety Scan'}
                    </button>
                </form>

                {!addressSupported ? (
                    <div className="w-full max-w-[950px] rounded-2xl border border-primary-red/25 bg-primary-red/10 px-4 py-3 text-sm font-semibold text-primary-red">
                        {network === 'sol' ? 'Solana scans require a valid Solana address.' : network === 'sui' ? 'Sui scans require a valid Sui token address.' : 'EVM scans require a valid 0x token address.'}
                    </div>
                ) : null}
                {error ? (
                    <div className="w-full max-w-[950px] rounded-2xl border border-primary-red/25 bg-primary-red/10 px-4 py-3 text-sm font-semibold text-primary-red">
                        {error}
                    </div>
                ) : null}

                <Card className="w-full max-w-[950px]">
                    <div className="flex min-h-[300px] flex-col items-center justify-center text-center">
                        <div className="mb-7 grid h-20 w-20 place-items-center rounded-full border border-border bg-card-hover/30 text-text-medium">
                            {loading ? <Loader2 size={36} className="animate-spin" /> : <ShieldAlert size={36} />}
                        </div>
                        <h2 className="text-4xl font-black tracking-tight text-text-light">Security Analysis</h2>
                        <p className="mt-4 max-w-[560px] text-lg leading-8 text-[#9AA8C7]">
                            Scan any token for contract risk, holder concentration, launch manipulation, and labeled wallet intelligence.
                        </p>
                    </div>
                </Card>
            </div>
        );
    }

    return (
        <div className="flex flex-col gap-5 animate-fade-in">
            <Card className="overflow-hidden">
                <div className="grid gap-6 xl:grid-cols-[1.1fr_1.4fr] xl:items-end">
                    <div>
                        <h1 className="text-3xl font-black tracking-tight text-text-light sm:text-4xl">Safety Scan</h1>
                        <p className="mt-3 max-w-2xl text-base leading-7 text-text-medium">
                            Run token security, holder concentration, cluster, insider, sniper, bundler, graph, and label intelligence from one Atlaix workspace.
                        </p>
                    </div>
                    <div className="flex justify-start xl:justify-end">
                        <button
                            type="button"
                            onClick={reset}
                            className="inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl bg-primary-green px-6 text-sm font-black text-main transition-colors hover:bg-primary-green-darker focus:outline-none focus:ring-2 focus:ring-primary-green/40 focus:ring-offset-2 focus:ring-offset-card"
                        >
                            <Shield size={18} />
                            New scan
                        </button>
                    </div>
                </div>
                {!addressSupported ? (
                    <div className="mt-4 rounded-2xl border border-primary-red/25 bg-primary-red/10 px-4 py-3 text-sm font-semibold text-primary-red">
                        {network === 'sol' ? 'Solana scans require a valid Solana address.' : network === 'sui' ? 'Sui scans require a valid Sui token address.' : 'EVM scans require a valid 0x token address.'}
                    </div>
                ) : null}
                {error ? (
                    <div className="mt-4 rounded-2xl border border-primary-red/25 bg-primary-red/10 px-4 py-3 text-sm font-semibold text-primary-red">
                        {error}
                    </div>
                ) : null}
            </Card>

                <>
                    <div className="grid gap-5 xl:grid-cols-[1.2fr_0.8fr]">
                        <Card>
                            <div className="flex flex-col gap-5">
                                <div className="flex flex-col gap-5 md:flex-row md:items-center md:justify-between">
                                    <div className="min-w-0">
                                        <div className="flex min-w-0 flex-wrap items-center gap-4">
                                            <div className="grid h-14 w-14 place-items-center overflow-hidden rounded-full border border-border bg-card-hover text-lg font-black text-primary-green">
                                                {scanner?.token?.logo ? <img src={scanner.token.logo} alt="" className="h-full w-full object-cover" /> : (scanner?.token?.symbol || 'IX').slice(0, 2)}
                                            </div>
                                            <div className="min-w-0">
                                                <h2 className="truncate text-3xl font-black text-text-light">{scanner?.token?.name || 'Token Safety Report'}</h2>
                                                <div className="mt-1 flex flex-wrap items-center gap-3 text-sm font-semibold text-text-medium">
                                                    <span>{scanner?.token?.symbol || 'N/A'}</span>
                                                    <button
                                                        type="button"
                                                        onClick={() => navigator.clipboard?.writeText(report.address)}
                                                        className="inline-flex min-h-9 items-center gap-2 rounded-full border border-border bg-card-hover px-3 font-mono text-xs transition-colors hover:text-text-light"
                                                    >
                                                        {shortenAddress(report.address)}
                                                        <Copy size={14} />
                                                    </button>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                    <div className={`min-w-[180px] rounded-2xl border p-4 text-center ${riskTone(adjustedScore)}`}>
                                        <div className="text-[11px] font-black uppercase tracking-[0.18em]">Safety score</div>
                                        <div className="mt-1 text-4xl font-black">{adjustedScore ?? 'N/A'}</div>
                                        <div className="text-sm font-black">{riskLabel(adjustedScore)}</div>
                                    </div>
                                </div>
                                <div className="grid gap-3 sm:grid-cols-2">
                                    <MetricCard
                                        label="Cluster supply"
                                        value={(
                                            <div>
                                                <div>{formatTotalClusterSupplyShare(clustersData, tokenTotalSupply, overview?.cluster_pct)}</div>
                                                <div className="mt-1 text-base font-black text-text-medium">{formatCurrencyCompact(clusterSupplyUsd)}</div>
                                            </div>
                                        )}
                                        detail="Supply held by detected clusters"
                                    />
                                    <MetricCard label="Dev holdings" value={formatCreatorSupplyShare(scanner, overview?.dev_pct)} detail="Creator/deployer exposure" />
                                </div>
                                <div className="grid gap-3 rounded-2xl border border-border bg-card-hover/35 p-4 sm:grid-cols-2 lg:grid-cols-4">
                                    <div>
                                        <div className="text-[11px] font-black uppercase tracking-[0.16em] text-text-dark">Supply</div>
                                        <div className="mt-2 text-lg font-black text-text-light">{formatCompact(scanner?.token?.total_supply)}</div>
                                    </div>
                                    <div>
                                        <div className="text-[11px] font-black uppercase tracking-[0.16em] text-text-dark">Decimals</div>
                                        <div className="mt-2 text-lg font-black text-text-light">{scanner?.token?.decimals ?? 'N/A'}</div>
                                    </div>
                                    <div>
                                        <div className="text-[11px] font-black uppercase tracking-[0.16em] text-text-dark">Token age</div>
                                        <div className="mt-2 text-lg font-black text-text-light">{formatAgeOrDate(scanner?.token?.age)}</div>
                                    </div>
                                    <div>
                                        <div className="text-[11px] font-black uppercase tracking-[0.16em] text-text-dark">Holders</div>
                                        <div className="mt-2 text-lg font-black text-text-light">{formatNumber(scanner?.results?.advanced?.holder_count)}</div>
                                    </div>
                                </div>
                            </div>
                        </Card>
                        <div className="grid gap-5">
                            <LiquidityLockSummary scanner={scanner} />
                            <DrainRiskSummary
                                clusterBalance={clusterSupplyBalance}
                                totalSupply={tokenTotalSupply}
                                liquidity={liveLiquidity}
                                loading={liquidityLoading}
                                error={liquidityError}
                                className="min-h-[280px]"
                            />
                        </div>
                    </div>

                    <div className="grid gap-5">
                        <ScannerPanel scanner={scanner} result={report.endpoints.scanner} />
                    </div>

                    <LiquidityAndHoldersPanel scanner={scanner} labels={labelsByAddress} />
                    {report.network === 'sol' ? (
                        <ManipulationPanel overview={overview} snipers={snipers} bundlers={bundlers} insiders={insiders} labels={labelsByAddress} totalSupply={tokenTotalSupply} tokenPriceUsd={liveLiquidity?.tokenPriceUsd} />
                    ) : null}
                    <ClusterPanel clusters={clustersData} labels={labelsByAddress} totalSupply={tokenTotalSupply} />
                    <AtlasPanel atlas={atlas} timestamps={atlasTimestamps} clusters={clustersData} />
                </>
        </div>
    );
};

export default SafefyScan;
