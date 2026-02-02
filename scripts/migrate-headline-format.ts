import { db } from "../server/db";
import { landingPages, landingPageVariants } from "../shared/schema";
import { eq } from "drizzle-orm";

async function migrateToDelimiterFormat() {
    try {
        // Get the 'landing' and 'derby' pages
        const pages = await db.query.landingPages.findMany({
            where: (landingPages, { inArray }) => inArray(landingPages.slug, ["landing", "derby"]),
            with: {
                variants: true
            }
        });

        console.log(`Found ${pages.length} pages to migrate`);

        for (const page of pages) {
            console.log(`\n📄 Migrating page: ${page.name} (${page.slug})`);

            for (const variant of page.variants) {
                console.log(`  🔄 Variant: ${variant.name} (ID: ${variant.id})`);
                console.log(`     Old headline: ${variant.content.heroHeadline}`);

                // Update to new delimiter format
                const newContent = {
                    ...variant.content,
                    heroHeadline: "{{location}}||Handyman Service||Next-day slots • Fast & reliable"
                };

                await db.update(landingPageVariants)
                    .set({ content: newContent })
                    .where(eq(landingPageVariants.id, variant.id));

                console.log(`     ✅ New headline: ${newContent.heroHeadline}`);
            }
        }

        console.log("\n✨ Migration complete!");
        process.exit(0);
    } catch (error) {
        console.error("❌ Migration failed:", error);
        process.exit(1);
    }
}

migrateToDelimiterFormat();
