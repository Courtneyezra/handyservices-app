/**
 * Quote-prep readiness eval harness — docs/EVAL_QUOTE_PREP_BRIEF.md.
 *
 *   npx tsx scripts/eval-quote-prep.ts                 # all cases, 1 trial each
 *   npx tsx scripts/eval-quote-prep.ts --trials 3      # baseline scoreboard run
 *   npx tsx scripts/eval-quote-prep.ts --only qp-inc-002-carolyne-visit-first
 *   npx tsx scripts/eval-quote-prep.ts --family near-miss
 *
 * Cases are DATA (eval-cases/quote-prep-readiness.json, key `quotePrepCases`,
 * schema in shared/eval-types.ts). Per trial the harness seeds the fixture
 * (conversation + messages + calls + prior quotes) under the case's Ofcom drama
 * number (+4477009008xx block), runs runQuotePrep, grades the SUBMITTED INTAKE
 * (readiness verdict, gaps, line quality — outcomes, never the tool-call path),
 * runs the shadow verifier as an ADVISORY column that gates nothing, then
 * deletes the fixture. Results land in eval-results/quote-prep-<runId>.json
 * plus eval-results/quote-prep-latest.md with deltas vs the previous run.
 *
 * Config isolation (Phase 0): COMMS_CONFIG_OVERRIDE (process-local) forces
 * EVERY comms flag off for this process — live flags are never written and
 * nothing can send. main() re-asserts the resolved config and exits 3 if any
 * flag is on. runQuotePrep itself has no send tools (get_thread,
 * get_prior_quotes, submit_intake only), so the blast radius is DB reads plus
 * the fixture rows this script owns.
 *
 * NEVER pipe this script through head/grep (SIGPIPE kills the run mid-fixture);
 * redirect to a file instead.
 */
import 'dotenv/config';

// Process-local config BEFORE any agent import: everything off. This harness
// calls runQuotePrep directly; no trigger path should be live.
process.env.COMMS_CONFIG_OVERRIDE = JSON.stringify({
    enabled: false,
    autosend: { enabled: false },
    firstContactAutoAck: { enabled: false, channels: [] },
    quotePrep: { enabled: false },
    vaCallTask: { enabled: false },
});
process.env.FIRST_CONTACT_ACK_NO_HOLD = '1';

import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { db } from '../server/db';
import { conversations, messages, messageDrafts, agentQuestions, personalizedQuotes, calls } from '@shared/schema';
import { eq, sql } from 'drizzle-orm';
import type {
    EvalQuotePrepCase, EvalQuotePrepGrader, EvalGapSpec, EvalReadiness, EvalUsage,
    EvalVerifierAdvisory, GraderResult, QuotePrepTrialResult, QuotePrepCaseResult, QuotePrepEvalRun,
} from '@shared/eval-types';

const ARGS = process.argv.slice(2);
const arg = (name: string): string | null => {
    const i = ARGS.indexOf(`--${name}`);
    return i >= 0 ? (ARGS[i + 1] ?? null) : null;
};
const TRIALS = Math.max(1, Number(arg('trials') ?? 1));
const ONLY = arg('only');
const FAMILY = arg('family');

const CASES_FILE = path.resolve(process.cwd(), 'eval-cases', 'quote-prep-readiness.json');
const RESULTS_DIR = path.resolve(process.cwd(), 'eval-results');

// The line-quality grader mirrors normalizeIntake's validator rules. Kept as
// literals here (not imported) so the eval is an independent check on the
// contract, not a tautology against the implementation.
const LINE_TITLE_MAX = 60;
const PRICE_RE = /£\s*\d/;

// Published per-token prices (USD/M) for the models involved; estimate, not a bill.
const SONNET_USD_PER_M = { in: 3, out: 15, cacheRead: 0.3, cacheWrite: 3.75 };
const USD_TO_GBP = 0.79;

// ---------------------------------------------------------------- fixtures

