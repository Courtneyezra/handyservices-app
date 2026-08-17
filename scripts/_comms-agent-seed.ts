/**
 * Seeds a test draft + ask-Ben question against the Ofcom test-range conversation
 * (+447700900999) for UI verification. Never touches a real customer.
 *
 *   npx tsx scripts/_comms-agent-seed.ts          # seed
 *   npx tsx scripts/_comms-agent-seed.ts --clean  # remove test rows
 */
import 'dotenv/config';
import { db } from '../server/db';
import { conversations, messageDrafts, agentQuestions } from '@shared/schema';
import { eq } from 'drizzle-orm';
import { queueDraft } from '../server/message-drafts';
import { askBen } from '../server/agent-questions';

const TEST_PHONE = '+447700900999';
const TEST_KEY = '447700900999@c.us';

async function main() {
    if (process.argv.includes('--clean')) {
        await db.delete(messageDrafts).where(eq(messageDrafts.phone, TEST_PHONE));
        await db.delete(agentQuestions).where(eq(agentQuestions.phone, TEST_PHONE));
        console.log('cleaned test drafts + questions');
        process.exit(0);
    }

    const [conv] = await db.select().from(conversations).where(eq(conversations.phoneNumber, TEST_KEY));
    if (!conv) { console.log('no test conversation found for', TEST_KEY); process.exit(1); }
    console.log('conversation:', conv.id);

    const draftId = await queueDraft({
        phone: TEST_PHONE,
        body: 'Hi! Thanks for the photos — that gives us everything we need. We will have your quote over shortly.',
        source: 'manual',
        reason: 'UI verification draft (test number, never sends to a real customer)',
    });
    console.log('draft:', draftId);

    const qId = await askBen({
        conversationId: conv.id,
        phone: TEST_PHONE,
        question: 'Customer wants Saturday morning — do we offer it?',
        context: 'They asked twice. Weekend visits normally carry the £40 surcharge.',
        options: ['Offer Saturday +£40', 'Offer Monday free instead', 'Call them to discuss'],
    });
    console.log('question:', qId);
    process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
