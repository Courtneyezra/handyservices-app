/**
 * Contract 7, piece two: the scenario.
 *
 * A scripted conversation: the checklist lines it exercises; a seed for the party, their
 * channels, the window state, any prior facts and ledger entries; then turns from the customer,
 * from Ben, or from the system, each with its expectations. One scenario may cover several lines;
 * every Goal 1 line has at least one scenario (scenario.test.ts pins that).
 *
 * Seeds make "known customer", "prefers text", "already rang us" and "window shut" reproducible
 * by stating them. Which of them the current sandbox door can honour is the runner's business
 * (door.ts seedPlan); the format states the intent, the report records what was honoured.
 *
 * Scenario files live in ./scenarios/*.json and are validated by this schema on load.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

// ---------------------------------------------------------------- the Goal 1 lines

/** design.md "Goal 1's stop condition, line by line": the WhatsApp lines of Stage 1 and all of Stage 2. */
export const GOAL_1_LINES = ['1.1', '1.6', '1.7', '2.1', '2.2', '2.3', '2.4', '2.5', '2.6', '2.7', '2.8'] as const;
export type Goal1Line = (typeof GOAL_1_LINES)[number];

/** Any checklist line id, e.g. "2.3" or a cross-cutting "x.1". */
export const lineIdSchema = z.string().regex(/^(x|\d)\.\d{1,2}$/);

// ---------------------------------------------------------------- the seed

export const askSubjectSchema = z.enum(['media', 'postcode', 'access', 'handoff']);
export type AskSubject = z.infer<typeof askSubjectSchema>;

export const seedSchema = z.object({
    /** Known: a customer record and past threads exist. New: nothing on file. */
    customer: z.enum(['new', 'known']).default('new'),
    /** The name the channel knows them by (a WhatsApp pushname). Null: unknown. */
    name: z.string().max(60).nullable().default(null),
    /** The party has said text only; the desk must not offer a call. */
    prefersText: z.boolean().default(false),
    /** The party has already rung us, so "is it OK if we call" is never asked. */
    alreadyRung: z.boolean().default(false),
    /** The party's channels. Goal 1 is WhatsApp only. */
    channels: z.array(z.enum(['whatsapp', 'sms', 'email'])).min(1).default(['whatsapp']),
    /** The 24-hour WhatsApp window at the start of the scenario. */
    window: z.enum(['open', 'shut']).default('open'),
    /** Prior facts on the case file (Contract 2). */
    facts: z.array(z.object({ key: z.string(), value: z.string(), source: z.string() })).default([]),
    /** Prior ask-ledger entries (Contract 2). */
    ledger: z.array(z.object({ subject: askSubjectSchema, state: z.enum(['asked', 'answered', 'thanked']) })).default([]),
});
export type Seed = z.infer<typeof seedSchema>;

// ---------------------------------------------------------------- expectations

/**
 * Per turn, any of (Contract 7): a reply is or is not sent; the reply asks a named subject, or
 * does not; no figure, no date, no commitment appears; a hold is raised for a named approver; a
 * template is used; the stage after the turn; the bubble count is within the ceiling; a fixed
 * line appears verbatim. Deterministic assertions over the planned send and the file.
 *
 * Two kinds check the rendered text directly beyond that list, which the old desk can supply:
 * `text_matches` (a regex over the bubbles) and `offers_call` / `not_offers_call` (1.1 and 1.6
 * are about the call offer). `asked_at_most_once` reads the scenario's history so 2.2 ("asks for
 * a photo once") is checkable without a ledger.
 *
 * `own_words` is the one expectation that carries a model verdict, beside a deterministic
 * assertion (one question at a time, no template placeholder), never instead of it. The schema
 * allows it on line 2.3 only.
 */
const base = { line: lineIdSchema, note: z.string().optional() };

export const expectationSchema = z.discriminatedUnion('kind', [
    z.object({ ...base, kind: z.literal('reply_sent') }),
    z.object({ ...base, kind: z.literal('reply_not_sent') }),
    z.object({ ...base, kind: z.literal('asks_subject'), subject: z.union([askSubjectSchema, z.literal('any')]) }),
    z.object({ ...base, kind: z.literal('not_asks_subject'), subject: askSubjectSchema }),
    z.object({ ...base, kind: z.literal('asked_at_most_once'), subject: askSubjectSchema }),
    z.object({ ...base, kind: z.literal('no_figure') }),
    z.object({ ...base, kind: z.literal('no_date') }),
    z.object({ ...base, kind: z.literal('no_commitment') }),
    z.object({ ...base, kind: z.literal('hold_for_approver'), approver: z.string() }),
    z.object({ ...base, kind: z.literal('no_hold') }),
    z.object({ ...base, kind: z.literal('template_used'), templateId: z.string().optional() }),
    z.object({ ...base, kind: z.literal('freeform') }),
    z.object({ ...base, kind: z.literal('window_state'), state: z.enum(['open', 'shut']) }),
    z.object({ ...base, kind: z.literal('stage_after'), stage: z.string() }),
    z.object({ ...base, kind: z.literal('bubble_count_within'), max: z.number().int().positive() }),
    z.object({ ...base, kind: z.literal('fixed_line'), text: z.string().min(1) }),
    z.object({ ...base, kind: z.literal('text_matches'), pattern: z.string().min(1), flags: z.string().optional() }),
    z.object({ ...base, kind: z.literal('offers_call') }),
    z.object({ ...base, kind: z.literal('not_offers_call') }),
    z.object({ ...base, kind: z.literal('own_words') }),
]).superRefine((e, ctx) => {
    if (e.kind === 'own_words' && e.line !== '2.3') {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'own_words (the model judge) is allowed on line 2.3 only' });
    }
    if (e.kind === 'text_matches') {
        try { new RegExp(e.pattern, e.flags ?? 'i'); } catch (err: any) { ctx.addIssue({ code: z.ZodIssueCode.custom, message: `bad pattern: ${err?.message ?? err}` }); }
    }
});
export type Expectation = z.infer<typeof expectationSchema>;
export type ExpectationKind = Expectation['kind'];

