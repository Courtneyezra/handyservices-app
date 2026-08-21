/**
 * Vertical config — the ONE source of truth for trade-specific copy, imagery
 * rules, and the default brand face across the contextual quote experience.
 *
 * The business runs parallel verticals (handyman + cleaning). Every quote carries
 * a `vertical` (personalized_quotes.vertical, default 'handyman') set at
 * generation; it rides on the GET payload so any client/server helper that
 * already has the quote can resolve the right brand via `verticalConfig(...)`.
 *
 * RULE: the `handyman` config must mirror the literals that were hard-coded
 * before this module existed, so the handyman flow is unchanged. `cleaning` is
 * purely additive — new copy + new image-set keys under the Handy umbrella.
 */

export type Vertical = 'handyman' | 'cleaning';

/**
 * Hero-image rule: when `test` matches the job, resolve to `imageKey`.
 * `skinKeyed` scenes render the assigned face's own set
 * (`/assets/quote-images/<skinKey>-<imageKey>.webp`); non-skin-keyed scenes are
 * shared brand images (`/assets/quote-images/<imageKey>.webp`).
 */
export interface HeroRule {
  test: (jobDesc: string, category: string) => boolean;
  imageKey: string;
  skinKeyed?: boolean;
}

export interface VerticalConfig {
  key: Vertical;

  // ── Brand / trade nouns ──────────────────────────────────────────────
  tradeNoun: string;        // "handyman" | "cleaner"
  tradeNounPlural: string;  // "handymen" | "cleaners"
  tradeNounTitle: string;   // "Handyman" | "Cleaner"
  brandName: string;        // "Handy Services" | "Handy Cleaning"
  brandSuffix: string;      // "HandyServices" | "Handy Cleaning" (compact byline)

  // ── Default brand face (used when no skin selected at generation) ─────
  defaultFace: {
    name: string;
    key: string;            // asset-set key + roster key
    avatarUrl: string;
    bannerUrl: string;
    roleSolo: string;       // "Your Nottingham handyman"
  };
  /** Team role line (teamSize) — trade-neutral, shared shape. */
  roleTeam: (teamSize: number) => string;

  // ── Segmentation ─────────────────────────────────────────────────────
  anchorDescription: string; // "Professional Handyman Service" | "...Cleaning..."

  // ── Hero imagery ─────────────────────────────────────────────────────
  heroRules: HeroRule[];
  /** "Recent work" gallery (skin-keyed scenes) for the contractor profile. */
  gallery: { imageKey: string; label: string }[];
  /** Scene when no rule matches. */
  heroFallbackKey: string;
  /** Whether the fallback is per-skin (`<skinKey>-<key>`) or a shared brand image. */
  heroFallbackSkinKeyed: boolean;
  /** Generic doorway scene for elderly/landlord archetypes (not skin-keyed). */
  archetypeDoorImage: string;

  // ── Copy tokens (customer-facing) ────────────────────────────────────
  copy: {
    meetEyebrow: string;        // "Meet your handyman"
    assignedLabel: string;      // "Your assigned handyman"
    bookingLabel: string;       // "Your handyman booking"
    insuredLabel: string;       // "Fully Insured Handymen"
    bestReviewed: string;       // "Nottingham's best-reviewed handyman"
    vsNormal: string;           // "vs. a normal handyman"
    wrongTurns: string;         // "The wrong handyman turns a small job into a big bill"
    everythingShouldBe: string; // "Everything a handyman should be — and usually isn't."
    everyVetted: string;        // "Every handyman DBS-checked & vetted"
    heroAlt: string;            // "Professional handyman at work"
    jobTitleFallback: string;   // "Your handyman job"
    cheapGamble: string;        // "A cheap handyman is a gamble."
  };

  /**
   * Social-proof reviews for this vertical. Handyman = the long-standing generic
   * set; cleaning = cleaning-specific. These front the quote's review cards when
   * no real Google reviews are wired for the vertical. PLACEHOLDER copy — swap
   * for genuine verified reviews before launch (never ship invented ones as real).
   */
  reviews: { text: string; author: string; detail: string; relativeTime: string; rating: number }[];
}

