
import 'dotenv/config';
import { db } from "../server/db";
import { calls, conversations } from "../shared/schema";
import { eq, isNotNull, desc, sql, and } from "drizzle-orm";
import { analyzeLeadActionPlan } from '../server/services/agentic-service';
import crypto from "crypto";

async function repairAllMissingActions() {
    console.log("🔧 STARTING SYSTEMATIC REPAIR OF MISSING ACTIONS...");

    // 1. Find candidates: Calls with transcript but NO agentPlan in metadata
    // Note: Drizzle JSON operators can be tricky, so fetching recent 50 and filtering in JS for safety
    const recentCalls = await db.select().from(calls)
        .where(isNotNull(calls.transcription))
        .orderBy(desc(calls.startTime))
        .limit(50);

    let repairCount = 0;

    for (const call of recentCalls) {
        const metadata = call.metadataJson as any || {};

        // Skip if already has agent plan or transcript is too short
        if (metadata.agentPlan) continue;
        if (!call.transcription || call.transcription.length < 20) continue;

        console.log(`\n--------------------------------------------------`);
        console.log(`🔍 Processing Call ID: ${call.id}`);
        console.log(`   Phone: ${call.phoneNumber}`);
        console.log(`   Customer: ${call.customerName || 'Unknown'}`);
        console.log(`   Transcript: "${call.transcription.substring(0, 40)}..."`);

        try {
            // 2. Run Analysis
            console.log(`🤖 Running Agent Analysis...`);
            const plan = await analyzeLeadActionPlan(call.transcription, call.customerName || undefined);
            console.log(`✅ Analyzed: ${plan.recommendedAction}`);

            // 3. Update Call Metadata
            const updatedMetadata = { ...metadata, agentPlan: plan };
            await db.update(calls)
                .set({
                    metadataJson: updatedMetadata,
                    actionStatus: 'pending',
                    actionUrgency: plan.urgency === 'critical' ? 1 : plan.urgency === 'high' ? 2 : 3
                })
                .where(eq(calls.id, call.id));
            console.log(`✅ Updated Call Record`);

            // 4. Update/Create Conversation
            const waId = call.phoneNumber.replace('+', '') + '@c.us';
            const existingConvs = await db.select().from(conversations).where(eq(conversations.phoneNumber, waId));

            if (existingConvs.length > 0) {
                console.log(`ℹ️ Updating existing conversation...`);
                await db.update(conversations)
                    .set({
                        metadata: plan as any,
                        lastMessagePreview: `[Agent Plan] ${plan.recommendedAction}: ${plan.draftReply.substring(0, 30)}...`
                    })
                    .where(eq(conversations.id, existingConvs[0].id));
            } else {
                console.log(`⚠️ Creating MISSING conversation...`);
                await db.insert(conversations).values({
                    id: crypto.randomBytes(16).toString("hex"),
                    phoneNumber: waId,
                    contactName: call.customerName || "Unknown Caller",
                    status: 'active',
                    unreadCount: 1,
                    lastMessageAt: new Date(),
                    lastMessagePreview: `[Agent Plan] ${plan.recommendedAction}`,
                    metadata: plan as any,
                    stage: 'new',
                    priority: 'normal'
                });
            }
            repairCount++;

        } catch (err) {
            console.error(`❌ FAILED to repair call ${call.id}:`, err);
        }
    }

    console.log(`\n--------------------------------------------------`);
    console.log(`✅ SYSTEMATIC REPAIR COMPLETE.`);
    console.log(`📊 Total Repaired: ${repairCount}`);
    process.exit(0);
}

repairAllMissingActions();
