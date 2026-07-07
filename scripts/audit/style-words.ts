/**
 * HIDDEN PHRASE LIFT — which words/bigrams in Ben's messages over-index in WON vs LOST chats.
 * Run: npx tsx scripts/audit/style-words.ts
 */
import fs from "fs";
import { notDummy, q } from "./lib";

const SYS = new Set(["e2e_notification","notification_template","gp2","call_log","ciphertext","protocol","revoked"]);
const natl = (s: string) => { if (!s) return null; let x = s.replace(/[^\d]/g,"");
  if (x.startsWith("44")&&x.length===12) x=x.slice(2); else if (x.startsWith("0")&&x.length===11) x=x.slice(1);
  return (x.length===10&&x.startsWith("7"))?x:null; };
const STOP = new Set("the a an to of and in on for you your we i it is are be will can at me my so that this with as your our have has do if or but no not get got im ill we'll i'll you'll there here just".split(" "));

async function main() {
  const dump = JSON.parse(fs.readFileSync("whatsapp-export/wa-dump.json","utf8")).filter((m:any)=>!SYS.has(m.type));
  const chats = new Map<string, any[]>();
  for (const m of dump) { if(!natl(m.chatName)) continue; if(!chats.has(m.chatName)) chats.set(m.chatName,[]); chats.get(m.chatName)!.push(m); }
  const quotes = await q(`SELECT phone, deposit_paid_at FROM personalized_quotes WHERE created_at>='2026-04-01' AND ${notDummy()};`);
  const byPhone = new Map<string, any>(); for (const r of quotes) { const n=natl(r.phone||""); if(n) byPhone.set(n,r); }

  const tok = (s: string) => (s||"").toLowerCase().replace(/[^a-z' ]/g," ").split(/\s+/).filter(w=>w.length>2&&!STOP.has(w));
  const grams = { paid: new Map<string,number>(), lost: new Map<string,number>() };
  const totals = { paid: 0, lost: 0 };
  for (const [name, msgs] of chats) { const n=natl(name); if(!n||!byPhone.has(n)) continue;
    const bucket = byPhone.get(n).deposit_paid_at ? "paid" : "lost";
    for (const m of msgs.filter((m:any)=>m.fromMe && (m.body||"").trim())) {
      const ws = tok(m.body);
      for (let i=0;i<ws.length;i++) {
        const uni = ws[i]; grams[bucket].set(uni,(grams[bucket].get(uni)||0)+1); totals[bucket]++;
        if (i<ws.length-1) { const bi = ws[i]+" "+ws[i+1]; grams[bucket].set(bi,(grams[bucket].get(bi)||0)+1); }
      }
    }
  }
  // rate per 1000 words; lift = paidRate / lostRate (smoothed)
  const all = new Set([...grams.paid.keys(), ...grams.lost.keys()]);
  const rows: { g: string; pr: number; lr: number; lift: number; n: number }[] = [];
  for (const g of all) {
    const pc = grams.paid.get(g)||0, lc = grams.lost.get(g)||0;
    if (pc + lc < 6) continue; // ignore rare
    const pr = 1000*pc/totals.paid, lr = 1000*lc/totals.lost;
    rows.push({ g, pr, lr, lift: (pr+0.05)/(lr+0.05), n: pc+lc });
  }
  console.log(`Ben words — WON chats ${totals.paid} words, LOST chats ${totals.lost} words\n`);
  console.log("=== over-indexed in WON chats (winning language) ===");
  rows.filter(r=>r.pr>=0.4).sort((a,b)=>b.lift-a.lift).slice(0,22).forEach(r=>console.log(`  ${r.lift.toFixed(1)}x  ${r.g.padEnd(22)} (won ${r.pr.toFixed(1)} vs lost ${r.lr.toFixed(1)} /1k)`));
  console.log("\n=== over-indexed in LOST chats (warning language) ===");
  rows.filter(r=>r.lr>=0.4).sort((a,b)=>a.lift-b.lift).slice(0,18).forEach(r=>console.log(`  ${(1/r.lift).toFixed(1)}x  ${r.g.padEnd(22)} (lost ${r.lr.toFixed(1)} vs won ${r.pr.toFixed(1)} /1k)`));
  process.exit(0);
}
main().catch((e)=>{console.error(e);process.exit(1);});
