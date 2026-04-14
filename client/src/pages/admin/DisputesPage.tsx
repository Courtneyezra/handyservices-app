import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";

// ── Types ────────────────────────────────────────────────────────────────────

interface Dispute {
  id: number;
  jobId: number | null;
  quoteId: string | null;
  contractorId: number | null;
  customerName: string | null;
  customerPhone: string | null;
  customerEmail: string | null;
  type: string;
  status: string;
  priority: string | null;
  customerDescription: string | null;
  resolution: string | null;
  resolutionNotes: string | null;
  refundAmountPence: number | null;
  contractorPenaltyApplied: boolean | null;
  escalatedAt: string | null;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
  contractorName: string | null;
  jobDate: string | null;
}

// ── Badge variant helpers ────────────────────────────────────────────────────

function statusBadge(status: string) {
  const map: Record<string, { label: string; className: string }> = {
    open: { label: "Open", className: "bg-red-600 text-white hover:bg-red-700" },
    investigating: { label: "Investigating", className: "bg-yellow-500 text-black hover:bg-yellow-600" },
    awaiting_contractor: { label: "Awaiting Contractor", className: "bg-amber-500 text-black hover:bg-amber-600" },
    awaiting_customer: { label: "Awaiting Customer", className: "bg-blue-500 text-white hover:bg-blue-600" },
    resolved: { label: "Resolved", className: "bg-green-600 text-white hover:bg-green-700" },
    escalated: { label: "Escalated", className: "bg-purple-600 text-white hover:bg-purple-700" },
    closed: { label: "Closed", className: "bg-gray-500 text-white hover:bg-gray-600" },
  };
  const cfg = map[status] || { label: status, className: "bg-gray-400 text-white" };
  return <Badge className={cfg.className}>{cfg.label}</Badge>;
}

function typeBadge(type: string) {
  const map: Record<string, { label: string; className: string }> = {
    quality: { label: "Quality", className: "bg-orange-500 text-white hover:bg-orange-600" },
    damage: { label: "Damage", className: "bg-red-600 text-white hover:bg-red-700" },
    incomplete: { label: "Incomplete", className: "bg-yellow-500 text-black hover:bg-yellow-600" },
    no_show: { label: "No Show", className: "bg-red-600 text-white hover:bg-red-700" },
    overcharge: { label: "Overcharge", className: "bg-amber-500 text-black hover:bg-amber-600" },
    other: { label: "Other", className: "bg-gray-500 text-white hover:bg-gray-600" },
  };
  const cfg = map[type] || { label: type, className: "bg-gray-400 text-white" };
  return <Badge className={cfg.className}>{cfg.label}</Badge>;
}

function priorityBadge(priority: string | null) {
  if (!priority) return null;
  const map: Record<string, { label: string; className: string }> = {
    high: { label: "High", className: "bg-red-500 text-white hover:bg-red-600" },
    medium: { label: "Medium", className: "bg-yellow-500 text-black hover:bg-yellow-600" },
    low: { label: "Low", className: "bg-blue-400 text-white hover:bg-blue-500" },
  };
  const cfg = map[priority] || { label: priority, className: "bg-gray-400 text-white" };
  return <Badge className={cfg.className}>{cfg.label}</Badge>;
}

