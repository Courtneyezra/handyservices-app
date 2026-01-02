
import { db } from "../server/db";
import { personalizedQuotes } from "../shared/schema";
import { desc } from "drizzle-orm";

async function main() {
    console.log("Checking personalized_quotes table...");
    try {
        const quotes = await db.select().from(personalizedQuotes).orderBy(desc(personalizedQuotes.createdAt)).limit(5);
        console.log(`Found ${quotes.length} quotes.`);
        quotes.forEach(q => {
            console.log(`- ID: ${q.id}, Customer: ${q.customerName}, Created: ${q.createdAt}`);
        });

        if (quotes.length === 0) {
            console.log("No quotes found in the database. This explains why they are missing in the UI.");
        }
    } catch (error) {
        console.error("Error querying database:", error);
    }
    process.exit(0);
}

main();
