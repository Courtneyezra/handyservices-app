
import { neon } from "@neondatabase/serverless";
import dotenv from "dotenv";

dotenv.config();

if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL must be set");
}

const sql = neon(process.env.DATABASE_URL);

async function main() {
    console.log("Fixing schema...");
    try {
        await sql`ALTER TABLE calls ADD COLUMN IF NOT EXISTS live_analysis_json jsonb;`;
        console.log("Added live_analysis_json");

        await sql`ALTER TABLE calls ADD COLUMN IF NOT EXISTS metadata_json jsonb;`;
        console.log("Added metadata_json");

        await sql`ALTER TABLE calls ADD COLUMN IF NOT EXISTS segments jsonb;`;
        console.log("Added segments");

        await sql`ALTER TABLE calls ADD COLUMN IF NOT EXISTS manual_skus_json jsonb;`;
        console.log("Added manual_skus_json");

        await sql`ALTER TABLE calls ADD COLUMN IF NOT EXISTS detected_skus_json jsonb;`;
        console.log("Added detected_skus_json");

        await sql`ALTER TABLE calls ADD COLUMN IF NOT EXISTS sku_detection_method varchar;`;
        console.log("Added sku_detection_method");

        console.log("Schema fixed successfully.");
    } catch (error) {
        console.error("Error fixing schema:", error);
    }
}

main();
