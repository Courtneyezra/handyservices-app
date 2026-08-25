import "dotenv/config";
import { db } from "../server/db";
import { personalizedQuotes } from "../shared/schema";
import { eq } from "drizzle-orm";

// One-off DEMO patch (touches ONLY the test fixture row test_q_homeowner_preview).
//
// Does two things so the hoprev01 preview faithfully exercises two features:
//   1) MATERIALS SPLIT — carve a realistic labour/materials split onto two lines
//      so the "inc. materials" reassurance renders on the collapsed breakdown
//      rows. Gas hob £30, curtain pole £15; "Gas Safe" stays £0 to demonstrate
//      the honest gating (a pure fee shows no materials note). Each line's
//      DISPLAYED price (guarded + materials) is held constant.
//   2) DISCOUNT RE-SYNC — recompute the multi-job discount + basePrice with the
//      SAME labour-only model the real engine uses
//      (server/contextual-pricing/multi-line-engine.ts:515):
//        savings   = roundToWholePounds(labourSubtotal * pct/100)   // labour only
//        basePrice = (labourSubtotal - savings) + materialsSubtotal // materials pass-through
//      Without this the stored savingsPence/basePrice (computed before step 1's
//      split) go stale and misrepresent the discount — which is exactly the
//      artifact that made it look like the discount wasn't labour-only.
//
// Reset to the pristine clone anytime: npx tsx scripts/_seed-homeowner-preview.ts

const TEST_ID = "test_q_homeowner_preview";

// description substring -> materials pence to carve out of the existing line price
const MATERIALS: { match: string; materials: number }[] = [
  { match: "gas hob", materials: 3000 },       // £30 gas hose + fittings
  { match: "curtain pole", materials: 1500 },  // £15 pole + brackets
  // "Gas Safe certification" intentionally omitted (a certification fee, no materials)
];

const roundToWholePounds = (pence: number) => Math.round(pence / 100) * 100;

async function run() {
  const [row] = await db
    .select()
    .from(personalizedQuotes)
    .where(eq(personalizedQuotes.id, TEST_ID))
    .limit(1);
  if (!row) throw new Error(`Preview quote ${TEST_ID} not found — run _seed-homeowner-preview.ts first`);

  // 1) Re-split labour/materials, holding each line's displayed price constant.
  const items: any[] = (((row as any).pricingLineItems as any[]) || []).map((li: any) => {
    const rule = MATERIALS.find((m) => String(li.description || "").toLowerCase().includes(m.match));
    if (!rule) return li;
    const sum = (li.guardedPricePence || 0) + (li.materialsWithMarginPence || 0);
    const materials = rule.materials;
    const guarded = sum - materials; // hold the displayed line price constant
    return { ...li, guardedPricePence: guarded, materialsWithMarginPence: materials, materialsCostPence: materials };
  });

  // 2) Re-sync the labour-only discount + basePrice to the new split.
  const labourSubtotal = items.reduce((s, li) => s + (li.guardedPricePence || 0), 0);
  const materialsSubtotal = items.reduce((s, li) => s + (li.materialsWithMarginPence || 0), 0);
  const plb: any = { ...((row as any).pricingLayerBreakdown || {}) };
  const pct = plb.batchDiscount?.discountPercent ?? (row as any).batchDiscountPercent ?? 0;
  const savings = roundToWholePounds(labourSubtotal * (pct / 100));
  const newBase = labourSubtotal - savings + materialsSubtotal;

  if (plb.batchDiscount) {
    plb.batchDiscount = { ...plb.batchDiscount, savingsPence: savings };
  }
  plb.subtotalPence = labourSubtotal;
  plb.totalMaterialsWithMarginPence = materialsSubtotal;
  plb.finalPricePence = newBase;

  await db
    .update(personalizedQuotes)
    .set({ pricingLineItems: items as any, basePrice: newBase, pricingLayerBreakdown: plb as any })
    .where(eq(personalizedQuotes.id, TEST_ID));

  console.log("Re-synced preview fixture (labour-only multi-job discount):");
  items.forEach((li: any) =>
    console.log(
      `  ${li.description}: labour £${(li.guardedPricePence || 0) / 100} + materials £${(li.materialsWithMarginPence || 0) / 100}`
    )
  );
  console.log(`  labour subtotal £${labourSubtotal / 100}, materials £${materialsSubtotal / 100}`);
  console.log(`  discount ${pct}% of labour = £${savings / 100}; basePrice £${newBase / 100}`);
  process.exit(0);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
