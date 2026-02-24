/**
 * Pipeline WebSocket Events
 *
 * Broadcasts real-time updates to connected dashboard clients.
 * Used by the Pipeline Home dashboard for live updates.
 */

import { broadcastToClients } from "./index";

// Event Types
export type PipelineEventType =
    | 'pipeline:alert'
    | 'pipeline:alert_resolved'
    | 'pipeline:activity'
    | 'pipeline:counts_updated'
    | 'pipeline:lead_stage_change';

/**
 * Broadcast a new pipeline alert
 */
export function broadcastPipelineAlert(alert: {
    id: string;
    type: 'sla_breach' | 'customer_reply' | 'payment_issue';
    severity: 'high' | 'medium' | 'low';
    leadId: string;
    customerName: string;
    message: string;
    data?: Record<string, any>;
}) {
    try {
        broadcastToClients({
            type: 'pipeline:alert',
            data: {
                ...alert,
                createdAt: new Date().toISOString(),
            },
            timestamp: new Date().toISOString(),
        });
        console.log(`[Pipeline-WS] Alert broadcast: ${alert.type} - ${alert.message.substring(0, 50)}`);
    } catch (error) {
        console.error('[Pipeline-WS] Failed to broadcast alert:', error);
    }
}

/**
 * Broadcast that an alert has been resolved
 */
export function broadcastAlertResolved(alertId: string, reason?: string) {
    try {
        broadcastToClients({
            type: 'pipeline:alert_resolved',
            data: {
                alertId,
                reason,
            },
            timestamp: new Date().toISOString(),
        });
        console.log(`[Pipeline-WS] Alert resolved: ${alertId}`);
    } catch (error) {
        console.error('[Pipeline-WS] Failed to broadcast alert resolution:', error);
    }
}

/**
 * Broadcast a new activity event
 */
export function broadcastPipelineActivity(activity: {
    type: 'call_started' | 'call_ended' | 'automation_sent' | 'quote_sent' | 'quote_viewed' | 'quote_selected' | 'payment_received' | 'payment_failed' | 'stage_change';
    leadId: string | null;
    customerName: string;
    summary: string;
    icon?: string;
    data?: Record<string, any>;
}) {
    try {
        broadcastToClients({
            type: 'pipeline:activity',
            data: {
                id: `activity_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                ...activity,
                timestamp: new Date().toISOString(),
            },
            timestamp: new Date().toISOString(),
        });
        console.log(`[Pipeline-WS] Activity broadcast: ${activity.type} - ${activity.summary.substring(0, 50)}`);
    } catch (error) {
        console.error('[Pipeline-WS] Failed to broadcast activity:', error);
    }
}

/**
 * Broadcast updated stage counts
 */
export function broadcastCountsUpdated(counts: Record<string, number>) {
    try {
        broadcastToClients({
            type: 'pipeline:counts_updated',
            data: {
                counts,
                total: Object.values(counts).reduce((sum, count) => sum + count, 0),
            },
            timestamp: new Date().toISOString(),
        });
        console.log('[Pipeline-WS] Counts updated broadcast');
    } catch (error) {
        console.error('[Pipeline-WS] Failed to broadcast counts update:', error);
    }
}

/**
 * Broadcast a lead stage change
 */
export function broadcastLeadStageChange(data: {
    leadId: string;
    customerName: string;
    previousStage: string | null;
    newStage: string;
    route?: string | null;
}) {
    try {
        broadcastToClients({
            type: 'pipeline:lead_stage_change',
            data: {
                ...data,
                timestamp: new Date().toISOString(),
            },
            timestamp: new Date().toISOString(),
        });
        console.log(`[Pipeline-WS] Lead stage change: ${data.leadId} ${data.previousStage || 'null'} -> ${data.newStage}`);
    } catch (error) {
        console.error('[Pipeline-WS] Failed to broadcast lead stage change:', error);
    }
}
