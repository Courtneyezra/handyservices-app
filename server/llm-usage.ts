/**
 * LLM usage ledger — every Anthropic call, counted at the one choke point
 * (server/anthropic.ts wraps messages.create with recordLlmUsage).
 *
 * Born 23 Aug 2026, the second token-burn incident: the first ($20/day, 19 Aug)
 * took a day of guessing because usage only went to a console nobody tails.
 * Now every call writes a system_events row (kind 'other', source 'llm-usage')
 * with model, tokens, estimated cost and the calling function — so "where is
 * the money going" is a SQL query and a dashboard column, not an investigation.
 */
import { logSystemEvent } from './system-events';
import { priceForModel, CACHE_READ_MULTIPLIER, CACHE_WRITE_MULTIPLIER } from './agent-cost';

/**
 * ONE price table, not two (0.4, 8 Sep 2026).
 *
 * This module had its own hand-kept RATES map, and it was wrong: Opus at $15/$75 and Sonnet at
 * $3/$15 — 3x and 1.5x the real rate (the audit's S12 §0 point 2). Every `~$` on /admin/activity
 * was that overstatement, and every ranking of "what is burning the money" was distorted with it.
 * The correct numbers were, all along, in server/agent-cost.ts, which prices agent_runs.cost_pence:
 * Haiku 4.5 $1/$5, Sonnet 5 $2/$10, Opus 5 $5/$25, cache reads at 10% of input and cache writes at
 * 125%. So this file no longer keeps a table — it reads that one. A model that is not in it is
 * priced at 0 and named in the row rather than guessed at, because a made-up figure that looks
 * like a measurement is worse than a visible zero.
 */
function rateFor(model: string): { in: number; out: number; cacheRead: number } | null {
    const price = priceForModel(model);
    if (!price) return null;
    return { in: price.input, out: price.output, cacheRead: price.input * CACHE_READ_MULTIPLIER };
}

/** Best-effort caller tag from the stack — function names survive esbuild bundling.
 *  MUST be called synchronously at the create() call site: by the time the response
 *  promise resolves, the caller's frames are gone from any stack you capture.
 *  Frames like "at file:///app/dist/index.js:1:2" carry no function name; the regex
 *  requires the name to be followed by " (" (a real named frame) so bare URL frames
 *  are skipped instead of matching "file". */
export function callerTag(): string {
    const stack = new Error().stack ?? '';
    const frames = stack.split('\n').slice(1)
        .map((l) => /at (?:async )?([A-Za-z_$][\w$.]*)\s+\(/.exec(l)?.[1])
        .filter((n): n is string => !!n
            && !/^(Object|Proxy|process|callerTag|recordLlmUsage|withUsageLedger|get|then|async|file|Anthropic|APIPromise|Messages|claudeText|claudeJson|claudeChat)/.test(n)
            && !/\.create$|^client\./.test(n)
            && !n.startsWith('_'));
    return frames.slice(0, 2).join('<') || 'unknown';
}

export function recordLlmUsage(model: string, usage: any, src = 'unknown'): void {
    try {
        const inTok = Number(usage?.input_tokens ?? 0);
        const outTok = Number(usage?.output_tokens ?? 0);
        const cacheRead = Number(usage?.cache_read_input_tokens ?? 0);
        const cacheWrite = Number(usage?.cache_creation_input_tokens ?? 0);
        const r = rateFor(model);
        const usd = r
            ? (inTok * r.in + cacheWrite * r.in * CACHE_WRITE_MULTIPLIER + cacheRead * r.cacheRead + outTok * r.out) / 1_000_000
            : 0;
        const unpriced = r ? '' : ' · UNPRICED MODEL';
        void logSystemEvent({
            kind: 'other',
            summary: `llm ${model.replace('claude-', '')} · ${src} · in=${inTok} cw=${cacheWrite} cr=${cacheRead} out=${outTok} · ~$${usd.toFixed(4)}${unpriced}`,
            detail: { model, src, inTok, outTok, cacheRead, cacheWrite, usd: Number(usd.toFixed(6)), ...(r ? {} : { unpriced: true }) },
            source: 'llm-usage',
        });
    } catch {
        // The ledger must never break the call it is counting.
    }
}
