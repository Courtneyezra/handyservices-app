/**
 * QuotePrepPanel — the full-height slide-over a "Prep quote" run opens over the comms thread.
 *
 * Evolves the old compact in-chat review card into builder parity without leaving the thread:
 * every job line carries the same materials picker (Screwfix/catalog, costs sync into the
 * engine price), the same per-line assumptions editor and scope steps, plus scheduling
 * signals (urgency, time of service, the survey-required gate), crew/skin selection and
 * optional extras — all reusing the contextual builder's own components.
 *
 * The agent's assumptions[] land as REAL assumptions: matched onto the line they belong to
 * (per-line, customer-visible) with the rest saved quote-level — all editable, Ben prunes
 * before send. Save = an UNSENT DRAFT through the builder's own creation path; Send drafts
 * the WhatsApp burst (builder generator, style dropdown, no greeting) for Ben's approval.
 * Thread is one click back (close the sheet); the panel keeps its state while the thread
 * stays open, so closing to check a message loses nothing.
 *
 * Mobile overhaul (29 Aug 2026): full-screen on phones, with sticky tabs — Quote (the
 * form), Thread (the conversation, self-fetched here so the mounting pages' prop contract
 * is untouched) and Media (a tappable grid with a full-screen lightbox). All panes stay
 * mounted across tab hops so nothing is lost. The media ticks are one shared state:
 * grid, lightbox and the Quote tab's compact summary all flip the same set.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import {
    Sheet, SheetContent, SheetTitle, SheetDescription,
} from '@/components/ui/sheet';
import {
    AlertCircle, Bot, Check, ChevronDown, ChevronRight, Clock, ExternalLink,
    FileText, Image as ImageIcon, Loader2, MessageSquare, Send, X, Plus, Sparkles, Pin,
} from 'lucide-react';
import { CATEGORY_OPTIONS } from '@/lib/quote-categories';
import { cn } from '@/lib/utils';
import { assessScopeRisk } from '@/lib/scope-risk';
import { type QuoteMaterial, materialsCostPence } from '@shared/materials';
import { MaterialsPicker } from '@/components/quote/MaterialsPicker';
import { LineAssumptionsEditor } from '@/components/quote/LineAssumptionsEditor';
import { SurveyGateCard } from '@/components/quote/SurveyGateCard';
import {
    CrewSkinPicker, useSkinContractors, useContractorTeams,
} from '@/components/quote/CrewSkinPicker';
import { ExtrasEditor, type OptionalExtra } from '@/components/quote/ExtrasEditor';
import { PrepThreadTab } from './PrepThreadTab';
import { PrepMediaGrid, PrepMediaLightbox } from './PrepMediaGrid';

function getAuthHeaders(): Record<string, string> {
    const token = localStorage.getItem('adminToken');
    return token ? { Authorization: `Bearer ${token}` } : {};
}

// ---------------------------------------------------------------- prop shapes

/** The quote-prep agent's structured intake (mirrors server/agents/quote-prep.ts). */
export interface IntakeLine {
    /** Customer-facing quote line title (server-capped at 60 chars). */
    title: string;
    /** Internal evidence behind the line: what the photo/thread shows. */
    detail: string;
    /** Caveats this line's price depends on. */
    assumptions: string[];
}

export type IntakeReadiness = 'quote_ready' | 'needs_info' | 'visit_first';

export interface IntakeGap {
    question: string;
    audience: 'customer' | 'ben';
    /** 1-based index into lines[]; null = whole job. */
    lineIndex: number | null;
}

/** Shadow-mode readiness (server-computed, rides on the intake). Advisory while the
 *  clerk's verdict still gates — shown so Ben sees both and disagreements get eyes. */
export interface IntakeShadow {
    score: number;
    band: 'build' | 'grey' | 'ask';
    wouldAskCount: number;
    wouldAssumeCount: number;
    slots: { label: string; state: 'confirmed' | 'assumed' | 'missing'; note: string }[];
    verifier: { priceable: boolean; blocker: string | null; suggestedAsk: string | null } | null;
    clerkVerdict: IntakeReadiness;
    agrees: boolean;
    at: string;
}

export interface QuoteIntake {
    customerName: string | null;
    phone: string;
    postcode: string | null;
    customerType?: 'homeowner' | 'landlord' | 'letting_agent' | 'business';
    lines: IntakeLine[];
    assumptions: string[];
    readiness: IntakeReadiness;
    gaps: IntakeGap[];
    urgency: 'low' | 'med' | 'high';
    shadow?: IntakeShadow;
}

/** Minimal thread-media shape (a CommsPage ThreadMessage satisfies it). */
export interface PrepThreadMedia {
    mediaUrl: string | null;
    mediaType: string | null;
    type: string;
}

/** Minimal conversation shape (a CommsPage BoardCard satisfies it). */
export interface PrepConversation {
    id: string;
    phoneNumber: string;
    windowOpen: boolean;
}

// ---------------------------------------------------------------- constants

const CUSTOMER_TYPE_OPTIONS = [
    { value: 'homeowner', label: 'Homeowner' },
    { value: 'oap_homeowner', label: 'OAP Homeowner' },
    { value: 'landlord', label: 'Landlord' },
    { value: 'property_manager', label: 'Property Manager' },
    { value: 'tenant', label: 'Tenant' },
    { value: 'business', label: 'Business' },
    { value: 'letting_agent', label: 'Letting agent' },
] as const;

/** The builder's message styles (mirrors MESSAGE_STYLES in server/contextual-pricing/
 *  quote-message.ts). Auto-picked from customerType server-side; this dropdown overrides. */
const MESSAGE_STYLE_OPTIONS = [
    { value: 'friendly', label: 'Friendly' },
    { value: 'professional', label: 'Professional' },
    { value: 'efficient', label: 'Hands-off' },
    { value: 'reassuring', label: 'Reassuring' },
    { value: 'delay', label: 'Apology for delay' },
] as const;

const URGENCY_OPTIONS = [
    { value: 'standard' as const, label: 'Standard', helper: 'This week' },
    { value: 'priority' as const, label: 'Priority', helper: 'Next 48h' },
    { value: 'emergency' as const, label: 'Emergency', helper: 'Today' },
];

const TIME_OF_SERVICE_OPTIONS = [
    { value: 'standard' as const, label: 'Daytime' },
    { value: 'after_hours' as const, label: 'After hours' },
    { value: 'weekend' as const, label: 'Weekend' },
];

const formatPence = (pence: number) => `£${(pence / 100).toFixed(2).replace(/\.00$/, '')}`;

/** Duration steps Ben actually prices in — minutes, then hours, then days (1 day = 8h,
 *  same as the scheduler's 480-minute day). */
const DURATION_OPTIONS: Array<{ value: number; label: string }> = [
    { value: 30, label: '30 min' },
    { value: 45, label: '45 min' },
    { value: 60, label: '1 hour' },
    { value: 90, label: '1.5 hours' },
    { value: 120, label: '2 hours' },
    { value: 150, label: '2.5 hours' },
    { value: 180, label: '3 hours' },
    { value: 240, label: '4 hours' },
    { value: 300, label: '5 hours' },
    { value: 360, label: '6 hours' },
    { value: 420, label: '7 hours' },
    { value: 480, label: '1 day' },
    { value: 720, label: '1.5 days' },
    { value: 960, label: '2 days' },
    { value: 1440, label: '3 days' },
    { value: 1920, label: '4 days' },
    { value: 2400, label: '5 days' },
];

/** Label for a parser-estimated duration that isn't one of the standard steps. */
function durationLabel(mins: number): string {
    if (mins < 60) return `${mins} min`;
    const h = mins / 60;
    if (h < 8) return Number.isInteger(h) ? `${h} hour${h > 1 ? 's' : ''}` : `${h.toFixed(1)} hours`;
    const d = mins / 480;
    return Number.isInteger(d) ? `${d} day${d > 1 ? 's' : ''}` : `${d.toFixed(1)} days`;
}

// ---------------------------------------------------------------- line model

/** One editable job line: the card's model plus the builder's per-line extras. */
interface PanelLine {
    key: string;
    description: string;
    /** Internal evidence (the agent's `detail`) — saved as the line's `details`. */
    detail: string;
    category: string | null;
    estimatedMinutes: number | null;
    /** Ben typed the minutes himself — the parser must stop touching them. */
    minutesEdited: boolean;
    /** Hand-typed labour price. Pins the line: the engine applies it verbatim. */
    priceOverridePence: number | null;
    materials: QuoteMaterial[];
    assumptions: string[];
    scopeSteps: string[];
}

/**
 * The agent now hands over lines already split the way the quote needs them, so this is a
 * direct map: title → the customer-facing description, detail → the line's internal details,
 * assumptions → the line's own assumptions. Nothing is guessed here any more (the old
 * word-overlap matcher and title/detail split heuristic are gone); intake.assumptions is
 * exactly what the agent judged to be quote-level.
 */
function buildInitialLines(intake: QuoteIntake): { lines: PanelLine[]; quoteLevel: string[] } {
    const stamp = Date.now();
    return {
        lines: (intake.lines ?? []).map((l, i) => ({
            key: `prep_${stamp}_${i}`,
            description: (l.title ?? '').trim(),
            detail: (l.detail ?? '').trim(),
            category: null,
            estimatedMinutes: null,
            minutesEdited: false,
            priceOverridePence: null,
            materials: [],
            assumptions: (l.assumptions ?? []).map((a) => a.trim()).filter(Boolean),
            scopeSteps: [],
        })),
        quoteLevel: (intake.assumptions ?? []).map((a) => a.trim()).filter(Boolean),
    };
}

const READINESS_UI: Record<IntakeReadiness, { label: string; blurb: string; chip: string; card: string }> = {
    quote_ready: {
        label: 'Quote ready',
        blurb: 'Everything needed to price this is in the thread.',
        chip: 'bg-emerald-600 text-white',
        card: 'border-emerald-200 bg-emerald-50 text-emerald-900',
    },
    needs_info: {
        label: 'Needs info',
        blurb: 'These answers change the price or the scope. Ask before you send.',
        chip: 'bg-amber-500 text-white',
        card: 'border-amber-200 bg-amber-50 text-amber-900',
    },
    visit_first: {
        label: 'Visit first',
        blurb: 'This one cannot be priced honestly from the thread. Send them the survey route, not a guess.',
        chip: 'bg-slate-700 text-white',
        card: 'border-slate-300 bg-slate-100 text-slate-800',
    },
};

