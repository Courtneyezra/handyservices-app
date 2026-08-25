import { db } from "../server/db";
import { sql } from "drizzle-orm";
import { writeFileSync } from "fs";

function normPhone(p: string | null): string {
  if (!p) return '';
  let s = p.replace(/[^0-9+]/g, '');
  if (s.startsWith('0')) s = '+44' + s.slice(1);
  if (s.startsWith('44')) s = '+' + s;
  return s;
}

// national digits for WhatsApp search (strip +44 / leading 0)
function natDigits(p: string | null): string {
  const n = normPhone(p);
  if (n.startsWith('+44')) return n.slice(3);
  if (n.startsWith('+')) return n.slice(1);
  return n;
}

async function main() {
  const rows = await db.execute(sql`
    SELECT id, customer_name, phone, segment, base_price, short_slug,
           created_at::date AS created,
           viewed_at, view_count, deposit_paid_at
    FROM personalized_quotes
    WHERE created_at >= '2026-04-01' AND created_at < '2026-06-01'
      AND (viewed_at IS NOT NULL OR view_count > 0)
      AND deposit_paid_at IS NULL
    ORDER BY base_price DESC NULLS LAST
  `);
  const data = rows.rows as any[];

  const lines: string[] = [];
  lines.push(`# WhatsApp ↔ Quote Cross-Reference — 2026-06-04`);
  lines.push(``);
  lines.push(`Cohort: viewed-but-unpaid quotes, Apr 1 – May 31 2026 (deposit metric). **${data.length} rows.**`);
  lines.push(``);
  lines.push(`Outcome codes: **DROPPED** (we owed next step, went silent) · **STALLED** (soft-deferred, no nudge) · **DECLINED** · **CASH** (wants cash on day — invisible to deposit metric) · **INPROGRESS** · **NOCONTACT** (empty thread) · **BOOKED-ELSE** · **JUNK** (bad phone/contractor/dummy) · **_pending_**`);
  lines.push(``);
  lines.push(`| £ | slug | search | phone | name | created | v | Outcome | Notes |`);
  lines.push(`|---:|---|---|---|---|---|---:|---|---|`);
  for (const r of data) {
    const pounds = r.base_price ? Math.round(r.base_price / 100) : 0;
    const slug = r.short_slug || '';
    const phone = normPhone(r.phone);
    const search = natDigits(r.phone);
    const name = (r.customer_name || '').replace(/\|/g, '/');
    lines.push(`| ${pounds} | ${slug} | ${search} | ${phone} | ${name} | ${r.created} | ${r.view_count || 0} | _pending_ |  |`);
  }
  lines.push(``);

  const out = "/Users/courtneebonnick/v6-switchboard/WhatsApp_Quote_CrossRef_2026-06-04.md";
  writeFileSync(out, lines.join("\n"));
  console.log(`wrote ${data.length} rows → ${out}`);
  console.log(`base_price sanity — first raw value: ${data[0]?.base_price}`);
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
