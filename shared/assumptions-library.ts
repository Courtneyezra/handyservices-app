// Quote assumptions — the caveats a fixed price is based on. Shown on the quote
// so that if reality differs on the day (hidden damage, no access, etc.) there's
// a documented basis to re-price rather than absorbing the cost. Two levels:
//   • quote-level "standard assumptions" — apply to every job (access, parking…)
//   • per-line assumptions — caveats tied to a specific line item
// Author-facing helpers only; nothing here is legally binding on its own — the
// decision was to DISPLAY assumptions prominently, not gate booking on them.

/**
 * Standard, reusable quote-level assumptions. Ben ticks the ones that apply and
 * can edit the wording per quote. Kept plain-English and customer-safe.
 */
export const STANDARD_ASSUMPTIONS: string[] = [
  'Clear, safe access to the work area on the day of the visit.',
  'Parking is available for our van within a reasonable distance.',
  'Working electricity and water are available on site.',
  'The work area is reasonably clear of furniture and belongings before we arrive.',
  'Existing installations (pipework, wiring, fixings) are sound unless stated otherwise.',
  'No asbestos or other hazardous materials are present in the work area.',
  'Walls and surfaces are suitable for standard fixings unless noted.',
  'Making good is limited to the immediate work area, not full-room redecoration.',
  'Price excludes unforeseen issues hidden behind walls, floors or units.',
  'Quoted for a single property at one visit unless stated otherwise.',
];

/**
 * Per-category suggested line assumptions — encodes the same "what varies on
 * site" knowledge as the scope-risk detector. Offered as one-tap chips in the
 * builder; Ben adds/edits the ones that apply to that line.
 */
export const CATEGORY_ASSUMPTIONS: Record<string, string[]> = {
  plastering: [
    'Existing plaster / substrate is sound and suitable to skim over.',
    'Finished to a smooth base ready for your own decoration.',
  ],
  plumbing_minor: [
    'Existing pipework is accessible and in serviceable condition.',
    'Stopcock / isolation valves are working.',
    'No hidden leaks or corrosion behind fittings.',
  ],
  electrical_minor: [
    'Existing wiring and consumer unit are sound and to current standard.',
    'Circuits are accessible without lifting floors or chasing walls.',
  ],
  tiling: [
    'Surface behind the tiles is flat, dry and sound.',
    'Substrate prep beyond minor leveling is not included.',
  ],
  flooring: [
    'Subfloor is level, dry and sound once the existing covering is lifted.',
    'No unforeseen damp or rot beneath the existing floor.',
  ],
  bathroom_fitting: [
    'Existing pipework and waste positions are reusable.',
    'No hidden rot, damp or leaks behind the existing suite.',
  ],
  kitchen_fitting: [
    'Existing services (water, waste, electrics) are in usable positions.',
    'Walls and floor are sound and reasonably level for units and worktops.',
  ],
  guttering: [
    'Existing fascia / brackets are sound enough to support the guttering.',
    'Safe ladder access is possible from the ground.',
  ],
  fencing: [
    'Ground is diggable for posts (no rock, concrete or buried services).',
    'Existing posts / panels can be removed without extra work.',
  ],
  carpentry: [
    'Existing timber / frame is sound where the new work meets it.',
  ],
  door_fitting: [
    'Existing frame and opening are square and sound.',
    'Standard-size door unless measured otherwise.',
  ],
  painting: [
    'Surfaces are sound and need only minor prep.',
    'Priced for the coats stated; heavy stain-blocking or repairs are extra.',
  ],
  general_fixing: [
    'Walls / surfaces are suitable for standard fixings.',
  ],
  other: [
    'Scope is as described from the information provided.',
  ],
};

/** Suggested per-line assumptions for a job category (empty if none defined). */
export function getSuggestedAssumptions(category?: string | null): string[] {
  if (!category) return [];
  return CATEGORY_ASSUMPTIONS[category] ?? [];
}
