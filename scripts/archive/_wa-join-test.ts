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
function natl(s:string):string|null{ if(!s)return null; let x=s.replace(/[^\d]/g,"");
  if(x.startsWith("44")&&x.length===12) x=x.slice(2);
  else if(x.startsWith("0")&&x.length===11) x=x.slice(1);
  if(x.length===10&&x.startsWith("7")) return x; return null; }
async function main(){
  const dump=JSON.parse(fs.readFileSync("whatsapp-export/wa-dump.json","utf8"));
  // chats keyed by chatName
  const chats=new Map<string,any[]>();
  for(const m of dump){ if(!chats.has(m.chatName)) chats.set(m.chatName,[]); chats.get(m.chatName)!.push(m); }
  console.log("distinct chats:", chats.size);
  let phoneLike=0; const chatPhones=new Map<string,string>();
  for(const name of chats.keys()){ const n=natl(name); if(n){phoneLike++; chatPhones.set(name,n);} }
  console.log("chats with phone-like name:", phoneLike, " name-only:", chats.size-phoneLike);
  // phone id format
  let lid=0,cus=0; for(const m of dump){ if(String(m.phone).endsWith("@lid"))lid++; else if(String(m.phone).endsWith("@c.us"))cus++; }
  console.log("phone field @lid:",lid," @c.us:",cus);

  const q:any = await db.execute(sql.raw(`SELECT phone, customer_name, short_slug,
     created_at, deposit_paid_at, base_price,
     (viewed_at IS NOT NULL OR COALESCE(view_count,0)>0) viewed
     FROM personalized_quotes WHERE created_at>='2026-04-01' AND ${ND};`));
  const quotes=q.rows??q;
  console.log("quotes (Apr+):", quotes.length);
  const qByPhone=new Map<string,any>();
  for(const r of quotes){ const n=natl(r.phone||""); if(n) qByPhone.set(n,r); }
  console.log("quotes with parseable UK phone:", qByPhone.size);

  // join: chats (phone-like) matching a quote
  let matched=0, matchedPaid=0; const matchedNames:string[]=[];
  for(const [name,n] of chatPhones){ if(qByPhone.has(n)){ matched++; if(qByPhone.get(n).deposit_paid_at) matchedPaid++; matchedNames.push(name);} }
  console.log(`\nphone-name chats matching a quote: ${matched} (of ${phoneLike})  -> paid:${matchedPaid}`);
  console.log("sample matched chats:", matchedNames.slice(0,10).join(" | "));

  // name-based fallback: saved-name chats matching customer_name (loose)
  const qNames=quotes.map((r:any)=>({nm:String(r.customer_name||"").toLowerCase().trim(), r}));
  let nameMatch=0; const nm:string[]=[];
  for(const name of chats.keys()){ if(natl(name)) continue; const ln=name.toLowerCase().replace(/[^a-z\s]/g,"").trim(); if(ln.length<3) continue;
    const hit=qNames.find(x=>x.nm && (x.nm===ln || x.nm.split(" ")[0]===ln.split(" ")[0] && ln.split(" ")[0].length>3));
    if(hit){nameMatch++; if(nm.length<10)nm.push(`${name} -> ${hit.nm}`);} }
  console.log(`\nname-only chats loosely matching a quote: ${nameMatch}`);
  console.log("sample name matches:", nm.join(" | "));
  process.exit(0);
}
main().catch(e=>{console.error(e);process.exit(1);});
