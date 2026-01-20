
import { db } from "../server/db";
import { calls, leads, conversations } from "../shared/schema";
import { count } from "drizzle-orm";

async function checkData() {
    const callCount = await db.select({ count: count() }).from(calls);
    const leadCount = await db.select({ count: count() }).from(leads);
    const convoCount = await db.select({ count: count() }).from(conversations);

    console.log("Existing Data Counts:");
    console.log("Calls:", callCount[0].count);
    console.log("Leads:", leadCount[0].count);
    console.log("Conversations:", convoCount[0].count);
    process.exit(0);
}

checkData().catch(console.error);
