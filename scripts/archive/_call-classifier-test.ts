/**
 * Test harness for the post-call classification layer.
 *
 *   npx tsx scripts/_call-classifier-test.ts
 *
 * Six parts:
 *   1. Fail-closed gates — no/short transcript classifies to NO_TRANSCRIPT, garbage
 *      model output parses to null. No model call, no DB.
 *   2. The decideOutreach routing matrix — every verdict shape, both config flags. Pure.
 *   3. pickVideoTemplate — the consent → template-name mapping. Pure.
 *   4. callbackFallbackEligible — when the sweep may text an unrung callback. Pure.
 *   5. The callback_due tag-clear round trip — one outbound call ingested against the Ofcom
 *      smoke conversation (447700900999@c.us), state restored in a finally.
 *   6. ONE live classification of a synthetic transcript (real model call, haiku).
 *
 * Sends nothing, enables nothing, and leaves the DB as it found it: the feature flag stays
 * wherever it is, part 5 works entirely on the smoke number and restores it, and only
 * classifyTranscript (the DB-free test hook) touches the model.
 */
import 'dotenv/config';
import {
    classifyTranscript,
    parseClassification,
    type CallClassification,
} from '../server/call-classifier';
import {
    decideOutreach,
    pickVideoTemplate,
    callbackFallbackEligible,
    AGREED_VIDEO_TEMPLATE,
    GENERIC_VIDEO_TEMPLATE,
} from '../server/post-call-outreach';

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
        callIncomplete: false,
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

    // callIncomplete is additive: pre-Aug-2026 verdicts don't carry it and must still parse.
    const { callIncomplete: _drop, ...legacy } = verdict();
    const parsedLegacy = parseClassification(legacy);
    check('missing callIncomplete parses, defaults false', parsedLegacy !== null && parsedLegacy.callIncomplete === false);
    const nonBool = parseClassification({ ...verdict(), callIncomplete: 'yes' });
    check('non-bool callIncomplete degrades to false, not null', nonBool !== null && nonBool.callIncomplete === false);
    const kept = parseClassification({ ...verdict(), callIncomplete: true });
    check('callIncomplete=true survives the parse', kept !== null && kept.callIncomplete === true);

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
        check('job enquiry + agreed → SEND, AGREED_ON_CALL', r.send && r.reason === 'AGREED_ON_CALL' && !r.tagNoAutoMessages && !r.complaintAlert && !r.callbackDue);
    }

    // Not discussed → flag decides.
    {
        const r = decideOutreach(verdict({ whatsappAgreed: 'not_discussed' }), off);
        check('not_discussed, flag off → no send, NOT_DISCUSSED_ON_CALL', !r.send && r.reason === 'NOT_DISCUSSED_ON_CALL' && !r.callbackDue);
        const r2 = decideOutreach(verdict({ whatsappAgreed: 'not_discussed' }), on);
        check('not_discussed, flag on → SEND, NOT_DISCUSSED_ALLOWED', r2.send && r2.reason === 'NOT_DISCUSSED_ALLOWED' && !r2.callbackDue);
    }

    // CALLBACK_DUE: a promised or interrupted call is rung back, not texted.
    {
        const r = decideOutreach(verdict({ callbackPromised: true }), off);
        check('callbackPromised → no send, CALLBACK_DUE, callbackDue flag',
            !r.send && r.reason === 'CALLBACK_DUE' && r.callbackDue && !r.tagNoAutoMessages && !r.complaintAlert);
        const r2 = decideOutreach(verdict({ callIncomplete: true }), off);
        check('callIncomplete → no send, CALLBACK_DUE', !r2.send && r2.reason === 'CALLBACK_DUE' && r2.callbackDue);
        // Precedence over whatsappAgreed: "yes send the WhatsApp" on a call that never concluded
        // (or that ended in "I'll ring you back") still means the phone comes first.
        const r3 = decideOutreach(verdict({ whatsappAgreed: 'agreed', callIncomplete: true }), off);
        check('agreed + callIncomplete → CALLBACK_DUE, not send', !r3.send && r3.reason === 'CALLBACK_DUE' && r3.callbackDue);
        const r4 = decideOutreach(verdict({ whatsappAgreed: 'agreed', callbackPromised: true }), on);
        check('agreed + callbackPromised (flag on) → CALLBACK_DUE, not send', !r4.send && r4.reason === 'CALLBACK_DUE' && r4.callbackDue);
        const r5 = decideOutreach(verdict({ whatsappAgreed: 'not_discussed', callbackPromised: true }), on);
        check('not_discussed + callbackPromised beats allowUndiscussed', !r5.send && r5.reason === 'CALLBACK_DUE');
        // But a decline still wins: an objection outlives the callback promise.
        const r6 = decideOutreach(verdict({ whatsappAgreed: 'declined', callbackPromised: true }), off);
        check('declined + callbackPromised → CUSTOMER_DECLINED_MESSAGING, no callbackDue',
            !r6.send && r6.reason === 'CUSTOMER_DECLINED_MESSAGING' && r6.tagNoAutoMessages && !r6.callbackDue);
        // And so do complaint / non-enquiry: CALLBACK_DUE is a job-enquiry outcome only.
        const r7 = decideOutreach(verdict({ kind: 'complaint', callbackPromised: true }), off);
        check('complaint + callbackPromised → COMPLAINT, no callbackDue', r7.reason === 'COMPLAINT' && r7.complaintAlert && !r7.callbackDue);
        const r8 = decideOutreach(verdict({ kind: 'supplier', callIncomplete: true }), off);
        check('supplier + callIncomplete → NOT_A_JOB_ENQUIRY, no callbackDue', r8.reason === 'NOT_A_JOB_ENQUIRY:supplier' && !r8.callbackDue);
    }

    // ---------- 3. pickVideoTemplate: consent → template name ----------
    console.log('\n3. pickVideoTemplate mapping');
    {
        const agreed = pickVideoTemplate(verdict({ whatsappAgreed: 'agreed', jobSummary: 'Rehang two internal doors' }));
        check(`agreed → ${AGREED_VIDEO_TEMPLATE} with the job as {{2}}`,
            agreed.name === AGREED_VIDEO_TEMPLATE && agreed.variables['2'] === 'Rehang two internal doors');
        const longJob = pickVideoTemplate(verdict({ whatsappAgreed: 'agreed', jobSummary: 'y'.repeat(200) }));
        check('agreed with oversize summary → {{2}} truncated to prose length',
            longJob.variables['2'].length <= 120 && longJob.variables['2'].endsWith('…'));
        const emptyJob = pickVideoTemplate(verdict({ whatsappAgreed: 'agreed', jobSummary: '' }));
        check('agreed with empty summary → {{2}} falls back to "the job we discussed"',
            emptyJob.variables['2'] === 'the job we discussed');
        const notDiscussed = pickVideoTemplate(verdict({ whatsappAgreed: 'not_discussed' }));
        check(`not_discussed → ${GENERIC_VIDEO_TEMPLATE}, no as-discussed claim`,
            notDiscussed.name === GENERIC_VIDEO_TEMPLATE && Object.keys(notDiscussed.variables).length === 0);
        const declined = pickVideoTemplate(verdict({ whatsappAgreed: 'declined' }));
        check('declined → generic (never reached by the send path, but never lies)', declined.name === GENERIC_VIDEO_TEMPLATE);
        const unclassified = pickVideoTemplate(null);
        check('null classification → generic', unclassified.name === GENERIC_VIDEO_TEMPLATE);
    }

    // ---------- 4. callbackFallbackEligible: when the sweep may text instead ----------
    console.log('\n4. callbackFallbackEligible');
    {
        const cfg = { enabled: true, callbackFallbackMinutes: 120 };
        const overdue = new Date(Date.now() - 3 * 3600_000).toISOString();  // 3h ago
        const fresh = new Date(Date.now() - 30 * 60_000).toISOString();     // 30min ago
        const base = { tags: ['callback_due'], callbackDueAt: overdue, cfg, ukHour: 12 };

        check('overdue tagged thread, daytime, enabled → eligible', callbackFallbackEligible(base) === true);
        check('feature flag off → not eligible', callbackFallbackEligible({ ...base, cfg: { ...cfg, enabled: false } }) === false);
        check('fallback minutes 0 → disabled', callbackFallbackEligible({ ...base, cfg: { ...cfg, callbackFallbackMinutes: 0 } }) === false);
        check('7am UK → too early', callbackFallbackEligible({ ...base, ukHour: 7 }) === false);
        check('8am UK → allowed', callbackFallbackEligible({ ...base, ukHour: 8 }) === true);
        check('7pm UK → allowed', callbackFallbackEligible({ ...base, ukHour: 19 }) === true);
        check('8pm UK → too late', callbackFallbackEligible({ ...base, ukHour: 20 }) === false);
        check('no callback_due tag → not eligible', callbackFallbackEligible({ ...base, tags: ['needs_ben'] }) === false);
        check('null tags → not eligible', callbackFallbackEligible({ ...base, tags: null }) === false);
        check('no_auto_messages present → never', callbackFallbackEligible({ ...base, tags: ['callback_due', 'no_auto_messages'] }) === false);
        check('not yet overdue → not eligible', callbackFallbackEligible({ ...base, callbackDueAt: fresh }) === false);
        check('missing callbackDueAt → fail closed', callbackFallbackEligible({ ...base, callbackDueAt: null }) === false);
        check('garbage callbackDueAt → fail closed', callbackFallbackEligible({ ...base, callbackDueAt: 'soon' }) === false);
    }

    // ---------- 5. callback_due tag-clear round trip (DB, smoke conversation) ----------
    console.log('\n5. Tag-clear round trip on the Ofcom smoke conversation');
    await tagClearRoundTrip();

    // ---------- 6. One live classification (synthetic transcript, model call) ----------
    console.log('\n6. Live classification (one haiku call, synthetic transcript)');
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

