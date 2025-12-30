import { db } from '../server/db';
import { calls } from '../shared/schema';

async function checkCallData() {
    console.log('Checking call data completeness...\n');

    // Get all calls
    const allCalls = await db.select().from(calls);

    console.log(`Total calls in database: ${allCalls.length}\n`);

    // Analyze data completeness
    const stats = {
        withTranscription: 0,
        withCustomerName: 0,
        withAddress: 0,
        withPostcode: 0,
        withOutcome: 0,
        withSegments: 0,
        withNotes: 0,
        withTotalPrice: 0,
    };

    for (const call of allCalls) {
        if (call.transcription) stats.withTranscription++;
        if (call.customerName && call.customerName !== 'Unknown') stats.withCustomerName++;
        if (call.address) stats.withAddress++;
        if (call.postcode) stats.withPostcode++;
        if (call.outcome) stats.withOutcome++;
        if (call.segments) stats.withSegments++;
        if (call.notes) stats.withNotes++;
        if (call.totalPricePence && call.totalPricePence > 0) stats.withTotalPrice++;
    }

    console.log('Data Completeness Statistics:');
    console.log('─'.repeat(50));
    console.log(`Calls with transcription:    ${stats.withTranscription}/${allCalls.length} (${Math.round(stats.withTranscription / allCalls.length * 100)}%)`);
    console.log(`Calls with customer name:    ${stats.withCustomerName}/${allCalls.length} (${Math.round(stats.withCustomerName / allCalls.length * 100)}%)`);
    console.log(`Calls with address:          ${stats.withAddress}/${allCalls.length} (${Math.round(stats.withAddress / allCalls.length * 100)}%)`);
    console.log(`Calls with postcode:         ${stats.withPostcode}/${allCalls.length} (${Math.round(stats.withPostcode / allCalls.length * 100)}%)`);
    console.log(`Calls with outcome:          ${stats.withOutcome}/${allCalls.length} (${Math.round(stats.withOutcome / allCalls.length * 100)}%)`);
    console.log(`Calls with segments:         ${stats.withSegments}/${allCalls.length} (${Math.round(stats.withSegments / allCalls.length * 100)}%)`);
    console.log(`Calls with notes:            ${stats.withNotes}/${allCalls.length} (${Math.round(stats.withNotes / allCalls.length * 100)}%)`);
    console.log(`Calls with total price:      ${stats.withTotalPrice}/${allCalls.length} (${Math.round(stats.withTotalPrice / allCalls.length * 100)}%)`);

    console.log('\n' + '─'.repeat(50));
    console.log('Sample Call Details (most recent):');
    console.log('─'.repeat(50));

    const recentCall = allCalls[0];
    if (recentCall) {
        console.log(`\nCall ID: ${recentCall.id}`);
        console.log(`Customer: ${recentCall.customerName || 'NULL'}`);
        console.log(`Phone: ${recentCall.phoneNumber}`);
        console.log(`Status: ${recentCall.status}`);
        console.log(`Duration: ${recentCall.duration || 'NULL'}s`);
        console.log(`Transcription: ${recentCall.transcription ? `${recentCall.transcription.substring(0, 100)}...` : 'NULL'}`);
        console.log(`Outcome: ${recentCall.outcome || 'NULL'}`);
        console.log(`Address: ${recentCall.address || 'NULL'}`);
        console.log(`Postcode: ${recentCall.postcode || 'NULL'}`);
        console.log(`Total Price: ${recentCall.totalPricePence || 'NULL'}`);
    }

    console.log('\n' + '─'.repeat(50));
    console.log('Recommendation:');
    console.log('─'.repeat(50));

    if (stats.withTranscription === 0) {
        console.log('⚠️  No calls have transcription data.');
        console.log('   This is likely because these are test calls that ended');
        console.log('   without speaking or before transcription could be captured.');
        console.log('   Make a real test call with speech to verify transcription works.');
    }

    if (stats.withCustomerName === 0) {
        console.log('⚠️  No calls have customer names extracted.');
        console.log('   This is expected if no names were mentioned in the calls.');
    }

    console.log('\n✅ The CallDetailsModal should handle all null values gracefully.');
    console.log('   Empty/null fields will show "-" or "No data available" messages.');
}

checkCallData()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error('Error checking call data:', error);
        process.exit(1);
    });
