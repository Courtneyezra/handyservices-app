/**
 * The in-chat quote card (Phase 4 / B; locked spec 18 Aug 2026; P8 / C, 3 Sep 2026: the ONE
 * entry into a quote from a thread — the legacy QuotePrepPanel slide-over is gone).
 *
 * A COMPACT review card in the thread panel, fed by THE intake (GET /api/spine/quote-intake/:id →
 * server/intake.ts getIntake: the spine clerk's artifact with any human lane override applied, the
 * legacy blob only for pre-spine threads). Not the builder embedded: the readiness lane (one
 * vocabulary, shared/intake-readiness.ts), name, postcode, customer type, the job lines
 * (editable), the clerk's open gaps, the thread's media as tickable thumbnails (all ticked), and
 * the actions:
 *
 *   - "Price and send"     once pane A's chain has priced a draft → /admin/price/<slug> (pane B)
 *   - "Estimating…"        while the chain runs (quote_pending)
 *   - "Save draft quote"   an UNSENT draft (nothing reaches the customer) when no priced draft exists
 *   - "Open full builder"  the same prefill, one tap away, always
 *   - "Re-run clerk"       asks the spine clerk for a fresh intake (202; the card updates when it lands)
 *
 * visit_first and decline explain what the spine has drafted for Ben's approval. When the name or
 * postcode is missing the card says so and "Ask now" sends the rules layer's content-free ask,
 * approved by the signed-in human. Renders nothing when the thread has no intake. Prices never
 * appear here: the card carries none and asks for none.
 */
import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, ClipboardList, ExternalLink, Loader2, Plus, PoundSterling, RefreshCw, Save, Send, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { READINESS_UI, isIntakeReadiness, readinessUi, type IntakeReadiness } from '@shared/intake-readiness';

type CustomerType = 'homeowner' | 'landlord' | 'letting_agent' | 'business';
const CUSTOMER_TYPES: Array<{ value: CustomerType; label: string }> = [
    { value: 'homeowner', label: 'Homeowner' },
    { value: 'landlord', label: 'Landlord' },
    { value: 'letting_agent', label: 'Letting agent' },
    { value: 'business', label: 'Business' },
];

interface CardLine { key: string; title: string; category: string; qty: string; notes: string; assumptions: string[] }
interface MediaItem { id: string; url: string; mimeType: string | null; kind: 'image' | 'video' | 'other'; at: string | null }
export interface CardEstimate {
    id: string;
    status: string;
    phase: 'running' | 'done' | 'failed';
    createdAt: string | null;
    draftQuoteId: string | null;
    draftSlug: string | null;
}
export interface CardPayload {
    available: true;
    runId: string | null;
    at: string;
    summary: string;
    intake: {
        customerName: string | null;
        postcode: string | null;
        customerType: CustomerType;
        readiness: IntakeReadiness | string | null;
        lines: Array<{ title: string; category?: string | null; qty?: number | null; notes?: string | null; assumptions?: string[] }>;
        assumptions: string[];
        gaps: Array<{ question: string; audience: string; lineIndex: number | null }>;
        declineReason?: string | null;
    };
    missing: Array<'name' | 'postcode'>;
    media: MediaItem[];
    source?: 'spine' | 'legacy';
    clerkReadiness?: string | null;
    override?: { readiness: string; by: string; at: string; reason: string | null } | null;
    overrideApplied?: boolean;
    estimate?: CardEstimate | null;
}

function authHeaders(): Record<string, string> {
    const token = localStorage.getItem('adminToken');
    return token ? { Authorization: `Bearer ${token}` } : {};
}

/** Which primary action the card shows for a payload — pure, so the states can be tested directly. */
export function cardPrimaryAction(p: Pick<CardPayload, 'intake' | 'estimate'>): 'price_and_send' | 'estimating' | 'save_draft' {
    if (p.estimate?.draftSlug) return 'price_and_send';
    if (p.intake.readiness === 'quote_pending' || p.estimate?.phase === 'running') return 'estimating';
    return 'save_draft';
}

