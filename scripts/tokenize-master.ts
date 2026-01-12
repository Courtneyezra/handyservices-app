
import { db } from "../server/db";
import { landingPages, landingPageVariants } from "../shared/schema";
import { eq } from "drizzle-orm";

async function tokenizeMaster() {
    console.log("Tokenizing Master Page Content...");

    // 1. Get the 'landing' page (Our Master)
    const masterPage = await db.query.landingPages.findFirst({
        where: eq(landingPages.slug, "landing"),
        with: {
            variants: true
        }
    });

    if (!masterPage) {
        console.error("Master page 'landing' not found!");
        process.exit(1);
    }

    console.log(`Found Master Page: ${masterPage.name} with ${masterPage.variants.length} variants.`);

    // 2. Iterate through variants and replace "Nottingham" with "{{location}}"
    for (const variant of masterPage.variants) {
        let updated = false;
        const content: any = { ...variant.content };

        // Helper to replace text
        const replaceText = (text: string | undefined) => {
            if (!text) return text;
            if (text.includes("Nottingham")) {
                updated = true;
                // Global replace of Nottingham with {{location}}
                return text.replace(/Nottingham/g, "{{location}}");
            }
            return text;
        };

        content.heroHeadline = replaceText(content.heroHeadline);
        content.heroSubhead = replaceText(content.heroSubhead);
        content.bannerText = replaceText(content.bannerText);

        // Also check CTA text just in case, though less likely
        content.ctaText = replaceText(content.ctaText);
        content.mobileCtaText = replaceText(content.mobileCtaText);
        content.desktopCtaText = replaceText(content.desktopCtaText);

        if (updated) {
            console.log(`Updating Variant '${variant.name}' (ID: ${variant.id})...`);
            await db.update(landingPageVariants)
                .set({ content })
                .where(eq(landingPageVariants.id, variant.id));
            console.log("  Success.");
        } else {
            console.log(`Variant '${variant.name}' (ID: ${variant.id}) required no changes.`);
        }
    }

    console.log("Tokenization complete.");
    process.exit(0);
}

tokenizeMaster().catch(console.error);
