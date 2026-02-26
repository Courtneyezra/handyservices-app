/**
 * Clear conversation history for a tenant to test fresh
 * Usage: npx tsx scripts/clear-tenant-conversation.ts +447508744402
 */
import { db } from '../server/db';
import { conversations, messages } from '../shared/schema';
import { eq, like } from 'drizzle-orm';

async function main() {
    const phone = process.argv[2];
    if (!phone) {
        console.log('Usage: npx tsx scripts/clear-tenant-conversation.ts +447508744402');
        process.exit(1);
    }

    // Remove + for search
    const phoneDigits = phone.replace(/\D/g, '');
    console.log(`Looking for conversations with phone containing: ${phoneDigits}`);

    // Find conversations for this phone
    const convs = await db.query.conversations.findMany({
        where: like(conversations.phoneNumber, `%${phoneDigits}%`)
    });

    if (convs.length === 0) {
        console.log('No conversations found for this phone');
        process.exit(0);
    }

    for (const conv of convs) {
        console.log(`Deleting conversation: ${conv.id} (${conv.phoneNumber})`);
        console.log(`  Last message: ${conv.lastMessagePreview || 'N/A'}`);

        // Count messages
        const msgCount = await db.query.messages.findMany({
            where: eq(messages.conversationId, conv.id)
        });
        console.log(`  Messages to delete: ${msgCount.length}`);

        // Delete messages first
        await db.delete(messages).where(eq(messages.conversationId, conv.id));

        // Delete conversation
        await db.delete(conversations).where(eq(conversations.id, conv.id));

        console.log(`  ✅ Deleted`);
    }

    console.log(`\n✅ Cleared ${convs.length} conversation(s) - ready for fresh test!`);
    process.exit(0);
}

main().catch(err => {
    console.error('Error:', err);
    process.exit(1);
});
