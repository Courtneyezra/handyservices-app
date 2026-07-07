import "dotenv/config";
import { db } from "../server/db";
import { personalizedQuotes } from "../shared/schema";
import { eq } from "drizzle-orm";

// One-off TEST helper: flip the hoprev01 preview fixture's customerType to
// 'oap_homeowner' (or back to 'homeowner' with --homeowner) so the OAP cash
// option can be verified in the preview. Touches ONLY test_q_homeowner_preview.
//   npx tsx scripts/_set-preview-oap.ts            → oap_homeowner
//   npx tsx scripts/_set-preview-oap.ts --homeowner → homeowner

const TEST_ID = "test_q_homeowner_preview";
const target = process.argv.includes("--homeowner") ? "homeowner" : "oap_homeowner";

async function run() {
  const [row] = await db
    .select()
    .from(personalizedQuotes)
    .where(eq(personalizedQuotes.id, TEST_ID))
    .limit(1);
  if (!row) throw new Error(`${TEST_ID} not found — run _seed-homeowner-preview.ts first`);

  const cs = { ...(((row as any).contextSignals as any) || {}), customerType: target };
  await db
    .update(personalizedQuotes)
    .set({ contextSignals: cs as any })
    .where(eq(personalizedQuotes.id, TEST_ID));

  console.log(`Set ${TEST_ID} contextSignals.customerType = ${target}`);
  process.exit(0);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
