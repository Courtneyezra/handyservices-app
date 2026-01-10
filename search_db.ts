
import { db } from "./server/db";
import { leads, calls } from "@shared/schema";
import { ilike, or } from "drizzle-orm";

async function findAllData() {
    const searchText = "%Replacing both a door%";

    console.log("Searching Leads...");
    // Only search text fields to avoid JSONB errors
    try {
        const leadResults = await db.select().from(leads).where(
            ilike(leads.jobDescription, searchText)
        );
        console.log("Leads found:", JSON.stringify(leadResults, null, 2));
    } catch (e) {
        console.error("Error searching leads:", e);
    }

    console.log("Searching Calls...");
    try {
        const callResults = await db.select().from(calls).where(
            or(
                ilike(calls.transcription, searchText),
                ilike(calls.jobSummary, searchText),
                ilike(calls.notes, searchText)
            )
        );
        console.log("Calls found:", JSON.stringify(callResults, null, 2));
    } catch (e) {
        console.error("Error searching calls:", e);
    }

    process.exit(0);
}

findAllData();
