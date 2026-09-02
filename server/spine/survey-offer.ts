/**
 * The paid-survey offer (P8 Route A, decision (e)): when the Quote clerk says `visit_first`, the
 * spine drafts ONE reply offering the survey at the fixed fee from settings
 * (PricingSettings.surveyFeePence). Tier DRAFT in customer.default — Ben approves the words.
 *
 * The money guard would refuse any figure in a customer draft; this is the one figure that is a
 * SETTING, not the agent's judgement, so the proposal cites it (`price_source=settings …`) and
 * server/spine/guards.ts lets the money detector pass only when EVERY figure in the body equals
 * that cited fee. Anything else — a second number, a different number — is still refused.
 *
 * No booking link is included: the survey quote row is an unsent draft and a link to it would
 * not render. The reply asks for a yes; Ben sends the booking link from the price screen.
 */
import type { Proposal } from './types';

export const SURVEY_INTENT = 'offer_survey' as const;
export const PRICE_SOURCE_SETTINGS = 'price_source=settings';

export function surveyFeeCitation(feePence: number): string {
    return `${PRICE_SOURCE_SETTINGS} surveyFeePence=${Math.round(feePence)}`;
}

/** Pure: the fee a proposal's citations vouch for, or null. */
export function citedSettingsFeePence(citations: string[] | undefined | null): number | null {
    for (const c of citations ?? []) {
        const m = /^price_source=settings\s+surveyFeePence=(\d+)$/.exec(String(c).trim());
        if (m) return Number(m[1]);
    }
    return null;
}

export function formatPounds(pence: number): string {
    const pounds = pence / 100;
    return Number.isInteger(pounds) ? `£${pounds}` : `£${pounds.toFixed(2)}`;
}

/** The reply, in the house voice (brand-voice/whatsapp-comms.md: short bursts, no dashes, no full address). */
export function surveyOfferBody(input: { firstName?: string | null; feePence: number; why?: string | null }): string[] {
    const hi = input.firstName ? `Hi ${input.firstName}, ` : '';
    const why = input.why?.trim() ? ` ${input.why.trim().replace(/[.]+$/, '')}.` : '';
    return [
        `${hi}thanks for the details.${why} To price this properly we need to see it first.`,
        // The fee only. Whether it is credited against the job is a POLICY COMMITMENT the guard
        // keeps for Ben (draft-guards POLICY_COMMITMENT_PATTERNS); he adds it when he approves.
        `We do a paid survey visit at ${formatPounds(input.feePence)}. Shall I send the booking link?`,
    ];
}

/** Why the clerk wanted eyes on it, from the intake, kept short. */
export function surveyWhyFrom(intake: { assumptions?: string[]; gaps?: Array<{ question?: string }> } | null | undefined): string | null {
    const gap = intake?.gaps?.find((g) => g?.question)?.question;
    if (gap && gap.length <= 90) return `It depends on what we find (${gap.replace(/\?$/, '').toLowerCase()})`;
    return null;
}

export function buildSurveyOfferProposal(input: { firstName?: string | null; feePence: number; why?: string | null; intakeRunId: string }): Proposal {
    return {
        intent: SURVEY_INTENT,
        body: surveyOfferBody(input),
        reasons: [`clerk readiness visit_first (run ${input.intakeRunId}); survey fee ${formatPounds(input.feePence)} from settings`],
        citations: [surveyFeeCitation(input.feePence), `agent_runs:${input.intakeRunId}`],
    };
}
