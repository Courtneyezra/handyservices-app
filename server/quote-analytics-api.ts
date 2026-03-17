/**
 * Quote Analytics API
 *
 * Aggregates data from personalizedQuotes table for the in-app conversion dashboard.
 * All queries hit the DB directly — no PostHog dependency.
 */

import { Router } from 'express';
import { db } from './db';
import { personalizedQuotes, quoteSectionEvents } from '@shared/schema';
import { sql, eq, and, gte, lte, isNotNull, count, avg, sum, desc } from 'drizzle-orm';

const router = Router();

// ---------------------------------------------------------------------------
// GET /api/analytics/quotes/summary
// Main dashboard data — funnel, revenue, pricing intelligence
// ---------------------------------------------------------------------------
router.get('/api/analytics/quotes/summary', async (req, res) => {
  try {
    const daysBack = parseInt(req.query.days as string) || 30;
    const since = new Date();
    since.setDate(since.getDate() - daysBack);

    const pq = personalizedQuotes;

    // All queries filter to CONTEXTUAL segment only — legacy quotes excluded
    const baseFilter = and(gte(pq.createdAt, since), eq(pq.segment, 'CONTEXTUAL'));

    // 1. Funnel counts
    const [funnelData] = await db.select({
      total_quotes: count(),
      total_viewed: count(pq.viewedAt),
      total_booked: count(pq.bookedAt),
      total_paid: count(pq.depositPaidAt),
    }).from(pq).where(baseFilter);

    // 2. Daily quote volume (for sparkline/trend)
    const dailyVolume = await db.select({
      date: sql<string>`DATE(${pq.createdAt})`.as('date'),
      count: count(),
      viewed: count(pq.viewedAt),
      booked: count(pq.bookedAt),
    })
    .from(pq)
    .where(baseFilter)
    .groupBy(sql`DATE(${pq.createdAt})`)
    .orderBy(sql`DATE(${pq.createdAt})`);

    // 3. Revenue metrics (from paid quotes)
    const [revenueData] = await db.select({
      total_revenue_pence: sum(pq.basePrice),
      avg_deal_size_pence: avg(pq.basePrice),
      paid_count: count(),
    })
    .from(pq)
    .where(and(baseFilter, isNotNull(pq.depositPaidAt)));

    // 4. Layout tier performance
    const layoutTierRows = await db.select({
      layout_tier: pq.layoutTier,
      quote_count: count(),
      viewed_count: count(pq.viewedAt),
      booked_count: count(pq.bookedAt),
      avg_price: avg(pq.basePrice),
    })
    .from(pq)
    .where(and(baseFilter, isNotNull(pq.layoutTier)))
    .groupBy(pq.layoutTier);

    // 5. VA leaderboard
    const vaRows = await db.select({
      created_by: pq.createdBy,
      created_by_name: pq.createdByName,
      quotes_sent: count(),
      quotes_viewed: count(pq.viewedAt),
      quotes_booked: count(pq.bookedAt),
      quotes_paid: count(pq.depositPaidAt),
      total_revenue_pence: sum(
        sql`CASE WHEN ${pq.depositPaidAt} IS NOT NULL THEN ${pq.basePrice} ELSE 0 END`
      ),
      avg_price: avg(pq.basePrice),
    })
    .from(pq)
    .where(and(baseFilter, isNotNull(pq.createdBy)))
    .groupBy(pq.createdBy, pq.createdByName)
    .orderBy(desc(count()));

    // 6. View-to-book timing (avg hours between viewedAt and bookedAt)
    const [timingData] = await db.select({
      avg_hours_to_book: avg(
        sql`EXTRACT(EPOCH FROM (${pq.bookedAt} - ${pq.viewedAt})) / 3600`
      ),
      avg_view_count_at_booking: avg(pq.viewCount),
    })
    .from(pq)
    .where(and(
      baseFilter,
      isNotNull(pq.bookedAt),
      isNotNull(pq.viewedAt),
    ));

    // 7. Price band analysis (group by price ranges)
    const priceBands = await db.select({
      price_band: sql<string>`
        CASE
          WHEN ${pq.basePrice} < 5000 THEN 'Under £50'
          WHEN ${pq.basePrice} < 10000 THEN '£50-£100'
          WHEN ${pq.basePrice} < 20000 THEN '£100-£200'
          WHEN ${pq.basePrice} < 35000 THEN '£200-£350'
          WHEN ${pq.basePrice} < 50000 THEN '£350-£500'
          ELSE '£500+'
        END
      `.as('price_band'),
      quote_count: count(),
      viewed_count: count(pq.viewedAt),
      booked_count: count(pq.bookedAt),
    })
    .from(pq)
    .where(and(baseFilter, isNotNull(pq.basePrice)))
    .groupBy(sql`
      CASE
        WHEN ${pq.basePrice} < 5000 THEN 'Under £50'
        WHEN ${pq.basePrice} < 10000 THEN '£50-£100'
        WHEN ${pq.basePrice} < 20000 THEN '£100-£200'
        WHEN ${pq.basePrice} < 35000 THEN '£200-£350'
        WHEN ${pq.basePrice} < 50000 THEN '£350-£500'
        ELSE '£500+'
      END
    `);

    // 8. Batch discount effectiveness
    const [batchData] = await db.select({
      with_discount_count: count(
        sql`CASE WHEN ${pq.batchDiscountPercent} > 0 THEN 1 END`
      ),
      with_discount_booked: count(
        sql`CASE WHEN ${pq.batchDiscountPercent} > 0 AND ${pq.bookedAt} IS NOT NULL THEN 1 END`
      ),
      no_discount_count: count(
        sql`CASE WHEN COALESCE(${pq.batchDiscountPercent}, 0) = 0 THEN 1 END`
      ),
      no_discount_booked: count(
        sql`CASE WHEN COALESCE(${pq.batchDiscountPercent}, 0) = 0 AND ${pq.bookedAt} IS NOT NULL THEN 1 END`
      ),
      avg_discount_percent: avg(
        sql`CASE WHEN ${pq.batchDiscountPercent} > 0 THEN ${pq.batchDiscountPercent} END`
      ),
    })
    .from(pq)
    .where(baseFilter);

    // 9. Human review rate
    const [reviewData] = await db.select({
      total_contextual: count(),
      requires_review: count(
        sql`CASE WHEN ${pq.requiresHumanReview} = true THEN 1 END`
      ),
    })
    .from(pq)
    .where(baseFilter);

    return res.json({
      period: { days: daysBack, since: since.toISOString() },
      funnel: funnelData,
      dailyVolume,
      revenue: {
        totalRevenuePence: Number(revenueData?.total_revenue_pence) || 0,
        avgDealSizePence: Math.round(Number(revenueData?.avg_deal_size_pence) || 0),
        paidCount: Number(revenueData?.paid_count) || 0,
      },
      layoutTiers: layoutTierRows,
      vaLeaderboard: vaRows,
      timing: {
        avgHoursToBook: Number(timingData?.avg_hours_to_book)?.toFixed(1) || null,
        avgViewCountAtBooking: Number(timingData?.avg_view_count_at_booking)?.toFixed(1) || null,
      },
      priceBands,
      batchDiscount: {
        withDiscountCount: Number(batchData?.with_discount_count) || 0,
        withDiscountBooked: Number(batchData?.with_discount_booked) || 0,
        noDiscountCount: Number(batchData?.no_discount_count) || 0,
        noDiscountBooked: Number(batchData?.no_discount_booked) || 0,
        avgDiscountPercent: Number(batchData?.avg_discount_percent)?.toFixed(1) || '0',
      },
      humanReview: {
        totalContextual: Number(reviewData?.total_contextual) || 0,
        requiresReview: Number(reviewData?.requires_review) || 0,
        reviewRate: reviewData?.total_contextual
          ? ((Number(reviewData.requires_review) / Number(reviewData.total_contextual)) * 100).toFixed(1)
          : '0',
      },
    });
  } catch (error) {
    console.error('[Analytics] Summary error:', error);
    return res.status(500).json({ error: 'Failed to fetch analytics' });
  }
});

