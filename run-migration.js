import pg from 'pg';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const { Pool } = pg;
const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function runMigration() {
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });

    console.log('🔄 Running migration: 0024_add_proposal_mode_and_optional_customer.sql');

    const migrationPath = path.join(__dirname, 'migrations', '0024_add_proposal_mode_and_optional_customer.sql');
    const migrationSQL = fs.readFileSync(migrationPath, 'utf-8');

    try {
        await pool.query(migrationSQL);
        console.log('✅ Migration completed successfully!');
    } catch (error) {
        console.error('❌ Migration failed:', error.message);
        process.exit(1);
    } finally {
        await pool.end();
    }
}

runMigration();
