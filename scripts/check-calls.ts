import { db } from '../server/db';
import { calls } from '../shared/schema';
import { desc } from 'drizzle-orm';

async function checkCalls() {
    try {
        const allCalls = await db.select().from(calls).orderBy(desc(calls.startTime)).limit(10);

        console.log(`\n📞 Total calls in database: ${allCalls.length}`);

        if (allCalls.length === 0) {
            console.log('\n⚠️  No calls found in database yet.');
            console.log('Make a test call to your Twilio number to verify the system is working.\n');
        } else {
            console.log('\n✅ Recent calls:');
            allCalls.forEach((call, i) => {
                console.log(`\n${i + 1}. ${call.customerName || 'Unknown'} - ${call.phoneNumber}`);
                console.log(`   Started: ${call.startTime}`);
                console.log(`   Outcome: ${call.outcome || 'In progress'}`);
                console.log(`   Duration: ${call.duration ? `${call.duration}s` : 'N/A'}`);
            });
        }

        process.exit(0);
    } catch (e) {
        console.error('Error checking calls:', e);
        process.exit(1);
    }
}

checkCalls();
