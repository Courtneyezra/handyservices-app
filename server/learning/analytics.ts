/**
 * Learning Analytics - Generates insights from Ben's edit patterns
 *
 * Produces actionable recommendations for improving prompts and
 * identifying candidates for auto-correction.
 */
import {
  getEditPatterns,
  getFieldEditStats,
  getTotalEditCount,
  getEditedMemoryCount,
  type EditPattern,
  type FieldEditStats,
} from './edit-tracker';
import { db } from '../db';
import { conversationMemory } from '@shared/schema';
import { count } from 'drizzle-orm';

// ==========================================
// TYPES
// ==========================================

export interface AutoCorrectCandidate {
  /** Human-readable description of the pattern */
  pattern: string;
  /** How many times this correction has been made */
  frequency: number;
  /** Confidence level 0-1 */
  confidence: number;
  /** The field being corrected */
  field: string;
}

export interface LearningRecommendation {
  /** Priority: high/medium/low */
  priority: 'high' | 'medium' | 'low';
  /** Category of recommendation */
  category: 'prompt_improvement' | 'auto_correction' | 'review_process' | 'data_quality';
  /** Human-readable recommendation */
  message: string;
  /** Related field or pattern */
  context?: string;
}

export interface LearningReport {
  /** Total number of memories processed */
  totalMemories: number;
  /** Number of memories with at least one edit */
  editedMemories: number;
  /** Overall edit rate (edited/total) */
  editRate: number;
  /** Total number of individual edits */
  totalEdits: number;
  /** Fields sorted by edit frequency */
  topEditedFields: FieldEditStats[];
  /** Patterns that could be auto-corrected */
  autoCorrectCandidates: AutoCorrectCandidate[];
  /** Actionable recommendations */
  recommendations: LearningRecommendation[];
  /** When this report was generated */
  generatedAt: string;
}

// ==========================================
// REPORT GENERATION
// ==========================================

/**
 * Generate a comprehensive learning report.
 * Analyzes edit patterns and produces actionable recommendations.
 */
export async function generateLearningReport(): Promise<LearningReport> {
  // Gather raw data
  const [
    totalMemoriesResult,
    editedMemoryCount,
    totalEdits,
    fieldStats,
    patterns,
  ] = await Promise.all([
    db.select({ count: count() }).from(conversationMemory),
    getEditedMemoryCount(),
    getTotalEditCount(),
    getFieldEditStats(),
    getEditPatterns(3), // Patterns with 3+ occurrences
  ]);

  const totalMemories = totalMemoriesResult[0]?.count ?? 0;
  const editRate = totalMemories > 0 ? editedMemoryCount / totalMemories : 0;

  // Build auto-correct candidates from high-frequency patterns
  const autoCorrectCandidates = patterns
    .filter(p => p.frequency >= 5)
    .map(p => ({
      pattern: formatPatternDescription(p),
      frequency: p.frequency,
      confidence: Math.min(p.frequency / 20, 1),
      field: p.field,
    }))
    .slice(0, 10); // Top 10 candidates

  // Generate recommendations
  const recommendations = generateRecommendations(
    fieldStats,
    patterns,
    editRate,
    autoCorrectCandidates
  );

  return {
    totalMemories,
    editedMemories: editedMemoryCount,
    editRate,
    totalEdits,
    topEditedFields: fieldStats.slice(0, 10),
    autoCorrectCandidates,
    recommendations,
    generatedAt: new Date().toISOString(),
  };
}

// ==========================================
// RECOMMENDATION ENGINE
// ==========================================

