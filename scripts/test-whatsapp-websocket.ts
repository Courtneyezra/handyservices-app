/**
 * Test script for the new Conversation Engine WebSocket
 */

import WebSocket from 'ws';

const WS_URL = 'ws://localhost:5001/api/ws/client';

async function testInboxWebSocket() {
    console.log('Testing WhatsApp Inbox WebSocket connection...\n');
    console.log(`Connecting to: ${WS_URL}\n`);

    const ws = new WebSocket(WS_URL);

    ws.on('open', () => {
        console.log('✅ WebSocket connected successfully\n');
    });

    ws.on('message', (data) => {
        try {
            const msg = JSON.parse(data.toString());
            console.log(`📨 Received message type: ${msg.type}`);

            if (msg.type === 'inbox:ready') {
                console.log('✅ Inbox is ready\n');
                // Request conversations
                ws.send(JSON.stringify({ type: 'inbox:get_conversations' }));
            } else if (msg.type === 'inbox:conversations') {
                console.log(`📋 Conversations received: ${msg.data.length} conversations`);
                if (msg.data.length > 0) {
                    console.log('\nFirst 3 conversations:');
                    msg.data.slice(0, 3).forEach((conv: any, i: number) => {
                        console.log(`  ${i + 1}. ${conv.contactName || conv.phoneNumber} (${conv.phoneNumber})`);
                        console.log(`     Last: ${conv.lastMessagePreview}`);
                        console.log(`     Freeform: ${conv.canSendFreeform ? '✅ Yes' : '⚠️ Template Required'}`);
                    });

                    // Test fetching messages for first conversation
                    const testConv = msg.data[0];
                    console.log(`\n🔍 Testing message fetch for: ${testConv.phoneNumber}`);
                    ws.send(JSON.stringify({
                        type: 'inbox:get_messages',
                        data: { conversationId: testConv.phoneNumber }
                    }));
                }
            } else if (msg.type === 'inbox:messages') {
                console.log(`📜 Messages received for: ${msg.conversationId}`);
                console.log(`   Total: ${msg.data.length} messages`);
                if (msg.error) {
                    console.log(`   ❌ Error: ${msg.error}`);
                }
                if (msg.data.length > 0) {
                    console.log('\nFirst 3 messages:');
                    msg.data.slice(0, 3).forEach((m: any, i: number) => {
                        const dir = m.direction === 'outbound' ? 'OUT' : 'IN';
                        console.log(`  ${i + 1}. [${dir}] ${m.content?.substring(0, 50)}...`);
                    });
                }

                console.log('\n✅ Test complete! New Conversation Engine is working.');
                setTimeout(() => {
                    ws.close();
                    process.exit(0);
                }, 1000);
            } else if (msg.type === 'inbox:error') {
                console.log(`❌ Error: ${msg.error}`);
            }

            // Legacy message types (from old server)
            else if (msg.type === 'whatsapp:ready' || msg.type === 'whatsapp:chat_list') {
                console.log('⚠️  Received legacy message type - OLD SERVER STILL RUNNING');
                console.log('   Please restart the server to use the new Conversation Engine');
                setTimeout(() => {
                    ws.close();
                    process.exit(1);
                }, 1000);
            }
        } catch (e) {
            console.error('Error parsing message:', e);
        }
    });

    ws.on('error', (error) => {
        console.error('❌ WebSocket error:', error.message);
        process.exit(1);
    });

    ws.on('close', () => {
        console.log('Connection closed');
    });

    // Timeout after 15 seconds
    setTimeout(() => {
        console.log('\n⏱️  Test timeout - closing connection');
        ws.close();
        process.exit(0);
    }, 15000);
}

testInboxWebSocket().catch(console.error);
