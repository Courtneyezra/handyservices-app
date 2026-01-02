import { neon } from "@neondatabase/serverless";
import dotenv from "dotenv";

dotenv.config();

if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL must be set");
}

const sql = neon(process.env.DATABASE_URL);

async function migrate() {
    console.log("Adding job_summary column to calls table...");
    try {
        await sql`ALTER TABLE calls ADD COLUMN IF NOT EXISTS job_summary text;`;
        console.log("Migration successful!");
    } catch (error) {
        console.error("Migration failed:", error);
    }
}

migrate();
