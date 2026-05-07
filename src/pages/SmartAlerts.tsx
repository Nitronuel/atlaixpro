// Route-level product screen for the Atlaix Smart Alerts feature.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    Activity,
    AlertTriangle,
    Bell,
    Clock,
    Flame,
    Loader2,
    ShieldCheck,
    TrendingUp,
    Wallet,
    X
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { SmartAlertRule, SmartAlertService, SmartAlertTrigger, SmartAlertType } from '../services/SmartAlertService';

type AlertType = SmartAlertType;

interface BasicAlertType {
    title: string;
    desc: string;
    example: string;
    type: AlertType;
    metric: string;
    icon: React.ReactNode;
}

interface AlertFeedItem {
    id: string;
    trigger: string;
    type: AlertType;
    target: string;
    status: boolean;
    lastTriggered: string;
    persisted: boolean;
}

interface AlertSetupDraft {
    target: string;
    chainId: string;
    tokenAddress: string;
    condition: string;
    value: string;
    notificationChannels: string[];
    cooldownMinutes: number;
}

const BASIC_ALERT_TYPES: BasicAlertType[] = [
    {
        title: 'Price Target',
        desc: 'Token crosses above or below a selected price.',
        example: 'SOL above $200',
        type: 'Price',
        metric: 'Price',
        icon: <TrendingUp size={18} />
    },
    {
        title: '24h Volume Spike',
        desc: 'Token volume reaches a selected dollar level or multiplier.',
        example: '24h volume above $1M',
        type: 'Volume',
        metric: 'Volume',
        icon: <Activity size={18} />
    },
    {
        title: 'Liquidity Change',
        desc: 'Liquidity is added, removed, or drops below a threshold.',
        example: 'Liquidity below $100K',
        type: 'Liquidity',
        metric: 'Liquidity',
        icon: <ShieldCheck size={18} />
    },
    {
        title: 'Whale Buy or Sell',
        desc: 'Large wallet activity crosses a dollar threshold.',
        example: 'Whale buy above $50K',
        type: 'Whale',
        metric: 'Wallet Flow',
        icon: <Wallet size={18} />
    },
    {
        title: 'Live Alpha Event',
        desc: 'Token appears in the Live Alpha Feed with a selected event.',
        example: 'Liquidity Event detected',
        type: 'Alpha',
        metric: 'Alpha Event',
        icon: <Flame size={18} />
    },
    {
        title: 'Risk Flag',
        desc: 'A token receives a new safety warning or risk signal.',
        example: 'High risk flag appears',
        type: 'Risk',
        metric: 'Risk',
        icon: <AlertTriangle size={18} />
    }
];

const DEMO_ALERTS: AlertFeedItem[] = [
    { id: 'demo-price', trigger: 'ETH price above $3,500', type: 'Price', target: 'ETH', status: true, lastTriggered: '2 hours ago', persisted: false },
    { id: 'demo-whale', trigger: 'Whale buy above $50K on Any token', type: 'Whale', target: 'Any token', status: true, lastTriggered: '1 day ago', persisted: false },
    { id: 'demo-volume', trigger: 'SOL 24h volume above $1B', type: 'Volume', target: 'SOL', status: false, lastTriggered: 'Never', persisted: false }
];

const DEMO_HISTORY = [
    { id: 'demo-1', title: 'ETH Price Alert', time: '10:42 AM', description: 'ETH crossed $3,450.', type: 'Price' },
    { id: 'demo-2', title: 'Whale Buy', time: '09:15 AM', description: 'A tracked wallet bought more than $50K.', type: 'Whale' },
    { id: 'demo-3', title: 'Risk Flag', time: 'Yesterday', description: 'A token received a high-risk signal.', type: 'Risk' },
    { id: 'demo-4', title: 'Volume Spike', time: 'Yesterday', description: 'BONK volume moved above its alert threshold.', type: 'Volume' },
    { id: 'demo-5', title: 'Alpha Event', time: '2 days ago', description: 'A token entered the Live Alpha Feed.', type: 'Alpha' }
] as const;

const CHAIN_OPTIONS = [
    { label: 'Solana', value: 'solana' },
    { label: 'Ethereum', value: 'ethereum' },
    { label: 'Base', value: 'base' },
    { label: 'BSC', value: 'bsc' },
    { label: 'Polygon', value: 'polygon' },
    { label: 'Arbitrum', value: 'arbitrum' }
];

