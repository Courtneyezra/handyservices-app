import { db } from "../server/db";
import { landingPages, landingPageVariants } from "../shared/schema";
import { eq } from "drizzle-orm";

async function updateHeadline() {
    try {
        // Get the 'landing' page
        const page = await db.query.landingPages.findFirst({
            where: eq(landingPages.slug, "landing"),
            with: {
                variants: true
            }
        });

        if (!page) {
            console.error("Landing page not found!");
            process.exit(1);
        }

        console.log(`Found landing page: ${page.name} (ID: ${page.id})`);
        console.log(`Variants: ${page.variants.length}`);

        // Update all variants with the new headline
        for (const variant of page.variants) {
            console.log(`\nUpdating variant: ${variant.name} (ID: ${variant.id})`);
            console.log(`Current headline: ${variant.content.heroHeadline}`);

            const newContent = {
                ...variant.content,
                heroHeadline: "Fast, reliable handyman services — next-day slots available"
            };

            await db.update(landingPageVariants)
                .set({ content: newContent })
                .where(eq(landingPageVariants.id, variant.id));

            console.log(`✅ Updated to: ${newContent.heroHeadline}`);
        }

        console.log("\n✨ All variants updated successfully!");
        process.exit(0);
    } catch (error) {
        console.error("Error updating headline:", error);
        process.exit(1);
    }
}

updateHeadline();
