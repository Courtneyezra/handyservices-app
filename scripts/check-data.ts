
import { db } from "../server/db";
import { personalizedQuotes, users, handymanProfiles } from "../shared/schema";
import { eq, desc } from "drizzle-orm";

async function checkData() {
    try {
        const userCount = await db.select().from(users);
        console.log(`Total Users: ${userCount.length}`);

        const profileCount = await db.select().from(handymanProfiles);
        console.log(`Total Profiles: ${profileCount.length}`);

        console.log("\n--- Quotes (Last 10) ---");
        const allQuotes = await db.select().from(personalizedQuotes).orderBy(desc(personalizedQuotes.createdAt)).limit(10);

        if (allQuotes.length === 0) {
            console.log("No quotes found.");
        } else {
            allQuotes.forEach(q => {
                console.log({
                    id: q.id,
                    slug: q.shortSlug,
                    customerName: q.customerName,
                    contractorId: q.contractorId, // This is what we want to check
                    createdAt: q.createdAt
                });
            });
        }

        // distinct check for null contractorId
        const nullContractorQuotes = allQuotes.filter(q => q.contractorId === null);
        if (nullContractorQuotes.length > 0) {
            console.log("\n!!! FOUND QUOTES WITH NULL CONTRACTOR ID !!!");
            console.log(`Count: ${nullContractorQuotes.length}`);
        }

    } catch (error) {
        console.error("Error checking data:", error);
    }
    process.exit(0);
}

checkData();