const digitsOf = (phone: string) => phone.replace(/\D/g, '');
const convKeyOf = (phone: string) => `${digitsOf(phone)}@c.us`;
const convIdOf = (c: EvalQuotePrepCase) => `evalqp_${c.id.replace(/[^a-z0-9]/gi, '_')}`;

/**
 * Every fixture phone must sit in the drama block this suite owns. A case that
 * drifted onto a real number (or another suite's block) would seed rows against
 * a live thread — refuse to run at all rather than trial-by-trial.
 */
function assertDramaBlock(cases: EvalQuotePrepCase[]): void {
    const bad = cases.filter((c) => !/^4477009008\d{2}$/.test(digitsOf(c.fixture.phone)));
    if (bad.length) {
        console.error(`FATAL: fixture phone outside the +4477009008xx drama block: ${bad.map((c) => `${c.id}=${c.fixture.phone}`).join(', ')}`);
        process.exit(3);
    }
}

async function cleanupFixture(c: EvalQuotePrepCase): Promise<void> {
    const digits = digitsOf(c.fixture.phone);
    await db.delete(messages).where(eq(messages.conversationId, convIdOf(c)));
    await db.delete(messageDrafts).where(sql`regexp_replace(${messageDrafts.phone}, '[^0-9]', '', 'g') = ${digits}`);
    await db.delete(agentQuestions).where(sql`regexp_replace(${agentQuestions.phone}, '[^0-9]', '', 'g') = ${digits}`);
    await db.delete(personalizedQuotes).where(sql`regexp_replace(${personalizedQuotes.phone}, '[^0-9]', '', 'g') = ${digits}`);
    await db.delete(calls).where(sql`regexp_replace(${calls.phoneNumber}, '[^0-9]', '', 'g') = ${digits}`);
    await db.delete(conversations).where(eq(conversations.id, convIdOf(c)));
}

async function seedFixture(c: EvalQuotePrepCase): Promise<string> {
    const f = c.fixture;
    const now = Date.now();
    const convId = convIdOf(c);

    await db.insert(conversations).values({
        id: convId,
        phoneNumber: convKeyOf(f.phone),
        contactName: f.contactName ?? 'Eval Fixture',
        status: 'active',
        stage: f.stage ?? 'scoping',
        priority: 'normal',
        tags: [],
    });

    let lastInboundAt: Date | null = null;
    for (const [i, m] of f.thread.entries()) {
        const at = new Date(now - m.minsAgo * 60_000 + i); // +i keeps ordering stable within a minute
        await db.insert(messages).values({
            id: `evalmsg_${c.id}_${i}`,
            conversationId: convId,
            direction: m.dir === 'in' ? 'inbound' : 'outbound',
            channel: m.channel ?? 'whatsapp',
            content: m.text,
            type: m.mediaUrl ? 'image' : 'text',
            status: 'delivered',
            senderName: m.dir === 'in' ? (f.contactName ?? 'Eval Fixture') : 'Agent',
            mediaUrl: m.mediaUrl ?? null,
            createdAt: at,
        });
        if (m.dir === 'in' && (m.channel ?? 'whatsapp') === 'whatsapp') lastInboundAt = at;
    }
    const lastMsg = f.thread[f.thread.length - 1];
    await db.update(conversations).set({
        lastInboundAt,
        lastCustomerContactAt: lastInboundAt,
        lastMessageAt: new Date(now - (lastMsg?.minsAgo ?? 0) * 60_000),
        lastMessagePreview: (lastMsg?.text ?? '').slice(0, 50),
        canSendFreeform: true,
    }).where(eq(conversations.id, convId));

    for (const q of f.quotes ?? []) {
        const created = new Date(now - (q.sentMinsAgo ?? 60) * 60_000);
        await db.insert(personalizedQuotes).values({
            id: `evalq_${c.id}_${q.slug}`,
            shortSlug: q.slug,
            customerName: f.contactName ?? 'Eval Fixture',
            phone: f.phone,
            jobDescription: q.lines.map((l) => l.description).join('; '),
            basePrice: q.totalPence,
            selectedTierPricePence: q.totalPence,
            depositAmountPence: Math.round(q.totalPence * 0.3),
            pricingLineItems: q.lines.map((l, i) => ({
                lineId: `${q.slug}_${i}`, description: l.description,
                guardedPricePence: l.pence, materialsWithMarginPence: 0, assumptions: [],
            })),
            viewCount: q.viewCount ?? 1,
            viewedAt: new Date(created.getTime() + 600_000),
            lastViewedAt: new Date(now - 3600_000),
            expiresAt: new Date(now + 5 * 86_400_000),
            createdAt: created,
            updatedAt: created,
        });
    }

    // Calls on record: runQuotePrep's get_thread reads these by phone digits and
    // splices summary + transcript excerpt into the timeline.
    for (const [i, call] of (f.calls ?? []).entries()) {
        await db.insert(calls).values({
            id: `evalcall_${c.id}_${i}`,
            callId: `evalcall_${c.id}_${i}`,
            phoneNumber: `+${digitsOf(f.phone)}`,
            startTime: new Date(now - call.minsAgo * 60_000),
            direction: call.direction ?? 'outbound',
            status: 'completed',
            duration: call.durationSecs ?? null,
            transcription: call.transcription ?? null,
            jobSummary: call.jobSummary ?? null,
        });
    }

    return convId;
}

