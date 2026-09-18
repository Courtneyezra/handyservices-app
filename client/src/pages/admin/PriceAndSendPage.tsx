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
 *   - four exits, none of which leave the screen: Send in the thumb bar; Ask first · Call · Needs a
 *     visit and the full builder behind its "⋯"
 *   - after Send: what happened and what happens next, then the next quote waiting
 *   - T9: a one-line strip in the sticky header says how many more are waiting and who is next, from
 *     the shared price-queue query (/admin/price is the whole list); a send or a hold refreshes it
 *   - phone: Thread · Price tabs; desktop (1024px and up): the thread on the left, price on the right
 * B9 restyled it to Ben's own design (direction A, the collapsed stack; the design notes'
 * fault-to-fix table F1–F6): one line open at a time, the top doubt line on load (F1); the dark
 * header is the only header on the route, name, stage and postcode (F6), with the total, the line
 * count and how many want checking under it (F3); materials as a table (F4); the message box grows
 * from two rows to six (F5); the thumb bar is Send and ⋯ (F2). Rendered outside the admin
 * shell (App.tsx).
 * Data: GET /api/spine/price/:slug. Send: POST …/send; the other exits POST …/ask, …/call, …/visit.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type MutableRefObject, type TextareaHTMLAttributes } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRoute } from 'wouter';
