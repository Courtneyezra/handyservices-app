
import { db } from "../server/db";
import { landingPages, landingPageVariants } from "../shared/schema";
import { eq } from "drizzle-orm";

async function syncContent() {
    console.log("Syncing landing page content...");

    // 1. Update Nottingham (/landing)
    const nottingham = await db.query.landingPages.findFirst({
        where: eq(landingPages.slug, "landing")
    });

    if (nottingham) {
        await db.update(landingPageVariants)
            .set({
                content: {
                    heroHeadline: "The Easiest Way to Book a Handyman in Nottingham",
                    heroSubhead: "Call or WhatsApp for an instant fixed quote.",
                    ctaText: "Call Now",
                    mobileCtaText: "Call Now",
                    desktopCtaText: "Call Now",
                    heroImage: "/assets/f7550ab2-8282-4cf6-b2af-83496eef2eee_1764599750751.webp", // Keep existing image
                }
            })
            .where(eq(landingPageVariants.landingPageId, nottingham.id));
        console.log("Updated Nottingham content");
    }

    // 2. Update Derby (/derby)
    const derby = await db.query.landingPages.findFirst({
        where: eq(landingPages.slug, "derby")
    });

    if (derby) {
        await db.update(landingPageVariants)
            .set({
                content: {
                    heroHeadline: "The Easiest Way to Book a Handyman in Derby",
                    heroSubhead: "Call or WhatsApp for an instant fixed quote.",
                    ctaText: "Call Now",
                    mobileCtaText: "Call Now",
                    desktopCtaText: "Call Now",
                    heroImage: "/assets/f7550ab2-8282-4cf6-b2af-83496eef2eee_1764599750751.webp",
                }
            })
            .where(eq(landingPageVariants.landingPageId, derby.id));
        console.log("Updated Derby content");
    }

    process.exit(0);
}

syncContent().catch((err) => {
    console.error(err);
    process.exit(1);
});
