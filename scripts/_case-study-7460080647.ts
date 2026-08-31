/**
 * Case study for +447460080647
 * Logs all agent runs, reasoning, tool calls, loops
 */
import { db } from '../server/db';
import { conversations, conversationMemory, messages } from '../shared/schema';
import { eq, like, desc } from 'drizzle-orm';

async function main() {
  // Find conversation
  const [conv] = await db.select()
    .from(conversations)
    .where(like(conversations.phoneNumber, '%7460080647%'));

  if (!conv) {
    console.log('Conversation not found for +447460080647');
    process.exit(1);
  }

  console.log('='.repeat(80));
  console.log('CASE STUDY: +447460080647');
  console.log('='.repeat(80));

  console.log('\n=== CONVERSATION ===');
  console.log('ID:', conv.id);
  console.log('Phone:', conv.phoneNumber);
  console.log('Status:', conv.status);
  console.log('Stage:', conv.stage);
  console.log('Tags:', conv.tags);
  console.log('Created:', conv.createdAt);

  // Get messages
  const msgs = await db.select()
    .from(messages)
    .where(eq(messages.conversationId, conv.id))
    .orderBy(messages.createdAt);

  console.log('\n=== MESSAGE HISTORY ===');
  for (const m of msgs) {
    const dir = m.direction === 'inbound' ? '<<< CUSTOMER' : '>>> US';
    const content = (m.content || '').slice(0, 100);
    console.log(`[${m.createdAt?.toISOString().slice(0, 19)}] ${dir}`);
    console.log(`  ${content}${content.length >= 100 ? '...' : ''}`);
    if (m.mediaUrl) console.log(`  [MEDIA: ${m.mediaType}]`);
  }

  // Get memory
  const [mem] = await db.select()
    .from(conversationMemory)
    .where(eq(conversationMemory.conversationId, conv.id));

  if (!mem) {
    console.log('\n[No memory record - V2 pipeline not run yet]');
    process.exit(0);
  }

  console.log('\n=== MEMORY STATE ===');
  console.log('Readiness:', mem.readiness);
  console.log('Version:', mem.version);
  console.log('Messages synced:', (mem.messages as any[])?.length || 0);
  console.log('Media items:', (mem.media as any[])?.length || 0);
  console.log('Media extractions:', (mem.mediaExtractions as any[])?.length || 0);

  console.log('\n=== WORKER RUNS (Agent Log) ===');
  const runs = (mem.workerRuns as any[]) || [];
  console.log(`Total runs: ${runs.length}\n`);

  for (let i = 0; i < runs.length; i++) {
    const run = runs[i];
    console.log(`--- Run ${i + 1}/${runs.length} ---`);
    console.log(`Worker: ${run.worker}`);
    console.log(`Model: ${run.model}`);
    console.log(`Trigger: ${run.trigger}`);
    console.log(`Started: ${run.startedAt}`);
    console.log(`Duration: ${run.durationMs}ms`);
    console.log(`Changes: ${JSON.stringify(run.changes)}`);
    if (run.error) {
      console.log(`ERROR: ${run.error}`);
    }
    if (run.tokenUsage) {
      console.log(`Tokens: in=${run.tokenUsage.input}, out=${run.tokenUsage.output}`);
    }
    // Show trace if available
    if (run.trace) {
      if (run.trace.reasoning) {
        console.log(`REASONING: ${run.trace.reasoning}`);
      }
      if (run.trace.prompt) {
        console.log(`PROMPT (truncated): ${run.trace.prompt.slice(0, 300)}...`);
      }
      if (run.trace.response) {
        console.log(`RESPONSE (truncated): ${run.trace.response.slice(0, 300)}...`);
      }
    }
    console.log('');
  }

  // Scope analysis
  const scope = mem.scope as any;
  if (scope) {
    console.log('=== SCOPE (Job Understanding) ===');
    console.log('Customer:', scope.customerName || 'Unknown');
    console.log('Type:', scope.customerType);
    console.log('Tone:', scope.tone);
    console.log('Postcode:', scope.postcode || 'Not captured');
    console.log('Last scoped:', scope.lastScopedAt);

    console.log('\nJob Lines:');
    for (const line of (scope.lines || [])) {
      console.log(`  • ${line.title}`);
      console.log(`    Detail: ${line.detail}`);
      console.log(`    Customer words: "${line.customerWords}"`);
    }

    console.log('\nGaps (questions to ask):');
    for (const gap of (scope.gaps || [])) {
      const status = gap.asked ? (gap.answered ? '✓ ANSWERED' : '⏳ ASKED') : '○ NOT ASKED';
      console.log(`  ${status} ${gap.question}`);
      console.log(`    Audience: ${gap.audience}, Impact: ${gap.impact}`);
      if (gap.answer) console.log(`    Answer: ${gap.answer}`);
    }
  }

  // Media extractions
  const extractions = (mem.mediaExtractions as any[]) || [];
  if (extractions.length > 0) {
    console.log('\n=== MEDIA EXTRACTIONS ===');
    for (const ext of extractions) {
      console.log(`Media ${ext.mediaId}:`);
      console.log(`  Model: ${ext.model}`);
      console.log(`  What is shown: ${ext.whatIsShown || 'N/A'}`);
      console.log(`  What is missing: ${ext.whatIsMissing || 'N/A'}`);
      console.log(`  Items: ${ext.items?.length || 0}`);
      console.log(`  Defects: ${ext.defects?.length || 0}`);
    }
  }

  // Blockers
  const blockers = (mem.blockers as any[]) || [];
  if (blockers.length > 0) {
    console.log('\n=== BLOCKERS ===');
    for (const b of blockers) {
      console.log(`  ⚠ ${b.type}: ${b.reason}`);
    }
  }

  console.log('\n' + '='.repeat(80));
  console.log('END CASE STUDY');
  console.log('='.repeat(80));

  process.exit(0);
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
