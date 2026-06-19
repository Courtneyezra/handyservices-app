import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { SlidersHorizontal, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

// ── FROZEN CONTRACT (engine + settings endpoints built in parallel) ──────────
type Objective = "day_margin" | "contractor_hourly" | "customer_speed" | "throughput" | "even_load";
type PackMode = "fast" | "balanced" | "dense";
interface DispatchGoal {
  objective: Objective;
  packMode: PackMode;
  maxJobsPerDay: number;
  maxTravelMilesPerJob: number;
  fuelPencePerMile: number;
  defaultDayRatePence: number;
}

// Per-contractor day-rate contract.
interface ContractorRate {
  id: string;
  name: string;
  dayRatePence: number | null;       // null = inherit default
  effectiveDayRatePence: number;     // resolved (own rate or default)
}
interface ContractorRatesResult {
  defaultDayRatePence: number;
  fuelPencePerMile: number;
  contractors: ContractorRate[];
}

const OBJECTIVE_OPTIONS: { value: Objective; label: string }[] = [
  { value: "day_margin", label: "Day margin" },
  { value: "contractor_hourly", label: "Contractor £/hr" },
  { value: "customer_speed", label: "Customer speed" },
  { value: "throughput", label: "Throughput" },
  { value: "even_load", label: "Even workload" },
];

const PACK_OPTIONS: { value: PackMode; label: string }[] = [
  { value: "fast", label: "Fast" },
  { value: "balanced", label: "Balanced" },
  { value: "dense", label: "Dense" },
];

async function fetchSettings(): Promise<DispatchGoal> {
  const token = localStorage.getItem("adminToken");
  const res = await fetch("/api/admin/daily-planner/settings", {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
  return res.json();
}

async function saveSettings(patch: Partial<DispatchGoal>): Promise<DispatchGoal> {
  const token = localStorage.getItem("adminToken");
  const res = await fetch("/api/admin/daily-planner/settings", {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
  return res.json();
}

async function fetchContractorRates(): Promise<ContractorRatesResult> {
  const token = localStorage.getItem("adminToken");
  const res = await fetch("/api/admin/daily-planner/contractor-rates", {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
  return res.json();
}

async function saveContractorRate(
  body: { contractorId: string; dayRatePence: number | null },
): Promise<{ ok: true }> {
  const token = localStorage.getItem("adminToken");
  const res = await fetch("/api/admin/daily-planner/contractor-rates", {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
  return res.json();
}

/**
 * Compact "Optimiser" control for the dispatch console header. Sets the engine's
 * optimisation goal; on save it invalidates BOTH ["dispatch-settings"] and
 * ["dispatch-preview"] so the engine re-optimises and the queue refreshes.
 */
export default function OptimiserSettings() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["dispatch-settings"],
    queryFn: fetchSettings,
    refetchOnWindowFocus: false,
  });

  // Any save here re-optimises: invalidate the plan preview (new margins),
  // the settings, and the per-contractor rate list so all three stay coherent.
  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: ["dispatch-preview"] });
    queryClient.invalidateQueries({ queryKey: ["dispatch-settings"] });
    queryClient.invalidateQueries({ queryKey: ["dispatch-contractor-rates"] });
  };

  const mutation = useMutation({
    mutationFn: (patch: Partial<DispatchGoal>) => saveSettings(patch),
    onSuccess: () => {
      invalidateAll();
      toast({ title: "Optimiser updated", description: "Re-optimising the queue…" });
    },
    onError: (err: Error) => {
      toast({ title: "Couldn't save", description: err.message, variant: "destructive" });
    },
  });

  const { data: rates, isLoading: ratesLoading } = useQuery({
    queryKey: ["dispatch-contractor-rates"],
    queryFn: fetchContractorRates,
    refetchOnWindowFocus: false,
  });

  const rateMutation = useMutation({
    mutationFn: (body: { contractorId: string; dayRatePence: number | null }) =>
      saveContractorRate(body),
    onSuccess: () => {
      invalidateAll();
      toast({ title: "Day rate updated", description: "Re-optimising the queue…" });
    },
    onError: (err: Error) => {
      toast({ title: "Couldn't save rate", description: err.message, variant: "destructive" });
    },
  });

  // On-change autosave — snappy, fire a Partial for just the changed field.
  const update = (patch: Partial<DispatchGoal>) => mutation.mutate(patch);

  const objective = data?.objective ?? "contractor_hourly";
  const packMode = data?.packMode ?? "balanced";
  const maxJobsPerDay = data?.maxJobsPerDay ?? 0;
  const maxTravelMilesPerJob = data?.maxTravelMilesPerJob ?? 0;
  const fuelPencePerMile = data?.fuelPencePerMile ?? 45;
  const defaultDayRatePence = data?.defaultDayRatePence ?? 15000;
  const busy = isLoading || mutation.isPending;
  const ratesBusy = ratesLoading || rateMutation.isPending;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="h-8 gap-1.5">
          {mutation.isPending
            ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
            : <SlidersHorizontal className="h-3.5 w-3.5" />}
          Optimiser
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 space-y-4">
        <div className="space-y-1">
          <h3 className="text-sm font-semibold leading-none">Optimise for</h3>
          <p className="text-[11px] text-muted-foreground">
            The engine packs the flexible pool to hit this goal.
          </p>
        </div>

        {/* Objective */}
        <div className="space-y-1.5">
          <Label className="text-xs">Objective</Label>
          <Select
            value={objective}
            onValueChange={(v) => update({ objective: v as Objective })}
            disabled={busy}
          >
            <SelectTrigger className="h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {OBJECTIVE_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* packMode — 3-way segmented control */}
        <div className="space-y-1.5">
          <Label className="text-xs">Pack mode</Label>
          <div className="grid grid-cols-3 gap-1 rounded-md bg-muted p-1">
            {PACK_OPTIONS.map((p) => (
              <button
                key={p.value}
                type="button"
                disabled={busy}
                onClick={() => update({ packMode: p.value })}
                className={cn(
                  "rounded-sm px-2 py-1 text-xs font-medium transition-colors disabled:opacity-50",
                  packMode === p.value
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {p.label}
              </button>
            ))}
          </div>
          <p className="text-[11px] text-muted-foreground">
            How long to hold jobs to pack tighter.
          </p>
        </div>

        {/* Limits */}
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="maxJobsPerDay" className="text-xs">Max jobs/day</Label>
            <Input
              id="maxJobsPerDay"
              type="number"
              min={0}
              className="h-9"
              value={maxJobsPerDay}
              disabled={busy}
              onChange={(e) => {
                const n = e.target.valueAsNumber;
                if (!Number.isNaN(n)) update({ maxJobsPerDay: n });
              }}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="maxTravelMilesPerJob" className="text-xs">Max miles/job</Label>
            <Input
              id="maxTravelMilesPerJob"
              type="number"
              min={0}
              className="h-9"
              value={maxTravelMilesPerJob}
              disabled={busy}
              onChange={(e) => {
                const n = e.target.valueAsNumber;
                if (!Number.isNaN(n)) update({ maxTravelMilesPerJob: n });
              }}
            />
          </div>
        </div>

        {/* Economics — fuel + default day rate feed the margin objective */}
        <div className="grid grid-cols-2 gap-3 border-t border-border pt-3">
          <div className="space-y-1.5">
            <Label htmlFor="fuelPencePerMile" className="text-xs">Vehicle cost (p/mile)</Label>
            <Input
              id="fuelPencePerMile"
              type="number"
              min={0}
              className="h-9"
              value={fuelPencePerMile}
              disabled={busy}
              onChange={(e) => {
                const n = e.target.valueAsNumber;
                if (!Number.isNaN(n)) update({ fuelPencePerMile: Math.round(n) });
              }}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="defaultDayRate" className="text-xs">Default day rate (£)</Label>
            <Input
              id="defaultDayRate"
              type="number"
              min={0}
              step={1}
              className="h-9"
              // Stored in pence; shown/edited in pounds.
              value={Math.round(defaultDayRatePence / 100)}
              disabled={busy}
              onChange={(e) => {
                const pounds = e.target.valueAsNumber;
                if (!Number.isNaN(pounds)) {
                  update({ defaultDayRatePence: Math.round(pounds * 100) });
                }
              }}
            />
          </div>
        </div>

        {/* Per-contractor day rates */}
        <div className="space-y-1.5 border-t border-border pt-3">
          <div className="flex items-center justify-between">
            <Label className="text-xs">Contractor day rates</Label>
            {rateMutation.isPending && (
              <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
            )}
          </div>
          <p className="text-[11px] text-muted-foreground">
            Blank = uses the default. £/day per person.
          </p>
          <div className="max-h-44 space-y-1.5 overflow-y-auto pr-1">
            {ratesLoading ? (
              <div className="flex items-center gap-1.5 py-1 text-[11px] text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" /> Loading rates…
              </div>
            ) : (rates?.contractors.length ?? 0) === 0 ? (
              <p className="py-1 text-[11px] text-muted-foreground">No contractors.</p>
            ) : (
              rates!.contractors.map((c) => (
                <div key={c.id} className="flex items-center gap-2">
                  <span className="flex-1 truncate text-xs" title={c.name}>{c.name}</span>
                  <Input
                    type="number"
                    min={0}
                    step={1}
                    className="h-8 w-24 text-xs"
                    // null own-rate → show empty input, placeholder reveals the
                    // effective (default) £/day so the dispatcher knows the fallback.
                    defaultValue={c.dayRatePence != null ? Math.round(c.dayRatePence / 100) : ""}
                    placeholder={`${Math.round(c.effectiveDayRatePence / 100)} (default)`}
                    disabled={ratesBusy}
                    onBlur={(e) => {
                      const raw = e.target.value.trim();
                      // Empty → null (inherit default); else pounds → pence.
                      const dayRatePence = raw === "" ? null : Math.round(Number(raw) * 100);
                      if (raw !== "" && Number.isNaN(Number(raw))) return;
                      // Skip no-op saves (unchanged value).
                      if (dayRatePence === c.dayRatePence) return;
                      rateMutation.mutate({ contractorId: c.id, dayRatePence });
                    }}
                  />
                </div>
              ))
            )}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
