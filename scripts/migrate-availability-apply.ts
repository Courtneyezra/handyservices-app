/**
 * APPLY — normalize contractor_availability_dates to one clean UTC-midnight row
 * per calendar day. Mirrors migrate-availability-dryrun.ts exactly.
 *   1. SNAP: any row not at 00:00:00 → same calendar DATE at 00:00:00Z (day never changes).
 *   2. DEDUPE: on collision keep ONE — the existing clean 00:00 row wins; else OFF wins.
 * Runs in a single transaction. Reads via ::text to avoid JS Date-parser ambiguity.
 */
import { Pool } from 'pg';
import 'dotenv/config';

(async () => {
  const p = new Pool({ connectionString: process.env.DATABASE_URL });
  const client = await p.connect();
  try {
    const { rows } = await client.query(`
      select id, contractor_id, date::text as raw,
             to_char(date,'YYYY-MM-DD') as day, to_char(date,'HH24:MI:SS') as tod,
             is_available from contractor_availability_dates`);

    const byDay = new Map<string, any[]>();
    for (const r of rows) { const k = r.contractor_id + '|' + r.day; (byDay.get(k) ?? byDay.set(k, []).get(k)!).push(r); }

    await client.query('BEGIN');
    let snaps = 0, drops = 0, conflicts = 0;
    console.log('=== APPLYING ===');
    for (const [k, group] of byDay) {
      if (!group.some(r => r.tod !== '00:00:00')) continue; // day already clean
      const [, day] = k.split('|');
      if (group.length === 1) {
        const r = group[0];
        // Snap: set the date to midnight UTC of the SAME calendar date.
        await client.query(`update contractor_availability_dates set date = ($1::date)::timestamp where id = $2`, [day, r.id]);
        console.log(`  SNAP  ${day}  ${r.raw} → ${day} 00:00:00  (${r.is_available ? 'AVAIL' : 'OFF'})`);
        snaps++;
      } else {
        conflicts++;
        const clean = group.find(r => r.tod === '00:00:00');
        const off = group.find(r => !r.is_available);
        const keep = clean ?? off ?? group[0];
        console.log(`  CONFLICT ${day}: ${group.map(r => `[${r.tod} ${r.is_available ? 'AVAIL' : 'OFF'}]`).join(' vs ')}`);
        for (const r of group) {
          if (r.id === keep.id) {
            if (r.tod !== '00:00:00') await client.query(`update contractor_availability_dates set date = ($1::date)::timestamp where id = $2`, [day, r.id]);
            console.log(`     KEEP  ${r.raw} (${r.is_available ? 'AVAIL' : 'OFF'})`);
          } else {
            await client.query(`delete from contractor_availability_dates where id = $1`, [r.id]);
            console.log(`     DROP  ${r.raw} (${r.is_available ? 'AVAIL' : 'OFF'})`);
            drops++;
          }
        }
      }
    }
    await client.query('COMMIT');
    console.log(`\nCOMMITTED: snap ${snaps} · resolve ${conflicts} conflict(s) · drop ${drops} duplicate(s)`);
  } catch (e: any) {
    await client.query('ROLLBACK');
    console.error('ROLLED BACK —', e.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await p.end();
  }
})();
