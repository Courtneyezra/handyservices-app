// ---------------------------------------------------------------------------
// CrewSkinPicker — brand vertical + Solo/Team + quote-skin selection, extracted
// from the contextual quote builder so the comms quote-prep panel offers the
// exact same choices. Presentational: values + callbacks in, no fetching —
// use the exported hooks (same react-query keys as the builder, so the cache
// is shared) when the parent doesn't already have the data.
// ---------------------------------------------------------------------------

import { useQuery } from '@tanstack/react-query';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { verticalConfig } from '@shared/verticals';

function getAuthHeaders(): Record<string, string> {
  const token = localStorage.getItem('adminToken');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export interface SkinContractorOption {
  id: string;
  name: string;
  profileImageUrl: string | null;
  city: string | null;
}

export interface ContractorTeamOption {
  id: string;
  name: string;
  displayName: string;
  profileImageUrl: string | null;
  crewSize?: number;
  members: { contractorId: string; name: string; role: string | null }[];
}

// Built-in static skins — generated contractor asset sets that front a quote
// without a DB contractor row (server resolves skinContractorId "static:<key>"
// in resolveQuoteSkin; <key> matches SKINNED_HERO_SETS for the job-scene set).
export const STATIC_SKINS: { value: string; name: string; avatar: string; vertical: 'handyman' | 'cleaning' }[] = [
  { value: 'static:emile', name: 'Emile', avatar: '/assets/avatars/emile-avatar-1.webp', vertical: 'handyman' },
  { value: 'static:courtnee', name: 'Courtnee', avatar: '/assets/avatars/courtnee-avatar-1.webp', vertical: 'handyman' },
  { value: 'static:neil', name: 'Neil', avatar: '/assets/avatars/neil-avatar-1.webp', vertical: 'handyman' },
  // Handy Cleaning personas (placeholder AI faces — see shared/verticals.ts).
  { value: 'static:sofia', name: 'Sofia', avatar: '/assets/avatars/sofia-avatar-1.webp', vertical: 'cleaning' },
  { value: 'static:maria', name: 'Maria', avatar: '/assets/avatars/maria-avatar-1.webp', vertical: 'cleaning' },
  { value: 'static:lena', name: 'Lena', avatar: '/assets/avatars/lena-avatar-1.webp', vertical: 'cleaning' },
];

/** Contractors for the skin dropdown — same query key as the builder. */
export function useSkinContractors() {
  return useQuery<SkinContractorOption[]>({
    queryKey: ['pricing-contractors'],
    queryFn: async () => {
      const res = await fetch('/api/pricing/contractors', { headers: getAuthHeaders() });
      if (!res.ok) throw new Error('Failed to fetch contractors');
      return res.json();
    },
    staleTime: 60_000,
  });
}

/** Contractor teams for the Team crew/skin picker — same query key as the builder. */
export function useContractorTeams() {
  return useQuery<ContractorTeamOption[]>({
    queryKey: ['pricing-contractor-teams'],
    queryFn: async () => {
      const res = await fetch('/api/pricing/contractor-teams', { headers: getAuthHeaders() });
      if (!res.ok) throw new Error('Failed to fetch teams');
      return res.json();
    },
    staleTime: 60_000,
  });
}

export function CrewSkinPicker({
  vertical,
  onVerticalChange,
  crewType,
  onCrewTypeChange,
  skinContractorId,
  onSkinContractorIdChange,
  skinTeamId,
  onSkinTeamIdChange,
  contractors,
  teams,
}: {
  vertical: 'handyman' | 'cleaning';
  /** Omit to hide the vertical toggle (locks the passed vertical). */
  onVerticalChange?: (v: 'handyman' | 'cleaning') => void;
  crewType: 'solo' | 'team';
  onCrewTypeChange: (v: 'solo' | 'team') => void;
  skinContractorId: string | null;
  onSkinContractorIdChange: (v: string | null) => void;
  skinTeamId: string | null;
  onSkinTeamIdChange: (v: string | null) => void;
  contractors: SkinContractorOption[] | undefined;
  teams: ContractorTeamOption[] | undefined;
}) {
  return (
    <div className="space-y-4">
      {/* Brand vertical — handyman vs cleaning. Switching resets the
          skin selection since personas differ per vertical. */}
      {onVerticalChange && (
        <div className="space-y-1.5">
          <Label className="text-xs">Brand vertical</Label>
          <div className="flex gap-2">
            {(['handyman', 'cleaning'] as const).map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => { onVerticalChange(v); onSkinContractorIdChange(null); }}
                className={`flex-1 rounded-lg border px-3 py-2 text-sm font-semibold transition-colors ${
                  vertical === v
                    ? 'border-handy-navy bg-handy-navy text-white'
                    : 'border-handy-grid bg-white text-handy-navy/70 hover:border-handy-navy/40'
                }`}
              >
                {v === 'handyman' ? 'Handyman' : 'Cleaning'}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Solo / Team toggle */}
      <div className="flex gap-2">
        {(['solo', 'team'] as const).map((mode) => (
          <button
            key={mode}
            type="button"
            onClick={() => onCrewTypeChange(mode)}
            className={`flex-1 rounded-lg border px-3 py-2 text-sm font-semibold transition-colors ${
              crewType === mode
                ? 'border-handy-navy bg-handy-navy text-white'
                : 'border-handy-grid bg-white text-handy-navy/70 hover:border-handy-navy/40'
            }`}
          >
            {mode === 'solo' ? 'Solo' : 'Team'}
          </button>
        ))}
      </div>

      {crewType === 'team' ? (
        (teams?.length ?? 0) > 0 ? (
          <div className="space-y-1.5">
            <Label className="text-xs">Team</Label>
            <Select
              value={skinTeamId ?? 'none'}
              onValueChange={(v) => onSkinTeamIdChange(v === 'none' ? null : v)}
            >
              <SelectTrigger className="h-9">
                <SelectValue placeholder="Pick a team" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">No team selected</SelectItem>
                {teams!.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.displayName} · crew {t.crewSize ?? t.members.length} ({t.members.length} member{t.members.length === 1 ? '' : 's'})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : (
          <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
            No teams set up yet — the quote is marked as a team job, and the page shows the
            default skin until a team is created.
          </p>
        )
      ) : (
        <div className="space-y-1.5">
          <Label className="text-xs">Quote skin (contractor)</Label>
          <Select
            value={skinContractorId ?? 'default'}
            onValueChange={(v) => onSkinContractorIdChange(v === 'default' ? null : v)}
          >
            <SelectTrigger className="h-9">
              <SelectValue placeholder={`Default (${verticalConfig(vertical).defaultFace.name})`} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="default">
                <span className="flex items-center gap-2">
                  <img src={verticalConfig(vertical).defaultFace.avatarUrl} alt="" className="w-5 h-5 rounded-full object-cover" />
                  Default ({verticalConfig(vertical).defaultFace.name})
                </span>
              </SelectItem>
              {STATIC_SKINS.filter((s) => s.vertical === vertical).map((s) => (
                <SelectItem key={s.value} value={s.value}>
                  <span className="flex items-center gap-2">
                    <img src={s.avatar} alt="" className="w-5 h-5 rounded-full object-cover" />
                    {s.name} · Nottingham
                  </span>
                </SelectItem>
              ))}
              {(contractors ?? []).map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  <span className="flex items-center gap-2">
                    {c.profileImageUrl ? (
                      <img src={c.profileImageUrl} alt="" className="w-5 h-5 rounded-full object-cover" />
                    ) : (
                      <span className="w-5 h-5 rounded-full bg-slate-200 shrink-0" />
                    )}
                    {c.name}
                    {c.city ? ` · ${c.city}` : ''}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
    </div>
  );
}

export default CrewSkinPicker;
