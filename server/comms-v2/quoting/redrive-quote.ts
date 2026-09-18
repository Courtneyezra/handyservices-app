/**
 * A quote a person priced whose delivery was refused, sent again on the clock pass once the refusal
 * no longer applies (the Needs-you audit, change N5, 18 Sep 2026).
 *
 * `deliverPricedQuote` (deliver-quote.ts) holds with its own card, `priceHold(slug)`, at every
 * refusal and clears that card when a later attempt lands; until now the only later attempt was a
 * person pressing send again, so a quote refused on a fault since fixed sat undelivered while the
 * customer had been told it was on its way (47 hours, on the "spine.senders.null" refusal).
 *
 * The re-drive never decides a price. It delivers only a quote that is still a draft whose prices a
 * person confirmed on the price screen (`QuoteRecord.pricedBy`), at the totals the row carries, under
 * that person as the approver, because the licence to send is their price. It runs only on the
 * delivery's own card, and only while nobody has written on that card since (`notedOn`), exactly the
 * card the landing is allowed to clear. Before it tries it asks whether each refusal still applies,
 * and tries nothing while one does:
 *   - the thread held because the customer asked us to stop (`optOutHeld`), never; the sender's own
 *     gate asks the opt-out ledger about every address, phone and email, as it does for a first send;
 *   - a customer message still waiting on the file (`waits`): the desk answers it first;
 *   - a price lock that has passed: the card is rewritten to say it needs pricing again;
 *   - no channel to answer on, or a shut WhatsApp window with no approved `quote_ready_link`: the
 *     card is rewritten to say so, so it never goes on naming a refusal that has cleared;
 *   - live, the sender registry or a switch refusing the approver (sender.ts `liveSwitchRefusal`).
 * Each attempt is recorded on the file, at most `MAX_REDRIVES` of them and `REDRIVE_GAP_MS` apart,
 * after which the card says the desk will not try again.
 */
import { noteOnHold, recordFact, type CaseFile, type Fact } from '../desk/case-file';
import { optOutHeld, type DeskDeps } from '../desk/desk';
import type { DeskResult } from '../desk/desk-types';
import { chooseChannel, liveSwitchRefusal, liveTemplateStatus, pickTemplate, windowOf } from '../desk/sender';
import type { Approver } from '../../approver';
import { deliverPricedQuote, newestCustomerTurn, priceHold, shutWindowHold } from './deliver-quote';
import { quoteRecordOf, quoteUrlFor } from './quote-record';
import { pricedQuoteOf, resolveQuotingDeps } from './quoting-tools';

/** The internal fact each re-drive attempt writes, for Ben's eyes only (case-file.ts INTERNAL_FACT_KEYS). */
export const REDRIVE_FACT = 'quote_redrive';
/** How many times the desk tries one refused delivery again before it leaves the card to Ben. */
export const MAX_REDRIVES = 3;
/** The least time between two attempts, so a refusal that has not cleared is not asked every minute. */
export const REDRIVE_GAP_MS = 30 * 60_000;

/** What the card says once the attempts are spent. */
const GAVE_UP = 'the desk will not try again: price and send it from the price screen';

export interface RedriveDeps {
    desk: DeskDeps;
    mode: 'dry_run' | 'live';
    now: () => Date;
    /**
     * Why a live send by this approver would be refused before anything else is asked; null when it
     * would not. The default asks the live deliverer's own gate in live mode, and nothing when a
     * deliverer is supplied or the send is a dry run.
     */
    sendRefusal?: (approver: Approver) => Promise<string | null>;
}

/** What the clock pass records: its note, and the delivery's result when an attempt was made. */
export interface RedriveOutcome { note: string; result: DeskResult | null }

/** The quote whose delivery card the file is held on, while that card still says only what the delivery wrote; else null. */
export function heldPricedSlug(file: CaseFile): string | null {
    const slug = file.job.quoteRef;
    if (!slug || !file.hold || file.hold.notedOn) return null;
    return file.hold.reason.startsWith(priceHold(slug)) ? slug : null;
}

function attemptsOn(file: CaseFile, slug: string): Fact[] {
    return file.facts.filter((f) => f.key === REDRIVE_FACT && f.source.kind === 'quote_line' && f.source.quoteRef === slug);
}

