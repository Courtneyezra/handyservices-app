/**
 * Go-live readiness (CUTOVER §0 preconditions) as a server function, so the /admin/staff live
 * flip can refuse on a NO-GO before the typed confirmation (P6 close-out / A2, decision 2).
 *
 * The P6-golive pane's `scripts/_golive-check.ts` did not exist when this was written; this module
 * is the shared logic that script can import (`runGoLiveCheck({ skipEvals: false })`, then print
 * `report.checks`). Read-only: SELECTs, the heartbeat row, the template cache, a file read.
 *
 * Checks (id → CUTOVER §0 line):
 *   worker      /api/health/comms-worker semantics: a fresh heartbeat from a worker process
 *   tables      to_regclass for the comms tables + the Phase 1/3 columns
 *   templates   the required names approved (server/template-status.ts EXPECTED_TEMPLATES)
 *   evals       eval-results/latest.json regression red = 0 (SKIP when skipEvals — the page's
 *               default, for speed; the script runs it)
 *   legacy      comms_agent.autosend.enabled must be false (the 2 Sep hotfix stays)
 *   shadow      shadow runs in the last 24 h (WARN when none: no evidence) and their errors
 *   flags       open flags past due (WARN: Ben's queue, not the code)
 *   mode        informational: where the switch is now
 * Loaders are injectable so the verdict arithmetic is unit-tested without a database.
 */
import { EXPECTED_TEMPLATES, shapeTemplateStatus, type CachedTemplateRow } from '../template-status';

export type CheckStatus = 'GO' | 'NO-GO' | 'WARN' | 'SKIP' | 'INFO';

export interface GoLiveCheck {
    id: 'worker' | 'tables' | 'templates' | 'evals' | 'legacy' | 'shadow' | 'flags' | 'mode';
    label: string;
    status: CheckStatus;
    detail: string;
}

export interface GoLiveReport {
    at: string;
    /** No NO-GO. WARNs do not block; the page shows them beside the confirmation. */
    ok: boolean;
    noGo: number;
    warn: number;
    checks: GoLiveCheck[];
}

export interface GoLiveDeps {
    heartbeat: () => Promise<{ ok?: boolean; stale?: boolean; ageSeconds?: number | null; host?: string | null; error?: string }>;
    /** Which of the given relations exist (to_regclass) and which columns exist. */
    schema: (tables: string[], columns: Array<[string, string]>) => Promise<{ tables: Record<string, boolean>; columns: Record<string, boolean> }>;
    templates: () => Promise<CachedTemplateRow[]>;
    /** Regression cases graded red in eval-results/latest.json; null when the file is missing. */
    evals: () => Promise<{ regressionRed: number; runId: string | null; at: string | null } | null>;
    legacyAutosend: () => Promise<boolean>;
    shadowRuns24h: () => Promise<{ runs: number; errors: number }>;
    openFlagsPastDue: () => Promise<number>;
    spineMode: () => Promise<'off' | 'shadow' | 'live'>;
    now?: () => Date;
}

export const REQUIRED_TABLES = ['agent_runs', 'comms_events', 'draft_verdicts', 'pack_intent_tiers', 'pack_tier_events'];
export const REQUIRED_COLUMNS: Array<[string, string]> = [['message_drafts', 'due_at'], ['agent_questions', 'due_at'], ['agent_runs', 'shadow_decision']];

export function summariseChecks(checks: GoLiveCheck[], now: Date = new Date()): GoLiveReport {
    const noGo = checks.filter((c) => c.status === 'NO-GO').length;
    const warn = checks.filter((c) => c.status === 'WARN').length;
    return { at: now.toISOString(), ok: noGo === 0, noGo, warn, checks };
}

async function guarded<T>(label: string, fn: () => Promise<T>): Promise<{ value: T } | { error: string }> {
    try { return { value: await fn() }; } catch (e: any) { return { error: `${label}: ${e?.message ?? e}` }; }
}

