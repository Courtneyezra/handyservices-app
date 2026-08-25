import { db } from "../server/db";
import { sql } from "drizzle-orm";
async function q(t:string){const r:any=await db.execute(sql.raw(t));return r.rows??r;}
// junk conversation filter (test/load/playback)
const JUNK = `(
     c.phone_number LIKE '447700900%' OR c.phone_number LIKE '447000000%'
  OR c.phone_number LIKE '4470000%'   OR LENGTH(c.phone_number) > 18
  OR COALESCE(c.contact_name,'') ILIKE '%test%' OR COALESCE(c.contact_name,'') ILIKE '%playback%'
  OR COALESCE(c.contact_name,'') ILIKE 'click here%' OR COALESCE(c.contact_name,'')='Unknown Caller'
)`;
async function main(){
  console.log("=== REAL (non-junk) conversations & messages by month ===");
  console.log("month   convs  inbound  outbound");
  for(const r of await q(`SELECT to_char(date_trunc('month',m.created_at),'YYYY-MM') mth,
      COUNT(DISTINCT m.conversation_id) convs,
      COUNT(*) FILTER (WHERE m.direction='inbound') inb,
      COUNT(*) FILTER (WHERE m.direction='outbound') outb
    FROM messages m JOIN conversations c ON c.id=m.conversation_id
    WHERE NOT ${JUNK} GROUP BY 1 ORDER BY 1;`))
    console.log(`  ${r.mth}  ${String(r.convs).padStart(4)}   ${String(r.inb).padStart(5)}   ${String(r.outb).padStart(6)}`);

  console.log("\n=== junk vs real conversation counts ===");
  console.dir((await q(`SELECT COUNT(*) total,
     COUNT(*) FILTER (WHERE ${JUNK}) junk,
     COUNT(*) FILTER (WHERE NOT ${JUNK}) real FROM conversations c;`))[0]);

  console.log("\n=== ALL inbound messages by month (any conv) ===");
  for(const r of await q(`SELECT to_char(date_trunc('month',created_at),'YYYY-MM') m, COUNT(*) n
     FROM messages WHERE direction='inbound' GROUP BY 1 ORDER BY 1;`)) console.log(`  ${r.m}  ${r.n}`);

  console.log("\n=== most-recent 12 messages (what is being stored now?) ===");
  for(const r of await q(`SELECT to_char(m.created_at,'YYYY-MM-DD HH24:MI') t, m.direction dir, m.type typ,
     LEFT(COALESCE(c.contact_name,c.phone_number),18) who, LEFT(COALESCE(m.content,'(no text)'),60) body
     FROM messages m JOIN conversations c ON c.id=m.conversation_id
     ORDER BY m.created_at DESC LIMIT 12;`))
     console.log(`  ${r.t} ${String(r.dir).padEnd(8)} ${String(r.typ).padEnd(8)} ${String(r.who).padEnd(18)} | ${r.body}`);

  console.log("\n=== the 9 lead-linked conversations ===");
  for(const r of await q(`SELECT LEFT(COALESCE(c.contact_name,'(none)'),18) nm, c.phone_number ph, c.lead_id,
     to_char(c.created_at,'YYYY-MM-DD') created, COUNT(m.id) msgs
     FROM conversations c LEFT JOIN messages m ON m.conversation_id=c.id
     WHERE c.lead_id IS NOT NULL GROUP BY 1,2,3,4 ORDER BY 4;`))
     console.log(`  ${String(r.nm).padEnd(18)} ${String(r.ph).padEnd(22)} lead=${String(r.lead_id).slice(0,10)} ${r.created} msgs=${r.msgs}`);
  process.exit(0);
}
main().catch(e=>{console.error(e);process.exit(1);});
