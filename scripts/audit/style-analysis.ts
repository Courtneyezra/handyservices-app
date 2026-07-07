/**
 * CONVERSATIONAL STYLE analysis — which messaging style converts best.
 * Style RATES (length-normalised) on Ben's outbound msgs + customer style, paid vs lost.
 * Run: npx tsx scripts/audit/style-analysis.ts
 */
import fs from "fs";
import { notDummy, q } from "./lib";

const SYS = new Set(["e2e_notification","notification_template","gp2","call_log","ciphertext","protocol","revoked"]);
const natl = (s: string) => { if (!s) return null; let x = s.replace(/[^\d]/g,"");
  if (x.startsWith("44")&&x.length===12) x=x.slice(2); else if (x.startsWith("0")&&x.length===11) x=x.slice(1);
  return (x.length===10&&x.startsWith("7"))?x:null; };
const EMOJI = /\p{Extended_Pictographic}/u;
const POLITE = /\b(please|thanks|thank you|cheers|mate|no worries|lovely|brilliant|perfect|great|fab|appreciate|of course)\b/i;
const CTA = /\b(shall i|want me to|would you like|let me|happy to|i can|i'll|do you want|get you booked|secure your|lock it in|sort (you|this)|pop you in)\b/i;
const GREET = /\b(hi|hey|hello|good morning|good afternoon|morning|afternoon|alright)\b/i;
const words = (s: string) => (s||"").trim().split(/\s+/).filter(Boolean).length;
const isVoice = (t: string) => /ptt|audio/.test(t);
const mean = (a: number[]) => a.length ? a.reduce((x,y)=>x+y,0)/a.length : NaN;
const med = (a: number[]) => { if(!a.length) return NaN; const s=[...a].sort((x,y)=>x-y); const m=Math.floor(s.length/2); return s.length%2?s[m]:(s[m-1]+s[m])/2; };

async function main() {
  const dump = JSON.parse(fs.readFileSync("whatsapp-export/wa-dump.json","utf8")).filter((m:any)=>!SYS.has(m.type));
  const chats = new Map<string, any[]>();
  for (const m of dump) { if(!natl(m.chatName)) continue; if(!chats.has(m.chatName)) chats.set(m.chatName,[]); chats.get(m.chatName)!.push(m); }
  for (const a of chats.values()) a.sort((x:any,y:any)=>+new Date(x.ts)-+new Date(y.ts));
  const quotes = await q(`SELECT phone, customer_name, deposit_paid_at FROM personalized_quotes WHERE created_at>='2026-04-01' AND ${notDummy()};`);
  const byPhone = new Map<string, any>(); for (const r of quotes) { const n=natl(r.phone||""); if(n) byPhone.set(n,r); }

  const recs: any[] = [];
  for (const [name, msgs] of chats) { const n=natl(name); if(!n||!byPhone.has(n)) continue; const qr=byPhone.get(n);
    const firstName = String(qr.customer_name||"").trim().split(/\s+/)[0].toLowerCase();
    const allBen = msgs.filter((m:any)=>m.fromMe);
    const benTxt = allBen.filter((m:any)=>(m.body||"").trim());
    const cust = msgs.filter((m:any)=>!m.fromMe && (m.body||"").trim());
    if (benTxt.length < 2) continue;
    const rate = (f:(b:string)=>boolean) => benTxt.filter((m:any)=>f(m.body)).length / benTxt.length;
    recs.push({
      paid: !!qr.deposit_paid_at,
      benWords: mean(benTxt.map((m:any)=>words(m.body))),
      benEmoji: rate(b=>EMOJI.test(b)),
      benExcl: rate(b=>b.includes("!")),
      benQ: rate(b=>b.includes("?")),
      benName: firstName.length>2 ? rate(b=>new RegExp(`\\b${firstName}\\b`,"i").test(b)) : NaN,
      benPolite: rate(b=>POLITE.test(b)),
      benCta: rate(b=>CTA.test(b)),
      benGreet: GREET.test(benTxt[0].body) ? 1 : 0,
      benVoice: allBen.filter((m:any)=>isVoice(m.type)).length / Math.max(allBen.length,1),
      custWords: mean(cust.map((m:any)=>words(m.body))),
      custEmoji: cust.length ? cust.filter((m:any)=>EMOJI.test(m.body)).length/cust.length : 0,
    });
  }
  const P = recs.filter(r=>r.paid), L = recs.filter(r=>!r.paid);
  console.log(`=== CONVERSATIONAL STYLE — PAID (${P.length}) vs LOST (${L.length}) ===`);
  const feats: [string,string,boolean][] = [ // [key, label, isRate0to1]
    ["benWords","Ben avg words/msg",false],["benName","Ben uses customer's NAME",true],
    ["benEmoji","Ben emoji rate",true],["benExcl","Ben '!' rate",true],["benQ","Ben asks '?'",true],
    ["benPolite","Ben warmth words",true],["benCta","Ben booking CTA",true],["benGreet","Ben greets in 1st msg",true],
    ["benVoice","Ben voice-note ratio",true],["custWords","Customer avg words/msg",false],["custEmoji","Customer emoji rate",true],
  ];
  console.log("feature                       PAID     LOST     gap");
  for (const [k,label,isRate] of feats) {
    const p = mean(P.map(r=>r[k]).filter((x:number)=>!isNaN(x)));
    const l = mean(L.map(r=>r[k]).filter((x:number)=>!isNaN(x)));
    const fmt = (x:number) => isRate ? (100*x).toFixed(0)+"%" : x.toFixed(1);
    const gap = isRate ? `${((p-l)*100>=0?'+':'')}${((p-l)*100).toFixed(0)}pt` : `${(p-l>=0?'+':'')}${(p-l).toFixed(1)}`;
    console.log(`${label.padEnd(28)} ${fmt(p).padStart(6)}   ${fmt(l).padStart(6)}   ${gap.padStart(6)}`);
  }
  // winning-style examples: paid chats where Ben used name + CTA
  console.log("\n=== sample WINNING-style Ben messages (from converted chats) ===");
  let shown = 0;
  for (const [name, msgs] of chats) { const n=natl(name); if(!n||!byPhone.has(n)||!byPhone.get(n).deposit_paid_at) continue;
    const fn = String(byPhone.get(n).customer_name||"").trim().split(/\s+/)[0].toLowerCase();
    for (const m of msgs.filter((m:any)=>m.fromMe && (m.body||"").trim())) {
      if (fn.length>2 && new RegExp(`\\b${fn}\\b`,"i").test(m.body) && CTA.test(m.body)) {
        console.log(`  • ${m.body.replace(/\s+/g," ").trim().slice(0,100)}`); if(++shown>=8) break; } }
    if (shown>=8) break; }
  process.exit(0);
}
main().catch((e)=>{console.error(e);process.exit(1);});
