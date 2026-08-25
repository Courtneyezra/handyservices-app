import 'dotenv/config';
import { buildVaOverview } from '../server/call-performance-routes';
for (const p of ['yesterday','week','month','all'] as const) {
  const o: any = await buildVaOverview(p);
  const t = o.totals;
  const check = (t.missedNoAnswer + t.missedAbandoned) === t.missed ? 'OK' : 'MISMATCH';
  console.log(`[${p}] missed=${t.missed} → no-answer=${t.missedNoAnswer} + hung-up=${t.missedAbandoned}  vm=${t.voicemail}  [${check}]`);
}
process.exit(0);
