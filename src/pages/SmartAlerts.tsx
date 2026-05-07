// Route-level product screen for the Atlaix application.
import React, { useState } from 'react';
import {
    Activity,
    AlertTriangle,
    Bell,
    Clock,
    Flame,
    ShieldCheck,
    TrendingUp,
    Wallet,
    X
} from 'lucide-react';

type AlertType = 'Price' | 'Volume' | 'Liquidity' | 'Whale' | 'Alpha' | 'Risk';

interface BasicAlertType {
    title: string;
    desc: string;
    example: string;
    type: AlertType;
    metric: string;
    icon: React.ReactNode;
}

interface AlertFeedItem {
    id: number;
    trigger: string;
    type: AlertType;
    target: string;
    status: boolean;
    lastTriggered: string;
}

interface AlertSetupDraft {
    target: string;
    condition: string;
    value: string;
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

const INITIAL_ALERTS: AlertFeedItem[] = [
    { id: 1, trigger: 'ETH price above $3,500', type: 'Price', target: 'ETH', status: true, lastTriggered: '2 hours ago' },
    { id: 2, trigger: 'Whale buy above $50K', type: 'Whale', target: 'Any token', status: true, lastTriggered: '1 day ago' },
    { id: 3, trigger: 'SOL 24h volume above $1B', type: 'Volume', target: 'SOL', status: false, lastTriggered: 'Never' }
];

const TRIGGER_HISTORY = [
    { id: 1, title: 'ETH Price Alert', time: '10:42 AM', description: 'ETH crossed $3,450.', type: 'Price' },
    { id: 2, title: 'Whale Buy', time: '09:15 AM', description: 'A tracked wallet bought more than $50K.', type: 'Whale' },
    { id: 3, title: 'Risk Flag', time: 'Yesterday', description: 'A token received a high-risk signal.', type: 'Risk' },
    { id: 4, title: 'Volume Spike', time: 'Yesterday', description: 'BONK volume moved above its alert threshold.', type: 'Volume' },
    { id: 5, title: 'Alpha Event', time: '2 days ago', description: 'A token entered the Live Alpha Feed.', type: 'Alpha' }
] as const;

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

const SETUP_DEFAULTS: Record<AlertType, AlertSetupDraft> = {
    Price: { target: 'SOL', condition: 'above', value: '$200' },
    Volume: { target: 'Any token', condition: 'above', value: '$1M' },
    Liquidity: { target: 'Any token', condition: 'below', value: '$100K' },
    Whale: { target: 'Any token', condition: 'buy above', value: '$50K' },
    Alpha: { target: 'Any token', condition: 'event is', value: 'Liquidity Event' },
    Risk: { target: 'Any token', condition: 'risk is', value: 'High' }
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

export const SmartAlerts: React.FC = () => {
    const [activeType, setActiveType] = useState<AlertType>('Price');
    const [alertFeed, setAlertFeed] = useState<AlertFeedItem[]>(INITIAL_ALERTS);
    const [setupType, setSetupType] = useState<BasicAlertType | null>(null);
    const [setupDraft, setSetupDraft] = useState<AlertSetupDraft>(SETUP_DEFAULTS.Price);

    const toggleAlert = (id: number) => {
        setAlertFeed((current) => current.map((alert) => alert.id === id ? { ...alert, status: !alert.status } : alert));
    };

    const removeAlert = (id: number) => {
        setAlertFeed((current) => current.filter((alert) => alert.id !== id));
    };

    const openSetupModal = (item: BasicAlertType) => {
        setActiveType(item.type);
        setSetupType(item);
        setSetupDraft(SETUP_DEFAULTS[item.type]);
    };

    const closeSetupModal = () => {
        setSetupType(null);
    };

    const createAlert = () => {
        if (!setupType) return;

        const trigger = getAlertTrigger(setupType, setupDraft);
        const target = setupDraft.target.trim() || 'Any token';

        setAlertFeed((current) => [
            {
                id: Date.now(),
                trigger,
                type: setupType.type,
                target,
                status: true,
                lastTriggered: 'Never'
            },
            ...current
        ]);
        closeSetupModal();
    };

    const previewTrigger = setupType ? getAlertTrigger(setupType, setupDraft) : '';

    return (
        <div className="relative z-10 mx-auto flex w-full max-w-7xl flex-col gap-8 pb-10 animate-fade-in">
            <div className="grid grid-cols-1 gap-6 md:gap-8 lg:grid-cols-3">
                <div className="flex flex-col gap-8 lg:col-span-2">
                    <div className="flex flex-col gap-4">
                        <div className="flex items-center justify-between">
                            <h3 className="flex items-center gap-2 text-lg font-bold text-text-light">
                                <Bell size={18} className="text-primary-green" />
                                Basic Alert Types
                            </h3>
                        </div>

                        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                            {BASIC_ALERT_TYPES.map((item) => (
                                <div
                                    key={item.type}
                                    onClick={() => openSetupModal(item)}
                                    className={`group relative cursor-pointer overflow-hidden rounded-xl border p-5 transition-all duration-300 hover:bg-card-hover ${activeType === item.type ? 'border-primary-green/40 bg-card-hover' : 'border-border bg-card hover:border-text-dark/50'}`}
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
                                </div>
                            ))}
                        </div>
                    </div>

                    <div className="flex flex-1 flex-col gap-4">
                        <div className="flex items-center justify-between">
                            <h3 className="flex items-center gap-2 text-lg font-bold text-text-light">
                                <Bell size={18} className="text-text-light" />
                                Alert Feed
                            </h3>
                            <button className="flex items-center gap-1 text-xs font-medium text-text-dark transition-colors hover:text-text-light">
                                Manage All
                            </button>
                        </div>

                        <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
                            <div className="custom-scrollbar max-h-[520px] overflow-y-auto">
                                {alertFeed.map((alert) => (
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
                                ))}
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
                            {TRIGGER_HISTORY.map((item, index) => (
                                <div key={item.id} className="group flex gap-4">
                                    <div className={`relative z-10 mt-1.5 box-content h-3.5 w-3.5 shrink-0 rounded-full border-[3px] border-card ${index === 0 ? 'bg-primary-green shadow-[0_0_8px_rgba(38,211,86,0.6)]' : 'bg-text-dark'}`}></div>

                                    <div className="flex-1 border-b border-border/30 pb-3 transition-all group-hover:pl-1 last:border-0">
                                        <div className="flex items-start justify-between gap-3">
                                            <h4 className="text-sm font-bold leading-tight text-text-light">{item.title}</h4>
                                            <span className="font-mono text-[10px] text-text-dark">{item.time}</span>
                                        </div>
                                        <p className="mt-1 text-xs text-text-medium">{item.description}</p>
                                        <button className="mt-2 flex items-center gap-1 text-[10px] font-bold text-primary-green opacity-0 transition-opacity group-hover:opacity-100">
                                            View Details
                                        </button>
                                    </div>
                                </div>
                            ))}

                            <div className="relative z-10 flex justify-center bg-card pt-4">
                                <button className="text-xs text-text-dark transition-colors hover:text-text-light">Load older alerts</button>
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
                            <label className="block">
                                <span className="mb-2 block text-xs font-bold uppercase tracking-wider text-text-medium">
                                    Target token or scope
                                </span>
                                <input
                                    value={setupDraft.target}
                                    onChange={(event) => setSetupDraft((current) => ({ ...current, target: event.target.value }))}
                                    className="w-full rounded-xl border border-border bg-main px-4 py-3 text-sm font-medium text-text-light outline-none transition-colors placeholder:text-text-dark focus:border-primary-green/60"
                                    placeholder="SOL, ETH, Any token, tracked wallet..."
                                />
                            </label>

                            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                                <label className="block">
                                    <span className="mb-2 block text-xs font-bold uppercase tracking-wider text-text-medium">
                                        Condition
                                    </span>
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

                            <div className="rounded-xl border border-border bg-main p-4">
                                <div className="text-xs font-bold uppercase tracking-wider text-text-dark">Preview</div>
                                <div className="mt-2 text-sm font-bold text-text-light">{previewTrigger}</div>
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
                                className="rounded-xl bg-primary-green px-5 py-3 text-sm font-bold text-black transition-colors hover:bg-primary-green/90"
                            >
                                Create Alert
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};
