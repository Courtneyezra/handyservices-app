import { db } from '../server/db';
import { conversations, messages } from '../shared/schema';
import { desc, eq } from 'drizzle-orm';

async function debugConversationLookup() {
    console.log('Testing conversation lookup with different phone formats...\n');

    // Get all conversations
    const allConvs = await db.select().from(conversations).orderBy(desc(conversations.lastMessageAt));

    console.log(`Total conversations: ${allConvs.length}\n`);

    // Test lookup for each conversation
    for (const conv of allConvs) {
        console.log(`\n--- Testing: ${conv.contactName || 'Unknown'} ---`);
        console.log(`Stored phone number: "${conv.phoneNumber}"`);

        // Try exact match
        const exactMatch = await db.query.conversations.findFirst({
            where: eq(conversations.phoneNumber, conv.phoneNumber)
        });
        console.log(`Exact match: ${exactMatch ? '✅ Found' : '❌ Not found'}`);

        // Count messages
        if (exactMatch) {
            const msgCount = await db.select()
                .from(messages)
                .where(eq(messages.conversationId, exactMatch.id));
            console.log(`Messages: ${msgCount.length}`);
        }
    }
}

debugConversationLookup().catch(console.error).finally(() => process.exit(0));
