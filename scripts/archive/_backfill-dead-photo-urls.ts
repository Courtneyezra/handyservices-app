// Backfill: remove verified-dead /uploads/ URLs from personalized_quotes.customer_photo_urls
// so quote pages and PDFs stop rendering broken photo frames.
//
// Reads recovered-quote-photos/audit-report.json (produced by _audit-quote-photo-urls.ts,
// every listed URL was individually liveness-checked against prod). Only URLs recorded
// there as dead are removed; any other entries in the array are kept. Empty result → NULL.
//
// Usage:
//   npx tsx scripts/_backfill-dead-photo-urls.ts          # dry run (default)
//   npx tsx scripts/_backfill-dead-photo-urls.ts --apply  # execute updates
import { db } from '../server/db';
import { personalizedQuotes } from '../shared/schema';
import { eq } from 'drizzle-orm';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPORT = path.resolve(__dirname, '../recovered-quote-photos/audit-report.json');
const BACKUP = path.resolve(__dirname, '../recovered-quote-photos/pre-backfill-backup.json');
const APPLY = process.argv.includes('--apply');

async function main() {
  const report = JSON.parse(fs.readFileSync(REPORT, 'utf8'));
  const deadByQuote = new Map<string, Set<string>>();
  for (const q of report.quotes) {
    const dead = q.uploadsUrls.filter((u: any) => !u.alive).map((u: any) => u.url);
    if (dead.length) deadByQuote.set(q.id, new Set(dead));
  }
  console.log(`${deadByQuote.size} quotes with dead URLs in report. Mode: ${APPLY ? 'APPLY' : 'dry-run'}`);

  const backup: any[] = [];
  let updated = 0;
  for (const [id, deadSet] of deadByQuote) {
    const [row] = await db
      .select({
        id: personalizedQuotes.id,
        shortSlug: personalizedQuotes.shortSlug,
        customerPhotoUrls: personalizedQuotes.customerPhotoUrls,
      })
      .from(personalizedQuotes)
      .where(eq(personalizedQuotes.id, id));
    if (!row) { console.warn(`  MISSING quote ${id}`); continue; }

    const current = row.customerPhotoUrls || [];
    const kept = current.filter((u) => !deadSet.has(u));
    if (kept.length === current.length) { console.log(`  ${row.shortSlug}: nothing to remove (already clean)`); continue; }

    backup.push({ id: row.id, shortSlug: row.shortSlug, before: current, after: kept.length ? kept : null });
    console.log(`  ${row.shortSlug}: ${current.length} -> ${kept.length ? kept.length : 'NULL'}${kept.length ? ' (keeping: ' + kept.join(', ') + ')' : ''}`);

    if (APPLY) {
      await db
        .update(personalizedQuotes)
        .set({ customerPhotoUrls: kept.length ? kept : null })
        .where(eq(personalizedQuotes.id, row.id));
      updated++;
    }
  }

  fs.writeFileSync(BACKUP, JSON.stringify({ appliedAt: APPLY ? new Date().toISOString() : null, rows: backup }, null, 2));
  console.log(`\n${APPLY ? `UPDATED ${updated} rows` : `Would update ${backup.length} rows`}. Backup of before/after: ${BACKUP}`);
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
