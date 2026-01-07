
import { db } from "../server/db";
import { users, handymanProfiles, contractorSessions } from "../shared/schema";
import { eq } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";
import bcrypt from "bcrypt";

async function main() {
    console.log("Starting registration reproduction...");

    const email = `repro-${Date.now()}@test.com`;
    const password = "password123";
    const firstName = "Repro";
    const lastName = "User";
    const phone = "07700900000";
    const postcode = "SW1A 1AA";

    try {
        console.log(`Attempting to register: ${email}`);

        // 1. Check existing
        const existing = await db.select().from(users).where(eq(users.email, email.toLowerCase())).limit(1);
        if (existing.length > 0) {
            console.log("Email already exists");
            return;
        }

        const hashedPassword = await bcrypt.hash(password, 12);
        const userId = uuidv4();

        console.log("Inserting user...");
        await db.insert(users).values({
            id: userId,
            email: email.toLowerCase(),
            firstName,
            lastName,
            phone,
            password: hashedPassword,
            role: 'contractor',
            isActive: true,
            emailVerified: false,
        });
        console.log("User inserted successfully.");

        console.log("Inserting handyman profile...");
        const profileId = uuidv4();
        await db.insert(handymanProfiles).values({
            id: profileId,
            userId,
            postcode,
            radiusMiles: 10,
        });
        console.log("Handyman profile inserted successfully.");

        console.log("Inserting session...");
        const sessionToken = uuidv4();
        const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
        await db.insert(contractorSessions).values({
            sessionToken,
            userId,
            expiresAt
        });
        console.log("Session inserted successfully.");

        console.log("SUCCESS: Registration flow completed without error.");

    } catch (error) {
        console.error("FATAL ERROR during reproduction:");
        console.error(error);
        process.exit(1);
    }
}

main().catch(console.error);
