import { db } from '../server/db';
import { calls } from '../shared/schema';

import { eq } from 'drizzle-orm';

async function fixStuckCalls() {
    console.log('Checking for calls stuck in "in-progress" status...');

    // Find all calls with in-progress status
    const inProgressCalls = await db.select()
        .from(calls)
        .where(eq(calls.status, 'in-progress'));

    console.log(`Found ${inProgressCalls.length} calls with "in-progress" status`);

    if (inProgressCalls.length === 0) {
        console.log('No stuck calls found!');
        return;
    }

    // Display the stuck calls
    for (const call of inProgressCalls) {
        console.log(`\nCall ID: ${call.id}`);
        console.log(`  Twilio CallSid: ${call.callId}`);
        console.log(`  Customer: ${call.customerName || 'Unknown'}`);
        console.log(`  Phone: ${call.phoneNumber}`);
        console.log(`  Start Time: ${call.startTime}`);
        console.log(`  End Time: ${call.endTime || 'Not set'}`);
        console.log(`  Duration: ${call.duration || 'Not set'}`);
        console.log(`  Status: ${call.status}`);
    }

    // Update all in-progress calls to completed
    console.log(`\nUpdating ${inProgressCalls.length} calls to "completed" status...`);

    for (const call of inProgressCalls) {
        await db.update(calls)
            .set({
                status: 'completed',
                endTime: call.endTime || new Date(),
                lastEditedAt: new Date(),
            })
            .where(eq(calls.id, call.id));

        console.log(`✓ Updated call ${call.id}`);
    }

    console.log('\n✅ All stuck calls have been updated to "completed" status');
}

fixStuckCalls()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error('Error fixing stuck calls:', error);
        process.exit(1);
    });
