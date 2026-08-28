/**
 * Send-path guard tests — 27 Aug 2026 triple-send incident (Agent A).
 *
 * Exercises, against the real DB with Ofcom test-range fixtures (+447700900xxx):
 *   1. isMalformedAgentReason / isNearDuplicateText unit behaviour
 *   2. Near-duplicate outbound guard in approveAndSendDraft:
 *      - exact repeat blocked for an automated approver, draft reverted to pending + marker
 *      - marker appended ONCE even when the guard trips twice
 *      - burst part ('---') repeat blocked
 *      - >=0.9 token-overlap variant blocked
 *      - outbound older than the 10-min window does NOT block
 *      - human approver passes the guard (proved by reaching OUTSIDE_WINDOW, not NEAR_DUPLICATE)
 *   3. Malformed-reason guard: '[unlabelled] undefined', '[answer_question] placeholder' and
 *      empty reasons blocked for automated approvers; human passes through
 *   4. Clean draft passes both guards (SMS channel; ok or SEND_FAILED acceptable — the assertion
 *      is that neither guard code fired)
 *   5. claimTriageTurn atomicity: 5 concurrent claims -> exactly one winner; re-claim refused
 *      while held; releaseTriageTurn with the wrong token is a no-op; with the right token the
 *      turn is reclaimable.
 *
 * Cleans up every fixture it creates. Run: npx tsx scripts/_test-send-path-guards.ts
 */
import { db } from '../server/db';
import { conversations, messages, messageDrafts } from '@shared/schema';
import { eq, inArray, sql } from 'drizzle-orm';
import {
    approveAndSendDraft,
    isMalformedAgentReason,
    isNearDuplicateText,
    NEAR_DUPLICATE_HOLD_MARKER,
    MALFORMED_REASON_HOLD_MARKER,
} from '../server/message-drafts';
import { claimTriageTurn, releaseTriageTurn } from '../server/agents/comms-sweep';

const TS = Date.now();
const PHONE_E164 = '+447700900950';                 // Ofcom test range — house convention
const PHONE_WA = '447700900950@c.us';
const CONV_ID = `test_conv_guards_${TS}`;
const draftIds: string[] = [];
const msgIds: string[] = [];

let pass = 0, fail = 0;
function check(cond: boolean, label: string) {
    if (cond) { pass++; console.log(`  PASS  ${label}`); }
    else { fail++; console.error(`  FAIL  ${label}`); }
}

async function mkDraft(n: string, body: string, reason: string | null, channel = 'whatsapp') {
    const id = `test_draft_guards_${n}_${TS}`;
    draftIds.push(id);
    await db.insert(messageDrafts).values({
        id, conversationId: CONV_ID, phone: PHONE_E164, body, channel,
        source: 'comms_agent', reason, status: 'pending',
    });
    return id;
}

async function getDraft(id: string) {
    const [d] = await db.select().from(messageDrafts).where(eq(messageDrafts.id, id));
    return d;
}

async function mkOutbound(n: string, content: string, agoMs: number) {
    const id = `test_msg_guards_${n}_${TS}`;
    msgIds.push(id);
    await db.insert(messages).values({
        id, conversationId: CONV_ID, direction: 'outbound', content,
        channel: 'whatsapp', status: 'sent', createdAt: new Date(Date.now() - agoMs),
    } as any);
}

