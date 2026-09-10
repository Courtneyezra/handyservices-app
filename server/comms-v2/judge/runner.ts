/**
 * Contract 7, piece four: the runner.
 *
 * Drives scenarios through the sandbox door one turn at a time, waits for the planned send,
 * checks each expectation, and runs the whole set twice: a line passes only when it passes both
 * times. A run that cannot reach a door, or times out, is reported as error, never as pass; a
 * fail is not an error. The exit code is the report's business (report.ts).
 *
 * The runner never calls a specialist, a prompt or a model directly. The one model call it makes
 * is the own-words judge for line 2.3, recorded beside the deterministic result (model-judge.ts).
 */
import { DoorError, loadFixture, seedPlan, type DoorClient, type SeedPlan } from './door';
import { evaluate, type EvalContext, type ExpectationResult, type SeedFeature } from './expectations';
import { OWN_WORDS_MODEL, buildOwnWordsPrompt, type ModelJudge, type ModelVerdict } from './model-judge';
import { doorStateSchema, plannedSendFromDoorResponse, type DoorPass, type PlannedSend } from './planned-send';
import { GOAL_1_LINES, type Scenario, type Turn } from './scenario';

// ---------------------------------------------------------------- results

export type LineStatus = 'pass' | 'fail' | 'error';

export interface CaseFileSnapshot {
    conversationId: string | null;
    stage: string | null;
    tags: string[];
    contactName: string | null;
    window: { canFreeform: boolean; summary: string | null } | null;
    messages: Array<{ direction: string; channel: string | null; sender: string | null; at: string | null; content: string }>;
    quote: { slug: string | null; basePrice: number | null; isDraft: boolean | null } | null;
    openFlags: unknown[];
    openPromises: unknown[];
    lastCall: { callId: string; preview: string } | null;
}

export interface ExpectationRecord extends ExpectationResult {
    /** Line 2.3 only: the model's verdict, beside the deterministic result above, never instead of it. */
    modelJudge?: ModelVerdict;
}

export interface TurnResult {
    index: number;
    from: Turn['from'];
    kind: Turn['kind'];
    /** What entered the door: the customer's words, the transcript's first line, the clock, the hours. */
    input: string;
    plannedSend: PlannedSend | null;
    /** Whether the door put the planned reply on the thread; null when nothing was to go. */
    landed: boolean | null;
    snapshot: CaseFileSnapshot | null;
    expectations: ExpectationRecord[];
    durationMs: number;
    error: string | null;
}

export interface ScenarioRunResult {
    scenarioId: string;
    title: string;
    lines: string[];
    run: number;
    seed: { requested: Scenario['seed']; plan: SeedPlan; unsupported: SeedFeature[] };
    turns: TurnResult[];
    error: string | null;
    startedAt: string;
    durationMs: number;
}

export interface LineRunVerdict {
    run: number;
    status: LineStatus;
    /** One line per expectation, so a reader sees why without the JSON. */
    reasons: string[];
}

export interface LineEvidence {
    scenarioId: string;
    run: number;
    turnIndex: number;
    plannedSend: PlannedSend | null;
    snapshot: CaseFileSnapshot | null;
    expectations: ExpectationRecord[];
}

export interface LineResult {
    line: string;
    status: LineStatus;
    perRun: LineRunVerdict[];
    evidence: LineEvidence[];
}

export interface JudgeResult {
    generatedAt: string;
    desk: string;
    door: { mode: string; host: string };
    runs: number;
    lines: LineResult[];
    scenarios: ScenarioRunResult[];
    summary: { pass: number; fail: number; error: number };
    exitCode: number;
}

// ---------------------------------------------------------------- one turn through the door

function turnInput(t: Turn): string {
    switch (t.kind) {
        case 'message': return t.media.length ? `${t.text} [+${t.media.length} media]` : t.text;
        case 'call': return `call: ${t.transcript.slice(0, 80)}`;
        case 'price': return `price${t.totalPence ? ` ${t.totalPence}p` : ''}`;
        case 'clock': return 'clock pass';
        case 'age': return `age ${t.hours} h`;
    }
}

