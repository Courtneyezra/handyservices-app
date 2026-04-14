import { Router } from "express";
import { db } from "./db";
import { personalizedQuotes, calls } from "../shared/schema";
import { eq, gte, and, sql, desc, count } from "drizzle-orm";

export const vaStatsRouter = Router();

/** Degressive acceptance brackets — resets monthly */
function calcAcceptanceEarnings(accepted: number): number {
  if (accepted <= 0) return 0;
  let total = 0;
  const t1 = Math.min(accepted, 20);
  total += t1 * 10;
  const t2 = Math.min(Math.max(accepted - 20, 0), 30);
  total += t2 * 7;
  const t3 = Math.min(Math.max(accepted - 50, 0), 30);
  total += t3 * 5;
  const t4 = Math.max(accepted - 80, 0);
  total += t4 * 3;
  return total;
}

function getCurrentBracket(accepted: number): string {
  if (accepted <= 20) return "£10 each (1-20)";
  if (accepted <= 50) return "£7 each (21-50)";
  if (accepted <= 80) return "£5 each (51-80)";
  return "£3 each (81+)";
}

/**
 * Payment ledger — hardcoded historical records.
 * Includes adjustments for deleted quotes (Stripe-verified).
 */
const PAYMENT_LEDGER = [
  {
    period: "Mar 9–13",
    label: "Week 1",
    sent: 26,
    booked: 1,
    sendEarnings: 78,
    acceptEarnings: 10,
    total: 88,
    paid: 88,
    note: "Mr Bhogal",
  },
  {
    period: "Mar 13–27",
    label: "Gap (deleted quotes)",
    sent: 33,
    booked: 11,
    sendEarnings: 99,
    acceptEarnings: 110,
    total: 209,
    paid: 209,
    note: "Stripe-verified: Raul, Suzy, Christine, Karan, Carrie, James, Ash, Liz, Joe + 2 repeats",
  },
  {
    period: "Mar 28–31",
    label: "Week 3",
    sent: 17,
    booked: 5,
    sendEarnings: 51,
    acceptEarnings: 50,
    total: 101,
    paid: 96,
    note: "Timothy, Cordelia, Panda property, James, Dale",
  },
  {
    period: "Apr 8",
    label: "Top-up payment",
    sent: 0,
    booked: 0,
    sendEarnings: 0,
    acceptEarnings: 0,
    total: 0,
    paid: 75,
    note: "Additional payment against April earnings",
  },
];

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

    // --- Earnings calculation ---
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const weekDay = now.getDay();
    const weekDiff = now.getDate() - weekDay + (weekDay === 0 ? -6 : 1);
    const weekStart = new Date(now.getFullYear(), now.getMonth(), weekDiff);

    const [monthlyTotals, weeklyTotals] = await Promise.all([
      db
        .select({
          sent: count(),
          accepted: sql<number>`count(case when ${personalizedQuotes.selectedAt} is not null then 1 end)`.as("accepted"),
        })
        .from(personalizedQuotes)
        .where(and(eq(personalizedQuotes.createdBy, userId), gte(personalizedQuotes.createdAt, monthStart))),
      db
        .select({
          sent: count(),
          accepted: sql<number>`count(case when ${personalizedQuotes.selectedAt} is not null then 1 end)`.as("accepted"),
        })
        .from(personalizedQuotes)
        .where(and(eq(personalizedQuotes.createdBy, userId), gte(personalizedQuotes.createdAt, weekStart))),
    ]);

    const monthSent = Number(monthlyTotals[0]?.sent) || 0;
    const monthAccepted = Number(monthlyTotals[0]?.accepted) || 0;
    const weekSent = Number(weeklyTotals[0]?.sent) || 0;
    const weekAccepted = Number(weeklyTotals[0]?.accepted) || 0;

    const monthSendEarnings = monthSent * 3;
    const monthAcceptEarnings = calcAcceptanceEarnings(monthAccepted);
    const monthTotalEarnings = monthSendEarnings + monthAcceptEarnings;

    const priorAccepted = monthAccepted - weekAccepted;
    const weekAcceptEarnings = calcAcceptanceEarnings(monthAccepted) - calcAcceptanceEarnings(priorAccepted);
    const weekSendEarnings = weekSent * 3;
    const weekTotalEarnings = weekSendEarnings + weekAcceptEarnings;

    // Ledger totals include historical earnings + any current-month top-up payments
    const ledgerEarned = PAYMENT_LEDGER.reduce((sum, row) => sum + row.total, 0);
    const ledgerPaid = PAYMENT_LEDGER.reduce((sum, row) => sum + row.paid, 0);

    const totalEarned = ledgerEarned + monthTotalEarnings;
    const totalPaid = ledgerPaid;
    const outstanding = totalEarned - totalPaid;

    res.json({
      callsHandled,
      quotesSent,
      quotesAccepted,
      conversionRate,
      segmentBreakdown,
      recentQuotes,
      earnings: {
        month: {
          sent: monthSent,
          accepted: monthAccepted,
          sendEarnings: monthSendEarnings,
          acceptEarnings: monthAcceptEarnings,
          total: monthTotalEarnings,
        },
        week: {
          sent: weekSent,
          accepted: weekAccepted,
          sendEarnings: weekSendEarnings,
          acceptEarnings: weekAcceptEarnings,
          total: weekTotalEarnings,
        },
        allTime: {
          totalEarned,
          totalPaid,
          owed: outstanding,
        },
        currentBracket: getCurrentBracket(monthAccepted),
        ledger: PAYMENT_LEDGER,
      },
    });
  } catch (error) {
    console.error("VA Stats Error:", error);
    res.status(500).json({ error: "Failed to fetch VA stats" });
  }
});
