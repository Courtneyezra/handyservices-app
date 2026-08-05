/**
 * Quote skin — the contractor/team identity fronting the customer quote page.
 *
 * The server resolves `quote.skin` from the generation-time selection
 * (skinContractorId / skinTeamId on personalized_quotes → handyman_profiles /
 * contractor_teams). This module merges that payload with the default brand
 * skin (Craig) so every consumer — loading reveal, "meet your handyman"
 * profile, guarantee imagery, day-picker copy, post-pay hub — reads ONE object
 * instead of hard-coding Craig.
 *
 * Rule of thumb: `skin.isDefault` gates the Craig-specific rich content
 * (bio, work gallery, banner) that real contractor profiles may not have yet.
 */

import { verticalConfig, SKINNED_HERO_SETS_BY_VERTICAL } from '@shared/verticals';

/** Shape of the server-resolved skin on the quote payload (see server/quotes.ts). */
export interface ServerQuoteSkin {
  kind: 'contractor' | 'team';
  name: string;
  fullName: string | null;
  avatarUrl: string | null;
  bannerUrl: string | null;
  bio: string | null;
  gallery: string[];
  teamSize?: number;
  members?: { name: string; avatarUrl: string | null }[];
}

export interface QuoteSkin {
  kind: 'contractor' | 'team';
  /** Customer-facing name: "Craig" or a team display name like "Craig's Team". */
  name: string;
  /** Possessive for copy: "Craig's queue" / "the team's queue". */
  possessive: string;
  avatarUrl: string;
  bannerUrl: string | null;
  bio: string | null;
  gallery: string[];
  rating: string;
  jobsLabel: string;
  role: string;
  teamSize?: number;
  members?: { name: string; avatarUrl: string | null }[];
  /** True when no skin was selected at generation — Craig brand default. */
  isDefault: boolean;
}

const SKIN_RATING = '4.9';
const SKIN_JOBS_LABEL = '214 jobs';

/**
 * The default brand skin for a vertical — used when no skin was selected at
 * generation. Handyman → Craig, cleaning → Sofia (see shared/verticals.ts).
 */
export function defaultSkin(vertical?: string | null): QuoteSkin {
  const face = verticalConfig(vertical).defaultFace;
  return {
    kind: 'contractor',
    name: face.name,
    possessive: `${face.name}'s`,
    avatarUrl: face.avatarUrl,
    bannerUrl: face.bannerUrl,
    bio: null,
    gallery: [],
    rating: SKIN_RATING,
    jobsLabel: SKIN_JOBS_LABEL,
    role: face.roleSolo,
    isDefault: true,
  };
}

/** Back-compat: the handyman brand default. Prefer `defaultSkin(vertical)`. */
export const DEFAULT_QUOTE_SKIN: QuoteSkin = defaultSkin('handyman');

export function resolveQuoteSkin(
  skin: ServerQuoteSkin | null | undefined,
  vertical?: string | null,
): QuoteSkin {
  const cfg = verticalConfig(vertical);
  if (!skin) return defaultSkin(vertical);
  const isTeam = skin.kind === 'team';
  return {
    kind: skin.kind,
    name: skin.name,
    // "Craig's" reads naturally; "Craig's Team's" doesn't — teams get "the team's".
    possessive: isTeam ? "the team's" : `${skin.name}'s`,
    avatarUrl: skin.avatarUrl || cfg.defaultFace.avatarUrl,
    bannerUrl: skin.bannerUrl,
    bio: skin.bio,
    gallery: skin.gallery ?? [],
    rating: SKIN_RATING,
    jobsLabel: SKIN_JOBS_LABEL,
    role: isTeam ? cfg.roleTeam(skin.teamSize ?? 2) : cfg.defaultFace.roleSolo,
    teamSize: skin.teamSize,
    members: skin.members,
    isDefault: false,
  };
}

/**
 * Skins that ship a COMPLETE job-scene image set under
 * /assets/quote-images/<key>-<job>.webp (+ banner + guarantee). A skin's key
 * uniquely identifies its set regardless of vertical, so this is the union of
 * every vertical's sets (see SKINNED_HERO_SETS_BY_VERTICAL). getHeroImage/
 * ValueGuarantee/ContractorProfile resolve into the skin's own set when its key
 * is here, else fall back to the vertical's default face set.
 */
export const SKINNED_HERO_SETS = new Set<string>([
  ...SKINNED_HERO_SETS_BY_VERTICAL.handyman,
  ...SKINNED_HERO_SETS_BY_VERTICAL.cleaning,
]);

/** Asset-set key for a skin, or null when it has no dedicated job-scene set. */
export function skinAssetKey(skin: QuoteSkin): string | null {
  const key = skin.name.trim().split(/\s+/)[0].toLowerCase();
  return SKINNED_HERO_SETS.has(key) ? key : null;
}

/**
 * Loading-screen reveal cast. Teams reveal the members (lead first, "+N" badge
 * handled by the screen); solo reveals the one face.
 */
export function skinToMatchedHandymen(skin: QuoteSkin): {
  name: string;
  avatarUrl: string;
  role?: string;
  rating?: string;
  jobsLabel?: string;
}[] {
  if (skin.kind === 'team' && skin.members && skin.members.length > 0) {
    return skin.members.map((m, i) => ({
      name: m.name,
      avatarUrl: m.avatarUrl || skin.avatarUrl,
      ...(i === 0 ? { role: skin.role, rating: skin.rating } : {}),
    }));
  }
  return [{
    name: skin.name,
    avatarUrl: skin.avatarUrl,
    role: skin.role,
    rating: skin.rating,
    jobsLabel: skin.jobsLabel,
  }];
}
