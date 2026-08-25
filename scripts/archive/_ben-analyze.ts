import fs from 'fs';
const rows = JSON.parse(fs.readFileSync('scratch-ben-calls.json','utf8'));

// IVR / marketing boilerplate that plays on outbound track before Ben connects
const IVR = [
  /please wait while we connect you/i,
  /leak wait while we connect you/i,   // whisper transcription glitch variant
  /only local handyman service who quotes in minutes/i,
  /get a free quote quick/i,
  /if there'?s anything you'?d like me to know about your business/i,
  /just let me know\.?$/i,
  /how you handle inquiries/i,
];
const isIVR = (t:string)=>IVR.some(re=>re.test(t.trim()));

const words = (t:string)=>t.trim().split(/\s+/).filter(Boolean).length;
const BACKCHANNEL = /^(yeah\.?|yep\.?|yes\.?|mhmm\.?|mm\.?|okay\.?|ok\.?|right\.?|perfect\.?|excellent\.?|alright\.?|great\.?|sure\.?|no problem\.?|of course\.?|absolutely\.?|definitely\.?|good\.?|lovely\.?|brilliant\.?|cool\.?)+$/i;
const QWORD = /\b(what|when|where|which|who|how|why|are you|do you|did you|have you|can you|could you|would you|is it|is that|whereabouts|any chance)\b/i;

let totBen=0, totCaller=0, totQ=0, totBenTurns=0, totBackchannel=0;
const perCall:any[] = [];

for (const r of rows) {
  const segs = (r.seg||[]);
  let benW=0, callerW=0, q=0, benTurns=0, back=0;
  const benLines:string[]=[];
  const rapport:string[]=[];
  for (const s of segs) {
    const t=(s.text||'').trim(); if(!t) continue;
    if (s.track==='outbound') {
      if (isIVR(t)) continue;         // skip greeting
      benTurns++; benW+=words(t); benLines.push(t);
      if (t.includes('?')||QWORD.test(t)) q++;
      if (BACKCHANNEL.test(t)) back++;
      if (/how are you|good to (hear|speak)|no worries|no problem|ha(ha)+|to be fair|mate|bear with|lovely|cheers|take care|have a good/i.test(t)) rapport.push(t);
    } else {
      callerW+=words(t);
    }
  }
  totBen+=benW; totCaller+=callerW; totQ+=q; totBenTurns+=benTurns; totBackchannel+=back;
  perCall.push({ name:r.name, dur:r.dur, outcome:r.outcome, benW, callerW,
    talkRatio: callerW? +(benW/(benW+callerW)).toFixed(2):null,
    q, benTurns, back, rapportN:rapport.length,
    rapport: rapport.slice(0,4), benLines });
}

const N=rows.length;
console.log(`\n=== AGGREGATE across ${N} calls ===`);
console.log('Ben words total:', totBen, '| Caller words total:', totCaller);
console.log('Ben talk share (words):', (100*totBen/(totBen+totCaller)).toFixed(0)+'%  (customer:', (100*totCaller/(totBen+totCaller)).toFixed(0)+'%)');
console.log('Avg Ben questions per call:', (totQ/N).toFixed(1));
console.log('Avg Ben turns per call:', (totBenTurns/N).toFixed(1));
console.log('Backchannel/affirmation turns (share of Ben turns):', (100*totBackchannel/totBenTurns).toFixed(0)+'%');
console.log('Avg words per Ben turn:', (totBen/totBenTurns).toFixed(1));

// Distribution of talk ratio
const ratios = perCall.map(c=>c.talkRatio).filter(x=>x!=null).sort((a,b)=>a-b);
console.log('Talk-ratio median:', ratios[Math.floor(ratios.length/2)], '(0=all customer, 1=all Ben)');

const rapportCalls = perCall.filter(c=>c.rapportN>0).length;
console.log('Calls with any rapport/social marker:', rapportCalls, '/', N, `(${(100*rapportCalls/N).toFixed(0)}%)`);

// richest calls to read (longest, real convo)
const rich = [...perCall].filter(c=>c.dur>60 && c.callerW>30).sort((a,b)=>b.dur-a.dur).slice(0,12);
fs.writeFileSync('scratch-ben-analysis.json', JSON.stringify({perCall, rich}, null, 2));
console.log('\n=== 12 richest calls (for reading) ===');
rich.forEach(c=>console.log(`${(c.name||'?').padEnd(18)} ${String(c.dur)+'s'} ratio=${c.talkRatio} Q=${c.q} rapport=${c.rapportN} outcome=${c.outcome}`));
