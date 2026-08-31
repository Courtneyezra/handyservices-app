/**
 * Test reply worker on most recent debug conversation
 */
import 'dotenv/config';
import { db } from '../server/db';
import { sql } from 'drizzle-orm';
import { getMemory } from '../server/memory';
import { runReplyWorker } from '../server/workers/reply';

async function test() {
  // Find the most recent debug conversation
  const r = await db.execute(sql`
    SELECT conversation_id FROM conversation_memory
    WHERE conversation_id LIKE 'debug-pipeline-%'
    ORDER BY updated_at DESC LIMIT 1
  `);

  const convId = r.rows[0]?.conversation_id as string;
  if (!convId) {
    console.log('No debug conversation found');
    return;
  }

  const memory = await getMemory(convId);
  if (!memory) {
    console.log('No memory found for', convId);
    return;
  }

  console.log('=== TESTING REPLY WORKER ===');
  console.log('Conversation:', convId);
  console.log('Scope lines:', memory.scope?.lines.map(l => l.title).join(', '));

  // Get first gap to ask
  const gapsToAsk = memory.scope?.gaps.filter(g => !g.asked && g.audience === 'customer').slice(0, 1) ?? [];

  console.log('Gap to ask:', gapsToAsk[0]?.question || 'None');

  // Run reply worker
  console.log('\nRunning reply worker...');
  const result = await runReplyWorker({
    conversationId: convId,
    trigger: 'inbound_message',
    gapsToAsk,
  });

  console.log('\n=== GENERATED REPLY ===');
  console.log(result.reply);
  console.log('\n---');
  console.log('Duration:', result.workerRun.durationMs, 'ms');
}

test().catch(err => console.error('Error:', err.message));
