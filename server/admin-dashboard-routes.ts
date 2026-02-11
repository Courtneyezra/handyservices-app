import { Router } from 'express';
import { db } from './db';
import {
    leads,
    personalizedQuotes,
    invoices,
    contractorJobs,
    handymanProfiles,
    users,
    contractorReviews
} from '../shared/schema';
import { sql, eq, and, gte, lte, count, sum, avg, desc } from 'drizzle-orm';

export const adminDashboardRouter = Router();

// ==========================================
// TYPE DEFINITIONS
// ==========================================

interface DateRange {
    start: Date;
    end: Date;
}

interface DashboardStats {
    quotes: {
        thisWeek: number;
        thisMonth: number;
        allTime: number;
    };
    conversionRate: {
        quotesToBookings: number; // Percentage
        totalQuotes: number;
        totalBookings: number;
    };
    revenue: {
        depositsCollected: number; // In pence
        invoicesPaid: number; // In pence
        totalRevenue: number; // In pence
    };
    jobs: {
        pending: number;
        accepted: number;
        inProgress: number;
        completed: number;
        cancelled: number;
    };
    pendingFollowUp: {
        count: number;
        quotes: Array<{
            id: string;
            customerName: string;
            createdAt: Date | null;
            viewCount: number | null;
        }>;
    };
}

interface RevenueAnalytics {
    period: 'daily' | 'weekly' | 'monthly';
    breakdown: Array<{
        period: string;
        revenue: number;
        count: number;
    }>;
    bySegment: Array<{
        segment: string;
        revenue: number;
        count: number;
        averageValue: number;
    }>;
    paymentMethods: {
        stripeDeposits: number;
        balancePayments: number;
        other: number;
    };
}

interface ContractorPerformance {
    contractors: Array<{
        id: string;
        name: string;
        email: string;
        jobsCompleted: number;
        averageRating: number | null;
        revenueGenerated: number;
        availabilityPercentage: number;
    }>;
    summary: {
        totalContractors: number;
        activeContractors: number;
        totalJobsCompleted: number;
        averageJobsPerContractor: number;
    };
}

interface LeadFunnel {
    bySource: Array<{
        source: string;
        count: number;
        percentage: number;
    }>;
    byStatus: Array<{
        status: string;
        count: number;
        percentage: number;
    }>;
    conversionRates: {
        newToQuoted: number;
        quotedToBooked: number;
        bookedToCompleted: number;
        overallConversion: number;
    };
    averageTimeInStage: {
        newToQuoted: number; // Hours
        quotedToBooked: number; // Hours
        bookedToCompleted: number; // Hours
    };
}

// ==========================================
// HELPER FUNCTIONS
// ==========================================

function getDateRange(days: number = 30): DateRange {
    const end = new Date();
    const start = new Date();
    start.setDate(start.getDate() - days);
    return { start, end };
}

function getWeekStart(): Date {
    const now = new Date();
    const day = now.getDay();
    const diff = now.getDate() - day + (day === 0 ? -6 : 1); // Adjust for Sunday
    const weekStart = new Date(now.setDate(diff));
    weekStart.setHours(0, 0, 0, 0);
    return weekStart;
}

function getMonthStart(): Date {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
}

function parseDateRangeFromQuery(query: any): DateRange {
    const days = parseInt(query.days) || 30;
    const startDate = query.startDate ? new Date(query.startDate) : undefined;
    const endDate = query.endDate ? new Date(query.endDate) : undefined;

    if (startDate && endDate) {
        return { start: startDate, end: endDate };
    }

    return getDateRange(days);
}

// ==========================================
// 1. DASHBOARD STATS ENDPOINT
// ==========================================

