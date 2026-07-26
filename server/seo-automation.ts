/**
 * SEO automation orchestration — the shared layer the cron scheduler AND the
 * admin "Run now" buttons both call, so they can't collide and both report the
 * same status.
 *
 * Two jobs:
 *   rank  — trackRankings() across every keyword with trackRankings=true
 *           (Google organic + Local Pack via Apify, + AI engines when keyed).
 *           Scheduled weekly. Needs APIFY_TOKEN.
 *   gmb   — pullGmbMetrics() for each configured Google Business Profile.
 *           Scheduled daily. Needs GOOGLE_GBP_* OAuth creds.
 *
 * Env-gated: a job self-activates only when its credentials are present, so the
 * scheduler stays quiet (no error spam) before go-live and turns itself on after
 * the creds are set + the server restarts.
 */
import { trackRankings } from './seo-rank-tracker';
import { pullGmbMetrics } from './seo-gmb-connector';

export const RANK_SCHEDULE = { cron: '0 4 * * 1', label: 'Weekly · Mondays 04:00' };
export const GMB_SCHEDULE = { cron: '0 5 * * *', label: 'Daily · 05:00' };

export function rankEnabled(): boolean {
    return !!(process.env.APIFY_TOKEN || process.env.APIFY_API_TOKEN);
}
export function gmbEnabled(): boolean {
    return !!(
        process.env.GOOGLE_GBP_CLIENT_ID &&
        process.env.GOOGLE_GBP_CLIENT_SECRET &&
        process.env.GOOGLE_GBP_REFRESH_TOKEN
    );
}

type JobKey = 'rank' | 'gmb';
interface JobState {
    running: boolean;
    lastRunAt: string | null;      // ISO — last time THIS process ran the job
    lastTrigger: 'cron' | 'manual' | null;
    lastResult: string | null;     // human summary of the last successful run
    lastError: string | null;
}
const state: Record<JobKey, JobState> = {
    rank: { running: false, lastRunAt: null, lastTrigger: null, lastResult: null, lastError: null },
    gmb: { running: false, lastRunAt: null, lastTrigger: null, lastResult: null, lastError: null },
};

/** Run the rank tracker. No-ops (logs) when disabled or already running. */
export async function runRankTracking(trigger: 'cron' | 'manual'): Promise<void> {
    if (!rankEnabled()) {
        console.log('[seo-automation] rank tracking skipped — APIFY_TOKEN not set');
        return;
    }
    if (state.rank.running) {
        console.log('[seo-automation] rank tracking already running — skipping this trigger');
        return;
    }
    state.rank.running = true;
    state.rank.lastTrigger = trigger;
    try {
        console.log(`[seo-automation] rank tracking start (${trigger})`);
        const s = await trackRankings({ concurrency: 2, delayMs: 1500 });
        state.rank.lastResult = `${s.processed} keywords · ${s.snapshotsWritten} snapshots · ${s.errors} errors`;
        state.rank.lastError = null;
        console.log(`[seo-automation] rank tracking done: ${state.rank.lastResult}`);
    } catch (e) {
        state.rank.lastError = e instanceof Error ? e.message : String(e);
        console.error('[seo-automation] rank tracking failed:', e);
    } finally {
        state.rank.running = false;
        state.rank.lastRunAt = new Date().toISOString();
    }
}

/** Run the GMB metrics pull. No-ops (logs) when disabled or already running. */
export async function runGmbPull(trigger: 'cron' | 'manual'): Promise<void> {
    if (!gmbEnabled()) {
        console.log('[seo-automation] GMB pull skipped — GOOGLE_GBP_* not set');
        return;
    }
    if (state.gmb.running) {
        console.log('[seo-automation] GMB pull already running — skipping this trigger');
        return;
    }
    state.gmb.running = true;
    state.gmb.lastTrigger = trigger;
    try {
        console.log(`[seo-automation] GMB pull start (${trigger})`);
        const results = await pullGmbMetrics();
        state.gmb.lastResult = `${results.length} location(s) updated`;
        state.gmb.lastError = null;
        console.log(`[seo-automation] GMB pull done: ${state.gmb.lastResult}`);
    } catch (e) {
        state.gmb.lastError = e instanceof Error ? e.message : String(e);
        console.error('[seo-automation] GMB pull failed:', e);
    } finally {
        state.gmb.running = false;
        state.gmb.lastRunAt = new Date().toISOString();
    }
}

/** Snapshot of both jobs for the admin dashboard. */
export function getAutomationStatus() {
    return {
        rank: { key: 'rank', enabled: rankEnabled(), schedule: RANK_SCHEDULE.label, ...state.rank },
        gmb: { key: 'gmb', enabled: gmbEnabled(), schedule: GMB_SCHEDULE.label, ...state.gmb },
    };
}
