/**
 * /admin/price/:slug — Ben's price-and-send screen, v2 (P12): Ben arrives cold.
 *
 * Route A has scoped, estimated and priced the job before Ben has seen the thread, so the screen
 * briefs him first and asks for numbers second:
 *   - her words first: the messages each line came from, quoted under the line, with the photos
 *     they arrived with; the whole thread embedded (last 24 h by default, one tap for all of it)
 *   - lines ordered by doubt: check_this, contradictions and low confidence first; accept is one
 *     tap, the basis (minutes, rate, margin) a tap away
 *   - a contradiction (assumption says "reused", materials list new ones) is one sentence and two
 *     taps, never a block
 *   - materials per line with swap / remove, margin applied; assumptions are customer-facing text
 *     Ben edits or drops
 *   - the message she reads, drafted by the desk, edited here above Send (the link goes on at send)
 *   - four exits in the thumb bar, none of which leave the screen: Send now · Ask her first · Call
 *     her · Needs a visit. The full builder stays a secondary link.
 *   - after Send: what happened and what happens next, then the next quote waiting
 *   - phone: Thread · Price tabs; desktop: side by side
 * Data: GET /api/spine/price/:slug. Send: POST …/send; the other exits POST …/ask, …/call, …/visit.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRoute } from 'wouter';
import { Loader2, AlertTriangle, ChevronDown, ChevronUp, Send, PenLine, RotateCcw, CheckCircle2, Clock, Wrench, RefreshCw, Phone, HelpCircle, Home, X, Check, ArrowRight, Quote as QuoteIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { depositFor } from '@shared/pricing-settings';
import { CATEGORY_OPTIONS } from '@/lib/quote-categories';

function getAuthHeaders(): Record<string, string> {
    const token = localStorage.getItem('adminToken');
    return token ? { Authorization: `Bearer ${token}` } : {};
}

// ---------------------------------------------------------------- payload (mirrors server/spine/price-screen.ts)

export type Confidence = 'low' | 'medium' | 'high';
export type MediaKind = 'image' | 'video' | 'audio' | 'document';

export interface ThreadMessage { id: string; at: string; direction: 'in' | 'out'; channel: string; body: string; media: { url: string; kind: MediaKind } | null; by: string | null }
export interface PriceThread { messages: ThreadMessage[]; recentSince: string | null; firstInboundAt: string | null; latestInboundId: string | null; count: number }
export interface LineEvidence { basedOnInboundId: string | null; quotes: Array<{ messageId: string; at: string; text: string }>; media: Array<{ messageId: string; url: string; kind: MediaKind }> }
export interface Material { lineId: string; index: number; name: string; qty: number; unitCostPence: number | null; source: string | null }
export interface Contradiction {
    id: string; lineId: string; kind: 'assumption_vs_materials'; sentence: string; assumption: string; assumptionIndex: number;
    materialIndexes: number[]; materialNames: string[]; options: Array<{ id: 'drop_materials' | 'keep_materials'; label: string }>;
}
export interface QuoteHold { reason: 'ask_first' | 'call' | 'visit'; at: string; by: string; question?: string | null; draftId?: string | null }

export interface PriceLine {
    lineId: string;
    title: string;
    category: string | null;
    notes?: string | null;
    qty: number;
    minutes: { point: number; low: number; high: number } | null;
    timeSource: string | null;
    materialsCount: number;
    /** At margin: what the customer pays. The only figure any total uses. */
    materialsPence: number;
    /** P16: at cost, what we pay the merchant. Shown inside the materials editor, never in a total. */
    materialsCostPence?: number;
    suggestedPence: number | null;
    bandLowPence: number | null;
    bandHighPence: number | null;
    confidence: Confidence | null;
    checkThis: boolean;
    checkReason: string | null;
    flags: string[];
    assumptions: string[];
    /** P15: the customer-facing "Not included" list; Ben edits, adds or drops. */
    notIncluded?: string[];
    basis?: { minutes: number | null; ratePencePerHour: number | null; marginPct: number | null; labourPence?: number | null; rules: string[] } | null;
    materials?: Material[];
    evidence?: LineEvidence;
}

export interface PricePayload {
    available: true;
    slug: string;
    quoteId: string;
    conversationId: string | null;
    version: string;
    status: 'draft' | 'sent' | 'superseded' | 'revoked';
    customer: { firstName: string; name: string; postcode: string | null; customerType: string; readiness: string | null; phone?: string | null };
    lines: PriceLine[];
    job: { setupMinutes: number; cleanupMinutes: number; accessNotes: string | null } | null;
    settings: { materialsMarginPercent: number; depositPercent: number };
    materials: Material[];
    photos: string[];
    videos: string[];
    builderUrl: string;
    estimate: { id: string | null; status: string | null; confidence: string | null; at: string | null } | null;
    quoteUrl: string;
    thread?: PriceThread;
    contradictions?: Contradiction[];
    message?: { body: string; source: 'desk' };
    hold?: QuoteHold | null;
    nextWaiting?: { slug: string; firstName: string } | null;
    call?: { customerPhone: string | null; businessNumber: string | null };
    followUpDays?: number;
}

export interface SendResult {
    ok: boolean; priced?: boolean; sent?: boolean; queued?: boolean; mode?: string; partial?: boolean;
    message?: string; errors?: string[]; quoteUrl?: string; verdicts?: number; status?: string | null;
    totals?: { labourPence: number; materialsPence: number; totalPence: number; depositPence: number };
    nextSteps?: string; nextWaiting?: { slug: string; firstName: string } | null;
}

export type Resolution = 'drop_materials' | 'keep_materials';

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

/** Materials at the live margin from a (possibly edited) list. Same rule as the server. */
export function materialsCostOf(list: Array<{ qty: number; unitCostPence: number | null }>): number {
    return list.reduce((s, m) => s + (m.unitCostPence ?? 0) * Math.max(1, m.qty), 0);
}

export function materialsAtMargin(list: Array<{ qty: number; unitCostPence: number | null }>, marginPercent: number): number {
    const cost = materialsCostOf(list);
    return cost ? Math.round(cost * (1 + marginPercent / 100)) : 0;
}

/**
 * P16: what the customer pays for a line's materials. An edited list is costed at the live margin;
 * an empty list falls back to the server's at-margin figure (the bridge's
 * `basis.materialsWithMarginPence`), because a line priced with no itemised list still has
 * materials in its price. Never the raw cost: that is `materialsCostPence`, editor-only.
 */
/**
 * The line's materials, at margin. `line.materialsPence` is the figure the ENGINE priced the line
 * with; recomputing it from the item list rounds differently and drifts (Gemma c1u0wkt8, 3 Sep 2026:
 * the six lines summed to £352.00 stored but £352.60 recomputed, so the page's labour and materials
 * both read 60p away from the line items they are supposed to add up to). So the stored figure wins
 * unless Ben has actually CHANGED the list — swapped an item, edited a cost or a quantity, removed
 * one — in which case his list is the truth and we recompute.
 */
export function lineMaterialsAtMargin(line: PriceLine, edited: Array<{ qty: number; unitCostPence: number | null }> | undefined, marginPercent: number): number {
    if (!edited) return line.materialsPence;
    const original = line.materials ?? [];
    const unchanged = edited.length === original.length
        && edited.every((m, i) => m.qty === original[i]?.qty && (m.unitCostPence ?? null) === (original[i]?.unitCostPence ?? null));
    if (unchanged) return line.materialsPence;
    if (!edited.length) return 0; // he removed them all
    return materialsAtMargin(edited, marginPercent);
}

/**
 * P18: pounds to pence for the two money boxes, where ZERO is a real answer (a line can be all
 * labour, or all materials). Blank or negative is null, which reads as "not answered yet" and
 * blocks the send — negative labour is refused at the input rather than clamped in the display.
 */
/** P18: the next free index for a material Ben adds; the list is keyed by index, not position. */
export function nextMaterialIndex(list: Array<{ index: number }>): number {
    return list.reduce((n, m) => Math.max(n, m.index + 1), 0);
}

export function moneyBoxToPence(text: string): number | null {
    const t = (text ?? '').replace(/[£,\s]/g, '');
    if (!t) return null;
    const n = Number(t);
    if (!Number.isFinite(n) || n < 0) return null;
    return Math.round(n * 100);
}

/** P18: what the customer pays for this line's materials — Ben's typed box, else his item list. */
export function stateMaterialsPence(line: PriceLine, state: LineState | undefined, marginPercent: number): number {
    if (!state) return line.materialsPence;
    if (state.materialsByHand != null) return moneyBoxToPence(state.materialsByHand) ?? 0;
    return lineMaterialsAtMargin(line, state.materials, marginPercent);
}