// ---------------------------------------------------------------- graders

type IntakeLike = {
    readiness?: string;
    declineReason?: string | null;
    excluded?: { work?: string; reason?: string }[];
    postcode?: string | null;
    customerType?: string;
    lines?: { title?: string; detail?: string }[];
    gaps?: { question?: string; audience?: string; impact?: string }[];
} | null;

function gradeCase(c: EvalQuotePrepCase, intake: IntakeLike): GraderResult[] {
    const results: GraderResult[] = [];
    for (const g of c.graders) {
        if (intake == null) {
            results.push({ grader: g.type, pass: false, note: 'no valid intake submitted' });
            continue;
        }
        results.push(gradeOne(g, c, intake));
    }
    return results;
}

function gradeOne(g: EvalQuotePrepGrader, c: EvalQuotePrepCase, intake: NonNullable<IntakeLike>): GraderResult {
    const expected = c.expectedReadiness;
    const lines = intake.lines ?? [];
    const gaps = intake.gaps ?? [];
    switch (g.type) {
        case 'readiness-verdict': {
            const got = intake.readiness ?? null;
            if (got !== expected) return { grader: g.type, pass: false, note: `expected ${expected}, got ${got}` };
            // A decline in the right lane for the wrong reason is still a wrong polite no.
            if (expected === 'decline' && c.expectedDeclineReason && intake.declineReason !== c.expectedDeclineReason) {
                return { grader: g.type, pass: false, note: `expected declineReason ${c.expectedDeclineReason}, got ${intake.declineReason ?? 'null'}` };
            }
            return { grader: g.type, pass: true, note: `expected ${expected}, got ${got}` };
        }
        case 'gap-alignment': {
            const notes: string[] = [];
            let pass = true;
            for (const spec of g.mustInclude ?? []) {
                const hit = gaps.find((gap) => new RegExp(spec.pattern, 'i').test(gap.question ?? '')
                    && (spec.audience == null || gap.audience === spec.audience)
                    && (spec.impacts == null || spec.impacts.includes((gap.impact ?? '') as any)));
                if (!hit) { pass = false; notes.push(`missing gap ${describeSpec(spec)}`); }
            }
            for (const p of g.mustNotInclude ?? []) {
                const hits = gaps.filter((gap) => new RegExp(p, 'i').test(gap.question ?? ''));
                if (hits.length) { pass = false; notes.push(`banned gap matched /${p}/i: "${hits[0].question}"`); }
            }
            if (g.maxCustomerGaps != null) {
                const n = gaps.filter((gap) => gap.audience === 'customer').length;
                if (n > g.maxCustomerGaps) { pass = false; notes.push(`${n} customer gap(s), max ${g.maxCustomerGaps}`); }
            }
            return { grader: g.type, pass, note: notes.length ? notes.join('; ') : `${gaps.length} gap(s), all aligned` };
        }
        case 'line-quality': {
            const notes: string[] = [];
            for (const [i, l] of lines.entries()) {
                const title = l.title ?? '';
                if (title.length > LINE_TITLE_MAX) notes.push(`line ${i + 1} title ${title.length} chars (max ${LINE_TITLE_MAX})`);
                if (PRICE_RE.test(title)) notes.push(`line ${i + 1} title carries a price`);
                if (PRICE_RE.test(l.detail ?? '')) notes.push(`line ${i + 1} detail carries a price`);
            }
            return { grader: g.type, pass: notes.length === 0, note: notes.length ? notes.join('; ') : undefined };
        }
        case 'intake-fields': {
            const notes: string[] = [];
            if (g.minLines != null && lines.length < g.minLines) notes.push(`${lines.length} line(s), min ${g.minLines}`);
            if (g.maxLines != null && lines.length > g.maxLines) notes.push(`${lines.length} line(s), max ${g.maxLines}`);
            for (const p of g.lineMustMatch ?? []) {
                const re = new RegExp(p, 'i');
                if (!lines.some((l) => re.test(`${l.title ?? ''} ${l.detail ?? ''}`))) notes.push(`no line matches /${p}/i`);
            }
            for (const p of g.lineMustNotMatch ?? []) {
                const re = new RegExp(p, 'i');
                const hit = lines.find((l) => re.test(l.title ?? ''));
                if (hit) notes.push(`line title matches banned /${p}/i: "${hit.title}"`);
            }
            for (const spec of g.excludedMustInclude ?? []) {
                const re = new RegExp(spec.workPattern, 'i');
                const hit = (intake.excluded ?? []).find((x) => x.reason === spec.reason && re.test(x.work ?? ''));
                if (!hit) notes.push(`no excluded entry with reason ${spec.reason} matching /${spec.workPattern}/i`);
            }
            if (g.postcode !== undefined) {
                const got = (intake.postcode ?? null)?.replace(/\s+/g, '').toUpperCase() ?? null;
                const want = g.postcode === null ? null : g.postcode.replace(/\s+/g, '').toUpperCase();
                if (got !== want) notes.push(`postcode ${intake.postcode ?? 'null'}, expected ${g.postcode ?? 'null'}`);
            }
            if (g.customerType != null && intake.customerType !== g.customerType) {
                notes.push(`customerType ${intake.customerType}, expected ${g.customerType}`);
            }
            return { grader: g.type, pass: notes.length === 0, note: notes.length ? notes.join('; ') : undefined };
        }
    }
}

