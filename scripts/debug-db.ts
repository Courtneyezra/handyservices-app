
import { neon } from "@neondatabase/serverless";
import dotenv from "dotenv";

dotenv.config();

if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL must be set");
}

const sql = neon(process.env.DATABASE_URL);

async function main() {
    console.log("Checking existing tables...");
    try {
        const result = await sql`
            SELECT table_name 
            FROM information_schema.tables 
            WHERE table_schema = 'public'
        `;
        console.log("Tables:", result.map(r => r.table_name));
    } catch (error) {
        console.error("Error:", error);
    }
}

main();