/**
 * One outbound call ingested against the Ofcom smoke conversation clears the callback_due tag
 * and its clock, and touches nothing else. All state (tags, metadata, preview clocks) is
 * captured first and restored in the finally, and the synthetic message row is deleted — the
 * smoke thread leaves this test exactly as it entered it.
 */
async function tagClearRoundTrip(): Promise<void> {
    const SMOKE_KEY = '447700900999@c.us';
    const { db } = await import('../server/db');
    const { conversations, messages } = await import('../shared/schema');
    const { eq, sql } = await import('drizzle-orm');
    const { ingestCallRow, callMessageId } = await import('../server/call-thread');

    let [conv] = await db.select().from(conversations).where(eq(conversations.phoneNumber, SMOKE_KEY));
    let createdConv = false;
    if (!conv) {
        await db.insert(conversations).values({
            id: `test_cbclear_conv_${Date.now()}`,
            phoneNumber: SMOKE_KEY,
            contactName: 'Ofcom Smoke',
            status: 'active',
            stage: 'scoping',
        });
        [conv] = await db.select().from(conversations).where(eq(conversations.phoneNumber, SMOKE_KEY));
        createdConv = true;
    }
    if (!conv) { check('smoke conversation available', false, 'could not read or create it'); return; }

    const original = {
        tags: conv.tags,
        metadata: conv.metadata,
        lastMessageAt: conv.lastMessageAt,
        lastMessagePreview: conv.lastMessagePreview,
        priority: conv.priority,
    };
    const testCallId = `test_cbclear_${Date.now()}`;

    try {
        // Arm: the tag, its clock, and a bystander tag that must survive the clear.
        await db.update(conversations).set({
            tags: ['callback_due', 'smoke_bystander'],
            metadata: sql`coalesce(${conversations.metadata}, '{}'::jsonb) || jsonb_build_object('callbackDueAt', ${new Date().toISOString()}::text)`,
        }).where(eq(conversations.id, conv.id));

        // The callback: an answered outbound call to the tagged number. Synthetic row, real ingest.
        const res = await ingestCallRow({
            id: testCallId,
            callId: `CA_test_cbclear_${Date.now()}`,
            phoneNumber: '+447700900999',
            direction: 'outbound-dial',
            status: 'completed',
            outcome: null,
            handledBy: null,
            duration: 45,
            ringSeconds: null,
            jobSummary: null,
            customerName: null,
            startTime: new Date(),
            endTime: new Date(),
            classification: null,
        } as any, { markUnread: false, advanceStage: false });
        check('outbound smoke call ingested onto the thread', res.status === 'written' || res.status === 'updated', JSON.stringify(res));

        const [after] = await db.select().from(conversations).where(eq(conversations.id, conv.id));
        const tags = after?.tags ?? [];
        check('callback_due cleared by the outbound call', !tags.includes('callback_due'), JSON.stringify(tags));
        check('other tags untouched', tags.includes('smoke_bystander'), JSON.stringify(tags));
        check('metadata.callbackDueAt deleted', (after?.metadata as any)?.callbackDueAt === undefined,
            JSON.stringify(after?.metadata));
    } finally {
        try {
            await db.delete(messages).where(eq(messages.id, callMessageId(testCallId)));
            if (createdConv) {
                await db.delete(conversations).where(eq(conversations.id, conv.id));
            } else {
                await db.update(conversations).set({
                    tags: original.tags,
                    metadata: original.metadata,
                    lastMessageAt: original.lastMessageAt,
                    lastMessagePreview: original.lastMessagePreview,
                    priority: original.priority,
                    updatedAt: new Date(),
                }).where(eq(conversations.id, conv.id));
            }
        } catch (e) {
            console.error('  ! restore failed — the smoke conversation may need manual cleanup:', e);
        }
    }
}

main().catch((e) => { console.error(e); process.exit(1); });
