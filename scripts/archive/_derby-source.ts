import { db } from "../server/db";
import { leads } from "../shared/schema";
import { sql } from "drizzle-orm";

function region(pc: string | null | undefined) {
  if (!pc) return "UNKNOWN";
  const up = pc.trim().toUpperCase();
  if (/^DE\d/.test(up)) return "DERBY";
  if (/^NG\d/.test(up)) return "NOTTS";
  return "OTHER";
}

async function main() {
  const ls = await db.select({
    postcode: leads.postcode, source: leads.source, phone: leads.phone,
    customerName: leads.customerName, createdAt: leads.createdAt,
  }).from(leads);

  const bySourceRegion: Record<string, Record<string, number>> = {};
  for (const l of ls) {
    const phone = (l.phone || "").replace(/\s/g, "");
    if (/07700900\d{3}/.test(phone)) continue;
    if (/\b(test|qa|phase|dummy|demo)\b/i.test(l.customerName || "")) continue;
    const r = region(l.postcode);
    const s = l.source || "(none)";
    bySourceRegion[s] = bySourceRegion[s] || {};
    bySourceRegion[s][r] = (bySourceRegion[s][r] || 0) + 1;
  }

  console.log("\n=== LEAD SOURCE x REGION ===");
  console.log("source".padEnd(22), "DERBY".padStart(7), "NOTTS".padStart(7), "OTHER".padStart(7), "UNKNOWN".padStart(8));
  for (const s of Object.keys(bySourceRegion).sort()) {
    const r = bySourceRegion[s];
    console.log(s.padEnd(22), String(r.DERBY||0).padStart(7), String(r.NOTTS||0).padStart(7), String(r.OTHER||0).padStart(7), String(r.UNKNOWN||0).padStart(8));
  }
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
