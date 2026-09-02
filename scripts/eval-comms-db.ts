/**
 * Comms agent eval harness, DATABASE-FIXTURE flavour (docs/COMMS_EVALS_PLAN.md Phase 1).
 *
 * Renamed from scripts/eval-comms.ts on 2 Sep 2026 (Phase 2 / C): the no-database harness now
 * owns that name. This one seeds real rows and runs the legacy agent, so it needs a Neon BRANCH
 * (never production: server/__tests__/setup.ts and the worker gate both refuse ep-broad-king).
 *
 *   npx tsx scripts/eval-comms-db.ts                 # all cases, 1 trial each
 *   npx tsx scripts/eval-comms-db.ts --trials 3      # scoreboard run (pass^3 headline)
 *   npx tsx scripts/eval-comms-db.ts --only rf-001-naeem-belief-hygiene
 *
 * Cases are DATA (eval-cases/*.json, schema in shared/eval-types.ts). Per trial the
 * harness seeds the case's thread under its Ofcom drama number, runs the agent (or the
 * named unit check), grades what actually happened — the drafted text and the DB
 * outcome, never the tool-call path — then deletes the fixture. Results land in
 * eval-results/<runId>.json plus a markdown scoreboard with deltas vs the last run.
 *
 * Config isolation: COMMS_CONFIG_OVERRIDE (process-local) forces the kill switch off
 * for the harness process — live flags are never written, and nothing can auto-send.
 * NEVER pipe this script through head/grep (SIGPIPE kills the run mid-fixture);
 * redirect to a file instead.
 */
import 'dotenv/config';

// Process-local config BEFORE any agent import: agent on, autosend off (drafts queue,
// nothing sends), ack + auto-quote-prep off (the harness drives triggers itself).
process.env.COMMS_CONFIG_OVERRIDE = JSON.stringify({
    enabled: true,
    autosend: { enabled: false, intents: [] },
    firstContactAutoAck: { enabled: false, channels: [] },
    quotePrep: { enabled: false },
});
process.env.FIRST_CONTACT_ACK_NO_HOLD = '1';

import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { db } from '../server/db';
import { conversations, messages, messageDrafts, agentQuestions, personalizedQuotes } from '@shared/schema';
import { eq, sql, desc } from 'drizzle-orm';
import { chatVoiceViolations } from '@shared/chat-voice';
import type { EvalCase, EvalGrader, GraderResult, TrialResult, CaseResult, EvalRun } from '@shared/eval-types';

const ARGS = process.argv.slice(2);
const arg = (name: string): string | null => {
    const i = ARGS.indexOf(`--${name}`);
    return i >= 0 ? (ARGS[i + 1] ?? null) : null;
};
const TRIALS = Math.max(1, Number(arg('trials') ?? 1));
const ONLY = arg('only');

const CASES_DIR = path.resolve(process.cwd(), 'eval-cases');
const RESULTS_DIR = path.resolve(process.cwd(), 'eval-results', 'db');

// ---------------------------------------------------------------- fixtures

const digitsOf = (phone: string) => phone.replace(/\D/g, '');
const convKeyOf = (phone: string) => `${digitsOf(phone)}@c.us`;
const convIdOf = (c: EvalCase) => `eval_${c.id.replace(/[^a-z0-9]/gi, '_')}`;

async function cleanupFixture(c: EvalCase): Promise<void> {
    const phone = c.fixture.phone;
    await db.delete(messages).where(eq(messages.conversationId, convIdOf(c)));
    await db.delete(messageDrafts).where(sql`regexp_replace(${messageDrafts.phone}, '[^0-9]', '', 'g') = ${digitsOf(phone)}`);
    await db.delete(agentQuestions).where(sql`regexp_replace(${agentQuestions.phone}, '[^0-9]', '', 'g') = ${digitsOf(phone)}`);
    await db.delete(personalizedQuotes).where(sql`regexp_replace(${personalizedQuotes.phone}, '[^0-9]', '', 'g') = ${digitsOf(phone)}`);
    await db.delete(conversations).where(eq(conversations.id, convIdOf(c)));
}

async function seedFixture(c: EvalCase): Promise<string> {
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

    // Ack-reply cases need a SENT first_contact_ack draft on record — that is what
    // triageAckReply uses to decide "was there a recent call-offer to answer".
    if (f.sentAckMinsAgo != null) {
        const at = new Date(now - f.sentAckMinsAgo * 60_000);
        await db.insert(messageDrafts).values({
            id: `evalack_${c.id}`,
            conversationId: convId,
            phone: f.phone,
            body: 'Is it OK if we give you a quick call to run through it? Or just reply here with the details and we will price it up.',
            channel: 'whatsapp',
            source: 'first_contact_ack',
            reason: '[ack_enquiry] eval fixture',
            status: 'sent',
            createdAt: at,
            sentAt: at,
        });
    }

    return convId;
}

