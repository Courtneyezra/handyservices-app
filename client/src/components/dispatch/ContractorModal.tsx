import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, AlertTriangle, Save, Wrench, CalendarDays } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { useDispatchSelection } from "@/components/dispatch/useDispatchSelection";

// ── Contract: GET /api/admin/contractors/:id ────────────────────────────────
interface ContractorSkill {
  categorySlug: string;
  hourlyRate?: string | null;
  dayRate?: string | null;
  proficiency?: string | null;
  service?: unknown;
}
interface DateOverride {
  date: string; // ISO timestamp
  isAvailable: boolean;
  startTime?: string | null;
  endTime?: string | null;
  notes?: string | null;
}
interface ContractorDetail {
  id: string;
  businessName?: string | null;
  radiusMiles?: number | null;
  user?: { firstName?: string | null; lastName?: string | null } | null;
  skills?: ContractorSkill[];
  weeklyPatterns?: unknown[];
  dateOverrides?: DateOverride[];
}

// The full checklist set the dispatcher can tag a contractor with.
const SKILL_CATEGORIES = [
  "general_fixing", "garden_maintenance", "carpentry", "flat_pack", "painting",
  "pressure_washing", "curtain_blinds", "fencing", "flooring", "shelving",
  "silicone_sealant", "tv_mounting", "door_fitting", "guttering", "kitchen_fitting",
  "waste_removal", "furniture_repair", "lock_change", "tiling", "electrical_minor",
  "plumbing_minor", "plastering", "other",
] as const;

type Slot = "am" | "pm" | "full_day" | "off";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// snake_case slug → "Title Case" (tv_mounting → "Tv Mounting").
function prettyCat(c: string): string {
  return c.split("_").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}

// Build the next 14 calendar days from today as { key: 'YYYY-MM-DD', label }.
function nextFortnight(): { key: string; label: string }[] {
  const out: { key: string; label: string }[] = [];
  const today = new Date();
  for (let i = 0; i < 14; i++) {
    const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() + i);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const label = `${WEEKDAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`;
    out.push({ key, label });
  }
  return out;
}

// Calendar-day key ('YYYY-MM-DD') of an ISO timestamp, matched on its UTC date
// (overrides are stored at UTC midnight ± slot hours).
function isoDayKey(iso: string): string {
  return iso.slice(0, 10);
}

// Infer the saved slot from a stored override's working window.
// full_day 09:00-18:00, am 09:00-13:00, pm 14:00-18:00 (see shared/slot-times.ts).
function inferSlot(o: DateOverride): Slot {
  if (!o.isAvailable) return "off";
  const start = o.startTime ?? "09:00";
  const end = o.endTime ?? "18:00";
  if (start <= "12:00" && end >= "16:00") return "full_day";
  if (start <= "12:00") return "am";
  return "pm";
}

const SLOT_LABELS: Record<Slot, string> = {
  off: "Off",
  am: "AM",
  pm: "PM",
  full_day: "Full day",
};

async function fetchContractor(id: string): Promise<ContractorDetail> {
  const token = localStorage.getItem("adminToken");
  const res = await fetch(`/api/admin/contractors/${id}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
  return res.json();
}

async function saveSkills(id: string, slugs: string[]): Promise<void> {
  const token = localStorage.getItem("adminToken");
  const res = await fetch(`/api/admin/contractors/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ skills: slugs.map((categorySlug) => ({ categorySlug })) }),
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
}

async function saveAvailability(id: string, dates: { date: string; slot: Slot; isAvailable: true }[]): Promise<void> {
  const token = localStorage.getItem("adminToken");
  const res = await fetch(`/api/admin/contractors/${id}/availability`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ dates }),
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
}

/**
 * Edit-contractor modal for the dispatch console. Opens when a contractor name is
 * clicked (modalContractorId set in the shared selection context) and lets the
 * dispatcher fix the two real bottlenecks inline: under-tagged SKILLS and missing
 * AVAILABILITY. Saving either invalidates the dispatch queries so the pool
 * re-matches immediately. Frontend-only — reuses the existing admin endpoints.
 */
