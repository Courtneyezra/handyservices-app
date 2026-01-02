import { db } from "../server/db";
import { calls } from "../shared/schema";
import { eq } from "drizzle-orm";

async function main() {
    console.log("Updating customer name for call...");
    try {
        await db.update(calls)
            .set({ customerName: 'Chirag' })
            .where(eq(calls.callId, 'CA951d6ea1ab2045dd80b73a6aa4921871'));
        console.log("Update successful!");
    } catch (err) {
        console.error("Update failed:", err);
        process.exit(1);
    }
    process.exit(0);
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