// ---------------------------------------------------------------- turns

export const mediaRefSchema = z.object({
    /** A file under ./scenarios/fixtures. */
    file: z.string().regex(/^[a-z0-9_.-]+$/i),
    mime: z.enum(['image/jpeg', 'image/png', 'image/webp', 'video/mp4']),
});
export type MediaRef = z.infer<typeof mediaRefSchema>;

export const turnSchema = z.discriminatedUnion('kind', [
    /** The customer writes on WhatsApp (the Goal 1 door). The first customer turn opens the thread. */
    z.object({ from: z.literal('customer'), kind: z.literal('message'), text: z.string().max(2000), media: z.array(mediaRefSchema).max(8).default([]), expect: z.array(expectationSchema).default([]) }),
    /** Ben rings them and the call is answered; the transcript is what was said. */
    z.object({ from: z.literal('ben'), kind: z.literal('call'), transcript: z.string().min(40).max(8000), expect: z.array(expectationSchema).default([]) }),
    /** Ben prices the waiting draft and sends the quote. */
    z.object({ from: z.literal('ben'), kind: z.literal('price'), totalPence: z.number().int().positive().optional(), expect: z.array(expectationSchema).default([]) }),
    /** A clock pass with no new message: what a sweep does live. */
    z.object({ from: z.literal('system'), kind: z.literal('clock'), expect: z.array(expectationSchema).default([]) }),
    /** Time passes: every timestamp on the thread moves back by N hours (shuts the window past 24). */
    z.object({ from: z.literal('system'), kind: z.literal('age'), hours: z.number().positive().max(720), expect: z.array(expectationSchema).default([]) }),
]);
export type Turn = z.infer<typeof turnSchema>;

// ---------------------------------------------------------------- the scenario

export const scenarioSchema = z.object({
    id: z.string().regex(/^[a-z0-9][a-z0-9.-]*$/),
    title: z.string().min(1),
    /** The checklist lines this scenario judges. Every expectation's line must be one of them. */
    lines: z.array(lineIdSchema).min(1),
    /** The door every turn enters through. Goal 1 is WhatsApp only. */
    door: z.literal('whatsapp').default('whatsapp'),
    seed: seedSchema.default({}),
    turns: z.array(turnSchema).min(1),
}).superRefine((s, ctx) => {
    if (s.turns[0].from !== 'customer') ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'the first turn must be the customer (their message opens the WhatsApp thread)' });
    s.turns.forEach((t, i) => t.expect.forEach((e, j) => {
        if (!s.lines.includes(e.line)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['turns', i, 'expect', j, 'line'], message: `line ${e.line} is not in the scenario's lines` });
    }));
});
export type Scenario = z.infer<typeof scenarioSchema>;

// ---------------------------------------------------------------- loading

const here = path.dirname(fileURLToPath(import.meta.url));
export const SCENARIOS_DIR = path.join(here, 'scenarios');
export const FIXTURES_DIR = path.join(SCENARIOS_DIR, 'fixtures');

export function parseScenario(raw: unknown, source = 'scenario'): Scenario {
    const parsed = scenarioSchema.safeParse(raw);
    if (!parsed.success) throw new Error(`${source}: ${parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ')}`);
    return parsed.data;
}

export function loadScenarioFile(file: string): Scenario {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    return parseScenario(raw, path.basename(file));
}

/** Every scenario in the directory, by file name order. */
export function loadScenarios(dir = SCENARIOS_DIR): Scenario[] {
    return fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort().map((f) => loadScenarioFile(path.join(dir, f)));
}

/** Which Goal 1 lines have no scenario. Empty when the set is complete. */
export function uncoveredGoal1Lines(scenarios: readonly Scenario[]): Goal1Line[] {
    const covered = new Set(scenarios.flatMap((s) => s.turns.flatMap((t) => t.expect.map((e) => e.line))));
    return GOAL_1_LINES.filter((l) => !covered.has(l));
}