/** The file after the turn, read from the door's own state. Pure. */
export function snapshotFrom(pass: DoorPass): CaseFileSnapshot {
    const s = pass.state as Record<string, any>;
    const conv = s.conversation ?? null;
    const messages = Array.isArray(s.messages) ? s.messages : [];
    const quote = s.quote ?? null;
    const run = (pass.run ?? null) as Record<string, any> | null;
    return {
        conversationId: conv?.id ?? null,
        stage: conv?.stage ?? null,
        tags: Array.isArray(conv?.tags) ? conv.tags : [],
        contactName: conv?.contactName ?? null,
        window: s.window ? { canFreeform: !!s.window.canFreeform, summary: s.window.summary ?? null } : null,
        messages: messages.map((m: any) => ({
            direction: String(m.direction ?? ''), channel: m.channel ?? null, sender: m.senderName ?? null,
            at: m.createdAt ? String(m.createdAt) : null, content: String(m.content ?? '').slice(0, 300),
        })),
        quote: quote ? { slug: quote.slug ?? null, basePrice: quote.basePrice ?? null, isDraft: quote.isDraft ?? null } : null,
        openFlags: run?.caseFile?.openFlags ?? [],
        openPromises: run?.caseFile?.openPromises ?? [],
        lastCall: s.lastCall ? { callId: String(s.lastCall.callId), preview: String(s.lastCall.preview ?? '') } : null,
    };
}

/**
 * Whether the door put this turn's planned reply on the thread, read from the door's own state:
 * an outbound message carrying the first bubble. The current sandbox lands only the rules-layer
 * first-contact ack; a desk send in dry run never reaches the exit, so it is not there. Pure.
 */
export function sendLanded(ps: PlannedSend, pass: DoorPass): boolean {
    const first = ps.bubbles[0]?.trim();
    if (!first) return false;
    const messages = (pass.state as { messages?: unknown }).messages;
    if (!Array.isArray(messages)) return false;
    return messages.some((m) => m && typeof m === 'object' && (m as { direction?: unknown }).direction === 'outbound' && typeof (m as { content?: unknown }).content === 'string' && ((m as { content: string }).content).includes(first));
}

async function enter(door: DoorClient, scenario: Scenario, t: Turn, index: number): Promise<unknown> {
    switch (t.kind) {
        case 'message': {
            const media = t.media.map((m) => loadFixture(m.file, m.mime));
            if (index === 0) {
                if (media.length) {
                    // POST /start carries text only. An opening message with photos is a clean thread
                    // (POST /reset) and then the photos with their caption on POST /message, which is
                    // how the live writer shapes a first WhatsApp that arrives with media.
                    await door.reset();
                    return door.message({ text: t.text, media });
                }
                return door.start({ text: t.text, name: scenario.seed.name });
            }
            return door.message({ text: t.text, media });
        }
        case 'call': return door.call(t.transcript);
        case 'price': return door.price(t.totalPence);
        case 'clock': return door.clock();
        case 'age': return door.age(t.hours);
    }
}

/** The window as the door reports it, or null when the response carried no state. */
function windowOpenOf(raw: unknown): boolean | null {
    const r = raw as { state?: unknown; window?: { canFreeform?: boolean } } | null;
    const st = doorStateSchema.safeParse(r?.state);
    if (st.success && st.data.window) return st.data.window.canFreeform;
    if (r?.window && typeof r.window.canFreeform === 'boolean') return r.window.canFreeform;
    return null;
}

// ---------------------------------------------------------------- one scenario, one run

export interface RunScenarioOptions {
    door: DoorClient;
    judge: ModelJudge | null;
    run: number;
    log?: (line: string) => void;
}

