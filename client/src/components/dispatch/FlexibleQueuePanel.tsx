import { Link } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, useRef, useEffect } from "react";
import {
  Loader2, AlertTriangle, CheckCircle2, UserCheck, Inbox,
  ArrowRight, UserPlus, MapPin, Send, Copy, Check, Clock, PauseCircle,
  Lock, Minus, Plus, RotateCcw,
} from "lucide-react";
import { SLA_DUE_SOON_DAYS } from "@shared/dispatch-sla";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { useDispatchSelection } from "@/components/dispatch/useDispatchSelection";
import { SlaBadge, formatDeadline } from "@/components/dispatch/sla";
import {
  type ActiveSlotOffer, type SlotOffer, type SlotCandidate, offerSlotLabel,
} from "@shared/slot-offer";
import { buildSlotOfferWhatsAppMessage } from "@/lib/whatsapp-slot-offer-message";
import { formatPhoneForDisplay } from "@/lib/whatsapp-helper";
import { JOB_CATEGORIES } from "@shared/contextual-pricing-types";
import { CATEGORY_LABELS } from "@shared/categories";

// ── Types (mirrored from DispatchBoardPage — the dispatch-preview contract) ──
interface SweepProposal {
  quoteId: string; customerName: string; categories: string[];
  date: string; slot: string; slackDays: number;
  flexDeadline?: string;
  uncoveredCategories?: string[];
  // Job-detail fields (optimiser members carry these; surfaced in the job-detail modal).
  valuePence?: number;
  postcode?: string | null;
  address?: string | null;
  jobDescription?: string | null;
  // Real on-site duration + whole days needed (daysNeeded > 1 ⇒ multi-day job).
  workMinutes?: number;
  daysNeeded?: number;
}
interface ProposalGroup {
  groupId: string; contractorId: string; contractorName: string; date: string;
  members: SweepProposal[]; totalValue: number; rationale: string;
  goalScore: number;
  marginPence?: number;
  coversDayRate?: boolean;
  dayRatePence?: number;
  fuelPence?: number;
  revenuePence?: number;
  uncoveredCategories?: string[];
}
// Every outstanding job the optimiser could NOT auto-place — surfaced in the
// worklist with a manual-assign override (no job hides).
interface Unassignable {
  quoteId: string; customerName: string; categories: string[];
  reason: string; slackDays?: number; flexDeadline?: string;
  // Job-detail fields (surfaced in the job-detail modal).
  valuePence?: number;
  postcode?: string | null;
  address?: string | null;
  jobDescription?: string | null;
}
interface ContractorOpt { id: string; name: string; }
interface PreviewResult {
  poolSize: number; assigned: SweepProposal[];
  unassignable: Unassignable[]; byReason: Record<string, number>;
  groups: ProposalGroup[];
}

