/**
 * Proof that the outcome loop actually closes.
 *
 *   npx tsx scripts/_outcome-loop-test.ts            full run (includes two real Twilio sends)
 *   npx tsx scripts/_outcome-loop-test.ts --no-send  skip anything that touches Twilio
 *
 * SAFETY: every phone number here is inside the Ofcom drama range (+447700900xxx), which is
 * permanently unallocated. No real customer can be reached by this script, and it never touches a
 * row it did not create — cleanup deletes tracked ids only, never "everything matching a pattern",
 * so an earlier session's test rows and any real data are left alone.
 *
 * The two sends are deliberate. The claim being tested is "the hook inside approveAndSendDraft
 * fires on the real approval path", and calling the ledger function directly would prove only that
 * the function works. The sends go to unallocated numbers and are expected to fail; the assertion
 * is about the ledger row, not the delivery.
 *
 * The routes are exercised through a real Express app on an ephemeral port — mounted WITHOUT
 * requireAdmin, since the thing under test is the handler, not the auth wrapper it is mounted
 * behind in server/index.ts.
 */
import 'dotenv/config';
import express from 'express';
import type { Server } from 'http';
import { db } from '../server/db';
import { sql } from 'drizzle-orm';
import { queueDraft, approveAndSendDraft, messageDraftsRouter } from '../server/message-drafts';
import { askBen, agentQuestionsRouter } from '../server/agent-questions';
import { agentStaffRouter } from '../server/agent-staff';
import {
    refreshOutcomes, reconcileOutcomes, exportApprovedExamples,
    setOutcomeLoopConfig, getOutcomeLoopConfig, editDistance,
} from '../server/agent-outcomes';

const NO_SEND = process.argv.includes('--no-send');

// Ofcom drama range only. 900999 is left alone — a previous session's test lives on it.
const P = {
    unedited: '+447700900901',
    edited: '+447700900902',
    rejected: '+447700900903',
    replied: '+447700900904',
    converted: '+447700900905',
    question: '+447700900906',
};

const created = { drafts: [] as string[], questions: [] as string[], outcomes: [] as string[], conversations: [] as string[], messages: [] as string[], quotes: [] as string[] };