import { Loader2, AlertTriangle, ChevronDown, ChevronUp, ChevronLeft, PenLine, RotateCcw, CheckCircle2, RefreshCw, Phone, HelpCircle, Home, X, Check, ArrowRight, MoreHorizontal, Quote as QuoteIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { depositFor } from '@shared/pricing-settings';
import { CATEGORY_OPTIONS } from '@/lib/quote-categories';
import { usePriceQueue, invalidatePriceQueue, queueExcluding, ageLabel } from '@/hooks/usePriceQueue';
import { HANDY_DESK_PATH } from '@/lib/handy-desk-path';

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
    /** T20: what she sent and whether we asked for a photo and she replied without one (server/spine/media-ask.ts). Absent on older payloads. */
    customerMedia?: { sentPhotos: boolean; sentVideo: boolean; askedAt: string | null; repliedWithoutMedia: boolean };
    /** Checklist 4.4: what the draft is missing, for Ben to request before he prices. */
    benToRequest?: string[];
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

/**
 * T20: what the "No photo" pill puts in the "Ask her first" sheet. The rules layer's own photo ask
 * (server/rules-layer.ts ASK_COPY.ask_media), the two bubbles as one question; Ben edits or queues it.
 */
export const PHOTO_ASK_PREFILL = 'Could you send a quick photo or video of the job? A clip of where the problem is helps us get it right first time.';

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

/** B9: the queue's channel as the header's short tag ("WA · 12 min"). */
const CHANNEL_SHORT: Record<string, string> = { whatsapp: 'WA', sms: 'SMS', email: 'Email', web: 'Web', web_form: 'Web', call: 'Call', phone: 'Call' };

/** B9: thread on the left and the price column on the right from 1024px; below that, the phone's tabs. */
const DESKTOP_QUERY = '(min-width: 1024px)';

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
    // B9: green is sure; amber is doubt, deeper the less sure. Never red: a doubtful line is a check, not an error.
    const cls = c === 'high' ? 'bg-green-600' : c === 'medium' ? 'bg-amber-400' : c === 'low' ? 'bg-amber-600' : 'bg-slate-300';
    const label = c ? `${c} confidence` : 'no confidence';
    return <span className={cn('inline-block h-2 w-2 shrink-0 rounded-full', cls)} title={label} aria-label={label} data-testid={`confidence-${c ?? 'none'}`} />;
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

/**
 * B9 (direction A, the collapsed stack): does this line still want Ben's eyes? The same signals
 * that order the stack (check_this, an open contradiction) plus a line with no price yet; accepting
 * it answers the question. The header's "to check" pill counts these.
 */
export function lineNeedsCheck(line: PriceLine, state: LineState | undefined, contradictions: Contradiction[], resolutions: Record<string, Resolution>, finalPence: number | null): boolean {
    if (state?.deleted || state?.accepted) return false;
    if (finalPence == null) return true;
    return line.checkThis || contradictions.some((c) => c.lineId === line.lineId && !resolutions[c.id]);
}

const EYEBROW = 'text-[10px] font-bold uppercase tracking-[0.06em] text-slate-500';

/**
 * Grows with its text from `minRows` to `maxRows`, then scrolls inside (B9 F5). jsdom has no
 * layout, so there it simply keeps `minRows`.
 */
export function AutoGrowTextarea({ minRows, maxRows, value, className, textareaRef, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement> & {
    minRows: number; maxRows: number; value: string; textareaRef?: MutableRefObject<HTMLTextAreaElement | null>;
}) {
    const own = useRef<HTMLTextAreaElement | null>(null);
    useLayoutEffect(() => {
        const el = own.current;
        if (!el || typeof window === 'undefined') return;
        const cs = window.getComputedStyle(el);
        const line = parseFloat(cs.lineHeight) || 20;
        const chrome = (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0) + (parseFloat(cs.borderTopWidth) || 0) + (parseFloat(cs.borderBottomWidth) || 0);
        el.style.height = 'auto';
        if (!el.scrollHeight) { el.style.height = ''; return; }
        const max = line * maxRows + chrome;
        el.style.height = `${Math.min(el.scrollHeight + (parseFloat(cs.borderTopWidth) || 0) + (parseFloat(cs.borderBottomWidth) || 0), max)}px`;
        el.style.overflowY = el.scrollHeight + chrome > max ? 'auto' : 'hidden';
    }, [value, maxRows]);
    return (
        <textarea {...rest} value={value} rows={minRows}
            ref={(el) => { own.current = el; if (textareaRef) textareaRef.current = el; }}
            className={cn('resize-none', className)} />
    );
}

export function PriceLineCard({ line, state, contradictions, resolutions, margin, disabled, open, onToggle, onChange, onResolve }: {
    line: PriceLine; state: LineState; contradictions: Contradiction[]; resolutions: Record<string, Resolution>; margin: number; disabled: boolean;
    /** B9 F1: one line open at a time; every other line is a one-row summary. */
    open: boolean;
    onToggle: () => void;
    onChange: (patch: LinePatch) => void;
    onResolve: (c: Contradiction, choice: Resolution) => void;
}) {
    const [showBasis, setShowBasis] = useState(false);
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
    const flagged = line.checkThis || mine.some((c) => !resolutions[c.id]);
    const check = lineNeedsCheck(line, state, contradictions, resolutions, pence);
    const title = line.title || 'Untitled line';
    const meta = [line.category && !added ? line.category.replace(/_/g, ' ') : null, mins].filter(Boolean).join(' · ');

    // P16: struck out and out of the totals, but still here until Send, with one tap back.
    if (state.deleted) {
        return (
            <div className="rounded-[20px] border border-dashed border-slate-300 bg-slate-100 px-3.5 py-3" data-testid={`price-line-${line.lineId}`}>
                <div className="flex min-h-7 items-center justify-between gap-3">
                    <div className="min-w-0 flex-1 text-[13px] font-bold text-slate-400 line-through" data-testid={`line-deleted-${line.lineId}`}>{title}</div>
                    <span className="shrink-0 text-[10px] font-bold uppercase tracking-[0.06em] text-slate-400">Removed</span>
                    {!disabled && (
                        <button type="button" onClick={() => onChange({ deleted: false })}
                            className="inline-flex min-h-9 shrink-0 items-center gap-1 rounded-full border border-slate-300 bg-white px-3 text-xs font-bold text-slate-700"
                            data-testid={`line-undo-${line.lineId}`}>
                            <RotateCcw className="h-3.5 w-3.5" /> Undo
                        </button>
                    )}
                </div>
            </div>
        );
    }

    // F1: a closed line is one row carrying its confidence dot and its price.
    if (!open) {
        return (
            <div className={cn('rounded-[20px] border bg-white shadow-sm shadow-slate-900/5', flagged && !state.accepted ? 'border-amber-400' : state.accepted ? 'border-emerald-300' : 'border-slate-200')}
                data-testid={`price-line-${line.lineId}`} data-open="false">
                <button type="button" onClick={onToggle} aria-expanded={false}
                    className="flex min-h-[52px] w-full items-center justify-between gap-3 px-3.5 py-2.5 text-left"
                    data-testid={`line-row-${line.lineId}`}>
                    <span className="flex min-w-0 items-center gap-2.5">
                        <ConfidenceDot c={line.confidence} />
                        <span className="min-w-0">
                            <span className="block break-words text-[13px] font-bold leading-snug text-slate-900">{line.qty > 1 ? `${line.qty}× ` : ''}{title}</span>
                            <span className={cn('block text-[10px] font-semibold', check ? 'text-amber-700' : state.accepted ? 'text-emerald-700' : 'text-slate-500')}>
                                {check ? (pence == null ? 'needs a price' : 'check') : state.accepted ? 'accepted' : (meta || 'no time set')}
                            </span>
                        </span>
                    </span>
                    <span className="flex shrink-0 items-center gap-1.5 text-[15px] font-extrabold text-slate-900" data-testid={`line-row-price-${line.lineId}`}>
                        {state.accepted && <Check className="h-4 w-4 text-emerald-600" aria-hidden />}
                        {pence == null ? '—' : pence === 0 ? <span className="text-[11px] font-semibold text-slate-500">incl.</span> : gbp(pence)}
                    </span>
                </button>
            </div>
        );
    }

    return (
        <div className={cn('rounded-3xl border-2 bg-white p-3.5 shadow-sm shadow-slate-900/5', flagged && !state.accepted ? 'border-amber-400' : state.accepted ? 'border-emerald-300' : 'border-slate-900')}
            data-testid={`price-line-${line.lineId}`} data-open="true">
            <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                    {/* P16: a line Ben added types its own title, category and time. Nothing estimated it. */}
                    {added ? (
                        <div className="space-y-1.5" data-testid={`added-fields-${line.lineId}`}>
                            <input type="text" value={line.title} disabled={disabled} placeholder="What is the job?" aria-label="Line title"
                                onChange={(e) => onChange({ addedTitle: e.target.value })}
                                className="min-h-11 w-full rounded-[14px] border border-slate-300 px-3 text-[15px] font-extrabold text-slate-900" data-testid={`added-title-${line.lineId}`} />
                            <div className="flex gap-1.5">
                                <select value={line.category ?? ''} disabled={disabled} aria-label="Category"
                                    onChange={(e) => onChange({ addedCategory: e.target.value || null })}
                                    className="min-h-11 min-w-0 flex-1 rounded-[14px] border border-slate-300 px-2 text-xs font-semibold text-slate-700" data-testid={`added-category-${line.lineId}`}>
                                    <option value="">Category</option>
                                    {CATEGORY_OPTIONS.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                                </select>
                                <input type="number" min={1} max={6000} step={15} value={line.minutes?.point ?? ''} disabled={disabled} placeholder="min" aria-label="Minutes"
                                    onChange={(e) => onChange({ addedMinutes: e.target.value === '' ? null : Math.max(1, Number(e.target.value) || 0) })}
                                    className="min-h-11 w-20 rounded-[14px] border border-slate-300 px-2 text-xs font-semibold text-slate-700" data-testid={`added-minutes-${line.lineId}`} />
                            </div>
                        </div>
                    ) : (
                        <button type="button" onClick={onToggle} aria-expanded className="block w-full text-left" data-testid={`line-collapse-${line.lineId}`}>
                            <span className="block text-[15px] font-extrabold leading-snug text-slate-900">{line.qty > 1 ? `${line.qty}× ` : ''}{line.title}</span>
                        </button>
                    )}
                    <div className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[11px] text-slate-500">
                        <ConfidenceDot c={line.confidence} />
                        {line.category && !added && <><span data-testid="category-chip">{line.category.replace(/_/g, ' ')}</span><span aria-hidden>·</span></>}
                        {mins && <><span>{mins}</span><span aria-hidden>·</span></>}
                        <span>{state.materials.length ? `${state.materials.length} material${state.materials.length === 1 ? '' : 's'}` : 'no materials'}</span>
                    </div>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                    {flagged && !state.accepted && <span className="rounded-full bg-amber-100 px-2 py-1 text-[10px] font-bold uppercase tracking-[0.06em] text-amber-700">Check</span>}
                    {/* P16: remove a whole line. Struck out with an Undo, never gone until Send. */}
                    {!disabled && (
                        <button type="button" onClick={() => onChange({ deleted: true, accepted: false })} aria-label={`Remove ${line.title || 'this line'}`}
                            className="flex h-9 w-9 items-center justify-center rounded-full text-slate-400 hover:bg-slate-100 hover:text-slate-700" data-testid={`line-delete-${line.lineId}`}>
                            <X className="h-4 w-4" />
                        </button>
                    )}
                    {added && (
                        <button type="button" onClick={onToggle} aria-label="Close this line" aria-expanded
                            className="flex h-9 w-9 items-center justify-center rounded-full text-slate-400 hover:bg-slate-100 hover:text-slate-700" data-testid={`line-collapse-${line.lineId}`}>
                            <ChevronUp className="h-4 w-4" />
                        </button>
                    )}
                </div>
            </div>

            {line.checkThis && (
                <div className="mt-2.5 flex items-start gap-2" data-testid="check-this">
                    <span className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-[7px] bg-slate-900 text-[8px] font-extrabold text-amber-400" aria-hidden>AI</span>
                    <span className="text-xs leading-relaxed text-slate-700"><span className="sr-only">Check this: </span>{line.checkReason ?? 'Check this line.'}</span>
                </div>
            )}

            {/* Her words first */}
            {evidence && (evidence.quotes.length > 0 || evidence.media.length > 0) && (
                <div className="mt-2.5 space-y-2" data-testid={`evidence-${line.lineId}`}>
                    {evidence.quotes.map((q) => (
                        <div key={q.messageId} className="flex items-start gap-2 rounded-[14px] bg-slate-50 px-3 py-2 text-[13px] italic leading-snug text-slate-800">
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
                    <div key={c.id} className={cn('mt-2.5 rounded-[14px] px-3 py-2 text-xs font-semibold', r ? 'bg-emerald-50 text-emerald-900' : 'bg-amber-50 text-amber-900')} data-testid={`contradiction-${c.id}`}>
                        <div className="flex items-start gap-2">
                            {r ? <Check className="mt-0.5 h-3.5 w-3.5 shrink-0" /> : <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />}
                            <span>{r ? (r === 'drop_materials' ? `Dropped ${c.materialNames.join(' and ')}.` : `Kept ${c.materialNames.join(' and ')}, assumption dropped.`) : <><span className="uppercase tracking-wide">Check this</span> · {c.sentence}</>}</span>
                        </div>
                        {!r && !disabled && (
                            <div className="mt-2 flex flex-wrap gap-2">
                                {c.options.map((o) => (
                                    <button key={o.id} type="button" onClick={() => onResolve(c, o.id)} className="min-h-9 rounded-full border border-amber-300 bg-white px-3 text-xs font-bold text-amber-900" data-testid={`resolve-${c.id}-${o.id}`}>{o.label}</button>
                                ))}
                            </div>
                        )}
                    </div>
                );
            })}

            {compact && (
                <button type="button" onClick={() => onChange({ accepted: false })}
                    className="mt-3 inline-flex min-h-11 items-center gap-2 rounded-full px-1 text-[13px] font-bold text-emerald-700"
                    data-testid={`accepted-${line.lineId}`}>
                    <span className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-600 text-white"><Check className="h-3 w-3" /></span>
                    Accepted {gbp(pence)}
                    <span className="text-[11px] font-semibold text-slate-500 underline decoration-dotted">change</span>
                </button>
            )}

            {!compact && (
                <>
                    {/* P18: labour and materials are the two inputs. The price below is their sum. */}
                    <div className="mt-3 grid grid-cols-2 gap-2">
                        <label className="block">
                            <span className={EYEBROW}>Labour</span>
                            <div className={cn('mt-1 flex min-h-11 items-center rounded-[14px] border bg-white px-3', labourPence == null && state.labour !== '' ? 'border-2 border-red-400' : 'border-slate-300')}>
                                <span className="text-base font-extrabold text-slate-400">£</span>
                                <input
                                    type="number" inputMode="decimal" min={0} step={1}
                                    className="w-full min-w-0 bg-transparent py-2 pl-1 text-base font-extrabold text-slate-900 outline-none"
                                    value={state.labour} disabled={disabled}
                                    onChange={(e) => onChange({ labour: e.target.value, accepted: false })}
                                    aria-label={`Labour for ${line.title}`}
                                    data-testid={`labour-input-${line.lineId}`}
                                />
                            </div>
                        </label>
                        <label className="block">
                            <span className={EYEBROW}>Materials</span>
                            <div className={cn('mt-1 flex min-h-11 items-center rounded-[14px] border bg-white px-3', materialsByHand ? 'border-2 border-slate-900' : 'border-slate-300')}>
                                <span className="text-base font-extrabold text-slate-400">£</span>
                                <input
                                    type="number" inputMode="decimal" min={0} step={1}
                                    className="w-full min-w-0 bg-transparent py-2 pl-1 text-base font-extrabold text-slate-900 outline-none"
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
                        <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] font-semibold text-slate-600" data-testid={`materials-by-hand-${line.lineId}`}>
                            <span>Materials set by hand. The items below are advisory.</span>
                            {!disabled && (
                                <button type="button" onClick={() => onChange({ materialsByHand: null, accepted: false })}
                                    className="inline-flex items-center gap-1 rounded-full border border-slate-300 px-2 py-0.5 text-slate-700"
                                    data-testid={`materials-revert-${line.lineId}`}>
                                    <RotateCcw className="h-3 w-3" /> use the list
                                </button>
                            )}
                        </div>
                    )}

                    <div className={cn('mt-2 flex items-center justify-between gap-2 rounded-[14px] px-3 py-2', outOfBand ? 'bg-amber-50' : 'bg-slate-50')}>
                        <div>
                            <div className={EYEBROW}>Line price</div>
                            <div className="text-xl font-extrabold text-slate-900" data-testid={`line-total-${line.lineId}`}>{pence == null ? '—' : gbp(pence)}</div>
                        </div>
                        <div className="flex flex-col items-end gap-0.5 text-right text-[11px] font-semibold text-slate-500">
                            {band ? <span data-testid="band">Band {band}</span> : <span data-testid="band">No band</span>}
                            {outOfBand && <span className="text-amber-700" data-testid="out-of-band">outside the band</span>}
                            {edited && <span className="inline-flex items-center gap-1 text-slate-900"><PenLine className="h-3 w-3" /> edited</span>}
                            {line.suggestedPence == null && <span className="text-amber-700">No suggestion, price by hand</span>}
                        </div>
                    </div>

                    <div className="mt-2 flex flex-wrap items-center gap-2">
                        {!disabled && pence != null && (
                            <button type="button" onClick={() => onChange({ accepted: true })}
                                className="inline-flex min-h-11 items-center rounded-full bg-slate-900 px-4 text-[13px] font-bold text-white"
                                data-testid={`accept-${line.lineId}`}>
                                Accept {gbp(pence)}
                            </button>
                        )}
                        {edited && !disabled && suggested.labourPence != null && (
                            <button type="button" onClick={() => onChange({ labour: penceToPoundsText(suggested.labourPence), materialsByHand: null, materials: (line.materials ?? []).map((m) => ({ ...m })) })}
                                className="inline-flex min-h-11 items-center gap-1 rounded-full border border-slate-300 px-3.5 text-xs font-bold text-slate-700"
                                data-testid={`reset-${line.lineId}`}>
                                <RotateCcw className="h-3.5 w-3.5" /> {gbp(line.suggestedPence)}
                            </button>
                        )}
                    </div>

                    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] font-semibold text-slate-500">
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
                            <button type="button" onClick={() => setShowBasis((s) => !s)} className="inline-flex min-h-7 items-center gap-0.5 text-slate-700 underline decoration-dotted" data-testid={`basis-toggle-${line.lineId}`}>
                                basis {showBasis ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                            </button>
                        )}
                    </div>
                    {showBasis && line.basis && (
                        <div className="mt-2 rounded-[14px] bg-slate-50 px-3 py-2 text-[11px] text-slate-600" data-testid={`basis-${line.lineId}`}>
                            {line.basis.minutes != null && <div>{line.basis.minutes} min on the wire{line.minutes ? ` (${line.minutes.low}–${line.minutes.high} on site, plus the job's setup and cleanup share)` : ''}</div>}
                            {line.basis.ratePencePerHour != null && <div>Reference rate {gbp(line.basis.ratePencePerHour)}/hr</div>}
                            {line.basis.marginPct != null && <div>Materials at {line.basis.marginPct}% margin</div>}
                            {line.basis.rules.length > 0 && <div>Rules: {line.basis.rules.join('; ')}</div>}
                            {line.timeSource && <div>Time from {line.timeSource}</div>}
                        </div>
                    )}

                    {/* F4: materials as a table. One header row, the name wraps instead of clipping,
                        quantity and cost right-aligned, every field in view at once. */}
                    {state.materials.length > 0 && (
                        <div className="mt-3 overflow-hidden rounded-[14px] border border-slate-200" data-testid={`materials-${line.lineId}`}>
                            <div className="grid grid-cols-[minmax(0,1fr)_2.75rem_4.75rem_2rem] items-center gap-1.5 bg-slate-50 px-2.5 py-1.5 text-[9px] font-bold uppercase tracking-[0.06em] text-slate-500" data-testid={`materials-head-${line.lineId}`}>
                                <span>Name</span><span className="text-right">Qty</span><span className="text-right">Cost each</span><span className="sr-only">Remove</span>
                            </div>
                            <ul>
                                {state.materials.map((m) => (
                                    <li key={m.index} className="grid grid-cols-[minmax(0,1fr)_2.75rem_4.75rem_2rem] items-start gap-1.5 border-t border-slate-100 px-2.5 py-1.5 text-xs" data-testid={`material-${line.lineId}-${m.index}`}>
                                        <AutoGrowTextarea minRows={1} maxRows={4} value={m.name} disabled={disabled} aria-label="Material name"
                                            onChange={(e) => onChange({ materials: state.materials.map((x) => x.index === m.index ? { ...x, name: e.target.value.replace(/\n/g, ' ') } : x) })}
                                            className="block w-full min-w-0 rounded-md border border-transparent bg-transparent px-1 py-1 text-xs leading-snug text-slate-900 hover:border-slate-200 focus:border-slate-400 focus:outline-none"
                                            data-testid={`material-name-${line.lineId}-${m.index}`} />
                                        <input type="number" min={1} value={m.qty} disabled={disabled} aria-label="Quantity"
                                            onChange={(e) => onChange({ materials: state.materials.map((x) => x.index === m.index ? { ...x, qty: Math.max(1, Number(e.target.value) || 1) } : x) })}
                                            className="w-full rounded-md border border-slate-200 px-1 py-1 text-right text-xs" data-testid={`material-qty-${line.lineId}-${m.index}`} />
                                        <div className="flex items-center rounded-md border border-slate-200 px-1">
                                            <span className="text-[11px] text-slate-400">£</span>
                                            <input type="number" min={0} step="0.01" value={m.unitCostPence != null ? penceToPoundsText(m.unitCostPence) : ''} disabled={disabled} aria-label="Unit cost"
                                                onChange={(e) => onChange({ materials: state.materials.map((x) => x.index === m.index ? { ...x, unitCostPence: e.target.value === '' ? 0 : Math.round(Number(e.target.value) * 100) } : x) })}
                                                className="w-full min-w-0 bg-transparent py-1 text-right text-xs font-semibold outline-none" data-testid={`material-cost-${line.lineId}-${m.index}`} />
                                        </div>
                                        {!disabled ? (
                                            <button type="button" aria-label={`Remove ${m.name}`} onClick={() => onChange({ materials: state.materials.filter((x) => x.index !== m.index) })} className="flex h-7 w-7 items-center justify-center rounded-full text-slate-400 hover:text-slate-700" data-testid={`material-remove-${line.lineId}-${m.index}`}>
                                                <X className="h-3.5 w-3.5" />
                                            </button>
                                        ) : <span />}
                                    </li>
                                ))}
                            </ul>
                            {!disabled && (
                                <div className="border-t border-slate-100 px-2.5 py-1.5">
                                    {/* P18: the missing control. Cost in, margin applied for her. */}
                                    <button type="button" onClick={() => onChange({ materials: [...state.materials, { lineId: line.lineId, index: nextMaterialIndex(state.materials), name: '', qty: 1, unitCostPence: 0, source: 'ben' }] })}
                                        className="min-h-7 text-xs font-bold text-slate-700 underline decoration-dotted" data-testid={`material-add-${line.lineId}`}>
                                        + add a material
                                    </button>
                                </div>
                            )}
                            <div className="border-t border-slate-100 bg-slate-50 px-2.5 py-1.5 text-[11px] font-semibold text-slate-500" data-testid={`materials-cost-${line.lineId}`}>
                                Cost {gbp(materialsCostPence)} · she pays {gbp(materialsPence)} at {margin}%
                                {materialsByHand && <span className="text-slate-400"> · the box is set by hand, so this is advisory</span>}
                            </div>
                        </div>
                    )}

                    {/* Assumptions: customer-facing text Ben edits or drops */}
                    {state.assumptions.length > 0 && (
                        <div className="mt-3" data-testid={`assumptions-${line.lineId}`}>
                            <div className={EYEBROW}>On the quote as assumptions</div>
                            <ul className="mt-1 space-y-1">
                                {state.assumptions.map((a, i) => (
                                    <li key={i} className="flex items-center gap-1.5">
                                        <input type="text" value={a} disabled={disabled} aria-label={`Assumption ${i + 1}`}
                                            onChange={(e) => onChange({ assumptions: state.assumptions.map((x, j) => j === i ? e.target.value : x) })}
                                            className="min-h-9 min-w-0 flex-1 rounded-[10px] border border-slate-200 px-2 text-xs text-slate-700" data-testid={`assumption-${line.lineId}-${i}`} />
                                        {!disabled && (
                                            <button type="button" aria-label="Drop this assumption" onClick={() => onChange({ assumptions: state.assumptions.filter((_, j) => j !== i) })} className="flex h-8 w-8 items-center justify-center rounded-full text-slate-400 hover:text-slate-700" data-testid={`assumption-drop-${line.lineId}-${i}`}>
                                                <X className="h-3.5 w-3.5" />
                                            </button>
                                        )}
                                    </li>
                                ))}
                            </ul>
                        </div>
                    )}

                    {/* P15 part 1: "Not included", customer-facing plain words Ben edits, adds or drops. Renders on the quote page and in the contractor's pack. */}
                    <div className="mt-3" data-testid={`not-included-${line.lineId}`}>
                        <div className={EYEBROW}>On the quote as not included</div>
                        {state.notIncluded.length > 0 && (
                            <ul className="mt-1 space-y-1">
                                {state.notIncluded.map((a, i) => (
                                    <li key={i} className="flex items-center gap-1.5">
                                        <input type="text" value={a} disabled={disabled} aria-label={`Not included ${i + 1}`} placeholder="e.g. small top door not included"
                                            onChange={(e) => onChange({ notIncluded: state.notIncluded.map((x, j) => j === i ? e.target.value : x) })}
                                            className="min-h-9 min-w-0 flex-1 rounded-[10px] border border-slate-200 px-2 text-xs text-slate-700" data-testid={`not-included-${line.lineId}-${i}`} />
                                        {!disabled && (
                                            <button type="button" aria-label="Drop this not-included item" onClick={() => onChange({ notIncluded: state.notIncluded.filter((_, j) => j !== i) })} className="flex h-8 w-8 items-center justify-center rounded-full text-slate-400 hover:text-slate-700" data-testid={`not-included-drop-${line.lineId}-${i}`}>
                                                <X className="h-3.5 w-3.5" />
                                            </button>
                                        )}
                                    </li>
                                ))}
                            </ul>
                        )}
                        {!disabled && state.notIncluded.length < 8 && (
                            <button type="button" onClick={() => onChange({ notIncluded: [...state.notIncluded, ''] })} className="mt-1 min-h-7 text-xs font-semibold text-slate-700 underline decoration-dotted" data-testid={`not-included-add-${line.lineId}`}>
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

export function PriceAndSend({ slug, embedded = false, onClose, onOpenQuote, onSent }: {
    slug: string;
    /** B9: inside the Handy Desk's answer column on a wide screen: no page header, the bar inline. */
    embedded?: boolean;
    /** Embedded: the X. With unsent changes it asks before it is called. */
    onClose?: () => void;
    /** Embedded: the quote has gone out. */
    onSent?: () => void;
    /** Embedded: open another quote in place rather than leaving the desk. */
    onOpenQuote?: (slug: string) => void;
}) {
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
    // T9: the queue behind the strip and the confirm screen; the sidebar badge reads the same cache.
    const { data: queue } = usePriceQueue();

    const [states, setStates] = useState<Record<string, LineState>>({});
    /** P16: lines Ben typed on this screen. They live here until Send writes them onto the quote. */
    const [addedLines, setAddedLines] = useState<PriceLine[]>([]);
    const messageRef = useRef<HTMLTextAreaElement | null>(null);
    const [resolutions, setResolutions] = useState<Record<string, Resolution>>({});
    const [message, setMessage] = useState('');
    const [tab, setTab] = useState<'thread' | 'price'>('price');
    const [threadExpanded, setThreadExpanded] = useState(false);
    const [sheet, setSheet] = useState<null | 'ask' | 'visit'>(null);
    /** F2: the ⋯ sheet holding the exits that are not Send. */
    const [overflow, setOverflow] = useState(false);
    /** F1: the one line open. The prefill opens the top doubt line; a tap on another row moves it. */
    const [openId, setOpenId] = useState<string | null>(null);
    const [sheetText, setSheetText] = useState('');
    const [busy, setBusy] = useState<null | 'send' | 'ask' | 'call' | 'visit'>(null);
    const [result, setResult] = useState<SendResult | null>(null);
    const [superseded, setSuperseded] = useState<string | null>(null);
    const [hold, setHold] = useState<QuoteHold | null>(null);
    const [actionError, setActionError] = useState<string | null>(null);
    const [confirmClose, setConfirmClose] = useState(false);

    // Prefill whenever a fresh payload arrives (a reload after 409 re-prefills).
    useEffect(() => {
        if (!data) return;
        setStates(Object.fromEntries(data.lines.map((l) => [l.lineId, initialLineState(l)])));
        setAddedLines([]);
        setResolutions({});
        setMessage(data.message?.body ?? '');
        setHold(data.hold ?? null);
        setSuperseded(null);
        setOpenId(orderByDoubt(data.lines, data.contradictions ?? [])[0]?.lineId ?? null);
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
    // F3: how many kept lines still want a look, for the header's summary.
    const toCheck = useMemo(() => kept.filter((l) => lineNeedsCheck(l, states[l.lineId], contradictions, resolutions, finals[l.lineId])).length, [kept, states, contradictions, resolutions, finals]);
    const messageEdited = !!data && message.trim() !== (data.message?.body ?? '').trim();
    const warnings = useMemo(() => messageWarnings(message), [message]);
    // P16: the link lives in the message Ben reads. If he deletes it, say so and offer it back.
    const linkPresent = !data || hasQuoteLink(message, data.quoteUrl);
    // Anything different from what the screen loaded, until it has been sent.
    const unsent = !!data && !result?.ok && (addedLines.length > 0 || Object.keys(resolutions).length > 0
        || message !== (data.message?.body ?? '')
        || data.lines.some((l) => JSON.stringify(states[l.lineId]) !== JSON.stringify(initialLineState(l))));
    useEffect(() => { if (result?.ok) onSent?.(); }, [result?.ok]); // eslint-disable-line react-hooks/exhaustive-deps

    function requestClose() {
        if (unsent) setConfirmClose(true);
        else onClose?.();
    }

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
        setOpenId(line.lineId);
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
            if (status >= 200 && status < 300) {
                void qc.invalidateQueries({ queryKey: ['spine-price', data.slug] });
                void invalidatePriceQueue(qc); // T9: this one has left the queue
            }
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
            void invalidatePriceQueue(qc); // T9: a held quote is out of the queue until she answers
            setSheet(null); setSheetText(''); setOverflow(false);
            if (kind === 'call') {
                const tel = json.tel ?? data.call?.customerPhone;
                if (tel && typeof window !== 'undefined') window.location.href = `tel:${tel}`;
            }
        } catch (e: any) {
            setActionError(e?.message ?? `${kind} failed`);
        } finally { setBusy(null); }
    }

    // Outside the admin shell the page's header is the only way back, and these screens have none.
    const backToDesk = !embedded && (
        <a href={HANDY_DESK_PATH} className="mx-4 mt-3 inline-flex min-h-11 items-center gap-1 text-sm font-bold text-slate-600 underline" data-testid="back">
            <ChevronLeft className="h-4 w-4" /> Back to the desk
        </a>
    );

    if (isLoading) {
        return <div>{backToDesk}<div className="flex h-64 items-center justify-center text-slate-500"><Loader2 className="mr-2 h-5 w-5 animate-spin" /> Loading the quote…</div></div>;
    }
    if ((error as Error)?.message === 'AUTH') {
        return <div>{backToDesk}<div className="m-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
            Your admin session has expired. <a href={`/admin/login?next=${encodeURIComponent(`/admin/price/${slug}`)}`} className="font-bold underline">Log in again</a> to price this quote.
        </div></div>;
    }
    if ((error as Error)?.message === 'NOT_FOUND') {
        return <div>{backToDesk}<div className="m-4 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700" data-testid="not-found">No quote with the slug <span className="font-mono">{slug}</span>.</div></div>;
    }
    if (error || !data) {
        return <div>{backToDesk}<div className="m-4 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">Couldn't load the quote. {(error as Error)?.message}</div></div>;
    }

    const first = data.customer.firstName;
    const readiness = data.customer.readiness;
    // T20: "no photo" is the payload's own photos / videos (plus the server's read of the thread), not a new field of missing.
    const noPhoto = data.status === 'draft' && data.photos.length === 0 && data.videos.length === 0
        && !(data.customerMedia?.sentPhotos || data.customerMedia?.sentVideo);
    const statusBanner = data.status === 'sent'
        ? { cls: 'border-emerald-200 bg-emerald-50 text-emerald-900', text: 'This quote has already been sent.' }
        : data.status === 'superseded'
            ? { cls: 'border-amber-200 bg-amber-50 text-amber-900', text: 'A new scope arrived and this draft was superseded. Open the thread for the new one.' }
            : data.status === 'revoked'
                ? { cls: 'border-red-200 bg-red-50 text-red-900', text: 'This quote was revoked.' }
                : null;

    // After Send: confirm and say what happens next, then the next quote waiting.
    if (result?.ok) {
        // T9: the refetched queue (less this quote) is the truth; the send's own nextWaiting is the
        // fallback while it loads.
        const fresh = queueExcluding(queue, data.slug);
        const next = fresh.next ? { slug: fresh.next.slug, firstName: fresh.next.firstName, waitingMs: fresh.next.waitingMs } : (result.nextWaiting ?? data.nextWaiting ?? null);
        const left = queue ? fresh.count : null;
        return (
            <div className="mx-auto max-w-md px-4 py-10" data-testid="confirm-screen">
                {backToDesk && <div className="-mx-4 -mt-6 mb-4">{backToDesk}</div>}
                {embedded && onClose && (
                    <div className="mb-2 flex justify-end">
                        <button type="button" onClick={onClose} aria-label="Close the quote" className="flex h-10 w-10 items-center justify-center rounded-full text-slate-400 hover:bg-slate-100 hover:text-slate-700" data-testid="price-close">
                            <X className="h-5 w-5" />
                        </button>
                    </div>
                )}
                <div className="rounded-3xl border border-emerald-300 bg-emerald-50 p-6 text-emerald-950">
                    <div className="flex items-center gap-2 text-xl font-black"><CheckCircle2 className="h-6 w-6" /> {result.sent ? (result.mode === 'template' ? 'Sent by WhatsApp template' : 'Sent on WhatsApp') : result.queued ? 'Queued for the window' : 'Done'}</div>
                    <p className="mt-3 text-base font-bold" data-testid="next-steps">{result.nextSteps ?? `Sent to ${first}.${result.totals ? ` Deposit ${gbp(result.totals.depositPence)}.` : ''}`}</p>
                    {result.message && <p className="mt-1 text-sm">{result.message}</p>}
                    {result.totals && <p className="mt-2 text-sm">{gbp(result.totals.totalPence)} total · labour {gbp(result.totals.labourPence)} · materials {gbp(result.totals.materialsPence)}</p>}
                    {result.quoteUrl && <a className="mt-2 block truncate font-mono text-xs underline" href={result.quoteUrl}>{result.quoteUrl}</a>}
                </div>
                {next ? (
                    <a href={`/admin/price/${next.slug}`} onClick={(e) => { if (onOpenQuote) { e.preventDefault(); onOpenQuote(next.slug); } }} className="mt-4 inline-flex h-14 w-full items-center justify-center gap-2 rounded-2xl bg-slate-900 text-lg font-black text-white" data-testid="next-waiting">
                        Next quote waiting: {next.firstName}{'waitingMs' in next && next.waitingMs != null ? ` · ${ageLabel(next.waitingMs)}` : ''} <ArrowRight className="h-5 w-5" />
                    </a>
                ) : (
                    <div className="mt-4 rounded-2xl border border-slate-300 bg-white p-4 text-center text-sm font-bold text-slate-600 shadow-md shadow-slate-900/5" data-testid="nothing-waiting">Nothing else waiting to be priced.</div>
                )}
                {left != null && left > 0 && <a href="/admin/price" className="mt-2 block text-center text-xs font-bold text-slate-500 underline" data-testid="queue-left">{left} left in the queue</a>}
                {data.conversationId && <a href={`/admin/comms?conversation=${encodeURIComponent(data.conversationId)}`} className="mt-3 block text-center text-sm font-bold text-slate-600 underline">Open {first}'s thread</a>}
            </div>
        );
    }

    // T9: the strip. Count and next exclude this quote; the payload's nextWaiting stands in until the
    // queue has loaded. One line in the sticky header, never over the lines or in the thumb bar.
    const stripQueue = queueExcluding(queue, data.slug);
    const stripNext = stripQueue.next ? { slug: stripQueue.next.slug, firstName: stripQueue.next.firstName, waitingMs: stripQueue.next.waitingMs as number | null } : data.nextWaiting ? { ...data.nextWaiting, waitingMs: null } : null;
    const stripCount: number | null = queue ? stripQueue.count : (data.nextWaiting ? null : 0);
    const queueStrip = (
        <div className="flex min-h-8 items-center justify-between gap-2 border-t border-slate-800 pt-2 text-[11px] font-semibold text-slate-400" data-testid="queue-strip">
            <span className="truncate" data-testid="queue-strip-count">
                {stripCount === 0 && !stripNext ? 'Nothing else waiting' : stripCount == null ? 'More waiting' : `${stripCount} more waiting`}
            </span>
            <span className="flex shrink-0 items-center gap-3">
                {stripNext && (
                    <a href={`/admin/price/${encodeURIComponent(stripNext.slug)}`} className="inline-flex min-h-8 items-center gap-1 text-white underline decoration-slate-600 underline-offset-2" data-testid="queue-strip-next">
                        Next: {stripNext.firstName}{stripNext.waitingMs != null ? `, ${ageLabel(stripNext.waitingMs)}` : ''} <ArrowRight className="h-3 w-3" />
                    </a>
                )}
                <a href="/admin/price" className="inline-flex min-h-8 items-center text-slate-400 underline decoration-slate-600 underline-offset-2" data-testid="queue-strip-all">All</a>
            </span>
        </div>
    );

    // B9: the eyebrow names the stage and, only when the queue has loaded and holds this quote, where
    // it sits in that queue; the pills say what is about to go out.
    const queueIndex = queue ? queue.items.findIndex((i) => i.slug === data.slug) : -1;
    const queueItem = queueIndex >= 0 ? queue!.items[queueIndex] : null;
    const stage = data.status === 'sent' ? 'Sent' : data.status === 'superseded' ? 'Superseded' : data.status === 'revoked' ? 'Revoked'
        : readiness ? (READINESS_LABEL[readiness] ?? readiness) : 'Ready to price';
    const eyebrow = queueItem && data.status === 'draft' ? `${stage} · ${queueIndex + 1} of ${queue!.count}` : stage;
    const channel = queueItem?.sourceChannel ? (CHANNEL_SHORT[queueItem.sourceChannel] ?? queueItem.sourceChannel) : null;

    const pricePane = (
        <div className="space-y-2" data-testid="price-pane">
            {statusBanner && <div className={cn('rounded-[20px] border px-3.5 py-2.5 text-sm font-semibold', statusBanner.cls)} data-testid="status-banner">{statusBanner.text}</div>}
            {superseded && (
                <div className="rounded-[20px] border border-amber-300 bg-amber-50 p-3.5 text-sm text-amber-900" data-testid="superseded-banner">
                    <div className="font-extrabold">{refusalTitle(superseded)}</div>
                    <p className="mt-0.5">{superseded}</p>
                    <button type="button" onClick={() => { setResult(null); void refetch(); }} disabled={isFetching}
                        className="mt-2 inline-flex min-h-11 items-center gap-1.5 rounded-full bg-amber-900 px-4 text-xs font-bold text-white" data-testid="reload">
                        <RefreshCw className={cn('h-3.5 w-3.5', isFetching && 'animate-spin')} /> Reload the draft
                    </button>
                </div>
            )}
            {hold && !locked && (
                <div className="rounded-[20px] border border-sky-200 bg-sky-50 px-3.5 py-2.5 text-sm font-semibold text-sky-900" data-testid="hold-banner">
                    {HOLD_LABEL[hold.reason]}{hold.question ? <div className="mt-1 font-normal italic">“{hold.question}”</div> : null}
                </div>
            )}
            {result && !result.ok && (
                <div className="rounded-[20px] border border-red-300 bg-red-50 p-3.5 text-sm text-red-900" data-testid="send-error">
                    <div className="font-extrabold">{result.priced ? 'Prices saved, but the send did not go through' : 'Not sent'}</div>
                    <ul className="mt-1 list-disc pl-4">{(result.errors ?? [result.message ?? 'Send failed']).map((e, i) => <li key={i}>{e}</li>)}</ul>
                </div>
            )}
            {actionError && <div className="rounded-[20px] border border-red-300 bg-red-50 p-3.5 text-sm font-semibold text-red-900" data-testid="action-error">{actionError}</div>}

            {data.lines.length === 0 && <div className="rounded-[20px] border border-slate-200 bg-white p-4 text-sm text-slate-600">This draft has no lines. Open the full builder.</div>}
            {/* F1: the doubt order stands; only one line is open, the top doubt line on load. */}
            {ordered.map((l) => (
                <PriceLineCard key={l.lineId} line={l} state={states[l.lineId] ?? initialLineState(l)} contradictions={contradictions} resolutions={resolutions}
                    margin={margin} disabled={locked} open={openId === l.lineId} onToggle={() => setOpenId((o) => o === l.lineId ? null : l.lineId)}
                    onChange={(p) => patch(l.lineId, p)} onResolve={resolve} />
            ))}

            {/* P16: something the estimate never saw. The same card, empty. */}
            {!locked && (
                <button type="button" onClick={addLine}
                    className="min-h-[52px] w-full rounded-[20px] border border-dashed border-slate-300 bg-white/60 text-sm font-bold text-slate-600 hover:border-slate-400 hover:bg-white hover:text-slate-900"
                    data-testid="add-line">
                    + Add a line
                </button>
            )}

            {/* The breakdown behind the header's total */}
            <div className="rounded-[20px] bg-slate-900 px-4 py-3 text-white" data-testid="totals">
                <div className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 text-xs">
                    <span className="text-slate-400">Labour</span><span className="text-right font-semibold">{gbp(totals.labourPence)}</span>
                    <span className="text-slate-400">Materials at {data.settings.materialsMarginPercent}%</span><span className="text-right font-semibold">{gbp(totals.materialsPence)}</span>
                    <span className="mt-1 text-sm font-extrabold">Total</span><span className="mt-1 text-right text-sm font-extrabold text-amber-400" data-testid="total">{gbp(totals.totalPence)}</span>
                    <span className="text-slate-400">Deposit (materials in full + {data.settings.depositPercent}% of labour)</span><span className="text-right font-semibold" data-testid="deposit">{gbp(totals.depositPence)}</span>
                </div>
                {totals.missing > 0 && <div className="mt-2 text-xs font-bold text-amber-300" data-testid="missing-prices">{totals.missing} line{totals.missing === 1 ? '' : 's'} still need{totals.missing === 1 ? 's' : ''} a price</div>}
                {untitledAdded && <div className="mt-2 text-xs font-bold text-amber-300" data-testid="missing-title">An added line still needs a title</div>}
            </div>

            {/* The message she reads. F5: two rows, growing to six, then it scrolls. */}
            <div className="rounded-[20px] border border-slate-200 bg-white px-3.5 py-3">
                <div className="flex min-h-7 items-center justify-between gap-2">
                    <span className={EYEBROW}>What {first} reads</span>
                    <div className="flex items-center gap-2">
                        {/* P16: he can put the link back where he wants it, at the cursor. */}
                        {!locked && !linkPresent && (
                            <button type="button" onClick={insertLink} className="inline-flex min-h-7 items-center gap-1 rounded-full bg-slate-900 px-2.5 text-[11px] font-bold text-white" data-testid="insert-link">
                                + link
                            </button>
                        )}
                        {messageEdited && !locked && (
                            <button type="button" onClick={() => setMessage(data.message?.body ?? '')} className="inline-flex min-h-7 items-center gap-1 text-[11px] font-semibold text-slate-600" data-testid="message-reset"><RotateCcw className="h-3 w-3" /> desk's draft</button>
                        )}
                    </div>
                </div>
                <AutoGrowTextarea minRows={2} maxRows={6} value={message} disabled={locked} onChange={(e) => setMessage(e.target.value)}
                    textareaRef={messageRef}
                    className="mt-1 block w-full rounded-[14px] border border-transparent bg-slate-100 px-3 py-2 text-[13px] leading-snug text-slate-800 outline-none focus:border-slate-400 focus:bg-white"
                    aria-label={`Message ${first} reads`} data-testid="message-body" />
                <div className="mt-1 text-[11px] text-slate-500">Exactly what {first} receives, link and all.{messageEdited ? ' Edited.' : ''}</div>
                {!linkPresent && <div className="mt-1 text-[11px] font-bold text-amber-700" data-testid="no-link-warning">No quote link in the message, so the customer will have no way to open the quote. You can still send.</div>}
                {warnings.length > 0 && <div className="mt-1 text-[11px] font-bold text-amber-700" data-testid="message-warnings">Careful: the message {warnings.join('; ')}.</div>}
            </div>
        </div>
    );

    const threadPane = <ThreadPane thread={data.thread} firstName={first} expanded={threadExpanded} onExpand={() => setThreadExpanded(true)} />;

    // T20 / 4.4 / the customer's type: context for the work, read once, so it sits in the sheet rather than the sticky header.
    const context = (
        <div className="flex flex-wrap items-center gap-1.5 text-[11px] font-semibold" data-testid="context-chips">
            <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-slate-700" data-testid="customer-type">{CUSTOMER_TYPE_LABEL[data.customer.customerType] ?? data.customer.customerType}</span>
            {data.estimate?.confidence && <span className="text-slate-500">estimate {data.estimate.confidence}</span>}
            {data.job && (data.job.setupMinutes || data.job.cleanupMinutes) ? <span className="text-slate-500">+{data.job.setupMinutes + data.job.cleanupMinutes} min setup/cleanup</span> : null}
            {/* T20: the missing photo travels here instead of holding the conversation. Read off what the
                payload already carries (photos / videos / the thread); a tap opens the existing
                "Ask first" sheet pre-filled, so nothing is sent without Ben. */}
            {noPhoto && (
                <button type="button" disabled={locked || !!busy} onClick={() => { setSheetText(PHOTO_ASK_PREFILL); setSheet('ask'); }}
                    className="min-h-7 rounded-full bg-amber-100 px-2.5 text-amber-700 underline decoration-dotted disabled:no-underline disabled:opacity-60" data-testid="no-photo">
                    No photo{data.customerMedia?.repliedWithoutMedia ? ' · asked, none sent' : ''}
                </button>
            )}
            {/* 4.4: what the draft is missing, for Ben to request before he prices. It reaches this
                screen off the desk's case file, never off the quote row, which anyone holding the
                slug can read. */}
            {(data.benToRequest?.length ?? 0) > 0 && (
                <span className="flex flex-wrap items-center gap-1.5" data-testid="ben-to-request">
                    <span className="text-slate-500">To request</span>
                    {data.benToRequest!.map((what) => (
                        <span key={what} className="rounded-full bg-amber-100 px-2.5 py-1 text-amber-700">{what}</span>
                    ))}
                </span>
            )}
        </div>
    );

    const exitRow = 'flex min-h-12 w-full items-center gap-2 rounded-full border border-slate-300 px-4 text-left text-[13px] font-bold text-slate-900 disabled:opacity-40';

    const sheets = (
        <>
            {/* Sheets: one question / why a visit */}
            {sheet && (
                <div className="fixed inset-0 z-30 flex items-end justify-center bg-slate-900/50" onClick={() => !busy && setSheet(null)}>
                    <div className="w-full max-w-xl rounded-t-[28px] bg-white px-4 pb-6 pt-3 shadow-2xl" style={{ paddingBottom: 'max(1.5rem, env(safe-area-inset-bottom))' }} onClick={(e) => e.stopPropagation()} data-testid={`${sheet}-sheet`}>
                        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-slate-300" />
                        <div className="text-base font-extrabold text-slate-900">{sheet === 'ask' ? `Ask ${first} one thing first` : `Offer ${first} a visit instead of a price`}</div>
                        <p className="mt-1 text-xs text-slate-600">{sheet === 'ask' ? 'It goes to your queue to approve, then to her. The quote stays here until she answers.' : 'The survey offer (fee from settings) goes to your queue to approve. No price goes out.'}</p>
                        <textarea value={sheetText} onChange={(e) => setSheetText(e.target.value)} rows={3} autoFocus
                            placeholder={sheet === 'ask' ? 'Are the handles staying, or do you want new ones?' : 'Why a visit (optional): what it depends on'}
                            className="mt-2 w-full rounded-[14px] border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-900" data-testid={sheet === 'ask' ? 'ask-question' : 'visit-why'} />
                        <div className="mt-3 flex gap-2">
                            <button type="button" onClick={() => setSheet(null)} className="min-h-12 flex-1 rounded-full border border-slate-300 text-sm font-bold text-slate-700">Back</button>
                            <button type="button" onClick={() => void exit(sheet)} disabled={!!busy || (sheet === 'ask' && !sheetText.trim())}
                                className="min-h-12 flex-1 rounded-full bg-slate-900 text-sm font-bold text-white disabled:bg-slate-300" data-testid={sheet === 'ask' ? 'ask-submit' : 'visit-submit'}>
                                {busy ? <Loader2 className="mx-auto h-4 w-4 animate-spin" /> : sheet === 'ask' ? 'Queue the question' : 'Draft the visit offer'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* F2: the ⋯ sheet holds the three other exits and the full builder. */}
            {overflow && (
                <div className="fixed inset-0 z-30 flex items-end justify-center bg-slate-900/50" onClick={() => !busy && setOverflow(false)}>
                    <div className="w-full max-w-xl rounded-t-[28px] bg-white px-4 pt-3" style={{ paddingBottom: 'max(1.5rem, env(safe-area-inset-bottom))' }} onClick={(e) => e.stopPropagation()} data-testid="exits-sheet">
                        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-slate-300" />
                        <div className="text-[10px] font-bold uppercase tracking-[0.1em] text-slate-500">Instead of sending</div>
                        <div className="mt-3 flex flex-col gap-2">
                            <button type="button" disabled={locked || !!busy} onClick={() => { setOverflow(false); setSheetText(''); setSheet('ask'); }} className={exitRow} data-testid="ask-first">
                                <HelpCircle className="h-4 w-4 text-slate-500" /> Ask {first} first
                            </button>
                            <button type="button" disabled={locked || !!busy || !data.call?.customerPhone} onClick={() => void exit('call')} className={exitRow} data-testid="call-her">
                                {busy === 'call' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Phone className="h-4 w-4 text-slate-500" />} Call {first}
                            </button>
                            <button type="button" disabled={locked || !!busy} onClick={() => { setOverflow(false); setSheetText(''); setSheet('visit'); }} className={exitRow} data-testid="needs-visit">
                                <Home className="h-4 w-4 text-slate-500" /> Needs a visit
                            </button>
                            <a href={data.builderUrl} className={cn(exitRow, 'font-semibold text-slate-500')} data-testid="open-builder">
                                <PenLine className="h-4 w-4" /> Open full builder
                            </a>
                        </div>
                    </div>
                </div>
            )}
        </>
    );

    const sendButton = (label: string) => (
        <button type="button" onClick={send} disabled={!canSend}
            className="inline-flex h-12 min-w-0 flex-1 items-center justify-center gap-2 rounded-full bg-amber-400 px-4 text-sm font-bold text-slate-900 transition-colors hover:bg-amber-300 disabled:bg-slate-200 disabled:text-slate-400"
            data-testid="send-quote">
            {busy === 'send' && <Loader2 className="h-4 w-4 animate-spin" />}
            <span className="truncate">{busy === 'send' ? 'Sending…' : `${label}${totals.totalPence > 0 ? ` · ${gbp(totals.totalPence)}` : ''}`}</span>
        </button>
    );
    const moreButton = (
        <button type="button" onClick={() => setOverflow(true)} aria-label="Other options: ask first, call, visit, full builder"
            className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full border border-slate-300 text-slate-900" data-testid="more-exits">
            <MoreHorizontal className="h-5 w-5" />
        </button>
    );

    if (embedded) {
        // B9 desktop: the quote as the Handy Desk's answer surface. The thread on the left, the price
        // on the right and the confirm footer under them; the desk's own header stays above.
        return (
            <div className="flex flex-col gap-3" data-testid="price-and-send" data-layout="desktop" data-embedded="true">
                <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                        <div className="text-[10px] font-bold uppercase tracking-[0.1em] text-amber-600" data-testid="readiness">{eyebrow}</div>
                        <h2 className="mt-0.5 flex items-center gap-2 text-[22px] font-extrabold leading-tight tracking-[-0.02em] text-slate-900" data-testid="customer-first-name">
                            {first}
                            {data.customer.postcode && <span className="rounded-full border border-slate-300 px-2.5 py-1 font-mono text-[11px] font-bold text-slate-700" data-testid="postcode">{data.customer.postcode}</span>}
                        </h2>
                    </div>
                    {onClose && (
                        <button type="button" onClick={requestClose} aria-label="Close the quote" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-slate-400 hover:bg-slate-100 hover:text-slate-700" data-testid="price-close">
                            <X className="h-5 w-5" />
                        </button>
                    )}
                </div>
                <div className="grid grid-cols-1 gap-5 xl:grid-cols-[340px_minmax(0,1fr)]" data-testid="side-by-side">
                    <aside className="order-last self-start rounded-[20px] xl:order-none border border-slate-200 bg-slate-100 p-3">
                        <div className={cn(EYEBROW, 'mb-2')}>Thread{data.thread?.count ? ` · ${data.thread.count}` : ''}</div>
                        {threadPane}
                    </aside>
                    <div className="space-y-2">
                        <div className="flex flex-wrap items-center gap-2" data-testid="summary">
                            <span className="rounded-full bg-amber-400 px-3 py-1 text-xs font-extrabold text-slate-900" data-testid="summary-total">{gbp(totals.totalPence)}</span>
                            <span className="rounded-full border border-slate-300 px-3 py-1 text-[11px] font-semibold text-slate-600" data-testid="summary-lines">{kept.length} line{kept.length === 1 ? '' : 's'}</span>
                            {toCheck > 0
                                ? <span className="rounded-full border border-amber-400 bg-amber-50 px-3 py-1 text-[11px] font-bold text-amber-700" data-testid="contradiction-count">{toCheck} to check</span>
                                : <span className="rounded-full border border-slate-300 px-3 py-1 text-[11px] font-semibold text-slate-500" data-testid="contradiction-count">nothing to check</span>}
                            {queueItem && <span className="ml-auto text-[11px] text-slate-500" data-testid="summary-waiting">{channel ? `${channel} · ` : ''}{ageLabel(queueItem.waitingMs)}</span>}
                        </div>
                        {context}
                        {pricePane}
                    </div>
                </div>
                <div className="sticky bottom-0 z-10 -mx-1 flex items-center gap-2.5 rounded-t-[20px] border-t border-slate-200 bg-white/95 px-3 py-3 backdrop-blur" data-testid="price-footer">
                    <span className="min-w-0 flex-1 truncate text-[11px] text-slate-500">
                        {data.settings.depositPercent}% deposit on labour, materials in full{data.followUpDays ? ` · follow-up in ${data.followUpDays} days if unviewed` : ''} · {stripCount === 0 && !stripNext ? 'nothing else waiting' : stripCount == null ? 'more waiting' : `${stripCount} more waiting`}
                    </span>
                    {moreButton}
                    <div className="flex w-64">{sendButton('Send quote')}</div>
                </div>
                {sheets}
                {confirmClose && (
                    <div className="fixed inset-0 z-30 flex items-center justify-center bg-slate-900/50 p-4" onClick={() => setConfirmClose(false)}>
                        <div role="alertdialog" aria-labelledby="price-close-title" className="w-full max-w-sm rounded-[24px] bg-white p-5 shadow-2xl" onClick={(e) => e.stopPropagation()} data-testid="price-close-confirm">
                            <div id="price-close-title" className="text-base font-extrabold text-slate-900">Close {first}'s quote? Your changes on it will be lost.</div>
                            <div className="mt-4 flex gap-2">
                                <button type="button" autoFocus onClick={() => setConfirmClose(false)} className="min-h-12 flex-1 rounded-full border border-slate-300 text-sm font-bold text-slate-700" data-testid="price-close-keep">Keep editing</button>
                                <button type="button" onClick={() => { setConfirmClose(false); onClose?.(); }} className="min-h-12 flex-1 rounded-full bg-red-600 text-sm font-bold text-white" data-testid="price-close-discard">Close and lose them</button>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-slate-900" data-testid="price-and-send" data-layout={desktop ? 'desktop' : 'phone'}>
            {/* F6: the page's own header, the only one on this route: name, stage and postcode, then F3's
                summary of what is about to go out, then the queue. */}
            <header className="sticky top-0 z-10 bg-slate-900 text-white" style={{ paddingTop: 'env(safe-area-inset-top)' }}>
                <div className={cn('mx-auto px-4 pb-2 pt-3', desktop ? 'max-w-6xl' : 'max-w-xl')}>
                    <div className="flex items-center gap-2">
                        <a href={HANDY_DESK_PATH} aria-label="Back to the desk" className="-ml-2 flex h-11 w-9 shrink-0 items-center justify-center text-white" data-testid="back">
                            <ChevronLeft className="h-5 w-5" />
                        </a>
                        <div className="min-w-0 flex-1">
                            <div className="text-[10px] font-bold uppercase tracking-[0.1em] text-amber-400" data-testid="readiness">{eyebrow}</div>
                            <h1 className="mt-0.5 truncate text-[26px] font-extrabold leading-none tracking-[-0.02em]" data-testid="customer-first-name">{first}</h1>
                        </div>
                        {data.customer.postcode && <span className="shrink-0 rounded-full border border-slate-700 px-2.5 py-1.5 font-mono text-[11px] font-bold" data-testid="postcode">{data.customer.postcode}</span>}
                    </div>
                    <div className="mt-2.5 flex flex-wrap items-center gap-2" data-testid="summary">
                        <span className="rounded-full bg-amber-400 px-3 py-1 text-xs font-extrabold text-slate-900" data-testid="summary-total">{gbp(totals.totalPence)}</span>
                        <span className="rounded-full border border-slate-700 px-3 py-1 text-[11px] font-semibold text-slate-300" data-testid="summary-lines">{kept.length} line{kept.length === 1 ? '' : 's'}</span>
                        {toCheck > 0
                            ? <span className="rounded-full border border-amber-400 px-3 py-1 text-[11px] font-bold text-amber-400" data-testid="contradiction-count">{toCheck} to check</span>
                            : <span className="rounded-full border border-slate-700 px-3 py-1 text-[11px] font-semibold text-slate-400" data-testid="contradiction-count">nothing to check</span>}
                        {queueItem && <span className="ml-auto text-[11px] text-slate-400" data-testid="summary-waiting">{channel ? `${channel} · ` : ''}{ageLabel(queueItem.waitingMs)}</span>}
                    </div>
                    <div className="mt-2">{queueStrip}</div>
                </div>
            </header>

            <div className={cn('min-h-[calc(100vh-150px)] rounded-t-[28px] bg-slate-50 pb-28 pt-4', desktop && 'pb-32')}>
                <div className={cn('mx-auto px-4', desktop ? 'max-w-6xl' : 'max-w-xl')}>
                    {desktop ? (
                        <div className="grid grid-cols-[340px_minmax(0,1fr)] gap-5" data-testid="side-by-side">
                            <aside className="sticky top-40 max-h-[calc(100vh-11rem)] self-start overflow-y-auto rounded-[20px] border border-slate-200 bg-slate-100 p-3">
                                <div className={cn(EYEBROW, 'mb-2')}>Thread{data.thread?.count ? ` · ${data.thread.count}` : ''}</div>
                                {threadPane}
                            </aside>
                            <div className="space-y-2">{context}{pricePane}</div>
                        </div>
                    ) : (
                        <div className="space-y-3">
                            <div className="grid grid-cols-2 gap-1 rounded-full bg-slate-200/70 p-1 text-[13px] font-bold" role="tablist" data-testid="tabs">
                                <button type="button" role="tab" aria-selected={tab === 'price'} onClick={() => setTab('price')} className={cn('min-h-9 rounded-full', tab === 'price' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500')} data-testid="tab-price">Price</button>
                                <button type="button" role="tab" aria-selected={tab === 'thread'} onClick={() => setTab('thread')} className={cn('min-h-9 rounded-full', tab === 'thread' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500')} data-testid="tab-thread">Thread{data.thread?.count ? ` · ${data.thread.count}` : ''}</button>
                            </div>
                            {tab === 'thread' ? threadPane : <>{context}{pricePane}</>}
                        </div>
                    )}
                </div>
            </div>

            {sheets}

            {/* F2: the thumb bar. The amber Send pill with the total, and ⋯. */}
            <div className="fixed inset-x-0 bottom-0 z-20 border-t border-slate-200 bg-white" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
                <div className={cn('mx-auto flex items-center gap-2.5 px-4 py-3', desktop ? 'max-w-6xl pl-[calc(340px+2.25rem)]' : 'max-w-xl')}>
                    {sendButton('Send')}
                    {moreButton}
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
