// Route-level product screen for the Atlaix Smart Alerts feature.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    Activity,
    AlertTriangle,
    Bell,
    CheckCircle2,
    Clock,
    Flame,
    Loader2,
    ShieldCheck,
    TrendingUp,
    Wallet,
    X
} from 'lucide-react';
import { APP_CONFIG } from '../config';
import { useAuth } from '../contexts/AuthContext';
import {
    SmartAlertCondition,
    SmartAlertRule,
    SmartAlertService,
    SmartAlertThresholdKind,
    SmartAlertTrigger,
    SmartAlertType
} from '../services/SmartAlertService';

interface BasicAlertType {
    title: string;
    desc: string;
    type: SmartAlertType;
    icon: React.ReactNode;
}

interface AlertSetupDraft {
    target: string;
    chainId: string;
    tokenAddress: string;
    condition: SmartAlertCondition;
    thresholdKind: SmartAlertThresholdKind;
    threshold: string;
    notificationChannels: string[];
    cooldownMinutes: number;
}

interface BackendStatus {
    enabled?: boolean;
    running?: boolean;
    lastRunStartedAt?: string | null;
    lastRunCompletedAt?: string | null;
    lastRunStatus?: string;
    lastError?: string;
    rulesChecked?: number;
    triggersCreated?: number;
}

const BASIC_ALERT_TYPES: BasicAlertType[] = [
    { title: 'Price Target', desc: 'Token crosses above or below a selected price.', type: 'Price', icon: <TrendingUp size={18} /> },
    { title: '24h Volume', desc: 'Volume crosses a dollar threshold or changes by a percentage.', type: 'Volume', icon: <Activity size={18} /> },
    { title: 'Liquidity', desc: 'Liquidity crosses a dollar threshold or changes by a percentage.', type: 'Liquidity', icon: <ShieldCheck size={18} /> },
    { title: 'Whale Flow', desc: 'Large buy or sell activity crosses a dollar threshold.', type: 'Whale', icon: <Wallet size={18} /> },
    { title: 'Live Alpha Event', desc: 'A token appears with a selected Live Alpha event.', type: 'Alpha', icon: <Flame size={18} /> },
    { title: 'Risk Flag', desc: 'A token receives a selected risk severity.', type: 'Risk', icon: <AlertTriangle size={18} /> }
];

const CHAIN_OPTIONS = [
    { label: 'Solana', value: 'solana' },
    { label: 'Ethereum', value: 'ethereum' },
    { label: 'Base', value: 'base' },
    { label: 'BSC', value: 'bsc' },
    { label: 'Polygon', value: 'polygon' },
    { label: 'Arbitrum', value: 'arbitrum' }
];

const CONDITION_OPTIONS: Record<SmartAlertType, Array<{ value: SmartAlertCondition; label: string; thresholdKind: SmartAlertThresholdKind }>> = {
    Price: [
        { value: 'above', label: 'Price above', thresholdKind: 'currency' },
        { value: 'below', label: 'Price below', thresholdKind: 'currency' }
    ],
    Volume: [
        { value: 'above', label: 'Volume above', thresholdKind: 'currency' },
        { value: 'below', label: 'Volume below', thresholdKind: 'currency' },
        { value: 'changes_by_percent', label: 'Volume changes by', thresholdKind: 'percent' }
    ],
    Liquidity: [
        { value: 'above', label: 'Liquidity above', thresholdKind: 'currency' },
        { value: 'below', label: 'Liquidity below', thresholdKind: 'currency' },
        { value: 'changes_by_percent', label: 'Liquidity changes by', thresholdKind: 'percent' }
    ],
    Whale: [
        { value: 'buy_above', label: 'Buy above', thresholdKind: 'currency' },
        { value: 'sell_above', label: 'Sell above', thresholdKind: 'currency' },
        { value: 'buy_or_sell_above', label: 'Buy or sell above', thresholdKind: 'currency' }
    ],
    Alpha: [
        { value: 'event_is', label: 'Event is', thresholdKind: 'event' }
    ],
    Risk: [
        { value: 'severity_is', label: 'Severity is', thresholdKind: 'severity' }
    ]
};