function generateRecommendations(
  fieldStats: FieldEditStats[],
  patterns: EditPattern[],
  editRate: number,
  autoCorrectCandidates: AutoCorrectCandidate[]
): LearningRecommendation[] {
  const recommendations: LearningRecommendation[] = [];

  // High edit rate fields -> prompt improvements needed
  for (const { field, editRate: fieldEditRate } of fieldStats) {
    if (fieldEditRate > 0.5) {
      recommendations.push({
        priority: 'high',
        category: 'prompt_improvement',
        message: `Field "${field}" is edited ${Math.round(fieldEditRate * 100)}% of the time. The extraction prompt may need improvement.`,
        context: field,
      });
    } else if (fieldEditRate > 0.3) {
      recommendations.push({
        priority: 'medium',
        category: 'prompt_improvement',
        message: `Field "${field}" is edited ${Math.round(fieldEditRate * 100)}% of the time. Consider reviewing the extraction logic.`,
        context: field,
      });
    }
  }

  // High-confidence auto-correct candidates
  for (const candidate of autoCorrectCandidates) {
    if (candidate.confidence >= 0.8) {
      recommendations.push({
        priority: 'high',
        category: 'auto_correction',
        message: `Pattern "${candidate.pattern}" has ${Math.round(candidate.confidence * 100)}% confidence. Consider enabling auto-correction.`,
        context: candidate.field,
      });
    } else if (candidate.confidence >= 0.5) {
      recommendations.push({
        priority: 'medium',
        category: 'auto_correction',
        message: `Pattern "${candidate.pattern}" appears ${candidate.frequency} times. May be a candidate for auto-correction with more data.`,
        context: candidate.field,
      });
    }
  }

  // Overall edit rate insights
  if (editRate > 0.7) {
    recommendations.push({
      priority: 'high',
      category: 'review_process',
      message: `${Math.round(editRate * 100)}% of quotes require edits. The agent pipeline may need significant tuning.`,
    });
  } else if (editRate < 0.2 && editRate > 0) {
    recommendations.push({
      priority: 'low',
      category: 'review_process',
      message: `Only ${Math.round(editRate * 100)}% of quotes need edits. The pipeline is performing well.`,
    });
  }

  // Specific field recommendations based on common patterns
  const scopeLineEdits = fieldStats.find(f => f.field === 'scope.lines');
  if (scopeLineEdits && scopeLineEdits.editRate > 0.4) {
    recommendations.push({
      priority: 'high',
      category: 'prompt_improvement',
      message: 'Job line titles are frequently edited. Consider improving the scoping worker prompt or adding more examples.',
      context: 'scope.lines',
    });
  }

  const pricingEdits = fieldStats.find(f => f.field === 'pricing');
  if (pricingEdits && pricingEdits.editRate > 0.3) {
    recommendations.push({
      priority: 'medium',
      category: 'data_quality',
      message: 'Pricing is frequently adjusted. Review material cost data and time estimates.',
      context: 'pricing',
    });
  }

  const draftEdits = fieldStats.find(f => f.field === 'draft.message');
  if (draftEdits && draftEdits.editRate > 0.5) {
    recommendations.push({
      priority: 'medium',
      category: 'prompt_improvement',
      message: 'Draft messages are frequently edited. The message worker may need tone/style adjustments.',
      context: 'draft.message',
    });
  }

  // Sort by priority
  const priorityOrder = { high: 0, medium: 1, low: 2 };
  return recommendations.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);
}

// ==========================================
// HELPERS
// ==========================================

function formatPatternDescription(pattern: EditPattern): string {
  const field = pattern.field;
  const before = truncate(pattern.beforePattern, 30);
  const after = truncate(pattern.afterPattern, 30);
  return `${field}: ${before} -> ${after}`;
}

function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen - 3) + '...';
}

// ==========================================
// SPECIALIZED REPORTS
// ==========================================

/**
 * Get a summary suitable for display in a dashboard.
 */
export async function getLearningDashboardSummary(): Promise<{
  editRate: number;
  topIssues: string[];
  autoCorrectReady: number;
}> {
  const report = await generateLearningReport();

  return {
    editRate: report.editRate,
    topIssues: report.recommendations
      .filter(r => r.priority === 'high')
      .slice(0, 3)
      .map(r => r.message),
    autoCorrectReady: report.autoCorrectCandidates
      .filter(c => c.confidence >= 0.8)
      .length,
  };
}

/**
 * Get field-specific improvement suggestions.
 */
export async function getFieldImprovementSuggestions(
  field: string
): Promise<{
  editRate: number;
  patterns: EditPattern[];
  suggestion: string;
}> {
  const [fieldStats, patterns] = await Promise.all([
    getFieldEditStats(),
    getEditPatterns(2),
  ]);

  const stats = fieldStats.find(f => f.field === field || field.startsWith(f.field));
  const fieldPatterns = patterns.filter(p => p.field === field || p.field.startsWith(field));

  let suggestion = 'No specific suggestions available.';
  const editRate = stats?.editRate ?? 0;

  if (editRate > 0.5) {
    suggestion = `This field is edited ${Math.round(editRate * 100)}% of the time. Consider reviewing the extraction prompt or adding more training examples.`;
  } else if (fieldPatterns.length > 0) {
    const topPattern = fieldPatterns[0];
    suggestion = `Common correction: ${topPattern.beforePattern} -> ${topPattern.afterPattern} (${topPattern.frequency} times)`;
  } else if (editRate > 0) {
    suggestion = `Edit rate is ${Math.round(editRate * 100)}%. Monitor for emerging patterns.`;
  }

  return {
    editRate,
    patterns: fieldPatterns.slice(0, 5),
    suggestion,
  };
}
