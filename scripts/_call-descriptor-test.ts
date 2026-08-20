/**
 * Proves the call-classification enrichment path without touching the database.
 *
 * Feeds fake call rows (with and without a `classification` verdict from
 * server/call-classifier.ts) straight through describeCall/classificationLine and prints what the
 * board card preview, the thread bubble and the comms agent's timeline would each see — including
 * the degraded cases: no verdict, null, garbage, missed and outbound.
 *
 *   npx tsx scripts/_call-descriptor-test.ts
 */
import { describeCall, classificationLine, readCallClassification, type CallClassification } from '../server/call-thread';

const base = {
    direction: 'inbound',
    status: 'completed',
    outcome: 'ANSWERED',
    handledBy: 'ai',
    duration: 192,
    ringSeconds: 6,
    jobSummary: null as string | null,
};

const cls = (over: Partial<CallClassification>): CallClassification => ({
    kind: 'job_enquiry',
    whatsappAgreed: 'not_discussed',
    messagingObjection: false,
    jobSummary: '',
    urgency: 'normal',
    callbackPromised: false,
    classifiedAt: new Date().toISOString(),
    ...over,
});

const cases: Array<[string, any]> = [
    ['unclassified (column absent)', { ...base, jobSummary: 'Fence panels blown down in the storm' }],
    ['classification null', { ...base, classification: null }],
    ['classification garbage', { ...base, classification: 'yes' }],
    ['job_enquiry + agreed', { ...base, classification: cls({ kind: 'job_enquiry', jobSummary: 'Two fence panels blown down, wants them replaced this week', whatsappAgreed: 'agreed' }) }],
    ['job_enquiry urgent + callback', { ...base, classification: cls({ kind: 'job_enquiry', jobSummary: 'Leak under the kitchen sink, water reaching the laminate', urgency: 'high', callbackPromised: true }) }],
    ['existing_customer + declined', { ...base, classification: cls({ kind: 'existing_customer', jobSummary: 'Asking when the plasterer is coming back to finish the hallway', whatsappAgreed: 'declined' }) }],
    ['existing_customer, objection only', { ...base, classification: cls({ kind: 'existing_customer', jobSummary: 'Wants to move Thursday to the afternoon', messagingObjection: true }) }],
    ['supplier', { ...base, duration: 65, classification: cls({ kind: 'supplier', jobSummary: 'Screwfix order 4471 ready for collection' }) }],
    ['sales_spam, no summary', { ...base, duration: 41, classification: cls({ kind: 'sales_spam' }) }],
    ['wrong_number', { ...base, duration: 12, classification: cls({ kind: 'wrong_number', jobSummary: 'Asked for a dental practice' }) }],
    ['complaint', { ...base, classification: cls({ kind: 'complaint', jobSummary: 'Boiler cupboard door still sticking after the visit, wants someone back out', callbackPromised: true }) }],
    ['other, empty summary (falls back)', { ...base, jobSummary: 'Caller discussed an ongoing job', classification: cls({ kind: 'other' }) }],
    ['long summary clips at ~90', { ...base, classification: cls({ kind: 'job_enquiry', jobSummary: 'Full bathroom refit: strip out the old suite, retile all four walls floor to ceiling, new towel radiator, extractor fan and underfloor heating throughout' }) }],
    ['missed call ignores classification', { ...base, status: 'no-answer', duration: 0, classification: cls({ kind: 'job_enquiry', jobSummary: 'should never print' }) }],
    ['outbound ignores classification', { ...base, direction: 'outbound-dial', classification: cls({ kind: 'job_enquiry', jobSummary: 'should never print' }) }],
];

for (const [name, call] of cases) {
    const d = describeCall(call);
    const parsed = readCallClassification(call);
    console.log(`\n== ${name}`);
    console.log(`   preview : ${d.preview}`);
    console.log(`   summary : ${d.summary ?? '(none)'}`);
    console.log(`   agent   : ${parsed ? JSON.stringify({ kind: parsed.kind, whatsappAgreed: parsed.whatsappAgreed }) : '(unclassified)'}`);
    if (parsed) console.log(`   bubble  : ${classificationLine(parsed)}`);
}

// call-thread imports the db module, whose pool keeps the event loop alive. Nothing here ever
// queried it; exit rather than hang.
process.exit(0);