// ---------------------------------------------------------------------------
// GET /api/analytics/quotes/pricing-layers
// Pricing engine accuracy — per-category reference vs LLM vs final
// ---------------------------------------------------------------------------
router.get('/api/analytics/quotes/pricing-layers', async (req, res) => {
  try {
    const daysBack = parseInt(req.query.days as string) || 30;
    const since = new Date();
    since.setDate(since.getDate() - daysBack);

    // Fetch contextual quotes with pricing data
    const quotes = await db.select({
      id: personalizedQuotes.id,
      basePrice: personalizedQuotes.basePrice,
      pricingLineItems: personalizedQuotes.pricingLineItems,
      pricingLayerBreakdown: personalizedQuotes.pricingLayerBreakdown,
      batchDiscountPercent: personalizedQuotes.batchDiscountPercent,
      bookedAt: personalizedQuotes.bookedAt,
      depositPaidAt: personalizedQuotes.depositPaidAt,
    })
    .from(personalizedQuotes)
    .where(and(
      gte(personalizedQuotes.createdAt, since),
      eq(personalizedQuotes.segment, 'CONTEXTUAL'),
      isNotNull(personalizedQuotes.pricingLineItems),
    ))
    .limit(200);

    // Aggregate per-category pricing layer data
    const categoryStats: Record<string, {
      category: string;
      lineCount: number;
      avgReferencePence: number;
      avgLLMPence: number;
      avgFinalPence: number;
      guardrailTriggerCount: number;
      totalReferencePence: number;
      totalLLMPence: number;
      totalFinalPence: number;
    }> = {};

    for (const q of quotes) {
      const lineItems = q.pricingLineItems as any[];
      if (!Array.isArray(lineItems)) continue;

      for (const line of lineItems) {
        const cat = line.category || 'unknown';
        if (!categoryStats[cat]) {
          categoryStats[cat] = {
            category: cat,
            lineCount: 0,
            avgReferencePence: 0,
            avgLLMPence: 0,
            avgFinalPence: 0,
            guardrailTriggerCount: 0,
            totalReferencePence: 0,
            totalLLMPence: 0,
            totalFinalPence: 0,
          };
        }
        const s = categoryStats[cat];
        s.lineCount++;
        s.totalReferencePence += line.referencePricePence || 0;
        s.totalLLMPence += line.llmSuggestedPricePence || 0;
        s.totalFinalPence += line.guardedPricePence || 0;
        if (line.guardedPricePence !== line.llmSuggestedPricePence) {
          s.guardrailTriggerCount++;
        }
      }
    }

    // Calculate averages
    const categories = Object.values(categoryStats).map(s => ({
      ...s,
      avgReferencePence: Math.round(s.totalReferencePence / s.lineCount),
      avgLLMPence: Math.round(s.totalLLMPence / s.lineCount),
      avgFinalPence: Math.round(s.totalFinalPence / s.lineCount),
      guardrailTriggerRate: ((s.guardrailTriggerCount / s.lineCount) * 100).toFixed(1),
      llmVsReferencePercent: s.totalReferencePence > 0
        ? (((s.totalLLMPence - s.totalReferencePence) / s.totalReferencePence) * 100).toFixed(1)
        : '0',
    })).sort((a, b) => b.lineCount - a.lineCount);

    return res.json({
      quoteCount: quotes.length,
      categories,
    });
  } catch (error) {
    console.error('[Analytics] Pricing layers error:', error);
    return res.status(500).json({ error: 'Failed to fetch pricing analytics' });
  }
});

