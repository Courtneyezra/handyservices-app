
import { db } from "../server/db";
import { personalizedQuotes } from "../shared/schema";
import { nanoid } from "nanoid";

async function seedTestQuote() {
    console.log("Seeding test quote...");

    const quoteId = `quote_${nanoid()}`;

    // Valid slug < 8 chars
    const shortSlug = "test99";

    try {
        await db.insert(personalizedQuotes).values({
            id: quoteId,
            shortSlug: shortSlug,
            customerName: "Test Customer Correct",
            phone: "07700900000",
            email: "test@test.com",
            jobDescription: "Fixing a broken test script.",
            tasks: ["Fix Script", "Verify DB", "Run Test"],
            quoteMode: "simple",
            basePrice: 12500, // £125.00
            urgencyReason: "high",
            createdAt: new Date(),
        });

        console.log("✅ Test quote created!");
        console.log(`👉 http://localhost:5001/quote-link/${shortSlug}`);
    } catch (error) {
        console.error("Seed failed:", error);
    }
    process.exit(0);
}

seedTestQuote();
