
import { db } from "../server/db";
import { calls, leads, conversations, messages } from "../shared/schema";
import { v4 as uuidv4 } from "uuid";

async function seedDOE() {
    console.log("🌱 Seeding D.O.E. Test Scenarios...");

    // 1. CLEAR EXISTING DATA (Optional, but good for clean testing)
    // await db.delete(calls);
    // await db.delete(leads);
    // await db.delete(conversations);

    const now = new Date();

    // SCENARIO 1: The Ideal Standard (Simple Quote)
    // "Hi, I need a 50-inch TV mounted on a plasterboard wall in my living room."
    await db.insert(calls).values({
        id: uuidv4(),
        callId: "call_" + uuidv4(),
        phoneNumber: "+447700900001",
        customerName: "Alice Standard",
        direction: "inbound",
        status: "completed",
        startTime: new Date(now.getTime() - 1000 * 60 * 5), // 5 mins ago
        transcription: "Hi, I need a 50-inch TV mounted on a plasterboard wall in my living room. Can you give me a price?",
        jobSummary: "TV Mounting Request",
        outcome: "completed",
        urgency: "Standard",
        detectedSkusJson: [{ sku: "TV-MOUNT-50", confidence: 0.95 }, { sku: "WALL-PLASTERBOARD", confidence: 0.9 }]
    });

    // SCENARIO 2: The Emergency (Book Visit)
    // "Water is coming through my kitchen ceiling! It’s ruining the floor!"
    await db.insert(calls).values({
        id: uuidv4(),
        callId: "call_" + uuidv4(),
        phoneNumber: "+447700900002",
        customerName: "Bob Emergency",
        direction: "inbound",
        status: "voicemail",
        startTime: new Date(now.getTime() - 1000 * 60 * 15), // 15 mins ago
        transcription: "Water is coming through my kitchen ceiling! It’s ruining the floor! Call me back immediately!",
        jobSummary: "Major Water Leak - Ceiling collapse risk",
        outcome: "VOICEMAIL",
        urgency: "Critical"
    });

    // SCENARIO 3: The Ambiguous Small Job (Request Video)
    // "My boiler is making a weird clicking sound."
    const whatsappId = uuidv4();
    await db.insert(conversations).values({
        id: whatsappId,
        phoneNumber: "+447700900003",
        contactName: "Charlie Ambiguous",
        lastMessagePreview: "My boiler is making a weird clicking sound. It works but it's annoying.",
        lastMessageAt: new Date(now.getTime() - 1000 * 60 * 30), // 30 mins ago
        status: "active"
    });
    // Add message? Handled by preview in inbox.

    // SCENARIO 4: The Renovation (HHH Quote)
    // "I want to redo my downstairs toilet."
    await db.insert(leads).values({
        id: uuidv4(),
        customerName: "Diana Reno",
        phone: "+447700900004",
        jobDescription: "I want to redo my downstairs toilet. New tiles, new sink, maybe painting.",
        source: "web_form",
        status: "new",
        createdAt: new Date(now.getTime() - 1000 * 60 * 60) // 1 hour ago
    });

    // SCENARIO 5: The Shopping List (Pick & Mix)
    // "I need a few odds and sods..."
    await db.insert(calls).values({
        id: uuidv4(),
        callId: "call_" + uuidv4(),
        phoneNumber: "+447700900005",
        customerName: "Edward Odds",
        direction: "inbound",
        status: "completed",
        startTime: new Date(now.getTime() - 1000 * 60 * 120), // 2 hours ago
        transcription: "I need a few odds and sods: hang a mirror, fix a loose door handle, and assemble a cabinet.",
        jobSummary: "Mirror, Door Handle, Cabinet Assembly",
        outcome: "completed",
        urgency: "Low",
        detectedSkusJson: [{ sku: "MIRROR-HANG", confidence: 0.8 }, { sku: "DOOR-HANDLE", confidence: 0.8 }, { sku: "FURNITURE-ASSEMBLY", confidence: 0.8 }]
    });

    console.log("✅ D.O.E. Scenarios Seeded!");
    process.exit(0);
}

seedDOE().catch(console.error);
