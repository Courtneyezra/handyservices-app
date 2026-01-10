
import { db } from './server/db';
import { users, handymanProfiles } from './shared/schema';
import { desc } from 'drizzle-orm';

async function checkVariations() {
    console.log("Variations Check:");

    // 1. Just findMany without relations
    console.log("\n1. Basic findMany (no 'with'):");
    const basic = await db.query.handymanProfiles.findMany();
    console.log(`Returned ${basic.length} profiles.`);
    const paulBasic = basic.find((h: any) => h.userId === '4003a546-efa4-4bd7-b08d-eb50b77255af'); // Using userId we saw earlier
    console.log(paulBasic ? "Paul Found!" : "Paul MISSING");

    // 2. With User only
    console.log("\n2. With User only:");
    const withUser = await db.query.handymanProfiles.findMany({
        with: { user: true }
    });
    console.log(`Returned ${withUser.length} profiles.`);
    const paulUser = withUser.find((h: any) => h.user?.firstName === 'Paul');
    console.log(paulUser ? "Paul Found!" : "Paul MISSING");

    // 3. With Skills only (no service)
    console.log("\n3. With Skills only:");
    const withSkills = await db.query.handymanProfiles.findMany({
        with: { skills: true }
    });
    console.log(`Returned ${withSkills.length} profiles.`);
    const paulSkills = withSkills.find((h: any) => h.id === (paulBasic?.id || 'unknown'));
    console.log(paulSkills ? "Paul Found!" : "Paul MISSING");
    if (paulSkills) {
        console.log("Paul's Skills:", JSON.stringify(paulSkills.skills));
    }

    // 4. Full Query
    console.log("\n4. Full Query (User + Skills.Service + Availability):");
    const full = await db.query.handymanProfiles.findMany({
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
    console.log(`Returned ${full.length} profiles.`);
    const paulFull = full.find((h: any) => h.user?.firstName === 'Paul');
    console.log(paulFull ? "Paul Found!" : "Paul MISSING");

}

checkVariations().catch(console.error).finally(() => process.exit(0));
