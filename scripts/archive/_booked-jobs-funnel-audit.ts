/**
 * READ-ONLY analytics: decompose "booked jobs" drop month-by-month.
 *   booked_jobs = generated  ×  view_rate  ×  conversion_rate
 * Answers: (1) quote volume by month, (2) conversion by cohort, plus
 * event-based paid/booked counts (the thing actually observed dropping).
 *
 * Dummy/test rows excluded per memory (project-quote-test-data).
 */
import { db } from "../server/db";
import { sql } from "drizzle-orm";

// NULL-safe dummy filter — keep in sync with project-quote-test-data memory.
const NOT_DUMMY = `NOT (
     COALESCE(phone,'')          LIKE '07700900%'
  OR COALESCE(phone,'')          LIKE '+447700900%'
  OR COALESCE(phone,'')          LIKE '07700000%'
  OR COALESCE(id,'')             LIKE 'test_q_%'
  OR COALESCE(id,'')             LIKE 'pq_test_%'
  OR COALESCE(customer_name,'')  ILIKE '%test%'
  OR COALESCE(customer_name,'')  ILIKE 'qa %'
  OR COALESCE(created_by_name,'')ILIKE '%test%'
  OR COALESCE(created_by_name,'')ILIKE '%qa%'
  OR COALESCE(created_by_name,'')ILIKE 'phase %'
  OR COALESCE(email,'')          ILIKE '%@example.com'
  OR COALESCE(customer_name,'')  ILIKE 'courtnee%'
  OR LOWER(TRIM(COALESCE(customer_name,''))) = 'ben'
)`;

const pct = (n: number, d: number) => (d === 0 ? "  -  " : ((100 * n) / d).toFixed(1) + "%");
const pad = (s: any, w: number) => String(s).padStart(w);

async function main() {
  // 1) Funnel by quote CREATED_AT cohort
  const cohort: any = await db.execute(sql.raw(`
    SELECT
      to_char(date_trunc('month', created_at), 'YYYY-MM')                         AS month,
      COUNT(*)                                                                     AS generated,
      COUNT(*) FILTER (WHERE viewed_at IS NOT NULL OR COALESCE(view_count,0) > 0)  AS viewed,
      COUNT(*) FILTER (WHERE booked_at IS NOT NULL)                                AS booked,
      COUNT(*) FILTER (WHERE deposit_paid_at IS NOT NULL)                          AS paid
    FROM personalized_quotes
    WHERE ${NOT_DUMMY}
    GROUP BY 1 ORDER BY 1;
  `));
  const rows = cohort.rows ?? cohort;

  console.log("\n=== FUNNEL BY QUOTE CREATED-MONTH (cohort) — dummies excluded ===");
  console.log("month     gen   viewed  view%   booked  paid   paid%ofView  paid%ofGen");
  console.log("-------   ----  ------  -----   ------  ----   -----------  ----------");
  for (const r of rows) {
    const g = +r.generated, v = +r.viewed, b = +r.booked, p = +r.paid;
    console.log(
      `${r.month}  ${pad(g,4)}  ${pad(v,6)}  ${pad(pct(v,g),5)}   ${pad(b,6)}  ${pad(p,4)}   ${pad(pct(p,v),9)}    ${pad(pct(p,g),8)}`
    );
  }

  // 2) Event-based: deposits PAID in each calendar month (what "booked jobs" actually tracks)
  const paidByMonth: any = await db.execute(sql.raw(`
    SELECT to_char(date_trunc('month', deposit_paid_at),'YYYY-MM') AS month, COUNT(*) AS n
    FROM personalized_quotes
    WHERE deposit_paid_at IS NOT NULL AND ${NOT_DUMMY}
    GROUP BY 1 ORDER BY 1;
  `));
  console.log("\n=== DEPOSITS PAID by month-of-payment (event-based booked jobs) ===");
  for (const r of (paidByMonth.rows ?? paidByMonth)) console.log(`${r.month}   ${pad(r.n,4)}`);

  // 3) Event-based: booked_at in each calendar month (holds, incl. unpaid)
  const bookedByMonth: any = await db.execute(sql.raw(`
    SELECT to_char(date_trunc('month', booked_at),'YYYY-MM') AS month, COUNT(*) AS n
    FROM personalized_quotes
    WHERE booked_at IS NOT NULL AND ${NOT_DUMMY}
    GROUP BY 1 ORDER BY 1;
  `));
  console.log("\n=== booked_at by month (booking confirmed, may be unpaid) ===");
  for (const r of (bookedByMonth.rows ?? bookedByMonth)) console.log(`${r.month}   ${pad(r.n,4)}`);

  // 4) Sanity: how fast do quotes convert? (cohort-lag check for recent months)
  const lag: any = await db.execute(sql.raw(`
    SELECT
      percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (deposit_paid_at - created_at))/86400.0) AS median_days,
      percentile_cont(0.9) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (deposit_paid_at - created_at))/86400.0) AS p90_days,
      COUNT(*) AS paid_n
    FROM personalized_quotes
    WHERE deposit_paid_at IS NOT NULL AND created_at IS NOT NULL AND ${NOT_DUMMY};
  `));
  const l = (lag.rows ?? lag)[0];
  console.log(`\n=== created→paid lag: median ${(+l.median_days).toFixed(1)}d, p90 ${(+l.p90_days).toFixed(1)}d (n=${l.paid_n}) ===`);

  // 5) Total rows + dummy count, to confirm table is clean
  const totals: any = await db.execute(sql.raw(`
    SELECT
      COUNT(*) AS total_rows,
      COUNT(*) FILTER (WHERE NOT (${NOT_DUMMY})) AS dummy_rows
    FROM personalized_quotes;
  `));
  const t = (totals.rows ?? totals)[0];
  console.log(`\n=== table totals: ${t.total_rows} rows, ${t.dummy_rows} still match dummy filter ===\n`);

  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
