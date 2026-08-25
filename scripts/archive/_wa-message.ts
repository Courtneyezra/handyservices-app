/**
 * Print the house WhatsApp send message for a quote, in every style, using the
 * real builder (server/contextual-pricing/quote-message.ts) — same output Ben's
 * builder produces. Read-only.
 *
 *   npx tsx scripts/_wa-message.ts <slug>
 */
import { db } from '../server/db';
import { personalizedQuotes } from '../shared/schema';
import { eq } from 'drizzle-orm';
import { buildQuoteMessage } from '../server/contextual-pricing/quote-message';

const STYLES = ['friendly', 'professional', 'efficient', 'reassuring'] as const;

async function main() {
  const slug = process.argv[2];
  if (!slug) throw new Error('usage: _wa-message.ts <slug>');

  const [q] = await db.select().from(personalizedQuotes).where(eq(personalizedQuotes.shortSlug, slug));
  if (!q) throw new Error(`Quote ${slug} not found`);

  const firstName = (q.customerName || '').trim().split(/\s+/)[0] || 'there';
  const quoteUrl = `https://www.handyservices.app/quote-link/${q.shortSlug}`;

  console.log(`${q.customerName} · ${q.phone} · total £${((q.basePrice || 0) / 100).toFixed(2)}`);
  console.log(`wa.me/${String(q.phone || '').replace(/[^0-9]/g, '')}\n`);

  for (const styleId of STYLES) {
    const msg = buildQuoteMessage({
      styleId,
      firstName,
      contextualMessage: q.contextualMessage || '',
      whatsappClosing: q.whatsappClosing || '',
      quoteUrl,
      finalPricePence: q.basePrice || 0,
    });
    console.log(`${'='.repeat(70)}\n${styleId.toUpperCase()}\n${'='.repeat(70)}\n${msg}\n`);
  }
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
