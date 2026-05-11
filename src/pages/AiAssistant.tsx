import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    AlertTriangle,
    ArrowRight,
    Bell,
    CheckCircle2,
    Loader2,
    RefreshCw,
    Search,
    Send,
    ShieldCheck
} from 'lucide-react';
import {
    AiAssistantAction,
    AiAssistantConversationMessage,
    AiAssistantNotification,
    AiAssistantProvider,
    AiAssistantService
} from '../services/AiAssistantService';

type ChatMessage = {
    id: string;
    role: 'user' | 'assistant';
    text: string;
    tool?: string;
    actions?: AiAssistantAction[];
    createdAt: number;
};

type ChatMenuItem = {
    id: 'assistant' | 'announcements';
    title: string;
    subtitle: string;
    meta: string;
    icon: React.ReactNode;
    active?: boolean;
    unread?: number;
};

const SUGGESTED_PROMPTS = [
    'Latest detections',
    'Run Safe Scan',
    'Set alert',
    'Token activity'
];

const OFFICIAL_ANNOUNCEMENTS: AiAssistantNotification[] = [];
const ASSISTANT_CHAT_CACHE_KEY = 'atlaix-ai-assistant-chat-v1';
const ASSISTANT_CHAT_TTL_MS = 60 * 60 * 1000;

type AssistantChatCache = {
    messages: ChatMessage[];
    draft: string;
    activeMenu: 'assistant' | 'announcements';
    provider: AiAssistantProvider | null;
    savedAt: number;
};

const createWelcomeMessage = (): ChatMessage => ({
    id: 'welcome',
    role: 'assistant',
    text: 'Hey, I am Atlaix AI. You can talk to me normally, and when the conversation touches tokens, wallets, risk, alerts, or market activity, I can help turn it into an Atlaix workflow.',
    tool: 'conversation',
    createdAt: Date.now()
});

const canUseLocalStorage = () => typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';

const loadAssistantChatCache = (): AssistantChatCache | null => {
    if (!canUseLocalStorage()) return null;

    try {
        const raw = window.localStorage.getItem(ASSISTANT_CHAT_CACHE_KEY);
        if (!raw) return null;

        const parsed = JSON.parse(raw) as AssistantChatCache;
        if (!Array.isArray(parsed.messages) || typeof parsed.savedAt !== 'number') return null;
        if (Date.now() - parsed.savedAt > ASSISTANT_CHAT_TTL_MS) {
            window.localStorage.removeItem(ASSISTANT_CHAT_CACHE_KEY);
            return null;
        }

        return {
            messages: parsed.messages.filter((message) => message?.id && message?.role && message?.text).slice(-40),
            draft: typeof parsed.draft === 'string' ? parsed.draft : '',
            activeMenu: parsed.activeMenu === 'announcements' ? 'announcements' : 'assistant',
            provider: parsed.provider || null,
            savedAt: parsed.savedAt
        };
    } catch {
        return null;
    }
};

const saveAssistantChatCache = (cache: Omit<AssistantChatCache, 'savedAt'>) => {
    if (!canUseLocalStorage()) return;

    try {
        window.localStorage.setItem(ASSISTANT_CHAT_CACHE_KEY, JSON.stringify({
            ...cache,
            messages: cache.messages.slice(-40),
            savedAt: Date.now()
        }));
    } catch {
        // Chat persistence is a convenience; do not interrupt the assistant if storage is unavailable.
    }
};

const splitLines = (text: string) => text.split('\n').filter(Boolean);

const toConversationHistory = (messages: ChatMessage[]): AiAssistantConversationMessage[] =>
    messages.map((message) => ({
        role: message.role,
        text: message.text
    }));

