/**
 * B-WP4 verification: seed one entity per desk source, call buildDeskItems()
 * directly (no HTTP, no server boot), assert the DeskItem contract shape,
 * dedup and strict waitingWorkingHours-DESC ranking, then clean up.
 *
 * Seeds (all clearly marked DESK-TEST, deleted in finally):
 *   conv B  needs_ben tag + flagged agent question 10 days old
 *             → sla_breach (needs_ben lane, 2wh SLA long past) AND a bensDesk
 *               reply card → dedup keeps sla_breach, 'reply' rides as a badge
 *   conv A  needs_ben tag, last customer contact 6 days ago → reply
 *   draft   pending message_draft created 4 days ago       → draft
 *   task    open va_call_task created 1 day ago            → call_task
 *             (notifiedAt set + dueAt in the future so the live task crons
 *              can neither re-ping nor expire it mid-test)
 *
 * Ages are relative (10/6/4/1 days) so working-hours ranking holds on any run
 * date: breach > reply > draft > task.
 *
 * Run: npx tsx scripts/_test-desk.ts
 */
import crypto from 'node:crypto';
import { db } from '../server/db';
import { conversations, messageDrafts, agentQuestions, vaCallTasks } from '@shared/schema';
import { eq, inArray } from 'drizzle-orm';
import { buildDeskItems } from '../server/desk-routes';
import type { DeskItem } from '@shared/ops-types';

const MARK = 'DESK-TEST';
const now = Date.now();
const daysAgo = (d: number) => new Date(now - d * 86_400_000);

// Ofcom drama-range numbers — never real customers.
const PHONE_BREACH = '447700900802';
const PHONE_REPLY = '447700900806';
const PHONE_DRAFT = '447700900803';
const PHONE_TASK = '447700900804';

let failures = 0;
function assert(cond: boolean, label: string): void {
    if (cond) {
        console.log(`  ✓ ${label}`);
    } else {
        failures++;
        console.error(`  ✗ FAIL: ${label}`);
    }
}