adminDashboardRouter.get('/stats', async (req, res) => {
    try {
        const { start, end } = parseDateRangeFromQuery(req.query);
        const weekStart = getWeekStart();
        const monthStart = getMonthStart();

        // Quotes counts
        const [quotesThisWeek] = await db
            .select({ count: count() })
            .from(personalizedQuotes)
            .where(gte(personalizedQuotes.createdAt, weekStart));

        const [quotesThisMonth] = await db
            .select({ count: count() })
            .from(personalizedQuotes)
            .where(gte(personalizedQuotes.createdAt, monthStart));

        const [quotesAllTime] = await db
            .select({ count: count() })
            .from(personalizedQuotes);

        // Conversion rate: quotes with bookedAt / total quotes
        const [bookedQuotes] = await db
            .select({ count: count() })
            .from(personalizedQuotes)
            .where(sql`${personalizedQuotes.bookedAt} IS NOT NULL`);

        const totalQuotes = quotesAllTime?.count || 0;
        const totalBookings = bookedQuotes?.count || 0;
        const conversionRate = totalQuotes > 0
            ? Math.round((totalBookings / totalQuotes) * 100 * 100) / 100
            : 0;

        // Revenue stats
        const [depositsResult] = await db
            .select({ total: sum(personalizedQuotes.depositAmountPence) })
            .from(personalizedQuotes)
            .where(sql`${personalizedQuotes.depositPaidAt} IS NOT NULL`);

        const [invoicesPaidResult] = await db
            .select({ total: sum(invoices.totalAmount) })
            .from(invoices)
            .where(eq(invoices.status, 'paid'));

        const depositsCollected = Number(depositsResult?.total) || 0;
        const invoicesPaid = Number(invoicesPaidResult?.total) || 0;

        // Jobs by status
        const jobStatusCounts = await db
            .select({
                status: contractorJobs.status,
                count: count()
            })
            .from(contractorJobs)
            .groupBy(contractorJobs.status);

        const jobsByStatus: DashboardStats['jobs'] = {
            pending: 0,
            accepted: 0,
            inProgress: 0,
            completed: 0,
            cancelled: 0
        };

        for (const row of jobStatusCounts) {
            const status = row.status;
            if (status === 'in_progress') {
                jobsByStatus.inProgress = row.count;
            } else if (status === 'pending') {
                jobsByStatus.pending = row.count;
            } else if (status === 'accepted') {
                jobsByStatus.accepted = row.count;
            } else if (status === 'completed') {
                jobsByStatus.completed = row.count;
            } else if (status === 'cancelled') {
                jobsByStatus.cancelled = row.count;
            }
        }

        // Pending follow-up quotes (viewed but not booked, older than 24 hours)
        const oneDayAgo = new Date();
        oneDayAgo.setDate(oneDayAgo.getDate() - 1);

        const pendingQuotes = await db
            .select({
                id: personalizedQuotes.id,
                customerName: personalizedQuotes.customerName,
                createdAt: personalizedQuotes.createdAt,
                viewCount: personalizedQuotes.viewCount
            })
            .from(personalizedQuotes)
            .where(
                and(
                    sql`${personalizedQuotes.viewedAt} IS NOT NULL`,
                    sql`${personalizedQuotes.bookedAt} IS NULL`,
                    lte(personalizedQuotes.createdAt, oneDayAgo)
                )
            )
            .orderBy(desc(personalizedQuotes.createdAt))
            .limit(10);

        const response: DashboardStats = {
            quotes: {
                thisWeek: quotesThisWeek?.count || 0,
                thisMonth: quotesThisMonth?.count || 0,
                allTime: totalQuotes
            },
            conversionRate: {
                quotesToBookings: conversionRate,
                totalQuotes,
                totalBookings
            },
            revenue: {
                depositsCollected,
                invoicesPaid,
                totalRevenue: depositsCollected + invoicesPaid
            },
            jobs: jobsByStatus,
            pendingFollowUp: {
                count: pendingQuotes.length,
                quotes: pendingQuotes
            }
        };

        res.json(response);
    } catch (error) {
        console.error('[AdminDashboard] Stats error:', error);
        res.status(500).json({ error: 'Failed to fetch dashboard stats' });
    }
});