/** P18: labour as typed. null = the box is empty or negative, so this line has no price yet. */
export function stateLabourPence(state: LineState | undefined): number | null {
    return state ? moneyBoxToPence(state.labour) : null;
}

/** P18: the line price. It is the sum of the two boxes, never a number Ben types. */
export function lineTotalPence(line: PriceLine, state: LineState | undefined, marginPercent: number): number | null {
    const labour = stateLabourPence(state);
    if (labour == null) return null;
    return labour + stateMaterialsPence(line, state, marginPercent);
}

/**
 * P18: the halves as the engine priced them, for seeding a box and for "accept as suggested".
 * A draft priced before P18 has no stored labour, so it falls back to the suggestion less the
 * materials the engine costed. Never written back on read.
 */
export function suggestedHalves(line: PriceLine): { labourPence: number | null; materialsPence: number } {
    const materialsPence = line.materialsPence;
    const fromBasis = line.basis?.labourPence;
    if (fromBasis != null) return { labourPence: fromBasis, materialsPence };
    if (line.suggestedPence != null) return { labourPence: Math.max(0, line.suggestedPence - materialsPence), materialsPence };
    return { labourPence: null, materialsPence };
}

/** Same rule as the server (totalsFor): labour = final − materials at margin; deposit = depositFor. */
export function totalsOf(lines: PriceLine[], finals: Record<string, number | null>, depositPercent: number, materialsPence?: Record<string, number>) {
    let total = 0, materials = 0, missing = 0;
    for (const l of lines) {
        const f = finals[l.lineId];
        if (f == null) { missing++; continue; }
        total += f;
        materials += Math.min(materialsPence?.[l.lineId] ?? l.materialsPence, f);
    }
    const labour = total - materials;
    return { totalPence: total, materialsPence: materials, labourPence: labour, depositPence: depositFor(total, materials, depositPercent), missing };
}

/**
 * P16: a 409 on send is not always a new scope. It is also the pack refusing a change to a line a
 * dispatch already holds. The heading follows the reason so Ben reads the right thing first.
 */
export function refusalTitle(reason: string): string {
    return /dispatch|locked|variation/i.test(reason) ? 'That job is already dispatched' : 'A new scope arrived';
}

/** How much a line needs Ben's eyes: check_this, a contradiction, low confidence, no suggestion. Higher first. */
export function doubtScore(line: PriceLine, contradictions: Contradiction[]): number {
    let s = 0;
    if (line.checkThis) s += 4;
    if (line.suggestedPence == null) s += 3;
    if (contradictions.some((c) => c.lineId === line.lineId)) s += 2;
    if (line.confidence === 'low') s += 2; else if (line.confidence === 'medium') s += 1;
    return s;
}

/** Doubt first, stable otherwise (the estimate's order). */
export function orderByDoubt(lines: PriceLine[], contradictions: Contradiction[]): PriceLine[] {
    return lines.map((l, i) => ({ l, i, s: doubtScore(l, contradictions) })).sort((a, b) => b.s - a.s || a.i - b.i).map((x) => x.l);
}

/** The thread window: everything at or after recentSince, unless expanded. */
export function visibleMessages(thread: PriceThread | undefined, expanded: boolean): ThreadMessage[] {
    if (!thread) return [];
    if (expanded || !thread.recentSince) return thread.messages;
    const since = thread.recentSince;
    const recent = thread.messages.filter((m) => m.at >= since);
    // Never an empty window: fall back to the last six when nothing is recent.
    return recent.length ? recent : thread.messages.slice(-6);
}

/** Light client-side guard for the message Ben edits: warn, never block (he is the human). */
export function messageWarnings(body: string): string[] {
    const out: string[] = [];
    if (/£|\bpounds?\b|\bquid\b/i.test(body)) out.push('has a price in it (the link carries the price)');
    if (/\b(mon|tues|wednes|thurs|fri|satur|sun)day\b|\btomorrow\b|\bnext week\b|\b\d{1,2}(st|nd|rd|th)\b/i.test(body)) out.push('has a date in it');
    if (/[—–]/.test(body)) out.push('has a dash (the house voice has none)');
    return out;
}

/** P16: does the message give her a way to open the quote? Mirrors the server's hasQuoteLink. */
export function hasQuoteLink(body: string, quoteUrl: string): boolean {
    return !!quoteUrl && body.includes(quoteUrl);
}

/**
 * P16: put the link back at the cursor, on its own line, without gluing it to a word. Ben deleted
 * it by accident far more often than on purpose.
 */
export function insertAt(body: string, text: string, at: number): string {
    const i = Math.max(0, Math.min(at, body.length));
    const before = body.slice(0, i), after = body.slice(i);
    const lead = before && !before.endsWith('\n') ? '\n' : '';
    const tail = after && !after.startsWith('\n') ? '\n' : '';
    return `${before}${lead}${text}${tail}${after}`;
}