async function main() {
    // ---------------------------------------------------------------- fixtures
    await db.delete(conversations).where(eq(conversations.phoneNumber, PHONE_WA)); // unique phone
    await db.insert(conversations).values({
        id: CONV_ID, phoneNumber: PHONE_WA, contactName: 'Guard Test', metadata: {},
    } as any);
    // The sentence the customer actually received twice on 27 Aug.
    await mkOutbound('recent', 'Hiya James, sorry for the wait on this one.', 2 * 60_000);
    await mkOutbound('old', 'Completely unrelated update about the scaffolding survey from earlier.', 30 * 60_000);

    // ---------------------------------------------------------------- 1. unit checks
    console.log('\n[1] Unit checks');
    check(isMalformedAgentReason('[unlabelled] undefined'), 'reason "[unlabelled] undefined" is malformed');
    check(isMalformedAgentReason('[answer_question] placeholder'), 'reason "[answer_question] placeholder" is malformed');
    check(isMalformedAgentReason(''), 'empty reason is malformed');
    check(isMalformedAgentReason(null), 'null reason is malformed');
    check(isMalformedAgentReason('[answer_question]'), 'tag with nothing after it is malformed');
    check(!isMalformedAgentReason('[answer_question] Customer asked how long pricing takes.'), 'real reason is NOT malformed');
    check(isNearDuplicateText('Hiya James, sorry for the wait on this one.', 'hiya james sorry for the wait on this one'), 'exact-after-normalize matches');
    check(isNearDuplicateText('Hiya James, sorry for the big wait on this one.', 'Hiya James, sorry for the wait on this one.'), '0.9 token overlap matches');
    check(!isNearDuplicateText('Hiya James, thanks for your patience on this one.', 'Quote is ready, link below.'), 'distinct texts do not match');

    // ---------------------------------------------------------------- 2. near-duplicate guard
    console.log('\n[2] Near-duplicate guard (automated approver)');
    const dupId = await mkDraft('dup_exact', 'Hiya James, sorry for the wait on this one.', '[answer_question] Customer asked about timing.');
    const r1 = await approveAndSendDraft(dupId, 'comms_agent:autosend');
    check(!r1.ok && r1.code === 'NEAR_DUPLICATE', `exact repeat blocked for autosend (got ${r1.ok ? 'ok' : r1.code})`);
    let d = await getDraft(dupId);
    check(d.status === 'pending' && d.approvedBy === null && d.approvedAt === null, 'blocked draft reverted to pending, approval cleared');
    check((d.reason ?? '').includes(NEAR_DUPLICATE_HOLD_MARKER), 'hold marker appended to reason');
    const reasonAfterFirst = d.reason;
    const r2 = await approveAndSendDraft(dupId, 'comms_agent:autosend');
    check(!r2.ok && r2.code === 'NEAR_DUPLICATE', 'second autosend attempt blocked again');
    d = await getDraft(dupId);
    check(d.reason === reasonAfterFirst, 'marker appended only once — reason did not grow on the second trip');

    const burstId = await mkDraft('dup_burst', 'Totally new first bubble about booking the visit.\n---\nHiya James, sorry for the wait on this one.', '[answer_question] Follow-up with details.');
    const r3 = await approveAndSendDraft(burstId, 'comms_agent:autosend');
    check(!r3.ok && r3.code === 'NEAR_DUPLICATE', `burst part repeat blocked (got ${r3.ok ? 'ok' : r3.code})`);

    const nearId = await mkDraft('dup_overlap', 'Hiya James, sorry for the big wait on this one.', '[answer_question] Re-worded apology.');
    const r4 = await approveAndSendDraft(nearId, 'comms_agent:autosend');
    check(!r4.ok && r4.code === 'NEAR_DUPLICATE', `0.9-overlap variant blocked (got ${r4.ok ? 'ok' : r4.code})`);

    console.log('\n[3] Near-duplicate guard: window edge + human override');
    // Repeats an outbound from 30 min ago — outside the 10-min window, so the guard must NOT
    // fire. WhatsApp draft + no open window => OUTSIDE_WINDOW is the "passed the guards" sentinel
    // (no real send attempted).
    const oldId = await mkDraft('dup_old', 'Completely unrelated update about the scaffolding survey from earlier.', '[follow_up] Chasing the survey.');
    const r5 = await approveAndSendDraft(oldId, 'comms_agent:autosend');
    check(!r5.ok && r5.code === 'OUTSIDE_WINDOW', `>10-min-old outbound does not block (got ${r5.ok ? 'ok' : r5.code})`);

    const r6 = await approveAndSendDraft(dupId, 'ben@handyservices.app');
    check(!r6.ok && r6.code === 'OUTSIDE_WINDOW', `human approver passes the near-dup guard (got ${r6.ok ? 'ok' : r6.code})`);

    // ---------------------------------------------------------------- 3. malformed-reason guard
    console.log('\n[4] Malformed-reason guard');
    const mal1 = await mkDraft('mal_unlabelled', 'Hiya James, thanks for your patience on this one.', '[unlabelled] undefined');
    const m1 = await approveAndSendDraft(mal1, 'comms_agent:autosend');
    check(!m1.ok && m1.code === 'MALFORMED_REASON', `"[unlabelled] undefined" blocked for autosend (got ${m1.ok ? 'ok' : m1.code})`);
    const md = await getDraft(mal1);
    check(md.status === 'pending' && (md.reason ?? '').includes(MALFORMED_REASON_HOLD_MARKER), 'malformed draft held pending with marker');

    const mal2 = await mkDraft('mal_placeholder', 'We will have your price over shortly.', '[answer_question] placeholder');
    const m2 = await approveAndSendDraft(mal2, 'hours_gate:morning_release');
    check(!m2.ok && m2.code === 'MALFORMED_REASON', `"placeholder" blocked for hours_gate approver (got ${m2.ok ? 'ok' : m2.code})`);

    const mal3 = await mkDraft('mal_empty', 'Just checking in on the quote.', '');
    const m3 = await approveAndSendDraft(mal3, 'first_contact_ack:held_release');
    check(!m3.ok && m3.code === 'MALFORMED_REASON', `empty reason blocked for first_contact_ack approver (got ${m3.ok ? 'ok' : m3.code})`);

    const m4 = await approveAndSendDraft(mal1, 'ben@handyservices.app');
    check(!m4.ok && m4.code === 'OUTSIDE_WINDOW', `human approver passes the malformed-reason guard (got ${m4.ok ? 'ok' : m4.code})`);

    // ---------------------------------------------------------------- 4. clean draft
    console.log('\n[5] Clean draft passes both guards');
    // SMS channel exercises the full send path. ok:true or SEND_FAILED are both acceptable here
    // (no Twilio creds / dead test range) — what must NOT happen is either guard code.
    const cleanId = await mkDraft('clean', 'Your quote is being priced now — link to follow this afternoon.', '[answer_question] Customer asked when the price lands.', 'sms');
    const c1 = await approveAndSendDraft(cleanId, 'comms_agent:autosend');
    check(c1.ok || (c1.code !== 'NEAR_DUPLICATE' && c1.code !== 'MALFORMED_REASON'),
        `clean draft not caught by guards (got ${c1.ok ? 'ok' : c1.code})`);

    // ---------------------------------------------------------------- 5. claimTriageTurn
    console.log('\n[6] claimTriageTurn atomicity');
    const winners = await Promise.all([1, 2, 3, 4, 5].map(() => claimTriageTurn(CONV_ID)));
    const won = winners.filter((w): w is string => w !== null);
    check(won.length === 1, `exactly one of 5 concurrent claims wins (got ${won.length})`);
    const again = await claimTriageTurn(CONV_ID);
    check(again === null, 'a later claim is refused while the hold stands');
    await releaseTriageTurn(CONV_ID, 'not-the-token');
    check((await claimTriageTurn(CONV_ID)) === null, 'release with the wrong token does not clobber the hold');
    await releaseTriageTurn(CONV_ID, won[0]);
    const reclaimed = await claimTriageTurn(CONV_ID);
    check(reclaimed !== null, 'release with the winning token frees the turn for a new claim');
    if (reclaimed) await releaseTriageTurn(CONV_ID, reclaimed);

    console.log(`\nDone: ${pass} passed, ${fail} failed.`);
    return fail === 0;
}

async function cleanup() {
    try {
        if (draftIds.length) await db.delete(messageDrafts).where(inArray(messageDrafts.id, draftIds));
        await db.delete(messages).where(eq(messages.conversationId, CONV_ID));
        await db.delete(conversations).where(eq(conversations.id, CONV_ID));
        await db.execute(sql`DELETE FROM system_events WHERE phone LIKE '%7700900950%'`);
    } catch (e: any) {
        console.error('Cleanup failed:', e?.message);
    }
}

main()
    .then(async (ok) => { await cleanup(); process.exit(ok ? 0 : 1); })
    .catch(async (e) => { console.error(e); await cleanup(); process.exit(1); });