export async function runGoLiveCheck(opts: { skipEvals?: boolean } = {}, overrides: Partial<GoLiveDeps> = {}): Promise<GoLiveReport> {
    const deps: GoLiveDeps = { ...(await defaultDeps()), ...overrides };
    const now = (deps.now ?? (() => new Date()))();
    const checks: GoLiveCheck[] = [];

    const hb = await guarded('heartbeat', deps.heartbeat);
    if ('error' in hb) checks.push({ id: 'worker', label: 'Comms worker alive', status: 'NO-GO', detail: hb.error });
    else {
        const fresh = !!hb.value.ok && !hb.value.stale;
        checks.push({
            id: 'worker', label: 'Comms worker alive', status: fresh ? 'GO' : 'NO-GO',
            detail: fresh ? `heartbeat ${Math.round(hb.value.ageSeconds ?? 0)}s ago${hb.value.host ? ` on ${hb.value.host}` : ''}`
                : hb.value.ageSeconds == null ? 'no heartbeat ever written: COMMS_WORKER=1 is not set on any running process' : `heartbeat stale (${Math.round(hb.value.ageSeconds)}s)${hb.value.error ? `: ${hb.value.error}` : ''}`,
        });
    }

    const sc = await guarded('schema', () => deps.schema(REQUIRED_TABLES, REQUIRED_COLUMNS));
    if ('error' in sc) checks.push({ id: 'tables', label: 'Migrations applied', status: 'NO-GO', detail: sc.error });
    else {
        const missingT = REQUIRED_TABLES.filter((t) => !sc.value.tables[t]);
        const missingC = REQUIRED_COLUMNS.filter(([t, c]) => !sc.value.columns[`${t}.${c}`]).map(([t, c]) => `${t}.${c}`);
        const missing = [...missingT, ...missingC];
        checks.push({ id: 'tables', label: 'Migrations applied', status: missing.length ? 'NO-GO' : 'GO', detail: missing.length ? `missing: ${missing.join(', ')}` : `${REQUIRED_TABLES.length} tables, ${REQUIRED_COLUMNS.length} columns present` });
    }

    const tp = await guarded('templates', deps.templates);
    if ('error' in tp) checks.push({ id: 'templates', label: 'Meta templates approved', status: 'NO-GO', detail: tp.error });
    else {
        const shaped = shapeTemplateStatus(tp.value, EXPECTED_TEMPLATES);
        const bad = shaped.expected.filter((e) => e.required && e.state !== 'approved');
        checks.push({
            id: 'templates', label: 'Meta templates approved', status: bad.length ? 'NO-GO' : 'GO',
            detail: bad.length ? bad.map((e) => `${e.names[0]} ${e.state === 'present' ? `(${e.byName[e.resolvedName ?? e.names[0]]})` : 'missing'}`).join(', ') : `${shaped.expected.filter((e) => e.required).length} required names approved`,
        });
    }

    if (opts.skipEvals) checks.push({ id: 'evals', label: 'Eval regression red = 0', status: 'SKIP', detail: 'skipped on the page (run npx tsx scripts/eval-comms.ts before the flip)' });
    else {
        const ev = await guarded('evals', deps.evals);
        if ('error' in ev) checks.push({ id: 'evals', label: 'Eval regression red = 0', status: 'NO-GO', detail: ev.error });
        else if (!ev.value) checks.push({ id: 'evals', label: 'Eval regression red = 0', status: 'NO-GO', detail: 'eval-results/latest.json not found on this server' });
        else checks.push({ id: 'evals', label: 'Eval regression red = 0', status: ev.value.regressionRed === 0 ? 'GO' : 'NO-GO', detail: `${ev.value.regressionRed} regression red${ev.value.at ? ` (${ev.value.at})` : ''}` });
    }

    const la = await guarded('comms_agent', deps.legacyAutosend);
    if ('error' in la) checks.push({ id: 'legacy', label: 'Legacy autosend OFF', status: 'NO-GO', detail: la.error });
    else checks.push({ id: 'legacy', label: 'Legacy autosend OFF', status: la.value ? 'NO-GO' : 'GO', detail: la.value ? 'comms_agent.autosend.enabled is true: two senders. Turn it off first.' : 'comms_agent.autosend.enabled is false' });

    const sh = await guarded('shadow', deps.shadowRuns24h);
    if ('error' in sh) checks.push({ id: 'shadow', label: 'Shadow runs (24h)', status: 'WARN', detail: sh.error });
    else {
        const { runs, errors } = sh.value;
        const status: CheckStatus = runs === 0 ? 'WARN' : errors > Math.max(3, runs * 0.2) ? 'NO-GO' : errors > 0 ? 'WARN' : 'GO';
        checks.push({ id: 'shadow', label: 'Shadow runs (24h)', status, detail: runs === 0 ? 'no shadow runs in the last 24 h: no evidence yet' : `${runs} run(s), ${errors} error(s)` });
    }

    const fl = await guarded('flags', deps.openFlagsPastDue);
    if ('error' in fl) checks.push({ id: 'flags', label: 'Open flags past due', status: 'WARN', detail: fl.error });
    else checks.push({ id: 'flags', label: 'Open flags past due', status: fl.value > 0 ? 'WARN' : 'GO', detail: fl.value > 0 ? `${fl.value} flag(s) past due: expiry holding lines are covering silence (Ben's hours, not the code)` : 'none' });

    const md = await guarded('mode', deps.spineMode);
    checks.push({ id: 'mode', label: 'Spine mode now', status: 'INFO', detail: 'error' in md ? md.error : md.value });

    return summariseChecks(checks, now);
}

