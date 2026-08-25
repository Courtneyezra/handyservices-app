/**
 * Read back a site-survey submission for a given visit-link slug.
 * Usage: npx tsx scripts/_read-survey.ts <slug>
 * (Reads the survey_response jsonb column via raw SQL so it works
 *  regardless of whether the local Drizzle schema has the column yet.)
 */
import { db } from '../server/db';
import { sql } from 'drizzle-orm';

const LABELS: Record<string, string> = {
  'small-bedroom-paper': 'Small bedroom — strip old paper & hang new',
  'small-room-ceiling-wall': 'Small room — ceiling/wall junction repair',
  'bay-bedroom-ceiling': 'Front bay bedroom — ceiling make-good (old light points)',
  'back-room-ceiling': 'Downstairs back room — ceiling repair',
  'front-pointing': 'Front elevation — repoint bigger sections (colour-match)',
};

async function main() {
  const slug = process.argv[2];
  if (!slug) { console.error('Usage: npx tsx scripts/_read-survey.ts <slug>'); process.exit(1); }

  const res = await db.execute(sql`
    SELECT short_slug, customer_name, address, survey_submitted_at, survey_response
    FROM personalized_quotes
    WHERE short_slug = ${slug}
    LIMIT 1
  `);
  const row: any = res.rows?.[0];
  if (!row) { console.log(`No quote found for slug "${slug}".`); process.exit(0); }

  console.log(`\n=== SITE SURVEY — ${row.customer_name || '(no name)'} ===`);
  console.log(`Slug: ${row.short_slug}   Address: ${row.address || '—'}`);
  console.log(`Submitted: ${row.survey_submitted_at || 'NOT SUBMITTED YET'}`);

  const sr = row.survey_response;
  if (!sr) { console.log('\n(no survey response on this row yet)\n'); process.exit(0); }
  const data = typeof sr === 'string' ? JSON.parse(sr) : sr;

  console.log(`Surveyor: ${data.surveyorName || '—'}\n`);
  const items: any[] = data.items || [];
  const filled = items.filter((i) => (i.scope || i.timeEstimate || i.notes || i.transcript || i.voiceNoteUrl || (i.photoUrls || []).length || (i.videoUrls || []).length));
  if (!filled.length) console.log('(no items filled in)\n');
  for (const it of filled) {
    console.log(`--- ${LABELS[it.key] || it.key} ---`);
    if (it.transcript)   console.log(`  Voice    : "${it.transcript}"`);
    if (it.voiceNoteUrl) console.log(`  Audio    : ${it.voiceNoteUrl}`);
    if (it.timeEstimate) console.log(`  Time est : ${it.timeEstimate}`);
    if (it.materials)    console.log(`  Materials: ${it.materials === 'us' ? 'We supply' : it.materials === 'her' ? 'Client supplies' : it.materials}`);
    if (it.scope)        console.log(`  Typed    : ${it.scope}`);
    if (it.notes)        console.log(`  Notes    : ${it.notes}`);
    for (const url of (it.videoUrls || [])) console.log(`  Video    : ${url}`);
    for (const url of (it.photoUrls || [])) console.log(`  Photo    : ${url}`);
    console.log('');
  }
  if (data.anythingElse) console.log(`ANYTHING ELSE: ${data.anythingElse}\n`);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
