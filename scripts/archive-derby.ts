
import { db } from "../server/db";
import { landingPages } from "../shared/schema";
import { eq } from "drizzle-orm";

async function archiveDerby() {
    console.log("Archiving 'derby' page...");

    const page = await db.query.landingPages.findFirst({
        where: eq(landingPages.slug, "derby")
    });

    if (!page) {
        console.log("Page 'derby' not found, nothing to do.");
        process.exit(0);
    }

    await db.update(landingPages)
        .set({ isActive: false })
        .where(eq(landingPages.id, page.id));

    console.log("Successfully archived 'derby' page.");
    process.exit(0);
}

archiveDerby().catch(console.error);
