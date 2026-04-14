import { Router } from "express";
import { db } from "./db";
import { personalizedQuotes } from "@shared/schema";
import { isNotNull } from "drizzle-orm";
import { requireAdmin } from "./auth";

const router = Router();

router.get("/api/admin/business-model/metrics", requireAdmin, async (req, res) => {
  try {
    // ── Time period filter ──────────────────────────────────────────────
    const period = (req.query.period as string) || "all";
    let periodStart: Date | null = null;
    const now = new Date();
    if (period === "7d") periodStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    else if (period === "30d") periodStart = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    else if (period === "90d") periodStart = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
    else if (period === "thisMonth") periodStart = new Date(now.getFullYear(), now.getMonth(), 1);
    else if (period === "lastMonth") {
      const lm = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      periodStart = lm;
    }
    // For lastMonth, also need an end date
    let periodEnd: Date | null = null;
    if (period === "lastMonth") {
      periodEnd = new Date(now.getFullYear(), now.getMonth(), 1);
    }

    // ── Fetch ALL quotes (for conversion rate) ──────────────────────────
    const allQuotes = await db
      .select({
        id: personalizedQuotes.id,
        basePrice: personalizedQuotes.basePrice,
        pricingLineItems: personalizedQuotes.pricingLineItems,
        categories: personalizedQuotes.categories,
        bookedAt: personalizedQuotes.bookedAt,
        segment: personalizedQuotes.segment,
        customerName: personalizedQuotes.customerName,
        phone: personalizedQuotes.phone,
        postcode: personalizedQuotes.postcode,
        stripePaymentIntentId: personalizedQuotes.stripePaymentIntentId,
        viewCount: personalizedQuotes.viewCount,
        layoutTier: personalizedQuotes.layoutTier,
        createdAt: personalizedQuotes.createdAt,
      })
      .from(personalizedQuotes);

    // ── Filter to REAL quotes only ──────────────────────────────────────
    const testNamePattern = /^(test|e2e|curl|demo|dummy|asdf)/i;
    const isRealQuote = (q: typeof allQuotes[0]) => {
      if (testNamePattern.test((q.customerName || "").trim())) return false;
      const pc = (q.postcode || "").trim().toUpperCase();
      if (pc.startsWith("NG") || pc.startsWith("DE")) return true;
      if (q.stripePaymentIntentId) return true;
      return false;
    };

    const isInPeriod = (q: typeof allQuotes[0]) => {
      if (!periodStart) return true; // "all"
      const created = q.createdAt ? new Date(q.createdAt) : null;
      if (!created) return false;
      if (created < periodStart) return false;
      if (periodEnd && created >= periodEnd) return false;
      return true;
    };

    const realQuotes = allQuotes.filter((q) => isRealQuote(q) && isInPeriod(q));

    // ── Contextual quotes only (have pricing line items = went through engine) ──
    const hasLineItems = (q: typeof allQuotes[0]) => {
      const li = q.pricingLineItems as any;
      return (Array.isArray(li) && li.length > 0) || (li?.items?.length > 0);
    };
    const contextualQuotes = realQuotes.filter(hasLineItems);
    const bookedQuotes = realQuotes.filter((q) => q.bookedAt);
    const contextualBooked = contextualQuotes.filter((q) => q.bookedAt);

    // Conversion rate = contextual quotes that converted (fair comparison)
    const totalQuotes = contextualQuotes.length;
    const totalQuotesUnfiltered = allQuotes.length;
    const totalRealAll = realQuotes.length;
    const conversionRate = totalQuotes > 0 ? (contextualBooked.length / totalQuotes) * 100 : 0;

    // ── Aggregates ──────────────────────────────────────────────────────
    let totalRevenuePence = 0;
    let totalLabourPence = 0;
    let totalMaterialsSellPence = 0;
    let totalMaterialsCostPence = 0;
    let totalHours = 0;
    let quotesWithLineItems = 0;
    let quotesWithoutLineItems = 0;

    // For quote-vs-booked comparison
    let totalLineItemSumPence = 0; // sum of guardedPrice + materials per line item (original contextual price)
    let quotesWithLineItemComparison = 0;

    const categoryRevenue: Record<string, number> = {};
    const categoryLabour: Record<string, number> = {};
    const categoryMaterials: Record<string, number> = {};
    const categoryHours: Record<string, number> = {};
    const categoryCount: Record<string, number> = {};
    const segmentCount: Record<string, number> = {};

    // Monthly trend
    const monthlyData: Record<string, { jobs: number; revenue: number }> = {};

    // Repeat customers
    const customerKeys = new Set<string>();
    const customerBookingCount: Record<string, number> = {};

    for (const quote of bookedQuotes) {
      const basePricePence = quote.basePrice || 0;
      totalRevenuePence += basePricePence;

      // Monthly trend
      if (quote.bookedAt) {
        const d = new Date(quote.bookedAt);
        const monthKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
        if (!monthlyData[monthKey]) monthlyData[monthKey] = { jobs: 0, revenue: 0 };
        monthlyData[monthKey].jobs++;
        monthlyData[monthKey].revenue += basePricePence;
      }

      // Repeat customers (by phone, normalised)
      const custKey = (quote.phone || "").replace(/\s+/g, "").toLowerCase();
      if (custKey) {
        customerKeys.add(custKey);
        customerBookingCount[custKey] = (customerBookingCount[custKey] || 0) + 1;
      }

      // Parse line items
      const lineItems = quote.pricingLineItems as any;
      const items: any[] = [];
      if (lineItems && Array.isArray(lineItems)) {
        items.push(...lineItems);
      } else if (lineItems && typeof lineItems === "object" && lineItems.items && Array.isArray(lineItems.items)) {
        items.push(...lineItems.items);
      }

      if (items.length > 0) {
        quotesWithLineItems++;

        let quoteLineItemTotal = 0;
        for (const item of items) {
          const matSell = item.materialsWithMarginPence || 0;
          const matCost = item.materialsCostPence || 0;
          const labour = item.guardedPricePence || 0;
          const mins = item.timeEstimateMinutes || 0;
          const cat = item.category || "uncategorised";
          const hours = mins / 60;

          totalMaterialsSellPence += matSell;
          totalMaterialsCostPence += matCost;
          totalLabourPence += labour;
          totalHours += hours;
          quoteLineItemTotal += labour + matSell;

          const lineTotal = labour + matSell;
          categoryRevenue[cat] = (categoryRevenue[cat] || 0) + lineTotal;
          categoryLabour[cat] = (categoryLabour[cat] || 0) + labour;
          categoryMaterials[cat] = (categoryMaterials[cat] || 0) + matSell;
          categoryHours[cat] = (categoryHours[cat] || 0) + hours;
          categoryCount[cat] = (categoryCount[cat] || 0) + 1;
        }

        // Track line item total vs basePrice for discount analysis
        if (quoteLineItemTotal > 0) {
          totalLineItemSumPence += quoteLineItemTotal;
          quotesWithLineItemComparison++;
        }
      } else {
        quotesWithoutLineItems++;
        const cat = "uncategorised";
        categoryRevenue[cat] = (categoryRevenue[cat] || 0) + basePricePence;
        categoryLabour[cat] = (categoryLabour[cat] || 0) + basePricePence;
        categoryCount[cat] = (categoryCount[cat] || 0) + 1;
      }

      const seg = quote.segment || "UNKNOWN";
      segmentCount[seg] = (segmentCount[seg] || 0) + 1;
    }

    const totalJobs = bookedQuotes.length;
    const toPounds = (p: number) => Math.round(p) / 100;

    // ── Category detail with revenue per hour ───────────────────────────
    const categoryDetail: Record<string, {
      revenue: number;
      labour: number;
      materials: number;
      hours: number;
      count: number;
      revenuePerHour: number;
    }> = {};
    const allCategories = Array.from(new Set([...Object.keys(categoryRevenue), ...Object.keys(categoryCount)]));
    for (const cat of allCategories) {
      const hrs = categoryHours[cat] || 0;
      const rev = categoryRevenue[cat] || 0;
      categoryDetail[cat] = {
        revenue: toPounds(rev),
        labour: toPounds(categoryLabour[cat] || 0),
        materials: toPounds(categoryMaterials[cat] || 0),
        hours: Math.round(hrs * 10) / 10,
        count: categoryCount[cat] || 0,
        revenuePerHour: hrs > 0 ? Math.round((rev / hrs)) / 100 : 0,
      };
    }

    // ── Monthly trend (sorted) ──────────────────────────────────────────
    const monthlyTrend = Object.entries(monthlyData)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, data]) => ({
        month,
        jobs: data.jobs,
        revenue: toPounds(data.revenue),
      }));

    // Actual monthly run rate (based on time span)
    let actualMonthlyRunRate = { jobs: 0, revenue: 0 };
    if (bookedQuotes.length > 0) {
      const dates = bookedQuotes
        .filter((q) => q.bookedAt)
        .map((q) => new Date(q.bookedAt!).getTime());
      const minDate = Math.min(...dates);
      const maxDate = Math.max(...dates);
      const spanMs = maxDate - minDate;
      const spanMonths = Math.max(spanMs / (30.44 * 24 * 60 * 60 * 1000), 1); // at least 1 month
      actualMonthlyRunRate = {
        jobs: Math.round((totalJobs / spanMonths) * 10) / 10,
        revenue: Math.round(toPounds(totalRevenuePence) / spanMonths),
      };
    }

    // ── Quote vs Booked (discount analysis) ─────────────────────────────
    // Line item total = original contextual engine price, basePrice = what was actually charged
    let avgQuotedValue = 0;
    let avgBookedValue = 0;
    let avgDiscount = 0;
    let discountPercent = 0;
    if (quotesWithLineItemComparison > 0) {
      // Only compare quotes that have both line items and basePrice
      const bookedWithItems = bookedQuotes.filter((q) => {
        const li = q.pricingLineItems as any;
        return (Array.isArray(li) && li.length > 0) || (li?.items?.length > 0);
      });
      const totalBooked = bookedWithItems.reduce((s, q) => s + (q.basePrice || 0), 0);
      avgQuotedValue = toPounds(totalLineItemSumPence) / quotesWithLineItemComparison;
      avgBookedValue = toPounds(totalBooked) / quotesWithLineItemComparison;
      avgDiscount = avgQuotedValue - avgBookedValue;
      discountPercent = avgQuotedValue > 0 ? (avgDiscount / avgQuotedValue) * 100 : 0;
    }

    // ── Repeat customers ────────────────────────────────────────────────
    const uniqueCustomers = customerKeys.size;
    const repeatCustomers = Object.values(customerBookingCount).filter((c) => c > 1).length;
    const repeatRate = uniqueCustomers > 0 ? (repeatCustomers / uniqueCustomers) * 100 : 0;

    // ── Sweet Spot Analysis (dimensional conversion breakdowns) ────────
    type DimBucket = { label: string; total: number; booked: number; rate: number };

    const buildDimension = (
      quotes: typeof contextualQuotes,
      bucketFn: (q: typeof contextualQuotes[0]) => string,
    ): DimBucket[] => {
      const buckets: Record<string, { total: number; booked: number }> = {};
      for (const q of quotes) {
        const key = bucketFn(q);
        if (!buckets[key]) buckets[key] = { total: 0, booked: 0 };
        buckets[key].total++;
        if (q.bookedAt) buckets[key].booked++;
      }
      return Object.entries(buckets)
        .map(([label, d]) => ({ label, total: d.total, booked: d.booked, rate: d.total > 0 ? Math.round((d.booked / d.total) * 1000) / 10 : 0 }))
        .sort((a, b) => b.total - a.total);
    };

    // Price bands
    const priceBands = buildDimension(contextualQuotes, (q) => {
      const p = (q.basePrice || 0) / 100;
      if (p < 100) return "£0-100";
      if (p < 150) return "£100-150";
      if (p < 200) return "£150-200";
      if (p < 300) return "£200-300";
      if (p < 500) return "£300-500";
      return "£500+";
    });

    // View count bands
    const viewBands = buildDimension(contextualQuotes, (q) => {
      const v = (q.viewCount as number) || 0;
      if (v === 0) return "0 views";
      if (v === 1) return "1 view";
      if (v <= 3) return "2-3 views";
      if (v <= 10) return "4-10 views";
      return "11+ views";
    });

    // Layout tier
    const layoutTiers = buildDimension(contextualQuotes, (q) => (q.layoutTier as string) || "unknown");

    // Category conversion (each quote can have multiple categories)
    const catConv: Record<string, { total: number; booked: number }> = {};
    for (const q of contextualQuotes) {
      const li = q.pricingLineItems as any;
      const items: any[] = Array.isArray(li) ? li : (li?.items || []);
      const cats = Array.from(new Set(items.map((i: any) => i.category || "other")));
      for (const c of cats) {
        if (!catConv[c]) catConv[c] = { total: 0, booked: 0 };
        catConv[c].total++;
        if (q.bookedAt) catConv[c].booked++;
      }
    }
    const categoryConversion: DimBucket[] = Object.entries(catConv)
      .map(([label, d]) => ({ label, total: d.total, booked: d.booked, rate: d.total > 0 ? Math.round((d.booked / d.total) * 1000) / 10 : 0 }))
      .sort((a, b) => b.total - a.total);

    // Time to book (hours from created → booked)
    const timeToBook: { name: string; hours: number; price: number }[] = [];
    for (const q of contextualBooked) {
      if (q.createdAt && q.bookedAt) {
        const hrs = (new Date(q.bookedAt).getTime() - new Date(q.createdAt).getTime()) / (1000 * 60 * 60);
        timeToBook.push({
          name: (q.customerName || "").trim().split(" ")[0],
          hours: Math.round(hrs * 10) / 10,
          price: (q.basePrice || 0) / 100,
        });
      }
    }
    timeToBook.sort((a, b) => a.hours - b.hours);

    const sweetSpots = { priceBands, viewBands, layoutTiers, categoryConversion, timeToBook };

    // ── Response ────────────────────────────────────────────────────────
    res.json({
      totalJobs,
      totalQuotes,
      totalQuotesUnfiltered,
      totalRealAll,
      conversionRate: Math.round(conversionRate * 10) / 10,
      quotesWithLineItems,
      quotesWithoutLineItems,
      totalRevenue: toPounds(totalRevenuePence),
      totalLabour: toPounds(totalLabourPence),
      totalMaterialsSell: toPounds(totalMaterialsSellPence),
      totalMaterialsCost: toPounds(totalMaterialsCostPence),
      materialsMargin: toPounds(totalMaterialsSellPence - totalMaterialsCostPence),
      materialsMarkupPercent: totalMaterialsCostPence > 0
        ? Math.round(((totalMaterialsSellPence - totalMaterialsCostPence) / totalMaterialsCostPence) * 100)
        : 0,
      totalHours: Math.round(totalHours * 10) / 10,
      avgJobValue: totalJobs > 0 ? Math.round((totalRevenuePence / totalJobs)) / 100 : 0,
      avgHourlyRate: totalHours > 0 ? Math.round((totalRevenuePence / totalHours)) / 100 : 0,
      categoryDetail,
      segmentCount,
      monthlyTrend,
      actualMonthlyRunRate,
      avgQuotedValue: Math.round(avgQuotedValue * 100) / 100,
      avgBookedValue: Math.round(avgBookedValue * 100) / 100,
      avgDiscount: Math.round(avgDiscount * 100) / 100,
      discountPercent: Math.round(discountPercent * 10) / 10,
      uniqueCustomers,
      repeatCustomers,
      repeatRate: Math.round(repeatRate * 10) / 10,
      firstBookedAt: bookedQuotes.length > 0
        ? bookedQuotes.reduce((min, q) => (q.bookedAt && (!min || q.bookedAt < min) ? q.bookedAt : min), bookedQuotes[0].bookedAt)
        : null,
      lastBookedAt: bookedQuotes.length > 0
        ? bookedQuotes.reduce((max, q) => (q.bookedAt && (!max || q.bookedAt > max) ? q.bookedAt : max), bookedQuotes[0].bookedAt)
        : null,
      sweetSpots,
      period,
      periodStart: periodStart?.toISOString() || null,
      periodEnd: periodEnd?.toISOString() || null,
    });
  } catch (error) {
    console.error("[BusinessModel] Error fetching metrics:", error);
    res.status(500).json({ error: "Failed to fetch business model metrics" });
  }
});

export default router;
