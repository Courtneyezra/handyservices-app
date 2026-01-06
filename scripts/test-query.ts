
import { db } from '../server/db';

async function test() {
    console.log("🔍 Testing Handyman Query...");
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
        console.log(`✅ Success! Found ${allProfiles.length} profiles.`);
        console.log("Sample:", JSON.stringify(allProfiles[0]?.user?.firstName, null, 2));
    } catch (e) {
        console.error("❌ Query failed:", e);
    }
    process.exit(0);
}

test();
