/**
 * Deflection Metrics Routes
 *
 * API routes for the troubleshooting deflection metrics dashboard.
 * Tracks success/failure rates, flow performance, and follow-up quality.
 */

import { Router } from 'express';
import { db } from '../db';
import { deflectionMetrics, troubleshootingSessions } from '@shared/schema';
import { sql, desc, eq, and, gte, count, avg, sum } from 'drizzle-orm';

const router = Router();

// ==========================================
// TYPE DEFINITIONS
// ==========================================

interface DeflectionStats {
    overall: {
        totalSessions: number;
        deflectedCount: number;
        escalatedCount: number;
        deflectionRate: number; // Percentage
        avgTimeToResolutionMs: number;
    };
    byCategory: Array<{
        category: string;
        totalSessions: number;
        deflectedCount: number;
        deflectionRate: number;
    }>;
    byFlow: Array<{
        flowId: string;
        totalSessions: number;
        deflectedCount: number;
        deflectionRate: number;
        avgStepsCompleted: number;
    }>;
    followUpRate: {
        totalDeflected: number;
        followedUp: number;
        followUpRate: number; // Percentage - lower is better (means DIY fix worked)
    };
}

interface FlowPerformance {
    flowId: string;
    totalSessions: number;
    completedSessions: number;
    escalatedSessions: number;
    abandonedSessions: number;
    deflectionRate: number;
    avgStepsCompleted: number;
    avgTimeToResolutionMs: number;
    commonEscalationReasons: Array<{
        reason: string;
        count: number;
    }>;
}

// ==========================================
// HELPER FUNCTIONS
// ==========================================

function getDateRange(days: number = 30): { start: Date; end: Date } {
    const end = new Date();
    const start = new Date();
    start.setDate(start.getDate() - days);
    return { start, end };
}

function parseDateRangeFromQuery(query: any): { start: Date; end: Date } {
    const days = parseInt(query.days) || 30;
    const startDate = query.startDate ? new Date(query.startDate) : undefined;
    const endDate = query.endDate ? new Date(query.endDate) : undefined;

    if (startDate && endDate) {
        return { start: startDate, end: endDate };
    }

    return getDateRange(days);
}

// ==========================================
// GET /api/admin/deflection-metrics
// Main deflection metrics endpoint
// ==========================================

