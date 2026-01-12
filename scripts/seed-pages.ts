
import { db } from "../server/db";
import { landingPages, landingPageVariants } from "../shared/schema";

async function seed() {
    console.log("Seeding landing pages...");

    // 1. Nottingham Landing Page
    const [nottingham] = await db.insert(landingPages).values({
        name: "Nottingham Landing",
        slug: "landing",
        status: "active",
    }).returning();

    await db.insert(landingPageVariants).values({
        landingPageId: nottingham.id,
        name: "Control",
        isControl: true,
        trafficWeight: 100,
        content: {
            heroHeadline: "Next-Day Handyman Service in Nottingham",
            heroSubhead: "Describe or record your job. Get an instant fixed quote in seconds.",
            ctaText: "Get Instant Quote",
            heroImage: "/assets/f7550ab2-8282-4cf6-b2af-83496eef2eee_1764599750751.webp",
        },
    });

    console.log("Created Nottingham page");

    // 2. Derby Landing Page
    const [derby] = await db.insert(landingPages).values({
        name: "Derby Landing",
        slug: "derby",
        status: "active",
    }).returning();

    await db.insert(landingPageVariants).values({
        landingPageId: derby.id,
        name: "Control",
        isControl: true,
        trafficWeight: 100,
        content: {
            heroHeadline: "Next-Day Handyman Service in Derby",
            heroSubhead: "Describe or record your job. Get an instant fixed quote in seconds.",
            ctaText: "Get Instant Quote",
            heroImage: "/assets/f7550ab2-8282-4cf6-b2af-83496eef2eee_1764599750751.webp",
        },
    });

    console.log("Created Derby page");
    process.exit(0);
}

seed().catch((err) => {
    console.error(err);
    process.exit(1);
});
