/**
 * Admin Generate Dispatch — editable form to send a contractor job brief.
 *
 * URL: /admin/dispatch/new?quoteId=<id>
 *
 * Pre-fills from GET /api/admin/dispatch/draft-from-quote/:quoteId, then lets
 * the operator edit title / tasks / bond / contractors / media before firing
 * POST /api/admin/dispatch (and a follow-up media upload). Styled to match the
 * dark admin sidebar dashboard (AdminDispatchDashboard.tsx) — same muted/card
 * tokens and accent colours so it slots in beside the dispatch list.
 */

import { useState, useMemo, useRef, useEffect } from "react";
import { useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
    Hammer, Loader2, Plus, X, Trash2, Upload, Camera, Video, ShieldCheck,
    Users, AlertTriangle, CheckCircle2, ArrowRight, ChevronLeft, FileText,
    Paperclip, MessageSquare, Copy as CopyIcon,
} from "lucide-react";
import { buildDispatchWhatsAppMessage } from "@/lib/whatsapp-dispatch-message";

// ───────────────────────────────────────────────────────────────────────────
// Types — mirror the backend draft response
// ───────────────────────────────────────────────────────────────────────────

interface DraftTask {
    num: number;
    title: string;
    description: string;
    category: string;
    tier: string;
    hours: number;
    payPence: number;
    payMethod: "floor" | "share";
    warning?: string;
    materials: string[];
}

interface DraftQuote {
    id: string;
    shortSlug: string;
    customerName: string;
    customerFirstName: string;
    customerPhone: string | null;
    customerEmail: string | null;
    customerAddress: string | null;
    postcode: string;
    contextualHeadline: string | null;
    selectedDate: string | null;
    selectedTierPricePence: number | null;
    depositPaidAt: string | null;
}

interface DraftContractor {
    id: string;
    name: string;
    phone: string | null;
}

interface DraftResponse {
    quote: DraftQuote;
    draft: {
        title: string;
        subtitle: string | null;
        scheduledDate: string | null;
        bondRequired: boolean;
        bondAmountPence: number;
        totalHours: number;
        totalContractorPayPence: number;
        customerRevenuePence: number;
        platformKeepsPence: number;
        tasks: DraftTask[];
        skippedLines: number;
    };
    contractors: DraftContractor[];
}

// File attached to a specific task by num (or "overview" for dispatch-level)
type MediaScope = { kind: "overview" } | { kind: "task"; taskNum: number };

interface PendingMedia {
    id: string;
    file: File;
    previewUrl: string;
    scope: MediaScope;
}

// ───────────────────────────────────────────────────────────────────────────
// Helpers
// ───────────────────────────────────────────────────────────────────────────

function fmt(pence: number | null | undefined): string {
    if (pence == null) return "—";
    return `£${(pence / 100).toFixed(2)}`;
}

function fmtDateInput(iso: string | null): string {
    if (!iso) return "";
    // Coerce ISO/Date string to yyyy-mm-dd for <input type="date">
    try {
        const d = new Date(iso);
        if (isNaN(d.getTime())) return "";
        const yyyy = d.getFullYear();
        const mm = String(d.getMonth() + 1).padStart(2, "0");
        const dd = String(d.getDate()).padStart(2, "0");
        return `${yyyy}-${mm}-${dd}`;
    } catch {
        return "";
    }
}

function fmtNiceDate(iso: string | null): string {
    if (!iso) return "TBC";
    try {
        return new Date(iso).toLocaleDateString("en-GB", {
            weekday: "short", day: "numeric", month: "short",
        });
    } catch {
        return "TBC";
    }
}

// PUT a single file directly to a presigned S3 URL with progress tracking.
function putToS3(file: File, putUrl: string, onProgress: (loaded: number) => void): Promise<void> {
    return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('PUT', putUrl, true);
        xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
        xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(e.loaded); };
        xhr.onload = () => {
            if (xhr.status >= 200 && xhr.status < 300) resolve();
            else reject(new Error(`S3 PUT ${xhr.status}: ${xhr.responseText.slice(0, 200)}`));
        };
        xhr.onerror = () => reject(new Error('S3 PUT network error'));
        xhr.ontimeout = () => reject(new Error('S3 PUT timed out'));
        xhr.send(file);
    });
}