const VALUE_OPTIONS: Partial<Record<SmartAlertType, string[]>> = {
    Alpha: ['Liquidity Event', 'Accumulation', 'Distribution', 'Market Stress', 'Recovery', 'Unusual Activity'],
    Risk: ['Any new risk', 'High', 'Medium', 'Low']
};

const SETUP_DEFAULTS: Record<SmartAlertType, AlertSetupDraft> = {
    Price: { target: 'SOL', chainId: 'solana', tokenAddress: '', condition: 'above', thresholdKind: 'currency', threshold: '$200', notificationChannels: ['in_app'], cooldownMinutes: 60 },
    Volume: { target: 'Any token', chainId: 'solana', tokenAddress: '', condition: 'above', thresholdKind: 'currency', threshold: '$1M', notificationChannels: ['in_app'], cooldownMinutes: 120 },
    Liquidity: { target: 'Any token', chainId: 'solana', tokenAddress: '', condition: 'below', thresholdKind: 'currency', threshold: '$100K', notificationChannels: ['in_app'], cooldownMinutes: 120 },
    Whale: { target: 'Any token', chainId: 'solana', tokenAddress: '', condition: 'buy_above', thresholdKind: 'currency', threshold: '$50K', notificationChannels: ['in_app'], cooldownMinutes: 60 },
    Alpha: { target: 'Any token', chainId: 'solana', tokenAddress: '', condition: 'event_is', thresholdKind: 'event', threshold: 'Liquidity Event', notificationChannels: ['in_app'], cooldownMinutes: 180 },
    Risk: { target: 'Any token', chainId: 'solana', tokenAddress: '', condition: 'severity_is', thresholdKind: 'severity', threshold: 'High', notificationChannels: ['in_app'], cooldownMinutes: 360 }
};

const DEMO_ALERTS: SmartAlertRule[] = [
    {
        id: 'demo-price',
        user_id: 'demo',
        alert_type: 'Price',
        target: 'ETH',
        chain_id: 'ethereum',
        token_address: null,
        condition: 'above',
        threshold_kind: 'currency',
        threshold: '$3.5K',
        trigger_label: 'ETH price above $3.5K',
        notification_channels: ['in_app'],
        cooldown_minutes: 60,
        enabled: true,
        last_checked_at: null,
        last_triggered_at: null,
        last_observed_value: null,
        last_observed_at: null,
        baseline_value: null,
        baseline_observed_at: null,
        trigger_count: 0,
        last_error: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
    }
];

const DEMO_HISTORY: SmartAlertTrigger[] = [
    {
        id: 'demo-trigger',
        alert_rule_id: 'demo-price',
        user_id: 'demo',
        alert_type: 'Price',
        title: 'Price Alert',
        message: 'ETH price above $3.5K triggered at $3,640.',
        observed_value: '$3,640',
        threshold: '$3.5K',
        source: 'smart-alert-runner',
        metadata: { tokenLabel: 'ETH' },
        created_at: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString()
    }
];

const apiUrl = (path: string) => `${APP_CONFIG.apiBaseUrl || ''}${path}`;

