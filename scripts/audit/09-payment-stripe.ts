/**
 * AUDIT TASK 9 — payment-step funnel via Stripe (the DB can't show checkout abandonment).
 * PaymentIntents created-but-not-succeeded = reached payment, didn't complete.
 * Tests: did BIG deposits start failing/abandoning after Apr 28 (Apple/Google Pay)?
 * Run: npx tsx scripts/audit/09-payment-stripe.ts
 */
import dotenv from "dotenv"; dotenv.config();
import Stripe from "stripe";

const KEY = process.env.STRIPE_SECRET_KEY!;
const stripe = new Stripe(KEY);
const gte = Math.floor(+new Date("2026-03-01") / 1000);
const lte = Math.floor(+new Date("2026-06-15") / 1000);

const band = (p: number) => p < 5000 ? "1 <£50" : p < 10000 ? "2 £50-100" : p < 20000 ? "3 £100-200" : "4 £200+";
const pc = (n: number, d: number) => d ? (100 * n / d).toFixed(0) + "%" : "-";

async function main() {
  console.log(`stripe key mode: ${KEY.startsWith("sk_live") ? "LIVE" : "TEST"}`);
  type PI = { month: string; amount: number; ok: boolean; methods: string };
  const pis: PI[] = [];
  let count = 0;
  for await (const pi of stripe.paymentIntents.list({ created: { gte, lte }, limit: 100 })) {
    pis.push({
      month: new Date(pi.created * 1000).toISOString().slice(0, 7),
      amount: pi.amount,
      ok: pi.status === "succeeded",
      methods: (pi.payment_method_types || []).join("+"),
    });
    if (++count >= 3000) break;
  }
  console.log(`fetched ${pis.length} payment intents (Mar–Jun)\n`);

  // A) success rate by month (created -> succeeded)
  console.log("=== A) PaymentIntent success rate by month (succeeded / created) ===");
  const months = [...new Set(pis.map(p => p.month))].sort();
  for (const m of months) {
    const g = pis.filter(p => p.month === m);
    console.log(`  ${m}  created=${String(g.length).padStart(3)}  succeeded=${String(g.filter(p=>p.ok).length).padStart(3)}  rate=${pc(g.filter(p=>p.ok).length, g.length)}`);
  }

  // B) success rate by amount band x month — the big-deposit test
  console.log("\n=== B) success rate by DEPOSIT BAND x month (the big-deposit test) ===");
  const bands = ["1 <£50","2 £50-100","3 £100-200","4 £200+"];
  console.log("band         " + months.map(m=>m.slice(5)).map(m=>("M"+m).padEnd(11)).join(""));
  for (const b of bands) {
    const cells = months.map(m => { const g = pis.filter(p => p.month===m && band(p.amount)===b);
      return `${g.filter(p=>p.ok).length}/${g.length} ${pc(g.filter(p=>p.ok).length,g.length)}`.padEnd(11); });
    console.log(b.padEnd(12) + cells.join(""));
  }

  // C) payment method types present (did Apple/Google Pay appear ~Apr 28?)
  console.log("\n=== C) payment_method_types seen by month ===");
  for (const m of months) {
    const g = pis.filter(p => p.month === m);
    const set: Record<string, number> = {};
    for (const p of g) set[p.methods] = (set[p.methods]||0)+1;
    console.log(`  ${m}  ${Object.entries(set).map(([k,v])=>`${k}:${v}`).join("  ")}`);
  }
  process.exit(0);
}
main().catch((e) => { console.error("STRIPE ERROR:", e.message); process.exit(1); });