// ==========================================
// 2. REVENUE ANALYTICS ENDPOINT
// ==========================================

adminDashboardRouter.get('/revenue', async (req, res) => {
    try {
        const { start, end } = parseDateRangeFromQuery(req.query);
        const period = (req.query.period as string) || 'daily';

        // Revenue breakdown by period
        let periodFormat: string;
        switch (period) {
            case 'weekly':
                periodFormat = 'YYYY-WW'; // Year-Week
                break;
            case 'monthly':
                periodFormat = 'YYYY-MM';
                break;
            default:
                periodFormat = 'YYYY-MM-DD';
        }

        // Daily/Weekly/Monthly revenue from deposits
        const revenueBreakdown = await db
            .select({
                period: sql<string>`to_char(${personalizedQuotes.depositPaidAt}, ${periodFormat})`,
                revenue: sum(personalizedQuotes.depositAmountPence),
                count: count()
            })
            .from(personalizedQuotes)
            .where(
                and(
                    sql`${personalizedQuotes.depositPaidAt} IS NOT NULL`,
                    gte(personalizedQuotes.depositPaidAt, start),
                    lte(personalizedQuotes.depositPaidAt, end)
                )
            )
            .groupBy(sql`to_char(${personalizedQuotes.depositPaidAt}, ${periodFormat})`)
            .orderBy(sql`to_char(${personalizedQuotes.depositPaidAt}, ${periodFormat})`);

        // Revenue by segment
        const revenueBySegment = await db
            .select({
                segment: personalizedQuotes.segment,
                revenue: sum(personalizedQuotes.depositAmountPence),
                count: count(),
                avgValue: avg(personalizedQuotes.depositAmountPence)
            })
            .from(personalizedQuotes)
            .where(
                and(
                    sql`${personalizedQuotes.depositPaidAt} IS NOT NULL`,
                    gte(personalizedQuotes.depositPaidAt, start),
                    lte(personalizedQuotes.depositPaidAt, end)
                )
            )
            .groupBy(personalizedQuotes.segment);

        // Payment method breakdown
        const [stripeDepositsResult] = await db
            .select({ total: sum(personalizedQuotes.depositAmountPence) })
            .from(personalizedQuotes)
            .where(
                and(
                    sql`${personalizedQuotes.stripePaymentIntentId} IS NOT NULL`,
                    gte(personalizedQuotes.depositPaidAt, start),
                    lte(personalizedQuotes.depositPaidAt, end)
                )
            );

        const [invoiceBalanceResult] = await db
            .select({ total: sum(invoices.balanceDue) })
            .from(invoices)
            .where(
                and(
                    eq(invoices.status, 'paid'),
                    gte(invoices.paidAt, start),
                    lte(invoices.paidAt, end)
                )
            );

        const response: RevenueAnalytics = {
            period: period as 'daily' | 'weekly' | 'monthly',
            breakdown: revenueBreakdown.map(row => ({
                period: row.period || 'Unknown',
                revenue: Number(row.revenue) || 0,
                count: row.count
            })),
            bySegment: revenueBySegment.map(row => ({
                segment: row.segment || 'UNKNOWN',
                revenue: Number(row.revenue) || 0,
                count: row.count,
                averageValue: Math.round(Number(row.avgValue) || 0)
            })),
            paymentMethods: {
                stripeDeposits: Number(stripeDepositsResult?.total) || 0,
                balancePayments: Number(invoiceBalanceResult?.total) || 0,
                other: 0 // Could be expanded for cash/bank transfer tracking
            }
        };

        res.json(response);
    } catch (error) {
        console.error('[AdminDashboard] Revenue error:', error);
        res.status(500).json({ error: 'Failed to fetch revenue analytics' });
    }
});

// ==========================================
// 3. CONTRACTOR PERFORMANCE ENDPOINT
// ==========================================