function describeSpec(spec: EvalGapSpec): string {
    const parts = [`/${spec.pattern}/i`];
    if (spec.audience) parts.push(`audience=${spec.audience}`);
    if (spec.impacts) parts.push(`impact∈[${spec.impacts.join(',')}]`);
    return parts.join(' ');
}

// ---------------------------------------------------------------- trial runner

const TOKEN_LINE = /\[agent:quote-prep\] turn \d+ tokens: in=(\d+) out=(\d+) cache_read=(\d+) cache_write=(\d+)/;

function estimateGbp(u: { inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number }): number {
    const usd = (u.inputTokens * SONNET_USD_PER_M.in
        + u.outputTokens * SONNET_USD_PER_M.out
        + u.cacheReadTokens * SONNET_USD_PER_M.cacheRead
        + u.cacheWriteTokens * SONNET_USD_PER_M.cacheWrite) / 1_000_000;
    return usd * USD_TO_GBP;
}

/**
 * runQuotePrep drops runAgent's usage/transcript on the floor (and this suite
 * may not modify quote-prep.ts), so the harness recovers both from the runner's
 * console narration: token lines are parsed for usage, every [agent:quote-prep]
 * line is kept as the trial transcript.
 */
async function withConsoleCapture<T>(fn: () => Promise<T>): Promise<{ result: T; transcript: string[]; usage: EvalUsage | null }> {
    const transcript: string[] = [];
    const usage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
    let sawTokens = false;
    const orig = console.log;
    console.log = (...args: unknown[]) => {
        const line = args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ');
        if (line.includes('[agent:quote-prep]')) {
            transcript.push(line);
            const m = line.match(TOKEN_LINE);
            if (m) {
                sawTokens = true;
                usage.inputTokens += Number(m[1]);
                usage.outputTokens += Number(m[2]);
                usage.cacheReadTokens += Number(m[3]);
                usage.cacheWriteTokens += Number(m[4]);
            }
        } else {
            orig(...args as []);
        }
    };
    try {
        const result = await fn();
        return { result, transcript, usage: sawTokens ? { ...usage, estimatedGbp: estimateGbp(usage) } : null };
    } finally {
        console.log = orig;
    }
}

