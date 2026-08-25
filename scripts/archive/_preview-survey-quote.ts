// One-off: apply the survey-gate columns (idempotent) and create an ISOLATED
// test clone of a real CONTEXTUAL quote with surveyRequired=true so we can
// preview the customer-facing survey page. Clearly test-signed so analytics
// scrub it. Safe to delete the row after previewing (prints a cleanup command).
import 'dotenv/config';
import { db } from '../server/db';
import { personalizedQuotes } from '../shared/schema';
import { sql, eq, and } from 'drizzle-orm';
import { nanoid } from 'nanoid';

(async () => {
  // 1. Apply the additive columns (mirrors migrations/20260811_survey_required_gate.sql)
  await db.execute(sql`ALTER TABLE personalized_quotes ADD COLUMN IF NOT EXISTS survey_required boolean DEFAULT false;`);
  await db.execute(sql`ALTER TABLE personalized_quotes ADD COLUMN IF NOT EXISTS survey_fee_pence integer;`);
  console.log('✓ survey_required / survey_fee_pence columns ensured');

  // 2. Pick a recent CONTEXTUAL quote with real messaging to clone.
  const [src] = await db.select().from(personalizedQuotes)
    .where(and(eq(personalizedQuotes.segment, 'CONTEXTUAL')))
    .orderBy(sql`created_at DESC NULLS LAST`)
    .limit(1);

  if (!src) { console.error('No CONTEXTUAL quote found to clone.'); process.exit(1); }
  console.log(`✓ cloning from ${src.shortSlug} — "${(src as any).jobTopLine || src.contextualHeadline || 'job'}", basePrice ${src.basePrice}p`);

  // 3. Build the clone: new id + slug, survey gate ON, test-signed identity.
  const id = nanoid();
  const shortSlug = 'sv' + Math.random().toString(36).substring(2, 8); // 8 chars (column max)
  const clone: any = {
    ...src,
    id,
    shortSlug,
    customerName: 'Survey Preview (TEST — delete me)',
    phone: '07700900123',
    email: 'preview@example.com',
    surveyRequired: true,
    surveyFeePence: 4900, // £49 survey fee
    // Reset lifecycle so it reads as a fresh, unbooked quote.
    viewedAt: null,
    selectedPackage: null,
    selectedAt: null,
    bookedAt: null,
    depositPaidAt: null,
    stripePaymentIntentId: null,
    createdAt: new Date(),
  };
  delete clone.updatedAt;

  await db.insert(personalizedQuotes).values(clone);

  console.log('\n=== PREVIEW READY ===');
  console.log(`Customer page : /quote/${shortSlug}`);
  console.log(`Fee           : £49 survey fee (credited to job)`);
  console.log(`Cleanup       : DELETE FROM personalized_quotes WHERE id = '${id}';`);
  console.log('SLUG=' + shortSlug);
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
