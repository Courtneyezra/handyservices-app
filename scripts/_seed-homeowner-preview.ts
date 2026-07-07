import { db } from "../server/db";
import { personalizedQuotes, quoteOfferEvents } from "../shared/schema";
import { eq } from "drizzle-orm";

// Seeds a PERSISTENT homeowner CONTEXTUAL quote on the dev server so the
// default-on 3-stage flow (loading → at_home offer → quote) can be walked
// through in the browser. Clones a real homeowner quote so it's structurally
// valid, but rewrites it into a clearly-synthetic, fresh (unviewed/unbooked)
// row carrying the project's scrub signatures (test_q_* id, 07700900xxx phone,
// @example.com email) so it never pollutes real analytics.
//   create:  npx tsx scripts/_seed-homeowner-preview.ts
//   remove:  npx tsx scripts/_seed-homeowner-preview.ts --drop

const SOURCE_SLUG = "rwlb6zsf";                  // a real homeowner CONTEXTUAL quote
const TEST_ID = "test_q_homeowner_preview";
const TEST_SLUG = "hoprev01";                     // 8-char synthetic slug
const TEST_NAME = "Sarah (Preview)";
const TEST_PHONE = "07700900123";

async function drop() {
  await db.delete(quoteOfferEvents).where(eq(quoteOfferEvents.quoteId, TEST_ID));
  await db.delete(personalizedQuotes).where(eq(personalizedQuotes.id, TEST_ID));
  console.log(`Removed preview quote ${TEST_ID} (/quote/${TEST_SLUG}) + its offer-event rows.`);
  process.exit(0);
}

async function create() {
  const [src] = await db
    .select()
    .from(personalizedQuotes)
    .where(eq(personalizedQuotes.shortSlug, SOURCE_SLUG))
    .limit(1);
  if (!src) throw new Error(`Source quote ${SOURCE_SLUG} not found`);

  // Idempotent: clear any prior preview row + its analytics first.
  await db.delete(quoteOfferEvents).where(eq(quoteOfferEvents.quoteId, TEST_ID));
  await db.delete(personalizedQuotes).where(eq(personalizedQuotes.id, TEST_ID));

  const clone: any = {
    ...src,
    id: TEST_ID,
    shortSlug: TEST_SLUG,
    customerName: TEST_NAME,
    phone: TEST_PHONE,
    email: "preview@example.com",
    // Fresh + unbooked so the full flow runs (not the returning/paid path).
    viewedAt: null,
    lastViewedAt: null,
    viewCount: 0,
    selectedAt: null,
    bookedAt: null,
    depositPaidAt: null,
    completedAt: null,
    stripeCustomerId: null,
    stripePaymentIntentId: null,
    reminderSentAt: null,
    followupSentAt: null,
    viewNudgeSentAt: null,
  };

  await db.insert(personalizedQuotes).values(clone);
  console.log("Seeded homeowner CONTEXTUAL preview quote:");
  console.log(`  name=${TEST_NAME}  segment=${src.segment}  ctxType=${(src.contextSignals as any)?.customerType}`);
  console.log(`  finalPricePence=${(src as any).finalPricePence}  basePrice=${(src as any).basePrice}`);
  console.log(`  URL:  http://localhost:5050/quote/${TEST_SLUG}`);
  process.exit(0);
}

(process.argv.includes("--drop") ? drop() : create()).catch((e) => {
  console.error(e);
  process.exit(1);
});