/** The delivery card rewritten in the desk's own words, as the delivery restates it; nothing when it already says this. */
function restate(file: CaseFile, slug: string, reason: string): void {
    if (file.hold?.reason === reason) return;
    noteOnHold(file, { reason, ownCard: priceHold(slug) });
}

/**
 * One clock pass's re-drive of the file's refused quote delivery, or null when there is none to
 * consider. A refusal that still applies is named in the note and nothing is sent.
 */
export async function redrivePricedQuote(file: CaseFile, deps: RedriveDeps): Promise<RedriveOutcome | null> {
    const slug = heldPricedSlug(file);
    if (!slug || optOutHeld(file)) return null;
    const party = file.parties[0];
    if ((file.waits ?? []).some((w) => w.partyId === party.personId)) return null;
    const now = deps.now();
    const quoting = { ...deps.desk.quoting, now: deps.now, newId: deps.desk.newId };
    const skip = (why: string): RedriveOutcome => ({ note: `quote ${slug} not re-driven: ${why}`, result: null });

    const attempts = attemptsOn(file, slug);
    if (attempts.length >= MAX_REDRIVES) {
        if (!file.hold!.reason.includes(GAVE_UP)) restate(file, slug, `${file.hold!.reason}; tried again ${attempts.length} times, ${GAVE_UP}`);
        return skip(`tried ${attempts.length} times already`);
    }
    const last = attempts[attempts.length - 1];
    if (last && now.getTime() - Date.parse(last.at) < REDRIVE_GAP_MS) return null;

    // The price must already be a person's decision, and still the one on the row.
    const store = resolveQuotingDeps(quoting).store;
    const row = await store.read(slug);
    if (!row) return skip('the quote row could not be read');
    const record = quoteRecordOf(row, now);
    if (record.status !== 'draft') return skip(`the quote is ${record.status}, not a draft waiting to go`);
    if (!record.pricedBy) return skip('no person has confirmed its prices');
    if (!record.totalPence || record.totalPence <= 0 || !record.lines.length || record.lines.some((l) => l.pricePence === null)) return skip('the quote is not fully priced');
    if (record.expiresAt && Date.parse(record.expiresAt) < now.getTime()) {
        restate(file, slug, `${priceHold(slug)} the price lock passed at ${record.expiresAt}, so the quote is not sent: re-price it from the price screen`);
        return skip(`its price lock passed at ${record.expiresAt}`);
    }

    const quoteUrl = quoteUrlFor(slug, quoting.baseUrl);
    const turn = newestCustomerTurn(file, party);
    const choice = chooseChannel(party, turn?.channel ?? null, now, { noTemplate: true });
    if (!choice.ok) return skip(choice.reason);
    const window = windowOf(party, choice.channel, now);
    if (window.state === 'shut') {
        const pick = await pickTemplate('quote_ready', { name: party.name, topic: quoteUrl, link: quoteUrl, at: now }, deps.desk.templates ?? liveTemplateStatus);
        if (!pick.ok || !pick.body.includes(quoteUrl)) {
            restate(file, slug, shutWindowHold(slug, window.reason));
            return skip('the WhatsApp window is shut and no approved template carries a quote link');
        }
    }
    const sendRefusal = deps.sendRefusal ?? (deps.mode === 'live' && !deps.desk.sender?.deliverer ? liveSwitchRefusal : async () => null);
    const refused = await sendRefusal(record.pricedBy);
    if (refused) return skip(refused);

    recordFact(file, { key: REDRIVE_FACT, value: `attempt ${attempts.length + 1} of ${MAX_REDRIVES}, under ${record.pricedBy}`, source: { kind: 'quote_line', quoteRef: slug, line: 'redrive' }, by: 'quoting' }, { now: deps.now, newId: deps.desk.newId });
    const priced = await pricedQuoteOf(file, quoteUrl, { totalPence: record.totalPence, depositPence: record.depositPence ?? 0 }, quoting);
    if (!priced.ok) return skip(priced.reason);
    const out = await deliverPricedQuote({ file, priced, approver: record.pricedBy, mode: deps.mode, now: deps.now, deps: { ...deps.desk, quoting } });
    if (!out.ok) return skip(out.reason);
    return {
        note: out.sent ? `quote ${slug} re-driven and sent under ${record.pricedBy} (attempt ${attempts.length + 1})` : `quote ${slug} re-driven and held again (attempt ${attempts.length + 1}): ${out.result.note}`,
        result: out.result,
    };
}