function tierBadge(tier: string) {
    const map: Record<string, { bg: string; fg: string }> = {
        specialist: { bg: "bg-indigo-500/15", fg: "text-indigo-300" },
        skilled: { bg: "bg-teal-500/15", fg: "text-teal-300" },
        outdoor: { bg: "bg-amber-500/15", fg: "text-amber-300" },
        standard: { bg: "bg-slate-500/15", fg: "text-slate-300" },
    };
    const m = map[tier] || map.standard;
    return (
        <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold uppercase tracking-wider ${m.bg} ${m.fg}`}>
            {tier || "standard"}
        </span>
    );
}

// ───────────────────────────────────────────────────────────────────────────
// Materials chip editor (small inline component)
// ───────────────────────────────────────────────────────────────────────────

function MaterialsEditor({
    materials, onChange,
}: { materials: string[]; onChange: (next: string[]) => void }) {
    const [draft, setDraft] = useState("");

    function add() {
        const trimmed = draft.trim();
        if (!trimmed) return;
        if (materials.includes(trimmed)) { setDraft(""); return; }
        onChange([...materials, trimmed]);
        setDraft("");
    }
    function remove(i: number) {
        onChange(materials.filter((_, idx) => idx !== i));
    }

    return (
        <div>
            <div className="flex flex-wrap gap-1.5 mb-2">
                {materials.length === 0 && (
                    <span className="text-[11px] text-muted-foreground italic">No materials listed</span>
                )}
                {materials.map((m, i) => (
                    <span key={i} className="inline-flex items-center gap-1 bg-muted text-xs rounded-full px-2 py-0.5 border">
                        {m}
                        <button
                            type="button"
                            onClick={() => remove(i)}
                            className="hover:text-red-400 transition"
                            aria-label={`Remove ${m}`}
                        >
                            <X className="h-3 w-3" />
                        </button>
                    </span>
                ))}
            </div>
            <div className="flex gap-1.5">
                <input
                    type="text"
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => {
                        if (e.key === "Enter") { e.preventDefault(); add(); }
                    }}
                    placeholder="Add material + Enter"
                    className="flex-1 text-xs bg-background border rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
                <button
                    type="button"
                    onClick={add}
                    className="text-xs px-2 py-1 bg-muted hover:bg-muted/70 rounded border flex items-center gap-1"
                >
                    <Plus className="h-3 w-3" /> Add
                </button>
            </div>
        </div>
    );
}

// ───────────────────────────────────────────────────────────────────────────
// Media chip / preview
// ───────────────────────────────────────────────────────────────────────────

function MediaPreview({ pm, onRemove }: { pm: PendingMedia; onRemove: () => void }) {
    const isVid = pm.file.type.startsWith("video/");
    return (
        <div className="relative group h-20 w-20 rounded-lg overflow-hidden border bg-black/40 shrink-0">
            {isVid ? (
                <div className="h-full w-full flex flex-col items-center justify-center text-[10px] text-slate-300">
                    <Video className="h-5 w-5 mb-0.5" />
                    <span className="truncate max-w-[70px] px-1">{pm.file.name.slice(0, 10)}</span>
                </div>
            ) : (
                <img src={pm.previewUrl} alt={pm.file.name} className="h-full w-full object-cover" />
            )}
            <button
                type="button"
                onClick={onRemove}
                className="absolute top-1 right-1 bg-black/70 hover:bg-red-600 rounded-full p-0.5 opacity-0 group-hover:opacity-100 transition"
                aria-label="Remove"
            >
                <X className="h-3 w-3 text-white" />
            </button>
        </div>
    );
}

function MediaUploadZone({
    label, scope, items, onAdd, onRemove,
}: {
    label: string;
    scope: MediaScope;
    items: PendingMedia[];
    onAdd: (files: File[], scope: MediaScope) => void;
    onRemove: (id: string) => void;
}) {
    const inputRef = useRef<HTMLInputElement>(null);
    const [isDragging, setIsDragging] = useState(false);

    return (
        <div>
            <label className="text-xs font-bold text-muted-foreground uppercase tracking-wider block mb-2">{label}</label>
            <div
                onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={(e) => {
                    e.preventDefault();
                    setIsDragging(false);
                    const files = Array.from(e.dataTransfer.files);
                    if (files.length) onAdd(files, scope);
                }}
                className={`border-2 border-dashed rounded-lg p-3 transition ${
                    isDragging ? "border-blue-500 bg-blue-500/5" : "border-muted hover:border-muted-foreground/40"
                }`}
            >
                <div className="flex flex-wrap gap-2 items-center">
                    {items.map((pm) => (
                        <MediaPreview key={pm.id} pm={pm} onRemove={() => onRemove(pm.id)} />
                    ))}
                    <button
                        type="button"
                        onClick={() => inputRef.current?.click()}
                        className="h-20 w-20 rounded-lg border-2 border-dashed border-muted-foreground/30 hover:border-blue-500 flex flex-col items-center justify-center gap-1 text-muted-foreground hover:text-blue-400 transition"
                    >
                        <Upload className="h-4 w-4" />
                        <span className="text-[10px]">Add files</span>
                    </button>
                </div>
                <input
                    ref={inputRef}
                    type="file"
                    accept="image/*,video/*"
                    multiple
                    className="hidden"
                    onChange={(e) => {
                        const files = Array.from(e.target.files || []);
                        if (files.length) onAdd(files, scope);
                        if (inputRef.current) inputRef.current.value = "";
                    }}
                />
                <p className="text-[10px] text-muted-foreground mt-2">
                    Drag &amp; drop, or click to choose. Images and video accepted.
                </p>
            </div>
        </div>
    );
}

// ───────────────────────────────────────────────────────────────────────────
// Main page
// ───────────────────────────────────────────────────────────────────────────

export default function AdminGenerateDispatch() {
    const [, setLocation] = useLocation();

    // Parse ?quoteId from the URL
    const quoteId = useMemo(() => {
        try {
            return new URLSearchParams(window.location.search).get("quoteId") || "";
        } catch {
            return "";
        }
    }, []);

    // Fetch the draft
    const { data, isLoading, isError, error } = useQuery<DraftResponse>({
        queryKey: ["dispatch-draft", quoteId],
        queryFn: async () => {
            const r = await fetch(`/api/admin/dispatch/draft-from-quote/${quoteId}`);
            if (!r.ok) {
                const body = await r.json().catch(() => ({}));
                throw new Error(body.error || `Draft fetch failed (${r.status})`);
            }
            return r.json();
        },
        enabled: !!quoteId,
        retry: false,
    });

    // ─── Editable form state ──────────────────────────────────────────────
    const [title, setTitle] = useState("");
    const [scheduledDate, setScheduledDate] = useState("");
    const [tasks, setTasks] = useState<DraftTask[]>([]);
    const [bondRequired, setBondRequired] = useState(true);
    const [bondPounds, setBondPounds] = useState<number>(0);
    const [selectedContractorIds, setSelectedContractorIds] = useState<Set<string>>(new Set());
    const [pendingMedia, setPendingMedia] = useState<PendingMedia[]>([]);
    const [actionResult, setActionResult] = useState<{ kind: "ok" | "err"; msg: string } | null>(null);
    const [uploadPhase, setUploadPhase] = useState<string | null>(null);
    // After successful creation we surface the shareable link so admin can copy it
    // before navigating away.
    const [createdLink, setCreatedLink] = useState<{ dispatchId: string; publicUrl: string } | null>(null);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const successRef = useRef<HTMLDivElement | null>(null);

    // When the success card appears, scroll it into view — admin is at the
    // bottom of the form (where the Preview & Send button is), but the card
    // renders at the top, so without this they think nothing happened.
    useEffect(() => {
        if (createdLink && successRef.current) {
            successRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
    }, [createdLink]);

    // Hydrate state once draft arrives
    useEffect(() => {
        if (!data) return;
        setTitle(data.draft.title);
        setScheduledDate(fmtDateInput(data.draft.scheduledDate));
        setTasks(data.draft.tasks.map((t) => ({ ...t, materials: [...(t.materials || [])] })));
        setBondRequired(data.draft.bondRequired);
        setBondPounds(Math.round((data.draft.bondAmountPence || 0) / 100));
    }, [data]);

    // ─── Derived totals (sourced from engine; not editable) ──────────────
    const totalHours = data?.draft.totalHours ?? 0;
    const totalContractorPayPence = data?.draft.totalContractorPayPence ?? 0;
    const customerRevenuePence = data?.draft.customerRevenuePence ?? 0;
    const platformKeepsPence = data?.draft.platformKeepsPence ?? 0;
    const bondPence = Math.max(0, Math.round(bondPounds * 100));
    const recommendedBondPence = Math.round(totalContractorPayPence * 0.05);

    // ─── Task mutators ────────────────────────────────────────────────────
    function updateTask(num: number, patch: Partial<DraftTask>) {
        setTasks((prev) => prev.map((t) => (t.num === num ? { ...t, ...patch } : t)));
    }
    function removeTask(num: number) {
        setTasks((prev) => prev.filter((t) => t.num !== num));
        // also drop any pending media tied to this task
        setPendingMedia((prev) => prev.filter((m) => !(m.scope.kind === "task" && m.scope.taskNum === num)));
    }

    // ─── Media handlers ───────────────────────────────────────────────────
    // Hard cap matching the server's 200MB body limit (roughly — base64 inflates
    // ~33% so a 150MB file becomes ~200MB on the wire). Per-file cap is friendlier
    // than waiting for an upload to fail.
    const MAX_FILE_BYTES = 150 * 1024 * 1024;     // 150MB raw
    const WARN_FILE_BYTES = 50 * 1024 * 1024;     // 50MB friendly warning
    function addMedia(files: File[], scope: MediaScope) {
        const tooBig: string[] = [];
        const big: string[] = [];
        const accepted: File[] = [];
        for (const f of files) {
            if (f.size > MAX_FILE_BYTES) {
                tooBig.push(`${f.name} (${(f.size / (1024 * 1024)).toFixed(1)}MB)`);
                continue;
            }
            if (f.size > WARN_FILE_BYTES) big.push(`${f.name} (${(f.size / (1024 * 1024)).toFixed(1)}MB)`);
            accepted.push(f);
        }
        if (tooBig.length > 0) {
            setActionResult({
                kind: "err",
                msg: `${tooBig.length} file(s) over 150MB and skipped: ${tooBig.join(", ")}. Compress or trim videos before retrying.`,
            });
        } else if (big.length > 0) {
            setActionResult({
                kind: "ok",
                msg: `Heads up — ${big.join(", ")} ${big.length > 1 ? "are" : "is"} large. Upload may take a minute on slower connections.`,
            });
        }
        if (accepted.length === 0) return;
        const next = accepted.map((f) => ({
            id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            file: f,
            previewUrl: URL.createObjectURL(f),
            scope,
        }));
        setPendingMedia((prev) => [...prev, ...next]);
    }
    function removeMedia(id: string) {
        setPendingMedia((prev) => {
            const found = prev.find((m) => m.id === id);
            if (found) URL.revokeObjectURL(found.previewUrl);
            return prev.filter((m) => m.id !== id);
        });
    }
    // Cleanup object URLs on unmount
    useEffect(() => {
        return () => { pendingMedia.forEach((m) => URL.revokeObjectURL(m.previewUrl)); };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // ─── Contractor selection ─────────────────────────────────────────────
    function toggleContractor(id: string) {
        setSelectedContractorIds((prev) => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id); else next.add(id);
            return next;
        });
    }
    function selectAllContractors() {
        if (!data) return;
        const all = new Set(data.contractors.map((c) => c.id));
        setSelectedContractorIds(all);
    }
    function clearAllContractors() {
        setSelectedContractorIds(new Set());
    }

    // ─── Submit ───────────────────────────────────────────────────────────
    const dispatchMutation = useMutation({
        mutationFn: async (body: any) => {
            const r = await fetch("/api/admin/dispatch", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body),
            });
            const payload = await r.json().catch(() => ({}));
            if (!r.ok) throw new Error(payload.error || "Dispatch create failed");
            return payload;
        },
    });

    // Direct-to-S3 upload via presigned PUT URLs. Browser sends raw file bytes
    // straight to S3, with real progress events and no Express proxy in path.
    async function uploadMediaDirect(
        dispatchId: string,
        items: PendingMedia[],
        onPhase: (msg: string) => void,
    ): Promise<void> {
        const totalBytes = items.reduce((s, m) => s + m.file.size, 0);
        const totalMB = (totalBytes / (1024 * 1024)).toFixed(1);

        onPhase(`Requesting upload URLs…`);
        const presignResp = await fetch(`/api/admin/dispatch/${dispatchId}/media/presign`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                files: items.map((m) => ({
                    contentType: m.file.type || "application/octet-stream",
                    scope: m.scope,
                })),
            }),
        });
        const presignJson = await presignResp.json().catch(() => ({}));
        if (!presignResp.ok) throw new Error(presignJson.error || "Failed to get upload URLs");
        const uploads: Array<{ key: string; putUrl: string; publicUrl: string; scope: MediaScope }> = presignJson.uploads;
        if (!Array.isArray(uploads) || uploads.length !== items.length) {
            throw new Error("presign response shape unexpected");
        }

        const loadedPerFile = new Array(items.length).fill(0);
        const refreshPhase = () => {
            const loaded = loadedPerFile.reduce((a, b) => a + b, 0);
            const pct = totalBytes ? Math.min(99, Math.round((loaded / totalBytes) * 100)) : 0;
            onPhase(`Uploading ${totalMB} MB to S3 · ${pct}%`);
        };
        refreshPhase();

        // Run uploads in parallel — S3 handles each PUT independently.
        await Promise.all(items.map((m, i) => putToS3(m.file, uploads[i].putUrl, (loaded) => {
            loadedPerFile[i] = loaded;
            refreshPhase();
        })));

        onPhase(`Saving media to dispatch…`);
        const overviewUrls = uploads.filter((u) => u.scope.kind === "overview").map((u) => u.publicUrl);
        const taskGroups: Record<number, string[]> = {};
        for (const u of uploads) {
            if (u.scope.kind !== "task") continue;
            if (!taskGroups[u.scope.taskNum]) taskGroups[u.scope.taskNum] = [];
            taskGroups[u.scope.taskNum].push(u.publicUrl);
        }
        const taskMedia = Object.entries(taskGroups).map(([taskNum, urls]) => ({
            taskNum: Number(taskNum), urls,
        }));

        const regResp = await fetch(`/api/admin/dispatch/${dispatchId}/media/register`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ overviewUrls, taskMedia }),
        });
        if (!regResp.ok) {
            const payload = await regResp.json().catch(() => ({}));
            throw new Error(payload.error || "Failed to register uploaded media");
        }
    }

    async function handleSubmit() {
        // Hard guard against double-click — even though button is disabled, network
        // hiccups during a long video upload could let a user click twice.
        if (isSubmitting) return;
        setActionResult(null);
        setUploadPhase(null);

        // Validate
        if (!title.trim()) { setActionResult({ kind: "err", msg: "Title is required." }); return; }
        if (tasks.length === 0) { setActionResult({ kind: "err", msg: "At least one task is required." }); return; }
        // Note: contractor pre-selection is now optional — the open shareable
        // link lets contractors claim themselves from the pool. Zero is fine.
        if (!data) return;

        setIsSubmitting(true);
        setUploadPhase("Creating dispatch…");
        try {
            const body = {
                quoteId: data.quote.id,
                invoiceId: null,
                title: title.trim(),
                subtitle: data.draft.subtitle,
                postcode: data.quote.postcode,
                customerFirstName: data.quote.customerFirstName,
                customerFullName: data.quote.customerName,
                customerPhone: data.quote.customerPhone,
                customerAddress: data.quote.customerAddress,
                tasks,
                totalHours,
                totalContractorPayPence,
                customerRevenuePence,
                platformKeepsPence,
                contractorIds: Array.from(selectedContractorIds),
                bondRequired,
                bondAmountPence: bondRequired ? bondPence : 0,
                scheduledDate: scheduledDate || null,
                createdBy: "admin",
            };

            const dispatchResp = await dispatchMutation.mutateAsync(body);
            const dispatchId: string | undefined = dispatchResp?.dispatch?.id || dispatchResp?.id;
            if (!dispatchId) throw new Error("No dispatch id returned");
            const publicUrlPath: string | undefined = dispatchResp?.publicUrl
                || (dispatchResp?.dispatch?.publicToken ? `/dispatch-link/${dispatchResp.dispatch.publicToken}` : undefined);

            // Upload media if any — failure here does NOT roll back the dispatch.
            // The dispatch exists; admin can re-attach media via the dashboard.
            if (pendingMedia.length > 0) {
                try {
                    await uploadMediaDirect(dispatchId, pendingMedia, setUploadPhase);
                } catch (mediaErr: any) {
                    // Dispatch is created — surface the partial-success state clearly,
                    // but STILL show the shareable link + WhatsApp message so admin can
                    // share the job. Media can be re-attached later from the dashboard.
                    setActionResult({
                        kind: "err",
                        msg: `Media upload failed: ${mediaErr?.message || "unknown"}. The dispatch (#${dispatchId.slice(-6)}) was created — copy the link below and share it now. Re-attach media from the dispatch dashboard when ready.`,
                    });
                    if (publicUrlPath) {
                        setCreatedLink({ dispatchId, publicUrl: `${window.location.origin}${publicUrlPath}` });
                    }
                    setUploadPhase(null);
                    setIsSubmitting(false);
                    return;
                }
            }

            setUploadPhase("Done");
            // Show the shareable link card and let admin copy before navigating away
            if (publicUrlPath) {
                setCreatedLink({ dispatchId, publicUrl: `${window.location.origin}${publicUrlPath}` });
                setActionResult({ kind: "ok", msg: "Dispatch created — copy the link below to share with your contractor pool." });
            } else {
                setActionResult({ kind: "ok", msg: "Dispatch created. Redirecting…" });
                setTimeout(() => setLocation(`/admin/dispatch?new=${dispatchId}`), 600);
            }
        } catch (e: any) {
            setActionResult({ kind: "err", msg: e?.message || "Something went wrong." });
            setUploadPhase(null);
        } finally {
            setIsSubmitting(false);
        }
    }

    // ─── Loading / error gates ────────────────────────────────────────────
    if (!quoteId) {
        return (
            <div className="p-6 max-w-3xl mx-auto">
                <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-6">
                    <h1 className="font-bold text-lg flex items-center gap-2 text-amber-300">
                        <AlertTriangle className="h-5 w-5" /> Missing quoteId
                    </h1>
                    <p className="text-sm text-muted-foreground mt-2">
                        Open this page with <code>?quoteId=&lt;id&gt;</code> in the URL. Usually you'd land here from the
                        Recent Quotes admin view.
                    </p>
                </div>
            </div>
        );
    }

    if (isLoading) {
        return (
            <div className="p-10 flex flex-col items-center justify-center gap-3 text-muted-foreground">
                <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
                <p className="text-sm">Loading draft from quote...</p>
            </div>
        );
    }

    if (isError || !data) {
        return (
            <div className="p-6 max-w-3xl mx-auto">
                <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-6">
                    <h1 className="font-bold text-lg flex items-center gap-2 text-red-300">
                        <AlertTriangle className="h-5 w-5" /> Couldn't load draft
                    </h1>
                    <p className="text-sm text-muted-foreground mt-2">
                        {(error as Error)?.message || "Unknown error"}
                    </p>
                    <button
                        onClick={() => setLocation("/admin/dispatch")}
                        className="mt-4 text-sm px-3 py-1.5 rounded bg-muted hover:bg-muted/80 inline-flex items-center gap-1"
                    >
                        <ChevronLeft className="h-4 w-4" /> Back to Dispatch
                    </button>
                </div>
            </div>
        );
    }

    const overviewMedia = pendingMedia.filter((m) => m.scope.kind === "overview");

    // ─── Render ───────────────────────────────────────────────────────────
    return (
        <div className="p-6 max-w-5xl mx-auto pb-32">
            {/* Header */}
            <div className="flex items-center justify-between mb-6">
                <div>
                    <h1 className="text-2xl font-bold flex items-center gap-2">
                        <Hammer className="h-6 w-6 text-orange-500" />
                        Generate Contractor Dispatch
                    </h1>
                    <p className="text-sm text-muted-foreground mt-1">
                        Edit the brief, attach media, pick contractors, then send.
                    </p>
                </div>
                <button
                    onClick={() => setLocation("/admin/dispatch")}
                    className="text-sm px-3 py-1.5 rounded bg-muted hover:bg-muted/80 inline-flex items-center gap-1"
                >
                    <ChevronLeft className="h-4 w-4" /> Cancel
                </button>
            </div>

            {/* Quote summary chip strip */}
            <div className="bg-card border rounded-xl p-3 mb-4 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                <span className="font-mono font-semibold text-blue-400">Quote #{data.quote.shortSlug}</span>
                <span className="text-muted-foreground">·</span>
                <span className="font-semibold">{data.quote.customerName}</span>
                <span className="text-muted-foreground">·</span>
                <span>{data.quote.postcode}</span>
                <span className="text-muted-foreground">·</span>
                <span>Visit {fmtNiceDate(data.quote.selectedDate)}</span>
                <span className="text-muted-foreground">·</span>
                <span className="font-bold text-green-400">{fmt(data.quote.selectedTierPricePence)}</span>
                {data.quote.depositPaidAt && (
                    <span className="ml-auto text-[10px] px-2 py-0.5 rounded-full bg-green-500/15 text-green-300 font-bold uppercase tracking-wider">
                        Deposit paid
                    </span>
                )}
            </div>

            {/* Title + Date */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
                <div className="md:col-span-2">
                    <label className="text-xs font-bold text-muted-foreground uppercase tracking-wider block mb-1">Title</label>
                    <input
                        type="text"
                        value={title}
                        onChange={(e) => setTitle(e.target.value)}
                        className="w-full bg-background border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                        placeholder="e.g. Wollaton — Bathroom refresh + tiling"
                    />
                </div>
                <div>
                    <label className="text-xs font-bold text-muted-foreground uppercase tracking-wider block mb-1">Visit date</label>
                    <input
                        type="date"
                        value={scheduledDate}
                        onChange={(e) => setScheduledDate(e.target.value)}
                        className="w-full bg-background border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                    />
                </div>
            </div>

            {/* Skipped lines warning */}
            {data.draft.skippedLines > 0 && (
                <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-3 mb-4 flex items-start gap-2 text-xs">
                    <AlertTriangle className="h-4 w-4 text-amber-400 shrink-0 mt-0.5" />
                    <p className="text-amber-200">
                        {data.draft.skippedLines} line(s) had no category/time and were skipped from the engine.
                        Review the source quote to make sure nothing important was dropped.
                    </p>
                </div>
            )}

            {/* Engine totals strip */}
            <div className="bg-muted/30 border rounded-lg p-3 mb-6 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
                <span><span className="text-muted-foreground">Hours:</span> <span className="font-semibold">{totalHours}h</span></span>
                <span><span className="text-muted-foreground">Contractor pay:</span> <span className="font-semibold text-green-400">{fmt(totalContractorPayPence)}</span></span>
                <span><span className="text-muted-foreground">Customer revenue:</span> <span className="font-semibold">{fmt(customerRevenuePence)}</span></span>
                <span><span className="text-muted-foreground">Platform keeps:</span> <span className="font-semibold text-blue-400">{fmt(platformKeepsPence)}</span></span>
            </div>

            {/* Tasks */}
            <div className="mb-6">
                <h2 className="font-bold mb-3 flex items-center gap-2">
                    <FileText className="h-4 w-4 text-blue-500" /> Tasks ({tasks.length})
                </h2>
                <div className="space-y-3">
                    {tasks.map((t) => {
                        const taskMedia = pendingMedia.filter(
                            (m) => m.scope.kind === "task" && m.scope.taskNum === t.num,
                        );
                        return (
                            <div key={t.num} className="bg-card border rounded-xl p-4 space-y-3">
                                {/* Top row */}
                                <div className="flex items-start justify-between gap-2">
                                    <div className="flex items-center gap-2 flex-wrap">
                                        <span className="text-xs font-mono px-2 py-0.5 rounded bg-muted">#{t.num}</span>
                                        {tierBadge(t.tier)}
                                        <span className="text-xs text-muted-foreground">
                                            {t.hours}h · {fmt(t.payPence)} ({t.payMethod})
                                        </span>
                                    </div>
                                    <button
                                        type="button"
                                        onClick={() => removeTask(t.num)}
                                        className="text-xs text-red-400 hover:text-red-300 flex items-center gap-1"
                                    >
                                        <Trash2 className="h-3.5 w-3.5" /> Remove
                                    </button>
                                </div>

                                {/* Title */}
                                <div>
                                    <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider block mb-1">Title</label>
                                    <input
                                        type="text"
                                        value={t.title}
                                        onChange={(e) => updateTask(t.num, { title: e.target.value })}
                                        className="w-full bg-background border rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                                    />
                                </div>

                                {/* Description */}
                                <div>
                                    <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider block mb-1">Description</label>
                                    <textarea
                                        value={t.description}
                                        onChange={(e) => updateTask(t.num, { description: e.target.value })}
                                        rows={3}
                                        className="w-full bg-background border rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                                    />
                                </div>

                                {/* Warning */}
                                <div>
                                    <label className="text-[10px] font-bold text-amber-400 uppercase tracking-wider block mb-1 flex items-center gap-1">
                                        <AlertTriangle className="h-3 w-3" /> Warning (optional)
                                    </label>
                                    <textarea
                                        value={t.warning || ""}
                                        onChange={(e) => updateTask(t.num, { warning: e.target.value || undefined })}
                                        rows={2}
                                        placeholder="e.g. Lockbox at side gate. Allergic dog upstairs."
                                        className="w-full bg-amber-500/5 border border-amber-500/20 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-amber-500"
                                    />
                                </div>

                                {/* Materials */}
                                <div>
                                    <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider block mb-1">Materials</label>
                                    <MaterialsEditor
                                        materials={t.materials}
                                        onChange={(next) => updateTask(t.num, { materials: next })}
                                    />
                                </div>

                                {/* Per-task media */}
                                <div>
                                    <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider block mb-1 flex items-center gap-1">
                                        <Paperclip className="h-3 w-3" /> Photos / video for this task
                                    </label>
                                    <MediaUploadZone
                                        label=""
                                        scope={{ kind: "task", taskNum: t.num }}
                                        items={taskMedia}
                                        onAdd={addMedia}
                                        onRemove={removeMedia}
                                    />
                                </div>
                            </div>
                        );
                    })}
                    {tasks.length === 0 && (
                        <div className="bg-muted/30 rounded-xl p-6 text-center text-sm text-muted-foreground">
                            All tasks were removed. Add one back, or refresh the draft.
                        </div>
                    )}
                </div>
            </div>

            {/* Overview media */}
            <div className="mb-6 bg-card border rounded-xl p-4">
                <h2 className="font-bold mb-3 flex items-center gap-2">
                    <Camera className="h-4 w-4 text-blue-500" /> Overview media
                </h2>
                <p className="text-xs text-muted-foreground mb-3">
                    These are dispatch-level photos / videos (e.g. front of property, full-room overview).
                    Per-task media goes inside each task above.
                </p>
                <MediaUploadZone
                    label="Drag &amp; drop overview files"
                    scope={{ kind: "overview" }}
                    items={overviewMedia}
                    onAdd={addMedia}
                    onRemove={removeMedia}
                />
            </div>

            {/* Bond */}
            <div className="mb-6 bg-card border rounded-xl p-4">
                <h2 className="font-bold mb-3 flex items-center gap-2">
                    <ShieldCheck className="h-4 w-4 text-amber-400" /> Bond
                </h2>
                <label className="flex items-center gap-2 text-sm mb-3 cursor-pointer">
                    <input
                        type="checkbox"
                        checked={bondRequired}
                        onChange={(e) => setBondRequired(e.target.checked)}
                        className="h-4 w-4"
                    />
                    Require contractor bond before lock-in
                </label>
                {bondRequired && (
                    <div className="flex items-center gap-3 flex-wrap">
                        <div>
                            <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider block mb-1">Bond £</label>
                            <input
                                type="number"
                                min={0}
                                step={1}
                                value={bondPounds}
                                onChange={(e) => setBondPounds(Number(e.target.value) || 0)}
                                className="w-32 bg-background border rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-amber-500"
                            />
                        </div>
                        <div className="text-xs text-muted-foreground">
                            5% of contractor pay = <span className="font-semibold text-amber-300">{fmt(recommendedBondPence)}</span>
                            {bondPence !== recommendedBondPence && (
                                <button
                                    type="button"
                                    onClick={() => setBondPounds(Math.round(recommendedBondPence / 100))}
                                    className="ml-2 underline hover:text-amber-300"
                                >
                                    Use recommended
                                </button>
                            )}
                        </div>
                    </div>
                )}
            </div>

            {/* Distribution model — open shareable link (single URL → contractor pool picks themselves) */}
            <div className="mb-6 bg-card border rounded-xl p-4">
                <h2 className="font-bold flex items-center gap-2 mb-2">
                    <Users className="h-4 w-4 text-blue-500" /> How this gets sent
                </h2>
                <div className="bg-blue-500/[0.06] border border-blue-500/30 rounded-lg p-3 text-sm leading-relaxed">
                    <p className="font-semibold text-blue-300 mb-1">Open shareable link</p>
                    <p className="text-muted-foreground">
                        On send, you'll get one URL to copy and paste into your contractor WhatsApp group.
                        Anyone in your <span className="font-semibold text-foreground">{data.contractors.length}-contractor pool</span> can open it,
                        pick themselves, and pay the security bond. <span className="font-semibold text-foreground">First to pay locks the job.</span>
                    </p>
                </div>
                <details className="mt-3 text-xs text-muted-foreground">
                    <summary className="cursor-pointer hover:text-foreground">Advanced: send to specific contractors only</summary>
                    <div className="pt-2 space-y-2">
                        <p>
                            You can ALSO pre-broadcast to specific contractors (they'll get private per-contractor links instead of needing to identify themselves).
                        </p>
                        <div className="flex gap-3">
                            <button type="button" onClick={selectAllContractors} className="text-blue-400 hover:underline">
                                Select all ({data.contractors.length})
                            </button>
                            <button type="button" onClick={clearAllContractors} className="text-muted-foreground hover:underline">
                                Clear
                            </button>
                            <span className="ml-auto">
                                {selectedContractorIds.size} pre-selected
                            </span>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-1.5 max-h-48 overflow-y-auto">
                            {data.contractors.map((c) => {
                                const checked = selectedContractorIds.has(c.id);
                                return (
                                    <label
                                        key={c.id}
                                        className={`flex items-center gap-2 p-1.5 rounded text-xs border cursor-pointer transition ${
                                            checked ? "bg-blue-500/10 border-blue-500/40" : "bg-background hover:bg-muted/40"
                                        }`}
                                    >
                                        <input type="checkbox" checked={checked} onChange={() => toggleContractor(c.id)} className="h-3 w-3" />
                                        <span className="truncate">{c.name}</span>
                                    </label>
                                );
                            })}
                        </div>
                    </div>
                </details>
            </div>

            {/* Action banner / toast */}
            {actionResult && (
                <div
                    className={`mb-4 rounded-lg p-3 text-sm border flex items-start gap-2 ${
                        actionResult.kind === "ok"
                            ? "bg-green-500/10 border-green-500/30 text-green-300"
                            : "bg-red-500/10 border-red-500/30 text-red-300"
                    }`}
                >
                    {actionResult.kind === "ok"
                        ? <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5" />
                        : <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />}
                    <span>{actionResult.msg}</span>
                </div>
            )}

            {/* Created — shareable link + WhatsApp broadcast message */}
            {createdLink && (() => {
                // Build the WhatsApp message — use form state for contractor pay /
                // bond / postcode / first preferred date so admins can edit and rebuild.
                const firstPref = data?.draft?.scheduledDate ? new Date(data.draft.scheduledDate).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }) : null;
                const fullMsg = buildDispatchWhatsAppMessage({
                    publicUrl: createdLink.publicUrl,
                    postcode: data?.quote?.postcode || null,
                    contractorPayPence: totalContractorPayPence,
                    bondAmountPence: bondRequired ? bondPence : null,
                    taskCount: tasks.length,
                    proposalSummary: data?.draft?.subtitle || null,
                    firstPreferredDate: firstPref,
                    flavour: 'full',
                });
                const shortMsg = buildDispatchWhatsAppMessage({
                    publicUrl: createdLink.publicUrl,
                    postcode: data?.quote?.postcode || null,
                    contractorPayPence: totalContractorPayPence,
                    bondAmountPence: bondRequired ? bondPence : null,
                    taskCount: tasks.length,
                    proposalSummary: data?.draft?.subtitle || null,
                    firstPreferredDate: firstPref,
                    flavour: 'short',
                });
                return (
                    <div ref={successRef} className="mb-6 bg-gradient-to-br from-blue-500/[0.08] to-card border-2 border-blue-500/40 rounded-xl p-5 space-y-4 scroll-mt-4">
                        <div>
                            <h3 className="font-bold text-base mb-2 flex items-center gap-2">
                                <CheckCircle2 className="h-5 w-5 text-green-400" /> Shareable link ready
                            </h3>
                            <p className="text-sm text-muted-foreground mb-3">
                                Use the WhatsApp message below — it explains the system + bond so contractors don't ask. The link is embedded.
                            </p>
                            <div className="flex items-center gap-2">
                                <input
                                    type="text"
                                    readOnly
                                    value={createdLink.publicUrl}
                                    onClick={(e) => (e.target as HTMLInputElement).select()}
                                    className="flex-1 bg-background border rounded-lg px-3 py-2 text-sm font-mono select-all"
                                />
                                <button
                                    type="button"
                                    onClick={() => {
                                        navigator.clipboard.writeText(createdLink.publicUrl);
                                        setActionResult({ kind: "ok", msg: "Link copied to clipboard." });
                                    }}
                                    className="text-sm px-3 py-2 rounded bg-muted hover:bg-muted/80 inline-flex items-center gap-1.5"
                                >
                                    <CopyIcon className="h-3.5 w-3.5" /> Link
                                </button>
                            </div>
                        </div>

                        {/* Full broadcast message preview — editable to copy/tweak */}
                        <div>
                            <div className="flex items-baseline justify-between mb-2">
                                <h4 className="font-semibold text-sm flex items-center gap-1.5">
                                    <MessageSquare className="h-4 w-4 text-[#25D366]" /> WhatsApp broadcast — full explainer
                                </h4>
                                <span className="text-[11px] text-muted-foreground">For new groups / first sends</span>
                            </div>
                            <textarea
                                readOnly
                                value={fullMsg}
                                rows={Math.min(16, fullMsg.split('\n').length + 1)}
                                onClick={(e) => (e.target as HTMLTextAreaElement).select()}
                                className="w-full bg-background border rounded-lg px-3 py-2 text-[13px] font-mono whitespace-pre-wrap select-all leading-snug"
                            />
                            <div className="flex flex-wrap gap-2 mt-2">
                                <button
                                    type="button"
                                    onClick={() => {
                                        navigator.clipboard.writeText(fullMsg);
                                        setActionResult({ kind: "ok", msg: "Full message copied — paste into WhatsApp." });
                                    }}
                                    className="text-sm px-3 py-1.5 rounded bg-blue-600 hover:bg-blue-500 text-white font-semibold inline-flex items-center gap-1.5"
                                >
                                    <CopyIcon className="h-3.5 w-3.5" /> Copy full message
                                </button>
                                <a
                                    href={`https://wa.me/?text=${encodeURIComponent(fullMsg)}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-sm px-3 py-1.5 rounded bg-[#25D366]/15 text-[#25D366] hover:bg-[#25D366]/25 inline-flex items-center gap-1.5 border border-[#25D366]/30"
                                >
                                    <MessageSquare className="h-3.5 w-3.5" /> Send via WhatsApp
                                </a>
                            </div>
                        </div>

                        {/* Short version for repeat broadcasts */}
                        <details className="group">
                            <summary className="cursor-pointer text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 list-none">
                                <span className="group-open:hidden">Show short version (for known contractors)</span>
                                <span className="hidden group-open:inline">Hide short version</span>
                            </summary>
                            <textarea
                                readOnly
                                value={shortMsg}
                                rows={Math.min(10, shortMsg.split('\n').length + 1)}
                                onClick={(e) => (e.target as HTMLTextAreaElement).select()}
                                className="mt-2 w-full bg-background border rounded-lg px-3 py-2 text-[13px] font-mono whitespace-pre-wrap select-all leading-snug"
                            />
                            <button
                                type="button"
                                onClick={() => {
                                    navigator.clipboard.writeText(shortMsg);
                                    setActionResult({ kind: "ok", msg: "Short message copied." });
                                }}
                                className="mt-2 text-sm px-3 py-1.5 rounded bg-muted hover:bg-muted/80 inline-flex items-center gap-1.5"
                            >
                                <CopyIcon className="h-3.5 w-3.5" /> Copy short
                            </button>
                        </details>

                        <div className="pt-3 border-t border-border/50 flex justify-end">
                            <button
                                type="button"
                                onClick={() => setLocation(`/admin/dispatch?new=${createdLink.dispatchId}`)}
                                className="text-sm px-3 py-1.5 rounded bg-muted hover:bg-muted/80"
                            >
                                Done — view dispatch →
                            </button>
                        </div>
                    </div>
                );
            })()}

            {/* Sticky action row */}
            <div className="fixed bottom-0 left-0 right-0 bg-background/95 backdrop-blur border-t z-40">
                <div className="max-w-5xl mx-auto px-6 py-3 flex items-center justify-between gap-3">
                    <div className="text-xs text-muted-foreground hidden sm:block">
                        {tasks.length} task(s) · {selectedContractorIds.size} contractor(s) ·{" "}
                        {pendingMedia.length} media file(s)
                    </div>
                    <div className="flex items-center gap-2 ml-auto">
                        {/* Phase indicator — shown next to the button during long uploads
                            so the user has live feedback instead of a "frozen" spinner */}
                        {isSubmitting && uploadPhase && (
                            <span className="text-xs text-blue-300 inline-flex items-center gap-1.5 mr-1">
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                {uploadPhase}
                            </span>
                        )}
                        <button
                            type="button"
                            onClick={() => setLocation("/admin/dispatch")}
                            className="text-sm px-4 py-2 rounded bg-muted hover:bg-muted/80"
                            disabled={isSubmitting}
                        >
                            Cancel
                        </button>
                        <button
                            type="button"
                            onClick={handleSubmit}
                            disabled={isSubmitting}
                            className="text-sm px-4 py-2 rounded bg-blue-600 hover:bg-blue-500 text-white font-semibold inline-flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            {isSubmitting ? (
                                <><Loader2 className="h-4 w-4 animate-spin" /> Sending…</>
                            ) : (
                                <>Preview &amp; Send <ArrowRight className="h-4 w-4" /></>
                            )}
                        </button>
                    </div>
                </div>
            </div>

            {/* Full-screen overlay during upload so it's IMPOSSIBLE to think
                the page is frozen. Click-blocking + visible progress text. */}
            {isSubmitting && (
                <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center pointer-events-auto">
                    <div className="bg-card border rounded-2xl shadow-2xl p-6 max-w-sm mx-4 text-center">
                        <Loader2 className="h-8 w-8 animate-spin text-blue-500 mx-auto mb-3" />
                        <p className="font-semibold text-base mb-1">{uploadPhase || "Sending…"}</p>
                        <p className="text-xs text-muted-foreground">
                            Don't close this tab. Large videos can take up to a minute.
                        </p>
                    </div>
                </div>
            )}
        </div>
    );
}
