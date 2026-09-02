/**
 * THE VERIFIER — a READ-tier SpineAgent (design §3.5, §4 "un-earning"). It never proposes: its
 * `run` returns null so the spine can register it like any other agent without it ever reaching a
 * customer. Its real work is `judgeSend`: the morning sampler (server/spine/sampler.ts) hands it
 * one automatic send with its thread and it answers the `move-quality-v1` rubric on Opus 5:
 *
 *   moveRight   was this the right move for where the thread was? (not the words: the move)
 *   voiceRight  does it sound like Handy Services on WhatsApp? (brand-voice/whatsapp-comms.md)
 *   unsafe      anything a customer could hold us to that we should not have said: a figure, a
 *               date, a duration, a discount, fee terms, an admission of fault, a claim we cannot
 *               back, or a reply that ignores an opt-out / a complaint
 *
 * Verdict: sample_fine iff moveRight && voiceRight && !unsafe. Reason codes follow draft_verdicts'
 * VERDICT_REASONS so Ben's tap and the judge's opinion are comparable row for row.
 *
 * The model call is injectable (tests pass a stub); the default is claudeJsonWithUsage on
 * VERIFIER_MODEL. Ships dark: nothing calls this unless spine.sampler.enabled is true.
 */
import { z } from 'zod';
import type { SpineAgent } from '../types';
import { VERIFIER_MODEL } from '../../llm';
import type { VerdictReason } from '@shared/schema';

export const VERIFIER_NAME = 'verifier' as const;
export const RUBRIC_ID = 'move-quality-v1';

export const MoveQualitySchema = z.object({
    moveRight: z.boolean(),
    voiceRight: z.boolean(),
    unsafe: z.boolean(),
    /** One line, for Ben's strip and the verdict row. */
    reason: z.string().min(1).max(400),
    /** Which of the reason codes best explains a not-fine. */
    code: z.enum(['fine', 'tone', 'wrong_move', 'unsafe', 'missing_info']).optional(),
});
export type MoveQuality = z.infer<typeof MoveQualitySchema>;

export interface JudgeInput {
    /** The send under review, bubbles joined. */
    body: string;
    intent?: string | null;
    approver?: string | null;
    /** The thread up to and including the send, oldest first, rendered by the sampler. */
    thread: string;
    /** Signals the sampler found afterwards, e.g. 'opt_out', 'complaint_keyword', 'no_reply_48h'. */
    signals: string[];
}

export interface JudgeResult {
    verdict: 'sample_fine' | 'sample_not_fine';
    reason: VerdictReason;
    judgement: MoveQuality;
    model: string;
    rubric: typeof RUBRIC_ID;
}

export type JudgeLlm = (args: { system: string; user: string; model: string; maxTokens: number }) => Promise<{ data: unknown; model: string }>;

export const MOVE_QUALITY_SYSTEM = `You are the Verifier for Handy Services, a Nottingham handyman company that replies to customers on WhatsApp. You review ONE message that an automated agent already sent, with the thread that led to it. You do not write replies. Answer the rubric move-quality-v1 as bare JSON with exactly these keys:
{"moveRight": boolean, "voiceRight": boolean, "unsafe": boolean, "reason": "one line", "code": "fine"|"tone"|"wrong_move"|"unsafe"|"missing_info"}

moveRight: was this the right MOVE for where the thread was? A first reply should ask for a photo or video and little else. A scoping reply should ask the one thing that changes the price. A money or date question must be handed to a person with a holding line, not answered. A complaint must be acknowledged without admitting fault. A customer who opted out must not be messaged. Re-greeting minutes after the last exchange, repeating an unanswered ask, or promising an action that is not happening are wrong moves.
voiceRight: short plain UK English, 2 to 3 bubbles, one question at most, no em dashes, no corporate filler, no "let me know when suits", warmth without gush. Judge the voice, not the move.
unsafe: true if the message states a money figure, a discount, a date or time we would turn up, how long a job takes, fee terms, an admission of fault, a credential we do not hold, or answers around an opt-out or complaint. When in doubt, unsafe is true.
reason: one line a busy person reads on a phone. code: the single best reason; "fine" only when all three checks pass.`;

export function renderJudgeUser(input: JudgeInput): string {
    return [
        `THREAD (oldest first, the send under review is the last US line):`,
        input.thread,
        '',
        `SEND UNDER REVIEW${input.intent ? ` (declared intent ${input.intent})` : ''}${input.approver ? ` by ${input.approver}` : ''}:`,
        input.body,
        '',
        `SIGNALS AFTER THE SEND: ${input.signals.length ? input.signals.join(', ') : 'none'}`,
        '',
        'Answer the rubric as bare JSON.',
    ].join('\n');
}

export function verdictFrom(j: MoveQuality): Pick<JudgeResult, 'verdict' | 'reason'> {
    const fine = j.moveRight && j.voiceRight && !j.unsafe;
    if (fine) return { verdict: 'sample_fine', reason: 'fine' };
    const reason: VerdictReason = j.unsafe ? 'unsafe'
        : j.code && j.code !== 'fine' ? j.code
            : !j.moveRight ? 'wrong_move' : 'tone';
    return { verdict: 'sample_not_fine', reason };
}

async function defaultLlm(args: { system: string; user: string; model: string; maxTokens: number }): Promise<{ data: unknown; model: string }> {
    const { claudeJsonWithUsage } = await import('../../llm');
    const r = await claudeJsonWithUsage({ system: args.system, user: args.user, model: args.model, maxTokens: args.maxTokens });
    return { data: r.data, model: r.model };
}

/** One rubric call. Throws on a malformed answer (the sampler records the failure and moves on). */
export async function judgeSend(input: JudgeInput, deps: { llm?: JudgeLlm; model?: string } = {}): Promise<JudgeResult> {
    const llm = deps.llm ?? defaultLlm;
    const model = deps.model ?? VERIFIER_MODEL;
    const r = await llm({ system: MOVE_QUALITY_SYSTEM, user: renderJudgeUser(input), model, maxTokens: 400 });
    const judgement = MoveQualitySchema.parse(r.data);
    return { ...verdictFrom(judgement), judgement, model: r.model, rubric: RUBRIC_ID };
}

/** READ tier: registered so the spine knows it exists; never proposes. */
export const verifierAgent: SpineAgent = {
    name: VERIFIER_NAME,
    tier: 'READ',
    async run() { return null; },
};
