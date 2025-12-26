import { db } from "../server/db";
import { productizedServices } from "../shared/schema";
import { count } from "drizzle-orm";

async function checkSkus() {
    console.log("Connect to DB...");
    try {
        const result = await db.select({ count: count() }).from(productizedServices);
        console.log(`Found ${result[0].count} SKUs in the database.`);

        const firstFew = await db.select().from(productizedServices).limit(3);
        console.log("Sample SKUs:", firstFew.map(s => s.skuCode));
    } catch (error) {
        console.error("Failed to connect or read SKUs:", error);
    }
}

checkSkus();
