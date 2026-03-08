import { Router } from "express";
import { db } from "./db";
import { personalizedQuotes, calls } from "../shared/schema";
import { eq, gte, and, sql, desc, count } from "drizzle-orm";

export const vaStatsRouter = Router();

function getStartDate(period: string): Date | null {
  const now = new Date();
  switch (period) {
    case "today":
      return new Date(now.getFullYear(), now.getMonth(), now.getDate());
    case "week": {
      const d = new Date(now);
      const day = d.getDay();
      const diff = d.getDate() - day + (day === 0 ? -6 : 1); // Monday
      return new Date(d.getFullYear(), d.getMonth(), diff);
    }
    case "month":
      return new Date(now.getFullYear(), now.getMonth(), 1);
    default:
      return null; // "all"
  }
}

function deriveQuoteStatus(row: {
  bookedAt: Date | null;
  selectedAt: Date | null;
  rejectionReason: string | null;
  expiresAt: Date | null;
  viewedAt: Date | null;
}): "booked" | "accepted" | "rejected" | "expired" | "viewed" | "sent" {
  if (row.bookedAt) return "booked";
  if (row.selectedAt) return "accepted";
  if (row.rejectionReason) return "rejected";
  if (row.expiresAt && row.expiresAt < new Date() && !row.selectedAt) return "expired";
  if (row.viewedAt) return "viewed";
  return "sent";
}

// GET /stats?period=today|week|month|all
vaStatsRouter.get("/stats", async (req, res) => {
  try {
    const userId = (req as any).user?.id;
    if (!userId) {
      return res.status(401).json({ error: "User not found" });
    }

    const period = (req.query.period as string) || "all";
    const startDate = getStartDate(period);

    // Build date conditions
    const quoteConditions = startDate
      ? and(eq(personalizedQuotes.createdBy, userId), gte(personalizedQuotes.createdAt, startDate))
      : eq(personalizedQuotes.createdBy, userId);

    const callConditions = startDate
      ? and(eq(calls.lastEditedBy, userId), gte(calls.startTime, startDate))
      : eq(calls.lastEditedBy, userId);

    // Run queries in parallel
    const [callsResult, quotesAgg, recentQuotesResult] = await Promise.all([
      // 1. Calls count
      db.select({ total: count() }).from(calls).where(callConditions),

      // 2. Quotes aggregated by segment
      db
        .select({
          segment: personalizedQuotes.segment,
          sent: count(),
          accepted: sql<number>`count(case when ${personalizedQuotes.selectedAt} is not null then 1 end)`.as("accepted"),
        })
        .from(personalizedQuotes)
        .where(quoteConditions)
        .groupBy(personalizedQuotes.segment),

      // 3. Recent 20 quotes
      db
        .select({
          id: personalizedQuotes.id,
          shortSlug: personalizedQuotes.shortSlug,
          customerName: personalizedQuotes.customerName,
          segment: personalizedQuotes.segment,
          basePrice: personalizedQuotes.basePrice,
          essentialPrice: personalizedQuotes.essentialPrice,
          viewedAt: personalizedQuotes.viewedAt,
          selectedAt: personalizedQuotes.selectedAt,
          bookedAt: personalizedQuotes.bookedAt,
          rejectionReason: personalizedQuotes.rejectionReason,
          expiresAt: personalizedQuotes.expiresAt,
          createdAt: personalizedQuotes.createdAt,
        })
        .from(personalizedQuotes)
        .where(eq(personalizedQuotes.createdBy, userId))
        .orderBy(desc(personalizedQuotes.createdAt))
        .limit(20),
    ]);

    // Aggregate top-line numbers from segment breakdown
    const callsHandled = callsResult[0]?.total ?? 0;
    let quotesSent = 0;
    let quotesAccepted = 0;

    const segmentBreakdown = quotesAgg.map((row) => {
      const sent = Number(row.sent) || 0;
      const accepted = Number(row.accepted) || 0;
      quotesSent += sent;
      quotesAccepted += accepted;
      return {
        segment: row.segment || "UNKNOWN",
        sent,
        accepted,
        conversionRate: sent > 0 ? Math.round((accepted / sent) * 100) : 0,
      };
    });

    const conversionRate = quotesSent > 0 ? Math.round((quotesAccepted / quotesSent) * 1000) / 10 : 0;

    // Derive status for recent quotes
    const recentQuotes = recentQuotesResult.map((q) => ({
      id: q.id,
      shortSlug: q.shortSlug,
      customerName: q.customerName,
      segment: q.segment,
      basePrice: q.basePrice,
      essentialPrice: q.essentialPrice,
      status: deriveQuoteStatus(q),
      createdAt: q.createdAt?.toISOString() ?? null,
    }));

    res.json({
      callsHandled,
      quotesSent,
      quotesAccepted,
      conversionRate,
      segmentBreakdown,
      recentQuotes,
    });
  } catch (error) {
    console.error("VA Stats Error:", error);
    res.status(500).json({ error: "Failed to fetch VA stats" });
  }
});
