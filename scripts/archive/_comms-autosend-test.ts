/**
 * Stages the Phase 3 auto-send test on the Ofcom test-range conversation (+447700900999):
 * clears prior agent work, injects a fake inbound "here are the photos" message, and opens
 * the 24h window. Then run:  npx tsx scripts/agent-comms.ts --phone +447700900999
 *
 * The expected chain: agent drafts an ack_photos reply → intent is whitelisted → the draft is
 * auto-approved through approveAndSendDraft → Twilio attempts delivery to the test number
 * (no real subscriber exists in the 07700 900xxx range).
 *
 *   npx tsx scripts/_comms-autosend-test.ts          # stage
 *   npx tsx scripts/_comms-autosend-test.ts --verify # show resulting draft rows
 */
import 'dotenv/config';
import { db } from '../server/db';
import { conversations, messages, messageDrafts, agentQuestions } from '@shared/schema';
import { eq, desc } from 'drizzle-orm';

const TEST_PHONE = '+447700900999';
const TEST_KEY = '447700900999@c.us';

async function main() {
    if (process.argv.includes('--verify')) {
        const drafts = await db.select({
            id: messageDrafts.id, status: messageDrafts.status, approvedBy: messageDrafts.approvedBy,
            sentAt: messageDrafts.sentAt, error: messageDrafts.error, reason: messageDrafts.reason,
            body: messageDrafts.body,
        }).from(messageDrafts)
            .where(eq(messageDrafts.phone, TEST_PHONE))
            .orderBy(desc(messageDrafts.createdAt)).limit(3);
        for (const d of drafts) {
            console.log(`${d.id}  status=${d.status}  approvedBy=${d.approvedBy}  sentAt=${d.sentAt?.toISOString() ?? '-'}`);
            console.log(`   reason: ${d.reason}`);
            console.log(`   body:   ${d.body.slice(0, 120)}`);
            if (d.error) console.log(`   error:  ${d.error}`);
        }
        process.exit(0);
    }

    const [conv] = await db.select().from(conversations).where(eq(conversations.phoneNumber, TEST_KEY));
    if (!conv) { console.error('no test conversation'); process.exit(1); }

    // Clear prior agent work so dedupe doesn't suppress the new draft.
    await db.delete(messageDrafts).where(eq(messageDrafts.phone, TEST_PHONE));
    await db.delete(agentQuestions).where(eq(agentQuestions.phone, TEST_PHONE));

    // Fake inbound WhatsApp message + open window.
    const now = new Date();
    await db.insert(messages).values({
        id: `test_msg_${Date.now()}`,
        conversationId: conv.id,
        direction: 'inbound',
        channel: 'whatsapp',
        content: 'Here are the photos of the fence panels you asked for',
        type: 'image',
        mediaUrl: null,
        status: 'delivered',
        senderName: 'Test Lead (smoke)',
        createdAt: now,
    });
    await db.update(conversations).set({
        lastInboundAt: now,
        lastCustomerContactAt: now,
        lastMessageAt: now,
        lastMessagePreview: 'Here are the photos of the fence panels you asked for',
        canSendFreeform: true,
    }).where(eq(conversations.id, conv.id));

    console.log(`staged: fake inbound photo message on ${conv.id}, window open`);
    console.log('now run: npx tsx scripts/agent-comms.ts --phone +447700900999');
    process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
