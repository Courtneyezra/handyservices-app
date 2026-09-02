/**
 * Deterministic job category per quote line (Phase 2 / C, COMMS_AGENTS_V3_DESIGN §6).
 *
 * "Build the catalog as a by-product: the clerk emits `category` on every line from day one, and
 * every line Ben keeps unchanged is a labelled SKU candidate." The vocabulary is the existing
 * JobCategoryValues so the label joins straight onto pricing data. Keyword rules, first match
 * wins, most specific first; 'other' when nothing matches. No model call — a label the eval can
 * pin down is worth more than a cleverer one it cannot.
 */
import { JobCategoryValues, type JobCategory } from '@shared/contextual-pricing-types';

const RULES: Array<[JobCategory, RegExp]> = [
    ['tv_mounting', /\b(tv|television)\b.*\b(mount|wall|bracket)|\b(mount|bracket)\b.*\btv\b/i],
    ['flat_pack', /\b(flat[- ]?pack|ikea|assembl|wardrobe build|bed frame|chest of drawers)\b/i],
    ['lock_change', /\b(lock|latch|deadbolt|cylinder|key(s)? (cut|lost)|door security)\b/i],
    ['silicone_sealant', /\b(silicone|sealant|re-?seal|mastic|caulk)\b/i],
    ['tiling', /\b(tile|tiling|grout|splashback)\b/i],
    ['plastering', /\b(plaster|skim|render|artex|ceiling crack)\b/i],
    ['painting', /\b(paint|decorat|emulsion|gloss|wallpaper|touch[- ]?up)\b/i],
    ['guttering', /\b(gutter|downpipe|fascia|soffit)\b/i],
    ['pressure_washing', /\b(pressure[- ]?wash|jet[- ]?wash|driveway clean|patio clean)\b/i],
    ['fencing', /\b(fence|fencing|fence panel|gate post|trellis)\b/i],
    ['garden_maintenance', /\b(garden|shed|hedge|lawn|decking|turf|weeding)\b/i],
    ['bathroom_fitting', /\b(bathroom (fit|install|refit)|new bathroom|shower (install|fit)|bath install)\b/i],
    ['kitchen_fitting', /\b(kitchen (fit|install|refit)|new kitchen|worktop (fit|replace))\b/i],
    ['door_fitting', /\b(door)\b.*\b(hang|fit|install|replace|adjust|plane|trim)|\b(hang|fit|install|replace)\b.*\bdoors?\b/i],
    ['flooring', /\b(floor|laminate|vinyl|lvt|carpet|underlay|skirting)\b/i],
    ['curtain_blinds', /\b(curtain|blind|roller blind|curtain (rail|pole|track))\b/i],
    ['shelving', /\b(shelf|shelves|shelving|bracket|alcove)\b/i],
    ['furniture_repair', /\b(drawer|hinge|runner|recliner|chair|sofa|table leg|cabinet repair)\b/i],
    ['plumbing_minor', /\b(tap|toilet|cistern|leak|radiator|valve|sink|waste pipe|bath waste|overflow|plumb)\b/i],
    ['waste_removal', /\b(rubbish|waste (removal|clearance|collection)|house clearance|dispose|disposal|skip hire)\b/i],
    ['electrical_minor', /\b(socket|light fitting|light fixture|switch|extractor|fan|spotlight|dimmer|electric)\b/i],
    ['carpentry', /\b(carpentry|joinery|timber|architrave|stud wall|boxing in|cupboard|built[- ]in)\b/i],
    ['general_fixing', /\b(hang|fix|fixing|picture|mirror|curtain rail|towel rail|grab rail|repair)\b/i],
];

export function categoriseLine(title: string, detail?: string | null): JobCategory {
    const text = `${title ?? ''} ${detail ?? ''}`;
    for (const [category, re] of RULES) if (re.test(text)) return category;
    return 'other';
}

export function isJobCategory(v: unknown): v is JobCategory {
    return typeof v === 'string' && (JobCategoryValues as readonly string[]).includes(v);
}

/** Add `category` to every line of an intake-shaped object without changing anything else. */
export function withLineCategories<T extends { lines: Array<{ title: string; detail?: string | null }> }>(
    intake: T,
): T & { lines: Array<T['lines'][number] & { category: JobCategory }> } {
    return { ...intake, lines: intake.lines.map((l) => ({ ...l, category: categoriseLine(l.title, l.detail) })) };
}
