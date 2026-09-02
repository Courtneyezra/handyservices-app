/**
 * V2 Pipeline Orchestrator
 *
 * Chains the specialist workers in sequence:
 * 1. Vision (if media present) → extract items/defects from photos/videos
 * 2. Scoping → extract job lines, gaps, assumptions
 * 3. Research → estimate materials and time (if scoped)
 * 4. Pricing → calculate costs (if researched)
 * 5. Reply → generate customer response
 *
 * Replaces the old linear comms agent with multi-model specialist workers.
 */

import { db } from '../db';
import { eq } from 'drizzle-orm';
import { conversations, messages } from '../../shared/schema';
import { getOrCreateMemory, updateMemory, getMemory } from '../memory';
import { runVisionWorker } from '../workers/vision';
import { runScopingWorker } from '../workers/scoping';
import { runResearchWorker } from '../workers/research';
import { runPricingWorker } from '../workers/pricing';
import { runReplyWorker } from '../workers/reply';
import type { MemoryMessage } from '../../shared/conversation-memory';

export interface V2PipelineOutcome {
  conversationId: string;
  reply: string | null;
  actions: Array<{ tool: string; result: string }>;
  autosent: boolean;
  readiness: string;
  error: string | null;
}

export interface V2PipelineConfig {
  enabled: boolean;
  autoSend: boolean;
  maxGapsToAsk: number;
}

const DEFAULT_CONFIG: V2PipelineConfig = {
  // 2 Sep 2026: OFF. V2 was routed to every conversation with no allowlist, and sendV2Reply
  // bypasses checkDraft, autosend.enabled and the hours gate. Railway has no OPENROUTER_API_KEY,
  // so prod was silent on inbound from 31 Aug while local dev processes sent unguarded replies.
  // Legacy comms.ts is the live path until the redesign lands (docs/COMMS_AGENTS_V3_DESIGN.md).
  enabled: false,
  autoSend: false, // Start with manual review
  maxGapsToAsk: 1,
};

let _config: V2PipelineConfig = { ...DEFAULT_CONFIG };

export function getV2Config(): V2PipelineConfig {
  return _config;
}

export function setV2Config(config: Partial<V2PipelineConfig>): void {
  _config = { ..._config, ...config };
}

/**
 * Run the V2 pipeline for a conversation.
 *
 * This is the main entry point that replaces runCommsAgent for V2 mode.
 */
export async function runV2Pipeline(
  conversationId: string,
  trigger: 'inbound_message' | 'media_received' | 'sla_sweep' | 'manual'
): Promise<V2PipelineOutcome> {
  const start = Date.now();
  const actions: Array<{ tool: string; result: string }> = [];

  console.log(`[V2Pipeline] Starting for ${conversationId}, trigger=${trigger}`);

  try {
    // 1. Load conversation and messages
    const [conv] = await db.select().from(conversations).where(eq(conversations.id, conversationId));
    if (!conv) {
      throw new Error(`Conversation ${conversationId} not found`);
    }

    const msgs = await db
      .select()
      .from(messages)
      .where(eq(messages.conversationId, conversationId))
      .orderBy(messages.createdAt);

    // 2. Initialize or update memory with messages
    const memory = await getOrCreateMemory(conversationId);

    const memoryMessages: MemoryMessage[] = msgs.map(m => ({
      id: m.id,
      content: m.content || '',
      direction: m.direction as 'inbound' | 'outbound',
      phone: conv.phoneNumber,
      createdAt: m.createdAt?.toISOString() || new Date().toISOString(),
      mediaUrl: m.mediaUrl || undefined,
      mediaType: m.mediaType || undefined,
    }));

    await updateMemory(conversationId, { messages: memoryMessages }, memory.version);
    actions.push({ tool: 'memory_sync', result: `${msgs.length} messages` });

    // 3. Vision: Process any unprocessed media
    const unprocessedMedia = msgs.filter(m =>
      m.mediaUrl &&
      m.direction === 'inbound' &&
      !memory.mediaExtractions.some(e => e.mediaId === m.id)
    );

    for (const media of unprocessedMedia) {
      if (media.mediaUrl && media.mediaType) {
        try {
          console.log(`[V2Pipeline] Running vision on ${media.id}`);
          const visionResult = await runVisionWorker({
            conversationId,
            mediaId: media.id,
            mediaPath: media.mediaUrl,
            mediaType: media.mediaType,
            customerContext: media.content || undefined,
          });
          actions.push({
            tool: 'vision',
            result: `${visionResult.extraction.items.length} items, ${visionResult.extraction.defects.length} defects`
          });
        } catch (err: any) {
          console.error(`[V2Pipeline] Vision failed for ${media.id}:`, err.message);
          actions.push({ tool: 'vision', result: `error: ${err.message}` });
        }
      }
    }

    // 4. Scoping: Extract job scope
    console.log(`[V2Pipeline] Running scoping`);
    const scopeResult = await runScopingWorker({
      conversationId,
      trigger: trigger === 'media_received' ? 'media_extracted' : 'message_received',
    });
    actions.push({
      tool: 'scoping',
      result: `${scopeResult.scope.lines.length} lines, ${scopeResult.scope.gaps.length} gaps`
    });

    // 5. Research: If we have scope lines and no blocking gaps
    const updatedMemory = await getMemory(conversationId);
    const customerGaps = updatedMemory?.scope?.gaps.filter(g =>
      g.audience === 'customer' && !g.answered
    ) || [];

    if (scopeResult.scope.lines.length > 0 && customerGaps.length === 0) {
      console.log(`[V2Pipeline] Running research`);
      try {
        const researchResult = await runResearchWorker(conversationId);
        actions.push({
          tool: 'research',
          result: `${researchResult.research.lines.length} lines researched`
        });

        // 6. Pricing: Calculate costs
        console.log(`[V2Pipeline] Running pricing`);
        const pricingResult = await runPricingWorker(conversationId);
        actions.push({
          tool: 'pricing',
          result: `£${(pricingResult.pricing.totalPence / 100).toFixed(2)}`
        });
      } catch (err: any) {
        console.error(`[V2Pipeline] Research/pricing failed:`, err.message);
        actions.push({ tool: 'research', result: `error: ${err.message}` });
      }
    }

    // 7. Reply: Generate response
    console.log(`[V2Pipeline] Running reply`);
    const gapsToAsk = customerGaps.slice(0, _config.maxGapsToAsk);

    const replyResult = await runReplyWorker({
      conversationId,
      trigger: 'inbound_message',
      gapsToAsk,
    });
    actions.push({ tool: 'reply', result: `${replyResult.reply.length} chars` });

    // Get final memory state
    const finalMemory = await getMemory(conversationId);

    console.log(`[V2Pipeline] Complete in ${Date.now() - start}ms: ${actions.map(a => a.tool).join(' → ')}`);

    return {
      conversationId,
      reply: replyResult.reply,
      actions,
      autosent: false, // TODO: implement auto-send
      readiness: finalMemory?.readiness || 'unknown',
      error: null,
    };

  } catch (error: any) {
    console.error(`[V2Pipeline] Failed for ${conversationId}:`, error.message);
    return {
      conversationId,
      reply: null,
      actions,
      autosent: false,
      readiness: 'error',
      error: error.message,
    };
  }
}

/**
 * Check if V2 pipeline should be used for a conversation.
 * Can be extended with A/B testing, feature flags, etc.
 */
export function shouldUseV2(conversationId: string): boolean {
  return _config.enabled;
}
