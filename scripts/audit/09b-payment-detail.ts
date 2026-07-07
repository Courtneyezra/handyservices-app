/**
 * AUDIT TASK 9b — isolate quote-deposit PaymentIntents + split April pre/post Apr 28 (change-point F).
 */
import dotenv from "dotenv"; dotenv.config();
import Stripe from "stripe";
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
const gte = Math.floor(+new Date("2026-03-01")/1000), lte = Math.floor(+new Date("2026-06-15")/1000);
const pc = (n:number,d:number)=> d?(100*n/d).toFixed(0)+"%":"-";

async function main() {
  type PI = { date: string; amount: number; ok: boolean; desc: string; metaKeys: string; isQuote: boolean };
  const pis: PI[] = []; let n = 0;
  for await (const pi of stripe.paymentIntents.list({ created:{gte,lte}, limit:100 })) {
    const meta = pi.metadata || {};
    const metaKeys = Object.keys(meta).join(",");
    const desc = (pi.description || "").toLowerCase();
    const isQuote = /quote|deposit|slug|booking/.test(metaKeys.toLowerCase()) || /quote|deposit/.test(desc) || !!(meta.quoteId||meta.quote_id||meta.shortSlug||meta.slug);
    pis.push({ date:new Date(pi.created*1000).toISOString().slice(0,10), amount:pi.amount, ok:pi.status==="succeeded", desc, metaKeys, isQuote });
    if (++n>=3000) break;
  }
  console.log(`fetched ${pis.length} PIs`);

  // what metadata/description do PIs carry? (to understand the flows)
  console.log("\n=== distinct metadata-key sets (top) ===");
  const mk: Record<string,number> = {}; for (const p of pis) mk[p.metaKeys||"(none)"]=(mk[p.metaKeys||"(none)"]||0)+1;
  Object.entries(mk).sort((a,b)=>b[1]-a[1]).slice(0,10).forEach(([k,v])=>console.log(`  ${v}  [${k}]`));
  console.log("\n=== sample descriptions ===");
  [...new Set(pis.map(p=>p.desc).filter(Boolean))].slice(0,8).forEach(d=>console.log(`  ${d.slice(0,70)}`));

  const quote = pis.filter(p=>p.isQuote);
  console.log(`\nquote-deposit PIs: ${quote.length} of ${pis.length}`);

  // success rate of QUOTE PIs by amount band x period, splitting April at Apr 28 (F)
  const periods: [string,(d:string)=>boolean][] = [
    ["Mar",        d=>d<"2026-04-01"],
    ["Apr 1-27",   d=>d>="2026-04-01"&&d<"2026-04-28"],
    ["Apr 28-30 (F)", d=>d>="2026-04-28"&&d<"2026-05-01"],
    ["May",        d=>d>="2026-05-01"&&d<"2026-06-01"],
    ["Jun",        d=>d>="2026-06-01"],
  ];
  const big = (p:PI)=>p.amount>=15000; // £150+ deposit ~ big job
  console.log("\n=== QUOTE-deposit PI success rate, BIG (≥£150) vs small, by period ===");
  console.log("period            BIG: ok/created  rate     small: ok/created  rate");
  for (const [lbl,f] of periods) {
    const g = quote.filter(p=>f(p.date)); const b=g.filter(big), s=g.filter(p=>!big(p));
    console.log(`  ${lbl.padEnd(16)} ${String(b.filter(p=>p.ok).length+"/"+b.length).padStart(10)}  ${pc(b.filter(p=>p.ok).length,b.length).padStart(5)}     ${String(s.filter(p=>p.ok).length+"/"+s.length).padStart(10)}  ${pc(s.filter(p=>p.ok).length,s.length).padStart(5)}`);
  }
  // also ALL PIs (not just quote) big vs small, same periods — in case isQuote misses some
  console.log("\n=== ALL PIs (fallback) success rate, BIG (≥£150) vs small, by period ===");
  for (const [lbl,f] of periods) {
    const g = pis.filter(p=>f(p.date)); const b=g.filter(big), s=g.filter(p=>!big(p));
    console.log(`  ${lbl.padEnd(16)} ${String(b.filter(p=>p.ok).length+"/"+b.length).padStart(10)}  ${pc(b.filter(p=>p.ok).length,b.length).padStart(5)}     ${String(s.filter(p=>p.ok).length+"/"+s.length).padStart(10)}  ${pc(s.filter(p=>p.ok).length,s.length).padStart(5)}`);
  }
  process.exit(0);
}
main().catch((e)=>{console.error("STRIPE ERROR:",e.message);process.exit(1);});
