
import { db } from "../server/db";
import { personalizedQuotes } from "../shared/schema";
import { count, desc } from "drizzle-orm";

async function main() {
    try {
        console.log("Checking personalized quotes...");
        const total = await db.select({ count: count() }).from(personalizedQuotes);
        console.log(`Total quotes in DB: ${total[0].count}`);

        const latestQuotes = await db.select()
            .from(personalizedQuotes)
            .orderBy(desc(personalizedQuotes.createdAt))
            .limit(5);

        console.log("Latest 5 quotes:");
        latestQuotes.forEach(q => {
            console.log(`- ID: ${q.id}, Slug: ${q.shortSlug}, CreatedAt: ${q.createdAt}, Customer: ${q.customerName}`);
        });

    } catch (error) {
        console.error("Error checking quotes:", error);
    }
    process.exit(0);
}

main();