// ---------------------------------------------------------------------------
// POST /api/analytics/quotes/section-event
// Lightweight beacon — client fires this when a section is viewed
// ---------------------------------------------------------------------------
router.post('/api/analytics/quotes/section-event', async (req, res) => {
  try {
    const { quoteId, shortSlug, section, dwellTimeMs, scrollDepthPercent, deviceType, layoutTier } = req.body;
    if (!quoteId || !section) {
      return res.status(400).json({ error: 'quoteId and section required' });
    }
    await db.insert(quoteSectionEvents).values({
      quoteId,
      shortSlug: shortSlug || null,
      section,
      dwellTimeMs: dwellTimeMs || 0,
      scrollDepthPercent: scrollDepthPercent || null,
      deviceType: deviceType || null,
      layoutTier: layoutTier || null,
    });
    return res.json({ ok: true });
  } catch (error) {
    console.error('[Analytics] Section event error:', error);
    return res.status(500).json({ error: 'Failed to store section event' });
  }
});

// ---------------------------------------------------------------------------
// GET /api/analytics/quotes/section-engagement
// Aggregated section engagement — powers the engagement waterfall
// ---------------------------------------------------------------------------
router.get('/api/analytics/quotes/section-engagement', async (req, res) => {
  try {
    const daysBack = parseInt(req.query.days as string) || 30;
    const since = new Date();
    since.setDate(since.getDate() - daysBack);

    const se = quoteSectionEvents;

    // Per-section aggregates
    const sections = await db.select({
      section: se.section,
      view_count: count(),
      avg_dwell_ms: avg(se.dwellTimeMs),
      max_dwell_ms: sql<number>`MAX(${se.dwellTimeMs})`,
      unique_quotes: sql<number>`COUNT(DISTINCT ${se.quoteId})`,
    })
    .from(se)
    .where(gte(se.createdAt, since))
    .groupBy(se.section)
    .orderBy(desc(count()));

    // Per-device breakdown
    const deviceBreakdown = await db.select({
      section: se.section,
      device_type: se.deviceType,
      view_count: count(),
      avg_dwell_ms: avg(se.dwellTimeMs),
    })
    .from(se)
    .where(gte(se.createdAt, since))
    .groupBy(se.section, se.deviceType);

    // Total unique quotes with any section events (for drop-off calculation)
    const [totals] = await db.select({
      total_quotes: sql<number>`COUNT(DISTINCT ${se.quoteId})`,
      total_events: count(),
    })
    .from(se)
    .where(gte(se.createdAt, since));

    return res.json({
      period: { days: daysBack, since: since.toISOString() },
      totalQuotesWithEvents: Number(totals?.total_quotes) || 0,
      totalEvents: Number(totals?.total_events) || 0,
      sections: sections.map(s => ({
        section: s.section,
        viewCount: Number(s.view_count),
        avgDwellMs: Math.round(Number(s.avg_dwell_ms) || 0),
        avgDwellSeconds: Math.round((Number(s.avg_dwell_ms) || 0) / 1000),
        maxDwellMs: Number(s.max_dwell_ms) || 0,
        uniqueQuotes: Number(s.unique_quotes),
        reachRate: totals?.total_quotes
          ? ((Number(s.unique_quotes) / Number(totals.total_quotes)) * 100).toFixed(1)
          : '0',
      })),
      deviceBreakdown: deviceBreakdown.map(d => ({
        section: d.section,
        deviceType: d.device_type,
        viewCount: Number(d.view_count),
        avgDwellMs: Math.round(Number(d.avg_dwell_ms) || 0),
      })),
    });
  } catch (error) {
    console.error('[Analytics] Section engagement error:', error);
    return res.status(500).json({ error: 'Failed to fetch section engagement' });
  }
});

export default router;
