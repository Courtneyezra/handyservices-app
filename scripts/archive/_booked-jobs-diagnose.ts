/** READ-ONLY follow-up diagnostics for the booked-jobs drop. */
import { db } from "../server/db";
import { sql } from "drizzle-orm";

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
const pad = (s: any, w: number) => String(s).padStart(w);
const pct = (n: number, d: number) => (d === 0 ? "  -  " : ((100 * n) / d).toFixed(1) + "%");

async function q(text: string) {
  const r: any = await db.execute(sql.raw(text));
  return r.rows ?? r;
}

async function main() {
  // A) Weekly funnel Mar–now
  console.log("\n=== WEEKLY FUNNEL (Mar 1 → now) ===");
  console.log("week-start   gen  viewed view%   paid  paid%ofView");
  for (const r of await q(`
    SELECT to_char(date_trunc('week', created_at),'YYYY-MM-DD') AS wk,
           COUNT(*) gen,
           COUNT(*) FILTER (WHERE viewed_at IS NOT NULL OR COALESCE(view_count,0)>0) viewed,
           COUNT(*) FILTER (WHERE deposit_paid_at IS NOT NULL) paid
    FROM personalized_quotes
    WHERE created_at >= '2026-03-01' AND ${NOT_DUMMY}
    GROUP BY 1 ORDER BY 1;`)) {
    const g=+r.gen,v=+r.viewed,p=+r.paid;
    console.log(`${r.wk}   ${pad(g,3)}  ${pad(v,5)}  ${pad(pct(v,g),5)}  ${pad(p,4)}  ${pad(pct(p,v),9)}`);
  }

  // B) May never-viewed quotes — who created them, what segment, which days
  console.log("\n=== MAY never-viewed: by creator ===");
  for (const r of await q(`
    SELECT COALESCE(created_by_name,'(null)') creator, COUNT(*) n
    FROM personalized_quotes
    WHERE created_at >= '2026-05-01' AND created_at < '2026-06-01'
      AND viewed_at IS NULL AND COALESCE(view_count,0)=0 AND ${NOT_DUMMY}
    GROUP BY 1 ORDER BY 2 DESC;`)) console.log(`  ${pad(r.n,3)}  ${r.creator}`);

  console.log("\n=== MAY never-viewed: by day ===");
  for (const r of await q(`
    SELECT to_char(created_at,'YYYY-MM-DD') d, COUNT(*) n
    FROM personalized_quotes
    WHERE created_at >= '2026-05-01' AND created_at < '2026-06-01'
      AND viewed_at IS NULL AND COALESCE(view_count,0)=0 AND ${NOT_DUMMY}
    GROUP BY 1 ORDER BY 1;`)) console.log(`  ${r.d}  ${pad(r.n,3)}`);

  console.log("\n=== MAY never-viewed: sample 12 ===");
  for (const r of await q(`
    SELECT to_char(created_at,'MM-DD HH24:MI') t, LEFT(customer_name,18) nm, LEFT(COALESCE(phone,''),16) ph,
           COALESCE(segment,'') seg, COALESCE(created_by_name,'') cb
    FROM personalized_quotes
    WHERE created_at >= '2026-05-01' AND created_at < '2026-06-01'
      AND viewed_at IS NULL AND COALESCE(view_count,0)=0 AND ${NOT_DUMMY}
    ORDER BY created_at LIMIT 12;`))
    console.log(`  ${r.t} | ${pad(r.nm,18)} | ${pad(r.ph,16)} | ${pad(r.seg,10)} | ${r.cb}`);

  // C) April paid — genuine? by creator + sample
  console.log("\n=== APRIL paid: by creator ===");
  for (const r of await q(`
    SELECT COALESCE(created_by_name,'(null)') creator, COUNT(*) n
    FROM personalized_quotes
    WHERE deposit_paid_at >= '2026-04-01' AND deposit_paid_at < '2026-05-01' AND ${NOT_DUMMY}
    GROUP BY 1 ORDER BY 2 DESC;`)) console.log(`  ${pad(r.n,3)}  ${r.creator}`);

  console.log("\n=== APRIL paid: sample 12 (name/phone/amount) ===");
  for (const r of await q(`
    SELECT to_char(deposit_paid_at,'MM-DD') d, LEFT(customer_name,18) nm, LEFT(COALESCE(phone,''),16) ph,
           COALESCE(base_price,0)/100 gbp
    FROM personalized_quotes
    WHERE deposit_paid_at >= '2026-04-01' AND deposit_paid_at < '2026-05-01' AND ${NOT_DUMMY}
    ORDER BY deposit_paid_at LIMIT 12;`))
    console.log(`  ${r.d} | ${pad(r.nm,18)} | ${pad(r.ph,16)} | £${r.gbp}`);

  // D) Conversion by segment, Apr vs May+Jun — is the drop concentrated?
  console.log("\n=== paid%ofViewed by segment: April vs May+June ===");
  for (const r of await q(`
    WITH base AS (
      SELECT COALESCE(segment,'UNKNOWN') seg,
        CASE WHEN created_at < '2026-05-01' THEN 'Apr' ELSE 'MayJun' END period,
        (viewed_at IS NOT NULL OR COALESCE(view_count,0)>0) viewed,
        (deposit_paid_at IS NOT NULL) paid
      FROM personalized_quotes
      WHERE created_at >= '2026-04-01' AND ${NOT_DUMMY}
    )
    SELECT seg, period, COUNT(*) FILTER (WHERE viewed) v, COUNT(*) FILTER (WHERE paid) p
    FROM base GROUP BY seg, period ORDER BY seg, period;`)) {
    console.log(`  ${pad(r.seg,12)} ${pad(r.period,6)}  viewed=${pad(r.v,3)} paid=${pad(r.p,3)}  ${pct(+r.p,+r.v)}`);
  }

  process.exit(0);
}
main().catch((e)=>{console.error(e);process.exit(1);});
