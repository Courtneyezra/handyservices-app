
import 'dotenv/config';
import { db } from "../server/db";
import { calls, conversations } from "../shared/schema";
import { eq, like } from "drizzle-orm";
import { analyzeLeadActionPlan } from '../server/services/agentic-service';
import crypto from "crypto";

async function repairConversation() {
    const phoneSegment = "7402600455";
    console.log(`🔧 Repairing data for number ending in ${phoneSegment}...`);

    // 1. Find the Call
    const callResults = await db.select().from(calls).where(like(calls.phoneNumber, `%${phoneSegment}%`));

    if (callResults.length === 0) {
        console.error("❌ No call record found!");
        process.exit(1);
    }

    const call = callResults[0];
    console.log(`✅ Found Call ID: ${call.id}`);
    console.log(`   Customer: ${call.customerName}`);
    console.log(`   Transcript: ${call.transcription?.substring(0, 50)}...`);

    if (!call.transcription) {
        console.error("❌ No transcription to analyze.");
        process.exit(1);
    }

    // 2. Run Agent
    console.log("🤖 Running Agent Analysis...");
    const plan = await analyzeLeadActionPlan(call.transcription, call.customerName || undefined);
    console.log("✅ Analysis Complete:", plan.recommendedAction);

    // 3. Check Conversation
    const waId = call.phoneNumber.replace('+', '') + '@c.us';
    const convResults = await db.select().from(conversations).where(eq(conversations.phoneNumber, waId));

    if (convResults.length > 0) {
        console.log("ℹ️ Conversation already exists. Updating metadata...");
        await db.update(conversations)
            .set({
                metadata: plan as any,
                lastMessagePreview: `[Agent Plan] ${plan.recommendedAction}: ${plan.draftReply.substring(0, 30)}...`
            })
            .where(eq(conversations.id, convResults[0].id));
    } else {
        console.log("⚠️ Conversation MISSING. Creating new record...");
        await db.insert(conversations).values({
            id: crypto.randomBytes(16).toString("hex"),
            phoneNumber: waId,
            contactName: call.customerName || "Unknown",
            status: 'active',
            unreadCount: 1,
            lastMessageAt: new Date(),
            lastMessagePreview: `[Agent Plan] ${plan.recommendedAction}: ${plan.draftReply.substring(0, 30)}...`,
            metadata: plan as any,
            stage: 'new',
            priority: 'normal'
        });
    }

    console.log("✅ REPAIR COMPLETE. Check Inbox now.");
    process.exit(0);
}

repairConversation();
