import { db } from "../server/db";
import { personalizedQuotes, leads } from "../shared/schema";
import { sql } from "drizzle-orm";

// Region from postcode outward code. DE* = Derby, NG* = Nottingham.
function region(pc: string | null | undefined): "DERBY" | "NOTTS" | "OTHER" | "UNKNOWN" {
  if (!pc) return "UNKNOWN";
  const up = pc.trim().toUpperCase();
  if (/^DE\d/.test(up)) return "DERBY";
  if (/^NG\d/.test(up)) return "NOTTS";
  if (up === "") return "UNKNOWN";
  return "OTHER";
}

// Test/dummy scrubber (per project quote-test-data rules)
function isTest(q: { id: string; phone?: string | null; customerName?: string | null; email?: string | null }): boolean {
  const phone = (q.phone || "").replace(/\s/g, "");
  const name = (q.customerName || "").toLowerCase();
  const email = (q.email || "").toLowerCase();
  if (q.id.startsWith("test_q_")) return true;
  if (/07700900\d{3}/.test(phone)) return true;
  if (email.includes("@example.com")) return true;
  if (/\b(test|qa|phase|dummy|demo)\b/.test(name)) return true;
  return false;
}

async function main() {
  const qs = await db
    .select({
      id: personalizedQuotes.id,
      postcode: personalizedQuotes.postcode,
      phone: personalizedQuotes.phone,
      customerName: personalizedQuotes.customerName,
      email: personalizedQuotes.email,
      basePrice: personalizedQuotes.basePrice,
      viewedAt: personalizedQuotes.viewedAt,
      depositPaidAt: personalizedQuotes.depositPaidAt,
      createdAt: personalizedQuotes.createdAt,
      segment: personalizedQuotes.segment,
    })
    .from(personalizedQuotes);

  const clean = qs.filter((q) => !isTest(q));

  type Agg = {
    generated: number;
    viewed: number;
    paid: number;
    labourGenPence: number;
    labourPaidPence: number;
    paidPrices: number[];
  };
  const init = (): Agg => ({ generated: 0, viewed: 0, paid: 0, labourGenPence: 0, labourPaidPence: 0, paidPrices: [] });
  const byRegion: Record<string, Agg> = { DERBY: init(), NOTTS: init(), OTHER: init(), UNKNOWN: init() };

  // monthly Derby vs Notts paid counts
  const monthly: Record<string, { DERBY: number; NOTTS: number }> = {};

  for (const q of clean) {
    const r = region(q.postcode);
    const a = byRegion[r];
    a.generated++;
    const price = q.basePrice || 0;
    a.labourGenPence += price;
    if (q.viewedAt) a.viewed++;
    if (q.depositPaidAt) {
      a.paid++;
      a.labourPaidPence += price;
      a.paidPrices.push(price);
      const m = q.depositPaidAt.toISOString().slice(0, 7);
      monthly[m] = monthly[m] || { DERBY: 0, NOTTS: 0 };
      if (r === "DERBY") monthly[m].DERBY++;
      if (r === "NOTTS") monthly[m].NOTTS++;
    }
  }

  const gbp = (p: number) => "£" + (p / 100).toLocaleString("en-GB", { maximumFractionDigits: 0 });
  const median = (arr: number[]) => {
    if (!arr.length) return 0;
    const s = [...arr].sort((a, b) => a - b);
    const mid = Math.floor(s.length / 2);
    return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
  };

  console.log("\n=== QUOTES: DERBY vs NOTTINGHAM (test data scrubbed) ===");
  console.log(`Total clean quotes: ${clean.length} (raw: ${qs.length}, test removed: ${qs.length - clean.length})\n`);

  const rows = ["DERBY", "NOTTS", "OTHER", "UNKNOWN"];
  console.log(
    "Region".padEnd(9),
    "Gen".padStart(6),
    "View".padStart(6),
    "Paid".padStart(6),
    "View%".padStart(7),
    "Paid%v".padStart(8),
    "Labour won".padStart(13),
    "Med job".padStart(10),
  );
  for (const r of rows) {
    const a = byRegion[r];
    const viewPct = a.generated ? ((a.viewed / a.generated) * 100).toFixed(0) + "%" : "-";
    const paidPct = a.viewed ? ((a.paid / a.viewed) * 100).toFixed(0) + "%" : "-";
    console.log(
      r.padEnd(9),
      String(a.generated).padStart(6),
      String(a.viewed).padStart(6),
      String(a.paid).padStart(6),
      viewPct.padStart(7),
      paidPct.padStart(8),
      gbp(a.labourPaidPence).padStart(13),
      gbp(median(a.paidPrices)).padStart(10),
    );
  }

  console.log("\n=== MONTHLY PAID JOBS (Derby vs Notts) ===");
  for (const m of Object.keys(monthly).sort()) {
    console.log(m, " Derby:", String(monthly[m].DERBY).padStart(3), " Notts:", String(monthly[m].NOTTS).padStart(3));
  }

  // Leads (top of funnel) by region
  const ls = await db
    .select({ postcode: leads.postcode, phone: leads.phone, customerName: leads.customerName, createdAt: leads.createdAt })
    .from(leads);
  const leadReg: Record<string, number> = { DERBY: 0, NOTTS: 0, OTHER: 0, UNKNOWN: 0 };
  for (const l of ls) {
    const phone = (l.phone || "").replace(/\s/g, "");
    if (/07700900\d{3}/.test(phone)) continue;
    if (/\b(test|qa|phase|dummy|demo)\b/i.test(l.customerName || "")) continue;
    leadReg[region(l.postcode)]++;
  }
  console.log("\n=== LEADS (top of funnel) by region ===");
  for (const r of rows) console.log(r.padEnd(9), leadReg[r]);
  console.log("Total leads:", ls.length);

  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
