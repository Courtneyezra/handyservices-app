import { db } from '../server/db';
import { conversations, messages } from '../shared/schema';
import { desc, eq } from 'drizzle-orm';

async function checkWhatsAppData() {
    console.log('Checking WhatsApp CRM data...\n');

    // Check conversations
    const convs = await db.select().from(conversations).orderBy(desc(conversations.lastMessageAt)).limit(10);
    console.log(`Total conversations found: ${convs.length}`);

    if (convs.length > 0) {
        console.log('\nRecent conversations:');
        convs.forEach((conv, i) => {
            console.log(`${i + 1}. ${conv.contactName || conv.phoneNumber}`);
            console.log(`   Phone: ${conv.phoneNumber}`);
            console.log(`   Last message: ${conv.lastMessagePreview}`);
            console.log(`   Unread: ${conv.unreadCount}`);
            console.log(`   Status: ${conv.status}`);
            console.log('');
        });

        // Check messages for first conversation
        const firstConv = convs[0];
        const msgs = await db.select()
            .from(messages)
            .where(eq(messages.conversationId, firstConv.id))
            .orderBy(messages.createdAt)
            .limit(5);

        console.log(`\nMessages in first conversation (${firstConv.contactName || firstConv.phoneNumber}):`);
        console.log(`Total messages: ${msgs.length}`);
        msgs.forEach((msg, i) => {
            console.log(`${i + 1}. [${msg.direction}] ${msg.content?.substring(0, 50)}...`);
        });
    } else {
        console.log('No conversations found in database.');
    }
}

checkWhatsAppData().catch(console.error).finally(() => process.exit(0));
