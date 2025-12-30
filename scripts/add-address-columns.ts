
import { db } from "../server/db";
import { sql } from "drizzle-orm";

async function addAddressColumns() {
    console.log("Applying address columns migration to 'leads' table...");

    const statements = [
        `ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "address_raw" text;`,
        `ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "address_canonical" text;`,
        `ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "place_id" varchar(255);`,
        `ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "postcode" varchar(10);`,
        `ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "coordinates" jsonb;`,

        // Add indexes for performance
        `CREATE INDEX IF NOT EXISTS "idx_leads_phone" ON "leads" ("phone");`,
        `CREATE INDEX IF NOT EXISTS "idx_leads_place_id" ON "leads" ("place_id");`,
        `CREATE INDEX IF NOT EXISTS "idx_leads_postcode" ON "leads" ("postcode");`
    ];

    for (const statement of statements) {
        try {
            console.log(`Executing: ${statement}`);
            await db.execute(sql.raw(statement));
            console.log("Success.");
        } catch (e: any) {
            console.error(`Statement failed: ${e.message}`);
        }
    }

    console.log("Migration complete!");
    process.exit(0);
}

addAddressColumns().catch(err => {
    console.error(err);
    process.exit(1);
});
