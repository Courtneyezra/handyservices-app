// MOUNT: app.use(seoRoutes) in server/index.ts (or wherever routers are registered)
import { Router } from "express";
import { db } from "./db";
import { keywordTargets, rankSnapshots, gmbMetrics } from "@shared/schema";
import { desc, eq, sql } from "drizzle-orm";
import { requireAdmin } from "./auth";
import {
    getAutomationStatus, runRankTracking, runGmbPull,
} from "./seo-automation";

const router = Router();

// ── GET /api/admin/seo/overview ──────────────────────────────────────────────
// Summary of the tracked keyword universe: demand split by deliverability,
// funnel-gate counts (pages published / booking enabled), and per-city totals.
router.get("/api/admin/seo/overview", requireAdmin, async (_req, res) => {
  try {
    const rows = await db
      .select({
        id: keywordTargets.id,
        city: keywordTargets.city,
        deliverability: keywordTargets.deliverability,
        avgMonthlySearches: keywordTargets.avgMonthlySearches,
        trackRankings: keywordTargets.trackRankings,
        pagePublished: keywordTargets.pagePublished,
        bookingEnabled: keywordTargets.bookingEnabled,
      })
      .from(keywordTargets);

    const trackedRows = rows.filter((r) => r.trackRankings);

    const byDeliverability: Record<string, { count: number; demand: number }> = {};
    const byCity: Record<string, { count: number; demand: number; core: number; sub: number }> = {};
    let pagePublished = 0;
    let bookingEnabled = 0;

    for (const r of rows) {
      const del = r.deliverability || "out_of_scope";
      const demand = r.avgMonthlySearches || 0;

      if (!byDeliverability[del]) byDeliverability[del] = { count: 0, demand: 0 };
      byDeliverability[del].count++;
      byDeliverability[del].demand += demand;

      const city = r.city || "unknown";
      if (!byCity[city]) byCity[city] = { count: 0, demand: 0, core: 0, sub: 0 };
      byCity[city].count++;
      byCity[city].demand += demand;
      if (del === "core") byCity[city].core += demand;
      else if (del === "sub") byCity[city].sub += demand;

      if (r.pagePublished) pagePublished++;
      if (r.bookingEnabled) bookingEnabled++;
    }

    const core = byDeliverability["core"] || { count: 0, demand: 0 };
    const sub = byDeliverability["sub"] || { count: 0, demand: 0 };
    const outOfScope = byDeliverability["out_of_scope"] || { count: 0, demand: 0 };

    res.json({
      totalKeywords: rows.length,
      trackedKeywords: trackedRows.length,
      pagePublished,
      bookingEnabled,
      deliverability: {
        core: { count: core.count, demand: core.demand },
        sub: { count: sub.count, demand: sub.demand },
        out_of_scope: { count: outOfScope.count, demand: outOfScope.demand },
      },
      perCity: Object.entries(byCity)
        .map(([city, d]) => ({ city, count: d.count, demand: d.demand, coreDemand: d.core, subDemand: d.sub }))
        .sort((a, b) => b.demand - a.demand),
    });
  } catch (error) {
    console.error("[SEO] Error fetching overview:", error);
    res.status(500).json({ error: "Failed to fetch SEO overview" });
  }
});

// ── GET /api/admin/seo/keywords ──────────────────────────────────────────────
// All keyword targets (priority desc), each decorated with its LATEST rank
// snapshot position/cited per engine. Fetch snapshots newest-first and reduce
// in JS: first seen per (keyword, engine) wins = latest.
router.get("/api/admin/seo/keywords", requireAdmin, async (_req, res) => {
  try {
    const keywords = await db
      .select()
      .from(keywordTargets)
      .orderBy(desc(keywordTargets.priorityScore));

    const snapshots = await db
      .select({
        keywordTargetId: rankSnapshots.keywordTargetId,
        engine: rankSnapshots.engine,
        position: rankSnapshots.position,
        url: rankSnapshots.url,
        cited: rankSnapshots.cited,
        capturedAt: rankSnapshots.capturedAt,
      })
      .from(rankSnapshots)
      .orderBy(desc(rankSnapshots.capturedAt));

    // latest[keywordTargetId][engine] = snapshot (first = newest due to ordering)
    const latest: Record<number, Record<string, { position: number | null; url: string | null; cited: boolean; capturedAt: Date }>> = {};
    for (const s of snapshots) {
      const kid = s.keywordTargetId;
      if (!latest[kid]) latest[kid] = {};
      if (!latest[kid][s.engine]) {
        latest[kid][s.engine] = {
          position: s.position ?? null,
          url: s.url ?? null,
          cited: !!s.cited,
          capturedAt: s.capturedAt as Date,
        };
      }
    }

    const result = keywords.map((k) => ({
      ...k,
      rankings: latest[k.id] || {},
    }));

    res.json(result);
  } catch (error) {
    console.error("[SEO] Error fetching keywords:", error);
    res.status(500).json({ error: "Failed to fetch SEO keywords" });
  }
});

