/**
 * Test harness for the post-call classification layer.
 *
 *   npx tsx scripts/_call-classifier-test.ts
 *
 * Three parts:
 *   1. Fail-closed gates — no/short transcript classifies to NO_TRANSCRIPT, garbage
 *      model output parses to null. No model call, no DB.
 *   2. The decideOutreach routing matrix — every verdict shape, both config flags. Pure.
 *   3. ONE live classification of a synthetic transcript (real model call, haiku).
 *
 * Sends nothing, enables nothing, writes nothing: the feature flag stays wherever it is,
 * and only classifyTranscript (the DB-free test hook) touches the model.
 */
import 'dotenv/config';
import {
    classifyTranscript,
    parseClassification,
    type CallClassification,
} from '../server/call-classifier';
import { decideOutreach } from '../server/post-call-outreach';

let passed = 0;
let failed = 0;

function check(name: string, ok: boolean, detail?: string) {
    if (ok) { passed++; console.log(`  ✓ ${name}`); }
    else { failed++; console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`); }
}

function verdict(over: Partial<CallClassification> = {}): CallClassification {
    return {
        kind: 'job_enquiry',
        whatsappAgreed: 'not_discussed',
        messagingObjection: false,
        jobSummary: 'Fix a dripping kitchen tap',
        urgency: 'normal',
        callbackPromised: false,
        classifiedAt: new Date().toISOString(),
        ...over,
    };
}

async function main() {
    // ---------- 1. Fail-closed gates (no model, no DB) ----------
    console.log('\n1. Fail-closed gates');

    for (const [label, t] of [['null', null], ['empty', ''], ['whitespace', '   \n  '], ['short', 'Hello? Hello? ...click']] as const) {
        const r = await classifyTranscript(t);
        check(`${label} transcript → NO_TRANSCRIPT`, !r.ok && r.reason === 'NO_TRANSCRIPT', JSON.stringify(r));
    }

    check('garbage object parses to null', parseClassification({ foo: 'bar' }) === null);
    check('null parses to null', parseClassification(null) === null);
    check('array parses to null', parseClassification([1, 2]) === null);
    check('string parses to null', parseClassification('job_enquiry') === null);
    check('bad kind parses to null', parseClassification({ ...verdict(), kind: 'emergency' }) === null);
    check('bad whatsappAgreed parses to null', parseClassification({ ...verdict(), whatsappAgreed: 'yes' }) === null);
    check('bad urgency parses to null', parseClassification({ ...verdict(), urgency: 'critical' }) === null);
    check('non-bool objection parses to null', parseClassification({ ...verdict(), messagingObjection: 'no' }) === null);
    check('valid verdict parses', parseClassification(verdict()) !== null);
    const long = parseClassification({ ...verdict(), jobSummary: 'x'.repeat(500) });
    check('oversize jobSummary truncated to 200', long !== null && long.jobSummary.length === 200);

    // ---------- 2. decideOutreach routing matrix ----------
    console.log('\n2. decideOutreach routing matrix');
    const off = { allowUndiscussed: false };
    const on = { allowUndiscussed: true };

    // No classification → nothing, ever.
    for (const cfg of [off, on]) {
        const r = decideOutreach(null, cfg);
        check(`null classification (allowUndiscussed=${cfg.allowUndiscussed}) → no send, NO_CLASSIFICATION`,
            !r.send && r.reason === 'NO_CLASSIFICATION' && !r.tagNoAutoMessages && !r.complaintAlert);
    }

    // Non-enquiry kinds → never send, reason names the kind. Even with agreement and the flag on.
    for (const kind of ['existing_customer', 'supplier', 'sales_spam', 'wrong_number', 'other'] as const) {
        const r = decideOutreach(verdict({ kind, whatsappAgreed: 'agreed' }), on);
        check(`kind=${kind} → no send, NOT_A_JOB_ENQUIRY:${kind}`,
            !r.send && r.reason === `NOT_A_JOB_ENQUIRY:${kind}` && !r.complaintAlert);
    }

    // Complaint → never send, alert fires, even if they "agreed" to WhatsApp.
    {
        const r = decideOutreach(verdict({ kind: 'complaint', whatsappAgreed: 'agreed' }), on);
        check('complaint → no send, COMPLAINT, complaintAlert', !r.send && r.reason === 'COMPLAINT' && r.complaintAlert);
        const r2 = decideOutreach(verdict({ kind: 'complaint', whatsappAgreed: 'declined' }), off);
        check('complaint + declined → complaintAlert AND no_auto_messages tag', !r2.send && r2.complaintAlert && r2.tagNoAutoMessages);
    }

    // Objection or explicit decline → no send + tag, regardless of the flag. Objection beats "agreed".
    {
        const r = decideOutreach(verdict({ whatsappAgreed: 'declined' }), on);
        check('declined → no send, CUSTOMER_DECLINED_MESSAGING, tagged',
            !r.send && r.reason === 'CUSTOMER_DECLINED_MESSAGING' && r.tagNoAutoMessages);
        const r2 = decideOutreach(verdict({ whatsappAgreed: 'agreed', messagingObjection: true }), off);
        check('objection overrides agreed → no send, tagged', !r2.send && r2.reason === 'CUSTOMER_DECLINED_MESSAGING' && r2.tagNoAutoMessages);
        const r3 = decideOutreach(verdict({ kind: 'supplier', messagingObjection: true }), off);
        check('supplier objection still tags no_auto_messages', !r3.send && r3.tagNoAutoMessages);
    }

    // Agreed job enquiry → send.
    {
        const r = decideOutreach(verdict({ whatsappAgreed: 'agreed' }), off);
        check('job enquiry + agreed → SEND, AGREED_ON_CALL', r.send && r.reason === 'AGREED_ON_CALL' && !r.tagNoAutoMessages && !r.complaintAlert);
    }

    // Not discussed → flag decides.
    {
        const r = decideOutreach(verdict({ whatsappAgreed: 'not_discussed' }), off);
        check('not_discussed, flag off → no send, NOT_DISCUSSED_ON_CALL', !r.send && r.reason === 'NOT_DISCUSSED_ON_CALL');
        const r2 = decideOutreach(verdict({ whatsappAgreed: 'not_discussed' }), on);
        check('not_discussed, flag on → SEND, NOT_DISCUSSED_ALLOWED', r2.send && r2.reason === 'NOT_DISCUSSED_ALLOWED');
    }

    // ---------- 3. One live classification (synthetic transcript, model call) ----------
    console.log('\n3. Live classification (one haiku call, synthetic transcript)');
    const syntheticTranscript = `
Agent: Good morning, Handy Services, how can I help?
Caller: Hi, yeah, I've got a leaking tap in the kitchen and the sealant round the bath has gone black, wondered if you could sort it.
Agent: We can, yes. Whereabouts are you?
Caller: NG7, near the park.
Agent: No problem. Easiest way to price it — could you send us a quick video of the tap and the bath on WhatsApp? Just show the area and talk us through it.
Caller: Yeah that's fine, I can do that this afternoon.
Agent: Brilliant, I'll text you the number now. Speak soon.
Caller: Thanks, bye.`.trim();

    const live = await classifyTranscript(syntheticTranscript);
    check('live call returns ok', live.ok, JSON.stringify(live));
    if (live.ok) {
        const c = live.classification;
        console.log('  verdict:', JSON.stringify(c));
        check('kind = job_enquiry', c.kind === 'job_enquiry', c.kind);
        check('whatsappAgreed = agreed (caller said "that\'s fine")', c.whatsappAgreed === 'agreed', c.whatsappAgreed);
        check('no messaging objection', c.messagingObjection === false);
        check('jobSummary non-empty and <=200 chars', c.jobSummary.length > 0 && c.jobSummary.length <= 200, c.jobSummary);
        check('classifiedAt is a valid ISO timestamp', !isNaN(Date.parse(c.classifiedAt)));

        // And the routing of that live verdict — decision object only, nothing sent.
        const route = decideOutreach(c, off);
        console.log('  route:', JSON.stringify(route));
        check('live verdict routes to SEND / AGREED_ON_CALL', route.send && route.reason === 'AGREED_ON_CALL');
    }

    console.log(`\n${passed} passed, ${failed} failed`);
    process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
