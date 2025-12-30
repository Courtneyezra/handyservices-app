/**
 * Seed script to populate conversations with realistic messages
 */

import { db } from '../server/db';
import { conversations, messages, type InsertMessage } from '../shared/schema';
import { eq } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';

// Sample conversation flows for a handyman business
const sampleConversations = [
    {
        contactName: 'Sarah Johnson',
        messages: [
            { direction: 'inbound', content: 'Hi, I need help fixing a leaky tap in my kitchen. How much would that cost?', delay: 0 },
            { direction: 'outbound', content: 'Hi Sarah! Thanks for reaching out. A basic tap repair typically costs £45-75 depending on the issue. Can you send a quick video of the leak?', delay: 5 },
            { direction: 'inbound', content: 'Sure, here you go', delay: 15 },
            { direction: 'outbound', content: 'Perfect, I can see the issue. Looks like the washer needs replacing. I can come tomorrow between 2-4pm. Does that work?', delay: 20 },
            { direction: 'inbound', content: 'Yes that works great! Thank you', delay: 25 },
            { direction: 'outbound', content: 'Great, I\'ve booked you in. You\'ll receive a confirmation shortly. See you tomorrow! 👍', delay: 30 },
        ]
    },
    {
        contactName: 'Mike Thompson',
        messages: [
            { direction: 'inbound', content: 'Hello, do you do bathroom fitting?', delay: 0 },
            { direction: 'outbound', content: 'Hi Mike! Yes we do bathroom fitting. What kind of work are you looking at?', delay: 5 },
            { direction: 'inbound', content: 'Full bathroom renovation. New bath, toilet, basin, and tiling', delay: 12 },
            { direction: 'outbound', content: 'That sounds like a great project! For a full bathroom renovation, we\'d need to do a site visit to give you an accurate quote. Are you available this week for a free assessment?', delay: 18 },
            { direction: 'inbound', content: 'I\'m free Thursday afternoon if that works?', delay: 25 },
            { direction: 'outbound', content: 'Thursday afternoon is perfect. I\'ll book you in for 2pm. Please have any inspiration photos ready if you have them. What\'s your address?', delay: 28 },
            { direction: 'inbound', content: '42 Oak Street, London NW3 2PQ', delay: 35 },
            { direction: 'outbound', content: 'Got it! See you Thursday at 2pm at 42 Oak Street. Looking forward to it! 🔧', delay: 38 },
        ]
    },
    {
        contactName: 'Emma Wilson',
        messages: [
            { direction: 'inbound', content: 'URGENT - My boiler has broken down and I have no heating or hot water!', delay: 0 },
            { direction: 'outbound', content: 'Hi Emma, I\'m sorry to hear that! I understand this is urgent. Can you tell me what\'s happening? Any error codes on the boiler display?', delay: 2 },
            { direction: 'inbound', content: 'It\'s showing E119 and making a strange noise', delay: 5 },
            { direction: 'outbound', content: 'E119 usually indicates low water pressure. Have you checked the pressure gauge? It should be between 1-1.5 bar when cold.', delay: 8 },
            { direction: 'inbound', content: 'Oh it says 0.3 bar!', delay: 12 },
            { direction: 'outbound', content: 'That\'s the issue! I can talk you through topping up the pressure if you\'d like to try that first? Or I can come out - earliest would be in about 2 hours.', delay: 15 },
            { direction: 'inbound', content: 'Can you talk me through it please?', delay: 18 },
            { direction: 'outbound', content: 'Of course! Look for a filling loop under the boiler - it\'s usually a silver braided hose. Turn the valve slowly until pressure reaches 1.2 bar. Let me know when you find it.', delay: 20 },
            { direction: 'inbound', content: 'Found it! Turning now...', delay: 25 },
            { direction: 'inbound', content: 'It\'s at 1.2 bar now! The error has cleared!', delay: 28 },
            { direction: 'outbound', content: 'Brilliant! 🎉 Reset the boiler and it should fire up. If this keeps happening, you might have a small leak somewhere that needs investigating. Give me a shout if you need anything else!', delay: 30 },
            { direction: 'inbound', content: 'You\'re amazing, thank you so much! Heating is back on 😊', delay: 35 },
        ]
    },
    {
        contactName: 'David Chen',
        messages: [
            { direction: 'inbound', content: 'Hi, looking for someone to hang a TV on the wall. 65 inch Samsung.', delay: 0 },
            { direction: 'outbound', content: 'Hi David! I can definitely help with that. What type of wall is it - plasterboard or brick?', delay: 8 },
            { direction: 'inbound', content: 'Brick wall', delay: 15 },
            { direction: 'outbound', content: 'Perfect, brick is the best for heavy TVs. Do you already have a wall mount or need me to supply one?', delay: 20 },
            { direction: 'inbound', content: 'I have the mount, it came with the TV', delay: 28 },
            { direction: 'outbound', content: 'Great! For a 65" TV mount on brick, installation is £65. Takes about an hour. Do you need any cables hidden in the wall too?', delay: 32 },
        ]
    },
    {
        contactName: 'Lisa Patel',
        messages: [
            { direction: 'inbound', content: 'Hello! I need a cat flap installed in my back door', delay: 0 },
            { direction: 'outbound', content: 'Hi Lisa! Is it a wooden, UPVC, or glass door?', delay: 10 },
            { direction: 'inbound', content: 'UPVC door', delay: 18 },
            { direction: 'outbound', content: 'UPVC is straightforward. Cat flap installation is £55. Do you have the cat flap already or would you like me to source one?', delay: 22 },
            { direction: 'inbound', content: 'I have one from Pets at Home, the microchip one', delay: 30 },
            { direction: 'outbound', content: 'Those are great flaps! Very secure. When would you like this done?', delay: 35 },
            { direction: 'inbound', content: 'Any chance you could do it this Saturday?', delay: 42 },
            { direction: 'outbound', content: 'Let me check... Yes, I have a slot at 10am on Saturday. Shall I book you in?', delay: 48 },
            { direction: 'inbound', content: 'Perfect yes please!', delay: 52 },
        ]
    }
];