// ---------------------------------------------------------------- panel

export function QuotePrepPanel({ intake, conversation, media, open, onOpenChange, onDismiss, onRefresh }: {
    intake: QuoteIntake;
    conversation: PrepConversation;
    media: PrepThreadMedia[];
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onDismiss: () => void;
    onRefresh: () => void;
}) {
    // ── Customer ──
    // Name/postcode are editable: the agent may have missed what Ben knows.
    const [customerName, setCustomerName] = useState(intake.customerName ?? '');
    const [postcode, setPostcode] = useState(intake.postcode ?? '');
    const [customerType, setCustomerType] = useState<string>(intake.customerType || 'homeowner');

    // ── Lines + assumptions ──
    const initial = useMemo(() => buildInitialLines(intake), [intake]);
    const [lines, setLines] = useState<PanelLine[]>(initial.lines);
    // Quote-level assumptions: the agent caveats that fit no single line. Saved
    // onto the quote's quote_assumptions column; editable here, Ben prunes.
    const [quoteAssumptions, setQuoteAssumptions] = useState<string[]>(initial.quoteLevel);
    const nextLineKeyRef = useRef(1000);
    // Which per-line sections are expanded, keyed `${lineKey}:${section}`.
    // Lines with agent assumptions open on that section so Ben sees them.
    const [openSections, setOpenSections] = useState<Set<string>>(
        () => new Set(initial.lines.filter((l) => l.assumptions.length > 0).map((l) => `${l.key}:assumptions`)),
    );
    const toggleSection = (key: string) =>
        setOpenSections((prev) => {
            const next = new Set(prev);
            if (next.has(key)) next.delete(key); else next.add(key);
            return next;
        });

    const updateLine = (key: string, patch: Partial<PanelLine>) =>
        setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));

    // ── Readiness + gaps ──
    // The agent's verdict for the whole conversation, and the questions behind it. A gap is
    // "resolved" when it has actually been dealt with: a customer gap once the ask is queued
    // for approval, a Ben gap once he's typed the answer. Unresolved gaps are what the
    // save/send checklist puts in front of him.
    const readiness: IntakeReadiness = intake.readiness ?? 'needs_info';
    const gaps = intake.gaps ?? [];
    const readinessUi = READINESS_UI[readiness] ?? READINESS_UI.needs_info;
    const [askedGaps, setAskedGaps] = useState<Set<number>>(new Set());
    const [gapAnswers, setGapAnswers] = useState<Record<number, string>>({});
    // Which Ben-audience chip is open for an answer.
    const [openGap, setOpenGap] = useState<number | null>(null);
    const [gapDraft, setGapDraft] = useState('');

    const gapResolved = (i: number) => askedGaps.has(i) || !!gapAnswers[i]?.trim();
    const unresolvedGaps = gaps.map((g, i) => ({ g, i })).filter(({ i }) => !gapResolved(i));

    /**
     * Ben's answer to a clarify chip lands where it belongs: appended to that line's internal
     * detail (question and answer, so the reason survives), or to the quote-level notes when
     * the gap spans the whole job.
     */
    const [jobNotes, setJobNotes] = useState<string[]>([]);
    const answerGap = (i: number, answer: string) => {
        const gap = gaps[i];
        const text = answer.trim();
        if (!gap || !text) return;
        const note = `${gap.question} ${text}`;
        const idx = gap.lineIndex;
        if (idx && idx >= 1 && idx <= lines.length) {
            const key = lines[idx - 1].key;
            setLines((prev) => prev.map((l) => (
                l.key === key ? { ...l, detail: [l.detail, note].filter(Boolean).join('\n') } : l
            )));
            setOpenSections((prev) => new Set(prev).add(`${key}:detail`));
        } else {
            setJobNotes((prev) => [...prev, note]);
        }
        setGapAnswers((prev) => ({ ...prev, [i]: text }));
        setOpenGap(null);
        setGapDraft('');
    };

    // ── Signals ──
    const [urgency, setUrgency] = useState<'standard' | 'priority' | 'emergency'>(
        intake.urgency === 'high' ? 'priority' : 'standard',
    );
    const [timeOfService, setTimeOfService] = useState<'standard' | 'after_hours' | 'weekend'>('standard');
    // "Visit first" pre-toggles the survey gate: the agent has already said this can't be
    // priced from the thread, so the default is the survey route, not a guessed quote.
    const [surveyRequired, setSurveyRequired] = useState(readiness === 'visit_first');
    const [surveyFeePounds, setSurveyFeePounds] = useState('');

    // ── Crew & skin ──
    const [vertical, setVertical] = useState<'handyman' | 'cleaning'>('handyman');
    const [crewType, setCrewType] = useState<'solo' | 'team'>('solo');
    const [skinContractorId, setSkinContractorId] = useState<string | null>(null);
    const [skinTeamId, setSkinTeamId] = useState<string | null>(null);
    const { data: contractors } = useSkinContractors();
    const { data: teams } = useContractorTeams();

    // ── Extras ──
    const [optionalExtras, setOptionalExtras] = useState<OptionalExtra[]>([]);

    // ── Media ticks (all ticked by default — Ben unticks) ──
    const [ticked, setTicked] = useState<Record<string, boolean>>(
        () => Object.fromEntries(media.filter((m) => m.mediaUrl).map((m) => [m.mediaUrl!, true])),
    );
    const isVideo = (m: PrepThreadMedia) => (m.mediaType ?? '').startsWith('video/') || m.type === 'video';
    const tickedCount = media.filter((m) => m.mediaUrl && ticked[m.mediaUrl]).length;

    // ── Tabs (mobile overhaul) ──
    // Quote = the builder form, Thread = the conversation, Media = the grid + lightbox.
    // All three panes stay mounted (hidden, not unmounted) so form state, scroll
    // positions and the thread query survive tab hops.
    const [tab, setTab] = useState<'quote' | 'thread' | 'media'>('quote');
    // The thread fetch is lazy: it fires the first time the tab is opened, then caches.
    const [threadVisited, setThreadVisited] = useState(false);
    const switchTab = (t: 'quote' | 'thread' | 'media') => {
        if (t === 'thread') setThreadVisited(true);
        setTab(t);
    };
    // Full-screen media viewer; null = shut. Indexes into `media`.
    const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
    const openMediaByUrl = (url: string) => {
        const idx = media.findIndex((m) => m.mediaUrl === url);
        if (idx >= 0) setLightboxIndex(idx);
        else window.open(url, '_blank', 'noopener'); // audio/doc from the thread — not gridable
    };
    // Jump-bar targets: one ref per line card.
    const lineRefs = useRef<Record<string, HTMLDivElement | null>>({});

    const [saved, setSaved] = useState<{ slug: string; quoteId: string; total: string | null } | null>(null);
    const [cardError, setCardError] = useState<string | null>(null);

    // ── Live engine re-price, debounced ──
    // Two stages: lines the parser hasn't classified yet go through /api/pricing/parse-job
    // for a category + realistic minutes; classified lines go to /api/pricing/multi-quote —
    // the exact engine path the builder's live preview calls — WITH their materials and the
    // panel's signals, so the £ here is the £ the builder would show, materials included.
    const [priced, setPriced] = useState<{
        totalPence: number;
        materialsPence: number;
        perLine: Map<string, number>;
    } | null>(null);
    const [pricingBusy, setPricingBusy] = useState(false);
    const priceAbortRef = useRef<AbortController | null>(null);
    const priceRunRef = useRef(0);

    useEffect(() => {
        const run = ++priceRunRef.current;
        const timer = setTimeout(async () => {
            priceAbortRef.current?.abort();
            const controller = new AbortController();
            priceAbortRef.current = controller;
            const headers = { 'Content-Type': 'application/json', ...getAuthHeaders() };
            try {
                // Stage 1: classify anything the engine can't price yet.
                const pending = lines.filter((l) => !l.category && l.description.trim());
                if (pending.length > 0) {
                    setPricingBusy(true);
                    const updates = new Map<string, { category: string; estimatedMinutes: number }>();
                    for (const line of pending) {
                        const res = await fetch('/api/pricing/parse-job', {
                            method: 'POST', headers, signal: controller.signal,
                            body: JSON.stringify({ description: line.description.slice(0, 2000) }),
                        });
                        const parsed = await res.json().catch(() => ({}));
                        const first = Array.isArray(parsed.lines) ? parsed.lines[0] : null;
                        if (res.ok && first?.category && first?.timeEstimateMinutes) {
                            updates.set(line.key, { category: first.category, estimatedMinutes: first.timeEstimateMinutes });
                        }
                    }
                    if (controller.signal.aborted || run !== priceRunRef.current) return;
                    if (updates.size > 0) {
                        // Merging re-fires this effect; the next pass finds nothing pending and prices.
                        // Minutes Ben typed himself survive the re-parse — only the category updates.
                        setLines((prev) => prev.map((l) => {
                            const u = updates.get(l.key);
                            if (!u) return l;
                            return {
                                ...l,
                                category: u.category,
                                estimatedMinutes: l.minutesEdited && l.estimatedMinutes ? l.estimatedMinutes : u.estimatedMinutes,
                            };
                        }));
                        return;
                    }
                }

                // Stage 2: price the classified lines through the engine.
                const valid = lines.filter((l) => l.category && (l.estimatedMinutes ?? 0) > 0 && l.description.trim());
                if (valid.length === 0) { setPriced(null); setPricingBusy(false); return; }
                setPricingBusy(true);
                const anyMaterials = valid.some((l) => l.materials.length > 0);
                const res = await fetch('/api/pricing/multi-quote', {
                    method: 'POST', headers, signal: controller.signal,
                    body: JSON.stringify({
                        lines: valid.map((l) => ({
                            id: l.key, description: l.description, category: l.category,
                            timeEstimateMinutes: l.estimatedMinutes,
                            materialsCostPence: materialsCostPence(l.materials),
                            ...(l.materials.length ? { materials: l.materials } : {}),
                            ...(l.priceOverridePence != null ? { priceOverridePence: l.priceOverridePence } : {}),
                            // Ben typed the minutes → time is the price input (£ = time × rate).
                            ...(l.minutesEdited && l.priceOverridePence == null ? { priceFromTime: true } : {}),
                        })),
                        signals: {
                            urgency,
                            timeOfService,
                            materialsSupply: anyMaterials ? 'we_supply' : 'labor_only',
                        },
                    }),
                });
                if (!res.ok) throw new Error('re-price failed');
                const data = await res.json();
                if (controller.signal.aborted || run !== priceRunRef.current) return;
                const perLine = new Map<string, number>();
                let materialsPence = 0;
                for (const li of data.lineItems ?? []) {
                    // Customer-facing per-line £: labour + materials with margin.
                    if (typeof li.guardedPricePence === 'number') {
                        perLine.set(li.lineId, li.guardedPricePence + (li.materialsWithMarginPence || 0));
                    }
                    materialsPence += li.materialsWithMarginPence || 0;
                }
                setPriced({ totalPence: data.finalPricePence ?? 0, materialsPence, perLine });
                setPricingBusy(false);
            } catch (e: any) {
                if (e?.name === 'AbortError') return;
                if (run === priceRunRef.current) { setPriced(null); setPricingBusy(false); }
            }
        }, 700);
        return () => clearTimeout(timer);
    }, [lines, urgency, timeOfService]); // eslint-disable-line react-hooks/exhaustive-deps

    // ── Auto-draft scope steps ──
    // The builder drafts customer-facing scope steps per line as titles settle
    // (always-on, owner call 12 Aug 2026). Mirror it here: once a line is
    // classified and has no steps, draft once per description through the same
    // /api/pricing/draft-line-detail endpoint; rewording a line re-drafts after
    // it re-classifies. Never overwrites steps Ben already has.
    const stepsAttemptedRef = useRef<Set<string>>(new Set());
    const [draftingStepsKeys, setDraftingStepsKeys] = useState<Set<string>>(new Set());

    const draftSteps = async (lineKey: string, description: string, category: string) => {
        setDraftingStepsKeys((prev) => new Set(prev).add(lineKey));
        try {
            const res = await fetch('/api/pricing/draft-line-detail', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
                body: JSON.stringify({ lineDescription: description, category }),
            });
            if (!res.ok) return;
            const { steps } = await res.json();
            const drafted = Array.isArray(steps)
                ? steps.filter((s: unknown): s is string => typeof s === 'string' && !!s.trim()).slice(0, 6)
                : [];
            if (drafted.length === 0) return;
            setLines((prev) => prev.map((l) => {
                if (l.key !== lineKey) return l;
                if (l.scopeSteps.some((s) => s.trim())) return l; // never overwrite typed steps
                return { ...l, scopeSteps: drafted };
            }));
            // Surface the drafted steps for review, same as agent assumptions.
            setOpenSections((prev) => new Set(prev).add(`${lineKey}:steps`));
        } catch {
            // Non-critical — Ben can add steps manually.
        } finally {
            setDraftingStepsKeys((prev) => { const n = new Set(prev); n.delete(lineKey); return n; });
        }
    };

    // ── Polish (explicit button, never an auto-rewrite) ──
    // Rough titles ("swap hinges cab door") become the customer-facing imperative the
    // quote prints. Result lands back in the input, still editable; category re-classifies
    // but minutes Ben typed survive (same rule as a manual reword).
    const [polishingKeys, setPolishingKeys] = useState<Set<string>>(new Set());
    const polishLine = async (lineKey: string) => {
        const line = lines.find((l) => l.key === lineKey);
        const description = line?.description.trim();
        if (!line || !description) return;
        setPolishingKeys((prev) => new Set(prev).add(lineKey));
        try {
            const res = await fetch('/api/pricing/polish-line', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
                body: JSON.stringify({ description }),
            });
            if (!res.ok) return;
            const { polished } = await res.json();
            if (typeof polished === 'string' && polished.trim() && polished.trim() !== description) {
                updateLine(lineKey, { description: polished.trim(), category: null });
            }
        } catch {
            // Non-critical — the title stays as typed.
        } finally {
            setPolishingKeys((prev) => { const n = new Set(prev); n.delete(lineKey); return n; });
        }
    };
    const polishAll = () => {
        for (const l of lines) {
            if (l.description.trim() && !polishingKeys.has(l.key)) void polishLine(l.key);
        }
    };

    // Smooth £ typing: the input's raw text lives here; the parsed pin lives on the line.
    const [priceDrafts, setPriceDrafts] = useState<Record<string, string>>({});

    useEffect(() => {
        for (const line of lines) {
            if (!line.category || !line.description.trim()) continue;
            if (line.scopeSteps.some((s) => s.trim())) continue;
            const attemptKey = `${line.key}::${line.description.trim().toLowerCase()}`;
            if (stepsAttemptedRef.current.has(attemptKey)) continue;
            stepsAttemptedRef.current.add(attemptKey);
            void draftSteps(line.key, line.description, line.category);
        }
    }, [lines]); // eslint-disable-line react-hooks/exhaustive-deps

    // Survey auto-suggestion, from the same scope-risk read the builder uses.
    const scopeRisk = useMemo(() => assessScopeRisk(
        lines.map((l) => ({
            description: l.description,
            category: (l.category ?? 'general_fixing') as any,
            source: 'custom' as const,
            estimatedMinutes: l.estimatedMinutes ?? 0,
            materialsCostPounds: materialsCostPence(l.materials) / 100,
        })),
        priced?.totalPence ?? 0,
    ), [lines, priced?.totalPence]);

    // A field is "waiting" when neither the agent nor Ben has it.
    const waitingOn = [
        !customerName.trim() ? 'name' : null,
        !postcode.trim() ? 'postcode' : null,
    ].filter((f): f is string => !!f);

    const askCustomer = useMutation({
        mutationFn: async () => {
            const res = await fetch(`/api/agents/quote-prep/${conversation.id}/request-details`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
                body: JSON.stringify({ fields: waitingOn }),
            });
            const detail = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(detail.error || 'Could not queue the ask');
            return detail as { queued: boolean; draftId: string | null };
        },
        onSuccess: () => { setCardError(null); onRefresh(); },
        onError: (e: Error) => setCardError(e.message),
    });

    /** One customer-audience gap, queued as an approval draft in the brand voice. Nothing sends. */
    const askGap = useMutation({
        mutationFn: async ({ index }: { index: number }) => {
            const res = await fetch(`/api/agents/quote-prep/${conversation.id}/request-details`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
                body: JSON.stringify({ question: gaps[index].question }),
            });
            const detail = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(detail.error || 'Could not queue the ask');
            return { index, ...(detail as { queued: boolean; draftId: string | null }) };
        },
        onSuccess: ({ index }) => {
            setCardError(null);
            setAskedGaps((prev) => new Set(prev).add(index));
            onRefresh();
        },
        onError: (e: Error) => setCardError(e.message),
    });

    /**
     * Persists the quote through the builder's own creation path, always as an UNSENT draft —
     * the send flow flips it to non-draft only after the burst actually reaches the customer.
     * A re-run passes the saved quoteId so edits re-save in place (same slug, same link).
     * Carries everything the panel edits: materials, assumptions (per-line + quote-level),
     * signals, survey gate, crew/skin, extras, ticked media.
     */
    async function persistQuote(): Promise<{ slug: string; quoteId: string; total: string | null }> {
        const items = lines
            .filter((l) => l.category && (l.estimatedMinutes ?? 0) > 0 && l.description.trim());
        if (items.length === 0) throw new Error('No priceable job lines yet. Give the re-price a moment to classify them.');

        const photos = media.filter((m) => m.mediaUrl && ticked[m.mediaUrl] && !isVideo(m)).map((m) => m.mediaUrl!).slice(0, 10);
        const videos = media.filter((m) => m.mediaUrl && ticked[m.mediaUrl] && isVideo(m)).map((m) => m.mediaUrl!).slice(0, 5);
        const adminUser = JSON.parse(localStorage.getItem('adminUser') || '{}');
        const anyMaterials = items.some((l) => l.materials.length > 0);
        const cleanQuoteAssumptions = quoteAssumptions.map((a) => a.trim()).filter(Boolean);

        const res = await fetch('/api/pricing/create-contextual-quote', {
            method: 'POST', headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
            body: JSON.stringify({
                isDraft: true,
                ...(saved ? { quoteId: saved.quoteId } : {}),
                customerName: customerName.trim() || intake.customerName,
                phone: intake.phone,
                postcode: postcode.trim() || undefined,
                customerType,
                jobDescription: items.map((i) => i.description.trim()).join('; '),
                lines: items.map((l) => ({
                    id: l.key,
                    description: l.description.trim(),
                    ...(l.detail.trim() ? { details: l.detail.trim() } : {}),
                    category: l.category!,
                    estimatedMinutes: l.estimatedMinutes!,
                    materialsCostPence: materialsCostPence(l.materials),
                    ...(l.materials.length ? { materials: l.materials } : {}),
                    ...(l.priceOverridePence != null ? { priceOverridePence: l.priceOverridePence } : {}),
                    ...(l.minutesEdited && l.priceOverridePence == null ? { priceFromTime: true } : {}),
                    ...(l.assumptions.filter((a) => a.trim()).length
                        ? { assumptions: l.assumptions.map((a) => a.trim()).filter(Boolean) }
                        : {}),
                    ...(l.scopeSteps.filter((s) => s.trim()).length
                        ? { scopeSteps: l.scopeSteps.map((s) => s.trim()).filter(Boolean) }
                        : {}),
                })),
                signals: {
                    urgency,
                    timeOfService,
                    materialsSupply: anyMaterials ? 'we_supply' : 'labor_only',
                },
                ...(cleanQuoteAssumptions.length ? { quoteAssumptions: cleanQuoteAssumptions } : {}),
                surveyRequired: surveyRequired || undefined,
                ...(surveyRequired && Number(surveyFeePounds) > 0
                    ? { surveyFeePence: Math.round(Number(surveyFeePounds) * 100) }
                    : {}),
                vertical,
                crewType,
                skinContractorId: skinContractorId || undefined,
                skinTeamId: crewType === 'team' ? (skinTeamId || undefined) : undefined,
                ...(optionalExtras.length
                    ? {
                        optionalExtras: optionalExtras.map((e) => ({
                            label: e.label,
                            description: e.description,
                            priceInPence: e.priceInPence,
                            ...(e.badge ? { badge: e.badge } : {}),
                        })),
                    }
                    : {}),
                vaContext: [
                    'Quote prepared from the comms thread (quote-prep agent intake).',
                    `Agent readiness: ${readinessUi.label}.`,
                    jobNotes.length ? `Ben answered: ${jobNotes.join('; ')}` : '',
                    unresolvedGaps.length
                        ? `Still unanswered: ${unresolvedGaps.map(({ g }) => g.question).join('; ')}`
                        : '',
                ].filter(Boolean).join(' ').slice(0, 2000),
                sourceChannel: 'whatsapp',
                ...(photos.length ? { customerPhotoUrls: photos } : {}),
                ...(videos.length ? { customerVideoUrls: videos } : {}),
                createdBy: adminUser?.id || undefined,
                createdByName: adminUser?.name || adminUser?.email || undefined,
            }),
        });
        const out = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(out.message || out.error || 'Could not save the quote');
        const result = { slug: out.shortSlug as string, quoteId: out.quoteId as string, total: out.pricing?.totalFormatted ?? null };
        setSaved(result);
        return result;
    }

    const saveDraft = useMutation({
        mutationFn: persistQuote,
        onSuccess: () => setCardError(null),
        onError: (e: Error) => setCardError(e.message),
    });

    // ── "Nothing missed?" checklist ──
    // Saving or sending with questions still open is exactly how a quote goes out half-scoped,
    // so the open ones get put in front of Ben first. He can still proceed: this is a checklist,
    // not a lock.
    const [checklistFor, setChecklistFor] = useState<'save' | 'send' | null>(null);
    const requestSave = () => (unresolvedGaps.length ? setChecklistFor('save') : saveDraft.mutate());
    const requestSend = () => (unresolvedGaps.length ? setChecklistFor('send') : void beginSend());
    const proceedAnyway = () => {
        const action = checklistFor;
        setChecklistFor(null);
        if (action === 'save') saveDraft.mutate();
        if (action === 'send') void beginSend();
    };

    // ── Send flow ──
    // Send quote = persist (as draft) → agent drafts the delivery burst → SEND, one motion.
    // The edit-then-send review step was removed 20 Aug 2026 at the owner's call: the generated
    // message is the approved builder copy, so a second look was pure friction. The review UI
    // remains only as the FAILURE fallback — a send that errors drops Ben into the editable
    // message instead of losing it. On success the sheet closes itself back to comms.
    type SendPhase = 'idle' | 'preparing' | 'review' | 'sending' | 'sent' | 'queued';
    const [sendPhase, setSendPhase] = useState<SendPhase>('idle');
    const [sendMessage, setSendMessage] = useState('');
    const [sendInfo, setSendInfo] = useState<string | null>(null);
    const [windowOpenHint, setWindowOpenHint] = useState<boolean | null>(null);
    const [sendStyle, setSendStyle] = useState<string>('');
    const [redrafting, setRedrafting] = useState(false);

    /** Fetches the builder-generated message for the saved quote. No style = server auto-picks
     *  from the quote's customerType; an explicit style is the dropdown override. */
    async function draftMessage(slug: string, style?: string): Promise<string> {
        const res = await fetch(`/api/agents/quote-prep/${conversation.id}/draft-send-message`, {
            method: 'POST', headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
            body: JSON.stringify({ slug, ...(style ? { messageStyle: style } : {}) }),
        });
        const detail = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(detail.message || detail.error || 'Could not draft the message');
        setSendMessage(detail.body);
        setWindowOpenHint(detail.windowOpen ?? null);
        setSendStyle(detail.styleUsed || '');
        return detail.body as string;
    }

    async function beginSend() {
        setCardError(null);
        setSendPhase('preparing');
        try {
            const q = await persistQuote();
            const body = await draftMessage(q.slug);
            await sendNow(q.slug, body);
        } catch (e: any) {
            setCardError(e.message);
            setSendPhase('idle');
        }
    }

    /** Style override: re-drafts the whole message in the new style (edits are replaced —
     *  the generator, not the textarea, is the source of the base copy). */
    async function changeStyle(style: string) {
        if (!saved || redrafting) return;
        setRedrafting(true);
        setCardError(null);
        try {
            await draftMessage(saved.slug, style);
        } catch (e: any) {
            setCardError(e.message);
        } finally {
            setRedrafting(false);
        }
    }

    /** The actual send. On success the sheet shows the confirmation for a beat and closes itself
     *  back to comms; on failure it drops into the review UI with the message intact, which is the
     *  only time Ben sees the edit step at all. */
    async function sendNow(slug: string, body: string) {
        setCardError(null);
        setSendPhase('sending');
        try {
            const res = await fetch(`/api/agents/quote-prep/${conversation.id}/send-quote`, {
                method: 'POST', headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
                body: JSON.stringify({ slug, body }),
            });
            const detail = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(detail.message || detail.error || 'Send failed');
            if (detail.queued) {
                setSendInfo(detail.message ?? 'Window shut, queued for approval when the window reopens.');
                setSendPhase('queued');
            } else {
                if (detail.partial) setSendInfo(detail.message ?? null);
                setSendPhase('sent');
                setTimeout(() => onOpenChange(false), 1400);
            }
            onRefresh();
        } catch (e: any) {
            setCardError(e.message);
            setSendPhase('review');
        }
    }

    /** Only reachable from the failure-fallback review UI. */
    async function confirmSend() {
        if (!saved) return;
        await sendNow(saved.slug, sendMessage);
    }

    const linkPresent = !!saved && sendMessage.includes(`/quote/${saved.slug}`);
    // Panel edits are frozen once a send is under way — the persisted quote must match the panel.
    const editingLocked = sendPhase !== 'idle';
    const hasName = !!(customerName.trim() || intake.customerName);

    const openFullBuilder = () => {
        // Same handoff the old flow used — the builder's prefill effect consumes it.
        sessionStorage.setItem('quoteFromComms', JSON.stringify({ ...intake, customerType }));
        window.location.href = '/admin/generate-contextual-quote';
    };

    const sectionTitle = (label: string) => (
        <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{label}</p>
    );

    return (
        <Sheet open={open} onOpenChange={onOpenChange}>
            <SheetContent
                side="right"
                className="flex w-full max-w-full flex-col gap-0 p-0 sm:max-w-[620px] lg:max-w-[720px]"
                // Keep the customer thread one click back, not one accidental click away:
                // clicking the dimmed thread closes the panel (state survives, reopen chip stays).
                // Esc with the lightbox up shuts the lightbox, not the whole panel.
                onEscapeKeyDown={(e) => {
                    if (lightboxIndex != null) { e.preventDefault(); setLightboxIndex(null); }
                }}
            >
                {/* 44px close for thumbs — sits over the built-in 16px close on phones. */}
                <button
                    type="button"
                    onClick={() => onOpenChange(false)}
                    aria-label="Close quote prep"
                    className="absolute right-1 top-1 z-20 flex h-11 w-11 items-center justify-center rounded-lg text-slate-500 hover:text-slate-900 sm:hidden"
                >
                    <X className="h-5 w-5" />
                </button>

                {/* ── Header: who + where + type + waiting chips ── */}
                <div className="border-b border-slate-200 px-4 py-3">
                    <div className="flex flex-wrap items-center gap-1.5 pr-10 sm:pr-8">
                        <FileText className="h-4 w-4 text-slate-700" />
                        <SheetTitle className="text-sm font-bold uppercase tracking-wide text-slate-900">
                            Quote prep — review &amp; send
                        </SheetTitle>
                        {/* The verdict, loud: it decides whether Ben prices this at all. */}
                        <span className={cn('rounded px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide', readinessUi.chip)}>
                            {readinessUi.label}
                        </span>
                        {intake.urgency === 'high' && (
                            <span className="rounded bg-red-600 px-1.5 py-0.5 text-[9px] font-bold uppercase text-white">Urgent</span>
                        )}
                    </div>
                    <SheetDescription className="sr-only">
                        Review the agent's intake, edit every quote detail, then save a draft or send.
                    </SheetDescription>

                    <div className="mt-2 grid grid-cols-1 gap-2 text-xs sm:grid-cols-3">
                        <div>
                            <p className="text-[10px] font-semibold uppercase text-slate-400">Name</p>
                            <input
                                value={customerName}
                                onChange={(e) => setCustomerName(e.target.value)}
                                disabled={editingLocked}
                                placeholder="waiting on name"
                                className={cn(
                                    'w-full rounded border border-slate-200 px-1.5 py-1 text-xs font-medium focus:border-slate-500 focus:outline-none disabled:bg-slate-50',
                                    customerName.trim() ? 'text-slate-900' : 'placeholder:text-amber-700',
                                )}
                            />
                        </div>
                        <div>
                            <p className="text-[10px] font-semibold uppercase text-slate-400">Postcode</p>
                            <input
                                value={postcode}
                                onChange={(e) => setPostcode(e.target.value.toUpperCase())}
                                disabled={editingLocked}
                                placeholder="waiting on postcode"
                                className={cn(
                                    'w-full rounded border border-slate-200 px-1.5 py-1 text-xs font-medium uppercase focus:border-slate-500 focus:outline-none disabled:bg-slate-50',
                                    postcode.trim() ? 'text-slate-900' : 'placeholder:text-amber-700',
                                )}
                            />
                        </div>
                        <div>
                            <p className="text-[10px] font-semibold uppercase text-slate-400">Customer type</p>
                            <select
                                value={customerType}
                                onChange={(e) => setCustomerType(e.target.value)}
                                disabled={editingLocked}
                                className="w-full rounded border border-slate-300 px-1 py-1 text-xs focus:border-slate-500 focus:outline-none disabled:bg-slate-50"
                            >
                                {CUSTOMER_TYPE_OPTIONS.map((o) => (
                                    <option key={o.value} value={o.value}>{o.label}</option>
                                ))}
                            </select>
                        </div>
                    </div>

                    {waitingOn.length > 0 && (
                        <div className="mt-2 flex items-center justify-between gap-2 rounded-lg bg-amber-50 px-2.5 py-2 text-xs text-amber-800">
                            <span className="flex items-center gap-1.5">
                                <Clock className="h-3.5 w-3.5 shrink-0" />
                                Waiting on {waitingOn.join(' and ')}
                            </span>
                            <button
                                onClick={() => askCustomer.mutate()}
                                disabled={askCustomer.isPending || askCustomer.isSuccess}
                                className="shrink-0 rounded bg-amber-600 px-2 py-1 text-[10px] font-bold uppercase text-white hover:bg-amber-700 disabled:opacity-60"
                            >
                                {askCustomer.isPending ? 'Queueing…'
                                    : askCustomer.isSuccess
                                        ? (askCustomer.data?.queued ? 'Ask queued for approval' : 'Already queued')
                                        : 'Ask the customer'}
                            </button>
                        </div>
                    )}
                </div>

                {/* ── Sticky tabs: Quote | Thread | Media ── */}
                <div className="flex flex-none border-b border-slate-200 bg-white">
                    {([
                        { id: 'quote' as const, label: 'Quote', icon: FileText },
                        { id: 'thread' as const, label: 'Thread', icon: MessageSquare },
                        { id: 'media' as const, label: media.length ? `Media ${tickedCount}/${media.length}` : 'Media', icon: ImageIcon },
                    ]).map((t) => (
                        <button
                            key={t.id}
                            type="button"
                            onClick={() => switchTab(t.id)}
                            className={cn(
                                'flex min-h-[44px] flex-1 items-center justify-center gap-1.5 border-b-2 px-2 text-[11px] font-bold uppercase tracking-wide transition-colors',
                                tab === t.id
                                    ? 'border-slate-900 text-slate-900'
                                    : 'border-transparent text-slate-400 hover:text-slate-600',
                            )}
                        >
                            <t.icon className="h-3.5 w-3.5" /> {t.label}
                        </button>
                    ))}
                </div>

                {/* ── Quote tab — scrollable body, full builder parity ── */}
                <div className={cn('flex-1 space-y-4 overflow-y-auto bg-slate-50 p-4', tab !== 'quote' && 'hidden')}>
                    {/* Sticky jump bar — hop straight to a line when there are several. */}
                    {lines.length >= 2 && (
                        <div className="sticky top-0 z-20 -mx-4 -mt-4 flex items-center gap-1.5 overflow-x-auto border-b border-slate-200 bg-white/95 px-4 py-1.5 backdrop-blur">
                            <span className="shrink-0 text-[10px] font-bold uppercase tracking-wide text-slate-400">Lines</span>
                            {lines.map((l, i) => (
                                <button
                                    key={l.key}
                                    type="button"
                                    onClick={() => lineRefs.current[l.key]?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
                                    title={l.description.trim() || `Line ${i + 1}`}
                                    className="flex h-9 shrink-0 items-center gap-1 rounded-full border border-slate-300 bg-white px-3 text-[11px] font-semibold text-slate-600 hover:border-slate-500"
                                >
                                    <span className="tabular-nums">{i + 1}</span>
                                    <span className="max-w-[90px] truncate">{l.description.trim() || 'untitled'}</span>
                                </button>
                            ))}
                        </div>
                    )}
                    {/* The readiness verdict and the questions behind it. Customer questions
                        queue an approval draft; Ben's questions he answers right here, and the
                        answer lands on the line it belongs to. */}
                    <div className={cn('rounded-lg border p-3', readinessUi.card)}>
                        <div className="flex items-center gap-2">
                            <span className={cn('rounded px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide', readinessUi.chip)}>
                                {readinessUi.label}
                            </span>
                            <p className="text-[11px] font-medium">{readinessUi.blurb}</p>
                        </div>

                        {/* Shadow readiness — the computed confidence gate, advisory while the
                            clerk's verdict above still decides. Score ring + slot provenance +
                            the sceptic's verdict when the score landed in the grey band. */}
                        {intake.shadow && (
                            <div className="mt-2 rounded-lg border border-slate-200 bg-white/80 p-2.5">
                                <div className="flex items-center gap-3">
                                    <div className="relative h-11 w-11 shrink-0">
                                        <svg viewBox="0 0 44 44" className="h-11 w-11 -rotate-90">
                                            <circle cx="22" cy="22" r="18" fill="none" strokeWidth="4" className="stroke-slate-200" />
                                            <circle
                                                cx="22" cy="22" r="18" fill="none" strokeWidth="4" strokeLinecap="round"
                                                strokeDasharray={`${(intake.shadow.score / 100) * 113.1} 113.1`}
                                                className={cn(
                                                    intake.shadow.band === 'build' ? 'stroke-emerald-500'
                                                        : intake.shadow.band === 'grey' ? 'stroke-amber-500' : 'stroke-red-400',
                                                )}
                                            />
                                        </svg>
                                        <span className="absolute inset-0 flex items-center justify-center text-[13px] font-bold tabular-nums text-slate-800">
                                            {intake.shadow.score}
                                        </span>
                                    </div>
                                    <div className="min-w-0 text-[11px] leading-snug">
                                        <p className="font-semibold text-slate-700">
                                            Confidence {intake.shadow.band === 'build' ? 'would build now' : intake.shadow.band === 'grey' ? 'grey zone' : 'would ask first'}
                                            {!intake.shadow.agrees && (
                                                <span className="ml-1.5 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold uppercase text-amber-800">disagrees with clerk</span>
                                            )}
                                        </p>
                                        <p className="text-slate-500">
                                            {intake.shadow.wouldAskCount} would ask · {intake.shadow.wouldAssumeCount} would assume · shadow only, verdict above decides
                                        </p>
                                    </div>
                                </div>
                                <div className="mt-2 flex flex-wrap gap-1">
                                    {intake.shadow.slots.slice(0, 8).map((s, i) => (
                                        <span
                                            key={i}
                                            title={s.note}
                                            className={cn(
                                                'rounded px-1.5 py-0.5 text-[10px] font-semibold',
                                                s.state === 'confirmed' ? 'bg-emerald-50 text-emerald-700'
                                                    : s.state === 'assumed' ? 'bg-amber-50 text-amber-800' : 'bg-red-50 text-red-700',
                                            )}
                                        >
                                            {s.label}: {s.state}
                                        </span>
                                    ))}
                                </div>
                                {intake.shadow.verifier && !intake.shadow.verifier.priceable && (
                                    <p className="mt-2 rounded bg-blue-50 px-2 py-1.5 text-[11px] text-blue-900">
                                        <span className="font-bold">Verifier:</span> {intake.shadow.verifier.blocker}
                                        {intake.shadow.verifier.suggestedAsk && (
                                            <> — suggested ask: “{intake.shadow.verifier.suggestedAsk}”</>
                                        )}
                                    </p>
                                )}
                            </div>
                        )}

                        {readiness === 'visit_first' && (
                            <p className="mt-2 rounded bg-white/70 px-2 py-1.5 text-[11px] font-semibold">
                                Survey gate switched on below. Price the visit, send that, and quote the work once we've seen it.
                            </p>
                        )}

                        {gaps.length > 0 && (
                            <div className="mt-2 space-y-1.5">
                                {gaps.map((gap, i) => {
                                    const resolved = gapResolved(i);
                                    const lineLabel = gap.lineIndex ? `line ${gap.lineIndex}` : 'whole job';
                                    if (gap.audience === 'customer') {
                                        return (
                                            <div key={i} className="flex items-start justify-between gap-2 rounded-lg bg-white px-2.5 py-2">
                                                <div className="min-w-0">
                                                    <p className="text-xs font-medium text-slate-800">{gap.question}</p>
                                                    <p className="text-[10px] uppercase tracking-wide text-slate-400">Customer · {lineLabel}</p>
                                                </div>
                                                <button
                                                    onClick={() => askGap.mutate({ index: i })}
                                                    disabled={resolved || (askGap.isPending && askGap.variables?.index === i)}
                                                    className="shrink-0 rounded bg-amber-600 px-2 py-1 text-[10px] font-bold uppercase text-white hover:bg-amber-700 disabled:opacity-60"
                                                >
                                                    {resolved
                                                        ? 'Ask queued'
                                                        : askGap.isPending && askGap.variables?.index === i ? 'Queueing…' : 'Ask customer'}
                                                </button>
                                            </div>
                                        );
                                    }
                                    return (
                                        <div key={i} className="rounded-lg bg-white px-2.5 py-2">
                                            <button
                                                onClick={() => {
                                                    setOpenGap(openGap === i ? null : i);
                                                    setGapDraft(gapAnswers[i] ?? '');
                                                }}
                                                className="flex w-full items-start justify-between gap-2 text-left"
                                            >
                                                <div className="min-w-0">
                                                    <p className="text-xs font-medium text-slate-800">{gap.question}</p>
                                                    <p className="text-[10px] uppercase tracking-wide text-slate-400">
                                                        Ben · {lineLabel}{resolved ? ' · answered' : ''}
                                                    </p>
                                                </div>
                                                {resolved
                                                    ? <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" />
                                                    : <ChevronRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" />}
                                            </button>
                                            {resolved && openGap !== i && (
                                                <p className="mt-1 text-[11px] italic text-slate-500">{gapAnswers[i]}</p>
                                            )}
                                            {openGap === i && (
                                                <div className="mt-1.5 flex items-center gap-1.5">
                                                    <input
                                                        value={gapDraft}
                                                        autoFocus
                                                        onChange={(e) => setGapDraft(e.target.value)}
                                                        onKeyDown={(e) => { if (e.key === 'Enter') answerGap(i, gapDraft); }}
                                                        placeholder="Answer it, goes on the line's detail"
                                                        className="h-7 min-w-0 flex-1 rounded border border-slate-300 px-1.5 text-xs focus:border-slate-500 focus:outline-none"
                                                    />
                                                    <button
                                                        onClick={() => answerGap(i, gapDraft)}
                                                        disabled={!gapDraft.trim()}
                                                        className="shrink-0 rounded bg-slate-900 px-2 py-1 text-[10px] font-bold uppercase text-white hover:bg-slate-700 disabled:opacity-40"
                                                    >
                                                        Save
                                                    </button>
                                                </div>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>

                    {/* Job lines, each with materials / assumptions / steps */}
                    <div className="rounded-lg border border-slate-200 bg-white p-3">
                        <div className="flex items-center justify-between">
                            {sectionTitle('Job lines')}
                            <button
                                onClick={polishAll}
                                disabled={editingLocked || polishingKeys.size > 0 || !lines.some((l) => l.description.trim())}
                                title="Rewrite every line title in customer-facing wording (still editable after)"
                                className="flex items-center gap-1 text-[10px] font-semibold text-slate-500 hover:text-violet-600 disabled:opacity-40"
                            >
                                <Sparkles className="h-3 w-3" /> Polish all
                            </button>
                        </div>
                        <div className="mt-2 space-y-2">
                            {lines.map((line, i) => {
                                const matKey = `${line.key}:materials`;
                                const assKey = `${line.key}:assumptions`;
                                const stepKey = `${line.key}:steps`;
                                const detKey = `${line.key}:detail`;
                                const matCost = materialsCostPence(line.materials);
                                return (
                                    <div
                                        key={line.key}
                                        ref={(el) => { lineRefs.current[line.key] = el; }}
                                        className="scroll-mt-14 rounded-lg border border-slate-200 p-2"
                                    >
                                        <div className="flex items-center gap-1.5">
                                            <span className="w-4 shrink-0 text-right text-[10px] tabular-nums text-slate-400">{i + 1}.</span>
                                            <input
                                                value={line.description}
                                                onChange={(e) =>
                                                    // Rewording a line sends it back through the parser so its
                                                    // category and minutes match the new description.
                                                    updateLine(line.key, { description: e.target.value, category: null, estimatedMinutes: null })}
                                                disabled={editingLocked}
                                                placeholder="Describe the work…"
                                                className="min-w-0 flex-1 rounded border border-slate-200 px-1.5 py-1 text-xs text-slate-800 focus:border-slate-500 focus:outline-none disabled:bg-slate-50 disabled:text-slate-400"
                                            />
                                            <button
                                                onClick={() => void polishLine(line.key)}
                                                disabled={editingLocked || !line.description.trim() || polishingKeys.has(line.key)}
                                                title="Polish the wording (customer-facing rewrite — still editable after)"
                                                className="shrink-0 text-slate-300 hover:text-violet-600 disabled:opacity-30"
                                            >
                                                {polishingKeys.has(line.key)
                                                    ? <Loader2 className="h-3.5 w-3.5 animate-spin text-violet-500" />
                                                    : <Sparkles className="h-3.5 w-3.5" />}
                                            </button>
                                            {/* Labour £ for the line. Blank = engine's price (shown as
                                                placeholder). Typing a figure PINS the line: the engine
                                                applies it verbatim and stops re-pricing it. Clear to unpin. */}
                                            <div className="relative w-20 shrink-0">
                                                {line.priceOverridePence != null && (
                                                    <Pin className="pointer-events-none absolute left-1 top-1/2 h-3 w-3 -translate-y-1/2 text-amber-500" />
                                                )}
                                                <input
                                                    inputMode="decimal"
                                                    value={priceDrafts[line.key] ?? (line.priceOverridePence != null ? String(line.priceOverridePence / 100) : '')}
                                                    placeholder={priced?.perLine.has(line.key) ? formatPence(priced.perLine.get(line.key)!) : '…'}
                                                    disabled={editingLocked}
                                                    title="Labour price. Typing pins this line (engine stops touching it); clear to hand it back. Materials margin adds on top."
                                                    onChange={(e) => {
                                                        const raw = e.target.value;
                                                        setPriceDrafts((prev) => ({ ...prev, [line.key]: raw }));
                                                        const pounds = parseFloat(raw.replace(/[£,\s]/g, ''));
                                                        updateLine(line.key, {
                                                            priceOverridePence: Number.isFinite(pounds) && pounds > 0 ? Math.round(pounds * 100) : null,
                                                        });
                                                    }}
                                                    onBlur={() => setPriceDrafts((prev) => { const n = { ...prev }; delete n[line.key]; return n; })}
                                                    className={cn(
                                                        'h-6 w-full rounded border px-1 pl-4 text-right text-[11px] font-semibold tabular-nums focus:outline-none disabled:bg-slate-50',
                                                        line.priceOverridePence != null
                                                            ? 'border-amber-400 bg-amber-50 text-amber-900 focus:border-amber-500'
                                                            : 'border-slate-200 text-slate-600 focus:border-slate-500',
                                                    )}
                                                />
                                            </div>
                                            <button
                                                onClick={() => setLines((prev) => prev.filter((l) => l.key !== line.key))}
                                                disabled={editingLocked || lines.length <= 1}
                                                title="Remove line"
                                                className="flex h-11 w-11 shrink-0 items-center justify-center text-slate-300 hover:text-red-600 disabled:opacity-30 sm:h-auto sm:w-auto"
                                            >
                                                <X className="h-3.5 w-3.5" />
                                            </button>
                                        </div>

                                        {/* Per-line controls: category / minutes, then the section toggles */}
                                        <div className="mt-1.5 flex flex-wrap items-center gap-1.5 pl-5">
                                            {/* Category drives the rate; "Auto" hands it back to the parser. */}
                                            <select
                                                value={line.category ?? ''}
                                                disabled={editingLocked}
                                                title="Job category — sets the rate this line is priced at"
                                                onChange={(e) => updateLine(line.key, { category: e.target.value || null })}
                                                className="h-6 max-w-[130px] rounded border border-slate-200 bg-white px-1 text-[10px] font-semibold text-slate-600 focus:border-slate-500 focus:outline-none disabled:bg-slate-50"
                                            >
                                                <option value="">{line.description.trim() ? 'Auto…' : 'Category'}</option>
                                                {CATEGORY_OPTIONS.map((o) => (
                                                    <option key={o.value} value={o.value}>{o.label}</option>
                                                ))}
                                            </select>
                                            {/* Time is the engine's input: pick a duration and the £ recomputes.
                                                Steps are how jobs are actually sized — hours and days, not raw
                                                minutes. A parser estimate off the grid shows as its own option. */}
                                            <select
                                                value={line.estimatedMinutes ?? ''}
                                                disabled={editingLocked}
                                                title="Estimated labour time — the engine prices from this"
                                                onChange={(e) => {
                                                    const n = parseInt(e.target.value, 10);
                                                    updateLine(line.key, {
                                                        estimatedMinutes: Number.isFinite(n) && n > 0 ? n : null,
                                                        minutesEdited: true,
                                                    });
                                                }}
                                                className="h-6 rounded border border-slate-200 bg-white px-1 text-[10px] font-semibold tabular-nums text-slate-600 focus:border-slate-500 focus:outline-none disabled:bg-slate-50"
                                            >
                                                {line.estimatedMinutes == null && <option value="">time…</option>}
                                                {line.estimatedMinutes != null
                                                    && !DURATION_OPTIONS.some((o) => o.value === line.estimatedMinutes)
                                                    && <option value={line.estimatedMinutes}>{durationLabel(line.estimatedMinutes)}</option>}
                                                {DURATION_OPTIONS.map((o) => (
                                                    <option key={o.value} value={o.value}>{o.label}</option>
                                                ))}
                                            </select>
                                            {([
                                                { key: detKey, label: line.detail.trim() ? 'Detail ✓' : 'Detail' },
                                                { key: matKey, label: `Materials${line.materials.length ? ` (${line.materials.length} · ${formatPence(matCost)})` : ''}` },
                                                { key: assKey, label: `Assumptions${line.assumptions.length ? ` (${line.assumptions.length})` : ''}` },
                                                {
                                                    key: stepKey,
                                                    label: draftingStepsKeys.has(line.key)
                                                        ? 'Steps drafting…'
                                                        : `Steps${line.scopeSteps.length ? ` (${line.scopeSteps.length})` : ''}`,
                                                },
                                            ] as const).map((t) => (
                                                <button
                                                    key={t.key}
                                                    onClick={() => toggleSection(t.key)}
                                                    disabled={editingLocked}
                                                    className={cn(
                                                        'flex min-h-[44px] items-center gap-0.5 rounded-full border px-3 py-0.5 text-[10px] font-semibold transition-colors disabled:opacity-40 sm:min-h-0 sm:px-2',
                                                        openSections.has(t.key)
                                                            ? 'border-slate-900 bg-slate-900 text-white'
                                                            : 'border-slate-300 text-slate-600 hover:border-slate-500',
                                                    )}
                                                >
                                                    {openSections.has(t.key) ? <ChevronDown className="h-2.5 w-2.5" /> : <ChevronRight className="h-2.5 w-2.5" />}
                                                    {t.label}
                                                </button>
                                            ))}
                                        </div>

                                        {/* The agent's evidence for this line, plus anything Ben
                                            answered on a clarify chip. Internal: it rides the
                                            quote as the line's `details`, not as customer copy. */}
                                        {openSections.has(detKey) && !editingLocked && (
                                            <div className="mt-1.5 pl-5">
                                                <textarea
                                                    value={line.detail}
                                                    onChange={(e) => updateLine(line.key, { detail: e.target.value })}
                                                    rows={Math.min(6, Math.max(2, line.detail.split('\n').length + 1))}
                                                    placeholder="What the photos and messages actually show (internal)"
                                                    className="w-full rounded border border-slate-200 bg-slate-50/60 px-1.5 py-1 text-[11px] text-slate-700 focus:border-slate-500 focus:outline-none"
                                                />
                                            </div>
                                        )}

                                        {openSections.has(matKey) && !editingLocked && (
                                            <div className="mt-2 pl-5">
                                                {/* The builder's own picker: catalog + live Screwfix search;
                                                    the picked list drives the line's materials cost, which the
                                                    re-price effect feeds straight into the engine total above. */}
                                                <MaterialsPicker
                                                    materials={line.materials}
                                                    onChange={(materials) => updateLine(line.key, { materials })}
                                                />
                                            </div>
                                        )}

                                        {openSections.has(assKey) && !editingLocked && (
                                            <div className="mt-1 pl-5">
                                                <LineAssumptionsEditor
                                                    assumptions={line.assumptions}
                                                    category={line.category}
                                                    description={line.description}
                                                    onChange={(assumptions) => updateLine(line.key, { assumptions })}
                                                />
                                            </div>
                                        )}

                                        {openSections.has(stepKey) && !editingLocked && (
                                            <div className="mt-2 space-y-1 pl-5">
                                                {line.scopeSteps.length === 0 && line.category && (
                                                    <button
                                                        onClick={() => void draftSteps(line.key, line.description, line.category!)}
                                                        disabled={draftingStepsKeys.has(line.key) || !line.description.trim()}
                                                        className="flex items-center gap-1 text-[11px] font-medium text-slate-500 hover:text-slate-900 disabled:opacity-40"
                                                    >
                                                        {draftingStepsKeys.has(line.key)
                                                            ? <><Loader2 className="h-3 w-3 animate-spin" /> Drafting steps…</>
                                                            : 'Draft steps from the line'}
                                                    </button>
                                                )}
                                                {line.scopeSteps.map((step, idx) => (
                                                    <div key={idx} className="flex items-center gap-1">
                                                        <input
                                                            value={step}
                                                            placeholder="Head — short detail"
                                                            onChange={(e) => {
                                                                const next = [...line.scopeSteps];
                                                                next[idx] = e.target.value;
                                                                updateLine(line.key, { scopeSteps: next });
                                                            }}
                                                            className="h-7 min-w-0 flex-1 rounded border border-slate-200 px-1.5 text-xs focus:border-slate-500 focus:outline-none"
                                                        />
                                                        <button
                                                            onClick={() => updateLine(line.key, { scopeSteps: line.scopeSteps.filter((_, j) => j !== idx) })}
                                                            className="flex h-11 w-11 shrink-0 items-center justify-center text-slate-300 hover:text-red-600 sm:h-auto sm:w-auto"
                                                            aria-label="Remove step"
                                                        >
                                                            <X className="h-3.5 w-3.5" />
                                                        </button>
                                                    </div>
                                                ))}
                                                {line.scopeSteps.length < 6 && (
                                                    <button
                                                        onClick={() => updateLine(line.key, { scopeSteps: [...line.scopeSteps, ''] })}
                                                        className="flex items-center gap-1 text-[11px] text-slate-500 hover:text-slate-900"
                                                    >
                                                        <Plus className="h-3 w-3" /> Add step
                                                    </button>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                        <div className="mt-2 flex items-center justify-between pl-5">
                            <button
                                onClick={() => setLines((prev) => [...prev, {
                                    key: `prep_add_${nextLineKeyRef.current++}`, description: '', detail: '', category: null,
                                    estimatedMinutes: null, minutesEdited: false, priceOverridePence: null,
                                    materials: [], assumptions: [], scopeSteps: [],
                                }])}
                                disabled={editingLocked}
                                className="text-[11px] font-semibold text-slate-500 hover:text-slate-900 disabled:opacity-40"
                            >
                                + Add line
                            </button>
                            <div className="flex items-center gap-1.5 text-xs">
                                {pricingBusy && <Loader2 className="h-3 w-3 animate-spin text-slate-400" />}
                                {priced && priced.materialsPence > 0 && (
                                    <span className="text-[10px] text-slate-400">incl. {formatPence(priced.materialsPence)} materials</span>
                                )}
                                <span className="text-[10px] font-semibold uppercase text-slate-400">Engine total</span>
                                <span className="text-sm font-bold tabular-nums text-slate-900">
                                    {priced ? formatPence(priced.totalPence) : '—'}
                                </span>
                            </div>
                        </div>
                    </div>

                    {/* Quote-level assumptions — the agent's caveats that fit no single line,
                        saved onto the quote. Replaces the old italic "Price will assume" note. */}
                    <div className="rounded-lg border border-slate-200 bg-white p-3">
                        {sectionTitle('Quote assumptions')}
                        <p className="mt-0.5 text-[11px] text-slate-500">
                            From the agent's read of the thread. Line-specific ones already sit under their line above; these apply to the whole quote. Prune before sending.
                        </p>
                        <div className="mt-2 space-y-1">
                            {quoteAssumptions.length === 0 && (
                                <p className="text-[11px] italic text-slate-400">None. Anything the price relies on can be added here.</p>
                            )}
                            {quoteAssumptions.map((a, idx) => (
                                <div key={idx} className="flex items-center gap-1">
                                    <input
                                        value={a}
                                        disabled={editingLocked}
                                        placeholder="e.g. clear access to the work area on the day"
                                        onChange={(e) => setQuoteAssumptions((prev) => prev.map((x, j) => (j === idx ? e.target.value : x)))}
                                        className="h-7 min-w-0 flex-1 rounded border border-amber-200 bg-amber-50/40 px-1.5 text-xs focus:border-amber-400 focus:outline-none disabled:bg-slate-50"
                                    />
                                    <button
                                        onClick={() => setQuoteAssumptions((prev) => prev.filter((_, j) => j !== idx))}
                                        disabled={editingLocked}
                                        className="flex h-11 w-11 shrink-0 items-center justify-center text-slate-300 hover:text-red-600 disabled:opacity-30 sm:h-auto sm:w-auto"
                                        aria-label="Remove assumption"
                                    >
                                        <X className="h-3.5 w-3.5" />
                                    </button>
                                </div>
                            ))}
                            {quoteAssumptions.length < 8 && !editingLocked && (
                                <button
                                    onClick={() => setQuoteAssumptions((prev) => [...prev, ''])}
                                    className="flex items-center gap-1 text-[11px] text-slate-500 hover:text-slate-900"
                                >
                                    <Plus className="h-3 w-3" /> Add assumption
                                </button>
                            )}
                        </div>
                    </div>

                    {/* Media tick summary — the full-size grid and lightbox live on the Media
                        tab; this keeps include/exclude visible (and tappable) in the form. */}
                    {media.length > 0 && (
                        <div className="rounded-lg border border-slate-200 bg-white p-3">
                            <div className="flex items-center justify-between">
                                {sectionTitle(`On the quote (${tickedCount}/${media.length} · tap to untick)`)}
                                <button
                                    type="button"
                                    onClick={() => switchTab('media')}
                                    className="flex min-h-[44px] items-center gap-1 text-[11px] font-semibold text-blue-700 hover:text-blue-900 sm:min-h-0"
                                >
                                    <ImageIcon className="h-3.5 w-3.5" /> View full-size
                                </button>
                            </div>
                            <div className="mt-1 flex flex-wrap gap-1.5">
                                {media.map((m) => (
                                    <button
                                        key={m.mediaUrl!}
                                        onClick={() => setTicked((t) => ({ ...t, [m.mediaUrl!]: !t[m.mediaUrl!] }))}
                                        disabled={editingLocked}
                                        className={cn(
                                            'relative h-11 w-11 overflow-hidden rounded-lg border-2',
                                            ticked[m.mediaUrl!] ? 'border-emerald-600' : 'border-slate-200 opacity-40',
                                        )}
                                        title={isVideo(m) ? 'Video' : 'Photo'}
                                    >
                                        {isVideo(m)
                                            ? <video src={m.mediaUrl!} preload="metadata" muted className="h-full w-full object-cover" />
                                            : <img src={m.mediaUrl!} alt="" loading="lazy" className="h-full w-full object-cover" />}
                                        {ticked[m.mediaUrl!] && (
                                            <span className="absolute right-0.5 top-0.5 rounded-full bg-emerald-600 p-0.5">
                                                <Check className="h-2.5 w-2.5 text-white" />
                                            </span>
                                        )}
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Scheduling signals: urgency, time of service, survey gate */}
                    <div className="rounded-lg border border-slate-200 bg-white p-3">
                        {sectionTitle('Scheduling signals')}
                        <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2">
                            <div>
                                <p className="mb-1 text-[10px] font-semibold uppercase text-slate-400">Urgency</p>
                                <div className="flex flex-col gap-1.5 sm:flex-row">
                                    {URGENCY_OPTIONS.map((o) => (
                                        <button
                                            key={o.value}
                                            onClick={() => setUrgency(o.value)}
                                            disabled={editingLocked}
                                            title={o.helper}
                                            className={cn(
                                                'min-h-[44px] w-full flex-1 rounded-lg border px-2 py-1.5 text-xs font-semibold transition-colors disabled:opacity-40 sm:min-h-0 sm:w-auto',
                                                urgency === o.value
                                                    ? 'border-slate-900 bg-slate-900 text-white'
                                                    : 'border-slate-300 bg-white text-slate-600 hover:border-slate-500',
                                            )}
                                        >
                                            {o.label}
                                        </button>
                                    ))}
                                </div>
                            </div>
                            <div>
                                <p className="mb-1 text-[10px] font-semibold uppercase text-slate-400">Time of service</p>
                                <div className="flex flex-col gap-1.5 sm:flex-row">
                                    {TIME_OF_SERVICE_OPTIONS.map((o) => (
                                        <button
                                            key={o.value}
                                            onClick={() => setTimeOfService(o.value)}
                                            disabled={editingLocked}
                                            className={cn(
                                                'min-h-[44px] w-full flex-1 rounded-lg border px-2 py-1.5 text-xs font-semibold transition-colors disabled:opacity-40 sm:min-h-0 sm:w-auto',
                                                timeOfService === o.value
                                                    ? 'border-slate-900 bg-slate-900 text-white'
                                                    : 'border-slate-300 bg-white text-slate-600 hover:border-slate-500',
                                            )}
                                        >
                                            {o.label}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        </div>
                        <div className="mt-3">
                            <SurveyGateCard
                                switchId="prep-survey-required"
                                surveyRequired={surveyRequired}
                                onSurveyRequiredChange={setSurveyRequired}
                                feePounds={surveyFeePounds}
                                onFeeChange={setSurveyFeePounds}
                                scopeRisk={scopeRisk}
                            />
                        </div>
                    </div>

                    {/* Crew & quote skin — the builder's picker, verbatim */}
                    <div className="rounded-lg border border-slate-200 bg-white p-3">
                        {sectionTitle('Crew & quote skin')}
                        <p className="mt-0.5 text-[11px] text-slate-500">
                            Solo or team decides the fulfilment pool. The skin decides whose face fronts the customer's quote page.
                        </p>
                        <div className="mt-2">
                            <CrewSkinPicker
                                vertical={vertical}
                                onVerticalChange={setVertical}
                                crewType={crewType}
                                onCrewTypeChange={setCrewType}
                                skinContractorId={skinContractorId}
                                onSkinContractorIdChange={setSkinContractorId}
                                skinTeamId={skinTeamId}
                                onSkinTeamIdChange={setSkinTeamId}
                                contractors={contractors}
                                teams={teams}
                            />
                        </div>
                    </div>

                    {/* Optional extras — the builder's catalog suggestions + custom */}
                    <div className="rounded-lg border border-slate-200 bg-white p-3">
                        {sectionTitle('Optional extras')}
                        <div className="mt-2">
                            <ExtrasEditor
                                categories={lines.map((l) => l.category).filter((c): c is string => !!c)}
                                value={optionalExtras}
                                onChange={setOptionalExtras}
                            />
                        </div>
                    </div>
                </div>

                {/* ── Thread tab — self-fetched conversation timeline, read-only ── */}
                <div className={cn('flex-1 overflow-y-auto bg-slate-50', tab !== 'thread' && 'hidden')}>
                    <PrepThreadTab
                        conversationId={conversation.id}
                        enabled={threadVisited}
                        active={tab === 'thread'}
                        onOpenMedia={openMediaByUrl}
                    />
                </div>

                {/* ── Media tab — tappable grid; ticks shared with the Quote tab summary ── */}
                <div className={cn('flex-1 overflow-y-auto bg-slate-50 p-3', tab !== 'media' && 'hidden')}>
                    {media.length > 0 && (
                        <p className="mb-2 text-[11px] text-slate-500">
                            Tap a photo or video to view it full-size. The tick decides whether it rides the quote.
                        </p>
                    )}
                    <PrepMediaGrid
                        media={media}
                        ticked={ticked}
                        onToggle={(url) => setTicked((t) => ({ ...t, [url]: !t[url] }))}
                        onOpen={setLightboxIndex}
                        disabled={editingLocked}
                    />
                </div>

                {/* ── Footer: errors, saved state, save / send (Quote tab only) ── */}
                <div className={cn('border-t border-slate-200 bg-white p-3', tab !== 'quote' && 'hidden')}>
                    {cardError && (
                        <div className="mb-2 flex items-start gap-2 rounded-lg bg-red-50 p-2 text-xs text-red-700">
                            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                            <span>{cardError}</span>
                        </div>
                    )}

                    {(sendPhase === 'review' || sendPhase === 'sending') ? (
                        /* Ben's approval gate: the agent-drafted burst, editable, with Send as the approval. */
                        <div className="rounded-lg border border-slate-300 bg-slate-50 p-2.5">
                            <div className="mb-1.5 flex items-center gap-2 text-[11px] font-bold uppercase text-slate-700">
                                <Bot className="h-3.5 w-3.5" /> Send hit a problem — check the message and retry
                                {windowOpenHint === false && (
                                    <span className="rounded bg-slate-700 px-1.5 py-0.5 text-[9px] text-white">window shut — template or queue</span>
                                )}
                                {/* Builder generator style — auto-picked from customer type, overridable.
                                    Changing it re-drafts (and replaces) the message below. */}
                                <span className="ml-auto flex items-center gap-1 normal-case">
                                    {redrafting && <Loader2 className="h-3 w-3 animate-spin text-slate-400" />}
                                    <select
                                        value={sendStyle}
                                        onChange={(e) => changeStyle(e.target.value)}
                                        disabled={sendPhase === 'sending' || redrafting}
                                        title="Message style (auto-picked from customer type). Changing it re-drafts the message."
                                        className="rounded border border-slate-300 bg-white px-1 py-0.5 text-[11px] font-medium text-slate-700 focus:border-slate-500 focus:outline-none disabled:opacity-50"
                                    >
                                        {MESSAGE_STYLE_OPTIONS.map((o) => (
                                            <option key={o.value} value={o.value}>{o.label}</option>
                                        ))}
                                    </select>
                                </span>
                            </div>
                            <textarea
                                value={sendMessage}
                                onChange={(e) => setSendMessage(e.target.value)}
                                disabled={sendPhase === 'sending' || redrafting}
                                rows={Math.min(10, Math.max(4, sendMessage.split('\n').length + 1))}
                                className="w-full rounded border border-slate-300 bg-white p-2 text-sm focus:border-slate-500 focus:outline-none disabled:bg-slate-100"
                            />
                            <p className="mt-1 text-[10px] text-slate-500">A line with only --- splits into separate WhatsApp messages.</p>
                            {!linkPresent && (
                                <p className="mt-1 text-[11px] font-semibold text-red-700">
                                    The quote link is missing. Put it back or the customer gets words with no quote.
                                </p>
                            )}
                            <div className="mt-2 flex items-center gap-2">
                                <button
                                    onClick={confirmSend}
                                    disabled={sendPhase === 'sending' || redrafting || !linkPresent || !sendMessage.trim()}
                                    className="flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-emerald-700 disabled:opacity-50"
                                >
                                    {sendPhase === 'sending' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                                    {sendPhase === 'sending' ? 'Sending…' : `Send quote${saved?.total ? ` (${saved.total})` : ''}`}
                                </button>
                                <button
                                    onClick={() => setSendPhase('idle')}
                                    disabled={sendPhase === 'sending'}
                                    className="rounded px-2 py-1.5 text-xs text-slate-500 hover:text-slate-800 disabled:opacity-40"
                                >
                                    Back
                                </button>
                            </div>
                        </div>
                    ) : sendPhase === 'sent' ? (
                        <div className="rounded-lg bg-emerald-600 px-3 py-2 text-xs text-white">
                            <p className="font-bold">
                                Quote sent{saved?.total ? ` at ${saved.total}` : ''}. Thread moved to Quote Sent.
                            </p>
                            {sendInfo && <p className="mt-0.5 font-medium text-emerald-100">{sendInfo}</p>}
                            {saved && (
                                <a href={`/quote/${saved.slug}`} target="_blank" rel="noreferrer" className="mt-1 inline-block font-semibold underline underline-offset-2">
                                    View what they received
                                </a>
                            )}
                        </div>
                    ) : sendPhase === 'queued' ? (
                        <div className="rounded-lg border-l-4 border-amber-500 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                            <p className="font-bold">Window shut — queued for approval when the window reopens.</p>
                            {sendInfo && <p className="mt-0.5">{sendInfo}</p>}
                        </div>
                    ) : checklistFor ? (
                        /* "Nothing missed?" — the open questions, one last time, before the
                           quote is priced and (maybe) sent. Proceeding is allowed; ignoring
                           them by accident is not. */
                        <div className="rounded-lg border border-amber-300 bg-amber-50 p-2.5">
                            <p className="text-xs font-bold uppercase tracking-wide text-amber-900">
                                Nothing missed? {unresolvedGaps.length} still open
                            </p>
                            <ul className="mt-1.5 space-y-1">
                                {unresolvedGaps.map(({ g, i }) => (
                                    <li key={i} className="flex items-start gap-1.5 text-[11px] text-amber-900">
                                        <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" />
                                        <span>
                                            {g.question}
                                            <span className="ml-1 text-[10px] uppercase text-amber-700">
                                                ({g.audience === 'customer' ? 'ask the customer' : 'Ben'})
                                            </span>
                                        </span>
                                    </li>
                                ))}
                            </ul>
                            <div className="mt-2 flex items-center gap-2">
                                <button
                                    onClick={() => setChecklistFor(null)}
                                    className="rounded-lg border border-amber-700 px-3 py-1.5 text-xs font-bold text-amber-900 hover:bg-amber-100"
                                >
                                    Go ask first
                                </button>
                                <button
                                    onClick={proceedAnyway}
                                    className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-bold text-white hover:bg-slate-700"
                                >
                                    {checklistFor === 'send' ? 'Send anyway' : 'Save draft anyway'}
                                </button>
                            </div>
                        </div>
                    ) : (
                        <>
                            {saved && (
                                <div className="mb-2 flex items-center justify-between gap-2 rounded-lg bg-emerald-50 px-2.5 py-2 text-xs text-emerald-800">
                                    <span className="font-medium">
                                        Draft saved{saved.total ? ` at ${saved.total}` : ''}. Nothing sent to the customer.
                                    </span>
                                    <a
                                        href={`/admin/quotes/${saved.slug}/edit`}
                                        className="shrink-0 rounded bg-emerald-600 px-2 py-1 text-[10px] font-bold uppercase text-white hover:bg-emerald-700"
                                    >
                                        Open in builder
                                    </a>
                                </div>
                            )}
                            <div className="flex items-center gap-2">
                                <button
                                    onClick={requestSave}
                                    disabled={saveDraft.isPending || sendPhase === 'preparing' || !hasName || lines.length === 0}
                                    title={hasName ? 'Prices through the quote engine and saves an unsent draft' : 'Needs a name first'}
                                    className="flex items-center gap-1.5 rounded-lg border border-slate-900 px-3 py-1.5 text-xs font-bold text-slate-900 hover:bg-slate-100 disabled:opacity-50"
                                >
                                    {saveDraft.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                                    {saveDraft.isPending ? 'Saving…' : saved ? 'Re-save draft' : 'Save draft'}
                                </button>
                                <button
                                    onClick={requestSend}
                                    disabled={saveDraft.isPending || sendPhase === 'preparing' || !hasName || lines.length === 0}
                                    title={hasName ? 'Creates the quote, drafts the WhatsApp message for your review, then you send' : 'Needs a name first'}
                                    className="flex items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-bold text-white hover:bg-slate-700 disabled:opacity-50"
                                >
                                    <Send className="h-3.5 w-3.5" />
                                    Send quote…
                                </button>
                                <div className="ml-auto flex items-center gap-2">
                                    <button
                                        onClick={openFullBuilder}
                                        className="flex items-center gap-1 rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs text-slate-600 hover:text-slate-900"
                                    >
                                        <ExternalLink className="h-3 w-3" /> Builder
                                    </button>
                                    <button
                                        onClick={onDismiss}
                                        title="Discard this prep"
                                        className="rounded px-2 py-1.5 text-xs text-slate-400 hover:text-red-700"
                                    >
                                        Discard
                                    </button>
                                </div>
                            </div>
                            {sendPhase === 'preparing' && (
                                <p className="mt-1.5 flex items-center gap-1.5 text-[11px] text-slate-500">
                                    <Loader2 className="h-3 w-3 animate-spin" /> Pricing &amp; drafting the message…
                                </p>
                            )}
                        </>
                    )}
                </div>

                {/* ── Full-screen lightbox (image zoom + video playback) ── */}
                {lightboxIndex != null && (
                    <PrepMediaLightbox
                        media={media}
                        index={lightboxIndex}
                        ticked={ticked}
                        onToggle={(url) => setTicked((t) => ({ ...t, [url]: !t[url] }))}
                        toggleDisabled={editingLocked}
                        onClose={() => setLightboxIndex(null)}
                        onNavigate={setLightboxIndex}
                    />
                )}
            </SheetContent>
        </Sheet>
    );
}

export default QuotePrepPanel;