export function QuoteIntakeCard({ conversationId, onSaved, variant = 'thread' }: {
    conversationId: string;
    onSaved?: (r: { slug: string; editUrl: string }) => void;
    /** 'portal' = the phone review page: same card, roomier tap targets. */
    variant?: 'thread' | 'portal';
}) {
    const queryClient = useQueryClient();
    const { data } = useQuery<CardPayload | null>({
        queryKey: ['quote-intake', conversationId],
        queryFn: async () => {
            const res = await fetch(`/api/spine/quote-intake/${conversationId}`, { headers: authHeaders() });
            if (res.status === 404) return null;
            if (!res.ok) throw new Error('Failed to load the quote intake');
            return res.json();
        },
        staleTime: 30_000,
        // While the chain is estimating, poll so "Estimating…" turns into "Price and send" by itself.
        refetchInterval: (q) => {
            const d = q.state.data as CardPayload | null | undefined;
            return d && cardPrimaryAction(d) === 'estimating' ? 15_000 : false;
        },
    });

    const [name, setName] = useState('');
    const [postcode, setPostcode] = useState('');
    const [customerType, setCustomerType] = useState<CustomerType>('homeowner');
    const [lines, setLines] = useState<CardLine[]>([]);
    const [ticked, setTicked] = useState<Set<string>>(new Set());
    const [saved, setSaved] = useState<{ slug: string; editUrl: string } | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [notice, setNotice] = useState<string | null>(null);

    // Seed the editable state from the artifact whenever a NEW run lands (keyed on runId), so
    // Ben's in-progress edits survive an unrelated refetch but a fresh clerk run resets them.
    useEffect(() => {
        if (!data) return;
        setName(data.intake.customerName ?? '');
        setPostcode(data.intake.postcode ?? '');
        setCustomerType(data.intake.customerType ?? 'homeowner');
        setLines(data.intake.lines.map((l, i) => ({
            key: `l${i}`, title: l.title, category: l.category ?? '', qty: l.qty ? String(l.qty) : '', notes: l.notes ?? '', assumptions: l.assumptions ?? [],
        })));
        setTicked(new Set(data.media.map((m) => m.id))); // all ticked by default; Ben unticks
        setSaved(null);
        setError(null);
    }, [data?.runId ?? data?.at]); // eslint-disable-line react-hooks/exhaustive-deps

    const missing = useMemo(() => ({ name: !name.trim(), postcode: !postcode.trim() }), [name, postcode]);

    const ask = useMutation({
        mutationFn: async (kind: 'ask_postcode' | 'ask_name' | 'ask_media') => {
            const res = await fetch(`/api/spine/ask/${conversationId}`, {
                method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders() }, body: JSON.stringify({ kind }),
            });
            const body = await res.json().catch(() => ({}));
            if (!res.ok && res.status !== 202) throw new Error(body.reason || body.detail || 'Ask failed');
            return body as { sent: boolean; reason: string; suppressedBy?: string | null };
        },
        onError: (e: Error) => setError(e.message),
        onSuccess: () => { setError(null); queryClient.invalidateQueries({ queryKey: ['comms-thread', conversationId] }); },
    });

    const save = useMutation({
        mutationFn: async () => {
            const res = await fetch(`/api/spine/quote-intake/${conversationId}/save-draft`, {
                method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders() },
                body: JSON.stringify({
                    lines: lines.filter((l) => l.title.trim()).map((l) => ({ title: l.title, category: l.category || null, qty: l.qty ? Number(l.qty) : null, notes: l.notes || null, assumptions: l.assumptions })),
                    customerType, name, postcode, mediaIds: Array.from(ticked),
                }),
            });
            const body = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error((body.errors ?? [body.error ?? 'Save failed']).join(' '));
            return body as { ok: true; id: string; slug: string; editUrl: string };
        },
        onSuccess: (r) => { setSaved({ slug: r.slug, editUrl: r.editUrl }); setError(null); onSaved?.(r); queryClient.invalidateQueries({ queryKey: ['comms-board'] }); },
        onError: (e: Error) => setError(e.message),
    });

    const rerun = useMutation({
        mutationFn: async () => {
            const res = await fetch(`/api/agents/quote-prep/${conversationId}`, { method: 'POST', headers: authHeaders() });
            const body = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(body.message || body.error || 'Could not request a clerk run');
            return body as { queued: boolean; mode?: string; message?: string };
        },
        onSuccess: (r) => { setError(null); setNotice(r.message ?? 'Clerk run requested.'); },
        onError: (e: Error) => setError(e.message),
    });

    if (!data) return null;

    const openFullBuilder = () => {
        // Same handoff the old panel used — the builder's prefill effect consumes it.
        sessionStorage.setItem('quoteFromComms', JSON.stringify({
            customerName: name || null, postcode: postcode || null, customerType,
            lines: lines.filter((l) => l.title.trim()).map((l) => ({ title: l.title, detail: l.notes, assumptions: l.assumptions, category: l.category || null })),
            assumptions: data.intake.assumptions, readiness: data.intake.readiness ?? 'needs_info', gaps: data.intake.gaps,
            mediaUrls: data.media.filter((m) => ticked.has(m.id)).map((m) => m.url),
        }));
        window.location.href = '/admin/generate-contextual-quote';
    };

    const updateLine = (key: string, patch: Partial<CardLine>) => setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));
    const toggleMedia = (id: string) => setTicked((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
    const busy = save.isPending;
    const readiness = data.intake.readiness;
    const ui = readinessUi(readiness);
    const primary = cardPrimaryAction(data);
    const portal = variant === 'portal';
    const btn = portal ? 'h-11 px-4 text-sm' : 'px-3 py-1.5 text-xs';

    return (
        <div className={cn('border-t-2 border-violet-700 bg-violet-50/40 px-3 py-2 text-sm', portal && 'rounded-xl border border-violet-200')} data-testid="quote-intake-card">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-1">
                <span className="flex flex-wrap items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-violet-900">
                    <ClipboardList className="h-3.5 w-3.5" /> Quote intake
                    {readiness && (
                        <span className={cn('inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-bold', ui.pill)} title={ui.blurb} data-testid="readiness-pill">
                            {readiness === 'quote_pending' && <Loader2 className="h-2.5 w-2.5 animate-spin" />}
                            {ui.label}
                        </span>
                    )}
                    {data.source === 'legacy' && (
                        <span className="rounded bg-slate-200 px-1.5 py-0.5 text-[10px] font-semibold normal-case tracking-normal text-slate-600" title="A pre-spine intake from the legacy clerk. Re-run the clerk for a fresh one.">legacy intake</span>
                    )}
                    <span className="font-normal normal-case tracking-normal text-violet-700">{data.summary}</span>
                </span>
                <span className="text-[10px] text-slate-500">clerk run {new Date(data.at).toLocaleString('en-GB', { hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short' })}</span>
            </div>

            {isIntakeReadiness(readiness) && (
                <p className="mb-2 text-[11px] text-slate-600">
                    {READINESS_UI[readiness].blurb}
                    {readiness === 'decline' && data.intake.declineReason && <> Reason: <span className="font-semibold">{data.intake.declineReason.replace(/_/g, ' ')}</span>.</>}
                </p>
            )}
            {data.overrideApplied && data.override && (
                <p className="mb-2 text-[11px] text-amber-800" data-testid="override-note">
                    Lane set by {data.override.by} ({data.override.reason ?? 'no reason given'}); the clerk said {readinessUi(data.clerkReadiness).label.toLowerCase()}.
                </p>
            )}

            {/* Customer */}
            <div className="mb-2 grid grid-cols-1 gap-2 sm:grid-cols-3">
                <label className="text-[11px] font-semibold text-slate-600">
                    Name
                    <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Customer" disabled={busy}
                        className="mt-0.5 w-full rounded border border-slate-300 bg-white px-2 py-1 text-sm font-normal text-slate-900" />
                </label>
                <label className="text-[11px] font-semibold text-slate-600">
                    Postcode
                    <input value={postcode} onChange={(e) => setPostcode(e.target.value.toUpperCase())} placeholder="NG1 1AA" disabled={busy}
                        className="mt-0.5 w-full rounded border border-slate-300 bg-white px-2 py-1 text-sm font-normal uppercase text-slate-900" />
                </label>
                <label className="text-[11px] font-semibold text-slate-600">
                    Customer type
                    <select value={customerType} onChange={(e) => setCustomerType(e.target.value as CustomerType)} disabled={busy}
                        className="mt-0.5 w-full rounded border border-slate-300 bg-white px-2 py-1 text-sm font-normal text-slate-900">
                        {CUSTOMER_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                    </select>
                </label>
            </div>

            {(missing.name || missing.postcode) && (
                <div className="mb-2 flex flex-wrap items-center gap-1.5">
                    {missing.postcode && (
                        <span className="flex items-center gap-1 rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-900">
                            Waiting on postcode
                            <button type="button" disabled={ask.isPending} onClick={() => ask.mutate('ask_postcode')} className="ml-1 flex items-center gap-0.5 rounded bg-amber-200 px-1.5 text-[10px] hover:bg-amber-300 disabled:opacity-50">
                                {ask.isPending && ask.variables === 'ask_postcode' ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />} Ask now
                            </button>
                        </span>
                    )}
                    {missing.name && (
                        <span className="flex items-center gap-1 rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-900">
                            Waiting on name
                            <button type="button" disabled={ask.isPending} onClick={() => ask.mutate('ask_name')} className="ml-1 flex items-center gap-0.5 rounded bg-amber-200 px-1.5 text-[10px] hover:bg-amber-300 disabled:opacity-50">
                                {ask.isPending && ask.variables === 'ask_name' ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />} Ask now
                            </button>
                        </span>
                    )}
                    {ask.data && !ask.data.sent && (
                        <span className="text-[11px] text-slate-500">Not sent: {ask.data.suppressedBy ?? ask.data.reason}</span>
                    )}
                </div>
            )}

            {/* Lines */}
            <div className="mb-2 space-y-1">
                {lines.map((l) => (
                    <div key={l.key} className="flex items-start gap-1.5">
                        <input value={l.title} onChange={(e) => updateLine(l.key, { title: e.target.value })} placeholder="Job line" disabled={busy}
                            className="min-w-0 flex-1 rounded border border-slate-300 bg-white px-2 py-1 text-sm text-slate-900" />
                        <input value={l.category} onChange={(e) => updateLine(l.key, { category: e.target.value })} placeholder="category" disabled={busy}
                            className="w-28 rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700" />
                        <input value={l.qty} onChange={(e) => updateLine(l.key, { qty: e.target.value })} placeholder="qty" inputMode="numeric" disabled={busy}
                            className="w-12 rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700" />
                        <button type="button" onClick={() => setLines((prev) => prev.filter((x) => x.key !== l.key))} disabled={busy} title="Remove line"
                            className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-700 disabled:opacity-50">
                            <Trash2 className="h-3.5 w-3.5" />
                        </button>
                    </div>
                ))}
                <button type="button" disabled={busy} onClick={() => setLines((prev) => [...prev, { key: `n${Date.now()}`, title: '', category: '', qty: '', notes: '', assumptions: [] }])}
                    className="flex items-center gap-1 text-[11px] font-semibold text-violet-800 hover:underline disabled:opacity-50">
                    <Plus className="h-3 w-3" /> Add line
                </button>
            </div>

            {/* Gaps — the clerk's open questions, by audience */}
            {data.intake.gaps.length > 0 && (
                <div className="mb-2" data-testid="intake-gaps">
                    <div className="mb-1 text-[10px] font-bold uppercase tracking-wide text-slate-500">Still open ({data.intake.gaps.length})</div>
                    <ul className="space-y-0.5">
                        {data.intake.gaps.map((g, i) => (
                            <li key={i} className="flex items-start gap-1.5 text-[11px] text-slate-700">
                                <span className={cn('mt-0.5 shrink-0 rounded px-1 text-[9px] font-bold uppercase', g.audience === 'ben' ? 'bg-slate-200 text-slate-700' : 'bg-amber-100 text-amber-800')}>
                                    {g.audience === 'ben' ? 'Ben' : 'customer'}
                                </span>
                                <span>{g.question}{g.lineIndex ? <span className="text-slate-400"> · line {g.lineIndex}</span> : null}</span>
                            </li>
                        ))}
                    </ul>
                </div>
            )}

            {/* Media */}
            {data.media.length > 0 && (
                <div className="mb-2">
                    <div className="mb-1 text-[10px] font-bold uppercase tracking-wide text-slate-500">On the quote ({ticked.size}/{data.media.length})</div>
                    <div className="flex flex-wrap gap-1.5">
                        {data.media.map((m) => {
                            const on = ticked.has(m.id);
                            return (
                                <button key={m.id} type="button" onClick={() => toggleMedia(m.id)} disabled={busy} title={on ? 'On the quote (click to remove)' : 'Off the quote (click to add)'}
                                    className={cn('relative overflow-hidden rounded border-2', portal ? 'h-16 w-16' : 'h-14 w-14', on ? 'border-emerald-500' : 'border-slate-300 opacity-50')}>
                                    {m.kind === 'video'
                                        ? <video src={m.url} className="h-full w-full object-cover" muted />
                                        : <img src={m.url} alt="" className="h-full w-full object-cover" />}
                                    <span className={cn('absolute right-0.5 top-0.5 rounded-full p-0.5', on ? 'bg-emerald-500 text-white' : 'bg-white text-slate-400')}>
                                        <Check className="h-2.5 w-2.5" />
                                    </span>
                                </button>
                            );
                        })}
                    </div>
                </div>
            )}

            {error && <div className="mb-2 text-[11px] text-red-700">{error}</div>}
            {notice && <div className="mb-2 text-[11px] text-emerald-800">{notice}</div>}

            <div className="flex flex-wrap items-center gap-2">
                {primary === 'price_and_send' && data.estimate?.draftSlug && (
                    <a href={`/admin/price/${data.estimate.draftSlug}`} data-testid="price-and-send"
                        className={cn('flex items-center gap-1.5 rounded-md bg-emerald-600 font-semibold text-white hover:bg-emerald-700', btn)}>
                        <PoundSterling className="h-3.5 w-3.5" /> Price and send
                    </a>
                )}
                {primary === 'estimating' && (
                    <span data-testid="estimating" className={cn('flex items-center gap-1.5 rounded-md bg-blue-100 font-semibold text-blue-800', btn)}>
                        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Estimating…
                    </span>
                )}
                {primary === 'save_draft' && (
                    <button type="button" disabled={busy || !lines.some((l) => l.title.trim())} onClick={() => save.mutate()}
                        className={cn('flex items-center gap-1.5 rounded-md bg-violet-800 font-semibold text-white hover:bg-violet-900 disabled:opacity-50', btn)}>
                        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />} Save draft quote
                    </button>
                )}
                <button type="button" disabled={busy} onClick={openFullBuilder}
                    className={cn('flex items-center gap-1.5 rounded-md border border-slate-300 bg-white font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50', btn)}>
                    <ExternalLink className="h-3.5 w-3.5" /> Open full builder
                </button>
                <button type="button" disabled={rerun.isPending} onClick={() => rerun.mutate()} title="Ask the spine clerk for a fresh intake"
                    className={cn('flex items-center gap-1 rounded-md text-[11px] font-semibold text-violet-800 hover:underline disabled:opacity-50')}>
                    {rerun.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />} Re-run clerk
                </button>
                {saved && (
                    <span className="text-[11px] text-emerald-800">
                        Draft saved, not sent. <a href={saved.editUrl} className="font-semibold underline">Open {saved.slug}</a>
                    </span>
                )}
                <span className="text-[10px] text-slate-500">
                    {primary === 'price_and_send' ? 'Suggested prices wait for your tap; nothing is sent until then.' : "Prices are Ben's; the draft carries none."}
                </span>
            </div>
        </div>
    );
}
