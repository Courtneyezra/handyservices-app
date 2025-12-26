import { db } from "../server/db";
import { users, handymanProfiles, handymanSkills, productizedServices } from "../shared/schema";
import { v4 as uuidv4 } from "uuid";

async function seedHandymen() {
    console.log("Seeding handymen...");

    // 1. Create a few users
    const userData = [
        { id: uuidv4(), email: "richard@example.com", firstName: "Richard", lastName: "Handy", role: "handyman" },
        { id: uuidv4(), email: "barry@example.com", firstName: "Barry", lastName: "Carpenter", role: "handyman" },
        { id: uuidv4(), email: "vinny@example.com", firstName: "Vinny", lastName: "Decorator", role: "handyman" },
    ];

    for (const user of userData) {
        await db.insert(users).values(user).onConflictDoNothing();
    }

    // Fetch the actual IDs (either new or existing)
    const dbUsers = await db.select().from(users);
    const getUserId = (email: string) => dbUsers.find(u => u.email === email)?.id;

    // 2. Create Handyman Profiles
    const handymanData = [
        {
            id: "1", // Use "1" for the dashboard demo
            userId: getUserId("richard@example.com")!,
            bio: "Lead Handyman with 10+ years experience in general repairs and plumbing.",
            address: "Market Square",
            city: "Nottingham",
            postcode: "NG1 2AS",
            latitude: "52.9548",
            longitude: "-1.1581",
            radiusMiles: 15
        },
        {
            id: uuidv4(),
            userId: getUserId("barry@example.com")!,
            bio: "Senior Carpenter specializing in joinery and custom woodwork.",
            address: "West Bridgford",
            city: "Nottingham",
            postcode: "NG2 6AS",
            latitude: "52.9348",
            longitude: "-1.1281",
            radiusMiles: 10
        },
        {
            id: uuidv4(),
            userId: getUserId("vinny@example.com")!,
            bio: "Professional decorator with a focus on interior finish and painting.",
            address: "Beeston",
            city: "Nottingham",
            postcode: "NG9 1AS",
            latitude: "52.9248",
            longitude: "-1.2181",
            radiusMiles: 12
        }
    ];

    await db.insert(handymanProfiles).values(handymanData).onConflictDoNothing();

    // 3. Link some skills if SKUs exist
    const skus = await db.select().from(productizedServices).limit(5);
    if (skus.length > 0) {
        const skillsData = [
            { id: uuidv4(), handymanId: "1", serviceId: skus[0].id },
            { id: uuidv4(), handymanId: "1", serviceId: skus[1].id },
        ];
        await db.insert(handymanSkills).values(skillsData).onConflictDoNothing();
    }

    console.log("Seeding complete!");
    process.exit(0);
}

seedHandymen().catch(err => {
    console.error(err);
    process.exit(1);
});
