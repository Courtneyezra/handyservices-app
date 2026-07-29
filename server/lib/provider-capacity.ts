/**
 * Provider capacity — the ONE place day-capacity comes from.
 *
 * Today every capacity number assumes one pair of hands (480min day, 240min
 * half-slot, 408min pack ceiling). The solo/team model makes capacity a
 * property of the PROVIDER: a crew of K works K × 480 × efficiency minutes
 * per calendar day (crews aren't perfectly parallel — some tasks serialise,
 * so K>1 pays an efficiency haircut). Week planner, day packer and duration
 * math should all read from here so onboarding a team contractor is a data
 * change, not a code hunt. See docs/contractor-platform/05-week-planner-ui.md.
 *
 * Wiring note: `crewSize` has no schema column yet — solo profiles pass
 * nothing and get exactly today's constants (invariant covered by tests).
 */

/** Crews lose ~15% to serialisation/coordination vs perfect parallelism. */
export const CREW_EFFICIENCY = 0.85;
/** One person's working day (matches SLOT_CAPACITY_MIN.full_day). */
export const SOLO_DAY_MINUTES = 480;
/** Suggestions stop filling at 85% of capacity — deliberate slack. */
export const PACK_CEILING_RATIO = 0.85;

export interface ProviderShape {
  crewSize?: number | null;
}

export interface ProviderCapacity {
  crew: number;
  /** Bookable work minutes per calendar day for this provider. */
  dayMinutes: number;
  /** One arrival window (AM or PM) worth of minutes. */
  halfSlotMinutes: number;
  /** The self-serve packing ceiling (85% of the day — slack preserved). */
  packCeilingMinutes: number;
}

export function providerCapacity(p?: ProviderShape | null): ProviderCapacity {
  const crew = Math.max(1, Math.round(Number(p?.crewSize ?? 1)) || 1);
  const dayMinutes = crew === 1 ? SOLO_DAY_MINUTES : Math.round(SOLO_DAY_MINUTES * crew * CREW_EFFICIENCY);
  return {
    crew,
    dayMinutes,
    halfSlotMinutes: Math.round(dayMinutes / 2),
    packCeilingMinutes: Math.round(dayMinutes * PACK_CEILING_RATIO),
  };
}

/** Days a job needs FROM THIS PROVIDER (a crew compresses the calendar). */
export function requiredDaysFor(p: ProviderShape | null | undefined, scheduleMinutes: number): number {
  if (!Number.isFinite(scheduleMinutes) || scheduleMinutes <= 0) return 1;
  return Math.max(1, Math.ceil(scheduleMinutes / providerCapacity(p).dayMinutes));
}