export function whenText(iso: string): string {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

const READINESS_LABEL: Record<string, string> = {
    quote_ready: 'Ready to price', quote_pending: 'Pending', needs_info: 'Needs info', visit_first: 'Visit first', decline: 'Decline',
};
const CUSTOMER_TYPE_LABEL: Record<string, string> = {
    homeowner: 'Homeowner', landlord: 'Landlord', property_manager: 'Letting agent', letting_agent: 'Letting agent', business: 'Business',
};
const HOLD_LABEL: Record<QuoteHold['reason'], string> = {
    ask_first: 'Held: you asked her first. The question is in your queue to approve; price once she answers.',
    call: 'Held: you are calling her. Send when you have spoken.',
    visit: 'Held: visit first. The survey offer is in your queue to approve.',
};

const DESKTOP_QUERY = '(min-width: 900px)';

/** Phone (tabs) or desktop (side by side). jsdom has no matchMedia: phone. */
export function useIsDesktop(): boolean {
    const [desktop, setDesktop] = useState<boolean>(() => typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia(DESKTOP_QUERY).matches : false);
    useEffect(() => {
        if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
        const mq = window.matchMedia(DESKTOP_QUERY);
        const on = () => setDesktop(mq.matches);
        on();
        if (typeof mq.addEventListener === 'function') { mq.addEventListener('change', on); return () => mq.removeEventListener('change', on); }
        mq.addListener?.(on);
        return () => mq.removeListener?.(on);
    }, []);
    return desktop;
}

function ConfidenceDot({ c }: { c: Confidence | null }) {
    const cls = c === 'high' ? 'bg-emerald-500' : c === 'medium' ? 'bg-amber-400' : c === 'low' ? 'bg-red-500' : 'bg-slate-300';
    const label = c ? `${c} confidence` : 'no confidence';
    return <span className={cn('inline-block h-2.5 w-2.5 rounded-full', cls)} title={label} aria-label={label} data-testid={`confidence-${c ?? 'none'}`} />;
}

// ---------------------------------------------------------------- thread

function MediaView({ media, className }: { media: NonNullable<ThreadMessage['media']>; className?: string }) {
    if (media.kind === 'image') return <a href={media.url} target="_blank" rel="noreferrer"><img src={media.url} alt="" className={cn('rounded-lg object-cover', className)} loading="lazy" /></a>;
    if (media.kind === 'video') return <video src={media.url} controls preload="metadata" className={cn('rounded-lg bg-black', className)} />;
    return <a href={media.url} target="_blank" rel="noreferrer" className={cn('flex items-center justify-center rounded-lg bg-slate-200 text-xs font-bold text-slate-700', className)}>{media.kind}</a>;
}

export function ThreadPane({ thread, firstName, expanded, onExpand, highlightIds }: { thread: PriceThread | undefined; firstName: string; expanded: boolean; onExpand: () => void; highlightIds?: Set<string> }) {
    const shown = visibleMessages(thread, expanded);
    const hidden = (thread?.count ?? 0) - shown.length;
    return (
        <div className="space-y-2" data-testid="thread-pane">
            {hidden > 0 && (
                <button type="button" onClick={onExpand} className="w-full rounded-xl border border-dashed border-slate-300 bg-white px-3 py-2 text-xs font-bold text-slate-600" data-testid="thread-expand">
                    Show the whole thread · {hidden} earlier message{hidden === 1 ? '' : 's'}{thread?.firstInboundAt ? ` since ${new Date(thread.firstInboundAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}` : ''}
                </button>
            )}
            {shown.length === 0 && <div className="rounded-xl border border-slate-200 bg-white p-3 text-sm text-slate-500">No messages on this thread.</div>}
            {shown.map((m) => (
                <div key={m.id} className={cn('flex', m.direction === 'in' ? 'justify-start' : 'justify-end')} data-testid={`thread-message-${m.id}`}>
                    <div className={cn('max-w-[85%] rounded-2xl px-3 py-2 text-sm leading-snug', m.direction === 'in' ? 'rounded-bl-sm bg-white text-slate-900 shadow-sm' : 'rounded-br-sm bg-emerald-100 text-emerald-950', highlightIds?.has(m.id) && 'ring-2 ring-amber-400')}>
                        {m.media && <MediaView media={m.media} className={cn('mb-1 max-h-56 w-full', m.media.kind === 'image' ? 'max-w-[240px]' : 'max-w-[280px]')} />}
                        {m.body && <div className="whitespace-pre-wrap break-words">{m.body}</div>}
                        <div className="mt-1 text-[10px] font-bold uppercase tracking-wide text-slate-500">{m.direction === 'in' ? firstName : (m.by || 'us')} · {whenText(m.at)}{m.channel && m.channel !== 'whatsapp' ? ` · ${m.channel}` : ''}</div>
                    </div>
                </div>
            ))}
        </div>
    );
}

// ---------------------------------------------------------------- line card

export interface LineState {
    /**
     * P18: labour, in pounds as typed. Labour and materials are the two INPUTS; the line price is
     * their sum and is never typed. Before P18 this was `value`, the line total, and labour existed
     * nowhere: it was re-derived as price minus materials at every read, so editing a material moved
     * money between the columns without changing what the customer pays.
     */
    labour: string;
    /**
     * P18: materials in pounds when Ben typed the box directly, overriding the item list. null = the
     * box follows the list. A figure he typed must never be silently overwritten by an item edit,
     * so the items become advisory until he reverts.
     */
    materialsByHand: string | null;
    materials: Material[];
    assumptions: string[];
    /** P15: "Not included" in plain words, one entry per item. */
    notIncluded: string[];
    accepted: boolean;
    /** P16: Ben struck this line out. It leaves the totals and the send; Undo brings it back. */
    deleted?: boolean;
}

/** P16: the reason an added line always wears the check_this badge. Mirrors the server. */
export const ADDED_BY_BEN_REASON = 'added by Ben, not estimated';

/** P16: a blank line for Ben to fill in. No suggestion and no band: nothing estimated it. */
export function newAddedLine(n: number): PriceLine {
    return {
        lineId: `ben_${n}_${Math.random().toString(36).slice(2, 7)}`,
        title: '', category: null, qty: 1, minutes: null, timeSource: 'ben',
        materialsCount: 0, materialsPence: 0, materialsCostPence: 0,
        suggestedPence: null, bandLowPence: null, bandHighPence: null, confidence: null,
        checkThis: true, checkReason: ADDED_BY_BEN_REASON, flags: [], assumptions: [], notIncluded: [],
        basis: null, materials: [], evidence: { basedOnInboundId: null, quotes: [], media: [] },
    };
}

/** P16: is this a line Ben typed rather than one the chain estimated? */
export function isAddedLine(line: PriceLine): boolean {
    return line.lineId.startsWith('ben_');
}

/** P16: a patch may edit the state (price, materials…) or, on an added line, the line itself. */
export type LinePatch = Partial<LineState> & { addedTitle?: string; addedCategory?: string | null; addedMinutes?: number | null };

export function PriceLineCard({ line, state, contradictions, resolutions, margin, disabled, onChange, onResolve }: {
    line: PriceLine; state: LineState; contradictions: Contradiction[]; resolutions: Record<string, Resolution>; margin: number; disabled: boolean;
    onChange: (patch: LinePatch) => void;
    onResolve: (c: Contradiction, choice: Resolution) => void;
}) {
    const [showBasis, setShowBasis] = useState(false);
    const [showMaterials, setShowMaterials] = useState(false);
    // P18: the two boxes are the inputs; the price is their sum. `pence` stays the line TOTAL so the
    // band, check_this and "edited" keep describing the number the engine suggested.
    const labourPence = stateLabourPence(state);
    const materialsPence = stateMaterialsPence(line, state, margin);
    const pence = lineTotalPence(line, state, margin);
    const suggested = suggestedHalves(line);
    const band = bandText(line.bandLowPence, line.bandHighPence);
    const edited = line.suggestedPence != null && pence !== line.suggestedPence;
    const outOfBand = pence != null && line.bandLowPence != null && line.bandHighPence != null && (pence < line.bandLowPence || pence > line.bandHighPence);
    const mins = minutesText(line.minutes);
    const materialsByHand = state.materialsByHand != null;
    const materialsCostPence = state.materials.length ? materialsCostOf(state.materials) : (line.materialsCostPence ?? 0);
    const evidence = line.evidence;
    const mine = contradictions.filter((c) => c.lineId === line.lineId);
    const compact = state.accepted && !disabled;
    const added = isAddedLine(line);

    // P16: struck out and out of the totals, but still here until Send, with one tap back.
    if (state.deleted) {
        return (
            <div className="rounded-2xl border border-dashed border-slate-400 bg-slate-200/60 px-4 py-3" data-testid={`price-line-${line.lineId}`}>
                <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0 flex-1 text-[14px] font-bold text-slate-500 line-through" data-testid={`line-deleted-${line.lineId}`}>
                        {line.title || 'Untitled line'}
                    </div>
                    <span className="shrink-0 text-[11px] font-bold uppercase tracking-wide text-slate-400">Removed</span>
                    {!disabled && (
                        <button type="button" onClick={() => onChange({ deleted: false })}
                            className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-black text-slate-700"
                            data-testid={`line-undo-${line.lineId}`}>
                            <RotateCcw className="h-3.5 w-3.5" /> Undo
                        </button>
                    )}
                </div>
            </div>
        );
    }

    return (
        <div className={cn('rounded-2xl border bg-white p-4 shadow-md shadow-slate-900/5', line.checkThis || mine.some((c) => !resolutions[c.id]) ? 'border-amber-300' : state.accepted ? 'border-emerald-300' : 'border-slate-300')} data-testid={`price-line-${line.lineId}`}>
            <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                    {/* P16: a line Ben added types its own title, category and time. Nothing estimated it. */}
                    {added ? (
                        <div className="space-y-1.5" data-testid={`added-fields-${line.lineId}`}>
                            <input type="text" value={line.title} disabled={disabled} placeholder="What is the job?" aria-label="Line title"
                                onChange={(e) => onChange({ addedTitle: e.target.value })}
                                className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-[15px] font-black text-slate-900" data-testid={`added-title-${line.lineId}`} />
                            <div className="flex gap-1.5">
                                <select value={line.category ?? ''} disabled={disabled} aria-label="Category"
                                    onChange={(e) => onChange({ addedCategory: e.target.value || null })}
                                    className="min-w-0 flex-1 rounded-lg border border-slate-300 px-2 py-1.5 text-xs font-bold text-slate-700" data-testid={`added-category-${line.lineId}`}>
                                    <option value="">Category</option>
                                    {CATEGORY_OPTIONS.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                                </select>
                                <input type="number" min={1} max={6000} step={15} value={line.minutes?.point ?? ''} disabled={disabled} placeholder="min" aria-label="Minutes"
                                    onChange={(e) => onChange({ addedMinutes: e.target.value === '' ? null : Math.max(1, Number(e.target.value) || 0) })}
                                    className="w-20 rounded-lg border border-slate-300 px-2 py-1.5 text-xs font-bold text-slate-700" data-testid={`added-minutes-${line.lineId}`} />
                            </div>
                        </div>
                    ) : (
                        <div className="text-[15px] font-black leading-snug text-slate-900">{line.qty > 1 ? `${line.qty}× ` : ''}{line.title}</div>
                    )}
                    <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] font-bold text-slate-500">
                        {line.category && !added && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-700" data-testid="category-chip">{line.category.replace(/_/g, ' ')}</span>}
                        {mins && <span className="inline-flex items-center gap-1"><Clock className="h-3 w-3" />{mins}</span>}
                        <span className="inline-flex items-center gap-1"><Wrench className="h-3 w-3" />{state.materials.length ? `${state.materials.length} material${state.materials.length === 1 ? '' : 's'}` : 'no materials'}</span>
                        <ConfidenceDot c={line.confidence} />
                    </div>
                </div>
                {state.accepted && !state.deleted && (
                    <button type="button" onClick={() => onChange({ accepted: false })} className="inline-flex shrink-0 items-center gap-1 rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-black text-emerald-800" data-testid={`accepted-${line.lineId}`}>
                        <Check className="h-3.5 w-3.5" /> {gbp(pence)}
                    </button>
                )}
                {/* P16: remove a whole line. Struck out with an Undo, never gone until Send. */}
                {!disabled && !state.deleted && (
                    <button type="button" onClick={() => onChange({ deleted: true, accepted: false })} aria-label={`Remove ${line.title || 'this line'}`}
                        className="shrink-0 rounded-md p-1 text-slate-300 hover:text-red-600" data-testid={`line-delete-${line.lineId}`}>
                        <X className="h-4 w-4" />
                    </button>
                )}
            </div>

            {/* Her words first */}
            {evidence && (evidence.quotes.length > 0 || evidence.media.length > 0) && (
                <div className="mt-3 space-y-2" data-testid={`evidence-${line.lineId}`}>
                    {evidence.quotes.map((q) => (
                        <div key={q.messageId} className="flex items-start gap-2 rounded-xl bg-slate-50 px-3 py-2 text-[13px] italic leading-snug text-slate-800">
                            <QuoteIcon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" />
                            <span>“{q.text}” <span className="not-italic text-[10px] font-bold uppercase text-slate-400">{whenText(q.at)}</span></span>
                        </div>
                    ))}
                    {evidence.media.length > 0 && (
                        <div className="flex gap-2 overflow-x-auto pb-1">
                            {evidence.media.map((m) => <MediaView key={m.messageId + m.url} media={{ url: m.url, kind: m.kind }} className="h-20 w-20 shrink-0" />)}
                        </div>
                    )}
                </div>
            )}

            {/* Contradictions: one sentence, two taps */}
            {mine.map((c) => {
                const r = resolutions[c.id];
                return (
                    <div key={c.id} className={cn('mt-3 rounded-xl px-3 py-2 text-xs font-bold', r ? 'bg-emerald-50 text-emerald-900' : 'bg-amber-50 text-amber-900')} data-testid={`contradiction-${c.id}`}>
                        <div className="flex items-start gap-2">
                            {r ? <Check className="mt-0.5 h-3.5 w-3.5 shrink-0" /> : <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />}
                            <span>{r ? (r === 'drop_materials' ? `Dropped ${c.materialNames.join(' and ')}.` : `Kept ${c.materialNames.join(' and ')}, assumption dropped.`) : <><span className="uppercase tracking-wide">Check this</span> · {c.sentence}</>}</span>
                        </div>
                        {!r && !disabled && (
                            <div className="mt-2 flex flex-wrap gap-2">
                                {c.options.map((o) => (
                                    <button key={o.id} type="button" onClick={() => onResolve(c, o.id)} className="rounded-lg border border-amber-300 bg-white px-2.5 py-1.5 text-xs font-black text-amber-900" data-testid={`resolve-${c.id}-${o.id}`}>{o.label}</button>
                                ))}
                            </div>
                        )}
                    </div>
                );
            })}

            {line.checkThis && (
                <div className="mt-3 flex items-start gap-2 rounded-xl bg-amber-50 px-3 py-2 text-xs font-bold text-amber-900" data-testid="check-this">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    <span><span className="uppercase tracking-wide">Check this</span>{line.checkReason ? ` · ${line.checkReason}` : ''}</span>
                </div>
            )}

            {!compact && (
                <>
                    {/* P18: labour and materials are the two inputs. The price below is their sum. */}
                    <div className="mt-3 grid grid-cols-2 gap-2">
                        <label className="block">
                            <span className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Labour</span>
                            <div className={cn('mt-1 flex items-center rounded-xl border-2 bg-white px-2.5', labourPence == null && state.labour !== '' ? 'border-red-400' : 'border-slate-300')}>
                                <span className="text-lg font-black text-slate-500">£</span>
                                <input
                                    type="number" inputMode="decimal" min={0} step={1}
                                    className="w-full bg-transparent py-2 pl-1 text-xl font-black text-slate-900 outline-none"
                                    value={state.labour} disabled={disabled}
                                    onChange={(e) => onChange({ labour: e.target.value, accepted: false })}
                                    aria-label={`Labour for ${line.title}`}
                                    data-testid={`labour-input-${line.lineId}`}
                                />
                            </div>
                        </label>
                        <label className="block">
                            <span className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Materials</span>
                            <div className={cn('mt-1 flex items-center rounded-xl border-2 bg-white px-2.5', materialsByHand ? 'border-slate-900' : 'border-slate-300')}>
                                <span className="text-lg font-black text-slate-500">£</span>
                                <input
                                    type="number" inputMode="decimal" min={0} step={1}
                                    className="w-full bg-transparent py-2 pl-1 text-xl font-black text-slate-900 outline-none"
                                    value={materialsByHand ? state.materialsByHand! : penceToPoundsText(materialsPence)}
                                    disabled={disabled}
                                    onChange={(e) => onChange({ materialsByHand: e.target.value, accepted: false })}
                                    aria-label={`Materials for ${line.title}`}
                                    data-testid={`materials-input-${line.lineId}`}
                                />
                            </div>
                        </label>
                    </div>
                    {state.labour !== '' && labourPence == null && (
                        <div className="mt-1 text-[11px] font-bold text-red-600" data-testid={`labour-invalid-${line.lineId}`}>Labour must be £0 or more.</div>
                    )}
                    {materialsByHand && (
                        <div className="mt-1 flex items-center gap-2 text-[11px] font-bold text-slate-600" data-testid={`materials-by-hand-${line.lineId}`}>
                            <span>Materials set by hand. The items below are advisory.</span>
                            {!disabled && (
                                <button type="button" onClick={() => onChange({ materialsByHand: null, accepted: false })}
                                    className="inline-flex items-center gap-1 rounded-md border border-slate-300 px-1.5 py-0.5 text-slate-700"
                                    data-testid={`materials-revert-${line.lineId}`}>
                                    <RotateCcw className="h-3 w-3" /> use the list
                                </button>
                            )}
                        </div>
                    )}
                    <div className="mt-2 flex items-end gap-2">
                        <div className={cn('flex-1 rounded-xl border-2 px-3 py-2', outOfBand ? 'border-amber-400 bg-amber-50' : edited ? 'border-slate-900 bg-white' : 'border-slate-300 bg-white')}>
                            <div className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Line price</div>
                            <div className="text-2xl font-black text-slate-900" data-testid={`line-total-${line.lineId}`}>
                                {pence == null ? '—' : gbp(pence)}
                            </div>
                        </div>
                        {edited && !disabled && suggested.labourPence != null && (
                            <button type="button" onClick={() => onChange({ labour: penceToPoundsText(suggested.labourPence), materialsByHand: null, materials: (line.materials ?? []).map((m) => ({ ...m })) })}
                                className="mb-1 inline-flex items-center gap-1 rounded-lg border border-slate-300 px-2.5 py-2 text-xs font-bold text-slate-700"
                                data-testid={`reset-${line.lineId}`}>
                                <RotateCcw className="h-3.5 w-3.5" /> {gbp(line.suggestedPence)}
                            </button>
                        )}
                        {!disabled && pence != null && (
                            <button type="button" onClick={() => onChange({ accepted: true })}
                                className="mb-1 inline-flex h-11 items-center gap-1 rounded-xl bg-slate-900 px-3 text-sm font-black text-white"
                                data-testid={`accept-${line.lineId}`}>
                                <Check className="h-4 w-4" /> Accept
                            </button>
                        )}
                    </div>
                    <div className="mt-1.5 flex flex-wrap items-center gap-x-3 text-xs font-bold text-slate-500">
                        {band ? <span data-testid="band">Band {band}</span> : <span data-testid="band">No band</span>}
                        {line.suggestedPence == null && <span className="text-amber-700">No suggestion, price by hand</span>}
                        {edited && <span className="inline-flex items-center gap-1 text-slate-900"><PenLine className="h-3 w-3" /> edited</span>}
                        {outOfBand && <span className="text-amber-700" data-testid="out-of-band">outside the band</span>}
                        {/* P16b put the split here as a read-only chip because the line showed only its
                            total. P18 made both halves editable boxes above, so the chip would repeat them
                            word for word; what is left is the materials figure the item list feeds. */}
                        {pence != null && materialsPence > 0 && (
                            <span data-testid={`split-${line.lineId}`}>
                                incl. <span data-testid={`materials-pence-${line.lineId}`}>{gbp(materialsPence)}</span> materials
                            </span>
                        )}
                        {pence != null && materialsPence === 0 && <span data-testid={`split-${line.lineId}`}>all labour</span>}
                        {line.basis && (
                            <button type="button" onClick={() => setShowBasis((s) => !s)} className="inline-flex items-center gap-0.5 text-slate-700 underline decoration-dotted" data-testid={`basis-toggle-${line.lineId}`}>
                                basis {showBasis ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                            </button>
                        )}
                    </div>
                    {showBasis && line.basis && (
                        <div className="mt-2 rounded-xl bg-slate-50 px-3 py-2 text-[11px] text-slate-600" data-testid={`basis-${line.lineId}`}>
                            {line.basis.minutes != null && <div>{line.basis.minutes} min on the wire{line.minutes ? ` (${line.minutes.low}–${line.minutes.high} on site, plus the job's setup and cleanup share)` : ''}</div>}
                            {line.basis.ratePencePerHour != null && <div>Reference rate {gbp(line.basis.ratePencePerHour)}/hr</div>}
                            {line.basis.marginPct != null && <div>Materials at {line.basis.marginPct}% margin</div>}
                            {line.basis.rules.length > 0 && <div>Rules: {line.basis.rules.join('; ')}</div>}
                            {line.timeSource && <div>Time from {line.timeSource}</div>}
                        </div>
                    )}

                    {/* Materials: the list, swap or remove */}
                    {state.materials.length > 0 && (
                        <div className="mt-3 rounded-xl border border-slate-200">
                            <button type="button" onClick={() => setShowMaterials((s) => !s)} className="flex w-full items-center justify-between px-3 py-2 text-xs font-black text-slate-800" data-testid={`materials-toggle-${line.lineId}`}>
                                <span>Materials ({state.materials.length}) · {gbp(materialsPence)} at {margin}%</span>{showMaterials ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                            </button>
                            {showMaterials && (
                                <ul className="divide-y divide-slate-100 border-t border-slate-100" data-testid={`materials-${line.lineId}`}>
                                    {state.materials.map((m) => (
                                        <li key={m.index} className="flex items-center gap-2 px-3 py-2 text-sm" data-testid={`material-${line.lineId}-${m.index}`}>
                                            <input type="text" value={m.name} disabled={disabled} aria-label="Material name"
                                                onChange={(e) => onChange({ materials: state.materials.map((x) => x.index === m.index ? { ...x, name: e.target.value } : x) })}
                                                className="min-w-0 flex-1 rounded-md border border-slate-200 px-2 py-1 text-sm" data-testid={`material-name-${line.lineId}-${m.index}`} />
                                            <input type="number" min={1} value={m.qty} disabled={disabled} aria-label="Quantity"
                                                onChange={(e) => onChange({ materials: state.materials.map((x) => x.index === m.index ? { ...x, qty: Math.max(1, Number(e.target.value) || 1) } : x) })}
                                                className="w-14 rounded-md border border-slate-200 px-2 py-1 text-sm" data-testid={`material-qty-${line.lineId}-${m.index}`} />
                                            <div className="flex w-24 items-center rounded-md border border-slate-200 px-1.5">
                                                <span className="text-xs text-slate-500">£</span>
                                                <input type="number" min={0} step="0.01" value={m.unitCostPence != null ? penceToPoundsText(m.unitCostPence) : ''} disabled={disabled} aria-label="Unit cost"
                                                    onChange={(e) => onChange({ materials: state.materials.map((x) => x.index === m.index ? { ...x, unitCostPence: e.target.value === '' ? 0 : Math.round(Number(e.target.value) * 100) } : x) })}
                                                    className="w-full py-1 pl-0.5 text-sm outline-none" data-testid={`material-cost-${line.lineId}-${m.index}`} />
                                            </div>
                                            {!disabled && (
                                                <button type="button" aria-label={`Remove ${m.name}`} onClick={() => onChange({ materials: state.materials.filter((x) => x.index !== m.index) })} className="rounded-md p-1 text-slate-400 hover:text-red-600" data-testid={`material-remove-${line.lineId}-${m.index}`}>
                                                    <X className="h-4 w-4" />
                                                </button>
                                            )}
                                        </li>
                                    ))}
                                </ul>
                            )}
                            {showMaterials && !disabled && (
                                <div className="border-t border-slate-100 px-3 py-2">
                                    {/* P18: the missing control. Cost in, margin applied for her. */}
                                    <button type="button" onClick={() => onChange({ materials: [...state.materials, { lineId: line.lineId, index: nextMaterialIndex(state.materials), name: '', qty: 1, unitCostPence: 0, source: 'ben' }] })}
                                        className="text-xs font-black text-slate-700 underline decoration-dotted" data-testid={`material-add-${line.lineId}`}>
                                        + add a material
                                    </button>
                                </div>
                            )}
                            {showMaterials && (
                                <div className="border-t border-slate-100 px-3 py-2 text-[11px] font-bold text-slate-500" data-testid={`materials-cost-${line.lineId}`}>
                                    Cost {gbp(materialsCostPence)} · she pays {gbp(materialsPence)} at {margin}%
                                    {materialsByHand && <span className="text-slate-400"> · the box is set by hand, so this is advisory</span>}
                                </div>
                            )}
                        </div>
                    )}

                    {/* Assumptions: customer-facing text Ben edits or drops */}
                    {state.assumptions.length > 0 && (
                        <div className="mt-3" data-testid={`assumptions-${line.lineId}`}>
                            <div className="text-[11px] font-bold uppercase tracking-wide text-slate-500">On the quote as assumptions</div>
                            <ul className="mt-1 space-y-1">
                                {state.assumptions.map((a, i) => (
                                    <li key={i} className="flex items-center gap-2">
                                        <input type="text" value={a} disabled={disabled} aria-label={`Assumption ${i + 1}`}
                                            onChange={(e) => onChange({ assumptions: state.assumptions.map((x, j) => j === i ? e.target.value : x) })}
                                            className="min-w-0 flex-1 rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-700" data-testid={`assumption-${line.lineId}-${i}`} />
                                        {!disabled && (
                                            <button type="button" aria-label="Drop this assumption" onClick={() => onChange({ assumptions: state.assumptions.filter((_, j) => j !== i) })} className="rounded-md p-1 text-slate-400 hover:text-red-600" data-testid={`assumption-drop-${line.lineId}-${i}`}>
                                                <X className="h-4 w-4" />
                                            </button>
                                        )}
                                    </li>
                                ))}
                            </ul>
                        </div>
                    )}

                    {/* P15 part 1: "Not included", customer-facing plain words Ben edits, adds or drops. Renders on the quote page and in the contractor's pack. */}
                    <div className="mt-3" data-testid={`not-included-${line.lineId}`}>
                        <div className="text-[11px] font-bold uppercase tracking-wide text-slate-500">On the quote as not included</div>
                        {state.notIncluded.length > 0 && (
                            <ul className="mt-1 space-y-1">
                                {state.notIncluded.map((a, i) => (
                                    <li key={i} className="flex items-center gap-2">
                                        <input type="text" value={a} disabled={disabled} aria-label={`Not included ${i + 1}`} placeholder="e.g. small top door not included"
                                            onChange={(e) => onChange({ notIncluded: state.notIncluded.map((x, j) => j === i ? e.target.value : x) })}
                                            className="min-w-0 flex-1 rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-700" data-testid={`not-included-${line.lineId}-${i}`} />
                                        {!disabled && (
                                            <button type="button" aria-label="Drop this not-included item" onClick={() => onChange({ notIncluded: state.notIncluded.filter((_, j) => j !== i) })} className="rounded-md p-1 text-slate-400 hover:text-red-600" data-testid={`not-included-drop-${line.lineId}-${i}`}>
                                                <X className="h-4 w-4" />
                                            </button>
                                        )}
                                    </li>
                                ))}
                            </ul>
                        )}
                        {!disabled && state.notIncluded.length < 8 && (
                            <button type="button" onClick={() => onChange({ notIncluded: [...state.notIncluded, ''] })} className="mt-1 text-xs font-bold text-slate-700 underline decoration-dotted" data-testid={`not-included-add-${line.lineId}`}>
                                + add something that is not included
                            </button>
                        )}
                    </div>
                </>
            )}
        </div>
    );
}

// ---------------------------------------------------------------- the screen

function initialLineState(l: PriceLine): LineState {
    // P18: seed the labour box from what the engine costed as labour; the materials box follows the
    // item list until Ben types in it.
    const { labourPence } = suggestedHalves(l);
    return {
        labour: labourPence == null ? '' : penceToPoundsText(labourPence),
        materialsByHand: null,
        materials: (l.materials ?? []).map((m) => ({ ...m })),
        assumptions: [...l.assumptions], notIncluded: [...(l.notIncluded ?? [])], accepted: false, deleted: false,
    };
}

/** P15: the not-included list as it would be sent (trimmed, blanks dropped). */
export function cleanNotIncluded(items: string[]): string[] {
    return items.map((s) => s.replace(/\s+/g, ' ').trim()).filter(Boolean).slice(0, 8);
}

export function PriceAndSend({ slug }: { slug: string }) {
    const qc = useQueryClient();
    const desktop = useIsDesktop();
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

    const [states, setStates] = useState<Record<string, LineState>>({});
    /** P16: lines Ben typed on this screen. They live here until Send writes them onto the quote. */
    const [addedLines, setAddedLines] = useState<PriceLine[]>([]);
    const messageRef = useRef<HTMLTextAreaElement | null>(null);
    const [resolutions, setResolutions] = useState<Record<string, Resolution>>({});
    const [message, setMessage] = useState('');
    const [tab, setTab] = useState<'thread' | 'price'>('price');
    const [threadExpanded, setThreadExpanded] = useState(false);
    const [sheet, setSheet] = useState<null | 'ask' | 'visit'>(null);
    const [sheetText, setSheetText] = useState('');
    const [busy, setBusy] = useState<null | 'send' | 'ask' | 'call' | 'visit'>(null);
    const [result, setResult] = useState<SendResult | null>(null);
    const [superseded, setSuperseded] = useState<string | null>(null);
    const [hold, setHold] = useState<QuoteHold | null>(null);
    const [actionError, setActionError] = useState<string | null>(null);

    // Prefill whenever a fresh payload arrives (a reload after 409 re-prefills).
    useEffect(() => {
        if (!data) return;
        setStates(Object.fromEntries(data.lines.map((l) => [l.lineId, initialLineState(l)])));
        setAddedLines([]);
        setResolutions({});
        setMessage(data.message?.body ?? '');
        setHold(data.hold ?? null);
        setSuperseded(null);
    }, [data?.version]); // eslint-disable-line react-hooks/exhaustive-deps

    const contradictions = data?.contradictions ?? [];
    const margin = data?.settings?.materialsMarginPercent ?? 0;
    // P16: the draft's lines plus any Ben typed. Added lines sort last: they have no doubt score
    // worth ranking, and he is still filling them in.
    const allLines = useMemo(() => [...(data?.lines ?? []), ...addedLines], [data, addedLines]);
    const ordered = useMemo(() => [...orderByDoubt(data?.lines ?? [], contradictions), ...addedLines], [data, contradictions, addedLines]);
    const kept = useMemo(() => allLines.filter((l) => !states[l.lineId]?.deleted), [allLines, states]);
    // P18: the line price is the sum of its two boxes, and the summary is the sum of the lines.
    const finals = useMemo(() => Object.fromEntries(allLines.map((l) => [l.lineId, lineTotalPence(l, states[l.lineId], margin)])), [allLines, states, margin]);
    const labourPence = useMemo(() => Object.fromEntries(allLines.map((l) => [l.lineId, stateLabourPence(states[l.lineId]) ?? 0])), [allLines, states]);
    const materialsPence = useMemo(() => Object.fromEntries(allLines.map((l) => [l.lineId, stateMaterialsPence(l, states[l.lineId], margin)])), [allLines, states, margin]);
    // Deleted lines are out of every total, exactly as they will be out of the quote.
    const totals = useMemo(() => totalsOf(kept, finals, data?.settings?.depositPercent ?? 30, materialsPence), [kept, finals, materialsPence, data]);
    const messageEdited = !!data && message.trim() !== (data.message?.body ?? '').trim();
    const warnings = useMemo(() => messageWarnings(message), [message]);
    // P16: the link lives in the message Ben reads. If he deletes it, say so and offer it back.
    const linkPresent = !data || hasQuoteLink(message, data.quoteUrl);

    function insertLink() {
        if (!data) return;
        const el = messageRef.current;
        const at = el ? el.selectionStart : message.length;
        setMessage(insertAt(message, data.quoteUrl, at));
        requestAnimationFrame(() => el?.focus());
    }

    const locked = !data || data.status !== 'draft' || !!result?.ok || !!superseded;
    // P16: an added line with no title is not a line yet, so it blocks the send the same way a
    // missing price does. Send is otherwise blocked only by a kept line without a price.
    const untitledAdded = addedLines.some((l) => !states[l.lineId]?.deleted && !l.title.trim());
    const canSend = !!data && data.status === 'draft' && !busy && totals.missing === 0 && !untitledAdded && kept.length > 0 && !result?.ok && !superseded;

    function patch(lineId: string, p: LinePatch) {
        const { addedTitle, addedCategory, addedMinutes, ...statePatch } = p;
        if (addedTitle !== undefined || addedCategory !== undefined || addedMinutes !== undefined) {
            setAddedLines((ls) => ls.map((l) => l.lineId !== lineId ? l : {
                ...l,
                ...(addedTitle !== undefined ? { title: addedTitle } : {}),
                ...(addedCategory !== undefined ? { category: addedCategory } : {}),
                ...(addedMinutes !== undefined ? { minutes: addedMinutes == null ? null : { point: addedMinutes, low: addedMinutes, high: addedMinutes } } : {}),
            }));
        }
        if (Object.keys(statePatch).length) {
            setStates((s) => ({ ...s, [lineId]: { ...(s[lineId] ?? { labour: '', materialsByHand: null, materials: [], assumptions: [], notIncluded: [], accepted: false }), ...statePatch } }));
        }
    }

    /** P16: one more card, empty, for something the estimate never saw. */
    function addLine() {
        const line = newAddedLine(addedLines.length + 1);
        setAddedLines((ls) => [...ls, line]);
        setStates((s) => ({ ...s, [line.lineId]: { labour: '', materialsByHand: null, materials: [], assumptions: [], notIncluded: [], accepted: false, deleted: false } }));
    }
    function resolve(c: Contradiction, choice: Resolution) {
        setResolutions((r) => ({ ...r, [c.id]: choice }));
        const st = states[c.lineId];
        if (!st) return;
        if (choice === 'drop_materials') patch(c.lineId, { materials: st.materials.filter((m) => !c.materialIndexes.includes(m.index)) });
        else patch(c.lineId, { assumptions: st.assumptions.filter((_, i) => i !== c.assumptionIndex) });
    }

    function sendBody() {
        if (!data) return null;
        return {
            version: data.version,
            lines: allLines.map((l) => {
                const st = states[l.lineId];
                // P16: a deleted line carries nothing but the fact that it is gone.
                if (st?.deleted) return { lineId: l.lineId, deleted: true };
                const original = l.materials ?? [];
                const materialsChanged = !st || st.materials.length !== original.length || st.materials.some((m, i) => m.name !== original[i]?.name || m.qty !== original[i]?.qty || (m.unitCostPence ?? 0) !== (original[i]?.unitCostPence ?? 0));
                const assumptionsChanged = !st || JSON.stringify(st.assumptions) !== JSON.stringify(l.assumptions);
                const notIncluded = st ? cleanNotIncluded(st.notIncluded) : [];
                const notIncludedChanged = !st || JSON.stringify(notIncluded) !== JSON.stringify(l.notIncluded ?? []);
                return {
                    lineId: l.lineId, finalPence: finals[l.lineId],
                    // P18: both halves, always, so the server never has to re-derive labour. They sum
                    // to finalPence by construction here, and validateSendBody refuses it if they do not.
                    labourPence: labourPence[l.lineId],
                    materialsPence: materialsPence[l.lineId],
                    ...(st && materialsChanged ? { materials: st.materials.map((m) => ({ name: m.name, qty: m.qty, unitCostPence: m.unitCostPence ?? 0, source: m.source })) } : {}),
                    ...(st && assumptionsChanged ? { assumptions: st.assumptions } : {}),
                    ...(st && notIncludedChanged ? { notIncluded } : {}),
                    // P16: a line Ben typed brings its own title, category and time; nothing estimated it.
                    ...(isAddedLine(l) ? { added: { title: l.title.trim(), category: l.category, minutesPoint: l.minutes?.point ?? null } } : {}),
                };
            }),
            message: message.trim(), messageEdited,
            resolutions: Object.entries(resolutions).map(([contradictionId, choice]) => ({ contradictionId, choice })),
        };
    }

    async function post(path: string, body: unknown): Promise<{ status: number; json: any }> {
        const res = await fetch(`/api/spine/price/${encodeURIComponent(slug)}/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...getAuthHeaders() }, body: JSON.stringify(body ?? {}) });
        const json = await res.json().catch(() => ({ ok: false, errors: [`${path} failed (${res.status})`] }));
        return { status: res.status, json };
    }

    async function send() {
        if (!data || !canSend) return;
        setBusy('send'); setResult(null); setActionError(null);
        try {
            const { status, json } = await post('send', sendBody());
            if (status === 409) { setSuperseded(json.errors?.[0] ?? 'This draft changed since it loaded.'); return; }
            setResult({ ...json, ok: status >= 200 && status < 300 && json.ok !== false });
            if (status >= 200 && status < 300) void qc.invalidateQueries({ queryKey: ['spine-price', data.slug] });
        } catch (e: any) {
            setResult({ ok: false, errors: [e?.message ?? 'Send failed'] });
        } finally { setBusy(null); }
    }

    async function exit(kind: 'ask' | 'call' | 'visit') {
        if (!data || locked) return;
        setBusy(kind); setActionError(null);
        try {
            const body = kind === 'ask' ? { question: sheetText } : kind === 'visit' ? { why: sheetText } : {};
            const { status, json } = await post(kind, body);
            if (status === 409) { setSuperseded(json.errors?.[0] ?? 'This draft changed since it loaded.'); return; }
            if (!json.ok) { setActionError(json.errors?.[0] ?? `${kind} failed`); return; }
            setHold(json.hold ?? null);
            setSheet(null); setSheetText('');
            if (kind === 'call') {
                const tel = json.tel ?? data.call?.customerPhone;
                if (tel && typeof window !== 'undefined') window.location.href = `tel:${tel}`;
            }
        } catch (e: any) {
            setActionError(e?.message ?? `${kind} failed`);
        } finally { setBusy(null); }
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

    const first = data.customer.firstName;
    const readiness = data.customer.readiness;
    const statusBanner = data.status === 'sent'
        ? { cls: 'border-emerald-200 bg-emerald-50 text-emerald-900', text: 'This quote has already been sent.' }
        : data.status === 'superseded'
            ? { cls: 'border-amber-200 bg-amber-50 text-amber-900', text: 'A new scope arrived and this draft was superseded. Open the thread for the new one.' }
            : data.status === 'revoked'
                ? { cls: 'border-red-200 bg-red-50 text-red-900', text: 'This quote was revoked.' }
                : null;

    // After Send: confirm and say what happens next, then the next quote waiting.
    if (result?.ok) {
        const next = result.nextWaiting ?? data.nextWaiting ?? null;
        return (
            <div className="mx-auto max-w-md px-4 py-10" data-testid="confirm-screen">
                <div className="rounded-3xl border border-emerald-300 bg-emerald-50 p-6 text-emerald-950">
                    <div className="flex items-center gap-2 text-xl font-black"><CheckCircle2 className="h-6 w-6" /> {result.sent ? (result.mode === 'template' ? 'Sent by WhatsApp template' : 'Sent on WhatsApp') : result.queued ? 'Queued for the window' : 'Done'}</div>
                    <p className="mt-3 text-base font-bold" data-testid="next-steps">{result.nextSteps ?? `Sent to ${first}.${result.totals ? ` Deposit ${gbp(result.totals.depositPence)}.` : ''}`}</p>
                    {result.message && <p className="mt-1 text-sm">{result.message}</p>}
                    {result.totals && <p className="mt-2 text-sm">{gbp(result.totals.totalPence)} total · labour {gbp(result.totals.labourPence)} · materials {gbp(result.totals.materialsPence)}</p>}
                    {result.quoteUrl && <a className="mt-2 block truncate font-mono text-xs underline" href={result.quoteUrl}>{result.quoteUrl}</a>}
                </div>
                {next ? (
                    <a href={`/admin/price/${next.slug}`} className="mt-4 inline-flex h-14 w-full items-center justify-center gap-2 rounded-2xl bg-slate-900 text-lg font-black text-white" data-testid="next-waiting">
                        Next quote waiting: {next.firstName} <ArrowRight className="h-5 w-5" />
                    </a>
                ) : (
                    <div className="mt-4 rounded-2xl border border-slate-300 bg-white p-4 text-center text-sm font-bold text-slate-600 shadow-md shadow-slate-900/5" data-testid="nothing-waiting">Nothing else waiting to be priced.</div>
                )}
                {data.conversationId && <a href={`/admin/comms?conversation=${encodeURIComponent(data.conversationId)}`} className="mt-3 block text-center text-sm font-bold text-slate-600 underline">Open {first}'s thread</a>}
            </div>
        );
    }

    const pricePane = (
        <div className="space-y-3" data-testid="price-pane">
            {statusBanner && <div className={cn('rounded-xl border px-3 py-2 text-sm font-bold', statusBanner.cls)} data-testid="status-banner">{statusBanner.text}</div>}
            {superseded && (
                <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900" data-testid="superseded-banner">
                    <div className="font-black">{refusalTitle(superseded)}</div>
                    <p className="mt-0.5">{superseded}</p>
                    <button type="button" onClick={() => { setResult(null); void refetch(); }} disabled={isFetching}
                        className="mt-2 inline-flex items-center gap-1 rounded-lg bg-amber-900 px-3 py-2 text-xs font-black text-white" data-testid="reload">
                        <RefreshCw className={cn('h-3.5 w-3.5', isFetching && 'animate-spin')} /> Reload the draft
                    </button>
                </div>
            )}
            {hold && !locked && (
                <div className="rounded-xl border border-sky-200 bg-sky-50 px-3 py-2 text-sm font-bold text-sky-900" data-testid="hold-banner">
                    {HOLD_LABEL[hold.reason]}{hold.question ? <div className="mt-1 font-normal italic">“{hold.question}”</div> : null}
                </div>
            )}
            {result && !result.ok && (
                <div className="rounded-xl border border-red-300 bg-red-50 p-3 text-sm text-red-900" data-testid="send-error">
                    <div className="font-black">{result.priced ? 'Prices saved, but the send did not go through' : 'Not sent'}</div>
                    <ul className="mt-1 list-disc pl-4">{(result.errors ?? [result.message ?? 'Send failed']).map((e, i) => <li key={i}>{e}</li>)}</ul>
                </div>
            )}
            {actionError && <div className="rounded-xl border border-red-300 bg-red-50 p-3 text-sm font-bold text-red-900" data-testid="action-error">{actionError}</div>}

            {data.lines.length === 0 && <div className="rounded-xl border border-slate-300 bg-white p-4 text-sm text-slate-600 shadow-md shadow-slate-900/5">This draft has no lines. Open the full builder.</div>}
            {ordered.map((l) => (
                <PriceLineCard key={l.lineId} line={l} state={states[l.lineId] ?? initialLineState(l)} contradictions={contradictions} resolutions={resolutions}
                    margin={margin} disabled={locked} onChange={(p) => patch(l.lineId, p)} onResolve={resolve} />
            ))}

            {/* P16: something the estimate never saw. The same card, empty. */}
            {!locked && (
                <button type="button" onClick={addLine}
                    className="w-full rounded-2xl border-2 border-dashed border-slate-400 bg-white/70 py-3 text-sm font-black text-slate-600 hover:border-slate-500 hover:bg-white hover:text-slate-900"
                    data-testid="add-line">
                    + Add a line
                </button>
            )}

            {/* Totals */}
            <div className="rounded-2xl bg-slate-900 p-4 text-white" data-testid="totals">
                <div className="grid grid-cols-2 gap-y-1 text-sm">
                    <span className="text-slate-300">Labour</span><span className="text-right font-bold">{gbp(totals.labourPence)}</span>
                    <span className="text-slate-300">Materials at {data.settings.materialsMarginPercent}%</span><span className="text-right font-bold">{gbp(totals.materialsPence)}</span>
                    <span className="mt-1 text-base font-black">Total</span><span className="mt-1 text-right text-base font-black" data-testid="total">{gbp(totals.totalPence)}</span>
                    <span className="text-slate-300">Deposit (materials in full + {data.settings.depositPercent}% of labour)</span><span className="text-right font-bold" data-testid="deposit">{gbp(totals.depositPence)}</span>
                </div>
                {totals.missing > 0 && <div className="mt-2 text-xs font-bold text-amber-300" data-testid="missing-prices">{totals.missing} line{totals.missing === 1 ? '' : 's'} still need{totals.missing === 1 ? 's' : ''} a price</div>}
                {untitledAdded && <div className="mt-2 text-xs font-bold text-amber-300" data-testid="missing-title">An added line still needs a title</div>}
            </div>

            {/* The message she reads */}
            <div className="rounded-2xl border border-slate-300 bg-white p-4 shadow-md shadow-slate-900/5">
                <div className="flex items-center justify-between">
                    <span className="text-[11px] font-bold uppercase tracking-wide text-slate-500">What {first} reads</span>
                    <div className="flex items-center gap-2">
                        {/* P16: he can put the link back where he wants it, at the cursor. */}
                        {!locked && !linkPresent && (
                            <button type="button" onClick={insertLink} className="inline-flex items-center gap-1 rounded-md bg-slate-900 px-2 py-1 text-[11px] font-black text-white" data-testid="insert-link">
                                + link
                            </button>
                        )}
                        {messageEdited && !locked && (
                            <button type="button" onClick={() => setMessage(data.message?.body ?? '')} className="inline-flex items-center gap-1 text-xs font-bold text-slate-600" data-testid="message-reset"><RotateCcw className="h-3 w-3" /> desk's draft</button>
                        )}
                    </div>
                </div>
                <textarea value={message} disabled={locked} onChange={(e) => setMessage(e.target.value)} rows={6}
                    ref={messageRef}
                    className="mt-1 w-full resize-y rounded-xl border border-slate-300 px-3 py-2 text-sm leading-snug text-slate-900 outline-none focus:border-slate-900"
                    aria-label={`Message ${first} reads`} data-testid="message-body" />
                <div className="mt-1 text-[11px] text-slate-500">This is exactly what she receives, link and all.{messageEdited ? ' Edited.' : ''}</div>
                {!linkPresent && <div className="mt-1 text-[11px] font-bold text-amber-700" data-testid="no-link-warning">No quote link in the message, so the customer will have no way to open the quote. You can still send.</div>}
                {warnings.length > 0 && <div className="mt-1 text-[11px] font-bold text-amber-700" data-testid="message-warnings">Careful: the message {warnings.join('; ')}.</div>}
            </div>
            <div className="h-2" />
        </div>
    );

    const threadPane = <ThreadPane thread={data.thread} firstName={first} expanded={threadExpanded} onExpand={() => setThreadExpanded(true)} />;

    return (
        <div className={cn('mx-auto min-h-screen bg-slate-100 pb-44', desktop ? 'max-w-6xl' : 'max-w-md')} data-testid="price-and-send" data-layout={desktop ? 'desktop' : 'phone'}>
            {/* Header: who, where, what kind, how ready */}
            <div className="sticky top-0 z-10 border-b border-slate-200 bg-white/95 px-4 py-3 backdrop-blur">
                <div className="flex items-baseline justify-between gap-2">
                    <h1 className="truncate text-xl font-black text-slate-900" data-testid="customer-first-name">{first}</h1>
                    {data.customer.postcode && <span className="rounded-md bg-slate-900 px-2 py-0.5 font-mono text-xs font-bold text-white" data-testid="postcode">{data.customer.postcode}</span>}
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] font-bold">
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-700" data-testid="customer-type">{CUSTOMER_TYPE_LABEL[data.customer.customerType] ?? data.customer.customerType}</span>
                    {readiness && <span className={cn('rounded-full px-2 py-0.5', readiness === 'quote_ready' ? 'bg-emerald-100 text-emerald-800' : readiness === 'visit_first' ? 'bg-violet-100 text-violet-800' : readiness === 'decline' ? 'bg-red-100 text-red-800' : 'bg-amber-100 text-amber-800')} data-testid="readiness">{READINESS_LABEL[readiness] ?? readiness}</span>}
                    {data.estimate?.confidence && <span className="text-slate-500">estimate {data.estimate.confidence}</span>}
                    {data.job && (data.job.setupMinutes || data.job.cleanupMinutes) ? <span className="text-slate-500">+{data.job.setupMinutes + data.job.cleanupMinutes} min setup/cleanup</span> : null}
                    {contradictions.length > 0 && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-amber-800" data-testid="contradiction-count">{contradictions.length} to check</span>}
                </div>
                {!desktop && (
                    <div className="mt-2 grid grid-cols-2 gap-1 rounded-xl bg-slate-100 p-1 text-sm font-black" role="tablist" data-testid="tabs">
                        <button type="button" role="tab" aria-selected={tab === 'thread'} onClick={() => setTab('thread')} className={cn('rounded-lg py-1.5', tab === 'thread' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500')} data-testid="tab-thread">Thread{data.thread?.count ? ` · ${data.thread.count}` : ''}</button>
                        <button type="button" role="tab" aria-selected={tab === 'price'} onClick={() => setTab('price')} className={cn('rounded-lg py-1.5', tab === 'price' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500')} data-testid="tab-price">Price</button>
                    </div>
                )}
            </div>

            {desktop ? (
                <div className="grid grid-cols-[minmax(320px,2fr)_minmax(380px,3fr)] gap-4 px-4 pt-3" data-testid="side-by-side">
                    <div className="max-h-[calc(100vh-140px)] overflow-y-auto rounded-2xl bg-slate-100 p-3">{threadPane}</div>
                    <div>{pricePane}</div>
                </div>
            ) : (
                <div className="px-4 pt-3">{tab === 'thread' ? <div className="rounded-2xl bg-slate-100 p-3">{threadPane}</div> : pricePane}</div>
            )}

            {/* Sheets: one question / why a visit */}
            {sheet && (
                <div className="fixed inset-0 z-30 flex items-end justify-center bg-black/40 p-3" onClick={() => !busy && setSheet(null)}>
                    <div className="w-full max-w-md rounded-3xl bg-white p-4 shadow-2xl" onClick={(e) => e.stopPropagation()} data-testid={`${sheet}-sheet`}>
                        <div className="text-base font-black text-slate-900">{sheet === 'ask' ? `Ask ${first} one thing first` : `Offer ${first} a visit instead of a price`}</div>
                        <p className="mt-1 text-xs text-slate-600">{sheet === 'ask' ? 'It goes to your queue to approve, then to her. The quote stays here until she answers.' : 'The survey offer (fee from settings) goes to your queue to approve. No price goes out.'}</p>
                        <textarea value={sheetText} onChange={(e) => setSheetText(e.target.value)} rows={3} autoFocus
                            placeholder={sheet === 'ask' ? 'Are the handles staying, or do you want new ones?' : 'Why a visit (optional): what it depends on'}
                            className="mt-2 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-900" data-testid={sheet === 'ask' ? 'ask-question' : 'visit-why'} />
                        <div className="mt-3 flex gap-2">
                            <button type="button" onClick={() => setSheet(null)} className="h-11 flex-1 rounded-xl border-2 border-slate-300 text-sm font-black text-slate-700">Back</button>
                            <button type="button" onClick={() => void exit(sheet)} disabled={!!busy || (sheet === 'ask' && !sheetText.trim())}
                                className="h-11 flex-1 rounded-xl bg-slate-900 text-sm font-black text-white disabled:bg-slate-300" data-testid={sheet === 'ask' ? 'ask-submit' : 'visit-submit'}>
                                {busy ? <Loader2 className="mx-auto h-4 w-4 animate-spin" /> : sheet === 'ask' ? 'Queue the question' : 'Draft the visit offer'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Thumb bar: four exits, Send primary; the builder secondary */}
            <div className="fixed inset-x-0 bottom-0 z-20 border-t border-slate-200 bg-white/95 p-3 backdrop-blur">
                <div className={cn('mx-auto flex flex-col gap-2', desktop ? 'max-w-3xl' : 'max-w-md')}>
                    <button type="button" onClick={send} disabled={!canSend}
                        className="inline-flex h-14 w-full items-center justify-center gap-2 rounded-2xl bg-emerald-600 text-lg font-black text-white shadow-lg disabled:bg-slate-300 disabled:text-slate-500 disabled:shadow-none"
                        data-testid="send-quote">
                        {busy === 'send' ? <Loader2 className="h-5 w-5 animate-spin" /> : <Send className="h-5 w-5" />}
                        {busy === 'send' ? 'Sending…' : `Send now${totals.totalPence > 0 ? ` · ${gbp(totals.totalPence)}` : ''}`}
                    </button>
                    <div className="grid grid-cols-3 gap-2">
                        <button type="button" disabled={locked || !!busy} onClick={() => { setSheetText(''); setSheet('ask'); }} className="inline-flex h-11 items-center justify-center gap-1 rounded-2xl border-2 border-slate-300 text-xs font-black text-slate-700 disabled:opacity-40" data-testid="ask-first">
                            <HelpCircle className="h-4 w-4" /> Ask her first
                        </button>
                        <button type="button" disabled={locked || !!busy || !data.call?.customerPhone} onClick={() => void exit('call')} className="inline-flex h-11 items-center justify-center gap-1 rounded-2xl border-2 border-slate-300 text-xs font-black text-slate-700 disabled:opacity-40" data-testid="call-her">
                            {busy === 'call' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Phone className="h-4 w-4" />} Call her
                        </button>
                        <button type="button" disabled={locked || !!busy} onClick={() => { setSheetText(''); setSheet('visit'); }} className="inline-flex h-11 items-center justify-center gap-1 rounded-2xl border-2 border-slate-300 text-xs font-black text-slate-700 disabled:opacity-40" data-testid="needs-visit">
                            <Home className="h-4 w-4" /> Needs a visit
                        </button>
                    </div>
                    <a href={data.builderUrl} className="inline-flex items-center justify-center gap-1 text-xs font-bold text-slate-500 underline" data-testid="open-builder">
                        <PenLine className="h-3 w-3" /> Open full builder
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
