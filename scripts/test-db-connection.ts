
import { neon } from "@neondatabase/serverless";
import dotenv from "dotenv";

dotenv.config();

if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL is not set");
    process.exit(1);
}

const sql = neon(process.env.DATABASE_URL);

async function testConnection() {
    console.log("Testing database connection...");
    const start = Date.now();
    try {
        const result = await sql`SELECT 1 as passed`;
        const duration = Date.now() - start;
        console.log(`Connection successful! Duration: ${duration}ms`);
        console.log("Result:", result);
    } catch (error) {
        console.error("Connection failed:", error);
    }
}

testConnection();
