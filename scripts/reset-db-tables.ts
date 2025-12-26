
import { neon } from "@neondatabase/serverless";
import dotenv from "dotenv";

dotenv.config();

if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL must be set");
}

const sql = neon(process.env.DATABASE_URL);

async function typeWriter(text: string) {
    console.log(text);
}

async function main() {
    console.log("Dropping tables...");
    try {
        await sql`DROP TABLE IF EXISTS personalized_quotes CASCADE`;
        console.log("Dropped personalized_quotes");

        await sql`DROP TABLE IF EXISTS leads CASCADE`;
        console.log("Dropped leads");

        console.log("Tables dropped successfully.");
    } catch (error) {
        console.error("Error dropping tables:", error);
    }
}

main();
