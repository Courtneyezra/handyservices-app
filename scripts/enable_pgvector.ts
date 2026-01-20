
import { db } from "../server/db";
import { sql } from "drizzle-orm";

async function enablePgVector() {
    console.log("🔧 Enabling pgvector extension...");

    try {
        // 1. Enable Extension
        await db.execute(sql`CREATE EXTENSION IF NOT EXISTS vector;`);
        console.log("✅ Extension 'vector' enabled.");
    } catch (e: any) {
        console.log("⚠️ Could not enable extension (might require superuser):", e.message);
    }

    try {
        // 2. Check Column Type
        const result = await db.execute(sql`
            SELECT data_type, udt_name 
            FROM information_schema.columns 
            WHERE table_name = 'productized_services' AND column_name = 'embedding';
        `);

        const colType = result.rows[0]?.udt_name;
        console.log(`ℹ️ Current column type: ${colType}`);

        if (colType !== 'vector') {
            console.log("🔄 Converting column 'embedding' to vector(1536)...");
            // Cast text/json string to vector
            // Note: If data is dirty, this might fail. We assume it's "[0.12, ...]" string format.
            await db.execute(sql`
                ALTER TABLE productized_services 
                ALTER COLUMN embedding TYPE vector(1536) 
                USING embedding::vector;
            `);
            console.log("✅ Column converted.");
        } else {
            console.log("✅ Column is already 'vector'.");
        }

    } catch (e: any) {
        console.error("❌ Migration Failed:", e.message);
    }

    process.exit(0);
}

enablePgVector();
