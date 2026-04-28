/**
 * Admin Dispatch Dashboard — list all contractor job dispatches with status,
 * contractor responses, variations, completions.
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "wouter";
import {
    Hammer, Clock, CheckCircle2, XCircle, MessageCircle, Lock, ExternalLink,
    AlertTriangle, Camera, FileText, Copy, ShieldCheck, Banknote, Undo2,
} from "lucide-react";

interface Bond {
    id: string;
    amountPence: number;
    status: "pending" | "held" | "refunded" | "forfeited" | "failed";
    paidAt: string | null;
    refundedAt: string | null;
    refundReason: string | null;
    forfeitedAt: string | null;
    forfeitReason: string | null;
}

interface ContractorLink {
    id: string;
    token: string;
    contractorId: string;
    contractorName: string;
    contractorPhone: string | null;
    status: string;
    warningsAcknowledged: any[];
    responseMessage: string | null;
    viewedAt: string | null;
    acceptedAt: string | null;
    declinedAt: string | null;
    bond: Bond | null;
}

interface Variation {
    id: string;
    contractorId: string;
    description: string;
    reason: string | null;
    additionalPricePence: number;
    photoUrls: string[];
    status: string;
    createdAt: string;
}

interface Completion {
    id: string;
    photoUrls: string[];
    notes: string | null;
    completedAt: string;
}

interface Dispatch {
    id: string;
    title: string;
    subtitle: string | null;
    postcode: string;
    customerFirstName: string;
    customerFullName: string | null;
    totalHours: number;
    totalContractorPayPence: number;
    customerRevenuePence: number | null;
    status: "pending" | "locked" | "completed" | "cancelled";
    lockedToContractorId: string | null;
    lockedAt: string | null;
    completedAt: string | null;
    bondRequired: boolean;
    bondAmountPence: number | null;
    createdAt: string;
    links: ContractorLink[];
    variations: Variation[];
    completion: Completion | null;
}

function bondBadge(b: Bond | null) {
    if (!b) return null;
    const map: Record<string, { fg: string; bg: string; label: string }> = {
        pending: { fg: "text-gray-300", bg: "bg-gray-500/15", label: "Bond pending" },
        held: { fg: "text-amber-300", bg: "bg-amber-500/15", label: `Bond £${(b.amountPence / 100).toFixed(2)} held` },
        refunded: { fg: "text-green-300", bg: "bg-green-500/15", label: `Bond refunded` },
        forfeited: { fg: "text-red-300", bg: "bg-red-500/15", label: `Bond forfeited` },
        failed: { fg: "text-red-300", bg: "bg-red-500/15", label: `Bond failed` },
    };
    const m = map[b.status] || map.pending;
    return <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold uppercase tracking-wider ${m.bg} ${m.fg}`}>{m.label}</span>;
}

function fmt(p: number) {
    return `£${(p / 100).toFixed(2)}`;
}

function relTime(iso: string | null) {
    if (!iso) return "—";
    const d = new Date(iso);
    const diff = (Date.now() - d.getTime()) / 1000;
    if (diff < 60) return "just now";
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    return d.toLocaleDateString("en-GB");
}

function statusBadge(status: string) {
    const map: Record<string, { bg: string; fg: string; label: string }> = {
        pending: { bg: "bg-amber-500/10", fg: "text-amber-300", label: "Pending" },
        locked: { bg: "bg-blue-500/10", fg: "text-blue-300", label: "Locked" },
        completed: { bg: "bg-green-500/10", fg: "text-green-300", label: "Completed" },
        cancelled: { bg: "bg-gray-500/10", fg: "text-gray-300", label: "Cancelled" },
        viewed: { bg: "bg-blue-500/10", fg: "text-blue-300", label: "Viewed" },
        accepted: { bg: "bg-green-500/10", fg: "text-green-300", label: "Accepted" },
        declined: { bg: "bg-red-500/10", fg: "text-red-300", label: "Declined" },
        questioning: { bg: "bg-purple-500/10", fg: "text-purple-300", label: "Asking" },
        locked_taken: { bg: "bg-gray-500/10", fg: "text-gray-400", label: "Taken (other)" },
    };
    const m = map[status] || map.pending;
    return <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold uppercase tracking-wider ${m.bg} ${m.fg}`}>{m.label}</span>;
}

export default function AdminDispatchDashboard() {
    const queryClient = useQueryClient();
    const { data, isLoading, refetch } = useQuery<{ dispatches: Dispatch[] }>({
        queryKey: ["admin-dispatches"],
        queryFn: () => fetch("/api/admin/dispatch").then((r) => r.json()),
        refetchInterval: 15000,
    });

    const [filter, setFilter] = useState<"all" | "pending" | "locked" | "completed">("all");
    const [expanded, setExpanded] = useState<string | null>(null);

    const forfeit = useMutation({
        mutationFn: async (args: { dispatchId: string; linkId: string; reason: string }) => {
            const r = await fetch(`/api/admin/dispatch/${args.dispatchId}/bond/forfeit`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ linkId: args.linkId, reason: args.reason }),
            });
            if (!r.ok) throw new Error((await r.json()).error || "forfeit failed");
            return r.json();
        },
        onSuccess: () => queryClient.invalidateQueries({ queryKey: ["admin-dispatches"] }),
    });

    const refundBond = useMutation({
        mutationFn: async (args: { dispatchId: string; linkId: string; reason: string }) => {
            const r = await fetch(`/api/admin/dispatch/${args.dispatchId}/bond/refund`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ linkId: args.linkId, reason: args.reason }),
            });
            if (!r.ok) throw new Error((await r.json()).error || "refund failed");
            return r.json();
        },
        onSuccess: () => queryClient.invalidateQueries({ queryKey: ["admin-dispatches"] }),
    });

    const dispatches = data?.dispatches || [];
    const filtered = filter === "all" ? dispatches : dispatches.filter((d) => d.status === filter);

    const counts = {
        all: dispatches.length,
        pending: dispatches.filter((d) => d.status === "pending").length,
        locked: dispatches.filter((d) => d.status === "locked").length,
        completed: dispatches.filter((d) => d.status === "completed").length,
    };

    const copy = (text: string) => navigator.clipboard.writeText(text);

    return (
        <div className="p-6 max-w-7xl mx-auto">
            <div className="flex items-center justify-between mb-6">
                <div>
                    <h1 className="text-2xl font-bold flex items-center gap-2">
                        <Hammer className="h-6 w-6 text-orange-500" />
                        Contractor Dispatch
                    </h1>
                    <p className="text-sm text-muted-foreground mt-1">
                        All job briefs sent to contractors. Polls every 15s.
                    </p>
                </div>
                <button onClick={() => refetch()} className="text-sm text-blue-500 hover:underline">Refresh</button>
            </div>

            {/* Status filter pills */}
            <div className="flex gap-2 mb-4 flex-wrap">
                {(["all", "pending", "locked", "completed"] as const).map((f) => (
                    <button
                        key={f}
                        onClick={() => setFilter(f)}
                        className={`px-3 py-1.5 rounded-full text-sm font-semibold transition ${filter === f ? "bg-blue-600 text-white" : "bg-muted text-muted-foreground hover:bg-muted/80"}`}
                    >
                        {f.charAt(0).toUpperCase() + f.slice(1)} ({counts[f]})
                    </button>
                ))}
            </div>

            {isLoading && <p className="text-muted-foreground">Loading...</p>}

            {filtered.length === 0 && !isLoading && (
                <div className="bg-muted/30 rounded-xl p-8 text-center">
                    <p className="text-muted-foreground">No dispatches match this filter.</p>
                </div>
            )}

            <div className="space-y-3">
                {filtered.map((d) => {
                    const isOpen = expanded === d.id;
                    const acceptedLink = d.links.find((l) => l.status === "accepted");
                    const declinedCount = d.links.filter((l) => l.status === "declined").length;
                    const questioningCount = d.links.filter((l) => l.status === "questioning").length;
                    const viewedCount = d.links.filter((l) => l.viewedAt).length;

                    return (
                        <div key={d.id} className="bg-card border rounded-xl overflow-hidden">
                            <button
                                onClick={() => setExpanded(isOpen ? null : d.id)}
                                className="w-full p-4 hover:bg-muted/40 transition text-left"
                            >
                                <div className="flex items-start justify-between gap-4">
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-2 flex-wrap mb-1">
                                            {statusBadge(d.status)}
                                            <h3 className="font-bold truncate">{d.title}</h3>
                                            <span className="text-xs text-muted-foreground">· {d.customerFirstName} · {d.postcode}</span>
                                        </div>
                                        <div className="flex items-center gap-4 text-xs text-muted-foreground flex-wrap">
                                            <span>{d.totalHours}h</span>
                                            <span>{fmt(d.totalContractorPayPence)} pay</span>
                                            {d.customerRevenuePence && <span>{fmt(d.customerRevenuePence)} customer</span>}
                                            <span>{d.links.length} contractor(s)</span>
                                            {d.bondRequired && d.bondAmountPence && (
                                                <span className="text-amber-400 flex items-center gap-1">
                                                    <ShieldCheck className="h-3 w-3" /> {fmt(d.bondAmountPence)} bond
                                                </span>
                                            )}
                                            <span>· created {relTime(d.createdAt)}</span>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-3 text-xs shrink-0">
                                        {viewedCount > 0 && (<span className="flex items-center gap-1 text-blue-400"><FileText className="h-3 w-3" />{viewedCount}</span>)}
                                        {questioningCount > 0 && (<span className="flex items-center gap-1 text-purple-400"><MessageCircle className="h-3 w-3" />{questioningCount}</span>)}
                                        {declinedCount > 0 && (<span className="flex items-center gap-1 text-red-400"><XCircle className="h-3 w-3" />{declinedCount}</span>)}
                                        {acceptedLink && (<span className="flex items-center gap-1 text-green-400"><CheckCircle2 className="h-3 w-3" />{acceptedLink.contractorName}</span>)}
                                        {d.variations.length > 0 && (<span className="flex items-center gap-1 text-amber-400"><AlertTriangle className="h-3 w-3" />{d.variations.length}</span>)}
                                        {d.completion && (<span className="flex items-center gap-1 text-green-300"><Camera className="h-3 w-3" />Complete</span>)}
                                    </div>
                                </div>
                            </button>

                            {isOpen && (
                                <div className="border-t bg-muted/20 p-4 space-y-4">

                                    {/* Customer details (admin sees full) */}
                                    <div className="text-xs">
                                        <span className="text-muted-foreground">Customer:</span>{" "}
                                        <span className="font-semibold">{d.customerFullName || d.customerFirstName}</span>
                                        {(d as any).customerPhone && <span className="ml-2 text-muted-foreground">{(d as any).customerPhone}</span>}
                                        {(d as any).customerAddress && <div className="text-muted-foreground mt-0.5">{(d as any).customerAddress}</div>}
                                    </div>

                                    {/* Contractor links */}
                                    <div>
                                        <h4 className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-2">Contractor Links</h4>
                                        <div className="space-y-2">
                                            {d.links.map((l) => {
                                                const url = `${window.location.origin}/contractor-job/${l.token}`;
                                                return (
                                                    <div key={l.id} className="bg-background rounded-lg p-3 border">
                                                        <div className="flex items-start justify-between gap-3">
                                                            <div className="flex-1 min-w-0">
                                                                <div className="flex items-center gap-2 mb-1 flex-wrap">
                                                                    {statusBadge(l.status)}
                                                                    {bondBadge(l.bond)}
                                                                    <span className="font-semibold text-sm">{l.contractorName}</span>
                                                                    {l.contractorPhone && <span className="text-xs text-muted-foreground">{l.contractorPhone}</span>}
                                                                </div>
                                                                <div className="text-[11px] text-muted-foreground flex flex-wrap gap-3">
                                                                    {l.viewedAt && <span>Viewed {relTime(l.viewedAt)}</span>}
                                                                    {l.acceptedAt && <span className="text-green-400">Accepted {relTime(l.acceptedAt)}</span>}
                                                                    {l.declinedAt && <span className="text-red-400">Declined {relTime(l.declinedAt)}</span>}
                                                                    {Array.isArray(l.warningsAcknowledged) && l.warningsAcknowledged.length > 0 && (<span>{l.warningsAcknowledged.length} warning(s) acked</span>)}
                                                                    {l.bond?.paidAt && <span className="text-amber-400">Bond paid {relTime(l.bond.paidAt)}</span>}
                                                                    {l.bond?.refundedAt && <span className="text-green-400">Bond refunded {relTime(l.bond.refundedAt)} ({l.bond.refundReason})</span>}
                                                                    {l.bond?.forfeitedAt && <span className="text-red-400">Bond forfeited ({l.bond.forfeitReason})</span>}
                                                                </div>
                                                                {l.responseMessage && (
                                                                    <div className="mt-2 text-xs italic bg-muted/30 rounded p-2 border-l-2 border-purple-500/40">
                                                                        "{l.responseMessage}"
                                                                    </div>
                                                                )}
                                                                {l.bond?.status === "held" && (
                                                                    <div className="mt-2 flex gap-2 flex-wrap">
                                                                        <button
                                                                            onClick={(e) => {
                                                                                e.stopPropagation();
                                                                                const reason = prompt("Forfeit reason (e.g. 'no-showed', 'cancelled <48hr'):");
                                                                                if (reason) forfeit.mutate({ dispatchId: d.id, linkId: l.id, reason });
                                                                            }}
                                                                            className="text-[11px] px-2 py-1 bg-red-500/10 text-red-400 hover:bg-red-500/20 rounded flex items-center gap-1 border border-red-500/30"
                                                                        >
                                                                            <Banknote className="h-3 w-3" /> Forfeit bond
                                                                        </button>
                                                                        <button
                                                                            onClick={(e) => {
                                                                                e.stopPropagation();
                                                                                const reason = prompt("Refund reason:", "customer_cancelled");
                                                                                if (reason) refundBond.mutate({ dispatchId: d.id, linkId: l.id, reason });
                                                                            }}
                                                                            className="text-[11px] px-2 py-1 bg-green-500/10 text-green-400 hover:bg-green-500/20 rounded flex items-center gap-1 border border-green-500/30"
                                                                        >
                                                                            <Undo2 className="h-3 w-3" /> Refund bond
                                                                        </button>
                                                                    </div>
                                                                )}
                                                            </div>
                                                            <div className="flex flex-col gap-1 shrink-0">
                                                                <button
                                                                    onClick={(e) => { e.stopPropagation(); copy(url); }}
                                                                    className="text-xs px-2 py-1 bg-muted hover:bg-muted/70 rounded flex items-center gap-1"
                                                                    title="Copy link to share"
                                                                >
                                                                    <Copy className="h-3 w-3" /> Copy
                                                                </button>
                                                                <a
                                                                    href={url}
                                                                    target="_blank"
                                                                    rel="noopener noreferrer"
                                                                    onClick={(e) => e.stopPropagation()}
                                                                    className="text-xs px-2 py-1 bg-blue-500/10 text-blue-400 hover:bg-blue-500/20 rounded flex items-center gap-1"
                                                                >
                                                                    <ExternalLink className="h-3 w-3" /> Open
                                                                </a>
                                                            </div>
                                                        </div>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    </div>

                                    {/* Variations */}
                                    {d.variations.length > 0 && (
                                        <div>
                                            <h4 className="text-xs font-bold text-amber-500 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                                                <AlertTriangle className="h-3 w-3" /> Variations Reported ({d.variations.length})
                                            </h4>
                                            <div className="space-y-2">
                                                {d.variations.map((v) => (
                                                    <div key={v.id} className="bg-amber-500/5 border border-amber-500/20 rounded-lg p-3">
                                                        <p className="text-sm font-semibold">{v.description}</p>
                                                        {v.reason && <p className="text-xs text-muted-foreground mt-1">Reason: {v.reason}</p>}
                                                        {v.additionalPricePence > 0 && <p className="text-xs text-amber-400 mt-1">Additional: {fmt(v.additionalPricePence)}</p>}
                                                        {v.photoUrls.length > 0 && (
                                                            <div className="flex gap-2 mt-2">
                                                                {v.photoUrls.map((u, i) => (
                                                                    <a key={i} href={u} target="_blank" rel="noopener noreferrer">
                                                                        <img src={u} alt="" className="h-16 w-16 object-cover rounded border" />
                                                                    </a>
                                                                ))}
                                                            </div>
                                                        )}
                                                        <p className="text-[10px] text-muted-foreground mt-1">{relTime(v.createdAt)} · status: {v.status}</p>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    )}

                                    {/* Completion */}
                                    {d.completion && (
                                        <div>
                                            <h4 className="text-xs font-bold text-green-500 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                                                <Camera className="h-3 w-3" /> Job Complete · {relTime(d.completion.completedAt)}
                                            </h4>
                                            <div className="bg-green-500/5 border border-green-500/20 rounded-lg p-3">
                                                {d.completion.notes && <p className="text-sm mb-2">{d.completion.notes}</p>}
                                                <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                                                    {d.completion.photoUrls.map((u, i) => (
                                                        <a key={i} href={u} target="_blank" rel="noopener noreferrer">
                                                            <img src={u} alt="" className="aspect-square w-full object-cover rounded border" />
                                                        </a>
                                                    ))}
                                                </div>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>

            <div className="mt-8 pt-6 border-t text-xs text-muted-foreground">
                <p>To create a new dispatch, use the seed/dispatch script or hit <code>POST /api/admin/dispatch</code> with: title, postcode, customerFirstName, tasks[], totalHours, totalContractorPayPence, contractorIds[].</p>
            </div>
        </div>
    );
}
