// Supabase persistence helpers for user-owned Smart Alert rules and trigger history.
import { authSupabase } from './SupabaseClient';

export type SmartAlertType = 'Price' | 'Volume' | 'Liquidity' | 'Whale' | 'Alpha' | 'Risk';

export interface SmartAlertRule {
    id: string;
    user_id: string;
    alert_type: SmartAlertType;
    target: string;
    chain_id: string;
    token_address: string | null;
    condition: string;
    threshold: string;
    trigger_label: string;
    notification_channels: string[];
    cooldown_minutes: number;
    enabled: boolean;
    last_triggered_at: string | null;
    created_at: string;
    updated_at: string;
}

export interface SmartAlertTrigger {
    id: string;
    alert_rule_id: string | null;
    user_id: string;
    alert_type: SmartAlertType;
    title: string;
    message: string;
    observed_value: string | null;
    threshold: string | null;
    source: string;
    created_at: string;
}

export interface SmartAlertRuleInput {
    userId: string;
    alertType: SmartAlertType;
    target: string;
    chainId: string;
    tokenAddress?: string | null;
    condition: string;
    threshold: string;
    triggerLabel: string;
    notificationChannels: string[];
    cooldownMinutes: number;
}

const ALERT_RULE_COLUMNS = [
    'id',
    'user_id',
    'alert_type',
    'target',
    'chain_id',
    'token_address',
    'condition',
    'threshold',
    'trigger_label',
    'notification_channels',
    'cooldown_minutes',
    'enabled',
    'last_triggered_at',
    'created_at',
    'updated_at'
].join(',');

const ALERT_TRIGGER_COLUMNS = [
    'id',
    'alert_rule_id',
    'user_id',
    'alert_type',
    'title',
    'message',
    'observed_value',
    'threshold',
    'source',
    'created_at'
].join(',');

const requireSupabase = () => {
    if (!authSupabase) {
        throw new Error('Supabase is not configured for Smart Alerts.');
    }
    return authSupabase;
};

const normalizeChannels = (channels: unknown): string[] => {
    return Array.isArray(channels)
        ? channels.map((channel) => String(channel)).filter(Boolean)
        : ['in_app'];
};

const normalizeRule = (row: any): SmartAlertRule => ({
    id: row.id,
    user_id: row.user_id,
    alert_type: row.alert_type,
    target: row.target || 'Any token',
    chain_id: row.chain_id || 'solana',
    token_address: row.token_address || null,
    condition: row.condition || 'above',
    threshold: row.threshold || '',
    trigger_label: row.trigger_label || '',
    notification_channels: normalizeChannels(row.notification_channels),
    cooldown_minutes: Number(row.cooldown_minutes || 60),
    enabled: Boolean(row.enabled),
    last_triggered_at: row.last_triggered_at || null,
    created_at: row.created_at || new Date().toISOString(),
    updated_at: row.updated_at || new Date().toISOString()
});

const normalizeTrigger = (row: any): SmartAlertTrigger => ({
    id: row.id,
    alert_rule_id: row.alert_rule_id || null,
    user_id: row.user_id,
    alert_type: row.alert_type,
    title: row.title || 'Smart Alert',
    message: row.message || '',
    observed_value: row.observed_value || null,
    threshold: row.threshold || null,
    source: row.source || 'system',
    created_at: row.created_at || new Date().toISOString()
});

export const SmartAlertService = {
    listRules: async (userId: string): Promise<SmartAlertRule[]> => {
        const supabase = requireSupabase();
        const { data, error } = await supabase
            .from('alert_rules')
            .select(ALERT_RULE_COLUMNS)
            .eq('user_id', userId)
            .order('created_at', { ascending: false });

        if (error) throw error;
        return (data || []).map(normalizeRule);
    },

    createRule: async (input: SmartAlertRuleInput): Promise<SmartAlertRule> => {
        const supabase = requireSupabase();
        const { data, error } = await supabase
            .from('alert_rules')
            .insert({
                user_id: input.userId,
                alert_type: input.alertType,
                target: input.target || 'Any token',
                chain_id: input.chainId || 'solana',
                token_address: input.tokenAddress || null,
                condition: input.condition,
                threshold: input.threshold,
                trigger_label: input.triggerLabel,
                notification_channels: input.notificationChannels.length ? input.notificationChannels : ['in_app'],
                cooldown_minutes: input.cooldownMinutes || 60,
                enabled: true
            })
            .select(ALERT_RULE_COLUMNS)
            .single();

        if (error) throw error;
        return normalizeRule(data);
    },

    setRuleEnabled: async (ruleId: string, enabled: boolean): Promise<SmartAlertRule> => {
        const supabase = requireSupabase();
        const { data, error } = await supabase
            .from('alert_rules')
            .update({ enabled })
            .eq('id', ruleId)
            .select(ALERT_RULE_COLUMNS)
            .single();

        if (error) throw error;
        return normalizeRule(data);
    },

    deleteRule: async (ruleId: string): Promise<void> => {
        const supabase = requireSupabase();
        const { error } = await supabase
            .from('alert_rules')
            .delete()
            .eq('id', ruleId);

        if (error) throw error;
    },

    listTriggers: async (userId: string, limit = 25): Promise<SmartAlertTrigger[]> => {
        const supabase = requireSupabase();
        const { data, error } = await supabase
            .from('alert_triggers')
            .select(ALERT_TRIGGER_COLUMNS)
            .eq('user_id', userId)
            .order('created_at', { ascending: false })
            .limit(limit);

        if (error) throw error;
        return (data || []).map(normalizeTrigger);
    }
};