async function main() {
    const convBreachId = crypto.randomUUID();
    const convReplyId = crypto.randomUUID();
    const questionId = crypto.randomUUID();
    const draftId = crypto.randomUUID();
    const taskConvId = crypto.randomUUID(); // no conversations row needed — plain varchar ref
    let taskId: string | undefined;

    try {
        console.log('— seeding —');
        await db.insert(conversations).values([
            {
                id: convBreachId,
                phoneNumber: `${PHONE_BREACH}@c.us`,
                contactName: `${MARK}-BREACH`,
                roleProfile: 'customer',
                status: 'active',
                stage: 'active',
                tags: ['needs_ben'],
                lastMessageAt: new Date(now),
                lastCustomerContactAt: daysAgo(10),
            },
            {
                id: convReplyId,
                phoneNumber: `${PHONE_REPLY}@c.us`,
                contactName: `${MARK}-REPLY`,
                roleProfile: 'customer',
                status: 'active',
                stage: 'active',
                tags: ['needs_ben'], // bensDesk, but NO flagged question → no SLA lane
                lastMessageAt: new Date(now),
                lastCustomerContactAt: daysAgo(6),
            },
        ]);
        await db.insert(agentQuestions).values({
            id: questionId,
            conversationId: convBreachId,
            phone: `+${PHONE_BREACH}`,
            question: `${MARK}: does the customer want the fence painted both sides?`,
            status: 'flagged',
            createdAt: daysAgo(10),
        });
        await db.insert(messageDrafts).values({
            id: draftId,
            conversationId: null,
            phone: `+${PHONE_DRAFT}`,
            body: `${MARK} draft body — hi, your quote is ready.`,
            channel: 'whatsapp',
            source: 'manual',
            reason: `${MARK} seeded pending draft`,
            status: 'pending',
            createdAt: daysAgo(4),
        });
        const [task] = await db.insert(vaCallTasks).values({
            conversationId: taskConvId,
            phone: `+${PHONE_TASK}`,
            contactName: `${MARK}-TASK`,
            channel: 'webform',
            reason: `${MARK} seeded call task`,
            createdAt: daysAgo(1),
            dueAt: new Date(now + 3_600_000), // future → expiry/notify crons leave it alone
            notifiedAt: new Date(now),
        }).returning();
        taskId = task.id;

        console.log('— building desk —');
        const items = await buildDeskItems();
        console.log(`  desk has ${items.length} items total`);

        console.log('— asserting: DeskItem contract shape (every item) —');
        const KINDS = ['reply', 'draft', 'call_task', 'sla_breach'];
        assert(items.every((i) => KINDS.includes(i.kind)), 'every kind is a DeskItem kind');
        assert(items.every((i) => typeof i.phone === 'string'), 'phone: string on every item');
        assert(items.every((i) => typeof i.contactName === 'string'), 'contactName: string on every item');
        assert(items.every((i) => typeof i.title === 'string' && i.title.length > 0), 'title present on every item');
        assert(items.every((i) => typeof i.preview === 'string'), 'preview: string on every item');
        assert(items.every((i) => typeof i.waitingWorkingHours === 'number' && Number.isFinite(i.waitingWorkingHours) && i.waitingWorkingHours >= 0), 'waitingWorkingHours: finite number ≥ 0');
        assert(items.every((i) => typeof i.href === 'string' && i.href.startsWith('/admin/')), 'href: /admin/... deep link on every item');
        assert(items.every((i) => Array.isArray(i.badges) && i.badges.every((b) => typeof b === 'string')), 'badges: string[] on every item');
        assert(items.filter((i) => i.kind === 'draft').every((i) => typeof i.draftId === 'string'), "every 'draft' item carries draftId");
        assert(items.filter((i) => i.kind === 'call_task').every((i) => typeof i.taskId === 'string'), "every 'call_task' item carries taskId");

        console.log('— asserting: ranking strictly by waitingWorkingHours DESC —');
        const sorted = items.every((item, idx) => idx === 0 || items[idx - 1].waitingWorkingHours >= item.waitingWorkingHours);
        assert(sorted, 'items[i-1].waitingWorkingHours >= items[i].waitingWorkingHours for the whole list');

        console.log('— asserting: the four seeded sources —');
        const byPhone = (digits: string) => items.filter((i) => i.phone.replace(/\D/g, '').endsWith(digits.slice(-10)));

        const breachItems = byPhone(PHONE_BREACH);
        assert(breachItems.length === 1, 'breach conv deduped to ONE item (was both bensDesk reply and SLA breach)');
        const breach = breachItems[0];
        assert(breach?.kind === 'sla_breach', "breach conv kept the higher-signal kind 'sla_breach'");
        assert(!!breach?.badges.includes('reply'), "breach item carries the merged 'reply' kind as a badge");
        assert(breach?.conversationId === convBreachId, 'breach item points at the seeded conversation');
        assert(breach?.href === `/admin/comms?conversation=${convBreachId}`, 'breach href deep-links the comms thread');

        const replyItems = byPhone(PHONE_REPLY);
        assert(replyItems.length === 1, 'reply conv appears exactly once');
        const reply = replyItems[0];
        assert(reply?.kind === 'reply', "reply conv is kind 'reply' (no SLA lane without a flagged question)");
        assert(reply?.href === `/admin/comms?conversation=${convReplyId}`, 'reply href deep-links the comms thread');

        const draftItems = byPhone(PHONE_DRAFT);
        assert(draftItems.length === 1, 'pending draft appears exactly once');
        const draft = draftItems[0];
        assert(draft?.kind === 'draft', "draft row is kind 'draft'");
        assert(draft?.draftId === draftId, 'draft item carries the message_drafts id');
        assert(!!draft?.preview.includes('your quote is ready'), 'draft preview is the draft body');

        const taskItems = byPhone(PHONE_TASK);
        assert(taskItems.length === 1, 'open call task appears exactly once');
        const taskItem = taskItems[0];
        assert(taskItem?.kind === 'call_task', "open task is kind 'call_task'");
        assert(taskItem?.taskId === taskId, 'call_task item carries the va_call_tasks id');
        assert(taskItem?.href === '/admin/va-tasks', 'call_task href points at /admin/va-tasks');

        console.log('— asserting: seeded relative order (10d > 6d > 4d > 1d of working hours) —');
        const pos = (i?: DeskItem) => (i ? items.indexOf(i) : -1);
        assert(pos(breach) !== -1 && pos(reply) !== -1 && pos(draft) !== -1 && pos(taskItem) !== -1, 'all four seeded items are on the desk');
        assert((breach?.waitingWorkingHours ?? 0) > (reply?.waitingWorkingHours ?? 0), 'breach (10d) has waited longer than reply (6d)');
        assert((reply?.waitingWorkingHours ?? 0) > (draft?.waitingWorkingHours ?? 0), 'reply (6d) has waited longer than draft (4d)');
        assert((draft?.waitingWorkingHours ?? 0) > (taskItem?.waitingWorkingHours ?? 0), 'draft (4d) has waited longer than call task (1d)');
        assert(pos(breach) < pos(reply) && pos(reply) < pos(draft) && pos(draft) < pos(taskItem), 'seeded items rank breach → reply → draft → task');
    } finally {
        console.log('— cleanup —');
        try {
            if (taskId) await db.delete(vaCallTasks).where(eq(vaCallTasks.id, taskId));
            await db.delete(agentQuestions).where(eq(agentQuestions.id, questionId));
            await db.delete(messageDrafts).where(eq(messageDrafts.id, draftId));
            await db.delete(conversations).where(inArray(conversations.id, [convBreachId, convReplyId]));
            console.log('  seeded rows deleted');
        } catch (error: any) {
            failures++;
            console.error('  ✗ CLEANUP FAILED — remove DESK-TEST rows by hand:', error?.message);
        }
    }

    console.log(failures === 0 ? '\nALL ASSERTIONS PASSED' : `\n${failures} ASSERTION(S) FAILED`);
    process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
    console.error('Test crashed:', error);
    process.exit(1);
});
