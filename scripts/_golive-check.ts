/**
 * Go-live readiness check — CUTOVER.md §0 preconditions as one go/no-go table.
 *
 *   npx tsx scripts/_golive-check.ts                 # table, exit 1 on any NO-GO
 *   npx tsx scripts/_golive-check.ts --json          # machine-readable
 *   npx tsx scripts/_golive-check.ts --skip-evals    # do not spawn scripts/eval-comms.ts
 *   GOLIVE_HEALTH_URL=https://... npx tsx scripts/_golive-check.ts   # health endpoint base (default BASE_URL or www.handyservices.app)
 *
 * READ-ONLY: SELECTs against DATABASE_URL, one GET of /api/health/comms-worker, one child process
 * (the eval harness, which opens no database). Writes nothing, flips nothing. Safe against production.
 *
 * Rows (each GO / NO-GO / WARN):
 *   1. health endpoint 200 + fresh heartbeat + the answering process is the worker (Phase 0)
 *   2. heartbeat row in the DB (the same evidence without going through Railway)
 *   3. the comms tables/columns exist: draft_verdicts, agent_runs, pack_intent_tiers, pack_tier_events,
 *      due_at on message_drafts + agent_questions (to_regclass / information_schema)
 *   4. Meta templates APPROVED by name via the template sync module's cached read:
 *      holding_line_v1 (or holding_line), missed_call_ack, video_request | job_video_request,
 *      postcode_request, call_request
 *   5. eval-comms regression red = 0 (spawned; capability reds are targets, not blockers)
 *   6. spine mode (shadow expected before a live flip; off/live are WARN, not NO-GO — §0b)
 *   7. comms_agent flags: autosend must be OFF; onInbound reported (true until step 3.3)
 *   8. agent_runs in the last 24h: total, shadow, errors, decision mix (CUTOVER §5)
 *   9. open flags and pending drafts past due (CUTOVER §5 "Ben's queue")
 * Exit: 0 all GO/WARN · 1 any NO-GO · 2 crashed.
 */
import { spawnSync } from 'node:child_process';
import { sql } from 'drizzle-orm';

type Status = 'GO' | 'NO-GO' | 'WARN';
interface Check { name: string; status: Status; detail: string; data?: Record<string, unknown> }

const argv = process.argv.slice(2);
const JSON_OUT = argv.includes('--json');
const SKIP_EVALS = argv.includes('--skip-evals');

// --json must be machine-readable: the db pool, dotenv and the config readers all chat on stdout
// at import time, so in JSON mode everything console.* says goes to stderr and the payload is the
// only thing on stdout. The server modules are therefore loaded AFTER this (dynamic imports below).
if (JSON_OUT) {
    const toErr = (...a: unknown[]) => console.error(...a);
    console.log = toErr; console.info = toErr; console.warn = toErr; console.debug = toErr;
}

// Loaded in main() so the redirect above runs first. Typed from the modules, never re-declared.
let db: typeof import('../server/db').db;
let assessHeartbeat: typeof import('../server/comms-worker-heartbeat').assessHeartbeat;
let readHeartbeat: typeof import('../server/comms-worker-heartbeat').readHeartbeat;
let HEARTBEAT_STALE_AFTER_SECONDS: number;
let getCachedTemplates: typeof import('../server/whatsapp-template-sync').getCachedTemplates;
let getSpineConfig: typeof import('../server/spine/config').getSpineConfig;
let spineModeFrom: typeof import('../server/spine/switch').spineModeFrom;
let getCommsAgentConfig: typeof import('../server/agents/comms').getCommsAgentConfig;
let HOLDING_TEMPLATE_NAME: string;
async function loadDeps() {
    await import('dotenv/config');
    ({ db } = await import('../server/db'));
    ({ assessHeartbeat, readHeartbeat, HEARTBEAT_STALE_AFTER_SECONDS } = await import('../server/comms-worker-heartbeat'));
    ({ getCachedTemplates } = await import('../server/whatsapp-template-sync'));
    ({ getSpineConfig } = await import('../server/spine/config'));
    ({ spineModeFrom } = await import('../server/spine/switch'));
    ({ getCommsAgentConfig } = await import('../server/agents/comms'));
    ({ HOLDING_TEMPLATE_NAME } = await import('../server/rules-layer'));
}
let HEALTH_BASE = ''; // resolved in main(), after dotenv has loaded

const checks: Check[] = [];
/** Set by the first SELECT. The config readers fail CLOSED (defaults) when the DB is unreachable,
 *  which would otherwise print a convincing "GO" for rows that never read the live row. */