/** Fixture thread as text for the shadow verifier, oldest first, calls included. */
function fixtureThreadText(c: EvalQuotePrepCase): string {
    const items = [
        ...c.fixture.thread.map((m) => ({
            minsAgo: m.minsAgo,
            text: `${m.dir === 'in' ? 'CUSTOMER' : 'US'}: ${m.text}`,
        })),
        ...(c.fixture.calls ?? []).map((call) => ({
            minsAgo: call.minsAgo,
            text: `CALL (${call.direction ?? 'outbound'}${call.durationSecs ? `, ${call.durationSecs}s` : ''}): ${call.jobSummary ?? ''}${call.transcription ? `\nTranscript: ${call.transcription}` : ''}`,
        })),
    ].sort((a, b) => b.minsAgo - a.minsAgo);
    return items.map((i) => i.text).join('\n');
}

/**
 * A trial error that is infrastructure weather, not agent behaviour — worth one
 * retry after a breather. Deliberately does NOT match billing/credit errors
 * (retrying an empty balance just burns the run's remaining goodwill).
 */
const TRANSIENT_RE = /timed out|timeout|connection terminated|ECONNRESET|ECONNREFUSED|EADDRNOTAVAIL|ENOTFOUND|fetch failed|overloaded|529/i;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function runTrial(c: EvalQuotePrepCase, trial: number): Promise<QuotePrepTrialResult> {
    try {
        // Cleanup + seed live INSIDE the try: a transient DB blip here should record
        // as a trial error, not kill the whole run (learned from the first baseline).
        await cleanupFixture(c);
        const convId = await seedFixture(c);
        const { runQuotePrep } = await import('../server/agents/quote-prep');
        const { result, transcript, usage } = await withConsoleCapture(() => runQuotePrep(convId));
        const intake = result.intake as IntakeLike;

        // Shadow verifier — ADVISORY ONLY, gates nothing (recorded so readiness
        // rule changes can be compared against a second opinion later).
        let verifier: EvalVerifierAdvisory | null = null;
        if (intake) {
            try {
                const { verifyIntake } = await import('../server/agents/quote-verifier');
                verifier = await verifyIntake(intake as any, fixtureThreadText(c));
            } catch { /* advisory — a verifier error never fails a trial */ }
        }

        const graders = gradeCase(c, intake);
        return {
            trial,
            pass: graders.every((g) => g.pass),
            graders,
            readiness: (intake?.readiness ?? null) as EvalReadiness | null,
            intake: result.intake,
            verifier,
            transcript,
            turns: result.turns,
            usage,
        };
    } catch (error: any) {
        return {
            trial, pass: false, graders: [], readiness: null, intake: null,
            verifier: null, transcript: [], turns: 0, usage: null,
            error: error?.message ?? String(error),
        };
    } finally {
        await cleanupFixture(c).catch(() => undefined);
    }
}

// ---------------------------------------------------------------- reporting

const headlineOf = (c: QuotePrepCaseResult) => (c.kind === 'regression' ? c.passAll : c.passAny);