async function seedConversations() {
    console.log('Seeding conversations with sample messages...\n');

    // Get existing conversations
    const existingConvs = await db.select().from(conversations).limit(5);

    if (existingConvs.length === 0) {
        console.log('No existing conversations found. Please run the app first to create some.');
        return;
    }

    console.log(`Found ${existingConvs.length} existing conversations\n`);

    // For each existing conversation, add sample messages
    for (let i = 0; i < Math.min(existingConvs.length, sampleConversations.length); i++) {
        const conv = existingConvs[i];
        const sample = sampleConversations[i];

        console.log(`\n📱 Seeding: ${sample.contactName} (${conv.phoneNumber})`);

        // Update contact name
        await db.update(conversations)
            .set({
                contactName: sample.contactName,
                lastMessagePreview: sample.messages[sample.messages.length - 1].content.substring(0, 50),
                lastMessageAt: new Date(),
                updatedAt: new Date()
            })
            .where(eq(conversations.id, conv.id));

        // Delete existing messages for this conversation
        await db.delete(messages).where(eq(messages.conversationId, conv.id));

        // Add sample messages
        const baseTime = new Date();
        baseTime.setHours(baseTime.getHours() - 2); // Start 2 hours ago

        for (const msg of sample.messages) {
            const msgTime = new Date(baseTime.getTime() + (msg.delay * 60 * 1000));

            const newMessage: InsertMessage = {
                id: uuidv4(),
                conversationId: conv.id,
                direction: msg.direction as 'inbound' | 'outbound',
                content: msg.content,
                type: 'text',
                status: 'delivered',
                senderName: msg.direction === 'inbound' ? sample.contactName : 'Agent',
                createdAt: msgTime,
            };

            await db.insert(messages).values(newMessage);
        }

        console.log(`   ✅ Added ${sample.messages.length} messages`);
    }

    console.log('\n✅ Seeding complete!');
}

seedConversations()
    .catch(console.error)
    .finally(() => process.exit(0));
