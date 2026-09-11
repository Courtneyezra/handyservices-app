/**
 * The model judge, used only for line 2.3 ("in its own words").
 *
 * Contract 7: a model judge is used only for lines about wording and tone, and its verdict is
 * recorded next to the deterministic assertion, never in place of one. The runner calls this for
 * an `own_words` expectation after expectations.ts has returned the deterministic result, and
 * writes both into the report.
 *
 * Uses the project's existing Anthropic client (server/anthropic.ts) on the cheapest suitable
 * model, the same id the old desk's triage runs on. Without a key the verdict is `skipped` with
 * the reason; that is not an error, because the deterministic assertion stands on its own.
 */
import { createHash } from 'node:crypto';

export const OWN_WORDS_MODEL = 'claude-haiku-4-5';

export interface OwnWordsInput {
    /** What the customer wrote on this turn. */
    customerText: string;
    /** The bubbles the desk planned in reply. */
    bubbles: readonly string[];
}

export interface ModelVerdict {
    model: string;
    promptHash: string;
    verdict: 'yes' | 'no' | 'skipped';
    reason: string;
}

const SYSTEM = [
    'You judge one reply from a handyman business to a customer on WhatsApp.',
    'Answer whether the reply asks about the job in its own words: natural, conversational, specific to what the customer said, one thing at a time.',
    'It fails when it reads as a template or a form, asks several things at once, or ignores what the customer wrote.',
    'Reply with JSON only: {"verdict":"yes"|"no","reason":"<one sentence>"}.',
].join(' ');

export function buildOwnWordsPrompt(input: OwnWordsInput): { system: string; user: string; hash: string } {
    const user = `Customer wrote:\n${input.customerText}\n\nThe reply, one line per bubble:\n${input.bubbles.map((b, i) => `${i + 1}. ${b}`).join('\n')}`;
    const hash = createHash('sha256').update(SYSTEM).update('\n---\n').update(user).digest('hex');
    return { system: SYSTEM, user, hash };
}

/** Parse the model's answer; anything that is not the JSON shape is a `no` with the raw text as the reason. */
export function parseVerdict(raw: string): { verdict: 'yes' | 'no'; reason: string } {
    const m = /\{[\s\S]*\}/.exec(raw);
    if (m) {
        try {
            const j = JSON.parse(m[0]) as { verdict?: unknown; reason?: unknown };
            if (j.verdict === 'yes' || j.verdict === 'no') return { verdict: j.verdict, reason: typeof j.reason === 'string' ? j.reason : '' };
        } catch { /* fall through */ }
    }
    return { verdict: 'no', reason: `unparseable model answer: ${raw.slice(0, 200)}` };
}

export type ModelCall = (args: { model: string; system: string; user: string }) => Promise<string>;

/** The project's client, loaded on first use so a run without a key never imports it. */
async function anthropicCall(): Promise<ModelCall> {
    const { getAnthropic } = await import('../../anthropic');
    const client = getAnthropic();
    return async ({ model, system, user }) => {
        const res = await client.messages.create({ model, max_tokens: 200, temperature: 0, system, messages: [{ role: 'user', content: user }] });
        return res.content.map((c) => ('text' in c ? c.text : '')).join('');
    };
}

export interface ModelJudge {
    ownWords(input: OwnWordsInput): Promise<ModelVerdict>;
}

/** A judge over the given caller (tests), or the project's client (the runner). */
export function makeModelJudge(call?: ModelCall, model = OWN_WORDS_MODEL): ModelJudge {
    return {
        async ownWords(input) {
            const { system, user, hash } = buildOwnWordsPrompt(input);
            if (!call && !process.env.ANTHROPIC_API_KEY) return { model, promptHash: hash, verdict: 'skipped', reason: 'ANTHROPIC_API_KEY is not set; the deterministic assertion stands alone' };
            try {
                const fn = call ?? await anthropicCall();
                const raw = await fn({ model, system, user });
                const v = parseVerdict(raw);
                return { model, promptHash: hash, verdict: v.verdict, reason: v.reason };
            } catch (err: any) {
                return { model, promptHash: hash, verdict: 'skipped', reason: `model call failed: ${err?.message ?? err}` };
            }
        },
    };
}