const formatRelativeTime = (value: string | null | undefined) => {
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

const typeStyle = (type: SmartAlertType) => {
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

const alertIcon = (type: SmartAlertType) => {
    switch (type) {
        case 'Price': return <TrendingUp size={18} />;
        case 'Whale': return <Wallet size={18} />;
        case 'Liquidity': return <ShieldCheck size={18} />;
        case 'Alpha': return <Flame size={18} />;
        case 'Risk': return <AlertTriangle size={18} />;
        default: return <Activity size={18} />;
    }
};

const currencyPattern = /^\$?\d+(?:\.\d+)?\s*[kKmMbB]?$/;
const percentPattern = /^-?\d+(?:\.\d+)?%?$/;

const validateDraft = (draft: AlertSetupDraft) => {
    if (!draft.target.trim()) return 'Enter a target token or choose Any token.';
    if (!draft.threshold.trim()) return 'Enter a threshold.';
    if (draft.thresholdKind === 'currency' && !currencyPattern.test(draft.threshold.trim())) {
        return 'Use a currency value like $50K, $1.5M, or 50000.';
    }
    if (draft.thresholdKind === 'percent' && !percentPattern.test(draft.threshold.trim())) {
        return 'Use a percentage value like 10% or 25.';
    }
    return null;
};

const getAlertTrigger = (template: BasicAlertType, draft: AlertSetupDraft) => {
    const target = draft.target.trim() || 'Any token';
    const conditionLabel = CONDITION_OPTIONS[template.type].find((option) => option.value === draft.condition)?.label.toLowerCase() || draft.condition;
    const value = draft.thresholdKind === 'percent' && !draft.threshold.includes('%')
        ? `${draft.threshold}%`
        : draft.threshold.trim();

    if (template.type === 'Alpha') return `${target} appears with ${value}`;
    if (template.type === 'Risk') return `${target} risk severity is ${value}`;
    if (template.type === 'Whale') return `Whale ${conditionLabel} ${value} on ${target}`;
    return `${target} ${conditionLabel} ${value}`;
};

export const SmartAlerts: React.FC = () => {
    const navigate = useNavigate();
    const { user, loading: authLoading } = useAuth();
    const [activeType, setActiveType] = useState<SmartAlertType>('Price');
    const [rules, setRules] = useState<SmartAlertRule[]>([]);
    const [triggers, setTriggers] = useState<SmartAlertTrigger[]>([]);
    const [setupType, setSetupType] = useState<BasicAlertType | null>(null);
    const [setupDraft, setSetupDraft] = useState<AlertSetupDraft>(SETUP_DEFAULTS.Price);
    const [loadingAlerts, setLoadingAlerts] = useState(false);
    const [saving, setSaving] = useState(false);
    const [backendStatus, setBackendStatus] = useState<BackendStatus | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [formError, setFormError] = useState<string | null>(null);
    const [authPrompt, setAuthPrompt] = useState<string | null>(null);

    const loadBackendStatus = useCallback(async () => {
        try {
            const response = await fetch(apiUrl('/api/smart-alerts/status'));
            if (!response.ok) return;
            setBackendStatus(await response.json());
        } catch {
            setBackendStatus(null);
        }
    }, []);

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
                SmartAlertService.listTriggers(user.id, 50),
                loadBackendStatus()
            ]);
            setRules(nextRules);
            setTriggers(nextTriggers);
        } catch (err: any) {
            setError(err?.message || 'Could not load Smart Alerts.');
        } finally {
            setLoadingAlerts(false);
        }
    }, [loadBackendStatus, user]);

    useEffect(() => {
        if (!authLoading) loadUserAlerts();
    }, [authLoading, loadUserAlerts]);

    useEffect(() => {
        loadBackendStatus();
    }, [loadBackendStatus]);

    const feedItems = useMemo(() => user ? rules : DEMO_ALERTS, [rules, user]);
    const historyItems = useMemo(() => user ? triggers : DEMO_HISTORY, [triggers, user]);

    const openSetupModal = (item: BasicAlertType) => {
        setActiveType(item.type);
        setSetupType(item);
        setSetupDraft(SETUP_DEFAULTS[item.type]);
        setFormError(null);
        setError(null);
    };

    const closeSetupModal = () => {
        setSetupType(null);
        setSaving(false);
        setFormError(null);
    };

    const updateCondition = (condition: SmartAlertCondition) => {
        if (!setupType) return;
        const option = CONDITION_OPTIONS[setupType.type].find((item) => item.value === condition);
        setSetupDraft((current) => ({
            ...current,
            condition,
            thresholdKind: option?.thresholdKind || current.thresholdKind,
            threshold: option?.thresholdKind === 'percent'
                ? '20'
                : option?.thresholdKind === 'event'
                    ? 'Liquidity Event'
                    : option?.thresholdKind === 'severity'
                        ? 'High'
                        : current.thresholdKind === 'currency'
                            ? current.threshold
                            : '$50K'
        }));
        setFormError(null);
    };

    const requireLogin = (message: string) => setAuthPrompt(message);

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

    const runBackendCheck = useCallback(async () => {
        if (!user) return;

        try {
            const response = await fetch(apiUrl('/api/smart-alerts/run'), { method: 'POST' });
            if (!response.ok) return;
            setBackendStatus(await response.json());
        } catch {
            // Backend checks are operational plumbing; keep the user flow focused on alerts.
        }
    }, [user]);

    const createAlert = async () => {
        if (!setupType) return;
        const validationError = validateDraft(setupDraft);
        if (validationError) {
            setFormError(validationError);
            return;
        }

        if (!user) {
            requireLogin('Sign in to save Smart Alerts. The backend will keep checking them even when you are offline.');
            return;
        }

        setSaving(true);
        setError(null);
        setFormError(null);
        try {
            const triggerLabel = getAlertTrigger(setupType, setupDraft);
            const created = await SmartAlertService.createRule({
                alertType: setupType.type,
                target: setupDraft.target.trim() || 'Any token',
                chainId: setupDraft.chainId,
                tokenAddress: setupDraft.tokenAddress.trim() || null,
                condition: setupDraft.condition,
                thresholdKind: setupDraft.thresholdKind,
                threshold: setupDraft.thresholdKind === 'percent' && !setupDraft.threshold.includes('%')
                    ? `${setupDraft.threshold}%`
                    : setupDraft.threshold.trim(),
                triggerLabel,
                notificationChannels: setupDraft.notificationChannels,
                cooldownMinutes: setupDraft.cooldownMinutes
            });
            setRules((current) => [created, ...current]);
            closeSetupModal();
            await runBackendCheck();
        } catch (err: any) {
            setError(err?.message || 'Could not create alert.');
        } finally {
            setSaving(false);
        }
    };

    const previewTrigger = setupType ? getAlertTrigger(setupType, setupDraft) : '';

    return (
        <div className="relative z-10 mx-auto flex w-full max-w-7xl flex-col gap-6 pb-10 animate-fade-in">
            {error && (
                <div className="rounded-xl border border-primary-red/30 bg-primary-red/10 px-4 py-3 text-sm text-primary-red">
                    {error}
                </div>
            )}

            <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
                <div className="flex flex-col gap-6 lg:col-span-2">
                    <div className="flex flex-col gap-4">
                        <h3 className="flex items-center gap-2 text-lg font-bold text-text-light">
                            <Bell size={18} className="text-primary-green" />
                            Basic Alert Types
                        </h3>
                        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                            {BASIC_ALERT_TYPES.map((item) => (
                                <button
                                    key={item.type}
                                    type="button"
                                    onClick={() => openSetupModal(item)}
                                    className={`group cursor-pointer rounded-xl border p-5 text-left transition-colors hover:bg-card-hover ${activeType === item.type ? 'border-primary-green/40 bg-card-hover' : 'border-border bg-card hover:border-text-dark/50'}`}
                                >
                                    <div className="flex items-start gap-4">
                                        <div className="rounded-lg border border-border/50 bg-main p-3 text-primary-green">
                                            {item.icon}
                                        </div>
                                        <div>
                                            <h4 className="text-sm font-bold text-text-light group-hover:text-primary-green">{item.title}</h4>
                                            <p className="mt-1 text-xs leading-relaxed text-text-medium">{item.desc}</p>
                                        </div>
                                    </div>
                                </button>
                            ))}
                        </div>
                    </div>

                    <div className="flex flex-col gap-4">
                        <div className="flex items-center justify-between">
                            <h3 className="flex items-center gap-2 text-lg font-bold text-text-light">
                                <Bell size={18} />
                                Saved Alert Rules
                            </h3>
                            <button type="button" onClick={loadUserAlerts} className="text-xs font-bold text-text-dark hover:text-text-light">
                                Refresh
                            </button>
                        </div>

                        <div className="overflow-hidden rounded-xl border border-border bg-card">
                            <div className="custom-scrollbar max-h-[560px] overflow-y-auto">
                                {loadingAlerts ? (
                                    <div className="flex min-h-[180px] items-center justify-center gap-3 text-sm text-text-medium">
                                        <Loader2 size={18} className="animate-spin text-primary-green" />
                                        Loading alerts
                                    </div>
                                ) : feedItems.length ? (
                                    feedItems.map((rule) => (
                                        <div key={rule.id} className={`flex flex-col gap-3 border-b border-border/50 p-4 last:border-0 md:flex-row md:items-center md:justify-between ${!rule.enabled ? 'opacity-60' : ''}`}>
                                            <div className="flex min-w-0 items-start gap-4">
                                                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-border/60 bg-main text-primary-green">
                                                    {alertIcon(rule.alert_type)}
                                                </div>
                                                <div className="min-w-0">
                                                    <div className="truncate text-sm font-bold text-text-light">{rule.trigger_label}</div>
                                                    <div className="mt-2 flex flex-wrap gap-2">
                                                        <span className={`rounded border px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider ${typeStyle(rule.alert_type)}`}>{rule.alert_type}</span>
                                                        <span className="rounded border border-border bg-main px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-text-medium">{rule.enabled ? 'Active' : 'Paused'}</span>
                                                        <span className="rounded border border-border bg-main px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-text-medium">{rule.chain_id}</span>
                                                    </div>
                                                    <div className="mt-2 grid grid-cols-1 gap-x-4 gap-y-1 text-[11px] text-text-dark sm:grid-cols-3">
                                                        <span>Last checked: {formatRelativeTime(rule.last_checked_at)}</span>
                                                        <span>Last triggered: {formatRelativeTime(rule.last_triggered_at)}</span>
                                                        <span>Triggers: {rule.trigger_count}</span>
                                                        {rule.last_observed_value && <span>Observed: {rule.last_observed_value}</span>}
                                                        {rule.last_error && <span className="text-primary-red sm:col-span-2">{rule.last_error}</span>}
                                                    </div>
                                                </div>
                                            </div>
                                            <div className="flex items-center gap-3 self-end md:self-auto">
                                                <button type="button" onClick={() => toggleAlert(rule.id)} className="relative inline-flex cursor-pointer items-center" aria-label={rule.enabled ? 'Pause alert' : 'Activate alert'}>
                                                    <span className={`relative h-5 w-9 rounded-full border transition-colors after:absolute after:left-[2px] after:top-[2px] after:h-4 after:w-4 after:rounded-full after:border after:transition-all after:content-[''] ${rule.enabled ? 'border-primary-green bg-primary-green after:translate-x-full after:border-white after:bg-white' : 'border-text-dark/30 bg-main after:border-gray-300 after:bg-text-medium'}`} />
                                                </button>
                                                <button type="button" onClick={() => removeAlert(rule.id)} className="rounded-lg p-2 text-text-dark transition-colors hover:bg-primary-red/10 hover:text-primary-red" aria-label="Remove alert">
                                                    <X size={16} />
                                                </button>
                                            </div>
                                        </div>
                                    ))
                                ) : (
                                    <div className="flex min-h-[200px] flex-col items-center justify-center p-6 text-center">
                                        <Bell size={24} className="mb-3 text-primary-green" />
                                        <div className="text-sm font-bold text-text-light">No saved alerts yet</div>
                                        <div className="mt-1 max-w-sm text-xs text-text-medium">Create a rule and the backend will keep checking it while you are away.</div>
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
                    <div className="relative max-h-[680px] overflow-hidden rounded-xl border border-border bg-card">
                        <div className="custom-scrollbar max-h-[680px] space-y-1 overflow-y-auto p-5">
                            {historyItems.length ? historyItems.map((item, index) => (
                                <div key={item.id} className="flex gap-4">
                                    <div className={`mt-1.5 h-3.5 w-3.5 shrink-0 rounded-full border-[3px] border-card ${index === 0 ? 'bg-primary-green shadow-[0_0_8px_rgba(38,211,86,0.6)]' : 'bg-text-dark'}`} />
                                    <div className="flex-1 border-b border-border/30 pb-4 last:border-0">
                                        <div className="flex items-start justify-between gap-3">
                                            <h4 className="text-sm font-bold leading-tight text-text-light">{item.title}</h4>
                                            <span className="font-mono text-[10px] text-text-dark">{formatRelativeTime(item.created_at)}</span>
                                        </div>
                                        <p className="mt-1 text-xs leading-relaxed text-text-medium">{item.message}</p>
                                        <div className="mt-2 flex flex-wrap gap-2">
                                            <span className={`rounded border px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider ${typeStyle(item.alert_type)}`}>{item.alert_type}</span>
                                            {item.observed_value && <span className="rounded border border-border bg-main px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-text-medium">{item.observed_value}</span>}
                                        </div>
                                    </div>
                                </div>
                            )) : (
                                <div className="flex min-h-[240px] flex-col items-center justify-center text-center">
                                    <CheckCircle2 size={24} className="mb-3 text-text-dark" />
                                    <div className="text-sm font-bold text-text-light">No triggers yet</div>
                                    <p className="mt-1 text-xs text-text-medium">Backend-generated trigger events will appear here when saved rules match market data.</p>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </div>

            {setupType && (
                <div className="fixed inset-0 z-[1400] flex items-center justify-center bg-black/70 px-4 py-6 backdrop-blur-sm" onClick={closeSetupModal}>
                    <div className="max-h-[92vh] w-full max-w-xl overflow-hidden rounded-2xl border border-border bg-card shadow-2xl" onClick={(event) => event.stopPropagation()}>
                        <div className="flex items-start justify-between gap-4 border-b border-border p-5">
                            <div className="flex items-start gap-3">
                                <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border ${typeStyle(setupType.type)}`}>{setupType.icon}</div>
                                <div>
                                    <h3 className="text-lg font-bold text-text-light">Set {setupType.title}</h3>
                                    <p className="mt-1 text-sm text-text-medium">{setupType.desc}</p>
                                </div>
                            </div>
                            <button type="button" onClick={closeSetupModal} className="rounded-lg p-2 text-text-dark transition-colors hover:bg-card-hover hover:text-text-light" aria-label="Close alert setup">
                                <X size={18} />
                            </button>
                        </div>

                        <div className="custom-scrollbar max-h-[calc(92vh-152px)] space-y-5 overflow-y-auto p-5">
                            {formError && <div className="rounded-xl border border-primary-red/30 bg-primary-red/10 px-4 py-3 text-sm text-primary-red">{formError}</div>}

                            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                                <label className="block">
                                    <span className="mb-2 block text-xs font-bold uppercase tracking-wider text-text-medium">Target token or scope</span>
                                    <input value={setupDraft.target} onChange={(event) => setSetupDraft((current) => ({ ...current, target: event.target.value }))} className="w-full rounded-xl border border-border bg-main px-4 py-3 text-sm font-medium text-text-light outline-none placeholder:text-text-dark focus:border-primary-green/60" placeholder="SOL, ETH, Any token..." />
                                </label>
                                <label className="block">
                                    <span className="mb-2 block text-xs font-bold uppercase tracking-wider text-text-medium">Chain</span>
                                    <select value={setupDraft.chainId} onChange={(event) => setSetupDraft((current) => ({ ...current, chainId: event.target.value }))} className="w-full rounded-xl border border-border bg-main px-4 py-3 text-sm font-medium text-text-light outline-none focus:border-primary-green/60">
                                        {CHAIN_OPTIONS.map((chain) => <option key={chain.value} value={chain.value}>{chain.label}</option>)}
                                    </select>
                                </label>
                            </div>

                            <label className="block">
                                <span className="mb-2 block text-xs font-bold uppercase tracking-wider text-text-medium">Token or pair address</span>
                                <input value={setupDraft.tokenAddress} onChange={(event) => setSetupDraft((current) => ({ ...current, tokenAddress: event.target.value }))} className="w-full rounded-xl border border-border bg-main px-4 py-3 font-mono text-sm text-text-light outline-none placeholder:text-text-dark focus:border-primary-green/60" placeholder="Optional for Any token, recommended for precise alerts" />
                            </label>

                            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                                <label className="block">
                                    <span className="mb-2 block text-xs font-bold uppercase tracking-wider text-text-medium">Condition</span>
                                    <select value={setupDraft.condition} onChange={(event) => updateCondition(event.target.value as SmartAlertCondition)} className="w-full rounded-xl border border-border bg-main px-4 py-3 text-sm font-medium text-text-light outline-none focus:border-primary-green/60">
                                        {CONDITION_OPTIONS[setupType.type].map((condition) => <option key={condition.value} value={condition.value}>{condition.label}</option>)}
                                    </select>
                                </label>
                                <label className="block">
                                    <span className="mb-2 block text-xs font-bold uppercase tracking-wider text-text-medium">
                                        {setupDraft.thresholdKind === 'percent' ? 'Percentage' : setupDraft.thresholdKind === 'event' ? 'Event' : setupDraft.thresholdKind === 'severity' ? 'Severity' : 'Threshold'}
                                    </span>
                                    {VALUE_OPTIONS[setupType.type] ? (
                                        <select value={setupDraft.threshold} onChange={(event) => setSetupDraft((current) => ({ ...current, threshold: event.target.value }))} className="w-full rounded-xl border border-border bg-main px-4 py-3 text-sm font-medium text-text-light outline-none focus:border-primary-green/60">
                                            {VALUE_OPTIONS[setupType.type]?.map((value) => <option key={value} value={value}>{value}</option>)}
                                        </select>
                                    ) : (
                                        <div className="relative">
                                            <input value={setupDraft.threshold} onChange={(event) => setSetupDraft((current) => ({ ...current, threshold: event.target.value }))} className="w-full rounded-xl border border-border bg-main px-4 py-3 pr-10 text-sm font-medium text-text-light outline-none placeholder:text-text-dark focus:border-primary-green/60" placeholder={setupDraft.thresholdKind === 'percent' ? '20' : '$50K'} />
                                            {setupDraft.thresholdKind === 'percent' && <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-xs font-black text-text-medium">%</span>}
                                        </div>
                                    )}
                                </label>
                            </div>

                            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                                <label className="block">
                                    <span className="mb-2 block text-xs font-bold uppercase tracking-wider text-text-medium">Notify by</span>
                                    <div className="w-full rounded-xl border border-border bg-main px-4 py-3 text-sm font-medium text-text-light">In-app history</div>
                                </label>
                                <label className="block">
                                    <span className="mb-2 block text-xs font-bold uppercase tracking-wider text-text-medium">Cooldown</span>
                                    <select value={setupDraft.cooldownMinutes} onChange={(event) => setSetupDraft((current) => ({ ...current, cooldownMinutes: Number(event.target.value) }))} className="w-full rounded-xl border border-border bg-main px-4 py-3 text-sm font-medium text-text-light outline-none focus:border-primary-green/60">
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
                                <div className="mt-2 text-xs leading-relaxed text-text-medium">
                                    {setupDraft.thresholdKind === 'percent'
                                        ? 'The first backend check establishes a baseline. Future checks trigger when the value moves by this percentage.'
                                        : 'Saved alerts are evaluated by the backend even when you are signed out.'}
                                </div>
                            </div>
                        </div>

                        <div className="flex flex-col-reverse gap-3 border-t border-border p-5 sm:flex-row sm:justify-end">
                            <button type="button" onClick={closeSetupModal} className="rounded-xl border border-border px-5 py-3 text-sm font-bold text-text-medium transition-colors hover:bg-card-hover hover:text-text-light">Cancel</button>
                            <button type="button" onClick={createAlert} disabled={saving} className="inline-flex items-center justify-center gap-2 rounded-xl bg-primary-green px-5 py-3 text-sm font-bold text-black transition-colors hover:bg-primary-green/90 disabled:cursor-not-allowed disabled:opacity-60">
                                {saving && <Loader2 size={16} className="animate-spin" />}
                                {user ? 'Create Alert' : 'Sign in to Save'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {authPrompt && (
                <div className="fixed inset-0 z-[1500] flex items-center justify-center bg-black/70 px-4 py-6 backdrop-blur-sm" onClick={() => setAuthPrompt(null)}>
                    <div className="w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-2xl" onClick={(event) => event.stopPropagation()}>
                        <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl border border-primary-green/30 bg-primary-green/10 text-primary-green"><Bell size={22} /></div>
                        <h3 className="text-xl font-bold text-text-light">Save this alert</h3>
                        <p className="mt-2 text-sm leading-relaxed text-text-medium">{authPrompt}</p>
                        <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
                            <button type="button" onClick={() => setAuthPrompt(null)} className="rounded-xl border border-border px-5 py-3 text-sm font-bold text-text-medium transition-colors hover:bg-card-hover hover:text-text-light">Keep browsing</button>
                            <button type="button" onClick={() => navigate('/login', { state: { from: { pathname: '/smart-alerts' } } })} className="rounded-xl bg-primary-green px-5 py-3 text-sm font-bold text-black transition-colors hover:bg-primary-green/90">Sign in</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};
