import { db } from '../server/db';
import { calls } from '../shared/schema';
import { eq, isNull, or } from 'drizzle-orm';

async function fixCallDurations() {
    console.log('Checking for calls with missing duration or endTime...');

    // Find all completed calls without duration or endTime
    const incompleteCalls = await db.select()
        .from(calls)
        .where(
            or(
                isNull(calls.duration),
                isNull(calls.endTime)
            )
        );

    console.log(`Found ${incompleteCalls.length} calls with missing duration/endTime`);

    if (incompleteCalls.length === 0) {
        console.log('No calls need fixing!');
        return;
    }

    // Display the calls
    for (const call of incompleteCalls) {
        console.log(`\nCall ID: ${call.id}`);
        console.log(`  Customer: ${call.customerName || 'Unknown'}`);
        console.log(`  Phone: ${call.phoneNumber}`);
        console.log(`  Status: ${call.status}`);
        console.log(`  Start Time: ${call.startTime}`);
        console.log(`  End Time: ${call.endTime || 'NOT SET'}`);
        console.log(`  Duration: ${call.duration || 'NOT SET'}`);
    }

    // Fix calls by setting endTime and calculating duration
    console.log(`\nFixing ${incompleteCalls.length} calls...`);

    for (const call of incompleteCalls) {
        const endTime = call.endTime || new Date();
        const startTime = new Date(call.startTime);
        const duration = Math.floor((endTime.getTime() - startTime.getTime()) / 1000);

        await db.update(calls)
            .set({
                endTime: endTime,
                duration: duration > 0 ? duration : 0,
                lastEditedAt: new Date(),
            })
            .where(eq(calls.id, call.id));

        console.log(`✓ Updated call ${call.id} - Duration: ${duration}s`);
    }

    console.log('\n✅ All calls have been updated with duration and endTime');
}

fixCallDurations()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error('Error fixing call durations:', error);
        process.exit(1);
    });
