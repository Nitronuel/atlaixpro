import { APP_CONFIG } from '../config';

export type AiAssistantNotificationTone = 'bullish' | 'bearish' | 'neutral' | 'risk';

export type AiAssistantNotification = {
    id: string;
    title: string;
    body: string;
    tone: AiAssistantNotificationTone;
    href?: string;
    timestamp: number;
};

export type AiAssistantAction = {
    label: string;
    href: string;
    kind?: 'navigate' | 'draft' | 'confirmable';
    confirmationRequired?: boolean;
    payload?: unknown;
};

export type AiAssistantProvider = {
    configured: boolean;
    model: string | null;
    mode: 'model-ready' | 'local-tool-router';
};

export type AiAssistantChatResponse = {
    id: string;
    role: 'assistant';
    answer: string;
    tool?: string;
    data?: unknown;
    actions?: AiAssistantAction[];
    provider: AiAssistantProvider;
    createdAt: string;
};

export type AiAssistantConversationMessage = {
    role: 'user' | 'assistant';
    text: string;
};

const apiUrl = (path: string) => `${APP_CONFIG.apiBaseUrl || ''}${path}`;

const fetchJson = async <T>(input: RequestInfo | URL, init?: RequestInit): Promise<T> => {
    const response = await fetch(input, init);
    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
        throw new Error(typeof payload?.error === 'string' ? payload.error : 'Assistant request failed.');
    }

    return payload as T;
};

export const AiAssistantService = {
    getNotifications: async () => {
        return fetchJson<{
            notifications: AiAssistantNotification[];
            provider: AiAssistantProvider;
            generatedAt: string;
        }>(apiUrl('/api/ai-assistant/notifications'));
    },

    sendMessage: async (message: string, history: AiAssistantConversationMessage[] = []) => {
        return fetchJson<AiAssistantChatResponse>(apiUrl('/api/ai-assistant/chat'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message, history: history.slice(-12) })
        });
    }
};