// ─────────────────────────────────────────────────────────────────────────
// HANDYMAN — mirrors the pre-existing hard-coded literals. Do not change
// these values without a matching change to the customer-facing handyman flow.
// ─────────────────────────────────────────────────────────────────────────
const HANDYMAN: VerticalConfig = {
  key: 'handyman',
  tradeNoun: 'handyman',
  tradeNounPlural: 'handymen',
  tradeNounTitle: 'Handyman',
  brandName: 'Handy Services',
  brandSuffix: 'HandyServices',
  defaultFace: {
    name: 'Craig',
    key: 'craig',
    avatarUrl: '/assets/avatars/craig-avatar-1.webp',
    bannerUrl: '/assets/quote-images/craig-banner.webp',
    roleSolo: 'Your Nottingham handyman',
  },
  roleTeam: (n) => `Your ${n}-person Nottingham team`,
  anchorDescription: 'Professional Handyman Service',
  heroRules: [
    { test: (d) => /gutter|downpipe|fascia|soffit/.test(d), imageKey: 'gutter', skinKeyed: true },
    { test: (d) => /fence|fencing|fence panel|decking|gate|garden/.test(d), imageKey: 'fence', skinKeyed: true },
    { test: (d) => /tv mount|tv bracket|mount.{0,6}tv|television|wall.?mount/.test(d), imageKey: 'tv-mount', skinKeyed: true },
    { test: (d) => /tile|tiling|grout|splashback|backsplash/.test(d), imageKey: 'tiling', skinKeyed: true },
    { test: (d) => /flat.?pack|assemble|assembly|wardrobe|furniture|ikea|cabinet|chest of drawers|bookshelf|shelf unit/.test(d), imageKey: 'flatpack', skinKeyed: true },
    { test: (d, c) => /electric|socket|light fitting|light fixture|pendant|downlight|spotlight|consumer unit|fuse|wiring|isolator|switch/.test(d) || c === 'electrical_minor', imageKey: 'light', skinKeyed: true },
    { test: (d, c) => /plumb|tap|leak|pipe|drain|toilet|boiler|washing machine|dishwasher/.test(d) || c === 'plumbing_minor', imageKey: 'plumbing', skinKeyed: true },
    { test: (d) => /silicone|re.?seal|sealant|caulk|re.?grout|shower/.test(d), imageKey: 'bathroom', skinKeyed: true },
    { test: (d, c) => /paint|decor|colour|color/.test(d) || c === 'painting', imageKey: 'painting', skinKeyed: true },
  ],
  gallery: [
    { imageKey: 'bathroom', label: 'Bathroom reseal' },
    { imageKey: 'tiling', label: 'Tiling' },
    { imageKey: 'fence', label: 'Fence repair' },
    { imageKey: 'light', label: 'Light fitting' },
    { imageKey: 'flatpack', label: 'Flat-pack build' },
    { imageKey: 'gutter', label: 'Gutter clear' },
  ],
  heroFallbackKey: 'door-greeting',   // shared generic doorway
  heroFallbackSkinKeyed: false,
  archetypeDoorImage: 'older-person-door',
  copy: {
    meetEyebrow: 'Meet your handyman',
    assignedLabel: 'Your assigned handyman',
    bookingLabel: 'Your handyman booking',
    insuredLabel: 'Fully Insured Handymen',
    bestReviewed: "Nottingham's best-reviewed handyman",
    vsNormal: 'vs. a normal handyman',
    wrongTurns: 'The wrong handyman turns a small job into a big bill',
    everythingShouldBe: "Everything a handyman should be — and usually isn't.",
    everyVetted: 'Every handyman DBS-checked & vetted',
    heroAlt: 'Professional handyman at work',
    jobTitleFallback: 'Your handyman job',
    cheapGamble: 'A cheap handyman is a gamble.',
  },
  reviews: [
    { text: 'Turned up on time, great quality work, left the place spotless. Will definitely use again.', author: 'Sarah M.', detail: 'Nottingham', relativeTime: '2 weeks ago', rating: 5 },
    { text: 'Fixed everything on the list in one visit. Professional, friendly, and fair price.', author: 'David T.', detail: 'West Bridgford', relativeTime: '1 month ago', rating: 5 },
    { text: 'Brilliant service start to finish. Communicated well, no hidden costs, top quality work.', author: 'James R.', detail: 'Beeston', relativeTime: '2 months ago', rating: 5 },
  ],
};

