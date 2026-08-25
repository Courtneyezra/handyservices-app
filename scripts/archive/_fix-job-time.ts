/**
 * Job-time intervention tool — set the VERIFIED on-site minutes on a quote's
 * lines so scheduling (days, packing, block sizing) reflects reality, not the
 * clamped pricing time.
 *
 * Why: timeEstimateMinutes doubles as a pricing knob and gets clamped per
 * category for scheduling (scheduling-caps.ts). A genuinely long line (e.g.
 * 16h flooring) is truncated to its cap → the job books too short.
 * `verifiedMinutes` is the human-vouched override — authoritative and
 * unclamped (see shared/schedule-composition.ts).
 *
 *   npx tsx scripts/_fix-job-time.ts show <slug>
 *   npx tsx scripts/_fix-job-time.ts set  <slug> <lineIndex> <value> [--dry]
 *     <value> = minutes (e.g. 780), hours (e.g. 13h), or 'clear' to remove.
 *
 * Writes back into personalized_quotes.pricing_line_items (jsonb). Read-only
 * `show` first; `set --dry` previews the day change without writing.
 */
import { sql } from 'drizzle-orm';
import { db } from '../server/db';
import { composeScheduleMinutes, computeRequiredDays, pickLineMinutes, lineScheduleMinutes, DAILY_CAPACITY_MIN } from '../shared/schedule-composition';
import { clampLineItemMinutes, CATEGORY_MAX_SCHEDULE_MINUTES } from '../shared/scheduling-caps';

const hrs = (m: number) => (m / 60).toFixed(2).replace(/\.00$/, '') + 'h';

async function load(slug: string) {
  const r = await db.execute(sql`SELECT id, customer_name, base_price, floor_number, has_lift, parking_distance_category, customer_present, pricing_line_items FROM personalized_quotes WHERE short_slug = ${slug} LIMIT 1;`);
  if (!r.rows.length) throw new Error(`quote ${slug} not found`);
  return r.rows[0] as any;
}
const ctxOf = (q: any) => ({ floorNumber: q.floor_number, hasLift: q.has_lift, parkingDistanceCategory: q.parking_distance_category, customerPresent: q.customer_present });

function render(q: any) {
  const lines = (q.pricing_line_items || []) as any[];
  const bd = composeScheduleMinutes(lines as any, ctxOf(q));
  const days = computeRequiredDays(bd.totalMinutes);
  console.log(`\n${String(q.customer_name).trim()} — cust £${((q.base_price || 0) / 100).toFixed(0)}`);
  lines.forEach((l, i) => {
    const raw = pickLineMinutes(l);
    const cap = (CATEGORY_MAX_SCHEDULE_MINUTES as any)[l.category] ?? 240;
    const eff = lineScheduleMinutes(l);
    const src = l.verifiedMinutes ? `VERIFIED ${hrs(l.verifiedMinutes)}` : raw > cap ? `clamped from ${hrs(raw)} (cap ${hrs(cap)})` : 'pricing time';
    console.log(`  [${i}] ${(l.category || 'other').padEnd(16)} eff ${hrs(eff).padStart(7)}  · ${src}  · labour £${(((l.guardedPricePence || 0)) / 100).toFixed(0)}`);
  });
  console.log(`  → work ${hrs(bd.workMinutes)} + buffers/access ${hrs(bd.totalMinutes - bd.workMinutes)} = ${hrs(bd.totalMinutes)} → ${days} day(s)`);
  // Day-boundary hints (on WORK minutes, since buffers are ~fixed).
  const nonWork = bd.totalMinutes - bd.workMinutes;
  const need = (d: number) => Math.max(0, (d - 1) * DAILY_CAPACITY_MIN + 1 - nonWork);
  console.log(`  day thresholds (work mins): 2 days > ${hrs(need(2))} · 3 days > ${hrs(need(3))} · 4 days > ${hrs(need(4))}`);
}

async function main() {
  const [cmd, slug, idxArg, valArg] = process.argv.slice(2);
  const dry = process.argv.includes('--dry');
  if (cmd === 'show' && slug) { render(await load(slug)); process.exit(0); }
  if (cmd === 'set' && slug && idxArg != null && valArg != null) {
    const q = await load(slug);
    const lines = (q.pricing_line_items || []) as any[];
    const i = Number(idxArg);
    if (!Number.isInteger(i) || i < 0 || i >= lines.length) throw new Error(`line index ${idxArg} out of range (0..${lines.length - 1})`);
    let minutes: number | null;
    if (valArg === 'clear') minutes = null;
    else if (/^\d+(\.\d+)?h$/.test(valArg)) minutes = Math.round(parseFloat(valArg) * 60);
    else minutes = Math.round(Number(valArg));
    if (minutes !== null && (!Number.isFinite(minutes) || minutes <= 0)) throw new Error(`bad value: ${valArg}`);

    console.log('BEFORE:'); render(q);
    if (minutes === null) delete lines[i].verifiedMinutes; else lines[i].verifiedMinutes = minutes;
    console.log(`\n${dry ? '[DRY] would set' : 'SET'} line [${i}] ${lines[i].category} verifiedMinutes = ${minutes === null ? 'cleared' : hrs(minutes)}`);
    console.log('AFTER:'); render({ ...q, pricing_line_items: lines });
    if (!dry) {
      await db.execute(sql`UPDATE personalized_quotes SET pricing_line_items = ${JSON.stringify(lines)}::jsonb WHERE id = ${q.id};`);
      console.log('\n✓ written');
    } else console.log('\n(dry run — nothing written)');
    process.exit(0);
  }
  console.error('usage: _fix-job-time.ts show <slug>  |  set <slug> <lineIndex> <minutes|Nh|clear> [--dry]');
  process.exit(1);
}
main().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
