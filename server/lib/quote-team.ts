/**
 * resolveQuoteTeam — the "steer, then compose" composer.
 *
 * Fixes the multi-trade zero-pool bug. The old rule (quote-fit.ts, the
 * `coveragePercent === 100` filter) required ONE contractor to cover every
 * category on a quote — so any genuinely multi-trade job resolved to an empty
 * pool → dead calendar → unbookable.
 *
 * New rule: a quote is bookable if EVERY category is covered by SOMEONE on the
 * assigned team. A committed lead (Craig first) takes the lines he covers; each
 * residual off-skill line goes to a specialist. Unbookable only on a TRUE supply
 * gap — a category no in-radius contractor covers at any tier (which becomes a
 * recruiting signal, not a customer dead-end).
 *
 * Pure + deterministic: takes the required categories + the candidate pool (tier,
 * routing priority, and which required categories each covers) and returns a team
 * plan. No DB, no I/O — fully unit-testable. The adapter that builds `candidates`
 * from the DB lives in the caller (see quote-fit.ts / the matcher).
 *
 * See docs/contractor-platform/00-PRD.md §11 for the acceptance criteria.
 */

export type DeliveryTier = 'partner' | 'core' | 'adhoc';

export interface TeamCandidate {
  contractorId: string;
  tier: DeliveryTier;
  /** Routing order within a tier — lower = first (Craig = 1). null = unranked (sorts last). */
  priority: number | null;
  /** The subset of required categories this contractor covers. */
  coveredCategories: string[];
}

export interface TeamAssignment {
  contractorId: string;
  role: 'lead' | 'specialist';
  coveredCategories: string[];
}

export type TeamPlanKind = 'solo' | 'composed' | 'no_supply';

export interface QuoteTeamPlan {
  bookable: boolean;
  kind: TeamPlanKind;
  leadContractorId: string | null;
  assignments: TeamAssignment[];
  /** Required categories no candidate covers. Non-empty ⇒ not bookable. */
  uncoveredCategories: string[];
}

const TIER_RANK: Record<DeliveryTier, number> = { partner: 0, core: 1, adhoc: 2 };

/** Committed tiers get first pick of the lead role; ad-hoc leads only as a fallback. */
function isCommitted(tier: DeliveryTier): boolean {
  return tier === 'partner' || tier === 'core';
}

/**
 * Routing order: committed tiers first (partner, core), then priority ascending
 * (nulls last), then contractorId for stable determinism. This is the Craig-first
 * stack — Craig (core, priority 1) → Bezent → Joe → ad-hoc pool.
 */
function byRoutingOrder(a: TeamCandidate, b: TeamCandidate): number {
  const t = TIER_RANK[a.tier] - TIER_RANK[b.tier];
  if (t !== 0) return t;
  const ap = a.priority ?? Number.POSITIVE_INFINITY;
  const bp = b.priority ?? Number.POSITIVE_INFINITY;
  if (ap !== bp) return ap - bp;
  return a.contractorId < b.contractorId ? -1 : a.contractorId > b.contractorId ? 1 : 0;
}

/** Lead = committed-first, then most required-cats covered, then routing order. */
function pickLead(pool: TeamCandidate[]): TeamCandidate {
  return [...pool].sort((a, b) => {
    const committed = (isCommitted(a.tier) ? 0 : 1) - (isCommitted(b.tier) ? 0 : 1);
    if (committed !== 0) return committed;
    if (b.coveredCategories.length !== a.coveredCategories.length) {
      return b.coveredCategories.length - a.coveredCategories.length;
    }
    return byRoutingOrder(a, b);
  })[0];
}