// ── POST /api/admin/seo/keywords/:id/publish ─────────────────────────────────
// Flip a keyword target's publish gates: pagePublished (page is live) and/or
// bookingEnabled (fulfilment gate open). Only the provided fields are updated.
// "RANK != FULFIL": publish the page when built, enable booking only when the
// pool can field it.
router.post("/api/admin/seo/keywords/:id/publish", requireAdmin, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      return res.status(400).json({ error: "Invalid keyword target id" });
    }

    const { pagePublished, bookingEnabled } = req.body ?? {};
    const updates: { pagePublished?: boolean; bookingEnabled?: boolean; updatedAt: Date } = {
      updatedAt: new Date(),
    };
    if (typeof pagePublished === "boolean") updates.pagePublished = pagePublished;
    if (typeof bookingEnabled === "boolean") updates.bookingEnabled = bookingEnabled;

    const [updated] = await db
      .update(keywordTargets)
      .set(updates)
      .where(eq(keywordTargets.id, id))
      .returning();

    if (!updated) {
      return res.status(404).json({ error: "Keyword target not found" });
    }

    res.json(updated);
  } catch (error) {
    console.error("[SEO] Error updating publish gates:", error);
    res.status(500).json({ error: "Failed to update publish gates" });
  }
});

// ── GET /api/admin/seo/gmb ───────────────────────────────────────────────────
// Latest gmbMetrics row per location.
router.get("/api/admin/seo/gmb", requireAdmin, async (_req, res) => {
  try {
    const rows = await db
      .select()
      .from(gmbMetrics)
      .orderBy(desc(gmbMetrics.capturedAt));

    // first seen per location = latest (rows already newest-first)
    const latestByLocation: Record<string, typeof rows[number]> = {};
    for (const r of rows) {
      if (!latestByLocation[r.location]) latestByLocation[r.location] = r;
    }

    res.json(Object.values(latestByLocation).sort((a, b) => a.location.localeCompare(b.location)));
  } catch (error) {
    console.error("[SEO] Error fetching GMB metrics:", error);
    res.status(500).json({ error: "Failed to fetch GMB metrics" });
  }
});

// ── GET /api/admin/seo/automation ────────────────────────────────────────────
// Scheduler status for the rank-tracking + GMB jobs: enabled (creds present),
// schedule, this-process last-run summary, plus the persistent "last data"
// timestamp derived from the newest snapshot in the DB (survives restarts).
router.get("/api/admin/seo/automation", requireAdmin, async (_req, res) => {
  try {
    const status = getAutomationStatus();

    const [rankLatest] = await db
      .select({ at: sql<Date | null>`max(${rankSnapshots.capturedAt})` })
      .from(rankSnapshots);
    const [gmbLatest] = await db
      .select({ at: sql<Date | null>`max(${gmbMetrics.capturedAt})` })
      .from(gmbMetrics);

    res.json({
      rank: { ...status.rank, lastDataAt: rankLatest?.at ?? null },
      gmb: { ...status.gmb, lastDataAt: gmbLatest?.at ?? null },
    });
  } catch (error) {
    console.error("[SEO] Error fetching automation status:", error);
    res.status(500).json({ error: "Failed to fetch automation status" });
  }
});

// ── POST /api/admin/seo/track/run ─────────────────────────────────────────────
// Fire a rank-tracking run now (fire-and-forget — a full run takes minutes).
// The shared run-state guard prevents overlap with the cron run. Poll
// /automation for progress/result.
router.post("/api/admin/seo/track/run", requireAdmin, (_req, res) => {
  const { rank } = getAutomationStatus();
  if (!rank.enabled) {
    return res.status(409).json({ error: "Rank tracking is disabled — APIFY_TOKEN not set." });
  }
  if (rank.running) {
    return res.status(409).json({ error: "A rank-tracking run is already in progress." });
  }
  void runRankTracking("manual"); // don't await — poll /automation for result
  res.status(202).json({ started: true });
});