let dbReachable = false;
function add(name: string, status: Status, detail: string, data?: Record<string, unknown>) {
    checks.push({ name, status, detail, data });
}
async function guarded(name: string, fn: () => Promise<void>) {
    try { await fn(); } catch (e: any) { add(name, 'NO-GO', `check crashed: ${e?.message ?? e}`); }
}

// ---------------------------------------------------------------- 1. health endpoint
async function checkHealthEndpoint() {
    const url = `${HEALTH_BASE}/api/health/comms-worker`;
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 15_000);
    let res: Response;
    try { res = await fetch(url, { signal: ctl.signal }); } finally { clearTimeout(t); }
    const body: any = await res.json().catch(() => ({}));
    const role = body?.thisProcess?.role ?? '?';
    const age = body?.ageSeconds ?? null;
    const summary = `${url} → ${res.status}, stale=${body?.stale ?? '?'}, age=${age ?? '?'}s, role=${role}, host=${body?.thisProcess?.host ?? '?'}`;
    if (res.status !== 200) return add('health endpoint', 'NO-GO', summary, { status: res.status, body });
    if (body?.stale) return add('health endpoint', 'NO-GO', `${summary} (heartbeat stale > ${HEARTBEAT_STALE_AFTER_SECONDS}s)`, { body });
    if (role !== 'worker') return add('health endpoint', 'NO-GO', `${summary} — the answering process is not the worker (COMMS_WORKER=1 missing on Railway?)`, { body });
    add('health endpoint', 'GO', summary, { body });
}

// ---------------------------------------------------------------- 2. heartbeat row
async function checkHeartbeatRow() {
    const rec = await readHeartbeat();
    const a = assessHeartbeat(rec);
    const detail = rec ? `beat ${a.ageSeconds}s ago from ${rec.host} pid ${rec.pid} (${rec.version ?? 'no version'})` : 'no heartbeat row';
    add('heartbeat row (DB)', a.ok ? 'GO' : 'NO-GO', detail, { record: rec, assessment: a });
}

// ---------------------------------------------------------------- 3. tables / columns
const REQUIRED_TABLES = ['draft_verdicts', 'agent_runs', 'pack_intent_tiers', 'pack_tier_events'];
const REQUIRED_COLUMNS: Array<[string, string]> = [
    ['message_drafts', 'due_at'], ['agent_questions', 'due_at'], ['agent_runs', 'shadow_decision'],
];
async function checkSchema() {
    const missing: string[] = [];
    for (const tbl of REQUIRED_TABLES) {
        const r = await db.execute(sql`SELECT to_regclass(${tbl}) AS reg`);
        if (!(r.rows[0] as any)?.reg) missing.push(tbl);
    }
    for (const [tbl, col] of REQUIRED_COLUMNS) {
        const r = await db.execute(sql`SELECT 1 FROM information_schema.columns WHERE table_name = ${tbl} AND column_name = ${col} LIMIT 1`);
        if (!r.rows.length) missing.push(`${tbl}.${col}`);
    }
    add('migrations applied', missing.length ? 'NO-GO' : 'GO',
        missing.length ? `missing: ${missing.join(', ')} (apply with scripts/_apply-migration.ts)` : `${REQUIRED_TABLES.join(', ')}; due_at on message_drafts + agent_questions; agent_runs.shadow_decision`,
        { missing });
}

// ---------------------------------------------------------------- 4. templates
const templateSlots = (): Array<{ slot: string; names: string[] }> => [
    { slot: 'holding line', names: [HOLDING_TEMPLATE_NAME, 'holding_line'] },
    { slot: 'missed call', names: ['missed_call_ack'] },
    { slot: 'video request', names: ['video_request', 'job_video_request'] },
    { slot: 'postcode request', names: ['postcode_request'] },
    { slot: 'call request', names: ['call_request'] },
];
async function checkTemplates() {
    const cached = await getCachedTemplates();
    const byName = new Map(cached.map((t: any) => [t.name, t]));
    const lines: string[] = [];
    let nogo = false;
    const TEMPLATE_SLOTS = templateSlots();
    for (const s of TEMPLATE_SLOTS) {
        const found = s.names.map((n) => byName.get(n)).filter(Boolean) as any[];
        const approved = found.find((t) => t.status === 'approved');
        if (approved) lines.push(`${s.slot}: ${approved.name} APPROVED`);
        else {
            nogo = true;
            const seen = found.length ? found.map((t) => `${t.name}=${t.status}`).join('/') : `${s.names.join('|')} not in cache`;
            lines.push(`${s.slot}: ${seen}`);
        }
    }
    add('meta templates approved', nogo ? 'NO-GO' : 'GO', lines.join(' · '),
        { cachedCount: cached.length, slots: TEMPLATE_SLOTS.map((s) => ({ slot: s.slot, candidates: s.names.map((n) => ({ name: n, status: byName.get(n)?.status ?? null })) })) });
}

