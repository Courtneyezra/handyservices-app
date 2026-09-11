/**
 * The hold vocabulary the Service specialist and its tools can raise (checklist 7.1, 7.2), each
 * with the fixed line the desk sends in Ben's words (desk/fixed-lines.ts). Two kinds of hold:
 *
 *   fixed line only   one fixed line, no composer, and no specialist until Ben releases it. A
 *                     complaint, a refund, a trust doubt, gas, and scoping that is not converging.
 *   answer the rest   the reply still answers what it can and carries the fixed line for the
 *                     rest. A question we have no source for, a change of details, a customer
 *                     asking for a call, and money (Goal 1's). A date change is one of these too,
 *                     but the Scheduling specialist raises its own (server/comms-v2/scheduling),
 *                     so the desk does not raise it here as well.
 *
 * The router's exceptions and these reasons share one type, HoldException (desk/router.ts), so a
 * hold on the file always names a reason from one vocabulary.
 */
import type { FixedLineKind } from '../desk/fixed-lines';
import type { HoldException } from '../desk/router';

export type ServiceHoldReason = Extract<HoldException, 'complaint' | 'refund' | 'trust_doubt' | 'no_source' | 'not_converging' | 'change_of_details'>;
export const SERVICE_HOLD_REASONS: readonly ServiceHoldReason[] = ['complaint', 'refund', 'trust_doubt', 'no_source', 'not_converging', 'change_of_details'];

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

/** Reasons the desk sends one fixed line for and keeps every specialist off the thread until Ben releases it. */
export const FIXED_LINE_ONLY: ReadonlySet<HoldException> = new Set<HoldException>(['complaint', 'refund', 'trust_doubt', 'regulated', 'not_converging']);

/** Reasons the reply still answers the rest for, carrying the fixed line. */
export const ANSWER_THE_REST: ReadonlySet<HoldException> = new Set<HoldException>(['money', 'callback', 'no_source', 'change_of_details']);

export function isFixedLineOnly(reason: HoldException | null | undefined): boolean {
    return !!reason && FIXED_LINE_ONLY.has(reason);
}