adminDashboardRouter.get('/contractors', async (req, res) => {
    try {
        const { start, end } = parseDateRangeFromQuery(req.query);

        // Get all contractors with their user info
        const contractors = await db
            .select({
                id: handymanProfiles.id,
                userId: handymanProfiles.userId,
                businessName: handymanProfiles.businessName,
            })
            .from(handymanProfiles);

        // Get user details for contractors
        const contractorUsers = await db
            .select({
                id: users.id,
                firstName: users.firstName,
                lastName: users.lastName,
                email: users.email,
            })
            .from(users)
            .where(eq(users.role, 'contractor'));

        // Map users by ID for quick lookup
        const userMap = new Map(contractorUsers.map(u => [u.id, u]));

        // Get jobs completed per contractor
        const jobsPerContractor = await db
            .select({
                contractorId: contractorJobs.contractorId,
                completed: count()
            })
            .from(contractorJobs)
            .where(
                and(
                    eq(contractorJobs.status, 'completed'),
                    gte(contractorJobs.completedAt, start),
                    lte(contractorJobs.completedAt, end)
                )
            )
            .groupBy(contractorJobs.contractorId);

        const jobsMap = new Map(jobsPerContractor.map(j => [j.contractorId, j.completed]));

        // Get revenue per contractor
        const revenuePerContractor = await db
            .select({
                contractorId: contractorJobs.contractorId,
                revenue: sum(contractorJobs.payoutPence)
            })
            .from(contractorJobs)
            .where(
                and(
                    eq(contractorJobs.status, 'completed'),
                    gte(contractorJobs.completedAt, start),
                    lte(contractorJobs.completedAt, end)
                )
            )
            .groupBy(contractorJobs.contractorId);

        const revenueMap = new Map(revenuePerContractor.map(r => [r.contractorId, Number(r.revenue) || 0]));

        // Get average ratings per contractor
        const ratingsPerContractor = await db
            .select({
                contractorId: contractorReviews.contractorId,
                avgRating: avg(contractorReviews.overallRating)
            })
            .from(contractorReviews)
            .where(eq(contractorReviews.isVerified, true))
            .groupBy(contractorReviews.contractorId);

        const ratingsMap = new Map(ratingsPerContractor.map(r => [r.contractorId, Number(r.avgRating)]));

        // Build contractor performance list
        const contractorPerformance = contractors.map(c => {
            const user = userMap.get(c.userId);
            const name = c.businessName ||
                (user ? `${user.firstName || ''} ${user.lastName || ''}`.trim() : 'Unknown');

            return {
                id: c.id,
                name: name || 'Unknown Contractor',
                email: user?.email || '',
                jobsCompleted: jobsMap.get(c.id) || 0,
                averageRating: ratingsMap.get(c.id) || null,
                revenueGenerated: revenueMap.get(c.id) || 0,
                availabilityPercentage: 100 // TODO: Calculate based on availability records
            };
        });

        // Sort by jobs completed (descending)
        contractorPerformance.sort((a, b) => b.jobsCompleted - a.jobsCompleted);

        // Calculate summary
        const totalJobsCompleted = contractorPerformance.reduce((sum, c) => sum + c.jobsCompleted, 0);
        const activeContractors = contractorPerformance.filter(c => c.jobsCompleted > 0).length;

        const response: ContractorPerformance = {
            contractors: contractorPerformance,
            summary: {
                totalContractors: contractors.length,
                activeContractors,
                totalJobsCompleted,
                averageJobsPerContractor: contractors.length > 0
                    ? Math.round((totalJobsCompleted / contractors.length) * 100) / 100
                    : 0
            }
        };

        res.json(response);
    } catch (error) {
        console.error('[AdminDashboard] Contractors error:', error);
        res.status(500).json({ error: 'Failed to fetch contractor performance' });
    }
});

// ==========================================
// 4. LEAD FUNNEL ENDPOINT
// ==========================================