router.get('/', async (req, res) => {
    try {
        const { start, end } = parseDateRangeFromQuery(req.query);

        // Overall deflection stats
        const [totalStats] = await db
            .select({
                totalSessions: count(),
                deflectedCount: sum(sql<number>`CASE WHEN ${deflectionMetrics.wasDeflected} = true THEN 1 ELSE 0 END`),
                avgTimeMs: avg(deflectionMetrics.timeToResolutionMs)
            })
            .from(deflectionMetrics)
            .where(
                and(
                    gte(deflectionMetrics.createdAt, start),
                    sql`${deflectionMetrics.createdAt} <= ${end}`
                )
            );

        const totalSessions = totalStats?.totalSessions || 0;
        const deflectedCount = Number(totalStats?.deflectedCount) || 0;
        const escalatedCount = totalSessions - deflectedCount;
        const deflectionRate = totalSessions > 0
            ? Math.round((deflectedCount / totalSessions) * 100 * 100) / 100
            : 0;
        const avgTimeToResolutionMs = Number(totalStats?.avgTimeMs) || 0;

        // By category breakdown
        const categoryStats = await db
            .select({
                category: deflectionMetrics.issueCategory,
                totalSessions: count(),
                deflectedCount: sum(sql<number>`CASE WHEN ${deflectionMetrics.wasDeflected} = true THEN 1 ELSE 0 END`)
            })
            .from(deflectionMetrics)
            .where(
                and(
                    gte(deflectionMetrics.createdAt, start),
                    sql`${deflectionMetrics.createdAt} <= ${end}`
                )
            )
            .groupBy(deflectionMetrics.issueCategory);

        const byCategory = categoryStats.map(row => ({
            category: row.category || 'unknown',
            totalSessions: row.totalSessions,
            deflectedCount: Number(row.deflectedCount) || 0,
            deflectionRate: row.totalSessions > 0
                ? Math.round((Number(row.deflectedCount) / row.totalSessions) * 100 * 100) / 100
                : 0
        }));

        // By flow breakdown
        const flowStats = await db
            .select({
                flowId: deflectionMetrics.flowId,
                totalSessions: count(),
                deflectedCount: sum(sql<number>`CASE WHEN ${deflectionMetrics.wasDeflected} = true THEN 1 ELSE 0 END`),
                avgSteps: avg(deflectionMetrics.stepsCompleted)
            })
            .from(deflectionMetrics)
            .where(
                and(
                    gte(deflectionMetrics.createdAt, start),
                    sql`${deflectionMetrics.createdAt} <= ${end}`
                )
            )
            .groupBy(deflectionMetrics.flowId);

        const byFlow = flowStats.map(row => ({
            flowId: row.flowId || 'unknown',
            totalSessions: row.totalSessions,
            deflectedCount: Number(row.deflectedCount) || 0,
            deflectionRate: row.totalSessions > 0
                ? Math.round((Number(row.deflectedCount) / row.totalSessions) * 100 * 100) / 100
                : 0,
            avgStepsCompleted: Math.round(Number(row.avgSteps) * 100) / 100 || 0
        }));

        // Follow-up rate (tenants who came back after DIY deflection = fix didn't work)
        const [followUpStats] = await db
            .select({
                totalDeflected: count(),
                followedUp: sum(sql<number>`CASE WHEN ${deflectionMetrics.hadFollowUp} = true THEN 1 ELSE 0 END`)
            })
            .from(deflectionMetrics)
            .where(
                and(
                    gte(deflectionMetrics.createdAt, start),
                    sql`${deflectionMetrics.createdAt} <= ${end}`,
                    eq(deflectionMetrics.wasDeflected, true)
                )
            );

        const totalDeflected = followUpStats?.totalDeflected || 0;
        const followedUp = Number(followUpStats?.followedUp) || 0;
        const followUpRate = totalDeflected > 0
            ? Math.round((followedUp / totalDeflected) * 100 * 100) / 100
            : 0;

        const response: DeflectionStats = {
            overall: {
                totalSessions,
                deflectedCount,
                escalatedCount,
                deflectionRate,
                avgTimeToResolutionMs: Math.round(avgTimeToResolutionMs)
            },
            byCategory,
            byFlow,
            followUpRate: {
                totalDeflected,
                followedUp,
                followUpRate
            }
        };

        res.json(response);
    } catch (error) {
        console.error('[DeflectionMetrics] Error fetching metrics:', error);
        res.status(500).json({ error: 'Failed to fetch deflection metrics' });
    }
});

// ==========================================
// GET /api/admin/deflection-metrics/flows
// Detailed flow performance stats
// ==========================================

