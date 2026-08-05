import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Users, Plus, Trash2, Pencil, Crown } from "lucide-react";

/**
 * Contractor Teams admin — create/manage the persistent "small firm" teams
 * (a lead + their crew) that front quotes as a team skin and get assigned +
 * paid as ONE unit (Handy pays the lead; the lead pays his crew). `crewSize`
 * captures the pairs of hands and drives capacity in the scheduler (Phase 2).
 */

const getAuthHeaders = () => {
  const token = localStorage.getItem("adminToken");
  return {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
};

interface ContractorOption {
  id: string;
  name: string;
  profileImageUrl: string | null;
  city: string | null;
}

interface TeamMember {
  contractorId: string;
  name: string;
  role: string | null;
  profileImageUrl: string | null;
}

interface Team {
  id: string;
  name: string;
  displayName: string;
  leadContractorId: string | null;
  profileImageUrl: string | null;
  heroImageUrl: string | null;
  bio: string | null;
  crewSize: number;
  isActive: boolean;
  members: TeamMember[];
}

interface TeamDraft {
  id?: string;
  name: string;
  displayName: string;
  leadContractorId: string;
  memberIds: string[];
  crewSize: number;
  bio: string;
  profileImageUrl: string;
  heroImageUrl: string;
}

const EMPTY_DRAFT: TeamDraft = {
  name: "",
  displayName: "",
  leadContractorId: "",
  memberIds: [],
  crewSize: 1,
  bio: "",
  profileImageUrl: "",
  heroImageUrl: "",
};

export default function ContractorTeams() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<TeamDraft | null>(null);

  const { data: teams = [], isLoading } = useQuery<Team[]>({
    queryKey: ["contractor-teams-admin"],
    queryFn: async () => {
      const res = await fetch("/api/pricing/contractor-teams", { headers: getAuthHeaders() });
      if (!res.ok) throw new Error("Failed to load teams");
      return res.json();
    },
  });

  const { data: contractors = [] } = useQuery<ContractorOption[]>({
    queryKey: ["pricing-contractors"],
    queryFn: async () => {
      const res = await fetch("/api/pricing/contractors", { headers: getAuthHeaders() });
      if (!res.ok) throw new Error("Failed to load contractors");
      return res.json();
    },
    staleTime: 60_000,
  });

  const contractorById = useMemo(
    () => new Map(contractors.map((c) => [c.id, c])),
    [contractors],
  );

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["contractor-teams-admin"] });
    // Keep the quote builder's picker in sync.
    queryClient.invalidateQueries({ queryKey: ["pricing-contractor-teams"] });
  };

  const saveMutation = useMutation({
    mutationFn: async (d: TeamDraft) => {
      // A lead is always one of the members.
      const memberContractorIds = Array.from(
        new Set(d.leadContractorId ? [d.leadContractorId, ...d.memberIds] : d.memberIds),
      );
      if (memberContractorIds.length === 0) throw new Error("Pick at least one team member");
      const body = JSON.stringify({
        name: d.name.trim(),
        displayName: d.displayName.trim() || undefined,
        leadContractorId: d.leadContractorId || undefined,
        memberContractorIds,
        crewSize: d.crewSize,
        bio: d.bio.trim() || undefined,
        profileImageUrl: d.profileImageUrl.trim() || undefined,
        heroImageUrl: d.heroImageUrl.trim() || undefined,
      });
      const url = d.id
        ? `/api/pricing/contractor-teams/${d.id}`
        : "/api/pricing/contractor-teams";
      const res = await fetch(url, { method: d.id ? "PATCH" : "POST", headers: getAuthHeaders(), body });
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error || "Save failed");
      return res.json();
    },
    onSuccess: (_r, d) => {
      toast({ title: d.id ? "Team updated" : "Team created" });
      setDraft(null);
      invalidate();
    },
    onError: (e: any) => toast({ title: "Couldn't save team", description: e.message, variant: "destructive" }),
  });

  const deactivateMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/pricing/contractor-teams/${id}`, { method: "DELETE", headers: getAuthHeaders() });
      if (!res.ok) throw new Error("Deactivate failed");
      return res.json();
    },
    onSuccess: () => { toast({ title: "Team deactivated" }); invalidate(); },
    onError: (e: any) => toast({ title: "Couldn't deactivate", description: e.message, variant: "destructive" }),
  });

  const startEdit = (t: Team) =>
    setDraft({
      id: t.id,
      name: t.name,
      displayName: t.displayName || "",
      leadContractorId: t.leadContractorId || "",
      memberIds: t.members.map((m) => m.contractorId),
      crewSize: t.crewSize ?? t.members.length ?? 1,
      bio: t.bio || "",
      profileImageUrl: t.profileImageUrl || "",
      heroImageUrl: t.heroImageUrl || "",
    });

  const toggleMember = (id: string) =>
    setDraft((d) =>
      d ? { ...d, memberIds: d.memberIds.includes(id) ? d.memberIds.filter((m) => m !== id) : [...d.memberIds, id] } : d,
    );

  return (
    <div className="max-w-4xl mx-auto p-4 md:p-8 space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-handy-navy flex items-center gap-2">
            <Users className="w-6 h-6" /> Contractor Teams
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            A lead + their crew. Assigned &amp; paid as one unit (Handy pays the lead); fronts quotes as a team skin.
            <b> Crew size</b> is the pairs of hands — it drives calendar capacity.
          </p>
        </div>
        {!draft && (
          <Button onClick={() => setDraft({ ...EMPTY_DRAFT })} className="shrink-0">
            <Plus className="w-4 h-4 mr-1" /> New team
          </Button>
        )}
      </div>

      {/* ── Editor ─────────────────────────────────────────────── */}
      {draft && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">{draft.id ? "Edit team" : "New team"}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label className="text-xs">Internal name</Label>
                <Input value={draft.name} placeholder="Craig + crew" onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Customer-facing name</Label>
                <Input value={draft.displayName} placeholder="Craig's Team" onChange={(e) => setDraft({ ...draft, displayName: e.target.value })} />
              </div>
            </div>

            <div className="grid sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label className="text-xs">Lead contractor</Label>
                <select
                  className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                  value={draft.leadContractorId}
                  onChange={(e) => setDraft({ ...draft, leadContractorId: e.target.value })}
                >
                  <option value="">— pick lead —</option>
                  {contractors.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}{c.city ? ` · ${c.city}` : ""}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Crew size (pairs of hands)</Label>
                <Input
                  type="number" min={1} max={20} value={draft.crewSize}
                  onChange={(e) => setDraft({ ...draft, crewSize: Math.max(1, Math.min(20, Number(e.target.value) || 1)) })}
                />
                <p className="text-[11px] text-muted-foreground">A team of {draft.crewSize} books ~{draft.crewSize}× the daily work and finishes a job ~{draft.crewSize}× faster (Phase 2).</p>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">Crew members</Label>
              <div className="grid sm:grid-cols-2 gap-1.5 max-h-56 overflow-y-auto rounded-md border p-2">
                {contractors.map((c) => {
                  const checked = draft.memberIds.includes(c.id) || draft.leadContractorId === c.id;
                  const isLead = draft.leadContractorId === c.id;
                  return (
                    <label key={c.id} className={`flex items-center gap-2 rounded px-2 py-1.5 text-sm cursor-pointer ${checked ? "bg-handy-navy/5" : "hover:bg-slate-50"}`}>
                      <input
                        type="checkbox" checked={checked} disabled={isLead}
                        onChange={() => toggleMember(c.id)}
                      />
                      {c.profileImageUrl
                        ? <img src={c.profileImageUrl} alt="" className="w-6 h-6 rounded-full object-cover" />
                        : <span className="w-6 h-6 rounded-full bg-slate-200 shrink-0" />}
                      <span className="truncate">{c.name}</span>
                      {isLead && <Crown className="w-3.5 h-3.5 text-amber-500 ml-auto shrink-0" />}
                    </label>
                  );
                })}
                {contractors.length === 0 && <p className="text-xs text-muted-foreground p-2">No contractors found.</p>}
              </div>
              <p className="text-[11px] text-muted-foreground">The lead is always included. Members are for the team skin faces + roster.</p>
            </div>

            <div className="grid sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label className="text-xs">Team avatar URL (optional)</Label>
                <Input value={draft.profileImageUrl} placeholder="/assets/avatars/…" onChange={(e) => setDraft({ ...draft, profileImageUrl: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Team banner URL (optional)</Label>
                <Input value={draft.heroImageUrl} placeholder="/assets/quote-images/…" onChange={(e) => setDraft({ ...draft, heroImageUrl: e.target.value })} />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">Bio (optional)</Label>
              <Textarea rows={2} value={draft.bio} placeholder="Craig's crew — end-of-tenancy specialists across Nottingham." onChange={(e) => setDraft({ ...draft, bio: e.target.value })} />
            </div>

            <div className="flex gap-2 justify-end pt-1">
              <Button variant="outline" onClick={() => setDraft(null)} disabled={saveMutation.isPending}>Cancel</Button>
              <Button onClick={() => saveMutation.mutate(draft)} disabled={saveMutation.isPending || !draft.name.trim()}>
                {saveMutation.isPending ? "Saving…" : draft.id ? "Save changes" : "Create team"}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── List ───────────────────────────────────────────────── */}
      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading teams…</p>
      ) : teams.length === 0 && !draft ? (
        <Card><CardContent className="py-10 text-center text-muted-foreground text-sm">
          No teams yet. Create one to skin quotes as a crew and assign team jobs.
        </CardContent></Card>
      ) : (
        <div className="space-y-3">
          {teams.map((t) => (
            <Card key={t.id}>
              <CardContent className="py-4 flex items-start gap-4">
                {t.profileImageUrl
                  ? <img src={t.profileImageUrl} alt="" className="w-12 h-12 rounded-full object-cover shrink-0" />
                  : <span className="w-12 h-12 rounded-full bg-handy-navy/10 flex items-center justify-center shrink-0"><Users className="w-5 h-5 text-handy-navy" /></span>}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-handy-navy">{t.displayName || t.name}</span>
                    <Badge variant="secondary" className="text-[11px]">crew {t.crewSize}</Badge>
                    {!t.isActive && <Badge variant="outline" className="text-[11px]">inactive</Badge>}
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">{t.name}</p>
                  <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                    {t.members.map((m) => (
                      <span key={m.contractorId} className="inline-flex items-center gap-1 text-xs bg-slate-100 rounded-full pl-1 pr-2 py-0.5">
                        {m.profileImageUrl
                          ? <img src={m.profileImageUrl} alt="" className="w-4 h-4 rounded-full object-cover" />
                          : <span className="w-4 h-4 rounded-full bg-slate-300" />}
                        {m.name}
                        {m.role === "lead" && <Crown className="w-3 h-3 text-amber-500" />}
                      </span>
                    ))}
                  </div>
                </div>
                <div className="flex flex-col gap-1.5 shrink-0">
                  <Button size="sm" variant="outline" onClick={() => startEdit(t)}><Pencil className="w-3.5 h-3.5 mr-1" /> Edit</Button>
                  <Button size="sm" variant="ghost" className="text-red-600 hover:text-red-700"
                    onClick={() => { if (confirm(`Deactivate ${t.displayName || t.name}?`)) deactivateMutation.mutate(t.id); }}>
                    <Trash2 className="w-3.5 h-3.5 mr-1" /> Deactivate
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