adminDashboardRouter.get('/funnel', async (req, res) => {
    try {
        const { start, end } = parseDateRangeFromQuery(req.query);

        // Leads by source
        const leadsBySource = await db
            .select({
                source: leads.source,
                count: count()
            })
            .from(leads)
            .where(
                and(
                    gte(leads.createdAt, start),
                    lte(leads.createdAt, end)
                )
            )
            .groupBy(leads.source);

        const totalLeads = leadsBySource.reduce((sum, row) => sum + row.count, 0);

        // Leads by status
        const leadsByStatus = await db
            .select({
                status: leads.status,
                count: count()
            })
            .from(leads)
            .where(
                and(
                    gte(leads.createdAt, start),
                    lte(leads.createdAt, end)
                )
            )
            .groupBy(leads.status);

        // Quote conversion stages
        const [totalQuotesResult] = await db
            .select({ count: count() })
            .from(personalizedQuotes)
            .where(
                and(
                    gte(personalizedQuotes.createdAt, start),
                    lte(personalizedQuotes.createdAt, end)
                )
            );

        const [viewedQuotesResult] = await db
            .select({ count: count() })
            .from(personalizedQuotes)
            .where(
                and(
                    sql`${personalizedQuotes.viewedAt} IS NOT NULL`,
                    gte(personalizedQuotes.createdAt, start),
                    lte(personalizedQuotes.createdAt, end)
                )
            );

        const [bookedQuotesResult] = await db
            .select({ count: count() })
            .from(personalizedQuotes)
            .where(
                and(
                    sql`${personalizedQuotes.bookedAt} IS NOT NULL`,
                    gte(personalizedQuotes.createdAt, start),
                    lte(personalizedQuotes.createdAt, end)
                )
            );

        const [completedJobsResult] = await db
            .select({ count: count() })
            .from(contractorJobs)
            .where(
                and(
                    eq(contractorJobs.status, 'completed'),
                    gte(contractorJobs.createdAt, start),
                    lte(contractorJobs.createdAt, end)
                )
            );

        const quotesCount = totalQuotesResult?.count || 0;
        const viewedCount = viewedQuotesResult?.count || 0;
        const bookedCount = bookedQuotesResult?.count || 0;
        const completedCount = completedJobsResult?.count || 0;

        // Calculate conversion rates
        const newToQuoted = totalLeads > 0
            ? Math.round((quotesCount / totalLeads) * 100 * 100) / 100
            : 0;
        const quotedToBooked = quotesCount > 0
            ? Math.round((bookedCount / quotesCount) * 100 * 100) / 100
            : 0;
        const bookedToCompleted = bookedCount > 0
            ? Math.round((completedCount / bookedCount) * 100 * 100) / 100
            : 0;
        const overallConversion = totalLeads > 0
            ? Math.round((completedCount / totalLeads) * 100 * 100) / 100
            : 0;

        // Calculate average time in stages (simplified - would need proper event tracking for accuracy)
        // For now, return placeholder values
        const avgTimeInStage = {
            newToQuoted: 24, // hours
            quotedToBooked: 48, // hours
            bookedToCompleted: 72 // hours
        };

        const response: LeadFunnel = {
            bySource: leadsBySource.map(row => ({
                source: row.source || 'unknown',
                count: row.count,
                percentage: totalLeads > 0
                    ? Math.round((row.count / totalLeads) * 100 * 100) / 100
                    : 0
            })),
            byStatus: leadsByStatus.map(row => ({
                status: row.status,
                count: row.count,
                percentage: totalLeads > 0
                    ? Math.round((row.count / totalLeads) * 100 * 100) / 100
                    : 0
            })),
            conversionRates: {
                newToQuoted,
                quotedToBooked,
                bookedToCompleted,
                overallConversion
            },
            averageTimeInStage: avgTimeInStage
        };

        res.json(response);
    } catch (error) {
        console.error('[AdminDashboard] Funnel error:', error);
        res.status(500).json({ error: 'Failed to fetch lead funnel data' });
    }
});

export default adminDashboardRouter;