// ---------------------------------------------------------------- 5. evals
function checkEvals() {
    if (SKIP_EVALS) return add('eval-comms regression', 'WARN', 'skipped (--skip-evals)');
    const env = { ...process.env };
    delete env.EVAL_LIVE; // deterministic adapters only: no model, no DB
    const r = spawnSync('npx', ['tsx', 'scripts/eval-comms.ts'], { env, encoding: 'utf8', timeout: 10 * 60_000, maxBuffer: 64 * 1024 * 1024 });
    const out = `${r.stdout ?? ''}\n${r.stderr ?? ''}`;
    const m = out.match(/Regression red:\s*(\d+)\s*·\s*capability red[^:]*:\s*(\d+)/);
    const red = m ? Number(m[1]) : null;
    const cap = m ? Number(m[2]) : null;
    const tail = out.trim().split('\n').slice(-3).join(' | ');
    if (r.status === 0 && red === 0) return add('eval-comms regression', 'GO', `regression red 0, capability red ${cap} (exit 0)`, { exit: r.status, regressionRed: red, capabilityRed: cap });
    add('eval-comms regression', 'NO-GO', `exit ${r.status}, regression red ${red ?? '?'}: ${tail}`, { exit: r.status, regressionRed: red, capabilityRed: cap, tail });
}

// ---------------------------------------------------------------- 6. spine mode
async function checkSpineMode() {
    if (!dbReachable) return add('spine mode', 'NO-GO', 'database unreachable: the switch cannot be read (fail-closed defaults are not the live row)');
    const cfg = await getSpineConfig();
    const mode = spineModeFrom(cfg);
    const detail = `mode=${mode} (enabled=${cfg.enabled}, shadow=${cfg.shadow}, mode field=${cfg.mode ?? 'derived'}); asks=${cfg.asks.enabled} autonomy=${cfg.autonomy.enabled} sampler=${cfg.sampler.enabled} video=${cfg.video.enabled}`;
    if (mode === 'shadow') return add('spine mode', 'GO', detail, { mode, cfg });
    if (mode === 'live') return add('spine mode', 'WARN', `${detail} — already live`, { mode, cfg });
    add('spine mode', 'WARN', `${detail} — not in shadow yet (§0b allows a direct flip; there will be no shadow evidence)`, { mode, cfg });
}

// ---------------------------------------------------------------- 7. comms_agent flags
async function checkCommsAgentFlags() {
    if (!dbReachable) return add('comms_agent flags', 'NO-GO', 'database unreachable: the comms_agent row cannot be read');
    const c = await getCommsAgentConfig();
    const detail = `enabled=${c.enabled} onInbound=${c.onInbound} autosend.enabled=${c.autosend.enabled} firstContactAutoAck.enabled=${(c as any).firstContactAutoAck?.enabled ?? '?'}`;
    if (c.autosend.enabled) return add('comms_agent flags', 'NO-GO', `${detail} — legacy autosend must stay OFF (HANDOVER §3)`, { config: c });
    add('comms_agent flags', 'GO', `${detail}${c.onInbound ? ' (onInbound goes false at CUTOVER §3.3)' : ''}`, { config: c });
}

// ---------------------------------------------------------------- 8. runs last 24h
async function checkRuns() {
    const totals = await db.execute(sql`
        SELECT count(*)::int AS total,
               count(*) FILTER (WHERE shadow_decision IS NOT NULL OR (proposal->>'dryRun') = 'true')::int AS shadow,
               count(*) FILTER (WHERE error IS NOT NULL)::int AS errors,
               count(*) FILTER (WHERE error IS NOT NULL AND started_at > now() - interval '1 hour')::int AS errors_last_hour
        FROM agent_runs WHERE started_at > now() - interval '24 hours'`);
    const t = totals.rows[0] as any;
    const mix = await db.execute(sql`
        SELECT coalesce(shadow_decision, decision, 'none') AS decision, coalesce(lane, '-') AS lane, count(*)::int AS n
        FROM agent_runs WHERE started_at > now() - interval '24 hours' AND agent NOT IN ('comms', 'quote-prep', 'recovery', 'ops-manager')
        GROUP BY 1, 2 ORDER BY 3 DESC LIMIT 12`);
    const mixStr = mix.rows.map((r: any) => `${r.decision}/${r.lane}=${r.n}`).join(' ') || 'no spine runs';
    const detail = `total ${t.total}, shadow ${t.shadow}, errors ${t.errors} (${t.errors_last_hour} in the last hour) · ${mixStr}`;
    const data = { ...t, mix: mix.rows };
    if (t.errors_last_hour > 3) return add('agent_runs last 24h', 'NO-GO', `${detail} — > 3 errors/hour is the §5 "back to shadow" line`, data);
    if (t.total > 0 && t.errors / t.total > 0.1) return add('agent_runs last 24h', 'NO-GO', `${detail} — error rate above 10%`, data);
    if (t.shadow === 0) return add('agent_runs last 24h', 'WARN', `${detail} — no shadow runs recorded (nothing to compare with scripts/_shadow-report.ts)`, data);
    add('agent_runs last 24h', t.errors ? 'WARN' : 'GO', detail, data);
}

