/**
 * ONE readiness vocabulary for a quote intake (P8 / C, 3 Sep 2026).
 *
 * Before this file three vocabularies described the same verdict: the quote-prep clerk's five
 * values, the board's four (no `decline`) and the portal's three (no `quote_pending`, no
 * `decline`). A `decline` verdict therefore had no lane on the board and no control in the
 * portal, and every surface carried its own labels and colours. Everything that shows, filters
 * or overrides a readiness now imports from here — server and client alike.
 *
 *   quote_ready    everything needed to price is in the thread; the chain estimates, Ben prices
 *   quote_pending  quote_ready, but the estimator is still running (system-only, never overridden TO)
 *   needs_info     the agent still has questions the customer must answer (the agent's move)
 *   visit_first    cannot be priced honestly from the thread; a paid survey is offered (DRAFT)
 *   decline        one of the four no-go trades; Ben confirms the polite no (DRAFT, intent closing)
 */

export const INTAKE_READINESS = ['quote_ready', 'quote_pending', 'needs_info', 'visit_first', 'decline'] as const;
export type IntakeReadiness = (typeof INTAKE_READINESS)[number];

/**
 * The lanes a person may move a thread TO. `quote_pending` is a transient state only the system
 * sets (an estimate in flight) — overriding FROM it is fine, overriding TO it would be a lie.
 */
export const OVERRIDABLE_READINESS = ['quote_ready', 'needs_info', 'visit_first', 'decline'] as const satisfies readonly IntakeReadiness[];
export type OverridableReadiness = (typeof OVERRIDABLE_READINESS)[number];

export function isIntakeReadiness(x: unknown): x is IntakeReadiness {
    return typeof x === 'string' && (INTAKE_READINESS as readonly string[]).includes(x);
}

export function isOverridableReadiness(x: unknown): x is OverridableReadiness {
    return typeof x === 'string' && (OVERRIDABLE_READINESS as readonly string[]).includes(x);
}

/** Coerce anything stored (older intakes, foreign strings) onto the vocabulary. */
export function normaliseReadiness(x: unknown, fallback: IntakeReadiness = 'needs_info'): IntakeReadiness {
    if (isIntakeReadiness(x)) return x;
    const v = String(x ?? '').toLowerCase().replace(/[\s-]+/g, '_');
    if (isIntakeReadiness(v)) return v;
    if (v === 'ready' || v === 'quoteready') return 'quote_ready';
    if (v === 'pending' || v === 'researching' || v === 'estimating') return 'quote_pending';
    if (v === 'visit' || v === 'survey' || v === 'visit_needed') return 'visit_first';
    if (v === 'declined' || v === 'decline_proposed' || v === 'no_go') return 'decline';
    if (v === 'gaps' || v === 'info' || v === 'needs_information') return 'needs_info';
    return fallback;
}

export type ReadinessTone = 'emerald' | 'blue' | 'amber' | 'violet' | 'red';

export interface ReadinessUi {
    /** Short chip text (board pills, lane badges). */
    label: string;
    /** The one-line explanation the portal shows under the badge. */
    blurb: string;
    tone: ReadinessTone;
    /** Tailwind classes for a solid chip (portal badge). */
    chip: string;
    /** Tailwind classes for a tinted pill (board card, thread header). */
    pill: string;
    /** True when the verdict puts the thread on Ben's desk. */
    bensMove: boolean;
}

export const READINESS_UI: Record<IntakeReadiness, ReadinessUi> = {
    quote_ready: {
        label: 'Ready to price',
        blurb: 'Everything needed to price this is in the thread. The estimate runs by itself; you price and send.',
        tone: 'emerald',
        chip: 'bg-emerald-600 text-white',
        pill: 'bg-emerald-100 text-emerald-800',
        bensMove: true,
    },
    quote_pending: {
        label: 'Estimating…',
        blurb: 'The estimator is measuring this one. A priced draft appears when it finishes.',
        tone: 'blue',
        chip: 'bg-blue-500 text-white',
        pill: 'bg-blue-100 text-blue-800',
        bensMove: false,
    },
    needs_info: {
        label: 'Needs info',
        blurb: 'These answers change the price or the scope. The agent asks; nothing to price yet.',
        tone: 'amber',
        chip: 'bg-amber-500 text-white',
        pill: 'bg-amber-100 text-amber-800',
        bensMove: false,
    },
    visit_first: {
        label: 'Visit first',
        blurb: 'This one cannot be priced honestly from the thread. A paid survey offer is drafted for you to approve.',
        tone: 'violet',
        chip: 'bg-violet-700 text-white',
        pill: 'bg-violet-100 text-violet-800',
        bensMove: true,
    },
    decline: {
        label: 'Decline proposed',
        blurb: 'One of the four no-go trades. The polite no is drafted; nothing goes out until you confirm it.',
        tone: 'red',
        chip: 'bg-red-600 text-white',
        pill: 'bg-red-100 text-red-800',
        bensMove: true,
    },
};

/** Chip text for a readiness; unknown strings render as themselves, spaces for underscores. */
export function readinessLabel(r: string | null | undefined): string {
    if (!r) return '';
    return isIntakeReadiness(r) ? READINESS_UI[r].label : r.replace(/_/g, ' ');
}

/** UI record for any string, with a neutral fallback so an unknown value never crashes a chip. */
export function readinessUi(r: string | null | undefined): ReadinessUi {
    if (isIntakeReadiness(r)) return READINESS_UI[r];
    return {
        label: readinessLabel(r) || 'unknown',
        blurb: '',
        tone: 'blue',
        chip: 'bg-slate-200 text-slate-700',
        pill: 'bg-slate-100 text-slate-700',
        bensMove: false,
    };
}

/** Portal segmented control: the lanes a person may pick, in display order. */
export const READINESS_OVERRIDE_OPTIONS: ReadonlyArray<{ readiness: OverridableReadiness; label: string }> = [
    { readiness: 'quote_ready', label: READINESS_UI.quote_ready.label },
    { readiness: 'needs_info', label: READINESS_UI.needs_info.label },
    { readiness: 'visit_first', label: READINESS_UI.visit_first.label },
    { readiness: 'decline', label: 'Decline' },
];
