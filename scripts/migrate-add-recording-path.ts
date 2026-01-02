import { db } from "../server/db";
import { sql } from "drizzle-orm";

async function main() {
    console.log("Adding local_recording_path column to calls table...");
    try {
        await db.execute(sql`ALTER TABLE calls ADD COLUMN IF NOT EXISTS local_recording_path VARCHAR;`);
        console.log("Migration successful!");
    } catch (err) {
        console.error("Migration failed:", err);
        process.exit(1);
    }
    process.exit(0);
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
