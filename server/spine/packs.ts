/**
 * Policy packs are CONFIG (§3.4): what a lane may say, to whom, when, and at what autonomy tier
 * is data, versioned, one object per (audience, stage). Promotion and demotion (Phase 3) edit
 * `tierByIntent`; the second city is a `city` value, not a rewrite.
 *
 * Invariants checked at module load, so a bad pack is a boot failure, never a customer message:
 *   - money and dates are not intents anywhere (the Intent union cannot express them; this also
 *     refuses any pack whose intent names smell of either);
 *   - every allowed intent is in the vocabulary.
 */
import type { CaseFile, PolicyPack, TriageResult } from './types';
import { isIntent, RULES_INTENTS } from './vocab';
import { RULES_FIRST_CONTACT } from './packs/rules-first-contact';
import { RULES_FOLLOWUP } from './packs/rules-followup';
import { CUSTOMER_DEFAULT } from './packs/customer-default';
import { CUSTOMER_POST_QUOTE } from './packs/customer-post-quote';
import { CUSTOMER_EXCEPTION } from './packs/customer-exception';
import { CONTRACTOR_DEFAULT } from './packs/contractor-default';
import { INTERNAL_BEN } from './packs/internal-ben';

export const PACKS: Record<string, PolicyPack> = Object.freeze({
    [RULES_FIRST_CONTACT.id]: RULES_FIRST_CONTACT,
    [RULES_FOLLOWUP.id]: RULES_FOLLOWUP,
    [CUSTOMER_DEFAULT.id]: CUSTOMER_DEFAULT,
    [CUSTOMER_POST_QUOTE.id]: CUSTOMER_POST_QUOTE,
    [CUSTOMER_EXCEPTION.id]: CUSTOMER_EXCEPTION,
    [CONTRACTOR_DEFAULT.id]: CONTRACTOR_DEFAULT,
    [INTERNAL_BEN.id]: INTERNAL_BEN,
});

const FORBIDDEN_INTENT_SMELL = /(money|price|cost|discount|deposit|invoice|date|slot|book|availability_confirm)/i;

export function validatePack(pack: PolicyPack): string[] {
    const problems: string[] = [];
    for (const intent of pack.allowedIntents) {
        if (!isIntent(intent)) problems.push(`${pack.id}: unknown intent ${intent}`);
        if (FORBIDDEN_INTENT_SMELL.test(intent) && pack.audience === 'customer') problems.push(`${pack.id}: intent ${intent} may carry money or dates`);
    }
    for (const intent of Object.keys(pack.tierByIntent)) {
        if (!(pack.allowedIntents as string[]).includes(intent)) problems.push(`${pack.id}: tier for ${intent} which is not allowed`);
    }
    if (pack.hours.proactiveFromHour < 0 || pack.hours.proactiveToHour > 24 || pack.hours.proactiveFromHour >= pack.hours.proactiveToHour) {
        problems.push(`${pack.id}: bad proactive hours`);
    }
    return problems;
}

for (const pack of Object.values(PACKS)) {
    const problems = validatePack(pack);
    if (problems.length) throw new Error(`[Spine] invalid policy pack: ${problems.join('; ')}`);
}

export function getPack(id: string): PolicyPack {
    const pack = PACKS[id];
    if (!pack) throw new Error(`[Spine] unknown policy pack ${id}`);
    return pack;
}

/** The tier an intent runs at in a pack. */
export function tierFor(pack: PolicyPack, intent: string): PolicyPack['defaultTier'] {
    return (pack.tierByIntent as Record<string, PolicyPack['defaultTier'] | undefined>)[intent] ?? pack.defaultTier;
}

/**
 * Which pack governs this run. Audience first (contractor / internal never see customer packs),
 * then the exception lane (Ben only), then the rules lane, then the stage.
 */
export function resolvePack(caseFile: CaseFile, triage: TriageResult): PolicyPack {
    const audience = triage.audience ?? caseFile.audience;
    if (audience === 'internal') return INTERNAL_BEN;
    if (audience === 'contractor' || triage.lane === 'contractor') return CONTRACTOR_DEFAULT;
    if (triage.lane === 'ben' || triage.lane === 'dropped' || triage.exceptions.length > 0) return CUSTOMER_EXCEPTION;
    if (triage.lane === 'rules') {
        return triage.intent !== 'unknown' && (RULES_FOLLOWUP.allowedIntents as string[]).includes(triage.intent)
            ? RULES_FOLLOWUP
            : RULES_FIRST_CONTACT;
    }
    if (triage.intent !== 'unknown' && (RULES_INTENTS as readonly string[]).includes(triage.intent)
        && (RULES_FOLLOWUP.allowedIntents as string[]).includes(triage.intent)) {
        return RULES_FOLLOWUP;
    }
    if (triage.lane === 'post_quote' || (triage.stage === 'quote_sent' && caseFile.quote && !caseFile.quote.paid)) {
        return CUSTOMER_POST_QUOTE;
    }
    return CUSTOMER_DEFAULT;
}
