/**
 * DRY RUN — normalize contractor_availability_dates to one clean UTC-midnight row
 * per calendar day. Reads via ::text/to_char to avoid ALL JS Date-parser ambiguity.
 * WRITES NOTHING. Proposed rules:
 *   1. SNAP: any row not at 00:00:00 → same calendar date at 00:00:00 (never changes the day).
 *   2. DEDUPE: if that collides with an existing row for the day, keep ONE —
 *      a) the row already stored at 00:00:00 (the clean one) wins; else
 *      b) OFF wins over AVAIL (never expose a day the contractor blocked).
 */
import { Pool } from 'pg';
import 'dotenv/config';

(async () => {
  const p = new Pool({ connectionString: process.env.DATABASE_URL });
  const { rows } = await p.query(`
    select id, contractor_id, date::text as raw,
           to_char(date,'YYYY-MM-DD') as day, to_char(date,'HH24:MI:SS') as tod,
           is_available from contractor_availability_dates`);

  const corrupt = rows.filter(r => r.tod !== '00:00:00');
  console.log(`TOTAL ${rows.length} rows · ${corrupt.length} need snapping (time ≠ 00:00:00)\n`);

  // Group by contractor+day to find collisions after snapping.
  const byDay = new Map<string, any[]>();
  for (const r of rows) { const k = r.contractor_id + '|' + r.day; (byDay.get(k) ?? byDay.set(k, []).get(k)!).push(r); }

  console.log('=== PROPOSED CHANGES ===');
  let snaps = 0, drops = 0, conflicts = 0;
  for (const [k, group] of byDay) {
    const hasCorrupt = group.some(r => r.tod !== '00:00:00');
    if (!hasCorrupt) continue;
    const [, day] = k.split('|');
    if (group.length === 1) {
      console.log(`  SNAP  ${day}  ${group[0].raw} → ${day} 00:00:00  (${group[0].is_available ? 'AVAIL' : 'OFF'})`);
      snaps++;
    } else {
      // collision — decide the keeper
      conflicts++;
      const clean = group.find(r => r.tod === '00:00:00');
      const off = group.find(r => !r.is_available);
      const keep = clean ?? off ?? group[0];
      console.log(`  CONFLICT ${day}: ${group.map(r => `[${r.tod} ${r.is_available ? 'AVAIL' : 'OFF'}]`).join(' vs ')}`);
      for (const r of group) {
        if (r.id === keep.id) console.log(`     KEEP  ${r.raw} (${r.is_available ? 'AVAIL' : 'OFF'})${clean === r ? ' — clean 00:00 row' : off === r ? ' — OFF wins' : ''}`);
        else { console.log(`     DROP  ${r.raw} (${r.is_available ? 'AVAIL' : 'OFF'})`); drops++; }
      }
    }
  }
  console.log(`\nSUMMARY: snap ${snaps} rows · resolve ${conflicts} conflict(s) · drop ${drops} duplicate(s)`);
  console.log('(DRY RUN — nothing written.)');
  await p.end();
})();
