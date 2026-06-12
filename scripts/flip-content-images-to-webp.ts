/**
 * flip-content-images-to-webp.ts
 *
 * One-off data fix: rewrites `content_images.url` rows that point at a local
 * `/assets/quote-images/NAME.(jpg|jpeg|png)` original to its confirmed `.webp`
 * twin. Until now the rewrite happened only at read time (server/quote-image-utils.ts
 * via the quote-serving endpoints); persisting it in the DB lets us delete the
 * dead local originals safely.
 *
 * Uses the exact same twin allow-list as the read-time normalizer, so it only
 * touches rows whose `.webp` twin is confirmed present on disk and leaves S3 /
 * absolute / unknown URLs untouched.
 *
 * SAFETY:
 *   - DRY-RUN by default: prints every row that WOULD change. Makes NO writes.
 *   - Requires an explicit `--apply` flag to update rows.
 *
 * Usage:
 *   npx tsx scripts/flip-content-images-to-webp.ts          # dry run (safe)
 *   npx tsx scripts/flip-content-images-to-webp.ts --apply  # write .webp urls
 */

import 'dotenv/config';
import { eq } from 'drizzle-orm';
import { db } from '../server/db';
import { contentImages } from '../shared/schema';
import { normalizeQuoteImageUrl } from '../server/quote-image-utils';

async function main() {
  const apply = process.argv.includes('--apply');

  console.log('=== content_images .jpg/.png -> .webp twin flip ===');
  console.log(`Mode: ${apply ? 'APPLY (writes rows)' : 'DRY-RUN (no writes)'}\n`);

  const rows = await db
    .select({ id: contentImages.id, url: contentImages.url })
    .from(contentImages);

  const changes = rows
    .map((r) => ({ id: r.id, from: r.url, to: normalizeQuoteImageUrl(r.url) }))
    .filter((c) => c.to !== c.from);

  if (changes.length === 0) {
    console.log(`No rows need flipping (scanned ${rows.length}). Done.`);
    process.exit(0);
  }

  for (const c of changes) {
    console.log(`#${c.id}  ${c.from}  ->  ${c.to}`);
  }
  console.log(`\n${changes.length} of ${rows.length} row(s) ${apply ? 'will be' : 'would be'} updated.`);

  if (apply) {
    for (const c of changes) {
      await db
        .update(contentImages)
        .set({ url: c.to, updatedAt: new Date() })
        .where(eq(contentImages.id, c.id));
    }
    console.log(`\n✓ Updated ${changes.length} row(s).`);
  } else {
    console.log('\nDRY-RUN: no rows modified. Re-run with --apply to write.');
  }

  process.exit(0);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
