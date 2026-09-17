/**
 * Closing a live case file (docs/comms-v2/contracts.md, Contract 2, `close`; server/comms-v2/README.md,
 * "Closing a case file"). The 17 Sep job-file close answer, "Both": a file closes on its own when the
 * job is booked or done, and Ben can close one by hand.
 *
 *   booked   the booking from the file's quote has landed: server/booking-engine.ts `confirmBooking`
 *            (the quote page's picker, a slot the customer reserved before paying, promoted by the
 *            Stripe webhook; and the flex placements that reuse it) and `assignFromPool` (a paid job
 *            with no slot placed from the dispatch pool, a slot offer the customer took, or the
 *            webhook's auto-assign); and Ben's dispatch from the daily planner
 *            (server/daily-planner-routes.ts: confirm-dispatch, dispatch-all, confirm-cluster). The
 *            booking's id goes onto the file's job.
 *   done     the job is signed off: server/job-lifecycle.ts `finalizeJobCompletion` (the one
 *            completion spine the job routes and the ops actions share), the field app's complete
 *            route (server/contractor-app-routes.ts) and the contractor dashboard's complete route
 *            (server/job-assignment.ts); or its invoice is paid: the Stripe webhook's
 *            invoice payment and POST /api/invoices/:id/mark-paid. The public payment-link completion
 *            is not wired: it is unauthenticated and verifies no payment.
 *   by hand  POST /api/comms-v2/case-files/:id/close from the board (api/routes.ts, `closeByHand`),
 *            recorded on the stage change as `human:<email or user id>`.
 *
 * Each event names a quote and, where it has one, the booking, which is how a file is found: the
 * quote reference on its job is the quote's short slug (Quoting's draft) or its id (the scheduling
 * fixture), so both are matched, and a follow-up file that carries only the booking (the booked
 * customer asking when we are coming, scheduling-tools.ts `linkPartyBooking`) is matched on it; a file
 * since quoted for another job is not, and stays open with that quote. Only
 * while the new desk is the live desk (switch.ts `commsV2Live`), on the live intake's store, and
 * only files that are not done. Nothing here throws into the event that called it, and no log line
 * carries a value from a file.
 *
 * A closed file is no longer where the person's next message lands (desk/store.ts): that opens a new
 * file with no job type, location or quote, so the desk scopes and quotes the new job from nothing.
 *
 * A quoted file that nobody ever answers is closed too (17 Sep, answer 125, "Close after 30 days"):
 * one still at `quoted` (never `accepted`, `booked` or held for Ben) whose quote has stood unanswered
 * for `STALE_QUOTE_CLOSE_DAYS`, measured from the file's last activity: the stage move that last put
 * it at `quoted`, the desk's later automatic reissue, or its newest turn. Run by the live clock tick
 * (channels/live-clock.ts), the same tick as the chase, not a scheduler of its own. As above: only
 * files on the live intake's store, only while the new desk is the live desk, never throwing into the
 * caller, and the customer's next message then opens a fresh file (store.ts `newestOpenFor`). Only
 * such a file reopens (`reopenStaleQuoteFiles`): a payment or booking on its quote arriving later
 * puts it back at `quoted` and records the event on it, so no take-up of the quote is lost.
 */
import { closeFile, lastTurn, release, reopenStaleClosed, staleClosed, type ApproverSlot, type CaseFile, type CaseFileDeps, type HoldRelease, type StageChange } from './desk/case-file';
import type { CaseFileStore } from './desk/store';
import { QUOTE_FACT, factsWithPrefix } from './quoting/quote-record';

export type AutoCloseEvent = 'booked' | 'done';

export interface FileCloseDeps {
    liveState?: () => Promise<{ live: boolean }>;
    /** The live intake's store; the default builds or reuses its gateway (channels/intake.ts). */
    store?: () => Promise<CaseFileStore>;
    /** The quote's short slug by its id; the default reads the quotes table on the live database. */
    slugOf?: (quoteId: string) => Promise<string | null>;
    now?: () => Date;
    log?: (line: string) => void;
}

export interface AutoCloseInput {
    /** The quote the event is about, by its id. */
    quoteId: string | null | undefined;
    /** The booking the event is about, by its id; files carrying it close too. */
    bookingId?: string | null;
    to: AutoCloseEvent;
    /** The event, in the desk's own words, for the stage history: "booking <id> landed". */
    why: string;
}

export type AutoCloseOutcome =
    | { closed: Array<{ caseId: string; to: AutoCloseEvent }>; skipped: string | null };

const defaultLog = (line: string) => console.log(`[comms-v2 file close] ${line}`);

async function liveStore(): Promise<CaseFileStore> {
    return (await (await import('./channels/intake')).liveChannelGateway()).store;
}

async function liveSlugOf(quoteId: string): Promise<string | null> {
    const { commsV2Db } = await import('./live-database');
    const { personalizedQuotes } = await import('../../shared/schema');
    const { eq } = await import('drizzle-orm');
    const db = await commsV2Db('comms-v2 file close', 'live');
    const [row] = await db.select({ slug: personalizedQuotes.shortSlug }).from(personalizedQuotes).where(eq(personalizedQuotes.id, quoteId)).limit(1);
    return row?.slug ?? null;
}

