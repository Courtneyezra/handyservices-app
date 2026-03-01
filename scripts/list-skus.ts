import { db } from "../server/db";
import { productizedServices } from "../shared/schema";
import { sql, eq } from "drizzle-orm";

async function summary() {
  const active = await db.select().from(productizedServices)
    .where(eq(productizedServices.isActive, true))
    .orderBy(productizedServices.category, productizedServices.skuCode);

  const inactive = await db.select().from(productizedServices)
    .where(sql`is_active = false`);

  console.log("PRODUCTIZED SERVICES CATALOG");
  console.log("=".repeat(90));

  let currentCategory = "";
  for (const sku of active) {
    if (sku.category !== currentCategory) {
      currentCategory = sku.category || "Other";
      console.log("\n" + currentCategory.toUpperCase());
      console.log("-".repeat(90));
    }
    const price = "£" + (sku.pricePence/100).toFixed(0);
    const time = sku.timeEstimateMinutes + "m";
    console.log(`  ${sku.skuCode.padEnd(24)} ${sku.name.substring(0,45).padEnd(45)} ${price.padStart(5)}  ${time.padStart(5)}`);
  }

  console.log("\n" + "=".repeat(90));
  console.log(`ACTIVE: ${active.length} productized services`);
  console.log(`INACTIVE: ${inactive.length} (historical - contractor rates & placeholders)`);

  // Category breakdown
  const categories: Record<string, number> = {};
  for (const s of active) {
    const cat = s.category || "Other";
    categories[cat] = (categories[cat] || 0) + 1;
  }

  console.log("\nCategory breakdown:");
  Object.entries(categories).sort((a,b) => b[1] - a[1]).forEach(([cat, count]) => {
    console.log(`  ${cat.padEnd(12)}: ${count} services`);
  });

  process.exit(0);
}
summary();