const SETUP_DEFAULTS: Record<AlertType, AlertSetupDraft> = {
    Price: { target: 'SOL', chainId: 'solana', tokenAddress: '', condition: 'above', value: '$200', notificationChannels: ['in_app'], cooldownMinutes: 60 },
    Volume: { target: 'Any token', chainId: 'solana', tokenAddress: '', condition: 'above', value: '$1M', notificationChannels: ['in_app'], cooldownMinutes: 120 },
    Liquidity: { target: 'Any token', chainId: 'solana', tokenAddress: '', condition: 'below', value: '$100K', notificationChannels: ['in_app'], cooldownMinutes: 120 },
    Whale: { target: 'Any token', chainId: 'solana', tokenAddress: '', condition: 'buy above', value: '$50K', notificationChannels: ['in_app'], cooldownMinutes: 60 },
    Alpha: { target: 'Any token', chainId: 'solana', tokenAddress: '', condition: 'event is', value: 'Liquidity Event', notificationChannels: ['in_app'], cooldownMinutes: 180 },
    Risk: { target: 'Any token', chainId: 'solana', tokenAddress: '', condition: 'risk is', value: 'High', notificationChannels: ['in_app'], cooldownMinutes: 360 }
};

const CONDITION_OPTIONS: Record<AlertType, string[]> = {
    Price: ['above', 'below'],
    Volume: ['above', 'below', 'increases by', 'drops by'],
    Liquidity: ['above', 'below', 'added above', 'removed above'],
    Whale: ['buy above', 'sell above', 'buy or sell above'],
    Alpha: ['event is'],
    Risk: ['risk is']
};

const VALUE_OPTIONS: Partial<Record<AlertType, string[]>> = {
    Alpha: ['Liquidity Event', 'Volume Spike', 'Accumulation', 'Distribution', 'Unusual Activity'],
    Risk: ['Any new risk', 'High', 'Critical']
};

const formatRelativeTime = (value: string | null) => {
    if (!value) return 'Never';
    const timestamp = new Date(value).getTime();
    if (!Number.isFinite(timestamp)) return 'Never';

    const diffMs = Date.now() - timestamp;
    if (diffMs < 60_000) return 'Just now';
    const minutes = Math.floor(diffMs / 60_000);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
};

const typeStyle = (type: string) => {
    switch (type) {
        case 'Price':
            return 'border-primary-green/30 bg-primary-green/10 text-primary-green';
        case 'Volume':
            return 'border-primary-blue/30 bg-primary-blue/10 text-primary-blue';
        case 'Liquidity':
            return 'border-primary-purple/30 bg-primary-purple/10 text-primary-purple';
        case 'Whale':
            return 'border-primary-yellow/30 bg-primary-yellow/10 text-primary-yellow';
        case 'Risk':
            return 'border-primary-red/30 bg-primary-red/10 text-primary-red';
        default:
            return 'border-border bg-card-hover text-text-medium';
    }
};

const alertIcon = (type: AlertType) => {
    switch (type) {
        case 'Price':
            return <TrendingUp size={18} />;
        case 'Whale':
            return <Wallet size={18} />;
        case 'Liquidity':
            return <ShieldCheck size={18} />;
        case 'Alpha':
            return <Flame size={18} />;
        case 'Risk':
            return <AlertTriangle size={18} />;
        default:
            return <Activity size={18} />;
    }
};

const getAlertTrigger = (template: BasicAlertType, draft: AlertSetupDraft) => {
    const target = draft.target.trim() || 'Any token';
    const value = draft.value.trim();

    switch (template.type) {
        case 'Price':
            return `${target} price ${draft.condition} ${value}`;
        case 'Volume':
            return `${target} 24h volume ${draft.condition} ${value}`;
        case 'Liquidity':
            return `${target} liquidity ${draft.condition} ${value}`;
        case 'Whale':
            return `Whale ${draft.condition} ${value} on ${target}`;
        case 'Alpha':
            return `${target} appears with ${value}`;
        case 'Risk':
            return `${target} risk flag is ${value}`;
        default:
            return `${target} ${draft.condition} ${value}`;
    }
};

