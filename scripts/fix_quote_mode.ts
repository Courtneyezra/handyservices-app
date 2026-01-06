import { neon } from "@neondatabase/serverless";
import dotenv from "dotenv";

dotenv.config();

if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL must be set");
}

const sql = neon(process.env.DATABASE_URL);

async function main() {
    console.log("Migrating quote_mode column...");
    try {
        // Alter the column type to VARCHAR(20) to support 'pick_and_mix'
        const result = await sql("ALTER TABLE personalized_quotes ALTER COLUMN quote_mode TYPE VARCHAR(20)");
        console.log("Migration successful", result);
    } catch (e) {
        console.error("Migration failed", e);
    }
}

main();
