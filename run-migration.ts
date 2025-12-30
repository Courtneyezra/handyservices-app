import { db } from './server/db';
import { sql } from 'drizzle-orm';
import fs from 'fs';
import path from 'path';

async function runMigration() {
    try {
        const migrationPath = path.join(process.cwd(), 'migrations', '0002_contractor_portal.sql');
        const migrationSql = fs.readFileSync(migrationPath, 'utf8');

        console.log('Running migration from:', migrationPath);

        // Split by semicolon and run statements individually
        const statements = migrationSql
            .split(';')
            .map(s => s.trim())
            .filter(s => s.length > 0);

        console.log(`Found ${statements.length} statements to execute`);

        for (const statement of statements) {
            console.log('Executing:', statement.substring(0, 50) + '...');
            await db.execute(sql.raw(statement));
        }

        console.log('Migration completed successfully!');
        process.exit(0);
    } catch (e) {
        console.error('Migration failed:', e);
        process.exit(1);
    }
}

runMigration();
