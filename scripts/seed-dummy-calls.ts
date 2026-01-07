
import { db } from "../server/db";
import { calls, callSkus, productizedServices } from "../shared/schema";
import { v4 as uuidv4 } from "uuid";
import { subMinutes, subHours, subDays } from "date-fns";
import { eq } from "drizzle-orm";

async function seedCalls() {
    console.log("🌱 Seeding dummy calls...");

    try {
        // 1. Get some SKUs to attach
        const allSkus = await db.select().from(productizedServices).limit(5);
        if (allSkus.length === 0) {
            console.error("⚠️ No SKUs found. Run 'npm run seed' first.");
            process.exit(1);
        }

        const SAMPLE_CUSTOMERS = [
            { name: "Alice Johnson", phone: "+447700900123", address: "123 High St, London" },
            { name: "Bob Smith", phone: "+447700900456", address: "45 Baker St, London" },
            { name: "Charlie Brown", phone: "+447700900789", address: "10 Downing St, London" },
            { name: "David Wilson", phone: "+447700900321", address: "221B Baker St, London" },
            { name: "Eva Green", phone: "+447700900654", address: "742 Evergreen Tce, London" },
        ];

        const OUTCOMES = ['INSTANT_PRICE', 'VIDEO_QUOTE', 'SITE_VISIT', 'NO_ANSWER', 'VOICEMAIL'];

        for (let i = 0; i < 20; i++) {
            const customer = SAMPLE_CUSTOMERS[i % SAMPLE_CUSTOMERS.length];
            const startTime = subHours(new Date(), i * 2); // Spread over last 40 hours
            const callId = `CA_${uuidv4().substring(0, 8)}`;
            const dbId = uuidv4();

            // Create Call
            await db.insert(calls).values({
                id: dbId,
                callId: callId,
                phoneNumber: customer.phone,
                customerName: customer.name,
                address: customer.address,
                startTime: startTime,
                direction: 'inbound',
                status: 'completed',
                outcome: OUTCOMES[i % OUTCOMES.length],
                duration: 120 + Math.floor(Math.random() * 300),
                jobSummary: `Customer needs help with ${allSkus[0].name}`,
                urgency: i % 3 === 0 ? 'High' : 'Standard',
                leadType: 'Homeowner',
                transcription: "This is a dummy transcription for testing purposes.",
                recordingUrl: "https://api.twilio.com/2010-04-01/Accounts/AC.../Recordings/RE...",
            });

            // Attach random SKUs
            if (i % 2 === 0) {
                const sku = allSkus[i % allSkus.length];
                await db.insert(callSkus).values({
                    id: uuidv4(),
                    callId: dbId,
                    skuId: sku.id,
                    quantity: 1,
                    pricePence: sku.pricePence,
                    source: 'detected',
                    confidence: 85 + Math.floor(Math.random() * 10),
                    detectionMethod: 'gpt'
                });
            }
        }

        console.log("✅ Successfully seeded 20 dummy calls!");

    } catch (error) {
        console.error("❌ Seeding failed:", error);
    }
    process.exit(0);
}

seedCalls();
