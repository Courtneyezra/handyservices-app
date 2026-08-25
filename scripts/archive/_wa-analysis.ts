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
const SYS = new Set(["e2e_notification","notification_template","gp2","call_log","ciphertext","protocol","revoked"]);
const natl=(s:string)=>{ if(!s)return null; let x=s.replace(/[^\d]/g,"");
  if(x.startsWith("44")&&x.length===12)x=x.slice(2); else if(x.startsWith("0")&&x.length===11)x=x.slice(1);
  return (x.length===10&&x.startsWith("7"))?x:null; };
const QUOTE_RE=/handyservices\.(app|uk)\/quote/i;
const med=(a:number[])=>{ if(!a.length)return NaN; const s=[...a].sort((x,y)=>x-y); const m=Math.floor(s.length/2);
  return s.length%2?s[m]:(s[m-1]+s[m])/2; };
const quant=(a:number[],q:number)=>{ if(!a.length)return NaN; const s=[...a].sort((x,y)=>x-y); return s[Math.min(s.length-1,Math.floor(q*s.length))]; };
const hm=(min:number)=> isNaN(min)?"  -  ": min<60?`${min.toFixed(0)}m`: min<1440?`${(min/60).toFixed(1)}h`:`${(min/1440).toFixed(1)}d`;

async function main(){
  const dump=JSON.parse(fs.readFileSync("whatsapp-export/wa-dump.json","utf8"))
    .filter((m:any)=>!SYS.has(m.type));
  const chats=new Map<string,any[]>();
  for(const m of dump){ if(!chats.has(m.chatName))chats.set(m.chatName,[]); chats.get(m.chatName)!.push(m); }
  for(const arr of chats.values()) arr.sort((a,b)=>+new Date(a.ts)-+new Date(b.ts));

  const q:any=await db.execute(sql.raw(`SELECT phone, customer_name, short_slug, created_at,
     deposit_paid_at, base_price, (viewed_at IS NOT NULL OR COALESCE(view_count,0)>0) viewed
     FROM personalized_quotes WHERE created_at>='2026-04-01' AND ${ND};`));
  const qByPhone=new Map<string,any>(); for(const r of (q.rows??q)){ const n=natl(r.phone||""); if(n)qByPhone.set(n,r); }

  // build matched customer-chat records
  type Rec={month:string,paid:boolean,ttq:number|null,inboundFirst:boolean,replyMeds:number,
    replyP90:number,replies:number,slowReplies:number,msgs:number,inb:number,outb:number};
  const recs:Rec[]=[];
  for(const [name,msgs] of chats){ const n=natl(name); if(!n||!qByPhone.has(n)) continue;
    const qr=qByPhone.get(n); const month=new Date(qr.created_at).toISOString().slice(0,7);
    const paid=!!qr.deposit_paid_at;
    const real=msgs.filter((m:any)=>m.body||["image","video","audio","ptt","document","sticker"].includes(m.type));
    const inb=real.filter((m:any)=>!m.fromMe).length, outb=real.filter((m:any)=>m.fromMe).length;
    // quote-sent ts = first outbound containing quote link
    const qMsg=real.find((m:any)=>m.fromMe && QUOTE_RE.test(m.body||""));
    const firstInb=real.find((m:any)=>!m.fromMe);
    let ttq:number|null=null, inboundFirst=false;
    if(qMsg && firstInb && +new Date(firstInb.ts) < +new Date(qMsg.ts)){
      ttq=(+new Date(qMsg.ts)-+new Date(firstInb.ts))/60000; inboundFirst=true; }
    // reply latency: customer burst -> our reply (wait from first unanswered customer msg)
    const gaps:number[]=[]; let burstStart:number|null=null;
    for(const m of real){ const t=+new Date(m.ts);
      if(!m.fromMe){ if(burstStart===null) burstStart=t; }
      else { if(burstStart!==null){ gaps.push((t-burstStart)/60000); burstStart=null; } } }
    const slow=gaps.filter(g=>g>360).length; // >6h
    recs.push({month,paid,ttq,inboundFirst,replyMeds:med(gaps),replyP90:quant(gaps,0.9),
      replies:gaps.length,slowReplies:slow,msgs:real.length,inb,outb});
  }
  console.log(`matched customer chats: ${recs.length}  (paid ${recs.filter(r=>r.paid).length}, not ${recs.filter(r=>!r.paid).length})`);

  const grp=(f:(r:Rec)=>boolean)=>recs.filter(f);
  const line=(label:string,rs:Rec[])=>{
    const ttqs=rs.map(r=>r.ttq).filter(x=>x!=null) as number[];
    const replyMeds=rs.map(r=>r.replyMeds).filter(x=>!isNaN(x));
    const allGapP90=rs.map(r=>r.replyP90).filter(x=>!isNaN(x));
    const totReplies=rs.reduce((a,r)=>a+r.replies,0), totSlow=rs.reduce((a,r)=>a+r.slowReplies,0);
    console.log(`${label.padEnd(22)} n=${String(rs.length).padStart(3)} | TTQ med ${hm(med(ttqs)).padStart(6)} (n=${ttqs.length}) | reply med ${hm(med(replyMeds)).padStart(6)} p90 ${hm(med(allGapP90)).padStart(6)} | >6h ${(100*totSlow/(totReplies||1)).toFixed(0).padStart(3)}% | msgs ${String(med(rs.map(r=>r.msgs))).padStart(4)} (in ${med(rs.map(r=>r.inb))}/out ${med(rs.map(r=>r.outb))})`);
  };
  console.log("\n=== CONVERTED vs NOT (medians) ===");
  line("ALL", recs); line("CONVERTED (paid)", grp(r=>r.paid)); line("NOT converted", grp(r=>!r.paid));
  console.log("\n=== BY MONTH (medians) ===");
  for(const mo of ["2026-04","2026-05","2026-06"]) line(mo, grp(r=>r.month===mo));
  console.log("\n=== BY MONTH x OUTCOME ===");
  for(const mo of ["2026-04","2026-05","2026-06"]){ line(mo+" paid", grp(r=>r.month===mo&&r.paid)); line(mo+" not ", grp(r=>r.month===mo&&!r.paid)); }
  console.log("\n=== inbound-first vs quote-first (lead behaviour) ===");
  for(const mo of ["2026-04","2026-05","2026-06"]){ const g=grp(r=>r.month===mo);
    const inf=g.filter(r=>r.inboundFirst).length;
    console.log(`  ${mo}: chats ${g.length}, with quote-link sent in chat ${g.filter(r=>r.ttq!=null||true).length}, inbound-first(measurable TTQ) ${inf}`); }
  process.exit(0);
}
main().catch(e=>{console.error(e);process.exit(1);});