// ---------------------------------------------------------------- graders

function gradeDraft(grader: EvalGrader, draft: string | null): GraderResult {
    const name = grader.type;
    if (draft == null) return { grader: name, pass: false, note: 'no draft to grade' };
    switch (grader.type) {
        case 'draft-must-match': {
            const missing = grader.patterns.filter((p) => !new RegExp(p, 'i').test(draft));
            return { grader: name, pass: missing.length === 0, note: missing.length ? `missing: ${missing.join(' | ')}` : undefined };
        }
        case 'draft-must-not-match': {
            const hits = grader.patterns.filter((p) => new RegExp(p, 'i').test(draft));
            return { grader: name, pass: hits.length === 0, note: hits.length ? `matched: ${hits.join(' | ')}` : undefined };
        }
        case 'question-count-max': {
            const n = (draft.match(/\?/g) ?? []).length;
            return { grader: name, pass: n <= grader.max, note: `${n} question(s), max ${grader.max}` };
        }
        case 'chat-voice': {
            const violations = chatVoiceViolations(draft);
            return { grader: name, pass: violations.length === 0, note: violations.length ? violations.map((v: any) => v.rule ?? String(v)).join(', ') : undefined };
        }
        default:
            return { grader: name, pass: false, note: 'grader not applicable to draft' };
    }
}

async function runAgentTrial(c: EvalCase, trial: number): Promise<TrialResult> {
    await cleanupFixture(c);
    const convId = await seedFixture(c);
    try {
        const { runCommsAgent } = await import('../server/agents/comms');
        const outcome = await runCommsAgent(convId, c.trigger);

        // The drafted reply: every queue_draft body this run produced, joined — burst
        // messages grade as one text (question budget is per-reply, not per-bubble).
        const bodies = outcome.actions
            .filter((a) => a.tool === 'queue_draft')
            .map((a) => String(a.input?.body ?? ''))
            .filter(Boolean);
        const draft = bodies.length ? bodies.join('\n---\n') : null;

        const [conv] = await db.select({ tags: conversations.tags }).from(conversations).where(eq(conversations.id, convId));
        const tags: string[] = conv?.tags ?? [];

        const graders: GraderResult[] = [];
        for (const g of c.graders) {
            if (g.type === 'replied') {
                graders.push({ grader: g.type, pass: draft != null, note: draft == null ? 'agent produced no reply' : undefined });
            } else if (g.type === 'no-autosend') {
                graders.push({ grader: g.type, pass: !outcome.autosent, note: outcome.autosent ? 'AUTOSENT with kill switch off!' : undefined });
            } else if (g.type === 'tag') {
                const has = tags.includes(g.tag);
                graders.push({ grader: `tag:${g.tag}`, pass: has === g.expect, note: `tags=[${tags.join(',')}]` });
            } else if (g.type === 'unit') {
                graders.push({ grader: `unit:${g.name}`, pass: false, note: 'unit grader on an agent-trigger case' });
            } else {
                graders.push(gradeDraft(g, draft));
            }
        }
        return { trial, pass: graders.every((g) => g.pass), graders, draft, escalated: outcome.escalated, autosent: outcome.autosent };
    } catch (error: any) {
        return { trial, pass: false, graders: [], draft: null, escalated: false, autosent: false, error: error?.message ?? String(error) };
    } finally {
        await cleanupFixture(c).catch(() => undefined);
    }
}

async function runUnitTrial(c: EvalCase, trial: number): Promise<TrialResult> {
    await cleanupFixture(c);
    const convId = await seedFixture(c);
    try {
        const graders: GraderResult[] = [];
        for (const g of c.graders) {
            if (g.type === 'unit' && g.name === 'ack-reply-consent') {
                const { triageAckReply } = await import('../server/first-contact-ack');
                const out = await triageAckReply({ conversationId: convId, phone: c.fixture.phone, text: g.text });
                graders.push({
                    grader: `unit:${g.name}`,
                    pass: (out.tagged ?? null) === g.expectTagged,
                    note: `tagged=${out.tagged} reason=${out.reason}${out.matched ? ` matched=${out.matched}` : ''}`,
                });
            } else if (g.type === 'tag') {
                const [conv] = await db.select({ tags: conversations.tags }).from(conversations).where(eq(conversations.id, convId));
                const tags: string[] = conv?.tags ?? [];
                graders.push({ grader: `tag:${g.tag}`, pass: tags.includes(g.tag) === g.expect, note: `tags=[${tags.join(',')}]` });
            }
        }
        return { trial, pass: graders.every((g) => g.pass), graders, draft: null, escalated: false, autosent: false };
    } catch (error: any) {
        return { trial, pass: false, graders: [], draft: null, escalated: false, autosent: false, error: error?.message ?? String(error) };
    } finally {
        await cleanupFixture(c).catch(() => undefined);
    }
}

