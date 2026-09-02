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
    family: 'haiku-4-5' | 'sonnet-5' | 'opus-5' | 'gemini-2.5-flash';
    match: RegExp;
    /** USD per million input tokens. */
    input: number;
    /** USD per million output tokens. */
    output: number;
}

export const MODEL_PRICES_USD_PER_MTOK: readonly ModelPrice[] = [
    { family: 'haiku-4-5', match: /haiku/i, input: 1, output: 5 },
    { family: 'sonnet-5', match: /sonnet/i, input: 2, output: 10 },
    { family: 'opus-5', match: /opus/i, input: 5, output: 25 },
    // Phase 4 describe_video. The repo carried no Gemini price, so this is the brief's working
    // assumption ($0.10/M input for video tokens; output set proportionally). Correct it here when
    // the bill arrives; every vision run's cost_pence is derived from these two numbers.
    { family: 'gemini-2.5-flash', match: /gemini.*flash/i, input: 0.10, output: 0.40 },
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
