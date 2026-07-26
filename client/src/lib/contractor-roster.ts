/**
 * Contractor roster — the ONE canonical list of the people who front Handy
 * Services across every surface: the quote loading-theatre orbit, the landing
 * "Meet your handymen" team grids, and the landing hero avatar cluster.
 *
 * Add a contractor here once and they appear everywhere. Each `key` matches the
 * asset filenames in client/public/assets/ (avatars/<key>-avatar-1.webp and
 * quote-images/<key>-*.webp) and the SKINNED_HERO_SETS entry in quote-skin.ts.
 *
 * NOTE: roles for `neil` and `bezent` are placeholders ("General handyman") —
 * swap for their real trade. `meta` avoids fabricated job counts for anyone
 * without real review data (only Craig/Joe carry the existing placeholder meta).
 */
export interface RosterContractor {
  key: string;
  name: string;
  role: string;
  /** Round headshot — orbit + hero cluster. */
  avatarUrl: string;
  /** Taller portrait — landing team cards (center-cropped to ~4:5). */
  portraitUrl: string;
  /** Trust/rating line under the team card. */
  meta: string;
}

export const CONTRACTOR_ROSTER: RosterContractor[] = [
  { key: 'craig', name: 'Craig', role: 'Lead handyman', avatarUrl: '/assets/avatars/craig-avatar-1.webp', portraitUrl: '/assets/quote-images/craig-banner.webp', meta: '4.9 · 214 jobs completed' },
  { key: 'joe', name: 'Joe', role: 'Handyman & carpenter', avatarUrl: '/assets/quote-images/joe-estimator.webp', portraitUrl: '/assets/quote-images/joe-estimator.webp', meta: '4.9 · vetted, DBS-checked' },
  { key: 'emile', name: 'Emile', role: 'General handyman', avatarUrl: '/assets/avatars/emile-avatar-1.webp', portraitUrl: '/assets/quote-images/emile-banner.webp', meta: 'DBS-checked · £2M insured' },
  { key: 'courtnee', name: 'Courtnee', role: 'Plumber · multi-skilled', avatarUrl: '/assets/avatars/courtnee-avatar-1.webp', portraitUrl: '/assets/quote-images/courtnee-banner.webp', meta: 'Vetted · 90-day guarantee' },
  { key: 'neil', name: 'Neil', role: 'General handyman', avatarUrl: '/assets/avatars/neil-avatar-1.webp', portraitUrl: '/assets/quote-images/neil-banner.webp', meta: '£2M insured · guaranteed work' },
  { key: 'bezent', name: 'Bezent', role: 'General handyman', avatarUrl: '/assets/avatars/bezent-avatar-1.webp', portraitUrl: '/assets/quote-images/bezent-banner.webp', meta: 'DBS-checked · fully vetted' },
];

/** Round avatar URLs in roster order — feeds the loading-theatre orbit pool. */
export const ROSTER_ORBIT_AVATARS = CONTRACTOR_ROSTER.map((c) => c.avatarUrl);
