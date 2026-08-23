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

/** USD per MTok, APPROXIMATE — for ranking burners, not accounting. */
const RATES: Record<string, { in: number; out: number; cacheRead: number }> = {
    'claude-opus-5': { in: 15, out: 75, cacheRead: 1.5 },
    'claude-sonnet-5': { in: 3, out: 15, cacheRead: 0.3 },
    'claude-sonnet-4-5': { in: 3, out: 15, cacheRead: 0.3 },
    'claude-haiku-4-5': { in: 1, out: 5, cacheRead: 0.1 },
};

function rateFor(model: string) {
    const key = Object.keys(RATES).find((k) => model.startsWith(k));
    return key ? RATES[key] : { in: 3, out: 15, cacheRead: 0.3 };
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
            && !/^(Object|Proxy|process|callerTag|recordLlmUsage|withUsageLedger|get|then|async|file|Anthropic|APIPromise|Messages)/.test(n)
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
        // Cache writes bill at 1.25x input; close enough for ranking.
        const usd = (inTok * r.in + cacheWrite * r.in * 1.25 + cacheRead * r.cacheRead + outTok * r.out) / 1_000_000;
        void logSystemEvent({
            kind: 'other',
            summary: `llm ${model.replace('claude-', '')} · ${src} · in=${inTok} cw=${cacheWrite} cr=${cacheRead} out=${outTok} · ~$${usd.toFixed(4)}`,
            detail: { model, src, inTok, outTok, cacheRead, cacheWrite, usd: Number(usd.toFixed(6)) },
            source: 'llm-usage',
        });
    } catch {
        // The ledger must never break the call it is counting.
    }
}
