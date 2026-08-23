/**
 * Quote-readiness scoring — the confidence gate, computed in CODE.
 *
 * The clerk (server/agents/quote-prep.ts) is a pure extractor: it fills slots
 * (lines, evidence, assumptions) and labels each gap's impact on the WORK.
 * This module turns that into a number and a decision — deterministic,
 * tunable via config (not prompts), loggable, and renderable in the UI.
 *
 * SHADOW MODE (from 23 Aug 2026): the score runs alongside the clerk's prose
 * verdict and is logged for calibration. The verdict still gates. Cutover
 * happens when shadow disagreements, judged against real quote outcomes
 * (amendments, disputes, drop-off), favour the score.
 *
 * Shared, not server-only: the intake panel renders the same breakdown the
 * server computed, from the same function.
 */
import type { QuoteIntake, IntakeGap, GapImpact } from '../server/agents/quote-prep';

/** The dial. Config, not prompt — tweakable without a deploy once it lives in appSettings. */
export interface ReadinessConfig {
    /** Score at or above which the quote builds with no questions. */
    buildAt: number;
    /** Score below which we ask (the filtered questions) without consulting the verifier. */
    askBelow: number;
    /** Impacts that justify a question when the customer has NOT yet answered a round. */
    askOnFreshThread: GapImpact[];
    /** Impacts that justify a question when they HAVE (the budget is spent). */
    askOnSpentBudget: GapImpact[];
}

export const DEFAULT_READINESS_CONFIG: ReadinessConfig = {
    buildAt: 75,
    askBelow: 55,
    askOnFreshThread: ['large', 'forks_job'],
    askOnSpentBudget: ['forks_job'],
};

export interface SlotView {
    label: string;
    state: 'confirmed' | 'assumed' | 'missing';
    note: string;
}

export interface ReadinessResult {
    /** 0–100. Higher = more priceable as-is. */
    score: number;
    band: 'build' | 'grey' | 'ask';
    /** Gaps that clear the dial — the ones worth a question. */
    wouldAsk: IntakeGap[];
    /** Gaps below the dial — ride as assumptions instead. */
    wouldAssume: IntakeGap[];
    /** Per-slot breakdown for the UI. */
    slots: SlotView[];
    config: ReadinessConfig;
}

const IMPACT_PENALTY: Record<GapImpact, number> = {
    none: 0,
    small: 6,
    large: 18,
    forks_job: 40,
};

/**
 * Score the intake. Deliberately simple v1 — weights are the tunable surface,
 * and calibration against amendment/dispute rates is what will move them.
 */
export function computeReadiness(
    intake: QuoteIntake,
    opts: { customerAnsweredRound?: boolean; config?: ReadinessConfig } = {},
): ReadinessResult {
    const config = opts.config ?? DEFAULT_READINESS_CONFIG;
    const customerGaps = intake.gaps.filter((g) => g.audience === 'customer');

    let score = 100;
    const slots: SlotView[] = [];

    // Postcode — required to price travel/area at all.
    if (intake.postcode) {
        slots.push({ label: 'Postcode', state: 'confirmed', note: intake.postcode });
    } else {
        score -= 15;
        slots.push({ label: 'Postcode', state: 'missing', note: 'not stated' });
    }

    // Lines — evidence quality proxied by detail depth (the clerk writes what the
    // photos/messages actually show; a thin detail means thin evidence).
    for (const [i, line] of intake.lines.entries()) {
        const evidenced = line.detail.trim().length >= 40;
        const assumptionLoad = Math.min(line.assumptions.length, 4);
        if (!evidenced) score -= 8;
        score -= assumptionLoad * 2;
        slots.push({
            label: `Line ${i + 1}`,
            state: evidenced ? 'confirmed' : 'assumed',
            note: `${line.title.slice(0, 40)}${evidenced ? '' : ' · thin evidence'}${assumptionLoad ? ` · ${assumptionLoad} assumption${assumptionLoad > 1 ? 's' : ''}` : ''}`,
        });
    }

    // Gaps — the direct uncertainty signal, weighted by the clerk's impact label.
    for (const gap of customerGaps) {
        score -= IMPACT_PENALTY[gap.impact];
    }
    // Quote-level assumption load: each is fine, a pile is a smell.
    score -= Math.max(0, intake.assumptions.length - 3) * 3;

    score = Math.max(0, Math.min(100, Math.round(score)));

    const askable = opts.customerAnsweredRound ? config.askOnSpentBudget : config.askOnFreshThread;
    const wouldAsk = customerGaps.filter((g) => askable.includes(g.impact));
    const wouldAssume = customerGaps.filter((g) => !askable.includes(g.impact));

    const band: ReadinessResult['band'] = score >= config.buildAt ? 'build'
        : score < config.askBelow ? 'ask'
        : 'grey';

    return { score, band, wouldAsk, wouldAssume, slots, config };
}
