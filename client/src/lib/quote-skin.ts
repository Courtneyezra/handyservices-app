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

export const DEFAULT_QUOTE_SKIN: QuoteSkin = {
  kind: 'contractor',
  name: 'Craig',
  possessive: "Craig's",
  avatarUrl: '/assets/avatars/craig-avatar-1.webp',
  bannerUrl: '/assets/quote-images/craig-banner.webp',
  bio: null,
  gallery: [],
  rating: '4.9',
  jobsLabel: '214 jobs',
  role: 'Your Nottingham handyman',
  isDefault: true,
};

export function resolveQuoteSkin(skin: ServerQuoteSkin | null | undefined): QuoteSkin {
  if (!skin) return DEFAULT_QUOTE_SKIN;
  const isTeam = skin.kind === 'team';
  return {
    kind: skin.kind,
    name: skin.name,
    // "Craig's" reads naturally; "Craig's Team's" doesn't — teams get "the team's".
    possessive: isTeam ? "the team's" : `${skin.name}'s`,
    avatarUrl: skin.avatarUrl || DEFAULT_QUOTE_SKIN.avatarUrl,
    bannerUrl: skin.bannerUrl,
    bio: skin.bio,
    gallery: skin.gallery ?? [],
    rating: DEFAULT_QUOTE_SKIN.rating,
    jobsLabel: DEFAULT_QUOTE_SKIN.jobsLabel,
    role: isTeam
      ? `Your ${skin.teamSize ?? 2}-person Nottingham team`
      : 'Your Nottingham handyman',
    teamSize: skin.teamSize,
    members: skin.members,
    isDefault: false,
  };
}

/**
 * Skins that ship a COMPLETE job-scene image set under
 * /assets/quote-images/<key>-<job>.webp (gutter/fence/tv-mount/tiling/
 * flatpack/light/bathroom/painting + banner + guarantee), mirroring the Craig
 * brand set. getHeroImage/ValueGuarantee/ContractorProfile resolve into the
 * skin's own set when its key is here, else fall back to the Craig set.
 */
export const SKINNED_HERO_SETS = new Set(['craig', 'bezent']);

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
