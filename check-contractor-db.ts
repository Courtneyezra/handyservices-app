
import { db } from './server/db';
import { users, handymanProfiles } from './shared/schema';
import { desc } from 'drizzle-orm';

async function checkExactQuery() {
    console.log("Running exact query from server/handymen.ts...");

    try {
        const allProfiles = await db.query.handymanProfiles.findMany({
            with: {
                user: true,
                skills: {
                    with: {
                        service: true
                    }
                },
                availability: true
            }
        });

        console.log(`Query returned ${allProfiles.length} profiles.`);

        const paul = allProfiles.find((h: any) => h.user?.firstName === 'Paul');
        if (paul) {
            console.log("Found Paul in exact query!");
            console.log(JSON.stringify({
                id: paul.id,
                name: paul.user?.firstName,
                lat: paul.latitude,
                lng: paul.longitude,
                postcode: paul.postcode,
                skillsCount: paul.skills.length
            }, null, 2));
        } else {
            console.log("Paul NOT found in exact query.");
            allProfiles.forEach((p: any) => console.log(`- ${p.user?.firstName} ${p.user?.lastName} (${p.id})`));
        }

    } catch (e) {
        console.error("Query failed:", e);
    }
}

checkExactQuery().catch(console.error).finally(() => process.exit(0));
