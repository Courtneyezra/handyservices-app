import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  PoundSterling,
  Loader2,
  Pencil,
  History,
  Sprout,
  ChevronDown,
  ChevronUp,
  AlertTriangle,
  CheckCircle2,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { CATEGORY_LABELS } from "@shared/categories";
import type { JobCategory } from "@shared/categories";

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

function getAuthHeaders(): Record<string, string> {
  const token = localStorage.getItem("adminToken");
  return token ? { Authorization: `Bearer ${token}` } : {};
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface WtbpRate {
  id: number;
  categorySlug: string;
  categoryLabel: string;
  ratePence: number;
  effectiveFrom: string;
  effectiveTo: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

interface HistoryEntry {
  id: number;
  categorySlug: string;
  ratePence: number;
  effectiveFrom: string;
  effectiveTo: string | null;
  notes: string | null;
}

interface HistoryResponse {
  categorySlug: string;
  categoryLabel: string;
  history: HistoryEntry[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function penceToPounds(pence: number): string {
  return (pence / 100).toFixed(2);
}

function poundsToPence(pounds: string): number {
  const val = parseFloat(pounds);
  return isNaN(val) ? 0 : Math.round(val * 100);
}

function formatDate(iso: string | null): string {
  if (!iso) return "--";
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function formatDateTime(iso: string | null): string {
  if (!iso) return "--";
  return new Date(iso).toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// All 24 categories from CATEGORY_LABELS
const ALL_CATEGORIES = Object.entries(CATEGORY_LABELS) as [JobCategory, string][];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function WTBPRateCardPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // State
  const [editSlug, setEditSlug] = useState<string | null>(null);
  const [editRate, setEditRate] = useState("");
  const [editNotes, setEditNotes] = useState("");
  const [historySlug, setHistorySlug] = useState<string | null>(null);
  const [expandedHistory, setExpandedHistory] = useState<string | null>(null);

  // Fetch all current rates
  const { data: rates = [], isLoading } = useQuery<WtbpRate[]>({
    queryKey: ["wtbp-rates"],
    queryFn: async () => {
      const res = await fetch("/api/admin/wtbp-rate-card", {
        headers: getAuthHeaders(),
      });
      if (!res.ok) throw new Error("Failed to fetch rates");
      return res.json();
    },
  });

  // Fetch history for a specific category
  const { data: historyData, isLoading: historyLoading } = useQuery<HistoryResponse>({
    queryKey: ["wtbp-history", historySlug],
    enabled: !!historySlug,
    queryFn: async () => {
      const res = await fetch(`/api/admin/wtbp-rate-card/history/${historySlug}`, {
        headers: getAuthHeaders(),
      });
      if (!res.ok) throw new Error("Failed to fetch history");
      return res.json();
    },
  });

  // Seed mutation
  const seedMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/admin/wtbp-rate-card/seed", {
        method: "POST",
        headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Failed to seed rates");
      }
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["wtbp-rates"] });
      toast({ title: "Rates seeded", description: data.message });
    },
    onError: (err: Error) => {
      toast({ title: "Seed failed", description: err.message, variant: "destructive" });
    },
  });

  // Update rate mutation
  const updateMutation = useMutation({
    mutationFn: async (payload: { categorySlug: string; ratePence: number; notes?: string }) => {
      const res = await fetch("/api/admin/wtbp-rate-card", {
        method: "POST",
        headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Failed to update rate");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["wtbp-rates"] });
      queryClient.invalidateQueries({ queryKey: ["wtbp-history"] });
      setEditSlug(null);
      toast({ title: "Rate updated" });
    },
    onError: (err: Error) => {
      toast({ title: "Update failed", description: err.message, variant: "destructive" });
    },
  });

  // Build merged list: all categories + their rate (or null)
  const rateMap = new Map(rates.map((r) => [r.categorySlug, r]));
  const merged = ALL_CATEGORIES.map(([slug, label]) => ({
    slug,
    label,
    rate: rateMap.get(slug) || null,
  }));

  // Sort: covered first, then uncovered
  merged.sort((a, b) => {
    if (a.rate && !b.rate) return -1;
    if (!a.rate && b.rate) return 1;
    return a.label.localeCompare(b.label);
  });

  // Stats
  const totalCategories = ALL_CATEGORIES.length;
  const coveredCount = merged.filter((m) => m.rate).length;
  const uncoveredCount = totalCategories - coveredCount;
  const avgRate =
    coveredCount > 0
      ? merged.reduce((sum, m) => sum + (m.rate?.ratePence || 0), 0) / coveredCount
      : 0;

  // Edit handlers
  function openEdit(slug: string, currentPence?: number) {
    setEditSlug(slug);
    setEditRate(currentPence ? penceToPounds(currentPence) : "");
    setEditNotes("");
  }

  function handleSaveEdit() {
    if (!editSlug) return;
    const pence = poundsToPence(editRate);
    if (pence <= 0) {
      toast({ title: "Invalid rate", description: "Rate must be greater than 0", variant: "destructive" });
      return;
    }
    updateMutation.mutate({
      categorySlug: editSlug,
      ratePence: pence,
      notes: editNotes.trim() || undefined,
    });
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <PoundSterling className="h-6 w-6 text-amber-400" />
            WTBP Rate Card
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            What To Budget Per Job — global contractor hourly payout rates
          </p>
          <p className="text-muted-foreground text-xs mt-2 max-w-xl leading-relaxed">
            WTBP rates are hourly — contractor pay for each job = hourly rate x estimated hours.
            Rates are calculated using the CVS (Contractor Value Score) framework based on
            Nottingham subcontractor going rates with a surplus capacity discount.
          </p>
        </div>
        {coveredCount === 0 && (
          <Button
            onClick={() => seedMutation.mutate()}
            disabled={seedMutation.isPending}
            variant="outline"
            className="border-amber-500/50 text-amber-400 hover:bg-amber-500/10"
            title="Calculate hourly rates using the Contractor Value Score (CVS) framework"
          >
            {seedMutation.isPending ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Sprout className="h-4 w-4 mr-2" />
            )}
            Seed CVS Rates
          </Button>
        )}
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="bg-card/50">
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">Total Categories</p>
            <p className="text-2xl font-bold mt-1">{totalCategories}</p>
          </CardContent>
        </Card>
        <Card className="bg-card/50">
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">Covered</p>
            <p className="text-2xl font-bold mt-1 text-green-400">{coveredCount}</p>
          </CardContent>
        </Card>
        <Card className="bg-card/50">
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">Uncovered</p>
            <p className="text-2xl font-bold mt-1 text-red-400">{uncoveredCount}</p>
          </CardContent>
        </Card>
        <Card className="bg-card/50">
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">Avg Hourly Rate</p>
            <p className="text-2xl font-bold mt-1">
              {coveredCount > 0 ? `£${penceToPounds(avgRate)}/hr` : "--"}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Rate Card Table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Rate Card</CardTitle>
          <CardDescription>
            Per-category contractor hourly payout rates. Click Edit to set or update a rate.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-muted-foreground">
                  <th className="px-4 py-3 font-medium">Category</th>
                  <th className="px-4 py-3 font-medium text-right">Hourly Rate</th>
                  <th className="px-4 py-3 font-medium">Effective Since</th>
                  <th className="px-4 py-3 font-medium">Notes</th>
                  <th className="px-4 py-3 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {merged.map(({ slug, label, rate }) => {
                  const isExpanded = expandedHistory === slug;
                  return (
                    <>
                      <tr
                        key={slug}
                        className={`border-b border-border/50 hover:bg-muted/30 transition-colors ${
                          !rate ? "bg-red-500/5" : ""
                        }`}
                      >
                        <td className="px-4 py-3">
                          <span className="font-medium">{label}</span>
                          <span className="text-xs text-muted-foreground ml-2">({slug})</span>
                        </td>
                        <td className="px-4 py-3 text-right">
                          {rate ? (
                            <span className="font-mono font-semibold text-green-400">
                              £{penceToPounds(rate.ratePence)}/hr
                            </span>
                          ) : (
                            <Badge variant="destructive" className="text-xs">
                              <AlertTriangle className="h-3 w-3 mr-1" />
                              No rate set
                            </Badge>
                          )}
                        </td>
                        <td className="px-4 py-3 text-muted-foreground">
                          {rate ? formatDate(rate.effectiveFrom) : "--"}
                        </td>
                        <td className="px-4 py-3 text-muted-foreground text-xs max-w-[200px] truncate">
                          {rate?.notes || "--"}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <div className="flex items-center justify-end gap-1">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => openEdit(slug, rate?.ratePence)}
                              className="h-8 px-2 text-xs"
                            >
                              <Pencil className="h-3.5 w-3.5 mr-1" />
                              Edit
                            </Button>
                            {rate && (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => {
                                  if (isExpanded) {
                                    setExpandedHistory(null);
                                    setHistorySlug(null);
                                  } else {
                                    setExpandedHistory(slug);
                                    setHistorySlug(slug);
                                  }
                                }}
                                className="h-8 px-2 text-xs"
                              >
                                <History className="h-3.5 w-3.5 mr-1" />
                                History
                                {isExpanded ? (
                                  <ChevronUp className="h-3 w-3 ml-1" />
                                ) : (
                                  <ChevronDown className="h-3 w-3 ml-1" />
                                )}
                              </Button>
                            )}
                          </div>
                        </td>
                      </tr>
                      {/* Expanded history row */}
                      {isExpanded && (
                        <tr key={`${slug}-history`}>
                          <td colSpan={5} className="px-4 py-3 bg-muted/20">
                            {historyLoading ? (
                              <div className="flex items-center gap-2 py-2 text-muted-foreground">
                                <Loader2 className="h-4 w-4 animate-spin" />
                                Loading history...
                              </div>
                            ) : historyData && historyData.history.length > 0 ? (
                              <div className="space-y-1">
                                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                                  Rate History for {historyData.categoryLabel}
                                </p>
                                <table className="w-full text-xs">
                                  <thead>
                                    <tr className="text-muted-foreground">
                                      <th className="text-left py-1 pr-4">Hourly Rate</th>
                                      <th className="text-left py-1 pr-4">Effective From</th>
                                      <th className="text-left py-1 pr-4">Effective To</th>
                                      <th className="text-left py-1">Notes</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {historyData.history.map((h) => (
                                      <tr
                                        key={h.id}
                                        className={`border-t border-border/30 ${
                                          !h.effectiveTo ? "text-green-400" : "text-muted-foreground"
                                        }`}
                                      >
                                        <td className="py-1.5 pr-4 font-mono">
                                          £{penceToPounds(h.ratePence)}/hr
                                          {!h.effectiveTo && (
                                            <Badge variant="outline" className="ml-2 text-[10px] py-0 text-green-400 border-green-400/30">
                                              Current
                                            </Badge>
                                          )}
                                        </td>
                                        <td className="py-1.5 pr-4">{formatDateTime(h.effectiveFrom)}</td>
                                        <td className="py-1.5 pr-4">{formatDateTime(h.effectiveTo)}</td>
                                        <td className="py-1.5">{h.notes || "--"}</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            ) : (
                              <p className="text-xs text-muted-foreground py-2">No history available.</p>
                            )}
                          </td>
                        </tr>
                      )}
                    </>
                  );
                })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Edit Dialog */}
      <Dialog open={!!editSlug} onOpenChange={(open) => !open && setEditSlug(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {editSlug
                ? `Set Hourly Rate: ${CATEGORY_LABELS[editSlug as JobCategory] || editSlug}`
                : "Set Hourly Rate"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="edit-rate">Hourly Rate (pounds per hour)</Label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground font-medium">
                  £
                </span>
                <Input
                  id="edit-rate"
                  type="number"
                  step="0.50"
                  min="0"
                  value={editRate}
                  onChange={(e) => setEditRate(e.target.value)}
                  className="pl-7"
                  placeholder="e.g. 27.00"
                  autoFocus
                />
              </div>
              <p className="text-xs text-muted-foreground">
                What the platform pays the contractor per hour for this category.
                Stored as {poundsToPence(editRate)} pence.
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-notes">Notes (optional)</Label>
              <Input
                id="edit-notes"
                value={editNotes}
                onChange={(e) => setEditNotes(e.target.value)}
                placeholder="Reason for change..."
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setEditSlug(null)}>
              Cancel
            </Button>
            <Button
              onClick={handleSaveEdit}
              disabled={updateMutation.isPending || !editRate}
              className="bg-amber-500 hover:bg-amber-600 text-black"
            >
              {updateMutation.isPending ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <CheckCircle2 className="h-4 w-4 mr-2" />
              )}
              Save Rate
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