async function fetchPreview(testOnly?: boolean): Promise<PreviewResult> {
  const token = localStorage.getItem("adminToken");
  const url = testOnly
    ? "/api/admin/daily-planner/dispatch-preview?testOnly=1"
    : "/api/admin/daily-planner/dispatch-preview";
  const res = await fetch(url, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
  return res.json();
}

async function fetchContractors(): Promise<ContractorOpt[]> {
  const token = localStorage.getItem("adminToken");
  const res = await fetch("/api/admin/daily-planner/contractor-rates", {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) return [];
  const j = await res.json();
  return (j.contractors ?? []).map((c: any) => ({ id: c.id, name: c.name }));
}

async function manualAssign(body: { quoteId: string; contractorId: string; date: string; slot: string; testOnly?: boolean }) {
  const token = localStorage.getItem("adminToken");
  const res = await fetch("/api/admin/daily-planner/assign", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
  return res.json();
}

// ── Customer slot-offer flow ──
// Instead of booking a contractor on approval, the dispatcher SENDS the customer a link of
// dispatch-approved dates; the customer self-selects (paying a premium for any non-recommended
// date) and only then is a contractor assigned. These three helpers drive that handoff.
interface SlotOfferRecommended {
  date: string; slot: "am" | "pm"; contractorId: string; contractorName: string;
}
interface SlotOfferSendResult {
  token: string; link: string; candidates: SlotCandidate[]; phone: string | null; email: string | null;
}
async function sendSlotOffer(body: { quoteId: string; recommended: SlotOfferRecommended }): Promise<SlotOfferSendResult> {
  const token = localStorage.getItem("adminToken");
  const res = await fetch("/api/admin/daily-planner/slot-offer/send", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
  return res.json();
}

async function fetchSlotOffers(): Promise<ActiveSlotOffer[]> {
  const token = localStorage.getItem("adminToken");
  const res = await fetch("/api/admin/daily-planner/slot-offers", {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
  const j = await res.json();
  return j.offers ?? [];
}

async function abandonSlotOffer(quoteId: string): Promise<{ ok: true }> {
  const token = localStorage.getItem("adminToken");
  const res = await fetch("/api/admin/daily-planner/slot-offer/abandon", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ quoteId }),
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
  return res.json();
}

// Copy text to the clipboard, with a legacy <textarea>+execCommand fallback for browsers /
// non-secure contexts where the async Clipboard API is unavailable. Returns whether it stuck —
// callers surface real success/failure instead of pretending it always worked (this drives
// manual WhatsApp sends, so a silent failure would have Ben pasting nothing).
async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through to the legacy path below */
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

// One editable schedule line on a quote — its description plus the minutes the optimiser
// budgets for it. The job's total on-site time is just the Σ of these (read-only badge).
interface QuoteLine {
  lineId: string;
  description: string;
  category?: string | null;
  scheduleMinutes: number;
}

// Fetch the per-line schedule breakdown for a quote (description + editable minutes per line).
async function fetchQuoteLines(quoteId: string): Promise<QuoteLine[]> {
  const token = localStorage.getItem("adminToken");
  const res = await fetch(`/api/admin/daily-planner/quote/${quoteId}/lines`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
  const j = await res.json();
  return j.lines ?? [];
}

// Override ONE line's on-site TIME (decoupled from the locked price). Re-flows the job's
// Σ workMinutes + daysNeeded into the next preview; returns the new job total.
async function setLineMinutes(
  quoteId: string, lineId: string, scheduleMinutes: number,
): Promise<{ ok: true; totalWorkMinutes: number }> {
  const token = localStorage.getItem("adminToken");
  const res = await fetch(`/api/admin/daily-planner/quote/${quoteId}/line/${lineId}/minutes`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ scheduleMinutes }),
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
  return res.json();
}

// Re-classify ONE line's trade/category. The job's required skills are the distinct set of
// its line categories, so fixing a mis-tagged line re-matches the pool to qualified
// contractors on the next preview. Price stays locked; only routing changes.
async function setLineCategory(
  quoteId: string, lineId: string, category: string,
): Promise<{ ok: true; categories: string[] }> {
  const token = localStorage.getItem("adminToken");
  const res = await fetch(`/api/admin/daily-planner/quote/${quoteId}/line/${lineId}/category`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ category }),
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
  return res.json();
}

function formatPence(pence: number): string {
  return `£${(pence / 100).toFixed(0)}`;
}

// On-site work minutes → compact hours: "≈9h" / "≈8.8h" (drops a trailing .0).
function formatHours(minutes: number): string {
  const h = minutes / 60;
  return `≈${h % 1 === 0 ? h : h.toFixed(1)}h`;
}

// Signed £ for margin: "+£42" / "−£8" (true minus sign U+2212 to match design).
function formatMargin(pence: number): string {
  const sign = pence < 0 ? "−" : "+";
  return `${sign}£${(Math.abs(pence) / 100).toFixed(0)}`;
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
// "2026-06-18" → "Thu 18 Jun" (parsed as UTC to avoid timezone drift).
function formatDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return `${WEEKDAYS[dt.getUTCDay()]} ${d} ${MONTHS[m - 1]}`;
}
function tomorrowISO(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}
// One offered candidate as a compact label: "Tue 23 Jun AM" (no weekday-less drift).
function candidateLabel(c: SlotCandidate): string {
  return `${formatDate(c.date)} ${offerSlotLabel(c.slot)}`;
}
// snake_case category → "Title Case".
function prettyCat(c: string): string {
  return c.split("_").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}
// Distinct, prettified job categories across a bundle ("Painting, Flat Pack +1").
function formatSkills(members: SweepProposal[]): string {
  const cats = [...new Set(members.flatMap((m) => m.categories))];
  const pretty = cats.slice(0, 3).map(prettyCat);
  return pretty.join(", ") + (cats.length > 3 ? ` +${cats.length - 3}` : "");
}
// Distinct uncovered categories for a bundle (empty array → no flag).
function bundleUncovered(group: ProposalGroup): string[] {
  const all = [
    ...(group.uncoveredCategories ?? []),
    ...group.members.flatMap((m) => m.uncoveredCategories ?? []),
  ];
  return [...new Set(all)];
}

/**
/**
 * "Hold vs Send now" — the slack-governor recommendation for WHEN to fire a bundle's
 * offer. While a job sits un-sent the optimiser keeps re-pairing it, so holding is free
 * upside UNTIL the SLA clock or a full/already-good day says stop:
 *   - tight slack (≤ due-soon)              → SEND  (don't gamble batching against a breach)
 *   - already a full/multi-day run          → SEND  (no room to pair — book it)
 *   - comfortable slack + solo/loss + ROOM  → HOLD  (a smaller job could still share the day)
 *   - dense + profitable + on track         → SEND  (no upside left — bank the confirmation)
 * Advisory only — the dispatcher can always override.
 */
function fireSignal(group: ProposalGroup): { hold: boolean; reason: string } {
  // A bundle within this of a full day (480min) has no room to pair another job → send it.
  const DAY_NEARLY_FULL_MIN = 420;
  const minSlack = group.members.reduce((m, x) => Math.min(m, x.slackDays ?? Infinity), Infinity);
  const totalMin = group.members.reduce((s, x) => s + (x.workMinutes ?? 0), 0);
  const isLoss = group.coversDayRate === false;
  const isSolo = group.members.length === 1;
  const multiDay = group.members.some((x) => typeof x.daysNeeded === "number" && x.daysNeeded > 1);
  const hasRoomToPair = totalMin > 0 && totalMin < DAY_NEARLY_FULL_MIN;
  if (minSlack <= SLA_DUE_SOON_DAYS) return { hold: false, reason: "slack low" };
  if (multiDay) return { hold: false, reason: "needs its own days" };
  // Only worth holding if the day still has room for another job to pair in.
  if (hasRoomToPair && isLoss) return { hold: true, reason: "wait for a denser day" };
  if (hasRoomToPair && isSolo) return { hold: true, reason: "could pair up if held" };
  return { hold: false, reason: totalMin >= DAY_NEARLY_FULL_MIN ? "full day" : "dense & on track" };
}

const WORK_STEP_MIN = 15; // stepper granularity (¼ hour)
const WORK_MIN_FLOOR = 15; // never below 15 min of on-site time

/**
 * Editable on-site TIME control — a compact −/+ stepper (step 15 min, min 15) used per
 * schedule line. Committing persists that line's minutes and re-optimises the job
 * (daysNeeded/grouping) without touching the locked price. Shows a subtle "edited" state
 * when the draft differs from the line's last-saved minutes, with a one-tap reset back to it.
 *
 * Local state is seeded from the `minutes` prop and re-syncs whenever it changes (the
 * line refetch / 45s preview refetch) while no commit is in flight, so background updates
 * flow in without clobbering an in-progress edit; the POST is debounced so rapid clicks fire once.
 */
function WorkMinutesStepper({
  minutes, originalMinutes, onEdit,
}: {
  minutes: number;
  originalMinutes: number;
  onEdit: (minutes: number) => void;
}) {
  const [draft, setDraft] = useState(minutes);
  // Re-sync to the server value when it changes (re-optimise / refetch) and no commit is in flight.
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (timer.current == null) setDraft(minutes);
  }, [minutes]);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const commit = (next: number) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = null;
      onEdit(next);
    }, 350);
  };
  const bump = (deltaMin: number) => {
    const next = Math.max(WORK_MIN_FLOOR, draft + deltaMin);
    if (next === draft) return;
    setDraft(next);
    commit(next);
  };
  const reset = () => {
    if (draft === originalMinutes) return;
    setDraft(originalMinutes);
    commit(originalMinutes);
  };
  const isEdited = draft !== originalMinutes;

  return (
    <span
      className={cn(
        "inline-flex items-center gap-0.5 rounded-md border px-0.5 py-0.5",
        isEdited ? "border-sky-400 bg-sky-50 dark:bg-sky-950/40" : "border-border bg-muted",
      )}
      title="Edit on-site time — re-optimises the schedule (price stays locked)"
    >
      <button
        type="button"
        aria-label="Reduce on-site time 15 min"
        className="grid h-5 w-5 place-items-center rounded text-muted-foreground hover:bg-background hover:text-foreground disabled:opacity-30"
        disabled={draft <= WORK_MIN_FLOOR}
        onClick={(e) => { e.stopPropagation(); bump(-WORK_STEP_MIN); }}
      >
        <Minus className="h-3 w-3" />
      </button>
      <span className={cn("min-w-[2.75rem] text-center text-[11px] font-semibold tabular-nums", isEdited && "text-sky-700 dark:text-sky-300")}>
        {formatHours(draft)}
      </span>
      <button
        type="button"
        aria-label="Add on-site time 15 min"
        className="grid h-5 w-5 place-items-center rounded text-muted-foreground hover:bg-background hover:text-foreground"
        onClick={(e) => { e.stopPropagation(); bump(WORK_STEP_MIN); }}
      >
        <Plus className="h-3 w-3" />
      </button>
      {isEdited && (
        <button
          type="button"
          aria-label="Reset on-site time to saved value"
          title="Reset to saved value"
          className="grid h-5 w-5 place-items-center rounded text-sky-600 hover:bg-background dark:text-sky-300"
          onClick={(e) => { e.stopPropagation(); reset(); }}
        >
          <RotateCcw className="h-3 w-3" />
        </button>
      )}
    </span>
  );
}

