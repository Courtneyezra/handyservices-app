/**
 * AUDIT TASK 4 — Stage 1 qual: read initial contacts (call summaries/transcripts +
 * first WhatsApp messages), converted vs lost, to characterise a strong opening.
 * Run: npx tsx scripts/audit/04-stage1-qual.ts
 */
import fs from "fs";
import { notDummy, FUNNEL, q } from "./lib";

const natl = (s: string) => { if (!s) return null; let x = s.replace(/[^\d]/g, "");
  if (x.startsWith("44") && x.length === 12) x = x.slice(2);
  else if (x.startsWith("0") && x.length === 11) x = x.slice(1);
  return (x.length === 10 && x.startsWith("7")) ? x : null; };
const clean = (s: string) => (s || "").replace(/\s+/g, " ").trim();

async function main() {
  // paid vs lost(viewed-not-paid) phone sets from clean quotes
  const quotes = await q(`SELECT phone, ${FUNNEL.viewed()} AS viewed, ${FUNNEL.converted()} AS paid
    FROM personalized_quotes WHERE created_at>='2026-03-01' AND ${notDummy()};`);
  const paid = new Set<string>(), lost = new Set<string>();
  for (const r of quotes) { const n = natl(r.phone || ""); if (!n) continue;
    if (r.paid) paid.add(n); else if (r.viewed) lost.add(n); }
  console.log(`paid phones: ${paid.size}, lost(viewed-not-paid) phones: ${lost.size}`);

  // CALL transcription coverage
  const cov = await q(`SELECT COUNT(*) n, COUNT(transcription) tr, COUNT(job_summary) js
    FROM calls WHERE start_time>='2026-03-01';`);
  console.log(`calls Mar+: ${cov[0].n}, with transcription ${cov[0].tr}, with job_summary ${cov[0].js}`);

  // Sample call job summaries + opening line, paid vs lost (joined by phone)
  const calls = await q(`SELECT phone_number, job_summary, LEFT(COALESCE(transcription,''),200) opening, outcome
    FROM calls WHERE start_time>='2026-03-01' AND (job_summary IS NOT NULL OR transcription IS NOT NULL)
    ORDER BY start_time;`);
  const callBy = (set: Set<string>) => calls.filter((c: any) => { const n = natl(c.phone_number || ""); return n && set.has(n); });
  const printCalls = (label: string, arr: any[]) => {
    console.log(`\n=== CALLS — ${label} (showing up to 8) ===`);
    for (const c of arr.slice(0, 8)) {
      console.log(`  [${c.outcome || "?"}] ${clean(c.job_summary || c.opening).slice(0, 130)}`);
    }
  };
  printCalls("led to PAID quote", callBy(paid));
  printCalls("led to LOST quote (viewed, not paid)", callBy(lost));

  // WhatsApp first inbound message, paid vs lost
  const SYS = new Set(["e2e_notification","notification_template","gp2","call_log","ciphertext","protocol","revoked"]);
  const dump = JSON.parse(fs.readFileSync("whatsapp-export/wa-dump.json","utf8")).filter((m: any) => !SYS.has(m.type));
  const chats = new Map<string, any[]>();
  for (const m of dump) { if (!natl(m.chatName)) continue; if (!chats.has(m.chatName)) chats.set(m.chatName, []); chats.get(m.chatName)!.push(m); }
  for (const a of chats.values()) a.sort((x: any, y: any) => +new Date(x.ts) - +new Date(y.ts));
  const firstInbound = (set: Set<string>) => {
    const out: string[] = [];
    for (const [name, msgs] of chats) { const n = natl(name); if (!n || !set.has(n)) continue;
      const fi = msgs.find((m: any) => !m.fromMe && (m.body || "").trim());
      if (fi) out.push(clean(fi.body)); }
    return out;
  };
  const wPaid = firstInbound(paid), wLost = firstInbound(lost);
  const stat = (arr: string[]) => `n=${arr.length}, avg ${Math.round(arr.reduce((a,s)=>a+s.length,0)/(arr.length||1))} chars, %with '?' ${Math.round(100*arr.filter(s=>s.includes('?')).length/(arr.length||1))}`;
  console.log(`\n=== WhatsApp FIRST customer message ===`);
  console.log(`  PAID: ${stat(wPaid)}`);
  console.log(`  LOST: ${stat(wLost)}`);
  console.log(`\n  -- sample PAID openings --`);
  wPaid.slice(0, 10).forEach(s => console.log(`   • ${s.slice(0, 90)}`));
  console.log(`\n  -- sample LOST openings --`);
  wLost.slice(0, 10).forEach(s => console.log(`   • ${s.slice(0, 90)}`));
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
