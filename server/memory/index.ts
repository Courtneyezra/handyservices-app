/**
 * Conversation Memory Access Functions
 *
 * Agent Framework V2, WS1: Data Model & Memory Object.
 *
 * CRUD operations for the conversation_memory table with optimistic locking.
 * Workers use these functions to read/write to the shared memory object.
 */

import { eq, sql } from 'drizzle-orm';
import { db } from '../db';
import { conversationMemory, type ConversationMemoryRow, type InsertConversationMemory } from '../../shared/schema';
import type {
    ConversationMemory,
    WorkerRun,
    BenEdit,
    MemoryUpdate,
} from '../../shared/conversation-memory';

// ==========================================
// TYPE CONVERSION
// ==========================================

/**
 * Convert a database row to the full ConversationMemory interface.
 * The DB stores JSONB fields; this function ensures proper typing.
 */
function rowToMemory(row: ConversationMemoryRow): ConversationMemory {
    return {
        id: row.id,
        conversationId: row.conversationId,
        version: row.version,
        messages: (row.messages ?? []) as ConversationMemory['messages'],
        media: (row.media ?? []) as ConversationMemory['media'],
        calls: (row.calls ?? []) as ConversationMemory['calls'],
        mediaExtractions: (row.mediaExtractions ?? []) as ConversationMemory['mediaExtractions'],
        scope: row.scope as ConversationMemory['scope'],
        research: row.research as ConversationMemory['research'],
        pricing: row.pricing as ConversationMemory['pricing'],
        draft: row.draft as ConversationMemory['draft'],
        readiness: row.readiness,
        blockers: (row.blockers ?? []) as ConversationMemory['blockers'],
        workerRuns: (row.workerRuns ?? []) as ConversationMemory['workerRuns'],
        benEdits: (row.benEdits ?? []) as ConversationMemory['benEdits'],
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
    };
}

// ==========================================
// CORE OPERATIONS
// ==========================================

/**
 * Get existing memory or create a new one for a conversation.
 *
 * This is the main entry point for workers. They call this to get the current
 * memory state, then call updateMemory with their changes.
 */
export async function getOrCreateMemory(conversationId: string): Promise<ConversationMemory> {
    // Try to find existing memory
    const [existing] = await db.select()
        .from(conversationMemory)
        .where(eq(conversationMemory.conversationId, conversationId));

    if (existing) {
        return rowToMemory(existing);
    }

    // Create new memory
    const [created] = await db.insert(conversationMemory)
        .values({
            conversationId,
        })
        .returning();

    return rowToMemory(created);
}

/**
 * Get memory by conversation ID. Returns null if not found.
 */
export async function getMemory(conversationId: string): Promise<ConversationMemory | null> {
    const [row] = await db.select()
        .from(conversationMemory)
        .where(eq(conversationMemory.conversationId, conversationId));

    return row ? rowToMemory(row) : null;
}

/**
 * Update memory with optimistic locking.
 *
 * @param conversationId - The conversation ID
 * @param updates - Partial memory updates
 * @param expectedVersion - The version the caller expects (for optimistic locking)
 * @throws Error if memory not found or version conflict
 */
export async function updateMemory(
    conversationId: string,
    updates: MemoryUpdate,
    expectedVersion: number
): Promise<ConversationMemory> {
    // Build the update object, incrementing version
    // Use Record<string, unknown> to allow dynamic assignment of JSONB fields
    const updateValues: Record<string, unknown> = {
        version: expectedVersion + 1,
        updatedAt: new Date(),
    };

    // Copy over allowed fields from updates
    if (updates.messages !== undefined) updateValues.messages = updates.messages;
    if (updates.media !== undefined) updateValues.media = updates.media;
    if (updates.calls !== undefined) updateValues.calls = updates.calls;
    if (updates.mediaExtractions !== undefined) updateValues.mediaExtractions = updates.mediaExtractions;
    if (updates.scope !== undefined) updateValues.scope = updates.scope;
    if (updates.research !== undefined) updateValues.research = updates.research;
    if (updates.pricing !== undefined) updateValues.pricing = updates.pricing;
    if (updates.draft !== undefined) updateValues.draft = updates.draft;
    if (updates.readiness !== undefined) updateValues.readiness = updates.readiness;
    if (updates.blockers !== undefined) updateValues.blockers = updates.blockers;
    if (updates.workerRuns !== undefined) updateValues.workerRuns = updates.workerRuns;
    if (updates.benEdits !== undefined) updateValues.benEdits = updates.benEdits;

    // Update with version check
    const [updated] = await db.update(conversationMemory)
        .set(updateValues)
        .where(
            sql`${conversationMemory.conversationId} = ${conversationId} AND ${conversationMemory.version} = ${expectedVersion}`
        )
        .returning();

    if (!updated) {
        throw new Error(`Memory update failed: not found or version conflict (expected ${expectedVersion})`);
    }

    return rowToMemory(updated);
}

// ==========================================
// AUDIT TRAIL HELPERS
// ==========================================

/**
 * Append a worker run to the audit trail.
 *
 * This is a convenience wrapper around updateMemory that handles the
 * read-modify-write cycle for adding to the workerRuns array.
 */
export async function appendWorkerRun(
    conversationId: string,
    run: WorkerRun
): Promise<void> {
    const memory = await getOrCreateMemory(conversationId);
    await updateMemory(conversationId, {
        workerRuns: [...memory.workerRuns, run],
    }, memory.version);
}

/**
 * Append a Ben edit to the audit trail.
 *
 * This is a convenience wrapper around updateMemory that handles the
 * read-modify-write cycle for adding to the benEdits array.
 */
export async function appendBenEdit(
    conversationId: string,
    edit: BenEdit
): Promise<void> {
    const memory = await getOrCreateMemory(conversationId);
    await updateMemory(conversationId, {
        benEdits: [...memory.benEdits, edit],
    }, memory.version);
}

// ==========================================
// QUERY HELPERS
// ==========================================

/**
 * Get all memories in a specific readiness state.
 */
export async function getMemoriesByReadiness(
    readiness: ConversationMemory['readiness']
): Promise<ConversationMemory[]> {
    const rows = await db.select()
        .from(conversationMemory)
        .where(eq(conversationMemory.readiness, readiness));

    return rows.map(rowToMemory);
}

/**
 * Get memories that are ready for Ben's review.
 */
export async function getMemoriesReadyForBen(): Promise<ConversationMemory[]> {
    return getMemoriesByReadiness('ready_for_ben');
}

/**
 * Get memories that need human intervention (blocked).
 */
export async function getMemoriesNeedingHuman(): Promise<ConversationMemory[]> {
    return getMemoriesByReadiness('needs_human');
}
