/**
 * P15 part 4 — THE COMPLETION GATE and the materials claim, as pure rules.
 *
 * A job does not close because the contractor tapped a button. It closes when the evidence exists:
 *
 *   1. a BEFORE and an AFTER photo for every task in the job pack — the pack says what to
 *      photograph (one entry per line, from the line's title), so "photos of the finished work"
 *      stops being a judgement call on the doorstep
 *   2. the CUSTOMER'S SIGN-OFF on the contractor's phone — happy, or not happy with a reason in
 *      her words. Not-happy still closes the job: the point is that it is recorded, not hidden
 *   3. the LEFTOVER REPORT — snags, extras spotted, access notes for next time. It may be empty,
 *      but the contractor has to have been asked; "nothing to report" is an answer, silence is not
 *
 * The MATERIALS CLAIM is deliberately NOT a gate (owner, 3 Sep: "no claim, no flag"). A contractor
 * who bought nothing claims nothing and the job closes. When he does claim, the total is compared
 * against what the pack said the materials would cost and a material difference goes to Ben.
 *
 * This file is pure and shared on purpose: the server refuses with these exact reasons and the
 * contractor's phone greys out the button with the same words, so the two can never drift apart.
 * No imports, no dates, no money formatting — just the rules.
 */

// ---------------------------------------------------------------- shapes

/** One thing the pack says to photograph, named by the line it came from. */
export interface PhotoTask {
    lineId: string;
    /** The pack line's title, verbatim — what the customer is paying for. */
    title: string;
}

/** What the contractor captured for one task. */
export interface TaskPhotos {
    before: string[];
    after: string[];
}

export type SignOffVerdict = 'happy' | 'not_happy';

export interface SignOff {
    verdict: SignOffVerdict | null;
    /** Required when the verdict is not_happy: her words, why. */
    reason?: string | null;
    /** Who signed, when they gave a name. */
    name?: string | null;
}

/**
 * The leftover report. Every field may be empty, but `nothingToReport` then has to be an explicit
 * true — the contractor answering "nothing", not the form being skipped.
 */
export interface LeftoverReport {
    snags?: string | null;
    /** Work spotted that we are not doing today (feeds Part 3's variation path, never priced here). */
    extras?: string | null;
    /** What the next person at this address needs to know. Filed onto the pack and the property. */
    accessNotes?: string | null;
    nothingToReport?: boolean;
}

export interface CompletionInput {
    /** Per lineId, what was captured. Missing lineId = nothing captured for that task. */
    taskPhotos?: Record<string, Partial<TaskPhotos>> | null;
    /** The legacy flat list (kept: it is what the history view and the invoice email read). */
    evidenceUrls?: string[] | null;
    signatureDataUrl?: string | null;
    signOff?: SignOff | null;
    leftover?: LeftoverReport | null;
}

/** One unmet requirement, in the words the contractor sees and the words the 422 carries. */
export interface GateFailure {
    /** 'photos:<lineId>:before' | 'photos:<lineId>:after' | 'photos' | 'signature' | 'signoff' | 'signoff.reason' | 'leftover' */
    field: string;
    label: string;
}

export interface GateResult {
    ok: boolean;
    failures: GateFailure[];
    /** One line for the 422 body and the button's helper text. */
    summary: string;
}

// ---------------------------------------------------------------- the gate

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
const urls = (v: unknown): string[] => (Array.isArray(v) ? v.filter((u): u is string => typeof u === 'string' && u.trim().length > 0) : []);

/** Pure: what this task still needs. Exported so the phone can mark a single card done. */
export function taskPhotosMissing(photos: Partial<TaskPhotos> | null | undefined): Array<'before' | 'after'> {
    const out: Array<'before' | 'after'> = [];
    if (urls(photos?.before).length === 0) out.push('before');
    if (urls(photos?.after).length === 0) out.push('after');
    return out;
}

/** Pure: is the leftover report answered? Empty is fine; unanswered is not. */
export function leftoverAnswered(report: LeftoverReport | null | undefined): boolean {
    if (!report) return false;
    if (report.nothingToReport === true) return true;
    return !!(str(report.snags) || str(report.extras) || str(report.accessNotes));
}

/** Pure: is the sign-off complete? not_happy needs the reason in her words. */
export function signOffComplete(signOff: SignOff | null | undefined): boolean {
    if (!signOff) return false;
    if (signOff.verdict === 'happy') return true;
    if (signOff.verdict === 'not_happy') return str(signOff.reason).length > 0;
    return false;
}

/**
 * Pure: THE GATE. `tasks` is the pack's photo plan; an empty plan (no pack, or a pack with no
 * lines) falls back to the rule that was there before P15 — at least one photo of the finished
 * work — because the pack is optional everywhere it is read and a missing pack must never be the
 * reason a contractor cannot close a job he has finished.
 */
