import 'dotenv/config';
import { neon } from '@neondatabase/serverless';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function runMigration() {
    const sql = neon(process.env.DATABASE_URL!);

    console.log('Running migration to add missing columns to calls table...\n');

    const alterStatements = [
        'ALTER TABLE calls ADD COLUMN IF NOT EXISTS customer_name VARCHAR',
        'ALTER TABLE calls ADD COLUMN IF NOT EXISTS email VARCHAR',
        'ALTER TABLE calls ADD COLUMN IF NOT EXISTS address VARCHAR',
        'ALTER TABLE calls ADD COLUMN IF NOT EXISTS postcode VARCHAR',
        'ALTER TABLE calls ADD COLUMN IF NOT EXISTS duration INTEGER',
        'ALTER TABLE calls ADD COLUMN IF NOT EXISTS end_time TIMESTAMP',
        'ALTER TABLE calls ADD COLUMN IF NOT EXISTS outcome VARCHAR',
        'ALTER TABLE calls ADD COLUMN IF NOT EXISTS urgency VARCHAR',
        'ALTER TABLE calls ADD COLUMN IF NOT EXISTS lead_type VARCHAR',
        'ALTER TABLE calls ADD COLUMN IF NOT EXISTS detected_skus_json JSONB',
        'ALTER TABLE calls ADD COLUMN IF NOT EXISTS sku_detection_method VARCHAR',
        'ALTER TABLE calls ADD COLUMN IF NOT EXISTS manual_skus_json JSONB',
        'ALTER TABLE calls ADD COLUMN IF NOT EXISTS total_price_pence INTEGER',
        'ALTER TABLE calls ADD COLUMN IF NOT EXISTS last_edited_by VARCHAR',
        'ALTER TABLE calls ADD COLUMN IF NOT EXISTS last_edited_at TIMESTAMP',
        'ALTER TABLE calls ADD COLUMN IF NOT EXISTS notes TEXT',
        'ALTER TABLE calls ADD COLUMN IF NOT EXISTS segments JSONB',
    ];

    try {
        for (const statement of alterStatements) {
            await sql(statement);
            console.log(`✓ ${statement.substring(0, 60)}...`);
        }
        console.log('\n✅ Migration completed successfully!');
        console.log('All missing columns have been added to the calls table.');
    } catch (e) {
        console.error('❌ Migration failed:', e);
        process.exit(1);
    }

    process.exit(0);
}

runMigration();
