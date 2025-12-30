import 'dotenv/config';
import { db } from '../server/db';
import { calls } from '../shared/schema';
import { eq } from 'drizzle-orm';

async function inspectCall() {
    try {
        // Get the most recent call
        const [call] = await db.select().from(calls).limit(1);

        if (!call) {
            console.log('No calls found');
            process.exit(0);
        }

        console.log('\n📞 Call Details:\n');
        console.log(JSON.stringify(call, null, 2));

        // Try to fetch with relations
        const callWithSkus = await db.query.calls.findFirst({
            where: eq(calls.id, call.id),
            with: {
                callSkus: {
                    with: {
                        sku: true
                    }
                }
            }
        });

        console.log('\n📞 Call with SKUs:\n');
        console.log(JSON.stringify(callWithSkus, null, 2));

        process.exit(0);
    } catch (e) {
        console.error('Error:', e);
        process.exit(1);
    }
}

inspectCall();