export async function runScenario(scenario: Scenario, opts: RunScenarioOptions): Promise<ScenarioRunResult> {
    const startedAt = new Date();
    const log = opts.log ?? (() => undefined);
    const plan = seedPlan(scenario.seed);
    const unsupported = new Set<SeedFeature>(Object.keys(plan.unsupported) as SeedFeature[]);
    const result: ScenarioRunResult = {
        scenarioId: scenario.id, title: scenario.title, lines: scenario.lines, run: opts.run,
        seed: { requested: scenario.seed, plan, unsupported: [] }, turns: [], error: null,
        startedAt: startedAt.toISOString(), durationMs: 0,
    };
    const history: PlannedSend[] = [];
    let priorSendNotLanded = false;
    let aborted: string | null = null;

    for (let i = 0; i < scenario.turns.length; i++) {
        const t = scenario.turns[i];
        const tr: TurnResult = { index: i, from: t.from, kind: t.kind, input: turnInput(t), plannedSend: null, landed: null, snapshot: null, expectations: [], durationMs: 0, error: null };
        const t0 = Date.now();
        if (aborted) {
            tr.error = `not run: ${aborted}`;
            tr.expectations = t.expect.map((e) => ({ line: e.line, kind: e.kind, status: 'error' as const, reason: tr.error! }));
            result.turns.push(tr);
            continue;
        }
        try {
            log(`  turn ${i + 1}/${scenario.turns.length} ${t.from}/${t.kind}: ${tr.input.slice(0, 70)}`);
            let raw = await enter(opts.door, scenario, t, i);
            // The seed's after-start steps run once the thread exists, before any second turn.
            if (i === 0) {
                for (const step of plan.afterStart) {
                    if (step.op === 'age') {
                        const aged = await opts.door.age(step.hours);
                        const open = windowOpenOf(aged);
                        if (open !== false) {
                            unsupported.add('window');
                            plan.unsupported.window = `POST /age ${step.hours} h did not shut the window (door reports ${open === null ? 'no window state' : 'open'})`;
                            delete plan.honoured.window;
                        }
                        // The planned send for the opening turn stands; only the state after ageing is newer.
                        raw = { ...(raw as object), state: (aged as { state?: unknown }).state ?? (raw as { state?: unknown }).state };
                    }
                }
            }
            const { pass, plannedSend } = waitForPlannedSend(raw, t);
            tr.plannedSend = plannedSend;
            tr.snapshot = snapshotFrom(pass);
            const ctx: EvalContext = { plannedSend, history, seed: scenario.seed, seedUnsupported: Array.from(unsupported), priorSendNotLanded };
            for (const e of t.expect) {
                let rec: ExpectationRecord;
                try { rec = evaluate(e, ctx); } catch (err: any) { rec = { line: e.line, kind: e.kind, status: 'error', reason: `evaluator threw: ${err?.message ?? err}` }; }
                if (e.kind === 'own_words' && opts.judge && t.kind === 'message') {
                    // The model judges wording, so it is only asked when there are words: an undelivered
                    // reply is already a deterministic fail, recorded above.
                    rec.modelJudge = plannedSend.delivered
                        ? await opts.judge.ownWords({ customerText: t.text, bubbles: plannedSend.bubbles })
                        : { model: OWN_WORDS_MODEL, promptHash: buildOwnWordsPrompt({ customerText: t.text, bubbles: [] }).hash, verdict: 'skipped', reason: 'no reply to judge' };
                }
                tr.expectations.push(rec);
            }
            history.push(plannedSend);
            tr.landed = plannedSend.delivered ? sendLanded(plannedSend, pass) : null;
            if (tr.landed === false) priorSendNotLanded = true;
        } catch (err: any) {
            const msg = err instanceof DoorError ? `door ${err.kind}: ${err.message}` : `turn failed: ${err?.message ?? err}`;
            tr.error = msg;
            tr.expectations = t.expect.map((e) => ({ line: e.line, kind: e.kind, status: 'error' as const, reason: msg }));
            aborted = msg;
            result.error = msg;
            log(`  ERROR ${msg}`);
        }
        tr.durationMs = Date.now() - t0;
        result.turns.push(tr);
    }
    result.seed.unsupported = Array.from(unsupported);
    result.durationMs = Date.now() - startedAt.getTime();
    return result;
}

/**
 * The planned send for a turn. The current door answers synchronously with the pass inside the
 * response; a response with no pass on a turn that must produce one is an error, not a silent
 * "nothing sent". Turns that are not customer messages may legitimately carry no pass (age, price).
 */
export function waitForPlannedSend(raw: unknown, t: Turn): { pass: DoorPass; plannedSend: PlannedSend } {
    const r = raw as { run?: unknown } | null;
    if ((t.kind === 'age' || t.kind === 'price') && (!r || r.run == null)) {
        // Time passing and Ben pricing send nothing through the desk by themselves; the planned
        // send is empty, read off the state.
        return plannedSendFromDoorResponse({ ...(r ?? {}), run: null });
    }
    if (!r || r.run == null) throw new DoorError('shape', `the door returned no pass for a ${t.from}/${t.kind} turn`);
    return plannedSendFromDoorResponse(raw);
}

