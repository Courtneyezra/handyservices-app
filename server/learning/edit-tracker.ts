/**
 * Edit Tracker - Learns from Ben's corrections
 *
 * Aggregates patterns from Ben's edits to conversation memory,
 * enabling future auto-corrections and prompt improvements.
 */
import { db } from '../db';
import { conversationMemory } from '@shared/schema';
import type { BenEdit } from '@shared/conversation-memory';

// ==========================================
// TYPES
// ==========================================

export interface EditPattern {
  /** JSON path to the field that was edited */
  field: string;
  /** Serialized before value (for matching) */
  beforePattern: string;
  /** Serialized after value (the correction) */
  afterPattern: string;
  /** How many times this exact edit has been made */
  frequency: number;
  /** When this pattern was last seen */
  lastSeen: string;
}

export interface FieldEditStats {
  /** Base field name (without array indices) */
  field: string;
  /** Number of memories where this field was edited */
  editCount: number;
  /** Edit rate as fraction of total memories */
  editRate: number;
}

export interface AutoCorrection {
  /** Field to auto-correct */
  field: string;
  /** Suggested new value */
  suggested: unknown;
  /** Human-readable reason */
  reason: string;
  /** Confidence 0-1 */
  confidence: number;
}

// ==========================================
// PATTERN EXTRACTION
// ==========================================

/**
 * Extract edit patterns from all conversation memories.
 * Returns patterns that appear at least `minFrequency` times.
 */
export async function getEditPatterns(minFrequency = 3): Promise<EditPattern[]> {
  const memories = await db.select({
    benEdits: conversationMemory.benEdits,
  }).from(conversationMemory);

  const patternMap = new Map<string, EditPattern>();

  for (const m of memories) {
    const edits = (m.benEdits ?? []) as BenEdit[];

    for (const edit of edits) {
      // Create a unique key for this exact transformation
      const key = `${edit.field}::${JSON.stringify(edit.before)}::${JSON.stringify(edit.after)}`;
      const existing = patternMap.get(key);

      if (existing) {
        existing.frequency++;
        existing.lastSeen = edit.editedAt;
      } else {
        patternMap.set(key, {
          field: edit.field,
          beforePattern: JSON.stringify(edit.before),
          afterPattern: JSON.stringify(edit.after),
          frequency: 1,
          lastSeen: edit.editedAt,
        });
      }
    }
  }

  // Filter by minimum frequency and sort by frequency desc
  return Array.from(patternMap.values())
    .filter(p => p.frequency >= minFrequency)
    .sort((a, b) => b.frequency - a.frequency);
}

/**
 * Get edit frequency by field (aggregated across all memories).
 * Returns the rate at which each field is edited.
 */
export async function getFieldEditRate(): Promise<Record<string, number>> {
  const memories = await db.select({
    benEdits: conversationMemory.benEdits,
  }).from(conversationMemory);

  const fieldCounts: Record<string, number> = {};
  let totalMemories = 0;

  for (const m of memories) {
    totalMemories++;
    const edits = (m.benEdits ?? []) as BenEdit[];

    // Track unique fields edited per memory (not total edits)
    const fieldsEdited = new Set(
      edits.map(e => e.field.split('[')[0]) // Strip array indices for grouping
    );

    for (const field of fieldsEdited) {
      fieldCounts[field] = (fieldCounts[field] ?? 0) + 1;
    }
  }

  // Convert to rates
  const rates: Record<string, number> = {};
  if (totalMemories > 0) {
    for (const [field, count] of Object.entries(fieldCounts)) {
      rates[field] = count / totalMemories;
    }
  }

  return rates;
}

/**
 * Get detailed field edit statistics sorted by edit rate.
 */
export async function getFieldEditStats(): Promise<FieldEditStats[]> {
  const rates = await getFieldEditRate();

  const memories = await db.select({
    benEdits: conversationMemory.benEdits,
  }).from(conversationMemory);

  // Count actual edits per field
  const editCounts: Record<string, number> = {};
  for (const m of memories) {
    const edits = (m.benEdits ?? []) as BenEdit[];
    for (const edit of edits) {
      const baseField = edit.field.split('[')[0];
      editCounts[baseField] = (editCounts[baseField] ?? 0) + 1;
    }
  }

  return Object.entries(rates)
    .map(([field, rate]) => ({
      field,
      editCount: editCounts[field] ?? 0,
      editRate: rate,
    }))
    .sort((a, b) => b.editRate - a.editRate);
}

// ==========================================
// AUTO-CORRECTION SUGGESTIONS
// ==========================================

/**
 * Traverse object by JSON path (supports array notation).
 */
function getFieldValue(obj: unknown, path: string): unknown {
  const parts = path.split(/[.\[\]]/).filter(Boolean);
  let current: unknown = obj;

  for (const part of parts) {
    if (current == null || typeof current !== 'object') {
      return undefined;
    }
    current = (current as Record<string, unknown>)[part];
  }

  return current;
}

/**
 * Suggest auto-corrections for a memory based on learned patterns.
 * Only suggests corrections for high-confidence patterns.
 */
export async function suggestAutoCorrections(
  memory: unknown,
  minFrequency = 5
): Promise<AutoCorrection[]> {
  const patterns = await getEditPatterns(minFrequency);
  const suggestions: AutoCorrection[] = [];

  for (const pattern of patterns) {
    const currentValue = getFieldValue(memory, pattern.field);

    // Check if current value matches the "before" pattern
    if (JSON.stringify(currentValue) === pattern.beforePattern) {
      // Calculate confidence based on frequency (max at 20 occurrences)
      const confidence = Math.min(pattern.frequency / 20, 1);

      suggestions.push({
        field: pattern.field,
        suggested: JSON.parse(pattern.afterPattern),
        reason: `Ben changed this ${pattern.frequency} time${pattern.frequency === 1 ? '' : 's'} before`,
        confidence,
      });
    }
  }

  return suggestions.sort((a, b) => b.confidence - a.confidence);
}

// ==========================================
// AGGREGATION HELPERS
// ==========================================

/**
 * Get total number of edits across all memories.
 */
export async function getTotalEditCount(): Promise<number> {
  const memories = await db.select({
    benEdits: conversationMemory.benEdits,
  }).from(conversationMemory);

  let total = 0;
  for (const m of memories) {
    const edits = (m.benEdits ?? []) as BenEdit[];
    total += edits.length;
  }

  return total;
}

/**
 * Get number of memories that have been edited.
 */
export async function getEditedMemoryCount(): Promise<number> {
  const memories = await db.select({
    benEdits: conversationMemory.benEdits,
  }).from(conversationMemory);

  let count = 0;
  for (const m of memories) {
    const edits = (m.benEdits ?? []) as BenEdit[];
    if (edits.length > 0) count++;
  }

  return count;
}

/**
 * Get recent edits (for display/debugging).
 */
export async function getRecentEdits(limit = 50): Promise<BenEdit[]> {
  const memories = await db.select({
    benEdits: conversationMemory.benEdits,
  }).from(conversationMemory);

  const allEdits: BenEdit[] = [];
  for (const m of memories) {
    const edits = (m.benEdits ?? []) as BenEdit[];
    allEdits.push(...edits);
  }

  // Sort by editedAt descending and take limit
  return allEdits
    .sort((a, b) => new Date(b.editedAt).getTime() - new Date(a.editedAt).getTime())
    .slice(0, limit);
}
