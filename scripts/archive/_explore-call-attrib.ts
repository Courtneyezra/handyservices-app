import { db } from "../server/db";
import { sql } from "drizzle-orm";

async function main() {
  console.log("=== USERS (potential quoters/handlers) ===");
  const users = await db.execute(sql`
    SELECT id, first_name, last_name, email, role
    FROM users
    ORDER BY created_at NULLS LAST
  `);
  for (const u of users.rows as any[]) {
    console.log(`${u.id}  | ${u.first_name ?? ''} ${u.last_name ?? ''} | ${u.email ?? ''} | role=${u.role ?? ''}`);
  }

  console.log("\n=== VA ENDPOINTS ===");
  const eps = await db.execute(sql`SELECT id, user_id, sip_address, display_name, active FROM va_endpoints`);
  for (const e of eps.rows as any[]) console.log(`${e.display_name} | user=${e.user_id} | ${e.sip_address} | active=${e.active}`);

  console.log("\n=== CALLS since 2026-07-20: handled_by x user attribution ===");
  const g = await db.execute(sql`
    SELECT handled_by,
           handled_by_user_id,
           count(*) AS n,
           count(*) FILTER (WHERE ai_scored_at IS NOT NULL) AS scored,
           count(*) FILTER (WHERE direction = 'inbound') AS inbound,
           min(start_time) AS first, max(start_time) AS last
    FROM calls
    WHERE start_time >= '2026-07-20'
    GROUP BY handled_by, handled_by_user_id
    ORDER BY n DESC
  `);
  for (const r of g.rows as any[]) {
    console.log(`handled_by=${r.handled_by ?? 'NULL'} user=${r.handled_by_user_id ?? 'NULL'} n=${r.n} scored=${r.scored} inbound=${r.inbound} [${String(r.first).slice(0,10)}..${String(r.last).slice(0,10)}]`);
  }

  console.log("\n=== Daily VA/answered call counts since 2026-07-20 ===");
  const d = await db.execute(sql`
    SELECT start_time::date AS day,
           count(*) FILTER (WHERE handled_by = 'va') AS va,
           count(*) FILTER (WHERE handled_by = 'ai_agent') AS ai,
           count(*) FILTER (WHERE handled_by = 'missed') AS missed,
           count(*) FILTER (WHERE handled_by = 'voicemail') AS vm,
           count(*) AS total
    FROM calls
    WHERE start_time >= '2026-07-20'
    GROUP BY day ORDER BY day
  `);
  for (const r of d.rows as any[]) {
    console.log(`${String(r.day).slice(0,10)}  va=${r.va} ai=${r.ai} missed=${r.missed} vm=${r.vm} total=${r.total}`);
  }

  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
