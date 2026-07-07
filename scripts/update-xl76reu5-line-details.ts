/**
 * One-shot: clean up line item copy on quote xl76reu5.
 *  1. Fill in `details` for three lines that were added without sub-copy.
 *  2. Rewrite `details` on lines whose copy implied a "removal of existing"
 *     or "replacement" step — per customer, everything on this job is new
 *     install, so any "remove old shower/silicone/grout/slab/caulk" language
 *     has to go.
 *
 * Prices are untouched. Both `pricingLineItems` and `pricingLayerBreakdown`
 * are kept in sync so the admin view matches.
 */

import 'dotenv/config';
import { eq } from 'drizzle-orm';
import { db } from '../server/db';
import { personalizedQuotes } from '../shared/schema';
import type { LineItemResult } from '../shared/contextual-pricing-types';

const SLUG = 'xl76reu5';

const NEW_DETAILS: Record<string, string> = {
  // --- Missing details added ---
  li_1779352258279:
    'Fit two supplied bath panels to the sides of the bath, securing them firmly in place ready for sealing. Left neat and flush against the bath.',
  li_1779352561251:
    'Apply flexible bathroom-grade silicone around the shower tray where it meets the wall and floor, leaving a clean, watertight seal. 24-hour cure before use.',
  li_1779352598331:
    'Apply a finishing coat of paint to the bathroom door in your chosen colour, with light sanding and any necessary preparation. The door is left smooth, evenly coated and ready to use once dry.',
  li_1779356209970:
    'Two-visit weed treatment programme using professional-grade herbicide across the affected areas. The second visit catches any regrowth and ensures the treated zones are left clear and ready for new planting or turf.',

  // --- Replacement / removal language stripped ---
  '4td2n6ps':
    'Fit the supplied mixer shower bar and riser rail to the tiled wall, securing fixings cleanly and connecting the controls. The shower is left fully functional and ready to use.',
  dz9l0vfv:
    'Fit two new bath panels to the sides of the bath, securing them firmly in place, then seal all edges with flexible bathroom sealant to prevent water ingress behind the bath.',
  ih7uwbzd:
    'Clean the joints around the bath, toilet and sink back to a dry, sound surface, then apply fresh bathroom-grade sealant. All three areas will be sealed and ready for normal use after 24 hours.',
  '0247y87w':
    'Clean the tile trim edges and clear any debris and moisture, then apply fresh silicone sealant along the joints. The trim will be sealed against water ingress and left neat and ready for use.',
  qdtim2sr:
    'Clean the gaps between tiles where grout is missing, then apply fresh grout and finish flush with the tile surface. The joints will be sealed and waterproof once cured.',
  '8b1k68vh':
    'Prepare and level the sub base, then dry-lay new slabs with proper fall for drainage and bed them firmly into the compacted base. No concrete is used. The result is a level, stable front surface that won\'t shift or puddle.',
};

function applyDetails<T extends LineItemResult>(lines: T[]): T[] {
  return lines.map((li) =>
    NEW_DETAILS[li.lineId] ? { ...li, details: NEW_DETAILS[li.lineId] } : li,
  );
}

async function main() {
  const rows = await db
    .select()
    .from(personalizedQuotes)
    .where(eq(personalizedQuotes.shortSlug, SLUG))
    .limit(1);

  if (rows.length === 0) {
    console.error(`Quote ${SLUG} not found`);
    process.exit(1);
  }

  const quote = rows[0];
  const lineItems = (quote.pricingLineItems as LineItemResult[] | null) || [];

  // Sanity check: every target lineId should exist on the quote.
  const presentIds = new Set(lineItems.map((li) => li.lineId));
  const missing = Object.keys(NEW_DETAILS).filter((id) => !presentIds.has(id));
  if (missing.length > 0) {
    console.error(`Missing line IDs on quote: ${missing.join(', ')}`);
    process.exit(1);
  }

  const updatedLines = applyDetails(lineItems);

  console.log('--- Changes ---');
  for (const id of Object.keys(NEW_DETAILS)) {
    const before = lineItems.find((li) => li.lineId === id);
    const after = updatedLines.find((li) => li.lineId === id);
    console.log(`\n[${id}] ${after?.description}`);
    console.log(`  before: ${before?.details || '(none)'}`);
    console.log(`  after:  ${after?.details}`);
  }

  // Patch the snapshot too so the admin view doesn't diverge.
  const existingBreakdown = (quote as any).pricingLayerBreakdown ?? null;
  let updatedBreakdown = existingBreakdown;
  if (
    existingBreakdown &&
    typeof existingBreakdown === 'object' &&
    Array.isArray(existingBreakdown.lineItems)
  ) {
    updatedBreakdown = {
      ...existingBreakdown,
      lineItems: applyDetails(existingBreakdown.lineItems as LineItemResult[]),
    };
  }

  await db
    .update(personalizedQuotes)
    .set({
      pricingLineItems: updatedLines as any,
      pricingLayerBreakdown: updatedBreakdown as any,
    })
    .where(eq(personalizedQuotes.id, quote.id));

  console.log(`\n✓ Quote ${SLUG} updated.`);
  process.exit(0);
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