// ── POST /api/admin/seo/gmb/run ───────────────────────────────────────────────
router.post("/api/admin/seo/gmb/run", requireAdmin, (_req, res) => {
  const { gmb } = getAutomationStatus();
  if (!gmb.enabled) {
    return res.status(409).json({ error: "GMB pull is disabled — GOOGLE_GBP_* not set." });
  }
  if (gmb.running) {
    return res.status(409).json({ error: "A GMB pull is already in progress." });
  }
  void runGmbPull("manual");
  res.status(202).json({ started: true });
});

// ── GET /api/admin/seo/trends ─────────────────────────────────────────────
// Rank history for the progress chart + "this week" movement summary. Groups
// rank_snapshots into daily runs and returns, per keyword, the organic/pack
// position across runs, plus a latest-vs-previous movement summary.
router.get("/api/admin/seo/trends", requireAdmin, async (_req, res) => {
  try {
    const kws = await db
      .select({
        id: keywordTargets.id,
        keyword: keywordTargets.keyword,
        city: keywordTargets.city,
        trade: keywordTargets.trade,
        deliverability: keywordTargets.deliverability,
        avgMonthlySearches: keywordTargets.avgMonthlySearches,
        pagePublished: keywordTargets.pagePublished,
      })
      .from(keywordTargets);

    const snaps = await db
      .select({
        kid: rankSnapshots.keywordTargetId,
        engine: rankSnapshots.engine,
        position: rankSnapshots.position,
        capturedAt: rankSnapshots.capturedAt,
      })
      .from(rankSnapshots)
      .orderBy(rankSnapshots.capturedAt);

    const day = (d: Date) => new Date(d).toISOString().slice(0, 10);
    const runsSet = new Set<string>();
    const cell: Record<string, number | null> = {}; // `${kid}|${engine}|${day}` -> latest position that day
    for (const s of snaps) {
      const d = day(s.capturedAt as Date);
      runsSet.add(d);
      cell[`${s.kid}|${s.engine}|${d}`] = s.position ?? null; // ordered asc, so last wins
    }
    const runs = [...runsSet].sort();
    const li = runs.length - 1;
    const pi = runs.length - 2;

    const keywords = kws.map((k) => ({
      id: k.id,
      keyword: k.keyword,
      city: k.city,
      trade: k.trade,
      deliverability: k.deliverability,
      avgMonthlySearches: k.avgMonthlySearches,
      organic: runs.map((d) => cell[`${k.id}|google_organic|${d}`] ?? null),
      pack: runs.map((d) => cell[`${k.id}|google_pack|${d}`] ?? null),
    }));

    const at = (arr: (number | null)[], i: number) => (i >= 0 ? arr[i] ?? null : null);
    let rankingOrganic = 0, top10 = 0, top3 = 0, newlyRanking = 0, improved = 0, declined = 0, sumPos = 0, posCount = 0;
    for (const k of keywords) {
      const cur = at(k.organic, li);
      const prev = at(k.organic, pi);
      if (cur != null) { rankingOrganic++; if (cur <= 10) top10++; if (cur <= 3) top3++; sumPos += cur; posCount++; }
      if (cur != null && prev == null) newlyRanking++;
      if (cur != null && prev != null) { if (cur < prev) improved++; else if (cur > prev) declined++; }
    }
    const publishedPages = new Set(kws.filter((k) => k.pagePublished).map((k) => k.trade)).size;
    const rankingPages = new Set(keywords.filter((k) => at(k.organic, li) != null).map((k) => k.trade)).size;

    res.json({
      runs,
      keywords,
      summary: {
        latestRunAt: runs[li] ?? null,
        prevRunAt: runs[pi] ?? null,
        tracked: kws.length,
        rankingOrganic, top10, top3, newlyRanking, improved, declined,
        avgPositionLatest: posCount ? Math.round((sumPos / posCount) * 10) / 10 : null,
        publishedPages, rankingPages,
      },
    });
  } catch (error) {
    console.error("[SEO] Error fetching trends:", error);
    res.status(500).json({ error: "Failed to fetch SEO trends" });
  }
});

export default router;
