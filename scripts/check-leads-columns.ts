import { db } from '../server/db';
import { sql } from 'drizzle-orm';

async function checkLeadsSchema() {
    try {
        console.log('Checking leads table columns...');
        const result = await db.execute(sql`
            SELECT table_schema, column_name 
            FROM information_schema.columns 
            WHERE table_name = 'leads';
        `);
        console.log('Columns in leads table:');
        result.rows.forEach((r: any) => console.log(`- ${r.table_schema}.${r.column_name}`));

        process.exit(0);
    } catch (e) {
        console.error(e);
        process.exit(1);
    }
}

checkLeadsSchema();