let passed = 0, failed = 0;
function check(name: string, ok: boolean, detail = '') {
    if (ok) { passed++; console.log(`  ✓ ${name}${detail ? ` — ${detail}` : ''}`); }
    else { failed++; console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`); }
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Ledger writes are fire-and-forget by design — that is the whole point, a send must never wait on
 * bookkeeping — so every read here polls for the expected state instead of sleeping a guessed
 * interval. A fixed sleep passes on a fast day and fails on a slow one, which is worse than no test.
 */
async function settle(kind: string, refId: string, done: (row: any) => boolean, timeoutMs = 12_000): Promise<any> {
    const deadline = Date.now() + timeoutMs;
    let row: any = null;
    while (Date.now() < deadline) {
        const r: any = await db.execute(sql`SELECT * FROM agent_outcomes WHERE kind = ${kind} AND ref_id = ${refId} LIMIT 1`);
        row = (r.rows ?? r)[0] ?? null;
        if (row && done(row)) return row;
        await sleep(250);
    }
    return row;
}

/** Ledger writes are fire-and-forget by design, so reads poll rather than assume. */
async function ledgerRow(kind: string, refId: string, tries = 20): Promise<any | null> {
    for (let i = 0; i < tries; i++) {
        const r: any = await db.execute(sql`SELECT * FROM agent_outcomes WHERE kind = ${kind} AND ref_id = ${refId} LIMIT 1`);
        const row = (r.rows ?? r)[0];
        if (row) { created.outcomes.push(row.id); return row; }
        await sleep(250);
    }
    return null;
}

async function main() {
    console.log(`\nOUTCOME LOOP TEST${NO_SEND ? ' (--no-send)' : ''}\n${'='.repeat(60)}`);

    // The exporter flag must start OFF or test 8 proves nothing.
    const configBefore = await getOutcomeLoopConfig();
    await setOutcomeLoopConfig({ fewShot: { enabled: false, limit: 6, maxAgeDays: 90 } });

    const app = express();
    app.use(express.json());
    app.use('/api/drafts', messageDraftsRouter);
    app.use('/api/agent-questions', agentQuestionsRouter);
    app.use('/api/agents', agentStaffRouter);
    const server: Server = await new Promise((resolve) => {
        const s = app.listen(0, () => resolve(s));
    });
    const base = `http://127.0.0.1:${(server.address() as any).port}`;

    try {
        // ---------------------------------------------------------------- 1. capture
        console.log('\n1. A queued draft appears in the ledger');
        const bodyA = 'Thanks for the photos, that gives me what I need.\n---\nI will get your quote over shortly.';
        const draftA = await queueDraft({ phone: P.unedited, body: bodyA, source: 'comms_agent', reason: '[ack_photos] Customer sent photos of the tap', channel: 'sms' });
        check('queueDraft returned an id', !!draftA, draftA ?? 'null');
        if (draftA) created.drafts.push(draftA);
        const rowA = draftA ? await ledgerRow('draft', draftA) : null;
        check('ledger row exists', !!rowA);
        check('proposed body frozen verbatim', rowA?.proposed_body === bodyA);
        check('verdict starts pending', rowA?.verdict === 'pending', rowA?.verdict);
        check('agent derived from source', rowA?.agent === 'comms', rowA?.agent);
        check('capability parsed from the intent prefix', rowA?.capability === 'ack_photos', rowA?.capability);
        check('phone key stored for joining', rowA?.phone_key === '7700900901', rowA?.phone_key);

        // ---------------------------------------------------------------- 2. approved unedited
        console.log('\n2. Approving it UNEDITED records exactly that');
        if (NO_SEND) {
            console.log('  (skipped: --no-send)');
        } else {
            const result = await approveAndSendDraft(draftA!, 'test@handyservices.com');
            console.log(`  approveAndSendDraft → ${result.ok ? 'sent' : `${(result as any).code}`} (delivery to an unallocated number is expected to fail)`);
            const after = await settle('draft', draftA!, (r) => r.verdict !== 'pending');
            check('verdict is approved_unedited', after?.verdict === 'approved_unedited', after?.verdict);
            check('edit distance is 0', Number(after?.edit_distance) === 0, String(after?.edit_distance));
            check('final_body not duplicated when nothing changed', after?.final_body === null);
            check('delivery recorded separately from the verdict', ['sent', 'failed'].includes(after?.send_status), after?.send_status);
            check('time to action captured', after?.time_to_action_seconds !== null, `${after?.time_to_action_seconds}s`);
            check('approver recorded', after?.decided_by === 'test@handyservices.com', after?.decided_by);
        }

        // ---------------------------------------------------------------- 3. approved with edits
        console.log('\n3. Approving it WITH EDITS records the diff and the final text');
        const bodyB = 'Hiya, thanks for that. We can sort the tap for you this week.';
        const editedB = 'Hi, thanks for that. We can sort the tap for you next week. Thanks, Ben';
        const draftB = await queueDraft({ phone: P.edited, body: bodyB, source: 'comms_agent', reason: '[scheduling] Customer asked when we can come', channel: 'sms' });
        if (draftB) created.drafts.push(draftB);
        await ledgerRow('draft', draftB!);
        // Exactly what PATCH /api/drafts/:id does — Ben rewrites the body in place before approving.
        const patchRes = await fetch(`${base}/api/drafts/${draftB}`, {
            method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ body: editedB }),
        });
        check('PATCH route accepted the edit', patchRes.ok, String(patchRes.status));

        if (NO_SEND) {
            console.log('  (approval skipped: --no-send)');
        } else {
            await approveAndSendDraft(draftB!, 'test@handyservices.com');
            const afterB = await settle('draft', draftB!, (r) => r.verdict !== 'pending');
            const expected = editDistance(bodyB, editedB);
            check('verdict is approved_edited', afterB?.verdict === 'approved_edited', afterB?.verdict);
            check('the agent original is still intact', afterB?.proposed_body === bodyB);
            check('the final text is stored', afterB?.final_body === editedB);
            check('edit distance matches Levenshtein', Number(afterB?.edit_distance) === expected, `${afterB?.edit_distance} vs ${expected}`);
            check('edit ratio is a sane fraction', Number(afterB?.edit_ratio) > 0 && Number(afterB?.edit_ratio) < 1, String(afterB?.edit_ratio));
        }

        // ---------------------------------------------------------------- 4. rejection
        console.log('\n4. A rejection is recorded, through the real route');
        const bodyC = 'Just checking in on that quote, any thoughts?';
        const draftC = await queueDraft({ phone: P.rejected, body: bodyC, source: 'comms_agent', reason: '[quote_followup] Quote viewed twice, no deposit', channel: 'sms' });
        if (draftC) created.drafts.push(draftC);
        await ledgerRow('draft', draftC!);
        const rejRes = await fetch(`${base}/api/drafts/${draftC}/reject`, { method: 'POST' });
        check('reject route returned 200', rejRes.ok, String(rejRes.status));
        const afterC = await settle('draft', draftC!, (r) => r.verdict !== 'pending');
        check('verdict is rejected', afterC?.verdict === 'rejected', afterC?.verdict);
        check('rejection is attributed to a human', !!afterC?.decided_by, afterC?.decided_by);
        check('nothing was sent', afterC?.send_status === null);

        // ---------------------------------------------------------------- 5. ask-Ben
        console.log('\n5. An ask-Ben question is captured and its answer recorded');
        const convQ = `oltest_conv_q_${Date.now()}`;
        await db.execute(sql`INSERT INTO conversations (id, phone_number, status) VALUES (${convQ}, ${'447700900906@c.us'}, 'active')`);
        created.conversations.push(convQ);
        const qId = await askBen({
            conversationId: convQ, phone: P.question,
            question: 'Can we do Saturday for this one?',
            context: 'Customer asked for the weekend', options: ['Yes, Saturday is fine', 'No, weekdays only'],
        });
        if (qId) created.questions.push(qId);
        const rowQ = qId ? await ledgerRow('question', qId) : null;
        check('question captured as a proposal', !!rowQ && rowQ.capability === 'ask_ben', rowQ?.capability);
        const ansRes = await fetch(`${base}/api/agent-questions/${qId}/answer`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ answer: 'Yes, Saturday is fine' }),
        });
        check('answer route returned 200', ansRes.ok, String(ansRes.status));
        const afterQ = await settle('question', qId!, (r) => r.verdict !== 'pending');
        check('verdict is answered', afterQ?.verdict === 'answered', afterQ?.verdict);
        check('the answer is stored', afterQ?.final_body === 'Yes, Saturday is fine');
        check('recorded that Ben tapped an offered option', afterQ?.meta?.tappedOption === true, JSON.stringify(afterQ?.meta));

        // ---------------------------------------------------------------- 6. reply attribution
        console.log('\n6. A customer reply after a send is attributed to the draft');
        const convR = `oltest_conv_r_${Date.now()}`;
        await db.execute(sql`INSERT INTO conversations (id, phone_number, status) VALUES (${convR}, ${'447700900904@c.us'}, 'active')`);
        created.conversations.push(convR);
        const draftD = await queueDraft({ phone: P.replied, body: 'Sorry we missed your call, still after a quote?', source: 'comms_agent', reason: '[ack_missed_call] Missed call recovery', channel: 'sms' });
        if (draftD) created.drafts.push(draftD);
        await ledgerRow('draft', draftD!);
        // Stand in for a successful delivery 10 minutes ago, exactly as the send hook would record it.
        await db.execute(sql`
            UPDATE agent_outcomes SET verdict='approved_unedited', decided_by='test@handyservices.com',
                decided_at = now() - interval '10 minutes', edit_distance = 0, edit_ratio = 0,
                send_status='sent', sent_at = now() - interval '10 minutes', time_to_action_seconds = 30
            WHERE kind='draft' AND ref_id=${draftD}`);
        const msgId = `oltest_msg_${Date.now()}`;
        await db.execute(sql`
            INSERT INTO messages (id, conversation_id, direction, content, channel, created_at)
            VALUES (${msgId}, ${convR}, 'inbound', 'Yes please, still interested', 'sms', now() - interval '5 minutes')`);
        created.messages.push(msgId);
        await refreshOutcomes({ limit: 200 });
        const afterD = await settle('draft', draftD!, (r) => !!r.customer_replied_at);
        check('reply detected', !!afterD?.customer_replied_at, String(afterD?.customer_replied_at));
        const lat = Number(afterD?.reply_latency_seconds);
        check('reply latency is ~5 minutes', lat > 240 && lat < 360, `${lat}s`);

        // ---------------------------------------------------------------- 7. conversion attribution
        console.log('\n7. A deposit after a send is attributed where one exists');
        const draftE = await queueDraft({ phone: P.converted, body: 'Quote is ready: https://handyservices.app/quote/oltest01', source: 'comms_agent', reason: '[quote_followup] Quote ready to send', channel: 'sms' });
        if (draftE) created.drafts.push(draftE);
        await ledgerRow('draft', draftE!);
        await db.execute(sql`
            UPDATE agent_outcomes SET verdict='approved_unedited', decided_by='test@handyservices.com',
                decided_at = now() - interval '2 hours', edit_distance = 0, edit_ratio = 0,
                send_status='sent', sent_at = now() - interval '2 hours', time_to_action_seconds = 45
            WHERE kind='draft' AND ref_id=${draftE}`);
        const quoteId = `oltest_quote_${Date.now()}`;
        await db.execute(sql`
            INSERT INTO personalized_quotes (id, short_slug, customer_name, phone, job_description, base_price, deposit_paid_at, created_at)
            VALUES (${quoteId}, ${'oltest01'}, 'Test Customer', ${P.converted}, 'Test job for the outcome loop',
                    19800, now() - interval '30 minutes', now() - interval '3 hours')`);
        created.quotes.push(quoteId);
        await refreshOutcomes({ limit: 200 });
        const afterE = await settle('draft', draftE!, (r) => !!r.converted_quote_id);
        check('deposit attributed to the thread', afterE?.converted_quote_id === quoteId, String(afterE?.converted_quote_id));
        check('conversion value carried through', Number(afterE?.conversion_value_pence) === 19800, String(afterE?.conversion_value_pence));
        check('a draft with no deposit is NOT attributed one', afterD?.converted_quote_id === null || afterD?.converted_quote_id === undefined);

        // ---------------------------------------------------------------- 8. admin API
        console.log('\n8. The admin API returns sane aggregates');
        const metricsRes = await fetch(`${base}/api/agents/outcomes?days=3650`);
        const metrics: any = await metricsRes.json();
        check('GET /outcomes returned 200', metricsRes.ok, String(metricsRes.status));
        const comms = (metrics.byAgent ?? []).find((a: any) => a.agent === 'comms');
        check('comms agent present in byAgent', !!comms);
        check('proposals >= humanDecided', comms && comms.proposals >= comms.humanDecided, `${comms?.proposals} >= ${comms?.humanDecided}`);
        check('uneditedRate is a fraction or null',
            comms && (comms.uneditedRate === null || (comms.uneditedRate >= 0 && comms.uneditedRate <= 1)), String(comms?.uneditedRate));
        check('unedited + edited + rejected === humanDecided',
            comms && comms.approvedUnedited + comms.approvedEdited + comms.rejected === comms.humanDecided);
        // Same scrub the endpoint applies, or this compares a filtered number with an unfiltered one.
        const autoCount = Number(((await db.execute(sql`
            SELECT count(*)::int n FROM agent_outcomes
            WHERE agent='comms' AND verdict='auto_sent' AND COALESCE(phone_key,'') NOT LIKE '7700900%'`) as any).rows[0]).n);
        check('auto-sent drafts are counted but kept OUT of the human denominator',
            comms && comms.autoSent === autoCount && comms.humanDecided === comms.approvedUnedited + comms.approvedEdited + comms.rejected,
            `${autoCount} auto-sent, ${comms?.humanDecided} human-judged`);
        check('byCapability breaks the agent down by intent',
            (metrics.byCapability ?? []).length > 0 && (metrics.byCapability ?? []).every((c: any) => !!c.capability));
        check('feedback config is reported and OFF', metrics.loopConfig?.fewShot?.enabled === false);

        // The scrub is load-bearing: every agent test in this repo fires at the Ofcom range, and
        // tests always "approve unedited", so unfiltered test traffic would quietly inflate the one
        // number that decides whether a capability graduates.
        const withTest: any = await (await fetch(`${base}/api/agents/outcomes?days=3650&includeTest=1`)).json();
        const commsWithTest = (withTest.byAgent ?? []).find((a: any) => a.agent === 'comms');
        check('test-range traffic is excluded from the default aggregates',
            commsWithTest && commsWithTest.proposals > comms.proposals,
            `${comms?.proposals} scrubbed vs ${commsWithTest?.proposals} raw`);

        const decRes = await fetch(`${base}/api/agents/outcomes/decisions?limit=50&includeTest=1`);
        const dec: any = await decRes.json();
        check('GET /outcomes/decisions returned 200', decRes.ok, String(decRes.status));
        const cleanDec: any = await (await fetch(`${base}/api/agents/outcomes/decisions?limit=50`)).json();
        check('the decisions feed hides test traffic unless asked',
            !(cleanDec.decisions ?? []).some((d: any) => String(d.phone ?? '').startsWith('+4477009')));
        const rejectedRow = (dec.decisions ?? []).find((d: any) => d.ref_id === draftC);
        check('the rejected draft is readable in the decisions feed', !!rejectedRow, rejectedRow?.verdict);
        if (!NO_SEND) {
            const editedRow = (dec.decisions ?? []).find((d: any) => d.ref_id === draftB);
            check('the decisions feed carries proposal AND final text side by side',
                !!editedRow && editedRow.proposed_body === bodyB && editedRow.final_body === editedB);
        }

        const staffRes = await fetch(`${base}/api/agents/staff`);
        const staff: any = await staffRes.json();
        const commsCard = (staff.staff ?? []).find((s: any) => s.id === 'comms');
        check('the staff dossier leads with the unedited-approval rate',
            !!commsCard?.stats?.[0]?.label?.startsWith('Approved unedited'), commsCard?.stats?.[0]?.label);

        // ---------------------------------------------------------------- 9. few-shot exporter
        console.log('\n9. The few-shot exporter is gated, filtered and capped');
        const offExamples = await exportApprovedExamples({ agent: 'comms' });
        check('returns nothing while the flag is OFF', offExamples.length === 0, `${offExamples.length} examples`);

        const cfgRes = await fetch(`${base}/api/agents/outcomes/config`, {
            method: 'PATCH', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ fewShot: { enabled: true, limit: 2 } }),
        });
        check('config route enabled it', cfgRes.ok, String(cfgRes.status));
        // includeTest is a test-only door. The default path scrubs the Ofcom range, so this suite's
        // own rows are used to prove the filtering and the cap, and then proved to be invisible to
        // the real exporter the agents would call.
        const onExamples = await exportApprovedExamples({ agent: 'comms', includeTest: true });
        check('returns examples once enabled', onExamples.length > 0, `${onExamples.length} examples`);
        check('respects the cap', onExamples.length <= 2, `${onExamples.length} <= 2`);
        check('never exports an edited draft', !onExamples.some((e) => e.body === bodyB || e.body === editedB));
        check('never exports a rejected draft', !onExamples.some((e) => e.body === bodyC));
        const liveExamples = await exportApprovedExamples({ agent: 'comms' });
        check('test sends never reach the agents as examples',
            !liveExamples.some((e) => e.body === bodyA || e.body === editedB),
            `${liveExamples.length} live examples`);
        // Checked as "every example traces back to a live approved-unedited row", not "no other row
        // shares this text" — the same stock acknowledgement legitimately appears many times in the
        // ledger with different fates, and the exporter filters on the row, not the wording.
        let tracedToUnedited = 0;
        for (const e of onExamples) {
            const r: any = await db.execute(sql`
                SELECT count(*)::int n FROM agent_outcomes
                WHERE proposed_body = ${e.body} AND verdict = 'approved_unedited' AND backfilled = false`);
            if (Number((r.rows ?? r)[0].n) > 0) tracedToUnedited++;
        }
        check('every exported example traces to a live approved_unedited row',
            onExamples.length > 0 && tracedToUnedited === onExamples.length,
            `${tracedToUnedited}/${onExamples.length}`);

        const badCfg = await fetch(`${base}/api/agents/outcomes/config`, {
            method: 'PATCH', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ fewShot: { limit: 500 } }),
        });
        check('config route refuses an out-of-range cap', badCfg.status === 400, String(badCfg.status));

        // ---------------------------------------------------------------- 10. reconcile safety net
        console.log('\n10. Reconcile catches a fate decided outside the hooks');
        const bodyF = 'This one gets rejected behind the ledger\'s back.';
        const draftF = await queueDraft({ phone: P.rejected, body: bodyF, source: 'comms_agent', reason: '[other] reconcile test', channel: 'sms', dedupe: false });
        if (draftF) created.drafts.push(draftF);
        await ledgerRow('draft', draftF!);
        // A status changed directly in the table — a script, a crash between send and ledger write,
        // or the comms agent superseding its own draft mid-run.
        await db.execute(sql`UPDATE message_drafts SET status='rejected', approved_by='someone@handyservices.com', approved_at=now() WHERE id=${draftF}`);
        await reconcileOutcomes({ limit: 100 });
        const afterF = await settle('draft', draftF!, (r) => r.verdict !== 'pending');
        check('reconcile picked up the rejection', afterF?.verdict === 'rejected', afterF?.verdict);

        const draftG = await queueDraft({ phone: P.rejected, body: 'Superseded body', source: 'comms_agent', reason: '[other] supersede test', channel: 'sms', dedupe: false });
        if (draftG) created.drafts.push(draftG);
        await ledgerRow('draft', draftG!);
        await db.execute(sql`UPDATE message_drafts SET status='rejected', approved_by='comms_agent:superseded', approved_at=now() WHERE id=${draftG}`);
        await reconcileOutcomes({ limit: 100 });
        const afterG = await settle('draft', draftG!, (r) => r.verdict !== 'pending');
        check('an agent replacing its own draft is NOT counted as a human rejection',
            afterG?.verdict === 'superseded', afterG?.verdict);

    } finally {
        // ------------------------------------------------------------------ cleanup
        console.log('\nCleaning up test rows…');
        await setOutcomeLoopConfig(configBefore);
        const del = async (label: string, stmt: any) => {
            try { await db.execute(stmt); } catch (e: any) { console.warn(`  cleanup ${label}:`, e.message); }
        };
        for (const id of created.messages) await del('message', sql`DELETE FROM messages WHERE id = ${id}`);
        for (const id of created.quotes) await del('quote', sql`DELETE FROM personalized_quotes WHERE id = ${id}`);
        for (const id of created.drafts) {
            await del('outcome', sql`DELETE FROM agent_outcomes WHERE kind='draft' AND ref_id = ${id}`);
            await del('draft', sql`DELETE FROM message_drafts WHERE id = ${id}`);
        }
        for (const id of created.questions) {
            await del('outcome', sql`DELETE FROM agent_outcomes WHERE kind='question' AND ref_id = ${id}`);
            await del('question', sql`DELETE FROM agent_questions WHERE id = ${id}`);
        }
        for (const id of created.conversations) await del('conversation', sql`DELETE FROM conversations WHERE id = ${id}`);
        server.close();

        console.log(`\n${'='.repeat(60)}\n${passed} passed, ${failed} failed\n`);
        process.exit(failed === 0 ? 0 : 1);
    }
}

main().catch((e) => { console.error(e); process.exit(1); });
