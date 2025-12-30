import { db } from './server/db';
import { sql } from 'drizzle-orm';

async function checkSchema() {
    try {
        console.log('Checking Productized Services (SKUs)...');
        const skus = await db.execute(sql`
            SELECT sku_code, name, category, price_pence 
            FROM productized_services 
            LIMIT 10;
        `);
        console.log('Sample SKUs:', skus.rows);

        const categories = await db.execute(sql`
            SELECT DISTINCT category FROM productized_services;
        `);
        console.log('Categories:', categories.rows.map((r: any) => r.category));

        process.exit(0);
    } catch (e) {
        console.error(e);
        process.exit(1);
    }
}

checkSchema();
