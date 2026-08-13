/**
 * Shared Claude text/JSON helpers — the replacement for the gpt-4o-mini
 * chat.completions calls that died when the OpenAI account ran out of credits
 * (12 Aug 2026). One helper, one fast default model, so every extraction /
 * copywriting call site migrates with a two-line change.
 *
 * Model choice: claude-haiku-4-5 — the like-for-like mini-tier swap
 * (stronger than gpt-4o-mini, fastest Claude, 1/5 the cost of Opus). Pass
 * `model` to override per call where quality warrants it; the offer shadow
 * classifier deliberately runs claude-opus-5 (see server/offer-shadow-agent.ts).
 */
import { getAnthropic } from './anthropic';

export const FAST_MODEL = 'claude-haiku-4-5';

export interface ClaudeChatOpts {
    system?: string;
    user: string;
    maxTokens?: number;
    model?: string;
}

/** Single-turn text completion. Throws on refusal/empty so callers' existing
 * try/catch fallbacks behave exactly as they did with OpenAI errors. */
export async function claudeText(opts: ClaudeChatOpts): Promise<string> {
    const response = await getAnthropic().messages.create({
        model: opts.model || FAST_MODEL,
        max_tokens: opts.maxTokens ?? 1024,
        ...(opts.system ? { system: opts.system } : {}),
        messages: [{ role: 'user', content: opts.user }],
    });
    if (response.stop_reason === 'refusal') {
        throw new Error('Claude declined the request');
    }
    const block = response.content.find((b) => b.type === 'text');
    if (!block || block.type !== 'text') throw new Error('Claude returned no text');
    return block.text;
}

/** Single-turn JSON completion — the response_format:{type:"json_object"}
 * replacement. Instructs bare-JSON output and tolerates accidental fencing. */
export async function claudeJson<T = any>(opts: ClaudeChatOpts): Promise<T> {
    const system = [
        opts.system || '',
        'Reply with ONLY a single valid JSON object. No prose before or after, no markdown code fences.',
    ].filter(Boolean).join('\n\n');
    const text = await claudeText({ ...opts, system });
    const raw = text.trim().replace(/^```(?:json)?\s*|\s*```$/g, '');
    return JSON.parse(raw) as T;
}