// ─────────────────────────────────────────────────────────────────────────
// CLEANING — additive, under the Handy umbrella (same navy/yellow palette).
// Default face "Sofia" + persona keys are placeholders (rename here + in
// contractor-roster.ts). Image-set keys drive the asset filenames Phase F fills.
// ─────────────────────────────────────────────────────────────────────────
const CLEANING: VerticalConfig = {
  key: 'cleaning',
  tradeNoun: 'cleaner',
  tradeNounPlural: 'cleaners',
  tradeNounTitle: 'Cleaner',
  brandName: 'Handy Cleaning',
  brandSuffix: 'Handy Cleaning',
  defaultFace: {
    name: 'Sofia',
    key: 'sofia',
    avatarUrl: '/assets/avatars/sofia-avatar-1.webp',
    bannerUrl: '/assets/quote-images/sofia-banner.webp',
    roleSolo: 'Your Nottingham cleaner',
  },
  roleTeam: (n) => `Your ${n}-person Nottingham team`,
  anchorDescription: 'Professional Cleaning Service',
  heroRules: [
    { test: (d) => /end.?of.?tenancy|move.?out|move.?in|check.?out|deposit|tenancy clean/.test(d), imageKey: 'end-of-tenancy', skinKeyed: true },
    { test: (d) => /oven|hob|extractor|range cooker|grill/.test(d), imageKey: 'oven', skinKeyed: true },
    { test: (d) => /carpet|upholstery|rug|steam clean|sofa clean/.test(d), imageKey: 'carpet', skinKeyed: true },
    { test: (d) => /regular|weekly|fortnightly|recurring|ongoing|maintenance clean|domestic clean/.test(d), imageKey: 'regular', skinKeyed: true },
    { test: (d) => /deep clean|one.?off|spring clean|first clean|full clean|thorough clean/.test(d), imageKey: 'deep-clean', skinKeyed: true },
  ],
  gallery: [
    { imageKey: 'deep-clean', label: 'Deep clean' },
    { imageKey: 'end-of-tenancy', label: 'End of tenancy' },
    { imageKey: 'oven', label: 'Oven clean' },
    { imageKey: 'carpet', label: 'Carpet clean' },
    { imageKey: 'regular', label: 'Regular clean' },
  ],
  heroFallbackKey: 'deep-clean', // assigned cleaner, deep-clean scene as the safe default
  heroFallbackSkinKeyed: true,
  archetypeDoorImage: 'cleaner-older-person-door',
  copy: {
    meetEyebrow: 'Meet your cleaner',
    assignedLabel: 'Your assigned cleaner',
    bookingLabel: 'Your cleaning booking',
    insuredLabel: 'Fully Insured Cleaners',
    bestReviewed: "Nottingham's best-reviewed cleaner",
    vsNormal: 'vs. a normal cleaner',
    wrongTurns: 'The wrong cleaner leaves you scrubbing it again yourself',
    everythingShouldBe: "Everything a cleaner should be — and usually isn't.",
    everyVetted: 'Every cleaner DBS-checked & vetted',
    heroAlt: 'Professional cleaner at work',
    jobTitleFallback: 'Your cleaning job',
    cheapGamble: 'A cheap cleaner is a gamble.',
  },
  // PLACEHOLDER cleaning reviews — swap for real verified Google reviews before launch.
  reviews: [
    { text: 'End-of-tenancy clean and I got my full deposit back — spotless from top to bottom.', author: 'Sarah M.', detail: 'West Bridgford', relativeTime: '2 weeks ago', rating: 5 },
    { text: 'The oven looks brand new. On time, lovely and thorough, and no hidden costs.', author: 'David T.', detail: 'Beeston', relativeTime: '1 month ago', rating: 5 },
    { text: 'Book them every fortnight now — reliable, trustworthy, and the house always smells amazing.', author: 'Priya K.', detail: 'Nottingham', relativeTime: '2 months ago', rating: 5 },
  ],
};

export const VERTICALS: Record<Vertical, VerticalConfig> = {
  handyman: HANDYMAN,
  cleaning: CLEANING,
};

/** Resolve a config from a (possibly undefined/loose) vertical value. */
export function verticalConfig(v?: string | null): VerticalConfig {
  return VERTICALS[(v as Vertical)] ?? VERTICALS.handyman;
}

/** Skin-set keys that ship a full job-scene image set, keyed by vertical. */
export const SKINNED_HERO_SETS_BY_VERTICAL: Record<Vertical, string[]> = {
  handyman: ['craig', 'bezent', 'emile', 'courtnee', 'neil'],
  cleaning: ['sofia', 'maria', 'lena'],
};
