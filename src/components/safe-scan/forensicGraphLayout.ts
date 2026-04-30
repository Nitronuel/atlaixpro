// Reusable interface component for Atlaix product workflows.
import {
    forceCenter,
    forceCollide,
    forceLink,
    forceManyBody,
    forceRadial,
    forceSimulation,
    forceX,
    forceY
} from 'd3-force';
import type {
    ForensicGraphCluster,
    ForensicGraphEdge,
    ForensicGraphNode
} from '../../services/ForensicBundleService';

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const GOLDEN_ANGLE = 2.3999632297;

const hashString = (value: string) => {
    let hash = 2166136261;
    for (let index = 0; index < value.length; index += 1) {
        hash ^= value.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
};

const collidesWithNodes = (
    x: number,
    y: number,
    radius: number,
    nodes: Array<{ x: number; y: number; radius: number }>,
    padding: number
) => nodes.some((node) => {
    const dx = node.x - x;
    const dy = node.y - y;
    const minDistance = node.radius + radius + padding;
    return (dx * dx) + (dy * dy) < minDistance * minDistance;
});

type Zone = 'clustered' | 'outer';
export type ForensicGraphLayoutStyle = 'standard' | 'cluster-packed';

type SimulationNode = {
    id: string;
    walletAddress: string;
    label: string;
    clusterId: string | null;
    role: ForensicGraphNode['role'];
    currentHoldingsTokens: string;
    currentHoldingsPct: number;
    flagReason: string;
    radius: number;
    zone: Zone;
    clusterRank: number;
    isAnchor?: boolean;
    x?: number;
    y?: number;
    vx?: number;
    vy?: number;
    fx?: number | null;
    fy?: number | null;
};

type SimulationLink = {
    source: string;
    target: string;
    relationshipType: ForensicGraphEdge['relationshipType'] | 'cluster';
    strengthScore: number;
};

export type PositionedForensicNode = ForensicGraphNode & {
    x: number;
    y: number;
    radius: number;
    zone: Zone;
    clusterRank: number;
};

export type PositionedForensicCluster = ForensicGraphCluster & {
    x: number;
    y: number;
    hullRadius: number;
};

export type ForensicGraphLayout = {
    width: number;
    height: number;
    centerX: number;
    centerY: number;
    groups: PositionedForensicCluster[];
    visibleClusters: PositionedForensicCluster[];
    nodes: PositionedForensicNode[];
    nodeMap: Map<string, PositionedForensicNode>;
    edges: ForensicGraphEdge[];
    clusteredWalletCount: number;
    nonClusteredWalletCount: number;
};

type Args = {
    graph: {
        nodes: ForensicGraphNode[];
        edges: ForensicGraphEdge[];
        clusters: ForensicGraphCluster[];
    };
    includeNetworkLinked: boolean;
    focusClusterId: string | null;
    layoutStyle?: ForensicGraphLayoutStyle;
    width?: number;
    height?: number;
};

type PreparedGraph = {
    width: number;
    height: number;
    centerX: number;
    centerY: number;
    visibleNodes: ForensicGraphNode[];
    visibleEdges: ForensicGraphEdge[];
    visibleClusters: ForensicGraphCluster[];
    layoutStyle: ForensicGraphLayoutStyle;
};

const separateClusterNodes = <T extends { x: number; y: number; radius: number; clusterId: string | null }>(
    nodes: T[],
    iterations = 16,
    padding = 44
) => {
    const grouped = new Map<string, T[]>();
    nodes.forEach((node) => {
        if (!node.clusterId) return;
        const existing = grouped.get(node.clusterId) ?? [];
        existing.push(node);
        grouped.set(node.clusterId, existing);
    });

    grouped.forEach((clusterNodes) => {
        if (clusterNodes.length < 2) return;
        for (let iteration = 0; iteration < iterations; iteration += 1) {
            let moved = false;
            for (let i = 0; i < clusterNodes.length; i += 1) {
                for (let j = i + 1; j < clusterNodes.length; j += 1) {
                    const first = clusterNodes[i];
                    const second = clusterNodes[j];
                    const dx = second.x - first.x;
                    const dy = second.y - first.y;
                    const distance = Math.hypot(dx, dy) || 0.001;
                    const minimum = first.radius + second.radius + padding;
                    if (distance >= minimum) continue;
                    const overlap = minimum - distance;
                    const pushX = (dx / distance) * overlap * 0.52;
                    const pushY = (dy / distance) * overlap * 0.52;
                    first.x -= pushX;
                    first.y -= pushY;
                    second.x += pushX;
                    second.y += pushY;
                    moved = true;
                }
            }
            if (!moved) break;
        }
    });

    return nodes;
};

const nodeRadius = (node: ForensicGraphNode) => {
    if (node.clusterId) {
        return clamp(8 + node.currentHoldingsPct * 2.8 + 1.6, 8.5, 34);
    }
    return clamp(6.4 + node.currentHoldingsPct * 1.45 + (node.role === 'network_linked' ? 1.4 : 0), 6.5, 22);
};

const collisionRadius = (node: SimulationNode | PositionedForensicNode) => {
    const padding = node.zone === 'clustered' ? 44 : 16;
    return node.radius + padding;
};

const edgeDisplayWeight = (edge: ForensicGraphEdge) => {
    const typeWeight = edge.relationshipType === 'funding'
        ? 4
        : edge.relationshipType === 'transfer'
            ? 3
            : edge.relationshipType === 'launch'
                ? 2
                : 1;
    return typeWeight + edge.strengthScore;
};

const simplifyClusterPackedEdges = (
    edges: ForensicGraphEdge[],
    nodes: ForensicGraphNode[],
    maxEdges = 72
) => {
    const nodeByWallet = new Map(nodes.map((node) => [node.walletAddress, node]));
    const bestByTarget = new Map<string, ForensicGraphEdge>();
    const bestByClusterPair = new Map<string, ForensicGraphEdge>();

    edges.forEach((edge) => {
        const source = nodeByWallet.get(edge.sourceWallet);
        const target = nodeByWallet.get(edge.targetWallet);
        if (!source || !target) return;

        if (source.clusterId && target.clusterId && source.clusterId === target.clusterId) {
            return;
        }

        const targetKey = target.clusterId
            ? target.walletAddress
            : source.clusterId
                ? source.walletAddress
                : target.walletAddress;
        const existingTarget = bestByTarget.get(targetKey);
        if (!existingTarget || edgeDisplayWeight(edge) > edgeDisplayWeight(existingTarget)) {
            bestByTarget.set(targetKey, edge);
        }

        if (source.clusterId && target.clusterId && source.clusterId !== target.clusterId) {
            const clusterPairKey = [source.clusterId, target.clusterId].sort().join(':');
            const existingPair = bestByClusterPair.get(clusterPairKey);
            if (!existingPair || edgeDisplayWeight(edge) > edgeDisplayWeight(existingPair)) {
                bestByClusterPair.set(clusterPairKey, edge);
            }
        }
    });

    return [...new Map([...bestByTarget.values(), ...bestByClusterPair.values()].map((edge) => [edge.edgeId, edge])).values()]
        .sort((left, right) => edgeDisplayWeight(right) - edgeDisplayWeight(left))
        .slice(0, maxEdges);
};

const edgeWeight = (edge: Pick<ForensicGraphEdge, 'relationshipType' | 'strengthScore'>) => {
    const typeWeight = edge.relationshipType === 'transfer'
        ? 1.45
        : edge.relationshipType === 'launch'
            ? 1.2
            : edge.relationshipType === 'funding'
                ? 1
                : 0.9;
    return edge.strengthScore * typeWeight;
};

const getFitTransform = (
    bounds: { minX: number; maxX: number; minY: number; maxY: number },
    width: number,
    height: number,
    padding: number
) => {
    const graphWidth = Math.max(1, bounds.maxX - bounds.minX);
    const graphHeight = Math.max(1, bounds.maxY - bounds.minY);
    const scale = Math.min(
        (width - padding * 2) / graphWidth,
        (height - padding * 2) / graphHeight
    );
    const scaledWidth = graphWidth * scale;
    const scaledHeight = graphHeight * scale;
    const offsetX = (width - scaledWidth) / 2;
    const offsetY = (height - scaledHeight) / 2;
    return {
        scale,
        offsetX,
        offsetY
    };
};

const fitPoint = (
    x: number,
    y: number,
    bounds: { minX: number; maxX: number; minY: number; maxY: number },
    transform: { scale: number; offsetX: number; offsetY: number }
) => {
    return {
        x: transform.offsetX + (x - bounds.minX) * transform.scale,
        y: transform.offsetY + (y - bounds.minY) * transform.scale
    };
};

const buildFallbackLayout = ({
    width,
    height,
    centerX,
    centerY,
    visibleNodes,
    visibleEdges,
    visibleClusters,
    layoutStyle
}: PreparedGraph): ForensicGraphLayout => {
    const compact = layoutStyle === 'cluster-packed';
    const clusterScores = visibleClusters
        .map((cluster) => ({
            ...cluster,
            score: (cluster.supplyHeldPct * 1.5) + cluster.walletCount,
            hullRadius: compact
                ? 54 + Math.sqrt(cluster.walletCount) * 15 + cluster.supplyHeldPct * 2.8
                : 74 + cluster.walletCount * 4.8 + cluster.supplyHeldPct * 4.2
        }))
        .sort((a, b) => b.score - a.score);

    const placedCenters: Array<{ x: number; y: number; radius: number }> = [];
    const groups = clusterScores.map((cluster, index) => {
        const angle = index * GOLDEN_ANGLE;
        const band = compact ? 86 + index * 58 : 72 + index * 28;
        let x = centerX + Math.cos(angle) * band;
        let y = centerY + Math.sin(angle) * band * 0.78;
        let attempts = 0;
        while (collidesWithNodes(x, y, cluster.hullRadius + (compact ? 48 : 84), placedCenters, compact ? 28 : 64) && attempts < 40) {
            const push = band + (compact ? 18 : 14) + attempts * (compact ? 10 : 7);
            x = centerX + Math.cos(angle + attempts * 0.2) * push;
            y = centerY + Math.sin(angle + attempts * 0.2) * push * 0.78;
            attempts += 1;
        }
        x = clamp(x, 120, width - 120);
        y = clamp(y, 100, height - 100);
        placedCenters.push({ x, y, radius: cluster.hullRadius + (compact ? 20 : 44) });
        return { ...cluster, x, y };
    });

    const groupById = new Map(groups.map((group) => [group.clusterId, group]));
    const rankedByCluster = new Map<string, ForensicGraphNode[]>();
    visibleNodes.filter((node) => node.clusterId).forEach((node) => {
        const clusterId = node.clusterId as string;
        const existing = rankedByCluster.get(clusterId) ?? [];
        existing.push(node);
        rankedByCluster.set(clusterId, existing);
    });
    rankedByCluster.forEach((nodes, clusterId) => {
        rankedByCluster.set(clusterId, nodes.slice().sort((a, b) => b.currentHoldingsPct - a.currentHoldingsPct));
    });

    const placedPoints: Array<{ x: number; y: number; radius: number }> = [];
    const positionedClusteredNodes: PositionedForensicNode[] = groups.flatMap((group) => {
        const clusterNodes = rankedByCluster.get(group.clusterId) ?? [];
        const packed: PositionedForensicNode[] = [];
        clusterNodes.forEach((node, index) => {
            const radius = nodeRadius(node);
            if (index === 0) {
                packed.push({ ...node, x: group.x, y: group.y, radius, zone: 'clustered', clusterRank: index });
                placedPoints.push({ x: group.x, y: group.y, radius });
                return;
            }
            let placed = false;
            let attempt = 0;
            const seedAngle = (hashString(`${node.walletAddress}:${group.clusterId}`) % 360) * (Math.PI / 180);
            while (!placed && attempt < 180) {
                const spiral = compact
                    ? 10 + Math.sqrt(attempt + 1) * (5.6 + radius * 0.42)
                    : 18 + Math.sqrt(attempt + 1) * (10 + radius * 0.72);
                const candidateX = group.x + Math.cos(seedAngle + attempt * 0.56) * spiral;
                const candidateY = group.y + Math.sin(seedAngle + attempt * 0.56) * spiral * 0.88;
                if (!collidesWithNodes(candidateX, candidateY, radius, packed, compact ? 12 : 40)) {
                    packed.push({ ...node, x: candidateX, y: candidateY, radius, zone: 'clustered', clusterRank: index });
                    placedPoints.push({ x: candidateX, y: candidateY, radius });
                    placed = true;
                }
                attempt += 1;
            }
            if (!placed) {
                const fallbackX = group.x + Math.cos(seedAngle) * ((compact ? 28 : 56) + index * (compact ? 4 : 8));
                const fallbackY = group.y + Math.sin(seedAngle) * ((compact ? 24 : 48) + index * (compact ? 3.6 : 7));
                packed.push({ ...node, x: fallbackX, y: fallbackY, radius, zone: 'clustered', clusterRank: index });
                placedPoints.push({ x: fallbackX, y: fallbackY, radius });
            }
        });
        return packed;
    });

    const positionedOuterNodes: PositionedForensicNode[] = [];
    const outerNodes = visibleNodes.filter((node) => node.clusterId === null).sort((a, b) => b.currentHoldingsPct - a.currentHoldingsPct);
    outerNodes.forEach((node, index) => {
        const radius = nodeRadius(node);
        const linkedClusters = visibleEdges.flatMap((edge) => {
            if (edge.sourceWallet === node.walletAddress) {
                return [groupById.get(positionedClusteredNodes.find((entry) => entry.walletAddress === edge.targetWallet)?.clusterId ?? '')];
            }
            if (edge.targetWallet === node.walletAddress) {
                return [groupById.get(positionedClusteredNodes.find((entry) => entry.walletAddress === edge.sourceWallet)?.clusterId ?? '')];
            }
            return [];
        }).filter(Boolean) as Array<{ x: number; y: number; hullRadius: number; clusterId: string }>;

        const anchor = linkedClusters[0];
        const seed = hashString(node.walletAddress);
        let x: number;
        let y: number;
        if (anchor) {
            const angle = (seed % 360) * (Math.PI / 180) + index * 0.32;
            const distance = anchor.hullRadius + (compact ? 128 : 94) + (index % 4) * (compact ? 36 : 28);
            x = anchor.x + Math.cos(angle) * distance;
            y = anchor.y + Math.sin(angle) * distance * 0.86;
        } else {
            const angle = index * GOLDEN_ANGLE + ((seed % 23) * 0.04);
            const radiusBand = Math.min(width, height) * 0.28 + Math.sqrt(index + 1) * 18 + (index % 4) * 14;
            x = centerX + Math.cos(angle) * radiusBand;
            y = centerY + Math.sin(angle) * radiusBand * 0.84;
        }

        let attempts = 0;
        while (collidesWithNodes(x, y, radius, placedPoints, 28) && attempts < 80) {
            const angle = index * GOLDEN_ANGLE + attempts * 0.18 + ((seed % 19) * 0.03);
            const radiusBand = Math.min(width, height) * 0.28 + Math.sqrt(index + 1) * 18 + (index % 4) * 14 + attempts * 5;
            x = centerX + Math.cos(angle) * radiusBand;
            y = centerY + Math.sin(angle) * radiusBand * 0.84;
            attempts += 1;
        }

        x = clamp(x, 24 + radius, width - 24 - radius);
        y = clamp(y, 24 + radius, height - 24 - radius);
        placedPoints.push({ x, y, radius });
        positionedOuterNodes.push({ ...node, x, y, radius, zone: 'outer', clusterRank: index });
    });

    const rawNodes = separateClusterNodes([...positionedClusteredNodes, ...positionedOuterNodes], compact ? 8 : 20, compact ? 14 : 44);
    const bounds = rawNodes.reduce((acc, node) => ({
        minX: Math.min(acc.minX, node.x - (compact && node.zone === 'clustered' ? node.radius + 20 : collisionRadius(node))),
        maxX: Math.max(acc.maxX, node.x + (compact && node.zone === 'clustered' ? node.radius + 20 : collisionRadius(node))),
        minY: Math.min(acc.minY, node.y - (compact && node.zone === 'clustered' ? node.radius + 20 : collisionRadius(node))),
        maxY: Math.max(acc.maxY, node.y + (compact && node.zone === 'clustered' ? node.radius + 20 : collisionRadius(node)))
    }), {
        minX: Number.POSITIVE_INFINITY,
        maxX: Number.NEGATIVE_INFINITY,
        minY: Number.POSITIVE_INFINITY,
        maxY: Number.NEGATIVE_INFINITY
    });
    const fitTransform = getFitTransform(bounds, width, height, compact ? 72 : 86);
    const nodeScale = Math.max(0.78, Math.min(1.02, fitTransform.scale));
    const nodes = rawNodes.map((node) => {
        const fitted = fitPoint(node.x, node.y, bounds, fitTransform);
        return {
            ...node,
            x: fitted.x,
            y: fitted.y,
            radius: node.radius * nodeScale
        };
    });
    const nodeMap = new Map(nodes.map((node) => [node.walletAddress, node]));
    const visibleGroupMeta: PositionedForensicCluster[] = groups.map((group) => {
        const clusterNodes = nodes.filter((node) => node.clusterId === group.clusterId);
        const avgX = clusterNodes.reduce((sum, node) => sum + node.x, 0) / Math.max(1, clusterNodes.length);
        const avgY = clusterNodes.reduce((sum, node) => sum + node.y, 0) / Math.max(1, clusterNodes.length);
        const hullRadius = clusterNodes.reduce((largest, node) => Math.max(largest, Math.hypot(node.x - avgX, node.y - avgY) + node.radius + (compact ? 9 : 12)), compact ? 36 : 54);
        return { ...group, x: avgX, y: avgY, hullRadius };
    });

    return {
        width,
        height,
        centerX,
        centerY,
        groups: visibleGroupMeta,
        visibleClusters: visibleGroupMeta,
        nodes,
        nodeMap,
        edges: visibleEdges,
        clusteredWalletCount: positionedClusteredNodes.length,
        nonClusteredWalletCount: positionedOuterNodes.length
    };
};

export const buildForensicGraphLayout = ({
    graph,
    includeNetworkLinked,
    focusClusterId,
    layoutStyle = 'standard',
    width = 1280,
    height = 760
}: Args): ForensicGraphLayout | null => {
    const filteredNodes = graph.nodes.filter((node) => includeNetworkLinked || node.role !== 'network_linked');
    const filteredWallets = new Set(filteredNodes.map((node) => node.walletAddress));
    const filteredEdges = graph.edges.filter((edge) => filteredWallets.has(edge.sourceWallet) && filteredWallets.has(edge.targetWallet));
    const filteredClusters = graph.clusters.filter((cluster) => filteredNodes.some((node) => node.clusterId === cluster.clusterId));
    const focusClusterIds = focusClusterId && filteredClusters.some((cluster) => cluster.clusterId === focusClusterId)
        ? new Set([focusClusterId])
        : null;

    const visibleNodes = focusClusterIds
        ? filteredNodes.filter((node) => node.clusterId === focusClusterId || (!node.clusterId && node.role !== 'network_linked'))
        : filteredNodes;
    const visibleWallets = new Set(visibleNodes.map((node) => node.walletAddress));
    const rawVisibleEdges = filteredEdges.filter((edge) => visibleWallets.has(edge.sourceWallet) && visibleWallets.has(edge.targetWallet));
    const visibleEdges = layoutStyle === 'cluster-packed'
        ? simplifyClusterPackedEdges(rawVisibleEdges, visibleNodes)
        : rawVisibleEdges;
    const visibleClusters = filteredClusters.filter((cluster) => !focusClusterIds || focusClusterIds.has(cluster.clusterId));

    if (!visibleNodes.length) return null;

    const preparedGraph: PreparedGraph = {
        width,
        height,
        centerX: width / 2,
        centerY: height / 2,
        visibleNodes,
        visibleEdges,
        visibleClusters,
        layoutStyle
    };

    if (layoutStyle === 'cluster-packed' || visibleNodes.length > 180 || visibleEdges.length > 320) {
        return buildFallbackLayout(preparedGraph);
    }

    const rankedClusterNodes = new Map<string, string[]>();
    visibleNodes
        .filter((node) => node.clusterId)
        .forEach((node) => {
            const clusterId = node.clusterId as string;
            const existing = rankedClusterNodes.get(clusterId) ?? [];
            existing.push(node.walletAddress);
            rankedClusterNodes.set(clusterId, existing);
        });
    rankedClusterNodes.forEach((wallets, clusterId) => {
        const rankMap = visibleNodes
            .filter((node) => node.clusterId === clusterId)
            .sort((a, b) => b.currentHoldingsPct - a.currentHoldingsPct)
            .map((node) => node.walletAddress);
        rankedClusterNodes.set(clusterId, rankMap);
    });

    const centerX = preparedGraph.centerX;
    const centerY = preparedGraph.centerY;
    const simNodes: SimulationNode[] = visibleNodes.map((node, index) => {
        const radius = nodeRadius(node);
        const seed = hashString(node.walletAddress);
        const angle = (seed % 360) * (Math.PI / 180);
        const spread = node.clusterId ? 42 + (seed % 22) : 180 + (seed % 120);
        const clusterRank = node.clusterId
            ? (rankedClusterNodes.get(node.clusterId)?.indexOf(node.walletAddress) ?? index)
            : index;
        return {
            ...node,
            id: node.walletAddress,
            radius,
            zone: node.clusterId ? 'clustered' : 'outer',
            clusterRank,
            x: centerX + Math.cos(angle) * spread,
            y: centerY + Math.sin(angle) * spread
        };
    });

    const clusterAnchors: SimulationNode[] = visibleClusters.map((cluster, index) => {
        const score = (cluster.supplyHeldPct * 1.4) + cluster.walletCount;
        const angle = index * GOLDEN_ANGLE;
        const distance = focusClusterIds ? 0 : 56 + index * 26 + Math.max(0, 84 - score * 1.6);
        const seed = hashString(cluster.clusterId);
        return {
            id: `anchor:${cluster.clusterId}`,
            walletAddress: `anchor:${cluster.clusterId}`,
            label: cluster.clusterName,
            clusterId: cluster.clusterId,
            role: 'cluster_core',
            currentHoldingsTokens: '0',
            currentHoldingsPct: 0,
            flagReason: '',
            radius: Math.max(28, 34 + cluster.walletCount * 0.9),
            zone: 'clustered',
            clusterRank: -1,
            isAnchor: true,
            x: centerX + Math.cos(angle + ((seed % 7) * 0.08)) * distance,
            y: centerY + Math.sin(angle + ((seed % 7) * 0.08)) * distance * 0.82
        };
    });

    const simulationNodes = [...simNodes, ...clusterAnchors];
    const simulationLinks: SimulationLink[] = visibleEdges.map((edge) => ({
        source: edge.sourceWallet,
        target: edge.targetWallet,
        relationshipType: edge.relationshipType,
        strengthScore: edgeWeight(edge)
    }));

    clusterAnchors.forEach((anchor) => {
        simNodes
            .filter((node) => node.clusterId === anchor.clusterId)
            .forEach((node) => {
                simulationLinks.push({
                    source: node.walletAddress,
                    target: anchor.id,
                    relationshipType: 'cluster',
                    strengthScore: 0.32 + Math.min(0.5, node.currentHoldingsPct * 0.06)
                });
            });
    });

    const simulation = forceSimulation(simulationNodes)
        .force('charge', forceManyBody<SimulationNode>().strength((node) => node.isAnchor ? -205 : node.zone === 'outer' ? -(78 + node.radius * 7.2) : -(92 + node.radius * 7.6)))
        .force('link', forceLink<SimulationNode, SimulationLink>(simulationLinks)
            .id((node) => node.id)
            .distance((link) => {
                if (link.relationshipType === 'cluster') return 96;
                if (link.relationshipType === 'transfer') return 58;
                if (link.relationshipType === 'launch') return 66;
                if (link.relationshipType === 'funding') return 76;
                return 84;
            })
            .strength((link) => link.relationshipType === 'cluster'
                ? Math.min(0.03, 0.014 + link.strengthScore * 0.2)
                : Math.min(0.42, 0.1 + link.strengthScore * 0.12)))
        .force('collide', forceCollide<SimulationNode>().radius((node) => node.isAnchor ? node.radius + 96 : collisionRadius(node)).strength(1).iterations(6))
        .force('center', forceCenter(centerX, centerY).strength(0.04))
        .force('radial', forceRadial<SimulationNode>(
            (node) => {
                if (node.isAnchor) return focusClusterIds ? 0 : 82;
                if (node.zone === 'clustered') return 72 + Math.min(34, Math.max(0, node.clusterRank) * 2.6);
                return 220 + Math.sqrt(Math.max(0, node.clusterRank) + 1) * 18 + (node.clusterRank % 3) * 14;
            },
            centerX,
            centerY
        ).strength((node) => {
            if (node.isAnchor) return 0.02;
            return node.zone === 'outer' ? 0.035 : 0.016;
        }))
        .force('x', forceX<SimulationNode>(centerX).strength((node) => node.isAnchor ? 0.026 : node.zone === 'outer' ? 0.008 : 0.01))
        .force('y', forceY<SimulationNode>(centerY).strength((node) => node.isAnchor ? 0.026 : node.zone === 'outer' ? 0.008 : 0.01))
        .stop();

    const ticks = focusClusterIds ? 90 : Math.max(95, 170 - Math.floor(visibleNodes.length * 0.35));
    for (let index = 0; index < ticks; index += 1) {
        simulation.tick();
    }

    const renderNodes = simulationNodes.filter((node) => !node.isAnchor);
    const bounds = renderNodes.reduce((acc, node) => ({
        minX: Math.min(acc.minX, (node.x ?? centerX) - node.radius),
        maxX: Math.max(acc.maxX, (node.x ?? centerX) + node.radius),
        minY: Math.min(acc.minY, (node.y ?? centerY) - node.radius),
        maxY: Math.max(acc.maxY, (node.y ?? centerY) + node.radius)
    }), {
        minX: Number.POSITIVE_INFINITY,
        maxX: Number.NEGATIVE_INFINITY,
        minY: Number.POSITIVE_INFINITY,
        maxY: Number.NEGATIVE_INFINITY
    });

    const padding = focusClusterIds ? 102 : 86;
    const separatedRenderNodes = separateClusterNodes(renderNodes.map((node) => ({
        walletAddress: node.walletAddress,
        label: node.label,
        clusterId: node.clusterId,
        role: node.role,
        currentHoldingsTokens: node.currentHoldingsTokens,
        currentHoldingsPct: node.currentHoldingsPct,
        flagReason: node.flagReason,
        x: node.x ?? centerX,
        y: node.y ?? centerY,
        radius: node.radius,
        zone: node.zone,
        clusterRank: node.clusterRank
    })), 22);
    const separatedBounds = separatedRenderNodes.reduce((acc, node) => ({
        minX: Math.min(acc.minX, node.x - collisionRadius(node)),
        maxX: Math.max(acc.maxX, node.x + collisionRadius(node)),
        minY: Math.min(acc.minY, node.y - collisionRadius(node)),
        maxY: Math.max(acc.maxY, node.y + collisionRadius(node))
    }), {
        minX: Number.POSITIVE_INFINITY,
        maxX: Number.NEGATIVE_INFINITY,
        minY: Number.POSITIVE_INFINITY,
        maxY: Number.NEGATIVE_INFINITY
    });
    const fitTransform = getFitTransform(separatedBounds, width, height, padding);
    const nodeScale = Math.max(0.8, Math.min(1.02, fitTransform.scale));
    const positionedNodes: PositionedForensicNode[] = separatedRenderNodes.map((node) => {
        const fitted = fitPoint(node.x, node.y, separatedBounds, fitTransform);
        return {
            walletAddress: node.walletAddress,
            label: node.label,
            clusterId: node.clusterId,
            role: node.role,
            currentHoldingsTokens: node.currentHoldingsTokens,
            currentHoldingsPct: node.currentHoldingsPct,
            flagReason: node.flagReason,
            x: fitted.x,
            y: fitted.y,
            radius: node.radius * nodeScale,
            zone: node.zone,
            clusterRank: node.clusterRank
        };
    });

    const nodeMap = new Map(positionedNodes.map((node) => [node.walletAddress, node]));
    const groups: PositionedForensicCluster[] = visibleClusters.map((cluster) => {
        const clusterNodes = positionedNodes.filter((node) => node.clusterId === cluster.clusterId);
        if (!clusterNodes.length) {
            return { ...cluster, x: centerX, y: centerY, hullRadius: 64 };
        }
        const avgX = clusterNodes.reduce((sum, node) => sum + node.x, 0) / clusterNodes.length;
        const avgY = clusterNodes.reduce((sum, node) => sum + node.y, 0) / clusterNodes.length;
        const hullRadius = clusterNodes.reduce((largest, node) => {
            return Math.max(largest, Math.hypot(node.x - avgX, node.y - avgY) + node.radius + 14);
        }, 54);
        return {
            ...cluster,
            x: avgX,
            y: avgY,
            hullRadius
        };
    });

    return {
        width,
        height,
        centerX,
        centerY,
        groups,
        visibleClusters: groups,
        nodes: positionedNodes,
        nodeMap,
        edges: visibleEdges,
        clusteredWalletCount: positionedNodes.filter((node) => node.clusterId !== null).length,
        nonClusteredWalletCount: positionedNodes.filter((node) => node.clusterId === null).length
    };
};
