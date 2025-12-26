import { db } from "../server/db";
import { sql } from "drizzle-orm";

async function listTables() {
    console.log("Existing tables in the database:");
    const result = await db.execute(sql`
    SELECT table_name 
    FROM information_schema.tables 
    WHERE table_schema = 'public'
    ORDER BY table_name;
  `);

    // result might be an array or have a rows property depending on the driver
    const rows = Array.isArray(result) ? result : (result as any).rows || [];
    const tables = rows.map((row: any) => row.table_name);
    console.log(tables.join(", "));
    process.exit(0);
}

listTables().catch(err => {
    console.error(err);
    process.exit(1);
});
