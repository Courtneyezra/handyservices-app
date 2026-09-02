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
import type { CaseFile, PolicyPack, Tier, TriageResult } from './types';
import { isIntent, RULES_INTENTS, TIERS } from './vocab';
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

/** The tier an intent runs at in a pack (after the DB overlay, when the pack came from resolvePack). */
export function tierFor(pack: PolicyPack, intent: string): PolicyPack['defaultTier'] {
    return (pack.tierByIntent as Record<string, PolicyPack['defaultTier'] | undefined>)[intent] ?? pack.defaultTier;
}

// ---------------------------------------------------------------- Phase 3: earned tiers (DB overlay)
//
// Static packs are the LAUNCH defaults. What an intent has since earned (or lost) lives in
// pack_intent_tiers, written only by server/spine/autonomy.ts or a person. resolvePack overlays
// it here. The overlay is cached in-process for a minute and refreshed by runOnce before every
// pack resolution, so `resolvePack` stays synchronous (the SpineApi contract) and a database
// blip means "launch defaults", never "no pack".

export type TierOverlay = Map<string, Record<string, Tier>>;
export const TIER_OVERLAY_TTL_MS = 60_000;
let tierOverlay: TierOverlay = new Map();
let tierOverlayLoadedAt = 0;

/** Money and dates are not intents; nothing may ever be promoted under such a name. */
export function isForbiddenIntent(intent: string): boolean {
    return FORBIDDEN_INTENT_SMELL.test(intent);
}

/** Throws unless (pack, intent) may legitimately hold a SEND tier. */
export function assertPromotable(pack: PolicyPack, intent: string): void {
    if (!isIntent(intent)) throw new Error(`[Spine] ${intent} is not an intent`);
    if (isForbiddenIntent(intent)) throw new Error(`[Spine] ${intent} may carry money or dates and can never be promoted`);
    if (!(pack.allowedIntents as string[]).includes(intent)) throw new Error(`[Spine] ${intent} is not allowed in pack ${pack.id}`);
}

/** A copy of the pack with the DB tiers merged over its static tierByIntent. Pure; refuses bad rows. */
export function applyTierOverlay(pack: PolicyPack, tiers: Record<string, string> | undefined | null): PolicyPack {
    if (!tiers || !Object.keys(tiers).length) return pack;
    const merged: Partial<Record<string, Tier>> = { ...pack.tierByIntent };
    for (const [intent, tier] of Object.entries(tiers)) {
        if (!(TIERS as readonly string[]).includes(tier)) { console.warn(`[Spine] ignoring tier ${tier} for ${pack.id}/${intent}`); continue; }
        if (!(pack.allowedIntents as string[]).includes(intent) || isForbiddenIntent(intent) || !isIntent(intent)) {
            console.warn(`[Spine] ignoring DB tier for ${pack.id}/${intent}: not an allowed intent`);
            continue;
        }
        merged[intent] = tier as Tier;
    }
    return { ...pack, tierByIntent: merged as PolicyPack['tierByIntent'] };
}

/** Load pack_intent_tiers (cached a minute). Never throws: a failure keeps the previous overlay. */
export async function refreshTierOverlay(force = false): Promise<TierOverlay> {
    if (!force && Date.now() - tierOverlayLoadedAt < TIER_OVERLAY_TTL_MS) return tierOverlay;
    try {
        const { db } = await import('../db');
        const { packIntentTiers } = await import('@shared/schema');
        const rows = await db.select({ packId: packIntentTiers.packId, intent: packIntentTiers.intent, tier: packIntentTiers.tier }).from(packIntentTiers);
        const next: TierOverlay = new Map();
        for (const r of rows) {
            if (!next.has(r.packId)) next.set(r.packId, {});
            next.get(r.packId)![r.intent] = r.tier as Tier;
        }
        tierOverlay = next;
        tierOverlayLoadedAt = Date.now();
    } catch (error: any) {
        console.warn('[Spine] pack_intent_tiers unavailable, keeping launch defaults:', error?.message ?? error);
        tierOverlayLoadedAt = Date.now(); // do not hammer a broken db every run
    }
    return tierOverlay;
}

export function currentTierOverlay(): TierOverlay {
    return tierOverlay;
}

/** Tests only. */
export function setTierOverlayForTests(overlay: TierOverlay | null): void {
    tierOverlay = overlay ?? new Map();
    tierOverlayLoadedAt = overlay ? Number.MAX_SAFE_INTEGER / 2 : 0;
}

/** Where an intent's effective tier comes from. */
export function tierSourceFor(packId: string, intent: string): 'db' | 'static' {
    return tierOverlay.get(packId)?.[intent] ? 'db' : 'static';
}

/**
 * Which pack governs this run. Audience first (contractor / internal never see customer packs),
 * then the exception lane (Ben only), then the rules lane, then the stage.
 */
export function resolvePack(caseFile: CaseFile, triage: TriageResult): PolicyPack {
    const base = resolveStaticPack(caseFile, triage);
    return applyTierOverlay(base, tierOverlay.get(base.id));
}

/** The launch-default pack, before earned tiers. */
export function resolveStaticPack(caseFile: CaseFile, triage: TriageResult): PolicyPack {
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
