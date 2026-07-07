import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2, ArrowRight, X, CheckCircle2, Trash2, Hand } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import {
  useDispatchSelection,
  type StagedPlacement,
} from "@/components/dispatch/useDispatchSelection";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function shortDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, (m ?? 1) - 1, d ?? 1));
  return `${WEEKDAYS[dt.getUTCDay()]} ${d} ${MONTHS[(m ?? 1) - 1]}`;
}

// Book one staged placement. confirm-dispatch creates the booking row AND fires
// the customer's WhatsApp — so it only runs on explicit Confirm, never on drop.
async function confirmDispatch(p: StagedPlacement): Promise<void> {
  const token = localStorage.getItem("adminToken");
  const res = await fetch("/api/admin/daily-planner/confirm-dispatch", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({
      quoteId: p.quoteId,
      confirmedDate: p.date,
      confirmedSlot: p.slot,
      contractorId: p.contractorId,
    }),
  });
  if (!res.ok) {
    const msg = (await res.json().catch(() => ({}))).error || `HTTP ${res.status}`;
    throw new Error(msg);
  }
}

/**
 * Floating tray that collects everything the dispatcher has manually dragged onto
 * the schedule grid. Nothing is booked until Confirm — until then placements are
 * browser-local and fully editable (change slot, remove, or re-drag on the grid).
 * Renders nothing when there's nothing staged.
 */
export default function StagedConfirmTray() {
  const { stagedPlacements, unstageJob, setStagedSlot, clearStaged } = useDispatchSelection();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [isConfirming, setIsConfirming] = useState(false);

  const placements = Object.values(stagedPlacements);
  if (placements.length === 0) return null;

  const handleConfirm = async () => {
    setIsConfirming(true);
    const failures: { name: string; error: string }[] = [];
    let booked = 0;

    // Sequential so one failure (e.g. already-booked) doesn't abort the rest, and
    // we can drop each succeeded job from the staging set as we go.
    for (const p of placements) {
      try {
        await confirmDispatch(p);
        unstageJob(p.quoteId);
        booked++;
      } catch (e) {
        failures.push({ name: p.customerName, error: (e as Error).message });
      }
    }

    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["dispatch-schedule"] }),
      queryClient.invalidateQueries({ queryKey: ["dispatch-preview"] }),
      queryClient.invalidateQueries({ queryKey: ["dispatch-fixed-lane"] }),
    ]);

    setIsConfirming(false);

    if (failures.length === 0) {
      toast({
        title: `Booked ${booked} job${booked === 1 ? "" : "s"}`,
        description: "Moved to the committed lane and the customers were notified.",
      });
    } else {
      toast({
        title: `${booked} booked, ${failures.length} failed`,
        description: failures.map((f) => `${f.name}: ${f.error}`).join(" · "),
        variant: "destructive",
      });
    }
  };

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex justify-center px-4">
      <div className="pointer-events-auto w-full max-w-2xl rounded-xl border border-sky-300 bg-white shadow-2xl dark:border-sky-800 dark:bg-slate-900">
        {/* Header */}
        <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-2.5">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <Hand className="h-4 w-4 text-sky-600" />
            {placements.length} job{placements.length === 1 ? "" : "s"} staged
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              className="h-8 px-2.5 text-xs text-muted-foreground"
              onClick={clearStaged}
              disabled={isConfirming}
            >
              <Trash2 className="mr-1 h-3.5 w-3.5" /> Discard all
            </Button>
            <Button
              size="sm"
              className="h-8 px-3 text-xs"
              onClick={handleConfirm}
              disabled={isConfirming}
            >
              {isConfirming
                ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                : <CheckCircle2 className="mr-1 h-3.5 w-3.5" />}
              Confirm &amp; book ({placements.length})
            </Button>
          </div>
        </div>

        {/* Placement rows */}
        <div className="max-h-48 space-y-1 overflow-auto px-3 py-2">
          {placements.map((p) => (
            <div
              key={p.quoteId}
              className="flex items-center gap-2 rounded-md bg-slate-50 px-2 py-1.5 text-xs dark:bg-slate-800/60"
            >
              <span className="min-w-0 flex-1 truncate font-medium">{p.customerName}</span>
              <ArrowRight className="h-3 w-3 shrink-0 text-muted-foreground" />
              <span className="shrink-0 font-medium text-sky-700 dark:text-sky-300">{p.contractorName}</span>
              <span className="shrink-0 text-muted-foreground">{shortDate(p.date)}</span>
              <select
                className="h-7 shrink-0 rounded-md border border-border bg-background px-1.5 text-xs"
                value={p.slot}
                onChange={(e) => setStagedSlot(p.quoteId, e.target.value as StagedPlacement["slot"])}
                disabled={isConfirming}
              >
                <option value="am">AM</option>
                <option value="pm">PM</option>
                <option value="full_day">Full day</option>
              </select>
              <button
                type="button"
                onClick={() => unstageJob(p.quoteId)}
                disabled={isConfirming}
                title="Remove from staging"
                className="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
