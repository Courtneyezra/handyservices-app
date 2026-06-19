import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ReactNode, useState } from "react";
import {
  Loader2, RefreshCw, AlertTriangle, CheckCircle2, MapPin,
  CalendarClock, UserCheck, Inbox, Users, PlayCircle, PoundSterling,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";

interface SweepProposal {
  quoteId: string; customerName: string; categories: string[];
  date: string; slot: "am" | "pm"; contractorId: string; contractorName: string;
  distanceMiles: number | null;
  slackDays: number; flexDeadline: string; valuePence: number;
}
interface PoolJob {
  quoteId: string; customerName: string; categories: string[]; reason: string;
  slackDays: number; flexDeadline: string;
}
interface ProposalGroup {
  groupId: string; contractorId: string; contractorName: string; date: string;
  members: SweepProposal[]; totalValue: number; rationale: string;
}
interface PreviewResult {
  poolSize: number; assigned: SweepProposal[];
  unassignable: PoolJob[]; byReason: Record<string, number>;
  groups: ProposalGroup[];
}

interface DispatchRunResult {
  booked: number;
  failures: { quoteId: string; error: string }[];
}

async function fetchPreview(): Promise<PreviewResult> {
  const token = localStorage.getItem("adminToken");
  const res = await fetch("/api/admin/daily-planner/dispatch-preview", {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
  return res.json();
}

async function runDispatch(quoteIds?: string[]): Promise<DispatchRunResult> {
  const token = localStorage.getItem("adminToken");
  const res = await fetch("/api/admin/daily-planner/dispatch-run", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(quoteIds ? { quoteIds } : {}),
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
  return res.json();
}

function formatPence(pence: number): string {
  return `£${(pence / 100).toFixed(0)}`;
}

/** Tiny urgency badge driven by days of slack until the flex deadline. */
function slackBadge(slackDays: number): ReactNode {
  if (slackDays < 0) {
    return <Badge className="bg-red-600 hover:bg-red-600 text-white whitespace-nowrap">Overdue {Math.abs(slackDays)}d</Badge>;
  }
  if (slackDays <= 2) {
    return <Badge className="bg-red-600 hover:bg-red-600 text-white whitespace-nowrap">{slackDays}d left</Badge>;
  }
  if (slackDays <= 5) {
    return <Badge className="bg-amber-500 hover:bg-amber-500 text-white whitespace-nowrap">{slackDays}d left</Badge>;
  }
  return <Badge variant="secondary" className="text-green-700 whitespace-nowrap">{slackDays}d left</Badge>;
}

export default function DispatchBoardPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data, isFetching, isError, error, refetch } = useQuery({
    queryKey: ["dispatch-preview"],
    queryFn: fetchPreview,
    refetchOnWindowFocus: false,
  });

  const poolSize = data?.poolSize ?? 0;
  const assigned = data?.assigned ?? [];
  const groups = data?.groups ?? [];
  // Most urgent first — lowest slack (incl. overdue negatives) at the top.
  const unassignable = [...(data?.unassignable ?? [])].sort((a, b) => a.slackDays - b.slackDays);
  const byReason = data?.byReason ?? {};

  // Tracks which group's approval is in flight (by groupId) so each card's
  // button disables independently. null = the "Run dispatch (all)" action.
  const [pendingGroupId, setPendingGroupId] = useState<string | null>(null);

  const onRunSuccess = (result: DispatchRunResult) => {
    // invalidateQueries already refetches the active preview query (the now-booked
    // jobs drop out of the pool) — no separate refetch() needed.
    queryClient.invalidateQueries({ queryKey: ["dispatch-preview"] });
    toast({
      title: `Booked ${result.booked} job${result.booked === 1 ? "" : "s"}`,
      description: result.failures.length
        ? `${result.failures.length} could not be booked (slot taken or already booked).`
        : "All selected assignments were written.",
      variant: result.failures.length ? "destructive" : undefined,
    });
  };

  const dispatchRunMutation = useMutation({
    mutationFn: (quoteIds?: string[]) => runDispatch(quoteIds),
    onSuccess: onRunSuccess,
    onError: (err: Error) => {
      toast({ title: "Dispatch failed", description: err.message, variant: "destructive" });
    },
    onSettled: () => setPendingGroupId(null),
  });

  const handleRunDispatch = () => {
    if (assigned.length === 0 || dispatchRunMutation.isPending) return;
    if (!window.confirm(`Book all ${assigned.length} proposed assignment${assigned.length === 1 ? "" : "s"}?`)) return;
    setPendingGroupId(null);
    dispatchRunMutation.mutate(undefined);
  };

  const handleApproveGroup = (group: ProposalGroup) => {
    if (dispatchRunMutation.isPending) return;
    const n = group.members.length;
    if (!window.confirm(`Approve & book ${n} job${n === 1 ? "" : "s"} for ${group.contractorName} on ${group.date}?`)) return;
    setPendingGroupId(group.groupId);
    dispatchRunMutation.mutate(group.members.map((m) => m.quoteId));
  };

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Inbox className="h-6 w-6" /> Dispatch Board
          </h1>
          <p className="text-sm text-muted-foreground">
            Auto-assign the flexible job pool — and see exactly what's blocking the rest.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => refetch()} disabled={isFetching || dispatchRunMutation.isPending}>
            {isFetching ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-2" />}
            Refresh preview
          </Button>
          <Button
            onClick={handleRunDispatch}
            disabled={assigned.length === 0 || isFetching || dispatchRunMutation.isPending}
          >
            {dispatchRunMutation.isPending && pendingGroupId === null
              ? <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              : <PlayCircle className="h-4 w-4 mr-2" />}
            Run dispatch (all){assigned.length > 0 ? ` (${assigned.length})` : ""}
          </Button>
        </div>
      </div>

      {isError && (
        <Card className="border-red-300 bg-red-50">
          <CardContent className="pt-6 text-red-700 flex items-center gap-2">
            <AlertTriangle className="h-5 w-5" /> {(error as Error).message}
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-3 gap-4">
        <Stat label="In pool" value={poolSize} icon={<Inbox className="h-5 w-5 text-slate-500" />} />
        <Stat label="Auto-assignable" value={assigned.length} tone="green" icon={<CheckCircle2 className="h-5 w-5 text-green-600" />} />
        <Stat label="Blocked" value={unassignable.length} tone="amber" icon={<AlertTriangle className="h-5 w-5 text-amber-600" />} />
      </div>

      {/* The punch-list — why jobs can't auto-assign (the actionable view) */}
      <Card>
        <CardHeader><CardTitle className="text-base">What's blocking assignment</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {Object.keys(byReason).length === 0 && (
            <p className="text-sm text-muted-foreground">Nothing blocked — pool is clear.</p>
          )}
          {Object.entries(byReason).sort((a, b) => b[1] - a[1]).map(([reason, n]) => (
            <div key={reason} className="flex items-center justify-between border rounded-lg px-4 py-2.5">
              <span className="text-sm flex items-center gap-2"><ReasonIcon reason={reason} /> {prettyReason(reason)}</span>
              <Badge variant="secondary" className="font-bold whitespace-nowrap">{n} job{n > 1 ? "s" : ""}</Badge>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Co-pilot approval queue — one card per proposed contractor day */}
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <UserCheck className="h-4 w-4 text-green-600" />
          <h2 className="text-base font-semibold">Approval queue</h2>
          <span className="text-xs text-muted-foreground">
            The engine proposes each contractor's day — you approve, it books.
          </span>
        </div>
        {groups.length === 0 ? (
          <Card>
            <CardContent className="pt-6 text-sm text-muted-foreground">
              No groupings proposed yet — clear the blockers above (mostly contractor availability).
            </CardContent>
          </Card>
        ) : (
          groups.map((group) => {
            const n = group.members.length;
            const isPending = dispatchRunMutation.isPending && pendingGroupId === group.groupId;
            return (
              <Card key={group.groupId} className="border-l-4 border-l-green-500">
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <CardTitle className="text-base flex items-center gap-2">
                        <UserCheck className="h-4 w-4 text-green-600 shrink-0" />
                        {group.contractorName}
                        <span className="font-normal text-muted-foreground flex items-center gap-1">
                          <CalendarClock className="h-3.5 w-3.5" /> {group.date}
                        </span>
                      </CardTitle>
                      {group.rationale && (
                        <p className="text-xs text-muted-foreground mt-1">{group.rationale}</p>
                      )}
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      <span className="flex items-center gap-1 text-sm font-semibold text-green-700 whitespace-nowrap">
                        <PoundSterling className="h-3.5 w-3.5" />{formatPence(group.totalValue)}
                      </span>
                      <Button
                        size="sm"
                        onClick={() => handleApproveGroup(group)}
                        disabled={dispatchRunMutation.isPending}
                      >
                        {isPending
                          ? <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                          : <CheckCircle2 className="h-4 w-4 mr-2" />}
                        Approve &amp; book ({n})
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="divide-y">
                    {group.members.map((m) => (
                      <div key={m.quoteId} className="py-2 flex items-center justify-between gap-4 text-sm">
                        <div className="min-w-0">
                          <span className="font-medium">{m.customerName}</span>{" "}
                          <span className="text-muted-foreground">[{m.categories.join(", ")}]</span>
                        </div>
                        <div className="flex items-center gap-3 text-muted-foreground shrink-0">
                          <span className="flex items-center gap-1"><CalendarClock className="h-3.5 w-3.5" /> {m.slot.toUpperCase()}</span>
                          {m.distanceMiles != null && <span className="flex items-center gap-1"><MapPin className="h-3.5 w-3.5" /> {m.distanceMiles}mi</span>}
                          {slackBadge(m.slackDays)}
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            );
          })
        )}
      </div>

      {/* Blocked detail — most urgent (lowest slack) first */}
      {unassignable.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-base">Blocked jobs (detail)</CardTitle></CardHeader>
          <CardContent>
            <div className="divide-y">
              {unassignable.map((u) => (
                <div key={u.quoteId} className="py-2 flex items-center justify-between text-sm gap-4">
                  <div className="min-w-0 flex items-center gap-2">
                    {slackBadge(u.slackDays)}
                    <span className="truncate">
                      <span className="font-medium">{u.customerName}</span>{" "}
                      <span className="text-muted-foreground">[{u.categories.join(", ")}]</span>
                    </span>
                  </div>
                  <span className="text-amber-700 text-xs text-right shrink-0">{u.reason}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <p className="text-xs text-muted-foreground">
        Refresh preview re-runs the dry sweep. Approve &amp; book writes that contractor's day as real
        bookings; Run dispatch (all) books every proposed assignment at once. Lists are ordered by slack
        (days to flex deadline) — red is urgent or overdue. Customer/contractor notifications aren't sent yet.
      </p>
    </div>
  );
}

function Stat({ label, value, icon, tone }: { label: string; value: number; icon: ReactNode; tone?: "green" | "amber" }) {
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm text-muted-foreground">{label}</div>
            <div className={`text-3xl font-bold ${tone === "green" ? "text-green-600" : tone === "amber" ? "text-amber-600" : ""}`}>{value}</div>
          </div>
          {icon}
        </div>
      </CardContent>
    </Card>
  );
}

function ReasonIcon({ reason }: { reason: string }) {
  if (/availab/i.test(reason)) return <CalendarClock className="h-4 w-4 text-amber-600 shrink-0" />;
  if (/radius|location/i.test(reason)) return <MapPin className="h-4 w-4 text-amber-600 shrink-0" />;
  if (/categor|cover/i.test(reason)) return <Users className="h-4 w-4 text-amber-600 shrink-0" />;
  return <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0" />;
}

function prettyReason(reason: string): string {
  if (/no contractors available/i.test(reason)) return "No contractor availability posted → contractors need to add dates";
  if (/within service radius/i.test(reason)) return "Customer outside every qualified contractor's radius → geocode / widen radius";
  if (/cover all/i.test(reason)) return "Multi-skill job — no single contractor covers all categories → split or cross-train";
  return reason;
}
