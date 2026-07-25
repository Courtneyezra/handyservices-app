// MOUNT in server/index.ts: app.use(seoPagesRouter) — must be placed AFTER all /api routers and BEFORE the Vite middleware / SPA catch-all (the app.use('*', ...) that serves index.html). Do NOT mount it before the API routers.
//
// Server-rendered SEO landing pages ("Handy Services", Nottingham/Derby).
// URL structure (see server/seo/contract.ts):
//   T1 city hub        /:city                    e.g. /nottingham
//   T2 service x city  /:city/:service           e.g. /nottingham/gutter-cleaning
//   T3 job x suburb    /:city/:service/:suburb    e.g. /nottingham/gutter-cleaning/beeston
// Every dynamic route calls next() when :city is not a known SEO city slug, so
// this router never swallows SPA / asset / API routes.

import { Router } from "express";
import { db } from "./db";
import { keywordTargets } from "@shared/schema";
import { eq } from "drizzle-orm";
import { SEO_CITIES, SEO_SERVICES } from "./seo/contract";
import {
    renderCityHub,
    renderServiceCity,
    renderJobSuburb,
    renderSitemapXml,
} from "./seo/render";

const router = Router();

// Known SEO city slugs — the guard set for every dynamic route.
const SEO_CITY_SLUGS = new Set(SEO_CITIES.map((c) => c.slug));

// ── /sitemap.xml ──────────────────────────────────────────────────────────
router.get("/sitemap.xml", async (_req, res) => {
    let publishedSlugs: string[] = [];
    try {
        const rows = await db
            .selectDistinct({ trade: keywordTargets.trade })
            .from(keywordTargets)
            .where(eq(keywordTargets.pagePublished, true));
        publishedSlugs = rows.map((r) => r.trade).filter(Boolean);
    } catch (err) {
        console.error("[SEO] sitemap: keywordTargets query failed, falling back to core services:", err);
    }

    // Never emit an empty sitemap (dev / empty DB) — fall back to all core services.
    if (publishedSlugs.length === 0) {
        publishedSlugs = SEO_SERVICES
            .filter((s) => s.deliverability === "core")
            .map((s) => s.slug);
    }

    res.setHeader("Content-Type", "application/xml");
    res.send(renderSitemapXml(publishedSlugs));
});

// ── /robots.txt ───────────────────────────────────────────────────────────
router.get("/robots.txt", (_req, res) => {
    res.setHeader("Content-Type", "text/plain");
    res.send(
        [
            "User-agent: *",
            "Allow: /",
            "",
            "Sitemap: https://www.handyservices.app/sitemap.xml",
            "# AI / LLM crawlers: see https://www.handyservices.app/llms.txt",
            "",
        ].join("\n"),
    );
});

// ── T3: /:city/:service/:suburb ─────────────────────────────────────────────
router.get("/:city/:service/:suburb", (req, res, next) => {
    if (!SEO_CITY_SLUGS.has(req.params.city)) return next();
    const result = renderJobSuburb(req.params.city, req.params.service, req.params.suburb);
    res.status(result.status).setHeader("Content-Type", "text/html");
    res.send(result.html);
});

// ── T2: /:city/:service ─────────────────────────────────────────────────────
router.get("/:city/:service", (req, res, next) => {
    if (!SEO_CITY_SLUGS.has(req.params.city)) return next();
    const result = renderServiceCity(req.params.city, req.params.service);
    res.status(result.status).setHeader("Content-Type", "text/html");
    res.send(result.html);
});

// Cities whose bare /:city URL serves the rich React landing (via the SPA)
// instead of the generated SEO hub. Deeper T2/T3 service/suburb pages still
// render as SEO. The T1 hubs were low value (Derby's was noindex); the React
// landings carry the brand, team roster and conversion flow.
const FULL_LANDING_CITIES = new Set(["nottingham", "derby"]);

// ── T1: /:city ──────────────────────────────────────────────────────────────
router.get("/:city", (req, res, next) => {
    if (!SEO_CITY_SLUGS.has(req.params.city)) return next();
    if (FULL_LANDING_CITIES.has(req.params.city)) return next(); // → SPA React landing
    const result = renderCityHub(req.params.city);
    res.status(result.status).setHeader("Content-Type", "text/html");
    res.send(result.html);
});

export default router;
