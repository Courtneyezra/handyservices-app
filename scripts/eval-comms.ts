/**
 * Comms eval harness, NO-DATABASE flavour (Phase 2 / C; docs/COMMS_EVALS_PLAN.md §2.2,
 * docs/comms-build/BRIEF-P2-evals.md).
 *
 *   npx tsx scripts/eval-comms.ts                       # every family, all adapters, 3 trials
 *   npx tsx scripts/eval-comms.ts --family guards       # one family
 *   npx tsx scripts/eval-comms.ts --only mq-001-tap-price
 *   npx tsx scripts/eval-comms.ts --adapter replay      # replay | legacy | spine | all
 *   npx tsx scripts/eval-comms.ts --trials 1 --quick
 *
 * Cases are DATA under eval-cases/<family>/*.json (schema: server/evals/case-schema.ts), each
 * self-contained: a context thread, an optional recorded reply (`candidate`), and `expected`.
 * Nothing here opens a database or a socket unless EVAL_LIVE=1. Three adapters:
 *   replay  — grades the recorded candidate through the real detectors + triage lexicon (always runs)
 *   legacy  — the pre-spine comms agent; it has no propose/dry-run mode, so it is SKIPPED with a
 *             reason (DB-fixture evals live in scripts/eval-comms-db.ts against a Neon branch)
 *   spine   — pane A's runOnce with the registered Scoper; skipped until both are on the branch
 * Regression families report pass^k (k = --trials, default 3); capability cases report pass@k.
 * Results: eval-results/<timestamp>.json, eval-results/latest.json, eval-results/latest.md
 * (scoreboard with deltas vs the previous run and the §9 guard false-negative report).
 * Exit code: 1 if any REGRESSION case is red; capability reds are improvement targets.
 */
if (!process.env.EVAL_LIVE) {
    // server/db.ts throws without DATABASE_URL at import time; a module we import for a pure
    // function may import it transitively. Point it at nothing so no pool can ever open.
    process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://eval:none@127.0.0.1:1/no-db';
}

import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { loadCases, lastInbound, type EvalCaseV2 } from '../server/evals/case-schema';
import { gradeObserved, passK, passAtK, type ObservedRun } from '../server/evals/graders';
import { runGuardChain } from '../server/evals/guard-chain';
import { lexiconExceptions, lexiconLane } from '../server/evals/triage-lexicon';
import { caseFileFromContext } from '../server/evals/case-file-from-context';
import { intentFromReason } from '../server/verdict-stats';
import {
    scoreboardMarkdown, summarise, type CaseOutcome, type EvalRunV2, type GuardFalseNegativeReport, type TrialOutcome,
} from '../server/evals/scoreboard';
import { chatVoiceViolations } from '@shared/chat-voice';

const ARGS = process.argv.slice(2);
const arg = (name: string): string | null => { const i = ARGS.indexOf(`--${name}`); return i >= 0 ? (ARGS[i + 1] ?? null) : null; };
const flag = (name: string): boolean => ARGS.includes(`--${name}`);
const TRIALS = Math.max(1, Number(arg('trials') ?? 3));
const FAMILY = arg('family');
const ONLY = arg('only');
const QUICK = flag('quick');
type AdapterName = 'replay' | 'legacy' | 'spine';
const ADAPTERS: AdapterName[] = ((arg('adapter') ?? 'all') === 'all' ? ['replay', 'legacy', 'spine'] : [arg('adapter') as AdapterName]);

const CASES_DIR = path.resolve(process.cwd(), 'eval-cases');
const RESULTS_DIR = path.resolve(process.cwd(), 'eval-results');

interface AdapterResult { observed?: ObservedRun; skipped?: string }

// ---------------------------------------------------------------- adapters