// ---------------------------------------------------------------- the whole set, twice

export interface RunAllOptions {
    door: DoorClient;
    judge: ModelJudge | null;
    log?: (line: string) => void;
    desk?: string;
    /** Lines that must have a verdict (an unjudged one is an error). Goal 1's eleven by default; empty for a subset run. */
    requiredLines?: readonly string[];
}

/** The whole set runs this many times; a line passes only when it passes every run. */
export const RUNS = 2;

export const CURRENT_DESK = 'current desk (server/spine via /api/comms-sandbox, dry run)';

export async function runAll(scenarios: readonly Scenario[], opts: RunAllOptions): Promise<JudgeResult> {
    const log = opts.log ?? (() => undefined);
    const results: ScenarioRunResult[] = [];
    for (let run = 1; run <= RUNS; run++) {
        log(`run ${run}/${RUNS}`);
        for (const s of scenarios) {
            log(` scenario ${s.id}: ${s.title}`);
            results.push(await runScenario(s, { door: opts.door, judge: opts.judge, run, log }));
        }
    }
    const lines = lineResults(results, RUNS, scenarios, opts.requiredLines ?? GOAL_1_LINES);
    const summary = { pass: 0, fail: 0, error: 0 };
    for (const l of lines) summary[l.status]++;
    return {
        generatedAt: new Date().toISOString(),
        desk: opts.desk ?? CURRENT_DESK,
        door: { mode: opts.door.mode, host: opts.door.host },
        runs: RUNS, lines, scenarios: results, summary,
        exitCode: summary.error > 0 || results.some((r) => r.error !== null) ? 1 : 0,
    };
}

/** Per line: pass only when every expectation on it passed in every run; error beats fail. Pure. */
export function lineResults(results: readonly ScenarioRunResult[], runs: number, scenarios: readonly Scenario[], requiredLines: readonly string[] = GOAL_1_LINES): LineResult[] {
    const ids = new Set<string>(requiredLines);
    for (const s of scenarios) for (const l of s.lines) ids.add(l);
    const out: LineResult[] = [];
    for (const line of Array.from(ids).sort(compareLines)) {
        const perRun: LineRunVerdict[] = [];
        const evidence: LineEvidence[] = [];
        for (let run = 1; run <= runs; run++) {
            const recs: ExpectationRecord[] = [];
            const reasons: string[] = [];
            for (const sr of results.filter((r) => r.run === run)) {
                for (const tr of sr.turns) {
                    const mine = tr.expectations.filter((e) => e.line === line);
                    if (!mine.length) continue;
                    recs.push(...mine);
                    evidence.push({ scenarioId: sr.scenarioId, run, turnIndex: tr.index, plannedSend: tr.plannedSend, snapshot: tr.snapshot, expectations: mine });
                    for (const e of mine) reasons.push(`${sr.scenarioId} turn ${tr.index + 1} ${e.kind}: ${e.status} - ${e.reason}${e.modelJudge ? ` [model ${e.modelJudge.model}: ${e.modelJudge.verdict}${e.modelJudge.reason ? ' - ' + e.modelJudge.reason : ''}]` : ''}`);
                }
            }
            let status: LineStatus;
            if (!recs.length) { status = 'error'; reasons.push('no expectation for this line was evaluated'); }
            else if (recs.some((e) => e.status === 'error')) status = 'error';
            else if (recs.some((e) => e.status === 'fail')) status = 'fail';
            else status = 'pass';
            perRun.push({ run, status, reasons });
        }
        const status: LineStatus = perRun.some((r) => r.status === 'error') ? 'error' : perRun.every((r) => r.status === 'pass') ? 'pass' : 'fail';
        out.push({ line, status, perRun, evidence });
    }
    return out;
}

function compareLines(a: string, b: string): number {
    const [a1, a2] = a.split('.'); const [b1, b2] = b.split('.');
    if (a1 !== b1) return Number(a1) - Number(b1);
    return Number(a2) - Number(b2);
}
