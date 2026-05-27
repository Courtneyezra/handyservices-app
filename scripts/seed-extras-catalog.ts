/**
 * Seed broad-appeal impulse-add extras into quote_extras_catalog with
 * category-relevance tags. Idempotent — uses label as the dedupe key.
 *
 * Usage: npx tsx scripts/seed-extras-catalog.ts
 * Production: DATABASE_URL=... npx tsx scripts/seed-extras-catalog.ts
 */

import 'dotenv/config';
import { db } from '../server/db';
import { quoteExtrasCatalog } from '../shared/schema';
import { eq } from 'drizzle-orm';

const SEED: Array<{
  label: string;
  description: string;
  priceInPence: number;
  badge?: string;
  sortOrder: number;
  relevantCategories: string[]; // empty = always-relevant
}> = [
  // ── Always-relevant (impulse adds for any job) ──
  { label: 'Photo report on completion',  description: 'Before / during / after photos sent on the day so you have proof for records, landlord, or insurance.', priceInPence: 0,    badge: 'Free', sortOrder: 5,  relevantCategories: [] },
  // ── Landlord / Property-manager favourites (Phase 21 auto-pick) ──
  { label: 'Tax-ready itemised invoice',  description: 'Itemised PDF invoice with VAT-ready line items so you can claim it against rental income at year-end.', priceInPence: 0,    badge: 'Free', sortOrder: 6,  relevantCategories: [] },
  { label: 'Tenant coordination',         description: 'We confirm the time with your tenant directly, knock on arrival, and update you when the work\'s done. No middle-manning for you.', priceInPence: 0, badge: 'Free', sortOrder: 7, relevantCategories: [] },
  { label: 'Final clean + hoover',        description: 'A proper wipe-down and hoover so the room is ready to use the moment we leave.',                          priceInPence: 1500, badge: 'Popular', sortOrder: 10, relevantCategories: [] },
  { label: 'Spare key copy',              description: 'Cut a spare key while we\'re there. Saves a separate trip to the locksmith.',                             priceInPence: 800,  sortOrder: 20, relevantCategories: ['lock_change'] },
  { label: 'Furniture lift / move',       description: 'Help shifting a heavy piece (sofa, bed frame, wardrobe) while we\'re already on site.',                  priceInPence: 2000, sortOrder: 25, relevantCategories: [] },

  // ── Door / carpentry adjacencies ──
  { label: 'Squeaky hinge fix',           description: 'Oil and adjust noisy or loose hinges. Quick win while we\'re working on the door.',                       priceInPence: 1000, sortOrder: 30, relevantCategories: ['door_fitting', 'carpentry', 'general_fixing', 'lock_change'] },
  { label: 'Door stop installation',      description: 'Wall- or floor-mounted door stop to protect plaster and handle marks.',                                  priceInPence: 1500, sortOrder: 35, relevantCategories: ['door_fitting', 'carpentry', 'painting', 'general_fixing'] },
  { label: 'Door handle replacement',     description: 'Swap a loose / outdated door handle. Bring your handle or we can supply standard chrome.',                priceInPence: 2000, sortOrder: 40, relevantCategories: ['door_fitting', 'lock_change', 'carpentry', 'general_fixing'] },

  // ── Electrical adjacencies ──
  { label: 'Smoke alarm battery swap',    description: 'Replace alarm batteries (per unit). Tested before we leave.',                                            priceInPence: 800,  sortOrder: 45, relevantCategories: ['electrical_minor', 'general_fixing'] },
  { label: 'Light bulb swap',             description: 'Replace dead bulbs (per bulb, including hard-to-reach).',                                                priceInPence: 800,  sortOrder: 50, relevantCategories: ['electrical_minor', 'general_fixing', 'painting'] },
  { label: 'Loose socket / switch fix',   description: 'Re-secure a wobbly socket or switch plate. Safety check while we\'re there.',                            priceInPence: 2500, sortOrder: 55, relevantCategories: ['electrical_minor'] },

  // ── Paint / plaster adjacencies ──
  { label: 'Crack & nail-hole touch-ups', description: 'Fill and paint over small cracks or old nail holes in the same room.',                                   priceInPence: 2000, sortOrder: 60, relevantCategories: ['painting', 'plastering', 'general_fixing'] },
  { label: 'Extra dust-sheet protection', description: 'Cover adjacent rooms / soft furnishings to keep dust out during the work.',                              priceInPence: 1000, sortOrder: 65, relevantCategories: ['painting', 'plastering', 'tiling', 'kitchen_fitting', 'bathroom_fitting'] },

  // ── Bathroom / tiling / silicone adjacencies ──
  { label: 'Caulk / sealant touch-up',    description: 'Refresh worn or mouldy silicone in the same room while we\'re there.',                                   priceInPence: 1500, sortOrder: 70, relevantCategories: ['silicone_sealant', 'tiling', 'bathroom_fitting', 'kitchen_fitting'] },
  { label: 'Grout colour-refresh',        description: 'Clean and re-line stained grout in the same area. Looks like new.',                                       priceInPence: 2500, sortOrder: 75, relevantCategories: ['tiling', 'bathroom_fitting'] },

  // ── Kitchen adjacencies ──
  { label: 'Cabinet door realignment',    description: 'Adjust cabinet doors that are sagging, sticking, or not closing flush.',                                  priceInPence: 1500, sortOrder: 80, relevantCategories: ['kitchen_fitting', 'carpentry', 'general_fixing'] },
  { label: 'Soft-close hinge upgrade',    description: 'Replace a noisy hinge with soft-close. Per door, parts included.',                                        priceInPence: 1800, sortOrder: 85, relevantCategories: ['kitchen_fitting', 'carpentry'] },

  // ── General shelving / wall mounts ──
  { label: 'Pictures / mirrors hung',     description: 'Mount and level pictures or mirrors (per item, picture-rail or wall-fix).',                              priceInPence: 1800, sortOrder: 90, relevantCategories: ['general_fixing', 'shelving', 'tv_mounting'] },
  { label: 'TV cable conceal',            description: 'Tidy up the TV cabling — clipped along skirting or behind plasterboard depending on access.',            priceInPence: 2500, sortOrder: 95, relevantCategories: ['tv_mounting'] },

  // ── Curtain / blinds adjacencies ──
  { label: 'Curtain rod adjustment',      description: 'Re-fix or re-level a rod / track in an adjacent window while we\'re there.',                             priceInPence: 1500, sortOrder: 100, relevantCategories: ['curtain_blinds', 'general_fixing'] },

  // ── Outdoor adjacencies ──
  { label: 'Drain / outflow check',       description: 'Clear leaves and check that downpipes are flowing while we\'re on the ladder.',                          priceInPence: 1500, sortOrder: 105, relevantCategories: ['guttering', 'pressure_washing', 'fencing'] },
  { label: 'Garden gate latch fix',       description: 'Realign or replace a sticky / loose garden gate latch.',                                                  priceInPence: 1500, sortOrder: 110, relevantCategories: ['fencing', 'garden_maintenance', 'general_fixing'] },

  // ── Waste / disposal ──
  { label: 'Take an extra item to the tip',description: 'Add a single bulky item (mattress, small fridge, garden waste bag) to the load.',                       priceInPence: 1500, sortOrder: 115, relevantCategories: ['waste_removal'] },

  // ── Plumbing adjacencies ──
  { label: 'Tap aerator clean / swap',    description: 'Boost water pressure by clearing or replacing the aerator on a tap.',                                    priceInPence: 1000, sortOrder: 120, relevantCategories: ['plumbing_minor'] },
  { label: 'Radiator bleed check',        description: 'Bleed any cold-topped radiators in the room while we\'re on plumbing.',                                  priceInPence: 1200, sortOrder: 125, relevantCategories: ['plumbing_minor'] },
];

async function main() {
  let inserted = 0;
  let updated = 0;
  for (const entry of SEED) {
    const [existing] = await db.select({ id: quoteExtrasCatalog.id }).from(quoteExtrasCatalog).where(eq(quoteExtrasCatalog.label, entry.label)).limit(1);
    if (existing) {
      await db.update(quoteExtrasCatalog).set({
        description: entry.description,
        priceInPence: entry.priceInPence,
        badge: entry.badge ?? null,
        sortOrder: entry.sortOrder,
        relevantCategories: entry.relevantCategories,
        isActive: true,
        updatedAt: new Date(),
      }).where(eq(quoteExtrasCatalog.id, existing.id));
      updated++;
    } else {
      await db.insert(quoteExtrasCatalog).values({
        label: entry.label,
        description: entry.description,
        priceInPence: entry.priceInPence,
        badge: entry.badge ?? null,
        sortOrder: entry.sortOrder,
        relevantCategories: entry.relevantCategories,
        isActive: true,
      });
      inserted++;
    }
  }
  console.log(`✓ Seed complete — ${inserted} inserted, ${updated} updated, ${SEED.length} total`);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
