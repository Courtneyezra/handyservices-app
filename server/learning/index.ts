/**
 * Learning Module - Tracks and learns from Ben's corrections
 */
export {
  getEditPatterns,
  getFieldEditRate,
  getFieldEditStats,
  suggestAutoCorrections,
  getTotalEditCount,
  getEditedMemoryCount,
  getRecentEdits,
  type EditPattern,
  type FieldEditStats,
  type AutoCorrection,
} from './edit-tracker';

export {
  generateLearningReport,
  getLearningDashboardSummary,
  getFieldImprovementSuggestions,
  type LearningReport,
  type LearningRecommendation,
  type AutoCorrectCandidate,
} from './analytics';