let holdsModule: null | { isNearDuplicateText(a: string, b: string): boolean; isMalformedAgentReason(r: string | null | undefined): boolean } = null;
let holdsError: string | null = null;
async function loadHolds() {
    if (holdsModule || holdsError) return holdsModule;
    try {
        const m = await import('../server/message-drafts');
        holdsModule = { isNearDuplicateText: m.isNearDuplicateText, isMalformedAgentReason: m.isMalformedAgentReason };
    } catch (e: any) {
        holdsError = e?.message ?? String(e);
    }
    return holdsModule;
}

async function replayAdapter(c: EvalCaseV2): Promise<AdapterResult> {
    if (!c.candidate) return { skipped: 'no recorded candidate to replay' };
    const customerText = lastInbound(c.context) ?? [...(c.caseFile?.timeline ?? [])].reverse().find((t) => t.kind === 'message_in')?.body ?? null;
    const guard = runGuardChain(c.candidate.body, {
        customerText, intent: c.candidate.intent ?? intentFromReason(c.candidate.reason) ?? null,
        quoteSeen: c.quote?.seen, quoteViewCount: c.quote?.viewCount, offeredDates: c.quote?.offeredDates, quoteTotalPence: c.quote?.totalPence ?? null,
    });
    const exceptions = lexiconExceptions(customerText);
    let holds: ObservedRun['holds'];
    if (c.expected.mustHold?.length) {
        const h = await loadHolds();
        if (h) {
            const prior = c.candidate.priorSends ?? [];
            holds = {
                nearDuplicate: prior.some((p) => h.isNearDuplicateText(p.body, c.candidate!.body)),
                malformedReason: h.isMalformedAgentReason(c.candidate.reason),
            };
        }
    }
    return {
        observed: {
            body: c.candidate.body,
            intent: c.candidate.intent ?? intentFromReason(c.candidate.reason) ?? null,
            lane: c.candidate.lane ?? lexiconLane(exceptions, { firstContact: !!c.firstContact, postQuote: !!c.quote }),
            flagged: !!c.candidate.flagged,
            guardHits: guard.hits.map((h) => h.code),
            escalatingGuards: guard.escalatingCodes,
            customerExceptions: exceptions,
            holds,
            voiceViolations: chatVoiceViolations(c.candidate.body).map((v: any) => (typeof v === 'string' ? v : v?.rule ?? String(v))),
        },
    };
}

async function legacyAdapter(_c: EvalCaseV2): Promise<AdapterResult> {
    // runCommsAgent (server/agents/comms.ts) reads and writes the database and has no propose /
    // dry-run mode (only the sweeps take dryRun). Seeding fixtures is scripts/eval-comms-db.ts's job.
    return { skipped: 'legacy runCommsAgent has no propose mode; use scripts/eval-comms-db.ts on a Neon branch' };
}

let spineRunner: null | ((input: { caseFile: unknown; trigger: string }) => Promise<any>) = null;
let spineSkip: string | null = null;
async function loadSpine() {
    if (spineRunner || spineSkip) return spineRunner;
    for (const spec of ['../server/spine/run-once', '../server/spine/runner', '../server/spine/index']) {
        try {
            const m: any = await import(/* @vite-ignore */ spec);
            const fn = m.runOnce ?? m.default?.runOnce;
            if (typeof fn === 'function') { spineRunner = fn; break; }
        } catch { /* try the next name */ }
    }
    if (!spineRunner) { spineSkip = 'spine runOnce not on this branch (pane A)'; return null; }
    try {
        const agents: any = await import('../server/spine/agents/index');
        if (!agents.getSpineAgent?.('scoper')) { spineSkip = 'no Scoper registered (pane B)'; spineRunner = null; }
    } catch (e: any) { spineSkip = `agent registry: ${e?.message ?? e}`; spineRunner = null; }
    return spineRunner;
}

