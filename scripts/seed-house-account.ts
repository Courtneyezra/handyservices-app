
import { nanoid } from "nanoid";
import { db } from "../server/db";
import { users, handymanProfiles, contractorAvailabilityDates } from "../shared/schema";
import { hash } from "bcrypt";
import { eq } from "drizzle-orm";

async function main() {
    // Nottingham Coordinates (Approx Centre)
    const NOTTINGHAM_LAT = 52.9548;
    const NOTTINGHAM_LNG = -1.1581;

    console.log("🏠 Seeding House Account (Nottingham)...");

    // 1. Ensure User Exists
    const existingUser = await db.query.users.findFirst({
        where: eq(users.email, "team@handyservices.com"),
    });

    let userId;

    if (existingUser) {
        console.log("✅ House account user already exists.");
        userId = existingUser.id;
    } else {
        console.log("Creating new House Account user...");
        const hashedPassword = await hash("InternalTeam123!", 10);
        const [newUser] = await db.insert(users).values({
            id: nanoid(),
            email: "team@handyservices.com",
            password: hashedPassword,
            role: "contractor",
            firstName: "Handy Services",
            lastName: "Team",
            isVerified: true,
        }).returning();
        userId = newUser.id;
        console.log("✅ Created new House Account user.");
    }

    // 2. Create/Update Profile
    console.log("Configuring Nottingham profile...");

    // Check if profile exists
    const existingProfile = await db.query.handymanProfiles.findFirst({
        where: eq(handymanProfiles.userId, userId)
    });

    let profile;
    if (existingProfile) {
        [profile] = await db.update(handymanProfiles).set({
            latitude: NOTTINGHAM_LAT.toString(),
            longitude: NOTTINGHAM_LNG.toString(),
            radiusMiles: 50,
            postcode: "NG1 1AA",
            verificationStatus: 'verified'
        })
            .where(eq(handymanProfiles.id, existingProfile.id))
            .returning();
    } else {
        [profile] = await db.insert(handymanProfiles).values({
            id: nanoid(),
            userId,
            postcode: "NG1 1AA", // Central Nottingham
            latitude: NOTTINGHAM_LAT.toString(),
            longitude: NOTTINGHAM_LNG.toString(),
            radiusMiles: 50, // 50 miles radius
            bio: "Official Handy Services Fulfillment Team. We handle all priority jobs in the region.",
            hourlyRate: 5000,
            verificationStatus: 'verified',
        }).returning();
    }

    console.log(`✅ House Account Profile ID: ${profile.id} Configured in Nottingham.`);

    // 3. Seed Availability for next 45 days
    console.log("generating availability...");
    const today = new Date();
    const dates = [];

    // Clear existing dates for this contractor to ensure fresh slate
    await db.delete(contractorAvailabilityDates).where(eq(contractorAvailabilityDates.contractorId, profile.id));

    for (let i = 0; i < 45; i++) { // 45 days out
        const date = new Date(today);
        date.setDate(date.getDate() + i);
        // Create a full day availability block
        dates.push({
            id: nanoid(),
            contractorId: profile.id,
            date: date,
            startTime: "08:00",
            endTime: "18:00",
            isAvailable: true,
        });
    }

    try {
        await db.insert(contractorAvailabilityDates).values(dates);
        console.log(`✅ Seeded ${dates.length} days of availability (08:00 - 18:00) for House Account.`);
    } catch (e) {
        console.error("Error inserting dates:", e);
    }

    process.exit(0);
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