/** The files not yet done whose job names this quote, by its id or its slug, or this booking with no other quote. */
export function filesForJob(files: CaseFile[], quoteRefs: ReadonlyArray<string | null>, bookingId: string | null): CaseFile[] {
    const wanted = new Set(quoteRefs.filter((r): r is string => !!r));
    return files.filter((f) => f.stage !== 'done'
        && ((!!f.job.quoteRef && wanted.has(f.job.quoteRef)) || (!!bookingId && f.job.bookingRef === bookingId && !f.job.quoteRef)));
}

/**
 * Reopens, at `quoted`, every file the stale quote rule closed whose job names one of these quotes:
 * a payment, acceptance or booking on a quote closed as stale is never lost. Returns the reopened files, not yet put.
 */
export function reopenStaleQuoteFiles(files: CaseFile[], quoteRefs: ReadonlyArray<string | null>, why: string, deps: CaseFileDeps = {}): CaseFile[] {
    const wanted = new Set(quoteRefs.filter((r): r is string => !!r));
    return files.filter((f) => staleClosed(f) && !!f.job.quoteRef && wanted.has(f.job.quoteRef) && reopenStaleClosed(f, why, deps).ok);
}

/** Closes again, as a stale quote, a file reopened for an event that then did not take the quote up; a file the event moved on is left. */
export function recloseStaleQuote(file: CaseFile, why: string, deps: CaseFileDeps = {}): boolean {
    return file.stage === 'quoted' && closeFile(file, 'done', { why, staleQuote: true }, deps).ok;
}

/** Closes the live files an event's quote or booking names. Never throws; a refusal or a failure is logged and the event goes on. */
export async function closeLiveFileForQuote(input: AutoCloseInput, deps: FileCloseDeps = {}): Promise<AutoCloseOutcome> {
    const log = deps.log ?? defaultLog;
    const out: AutoCloseOutcome = { closed: [], skipped: null };
    const bookingId = input.bookingId || null;
    try {
        if (!input.quoteId && !bookingId) return { ...out, skipped: 'the event names no quote or booking' };
        const readState = deps.liveState ?? (async () => (await import('./switch')).commsV2LiveState());
        if (!(await readState()).live) return { ...out, skipped: 'the new desk is not the live desk' };
        const store = await (deps.store ?? liveStore)();
        const slug = input.quoteId ? await (deps.slugOf ?? liveSlugOf)(input.quoteId) : null;
        reopenStaleQuoteFiles(store.all(), [input.quoteId ?? null, slug], input.why, { now: deps.now });
        const files = filesForJob(store.all(), [input.quoteId ?? null, slug], bookingId);
        if (!files.length) return { ...out, skipped: 'no live case file carries the quote or booking' };
        const bookingRef = input.to === 'booked' ? bookingId : null;
        for (const file of files) {
            const r = closeFile(file, input.to, { why: input.why, bookingRef }, { now: deps.now });
            if (!r.ok) { log(`case file ${file.id} not moved to ${input.to} for quote ${input.quoteId ?? '-'} booking ${bookingId ?? '-'}: ${r.reason}`); continue; }
            store.put(file);
            out.closed.push({ caseId: file.id, to: input.to });
            log(`case file ${file.id} is ${input.to}: ${input.why}`);
        }
        return out;
    } catch (err: any) {
        log(`closing the case file for quote ${input.quoteId ?? '-'} booking ${bookingId ?? '-'} (${input.to}) failed: ${err?.message ?? err}`);
        return { ...out, skipped: 'failed' };
    }
}

/** The booking from a quote has landed. */
export function fileBooked(quoteId: string | null | undefined, bookingId: string | null | undefined, deps: FileCloseDeps = {}): Promise<AutoCloseOutcome> {
    return closeLiveFileForQuote({ quoteId, bookingId, to: 'booked', why: bookingId ? `booking ${bookingId} landed from the quote` : 'a booking landed from the quote' }, deps);
}

/** The job from a quote, or the booking, is done: signed off, or its invoice paid. */
export function fileDone(quoteId: string | null | undefined, bookingId: string | null | undefined, event: 'signed_off' | 'invoice_paid', deps: FileCloseDeps = {}): Promise<AutoCloseOutcome> {
    const why = event === 'signed_off' ? 'the job was signed off as complete' : 'the invoice for the job was paid';
    return closeLiveFileForQuote({ quoteId, bookingId, to: 'done', why }, deps);
}

// ---------------------------------------------------------------- stale quote

/** How long a quoted file may stand unanswered before it closes on its own (answer 125, 17 Sep). */
export const STALE_QUOTE_CLOSE_DAYS = 30;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Since when the quoted file has been quiet: the newest of the stage move that last put it at
 * `quoted`, the desk's latest automatic reissue of its quote (`quote_reissued`, which puts the quote
 * live again without moving the stage), and its newest turn either way. Null off a quoted file.
 */
