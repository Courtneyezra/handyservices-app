import { db } from "../server/db";
import { sql } from "drizzle-orm";
async function q(t:string){const r:any=await db.execute(sql.raw(t));return r.rows??r;}
async function main(){
  console.log("=== conversations: totals & date range ===");
  console.dir((await q(`SELECT COUNT(*) convs, COUNT(lead_id) with_lead,
     MIN(created_at) min_created, MAX(created_at) max_created,
     MIN(last_message_at) min_lastmsg, MAX(last_message_at) max_lastmsg FROM conversations;`))[0]);

  console.log("\n=== messages: totals & date range ===");
  console.dir((await q(`SELECT COUNT(*) msgs, MIN(created_at) min_c, MAX(created_at) max_c,
     COUNT(*) FILTER (WHERE direction='inbound') inbound,
     COUNT(*) FILTER (WHERE direction='outbound') outbound FROM messages;`))[0]);

  console.log("\n=== messages by month x direction ===");
  for(const r of await q(`SELECT to_char(date_trunc('month',created_at),'YYYY-MM') m,
     COUNT(*) FILTER (WHERE direction='inbound') inb,
     COUNT(*) FILTER (WHERE direction='outbound') outb,
     COUNT(DISTINCT conversation_id) convs
     FROM messages GROUP BY 1 ORDER BY 1;`))
     console.log(`  ${r.m}  in=${String(r.inb).padStart(5)} out=${String(r.outb).padStart(5)} convs=${String(r.convs).padStart(4)}`);

  console.log("\n=== conversations created by month ===");
  for(const r of await q(`SELECT to_char(date_trunc('month',created_at),'YYYY-MM') m, COUNT(*) n
     FROM conversations GROUP BY 1 ORDER BY 1;`)) console.log(`  ${r.m}  ${r.n}`);

  console.log("\n=== sample 12 conversations (name / phone / msg count) ===");
  for(const r of await q(`SELECT LEFT(COALESCE(c.contact_name,'(none)'),20) nm, c.phone_number ph,
     COUNT(m.id) msgs, to_char(MIN(m.created_at),'YYYY-MM-DD') first_msg
     FROM conversations c LEFT JOIN messages m ON m.conversation_id=c.id
     GROUP BY 1,2 ORDER BY 3 DESC LIMIT 12;`))
     console.log(`  ${String(r.nm).padEnd(20)} ${String(r.ph).padEnd(24)} msgs=${String(r.msgs).padStart(4)} first=${r.first_msg}`);
  process.exit(0);
}
main().catch(e=>{console.error(e);process.exit(1);});