const formatRelative = (timestamp: number) => {
    const diff = Math.max(0, Date.now() - timestamp);
    const minutes = Math.floor(diff / 60_000);
    if (minutes < 1) return 'now';
    if (minutes < 60) return `${minutes}m`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h`;
    return `${Math.floor(hours / 24)}d`;
};

const formatClock = (timestamp: number) => new Intl.DateTimeFormat('en-US', {
    hour: '2-digit',
    minute: '2-digit'
}).format(new Date(timestamp));

const toolLabel = (tool?: string) => {
    if (tool === 'run_safe_scan') return 'Safe Scan';
    if (tool === 'detection_updates') return 'Detection';
    if (tool === 'get_token_activity') return 'Token Activity';
    if (tool === 'get_smart_alert_status') return 'Smart Alerts';
    if (tool === 'alert_setup') return 'Smart Alerts';
    if (tool === 'error') return 'Needs Attention';
    return 'Atlaix AI';
};

const toolIcon = (tool?: string) => {
    if (tool === 'run_safe_scan') return <ShieldCheck size={15} />;
    if (tool === 'detection_updates') return <CheckCircle2 size={15} />;
    if (tool === 'get_smart_alert_status' || tool === 'alert_setup') return <Bell size={15} />;
    if (tool === 'error') return <AlertTriangle size={15} />;
    return <img src="/logo.png" alt="Atlaix" className="h-4 w-4 object-contain" />;
};

const notificationToneClass = (tone: AiAssistantNotification['tone']) => {
    if (tone === 'risk') return 'text-primary-red';
    if (tone === 'bearish') return 'text-primary-yellow';
    if (tone === 'bullish') return 'text-primary-green';
    return 'text-text-medium';
};

const promptToMessage = (prompt: string) => {
    if (prompt === 'Latest detections') return 'Show me the latest Detection Engine updates';
    if (prompt === 'Run Safe Scan') return 'Run a Safe Scan on a token';
    if (prompt === 'Set alert') return 'Help me set an alert for a token';
    return 'Show me token activity for a token';
};

export const AiAssistant: React.FC = () => {
    const navigate = useNavigate();
    const cachedChatRef = useRef<AssistantChatCache | null>(loadAssistantChatCache());
    const [notifications, setNotifications] = useState<AiAssistantNotification[]>([]);
    const [provider, setProvider] = useState<AiAssistantProvider | null>(cachedChatRef.current?.provider || null);
    const [activeMenu, setActiveMenu] = useState<'assistant' | 'announcements'>(cachedChatRef.current?.activeMenu || 'assistant');
    const [loadingNotifications, setLoadingNotifications] = useState(true);
    const [notificationError, setNotificationError] = useState('');
    const [messages, setMessages] = useState<ChatMessage[]>(cachedChatRef.current?.messages?.length ? cachedChatRef.current.messages : [createWelcomeMessage()]);
    const [draft, setDraft] = useState(cachedChatRef.current?.draft || '');
    const [sending, setSending] = useState(false);
    const messagesEndRef = useRef<HTMLDivElement | null>(null);

    const loadNotifications = async () => {
        setLoadingNotifications(true);
        setNotificationError('');
        try {
            const payload = await AiAssistantService.getNotifications();
            setNotifications(OFFICIAL_ANNOUNCEMENTS);
            setProvider(payload.provider);
        } catch (error) {
            setNotifications(OFFICIAL_ANNOUNCEMENTS);
            setNotificationError('');
        } finally {
            setLoadingNotifications(false);
        }
    };

    useEffect(() => {
        loadNotifications();
    }, []);

    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }, [messages, sending]);

    useEffect(() => {
        saveAssistantChatCache({ messages, draft, activeMenu, provider });
    }, [activeMenu, draft, messages, provider]);

    const goToAction = (href: string) => {
        if (href.startsWith('/')) {
            navigate(href);
            return;
        }
        window.open(href, '_blank', 'noopener,noreferrer');
    };

    const sendMessage = async (text = draft) => {
        const trimmed = text.trim();
        if (!trimmed || sending) return;

        const history = toConversationHistory(messages);
        const userMessage: ChatMessage = {
            id: `user-${Date.now()}`,
            role: 'user',
            text: trimmed,
            createdAt: Date.now()
        };

        setDraft('');
        setSending(true);
        setMessages((current) => [...current, userMessage]);

        try {
            const response = await AiAssistantService.sendMessage(trimmed, history);
            setProvider(response.provider);
            setMessages((current) => [
                ...current,
                {
                    id: response.id,
                    role: 'assistant',
                    text: response.answer,
                    tool: response.tool,
                    actions: response.actions || [],
                    createdAt: new Date(response.createdAt).getTime() || Date.now()
                }
            ]);
        } catch (error) {
            setMessages((current) => [
                ...current,
                {
                    id: `assistant-error-${Date.now()}`,
                    role: 'assistant',
                    text: error instanceof Error ? error.message : 'I could not complete that request.',
                    tool: 'error',
                    createdAt: Date.now()
                }
            ]);
        } finally {
            setSending(false);
        }
    };

    const chatItems: ChatMenuItem[] = [
        {
            id: 'assistant',
            title: 'Atlaix AI',
            subtitle: messages[messages.length - 1]?.text || 'Ready to help',
            meta: '',
            icon: <img src="/logo.png" alt="Atlaix" className="h-5 w-5 object-contain" />,
            active: activeMenu === 'assistant'
        },
        {
            id: 'announcements',
            title: 'Announcements',
            subtitle: notifications[0]?.body || 'Official updates from Atlaix',
            meta: notifications[0] ? formatRelative(notifications[0].timestamp) : '',
            icon: <Bell size={18} />,
            active: activeMenu === 'announcements',
            unread: notifications.length || undefined
        }
    ];

    return (
        <div className="h-[calc(100vh-132px)] overflow-hidden rounded-xl border border-border bg-card">
            <div className="grid h-full grid-cols-1 lg:grid-cols-[340px_minmax(0,1fr)]">
                <aside className="flex min-h-0 flex-col border-b border-border bg-main/40 lg:border-b-0 lg:border-r">
                    <div className="border-b border-border p-4">
                        <div className="mb-4 flex items-center justify-between gap-3">
                            <div>
                                <h2 className="mt-1 text-xl font-bold text-text-light">Chats</h2>
                            </div>
                            <button
                                type="button"
                                onClick={loadNotifications}
                                className="flex h-9 w-9 items-center justify-center rounded-full border border-border text-text-medium transition-colors hover:border-primary-green hover:text-primary-green"
                                aria-label="Refresh assistant feed"
                            >
                                <RefreshCw size={16} className={loadingNotifications ? 'animate-spin' : ''} />
                            </button>
                        </div>
                        <div className="flex h-10 items-center gap-2 rounded-full border border-border bg-card px-4 text-text-medium">
                            <Search size={16} />
                            <span className="text-sm font-medium text-text-dark">Search chats</span>
                        </div>
                    </div>

                    <div className="min-h-0 flex-1 overflow-y-auto p-2">
                        {chatItems.map((item) => (
                            <button
                                key={item.id}
                                type="button"
                                onClick={() => setActiveMenu(item.id)}
                                className={`flex w-full items-center gap-3 rounded-lg p-3 text-left transition-colors ${
                                    item.active
                                        ? 'bg-primary-green/10 text-text-light'
                                        : 'text-text-medium hover:bg-card-hover hover:text-text-light'
                                }`}
                            >
                                <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full border ${
                                    item.active ? 'border-primary-green/40 bg-primary-green/10 text-primary-green' : 'border-border bg-card text-text-medium'
                                }`}>
                                    {item.icon}
                                </div>
                                <div className="min-w-0 flex-1">
                                    <div className="flex items-center justify-between gap-2">
                                        <div className="truncate text-sm font-bold">{item.title}</div>
                                        {item.meta && <div className="shrink-0 text-[10px] font-mono text-text-dark">{item.meta}</div>}
                                    </div>
                                    <div className="mt-0.5 line-clamp-1 text-xs text-text-dark">{item.subtitle}</div>
                                </div>
                                {item.unread ? (
                                    <div className="flex h-5 min-w-5 items-center justify-center rounded-full bg-primary-green px-1.5 text-[10px] font-bold text-black">
                                        {item.unread}
                                    </div>
                                ) : null}
                            </button>
                        ))}
                    </div>
                </aside>

                <section className="flex min-h-0 flex-col bg-main">
                    <header className="flex h-17 shrink-0 items-center justify-between border-b border-border bg-card px-5 py-3">
                        <div className="flex min-w-0 items-center gap-3">
                            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-primary-green/40 bg-primary-green/10 text-primary-green">
                                {activeMenu === 'announcements' ? <Bell size={21} /> : <img src="/logo.png" alt="Atlaix" className="h-6 w-6 object-contain" />}
                            </div>
                            <div className="min-w-0">
                                <h2 className="truncate text-base font-bold text-text-light">
                                    {activeMenu === 'announcements' ? 'Announcements' : 'Atlaix AI'}
                                </h2>
                                <div className="mt-0.5 flex items-center gap-2 text-xs font-medium text-text-medium">
                                    <span className="h-2 w-2 rounded-full bg-primary-green" />
                                    {activeMenu === 'announcements' ? `${notifications.length} updates` : 'Online'}
                                </div>
                            </div>
                        </div>
                        <div className="hidden text-right text-xs text-text-dark sm:block">
                            {activeMenu === 'announcements' ? 'Platform notices' : 'Smart app guidance'}
                        </div>
                    </header>

                    <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-6">
                        {activeMenu === 'announcements' ? (
                            <div className="mx-auto max-w-4xl">
                                <div className="mb-4 flex items-center justify-between gap-3">
                                    <div>
                                        <h3 className="text-lg font-bold text-text-light">Latest Announcements</h3>
                                        <p className="mt-1 text-sm font-medium text-text-medium">
                                            Official product notes and user-facing updates from Atlaix.
                                        </p>
                                    </div>
                                    <button
                                        type="button"
                                        onClick={loadNotifications}
                                        className="flex h-9 w-9 items-center justify-center rounded-full border border-border text-text-medium transition-colors hover:border-primary-green hover:text-primary-green"
                                        aria-label="Refresh announcements"
                                    >
                                        <RefreshCw size={16} className={loadingNotifications ? 'animate-spin' : ''} />
                                    </button>
                                </div>
                                {notificationError && (
                                    <div className="rounded-lg border border-primary-red/30 bg-primary-red/10 p-4 text-sm font-semibold text-primary-red">
                                        {notificationError}
                                    </div>
                                )}
                                {!notificationError && loadingNotifications && (
                                    <div className="flex items-center gap-2 rounded-lg border border-border bg-card p-4 text-sm font-semibold text-text-medium">
                                        <Loader2 size={16} className="animate-spin" /> Loading announcements
                                    </div>
                                )}
                                {!notificationError && !loadingNotifications && notifications.length === 0 && (
                                    <div className="rounded-lg border border-border bg-card p-5 text-sm font-semibold text-text-medium">
                                        No announcements have been published yet.
                                    </div>
                                )}
                                <div className="grid gap-3">
                                    {!notificationError && !loadingNotifications && notifications.map((item) => (
                                        <button
                                            key={item.id}
                                            type="button"
                                            onClick={() => item.href && goToAction(item.href)}
                                            className="rounded-lg border border-border bg-card p-4 text-left transition-colors hover:border-primary-green/50 hover:bg-card-hover"
                                        >
                                            <div className="flex items-start justify-between gap-3">
                                                <div>
                                                    <div className="text-sm font-bold text-text-light">{item.title}</div>
                                                    <div className={`mt-2 text-sm font-semibold leading-relaxed ${notificationToneClass(item.tone)}`}>{item.body}</div>
                                                </div>
                                                <div className="shrink-0 text-[11px] font-mono text-text-dark">{formatRelative(item.timestamp)}</div>
                                            </div>
                                        </button>
                                    ))}
                                </div>
                            </div>
                        ) : (
                        <div className="mx-auto flex max-w-4xl flex-col gap-3">
                            <div className="mx-auto mb-2 rounded-full border border-border bg-card px-3 py-1 text-[11px] font-bold uppercase tracking-wide text-text-dark">
                                Today
                            </div>

                            {messages.map((message) => {
                                const isUser = message.role === 'user';
                                return (
                                    <div key={message.id} className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
                                        <div className={`flex max-w-[82%] gap-2 ${isUser ? 'flex-row-reverse' : 'flex-row'}`}>
                                            {!isUser && (
                                                <div className="mt-auto flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-border bg-card text-primary-green">
                                                    {toolIcon(message.tool)}
                                                </div>
                                            )}
                                            <div className={`rounded-2xl px-4 py-3 shadow-sm ${
                                                isUser
                                                    ? 'rounded-br-md bg-primary-green text-black'
                                                    : 'rounded-bl-md border border-border bg-card text-text-light'
                                            }`}>
                                                {!isUser && (
                                                    <div className="mb-2 text-[10px] font-bold uppercase tracking-wide text-primary-green">
                                                        {toolLabel(message.tool)}
                                                    </div>
                                                )}
                                                <div className={`space-y-2 text-sm leading-relaxed ${isUser ? 'font-semibold' : 'font-medium'}`}>
                                                    {splitLines(message.text).map((line, index) => (
                                                        <p key={index}>{line}</p>
                                                    ))}
                                                </div>
                                                {message.actions && message.actions.length > 0 && (
                                                    <div className="mt-3 flex flex-wrap gap-2">
                                                        {message.actions.map((action) => (
                                                            <button
                                                                key={`${message.id}-${action.href}`}
                                                                type="button"
                                                                onClick={() => goToAction(action.href)}
                                                                className="inline-flex items-center gap-2 rounded-full border border-primary-green/30 bg-primary-green/10 px-3 py-1.5 text-xs font-bold text-primary-green transition-colors hover:border-primary-green"
                                                            >
                                                                {action.label} <ArrowRight size={13} />
                                                            </button>
                                                        ))}
                                                    </div>
                                                )}
                                                <div className={`mt-2 text-right text-[10px] ${isUser ? 'text-black/60' : 'text-text-dark'}`}>
                                                    {formatClock(message.createdAt)}
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}

                            {sending && (
                                <div className="flex justify-start">
                                    <div className="flex items-end gap-2">
                                        <div className="flex h-8 w-8 items-center justify-center rounded-full border border-border bg-card text-primary-green">
                                            <img src="/logo.png" alt="Atlaix" className="h-4 w-4 object-contain" />
                                        </div>
                                        <div className="rounded-2xl rounded-bl-md border border-border bg-card px-4 py-3 text-sm font-semibold text-text-medium">
                                            <Loader2 size={15} className="mr-2 inline animate-spin" />
                                            Thinking
                                        </div>
                                    </div>
                                </div>
                            )}
                            <div ref={messagesEndRef} />
                        </div>
                        )}
                    </div>

                    {activeMenu === 'assistant' && <div className="shrink-0 border-t border-border bg-card p-4">
                        <div className="mx-auto max-w-4xl">
                            <div className="mb-3 flex gap-2 overflow-x-auto pb-1">
                                {SUGGESTED_PROMPTS.map((prompt) => (
                                    <button
                                        key={prompt}
                                        type="button"
                                        onClick={() => sendMessage(promptToMessage(prompt))}
                                        disabled={sending}
                                        className="shrink-0 rounded-full border border-border bg-main px-3 py-1.5 text-xs font-bold text-text-medium transition-colors hover:border-primary-green hover:text-primary-green disabled:cursor-not-allowed disabled:opacity-60"
                                    >
                                        {prompt}
                                    </button>
                                ))}
                            </div>
                            <form
                                onSubmit={(event) => {
                                    event.preventDefault();
                                    sendMessage();
                                }}
                            >
                                <div className="flex items-end gap-3">
                                    <textarea
                                        value={draft}
                                        onChange={(event) => setDraft(event.target.value)}
                                        onKeyDown={(event) => {
                                            if (event.key === 'Enter' && !event.shiftKey) {
                                                event.preventDefault();
                                                sendMessage();
                                            }
                                        }}
                                        placeholder="Message Atlaix AI"
                                        className="max-h-32 min-h-[46px] flex-1 resize-none rounded-2xl border border-border bg-main px-4 py-3 text-sm font-medium text-text-light outline-none transition-colors placeholder:text-text-dark focus:border-primary-green/60"
                                    />
                                    <button
                                        type="submit"
                                        disabled={!draft.trim() || sending}
                                        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-primary-green text-black transition-colors hover:bg-primary-green/90 disabled:cursor-not-allowed disabled:opacity-50"
                                        aria-label="Send assistant message"
                                    >
                                        <Send size={18} />
                                    </button>
                                </div>
                            </form>
                        </div>
                    </div>}
                </section>
            </div>
        </div>
    );
};
