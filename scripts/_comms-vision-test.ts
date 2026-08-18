/**
 * Vision proof test: stages the Ofcom smoke-test conversation with a real customer photo and a
 * real customer video whose TEXT says nothing about their content. If the agent's output then
 * references what is actually IN the media, the pixels demonstrably reached the model.
 *
 *   npx tsx scripts/_comms-vision-test.ts          # stage
 *   npx tsx scripts/_comms-vision-test.ts --clean  # remove staged rows
 * then: npx tsx scripts/agent-comms.ts --phone +447700900999
 */
import 'dotenv/config';
import { db } from '../server/db';
import { conversations, messages, messageDrafts, agentQuestions } from '@shared/schema';
import { eq, like } from 'drizzle-orm';

const TEST_KEY = '447700900999@c.us';
const TEST_PHONE = '+447700900999';
const PHOTO = '/api/media/MM6d77d95c2f16ac348c4837c17a84e70a.jpg';  // real backfilled customer photo
const VIDEO = '/api/media/MMfdd04c416b02665f0e4978a9f4ac2606.mp4'; // real backfilled customer video

async function main() {
    const [conv] = await db.select().from(conversations).where(eq(conversations.phoneNumber, TEST_KEY));
    if (!conv) { console.error('no smoke conversation'); process.exit(1); }

    if (process.argv.includes('--clean')) {
        await db.delete(messages).where(eq(messages.conversationId, conv.id));
        await db.delete(messageDrafts).where(eq(messageDrafts.phone, TEST_PHONE));
        await db.delete(agentQuestions).where(eq(agentQuestions.phone, TEST_PHONE));
        console.log('cleaned smoke thread');
        process.exit(0);
    }

    // Fresh slate, then a deliberately uninformative thread: all the signal is in the media.
    await db.delete(messages).where(eq(messages.conversationId, conv.id));
    await db.delete(messageDrafts).where(eq(messageDrafts.phone, TEST_PHONE));
    await db.delete(agentQuestions).where(eq(agentQuestions.phone, TEST_PHONE));

    const base = Date.now() - 60_000;
    const rows = [
        { id: `vt_${base}_1`, content: 'Hi, could you take a look and let me know if this is something you can sort?', type: 'text', mediaUrl: null, mediaType: null },
        { id: `vt_${base}_2`, content: '', type: 'image', mediaUrl: PHOTO, mediaType: 'image/jpeg' },
        { id: `vt_${base}_3`, content: '', type: 'video', mediaUrl: VIDEO, mediaType: 'video/mp4' },
    ];
    for (let i = 0; i < rows.length; i++) {
        await db.insert(messages).values({
            ...rows[i],
            conversationId: conv.id,
            direction: 'inbound',
            channel: 'whatsapp',
            status: 'delivered',
            senderName: 'Test Lead (smoke)',
            createdAt: new Date(base + i * 1000),
        });
    }
    await db.update(conversations).set({
        lastInboundAt: new Date(base + 2000),
        lastCustomerContactAt: new Date(base + 2000),
        lastMessageAt: new Date(base + 2000),
        lastMessagePreview: '📷 Photo',
        canSendFreeform: true,
        tags: [], priority: 'normal', stage: 'new',
    }).where(eq(conversations.id, conv.id));

    console.log('staged: text says nothing, photo + video carry all the signal');
    console.log('now run: npx tsx scripts/agent-comms.ts --phone +447700900999');
    process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
