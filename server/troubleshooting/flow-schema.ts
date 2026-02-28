/**
 * Troubleshooting Flow Schema
 *
 * TypeScript interfaces for defining troubleshooting flows that guide
 * tenants through DIY resolution steps before escalating to a callout.
 */

import { IssueCategory, TroubleshootingOutcome } from '@shared/schema';

/**
 * A complete troubleshooting flow definition
 */
export interface TroubleshootingFlow {
    id: string;
    name: string;
    description: string;
    category: IssueCategory;
    triggerKeywords: string[];
    safeForDIY: boolean;
    safetyWarning?: string;
    maxAttempts: number;
    estimatedTimeMinutes: number;
    steps: FlowStep[];
    escalationDataNeeded: string[];
}

/**
 * A single step in a troubleshooting flow
 */
export interface FlowStep {
    id: string;
    type: 'question' | 'instruction' | 'confirmation' | 'media_request' | 'branch';
    template: string;
    mediaUrl?: string;
    expectedResponses?: ExpectedResponse[];
    confirmationRequired?: boolean;
    transitions: StepTransition[];
    fallbackTransition: StepTransition;
}

/**
 * Expected user response patterns for a step
 */
export interface ExpectedResponse {
    id: string;
    patterns: string[];
    semanticMatch?: string;
    examples: string[];
}

/**
 * A transition between steps based on conditions
 */
export interface StepTransition {
    condition: TransitionCondition;
    action: TransitionAction;
}

/**
 * Conditions that trigger transitions
 */
export type TransitionCondition =
    | { type: 'response_matches'; responseId: string }
    | { type: 'always' }
    | { type: 'attempt_count_exceeds'; count: number }
    | { type: 'media_received'; mediaType: 'photo' | 'video' }
    | { type: 'expression'; expr: string };

/**
 * Actions to take when a transition condition is met
 */
export type TransitionAction =
    | { type: 'goto_step'; stepId: string }
    | { type: 'resolve'; resolution: string }
    | { type: 'escalate'; reason: string; collectData: string[] }
    | { type: 'retry_step'; message?: string }
    | { type: 'end_flow'; outcome: TroubleshootingOutcome };

/**
 * Re-export TroubleshootingOutcome for convenience
 */
export type { TroubleshootingOutcome };

/**
 * Step history entry for session tracking
 */
export interface StepHistoryEntry {
    stepId: string;
    timestamp: Date;
    userResponse: string;
    interpretedAs: string;
    actionTaken: string;
}