export function quietSince(file: CaseFile): string | null {
    let at: string | null = null;
    for (let i = file.stageHistory.length - 1; i >= 0; i--) if (file.stageHistory[i].to === 'quoted') { at = file.stageHistory[i].at; break; }
    if (!at) return null;
    const times = [...factsWithPrefix(file, QUOTE_FACT.reissued).map((f) => f.at), lastTurn(file)?.at];
    for (const t of times) if (t && Date.parse(t) > Date.parse(at)) at = t;
    return at;
}

/**
 * A quoted file, not held for Ben and with no customer burst waiting on it, that has been quiet for
 * `STALE_QUOTE_CLOSE_DAYS` (`quietSince`): a file with any quote send, reissue or turn in that time
 * never closes. Never true off `quoted`: `accepted` and `booked` are quoted files that moved on, so
 * isolating this to `quoted` alone is enough to leave them, and every other stage, untouched.
 */
export function staleQuoteDue(file: CaseFile, now: Date): boolean {
    if (file.stage !== 'quoted' || file.hold || file.waits?.length) return false;
    const at = quietSince(file);
    return !!at && now.getTime() - Date.parse(at) > STALE_QUOTE_CLOSE_DAYS * DAY_MS;
}

/** The live intake's gateway as the stale close needs it: its files, and a pass queued behind any desk pass on a file. */
export interface StaleQuoteGateway {
    store: { all(): CaseFile[] };
    passOn<T>(fileId: string, pass: (file: CaseFile) => T | Promise<T>): Promise<T | null>;
}

export interface StaleQuoteDeps {
    liveState?: () => Promise<{ live: boolean }>;
    gateway?: () => Promise<StaleQuoteGateway>;
    now?: () => Date;
    log?: (line: string) => void;
}

/**
 * Closes every live quoted file whose quote has gone unaccepted for `STALE_QUOTE_CLOSE_DAYS` days
 * (answer 125, "Close after 30 days"), run by the live clock tick (channels/live-clock.ts) over every
 * file rather than one event's quote or booking. Each close runs as a pass on the file, after any desk
 * pass already running or queued on it, and asks again there, so it never closes a file under a
 * customer's turn. Marked as a stale close, so a later take-up of the quote reopens the file
 * (`reopenStaleQuoteFiles`). Never throws; a refusal or a failure is logged and the pass goes on.
 */
export async function closeStaleQuotes(deps: StaleQuoteDeps = {}): Promise<AutoCloseOutcome> {
    const log = deps.log ?? defaultLog;
    const out: AutoCloseOutcome = { closed: [], skipped: null };
    try {
        const readState = deps.liveState ?? (async () => (await import('./switch')).commsV2LiveState());
        if (!(await readState()).live) return { ...out, skipped: 'the new desk is not the live desk' };
        const gateway = await (deps.gateway ?? (async () => (await import('./channels/intake')).liveChannelGateway()))();
        const now = deps.now ?? (() => new Date());
        const due = gateway.store.all().filter((f) => staleQuoteDue(f, now()));
        if (!due.length) return { ...out, skipped: 'no live case file is a stale quote' };
        for (const { id } of due) {
            const closed = await gateway.passOn(id, (file) => {
                if (!staleQuoteDue(file, now())) return false;
                const why = `quote ${file.job.quoteRef ?? '-'} sent more than ${STALE_QUOTE_CLOSE_DAYS} days ago and not accepted`;
                const r = closeFile(file, 'done', { why, staleQuote: true }, { now });
                if (!r.ok) { log(`case file ${id} not closed as a stale quote: ${r.reason}`); return false; }
                log(`case file ${id} closed: ${why}`);
                return true;
            });
            if (closed) out.closed.push({ caseId: id, to: 'done' });
        }
        return out;
    } catch (err: any) {
        log(`closing stale quoted files failed: ${err?.message ?? err}`);
        return { ...out, skipped: 'failed' };
    }
}

// ---------------------------------------------------------------- by hand

export type HandCloseOutcome =
    | { ok: true; change: StageChange; release: HoldRelease | null }
    | { ok: false; status: number; reason: string };

/**
 * Ben closes the file from the board. The file goes to done with the person on the stage change.
 * A standing hold is released first, by the same rule as any release (only its named approver, with
 * the approver's own words), so a closed file never waits in anyone's queue; when that release
 * refuses, nothing changes. A file with no hold closes without words.
 */
export function closeByHand(file: CaseFile, input: { approver: ApproverSlot; person: string; words?: string }, deps: { now?: () => Date } = {}): HandCloseOutcome {
    if (file.stage === 'done') return { ok: false, status: 409, reason: 'the file is already done' };
    const person = input.person.trim();
    if (!person) return { ok: false, status: 400, reason: 'a hand close names the person closing it' };
    const words = input.words?.trim() ?? '';
    let rel: HoldRelease | null = null;
    if (file.hold) {
        const released = release(file, input.approver, words, deps);
        if (!released.ok) return { ok: false, status: 409, reason: released.reason };
        rel = released.value;
    }
    const closed = closeFile(file, 'done', { why: 'closed by hand from the board', approver: `human:${person}`, words }, deps);
    if (!closed.ok) return { ok: false, status: 409, reason: closed.reason };
    return { ok: true, change: closed.value, release: rel };
}