/**
 * One job's facts — customer, optional slot, price, address, categories, full
 * description, and any uncovered-category flag. Shared by the bundle modal (one per
 * member) and the unassigned-job modal (single), so the two render identically.
 *
 * When `editable && quoteId`, it also fetches the job's schedule LINES and renders a
 * per-line on-site-time editor (one stepper per line). Editing a line persists that
 * line's minutes and re-optimises the whole preview; the aggregate ≈Xh badge stays
 * read-only (it's the Σ, which re-flows from the optimiser after the re-optimise).
 */
function JobFacts({
  customerName, slot, valuePence, address, postcode, categories, jobDescription, uncoveredCategories,
  slackDays, deadline, workMinutes, daysNeeded, quoteId, editable = false,
}: {
  customerName: string;
  slot?: string;
  valuePence?: number | null;
  address?: string | null;
  postcode?: string | null;
  categories: string[];
  jobDescription?: string | null;
  uncoveredCategories?: string[];
  slackDays?: number | null;
  deadline?: string | null;
  workMinutes?: number | null;
  daysNeeded?: number | null;
  quoteId?: string;
  // When true (and quoteId is set) the job's schedule lines become individually editable.
  editable?: boolean;
}) {
  const cats = [...new Set(categories)].map(prettyCat).join(", ");
  const uncovered = uncoveredCategories ?? [];
  const queryClient = useQueryClient();
  const { toast } = useToast();

  // Per-line schedule breakdown — only fetched in the editable (bundle-modal) usage.
  const canEditLines = editable && !!quoteId;
  const { data: lines = [], isLoading: linesLoading } = useQuery({
    queryKey: ["job-lines", quoteId],
    queryFn: () => fetchQuoteLines(quoteId!),
    enabled: canEditLines,
    refetchOnWindowFocus: false,
  });

  // Persist ONE line's minutes, then re-optimise (workMinutes/daysNeeded/grouping reflow)
  // and refresh this job's lines so the stepper re-syncs to the saved value.
  const editLineMutation = useMutation({
    mutationFn: ({ lineId, scheduleMinutes }: { lineId: string; scheduleMinutes: number }) =>
      setLineMinutes(quoteId!, lineId, scheduleMinutes),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["dispatch-preview"] });
      queryClient.invalidateQueries({ queryKey: ["job-lines", quoteId] });
    },
    onError: (err: Error) => toast({ title: "Couldn't update time", description: err.message, variant: "destructive" }),
  });

  // Re-classify a line's trade. Re-matches the pool to qualified contractors on the next
  // preview (a mis-tagged line can otherwise strand a job on a skill nobody covers).
  const editCategoryMutation = useMutation({
    mutationFn: ({ lineId, category }: { lineId: string; category: string }) =>
      setLineCategory(quoteId!, lineId, category),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["dispatch-preview"] });
      queryClient.invalidateQueries({ queryKey: ["job-lines", quoteId] });
    },
    onError: (err: Error) => toast({ title: "Couldn't update category", description: err.message, variant: "destructive" }),
  });
  const reoptimising = editLineMutation.isPending || editCategoryMutation.isPending;

  // Total + days reflect the LIVE per-line sum once lines load, so a line edit updates the
  // badge and the "~N days" flag (after its save) — not the stale proposal value. Falls back
  // to the proposal's workMinutes/daysNeeded when lines aren't loaded (non-editable usage).
  const liveTotalMin = canEditLines && lines.length > 0
    ? lines.reduce((s, l) => s + (Number(l.scheduleMinutes) || 0), 0)
    : null;
  const effWorkMinutes = liveTotalMin ?? workMinutes;
  const effDaysNeeded = liveTotalMin != null ? Math.max(1, Math.round(liveTotalMin / 480)) : daysNeeded;
  const multiDay = typeof effDaysNeeded === "number" && effDaysNeeded > 1;

  return (
    <div className="rounded-md border border-border p-3">
      <div className="flex items-baseline justify-between gap-2">
        <span className="truncate text-sm font-semibold">{customerName}</span>
        <div className="flex items-center gap-2 whitespace-nowrap">
          {typeof effWorkMinutes === "number" && (
            <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">{formatHours(effWorkMinutes)}</span>
          )}
          {slot && <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide">{slot}</span>}
          {valuePence != null && (
            <span className="inline-flex items-center gap-1 text-sm font-semibold" title="Price locked — accepted, deposit-paid quote">
              <Lock className="h-3 w-3 text-muted-foreground" />
              {formatPence(valuePence)}
            </span>
          )}
        </div>
      </div>
      {/* Multi-day jobs can't fit one contractor-day — flag, don't pretend. */}
      {multiDay && (
        <div className="mt-1.5 inline-flex items-center gap-1 rounded-full bg-red-100 px-1.5 py-0.5 text-[10px] font-semibold text-red-700 dark:bg-red-950/60 dark:text-red-300">
          <AlertTriangle className="h-2.5 w-2.5 shrink-0" />
          ~{effDaysNeeded} days — schedule separately
        </div>
      )}
      {/* How long before the 7-day promise — the window to give a date + book. */}
      {(typeof slackDays === "number" || deadline) && (
        <div className="mt-1.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <Clock className="h-3 w-3 shrink-0" />
          {deadline && <span>Book by {formatDeadline(deadline)}</span>}
          {typeof slackDays === "number" && <SlaBadge slackDays={slackDays} />}
        </div>
      )}
      {(address || postcode) && (
        <p className="mt-1 flex items-start gap-1 text-xs text-muted-foreground">
          <MapPin className="mt-0.5 h-3 w-3 shrink-0" />
          <span>{address || postcode}</span>
        </p>
      )}
      {cats && <p className="mt-1.5 text-[11px] font-medium text-muted-foreground">{cats}</p>}
      {jobDescription && (
        <p className="mt-1.5 whitespace-pre-wrap text-xs leading-relaxed text-foreground/90">{jobDescription}</p>
      )}
      {/* Per-line on-site-time editor — each line gets its own stepper; the job total
          above is the read-only Σ that re-flows after a line edit re-optimises. */}
      {canEditLines && (
        <div className="mt-2.5 space-y-1.5 border-t border-border pt-2">
          <div className="flex items-center justify-between gap-2">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Per line — trade &amp; on-site time</p>
            {reoptimising && (
              <span className="inline-flex items-center gap-1 text-[10px] font-medium text-sky-600">
                <Loader2 className="h-2.5 w-2.5 animate-spin" /> Re-optimising…
              </span>
            )}
          </div>
          {linesLoading ? (
            <div className="flex items-center gap-1.5 py-1 text-[11px] text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" /> Loading lines…
            </div>
          ) : lines.length === 0 ? (
            <p className="py-0.5 text-[11px] text-muted-foreground">No schedule lines.</p>
          ) : (
            lines.map((line) => (
              <div key={line.lineId} className="space-y-1">
                <span className="block truncate text-xs text-foreground/90" title={line.description}>
                  {line.description}
                </span>
                <div className="flex items-center justify-between gap-2">
                  <Select
                    value={(line.category ?? "other") as string}
                    onValueChange={(category) => editCategoryMutation.mutate({ lineId: line.lineId, category })}
                  >
                    <SelectTrigger
                      className="h-7 w-[160px] text-[11px]"
                      title="Trade/skill this line needs — re-matches the pool to qualified contractors (price stays locked)"
                      aria-label={`Trade for ${line.description}`}
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {JOB_CATEGORIES.map((slug) => (
                        <SelectItem key={slug} value={slug} className="text-xs">
                          {CATEGORY_LABELS[slug] ?? slug}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <WorkMinutesStepper
                    minutes={line.scheduleMinutes}
                    originalMinutes={line.scheduleMinutes}
                    onEdit={(scheduleMinutes) => editLineMutation.mutate({ lineId: line.lineId, scheduleMinutes })}
                  />
                </div>
              </div>
            ))
          )}
        </div>
      )}
      {uncovered.length > 0 && (
        <span className="mt-1.5 inline-flex items-center gap-1 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-800 dark:bg-amber-950/60 dark:text-amber-300">
          <AlertTriangle className="h-2.5 w-2.5 shrink-0" />
          {uncovered.map(prettyCat).join(", ")} — needs 2nd trade
        </span>
      )}
    </div>
  );
}

/**
 * Job-detail modal — opened by clicking a proposal CARD body. Shows what the run
 * actually IS: the contractor-day's margin breakdown, then each job's customer,
 * address, slot, price, categories, and full description. Read + Send only; the
 * "Send options" here offers each member's slot to its customer (same write-path
 * as the card button) — the customer self-selects before any contractor is booked.
 */
function JobDetailModal({
  group, onClose, onSend, isSending,
}: {
  group: ProposalGroup | null;
  onClose: () => void;
  onSend: (g: ProposalGroup) => void;
  isSending: boolean;
}) {
  const isLoss = group?.coversDayRate === false;
  const n = group?.members.length ?? 0;
  // How many members are scheduled past their 7-day promise (one summary line, not per-member).
  const lateCount = group?.members.filter((m) => m.flexDeadline && m.date > m.flexDeadline).length ?? 0;
  return (
    <Dialog open={group != null} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-lg">
        {group && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-baseline justify-between gap-2 pr-6">
                <span className="truncate">{group.contractorName}</span>
                <span className="text-xs font-normal text-muted-foreground whitespace-nowrap">{formatDate(group.date)}</span>
              </DialogTitle>
              <DialogDescription>
                {n} job{n === 1 ? "" : "s"} on this run — review before sending date options.
              </DialogDescription>
            </DialogHeader>

            {/* Economics hero — the day's true margin breakdown */}
            <div className={cn(
              "rounded-lg border p-3",
              isLoss ? "border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950/30"
                     : "border-green-200 bg-green-50 dark:border-green-900 dark:bg-green-950/30",
            )}>
              {group.marginPence != null ? (
                <>
                  <div className="flex items-baseline gap-2">
                    <span className={cn("text-2xl font-bold leading-none", isLoss ? "text-red-600" : "text-green-600")}>
                      {formatMargin(group.marginPence)}
                    </span>
                    <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                      {isLoss ? "loss on the day" : "day margin"}
                    </span>
                  </div>
                  <p className="mt-1.5 text-xs text-muted-foreground">
                    {formatPence(group.revenuePence ?? group.totalValue)} revenue − {formatPence(group.dayRatePence ?? 0)} day rate − {formatPence(group.fuelPence ?? 0)} vehicle
                    {group.routeMiles != null ? ` · ${group.routeMiles.toFixed(1)}mi route` : ""}
                  </p>
                </>
              ) : (
                <div className="flex items-baseline gap-2">
                  <span className="text-2xl font-bold leading-none text-green-700">{formatPence(group.totalValue)}</span>
                  <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">total value</span>
                </div>
              )}
            </div>

            {lateCount > 0 && (
              <div className="flex items-center gap-1.5 text-xs font-semibold text-red-600 dark:text-red-400">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                {lateCount} job{lateCount === 1 ? "" : "s"} past the 7-day promise
              </div>
            )}

            {/* Per-job detail (each job in the bundle) */}
            <ScrollArea className="-mr-3 max-h-[44vh] pr-3">
              <div className="space-y-2.5">
                {group.members.map((m) => (
                  <JobFacts
                    key={m.quoteId}
                    customerName={m.customerName}
                    slot={m.slot}
                    valuePence={m.valuePence}
                    address={m.address}
                    postcode={m.postcode}
                    categories={m.categories}
                    jobDescription={m.jobDescription}
                    uncoveredCategories={m.uncoveredCategories}
                    slackDays={m.slackDays}
                    deadline={m.flexDeadline}
                    workMinutes={m.workMinutes}
                    daysNeeded={m.daysNeeded}
                    quoteId={m.quoteId}
                    editable
                  />
                ))}
              </div>
            </ScrollArea>

            <DialogFooter className="gap-2 sm:gap-2">
              <Button variant="ghost" size="sm" className="h-8 px-3 text-xs" onClick={onClose} disabled={isSending}>
                Close
              </Button>
              <Button size="sm" className="h-8 px-3 text-xs" onClick={() => onSend(group)} disabled={isSending}>
                {isSending ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Send className="h-3.5 w-3.5 mr-1" />}
                Send options ({n})
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

// One just-sent slot offer, ready for the dispatcher to paste into the customer's WhatsApp.
interface SentMessage {
  quoteId: string;
  customerName: string;
  phone: string | null;
  message: string;
}

/**
 * One customer's just-sent message row: who + their WhatsApp number, the full message text
 * (selectable for a manual fallback), and a Copy button that confirms with "Copied!". The
 * copied state is per-row so the dispatcher can track which of a multi-job bundle they've
 * already pasted + sent.
 */
function SentMessageRow({ message }: { message: SentMessage }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    const ok = await copyToClipboard(message.message);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  };
  return (
    <div className={cn("rounded-lg border p-3", copied ? "border-green-300 bg-green-50/50 dark:border-green-900 dark:bg-green-950/20" : "border-border")}>
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{message.customerName}</p>
          {message.phone && (
            <p className="text-[11px] text-muted-foreground">{formatPhoneForDisplay(message.phone)}</p>
          )}
        </div>
        <Button
          size="sm"
          variant="outline"
          className={cn("h-7 shrink-0 px-2.5 text-xs", copied && "border-green-500 text-green-700 dark:text-green-400")}
          onClick={copy}
        >
          {copied
            ? <><Check className="h-3.5 w-3.5 mr-1" /> Copied!</>
            : <><Copy className="h-3.5 w-3.5 mr-1" /> Copy message</>}
        </Button>
      </div>
      <div className="mt-2 max-h-40 overflow-y-auto whitespace-pre-wrap rounded-md bg-muted/50 p-2 text-[11px] leading-relaxed text-foreground/90 select-text">
        {message.message}
      </div>
    </div>
  );
}

/**
 * "Messages to send" dialog — opens after a bundle's offers are sent. Because one
 * contractor-bundle can carry MULTIPLE jobs (one per customer), each customer needs their
 * OWN WhatsApp message (their name, dates and confirm link). This lists every just-sent
 * message with a per-customer Copy button + phone number, so the dispatcher works through
 * them one-by-one into WhatsApp — nothing relies on hunting the "Awaiting customer" list.
 */
function SentMessagesDialog({
  messages, onClose,
}: {
  messages: SentMessage[] | null;
  onClose: () => void;
}) {
  const open = messages != null && messages.length > 0;
  const n = messages?.length ?? 0;
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-lg">
        {messages && (
          <>
            <DialogHeader>
              <DialogTitle>Send {n} message{n === 1 ? "" : "s"} on WhatsApp</DialogTitle>
              <DialogDescription>
                {n === 1
                  ? "Copy the message and paste it into the customer's WhatsApp chat."
                  : "One message per customer — copy each and paste it into that customer's WhatsApp chat."}
              </DialogDescription>
            </DialogHeader>
            <ScrollArea className="-mr-3 max-h-[60vh] pr-3">
              <div className="space-y-2.5">
                {messages.map((m) => (
                  <SentMessageRow key={m.quoteId} message={m} />
                ))}
              </div>
            </ScrollArea>
            <DialogFooter>
              <Button size="sm" className="h-8 px-3 text-xs" onClick={onClose}>Done</Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

/**
 * Job-detail modal for an UNASSIGNED job — opened by clicking a "Needs assigning"
 * card body. No contractor / margin / slot (it isn't placed yet); instead it shows
 * the blocking reason up top, then the job facts (customer, address, price, full
 * description), and an "Assign manually" action that hands off to the inline form.
 */
function UnassignedJobModal({
  job, onClose, onAssign,
}: {
  job: Unassignable | null;
  onClose: () => void;
  onAssign: (quoteId: string) => void;
}) {
  return (
    <Dialog open={job != null} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-lg">
        {job && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-baseline justify-between gap-2 pr-6">
                <span>Job detail</span>
                {typeof job.slackDays === "number" && (
                  <span className={cn(
                    "text-xs font-normal whitespace-nowrap",
                    job.slackDays <= 0 ? "font-semibold text-red-600" : job.slackDays <= 2 ? "text-amber-600" : "text-muted-foreground",
                  )}>
                    {job.slackDays < 0 ? `${-job.slackDays}d overdue` : `${job.slackDays}d left`}
                  </span>
                )}
              </DialogTitle>
              <DialogDescription>Outstanding flexible job — review and assign.</DialogDescription>
            </DialogHeader>

            {/* Why the optimiser couldn't auto-place it */}
            <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{job.reason}</span>
            </div>

            {/* The 7-day promise — e.g. "2d overdue · by 24 Jun" */}
            <SlaBadge slackDays={job.slackDays} deadline={job.flexDeadline} showDeadline />

            <JobFacts
              customerName={job.customerName}
              valuePence={job.valuePence}
              address={job.address}
              postcode={job.postcode}
              categories={job.categories}
              jobDescription={job.jobDescription}
              quoteId={job.quoteId}
              editable
            />

            <DialogFooter className="gap-2 sm:gap-2">
              <Button variant="ghost" size="sm" className="h-8 px-3 text-xs" onClick={onClose}>Close</Button>
              <Button size="sm" className="h-8 px-3 text-xs" onClick={() => onAssign(job.quoteId)}>
                <UserPlus className="h-3.5 w-3.5 mr-1" /> Assign manually
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

/**
 * "Awaiting customer" card — a job whose date options have been SENT to the customer and
 * is now held out of the dispatch pool until they pick (or decline). The SLA clock keeps
 * running while we wait, so it carries the same SlaBadge as the worklist. Two actions:
 * copy the ready-to-send WhatsApp message (greeting + dates + confirm link, to paste into
 * WhatsApp manually) and abandon (return the job to the pool).
 */
function AwaitingCustomerCard({
  offer, onCopyMessage, onAbandon, isAbandoning,
}: {
  offer: ActiveSlotOffer;
  onCopyMessage: (o: ActiveSlotOffer) => Promise<boolean>;
  onAbandon: (o: ActiveSlotOffer) => void;
  isAbandoning: boolean;
}) {
  const o: SlotOffer = offer.offer;
  const declined = o.status === "declined_all";
  const n = o.candidates.length;
  // Brief "Copied!" confirmation on the button after a successful copy.
  const [copied, setCopied] = useState(false);
  const handleCopy = async () => {
    const ok = await onCopyMessage(offer);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  };
  return (
    <Card className={cn("border-l-4", declined ? "border-l-red-500" : "border-l-sky-400")}>
      <CardContent className="p-2.5 space-y-1.5">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-sm font-semibold truncate">{offer.customerName}</span>
          <SlaBadge slackDays={offer.slackDays} deadline={offer.flexDeadline} />
        </div>
        {declined ? (
          <p className="flex items-center gap-1 text-[11px] font-semibold text-red-600 dark:text-red-400">
            <AlertTriangle className="h-3 w-3 shrink-0" /> Customer declined — offer new dates
          </p>
        ) : (
          <p className="flex items-center gap-1 text-[11px] text-muted-foreground">
            <Clock className="h-3 w-3 shrink-0" /> Awaiting customer · {n} date{n === 1 ? "" : "s"} offered
          </p>
        )}
        {/* The offered candidates — recommended one starred, premium picks show the top-up */}
        <ul className="space-y-0.5">
          {o.candidates.map((c, i) => (
            <li key={`${c.date}-${c.slot}-${i}`} className="flex items-center justify-between gap-2 text-[11px]">
              <span className="truncate">
                {c.recommended && <span className="mr-0.5 text-amber-500" aria-label="recommended">★</span>}
                {candidateLabel(c)}
              </span>
              <span className={cn("font-medium whitespace-nowrap", c.premiumPence > 0 ? "text-foreground" : "text-green-700 dark:text-green-400")}>
                {c.premiumPence > 0 ? `+${formatPence(c.premiumPence)}` : "free"}
              </span>
            </li>
          ))}
        </ul>
        <div className="flex gap-1.5 pt-0.5">
          <Button
            variant="outline"
            size="sm"
            className={cn("h-7 flex-1 px-2.5 text-xs", copied && "border-green-500 text-green-700 dark:text-green-400")}
            onClick={handleCopy}
            title="Copy the full WhatsApp message (dates + confirm link) to paste to the customer"
          >
            {copied
              ? <><Check className="h-3.5 w-3.5 mr-1" /> Copied!</>
              : <><Copy className="h-3.5 w-3.5 mr-1" /> Copy message</>}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs text-red-600 hover:text-red-700 dark:text-red-400"
            disabled={isAbandoning}
            onClick={() => onAbandon(offer)}
          >
            {isAbandoning ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : null}
            Abandon
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * Flexible-job WORKLIST. Shows every outstanding job, not just the auto-placeable
 * ones: "ready" bundles (one-click approve) PLUS a "needs assigning" list where the
 * dispatcher manually assigns the jobs the optimiser couldn't — so nothing hides.
 * Shares the ["dispatch-preview"] cache key with the Board so they stay in sync.
 */
export default function FlexibleQueuePanel({ testOnly = false }: { testOnly?: boolean } = {}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { hoveredGroupId, setHoveredGroupId, selectedContractorId, setModalContractorId } =
    useDispatchSelection();
  const { data, isFetching, isError, error } = useQuery({
    queryKey: ["dispatch-preview", { testOnly }],
    queryFn: () => fetchPreview(testOnly),
    refetchOnWindowFocus: false,
    // Continuously re-optimise: every refetch re-runs the FULL optimiser over the current
    // pool, so new paid jobs + availability changes flow into the proposals without a
    // manual reload. Safe for the dispatcher — sent offers are soft-held and won't shift.
    refetchInterval: 45000,
  });

  const poolSize = data?.poolSize ?? 0;
  const assigned = data?.assigned ?? [];
  const groups = data?.groups ?? [];
  // Tightest-deadline-first: ascending by slack (most overdue / soonest first),
  // jobs with no slack sink to the bottom — so the fires sit at the top of the list.
  const unassignable = [...(data?.unassignable ?? [])].sort((a, b) => {
    const sa = typeof a.slackDays === "number" ? a.slackDays : Infinity;
    const sb = typeof b.slackDays === "number" ? b.slackDays : Infinity;
    return sa - sb;
  });

  const { data: contractors = [] } = useQuery({
    queryKey: ["dispatch-contractors"],
    queryFn: fetchContractors,
    refetchOnWindowFocus: false,
  });

  // Jobs whose date options have been sent to the customer (held out of the pool until
  // they pick or decline). Polled so a customer's pick/decline surfaces without a refresh.
  const { data: slotOffers = [] } = useQuery({
    queryKey: ["slot-offers"],
    queryFn: fetchSlotOffers,
    refetchOnWindowFocus: false,
    refetchInterval: 30000,
  });

  // Tracks which group's send is in flight (by groupId) so each card's
  // button disables independently. Mirrors DispatchBoardPage.
  const [pendingGroupId, setPendingGroupId] = useState<string | null>(null);
  // The offer whose abandon is in flight (by quoteId), so only its button shows a spinner.
  const [abandoningQuoteId, setAbandoningQuoteId] = useState<string | null>(null);
  // The blocked job currently being manually assigned (inline form), or null.
  const [assignDraft, setAssignDraft] = useState<
    { quoteId: string; contractorId: string; date: string; slot: "am" | "pm" } | null
  >(null);
  // The bundle whose job-detail modal is open (card-body click), or null.
  const [detailGroup, setDetailGroup] = useState<ProposalGroup | null>(null);
  // The unassigned job whose detail modal is open (needs-assigning card click), or null.
  const [detailJob, setDetailJob] = useState<Unassignable | null>(null);
  // Messages from the most recent send — one per customer in the bundle — shown in the
  // "Messages to send" dialog so each can be copied + pasted to WhatsApp individually.
  const [sentMessages, setSentMessages] = useState<SentMessage[] | null>(null);

  // Re-derive the open bundle from the LIVE preview each render (by groupId), so the modal —
  // margin, revenue, days, members — reflects re-optimisation (e.g. after a per-line time
  // edit). Falls back to the captured group if the optimiser re-bundled it away (no blank).
  const liveDetailGroup = detailGroup
    ? (groups.find((g) => g.groupId === detailGroup.groupId) ?? detailGroup)
    : null;

  // Send date options to every customer in a bundle. A bundle is ONE contractor but can carry
  // MULTIPLE jobs — each a separate customer — so we POST one offer per member (its own slot,
  // the bundle's contractor as the recommended pick). On success the jobs leave the dispatch
  // pool (now awaiting-customer) and we build a ready-to-send WhatsApp message PER customer,
  // surfaced in the "Messages to send" dialog so each can be copied + pasted individually.
  const sendOffersMutation = useMutation({
    mutationFn: (group: ProposalGroup) =>
      Promise.all(
        group.members.map(async (m) => {
          const result = await sendSlotOffer({
            quoteId: m.quoteId,
            recommended: {
              date: m.date,
              slot: m.slot as "am" | "pm",
              contractorId: group.contractorId,
              contractorName: group.contractorName,
            },
          });
          return { result, customerName: m.customerName, quoteId: m.quoteId };
        }),
      ),
    onSuccess: (sent) => {
      queryClient.invalidateQueries({ queryKey: ["dispatch-preview"] });
      queryClient.invalidateQueries({ queryKey: ["slot-offers"] });
      setDetailGroup(null);
      // One WhatsApp message per customer in the bundle → the "Messages to send" dialog.
      // Build the confirm link from the dispatcher's CURRENT origin (not the server's
      // BASE_URL): in dev the app runs on a harness-assigned port, and BASE_URL's default
      // (localhost:5000) is both the wrong port and macOS AirPlay. location.origin always
      // matches the reachable app (and the real domain in production).
      setSentMessages(
        sent.map((s) => ({
          quoteId: s.quoteId,
          customerName: s.customerName,
          phone: s.result.phone,
          message: buildSlotOfferWhatsAppMessage({
            customerName: s.customerName,
            candidates: s.result.candidates,
            confirmUrl: `${location.origin}/confirm-slot/${s.result.token}`,
          }),
        })),
      );
    },
    onError: (err: Error) => {
      toast({ title: "Send failed", description: err.message, variant: "destructive" });
    },
    onSettled: () => setPendingGroupId(null),
  });

  // Abandon an active offer — returns the job to the dispatch pool (and frees its soft-held slots).
  const abandonOfferMutation = useMutation({
    mutationFn: (quoteId: string) => abandonSlotOffer(quoteId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["slot-offers"] });
      queryClient.invalidateQueries({ queryKey: ["dispatch-preview"] });
      toast({ title: "Offer abandoned", description: "Job returned to the pool." });
    },
    onError: (err: Error) => toast({ title: "Abandon failed", description: err.message, variant: "destructive" }),
    onSettled: () => setAbandoningQuoteId(null),
  });

  const assignMutation = useMutation({
    mutationFn: (d: { quoteId: string; contractorId: string; date: string; slot: "am" | "pm" }) =>
      manualAssign({ ...d, testOnly }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["dispatch-preview"] });
      queryClient.invalidateQueries({ queryKey: ["dispatch-fixed-lane"] });
      queryClient.invalidateQueries({ queryKey: ["dispatch-map"] });
      setAssignDraft(null);
      toast({ title: "Job assigned", description: "Booked & moved to committed." });
    },
    onError: (err: Error) => toast({ title: "Assign failed", description: err.message, variant: "destructive" }),
  });

  // Core send-options action — shared by the card button (after a confirm) and the
  // job-detail modal (the modal IS the review step, so it sends directly; onSuccess
  // closes it). pendingGroupId disables that bundle's controls while in flight.
  const sendOptions = (group: ProposalGroup) => {
    if (sendOffersMutation.isPending) return;
    setPendingGroupId(group.groupId);
    sendOffersMutation.mutate(group);
  };

  const handleSendOptions = (group: ProposalGroup) => {
    const n = group.members.length;
    if (!window.confirm(`Send date options to ${n} customer${n === 1 ? "" : "s"} for ${group.contractorName} on ${group.date}?`)) return;
    sendOptions(group);
  };

  // Copy an active offer's full WhatsApp message (greeting + offered dates + confirm link)
  // so Ben can paste it straight into WhatsApp. Returns whether the copy stuck so the card
  // can show a real "Copied!" confirmation (or a failure toast).
  const copyOfferMessage = async (o: ActiveSlotOffer): Promise<boolean> => {
    const confirmUrl = `${location.origin}/confirm-slot/${o.offer.token}`;
    const message = buildSlotOfferWhatsAppMessage({
      customerName: o.customerName,
      candidates: o.offer.candidates,
      confirmUrl,
    });
    const copied = await copyToClipboard(message);
    toast(
      copied
        ? { title: "Message copied", description: "Paste it to the customer on WhatsApp." }
        : { title: "Couldn't copy", description: "Clipboard blocked — try again.", variant: "destructive" },
    );
    return copied;
  };

  const handleAbandonOffer = (o: ActiveSlotOffer) => {
    if (!window.confirm(`Abandon the offer for ${o.customerName} and return the job to the pool?`)) return;
    setAbandoningQuoteId(o.quoteId);
    abandonOfferMutation.mutate(o.quoteId);
  };

  const openAssign = (quoteId: string) => {
    setDetailJob(null); // close the detail modal if the assign was launched from it
    setAssignDraft({ quoteId, contractorId: contractors[0]?.id ?? "", date: tomorrowISO(), slot: "am" });
  };

  return (
    <div className="flex flex-col">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-background/95 backdrop-blur-sm border-b border-border px-3 py-2.5">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold flex items-center gap-1.5">
            <UserCheck className="h-4 w-4 text-green-600" /> To assign
            {isFetching && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
          </h2>
          <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground whitespace-nowrap">
            <span className="flex items-center gap-1">
              <Inbox className="h-3 w-3" />{poolSize} pool
            </span>
            <span className="text-green-700 font-medium">{assigned.length} ready</span>
            {unassignable.length > 0 && <span className="text-amber-700 font-medium">{unassignable.length} to action</span>}
            {slotOffers.length > 0 && <span className="text-sky-700 font-medium">{slotOffers.length} awaiting</span>}
          </div>
        </div>
      </div>

      <div className="px-3 py-2.5 space-y-2">
        {isError && (
          <div className="flex items-start gap-2 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-700">
            <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" /> {(error as Error).message}
          </div>
        )}

        {/* READY — bundles the optimiser can auto-place; sending offers the slots to customers */}
        {groups.map((group) => {
          const n = group.members.length;
          const isPending = sendOffersMutation.isPending && pendingGroupId === group.groupId;
          const isLoss = group.coversDayRate === false;
          const cats = formatSkills(group.members);
          const uncovered = bundleUncovered(group);
          // Any member scheduled PAST its 7-day promise → flag the whole bundle as late
          // so the dispatcher sees it before sending (honoured bundles stay unbadged).
          const lateMember = group.members.find((m) => m.flexDeadline && m.date > m.flexDeadline);
          const fire = fireSignal(group);
          // A member that needs more than one day can't be delivered as a single slot.
          const multiDayMember = group.members.find((m) => typeof m.daysNeeded === "number" && m.daysNeeded > 1);
          const isHovered = hoveredGroupId === group.groupId;
          const isFaded =
            selectedContractorId !== null && group.contractorId !== selectedContractorId;
          return (
            <Card
              key={group.groupId}
              role="button"
              tabIndex={0}
              title="View job details"
              onClick={() => setDetailGroup(group)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setDetailGroup(group); }
              }}
              onMouseEnter={() => setHoveredGroupId(group.groupId)}
              onMouseLeave={() => setHoveredGroupId(null)}
              className={cn(
                "border-l-4 transition-all cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-400",
                isLoss ? "border-l-red-500" : "border-l-green-500",
                isHovered && "ring-2 ring-sky-400 shadow-md -translate-y-px",
                isFaded && "opacity-40 hover:opacity-100",
              )}
            >
              <CardContent className="p-3 space-y-1.5">
                {/* who + when */}
                <div className="flex items-baseline justify-between gap-2">
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); setModalContractorId(group.contractorId); }}
                    title="Edit this contractor's skills & availability"
                    className={cn(
                      "text-sm font-semibold truncate text-left rounded-sm hover:underline focus:outline-none focus-visible:ring-1 focus-visible:ring-sky-400",
                      selectedContractorId === group.contractorId && "text-sky-700 dark:text-sky-300",
                    )}
                  >
                    {group.contractorName}
                  </button>
                  <span className="text-[11px] text-muted-foreground whitespace-nowrap">{formatDate(group.date)}</span>
                </div>
                {/* what */}
                <p className="text-[11px] text-muted-foreground truncate">
                  {n} job{n === 1 ? "" : "s"}{cats ? ` · ${cats}` : ""}
                </p>
                {multiDayMember && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-1.5 py-0.5 text-[10px] font-semibold text-red-700 dark:bg-red-950/60 dark:text-red-300">
                    <AlertTriangle className="h-2.5 w-2.5 shrink-0" />
                    ~{multiDayMember.daysNeeded}-day job — schedule separately
                  </span>
                )}
                {lateMember && (
                  <div>
                    <SlaBadge scheduledDate={lateMember.date} deadline={lateMember.flexDeadline} className="mt-1" />
                  </div>
                )}
                {uncovered.length > 0 && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-800 dark:bg-amber-950/60 dark:text-amber-300">
                    <AlertTriangle className="h-2.5 w-2.5 shrink-0" />
                    {uncovered.map(prettyCat).join(", ")} — needs 2nd trade
                  </span>
                )}
                {/* Hold-vs-send signal (slack governor): HOLD prominent (amber), send quiet. */}
                {fire.hold ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800 dark:bg-amber-950/60 dark:text-amber-300">
                    <PauseCircle className="h-2.5 w-2.5 shrink-0" /> Hold · {fire.reason}
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 text-[10px] font-medium text-green-700 dark:text-green-400">
                    <Send className="h-2.5 w-2.5 shrink-0" /> Send now · {fire.reason}
                  </span>
                )}
                {/* economics (hero) + action */}
                <div className="flex items-end justify-between gap-2 pt-0.5">
                  <div className="min-w-0">
                    {group.marginPence != null ? (
                      <>
                        <div className="flex items-baseline gap-1.5">
                          <span className={cn("text-lg font-bold leading-none", isLoss ? "text-red-600" : "text-green-600")}>
                            {formatMargin(group.marginPence)}
                          </span>
                          <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                            {isLoss ? "loss" : "margin"}
                          </span>
                        </div>
                        <p className="mt-1 text-[10px] text-muted-foreground">
                          {formatPence(group.revenuePence ?? group.totalValue)} rev − {formatPence(group.dayRatePence ?? 0)} day − {formatPence(group.fuelPence ?? 0)} vehicle
                        </p>
                      </>
                    ) : (
                      <div className="flex items-baseline gap-1.5">
                        <span className="text-lg font-bold leading-none text-green-700">{formatPence(group.totalValue)}</span>
                        <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">value</span>
                      </div>
                    )}
                  </div>
                  <Button
                    size="sm"
                    variant={fire.hold ? "outline" : "default"}
                    className="h-8 px-3 text-xs shrink-0"
                    onClick={(e) => { e.stopPropagation(); handleSendOptions(group); }}
                    disabled={sendOffersMutation.isPending}
                  >
                    {isPending
                      ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
                      : <Send className="h-3.5 w-3.5 mr-1" />}
                    Send options ({n})
                  </Button>
                </div>
              </CardContent>
            </Card>
          );
        })}

        {/* AWAITING CUSTOMER — jobs whose date options have been sent; held out of the pool
            until the customer picks (firm booking) or declines (re-offer). The SLA clock is
            still running, so each card keeps its promise badge. */}
        {slotOffers.length > 0 && (
          <div className="pt-1.5">
            <div className="mb-1.5 flex items-center gap-1 text-[11px] font-semibold text-muted-foreground">
              <Clock className="h-3 w-3 text-sky-500" /> Awaiting customer ({slotOffers.length})
            </div>
            <div className="space-y-1.5">
              {slotOffers.map((o) => (
                <AwaitingCustomerCard
                  key={o.quoteId}
                  offer={o}
                  onCopyMessage={copyOfferMessage}
                  onAbandon={handleAbandonOffer}
                  isAbandoning={abandonOfferMutation.isPending && abandoningQuoteId === o.quoteId}
                />
              ))}
            </div>
          </div>
        )}

        {/* NEEDS ASSIGNING — every outstanding job the optimiser couldn't auto-place,
            each with a one-tap manual override (the dispatcher knows availability/skills
            the system doesn't). Nothing hides. */}
        {unassignable.length > 0 && (
          <div className="pt-1.5">
            <div className="mb-1.5 flex items-center gap-1 text-[11px] font-semibold text-muted-foreground">
              <AlertTriangle className="h-3 w-3 text-amber-500" /> Needs assigning ({unassignable.length})
            </div>
            <div className="space-y-1.5">
              {unassignable.map((job) => {
                const draftOpen = assignDraft?.quoteId === job.quoteId;
                // Warn (don't block) when the chosen assign date falls past this job's 7-day promise.
                const pastPromise =
                  draftOpen && !!assignDraft?.date && !!job.flexDeadline && assignDraft.date > job.flexDeadline;
                const cats = [...new Set(job.categories)].slice(0, 3).map(prettyCat).join(", ");
                return (
                  <Card
                    key={job.quoteId}
                    role="button"
                    tabIndex={0}
                    title="View job details"
                    onClick={() => setDetailJob(job)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setDetailJob(job); }
                    }}
                    className="border-l-4 border-l-slate-300 cursor-pointer transition-all hover:ring-2 hover:ring-sky-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-400"
                  >
                    <CardContent className="p-2.5 space-y-1.5">
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="text-sm font-semibold truncate">{job.customerName}</span>
                        <SlaBadge slackDays={job.slackDays} deadline={job.flexDeadline} />
                      </div>
                      {cats && <p className="truncate text-[11px] text-muted-foreground">{cats}</p>}
                      <p className="text-[10px] text-amber-700">{job.reason}</p>
                      {!draftOpen ? (
                        <Button variant="outline" size="sm" className="h-7 w-full px-2.5 text-xs" onClick={(e) => { e.stopPropagation(); openAssign(job.quoteId); }}>
                          <UserPlus className="h-3.5 w-3.5 mr-1" /> Assign manually
                        </Button>
                      ) : (
                        <div className="space-y-1.5 rounded-md border border-border bg-muted/30 p-2" onClick={(e) => e.stopPropagation()}>
                          <select
                            className="h-8 w-full rounded-md border border-border bg-background px-2 text-xs"
                            value={assignDraft!.contractorId}
                            onChange={(e) => setAssignDraft((d) => (d ? { ...d, contractorId: e.target.value } : d))}
                          >
                            {contractors.length === 0 && <option value="">No contractors</option>}
                            {contractors.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                          </select>
                          <div className="flex gap-1.5">
                            <input
                              type="date"
                              className="h-8 flex-1 rounded-md border border-border bg-background px-2 text-xs"
                              value={assignDraft!.date}
                              onChange={(e) => setAssignDraft((d) => (d ? { ...d, date: e.target.value } : d))}
                            />
                            <select
                              className="h-8 rounded-md border border-border bg-background px-2 text-xs"
                              value={assignDraft!.slot}
                              onChange={(e) => setAssignDraft((d) => (d ? { ...d, slot: e.target.value as "am" | "pm" } : d))}
                            >
                              <option value="am">AM</option>
                              <option value="pm">PM</option>
                            </select>
                          </div>
                          {pastPromise && job.flexDeadline && (
                            <p className="flex items-center gap-1 text-[10px] font-medium text-amber-700 dark:text-amber-300">
                              <AlertTriangle className="h-2.5 w-2.5 shrink-0" />
                              Past the 7-day promise (due {formatDeadline(job.flexDeadline)})
                            </p>
                          )}
                          <div className="flex gap-1.5">
                            <Button
                              size="sm"
                              className="h-7 flex-1 px-2.5 text-xs"
                              disabled={!assignDraft!.contractorId || assignMutation.isPending}
                              onClick={() => assignMutation.mutate(assignDraft!)}
                            >
                              {assignMutation.isPending ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5 mr-1" />}
                              Book
                            </Button>
                            <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => setAssignDraft(null)}>Cancel</Button>
                          </div>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </div>
        )}

        {groups.length === 0 && unassignable.length === 0 && !isError && (
          <div className="rounded-md border border-dashed border-border px-3 py-6 text-center text-xs text-muted-foreground">
            Pool clear — nothing outstanding.
          </div>
        )}

        <Link href="/admin/dispatch-board">
          <span className="flex cursor-pointer items-center justify-center gap-1 pt-1 text-[11px] font-medium text-muted-foreground hover:text-foreground transition-colors">
            Open full board <ArrowRight className="h-3 w-3" />
          </span>
        </Link>
      </div>

      <JobDetailModal
        group={liveDetailGroup}
        onClose={() => setDetailGroup(null)}
        onSend={sendOptions}
        isSending={sendOffersMutation.isPending && pendingGroupId === detailGroup?.groupId}
      />

      <UnassignedJobModal
        job={detailJob}
        onClose={() => setDetailJob(null)}
        onAssign={openAssign}
      />

      <SentMessagesDialog
        messages={sentMessages}
        onClose={() => setSentMessages(null)}
      />
    </div>
  );
}