// ---------------------------------------------------------------- 9. past due
async function checkPastDue() {
    const r = await db.execute(sql`
        SELECT
          (SELECT count(*)::int FROM agent_questions WHERE status IN ('open','flagged') AND due_at IS NOT NULL AND due_at < now() AND expired_at IS NULL) AS flags_past_due_unexpired,
          (SELECT count(*)::int FROM agent_questions WHERE status IN ('open','flagged') AND due_at IS NOT NULL AND due_at < now() AND expired_at IS NOT NULL) AS flags_past_due_expired,
          (SELECT count(*)::int FROM agent_questions WHERE status IN ('open','flagged')) AS flags_open,
          (SELECT count(*)::int FROM message_drafts WHERE status = 'pending') AS drafts_pending,
          (SELECT count(*)::int FROM message_drafts WHERE status = 'pending' AND due_at IS NOT NULL AND due_at < now()) AS drafts_past_due`);
    const t = r.rows[0] as any;
    const detail = `open flags ${t.flags_open} (past due: ${t.flags_past_due_unexpired} not yet expired, ${t.flags_past_due_expired} expired by the holding line) · pending drafts ${t.drafts_pending} (${t.drafts_past_due} past due)`;
    if (t.flags_past_due_unexpired > 10) return add('open flags past due', 'NO-GO', `${detail} — the flag-expiry sweep is not keeping up (worker down?)`, t);
    if (t.flags_past_due_unexpired > 0 || t.drafts_past_due > 0) return add('open flags past due', 'WARN', `${detail} — expiry holding lines are covering silence; Ben's hours, not the code (§5)`, t);
    add('open flags past due', 'GO', detail, t);
}

// ---------------------------------------------------------------- 0. which database
async function checkDatabaseTarget() {
    const url = process.env.DATABASE_URL ?? '';
    const host = url.replace(/^.*@/, '').replace(/[/?].*$/, '');
    const prod = url.includes('ep-broad-king') ? ' (this is PRODUCTION)' : '';
    try {
        await db.execute(sql`SELECT 1`);
        dbReachable = true;
        add('database', 'WARN', `${host || '(unset)'} — reachable, read-only SELECTs only${prod}`, { host, reachable: true });
    } catch (e: any) {
        add('database', 'NO-GO', `${host || '(unset)'} — unreachable: ${e?.message ?? e}`, { host, reachable: false });
    }
}

async function main() {
    await loadDeps();
    HEALTH_BASE = (process.env.GOLIVE_HEALTH_URL || process.env.BASE_URL || 'https://www.handyservices.app').replace(/\/$/, '');
    await checkDatabaseTarget();
    await guarded('health endpoint', checkHealthEndpoint);
    await guarded('heartbeat row (DB)', checkHeartbeatRow);
    await guarded('migrations applied', checkSchema);
    await guarded('meta templates approved', checkTemplates);
    await guarded('spine mode', checkSpineMode);
    await guarded('comms_agent flags', checkCommsAgentFlags);
    await guarded('agent_runs last 24h', checkRuns);
    await guarded('open flags past due', checkPastDue);
    checkEvals();

    const nogo = checks.filter((c) => c.status === 'NO-GO');
    const verdict = nogo.length ? 'NO-GO' : 'GO';
    if (JSON_OUT) {
        process.stdout.write(JSON.stringify({ verdict, ok: !nogo.length, at: new Date().toISOString(), healthBase: HEALTH_BASE, checks }, null, 2) + '\n');
    } else {
        const w = Math.max(...checks.map((c) => c.name.length));
        console.log(`\nGo-live readiness (CUTOVER §0) — ${new Date().toISOString()}\n`);
        for (const c of checks) console.log(`  ${c.status.padEnd(5)}  ${c.name.padEnd(w)}  ${c.detail}`);
        console.log(`\n  ${verdict}${nogo.length ? `: ${nogo.length} blocking (${nogo.map((c) => c.name).join(', ')})` : ': every precondition holds'}.`);
        console.log(nogo.length ? '  Fix the NO-GO rows, then rerun. Nothing was changed by this check.' : '  Next: npx tsx scripts/_golive.ts --to live --yes (CUTOVER §3 steps 1–3).');
    }
    process.exit(nogo.length ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(2); });
