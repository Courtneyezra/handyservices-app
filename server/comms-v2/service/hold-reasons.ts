/**
 * The hold vocabulary the Service specialist and its tools can raise (checklist 7.1, 7.2), each
 * with the fixed line the desk sends in Ben's words (desk/fixed-lines.ts). Two kinds of hold:
 *
 *   fixed line only   one fixed line, no composer, and no specialist until Ben releases it. A
 *                     complaint, a refund, a trust doubt, and gas (answer 21: nothing else freezes).
 *                     Gas beside work we do in the same message does not freeze the rest (the
 *                     ruling of 18 Sep 2026, which changes answer 21): the gas line goes in the
 *                     reply, the work we do is still scoped and quoted, and the hold still names
 *                     the gas item for Ben (`REGULATED_WITH_REST`).
 *   answer the rest   the reply still answers what it can and carries the fixed line for the
 *                     rest (answer 14). A question we have no source for, a change of details, a
 *                     customer asking for a call, money (Goal 1's), and scoping that is not
 *                     converging, which keeps being scoped so the fact it lacked can still arrive
 *                     and the desk clears its own card when it does. A date change is one of these too,
 *                     but the Scheduling specialist raises its own (server/comms-v2/scheduling),
 *                     so the desk does not raise it here as well.
 *
 * The router's exceptions and these reasons share one type, HoldException (desk/router.ts), so a
 * hold on the file always names a reason from one vocabulary. A fixed-line-only reason outranks a
 * standing answer-the-rest hold and takes it over (case-file.ts supersede), so a thread that turns
 * to a complaint stops being scoped; one thread has one record of what it is held on.
 */
import type { FixedLineKind } from '../desk/fixed-lines';
import { regulatedMatch, regulatedNotGasMatch } from '../desk/lexicon';
import type { HoldException } from '../desk/router';

/** `money` only for an invoice money question the router handed to Service that the invoice row did not answer (service/customer-record.ts). */
export type ServiceHoldReason = Extract<HoldException, 'complaint' | 'refund' | 'trust_doubt' | 'no_source' | 'not_converging' | 'change_of_details' | 'money'>;

export interface ServiceHold { reason: ServiceHoldReason; match: string }

/** The fixed line for every reason a hold can be raised for. */
export const FIXED_LINE_FOR: Record<HoldException, FixedLineKind> = {
    regulated: 'gas',
    complaint: 'complaint',
    refund: 'refund',
    trust_doubt: 'trust',
    money: 'money_to_ben',
    date_change: 'date_change_to_ben',
    date_unconfirmed: 'date_change_to_ben',
    callback: 'callback_to_ben',
    no_source: 'no_source',
    not_converging: 'not_converging',
    change_of_details: 'change_of_details',
};

/**
 * A regulated hold with no line to send. `FIXED_LINE_FOR.regulated` is the gas line, so it goes only
 * when the turn is positively gas: a gas term matches and no regulated work that is not gas does.
 * Anything else the desk holds as regulated (asbestos, an artex ceiling, gas beside asbestos, or a
 * turn the router flagged that no pattern recognises) would hear the wrong work and the wrong trade,
 * so the desk holds for Ben, sends nothing, and says why on the hold. Null when the gas line may go.
 */
export function regulatedWithoutLine(reason: HoldException | null, body: string): string | null {
    if (reason !== 'regulated') return null;
    const notGas = regulatedNotGasMatch(body);
    if (notGas) return `nothing sent: "${notGas}" is regulated work that is not gas, and the gas line would send them to the wrong trade; no line is approved for it`;
    if (regulatedMatch(body)) return null;
    return 'nothing sent: the turn is regulated but not identified as gas, so the gas line would not be true; no line is approved for it';
}

/** Reasons the desk sends one fixed line for and keeps every specialist off the thread until Ben releases it. */
export const FIXED_LINE_ONLY: ReadonlySet<HoldException> = new Set<HoldException>(['complaint', 'refund', 'trust_doubt', 'regulated']);

/**
 * What a gas hold says when the same message also asked for work we do, and the words `freezes`
 * reads back. The ruling of 18 Sep 2026 ("answer the part we cover"): the gas line goes, unchanged,
 * and the rest of the message is still scoped and quoted, so one gas item no longer drops the
 * ceiling job beside it. The hold stays `regulated`, so Ben is still told about the gas item.
 */
export const REGULATED_WITH_REST = 'the same message asks for work we do';

/** The reason a gas hold beside work we do is raised with: the gas item for Ben, and the work the desk carries on with. */
export function regulatedWithRestReason(match: string, rest: string): string {
    return `regulated: ${match}; ${REGULATED_WITH_REST} (${rest}), so the gas line goes with the reply and the desk keeps scoping that; the ${match} is Ben's`;
}

/** Noted on the gas hold when the reply that was to carry the gas line did not go (desk.ts `settleGasLine`). */
export const GAS_LINE_NOT_SENT = 'the gas line has not gone to the customer';

/**
 * Whether a hold keeps every specialist off the thread: a fixed-line-only reason, except a gas hold
 * raised beside work we do (`REGULATED_WITH_REST`), which answers the rest. A graver reason that
 * takes it over (a complaint) is its own exception and freezes as ever.
 */
export function freezes(hold: { exception: HoldException | null; reason: string } | null | undefined): boolean {
    if (!hold?.exception || !FIXED_LINE_ONLY.has(hold.exception)) return false;
    return !(hold.exception === 'regulated' && hold.reason.includes(REGULATED_WITH_REST));
}

/** Reasons the reply still answers the rest for, carrying the fixed line. */
export const ANSWER_THE_REST: ReadonlySet<HoldException> = new Set<HoldException>(['money', 'callback', 'no_source', 'change_of_details', 'not_converging']);

/** How a card the convergence check raised opens (`${reason}: ${why}`), so the desk can restate or clear its own card. */
export const NOT_CONVERGING_CARD = 'not_converging:';