function formatDate(d: string | null) {
  if (!d) return "-";
  return new Date(d).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function formatPence(pence: number | null) {
  if (pence == null) return "";
  return `\u00a3${(pence / 100).toFixed(2)}`;
}

// ── Main Component ───────────────────────────────────────────────────────────

export default function DisputesPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [resolveOpen, setResolveOpen] = useState(false);
  const [selectedDispute, setSelectedDispute] = useState<Dispute | null>(null);

  // Resolve form state
  const [resolution, setResolution] = useState("");
  const [refundAmount, setRefundAmount] = useState("");
  const [resolutionNotes, setResolutionNotes] = useState("");
  const [applyPenalty, setApplyPenalty] = useState(false);

  // ── Fetch disputes ──────────────────────────────────────────────────────────
  const { data: disputes = [], isLoading } = useQuery<Dispute[]>({
    queryKey: ["admin-disputes", statusFilter],
    queryFn: async () => {
      const params = statusFilter !== "all" ? `?status=${statusFilter}` : "";
      const res = await fetch(`/api/admin/disputes${params}`, {
        headers: {
          Authorization: `Bearer ${localStorage.getItem("adminToken")}`,
        },
      });
      if (!res.ok) throw new Error("Failed to fetch disputes");
      const data = await res.json();
      return Array.isArray(data) ? data : data.disputes || [];
    },
  });

  // ── Resolve mutation ────────────────────────────────────────────────────────
  const resolveMutation = useMutation({
    mutationFn: async (payload: {
      id: number;
      resolution: string;
      resolutionNotes: string;
      refundAmountPence?: number;
      contractorPenaltyApplied: boolean;
    }) => {
      const res = await fetch(`/api/admin/disputes/${payload.id}/resolve`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${localStorage.getItem("adminToken")}`,
        },
        body: JSON.stringify({
          resolution: payload.resolution,
          resolutionNotes: payload.resolutionNotes,
          refundAmountPence: payload.refundAmountPence,
          contractorPenaltyApplied: payload.contractorPenaltyApplied,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Failed to resolve dispute");
      }
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Dispute resolved", description: "The dispute has been resolved successfully." });
      queryClient.invalidateQueries({ queryKey: ["admin-disputes"] });
      closeResolveModal();
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  // ── Escalate mutation ───────────────────────────────────────────────────────
  const escalateMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`/api/admin/disputes/${id}/escalate`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${localStorage.getItem("adminToken")}`,
        },
        body: JSON.stringify({}),
      });
      if (!res.ok) throw new Error("Failed to escalate dispute");
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Dispute escalated" });
      queryClient.invalidateQueries({ queryKey: ["admin-disputes"] });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  function openResolveModal(dispute: Dispute) {
    setSelectedDispute(dispute);
    setResolution("");
    setRefundAmount("");
    setResolutionNotes("");
    setApplyPenalty(false);
    setResolveOpen(true);
  }

  function closeResolveModal() {
    setResolveOpen(false);
    setSelectedDispute(null);
  }

  function handleResolve() {
    if (!selectedDispute || !resolution) return;

    const refundPence =
      (resolution === "refund_partial" || resolution === "refund_full") && refundAmount
        ? Math.round(parseFloat(refundAmount) * 100)
        : undefined;

    resolveMutation.mutate({
      id: selectedDispute.id,
      resolution,
      resolutionNotes,
      refundAmountPence: refundPence,
      contractorPenaltyApplied: applyPenalty,
    });
  }

  const showRefundInput = resolution === "refund_partial" || resolution === "refund_full";

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Disputes</h1>
          <p className="text-muted-foreground">
            Manage customer complaints and dispute resolutions
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="Filter by status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Statuses</SelectItem>
              <SelectItem value="open">Open</SelectItem>
              <SelectItem value="investigating">Investigating</SelectItem>
              <SelectItem value="awaiting_contractor">Awaiting Contractor</SelectItem>
              <SelectItem value="awaiting_customer">Awaiting Customer</SelectItem>
              <SelectItem value="escalated">Escalated</SelectItem>
              <SelectItem value="resolved">Resolved</SelectItem>
              <SelectItem value="closed">Closed</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {isLoading ? (
        <div className="text-center py-12 text-muted-foreground">Loading disputes...</div>
      ) : disputes.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          No disputes found{statusFilter !== "all" ? ` with status "${statusFilter}"` : ""}.
        </div>
      ) : (
        <div className="border rounded-lg">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[60px]">ID</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Priority</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Contractor</TableHead>
                <TableHead>Date</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {disputes.map((d) => (
                <TableRow key={d.id}>
                  <TableCell className="font-mono text-sm">#{d.id}</TableCell>
                  <TableCell>
                    <div className="font-medium">{d.customerName || "Unknown"}</div>
                    {d.customerPhone && (
                      <div className="text-xs text-muted-foreground">{d.customerPhone}</div>
                    )}
                  </TableCell>
                  <TableCell>{typeBadge(d.type)}</TableCell>
                  <TableCell>{priorityBadge(d.priority)}</TableCell>
                  <TableCell>{statusBadge(d.status)}</TableCell>
                  <TableCell className="text-sm">
                    {d.contractorName || (d.contractorId ? `#${d.contractorId}` : "-")}
                  </TableCell>
                  <TableCell className="text-sm">{formatDate(d.createdAt)}</TableCell>
                  <TableCell className="text-right space-x-2">
                    {d.status !== "resolved" && d.status !== "closed" && (
                      <>
                        <Button
                          size="sm"
                          variant="default"
                          onClick={() => openResolveModal(d)}
                        >
                          Resolve
                        </Button>
                        {d.status !== "escalated" && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => escalateMutation.mutate(d.id)}
                          >
                            Escalate
                          </Button>
                        )}
                      </>
                    )}
                    {d.status === "resolved" && d.refundAmountPence != null && (
                      <span className="text-sm text-green-500 font-medium">
                        Refunded {formatPence(d.refundAmountPence)}
                      </span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {/* ── Resolve Modal ────────────────────────────────────────────────────── */}
      <Dialog open={resolveOpen} onOpenChange={setResolveOpen}>
        <DialogContent className="sm:max-w-[480px]">
          <DialogHeader>
            <DialogTitle>Resolve Dispute #{selectedDispute?.id}</DialogTitle>
            <DialogDescription>
              {selectedDispute?.customerName} - {selectedDispute?.type} dispute
            </DialogDescription>
          </DialogHeader>

          {selectedDispute?.customerDescription && (
            <div className="bg-muted rounded-md p-3 text-sm">
              <p className="font-medium mb-1">Customer description:</p>
              <p className="text-muted-foreground">{selectedDispute.customerDescription}</p>
            </div>
          )}

          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium mb-1.5 block">Resolution</label>
              <Select value={resolution} onValueChange={setResolution}>
                <SelectTrigger>
                  <SelectValue placeholder="Select resolution type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="refund_full">Full Refund</SelectItem>
                  <SelectItem value="refund_partial">Partial Refund</SelectItem>
                  <SelectItem value="return_visit">Return Visit</SelectItem>
                  <SelectItem value="no_action">No Action</SelectItem>
                  <SelectItem value="insurance_claim">Insurance Claim</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {showRefundInput && (
              <div>
                <label className="text-sm font-medium mb-1.5 block">
                  Refund Amount ({"\u00a3"})
                </label>
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  placeholder="0.00"
                  value={refundAmount}
                  onChange={(e) => setRefundAmount(e.target.value)}
                />
              </div>
            )}

            <div>
              <label className="text-sm font-medium mb-1.5 block">Resolution Notes</label>
              <Textarea
                placeholder="Explain the resolution decision..."
                value={resolutionNotes}
                onChange={(e) => setResolutionNotes(e.target.value)}
                rows={3}
              />
            </div>

            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="penalty"
                checked={applyPenalty}
                onChange={(e) => setApplyPenalty(e.target.checked)}
                className="rounded border-gray-300"
              />
              <label htmlFor="penalty" className="text-sm">
                Apply contractor penalty
              </label>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={closeResolveModal}>
              Cancel
            </Button>
            <Button
              onClick={handleResolve}
              disabled={!resolution || resolveMutation.isPending}
            >
              {resolveMutation.isPending ? "Resolving..." : "Resolve Dispute"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