async function spineAdapter(c: EvalCaseV2): Promise<AdapterResult> {
    const run = await loadSpine();
    if (!run) return { skipped: spineSkip ?? 'spine unavailable' };
    const caseFile = caseFileFromContext(c);
    const out = await run({ caseFile, trigger: 'inbound_message' });
    const body = out?.proposal?.body?.length ? out.proposal.body.join('\n---\n') : null;
    return {
        observed: {
            body,
            intent: out?.proposal?.intent ?? out?.triage?.intent ?? null,
            lane: out?.triage?.lane ?? null,
            flagged: out?.decision?.kind === 'flag' || !!out?.proposal?.flag,
            guardHits: out?.guards?.guardsHit ?? [],
            escalatingGuards: out?.guards?.escalate ? (out?.guards?.guardsHit ?? []) : [],
            customerExceptions: out?.triage?.exceptions ?? [],
            voiceViolations: body ? chatVoiceViolations(body).map((v: any) => (typeof v === 'string' ? v : v?.rule ?? String(v))) : [],
        },
    };
}

const ADAPTER_FNS: Record<AdapterName, (c: EvalCaseV2) => Promise<AdapterResult>> = { replay: replayAdapter, legacy: legacyAdapter, spine: spineAdapter };

// ---------------------------------------------------------------- run

async function runCase(c: EvalCaseV2, adapter: AdapterName): Promise<CaseOutcome> {
    const kind = c.kind ?? 'regression';
    const n = adapter === 'replay' ? TRIALS : (c.trials ?? TRIALS);
    const trials: TrialOutcome[] = [];
    let skipped: string | undefined;
    for (let t = 1; t <= n; t++) {
        try {
            const r = await ADAPTER_FNS[adapter](c);
            if (r.skipped || !r.observed) { skipped = r.skipped ?? 'no observation'; trials.push({ trial: t, pass: false, graders: [], skipped }); break; }
            const graders = gradeObserved(c.expected, r.observed);
            trials.push({ trial: t, pass: graders.every((g) => g.pass), graders, body: r.observed.body });
        } catch (e: any) {
            trials.push({ trial: t, pass: false, graders: [], error: e?.message ?? String(e) });
        }
    }
    const allSkipped = trials.every((t) => t.skipped);
    return {
        id: c.id, family: c.family, kind, adapter, trials, skipped: allSkipped ? skipped : undefined,
        passK: allSkipped ? null : passK(trials), passAny: allSkipped ? null : passAtK(trials),
    };
}

/** §9: the guard chain measured on the 31 Aug incident sends (guards family, provenance incident). */
function guardFalseNegatives(cases: EvalCaseV2[], outcomes: CaseOutcome[]): GuardFalseNegativeReport | null {
    const incident = cases.filter((c) => c.family === 'guards' && /incident/.test(c.provenance ?? ''));
    if (!incident.length) return null;
    const by = new Map(outcomes.filter((o) => o.adapter === 'replay').map((o) => [o.id, o]));
    const labels: Record<string, number> = {};
    let shouldHold = 0, caughtText = 0, caughtLexOnly = 0;
    const missedIds: string[] = [];
    for (const c of incident) {
        const label = c.expected.label ?? 'unlabelled';
        labels[label] = (labels[label] ?? 0) + 1;
        if (label === 'unguarded_but_fine') continue;
        shouldHold += 1;
        const o = by.get(c.id);
        const g = o?.trials[0]?.graders.find((x) => x.grader === 'must-flag');
        const note = g?.note ?? '';
        const text = /guards=\[[^\]]+\]/.test(note) && !/guards=\[\]/.test(note);
        const lex = /exceptions=\[[^\]]+\]/.test(note) && !/exceptions=\[\]/.test(note);
        if (text) caughtText += 1;
        else if (lex) caughtLexOnly += 1;
        else missedIds.push(c.id);
    }
    const missed = missedIds.length;
    return {
        shouldHold, caughtByTextGuard: caughtText, caughtByLexiconOnly: caughtLexOnly, missed,
        textGuardFalseNegativeRate: shouldHold ? (shouldHold - caughtText) / shouldHold : null,
        combinedFalseNegativeRate: shouldHold ? missed / shouldHold : null,
        missedIds, labels,
    };
}

