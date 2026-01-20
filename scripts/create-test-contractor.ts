
import { db } from "../server/db";
import { users, handymanProfiles, handymanSkills, productizedServices } from "../shared/schema";
import { scrypt, randomBytes } from "crypto";
import { promisify } from "util";
import { eq } from "drizzle-orm";
import { v4 as uuidv4 } from 'uuid';

const scryptAsync = promisify(scrypt);

async function hashPassword(password: string) {
    const salt = randomBytes(16).toString("hex");
    const buf = (await scryptAsync(password, salt, 64)) as Buffer;
    return `${buf.toString("hex")}.${salt}`;
}

async function createTestContractor() {
    console.log("Creating test contractor...");

    const email = `test.contractor.${Date.now()}@example.com`;
    const password = await hashPassword("password123");
    const userId = uuidv4();

    // 1. Create User
    const [user] = await db.insert(users).values({
        id: userId,
        email,
        password,
        role: 'contractor',
        firstName: "Test",
        lastName: "Contractor",
        phone: "07700900000",
        emailVerified: true,
        isActive: true
    }).returning();

    console.log(`Created user: ${user.email} (${user.id})`);

    // 2. Create Profile
    const profileId = uuidv4();
    const [profile] = await db.insert(handymanProfiles).values({
        id: profileId,
        userId: user.id,
        businessName: "Test Contractor Services Ltd",
        bio: "This is a test contractor account created via script.",
        address: "123 Test Lane, London",
        city: "London",
        postcode: "SW1A 1AA",
        latitude: "51.5014",
        longitude: "-0.1419",
        radiusMiles: 10,
        hourlyRate: 5000,
        verificationStatus: 'verified',
        publicProfileEnabled: true,
        headline: "Reliable Test Contractor"
    }).returning();

    console.log(`Created profile: ${profile.businessName} (${profile.id})`);

    // 3. Add Skills (General Plumbing & Electrical)
    // Find generic services first
    const services = await db.select().from(productizedServices).execute();

    // Pick a couple of "General" services if available, or just random ones
    const plumbing = services.find(s => s.name.includes("Plumbing")) || services[0];
    const electrical = services.find(s => s.name.includes("Electrical")) || services[1];

    const skillsToAdd = [];

    if (plumbing) {
        skillsToAdd.push({
            id: uuidv4(),
            handymanId: profile.id,
            serviceId: plumbing.id,
            hourlyRate: 6500, // £65.00
            dayRate: 45000,   // £450.00
            proficiency: 'expert'
        });
    }

    if (electrical && electrical.id !== plumbing?.id) {
        skillsToAdd.push({
            id: uuidv4(),
            handymanId: profile.id,
            serviceId: electrical.id,
            hourlyRate: 7500, // £75.00
            dayRate: 50000,   // £500.00
            proficiency: 'competent'
        });
    }

    if (skillsToAdd.length > 0) {
        await db.insert(handymanSkills).values(skillsToAdd);
        console.log(`Added ${skillsToAdd.length} skills with rates.`);
    }

    console.log("\n--- TEST CONTRACTOR CREATED ---");
    console.log(`Email: ${email}`);
    console.log(`Password: password123`);
    console.log(`Profile ID: ${profileId}`);
    console.log("-------------------------------\n");

    return { userId, profileId, email };
}

// Check if accessible via API (simulation)
async function verifyAdminAccess(profileId: string) {
    console.log("Verifying admin visibility...");

    // In a real scenario we'd hit the API, but here we can check the database query
    // that the /api/handymen endpoint simulates.

    const found = await db.query.handymanProfiles.findFirst({
        where: eq(handymanProfiles.id, profileId),
        with: {
            user: true,
            skills: {
                with: {
                    service: true
                }
            }
        }
    });

    if (found) {
        console.log("✅ Contractor is visible in database query matching admin endpoint.");
        console.log(`   Name: ${found.user.firstName} ${found.user.lastName}`);
        console.log(`   Business: ${found.businessName}`);
        console.log(`   Skills: ${found.skills.map(s => `${s.service.name} (£${(s.hourlyRate || 0) / 100}/hr)`).join(", ")}`);
    } else {
        console.error("❌ Contractor NOT found in verification query.");
    }
}

createTestContractor()
    .then(async (data) => {
        await verifyAdminAccess(data.profileId);
        process.exit(0);
    })
    .catch((err) => {
        console.error("Error creating test contractor:", err);
        process.exit(1);
    });
