/**
 * Model pricing → pence. Pure (no db, no network) so the runner can import it and vitest can
 * pin the arithmetic. Prices are USD per million tokens as of Sep 2026; cache reads are billed
 * at 10% of the input rate, cache writes at 125% (Anthropic's standard prompt-caching terms).
 * FX is a fixed 1 USD = 0.78 GBP — cost_pence is an operating signal for /admin/staff and the
 * daily caps, not an invoice.
 */
export interface TokenUsage {
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
}

export interface ModelPrice {
    family: 'haiku-4-5' | 'sonnet-4-5' | 'sonnet-5' | 'opus-5' | 'fable-5-1' | 'gemini-3.6-flash';
    match: RegExp;
    /** USD per million input tokens. */
    input: number;
    /** USD per million output tokens. */
    output: number;
}

// ORDER MATTERS: priceForModel takes the FIRST match, so a dated id must come before the family
// it would otherwise fall into. `claude-sonnet-4-5-*` is not Sonnet 5 and is not priced like it.
export const MODEL_PRICES_USD_PER_MTOK: readonly ModelPrice[] = [
    { family: 'haiku-4-5', match: /haiku/i, input: 1, output: 5 },
    // 0.4 (8 Sep 2026): the one dated model still called anywhere — /api/pricing/parse-job
    // (server/job-parser.ts, `claude-sonnet-4-5-20250929`). Anthropic's published Sonnet 4.5 rate,
    // $3 / $15 per M, which is NOT the Sonnet 5 rate below. Before this row it was priced as
    // Sonnet 5 and understated by a third. Pinned in agent-cost.test.ts.
    { family: 'sonnet-4-5', match: /sonnet-4-5/i, input: 3, output: 15 },
    { family: 'sonnet-5', match: /sonnet/i, input: 2, output: 10 },
    { family: 'opus-5', match: /opus/i, input: 5, output: 25 },
    // The comms-v2 composer (server/comms-v2/desk/models.ts). Anthropic's published Fable 5.1 rate.
    { family: 'fable-5-1', match: /fable/i, input: 10, output: 50 },
    // Phase 4 describe_video, on Gemini 3.6 Flash since T14 (7 Sep 2026). Google's pricing page,
    // paid tier, read that day: $0.75 / M input (text, image and video alike), $3.75 / M output
    // "through December 31, 2026", then $1.50 / $7.50 "starting January 1, 2027" — raise these two
    // numbers then. Output includes the model's thinking tokens (describe-video.ts counts them as
    // output). The old row ($0.10 / $0.40) was a working assumption and was wrong even for 2.5 Flash
    // ($0.30 / $2.50). Every vision run's cost_pence is derived from these two numbers.
    { family: 'gemini-3.6-flash', match: /gemini.*flash/i, input: 0.75, output: 3.75 },
];

export const CACHE_READ_MULTIPLIER = 0.10;
export const CACHE_WRITE_MULTIPLIER = 1.25;
export const USD_TO_GBP = 0.78;

export function priceForModel(model: string | null | undefined): ModelPrice | null {
    if (!model) return null;
    return MODEL_PRICES_USD_PER_MTOK.find((p) => p.match.test(model)) ?? null;
}

/** USD for a run, or null when the model is not priced. */
export function computeCostUsd(usage: TokenUsage, model: string | null | undefined): number | null {
    const price = priceForModel(model);
    if (!price) return null;
    const inputUsd = (usage.inputTokens * price.input
        + usage.cacheReadTokens * price.input * CACHE_READ_MULTIPLIER
        + usage.cacheWriteTokens * price.input * CACHE_WRITE_MULTIPLIER) / 1_000_000;
    const outputUsd = (usage.outputTokens * price.output) / 1_000_000;
    return inputUsd + outputUsd;
}

/** Whole pence (GBP) for a run, rounded to nearest; null when the model is not priced. */
export function computeCostPence(usage: TokenUsage, model: string | null | undefined): number | null {
    const usd = computeCostUsd(usage, model);
    if (usd == null) return null;
    return Math.round(usd * USD_TO_GBP * 100);
}
