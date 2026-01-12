
import { Router } from "express";
import { db } from "./db";
import {
    landingPages,
    landingPageVariants,
    banners,
    insertLandingPageSchema,
    insertLandingPageVariantSchema,
    insertBannerSchema,
    landingPageRelations,
    landingPageVariantRelations
} from "../shared/schema";
import { eq, desc, and, sql } from "drizzle-orm";
import { z } from "zod";

// Helper: Sample from Beta Distribution (Thompson Sampling)
// Uses Normal approximation for large alpha/beta, and summation for small.
function sampleBeta(alpha: number, beta: number): number {
    const a = alpha;
    const b = beta;

    // Normal approximation for efficiency when counts are high
    if (a > 50 || b > 50) {
        const mean = a / (a + b);
        const variance = (a * b) / (Math.pow(a + b, 2) * (a + b + 1));
        const stdDev = Math.sqrt(variance);

        // Box-Muller transform for standard normal sample
        let u = 0, v = 0;
        while (u === 0) u = Math.random();
        while (v === 0) v = Math.random();
        const z = Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);

        return Math.min(1, Math.max(0, mean + z * stdDev));
    }

    // Direct Gamma interaction for smaller counts (sum of logs)
    // Gamma(n, 1) is sum of n exponential variables
    // This is a simplified integer-based Gamma approach suitable for discrete conversion counts
    const gamma = (n: number) => {
        let sum = 0;
        for (let i = 0; i < n; i++) {
            sum -= Math.log(Math.random());
        }
        return sum;
    };

    const x = gamma(Math.max(1, Math.floor(a)));
    const y = gamma(Math.max(1, Math.floor(b)));
    return x / (x + y);
}

const router = Router();

// ==========================================
// LANDING PAGES
// ==========================================

// Get all landing pages (Admin)
router.get("/landing-pages", async (req, res) => {
    try {
        const pages = await db.query.landingPages.findMany({
            with: {
                variants: true
            },
            orderBy: [desc(landingPages.createdAt)]
        });
        res.json(pages);
    } catch (error) {
        console.error("Error fetching landing pages:", error);
        res.status(500).json({ error: "Failed to fetch landing pages" });
    }
});

// Get single landing page by slug (Public)
router.get("/landing-pages/:slug", async (req, res) => {
    try {
        const page = await db.query.landingPages.findFirst({
            where: eq(landingPages.slug, req.params.slug),
            with: {
                variants: true
            }
        });

        if (!page) {
            return res.status(404).json({ error: "Landing page not found" });
        }

        if (page.status !== "active") {
            // Allow admin to see draft/inactive? Probably not on public route.
            // But existing code checked isActive. I migrated status.
            // Logic check: I replaced isActive with status enum in schema plan, but did I migrate existing data check?
            // Actually schema has status='active'.
            // Let's assume schema update replaced isActive with status.
            // If NOT, I should check what is in the DB.
            // My recent edit added optimizationMode but kept isActive.
            // So `page.isActive` is correct.
            if (!page.isActive) {
                return res.status(404).json({ error: "Landing page is not active" });
            }
        }

        // AUTO-OPTIMIZATION (Thompson Sampling)
        if (page.optimizationMode === 'auto' && page.variants.length > 1) {
            // 1. Calculate Score for each variant
            const scoredVariants = page.variants.map(v => {
                // Alpha = Successes + 1
                // Beta = Failures + 1 = (Views - Conversions) + 1
                // We add 1 for "Uniform Prior" (start neutral 50/50 chance)
                const alpha = v.conversionCount + 1;
                const beta = (v.viewCount - v.conversionCount) + 1;

                return {
                    ...v,
                    score: sampleBeta(alpha, beta)
                };
            });

            // 2. Pick Winner
            scoredVariants.sort((a, b) => b.score - a.score);
            const winner = scoredVariants[0];

            // 3. Mutate Weights: Winner get 100, others 0
            // This tricks the frontend into picking the winner.
            page.variants = page.variants.map(v => ({
                ...v,
                weight: v.id === winner.id ? 100 : 0
            }));
        }

        res.json(page);
    } catch (error) {
        console.error("Error fetching landing page:", error);
        res.status(500).json({ error: "Failed to fetch landing page" });
    }
});

// Create Landing Page (Admin)
router.post("/landing-pages", async (req, res) => {
    try {
        const data = insertLandingPageSchema.parse(req.body);
        const [page] = await db.insert(landingPages).values(data).returning();

        // Create default control variant
        await db.insert(landingPageVariants).values({
            landingPageId: page.id,
            name: "Control",
            weight: 100,
            content: {
                heroHeadline: "Welcome",
                heroSubhead: "The best service in town.",
                ctaText: "Get a Quote",
                heroImage: ""
            }
        });

        res.json(page);
    } catch (error) {
        console.error("Error creating landing page:", error);
        res.status(400).json({ error: "Failed to create landing page" });
    }
});

