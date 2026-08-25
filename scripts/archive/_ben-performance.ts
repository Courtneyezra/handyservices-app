import fs from "fs";
const SYS=new Set(["e2e_notification","notification_template","gp2","call_log","ciphertext","protocol","revoked"]);
const natl=(s:string)=>{if(!s)return null;let x=s.replace(/[^\d]/g,"");if(x.startsWith("44")&&x.length===12)x=x.slice(2);else if(x.startsWith("0")&&x.length===11)x=x.slice(1);return(x.length===10&&x.startsWith("7"))?x:null;};
const QRE=/handyservices\.(app|uk)\/quote/i;
const CHASE=/(any update|update\?|still waiting|heard (back|anything)|you there|hello\?|following up|just chasing|just checking|when (can|will|are|do)|how long|did you (get|receive|manage|have)|are you (still|there|able|free)|still (interested|available|able)|^\?+$|bump)/i;
const med=(a:number[])=>{if(!a.length)return NaN;const s=[...a].sort((x,y)=>x-y);const m=Math.floor(s.length/2);return s.length%2?s[m]:(s[m-1]+s[m])/2;};
const quant=(a:number[],q:number)=>{if(!a.length)return NaN;const s=[...a].sort((x,y)=>x-y);return s[Math.min(s.length-1,Math.floor(q*s.length))];};
const hm=(x:number)=>isNaN(x)?"  - ":x<60?`${x.toFixed(0)}m`:x<1440?`${(x/60).toFixed(1)}h`:`${(x/1440).toFixed(1)}d`;
const dump=JSON.parse(fs.readFileSync("whatsapp-export/wa-dump.json","utf8")).filter((m:any)=>!SYS.has(m.type));
const chats=new Map<string,any[]>(); for(const m of dump){ if(!natl(m.chatName))continue; if(!chats.has(m.chatName))chats.set(m.chatName,[]); chats.get(m.chatName)!.push(m);}
for(const a of chats.values())a.sort((x:any,y:any)=>+new Date(x.ts)-+new Date(y.ts));
const months=["2026-04","2026-05","2026-06"];
const firstReply:Record<string,number[]>={}, normReply:Record<string,number[]>={}, quoteReply:Record<string,number[]>={};
const inboundN:Record<string,number>={}, chaseN:Record<string,number>={};
const chatsEndMonth:Record<string,number>={}, hangN:Record<string,number>={}, neverN:Record<string,number>={};
for(const mo of months){firstReply[mo]=[];normReply[mo]=[];quoteReply[mo]=[];inboundN[mo]=0;chaseN[mo]=0;chatsEndMonth[mo]=0;hangN[mo]=0;neverN[mo]=0;}
for(const [name,msgs] of chats){
  const real=msgs.filter((m:any)=>m.body||["image","video","audio","ptt","document","sticker"].includes(m.type));
  if(!real.some((m:any)=>!m.fromMe)) continue; // need a customer message
  let burstStart:number|null=null, firstDone=false, outCount=0;
  for(const m of real){
    const t=+new Date(m.ts), mo=m.ts.slice(0,7);
    if(!m.fromMe){ if(burstStart===null)burstStart=t; if(months.includes(mo)){inboundN[mo]++; if(CHASE.test((m.body||"").trim()))chaseN[mo]++;} }
    else { outCount++;
      if(burstStart!==null){ const gap=(t-burstStart)/60000; const bm=new Date(burstStart).toISOString().slice(0,7);
        if(months.includes(bm)){ const isQ=QRE.test(m.body||"");
          if(isQ) quoteReply[bm].push(gap); else normReply[bm].push(gap);
          if(!firstDone) firstReply[bm].push(gap); }
        firstDone=true; burstStart=null; } } }
  // left-hanging / never-replied (tag by last message month)
  const last=real[real.length-1]; const lm=last.ts.slice(0,7);
  if(months.includes(lm)){ chatsEndMonth[lm]++; if(!last.fromMe) hangN[lm]++; if(outCount===0) neverN[lm]++; }
}
const pctSlow=(a:number[],min:number)=>a.length?(100*a.filter(x=>x>min).length/a.length).toFixed(0)+"%":"-";
console.log("=== BEN's WHATSAPP ATTENTIVENESS, month by month (phone-name customer chats) ===\n");
console.log("metric                          Apr        May        Jun");
const row=(lbl:string,f:(mo:string)=>string)=>console.log(lbl.padEnd(30)+months.map(mo=>f(mo).padEnd(11)).join(""));
console.log("-- CLEAN (not gated by contractor availability) --");
row("First-reply median",        mo=>hm(med(firstReply[mo])));
row("First-reply p90",           mo=>hm(quant(firstReply[mo],0.9)));
row("Normal-reply median (no qt)",mo=>hm(med(normReply[mo])));
row("Normal-reply p90",          mo=>hm(quant(normReply[mo],0.9)));
row("Replies >6h late",          mo=>pctSlow(normReply[mo],360));
row("Chase msgs / 100 inbound",  mo=>(100*chaseN[mo]/(inboundN[mo]||1)).toFixed(1));
row("Left-hanging (end on cust)", mo=>`${(100*hangN[mo]/(chatsEndMonth[mo]||1)).toFixed(0)}%`);
row("Never-replied chats",       mo=>`${(100*neverN[mo]/(chatsEndMonth[mo]||1)).toFixed(0)}%`);
console.log("-- GATED (system: must confirm contractor supply first) --");
row("Quote-delivery median",     mo=>hm(med(quoteReply[mo])));
row("Quote-delivery p90",        mo=>hm(quant(quoteReply[mo],0.9)));
console.log("\nsample sizes (chats ending / inbound msgs):");
row("chats ended / inbound",     mo=>`${chatsEndMonth[mo]}/${inboundN[mo]}`);
