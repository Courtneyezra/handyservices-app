/**
 * Flow Engine
 *
 * Main execution engine for troubleshooting flows. Manages session state,
 * processes user responses, and determines transitions between steps.
 */

import { db } from '../db';
import { troubleshootingSessions, tenantIssues, deflectionMetrics } from '@shared/schema';
import { eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import {
    TroubleshootingFlow,
    FlowStep,
    TransitionAction,
    TransitionCondition,
    StepHistoryEntry,
    TroubleshootingOutcome
} from './flow-schema';
import { interpretUserResponse, ResponseInterpretation, extractDataFromMessage } from './response-interpreter';
import { FLOW_REGISTRY, getFlowById, findFlowByKeywords } from './flows';

/**
 * Result returned by the flow engine after processing
 */
export interface FlowEngineResult {
    response: string;
    sessionStatus: 'active' | 'resolved' | 'escalated';
    outcome?: TroubleshootingOutcome;
    nextStepId?: string;
    dataToCollect?: string[];
}

/**
 * Session state loaded from database
 */
interface SessionState {
    id: string;
    issueId: string | null;
    flowId: string;
    currentStepId: string | null;
    stepHistory: StepHistoryEntry[];
    status: 'active' | 'paused' | 'completed' | 'escalated' | 'abandoned';
    attemptCount: number;
    maxAttempts: number;
    collectedData: Record<string, unknown>;
}

/**
 * Main Flow Engine class
 */
export class FlowEngine {
    /**
     * Start a new troubleshooting session
     */
    async startSession(
        issueId: string,
        flowId: string,
        initialMessage: string
    ): Promise<FlowEngineResult> {
        console.log('[FlowEngine] Starting session:', { issueId, flowId });

        const flow = getFlowById(flowId);
        if (!flow) {
            console.error('[FlowEngine] Flow not found:', flowId);
            return {
                response: "I'm sorry, I couldn't find the right troubleshooting guide for this issue. Let me connect you with our team.",
                sessionStatus: 'escalated',
                outcome: 'escalated_complex'
            };
        }

        // Create session in database
        const sessionId = nanoid();
        const firstStep = flow.steps[0];

        try {
            await db.insert(troubleshootingSessions).values({
                id: sessionId,
                issueId,
                flowId,
                currentStepId: firstStep.id,
                stepHistory: [],
                status: 'active',
                attemptCount: 0,
                maxAttempts: flow.maxAttempts,
                collectedData: {},
                startedAt: new Date(),
                lastActivityAt: new Date()
            });

            console.log('[FlowEngine] Session created:', sessionId);

            // Update tenant issue status to ai_helping
            if (issueId) {
                await db.update(tenantIssues)
                    .set({
                        status: 'ai_helping',
                        aiResolutionAttempted: true,
                        updatedAt: new Date()
                    })
                    .where(eq(tenantIssues.id, issueId));
            }

            // Build welcome message with safety warning if applicable
            let welcomeMessage = `Let me help you troubleshoot this issue. This usually takes about ${flow.estimatedTimeMinutes} minutes.\n\n`;

            if (flow.safetyWarning) {
                welcomeMessage += `**Safety Note**: ${flow.safetyWarning}\n\n`;
            }

            welcomeMessage += firstStep.template;

            return {
                response: welcomeMessage,
                sessionStatus: 'active',
                nextStepId: firstStep.id
            };

        } catch (error) {
            console.error('[FlowEngine] Failed to create session:', error);
            return {
                response: "I encountered an error starting the troubleshooting session. Let me connect you with our team.",
                sessionStatus: 'escalated',
                outcome: 'escalated_complex'
            };
        }
    }

    /**
     * Process a user response in an existing session
     */
    async processResponse(
        sessionId: string,
        userMessage: string,
        mediaUrls?: string[]
    ): Promise<FlowEngineResult> {
        console.log('[FlowEngine] Processing response:', {
            sessionId,
            userMessage: userMessage.substring(0, 100),
            hasMedia: mediaUrls && mediaUrls.length > 0
        });

        // Load session state
        const session = await this.loadSession(sessionId);
        if (!session) {
            console.error('[FlowEngine] Session not found:', sessionId);
            return {
                response: "I couldn't find your troubleshooting session. Would you like to start over?",
                sessionStatus: 'escalated',
                outcome: 'abandoned'
            };
        }

        if (session.status !== 'active') {
            return {
                response: "This troubleshooting session has already ended. Would you like to start a new one?",
                sessionStatus: session.status === 'completed' ? 'resolved' : 'escalated',
                outcome: session.status === 'completed' ? 'resolved_diy' : 'abandoned'
            };
        }

        // Load the flow definition
        const flow = getFlowById(session.flowId);
        if (!flow) {
            return {
                response: "I couldn't load the troubleshooting guide. Let me connect you with our team.",
                sessionStatus: 'escalated',
                outcome: 'escalated_complex'
            };
        }

        // Find current step
        const currentStep = flow.steps.find(s => s.id === session.currentStepId);
        if (!currentStep) {
            return {
                response: "I lost track of where we were. Let me connect you with our team.",
                sessionStatus: 'escalated',
                outcome: 'escalated_complex'
            };
        }

        // Interpret user response
        const interpretation = await interpretUserResponse(
            userMessage,
            currentStep,
            session.collectedData
        );

        // Check for media if this step expects it
        if (mediaUrls && mediaUrls.length > 0) {
            interpretation.mediaReceived = {
                type: mediaUrls[0].match(/\.(mp4|mov|avi|webm)$/i) ? 'video' : 'photo',
                url: mediaUrls[0]
            };
        }

        // Determine transition based on interpretation
        const transition = this.determineTransition(
            currentStep,
            interpretation,
            session.attemptCount + 1,
            session.maxAttempts
        );

        // Execute the transition action
        const result = await this.executeTransition(
            session,
            flow,
            currentStep,
            transition,
            userMessage,
            interpretation
        );

        return result;
    }

    /**
     * Load session state from database
     */
    private async loadSession(sessionId: string): Promise<SessionState | null> {
        try {
            const sessions = await db
                .select()
                .from(troubleshootingSessions)
                .where(eq(troubleshootingSessions.id, sessionId))
                .limit(1);

            if (sessions.length === 0) {
                return null;
            }

            const s = sessions[0];
            return {
                id: s.id,
                issueId: s.issueId,
                flowId: s.flowId,
                currentStepId: s.currentStepId,
                stepHistory: (s.stepHistory as StepHistoryEntry[]) || [],
                status: s.status as SessionState['status'],
                attemptCount: s.attemptCount || 0,
                maxAttempts: s.maxAttempts || 3,
                collectedData: (s.collectedData as Record<string, unknown>) || {}
            };
        } catch (error) {
            console.error('[FlowEngine] Failed to load session:', error);
            return null;
        }
    }

    /**
     * Determine which transition to take based on the user's response
     */
    private determineTransition(
        step: FlowStep,
        interpretation: ResponseInterpretation,
        currentAttempt: number,
        maxAttempts: number
    ): TransitionAction {
        console.log('[FlowEngine] Determining transition:', {
            stepId: step.id,
            matchedResponseId: interpretation.matchedResponseId,
            confidence: interpretation.confidence,
            currentAttempt,
            maxAttempts
        });

        // Check each transition condition
        for (const transition of step.transitions) {
            if (this.evaluateCondition(transition.condition, interpretation, currentAttempt)) {
                console.log('[FlowEngine] Transition matched:', transition.action);
                return transition.action;
            }
        }

        // Check if we've exceeded max attempts
        if (currentAttempt >= maxAttempts) {
            console.log('[FlowEngine] Max attempts exceeded, using fallback');
            return step.fallbackTransition.action;
        }

        // If frustrated, might want to escalate
        if (interpretation.sentiment === 'frustrated' && currentAttempt > 1) {
            return {
                type: 'escalate',
                reason: 'User appears frustrated with troubleshooting process',
                collectData: []
            };
        }

        // Need clarification
        if (interpretation.needsClarification || interpretation.confidence < 0.6) {
            return {
                type: 'retry_step',
                message: "I'm not quite sure I understood. Could you try rephrasing that?"
            };
        }

        // Default to fallback
        return step.fallbackTransition.action;
    }

    /**
     * Evaluate a transition condition
     */
    private evaluateCondition(
        condition: TransitionCondition,
        interpretation: ResponseInterpretation,
        currentAttempt: number
    ): boolean {
        switch (condition.type) {
            case 'always':
                return true;

            case 'response_matches':
                return interpretation.matchedResponseId === condition.responseId &&
                       interpretation.confidence >= 0.7;

            case 'attempt_count_exceeds':
                return currentAttempt > condition.count;

            case 'media_received':
                return interpretation.mediaReceived?.type === condition.mediaType;

            case 'expression':
                // Simple expression evaluation - could be extended
                try {
                    // Only allow safe expressions
                    if (condition.expr.includes('confidence')) {
                        return interpretation.confidence >= 0.8;
                    }
                    return false;
                } catch {
                    return false;
                }

            default:
                return false;
        }
    }

    /**
     * Execute a transition action and return the result
     */
    private async executeTransition(
        session: SessionState,
        flow: TroubleshootingFlow,
        currentStep: FlowStep,
        action: TransitionAction,
        userMessage: string,
        interpretation: ResponseInterpretation
    ): Promise<FlowEngineResult> {
        console.log('[FlowEngine] Executing transition:', action);

        // Record step history
        const historyEntry: StepHistoryEntry = {
            stepId: currentStep.id,
            timestamp: new Date(),
            userResponse: userMessage,
            interpretedAs: interpretation.matchedResponseId || 'unrecognized',
            actionTaken: action.type
        };

        const newHistory = [...session.stepHistory, historyEntry];
        const newCollectedData = {
            ...session.collectedData,
            ...interpretation.extractedData
        };

        switch (action.type) {
            case 'goto_step': {
                const nextStep = flow.steps.find(s => s.id === action.stepId);
                if (!nextStep) {
                    return this.handleEscalation(session, 'Step not found in flow', []);
                }

                await this.updateSession(session.id, {
                    currentStepId: action.stepId,
                    stepHistory: newHistory,
                    collectedData: newCollectedData,
                    attemptCount: 0 // Reset attempts for new step
                });

                return {
                    response: nextStep.template,
                    sessionStatus: 'active',
                    nextStepId: action.stepId
                };
            }

            case 'resolve': {
                await this.completeSession(session, 'resolved_diy', action.resolution);

                return {
                    response: `Great news! ${action.resolution}\n\nIf you have any other issues, just let me know!`,
                    sessionStatus: 'resolved',
                    outcome: 'resolved_diy'
                };
            }

            case 'escalate': {
                return this.handleEscalation(session, action.reason, action.collectData);
            }

            case 'retry_step': {
                await this.updateSession(session.id, {
                    attemptCount: session.attemptCount + 1,
                    stepHistory: newHistory,
                    collectedData: newCollectedData
                });

                const retryMessage = action.message ||
                    "I'm not sure I understood that. Let me ask again:\n\n" + currentStep.template;

                return {
                    response: retryMessage,
                    sessionStatus: 'active',
                    nextStepId: currentStep.id
                };
            }

            case 'end_flow': {
                await this.completeSession(session, action.outcome, 'Flow ended');

                const outcomeMessages: Record<TroubleshootingOutcome, string> = {
                    resolved_diy: "Glad we could fix it together!",
                    needs_callout: "It looks like this needs a professional visit. I'll arrange that for you.",
                    escalated_complex: "This seems more complex than expected. I'll get our team to help.",
                    escalated_safety: "For safety reasons, I'm connecting you with a professional.",
                    abandoned: "No problem. Let me know if you'd like to try again later."
                };

                return {
                    response: outcomeMessages[action.outcome],
                    sessionStatus: action.outcome === 'resolved_diy' ? 'resolved' : 'escalated',
                    outcome: action.outcome
                };
            }

            default:
                return this.handleEscalation(session, 'Unknown action type', []);
        }
    }

    /**
     * Handle escalation to human support
     */
    private async handleEscalation(
        session: SessionState,
        reason: string,
        collectData: string[]
    ): Promise<FlowEngineResult> {
        console.log('[FlowEngine] Escalating:', { reason, collectData });

        await this.completeSession(session, 'escalated_complex', reason);

        // Update tenant issue status
        if (session.issueId) {
            await db.update(tenantIssues)
                .set({
                    status: 'awaiting_details',
                    aiResolutionAccepted: false,
                    updatedAt: new Date()
                })
                .where(eq(tenantIssues.id, session.issueId));
        }

        let message = "I've reached the limits of what I can help with remotely. ";

        if (collectData.length > 0) {
            message += `To help the technician, could you provide:\n`;
            collectData.forEach((item, i) => {
                message += `${i + 1}. ${item}\n`;
            });
        } else {
            message += "I'll connect you with our team who can arrange a visit.";
        }

        return {
            response: message,
            sessionStatus: 'escalated',
            outcome: 'escalated_complex',
            dataToCollect: collectData
        };
    }

    /**
     * Update session state in database
     */
    private async updateSession(
        sessionId: string,
        updates: Partial<{
            currentStepId: string;
            stepHistory: StepHistoryEntry[];
            collectedData: Record<string, unknown>;
            attemptCount: number;
            status: string;
        }>
    ): Promise<void> {
        try {
            // Build update object explicitly to satisfy Drizzle types
            const updateData: Record<string, unknown> = {
                lastActivityAt: new Date()
            };
            if (updates.currentStepId !== undefined) updateData.currentStepId = updates.currentStepId;
            if (updates.stepHistory !== undefined) updateData.stepHistory = updates.stepHistory;
            if (updates.collectedData !== undefined) updateData.collectedData = updates.collectedData;
            if (updates.attemptCount !== undefined) updateData.attemptCount = updates.attemptCount;
            if (updates.status !== undefined) updateData.status = updates.status;

            await db.update(troubleshootingSessions)
                .set(updateData as any)
                .where(eq(troubleshootingSessions.id, sessionId));
        } catch (error) {
            console.error('[FlowEngine] Failed to update session:', error);
        }
    }

    /**
     * Complete a session and record metrics
     */
    private async completeSession(
        session: SessionState,
        outcome: TroubleshootingOutcome,
        reason: string
    ): Promise<void> {
        try {
            // Update session
            await db.update(troubleshootingSessions)
                .set({
                    status: outcome === 'resolved_diy' ? 'completed' : 'escalated',
                    outcome,
                    outcomeReason: reason,
                    completedAt: new Date(),
                    lastActivityAt: new Date()
                })
                .where(eq(troubleshootingSessions.id, session.id));

            // Record deflection metrics
            const flow = getFlowById(session.flowId);
            const wasDeflected = outcome === 'resolved_diy';

            await db.insert(deflectionMetrics).values({
                id: nanoid(),
                issueId: session.issueId,
                sessionId: session.id,
                issueCategory: flow?.category,
                flowId: session.flowId,
                wasDeflected,
                deflectionType: wasDeflected ? 'diy_resolved' : undefined,
                stepsCompleted: session.stepHistory.length,
                totalStepsInFlow: flow?.steps.length || 0,
                timeToResolutionMs: session.stepHistory.length > 0
                    ? Date.now() - new Date(session.stepHistory[0].timestamp).getTime()
                    : 0,
                createdAt: new Date()
            });

            // Update tenant issue if resolved
            if (session.issueId && outcome === 'resolved_diy') {
                await db.update(tenantIssues)
                    .set({
                        status: 'resolved_diy',
                        aiResolutionAccepted: true,
                        resolvedAt: new Date(),
                        updatedAt: new Date()
                    })
                    .where(eq(tenantIssues.id, session.issueId));
            }

            console.log('[FlowEngine] Session completed:', {
                sessionId: session.id,
                outcome,
                wasDeflected
            });

        } catch (error) {
            console.error('[FlowEngine] Failed to complete session:', error);
        }
    }
}

// Export singleton instance
export const flowEngine = new FlowEngine();

/**
 * Select the best flow for a given issue based on category and description
 */
export function selectFlowForIssue(
    category: string,
    description: string
): string | null {
    console.log('[FlowEngine] Selecting flow for issue:', { category, description });

    // Extract keywords from description
    const keywords = description.toLowerCase().split(/\s+/);

    // First try to match by keywords
    const keywordMatch = findFlowByKeywords(keywords);
    if (keywordMatch) {
        console.log('[FlowEngine] Found flow by keywords:', keywordMatch);
        return keywordMatch;
    }

    // Fall back to category-based matching
    for (const [flowId, flow] of Object.entries(FLOW_REGISTRY)) {
        if (flow.category === category) {
            console.log('[FlowEngine] Found flow by category:', flowId);
            return flowId;
        }
    }

    console.log('[FlowEngine] No matching flow found');
    return null;
}
