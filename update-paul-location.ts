
import { db } from './server/db';
import { handymanProfiles } from './shared/schema';
import { eq } from 'drizzle-orm';

async function updatePaul() {
    console.log("Updating Paul's location...");

    // Find Paul first to get ID
    const profiles = await db.query.handymanProfiles.findMany({
        with: { user: true }
    });
    const paul = profiles.find((h: any) => h.user?.firstName === 'Paul');

    if (!paul) {
        console.error("Paul not found!");
        return;
    }

    console.log(`Found Paul (ID: ${paul.id}). Updating...`);

    // Update with London coordinates (approx)
    await db.update(handymanProfiles)
        .set({
            latitude: "51.5074",
            longitude: "-0.1278",
            postcode: "SW1A 1AA",
            city: "London",
            address: "10 Downing Street"
        })
        .where(eq(handymanProfiles.id, paul.id));

    console.log("Update complete.");
}

updatePaul().catch(console.error).finally(() => process.exit(0));
