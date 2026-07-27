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
import { SEO_CITIES } from "./seo/contract";
import {
    renderCityHub,
    renderServiceCity,
    renderJobSuburb,
    renderSitemapXml,
} from "./seo/render";
import { ROLLOUT, getPublishedTradesByCity, isTradePublished } from "./seo/rollout";

const router = Router();

// Known SEO city slugs — the guard set for every dynamic route.
const SEO_CITY_SLUGS = new Set(SEO_CITIES.map((c) => c.slug));

// ── /sitemap.xml ──────────────────────────────────────────────────────────
// Lists T1 hubs + published T2 pages only. Suburb (T3) pages are excluded
// while they ship noindex (ROLLOUT.T3_INDEXABLE) — a noindex URL must not
// appear in the sitemap.
router.get("/sitemap.xml", async (_req, res) => {
    const publishedByCity = await getPublishedTradesByCity();
    res.setHeader("Content-Type", "application/xml");
    res.send(
        renderSitemapXml(publishedByCity, { includeSuburbs: ROLLOUT.T3_INDEXABLE }),
    );
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
// Served during rollout as noindex,follow (crawlable for link equity, not
// indexed) until suburb pages carry unique local content — see ROLLOUT.
router.get("/:city/:service/:suburb", (req, res, next) => {
    if (!SEO_CITY_SLUGS.has(req.params.city)) return next();
    const result = renderJobSuburb(req.params.city, req.params.service, req.params.suburb, {
        indexable: ROLLOUT.T3_INDEXABLE,
    });
    res.status(result.status).setHeader("Content-Type", "text/html");
    res.send(result.html);
});

// ── T2: /:city/:service ─────────────────────────────────────────────────────
// Indexable only when the trade is published (per-trade stagger control).
router.get("/:city/:service", async (req, res, next) => {
    if (!SEO_CITY_SLUGS.has(req.params.city)) return next();
    const indexable = await isTradePublished(req.params.city, req.params.service);
    const result = renderServiceCity(req.params.city, req.params.service, {
        indexable,
    });
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
