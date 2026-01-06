
import { db } from '../server/db';
import { sql } from 'drizzle-orm';

async function fix() {
    console.log("🛠 Patching schema...");
    try {
        const queries = [
            `ALTER TABLE handyman_profiles ADD COLUMN IF NOT EXISTS trust_badges JSONB;`,
            `ALTER TABLE handyman_profiles ADD COLUMN IF NOT EXISTS availability_status VARCHAR(20) DEFAULT 'available';`,
            `ALTER TABLE handyman_profiles ADD COLUMN IF NOT EXISTS intro_video_url TEXT;`,
            `ALTER TABLE handyman_profiles ADD COLUMN IF NOT EXISTS media_gallery JSONB;`,
            `ALTER TABLE handyman_profiles ADD COLUMN IF NOT EXISTS ai_rules JSONB;`,
            `ALTER TABLE handyman_profiles ADD COLUMN IF NOT EXISTS before_after_gallery JSONB;`
        ];

        for (const query of queries) {
            await db.execute(sql.raw(query));
            console.log(`✅ Executed: ${query.split('ADD COLUMN')[1].split(';')[0]}`);
        }

    } catch (e) {
        console.error("❌ Patch failed:", e);
    }
    process.exit(0);
}

fix();
