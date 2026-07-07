/**
 * Phase 1 §4.4 — Backfill the historical leaked paid jobs.
 *
 * A "leaked" job = a paid deposit (`deposit_paid_at` set) that never got a
 * contractor_booking_requests (CBR) row — i.e. it's sitting in the pending pool,
 * read by dispatch-sweep as `deposit_paid_at IS NOT NULL AND cbr.id IS NULL`.
 *
 * This reconcile pass classifies every leaked job and, for the RECENT + still-pending
 * ones, runs the SAME assignment the payment webhook runs (autoAssignPaidJob) so a
 * committed CBR row appears where a contractor fits. OLD jobs (paid > N days ago, or
 * whose lead stage is already past `booked`) are REPORT-ONLY — they're likely already
 * fulfilled offline, so the script classifies them and never auto-books (§6 decision 1).
 *
 *   DATED   (selected_date set):
 *     - old / past-booked stage  → report only (likely already done offline)
 *     - recent + still pending   → auto-assign (dry-run predicts; --commit writes a CBR)
 *     - date already passed       → report (needs reschedule, can't book a past date)
 *     - no fitting contractor     → report (needs human dispatch)
 *   FLEXIBLE (no selected_date):
 *     - left pending (no date = nothing to commit), SLA clock normalised so it ages
 *       visibly in the cockpit (--commit sets flex_booking_within_days = default where
 *       missing). Reported in the aged-pool view either way.
 *
 * SAFETY:
 *   - DRY-RUN by default. Pass `--commit` to actually write. (No env flag needed; the
 *     webhook's AUTO_ASSIGN_ON_PAYMENT gate does NOT apply here — this is a deliberate,
 *     operator-run backfill, not the automatic payment path.)
 *   - Idempotent: only loads jobs with NO CBR; autoAssignPaidJob → assignFromPool
 *     re-checks for an existing booking + slot conflict before inserting, so a re-run
 *     never double-books.
 *   - Test/dummy quotes are scrubbed out (same signature filter as the analytics work).
 *
 * Usage:
 *   tsx scripts/dispatch-backfill.ts            # dry-run (default) — classify + predict
 *   tsx scripts/dispatch-backfill.ts --commit   # actually write CBRs + normalise SLA
 *   tsx scripts/dispatch-backfill.ts --recent-days=14   # override the old/recent cutoff
 */
import { db } from '../server/db';
import { sql } from 'drizzle-orm';
import { autoAssignPaidJob } from '../server/booking-engine';
import { computeSlack } from '../server/dispatch-sweep';
import { SLA_DEFAULT_WINDOW_DAYS } from '../shared/dispatch-sla';

const COMMIT = process.argv.includes('--commit');
const RECENT_DAYS = (() => {
  const a = process.argv.find((x) => x.startsWith('--recent-days='));
  const n = a ? Number(a.split('=')[1]) : NaN;
  return Number.isFinite(n) && n > 0 ? n : 21; // default: paid within 3 weeks = "recent"
})();

// Lead stages strictly AFTER `booked` in the funnel ⇒ work already progressed/closed,
// so the job was almost certainly fulfilled offline — never auto-book these.
const PAST_BOOKED_STAGES = new Set(['in_progress', 'completed', 'complete']);

// Non-skill pseudo line-item categories (mirrors autoAssignPaidJob's own filter; only
// used here for the report's category preview).
const NON_SKILL = new Set(['materials', 'other']);

function mapSlot(raw: string | null): 'am' | 'pm' | null {
  const s = (raw || '').toLowerCase();
  if (s === 'am' || s === 'morning') return 'am';
  if (s === 'pm' || s === 'afternoon') return 'pm';
  return null;
}

function previewCategories(lineItems: any): string[] {
  return Array.from(new Set(
    (Array.isArray(lineItems) ? lineItems : [])
      .map((it: any) => it?.categorySlug || it?.category)
      .filter(Boolean)
      .map((c: any) => String(c).toLowerCase()),
  )).filter((c) => !NON_SKILL.has(c));
}

function ymd(d: Date): string { return d.toISOString().slice(0, 10); }

type Bucket =
  | 'report_completed_no_cbr'                  // any lane: completed but never booked (record gap)
  | 'auto_assigned' | 'would_auto_assign'      // dated, recent, fits
  | 'report_no_fit'                            // dated, recent, no contractor
  | 'report_date_passed'                       // dated, recent, but date in the past
  | 'report_unsupported_slot'                  // dated, recent, slot not am/pm
  | 'report_no_categories'                     // dated, recent, no assignable categories
  | 'report_old_dated'                         // dated, old / past-booked stage
  | 'flex_in_offer'                            // flexible — live slot_offer (customer deciding)
  | 'flex_sla_normalised' | 'flex_sla_ok';     // flexible — left pending

interface Row { bucket: Bucket; line: string; }