const mapRuleToFeedItem = (rule: SmartAlertRule): AlertFeedItem => ({
    id: rule.id,
    trigger: rule.trigger_label,
    type: rule.alert_type,
    target: rule.target,
    status: rule.enabled,
    lastTriggered: formatRelativeTime(rule.last_triggered_at),
    persisted: true
});

const mapTriggerToHistory = (trigger: SmartAlertTrigger) => ({
    id: trigger.id,
    title: trigger.title,
    time: formatRelativeTime(trigger.created_at),
    description: trigger.message,
    type: trigger.alert_type
});

export const SmartAlerts: React.FC = () => {
    const navigate = useNavigate();
    const { user, loading: authLoading } = useAuth();
    const [activeType, setActiveType] = useState<AlertType>('Price');
    const [rules, setRules] = useState<SmartAlertRule[]>([]);
    const [triggers, setTriggers] = useState<SmartAlertTrigger[]>([]);
    const [setupType, setSetupType] = useState<BasicAlertType | null>(null);
    const [setupDraft, setSetupDraft] = useState<AlertSetupDraft>(SETUP_DEFAULTS.Price);
    const [loadingAlerts, setLoadingAlerts] = useState(false);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [authPrompt, setAuthPrompt] = useState<string | null>(null);

    const loadUserAlerts = useCallback(async () => {
        if (!user) {
            setRules([]);
            setTriggers([]);
            return;
        }

        setLoadingAlerts(true);
        setError(null);
        try {
            const [nextRules, nextTriggers] = await Promise.all([
                SmartAlertService.listRules(user.id),
                SmartAlertService.listTriggers(user.id, 25)
            ]);
            setRules(nextRules);
            setTriggers(nextTriggers);
        } catch (err: any) {
            setError(err?.message || 'Could not load Smart Alerts.');
        } finally {
            setLoadingAlerts(false);
        }
    }, [user]);

    useEffect(() => {
        if (!authLoading) {
            loadUserAlerts();
        }
    }, [authLoading, loadUserAlerts]);

    const feedItems = useMemo(() => {
        if (!user) return DEMO_ALERTS;
        return rules.map(mapRuleToFeedItem);
    }, [rules, user]);

    const historyItems = useMemo(() => {
        if (!user) return DEMO_HISTORY;
        return triggers.map(mapTriggerToHistory);
    }, [triggers, user]);

    const requireLogin = (message: string) => {
        setAuthPrompt(message);
    };

    const openSetupModal = (item: BasicAlertType) => {
        setActiveType(item.type);
        setSetupType(item);
        setSetupDraft(SETUP_DEFAULTS[item.type]);
        setError(null);
    };

    const closeSetupModal = () => {
        setSetupType(null);
        setSaving(false);
    };

    const toggleAlert = async (id: string) => {
        if (!user) {
            requireLogin('Sign in to pause, resume, and sync alerts across your account.');
            return;
        }

        const rule = rules.find((item) => item.id === id);
        if (!rule) return;

        const previousRules = rules;
        setRules((current) => current.map((item) => item.id === id ? { ...item, enabled: !item.enabled } : item));
        try {
            const updated = await SmartAlertService.setRuleEnabled(id, !rule.enabled);
            setRules((current) => current.map((item) => item.id === id ? updated : item));
        } catch (err: any) {
            setRules(previousRules);
            setError(err?.message || 'Could not update alert.');
        }
    };

    const removeAlert = async (id: string) => {
        if (!user) {
            requireLogin('Sign in to remove saved alerts from your account.');
            return;
        }

        const previousRules = rules;
        setRules((current) => current.filter((item) => item.id !== id));
        try {
            await SmartAlertService.deleteRule(id);
        } catch (err: any) {
            setRules(previousRules);
            setError(err?.message || 'Could not delete alert.');
        }
    };

    const createAlert = async () => {
        if (!setupType) return;

        if (!user) {
            requireLogin('Sign in to save Smart Alerts and receive trigger history.');
            return;
        }

        setSaving(true);
        setError(null);
        try {
            const triggerLabel = getAlertTrigger(setupType, setupDraft);
            const created = await SmartAlertService.createRule({
                userId: user.id,
                alertType: setupType.type,
                target: setupDraft.target.trim() || 'Any token',
                chainId: setupDraft.chainId,
                tokenAddress: setupDraft.tokenAddress.trim() || null,
                condition: setupDraft.condition,
                threshold: setupDraft.value.trim(),
                triggerLabel,
                notificationChannels: setupDraft.notificationChannels,
                cooldownMinutes: setupDraft.cooldownMinutes
            });
            setRules((current) => [created, ...current]);
            closeSetupModal();
        } catch (err: any) {
            setError(err?.message || 'Could not create alert.');
        } finally {
            setSaving(false);
        }
    };

    const previewTrigger = setupType ? getAlertTrigger(setupType, setupDraft) : '';

    return (
        <div className="relative z-10 mx-auto flex w-full max-w-7xl flex-col gap-8 pb-10 animate-fade-in">
            {error && (
                <div className="rounded-xl border border-primary-red/30 bg-primary-red/10 px-4 py-3 text-sm text-primary-red">
                    {error}
                </div>
            )}

            <div className="grid grid-cols-1 gap-6 md:gap-8 lg:grid-cols-3">
                <div className="flex flex-col gap-8 lg:col-span-2">
                    <div className="flex flex-col gap-4">
                        <div className="flex items-center justify-between">
                            <h3 className="flex items-center gap-2 text-lg font-bold text-text-light">
                                <Bell size={18} className="text-primary-green" />
                                Basic Alert Types
                            </h3>
                            {user && (
                                <button
                                    type="button"
                                    onClick={loadUserAlerts}
                                    className="text-xs font-bold text-text-dark transition-colors hover:text-text-light"
                                >
                                    Refresh
                                </button>
                            )}
                        </div>

                        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                            {BASIC_ALERT_TYPES.map((item) => (
                                <button
                                    key={item.type}
                                    type="button"
                                    onClick={() => openSetupModal(item)}
                                    className={`group relative cursor-pointer overflow-hidden rounded-xl border p-5 text-left transition-all duration-300 hover:bg-card-hover ${activeType === item.type ? 'border-primary-green/40 bg-card-hover' : 'border-border bg-card hover:border-text-dark/50'}`}
                                >
                                    <div className="flex items-start gap-4">
                                        <div className="rounded-lg border border-border/50 bg-main p-3 text-primary-green transition-transform duration-300 group-hover:scale-110">
                                            {item.icon}
                                        </div>
                                        <div>
                                            <h4 className="text-sm font-bold text-text-light transition-colors group-hover:text-primary-green">{item.title}</h4>
                                            <p className="mt-1 text-xs leading-relaxed text-text-medium">{item.desc}</p>
                                        </div>
                                    </div>
                                </button>
                            ))}
                        </div>
                    </div>

                    <div className="flex flex-1 flex-col gap-4">
                        <div className="flex items-center justify-between">
                            <h3 className="flex items-center gap-2 text-lg font-bold text-text-light">
                                <Bell size={18} className="text-text-light" />
                                Alert Feed
                            </h3>
                            <div className="text-xs text-text-dark">
                                {user ? `${feedItems.length} saved` : 'Preview mode'}
                            </div>
                        </div>

                        <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
                            <div className="custom-scrollbar max-h-[520px] overflow-y-auto">
                                {loadingAlerts ? (
                                    <div className="flex min-h-[180px] items-center justify-center gap-3 text-sm text-text-medium">
                                        <Loader2 size={18} className="animate-spin text-primary-green" />
                                        Loading alerts
                                    </div>
                                ) : feedItems.length ? (
                                    feedItems.map((alert) => (
                                        <div
                                            key={alert.id}
                                            className={`flex items-center justify-between gap-4 border-b border-border/50 p-4 transition-colors last:border-0 hover:bg-card-hover/40 ${!alert.status ? 'opacity-60 grayscale-[0.5]' : ''}`}
                                        >
                                            <div className="flex min-w-0 items-center gap-4">
                                                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-border/60 bg-main text-primary-green shadow-inner">
                                                    {alertIcon(alert.type)}
                                                </div>
                                                <div className="min-w-0">
                                                    <div className="truncate text-sm font-bold text-text-light">{alert.trigger}</div>
                                                    <div className="mt-1 flex items-center gap-3">
                                                        <span className="rounded border border-border bg-main px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-text-medium">{alert.type}</span>
                                                        <span className="flex items-center gap-1 text-[10px] text-text-dark">
                                                            <Clock size={10} /> Last: {alert.lastTriggered}
                                                        </span>
                                                    </div>
                                                </div>
                                            </div>

                                            <div className="flex items-center gap-4">
                                                <button
                                                    type="button"
                                                    onClick={() => toggleAlert(alert.id)}
                                                    className="relative inline-flex cursor-pointer items-center"
                                                    aria-label={alert.status ? 'Pause alert' : 'Activate alert'}
                                                >
                                                    <span className="sr-only">{alert.status ? 'Pause alert' : 'Activate alert'}</span>
                                                    <span className={`relative h-5 w-9 rounded-full border transition-colors after:absolute after:left-[2px] after:top-[2px] after:h-4 after:w-4 after:rounded-full after:border after:transition-all after:content-[''] ${alert.status ? 'border-primary-green bg-primary-green after:translate-x-full after:border-white after:bg-white' : 'border-text-dark/30 bg-main after:border-gray-300 after:bg-text-medium'}`} />
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() => removeAlert(alert.id)}
                                                    className="rounded-lg p-2 text-text-dark transition-colors hover:bg-primary-red/10 hover:text-primary-red"
                                                    aria-label="Remove alert"
                                                >
                                                    <X size={16} />
                                                </button>
                                            </div>
                                        </div>
                                    ))
                                ) : (
                                    <div className="flex min-h-[180px] flex-col items-center justify-center p-6 text-center">
                                        <Bell size={24} className="mb-3 text-primary-green" />
                                        <div className="text-sm font-bold text-text-light">No saved alerts yet</div>
                                        <div className="mt-1 max-w-sm text-xs text-text-medium">Choose a basic alert type above to create your first saved rule.</div>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                </div>

                <div className="flex flex-col gap-4">
                    <h3 className="flex items-center gap-2 text-lg font-bold text-text-light">
                        <Clock size={18} className="text-text-medium" />
                        Trigger History
                    </h3>

                    <div className="relative flex max-h-[600px] w-full flex-col overflow-hidden rounded-xl border border-border bg-card p-0">
                        <div className="absolute bottom-12 left-[27px] top-6 z-0 w-[2px] bg-border"></div>

                        <div className="custom-scrollbar relative z-10 space-y-1 overflow-y-auto p-5">
                            {historyItems.length ? historyItems.map((item, index) => (
                                <div key={item.id} className="group flex gap-4">
                                    <div className={`relative z-10 mt-1.5 box-content h-3.5 w-3.5 shrink-0 rounded-full border-[3px] border-card ${index === 0 ? 'bg-primary-green shadow-[0_0_8px_rgba(38,211,86,0.6)]' : 'bg-text-dark'}`}></div>

                                    <div className="flex-1 border-b border-border/30 pb-3 transition-all group-hover:pl-1 last:border-0">
                                        <div className="flex items-start justify-between gap-3">
                                            <h4 className="text-sm font-bold leading-tight text-text-light">{item.title}</h4>
                                            <span className="font-mono text-[10px] text-text-dark">{item.time}</span>
                                        </div>
                                        <p className="mt-1 text-xs text-text-medium">{item.description}</p>
                                        <span className={`mt-2 inline-flex rounded border px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider ${typeStyle(item.type)}`}>
                                            {item.type}
                                        </span>
                                    </div>
                                </div>
                            )) : (
                                <div className="relative z-10 flex min-h-[220px] flex-col items-center justify-center text-center">
                                    <Clock size={22} className="mb-3 text-text-dark" />
                                    <div className="text-sm font-bold text-text-light">No triggers yet</div>
                                    <p className="mt-1 text-xs text-text-medium">Triggered alerts will appear here once the evaluator records them.</p>
                                </div>
                            )}

                            <div className="relative z-10 flex justify-center bg-card pt-4">
                                <button
                                    type="button"
                                    onClick={loadUserAlerts}
                                    className="text-xs text-text-dark transition-colors hover:text-text-light"
                                >
                                    {user ? 'Refresh history' : 'Sign in to store history'}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {setupType && (
                <div
                    className="fixed inset-0 z-[1400] flex items-center justify-center bg-black/70 px-4 py-6 backdrop-blur-sm"
                    onClick={closeSetupModal}
                >
                    <div
                        className="w-full max-w-xl overflow-hidden rounded-2xl border border-border bg-card shadow-2xl"
                        onClick={(event) => event.stopPropagation()}
                    >
                        <div className="flex items-start justify-between gap-4 border-b border-border p-5">
                            <div className="flex items-start gap-3">
                                <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border ${typeStyle(setupType.type)}`}>
                                    {setupType.icon}
                                </div>
                                <div>
                                    <h3 className="text-lg font-bold text-text-light">Set {setupType.title}</h3>
                                    <p className="mt-1 text-sm text-text-medium">{setupType.desc}</p>
                                </div>
                            </div>
                            <button
                                type="button"
                                onClick={closeSetupModal}
                                className="rounded-lg p-2 text-text-dark transition-colors hover:bg-card-hover hover:text-text-light"
                                aria-label="Close alert setup"
                            >
                                <X size={18} />
                            </button>
                        </div>

                        <div className="space-y-5 p-5">
                            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                                <label className="block">
                                    <span className="mb-2 block text-xs font-bold uppercase tracking-wider text-text-medium">Target token or scope</span>
                                    <input
                                        value={setupDraft.target}
                                        onChange={(event) => setSetupDraft((current) => ({ ...current, target: event.target.value }))}
                                        className="w-full rounded-xl border border-border bg-main px-4 py-3 text-sm font-medium text-text-light outline-none transition-colors placeholder:text-text-dark focus:border-primary-green/60"
                                        placeholder="SOL, ETH, Any token..."
                                    />
                                </label>

                                <label className="block">
                                    <span className="mb-2 block text-xs font-bold uppercase tracking-wider text-text-medium">Chain</span>
                                    <select
                                        value={setupDraft.chainId}
                                        onChange={(event) => setSetupDraft((current) => ({ ...current, chainId: event.target.value }))}
                                        className="w-full rounded-xl border border-border bg-main px-4 py-3 text-sm font-medium text-text-light outline-none transition-colors focus:border-primary-green/60"
                                    >
                                        {CHAIN_OPTIONS.map((chain) => (
                                            <option key={chain.value} value={chain.value}>{chain.label}</option>
                                        ))}
                                    </select>
                                </label>
                            </div>

                            <label className="block">
                                <span className="mb-2 block text-xs font-bold uppercase tracking-wider text-text-medium">Token address or pair address</span>
                                <input
                                    value={setupDraft.tokenAddress}
                                    onChange={(event) => setSetupDraft((current) => ({ ...current, tokenAddress: event.target.value }))}
                                    className="w-full rounded-xl border border-border bg-main px-4 py-3 font-mono text-sm text-text-light outline-none transition-colors placeholder:text-text-dark focus:border-primary-green/60"
                                    placeholder="Optional, but recommended for precise alerts"
                                />
                            </label>

                            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                                <label className="block">
                                    <span className="mb-2 block text-xs font-bold uppercase tracking-wider text-text-medium">Condition</span>
                                    <select
                                        value={setupDraft.condition}
                                        onChange={(event) => setSetupDraft((current) => ({ ...current, condition: event.target.value }))}
                                        className="w-full rounded-xl border border-border bg-main px-4 py-3 text-sm font-medium text-text-light outline-none transition-colors focus:border-primary-green/60"
                                    >
                                        {CONDITION_OPTIONS[setupType.type].map((condition) => (
                                            <option key={condition} value={condition}>{condition}</option>
                                        ))}
                                    </select>
                                </label>

                                <label className="block">
                                    <span className="mb-2 block text-xs font-bold uppercase tracking-wider text-text-medium">
                                        {setupType.type === 'Alpha' ? 'Event' : setupType.type === 'Risk' ? 'Severity' : 'Threshold'}
                                    </span>
                                    {VALUE_OPTIONS[setupType.type] ? (
                                        <select
                                            value={setupDraft.value}
                                            onChange={(event) => setSetupDraft((current) => ({ ...current, value: event.target.value }))}
                                            className="w-full rounded-xl border border-border bg-main px-4 py-3 text-sm font-medium text-text-light outline-none transition-colors focus:border-primary-green/60"
                                        >
                                            {VALUE_OPTIONS[setupType.type]?.map((value) => (
                                                <option key={value} value={value}>{value}</option>
                                            ))}
                                        </select>
                                    ) : (
                                        <input
                                            value={setupDraft.value}
                                            onChange={(event) => setSetupDraft((current) => ({ ...current, value: event.target.value }))}
                                            className="w-full rounded-xl border border-border bg-main px-4 py-3 text-sm font-medium text-text-light outline-none transition-colors placeholder:text-text-dark focus:border-primary-green/60"
                                            placeholder="$50K, 20%, 2x..."
                                        />
                                    )}
                                </label>
                            </div>

                            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                                <label className="block">
                                    <span className="mb-2 block text-xs font-bold uppercase tracking-wider text-text-medium">Notify by</span>
                                    <div className="w-full rounded-xl border border-border bg-main px-4 py-3 text-sm font-medium text-text-light">
                                        In-app only
                                    </div>
                                </label>

                                <label className="block">
                                    <span className="mb-2 block text-xs font-bold uppercase tracking-wider text-text-medium">Cooldown</span>
                                    <select
                                        value={setupDraft.cooldownMinutes}
                                        onChange={(event) => setSetupDraft((current) => ({ ...current, cooldownMinutes: Number(event.target.value) }))}
                                        className="w-full rounded-xl border border-border bg-main px-4 py-3 text-sm font-medium text-text-light outline-none transition-colors focus:border-primary-green/60"
                                    >
                                        <option value={15}>15 minutes</option>
                                        <option value={60}>1 hour</option>
                                        <option value={180}>3 hours</option>
                                        <option value={720}>12 hours</option>
                                        <option value={1440}>24 hours</option>
                                    </select>
                                </label>
                            </div>

                            <div className="rounded-xl border border-border bg-main p-4">
                                <div className="text-xs font-bold uppercase tracking-wider text-text-dark">Preview</div>
                                <div className="mt-2 text-sm font-bold text-text-light">{previewTrigger}</div>
                                {!user && <div className="mt-2 text-xs text-text-medium">You can configure this freely. Saving it to your account requires sign in.</div>}
                            </div>
                        </div>

                        <div className="flex flex-col-reverse gap-3 border-t border-border p-5 sm:flex-row sm:justify-end">
                            <button
                                type="button"
                                onClick={closeSetupModal}
                                className="rounded-xl border border-border px-5 py-3 text-sm font-bold text-text-medium transition-colors hover:bg-card-hover hover:text-text-light"
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                onClick={createAlert}
                                disabled={saving}
                                className="inline-flex items-center justify-center gap-2 rounded-xl bg-primary-green px-5 py-3 text-sm font-bold text-black transition-colors hover:bg-primary-green/90 disabled:cursor-not-allowed disabled:opacity-60"
                            >
                                {saving && <Loader2 size={16} className="animate-spin" />}
                                {user ? 'Create Alert' : 'Sign in to Save'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {authPrompt && (
                <div
                    className="fixed inset-0 z-[1500] flex items-center justify-center bg-black/70 px-4 py-6 backdrop-blur-sm"
                    onClick={() => setAuthPrompt(null)}
                >
                    <div
                        className="w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-2xl"
                        onClick={(event) => event.stopPropagation()}
                    >
                        <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl border border-primary-green/30 bg-primary-green/10 text-primary-green">
                            <Bell size={22} />
                        </div>
                        <h3 className="text-xl font-bold text-text-light">Save this alert</h3>
                        <p className="mt-2 text-sm leading-relaxed text-text-medium">{authPrompt}</p>
                        <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
                            <button
                                type="button"
                                onClick={() => setAuthPrompt(null)}
                                className="rounded-xl border border-border px-5 py-3 text-sm font-bold text-text-medium transition-colors hover:bg-card-hover hover:text-text-light"
                            >
                                Keep browsing
                            </button>
                            <button
                                type="button"
                                onClick={() => navigate('/login', { state: { from: { pathname: '/smart-alerts' } } })}
                                className="rounded-xl bg-primary-green px-5 py-3 text-sm font-bold text-black transition-colors hover:bg-primary-green/90"
                            >
                                Sign in
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};
