
import { db } from "../server/db";
import { conversations, calls } from "../shared/schema";
import { eq, like } from "drizzle-orm";

async function debugConversation() {
    const phone = "+447402600455";
    console.log(`🔍 Searching for conversation with ${phone}...`);

    const results = await db.select().from(conversations).where(eq(conversations.phoneNumber, phone));

    const { calls } = await import("../shared/schema");
    const callResults = await db.select().from(calls).where(like(calls.phoneNumber, `%7404552759%`)); // Fuzzy search
    console.log(`📞 Found ${callResults.length} calls for this number.`);
    if (callResults.length > 0) {
        console.log("Last Call ID:", callResults[0].id);
        console.log("Transcription:", callResults[0].transcription);
        console.log("MetadataJson:", JSON.stringify(callResults[0].metadataJson, null, 2));
    }
    process.exit(0);
}

debugConversation();
