/**
 * Judge rubric `voice-v1` (Phase 3 / C; COMMS_EVALS_PLAN §2.3, design §9).
 *
 * "Does this read like Ben?" — scored 1–5 per dimension against brand-voice/whatsapp-comms.md and
 * the shared chat-voice rules, with an explicit "cannot judge" escape. ADVISORY ONLY: nothing
 * gates on it until calibration shows ≥ 85% agreement with Ben's own verdicts
 * (scripts/_judge-agreement.ts). Opus 5 via server/llm.ts; the response is schema-validated and a
 * malformed answer is a verdict of `cannotJudge`, never a crash.
 *
 * Pure parts (rubric text, schema, parsing, agreement mapping) are exported for tests; the model
 * call is the only side effect and is injectable.
 */
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { chatVoiceViolations } from '@shared/chat-voice';
import type { ClaudeUsage } from '../llm';

export const JUDGE_MODEL = 'claude-opus-5';
export const VOICE_RUBRIC_ID = 'voice-v1';

export const VOICE_DIMENSIONS = ['register', 'burstLength', 'oneQuestion', 'noSystemTells', 'leverChoice'] as const;
export type VoiceDimension = (typeof VOICE_DIMENSIONS)[number];

const score = z.number().int().min(1).max(5).nullable();
export const VoiceVerdictSchema = z.object({
    rubric: z.literal(VOICE_RUBRIC_ID).optional(),
    cannotJudge: z.boolean().default(false),
    cannotJudgeReason: z.string().max(400).nullable().optional(),
    dimensions: z.object({
        register: score,
        burstLength: score,
        oneQuestion: score,
        noSystemTells: score,
        leverChoice: score,
    }),
    overall: score,
    notes: z.array(z.string().max(300)).max(6).default([]),
    /** The judge's own one-word call, for the agreement report. */
    call: z.enum(['fine', 'tone', 'wrong_move', 'unsafe', 'missing_info']).nullable().optional(),
});
export type VoiceVerdict = z.infer<typeof VoiceVerdictSchema> & { rubric: typeof VOICE_RUBRIC_ID; model?: string; usage?: ClaudeUsage | null; deterministic?: string[] };

export function loadVoiceFile(root: string = process.cwd()): string {
    try { return fs.readFileSync(path.join(root, 'brand-voice', 'whatsapp-comms.md'), 'utf8'); } catch { return '(brand-voice/whatsapp-comms.md not found)'; }
}

export function buildVoiceJudgeSystem(voiceFile: string = loadVoiceFile()): string {
    return [
        `You are the voice judge for Handy Services, a Nottingham handyman company. You read ONE proposed WhatsApp reply to a customer and score how much it reads like Ben, the owner, texting back. You are not judging whether the reply is correct or safe — other checks do that — only whether it sounds like him and makes a sensible conversational move.`,
        ``,
        `THE VOICE (verbatim house file):`,
        voiceFile,
        ``,
        `HARD MECHANICAL RULES (shared/chat-voice.ts): no em dashes or en dashes; no spaced hyphens as punctuation; never "let me know when suits" / "ready when you are" / "shout when you're ready" / "whenever suits you".`,
        ``,
        `Score each dimension 1 (nothing like him) to 5 (indistinguishable):`,
        `- register: friendly Nottingham tradesperson, plain English, UK spelling, his words (no problem, perfect, proper, sorted, pop round); not a brochure, form or notification.`,
        `- burstLength: 2–3 short bursts (split on a line with only ---), each under ~25 words; not one block.`,
        `- oneQuestion: at most one question in the whole reply.`,
        `- noSystemTells: no "the team" / "my colleague" / "Ben will" in the third person, no corporate sign-off, no "Kind regards", no puffery, no credentials.`,
        `- leverChoice: the move is the one he would make (photo first, postcode later, point at ONE action, name what the money buys rather than capitulate, never offer a free visit or a date).`,
        `Use null for a dimension you genuinely cannot score from the text alone, and set cannotJudge=true with a reason if the whole reply cannot be judged (empty, not English, a template you were not given).`,
        ``,
        `Return JSON: { "rubric": "voice-v1", "cannotJudge": boolean, "cannotJudgeReason": string|null, "dimensions": { "register": 1-5|null, "burstLength": 1-5|null, "oneQuestion": 1-5|null, "noSystemTells": 1-5|null, "leverChoice": 1-5|null }, "overall": 1-5|null, "call": "fine"|"tone"|"wrong_move"|"unsafe"|"missing_info"|null, "notes": [up to 6 short strings] }`,
    ].join('\n');
}

