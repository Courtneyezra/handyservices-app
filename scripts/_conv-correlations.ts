import { db } from "../server/db"; import { sql } from "drizzle-orm"; import fs from "fs";
const ND=`NOT (COALESCE(phone,'') LIKE '07700900%' OR COALESCE(phone,'') LIKE '+447700900%' OR COALESCE(phone,'') LIKE '07700000%' OR COALESCE(phone,'') LIKE '+449900%' OR COALESCE(id,'') LIKE 'test_q_%' OR COALESCE(id,'') LIKE 'pq_test_%' OR COALESCE(customer_name,'') ILIKE '%test%' OR COALESCE(customer_name,'') ILIKE 'qa %' OR COALESCE(created_by_name,'') ILIKE '%test%' OR COALESCE(created_by_name,'') ILIKE '%qa%' OR COALESCE(created_by_name,'') ILIKE 'phase %' OR COALESCE(email,'') ILIKE '%@example.com' OR COALESCE(customer_name,'') ILIKE 'courtnee%' OR LOWER(TRIM(COALESCE(customer_name,'')))='ben')`;
const SYS=new Set(["e2e_notification","notification_template","gp2","call_log","ciphertext","protocol","revoked"]);
const natl=(s:string)=>{if(!s)return null;let x=s.replace(/[^\d]/g,"");if(x.startsWith("44")&&x.length===12)x=x.slice(2);else if(x.startsWith("0")&&x.length===11)x=x.slice(1);return(x.length===10&&x.startsWith("7"))?x:null;};
const QRE=/handyservices\.(app|uk)\/quote/i;
const isVoice=(t:string)=>/ptt|audio/.test(t), isVid=(t:string)=>/image|video/.test(t), isDoc=(t:string)=>/document/.test(t);
async function q(t:string){const r:any=await db.execute(sql.raw(t));return r.rows??r;}
async function main(){
  const dump=JSON.parse(fs.readFileSync("whatsapp-export/wa-dump.json","utf8"));
  const tc:Record<string,number>={}; for(const m of dump) tc[m.type]=(tc[m.type]||0)+1;
  console.log("=== message type counts ==="); Object.entries(tc).sort((a,b)=>b[1]-a[1]).forEach(([k,v])=>console.log(`  ${k}: ${v}`));
  const real=dump.filter((m:any)=>!SYS.has(m.type));
  const chats=new Map<string,any[]>(); for(const m of real){if(!natl(m.chatName))continue;if(!chats.has(m.chatName))chats.set(m.chatName,[]);chats.get(m.chatName)!.push(m);}
  for(const a of chats.values())a.sort((x:any,y:any)=>+new Date(x.ts)-+new Date(y.ts));
  const qr:any=await q(`SELECT phone,deposit_paid_at FROM personalized_quotes WHERE created_at>='2026-04-01' AND ${ND};`);
  const byP=new Map<string,any>(); for(const r of qr){const n=natl(r.phone||"");if(n)byP.set(n,r);}

  type F={paid:boolean}&Record<string,boolean|number>;
  const recs:F[]=[];
  for(const [name,msgs] of chats){const n=natl(name);if(!n||!byP.has(n))continue;
    const m=msgs.filter((x:any)=>x.body||["image","video","audio","ptt","document","sticker"].includes(x.type));
    const qm=m.find((x:any)=>x.fromMe&&QRE.test(x.body||"")); const lt=qm?+new Date(qm.ts):Infinity;
    const pre=(x:any)=>+new Date(x.ts)<lt;
    const benVoice=m.some((x:any)=>x.fromMe&&isVoice(x.type));
    const custVoice=m.some((x:any)=>!x.fromMe&&isVoice(x.type));
    const custPhotoPre=m.some((x:any)=>!x.fromMe&&isVid(x.type)&&pre(x));
    const benPhoto=m.some((x:any)=>x.fromMe&&(isVid(x.type)||isDoc(x.type)));
    const custQpre=m.filter((x:any)=>!x.fromMe&&pre(x)&&/\?/.test(x.body||"")).length;
    const benQpre=m.filter((x:any)=>x.fromMe&&pre(x)&&/\?/.test(x.body||"")).length;
    // proactive follow-up: Ben message whose prev real msg is also Ben AND gap>3h (re-pinged a quiet thread)
    let benFollowup=0; for(let i=1;i<m.length;i++){ if(m[i].fromMe&&m[i-1].fromMe&&(+new Date(m[i].ts)-+new Date(m[i-1].ts))>3*3600e3) benFollowup++; }
    let turns=0; for(let i=1;i<m.length;i++) if(m[i].fromMe!==m[i-1].fromMe) turns++;
    recs.push({paid:!!byP.get(n).deposit_paid_at,benVoice,custVoice,custPhotoPre,benPhoto,
      custQpre:custQpre>=2,benQpre:benQpre>=1,benFollowup:benFollowup>=1,turnsHi:turns>=6} as any);}
  const base=recs.filter(r=>r.paid).length, N=recs.length;
  console.log(`\n=== conversion correlations (n=${N} chats, base conv ${(100*base/N).toFixed(0)}%) ===`);
  console.log("feature                       with: n  conv%   without: n  conv%   lift   note");
  const notes:Record<string,string>={custPhotoPre:"PRE-link (clean)",custQpre:"PRE-link (clean)",benQpre:"PRE-link (clean)",
    benVoice:"whole-chat",custVoice:"whole-chat",benPhoto:"whole-chat",benFollowup:"whole-chat (action)",turnsHi:"reverse-causal"};
  const feats=["benVoice","custVoice","custPhotoPre","benPhoto","custQpre","benQpre","benFollowup","turnsHi"];
  for(const f of feats){const wi=recs.filter(r=>r[f]),wo=recs.filter(r=>!r[f]);
    const cw=wi.length?100*wi.filter(r=>r.paid).length/wi.length:NaN, co=wo.length?100*wo.filter(r=>r.paid).length/wo.length:NaN;
    console.log(`${f.padEnd(28)} ${String(wi.length).padStart(4)}  ${(cw.toFixed(0)+'%').padStart(5)}      ${String(wo.length).padStart(4)}  ${(co.toFixed(0)+'%').padStart(5)}    ${((cw-co>=0?'+':'')+(cw-co).toFixed(0)+'pt').padStart(6)}  ${notes[f]||''}`);}
  process.exit(0);
}
main().catch(e=>{console.error(e);process.exit(1);});
