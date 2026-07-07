import fs from "fs";
const SYS=new Set(["e2e_notification","notification_template","gp2","call_log","ciphertext","protocol","revoked"]);
const natl=(s:string)=>{if(!s)return null;let x=s.replace(/[^\d]/g,"");if(x.startsWith("44")&&x.length===12)x=x.slice(2);else if(x.startsWith("0")&&x.length===11)x=x.slice(1);return(x.length===10&&x.startsWith("7"))?x:null;};
const SIG:[string,RegExp][]=[
 ["priceObj",/(too (much|expensive|dear|pricey)|can'?t afford|out of (my|our) budget|bit (much|steep|pricey)|expensive|cheaper (else|local|quote)|lot of money)/i],
 ["priceUNSTABLE",/(gone up|went up|price (has |)changed|more than (it said|the (website|app|link)|online|before)|why is it (more|higher|gone)|increased when|different price)/i],
 ["competitor",/(another (quote|compan|firm|carpenter|builder|guy)|someone else|local (guy|man|family|carpenter|builder|profession|lad)|going (with|elsewhere)|found someone|cheaper)/i],
 ["offlinePay",/(bank (details|transfer)|sort code|account number|pay(ing|) (cash|by bank|you direct|the cash)|in cash|transfer (the|you|it|money)|paypal|send (you |)(the |)money)/i],
 ["techLink",/(link (doesn|won|not|isn)|doesn'?t (work|open)|won'?t (open|load|let|go)|can'?t (open|pay|access)|error|page (won|not|isn|keeps)|not working|broken)/i],
];
const dump=JSON.parse(fs.readFileSync("whatsapp-export/wa-dump.json","utf8")).filter((m:any)=>!SYS.has(m.type));
// customer = phone-name chats (unsaved contacts)
const cust=new Set<string>(); for(const m of dump){ if(natl(m.chatName)) cust.add(m.chatName); }
const months=["2026-04","2026-05","2026-06"];
const inboundBy:Record<string,string[]>={}; for(const mo of months) inboundBy[mo]=[];
for(const m of dump){ if(!cust.has(m.chatName)||m.fromMe) continue; const mo=m.ts.slice(0,7); if(inboundBy[mo]) inboundBy[mo].push(m.body||""); }
console.log("=== customer inbound messages per month (phone-name chats) ===");
for(const mo of months) console.log(`  ${mo}: ${inboundBy[mo].length} inbound msgs`);
console.log("\n=== signal RATE per 100 inbound customer msgs, by month ===");
console.log("signal          "+months.map(m=>m.slice(5)).map(m=>("M"+m).padEnd(12)).join(""));
for(const [lbl,re] of SIG){
  const row=months.map(mo=>{const arr=inboundBy[mo];const n=arr.filter(t=>re.test(t)).length;return `${n} (${(100*n/(arr.length||1)).toFixed(1)})`.padEnd(12);});
  console.log(lbl.padEnd(15)+row.join(""));
}
for(const key of ["priceUNSTABLE","offlinePay","priceObj"]){
  const re=SIG.find(s=>s[0]===key)![1];
  console.log(`\n--- examples: ${key} ---`);
  let shown=0;
  for(const mo of months){ for(const t of inboundBy[mo]){ if(re.test(t)&&t.trim()){ console.log(`  [${mo.slice(5)}] ${t.replace(/\s+/g," ").trim().slice(0,90)}`); if(++shown>=12)break; } } if(shown>=12)break; }
}