export function buildVoiceJudgeUser(input: { body: string; customerText?: string | null; intent?: string | null }): string {
    return [
        input.customerText ? `CUSTOMER'S LAST MESSAGE:\n${input.customerText}` : 'CUSTOMER\'S LAST MESSAGE: (not provided)',
        input.intent ? `DECLARED INTENT: ${input.intent}` : '',
        `PROPOSED REPLY (bursts separated by ---):\n${input.body}`,
    ].filter(Boolean).join('\n\n');
}

/** Parse + validate a raw model answer. Never throws: malformed → cannotJudge with the zod message. */
export function parseVoiceVerdict(raw: unknown): VoiceVerdict {
    const r = VoiceVerdictSchema.safeParse(raw);
    if (r.success) return { ...r.data, rubric: VOICE_RUBRIC_ID };
    return {
        rubric: VOICE_RUBRIC_ID, cannotJudge: true, cannotJudgeReason: `schema: ${r.error.issues.map((i) => `${i.path.join('.')} ${i.message}`).join('; ').slice(0, 380)}`,
        dimensions: { register: null, burstLength: null, oneQuestion: null, noSystemTells: null, leverChoice: null }, overall: null, notes: [], call: null,
    };
}

/** The judge's binary reading of its own scores: "fine" = overall ≥ 4 and no dimension ≤ 2. */
export function judgeSaysFine(v: VoiceVerdict): boolean | null {
    if (v.cannotJudge || v.overall == null) return null;
    const dims = Object.values(v.dimensions).filter((d): d is number => d != null);
    return v.overall >= 4 && !dims.some((d) => d <= 2);
}

/**
 * Agreement with a human verdict (draft_verdicts): approve ⇔ judge fine; edit/reject ⇔ judge not
 * fine. Null when either side cannot say (samples and cannotJudge are left out of the rate).
 */
export function judgeAgrees(v: VoiceVerdict, human: { verdict: string; reason: string | null }): boolean | null {
    const fine = judgeSaysFine(v);
    if (fine === null) return null;
    if (human.verdict === 'approve') return fine === true;
    if (human.verdict === 'edit' || human.verdict === 'reject') return fine === false;
    return null;
}

export type JudgeLlm = (args: { system: string; user: string; model: string; maxTokens: number }) => Promise<{ data: unknown; usage: ClaudeUsage | null; model: string }>;

async function defaultLlm(): Promise<JudgeLlm> {
    const { claudeJsonWithUsage } = await import('../llm');
    return async (args) => claudeJsonWithUsage({ system: args.system, user: args.user, model: args.model, maxTokens: args.maxTokens });
}

/** Score one reply. Deterministic chat-voice violations are attached so the report shows both readings. */
export async function judgeVoiceV1(
    input: { body: string; customerText?: string | null; intent?: string | null },
    deps: { llm?: JudgeLlm; system?: string; model?: string } = {},
): Promise<VoiceVerdict> {
    const deterministic = chatVoiceViolations(input.body);
    if (!input.body.trim()) {
        return { ...parseVoiceVerdict({ cannotJudge: true, cannotJudgeReason: 'empty reply', dimensions: { register: null, burstLength: null, oneQuestion: null, noSystemTells: null, leverChoice: null }, overall: null }), deterministic };
    }
    const llm = deps.llm ?? (await defaultLlm());
    const model = deps.model ?? JUDGE_MODEL;
    try {
        const r = await llm({ system: deps.system ?? buildVoiceJudgeSystem(), user: buildVoiceJudgeUser(input), model, maxTokens: 600 });
        return { ...parseVoiceVerdict(r.data), model: r.model, usage: r.usage, deterministic };
    } catch (error: any) {
        return { ...parseVoiceVerdict({ cannotJudge: true, cannotJudgeReason: `llm: ${error?.message ?? error}`.slice(0, 380), dimensions: { register: null, burstLength: null, oneQuestion: null, noSystemTells: null, leverChoice: null }, overall: null }), model, deterministic };
    }
}
