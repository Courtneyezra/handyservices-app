/**
 * AUDIT TASK 6 — Stage 2 behavioural correlations + post-link fate.
 * Which WhatsApp behaviours associate with conversion (with reverse-causation flags).
 * Run: npx tsx scripts/audit/06-stage2-qual.ts
 */
import fs from "fs";
import { notDummy, q } from "./lib";

const SYS = new Set(["e2e_notification","notification_template","gp2","call_log","ciphertext","protocol","revoked"]);
const natl = (s: string) => { if (!s) return null; let x = s.replace(/[^\d]/g,"");
  if (x.startsWith("44") && x.length===12) x=x.slice(2); else if (x.startsWith("0") && x.length===11) x=x.slice(1);
  return (x.length===10 && x.startsWith("7")) ? x : null; };
const QRE = /handyservices\.(app|uk)\/quote/i;
const isVoice=(t:string)=>/ptt|audio/.test(t), isVid=(t:string)=>/image|video|album/.test(t);

async function main() {
  const dump = JSON.parse(fs.readFileSync("whatsapp-export/wa-dump.json","utf8")).filter((m:any)=>!SYS.has(m.type));
  const chats = new Map<string, any[]>();
  for (const m of dump) { if(!natl(m.chatName)) continue; if(!chats.has(m.chatName)) chats.set(m.chatName,[]); chats.get(m.chatName)!.push(m); }
  for (const a of chats.values()) a.sort((x:any,y:any)=>+new Date(x.ts)-+new Date(y.ts));
  const quotes = await q(`SELECT phone, deposit_paid_at FROM personalized_quotes WHERE created_at>='2026-04-01' AND ${notDummy()};`);
  const byPhone = new Map<string, any>(); for (const r of quotes) { const n=natl(r.phone||""); if(n) byPhone.set(n,r); }

  const recs: any[] = [];
  for (const [name, msgs] of chats) { const n=natl(name); if(!n||!byPhone.has(n)) continue;
    const m = msgs.filter((x:any)=>x.body||["image","video","audio","ptt","document","sticker","album"].includes(x.type));
    const qm = m.find((x:any)=>x.fromMe&&QRE.test(x.body||"")); const lt = qm?+new Date(qm.ts):Infinity;
    const pre = (x:any)=>+new Date(x.ts)<lt;
    let followup=false; for(let i=1;i<m.length;i++){ if(m[i].fromMe&&m[i-1].fromMe&&(+new Date(m[i].ts)-+new Date(m[i-1].ts))>3*3600e3){followup=true;break;} }
    recs.push({ paid:!!byPhone.get(n).deposit_paid_at,
      benVoice: m.some((x:any)=>x.fromMe&&isVoice(x.type)),
      custPhotoPre: m.some((x:any)=>!x.fromMe&&isVid(x.type)&&pre(x)),
      benQpre: m.filter((x:any)=>x.fromMe&&pre(x)&&/\?/.test(x.body||"")).length>=1,
      followup });
  }
  const N=recs.length, base=recs.filter(r=>r.paid).length;
  console.log(`=== STAGE 2 behavioural lift (n=${N}, base conv ${Math.round(100*base/N)}%) ===`);
  console.log("behaviour          with:n conv%   without:n conv%   lift   note");
  const feats: [string,string][] = [["followup","ACTION — biggest lever"],["custPhotoPre","PRE-link, clean"],["benVoice","marker"],["benQpre","marks job complexity"]];
  for (const [f,note] of feats) {
    const wi=recs.filter(r=>r[f]), wo=recs.filter(r=>!r[f]);
    const cw=wi.length?100*wi.filter(r=>r.paid).length/wi.length:NaN, co=wo.length?100*wo.filter(r=>r.paid).length/wo.length:NaN;
    console.log(`${f.padEnd(16)} ${String(wi.length).padStart(4)} ${(cw.toFixed(0)+'%').padStart(5)}     ${String(wo.length).padStart(5)} ${(co.toFixed(0)+'%').padStart(5)}   ${((cw-co>=0?'+':'')+(cw-co).toFixed(0)+'pt').padStart(6)}  ${note}`);
  }
  process.exit(0);
}
main().catch((e)=>{console.error(e);process.exit(1);});
