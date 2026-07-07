/**
 * LEARN CATALOG TIMES — the two-rail model's "refine via contractor actuals" loop.
 *
 * Reads completed contractor bookings (which carry a real measured on-site duration in
 * `time_on_job_seconds` from the field work-timer), attributes that time across the job's
 * SKU line items, and rolls it into `service_catalog.actual_minutes_per_unit` (+ sample
 * count). The dispatch TIME rail then prefers `actual_minutes_per_unit` over the authored
 * estimate — so day-planning self-corrects from reality instead of trade-norm guesses.
 *
 * Safe + idempotent-ish: it recomputes a rolling mean per run. Intended to run on a
 * schedule (e.g. nightly) or on demand:  npx tsx scripts/learn-catalog-times.ts
 *
 * NOTE: dormant until jobs complete through the timer (today: 0 completed bookings). The
 * attribution heuristic + per-shape semantics below are v1 and should be revisited once
 * real completion data exists to validate them.
 */
import { db } from "../server/db";
import { serviceCatalog } from "../shared/schema";
import { sql, eq } from "drizzle-orm";

type Row = typeof serviceCatalog.$inferSelect;

// Authored on-site minutes for a SKU line at a given quantity (pre-buffer), by shape.
function authoredMinutes(row: Row, qty: number): number {
  if (row.shape === "fixed") return row.scheduleMinutes ?? 0;
  if (row.shape === "per_unit") return (row.setupMinutes ?? 0) + (row.minutesPerUnit ?? 0) * qty;
  if (row.shape === "tiered" && Array.isArray(row.tiers) && row.tiers.length) {
    return row.tiers[Math.floor(row.tiers.length / 2)].scheduleMinutes ?? 0; // median tier
  }
  return 0;
}

(async () => {
  const catalog = await db.select().from(serviceCatalog);
  const bySku = new Map(catalog.map((r) => [r.skuCode, r]));

  // Completed bookings with a measured duration + their quote's line items.
  const res: any = await db.execute(sql`
    SELECT cbr.id, cbr.time_on_job_seconds AS secs, pq.pricing_line_items AS lines
    FROM contractor_booking_requests cbr
    JOIN personalized_quotes pq ON pq.id = cbr.quote_id
    WHERE cbr.completed_at IS NOT NULL AND cbr.time_on_job_seconds > 0
      AND pq.pricing_line_items IS NOT NULL`);
  const bookings = (res.rows ?? res) as { id: string; secs: number; lines: any[] }[];

  if (!bookings.length) {
    console.log("No completed bookings with measured time yet — learning loop is ready but dormant.");
    console.log("(It will start refining service_catalog.actual_minutes_per_unit once jobs complete through the field timer.)");
    process.exit(0);
  }

  // Accumulate per-SKU observations of realistic minutes-per-unit (fixed → whole-job @ qty 1).
  const obs = new Map<string, number[]>();
  for (const b of bookings) {
    const lines = (b.lines ?? []).filter((l) => l?.skuCode && bySku.has(l.skuCode));
    if (!lines.length) continue;
    const withAuthored = lines.map((l) => {
      const row = bySku.get(l.skuCode)!;
      const qty = Number(l.unitCount ?? l.quantity ?? 1) || 1;
      return { l, row, qty, authored: authoredMinutes(row, qty) };
    });
    const totalAuthored = withAuthored.reduce((a, x) => a + x.authored, 0) || 1;
    const totalActualMin = b.secs / 60;
    for (const { row, qty, authored } of withAuthored) {
      const attributed = totalActualMin * (authored / totalAuthored); // split by authored share
      // per_unit → strip setup then divide by qty; fixed/tiered → whole-job minutes
      const perUnitObs = row.shape === "per_unit"
        ? Math.max(0, attributed - (row.setupMinutes ?? 0)) / qty
        : attributed;
      (obs.get(row.skuCode) ?? obs.set(row.skuCode, []).get(row.skuCode)!).push(perUnitObs);
    }
  }

  let updated = 0;
  for (const [skuCode, samples] of obs) {
    const row = bySku.get(skuCode)!;
    const priorN = row.actualSampleCount ?? 0;
    const priorMean = row.actualMinutesPerUnit ?? 0;
    const newN = priorN + samples.length;
    const sampleSum = samples.reduce((a, x) => a + x, 0);
    const newMean = Math.round((priorMean * priorN + sampleSum) / newN); // rolling mean
    await db.update(serviceCatalog)
      .set({ actualMinutesPerUnit: newMean, actualSampleCount: newN, updatedAt: new Date() })
      .where(eq(serviceCatalog.skuCode, skuCode));
    updated++;
  }

  console.log(`Processed ${bookings.length} completed bookings → refined ${updated} SKUs' actual_minutes_per_unit.`);
  process.exit(0);
})().catch((e) => { console.error("ERR", e.message); process.exit(1); });