// ---------------------------------------------------------------- reporting

function scoreboardMd(run: EvalRun, prev: EvalRun | null): string {
    const prevBy = new Map((prev?.cases ?? []).map((c) => [c.id, c]));
    const lines: string[] = [
        `# Comms eval scoreboard`,
        ``,
        `Run \`${run.runId}\` at ${run.startedAt} on \`${run.gitRef}\` — ${run.trialsRequested} trial(s)/case.`,
        prev ? `Compared against \`${prev.runId}\`.` : `No previous run to compare against.`,
        ``,
        `| case | family | kind | result | vs last | failing graders |`,
        `| --- | --- | --- | --- | --- | --- |`,
    ];
    for (const c of run.cases) {
        const headline = c.kind === 'regression' ? c.passAll : c.passAny;
        const label = c.kind === 'regression' ? `pass^${c.trials.length}` : `pass@${c.trials.length}`;
        const prevCase = prevBy.get(c.id);
        const prevHeadline = prevCase ? (prevCase.kind === 'regression' ? prevCase.passAll : prevCase.passAny) : null;
        const delta = prevHeadline == null ? 'new' : prevHeadline === headline ? '=' : headline ? '🔺 fixed' : '🔻 REGRESSED';
        const failing = [...new Set(c.trials.flatMap((t) => t.graders.filter((g) => !g.pass).map((g) => g.grader)))].join(', ') || '—';
        lines.push(`| ${c.id} | ${c.family} | ${c.kind} | ${headline ? '✅' : '❌'} ${label} | ${delta} | ${failing} |`);
    }
    const passed = run.cases.filter((c) => (c.kind === 'regression' ? c.passAll : c.passAny)).length;
    lines.push(``, `**${passed}/${run.cases.length} cases green.**`);
    return lines.join('\n');
}

// ---------------------------------------------------------------- main

async function main() {
    const files = fs.readdirSync(CASES_DIR).filter((f) => f.endsWith('.json'));
    let cases: EvalCase[] = files.flatMap((f) => JSON.parse(fs.readFileSync(path.join(CASES_DIR, f), 'utf8')).cases as EvalCase[]);
    if (ONLY) cases = cases.filter((c) => c.id === ONLY);
    if (!cases.length) { console.error('No cases matched.'); process.exit(2); }

    let gitRef = 'unknown';
    try { gitRef = execSync('git rev-parse --short HEAD').toString().trim(); } catch { /* fine */ }

    const runId = new Date().toISOString().replace(/[:.]/g, '-');
    const startedAt = new Date().toISOString();
    console.log(`eval-comms: ${cases.length} case(s) × ${TRIALS} trial(s) on ${gitRef}\n`);

    const results: CaseResult[] = [];
    for (const c of cases) {
        const trials: TrialResult[] = [];
        const nTrials = c.trigger === 'unit' ? 1 : (c.trials ?? TRIALS); // unit checks are deterministic
        for (let t = 1; t <= nTrials; t++) {
            const r = c.trigger === 'unit' ? await runUnitTrial(c, t) : await runAgentTrial(c, t);
            trials.push(r);
            console.log(`  ${r.pass ? 'PASS' : 'FAIL'}  ${c.id} trial ${t}${r.error ? ` (ERROR: ${r.error})` : ''}`);
            for (const g of r.graders.filter((x) => !x.pass)) console.log(`        ✗ ${g.grader}${g.note ? ` — ${g.note}` : ''}`);
        }
        results.push({
            id: c.id, family: c.family, kind: c.kind, trials,
            passAll: trials.every((t) => t.pass),
            passAny: trials.some((t) => t.pass),
        });
    }

    const run: EvalRun = { runId, startedAt, finishedAt: new Date().toISOString(), gitRef, trialsRequested: TRIALS, cases: results };

    fs.mkdirSync(RESULTS_DIR, { recursive: true });
    const prevPath = path.join(RESULTS_DIR, 'latest.json');
    const prev: EvalRun | null = fs.existsSync(prevPath) ? JSON.parse(fs.readFileSync(prevPath, 'utf8')) : null;
    fs.writeFileSync(path.join(RESULTS_DIR, `${runId}.json`), JSON.stringify(run, null, 2));
    fs.writeFileSync(prevPath, JSON.stringify(run, null, 2));
    const md = scoreboardMd(run, prev);
    fs.writeFileSync(path.join(RESULTS_DIR, 'latest.md'), md);

    console.log(`\n${md}\n\nResults: eval-results/${runId}.json`);
    const greens = results.filter((c) => (c.kind === 'regression' ? c.passAll : c.passAny)).length;
    process.exit(greens === results.length ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(2); });
