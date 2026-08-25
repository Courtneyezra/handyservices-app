function decide(prefs: {date:string;timeSlot:string}[]) {
  const allFlexible = prefs.every(p => p.timeSlot === 'flexible');
  const dayLabel = (iso:string)=> new Date(iso+'T12:00:00').toLocaleDateString('en-GB',{weekday:'short',day:'numeric',month:'short'});
  if (allFlexible) {
    const allowed = prefs.map(p=>p.date).sort();
    const set = new Set(allowed);
    const avoided:string[]=[];
    const start=new Date(allowed[0]+'T12:00:00'), end=new Date(allowed[allowed.length-1]+'T12:00:00');
    for(const d=new Date(start); d<=end; d.setDate(d.getDate()+1)){ if(d.getDay()===0)continue; const iso=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; if(!set.has(iso))avoided.push(iso);}
    if (allowed.length>4) return avoided.length===0 ? 'Fully flexible — any day over the next 3 weeks' : 'Do not book: '+avoided.map(dayLabel).join(', ')+' (otherwise flexible)';
  }
  return 'Customer prefers: '+prefs.slice(0,4).map(p=>dayLabel(p.date)+' '+p.timeSlot).join(' | ');
}
// (a) faprev01-style: 16 allowed, avoiding Jul 21 + Jul 25
const wd:string[]=[]; const start=new Date('2026-07-19T12:00:00');
for(let i=0;i<21;i++){const d=new Date(start); d.setDate(d.getDate()+i); if(d.getDay()===0)continue; const iso=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; if(iso==='2026-07-21'||iso==='2026-07-25')continue; wd.push(iso);}
console.log('(a) avoid case →', decide(wd.map(d=>({date:d,timeSlot:'flexible'}))));
// (b) fully flexible: all 18 working days, none avoided
const wd2:string[]=[]; for(let i=0;i<21;i++){const d=new Date(start); d.setDate(d.getDate()+i); if(d.getDay()===0)continue; const iso=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; wd2.push(iso);}
console.log('(b) fully flexible →', decide(wd2.map(d=>({date:d,timeSlot:'flexible'}))));
// (c) legacy am/pm 3 picks
console.log('(c) legacy picks →', decide([{date:'2026-07-20',timeSlot:'am'},{date:'2026-07-22',timeSlot:'pm'},{date:'2026-07-24',timeSlot:'am'}]));
