import { db } from "../server/db"; import { sql } from "drizzle-orm"; import fs from "fs";
const ND=`NOT (COALESCE(phone,'') LIKE '07700900%' OR COALESCE(phone,'') LIKE '+447700900%' OR COALESCE(phone,'') LIKE '07700000%' OR COALESCE(phone,'') LIKE '+449900%' OR COALESCE(id,'') LIKE 'test_q_%' OR COALESCE(id,'') LIKE 'pq_test_%' OR COALESCE(customer_name,'') ILIKE '%test%' OR COALESCE(customer_name,'') ILIKE 'qa %' OR COALESCE(created_by_name,'') ILIKE '%test%' OR COALESCE(created_by_name,'') ILIKE '%qa%' OR COALESCE(created_by_name,'') ILIKE 'phase %' OR COALESCE(email,'') ILIKE '%@example.com' OR COALESCE(customer_name,'') ILIKE 'courtnee%' OR LOWER(TRIM(COALESCE(customer_name,'')))='ben')`;
const NDp=ND.replace(/COALESCE\(/g,"COALESCE(pq.").replace(/COALESCE\(pq\.\)/g,"COALESCE(").replace(/LOWER\(TRIM\(COALESCE\(pq\.customer_name/,"LOWER(TRIM(COALESCE(pq.customer_name");
const SYS=new Set(["e2e_notification","notification_template","gp2","call_log","ciphertext","protocol","revoked"]);
const natl=(s:string)=>{if(!s)return null;let x=s.replace(/[^\d]/g,"");if(x.startsWith("44")&&x.length===12)x=x.slice(2);else if(x.startsWith("0")&&x.length===11)x=x.slice(1);return(x.length===10&&x.startsWith("7"))?x:null;};
const QRE=/handyservices\.(app|uk)\/quote/i;
const med=(a:number[])=>{if(!a.length)return NaN;const s=[...a].sort((x,y)=>x-y);const m=Math.floor(s.length/2);return s.length%2?s[m]:(s[m-1]+s[m])/2;};
async function q(t:string){const r:any=await db.execute(sql.raw(t));return r.rows??r;}
async function main(){
  // ---- CHECK A: pre-link vs post-link engagement (WhatsApp matched chats) ----
  const dump=JSON.parse(fs.readFileSync("whatsapp-export/wa-dump.json","utf8")).filter((m:any)=>!SYS.has(m.type));
  const chats=new Map<string,any[]>(); for(const m of dump){if(!chats.has(m.chatName))chats.set(m.chatName,[]);chats.get(m.chatName)!.push(m);}
  for(const a of chats.values())a.sort((x,y)=>+new Date(x.ts)-+new Date(y.ts));
  const qr:any=await q(`SELECT phone,deposit_paid_at,base_price FROM personalized_quotes WHERE created_at>='2026-04-01' AND ${ND};`);
  const byP=new Map<string,any>(); for(const r of qr){const n=natl(r.phone||"");if(n)byP.set(n,r);}
  const recs:{paid:boolean;preIn:number;preOut:number;postIn:number;postOut:number}[]=[];
  for(const[name,msgs]of chats){const n=natl(name);if(!n||!byP.has(n))continue;
    const real=msgs.filter((m:any)=>m.body||["image","video","audio","ptt","document","sticker"].includes(m.type));
    const qm=real.find((m:any)=>m.fromMe&&QRE.test(m.body||"")); if(!qm)continue;
    const lt=+new Date(qm.ts); let preIn=0,preOut=0,postIn=0,postOut=0;
    for(const m of real){const t=+new Date(m.ts); if(t<lt){m.fromMe?preOut++:preIn++;} else if(t>lt){m.fromMe?postOut++:postIn++;}}
    recs.push({paid:!!byP.get(n).deposit_paid_at,preIn,preOut,postIn,postOut});}
  const P=recs.filter(r=>r.paid),N=recs.filter(r=>!r.paid);
  const stat=(rs:any[])=>`preIN ${med(rs.map(r=>r.preIn))} preOUT ${med(rs.map(r=>r.preOut))} | postIN ${med(rs.map(r=>r.postIn))} postOUT ${med(rs.map(r=>r.postOut))}`;
  console.log("=== CHECK A: pre-link vs post-link msgs (median) — does engagement that predicts conversion happen BEFORE the link? ===");
  console.log(`  CONVERTED (n=${P.length}): ${stat(P)}`);
  console.log(`  NOT      (n=${N.length}): ${stat(N)}`);
  console.log("  (post-link is partly mechanical for converters: scheduling/payment. PRE-link is the clean signal.)");

  // ---- CHECK B: is the source gap really job-size? median price + big-share by source ----
  console.log("\n=== CHECK B: median price & big-job share by lead source (Apr+) ===");
  for(const r of await q(`SELECT COALESCE(l.source,'(none)') src, COUNT(*) n,
     ROUND(percentile_cont(0.5) WITHIN GROUP (ORDER BY pq.base_price)/100.0) med_gbp,
     ROUND(100.0*AVG((pq.base_price>=30000)::int)) big_pct,
     ROUND(100.0*AVG((pq.deposit_paid_at IS NOT NULL)::int) FILTER (WHERE pq.viewed_at IS NOT NULL OR COALESCE(pq.view_count,0)>0)) conv_pct
     FROM personalized_quotes pq LEFT JOIN leads l ON l.id=pq.lead_id
     WHERE pq.created_at>='2026-04-01' AND ${NDp} GROUP BY 1 HAVING COUNT(*)>=5 ORDER BY 2 DESC;`))
     console.log(`  ${String(r.src).padEnd(17)} n=${String(r.n).padStart(3)}  medPrice £${String(r.med_gbp).padStart(4)}  big£300+ ${String(r.big_pct).padStart(3)}%  conv ${r.conv_pct}%`);

  // ---- CHECK C: WHEN did £300+ conversion break? 10-day buckets vs commit dates ----
  console.log("\n=== CHECK C: £300+ conversion by 10-day bucket (vs commits) ===");
  console.log("  commits: May6 large-job display + 10-item-cap | May29 SKU overhaul | May31-Jun1 flex+booking-gate");
  for(const r of await q(`WITH b AS (SELECT created_at, (viewed_at IS NOT NULL OR COALESCE(view_count,0)>0) v, (deposit_paid_at IS NOT NULL) p
     FROM personalized_quotes WHERE created_at>='2026-04-01' AND base_price>=30000 AND ${ND})
     SELECT to_char(date_trunc('day', created_at) - (EXTRACT(day FROM created_at)::int % 10) * interval '1 day','YYYY-MM-DD') bucket,
        COUNT(*) FILTER (WHERE v) viewed, COUNT(*) FILTER (WHERE p) paid
     FROM b GROUP BY 1 ORDER BY 1;`))
     console.log(`  ${r.bucket}  viewed=${String(r.viewed).padStart(2)} paid=${String(r.paid).padStart(2)}  ${(+r.viewed)?(100*(+r.paid)/(+r.viewed)).toFixed(0)+'%':'-'}`);
  process.exit(0);
}
main().catch(e=>{console.error(e);process.exit(1);});
