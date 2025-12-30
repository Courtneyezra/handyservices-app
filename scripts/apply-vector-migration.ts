
import { db } from "../server/db";
import { sql } from "drizzle-orm";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function runMigration() {
    console.log("🚀 Starting pgvector migration...");

    try {
        const migrationPath = path.resolve(__dirname, "../migrations/0003_add_pgvector.sql");
        const migrationSql = fs.readFileSync(migrationPath, "utf-8");

        console.log(`📄 Read migration file: ${migrationPath}`);

        // Split by semicolon to run statements individually
        // Filter out empty statements
        const statements = migrationSql
            .split(';')
            .map(s => s.trim())
            .filter(s => s.length > 0);

        console.log(`⚡ Found ${statements.length} SQL statements to execute`);

        for (const statement of statements) {
            console.log(`   Running: ${statement.substring(0, 50)}...`);
            await db.execute(sql.raw(statement));
        }

        console.log("✅ Migration applied successfully!");
        console.log("   - pgvector extension enabled");
        console.log("   - 'embedding' column created");
        console.log("   - Existing data migrated from JSON to Vector");
        console.log("   - HNSW index created");

    } catch (e) {
        console.error("❌ Migration failed:", e);
        process.exit(1);
    }
    process.exit(0);
}

runMigration().catch(console.error);
