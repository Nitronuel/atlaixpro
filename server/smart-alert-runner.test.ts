import { describe, expect, it } from 'vitest';
import { SmartAlertRunner } from './smart-alert-runner';

const restoreEnv = (key: string, value: string | undefined) => {
    if (value === undefined) {
        delete process.env[key];
        return;
    }
    process.env[key] = value;
};

describe('SmartAlertRunner', () => {
    it('reports a clear backend configuration error when service-role credentials are missing', async () => {
        const previousUrl = process.env.SUPABASE_URL;
        const previousViteUrl = process.env.VITE_SUPABASE_URL;
        const previousServiceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;
        const previousServiceKey = process.env.SUPABASE_SERVICE_KEY;

        delete process.env.SUPABASE_URL;
        delete process.env.VITE_SUPABASE_URL;
        delete process.env.SUPABASE_SERVICE_ROLE_KEY;
        delete process.env.SUPABASE_SERVICE_KEY;

        const runner = new SmartAlertRunner();
        const status = await runner.runNow();

        expect(status.lastRunStatus).toBe('error');
        expect(status.lastError).toContain('Supabase service-role credentials');

        restoreEnv('SUPABASE_URL', previousUrl);
        restoreEnv('VITE_SUPABASE_URL', previousViteUrl);
        restoreEnv('SUPABASE_SERVICE_ROLE_KEY', previousServiceRole);
        restoreEnv('SUPABASE_SERVICE_KEY', previousServiceKey);
    });
});
