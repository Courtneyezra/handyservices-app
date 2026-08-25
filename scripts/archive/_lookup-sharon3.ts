import "dotenv/config";
import { db } from "../server/db";
async function main() {
  const res: any = await db.execute(`select * from handyman_profiles where id = 'hp_aa21264a-9143-4116-bda2-2da998255929'` as any);
  const r = res.rows?.[0] ?? res[0];
  for (const k of Object.keys(r)) {
    const v = r[k];
    if (v === null || v === '') continue;
    const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
    if (s.length > 200) continue;
    console.log(`${k}: ${s}`);
  }
  process.exit(0);
}
main().catch(e => { console.error("ERR:", e.message); process.exit(1); });