router.get('/flows', async (req, res) => {
    try {
        const { start, end } = parseDateRangeFromQuery(req.query);

        // Get session data grouped by flow
        const flowData = await db
            .select({
                flowId: troubleshootingSessions.flowId,
                status: troubleshootingSessions.status,
                outcome: troubleshootingSessions.outcome,
                outcomeReason: troubleshootingSessions.outcomeReason
            })
            .from(troubleshootingSessions)
            .where(
                and(
                    gte(troubleshootingSessions.startedAt, start),
                    sql`${troubleshootingSessions.startedAt} <= ${end}`
                )
            );

        // Define session type for flow grouping
        type FlowSession = {
            flowId: string;
            status: string | null;
            outcome: string | null;
            outcomeReason: string | null;
        };

        // Group data by flowId
        const flowGroups: Record<string, FlowSession[]> = {};
        for (const session of flowData) {
            const flowId = session.flowId;
            if (!flowGroups[flowId]) {
                flowGroups[flowId] = [];
            }
            flowGroups[flowId].push(session);
        }

        // Get metrics from deflection_metrics table
        const metricsData = await db
            .select({
                flowId: deflectionMetrics.flowId,
                avgSteps: avg(deflectionMetrics.stepsCompleted),
                avgTimeMs: avg(deflectionMetrics.timeToResolutionMs)
            })
            .from(deflectionMetrics)
            .where(
                and(
                    gte(deflectionMetrics.createdAt, start),
                    sql`${deflectionMetrics.createdAt} <= ${end}`
                )
            )
            .groupBy(deflectionMetrics.flowId);

        const metricsMap = new Map(
            metricsData.map(m => [m.flowId, {
                avgSteps: Number(m.avgSteps) || 0,
                avgTimeMs: Number(m.avgTimeMs) || 0
            }])
        );

        // Build flow performance stats
        const flows: FlowPerformance[] = [];

        for (const flowId of Object.keys(flowGroups)) {
            const sessions = flowGroups[flowId];
            const totalSessions = sessions.length;
            const completedSessions = sessions.filter((s: FlowSession) => s.status === 'completed').length;
            const escalatedSessions = sessions.filter((s: FlowSession) => s.status === 'escalated').length;
            const abandonedSessions = sessions.filter((s: FlowSession) => s.status === 'abandoned').length;

            const deflectionRate = totalSessions > 0
                ? Math.round((completedSessions / totalSessions) * 100 * 100) / 100
                : 0;

            // Count escalation reasons
            const reasonCounts = new Map<string, number>();
            for (const session of sessions) {
                if (session.status === 'escalated' && session.outcomeReason) {
                    const reason = session.outcomeReason;
                    reasonCounts.set(reason, (reasonCounts.get(reason) || 0) + 1);
                }
            }

            const commonEscalationReasons = Array.from(reasonCounts.entries())
                .map(([reason, count]) => ({ reason, count }))
                .sort((a, b) => b.count - a.count)
                .slice(0, 5);

            const metrics = metricsMap.get(flowId) || { avgSteps: 0, avgTimeMs: 0 };

            flows.push({
                flowId,
                totalSessions,
                completedSessions,
                escalatedSessions,
                abandonedSessions,
                deflectionRate,
                avgStepsCompleted: Math.round(metrics.avgSteps * 100) / 100,
                avgTimeToResolutionMs: Math.round(metrics.avgTimeMs),
                commonEscalationReasons
            });
        }

        // Sort by total sessions (most used flows first)
        flows.sort((a, b) => b.totalSessions - a.totalSessions);

        res.json({ flows });
    } catch (error) {
        console.error('[DeflectionMetrics] Error fetching flow performance:', error);
        res.status(500).json({ error: 'Failed to fetch flow performance' });
    }
});

// ==========================================
// GET /api/admin/deflection-metrics/trends
// Time-based trends for deflection rates
// ==========================================

router.get('/trends', async (req, res) => {
    try {
        const { start, end } = parseDateRangeFromQuery(req.query);
        const period = (req.query.period as string) || 'daily';

        let periodFormat: string;
        switch (period) {
            case 'weekly':
                periodFormat = 'YYYY-WW';
                break;
            case 'monthly':
                periodFormat = 'YYYY-MM';
                break;
            default:
                periodFormat = 'YYYY-MM-DD';
        }

        const trendData = await db
            .select({
                period: sql<string>`to_char(${deflectionMetrics.createdAt}, ${periodFormat})`,
                totalSessions: count(),
                deflectedCount: sum(sql<number>`CASE WHEN ${deflectionMetrics.wasDeflected} = true THEN 1 ELSE 0 END`)
            })
            .from(deflectionMetrics)
            .where(
                and(
                    gte(deflectionMetrics.createdAt, start),
                    sql`${deflectionMetrics.createdAt} <= ${end}`
                )
            )
            .groupBy(sql`to_char(${deflectionMetrics.createdAt}, ${periodFormat})`)
            .orderBy(sql`to_char(${deflectionMetrics.createdAt}, ${periodFormat})`);

        const trends = trendData.map(row => ({
            period: row.period || 'Unknown',
            totalSessions: row.totalSessions,
            deflectedCount: Number(row.deflectedCount) || 0,
            deflectionRate: row.totalSessions > 0
                ? Math.round((Number(row.deflectedCount) / row.totalSessions) * 100 * 100) / 100
                : 0
        }));

        res.json({ trends });
    } catch (error) {
        console.error('[DeflectionMetrics] Error fetching trends:', error);
        res.status(500).json({ error: 'Failed to fetch deflection trends' });
    }
});

export default router;
