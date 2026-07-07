/**
 * PipelinePage — Ben's single work-first home for the deal lifecycle.
 *
 * One page, three tabs, one per stage of quote → job → invoice:
 *   • Quotes   — every generated quote, newest first, with a status pill
 *     derived from its timestamps, plus per-row Edit + Preview actions.
 *   • Jobs     — booked-but-not-completed jobs, each with a Mark complete
 *     action (POST /api/admin/jobs/:id/complete — the id is the JOB /
 *     contractor_booking_requests id, NOT the quote id).
 *   • Invoices — read-only status visibility (paid/overdue/sent/draft).
 *
 * Light theme matches CallsHubPage. Tab state synced to ?tab=quotes|jobs|invoices.
 * Route: /admin/work — reachable by owner (admin) and Ben (va).
 */

import { useMemo, useState, lazy, Suspense } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation, useSearch } from "wouter";
import { format } from "date-fns";
import {
    Layers, Loader2, Search, Pencil, Eye, ExternalLink,
    CheckCircle2, Receipt, FileText, Briefcase,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";

// The quote editor is the full generator in edit mode — opened here as a
// modal so Ben stays on the Pipeline (close returns to the list). Lazy so it
// doesn't bloat the Pipeline chunk.
const GenerateContextualQuote = lazy(() => import("@/pages/admin/GenerateContextualQuote"));

// ─── Row shapes ──────────────────────────────────────────────────────────

// From GET /api/personalized-quotes (see QuotesPage.tsx PersonalizedQuote)
interface QuoteRow {
    id: string;
    shortSlug: string;
    customerName: string;
    phone: string;
    jobDescription: string;
    quoteMode: string;
    essentialPrice: number | null;
    enhancedPrice: number | null;
    elitePrice: number | null;
    basePrice: number | null;
    viewedAt: string | null;
    selectedAt: string | null;
    bookedAt: string | null;
    depositPaidAt: string | null;
    completedAt: string | null;
    createdAt: string;
}

// From GET /api/admin/jobs (raw contractor_booking_requests rows)
interface JobRow {
    id: string;                 // ← the id mark-complete expects
    quoteId: string | null;
    customerName: string;
    description: string | null;
    scheduledDate: string | null;
    bookedAt?: string | null;   // not on CBR; kept for safety
    completedAt: string | null;
    assignmentStatus: string | null;
    dayOfStatus: string | null;
    status: string;
}

// From GET /api/invoices (see InvoicesPage.tsx)
interface InvoiceRow {
    id: string;
    invoiceNumber: string;
    customerName: string;
    customerEmail: string | null;
    totalAmount: number | string;
    balanceDue: number | string;
    status: string;
    createdAt: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────

function fmtGbp(pence: number | string | null | undefined) {
    if (pence == null) return "—";
    const n = typeof pence === "string" ? parseFloat(pence) : pence;
    if (!isFinite(n)) return "—";
    return new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(n / 100);
}

function fmtDate(d: string | null | undefined) {
    if (!d) return "—";
    return format(new Date(d), "d MMM yyyy");
}

/** Best headline price for a quote (in pence). */
function quoteValuePence(q: QuoteRow): number | null {
    return q.basePrice ?? q.essentialPrice ?? q.enhancedPrice ?? q.elitePrice ?? null;
}

type QuoteStatus = "Sent" | "Viewed" | "Accepted" | "Deposit paid" | "Booked" | "Completed" | "Paid";

/** Derive a lifecycle status from the quote's timestamps (latest wins). */
function deriveQuoteStatus(q: QuoteRow): QuoteStatus {
    if (q.completedAt) return "Completed";
    if (q.bookedAt) return "Booked";
    if (q.depositPaidAt) return "Deposit paid";
    if (q.selectedAt) return "Accepted";
    if (q.viewedAt) return "Viewed";
    return "Sent";
}

const QUOTE_STATUS_CLS: Record<QuoteStatus, string> = {
    Sent: "bg-zinc-100 text-zinc-600 border-zinc-200",
    Viewed: "bg-sky-50 text-sky-700 border-sky-200",
    Accepted: "bg-violet-50 text-violet-700 border-violet-200",
    "Deposit paid": "bg-emerald-50 text-emerald-700 border-emerald-200",
    Booked: "bg-blue-50 text-blue-700 border-blue-200",
    Completed: "bg-emerald-100 text-emerald-800 border-emerald-300",
    Paid: "bg-emerald-100 text-emerald-800 border-emerald-300",
};

function StatusPill({ label, cls }: { label: string; cls: string }) {
    return (
        <span className={cn("inline-flex items-center px-2 py-0.5 rounded-md border text-[10px] font-semibold whitespace-nowrap", cls)}>
            {label}
        </span>
    );
}

// ─── Quotes tab ──────────────────────────────────────────────────────────

function QuotesTab() {
    const [, navigate] = useLocation();
    const [search, setSearch] = useState("");
    const [editSlug, setEditSlug] = useState<string | null>(null);

    const { data: quotes = [], isLoading } = useQuery<QuoteRow[]>({
        queryKey: ["/api/personalized-quotes"],
        queryFn: async () => {
            const res = await fetch("/api/personalized-quotes");
            if (!res.ok) throw new Error("Failed to fetch quotes");
            return res.json();
        },
    });

    const rows = useMemo(() => {
        const q = search.trim().toLowerCase();
        return quotes
            .filter((row) => row.quoteMode !== "consultation")
            .filter((row) =>
                !q ||
                row.customerName?.toLowerCase().includes(q) ||
                row.phone?.includes(search.trim()) ||
                row.shortSlug?.toLowerCase().includes(q),
            )
            .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    }, [quotes, search]);

    return (
        <div className="space-y-3">
            <div className="relative max-w-xs">
                <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-400" />
                <input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search name or number…"
                    className="w-full bg-card border rounded-lg pl-8 pr-3 py-1.5 text-xs text-foreground placeholder-zinc-400 focus:outline-none focus:border-zinc-400"
                />
            </div>

            {isLoading ? (
                <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-zinc-400" /></div>
            ) : rows.length === 0 ? (
                <div className="text-center py-16 text-sm text-zinc-500">No quotes found.</div>
            ) : (
                <div className="space-y-1.5">
                    {rows.map((q) => {
                        const status = deriveQuoteStatus(q);
                        return (
                            <div key={q.id} className="flex items-center gap-3 p-2.5 rounded-xl bg-card border shadow-sm hover:bg-muted/40 transition-colors">
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2">
                                        <span className="font-medium text-sm text-foreground truncate">{q.customerName || "Unknown"}</span>
                                        <StatusPill label={status} cls={QUOTE_STATUS_CLS[status]} />
                                    </div>
                                    <div className="flex items-center gap-1.5 mt-0.5 text-[11px] text-zinc-500">
                                        <span className="font-semibold text-zinc-600">{fmtGbp(quoteValuePence(q))}</span>
                                        <span>· {fmtDate(q.createdAt)}</span>
                                        {q.jobDescription && <span className="truncate text-zinc-400">· {q.jobDescription}</span>}
                                    </div>
                                </div>
                                <div className="flex items-center gap-1.5 flex-shrink-0">
                                    <button
                                        title="Edit quote"
                                        onClick={() => setEditSlug(q.shortSlug)}
                                        className="p-1.5 rounded-lg bg-muted text-zinc-500 border hover:text-zinc-800"
                                    >
                                        <Pencil className="w-4 h-4" />
                                    </button>
                                    <a
                                        title="Preview as customer (no view logged)"
                                        href={`/admin/quotes/${q.shortSlug}/preview`}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="p-1.5 rounded-lg bg-blue-50 text-blue-600 border border-blue-200 hover:bg-blue-100 inline-flex"
                                    >
                                        <Eye className="w-4 h-4" />
                                    </a>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}

            {/* Edit modal — the full generator in edit mode, over the Pipeline.
                Close (× in its banner, or backdrop) returns to this list. On save
                it re-prices in place; refresh the list so statuses update. */}
            {editSlug && (
                <div
                    className="fixed inset-0 z-50 bg-black/50 flex sm:items-center sm:justify-center"
                    onClick={(e) => { if (e.target === e.currentTarget) setEditSlug(null); }}
                >
                    <div className="w-full sm:max-w-3xl h-full sm:h-[92vh] bg-background sm:rounded-2xl overflow-y-auto shadow-2xl">
                        <Suspense fallback={<div className="flex justify-center py-24"><Loader2 className="w-6 h-6 animate-spin text-zinc-400" /></div>}>
                            <GenerateContextualQuote editSlug={editSlug} onClose={() => setEditSlug(null)} />
                        </Suspense>
                    </div>
                </div>
            )}
        </div>
    );
}

// ─── Jobs tab ────────────────────────────────────────────────────────────

function JobsTab() {
    const { toast } = useToast();
    const queryClient = useQueryClient();
    const [pendingId, setPendingId] = useState<string | null>(null);

    // Booked-but-not-completed jobs come straight from the jobs (CBR) list.
    const { data: jobs = [], isLoading } = useQuery<JobRow[]>({
        queryKey: ["/api/admin/jobs"],
        queryFn: async () => {
            const res = await fetch("/api/admin/jobs");
            if (!res.ok) throw new Error("Failed to fetch jobs");
            return res.json();
        },
    });

    // Value lives on the quote, not the job — join by quoteId for display only.
    const { data: quotes = [] } = useQuery<QuoteRow[]>({
        queryKey: ["/api/personalized-quotes"],
        queryFn: async () => {
            const res = await fetch("/api/personalized-quotes");
            if (!res.ok) throw new Error("Failed to fetch quotes");
            return res.json();
        },
    });
    const valueByQuoteId = useMemo(() => {
        const m = new Map<string, number | null>();
        for (const q of quotes) m.set(q.id, quoteValuePence(q));
        return m;
    }, [quotes]);

    const completeMutation = useMutation({
        mutationFn: async (jobId: string) => {
            const res = await fetch(`/api/admin/jobs/${jobId}/complete`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${localStorage.getItem("adminToken")}`,
                },
                body: JSON.stringify({ completionType: "full" }),
            });
            if (!res.ok) {
                const body = await res.json().catch(() => ({}));
                throw new Error(body.error || "Failed to mark complete");
            }
            return res.json();
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["/api/admin/jobs"] });
            queryClient.invalidateQueries({ queryKey: ["/api/personalized-quotes"] });
            queryClient.invalidateQueries({ queryKey: ["invoices"] });
            toast({ title: "Job completed", description: "Balance invoice generated and customer notified." });
        },
        onError: (err: any) => {
            toast({ title: "Error", description: err?.message || "Failed to mark job complete.", variant: "destructive" });
        },
        onSettled: () => setPendingId(null),
    });

    const openJobs = useMemo(
        () =>
            jobs
                .filter((j) => !j.completedAt && j.dayOfStatus !== "completed" && j.status !== "completed")
                .sort((a, b) => new Date(a.scheduledDate || 0).getTime() - new Date(b.scheduledDate || 0).getTime()),
        [jobs],
    );

    const handleComplete = (job: JobRow) => {
        if (!window.confirm(`Mark this job for ${job.customerName} complete?\n\nThis generates the balance invoice and notifies the customer.`)) return;
        setPendingId(job.id);
        completeMutation.mutate(job.id);
    };

    return (
        <div className="space-y-3">
            {isLoading ? (
                <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-zinc-400" /></div>
            ) : openJobs.length === 0 ? (
                <div className="text-center py-16 text-sm text-zinc-500">No jobs waiting to be completed.</div>
            ) : (
                <div className="space-y-1.5">
                    {openJobs.map((job) => {
                        const value = job.quoteId ? valueByQuoteId.get(job.quoteId) : null;
                        const isPending = pendingId === job.id;
                        return (
                            <div key={job.id} className="flex items-center gap-3 p-2.5 rounded-xl bg-card border shadow-sm hover:bg-muted/40 transition-colors">
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2">
                                        <span className="font-medium text-sm text-foreground truncate">{job.customerName || "Unknown"}</span>
                                        <StatusPill label="Booked" cls="bg-blue-50 text-blue-700 border-blue-200" />
                                    </div>
                                    <div className="flex items-center gap-1.5 mt-0.5 text-[11px] text-zinc-500">
                                        <span>{fmtDate(job.scheduledDate)}</span>
                                        {value != null && <span className="font-semibold text-zinc-600">· {fmtGbp(value)}</span>}
                                        {job.description && <span className="truncate text-zinc-400">· {job.description}</span>}
                                    </div>
                                </div>
                                <button
                                    onClick={() => handleComplete(job)}
                                    disabled={isPending}
                                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-semibold hover:bg-emerald-500 disabled:opacity-50 flex-shrink-0"
                                >
                                    {isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
                                    Mark complete
                                </button>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}

// ─── Invoices tab (read-only) ────────────────────────────────────────────

const INVOICE_STATUS_CLS: Record<string, string> = {
    paid: "bg-emerald-100 text-emerald-800 border-emerald-300",
    overdue: "bg-red-100 text-red-800 border-red-200",
    sent: "bg-amber-100 text-amber-800 border-amber-200",
    draft: "bg-zinc-100 text-zinc-600 border-zinc-200",
    void: "bg-zinc-100 text-zinc-500 border-zinc-200",
};

function InvoicesTab() {
    const { data: invoices = [], isLoading } = useQuery<InvoiceRow[]>({
        queryKey: ["invoices"],
        queryFn: async () => {
            const res = await fetch("/api/invoices");
            if (!res.ok) throw new Error("Failed to fetch invoices");
            return res.json();
        },
    });

    if (isLoading) {
        return <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-zinc-400" /></div>;
    }
    if (invoices.length === 0) {
        return <div className="text-center py-16 text-sm text-zinc-500">No invoices yet.</div>;
    }

    return (
        <div className="space-y-1.5">
            {invoices.map((inv) => {
                const status = (inv.status || "draft").toLowerCase();
                const balance = typeof inv.balanceDue === "string" ? parseFloat(inv.balanceDue) : inv.balanceDue;
                return (
                    <div key={inv.id} className="flex items-center gap-3 p-2.5 rounded-xl bg-card border shadow-sm hover:bg-muted/40 transition-colors">
                        <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                                <span className="font-medium text-sm text-foreground truncate">{inv.customerName || "Unknown"}</span>
                                <StatusPill
                                    label={status.charAt(0).toUpperCase() + status.slice(1)}
                                    cls={INVOICE_STATUS_CLS[status] || INVOICE_STATUS_CLS.draft}
                                />
                            </div>
                            <div className="flex items-center gap-1.5 mt-0.5 text-[11px] text-zinc-500">
                                <span className="font-mono">{inv.invoiceNumber}</span>
                                <span>· {fmtDate(inv.createdAt)}</span>
                            </div>
                        </div>
                        <div className="text-right flex-shrink-0">
                            <div className="font-semibold text-sm text-foreground">{fmtGbp(inv.totalAmount)}</div>
                            {balance > 0 && <div className="text-[11px] text-amber-600">Due {fmtGbp(inv.balanceDue)}</div>}
                        </div>
                    </div>
                );
            })}
        </div>
    );
}

// ─── Page shell ──────────────────────────────────────────────────────────

type Tab = "quotes" | "jobs" | "invoices";

export default function PipelinePage() {
    const searchStr = useSearch();
    const [, navigate] = useLocation();
    const raw = new URLSearchParams(searchStr).get("tab");
    const activeTab: Tab = raw === "jobs" || raw === "invoices" ? raw : "quotes";

    const setTab = (tab: Tab) => {
        navigate(tab === "quotes" ? "/admin/work" : `/admin/work?tab=${tab}`, { replace: true });
    };

    const TABS: Array<{ id: Tab; label: string; Icon: typeof FileText }> = [
        { id: "quotes", label: "Quotes", Icon: FileText },
        { id: "jobs", label: "Jobs", Icon: Briefcase },
        { id: "invoices", label: "Invoices", Icon: Receipt },
    ];

    return (
        <div className="max-w-6xl mx-auto p-4 lg:p-6 space-y-4">
            <div className="flex items-center gap-2">
                <Layers className="w-5 h-5 text-zinc-500" />
                <h1 className="text-xl font-bold text-foreground">Pipeline</h1>
            </div>

            {/* Tab switcher */}
            <div className="flex items-center gap-1 border-b">
                {TABS.map(({ id, label, Icon }) => (
                    <button
                        key={id}
                        onClick={() => setTab(id)}
                        className={cn(
                            "flex items-center gap-1.5 px-4 py-2 text-sm font-medium -mb-px border-b-2 transition-colors",
                            activeTab === id
                                ? "border-foreground text-foreground"
                                : "border-transparent text-zinc-500 hover:text-zinc-700",
                        )}
                    >
                        <Icon className="w-4 h-4" /> {label}
                    </button>
                ))}
            </div>

            {activeTab === "quotes" && <QuotesTab />}
            {activeTab === "jobs" && <JobsTab />}
            {activeTab === "invoices" && <InvoicesTab />}
        </div>
    );
}
