// MOUNT: app.use(seoRoutes) in server/index.ts (or wherever routers are registered)
import { Router } from "express";
import { db } from "./db";
import { keywordTargets, rankSnapshots, gmbMetrics } from "@shared/schema";
import { desc, eq, sql } from "drizzle-orm";
import { requireAdmin } from "./auth";

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

export default router;
