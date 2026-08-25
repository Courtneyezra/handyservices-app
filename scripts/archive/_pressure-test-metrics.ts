import { buildVaOverview } from '../server/call-performance-routes';
import { db } from '../server/db';
import { sql } from 'drizzle-orm';

const NOT_TEST = sql`(phone_number IS NULL OR (phone_number NOT LIKE '%447700900%' AND phone_number NOT LIKE '%07700900%' AND phone_number NOT LIKE '%449900001%'))`;

function periodWhere(period: string) {
  const now = new Date();
  if (period === 'all') return sql`TRUE`;
  if (period === 'week') return sql`start_time >= ${new Date(Date.now()-7*864e5)}`;
  if (period === 'today') { const s=new Date(); s.setHours(0,0,0,0); return sql`start_time >= ${s}`; }
  if (period === 'yesterday') { const s=new Date(); s.setHours(0,0,0,0); return sql`start_time >= ${new Date(s.getTime()-864e5)} AND start_time < ${s}`; }
  // month
  return sql`start_time >= ${new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(),1))} AND start_time < ${new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth()+1,1))}`;
}

async function main() {
  for (const period of ['today','yesterday','week','month','all']) {
    const o: any = await buildVaOverview(period as any);
    const t = o.totals;
    // independent ground truth
    const gt: any = (await db.execute(sql`
      SELECT count(*)::int total,
        (count(*) FILTER (WHERE handled_by='va'))::int va,
        (count(*) FILTER (WHERE handled_by='ai_agent'))::int ai,
        (count(*) FILTER (WHERE handled_by='missed'))::int missed,
        (count(*) FILTER (WHERE handled_by='voicemail'))::int vm,
        (count(*) FILTER (WHERE handled_by IS NULL))::int unclassified
      FROM calls WHERE ${periodWhere(period)} AND ${NOT_TEST}`)).rows[0];

    const bucketsSum = t.va + t.aiAgent + t.missed + t.voicemail + t.unclassified;
    const rateCheck = t.total>0 ? Math.round((100*(t.va+t.aiAgent)/t.total)*10)/10 : 0;
    const problems: string[] = [];
    if (t.total !== gt.total) problems.push(`total ${t.total}≠GT ${gt.total}`);
    if (bucketsSum !== t.total) problems.push(`buckets sum ${bucketsSum}≠total ${t.total}`);
    if (t.answeredRatePct !== rateCheck) problems.push(`rate ${t.answeredRatePct}≠${rateCheck}`);
    // THE key consistency: answered% implies (100-rate)% not-answered, but missed card only shows explicit missed
    const notAnswered = t.total - (t.va + t.aiAgent);
    const shownAsMissedOrVm = t.missed + t.voicemail;
    if (notAnswered !== shownAsMissedOrVm) problems.push(`⚠ ${notAnswered} not-answered but only ${shownAsMissedOrVm} shown as missed+vm (${t.unclassified} unclassified invisible)`);

    console.log(`\n[${period}] total=${t.total} answered=${t.va+t.aiAgent} (${t.answeredRatePct}%) missed=${t.missed} vm=${t.voicemail} unclassified=${t.unclassified}`);
    console.log(problems.length ? '  ✗ ' + problems.join(' | ') : '  ✓ internally consistent');
  }
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
