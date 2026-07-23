/**
 * Completion Sync — closes the delivery-funnel instrumentation gap.
 *
 * WHY: the formal completion endpoints exist but ops doesn't drive them.
 * July 2026 diagnosis: every accepted booking request was frozen at
 * accepted/scheduled with completedAt NULL — while 84 invoices went out in 8
 * weeks. Completion data (the basis for contractor weekly-volume reporting,
 * the §5 pay-agreement floor, and delivery metrics) simply never lands.
 *
 * Invoice CREATION is NOT a completion signal (46 of 84 quote-linked invoices
 * were raised before the job date — deposit/booking invoices). Two signals are
 * honest:
 *   1. A PAID invoice linked to the quote (balance settled ⇒ work done) —
 *      completedAt = invoice.paidAt.
 *   2. The scheduled date passed >24h ago on an accepted, never-declined job
 *      ⇒ the visit happened — completedAt = that scheduled date.
 *
 * Both rules run in one idempotent DB-side sweep, called hourly from the cron
 * in server/index.ts. First run doubles as the historical backfill. Rows a
 * human already completed are never touched (completedAt IS NULL guard), and
 * unclaimed dispatches are left alone (a stale offer is not a delivery).
 */
import { db } from './db';
import { sql } from 'drizzle-orm';

export interface CompletionSweepResult {
  cbrFromPaidInvoice: number;
  cbrFromDatePassed: number;
  dispatchesFromDatePassed: number;
}

export async function sweepCompletions(): Promise<CompletionSweepResult> {
  const result: CompletionSweepResult = {
    cbrFromPaidInvoice: 0,
    cbrFromDatePassed: 0,
    dispatchesFromDatePassed: 0,
  };

  try {
    // Rule 1 — paid invoice on the quote ⇒ completed at paidAt.
    // Strongest evidence; runs first so it wins the completedAt timestamp.
    const paid = await db.execute(sql`
      update contractor_booking_requests cbr
      set status = 'completed',
          assignment_status = 'completed',
          completed_at = i.paid_at,
          invoice_id = coalesce(cbr.invoice_id, i.id)
      from invoices i
      where i.quote_id = cbr.quote_id
        and i.paid_at is not null
        and cbr.status = 'accepted'
        and cbr.completed_at is null
      returning cbr.id
    `);
    result.cbrFromPaidInvoice = paid.rows.length;

    // Rule 2 — scheduled/requested date >24h past on an accepted job ⇒ the
    // visit happened. completedAt = the scheduled date itself (not now()),
    // so weekly attribution lands in the week the work was done.
    const dated = await db.execute(sql`
      update contractor_booking_requests
      set status = 'completed',
          assignment_status = 'completed',
          completed_at = coalesce(scheduled_date, requested_date)
      where status = 'accepted'
        and completed_at is null
        and coalesce(scheduled_date, requested_date) < now() - interval '24 hours'
      returning id
    `);
    result.cbrFromDatePassed = dated.rows.length;

    // Dispatches: only CLAIMED (locked) ones auto-complete on date passing —
    // completing an unclaimed offer would fabricate contractor delivery data.
    const disp = await db.execute(sql`
      update job_dispatches
      set status = 'completed',
          completed_at = coalesce(scheduled_date, locked_at),
          updated_at = now()
      where locked_to_contractor_id is not null
        and completed_at is null
        and coalesce(scheduled_date, locked_at) < now() - interval '24 hours'
      returning id
    `);
    result.dispatchesFromDatePassed = disp.rows.length;

    const total = result.cbrFromPaidInvoice + result.cbrFromDatePassed + result.dispatchesFromDatePassed;
    if (total > 0) {
      console.log(`[CompletionSync] swept ${total}: ${result.cbrFromPaidInvoice} CBR via paid invoice, ${result.cbrFromDatePassed} CBR via date passed, ${result.dispatchesFromDatePassed} dispatch(es) via date passed`);
    }
  } catch (err) {
    // Best-effort by design — log and let the next hourly run retry.
    console.warn('[CompletionSync] sweep failed (non-fatal):', err instanceof Error ? err.message : err);
  }
  return result;
}
