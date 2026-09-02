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
/** Reasoning tier for the spine's Scoper and Quote clerk (design §3.8). */
export const SCOPER_MODEL = 'claude-sonnet-5';

export interface ClaudeChatOpts {
    system?: string;
    user: string;
    maxTokens?: number;
    model?: string;
}

/** Single-turn text completion. Throws on refusal/empty so callers' existing
 * try/catch fallbacks behave exactly as they did with OpenAI errors.
 *
 * Prompt caching: the system prompt goes up as a block with a cache_control
 * marker, so callers that reuse a fixed system string bill repeat calls at
 * ~0.1x within the 5-minute TTL. Single-turn calls, so the system/prefix
 * breakpoint is the only marker — no message marker (that's runner.ts's
 * multi-turn pattern). Below the model's minimum cacheable prefix (4096
 * tokens on haiku-4-5, our default) the marker is a silent no-op and costs
 * nothing, so small prompts are safe. */
export async function claudeText(opts: ClaudeChatOpts): Promise<string> {
    const model = opts.model || FAST_MODEL;
    const response = await getAnthropic().messages.create({
        model,
        max_tokens: opts.maxTokens ?? 1024,
        ...(opts.system
            ? { system: [{ type: 'text' as const, text: opts.system, cache_control: { type: 'ephemeral' as const } }] }
            : {}),
        messages: [{ role: 'user', content: opts.user }],
    });
    // One line per call (same fields runner.ts logs) — enough to see cache
    // hit rate in prod logs without spamming multi-line dumps on hot paths.
    const u = response.usage;
    console.log(
        `[llm:${model}] tokens: in=${u.input_tokens} out=${u.output_tokens} `
        + `cache_read=${u.cache_read_input_tokens ?? 0} cache_write=${u.cache_creation_input_tokens ?? 0}`,
    );
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
