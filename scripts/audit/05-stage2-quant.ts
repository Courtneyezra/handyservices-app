/**
 * AUDIT TASK 5 — Stage 2 (WhatsApp) quant, formalised. By month + converted vs not.
 * Note: time-to-quote is GATED by the contractor-availability system (a system delay),
 * so we separate the gated quote-send from ordinary first replies (Ben's attentiveness).
 * Run: npx tsx scripts/audit/05-stage2-quant.ts
 */
import fs from "fs";
import { notDummy, FUNNEL, q } from "./lib";

const SYS = new Set(["e2e_notification","notification_template","gp2","call_log","ciphertext","protocol","revoked"]);
const natl = (s: string) => { if (!s) return null; let x = s.replace(/[^\d]/g,"");
  if (x.startsWith("44") && x.length===12) x=x.slice(2); else if (x.startsWith("0") && x.length===11) x=x.slice(1);
  return (x.length===10 && x.startsWith("7")) ? x : null; };
const QRE = /handyservices\.(app|uk)\/quote/i;
const med = (a: number[]) => { if(!a.length) return NaN; const s=[...a].sort((x,y)=>x-y); const m=Math.floor(s.length/2); return s.length%2?s[m]:(s[m-1]+s[m])/2; };
const hm = (x: number) => isNaN(x) ? "  -  " : x<60?`${x.toFixed(0)}m`:x<1440?`${(x/60).toFixed(1)}h`:`${(x/1440).toFixed(1)}d`;

async function main() {
  const dump = JSON.parse(fs.readFileSync("whatsapp-export/wa-dump.json","utf8")).filter((m:any)=>!SYS.has(m.type));
  const chats = new Map<string, any[]>();
  for (const m of dump) { if(!natl(m.chatName)) continue; if(!chats.has(m.chatName)) chats.set(m.chatName,[]); chats.get(m.chatName)!.push(m); }
  for (const a of chats.values()) a.sort((x:any,y:any)=>+new Date(x.ts)-+new Date(y.ts));

  const quotes = await q(`SELECT phone, created_at, deposit_paid_at FROM personalized_quotes
     WHERE created_at>='2026-04-01' AND ${notDummy()};`);
  const byPhone = new Map<string, any>(); for (const r of quotes) { const n=natl(r.phone||""); if(n) byPhone.set(n,r); }

  type Rec = { month: string; paid: boolean; firstReply: number|null; quoteReply: number|null;
    postSilent: boolean; followup: boolean; msgs: number; lastIsCustomer: boolean };
  const recs: Rec[] = [];
  for (const [name, msgs] of chats) { const n=natl(name); if(!n||!byPhone.has(n)) continue; const qr=byPhone.get(n);
    const real = msgs.filter((m:any)=>m.body||["image","video","audio","ptt","document","sticker"].includes(m.type));
    if (!real.length) continue;
    const qm = real.find((m:any)=>m.fromMe && QRE.test(m.body||""));
    const fi = real.find((m:any)=>!m.fromMe);
    // first reply (clean attentiveness): first inbound -> first outbound after it
    let firstReply: number|null = null;
    if (fi) { const fr = real.find((m:any)=>m.fromMe && +new Date(m.ts)>+new Date(fi.ts)); if(fr) firstReply=(+new Date(fr.ts)-+new Date(fi.ts))/60000; }
    const quoteReply = (qm && fi && +new Date(fi.ts)<+new Date(qm.ts)) ? (+new Date(qm.ts)-+new Date(fi.ts))/60000 : null;
    const postInb = qm ? real.filter((m:any)=>!m.fromMe && +new Date(m.ts)>+new Date(qm.ts)).length : 0;
    let followup=false; for(let i=1;i<real.length;i++){ if(real[i].fromMe&&real[i-1].fromMe&&(+new Date(real[i].ts)-+new Date(real[i-1].ts))>3*3600e3){followup=true;break;} }
    recs.push({ month:new Date(qr.created_at).toISOString().slice(0,7), paid:!!qr.deposit_paid_at,
      firstReply, quoteReply, postSilent: !!qm && postInb<=1, followup, msgs: real.length,
      lastIsCustomer: !real[real.length-1].fromMe });
  }

  const row = (label: string, rs: Rec[]) => {
    if (!rs.length) return;
    const fr=rs.map(r=>r.firstReply).filter((x):x is number=>x!=null);
    const qrp=rs.map(r=>r.quoteReply).filter((x):x is number=>x!=null);
    const silent=rs.filter(r=>r.postSilent).length, fu=rs.filter(r=>r.followup).length, lh=rs.filter(r=>r.lastIsCustomer).length;
    console.log(`${label.padEnd(16)} n=${String(rs.length).padStart(3)} | firstReply ${hm(med(fr)).padStart(6)} | quoteSend(gated) ${hm(med(qrp)).padStart(6)} | postLinkSilent ${String(Math.round(100*silent/rs.length)).padStart(3)}% | followedUp ${String(Math.round(100*fu/rs.length)).padStart(3)}% | leftHanging ${String(Math.round(100*lh/rs.length)).padStart(3)}% | msgs ${med(rs.map(r=>r.msgs))}`);
  };
  console.log("=== STAGE 2 WhatsApp dynamics — converted vs not ===");
  row("ALL", recs); row("CONVERTED", recs.filter(r=>r.paid)); row("LOST", recs.filter(r=>!r.paid));
  console.log("\n=== by month ===");
  for (const mo of ["2026-04","2026-05","2026-06"]) row(mo, recs.filter(r=>r.month===mo));
  process.exit(0);
}
main().catch((e)=>{console.error(e);process.exit(1);});
