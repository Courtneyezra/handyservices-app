
import { db } from '../server/db';
import { users, handymanProfiles, handymanSkills, productizedServices } from '../shared/schema';
import { v4 as uuidv4 } from 'uuid';
import { eq } from 'drizzle-orm';

// Mock Data
const DUMMY_HANDYMEN = [
    {
        firstName: "Liam", lastName: "Smith", email: "liam.smith@example.com",
        city: "Derby", lat: "52.9225", lng: "-1.4746", trade: "Plumbing"
    },
    {
        firstName: "Noah", lastName: "Johnson", email: "noah.j@example.com",
        city: "Nottingham", lat: "52.9548", lng: "-1.1581", trade: "Electrical"
    },
    {
        firstName: "Olivia", lastName: "Williams", email: "olivia.w@example.com",
        city: "Derby", lat: "52.9100", lng: "-1.4500", trade: "Painting"
    },
    {
        firstName: "Emma", lastName: "Jones", email: "emma.j@example.com",
        city: "Leicester", lat: "52.6369", lng: "-1.1398", trade: "Handyman"
    },
    {
        firstName: "James", lastName: "Brown", email: "james.brown@example.com",
        city: "Nottingham", lat: "52.9400", lng: "-1.1800", trade: "Carpentry"
    },
    {
        firstName: "David", lastName: "Wilson", email: "david.w@example.com",
        city: "Derby", lat: "52.9300", lng: "-1.4800", trade: "Plumbing"
    },
    {
        firstName: "Ava", lastName: "Taylor", email: "ava.t@example.com",
        city: "Burton", lat: "52.8019", lng: "-1.6311", trade: "Handyman"
    }
];

async function seed() {
    console.log("🌱 Seeding Dummy Handymen...");

    // 0. Cleanup previous runs
    console.log("Cleaning up old dummy data...");
    for (const h of DUMMY_HANDYMEN) {
        // Delete profile if exists (cascade should handle it but let's be safe if not)
        // Actually, just delete user is usually enough if cascade is on. 
        // But let's look up user by email and delete.
        const user = await db.query.users.findFirst({
            where: (u, { eq }) => eq(u.email, h.email)
        });
        if (user) {
            await db.delete(users).where(eq(users.id, user.id));
        }
    }

    // 1. Ensure minimal SKUs exist to link skills
    // We check if "Plumbing", "Electrical" etc exist, if not create them
    const trades = ["Plumbing", "Electrical", "Painting", "Handyman", "Carpentry"];
    const skuMap: Record<string, string> = {};

    for (const trade of trades) {
        let sku = await db.query.productizedServices.findFirst({
            where: (t, { ilike }) => ilike(t.name, `%${trade}%`)
        });

        if (!sku) {
            console.log(`Creating missing SKU for ${trade}...`);
            const id = uuidv4();
            await db.insert(productizedServices).values({
                id,
                name: `${trade} Standard Service`,
                skuCode: `${trade.toUpperCase().slice(0, 3)}-STD`,
                description: `Standard ${trade} services`,
                pricePence: 6000,
                timeEstimateMinutes: 60,
                keywords: [trade.toLowerCase()],
                category: trade.toLowerCase()
            });
            skuMap[trade] = id;
        } else {
            skuMap[trade] = sku.id;
        }
    }

    // 2. Create Users & Profiles
    for (const h of DUMMY_HANDYMEN) {
        console.log(`Creating user: ${h.firstName} ${h.lastName}`);

        // Create User
        const userId = uuidv4();
        await db.insert(users).values({
            id: userId,
            email: h.email,
            firstName: h.firstName,
            lastName: h.lastName,
            role: 'contractor',
            isActive: true,
            emailVerified: true
        });

        // Create Profile
        const profileId = uuidv4();
        await db.insert(handymanProfiles).values({
            id: profileId,
            userId: userId,
            city: h.city,
            address: "123 High St",
            postcode: "DE1 1AA",
            radiusMiles: 15,
            bio: `Experienced ${h.trade} professional serving the ${h.city} area.`,
            latitude: h.lat,
            longitude: h.lng,
            publicProfileEnabled: true,
            hourlyRate: 60
        });

        // Add Skill
        const skuId = skuMap[h.trade] || Object.values(skuMap)[0];
        if (skuId) {
            await db.insert(handymanSkills).values({
                id: uuidv4(),
                handymanId: profileId,
                serviceId: skuId
            });
        }
    }

    console.log("✅ Seeding Complete!");
    process.exit(0);
}

seed().catch(err => {
    console.error("Seed failed:", err);
    process.exit(1);
});