async function main() {
    const { cases, errors } = loadCases(CASES_DIR, { family: FAMILY, only: ONLY });
    for (const e of errors) console.error(`case error: ${e}`);
    if (errors.length) process.exit(2);
    const selected = QUICK ? cases.filter((c) => (c.kind ?? 'regression') === 'regression') : cases;
    if (!selected.length) { console.error('No cases matched.'); process.exit(2); }

    let gitRef = 'unknown';
    try { gitRef = execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch { /* fine */ }
    const runId = new Date().toISOString().replace(/[:.]/g, '-');
    const startedAt = new Date().toISOString();
    console.log(`eval-comms: ${selected.length} case(s) × ${TRIALS} trial(s) × adapters [${ADAPTERS.join(', ')}] on ${gitRef}${process.env.EVAL_LIVE ? ' (EVAL_LIVE)' : ' (no db, no network)'}\n`);

    const outcomes: CaseOutcome[] = [];
    for (const adapter of ADAPTERS) {
        for (const c of selected) {
            const o = await runCase(c, adapter);
            outcomes.push(o);
            const h = o.kind === 'regression' ? o.passK : o.passAny;
            const tag = h === null ? 'SKIP' : h ? 'PASS' : o.kind === 'capability' ? 'MISS' : 'FAIL';
            if (tag !== 'PASS' && !(tag === 'SKIP' && adapter !== 'replay')) {
                console.log(`  ${tag}  [${adapter}] ${c.id}${o.skipped ? ` — ${o.skipped}` : ''}`);
                for (const g of o.trials.flatMap((t) => t.graders).filter((g) => !g.pass).slice(0, 4)) console.log(`        ✗ ${g.grader}${g.note ? ` — ${g.note}` : ''}`);
                for (const t of o.trials.filter((t) => t.error)) console.log(`        ! ${t.error}`);
            }
        }
        const skippedAll = outcomes.filter((o) => o.adapter === adapter && o.skipped);
        if (skippedAll.length === selected.length) console.log(`  SKIP  [${adapter}] all ${selected.length} cases — ${skippedAll[0].skipped}`);
    }

    const run: EvalRunV2 = {
        runId, startedAt, finishedAt: new Date().toISOString(), gitRef, trialsRequested: TRIALS, adapters: ADAPTERS,
        cases: outcomes, guardFalseNegative: guardFalseNegatives(selected, outcomes),
    };
    fs.mkdirSync(RESULTS_DIR, { recursive: true });
    const latestPath = path.join(RESULTS_DIR, 'latest.json');
    const prev: EvalRunV2 | null = fs.existsSync(latestPath) ? JSON.parse(fs.readFileSync(latestPath, 'utf8')) : null;
    fs.writeFileSync(path.join(RESULTS_DIR, `${runId}.json`), JSON.stringify(run, null, 2));
    fs.writeFileSync(latestPath, JSON.stringify(run, null, 2));
    const md = scoreboardMarkdown(run, prev && prev.cases ? prev : null);
    fs.writeFileSync(path.join(RESULTS_DIR, 'latest.md'), md);

    const sum = summarise(outcomes);
    const regressionRed = outcomes.filter((o) => o.kind === 'regression' && o.passK === false).length;
    const capabilityRed = outcomes.filter((o) => o.kind === 'capability' && o.passAny === false).length;
    console.log(`\n${md.split('\n## Cases')[0]}`);
    console.log(`\nRegression red: ${regressionRed} · capability red (improvement targets): ${capabilityRed} · skipped: ${sum.skipped}`);
    console.log(`Results: eval-results/${runId}.json · scoreboard: eval-results/latest.md`);
    process.exit(regressionRed > 0 ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(2); });
