import { db } from "../server/db";
import { sql } from "drizzle-orm";
import fs from "fs";
const ND = `NOT (COALESCE(phone,'') LIKE '07700900%' OR COALESCE(phone,'') LIKE '+447700900%'
  OR COALESCE(phone,'') LIKE '07700000%' OR COALESCE(phone,'') LIKE '+449900%'
  OR COALESCE(id,'') LIKE 'test_q_%' OR COALESCE(id,'') LIKE 'pq_test_%'
  OR COALESCE(customer_name,'') ILIKE '%test%' OR COALESCE(customer_name,'') ILIKE 'qa %'
  OR COALESCE(created_by_name,'') ILIKE '%test%' OR COALESCE(created_by_name,'') ILIKE '%qa%'
  OR COALESCE(created_by_name,'') ILIKE 'phase %' OR COALESCE(email,'') ILIKE '%@example.com'
  OR COALESCE(customer_name,'') ILIKE 'courtnee%' OR LOWER(TRIM(COALESCE(customer_name,'')))='ben')`;
const SYS=new Set(["e2e_notification","notification_template","gp2","call_log","ciphertext","protocol","revoked"]);
const natl=(s:string)=>{ if(!s)return null; let x=s.replace(/[^\d]/g,"");
  if(x.startsWith("44")&&x.length===12)x=x.slice(2); else if(x.startsWith("0")&&x.length===11)x=x.slice(1);
  return (x.length===10&&x.startsWith("7"))?x:null; };
const QUOTE_RE=/handyservices\.(app|uk)\/quote/i;
const mean=(a:number[])=>a.length?a.reduce((x,y)=>x+y,0)/a.length:NaN;
const med=(a:number[])=>{ if(!a.length)return NaN; const s=[...a].sort((x,y)=>x-y);const m=Math.floor(s.length/2);return s.length%2?s[m]:(s[m-1]+s[m])/2;};
const hm=(min:number)=> isNaN(min)?"-":min<60?`${min.toFixed(0)}m`:min<1440?`${(min/60).toFixed(1)}h`:`${(min/1440).toFixed(1)}d`;
async function main(){
  const dump=JSON.parse(fs.readFileSync("whatsapp-export/wa-dump.json","utf8")).filter((m:any)=>!SYS.has(m.type));
  const chats=new Map<string,any[]>(); for(const m of dump){ if(!chats.has(m.chatName))chats.set(m.chatName,[]); chats.get(m.chatName)!.push(m);}
  for(const a of chats.values())a.sort((x,y)=>+new Date(x.ts)-+new Date(y.ts));
  const q:any=await db.execute(sql.raw(`SELECT phone, deposit_paid_at, created_at, base_price FROM personalized_quotes WHERE created_at>='2026-04-01' AND ${ND};`));
  const qByPhone=new Map<string,any>(); for(const r of (q.rows??q)){const n=natl(r.phone||"");if(n)qByPhone.set(n,r);}
  const recs:{month:string,paid:boolean,ttq:number|null,big:boolean}[]=[];
  for(const [name,msgs] of chats){ const n=natl(name); if(!n||!qByPhone.has(n))continue; const qr=qByPhone.get(n);
    const real=msgs.filter((m:any)=>m.body||["image","video","audio","ptt","document","sticker"].includes(m.type));
    const qMsg=real.find((m:any)=>m.fromMe&&QUOTE_RE.test(m.body||"")); const fi=real.find((m:any)=>!m.fromMe);
    let ttq:number|null=null; if(qMsg&&fi&&+new Date(fi.ts)<+new Date(qMsg.ts)) ttq=(+new Date(qMsg.ts)-+new Date(fi.ts))/60000;
    recs.push({month:new Date(qr.created_at).toISOString().slice(0,7),paid:!!qr.deposit_paid_at,ttq,big:(qr.base_price||0)>=30000}); }

  const buckets=[["<1h",0,60],["1-4h",60,240],["4-12h",240,720],["12-24h",720,1440],[">24h",1440,1e9]] as const;
  console.log("=== CONVERSION RATE by TIME-TO-QUOTE (TTQ measured before outcome) ===");
  console.log("bucket     n   paid  conv%");
  for(const [lbl,lo,hi] of buckets){ const g=recs.filter(r=>r.ttq!=null&&r.ttq>=lo&&r.ttq<hi);
    const p=g.filter(r=>r.paid).length; console.log(`${lbl.padEnd(8)} ${String(g.length).padStart(3)}  ${String(p).padStart(4)}  ${g.length?(100*p/g.length).toFixed(0)+"%":"-"}`); }

  console.log("\n=== TTQ distribution by month (share of leads quoted within...) ===");
  console.log("month   n   <1h  1-4h 4-12h 12-24h >24h   median   mean");
  for(const mo of ["2026-04","2026-05","2026-06"]){ const g=recs.filter(r=>r.month===mo&&r.ttq!=null).map(r=>r.ttq!) ;
    const sh=(lo:number,hi:number)=>g.length?Math.round(100*g.filter(t=>t>=lo&&t<hi).length/g.length):0;
    console.log(`${mo}  ${String(g.length).padStart(3)}  ${String(sh(0,60)).padStart(3)}% ${String(sh(60,240)).padStart(3)}% ${String(sh(240,720)).padStart(3)}% ${String(sh(720,1440)).padStart(4)}% ${String(sh(1440,1e9)).padStart(3)}%  ${hm(med(g)).padStart(6)} ${hm(mean(g)).padStart(6)}`); }

  console.log("\n=== conversion by TTQ x recency (Apr vs May+Jun) ===");
  for(const [plabel,pf] of [["Apr",(r:any)=>r.month==="2026-04"],["May+Jun",(r:any)=>r.month!=="2026-04"]] as const){
    const fast=recs.filter(r=>pf(r)&&r.ttq!=null&&r.ttq<240), slow=recs.filter(r=>pf(r)&&r.ttq!=null&&r.ttq>=240);
    const cv=(g:any[])=>g.length?(100*g.filter(r=>r.paid).length/g.length).toFixed(0)+"%":"-";
    console.log(`  ${plabel.padEnd(8)} fast(<4h): n=${String(fast.length).padStart(2)} conv ${cv(fast).padStart(4)}   |  slow(>4h): n=${String(slow.length).padStart(2)} conv ${cv(slow).padStart(4)}`); }
  process.exit(0);
}
main().catch(e=>{console.error(e);process.exit(1);});
