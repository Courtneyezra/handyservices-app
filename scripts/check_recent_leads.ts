
import { db } from "../server/db";
import { leads } from "../shared/schema";
import { desc } from "drizzle-orm";

async function checkRecentLeads() {
    console.log("Checking recent leads...");
    const recentLeads = await db.select().from(leads).orderBy(desc(leads.createdAt)).limit(5);

    if (recentLeads.length === 0) {
        console.log("No leads found in the database.");
    } else {
        console.log(`Found ${recentLeads.length} recent leads:`);
        recentLeads.forEach(lead => {
            console.log(`- ID: ${lead.id}, CreatedAt: ${lead.createdAt}, Source: ${lead.source}, Name: ${lead.customerName}`);
        });
    }
    process.exit(0);
}

checkRecentLeads().catch(console.error);
