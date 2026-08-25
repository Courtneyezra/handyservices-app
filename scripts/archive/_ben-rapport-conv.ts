import { db } from '../server/db';
import { calls, personalizedQuotes } from '../shared/schema';
import { and, eq, isNotNull, sql } from 'drizzle-orm';

const IVR=[/please wait while we connect/i,/leak wait while we connect/i,/only local handyman service who quotes/i,/get a free quote quick/i,/anything you'?d like me to know about your business/i,/how you handle inquiries/i,/^just let me know\.?$/i];
const isIVR=(t:string)=>IVR.some(re=>re.test(t.trim()));
const words=(t:string)=>t.trim().split(/\s+/).filter(Boolean).length;
const RAPPORT=/how are you|good to (hear|speak)|no worries|no problem|ha(ha)+|to be fair|mate|bear with|lovely|cheers|take care|have a good|stay safe|speak soon|don'?t worry|brilliant|amazing/i;
const QWORD=/\b(what|when|where|which|who|how|why|are you|do you|did you|have you|can you|could you|would you|is it|is that|whereabouts|any chance)\b/i;
const norm=(p:string)=>{let x=(p||'').replace(/[^\d]/g,'');if(x.startsWith('44'))x=x.slice(2);if(x.startsWith('0'))x=x.slice(1);return x.slice(-9);};

async function main(){
  const BEN='024ea1a1-dc74-450b-a89f-6481db2bc16c';
  const cs = await db.select({id:calls.id,name:calls.customerName,phone:calls.phoneNumber,dur:calls.duration,seg:calls.segments})
    .from(calls).where(and(eq(calls.handledByUserId,BEN),isNotNull(calls.transcription)));

  const qs = await db.select({id:personalizedQuotes.id,srcCall:personalizedQuotes.sourceCallId,phone:personalizedQuotes.phone,viewed:personalizedQuotes.viewedAt,paid:personalizedQuotes.depositPaidAt}).from(personalizedQuotes);

  const byCall=new Map<string,any[]>(); const byPhone=new Map<string,any[]>();
  for(const q of qs){ if(q.srcCall){(byCall.get(q.srcCall)||byCall.set(q.srcCall,[]).get(q.srcCall))!.push(q);} const p=norm(q.phone||''); if(p.length>=9){(byPhone.get(p)||byPhone.set(p,[]).get(p))!.push(q);} }

  const recs:any[]=[];
  for(const c of cs){
    let benW=0,callW=0,rap=0,q=0,turns=0;
    for(const s of (c.seg as any[]||[])){const t=(s.text||'').trim();if(!t)continue;
      if(s.track==='outbound'){if(isIVR(t))continue;turns++;benW+=words(t);if(t.includes('?')||QWORD.test(t))q++;if(RAPPORT.test(t))rap++;}
      else callW+=words(t);}
    // link quote: by call id first, else phone
    let linked = byCall.get(c.id)||[];
    if(!linked.length){ linked = byPhone.get(norm(c.phone||''))||[]; }
    const hasQuote = linked.length>0;
    const viewed = linked.some((x:any)=>x.viewed);
    const paid = linked.some((x:any)=>x.paid);
    recs.push({name:c.name,dur:c.dur||0,benW,callW,ratio:callW?benW/(benW+callW):null,rap,q,turns,hasQuote,viewed,paid});
  }

  const N=recs.length;
  const withQuote=recs.filter(r=>r.hasQuote);
  const paid=recs.filter(r=>r.paid);
  console.log(`Ben calls: ${N} | linked to a quote: ${withQuote.length} | quote viewed: ${recs.filter(r=>r.viewed).length} | deposit PAID: ${paid.length}`);

  const mean=(a:number[])=>a.length?a.reduce((x,y)=>x+y,0)/a.length:NaN;
  const grp=(pred:(r:any)=>boolean,lbl:string)=>{
    const g=recs.filter(pred);
    console.log(`\n${lbl} (n=${g.length}):`);
    console.log('  avg rapport markers:', mean(g.map(r=>r.rap)).toFixed(2));
    console.log('  avg questions:', mean(g.map(r=>r.q)).toFixed(2));
    console.log('  avg duration(s):', mean(g.map(r=>r.dur)).toFixed(0));
    console.log('  avg Ben talk-ratio:', mean(g.map(r=>r.ratio).filter((x:any)=>x!=null)).toFixed(2));
    console.log('  avg Ben words:', mean(g.map(r=>r.benW)).toFixed(0));
  };
  console.log('\n===== RAPPORT / STYLE vs OUTCOME =====');
  grp(r=>r.paid,'PAID (converted)');
  grp(r=>r.hasQuote && !r.paid,'Got a quote but NOT paid');
  grp(r=>!r.hasQuote,'No quote generated');

  // point-biserial-ish: correlation of rapport with paid, and duration with paid
  const corr=(xs:number[],ys:number[])=>{const n=xs.length;const mx=mean(xs),my=mean(ys);let num=0,dx=0,dy=0;for(let i=0;i<n;i++){num+=(xs[i]-mx)*(ys[i]-my);dx+=(xs[i]-mx)**2;dy+=(ys[i]-my)**2;}return num/Math.sqrt(dx*dy);};
  const paidY=recs.map(r=>r.paid?1:0);
  const quoteY=recs.map(r=>r.hasQuote?1:0);
  console.log('\n===== CORRELATIONS (Pearson, point-biserial) =====');
  console.log('rapport  vs PAID :', corr(recs.map(r=>r.rap),paidY).toFixed(2));
  console.log('duration vs PAID :', corr(recs.map(r=>r.dur),paidY).toFixed(2));
  console.log('questions vs PAID:', corr(recs.map(r=>r.q),paidY).toFixed(2));
  console.log('rapport  vs got-QUOTE :', corr(recs.map(r=>r.rap),quoteY).toFixed(2));
  console.log('duration vs got-QUOTE :', corr(recs.map(r=>r.dur),quoteY).toFixed(2));
  console.log('questions vs got-QUOTE:', corr(recs.map(r=>r.q),quoteY).toFixed(2));
  process.exit(0);
}
main().catch(e=>{console.error(e);process.exit(1);});
