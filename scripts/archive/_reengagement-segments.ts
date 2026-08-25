/**
 * Re-engagement campaign — segment the existing customer base.
 * Past PAYERS only (deposit_paid_at set), test data scrubbed, one row per
 * customer (normalized phone, else email). Read-only.
 *   npx tsx scripts/_reengagement-segments.ts
 */
import { db } from "../server/db";
import { sql } from "drizzle-orm";

const natPhone = (s: string | null): string | null => {
  if (!s) return null;
  let x = s.replace(/[^\d]/g, "");
  if (x.startsWith("44") && x.length === 12) x = x.slice(2);
  else if (x.startsWith("0") && x.length === 11) x = x.slice(1);
  return x.length === 10 && x.startsWith("7") ? x : null;
};

const isTest = (r: any): boolean => {
  const p = (r.phone || "").replace(/[^\d]/g, "");
  if (p.includes("7700900")) return true;
  if ((r.id || "").startsWith("test_q_")) return true;
  if (/\b(test|qa|phase|dummy|demo)\b/i.test(r.customer_name || "")) return true;
  if (/@example\.com$/i.test(r.email || "")) return true;
  return false;
};

(async () => {
  const rows: any[] = (
    await db.execute(sql`
      SELECT id, customer_name, phone, email, postcode, customer_type,
             ownership_context, deposit_paid_at, completed_at,
             selected_tier_price_pence, base_price, vertical,
             job_description
      FROM personalized_quotes
      WHERE deposit_paid_at IS NOT NULL`)
  ).rows;

  const clean = rows.filter((r) => !isTest(r));
  const skipped = rows.length - clean.length;

  type Cust = {
    name: string; phone: string | null; email: string | null;
    postcode: string | null; types: Set<string>; jobs: number;
    totalPence: number; lastPaid: Date; firstPaid: Date; completed: number;
  };
  const custs = new Map<string, Cust>();
  for (const r of clean) {
    const key = natPhone(r.phone) || (r.email || "").toLowerCase().trim() || r.id;
    const paid = new Date(r.deposit_paid_at);
    const val = r.selected_tier_price_pence ?? r.base_price ?? 0;
    const c = custs.get(key);
    if (!c) {
      custs.set(key, {
        name: r.customer_name, phone: natPhone(r.phone), email: r.email || null,
        postcode: r.postcode || null,
        types: new Set(r.customer_type ? [r.customer_type] : []),
        jobs: 1, totalPence: val, lastPaid: paid, firstPaid: paid,
        completed: r.completed_at ? 1 : 0,
      });
    } else {
      c.jobs += 1; c.totalPence += val;
      if (r.customer_type) c.types.add(r.customer_type);
      if (paid > c.lastPaid) c.lastPaid = paid;
      if (paid < c.firstPaid) c.firstPaid = paid;
      if (r.completed_at) c.completed += 1;
      if (!c.email && r.email) c.email = r.email;
    }
  }

  const now = Date.now();
  const days = (d: Date) => Math.floor((now - d.getTime()) / 86400000);
  const recBand = (d: number) =>
    d <= 90 ? "0-90d" : d <= 180 ? "91-180d" : d <= 365 ? "181-365d" : ">365d";
  const valBand = (p: number) => {
    const gbp = p / 100;
    return gbp < 200 ? "<£200" : gbp < 500 ? "£200-500" : gbp < 1000 ? "£500-1k" : "£1k+";
  };

  const list = [...custs.values()];
  const count = (fn: (c: Cust) => string) => {
    const m = new Map<string, number>();
    for (const c of list) m.set(fn(c), (m.get(fn(c)) || 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  };

  console.log(`PAID QUOTES: ${rows.length} rows (${skipped} test rows scrubbed)`);
  console.log(`UNIQUE PAYING CUSTOMERS: ${list.length}`);
  console.log(`  with phone: ${list.filter((c) => c.phone).length}, with email: ${list.filter((c) => c.email).length}, both: ${list.filter((c) => c.phone && c.email).length}`);
  console.log(`\nRECENCY (last paid job):`);
  for (const [k, v] of count((c) => recBand(days(c.lastPaid)))) console.log(`  ${k}: ${v}`);
  console.log(`\nCUSTOMER TYPE:`);
  for (const [k, v] of count((c) => [...c.types].sort().join("+") || "(unset)")) console.log(`  ${k}: ${v}`);
  console.log(`\nREPEAT vs ONE-OFF:`);
  for (const [k, v] of count((c) => (c.jobs > 1 ? `repeat (${c.jobs >= 3 ? "3+" : "2"} jobs)` : "one job"))) console.log(`  ${k}: ${v}`);
  console.log(`\nLIFETIME VALUE BAND:`);
  for (const [k, v] of count((c) => valBand(c.totalPence))) console.log(`  ${k}: ${v}`);

  // Cross-tab: recency x repeat — the campaign's priority grid
  console.log(`\nGRID recency × repeat:`);
  const grid = new Map<string, number>();
  for (const c of list) {
    const k = `${recBand(days(c.lastPaid))} | ${c.jobs > 1 ? "repeat" : "one-off"}`;
    grid.set(k, (grid.get(k) || 0) + 1);
  }
  for (const [k, v] of [...grid.entries()].sort()) console.log(`  ${k}: ${v}`);

  // For context: the un-converted universe (recovery agent's lane, NOT this campaign)
  const unconv: any = await db.execute(sql`
    SELECT COUNT(DISTINCT COALESCE(NULLIF(regexp_replace(phone,'[^0-9]','','g'),''), lower(email))) AS n
    FROM personalized_quotes
    WHERE deposit_paid_at IS NULL AND viewed_at IS NOT NULL
      AND phone NOT LIKE '%7700900%' AND id NOT LIKE 'test_q_%'
      AND (email IS NULL OR email NOT ILIKE '%@example.com')`);
  console.log(`\n(context) viewed-but-never-paid customers: ${unconv.rows[0].n} — recovery agent's lane, exclude from this campaign`);
  process.exit(0);
})();