async function main() {
  const today = new Date(); today.setUTCHours(0, 0, 0, 0);
  const todayStr = ymd(today);

  console.log('================ DISPATCH BACKFILL (§4.4) ================');
  console.log(`Mode:        ${COMMIT ? '*** COMMIT (writes enabled) ***' : 'DRY-RUN (no writes)'}`);
  console.log(`Recent cutoff: paid within ${RECENT_DAYS} days ⇒ eligible to auto-assign; older ⇒ report-only`);
  console.log(`Today (UTC):   ${todayStr}\n`);

  // Load every leaked paid job (no CBR), joined to its lead for the stage signal.
  // Same pool predicate as dispatch-sweep + the test-data scrub from the analytics work.
  const res = await db.execute(sql`
    SELECT q.id, q.customer_name, q.selected_date, q.time_slot_type, q.coordinates,
           q.pricing_line_items, q.deposit_paid_at, q.flex_booking_within_days,
           COALESCE(q.base_price, q.essential_price, 0) AS price_pence,
           l.stage AS lead_stage,
           (q.completed_at IS NOT NULL) AS completed,
           (q.slot_offer IS NOT NULL)   AS has_offer,
           (q.deposit_paid_at >= (now() - (${RECENT_DAYS} || ' days')::interval)) AS is_recent
    FROM personalized_quotes q
    LEFT JOIN contractor_booking_requests cbr ON cbr.quote_id = q.id
    LEFT JOIN leads l ON l.id = q.lead_id
    WHERE q.deposit_paid_at IS NOT NULL AND cbr.id IS NULL
      AND COALESCE(q.phone,'') NOT LIKE '07700900%'
      AND q.id::text NOT LIKE 'test_q_%'
      AND COALESCE(q.email,'') NOT ILIKE '%@example.com'
      AND COALESCE(q.customer_name,'') !~* '(test|qa|phase|dummy|sample)'
    ORDER BY q.deposit_paid_at DESC`);
  const jobs = ((res as any).rows ?? res) as any[];

  // A completed quote that never got a CBR row is NOT pending work — it was fulfilled
  // (offline or some other path) without going through dispatch→payout. NEVER auto-book
  // these (would create a booking for a done job); classify them as a reconciliation gap.
  const completedNoCbr = jobs.filter((j) => j.completed);
  const active = jobs.filter((j) => !j.completed);
  const dated = active.filter((j) => j.selected_date);
  const flexible = active.filter((j) => !j.selected_date);
  console.log(`Loaded ${jobs.length} leaked paid jobs:`);
  console.log(`  ${completedNoCbr.length} completed-without-CBR (reconcile/payout gap — never booked)`);
  console.log(`  ${dated.length} active dated, ${flexible.length} active flexible (the true pending pool)\n`);

  const counts: Record<Bucket, number> = {
    report_completed_no_cbr: 0,
    auto_assigned: 0, would_auto_assign: 0, report_no_fit: 0, report_date_passed: 0,
    report_unsupported_slot: 0, report_no_categories: 0, report_old_dated: 0,
    flex_in_offer: 0, flex_sla_normalised: 0, flex_sla_ok: 0,
  };
  const samples: Row[] = [];
  const push = (bucket: Bucket, line: string) => {
    counts[bucket]++;
    if (samples.filter((s) => s.bucket === bucket).length < 6) samples.push({ bucket, line });
  };

  // ── COMPLETED-WITHOUT-CBR (reconciliation gap) ───────────────────────────────
  // Read-only: never booked, never modified. Surfaced so the operator can reconcile
  // (and later backfill payout records for genuinely-done work) — out of scope to book.
  for (const j of completedNoCbr) {
    const name = j.customer_name || j.id;
    const lane = j.selected_date ? `dated ${ymd(new Date(j.selected_date))}` : 'flexible';
    push('report_completed_no_cbr', `${name} — ${lane}, paid ${ymd(new Date(j.deposit_paid_at))}, stage=${j.lead_stage ?? '∅'} (completed, no CBR/payout record)`);
  }

  // ── DATED lane ──────────────────────────────────────────────────────────────
  for (const j of dated) {
    const name = j.customer_name || j.id;
    const cats = previewCategories(j.pricing_line_items);
    const dateStr = ymd(new Date(j.selected_date));
    const stale = !j.is_recent || PAST_BOOKED_STAGES.has(String(j.lead_stage || ''));

    if (stale) {
      push('report_old_dated', `${name} — paid ${ymd(new Date(j.deposit_paid_at))}, stage=${j.lead_stage ?? '∅'}, date ${dateStr} (likely fulfilled offline — NOT booked)`);
      continue;
    }
    if (cats.length === 0) { push('report_no_categories', `${name} — no assignable categories`); continue; }
    const slot = mapSlot(j.time_slot_type);
    if (!slot) { push('report_unsupported_slot', `${name} — slot '${j.time_slot_type}' (date ${dateStr})`); continue; }
    if (dateStr < todayStr) { push('report_date_passed', `${name} — chosen date ${dateStr} already passed (needs reschedule)`); continue; }

    let lat: number | undefined, lng: number | undefined;
    const c = j.coordinates;
    if (c && typeof c === 'object' && typeof c.lat === 'number' && typeof c.lng === 'number') { lat = c.lat; lng = c.lng; }

    try {
      const r = await autoAssignPaidJob({
        quoteId: j.id, pricingLineItems: j.pricing_line_items,
        date: new Date(`${dateStr}T00:00:00.000Z`), slot,
        pricePence: Number(j.price_pence) || 0, customerLat: lat, customerLng: lng,
        dryRun: !COMMIT,
      });
      if (r.success) {
        if (COMMIT) push('auto_assigned', `${name} [${cats.join(', ')}] → ${r.contractorName} on ${dateStr} ${slot} (booking ${r.bookingId})`);
        else push('would_auto_assign', `${name} [${cats.join(', ')}] → ${r.contractorName} on ${dateStr} ${slot}`);
      } else {
        push('report_no_fit', `${name} [${cats.join(', ')}] on ${dateStr} ${slot} — ${r.reason}`);
      }
    } catch (e: any) {
      push('report_no_fit', `${name} — THREW: ${e?.message?.slice(0, 60)}`);
    }
  }

  // ── FLEXIBLE lane ───────────────────────────────────────────────────────────
  // Never booked here (no date = nothing to commit). Just ensure the SLA clock exists
  // so the job ages visibly in the cockpit's aged-pool view.
  for (const j of flexible) {
    const name = j.customer_name || j.id;
    const within = Number(j.flex_booking_within_days) || 0;
    const { flexDeadline, slackDays } = computeSlack(j, today);
    const overdue = slackDays < 0 ? `${-slackDays}d OVERDUE` : `${slackDays}d left`;
    // A live slot_offer means the customer is mid-decision — leave it entirely alone
    // (mirrors the canonical pool reader, which excludes slot_offer jobs).
    if (j.has_offer) { push('flex_in_offer', `${name} — awaiting customer slot pick (deadline ${flexDeadline}, ${overdue})`); continue; }
    if (within <= 0) {
      if (COMMIT) {
        await db.execute(sql`
          UPDATE personalized_quotes SET flex_booking_within_days = ${SLA_DEFAULT_WINDOW_DAYS}
          WHERE id = ${j.id} AND (flex_booking_within_days IS NULL OR flex_booking_within_days <= 0)`);
      }
      push('flex_sla_normalised', `${name} — no flex window → set ${SLA_DEFAULT_WINDOW_DAYS}d (deadline ${flexDeadline}, ${overdue})`);
    } else {
      push('flex_sla_ok', `${name} — flex window ${within}d (deadline ${flexDeadline}, ${overdue})`);
    }
  }

  // ── Report ──────────────────────────────────────────────────────────────────
  const label: Record<Bucket, string> = {
    report_completed_no_cbr: 'COMPLETED without CBR — reconcile/payout gap (never booked)',
    auto_assigned:           'BOOKED (committed CBR written)',
    would_auto_assign:       'WOULD auto-book (dry-run)',
    report_no_fit:           'No fitting contractor — needs human dispatch',
    report_date_passed:      'Chosen date already passed — needs reschedule',
    report_unsupported_slot: 'Unsupported slot — needs review',
    report_no_categories:    'No assignable categories — needs review',
    report_old_dated:        'OLD/past-booked dated — report-only (likely fulfilled offline)',
    flex_in_offer:           'Flexible — awaiting customer slot pick (left alone)',
    flex_sla_normalised:     'Flexible — SLA clock normalised (left pending)',
    flex_sla_ok:             'Flexible — SLA clock already set (left pending)',
  };
  const order: Bucket[] = [
    'report_completed_no_cbr',
    'auto_assigned', 'would_auto_assign', 'report_no_fit', 'report_date_passed',
    'report_unsupported_slot', 'report_no_categories', 'report_old_dated',
    'flex_in_offer', 'flex_sla_normalised', 'flex_sla_ok',
  ];

  console.log('================ CLASSIFICATION ================');
  for (const b of order) if (counts[b]) console.log(`${String(counts[b]).padStart(3)}×  ${label[b]}`);

  console.log('\n──────────── samples (≤6 per bucket) ────────────');
  for (const b of order) {
    const rows = samples.filter((s) => s.bucket === b);
    if (!rows.length) continue;
    console.log(`\n[${label[b]}]`);
    for (const r of rows) console.log(`  • ${r.line}`);
  }

  const resolved = counts.auto_assigned + counts.would_auto_assign;
  const needHuman = counts.report_no_fit + counts.report_date_passed + counts.report_unsupported_slot + counts.report_no_categories;
  console.log('\n================ SUMMARY ================');
  console.log(`Completed-without-CBR (reconcile gap): ${counts.report_completed_no_cbr}  (read-only — never booked)`);
  console.log(`Auto-${COMMIT ? 'resolved' : 'resolvable'} (dated):  ${resolved}`);
  console.log(`Need human dispatch (dated): ${needHuman}`);
  console.log(`Report-only old (dated):     ${counts.report_old_dated}`);
  console.log(`Flexible left pending:       ${flexible.length}  (SLA normalised: ${counts.flex_sla_normalised}, in-offer: ${counts.flex_in_offer})`);
  console.log(`\nMode was ${COMMIT ? 'COMMIT — writes applied above.' : 'DRY-RUN — nothing written. Re-run with --commit to apply.'}`);
  console.log('=========================================');
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