// Update Landing Page (Admin)
router.patch("/landing-pages/:id", async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        const [page] = await db.update(landingPages)
            .set(req.body)
            .where(eq(landingPages.id, id))
            .returning();
        res.json(page);
    } catch (error) {
        console.error("Error updating landing page:", error);
        res.status(500).json({ error: "Failed to update landing page" });
    }
});

// Delete Landing Page (Admin)
router.delete("/landing-pages/:id", async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        await db.delete(landingPages).where(eq(landingPages.id, id));
        res.json({ success: true });
    } catch (error) {
        console.error("Error deleting landing page:", error);
        res.status(500).json({ error: "Failed to delete landing page" });
    }
});

// ==========================================
// VARIANTS
// ==========================================

// Create Variant (Admin)
router.post("/landing-pages/:id/variants", async (req, res) => {
    try {
        const landingPageId = parseInt(req.params.id);
        const data = insertLandingPageVariantSchema.parse({
            ...req.body,
            landingPageId
        });

        const [variant] = await db.insert(landingPageVariants).values(data).returning();
        res.json(variant);
    } catch (error) {
        console.error("Error creating variant:", error);
        res.status(400).json({ error: "Failed to create variant" });
    }
});

// Update Variant (Admin)
router.patch("/variants/:id", async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        const [variant] = await db.update(landingPageVariants)
            .set(req.body)
            .where(eq(landingPageVariants.id, id))
            .returning();
        res.json(variant);
    } catch (error) {
        console.error("Error updating variant:", error);
        res.status(500).json({ error: "Failed to update variant" });
    }
});

// Delete Variant (Admin)
router.delete("/variants/:id", async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        await db.delete(landingPageVariants).where(eq(landingPageVariants.id, id));
        res.json({ success: true });
    } catch (error) {
        console.error("Error deleting variant:", error);
        res.status(500).json({ error: "Failed to delete variant" });
    }
});


// ==========================================
// BANNERS
// ==========================================

// Get active banners (Public)
router.get("/banners/active", async (req, res) => {
    try {
        const activeBanners = await db.query.banners.findMany({
            where: and(
                eq(banners.isActive, true),
                // Optional: Check dates if implemented
            )
        });
        res.json(activeBanners);
    } catch (error) {
        console.error("Error fetching banners:", error);
        res.status(500).json({ error: "Failed to fetch banners" });
    }
});

// Get all banners (Admin)
router.get("/banners", async (req, res) => {
    try {
        const allBanners = await db.query.banners.findMany({
            orderBy: [desc(banners.createdAt)]
        });
        res.json(allBanners);
    } catch (error) {
        console.error("Error fetching banners:", error);
        res.status(500).json({ error: "Failed to fetch banners" });
    }
});

// Create Banner
router.post("/banners", async (req, res) => {
    try {
        const data = insertBannerSchema.parse(req.body);
        const [banner] = await db.insert(banners).values(data).returning();
        res.json(banner);
    } catch (error) {
        console.error("Error creating banner:", error);
        res.status(400).json({ error: "Failed to create banner" });
    }
});

// Update Banner
router.patch("/banners/:id", async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        const [banner] = await db.update(banners)
            .set(req.body)
            .where(eq(banners.id, id))
            .returning();
        res.json(banner);
    } catch (error) {
        console.error("Error updating banner:", error);
        res.status(500).json({ error: "Failed to update banner" });
    }
});

// Delete Banner
router.delete("/banners/:id", async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        await db.delete(banners).where(eq(banners.id, id));
        res.json({ success: true });
    } catch (error) {
        console.error("Error deleting banner:", error);
        res.status(500).json({ error: "Failed to delete banner" });
    }
});

// ==========================================
// TRACKING
// ==========================================

// Track View/Conversion (Parallel to PostHog)
router.post("/content/track", async (req, res) => {
    try {
        const { type, id, action } = req.body; // type: 'variant' | 'banner', action: 'view' | 'click'

        if (type === 'variant') {
            if (action === 'view') {
                await db.update(landingPageVariants)
                    .set({ viewCount: sql`${landingPageVariants.viewCount} + 1` })
                    .where(eq(landingPageVariants.id, id));
            } else if (action === 'click') {
                await db.update(landingPageVariants)
                    .set({ conversionCount: sql`${landingPageVariants.conversionCount} + 1` })
                    .where(eq(landingPageVariants.id, id));
            }
        } else if (type === 'banner') {
            if (action === 'view') {
                await db.update(banners)
                    .set({ viewCount: sql`${banners.viewCount} + 1` })
                    .where(eq(banners.id, id));
            } else if (action === 'click') {
                await db.update(banners)
                    .set({ clickCount: sql`${banners.clickCount} + 1` })
                    .where(eq(banners.id, id));
            }
        }

        res.json({ success: true });
    } catch (error) {
        console.error("Error tracking event:", error);
        // Don't fail the request if tracking fails, just log it
        res.json({ success: false, error: "Tracking failed" });
    }
});

export default router;
