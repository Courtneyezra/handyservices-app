import { db } from "../server/db"; import { sql } from "drizzle-orm"; import fs from "fs";
const ND=`NOT (COALESCE(phone,'') LIKE '07700900%' OR COALESCE(phone,'') LIKE '+447700900%' OR COALESCE(phone,'') LIKE '07700000%' OR COALESCE(phone,'') LIKE '+449900%' OR COALESCE(id,'') LIKE 'test_q_%' OR COALESCE(id,'') LIKE 'pq_test_%' OR COALESCE(customer_name,'') ILIKE '%test%' OR COALESCE(customer_name,'') ILIKE 'qa %' OR COALESCE(created_by_name,'') ILIKE '%test%' OR COALESCE(created_by_name,'') ILIKE '%qa%' OR COALESCE(created_by_name,'') ILIKE 'phase %' OR COALESCE(email,'') ILIKE '%@example.com' OR COALESCE(customer_name,'') ILIKE 'courtnee%' OR LOWER(TRIM(COALESCE(customer_name,'')))='ben')`;
const SYS=new Set(["e2e_notification","notification_template","gp2","call_log","ciphertext","protocol","revoked"]);
const natl=(s:string)=>{if(!s)return null;let x=s.replace(/[^\d]/g,"");if(x.startsWith("44")&&x.length===12)x=x.slice(2);else if(x.startsWith("0")&&x.length===11)x=x.slice(1);return(x.length===10&&x.startsWith("7"))?x:null;};
const QRE=/handyservices\.(app|uk)\/quote/i;
const SIG:[string,RegExp][]=[
 ["price",/\b(expensive|too much|pricey|afford|cheaper|budget|steep|bit much|too dear|a lot)\b/i],
 ["pay/tech",/(doesn'?t work|won'?t (open|let|load|go)|can'?t (pay|open|get)|not working|broken|error|the link|deposit|upfront|pay (first|now)|won'?t accept|card details|loading|page)/i],
 ["stall/comp",/(think about|get back to|let you know|someone else|another (quote|company|firm)|sorted now|no longer|changed my mind|cancel|found someone|going with|decided to|don'?t need)/i],
 ["chasing",/(any update|still waiting|heard (back|anything)|you there|hello\?|following up|chase|when can|how long)/i],
];
async function q(t:string){const r:any=await db.execute(sql.raw(t));return r.rows??r;}
const clean=(s:string)=>(s||"").replace(/\s+/g," ").trim();
async function main(){
  const dump=JSON.parse(fs.readFileSync("whatsapp-export/wa-dump.json","utf8")).filter((m:any)=>!SYS.has(m.type));
  const chats=new Map<string,any[]>(); for(const m of dump){if(!chats.has(m.chatName))chats.set(m.chatName,[]);chats.get(m.chatName)!.push(m);}
  for(const a of chats.values())a.sort((x,y)=>+new Date(x.ts)-+new Date(y.ts));
  const qr:any=await q(`SELECT phone,deposit_paid_at,base_price,created_at FROM personalized_quotes WHERE created_at>='2026-04-01' AND ${ND};`);
  const byP=new Map<string,any>(); for(const r of qr){const n=natl(r.phone||"");if(n)byP.set(n,r);}
  type C={month:string;paid:boolean;big:boolean;msgs:any[];linkTs:number|null;postInb:any[];lastInb:any};
  const cs:C[]=[];
  for(const[name,msgs]of chats){const n=natl(name);if(!n||!byP.has(n))continue;const r=byP.get(n);
    const real=msgs.filter((m:any)=>m.body||["image","video","audio","ptt","document","sticker"].includes(m.type));
    const qm=real.find((m:any)=>m.fromMe&&QRE.test(m.body||""));const lt=qm?+new Date(qm.ts):null;
    const postInb=lt?real.filter((m:any)=>!m.fromMe&&+new Date(m.ts)>lt):[];
    const inbs=real.filter((m:any)=>!m.fromMe);
    cs.push({month:new Date(r.created_at).toISOString().slice(0,7),paid:!!r.deposit_paid_at,big:(r.base_price||0)>=30000,msgs:real,linkTs:lt,postInb,lastInb:inbs[inbs.length-1]});}

  const months=["2026-04","2026-05","2026-06"];
  console.log("=== A) POST-LINK FATE by month: of matched chats, % that go SILENT after the link (<=1 reply) ===");
  console.log("month   chats  gotLink  silentAfterLink%  engaged&lost%  engaged&won%");
  for(const mo of months){const g=cs.filter(c=>c.month===mo);const gl=g.filter(c=>c.linkTs);
    const silent=gl.filter(c=>c.postInb.length<=1).length;
    const engLost=gl.filter(c=>c.postInb.length>1&&!c.paid).length;
    const engWon=gl.filter(c=>c.postInb.length>1&&c.paid).length;
    console.log(`${mo}  ${String(g.length).padStart(4)}  ${String(gl.length).padStart(6)}  ${(100*silent/(gl.length||1)).toFixed(0).padStart(13)}%  ${(100*engLost/(gl.length||1)).toFixed(0).padStart(11)}%  ${(100*engWon/(gl.length||1)).toFixed(0).padStart(10)}%`);}

  console.log("\n=== B) FRICTION SIGNALS in POST-LINK customer messages, by month (count / per 10 chats) ===");
  console.log("month   "+SIG.map(s=>s[0].padEnd(10)).join(""));
  for(const mo of months){const g=cs.filter(c=>c.month===mo&&c.linkTs);const txt=g.flatMap(c=>c.postInb.map((m:any)=>m.body||""));
    const row=SIG.map(([lbl,re])=>{const n=txt.filter(t=>re.test(t)).length;return `${n}(${(10*n/(g.length||1)).toFixed(1)})`.padEnd(10);});
    console.log(`${mo}  `+row.join(""));}

  console.log("\n=== C) LOST BIG-JOB (£300+) chats — did they react to the link, and last words ===");
  const lostBig=cs.filter(c=>c.big&&!c.paid&&c.linkTs).sort((a,b)=>a.month.localeCompare(b.month));
  console.log(`(n=${lostBig.length})  month | reactedToLink | lastCustomerMsg`);
  for(const c of lostBig.slice(0,30)){
    const reacted=c.postInb.length>0?`reply x${c.postInb.length}`:"SILENT";
    console.log(`  ${c.month} | ${reacted.padEnd(9)} | ${clean(c.lastInb?.body||"(none)").slice(0,72)}`);}

  console.log("\n=== D) for ENGAGED-BUT-LOST big jobs: the post-link customer messages (the objection) ===");
  for(const c of lostBig.filter(c=>c.postInb.length>0).slice(0,14)){
    console.log(`  [${c.month} £${Math.round((byP.get(natl(c.msgs[0]? "":"")||"")?.base_price||0))||""}] ${c.postInb.map((m:any)=>clean(m.body)).filter(Boolean).slice(0,3).join("  //  ").slice(0,140)}`);}
  process.exit(0);
}
main().catch(e=>{console.error(e);process.exit(1);});