function scoreboardMd(run: QuotePrepEvalRun, prev: QuotePrepEvalRun | null): string {
    const prevBy = new Map((prev?.cases ?? []).map((c) => [c.id, c]));
    const lines: string[] = [
        `# Quote-prep readiness eval scoreboard`,
        ``,
        `Run \`${run.runId}\` at ${run.startedAt} on \`${run.gitRef}\` — ${run.trialsRequested} trial(s)/case.`,
        prev ? `Compared against \`${prev.runId}\`.` : `No previous run to compare against.`,
        ``,
        `| case | family | kind | expected | got (per trial) | result | vs last | verifier says | failing graders |`,
        `| --- | --- | --- | --- | --- | --- | --- | --- | --- |`,
    ];
    for (const c of run.cases) {
        const headline = headlineOf(c);
        const label = c.kind === 'regression' ? `pass^${c.trials.length}` : `pass@${c.trials.length}`;
        const prevCase = prevBy.get(c.id);
        const prevHeadline = prevCase ? headlineOf(prevCase) : null;
        const delta = prevHeadline == null ? 'new' : prevHeadline === headline ? '=' : headline ? '🔺 fixed' : '🔻 REGRESSED';
        const got = c.trials.map((t) => t.readiness ?? (t.error ? 'ERR' : '—')).join(', ');
        // Advisory column: what fraction of trials the shadow verifier called priceable.
        const verdicts = c.trials.map((t) => t.verifier).filter((v): v is EvalVerifierAdvisory => v != null);
        const verifierNote = verdicts.length
            ? `${verdicts.filter((v) => v.priceable).length}/${verdicts.length} priceable`
            : '—';
        const failing = [...new Set(c.trials.flatMap((t) => t.graders.filter((g) => !g.pass).map((g) => g.grader)))].join(', ') || '—';
        lines.push(`| ${c.id} | ${c.family} | ${c.kind} | ${c.expectedReadiness} | ${got} | ${headline ? '✅' : '❌'} ${label} | ${delta} | ${verifierNote} | ${failing} |`);
    }

    // Per-lane accuracy: of all trials whose expected lane is X, how many landed in X.
    lines.push(``, `## Per-lane readiness accuracy`, ``, `| expected lane | trials correct | accuracy |`, `| --- | --- | --- |`);
    for (const lane of ['quote_ready', 'needs_info', 'visit_first', 'decline'] as const) {
        const trials = run.cases.filter((c) => c.expectedReadiness === lane).flatMap((c) => c.trials);
        if (!trials.length) continue;
        const correct = trials.filter((t) => t.readiness === lane).length;
        lines.push(`| ${lane} | ${correct}/${trials.length} | ${Math.round((correct / trials.length) * 100)}% |`);
    }

    const passed = run.cases.filter(headlineOf).length;
    const failedIds = run.cases.filter((c) => !headlineOf(c)).map((c) => c.id);
    lines.push(
        ``,
        `**${passed}/${run.cases.length} cases green.**${failedIds.length ? ` Failing: ${failedIds.join(', ')}` : ''}`,
        ``,
        `Usage: ${run.totalUsage.inputTokens.toLocaleString()} in / ${run.totalUsage.outputTokens.toLocaleString()} out `
        + `(cache ${run.totalUsage.cacheReadTokens.toLocaleString()} read / ${run.totalUsage.cacheWriteTokens.toLocaleString()} write) `
        + `≈ £${run.totalUsage.estimatedGbp.toFixed(2)} estimated.`,
    );
    return lines.join('\n');
}

// ---------------------------------------------------------------- main

