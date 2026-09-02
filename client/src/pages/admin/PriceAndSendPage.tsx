/**
 * /admin/price/:slug — Ben's phone-first "price and send" screen (P8 / B).
 *
 * The chain (P8 / A) has already scoped the job, estimated minutes and materials, and asked the
 * real engine for a suggested price and band per line. This screen is the human step the money
 * rule requires: every suggestion is prefilled in an EDITABLE field, the band and confidence sit
 * beside it, a `check_this` line says why it needs a look, and ONE primary button sends. The
 * contextual builder stays one tap away for anything that needs more than a number.
 *
 * Thumb reach: the two actions live in a sticky bottom bar; everything else is one column.
 * Data: GET /api/spine/price/:slug. Send: POST /api/spine/price/:slug/send with the final
 * per-line prices and the supersede token — 409 means a new scope arrived and the screen reloads.
 */
import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRoute } from 'wouter';
import { Loader2, AlertTriangle, Camera, ChevronDown, ChevronUp, Send, PenLine, RotateCcw, CheckCircle2, Clock, Wrench, RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';

function getAuthHeaders(): Record<string, string> {
    const token = localStorage.getItem('adminToken');
    return token ? { Authorization: `Bearer ${token}` } : {};
}

export type Confidence = 'low' | 'medium' | 'high';

export interface PriceLine {
    lineId: string;
    title: string;
    category: string | null;
    qty: number;
    minutes: { point: number; low: number; high: number } | null;
    timeSource: string | null;
    materialsCount: number;
    materialsPence: number;
    suggestedPence: number | null;
    bandLowPence: number | null;
    bandHighPence: number | null;
    confidence: Confidence | null;
    checkThis: boolean;
    checkReason: string | null;
    flags: string[];
    assumptions: string[];
}

export interface PricePayload {
    available: true;
    slug: string;
    quoteId: string;
    conversationId: string | null;
    version: string;
    status: 'draft' | 'sent' | 'superseded' | 'revoked';
    customer: { firstName: string; name: string; postcode: string | null; customerType: string; readiness: string | null };
    lines: PriceLine[];
    job: { setupMinutes: number; cleanupMinutes: number; accessNotes: string | null } | null;
    settings: { materialsMarginPercent: number; depositPercent: number };
    materials: Array<{ lineId: string; name: string; qty: number; unitCostPence: number | null; source: string | null }>;
    photos: string[];
    videos: string[];
    builderUrl: string;
    estimate: { id: string | null; status: string | null; confidence: string | null; at: string | null } | null;
    quoteUrl: string;
}

export interface SendResult {
    ok: boolean; priced?: boolean; sent?: boolean; queued?: boolean; mode?: string; partial?: boolean;
    message?: string; errors?: string[]; quoteUrl?: string; verdicts?: number; status?: string | null;
    totals?: { labourPence: number; materialsPence: number; totalPence: number; depositPence: number };
}

// ---------------------------------------------------------------- pure helpers (exported for tests)

export function gbp(pence: number | null | undefined): string {
    if (pence == null || !Number.isFinite(pence)) return '—';
    const pounds = pence / 100;
    return Number.isInteger(pounds) ? `£${pounds.toLocaleString('en-GB')}` : `£${pounds.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function poundsToPence(text: string): number | null {
    const t = text.replace(/[£,\s]/g, '');
    if (!t) return null;
    const n = Number(t);
    if (!Number.isFinite(n) || n <= 0) return null;
    return Math.round(n * 100);
}

export function penceToPoundsText(pence: number | null): string {
    if (pence == null) return '';
    return Number.isInteger(pence / 100) ? String(pence / 100) : (pence / 100).toFixed(2);
}

export function bandText(low: number | null, high: number | null): string | null {
    if (low == null || high == null) return null;
    return low === high ? gbp(low) : `${gbp(low)}–${gbp(high)}`;
}

export function minutesText(m: PriceLine['minutes']): string | null {
    if (!m) return null;
    const range = m.low === m.high ? '' : ` (${m.low}–${m.high})`;
    return `${m.point} min${range}`;
}

/** Same rule as the server (totalsFor): labour = final − materials; deposit = materials + X % of labour, to the pound. */
export function totalsOf(lines: PriceLine[], finals: Record<string, number | null>, depositPercent: number) {
    let total = 0, materials = 0, missing = 0;
    for (const l of lines) {
        const f = finals[l.lineId];
        if (f == null) { missing++; continue; }
        total += f;
        materials += Math.min(l.materialsPence, f);
    }
    const labour = total - materials;
    const deposit = Math.round((materials + Math.round(labour * (depositPercent / 100))) / 100) * 100;
    return { totalPence: total, materialsPence: materials, labourPence: labour, depositPence: deposit, missing };
}

const READINESS_LABEL: Record<string, string> = {
    quote_ready: 'Ready to price', quote_pending: 'Pending', needs_info: 'Needs info', visit_first: 'Visit first', decline: 'Decline',
};
const CUSTOMER_TYPE_LABEL: Record<string, string> = {
    homeowner: 'Homeowner', landlord: 'Landlord', property_manager: 'Letting agent', letting_agent: 'Letting agent', business: 'Business',
};

function ConfidenceDot({ c }: { c: Confidence | null }) {
    const cls = c === 'high' ? 'bg-emerald-500' : c === 'medium' ? 'bg-amber-400' : c === 'low' ? 'bg-red-500' : 'bg-slate-300';
    const label = c ? `${c} confidence` : 'no confidence';
    return <span className={cn('inline-block h-2.5 w-2.5 rounded-full', cls)} title={label} aria-label={label} data-testid={`confidence-${c ?? 'none'}`} />;
}

// ---------------------------------------------------------------- line card

export function PriceLineCard({ line, value, onChange, disabled }: {
    line: PriceLine; value: string; onChange: (text: string) => void; disabled: boolean;
}) {
    const pence = poundsToPence(value);
    const band = bandText(line.bandLowPence, line.bandHighPence);
    const edited = line.suggestedPence != null && pence !== line.suggestedPence;
    const outOfBand = pence != null && line.bandLowPence != null && line.bandHighPence != null && (pence < line.bandLowPence || pence > line.bandHighPence);
    const mins = minutesText(line.minutes);
    return (
        <div className={cn('rounded-2xl border bg-white p-4 shadow-sm', line.checkThis ? 'border-amber-300' : 'border-slate-200')} data-testid={`price-line-${line.lineId}`}>
            <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                    <div className="text-[15px] font-black leading-snug text-slate-900">{line.qty > 1 ? `${line.qty}× ` : ''}{line.title}</div>
                    <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] font-bold text-slate-500">
                        {line.category && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-700" data-testid="category-chip">{line.category.replace(/_/g, ' ')}</span>}
                        {mins && <span className="inline-flex items-center gap-1"><Clock className="h-3 w-3" />{mins}</span>}
                        <span className="inline-flex items-center gap-1"><Wrench className="h-3 w-3" />{line.materialsCount ? `${line.materialsCount} material${line.materialsCount === 1 ? '' : 's'}` : 'no materials'}</span>
                        <ConfidenceDot c={line.confidence} />
                    </div>
                </div>
            </div>

            {line.checkThis && (
                <div className="mt-3 flex items-start gap-2 rounded-xl bg-amber-50 px-3 py-2 text-xs font-bold text-amber-900" data-testid="check-this">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    <span><span className="uppercase tracking-wide">Check this</span>{line.checkReason ? ` · ${line.checkReason}` : ''}</span>
                </div>
            )}

            <div className="mt-3 flex items-end gap-3">
                <label className="block flex-1">
                    <span className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Price</span>
                    <div className={cn('mt-1 flex items-center rounded-xl border-2 bg-white px-3', outOfBand ? 'border-amber-400' : edited ? 'border-slate-900' : 'border-slate-300')}>
                        <span className="text-xl font-black text-slate-500">£</span>
                        <input
                            type="number" inputMode="decimal" min={0} step={1}
                            className="w-full bg-transparent py-2.5 pl-1 text-2xl font-black text-slate-900 outline-none"
                            value={value} disabled={disabled}
                            onChange={(e) => onChange(e.target.value)}
                            aria-label={`Price for ${line.title}`}
                            data-testid={`price-input-${line.lineId}`}
                        />
                    </div>
                </label>
                {edited && !disabled && (
                    <button type="button" onClick={() => onChange(penceToPoundsText(line.suggestedPence))}
                        className="mb-1 inline-flex items-center gap-1 rounded-lg border border-slate-300 px-2.5 py-2 text-xs font-bold text-slate-700"
                        data-testid={`reset-${line.lineId}`}>
                        <RotateCcw className="h-3.5 w-3.5" /> {gbp(line.suggestedPence)}
                    </button>
                )}
            </div>
            <div className="mt-1.5 flex flex-wrap items-center gap-x-3 text-xs font-bold text-slate-500">
                {band ? <span data-testid="band">Band {band}</span> : <span data-testid="band">No band</span>}
                {line.suggestedPence == null && <span className="text-amber-700">No suggestion, price by hand</span>}
                {edited && <span className="inline-flex items-center gap-1 text-slate-900"><PenLine className="h-3 w-3" /> edited</span>}
                {outOfBand && <span className="text-amber-700" data-testid="out-of-band">outside the band</span>}
                {line.materialsPence > 0 && <span>incl. {gbp(line.materialsPence)} materials</span>}
            </div>
            {line.assumptions.length > 0 && (
                <ul className="mt-2 list-disc pl-4 text-[11px] text-slate-500">
                    {line.assumptions.slice(0, 4).map((a, i) => <li key={i}>{a}</li>)}
                </ul>
            )}
        </div>
    );
}

// ---------------------------------------------------------------- the screen

export function PriceAndSend({ slug }: { slug: string }) {
    const qc = useQueryClient();
    const { data, isLoading, error, refetch, isFetching } = useQuery<PricePayload>({
        queryKey: ['spine-price', slug],
        queryFn: async () => {
            const res = await fetch(`/api/spine/price/${encodeURIComponent(slug)}`, { headers: getAuthHeaders() });
            if (res.status === 401 || res.status === 403) throw new Error('AUTH');
            if (res.status === 404) throw new Error('NOT_FOUND');
            if (!res.ok) throw new Error(`price screen ${res.status}`);
            return res.json();
        },
    });

    const [values, setValues] = useState<Record<string, string>>({});
    const [showMaterials, setShowMaterials] = useState(false);
    const [sending, setSending] = useState(false);
    const [result, setResult] = useState<SendResult | null>(null);
    const [superseded, setSuperseded] = useState<string | null>(null);

    // Prefill from the suggestions whenever a fresh payload arrives (a reload after 409 re-prefills).
    useEffect(() => {
        if (!data) return;
        setValues(Object.fromEntries(data.lines.map((l) => [l.lineId, penceToPoundsText(l.suggestedPence)])));
        setSuperseded(null);
    }, [data?.version]); // eslint-disable-line react-hooks/exhaustive-deps

    const finals = useMemo(() => Object.fromEntries((data?.lines ?? []).map((l) => [l.lineId, poundsToPence(values[l.lineId] ?? '')])), [data, values]);
    const totals = useMemo(() => totalsOf(data?.lines ?? [], finals, data?.settings.depositPercent ?? 30), [data, finals]);

    const locked = !data || data.status !== 'draft' || !!result?.ok || !!superseded;
    const canSend = !!data && data.status === 'draft' && !sending && totals.missing === 0 && data.lines.length > 0 && !result?.ok && !superseded;

    async function send() {
        if (!data || !canSend) return;
        setSending(true);
        setResult(null);
        try {
            const res = await fetch(`/api/spine/price/${encodeURIComponent(data.slug)}/send`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
                body: JSON.stringify({ version: data.version, lines: data.lines.map((l) => ({ lineId: l.lineId, finalPence: finals[l.lineId] })) }),
            });
            const json: SendResult = await res.json().catch(() => ({ ok: false, errors: [`Send failed (${res.status})`] }));
            if (res.status === 409) {
                setSuperseded(json.errors?.[0] ?? 'This draft changed since it loaded.');
                return;
            }
            setResult({ ...json, ok: res.ok && json.ok !== false });
            if (res.ok) void qc.invalidateQueries({ queryKey: ['spine-price', data.slug] });
        } catch (e: any) {
            setResult({ ok: false, errors: [e?.message ?? 'Send failed'] });
        } finally {
            setSending(false);
        }
    }

    if (isLoading) {
        return <div className="flex h-64 items-center justify-center text-slate-500"><Loader2 className="mr-2 h-5 w-5 animate-spin" /> Loading the quote…</div>;
    }
    if ((error as Error)?.message === 'AUTH') {
        return <div className="m-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
            Your admin session has expired. <a href={`/admin/login?next=${encodeURIComponent(`/admin/price/${slug}`)}`} className="font-bold underline">Log in again</a> to price this quote.
        </div>;
    }
    if ((error as Error)?.message === 'NOT_FOUND') {
        return <div className="m-4 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700" data-testid="not-found">No quote with the slug <span className="font-mono">{slug}</span>.</div>;
    }
    if (error || !data) {
        return <div className="m-4 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">Couldn't load the quote. {(error as Error)?.message}</div>;
    }

    const readiness = data.customer.readiness;
    const statusBanner = data.status === 'sent'
        ? { cls: 'border-emerald-200 bg-emerald-50 text-emerald-900', text: 'This quote has already been sent.' }
        : data.status === 'superseded'
            ? { cls: 'border-amber-200 bg-amber-50 text-amber-900', text: 'A new scope arrived and this draft was superseded. Open the thread for the new one.' }
            : data.status === 'revoked'
                ? { cls: 'border-red-200 bg-red-50 text-red-900', text: 'This quote was revoked.' }
                : null;

    return (
        <div className="mx-auto max-w-md pb-36" data-testid="price-and-send">
            {/* Header: who, where, what kind, how ready */}
            <div className="sticky top-0 z-10 border-b border-slate-200 bg-white/95 px-4 py-3 backdrop-blur">
                <div className="flex items-baseline justify-between gap-2">
                    <h1 className="truncate text-xl font-black text-slate-900" data-testid="customer-first-name">{data.customer.firstName}</h1>
                    {data.customer.postcode && <span className="rounded-md bg-slate-900 px-2 py-0.5 font-mono text-xs font-bold text-white" data-testid="postcode">{data.customer.postcode}</span>}
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] font-bold">
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-700" data-testid="customer-type">{CUSTOMER_TYPE_LABEL[data.customer.customerType] ?? data.customer.customerType}</span>
                    {readiness && <span className={cn('rounded-full px-2 py-0.5', readiness === 'quote_ready' ? 'bg-emerald-100 text-emerald-800' : readiness === 'visit_first' ? 'bg-violet-100 text-violet-800' : readiness === 'decline' ? 'bg-red-100 text-red-800' : 'bg-amber-100 text-amber-800')} data-testid="readiness">{READINESS_LABEL[readiness] ?? readiness}</span>}
                    {data.estimate?.confidence && <span className="text-slate-500">estimate {data.estimate.confidence}</span>}
                    {data.job && (data.job.setupMinutes || data.job.cleanupMinutes) ? <span className="text-slate-500">+{data.job.setupMinutes + data.job.cleanupMinutes} min setup/cleanup</span> : null}
                </div>
            </div>

            <div className="space-y-3 px-4 pt-3">
                {statusBanner && <div className={cn('rounded-xl border px-3 py-2 text-sm font-bold', statusBanner.cls)} data-testid="status-banner">{statusBanner.text}</div>}

                {superseded && (
                    <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900" data-testid="superseded-banner">
                        <div className="font-black">A new scope arrived</div>
                        <p className="mt-0.5">{superseded}</p>
                        <button type="button" onClick={() => { setResult(null); void refetch(); }} disabled={isFetching}
                            className="mt-2 inline-flex items-center gap-1 rounded-lg bg-amber-900 px-3 py-2 text-xs font-black text-white" data-testid="reload">
                            <RefreshCw className={cn('h-3.5 w-3.5', isFetching && 'animate-spin')} /> Reload the draft
                        </button>
                    </div>
                )}

                {result?.ok && (
                    <div className="rounded-xl border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-900" data-testid="sent-state">
                        <div className="flex items-center gap-2 font-black"><CheckCircle2 className="h-4 w-4" /> {result.sent ? (result.mode === 'template' ? 'Sent by WhatsApp template' : 'Sent on WhatsApp') : result.queued ? 'Queued for the window' : 'Done'}</div>
                        {result.message && <p className="mt-1">{result.message}</p>}
                        {result.totals && <p className="mt-1 font-bold">{gbp(result.totals.totalPence)} total · deposit {gbp(result.totals.depositPence)}</p>}
                        {result.quoteUrl && <a className="mt-1 block truncate font-mono text-xs underline" href={result.quoteUrl}>{result.quoteUrl}</a>}
                    </div>
                )}
                {result && !result.ok && (
                    <div className="rounded-xl border border-red-300 bg-red-50 p-3 text-sm text-red-900" data-testid="send-error">
                        <div className="font-black">{result.priced ? 'Prices saved, but the send did not go through' : 'Not sent'}</div>
                        <ul className="mt-1 list-disc pl-4">{(result.errors ?? [result.message ?? 'Send failed']).map((e, i) => <li key={i}>{e}</li>)}</ul>
                    </div>
                )}

                {data.lines.length === 0 && <div className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-600">This draft has no lines. Open the full builder.</div>}
                {data.lines.map((l) => (
                    <PriceLineCard key={l.lineId} line={l} value={values[l.lineId] ?? ''} onChange={(t) => setValues((v) => ({ ...v, [l.lineId]: t }))} disabled={locked} />
                ))}

                {/* Totals */}
                <div className="rounded-2xl bg-slate-900 p-4 text-white" data-testid="totals">
                    <div className="grid grid-cols-2 gap-y-1 text-sm">
                        <span className="text-slate-300">Labour</span><span className="text-right font-bold">{gbp(totals.labourPence)}</span>
                        <span className="text-slate-300">Materials at {data.settings.materialsMarginPercent}%</span><span className="text-right font-bold">{gbp(totals.materialsPence)}</span>
                        <span className="mt-1 text-base font-black">Total</span><span className="mt-1 text-right text-base font-black" data-testid="total">{gbp(totals.totalPence)}</span>
                        <span className="text-slate-300">Deposit ({data.settings.depositPercent}% labour + materials)</span><span className="text-right font-bold" data-testid="deposit">{gbp(totals.depositPence)}</span>
                    </div>
                    {totals.missing > 0 && <div className="mt-2 text-xs font-bold text-amber-300" data-testid="missing-prices">{totals.missing} line{totals.missing === 1 ? '' : 's'} still need{totals.missing === 1 ? 's' : ''} a price</div>}
                </div>

                {/* Materials */}
                {data.materials.length > 0 && (
                    <div className="rounded-2xl border border-slate-200 bg-white">
                        <button type="button" onClick={() => setShowMaterials((s) => !s)} className="flex w-full items-center justify-between px-4 py-3 text-sm font-black text-slate-900" data-testid="materials-toggle">
                            <span>Materials ({data.materials.length})</span>{showMaterials ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                        </button>
                        {showMaterials && (
                            <ul className="divide-y divide-slate-100 border-t border-slate-100 text-sm" data-testid="materials-list">
                                {data.materials.map((m, i) => (
                                    <li key={i} className="flex items-center justify-between gap-3 px-4 py-2">
                                        <span className="min-w-0 truncate text-slate-800">{m.qty > 1 ? `${m.qty}× ` : ''}{m.name}</span>
                                        <span className="shrink-0 text-xs font-bold text-slate-500">{m.unitCostPence != null ? gbp(m.unitCostPence * m.qty) : '—'}{m.source ? ` · ${m.source}` : ''}</span>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </div>
                )}

                {/* Photos */}
                {(data.photos.length > 0 || data.videos.length > 0) && (
                    <div data-testid="photos-strip">
                        <div className="mb-1.5 flex items-center gap-1 text-[11px] font-bold uppercase tracking-wide text-slate-500"><Camera className="h-3 w-3" /> Photos</div>
                        <div className="flex gap-2 overflow-x-auto pb-1">
                            {data.photos.map((u, i) => <a key={i} href={u} target="_blank" rel="noreferrer" className="shrink-0"><img src={u} alt="" className="h-20 w-20 rounded-lg object-cover" /></a>)}
                            {data.videos.map((u, i) => <a key={`v${i}`} href={u} target="_blank" rel="noreferrer" className="flex h-20 w-20 shrink-0 items-center justify-center rounded-lg bg-slate-900 text-xs font-bold text-white">video</a>)}
                        </div>
                    </div>
                )}
            </div>

            {/* Sticky actions, thumb reach */}
            <div className="fixed inset-x-0 bottom-0 z-20 border-t border-slate-200 bg-white/95 p-3 backdrop-blur">
                <div className="mx-auto flex max-w-md flex-col gap-2">
                    <button type="button" onClick={send} disabled={!canSend}
                        className="inline-flex h-14 w-full items-center justify-center gap-2 rounded-2xl bg-emerald-600 text-lg font-black text-white shadow-lg disabled:bg-slate-300 disabled:text-slate-500 disabled:shadow-none"
                        data-testid="send-quote">
                        {sending ? <Loader2 className="h-5 w-5 animate-spin" /> : <Send className="h-5 w-5" />}
                        {sending ? 'Sending…' : result?.ok ? 'Sent' : `Send quote${totals.totalPence > 0 ? ` · ${gbp(totals.totalPence)}` : ''}`}
                    </button>
                    <a href={data.builderUrl} className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-2xl border-2 border-slate-300 text-sm font-black text-slate-700" data-testid="open-builder">
                        <PenLine className="h-4 w-4" /> Open full builder
                    </a>
                </div>
            </div>
        </div>
    );
}

export default function PriceAndSendPage() {
    const [, params] = useRoute('/admin/price/:slug');
    const slug = params?.slug ?? '';
    if (!slug) return <div className="m-4 text-sm text-slate-600">No quote slug in the address.</div>;
    return <PriceAndSend slug={slug} />;
}
