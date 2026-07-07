import { db } from "../server/db"; import { sql } from "drizzle-orm"; import fs from "fs";
const ND=`NOT (COALESCE(phone,'') LIKE '07700900%' OR COALESCE(phone,'') LIKE '+447700900%' OR COALESCE(phone,'') LIKE '07700000%' OR COALESCE(phone,'') LIKE '+449900%' OR COALESCE(id,'') LIKE 'test_q_%' OR COALESCE(id,'') LIKE 'pq_test_%' OR COALESCE(customer_name,'') ILIKE '%test%' OR COALESCE(customer_name,'') ILIKE 'qa %' OR COALESCE(created_by_name,'') ILIKE '%test%' OR COALESCE(created_by_name,'') ILIKE '%qa%' OR COALESCE(created_by_name,'') ILIKE 'phase %' OR COALESCE(email,'') ILIKE '%@example.com' OR COALESCE(customer_name,'') ILIKE 'courtnee%' OR LOWER(TRIM(COALESCE(customer_name,'')))='ben')`;
const SYS=new Set(["e2e_notification","notification_template","gp2","call_log","ciphertext","protocol","revoked"]);
const natl=(s:string)=>{if(!s)return null;let x=s.replace(/[^\d]/g,"");if(x.startsWith("44")&&x.length===12)x=x.slice(2);else if(x.startsWith("0")&&x.length===11)x=x.slice(1);return(x.length===10&&x.startsWith("7"))?x:null;};
const QRE=/handyservices\.(app|uk)\/quote/i;
const med=(a:number[])=>{if(!a.length)return NaN;const s=[...a].sort((x,y)=>x-y);const m=Math.floor(s.length/2);return s.length%2?s[m]:(s[m-1]+s[m])/2;};
const hm=(x:number)=>isNaN(x)?"-":x<60?`${x.toFixed(0)}m`:x<1440?`${(x/60).toFixed(1)}h`:`${(x/1440).toFixed(1)}d`;
async function main(){
  const dump=JSON.parse(fs.readFileSync("whatsapp-export/wa-dump.json","utf8")).filter((m:any)=>!SYS.has(m.type));
  const chats=new Map<string,any[]>(); for(const m of dump){if(!chats.has(m.chatName))chats.set(m.chatName,[]);chats.get(m.chatName)!.push(m);}
  for(const a of chats.values())a.sort((x,y)=>+new Date(x.ts)-+new Date(y.ts));
  const q:any=await db.execute(sql.raw(`SELECT phone,deposit_paid_at,created_at,base_price FROM personalized_quotes WHERE created_at>='2026-04-01' AND ${ND};`));
  const byP=new Map<string,any>();for(const r of(q.rows??q)){const n=natl(r.phone||"");if(n)byP.set(n,r);}
  const recs:{recent:boolean,big:boolean,paid:boolean,ttq:number|null,msgs:number}[]=[];
  for(const[name,msgs]of chats){const n=natl(name);if(!n||!byP.has(n))continue;const qr=byP.get(n);
    const real=msgs.filter((m:any)=>m.body||["image","video","audio","ptt","document","sticker"].includes(m.type));
    const qm=real.find((m:any)=>m.fromMe&&QRE.test(m.body||""));const fi=real.find((m:any)=>!m.fromMe);
    let ttq:number|null=null;if(qm&&fi&&+new Date(fi.ts)<+new Date(qm.ts))ttq=(+new Date(qm.ts)-+new Date(fi.ts))/60000;
    recs.push({recent:new Date(qr.created_at).toISOString().slice(0,7)!=="2026-04",big:(qr.base_price||0)>=30000,paid:!!qr.deposit_paid_at,ttq,msgs:real.length});}
  const cv=(g:any[])=>g.length?(100*g.filter(r=>r.paid).length/g.length).toFixed(0)+"%":"-";
  console.log("=== chat dynamics: BIG (£300+) vs SMALL, April vs May+June ===");
  console.log("group                 n   conv%   medTTQ   medMsgs");
  for(const[lbl,f]of[
    ["Apr  BIG £300+",(r:any)=>!r.recent&&r.big],["Apr  small",(r:any)=>!r.recent&&!r.big],
    ["MayJun BIG £300+",(r:any)=>r.recent&&r.big],["MayJun small",(r:any)=>r.recent&&!r.big]] as const){
    const g=recs.filter(f);const t=g.map(r=>r.ttq).filter((x:any)=>x!=null) as number[];
    console.log(`${lbl.padEnd(20)} ${String(g.length).padStart(3)}  ${cv(g).padStart(5)}  ${hm(med(t)).padStart(6)}  ${String(med(g.map(r=>r.msgs))).padStart(5)}`);}
  process.exit(0);
}
main().catch(e=>{console.error(e);process.exit(1);});
