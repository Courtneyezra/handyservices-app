
import { db } from "../server/db";
import { productizedServices } from "../shared/schema";
import { detectMultipleTasks } from "../server/skuDetector";

async function run() {
    console.log("--- DEBUG SKU DETECTION ---");

    // 1. Check SKUs in DB
    const skus = await db.select().from(productizedServices);
    console.log(`Found ${skus.length} SKUs in database:`);
    skus.forEach(s => console.log(`- [${s.skuCode}] ${s.name} (£${s.pricePence / 100}) Keywords: ${s.keywords}`));

    if (skus.length === 0) {
        console.log("⚠️ NO SKUS FOUND. THIS IS LIKELY THE PROBLEM.");
    }

    // 2. Test Detection
    const testPhrase = "Install a TV on the wall";
    console.log(`\nTesting detection with phrase: "${testPhrase}"`);
    try {
        const result = await detectMultipleTasks(testPhrase);
        console.log("Detection Result:", JSON.stringify(result, null, 2));
    } catch (e) {
        console.error("Detection Failed:", e);
    }

    process.exit(0);
}

run().catch(console.error);
