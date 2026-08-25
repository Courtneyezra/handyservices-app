import 'dotenv/config';
import { db } from '../server/db';
import { personalizedQuotes } from '../shared/schema';
import { and, isNotNull, desc, sql } from 'drizzle-orm';

// READ-ONLY. List the most recent customer-confirmed door addresses captured at
// payment for CONTEXTUAL quotes. Phase 30 persists this address (carried via the
// PaymentIntent metadata) onto personalized_quotes.address on payment success.
// Contextual quotes are flagged by layoutTier (the contextual pricing engine).
const LIMIT = parseInt(process.argv[2] || '30', 10);

const dt = (d?: Date | null) =>
  d ? new Date(d).toLocaleString('en-GB', { timeZone: 'Europe/London', hour12: false }) : '—';

async function main() {
  const rows = await db
    .select({
      slug: personalizedQuotes.shortSlug,
      name: personalizedQuotes.customerName,
      phone: personalizedQuotes.phone,
      address: personalizedQuotes.address,
      postcode: personalizedQuotes.postcode,
      layoutTier: personalizedQuotes.layoutTier,
      depositPaidAt: personalizedQuotes.depositPaidAt,
      createdAt: personalizedQuotes.createdAt,
    })
    .from(personalizedQuotes)
    .where(
      and(
        isNotNull(personalizedQuotes.layoutTier), // contextual quote
        isNotNull(personalizedQuotes.address),    // address actually captured
        // exclude obvious synthetic/test rows
        sql`${personalizedQuotes.phone} NOT LIKE '07700900%'`,
        sql`${personalizedQuotes.id} NOT LIKE 'test_q_%'`,
      ),
    )
    .orderBy(desc(personalizedQuotes.depositPaidAt), desc(personalizedQuotes.createdAt))
    .limit(LIMIT);

  console.log(`\nLast ${rows.length} contextual-quote addresses (most recent first)\n`);
  rows.forEach((r, i) => {
    const paid = r.depositPaidAt ? `PAID ${dt(r.depositPaidAt)}` : `unpaid (created ${dt(r.createdAt)})`;
    console.log(`${String(i + 1).padStart(2)}. ${r.name ?? '—'}  [${r.slug}]  ${r.layoutTier}`);
    console.log(`    ${r.address}${r.postcode ? `  (${r.postcode})` : ''}`);
    console.log(`    ${paid}\n`);
  });
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