export function completionGate(tasks: PhotoTask[], input: CompletionInput): GateResult {
    const failures: GateFailure[] = [];
    const photos = input.taskPhotos ?? {};

    if (tasks.length > 0) {
        for (const task of tasks) {
            for (const which of taskPhotosMissing(photos[task.lineId])) {
                failures.push({ field: `photos:${task.lineId}:${which}`, label: `${which === 'before' ? 'Before' : 'After'} photo of ${task.title}` });
            }
        }
    } else {
        const any = urls(input.evidenceUrls).length > 0
            || Object.values(photos).some((p) => urls(p?.before).length > 0 || urls(p?.after).length > 0);
        if (!any) failures.push({ field: 'photos', label: 'At least one photo of the finished work' });
    }

    if (!str(input.signatureDataUrl).startsWith('data:image/')) {
        failures.push({ field: 'signature', label: "The customer's signature" });
    }
    if (!input.signOff?.verdict) {
        failures.push({ field: 'signoff', label: 'Ask the customer: happy or not happy' });
    } else if (input.signOff.verdict === 'not_happy' && !str(input.signOff.reason)) {
        failures.push({ field: 'signoff.reason', label: 'What is not right, in her words' });
    }
    if (!leftoverAnswered(input.leftover)) {
        failures.push({ field: 'leftover', label: 'The leftover report (or tick nothing to report)' });
    }

    return { ok: failures.length === 0, failures, summary: summarise(failures) };
}

function summarise(failures: GateFailure[]): string {
    if (failures.length === 0) return 'Ready to close';
    if (failures.length === 1) return `Still needed: ${failures[0].label.toLowerCase()}`;
    const labels = failures.slice(0, 3).map((f) => f.label.toLowerCase());
    const more = failures.length - labels.length;
    return `Still needed: ${labels.join(', ')}${more > 0 ? ` and ${more} more` : ''}`;
}

/** Pure: every after-photo, flattened, for the columns that predate the per-task split. */
export function flattenEvidence(input: CompletionInput): string[] {
    const out: string[] = [];
    for (const p of Object.values(input.taskPhotos ?? {})) out.push(...urls(p?.after), ...urls(p?.before));
    for (const u of urls(input.evidenceUrls)) if (!out.includes(u)) out.push(u);
    return out;
}

// ---------------------------------------------------------------- the materials claim

/**
 * WHAT "over 10 % / £20" MEANS HERE (owner's words, 3 Sep). Both conditions, not either: a claim
 * is flagged when it is more than 10 % away from what the pack expected AND more than £20 away in
 * cash. Either-condition would push Ben a notification for £4 over on a £35 receipt, and an alert
 * that cries wolf is an alert nobody opens — the one thing this flag cannot afford to be. Change
 * these two constants (and `VARIANCE_NEEDS_BOTH`) if the owner wants it to bite earlier.
 */
export const VARIANCE_PERCENT = 10;
export const VARIANCE_PENCE = 2000;
export const VARIANCE_NEEDS_BOTH = true;

export interface MaterialsClaim {
    /** What the contractor actually spent, in pence. */
    claimedPence: number;
    receiptUrls: string[];
    note?: string | null;
}

export interface VarianceResult {
    claimedPence: number;
    /** What the pack said these materials would cost. */
    expectedPence: number;
    /** claimed − expected. Positive = overspend. */
    variancePence: number;
    /** Of expected. 0 when there was nothing to expect. */
    variancePercent: number;
    flagged: boolean;
    /** One line for the Pushover and the row on the job. */
    reason: string;
}

const gbp = (pence: number): string => {
    const p = Math.abs(Math.round(pence));
    return `£${(p / 100).toLocaleString('en-GB', { minimumFractionDigits: p % 100 ? 2 : 0, maximumFractionDigits: 2 })}`;
};

/**
 * Pure: the variance maths. `expectedPence` is the pack's own materials figure (see
 * expectedMaterialsPence in server/spine/job-pack-completion.ts for which figure and why).
 *
 * A claim against a pack that expected NOTHING is always flagged when it clears the cash floor:
 * spending £60 on a job quoted with no materials is exactly the surprise Ben needs to see, and no
 * percentage is computable against zero.
 */
export function materialsVariance(claimedPence: number, expectedPence: number): VarianceResult {
    const claimed = Math.max(0, Math.round(claimedPence));
    const expected = Math.max(0, Math.round(expectedPence));
    const variancePence = claimed - expected;
    const abs = Math.abs(variancePence);
    const variancePercent = expected > 0 ? (abs / expected) * 100 : 0;

    const overCash = abs > VARIANCE_PENCE;
    const overPercent = expected > 0 ? variancePercent > VARIANCE_PERCENT : true;
    const flagged = VARIANCE_NEEDS_BOTH ? overCash && overPercent : overCash || overPercent;

    const direction = variancePence > 0 ? 'over' : 'under';
    const reason = expected > 0
        ? `Claimed ${gbp(claimed)} against ${gbp(expected)} on the pack — ${gbp(abs)} ${direction} (${variancePercent.toFixed(0)}%)`
        : `Claimed ${gbp(claimed)}; the pack expected no materials`;

    return { claimedPence: claimed, expectedPence: expected, variancePence, variancePercent, flagged, reason };
}