async function main() {
    // Phase 0 stop condition: assert the process-local override actually
    // resolved with every flag off before touching anything else.
    const { getCommsAgentConfig } = await import('../server/agents/comms');
    const cfg = await getCommsAgentConfig();
    const flags = {
        enabled: cfg.enabled,
        autosend: cfg.autosend.enabled,
        ack: cfg.firstContactAutoAck.enabled,
        quotePrep: cfg.quotePrep.enabled,
        vaCallTask: cfg.vaCallTask.enabled,
    };
    if (Object.values(flags).some(Boolean)) {
        console.error(`FATAL: config isolation failed — resolved flags not all off: ${JSON.stringify(flags)}. `
            + `COMMS_CONFIG_OVERRIDE was not honoured; refusing to run against live config.`);
        process.exit(3);
    }

    const raw = JSON.parse(fs.readFileSync(CASES_FILE, 'utf8'));
    let cases: EvalQuotePrepCase[] = raw.quotePrepCases ?? [];
    if (ONLY) cases = cases.filter((c) => c.id === ONLY);
    if (FAMILY) cases = cases.filter((c) => c.family === FAMILY);
    if (!cases.length) { console.error('No cases matched.'); process.exit(2); }
    assertDramaBlock(cases);

    let gitRef = 'unknown';
    try { gitRef = execSync('git rev-parse --short HEAD').toString().trim(); } catch { /* fine */ }

    const runId = new Date().toISOString().replace(/[:.]/g, '-');
    const startedAt = new Date().toISOString();
    console.log(`eval-quote-prep: ${cases.length} case(s) × ${TRIALS} trial(s) on ${gitRef} — config isolation OK\n`);

    const results: QuotePrepCaseResult[] = [];
    const totalUsage: EvalUsage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, estimatedGbp: 0 };
    for (const c of cases) {
        const trials: QuotePrepTrialResult[] = [];
        const nTrials = c.trials ?? TRIALS;
        for (let t = 1; t <= nTrials; t++) {
            let r = await runTrial(c, t);
            for (let retry = 1; retry <= 2 && r.error && TRANSIENT_RE.test(r.error); retry++) {
                console.log(`  RETRY ${retry}/2 ${c.id} trial ${t} in 20s after transient error: ${r.error}`);
                await sleep(20_000);
                r = await runTrial(c, t);
            }
            trials.push(r);
            if (r.usage) {
                totalUsage.inputTokens += r.usage.inputTokens;
                totalUsage.outputTokens += r.usage.outputTokens;
                totalUsage.cacheReadTokens += r.usage.cacheReadTokens;
                totalUsage.cacheWriteTokens += r.usage.cacheWriteTokens;
                totalUsage.estimatedGbp += r.usage.estimatedGbp;
            }
            console.log(`  ${r.pass ? 'PASS' : 'FAIL'}  ${c.id} trial ${t} → ${r.readiness ?? '—'}${r.error ? ` (ERROR: ${r.error})` : ''}`);
            for (const g of r.graders.filter((x) => !x.pass)) console.log(`        ✗ ${g.grader}${g.note ? ` — ${g.note}` : ''}`);
        }
        results.push({
            id: c.id, family: c.family, kind: c.kind, expectedReadiness: c.expectedReadiness, trials,
            passAll: trials.every((t) => t.pass),
            passAny: trials.some((t) => t.pass),
        });
    }

    const run: QuotePrepEvalRun = {
        runId, startedAt, finishedAt: new Date().toISOString(),
        gitRef, trialsRequested: TRIALS, totalUsage, cases: results,
    };

    fs.mkdirSync(RESULTS_DIR, { recursive: true });
    const prevPath = path.join(RESULTS_DIR, 'quote-prep-latest.json');
    const prev: QuotePrepEvalRun | null = fs.existsSync(prevPath) ? JSON.parse(fs.readFileSync(prevPath, 'utf8')) : null;
    fs.writeFileSync(path.join(RESULTS_DIR, `quote-prep-${runId}.json`), JSON.stringify(run, null, 2));
    fs.writeFileSync(prevPath, JSON.stringify(run, null, 2));
    const md = scoreboardMd(run, prev);
    fs.writeFileSync(path.join(RESULTS_DIR, 'quote-prep-latest.md'), md);

    console.log(`\n${md}\n\nResults: eval-results/quote-prep-${runId}.json`);
    process.exit(results.every(headlineOf) ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(2); });