export default function ContractorModal(): JSX.Element {
  const { modalContractorId, setModalContractorId } = useDispatchSelection();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const open = modalContractorId != null;

  const { data: detail, isLoading, isError, error } = useQuery({
    queryKey: ["contractor", modalContractorId],
    queryFn: () => fetchContractor(modalContractorId as string),
    enabled: open,
  });

  // Local editable state, seeded from the fetched detail.
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [slots, setSlots] = useState<Record<string, Slot>>({});

  const days = useMemo(() => nextFortnight(), [modalContractorId]);

  // Seed skill checkboxes + availability slots once the detail arrives.
  useEffect(() => {
    if (!detail) return;
    setChecked(new Set((detail.skills ?? []).map((s) => s.categorySlug)));

    const byDay = new Map<string, DateOverride>();
    for (const o of detail.dateOverrides ?? []) {
      byDay.set(isoDayKey(o.date), o);
    }
    const next: Record<string, Slot> = {};
    for (const d of days) {
      const o = byDay.get(d.key);
      next[d.key] = o ? inferSlot(o) : "off";
    }
    setSlots(next);
  }, [detail, days]);

  const displayName =
    [detail?.user?.firstName, detail?.user?.lastName].filter(Boolean).join(" ") ||
    detail?.businessName ||
    "Contractor";

  const skillsMutation = useMutation({
    mutationFn: () => saveSkills(modalContractorId as string, [...checked]),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["dispatch-preview"] });
      queryClient.invalidateQueries({ queryKey: ["dispatch-map"] });
      queryClient.invalidateQueries({ queryKey: ["dispatch-contractors"] });
      queryClient.invalidateQueries({ queryKey: ["contractor", modalContractorId] });
      toast({ title: "Skills saved", description: `${checked.size} skill${checked.size === 1 ? "" : "s"} tagged for ${displayName}.` });
    },
    onError: (err: Error) => toast({ title: "Save failed", description: err.message, variant: "destructive" }),
  });

  const availabilityMutation = useMutation({
    mutationFn: () =>
      saveAvailability(
        modalContractorId as string,
        days.map((d) => ({ date: d.key, slot: slots[d.key] ?? "off", isAvailable: true as const })),
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["dispatch-preview"] });
      queryClient.invalidateQueries({ queryKey: ["dispatch-map"] });
      queryClient.invalidateQueries({ queryKey: ["dispatch-fixed-lane"] });
      queryClient.invalidateQueries({ queryKey: ["contractor", modalContractorId] });
      toast({ title: "Availability saved", description: `Updated the next 14 days for ${displayName}.` });
    },
    onError: (err: Error) => toast({ title: "Save failed", description: err.message, variant: "destructive" }),
  });

  const toggleSkill = (slug: string) => {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(slug)) next.delete(slug);
      else next.add(slug);
      return next;
    });
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) setModalContractorId(null); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{isLoading ? "Loading…" : displayName}</DialogTitle>
          <DialogDescription>
            Edit skills &amp; availability — saving re-matches the dispatch pool.
          </DialogDescription>
        </DialogHeader>

        {isError && (
          <div className="flex items-start gap-2 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-700">
            <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" /> {(error as Error).message}
          </div>
        )}

        {isLoading ? (
          <div className="flex items-center justify-center py-10 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : (
          <Tabs defaultValue="skills" className="w-full">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="skills" className="gap-1.5">
                <Wrench className="h-3.5 w-3.5" /> Skills
              </TabsTrigger>
              <TabsTrigger value="availability" className="gap-1.5">
                <CalendarDays className="h-3.5 w-3.5" /> Availability
              </TabsTrigger>
            </TabsList>

            {/* ── SKILLS ── checkbox grid of every category; checked = tagged ── */}
            <TabsContent value="skills" className="space-y-3">
              <ScrollArea className="h-[340px] pr-3">
                <div className="grid grid-cols-2 gap-x-3 gap-y-2">
                  {SKILL_CATEGORIES.map((slug) => (
                    <label
                      key={slug}
                      className="flex items-center gap-2 rounded-md px-1.5 py-1 text-sm cursor-pointer hover:bg-muted/60"
                    >
                      <Checkbox
                        checked={checked.has(slug)}
                        onCheckedChange={() => toggleSkill(slug)}
                      />
                      <span className="truncate">{prettyCat(slug)}</span>
                    </label>
                  ))}
                </div>
              </ScrollArea>
              <div className="flex items-center justify-between gap-2 border-t border-border pt-3">
                <span className="text-xs text-muted-foreground">{checked.size} selected</span>
                <Button
                  size="sm"
                  className="h-8 px-3 text-xs"
                  onClick={() => skillsMutation.mutate()}
                  disabled={skillsMutation.isPending}
                >
                  {skillsMutation.isPending
                    ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
                    : <Save className="h-3.5 w-3.5 mr-1" />}
                  Save skills
                </Button>
              </div>
            </TabsContent>

            {/* ── AVAILABILITY ── next 14 days, each Off / AM / PM / Full day ── */}
            <TabsContent value="availability" className="space-y-3">
              <ScrollArea className="h-[340px] pr-3">
                <div className="space-y-1.5">
                  {days.map((d) => (
                    <div key={d.key} className="flex items-center justify-between gap-2">
                      <span className="text-sm">{d.label}</span>
                      <Select
                        value={slots[d.key] ?? "off"}
                        onValueChange={(v) => setSlots((prev) => ({ ...prev, [d.key]: v as Slot }))}
                      >
                        <SelectTrigger
                          className={cn(
                            "h-8 w-[130px] text-xs",
                            (slots[d.key] ?? "off") === "off" && "text-muted-foreground",
                          )}
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="off">{SLOT_LABELS.off}</SelectItem>
                          <SelectItem value="am">{SLOT_LABELS.am}</SelectItem>
                          <SelectItem value="pm">{SLOT_LABELS.pm}</SelectItem>
                          <SelectItem value="full_day">{SLOT_LABELS.full_day}</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  ))}
                </div>
              </ScrollArea>
              <div className="flex items-center justify-end border-t border-border pt-3">
                <Button
                  size="sm"
                  className="h-8 px-3 text-xs"
                  onClick={() => availabilityMutation.mutate()}
                  disabled={availabilityMutation.isPending}
                >
                  {availabilityMutation.isPending
                    ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
                    : <Save className="h-3.5 w-3.5 mr-1" />}
                  Save availability
                </Button>
              </div>
            </TabsContent>
          </Tabs>
        )}
      </DialogContent>
    </Dialog>
  );
}
