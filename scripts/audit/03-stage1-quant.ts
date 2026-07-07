/**
 * AUDIT TASK 3 — Stage 1 (initial call/message) quant.
 * Top-of-funnel volume by channel & month; lead→quote→paid by channel.
 * Run: npx tsx scripts/audit/03-stage1-quant.ts
 */
import { notDummy, FUNNEL, q, pct, pad } from "./lib";

// lead/call dummy filter (lighter — leads lack created_by/id-prefix signatures)
const LEAD_ND = `NOT (
   COALESCE(phone,'') LIKE '07700900%' OR COALESCE(phone,'') LIKE '+447700900%'
   OR COALESCE(phone,'') LIKE '+449900%' OR COALESCE(phone,'') LIKE '07700000%'
   OR COALESCE(customer_name,'') ILIKE '%test%' OR COALESCE(customer_name,'') ILIKE 'courtnee%'
   OR LOWER(TRIM(COALESCE(customer_name,''))) = 'ben')`;
const leadNDp = (p = "") => LEAD_ND
  .replace(/COALESCE\(phone,/g, `COALESCE(${p}phone,`)
  .replace(/COALESCE\(customer_name,/g, `COALESCE(${p}customer_name,`);

async function main() {
  // A) Lead volume by month + source (top of funnel)
  console.log("=== A) LEADS by month (total enquiries) + source mix ===");
  for (const r of await q(`
    SELECT to_char(date_trunc('month',created_at),'YYYY-MM') m, COUNT(*) n,
      COUNT(*) FILTER (WHERE source ILIKE 'voice%' OR source ILIKE 'call%') call_src,
      COUNT(*) FILTER (WHERE source ILIKE '%whatsapp%') wa_src,
      COUNT(*) FILTER (WHERE source ILIKE 'eleven%') ai_src,
      COUNT(*) FILTER (WHERE source ILIKE 'contextual%' OR source ILIKE '%web%' OR source ILIKE '%form%') web_src
    FROM leads WHERE created_at>='2026-01-01' AND ${LEAD_ND} GROUP BY 1 ORDER BY 1;`))
    console.log(`  ${r.m}  total=${pad(r.n,3)}  call=${pad(r.call_src,3)} whatsapp=${pad(r.wa_src,3)} ai=${pad(r.ai_src,3)} web/ctx=${pad(r.web_src,3)}`);

  console.log("\n=== A2) distinct lead.source values (Mar+) ===");
  for (const r of await q(`SELECT COALESCE(source,'(null)') s, COUNT(*) n FROM leads
     WHERE created_at>='2026-03-01' AND ${LEAD_ND} GROUP BY 1 ORDER BY 2 DESC;`))
    console.log(`  ${String(r.s).padEnd(20)} ${r.n}`);

  console.log("\n=== A3) lead.scored_by (channel of qualification) Mar+ ===");
  for (const r of await q(`SELECT COALESCE(scored_by,'(null)') s, COUNT(*) n FROM leads
     WHERE created_at>='2026-03-01' AND ${LEAD_ND} GROUP BY 1 ORDER BY 2 DESC;`))
    console.log(`  ${String(r.s).padEnd(20)} ${r.n}`);

  // B) Calls by month + outcome (call-channel health, missed calls)
  console.log("\n=== B) CALLS by month: total / answered / missed ===");
  for (const r of await q(`
    SELECT to_char(date_trunc('month',start_time),'YYYY-MM') m, COUNT(*) n,
      COUNT(*) FILTER (WHERE outcome IN ('NO_ANSWER','VOICEMAIL') OR status ILIKE '%no-answer%' OR status ILIKE '%missed%') missed,
      COUNT(*) FILTER (WHERE outcome IN ('INSTANT_PRICE','VIDEO_QUOTE','SITE_VISIT')) productive
    FROM calls WHERE start_time>='2026-01-01' AND ${LEAD_ND.replace(/COALESCE\(phone,/g,'COALESCE(phone_number,')} GROUP BY 1 ORDER BY 1;`))
    console.log(`  ${r.m}  total=${pad(r.n,4)}  missed=${pad(r.missed,3)} (${pct(+r.missed,+r.n)})  productive=${pad(r.productive,3)}`);

  // C) Channel funnel: lead.source -> quoted -> viewed -> paid (the conversion-by-entry-channel)
  console.log("\n=== C) CHANNEL FUNNEL (Apr+): lead source -> quote -> viewed -> paid ===");
  console.log("source            leads  quoted  quote%   viewed  paid   paid%ofViewed");
  for (const r of await q(`
    SELECT COALESCE(l.source,'(none)') src,
      COUNT(DISTINCT l.id) leads,
      COUNT(DISTINCT pq.id) quoted,
      COUNT(DISTINCT pq.id) FILTER (WHERE ${FUNNEL.viewed('pq.')}) viewed,
      COUNT(DISTINCT pq.id) FILTER (WHERE ${FUNNEL.converted('pq.')}) paid
    FROM leads l
    LEFT JOIN personalized_quotes pq ON pq.lead_id = l.id AND ${notDummy('pq.')}
    WHERE l.created_at>='2026-04-01' AND ${leadNDp('l.')}
    GROUP BY 1 HAVING COUNT(DISTINCT l.id) >= 5 ORDER BY 2 DESC;`)) {
    const ld=+r.leads,qd=+r.quoted,v=+r.viewed,p=+r.paid;
    console.log(`  ${String(r.src).padEnd(16)} ${pad(ld,5)}  ${pad(qd,6)}  ${pad(pct(qd,ld),6)}   ${pad(v,5)}  ${pad(p,4)}   ${pad(pct(p,v),9)}`);
  }

  // D) lead->quote RATE by month (are we quoting a smaller share of enquiries?)
  console.log("\n=== D) lead -> quote RATE by month ===");
  for (const r of await q(`
    SELECT to_char(date_trunc('month',l.created_at),'YYYY-MM') m,
      COUNT(DISTINCT l.id) leads, COUNT(DISTINCT pq.id) quoted
    FROM leads l LEFT JOIN personalized_quotes pq ON pq.lead_id=l.id AND ${notDummy('pq.')}
    WHERE l.created_at>='2026-02-01' AND ${leadNDp('l.')} GROUP BY 1 ORDER BY 1;`))
    console.log(`  ${r.m}  leads=${pad(r.leads,3)}  quoted=${pad(r.quoted,3)}  quote-rate=${pct(+r.quoted,+r.leads)}`);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