// ---------------------------------------------------------------- default loaders (db, read-only)

async function defaultDeps(): Promise<GoLiveDeps> {
    return {
        heartbeat: async () => (await import('../comms-worker-heartbeat')).getHeartbeatHealth(),
        schema: async (tables, columns) => {
            const { db } = await import('../db');
            const { sql } = await import('drizzle-orm');
            const rows = async (q: any): Promise<any[]> => { const r: any = await db.execute(q); return r.rows ?? r; };
            const t: Record<string, boolean> = {};
            for (const name of tables) {
                const [row] = await rows(sql`select to_regclass(${name}) as reg`);
                t[name] = !!row?.reg;
            }
            const c: Record<string, boolean> = {};
            for (const [table, column] of columns) {
                const [row] = await rows(sql`select 1 as ok from information_schema.columns where table_name = ${table} and column_name = ${column} limit 1`);
                c[`${table}.${column}`] = !!row;
            }
            return { tables: t, columns: c };
        },
        templates: async () => (await import('../whatsapp-template-sync')).getCachedTemplates(),
        evals: async () => {
            const fs = await import('fs');
            const path = await import('path');
            try {
                const board = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), 'eval-results', 'latest.json'), 'utf8')) as { runId?: string; finishedAt?: string; cases?: Array<{ kind?: string; passK?: boolean | null }> };
                const regressionRed = (board.cases ?? []).filter((x) => x.kind === 'regression' && x.passK === false).length;
                return { regressionRed, runId: board.runId ?? null, at: board.finishedAt ?? null };
            } catch { return null; }
        },
        legacyAutosend: async () => (await (await import('../agents/comms')).getCommsAgentConfig()).autosend.enabled,
        shadowRuns24h: async () => {
            const { db } = await import('../db');
            const { sql } = await import('drizzle-orm');
            const r: any = await db.execute(sql`select count(*)::int as runs, count(*) filter (where error is not null)::int as errors from agent_runs where shadow_decision is not null and started_at > now() - interval '1 day'`);
            const row = (r.rows ?? r)[0] ?? {};
            return { runs: Number(row.runs ?? 0), errors: Number(row.errors ?? 0) };
        },
        openFlagsPastDue: async () => {
            const { db } = await import('../db');
            const { sql } = await import('drizzle-orm');
            const r: any = await db.execute(sql`select count(*)::int as n from agent_questions where status = 'flagged' and expired_at is null and due_at is not null and due_at < now()`);
            return Number(((r.rows ?? r)[0] ?? {}).n ?? 0);
        },
        spineMode: async () => (await import('./switch')).spineMode(),
    };
}