export function resolveQuoteTeam(
  requiredCategories: string[],
  candidates: TeamCandidate[],
): QuoteTeamPlan {
  const required = Array.from(new Set(requiredCategories.filter(Boolean)));

  // Nothing to route.
  if (required.length === 0) {
    return { bookable: false, kind: 'no_supply', leadContractorId: null, assignments: [], uncoveredCategories: [] };
  }

  // Clamp each candidate's coverage to the required set; drop non-coverers; order.
  const pool = candidates
    .map((c) => ({ ...c, coveredCategories: c.coveredCategories.filter((cat) => required.includes(cat)) }))
    .filter((c) => c.coveredCategories.length > 0)
    .sort(byRoutingOrder);

  // True supply gap: a required category nobody covers, at any tier.
  const coveredByAnyone = new Set<string>();
  for (const c of pool) for (const cat of c.coveredCategories) coveredByAnyone.add(cat);
  const uncovered = required.filter((cat) => !coveredByAnyone.has(cat));
  if (uncovered.length > 0) {
    return { bookable: false, kind: 'no_supply', leadContractorId: null, assignments: [], uncoveredCategories: uncovered };
  }

  // 1. Solo (Craig-first): the best-ranked single contractor covering everything.
  const solo = pool.find((c) => c.coveredCategories.length === required.length);
  if (solo) {
    return {
      bookable: true,
      kind: 'solo',
      leadContractorId: solo.contractorId,
      assignments: [{ contractorId: solo.contractorId, role: 'lead', coveredCategories: [...required] }],
      uncoveredCategories: [],
    };
  }

  // 2. Compose: committed lead takes what it covers; residual lines → specialists.
  const lead = pickLead(pool);
  const leadCats = lead.coveredCategories;
  const residual = required.filter((cat) => !leadCats.includes(cat));

  const specialistCats = new Map<string, string[]>();
  for (const cat of residual) {
    const pick = pool.find((c) => c.contractorId !== lead.contractorId && c.coveredCategories.includes(cat));
    if (!pick) continue; // unreachable — uncovered handled above — but stay safe
    const list = specialistCats.get(pick.contractorId) ?? [];
    list.push(cat);
    specialistCats.set(pick.contractorId, list);
  }

  const assignments: TeamAssignment[] = [
    { contractorId: lead.contractorId, role: 'lead', coveredCategories: [...leadCats] },
    ...Array.from(specialistCats.entries()).map(([contractorId, cats]) => ({
      contractorId,
      role: 'specialist' as const,
      coveredCategories: cats,
    })),
  ];

  return { bookable: true, kind: 'composed', leadContractorId: lead.contractorId, assignments, uncoveredCategories: [] };
}

// ---------------------------------------------------------------------------
// Availability-driver derivation
// ---------------------------------------------------------------------------

export interface TeamFit {
  plan: QuoteTeamPlan;
  /**
   * Whose availability drives the customer calendar. `solo` → every contractor
   * who can do the whole job alone (union of their dates, unchanged from the old
   * behaviour). `composed` → the lead only (anchor) — ad-hoc specialists hold no
   * availability to intersect, so the lead's real windows set the promise and Ben
   * coordinates the specialist post-confirm (PRD §10.1). `no_supply` → empty.
   */
  availabilityContractorIds: string[];
  /** Contractors who can solo the whole job — for admin display + candidate pool. */
  fullCoverageCandidateIds: string[];
}

/**
 * Pure: turn a resolved candidate pool (with tiers) into a team plan plus the
 * contractor ids whose availability the customer calendar should reflect. DB-free
 * so it stays unit-testable; the caller supplies `candidates` from the matcher +
 * profile tiers.
 */
export function deriveTeamFit(
  requiredCategories: string[],
  candidates: TeamCandidate[],
): TeamFit {
  const plan = resolveQuoteTeam(requiredCategories, candidates);
  const required = Array.from(new Set(requiredCategories.filter(Boolean)));

  const fullCoverageCandidateIds =
    required.length === 0
      ? []
      : candidates
          .filter((c) => required.every((cat) => c.coveredCategories.includes(cat)))
          .map((c) => c.contractorId);

  let availabilityContractorIds: string[] = [];
  if (plan.kind === 'solo') {
    availabilityContractorIds = fullCoverageCandidateIds; // union of everyone who can solo it
  } else if (plan.kind === 'composed') {
    availabilityContractorIds = plan.leadContractorId ? [plan.leadContractorId] : [];
  }

  return { plan, availabilityContractorIds, fullCoverageCandidateIds };
}
