
import { db } from "../server/db";
import { personalizedQuotes } from "../shared/schema";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";

async function main() {
    try {
        console.log("Creating test quote...");
        const id = `quote_${nanoid()}`;
        const shortSlug = nanoid(8);

        await db.insert(personalizedQuotes).values({
            id,
            shortSlug,
            customerName: "Test User",
            phone: "07000000000",
            jobDescription: "Test Job",
            quoteMode: "hhh",
            createdAt: new Date(),
        });

        console.log(`Quote created: ${id}`);

        const result = await db.select().from(personalizedQuotes).where(eq(personalizedQuotes.id, id));
        if (result.length > 0) {
            console.log("Retrieved quote successfully:", result[0].id);
        } else {
            console.error("Failed to retrieve quote");
        }

    } catch (error) {
        console.error("Error creating quote:", error);
    }
    process.exit(0);
}

main();
