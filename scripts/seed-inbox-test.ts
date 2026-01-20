
import { db } from "../server/db";
import { calls, leads, conversations } from "../shared/schema";
import { v4 as uuidv4 } from "uuid";

async function seedInboxTest() {
    console.log("🌱 Seeding Inbox with D.O.E Test Data...");

    const now = new Date();
    const tenMinsAgo = new Date(now.getTime() - 10 * 60000);
    const thirtyMinsAgo = new Date(now.getTime() - 30 * 60000);
    const twoHoursAgo = new Date(now.getTime() - 120 * 60000);

    // 1. SCENARIO: Emergency Plumbing Call (Co-pilot: "Book Emergency Visit")
    // D: Analysis detects "Burst pipe", "Water everywhere" -> Urgency: Critical
    // O: Inbox flags as High Priority, Suggests "Book Emergency Visit"
    await db.insert(calls).values({
        id: uuidv4(),
        callId: `test_call_${uuidv4()}`,
        phoneNumber: "+447700900001",
        customerName: "Alice Emergency",
        startTime: tenMinsAgo,
        direction: "inbound",
        status: "completed",
        outcome: "VOICEMAIL", // Or completed call
        urgency: "Critical",
        jobSummary: "Customer reported a burst pipe in the kitchen. Water is flooding the floor. Needs urgent help.",
        transcription: "Hello? Is this the emergency line? I have a burst pipe under my sink, there is water everywhere! Please send someone now!",
        actionStatus: "pending"
    });
    console.log("✅ Seeded: Critical Emergency Call");

    // 2. SCENARIO: Standard Web Lead (Co-pilot: "Create Quote")
    // D: Analysis matches SKU "TV-MOUNT"
    // O: Inbox Suggests "Create Quote"
    await db.insert(calls).values({
        id: uuidv4(),
        callId: `test_call_${uuidv4()}`,
        phoneNumber: "+447700900002",
        customerName: "Bob Builder",
        startTime: thirtyMinsAgo,
        direction: "inbound",
        status: "completed",
        outcome: "completed",
        urgency: "Standard",
        jobSummary: "Customer wants a 65 inch TV mounted on plasterboard. Has the bracket.",
        transcription: "Hi, I'm looking to get a TV mounted. It's a 65 inch, going on a standard plasterboard wall. I already have the bracket.",
        detectedSkusJson: [{ sku: "TV-MOUNT-65", confidence: 0.9 }], // Trigger for Quote
        actionStatus: "pending"
    });
    console.log("✅ Seeded: Standard Job Call (TV Mount)");

    // 3. SCENARIO: WhatsApp Inquiry (Co-pilot: "Reply")
    // D: Analysis detects Question
    // O: Inbox Suggests "Reply"
    await db.insert(conversations).values({
        id: uuidv4(),
        phoneNumber: "447700900003",
        contactName: "Charlie Chat",
        lastMessagePreview: "Hi, do you cover the Oxford area? And what are your rates?",
        lastMessageAt: twoHoursAgo,
        status: "active",
        stage: "new",
        unreadCount: 1
    });
    console.log("✅ Seeded: WhatsApp Inquiry");

    console.log("🚀 D.O.E Verification Data Ready! Refresh your Inbox.");
    process.exit(0);
}

seedInboxTest().catch(console.error);
