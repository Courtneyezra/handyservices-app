
import { db } from "./server/db";
import { calls, leads } from "./shared/schema";
import { eq, desc, isNotNull } from "drizzle-orm";

async function main() {
    console.log("Checking recent calls...");
    const recentCalls = await db.select().from(calls)
        .orderBy(desc(calls.startTime))
        .limit(10);

    for (const call of recentCalls) {
        console.log(`Call ID: ${call.id}`);
        console.log(`  Phone: ${call.phoneNumber}`);
        console.log(`  Outcome: ${call.outcome}`);
        console.log(`  MissedReason: ${call.missedReason}`);
        console.log(`  Metadata: ${JSON.stringify(call.metadataJson)}`);
        console.log(`  RecordingURL: ${call.recordingUrl}`);
        console.log(`  LeadID: ${call.leadId}`);

        if (call.leadId) {
            const lead = await db.query.leads.findFirst({
                where: eq(leads.id, call.leadId)
            });
            console.log(`  -> Linked Lead found: ${!!lead}`);
            if (lead) {
                console.log(`     Lead RecordingURL: ${lead.elevenLabsRecordingUrl}`);
                console.log(`     Lead ConvID: ${lead.elevenLabsConversationId}`);
            }
        } else {
            // Try to find lead by phone
            const leadByPhone = await db.query.leads.findFirst({
                where: eq(leads.phone, call.phoneNumber)
            });
            console.log(`  -> Lead by Phone found: ${!!leadByPhone}`);
            if (leadByPhone) {
                console.log(`     Lead (by phone) RecordingURL: ${leadByPhone.elevenLabsRecordingUrl}`);
                console.log(`     Lead (by phone) ConvID: ${leadByPhone.elevenLabsConversationId}`);
            }
        }
        console.log("---");
    }
    process.exit(0);
}

main().catch(console.error);
