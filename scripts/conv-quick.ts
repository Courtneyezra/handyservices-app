import { db } from "../server/db";
import { sql } from "drizzle-orm";

async function main() {
    const r = await db.execute(sql`
      SELECT
        count(*) as total,
        count(viewed_at) as viewed,
        count(selected_at) as selected,
        count(booked_at) as booked,
        count(deposit_paid_at) as deposit_paid,
        count(completed_at) as completed,
        count(rejection_reason) as rejected,
        count(case when payment_type is not null then 1 end) as had_payment_intent,
        count(case when stripe_payment_intent_id is not null then 1 end) as stripe_pi
      FROM personalized_quotes
    `);
    console.log("Quote conversion funnel:");
    console.log(r.rows[0]);
    process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
