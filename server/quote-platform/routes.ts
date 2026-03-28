/**
 * Quote Platform API Routes
 *
 * Manages image library, headline variants, and testimonials used to
 * personalise contextual quote pages. Includes analytics aggregation
 * and a one-time seed endpoint.
 *
 * Endpoints:
 *   GET/POST/PATCH/DELETE /api/quote-platform/images
 *   POST                  /api/quote-platform/images/upload
 *   GET/POST/PATCH/DELETE /api/quote-platform/headlines
 *   GET/POST/PATCH/DELETE /api/quote-platform/testimonials
 *   GET                   /api/quote-platform/analytics
 *   POST                  /api/quote-platform/seed
 */

import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { eq, sql, count, isNotNull, desc, and, gte } from 'drizzle-orm';
import { S3Client, PutObjectCommand, ObjectCannedACL } from '@aws-sdk/client-s3';
import { nanoid } from 'nanoid';
import { db } from '../db';
import { requireAdmin } from '../auth';

// ---------------------------------------------------------------------------
// Analytics reset timestamp — persisted so it survives server restarts
// ---------------------------------------------------------------------------

const RESET_TIMESTAMP_FILE = path.join(process.cwd(), '.analytics-reset-at.json');

function loadResetAt(): Date | null {
  try {
    if (fs.existsSync(RESET_TIMESTAMP_FILE)) {
      const { resetAt } = JSON.parse(fs.readFileSync(RESET_TIMESTAMP_FILE, 'utf8'));
      return resetAt ? new Date(resetAt) : null;
    }
  } catch {}
  return null;
}

function saveResetAt(date: Date): void {
  try {
    fs.writeFileSync(RESET_TIMESTAMP_FILE, JSON.stringify({ resetAt: date.toISOString() }), 'utf8');
  } catch (e) {
    console.error('[quote-platform] Failed to persist analyticsResetAt:', e);
  }
}

let analyticsResetAt: Date | null = loadResetAt();
import {
  quotePlatformImages,
  quotePlatformHeadlines,
  quotePlatformTestimonials,
  personalizedQuotes,
} from '@shared/schema';

const router = Router();

// ---------------------------------------------------------------------------
// S3 helpers (mirrors content-library pattern)
// ---------------------------------------------------------------------------

function getS3Client(): S3Client {
  const bucket = process.env.AWS_S3_BUCKET;
  const accessKey = process.env.AWS_ACCESS_KEY_ID;
  const secretKey = process.env.AWS_SECRET_ACCESS_KEY;
  const region = process.env.AWS_REGION || 'eu-west-2';
  if (!bucket || !accessKey || !secretKey) {
    throw new Error('[quote-platform] Missing AWS S3 credentials');
  }
  return new S3Client({ region, credentials: { accessKeyId: accessKey, secretAccessKey: secretKey } });
}

const MIME_MAP: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
};

const imageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = /\.(jpg|jpeg|png|webp|svg)$/i;
    if (allowed.test(path.extname(file.originalname))) {
      cb(null, true);
    } else {
      cb(new Error('Only image files (jpg, png, webp, svg) are allowed'));
    }
  },
});

// ---------------------------------------------------------------------------
// Shape helpers — normalise Drizzle camelCase rows to snake_case for the UI
// ---------------------------------------------------------------------------

function shapeImage(r: typeof quotePlatformImages.$inferSelect) {
  return {
    id: r.id,
    url: r.url,
    filename: r.filename,
    alt: r.altText,
    archetypes: r.archetypes ?? [],
    gender_cues: r.genderCue ? [r.genderCue] : [],
    job_types: r.jobTypes ?? [],
    is_active: r.isActive ?? true,
    view_count: r.viewCount ?? 0,
    booking_count: r.bookingCount ?? 0,
    conversion_rate: r.viewCount ? ((r.bookingCount ?? 0) / r.viewCount) * 100 : undefined,
    created_at: r.createdAt,
  };
}

function shapeHeadline(r: typeof quotePlatformHeadlines.$inferSelect) {
  return {
    id: r.id,
    section: r.section,
    text: r.text,
    customer_type: r.customerType,
    is_active: r.isActive ?? true,
    view_count: r.viewCount ?? 0,
    booking_count: r.bookingCount ?? 0,
    conversion_rate: r.viewCount ? ((r.bookingCount ?? 0) / r.viewCount) * 100 : 0,
    created_at: r.createdAt,
  };
}

function shapeTestimonial(r: typeof quotePlatformTestimonials.$inferSelect) {
  return {
    id: r.id,
    author: r.author,
    text: r.text,
    rating: r.rating ?? 5,
    archetype: r.archetype,
    location: r.location,
    source: r.source ?? 'manual',
    is_active: r.isActive ?? true,
    view_count: r.viewCount ?? 0,
    booking_count: r.bookingCount ?? 0,
    created_at: r.createdAt,
  };
}

// ---------------------------------------------------------------------------
// IMAGES
// ---------------------------------------------------------------------------

router.get('/images', async (req, res) => {
  try {
    const { archetype, job_type } = req.query;
    let rows = await db.select().from(quotePlatformImages).orderBy(desc(quotePlatformImages.createdAt));

    if (archetype && typeof archetype === 'string') {
      rows = rows.filter((r) => Array.isArray(r.archetypes) && r.archetypes.includes(archetype));
    }
    if (job_type && typeof job_type === 'string') {
      rows = rows.filter((r) => Array.isArray(r.jobTypes) && r.jobTypes.includes(job_type));
    }

    return res.json(rows.map(shapeImage));
  } catch (error) {
    console.error('[quote-platform/images] GET error:', error);
    return res.status(500).json({ error: 'Failed to fetch images' });
  }
});

router.post('/images', async (req, res) => {
  try {
    const { url, filename, archetypes, gender_cue, job_types, alt_text } = req.body;
    if (!url || !filename) {
      return res.status(400).json({ error: 'url and filename are required' });
    }
    const [created] = await db
      .insert(quotePlatformImages)
      .values({
        url,
        filename,
        altText: alt_text ?? null,
        archetypes: archetypes ?? [],
        genderCue: gender_cue ?? 'neutral',
        jobTypes: job_types ?? [],
      })
      .returning();
    return res.status(201).json(shapeImage(created));
  } catch (error) {
    console.error('[quote-platform/images] POST error:', error);
    return res.status(500).json({ error: 'Failed to create image record' });
  }
});

router.patch('/images/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid id' });

    const updates: Record<string, unknown> = {};
    if (req.body.is_active !== undefined) updates.isActive = req.body.is_active;
    if (req.body.archetypes !== undefined) updates.archetypes = req.body.archetypes;
    if (req.body.job_types !== undefined) updates.jobTypes = req.body.job_types;
    if (req.body.gender_cue !== undefined) updates.genderCue = req.body.gender_cue;
    if (req.body.alt_text !== undefined) updates.altText = req.body.alt_text;
    if (req.body.url !== undefined) updates.url = req.body.url;

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'No valid fields to update' });
    }

    const [updated] = await db
      .update(quotePlatformImages)
      .set(updates)
      .where(eq(quotePlatformImages.id, id))
      .returning();
    if (!updated) return res.status(404).json({ error: 'Image not found' });
    return res.json(shapeImage(updated));
  } catch (error) {
    console.error('[quote-platform/images] PATCH error:', error);
    return res.status(500).json({ error: 'Failed to update image' });
  }
});

router.delete('/images/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid id' });

    const [deleted] = await db
      .delete(quotePlatformImages)
      .where(eq(quotePlatformImages.id, id))
      .returning();
    if (!deleted) return res.status(404).json({ error: 'Image not found' });
    return res.json({ success: true });
  } catch (error) {
    console.error('[quote-platform/images] DELETE error:', error);
    return res.status(500).json({ error: 'Failed to delete image' });
  }
});

// S3 multipart upload
router.post('/images/upload', imageUpload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No image file uploaded' });
    }

    const ext = path.extname(req.file.originalname).toLowerCase();
    const filename = `${nanoid(12)}${ext}`;
    const key = `quote-platform/${filename}`;
    const bucket = process.env.AWS_S3_BUCKET!;
    const region = process.env.AWS_REGION || 'eu-west-2';
    const contentType = MIME_MAP[ext] || 'application/octet-stream';

    const client = getS3Client();
    await client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: req.file.buffer,
        ContentType: contentType,
        ACL: ObjectCannedACL.public_read,
      }),
    );

    const url = `https://${bucket}.s3.${region}.amazonaws.com/${key}`;
    console.log(`[quote-platform/images] S3 upload: ${url}`);
    return res.json({ success: true, url, filename });
  } catch (error) {
    console.error('[quote-platform/images] S3 upload error:', error);
    return res.status(500).json({ error: 'Image upload failed' });
  }
});

// ---------------------------------------------------------------------------
// HEADLINES
// ---------------------------------------------------------------------------

router.get('/headlines', async (req, res) => {
  try {
    const { section } = req.query;
    let rows = await db.select().from(quotePlatformHeadlines).orderBy(quotePlatformHeadlines.section);

    if (section && typeof section === 'string') {
      rows = rows.filter((r) => r.section === section);
    }

    return res.json(rows.map(shapeHeadline));
  } catch (error) {
    console.error('[quote-platform/headlines] GET error:', error);
    return res.status(500).json({ error: 'Failed to fetch headlines' });
  }
});

router.post('/headlines', async (req, res) => {
  try {
    const { section, text, customer_type } = req.body;
    if (!section || !text || !customer_type) {
      return res.status(400).json({ error: 'section, text, and customer_type are required' });
    }
    const [created] = await db
      .insert(quotePlatformHeadlines)
      .values({ section, text, customerType: customer_type })
      .returning();
    return res.status(201).json(shapeHeadline(created));
  } catch (error) {
    console.error('[quote-platform/headlines] POST error:', error);
    return res.status(500).json({ error: 'Failed to create headline' });
  }
});

router.patch('/headlines/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid id' });

    const updates: Record<string, unknown> = {};
    if (req.body.section !== undefined) updates.section = req.body.section;
    if (req.body.text !== undefined) updates.text = req.body.text;
    if (req.body.customer_type !== undefined) updates.customerType = req.body.customer_type;
    if (req.body.is_active !== undefined) updates.isActive = req.body.is_active;

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'No valid fields to update' });
    }

    const [updated] = await db
      .update(quotePlatformHeadlines)
      .set(updates)
      .where(eq(quotePlatformHeadlines.id, id))
      .returning();
    if (!updated) return res.status(404).json({ error: 'Headline not found' });
    return res.json(shapeHeadline(updated));
  } catch (error) {
    console.error('[quote-platform/headlines] PATCH error:', error);
    return res.status(500).json({ error: 'Failed to update headline' });
  }
});

router.delete('/headlines/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid id' });

    const [deleted] = await db
      .delete(quotePlatformHeadlines)
      .where(eq(quotePlatformHeadlines.id, id))
      .returning();
    if (!deleted) return res.status(404).json({ error: 'Headline not found' });
    return res.json({ success: true });
  } catch (error) {
    console.error('[quote-platform/headlines] DELETE error:', error);
    return res.status(500).json({ error: 'Failed to delete headline' });
  }
});

// ---------------------------------------------------------------------------
// TESTIMONIALS
// ---------------------------------------------------------------------------

router.get('/testimonials', async (req, res) => {
  try {
    const { archetype } = req.query;
    let rows = await db
      .select()
      .from(quotePlatformTestimonials)
      .orderBy(desc(quotePlatformTestimonials.createdAt));

    if (archetype && typeof archetype === 'string') {
      rows = rows.filter((r) => r.archetype === archetype);
    }

    return res.json(rows.map(shapeTestimonial));
  } catch (error) {
    console.error('[quote-platform/testimonials] GET error:', error);
    return res.status(500).json({ error: 'Failed to fetch testimonials' });
  }
});

router.post('/testimonials', async (req, res) => {
  try {
    const { author, text, rating, archetype, location, source } = req.body;
    if (!author || !text || !archetype) {
      return res.status(400).json({ error: 'author, text, and archetype are required' });
    }
    const [created] = await db
      .insert(quotePlatformTestimonials)
      .values({
        author,
        text,
        rating: rating ?? 5,
        archetype,
        location: location ?? null,
        source: source ?? 'manual',
      })
      .returning();
    return res.status(201).json(shapeTestimonial(created));
  } catch (error) {
    console.error('[quote-platform/testimonials] POST error:', error);
    return res.status(500).json({ error: 'Failed to create testimonial' });
  }
});

router.patch('/testimonials/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid id' });

    const updates: Record<string, unknown> = {};
    if (req.body.author !== undefined) updates.author = req.body.author;
    if (req.body.text !== undefined) updates.text = req.body.text;
    if (req.body.rating !== undefined) updates.rating = req.body.rating;
    if (req.body.archetype !== undefined) updates.archetype = req.body.archetype;
    if (req.body.location !== undefined) updates.location = req.body.location;
    if (req.body.source !== undefined) updates.source = req.body.source;
    if (req.body.is_active !== undefined) updates.isActive = req.body.is_active;

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'No valid fields to update' });
    }

    const [updated] = await db
      .update(quotePlatformTestimonials)
      .set(updates)
      .where(eq(quotePlatformTestimonials.id, id))
      .returning();
    if (!updated) return res.status(404).json({ error: 'Testimonial not found' });
    return res.json(shapeTestimonial(updated));
  } catch (error) {
    console.error('[quote-platform/testimonials] PATCH error:', error);
    return res.status(500).json({ error: 'Failed to update testimonial' });
  }
});

router.delete('/testimonials/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid id' });

    const [deleted] = await db
      .delete(quotePlatformTestimonials)
      .where(eq(quotePlatformTestimonials.id, id))
      .returning();
    if (!deleted) return res.status(404).json({ error: 'Testimonial not found' });
    return res.json({ success: true });
  } catch (error) {
    console.error('[quote-platform/testimonials] DELETE error:', error);
    return res.status(500).json({ error: 'Failed to delete testimonial' });
  }
});

// ---------------------------------------------------------------------------
// ANALYTICS
// ---------------------------------------------------------------------------

router.get('/analytics', requireAdmin, async (req, res) => {
  try {
    const pq = personalizedQuotes;
    // Only count CONTEXTUAL segment quotes created after the last analytics reset
    const contextualFilter = analyticsResetAt
      ? and(eq(pq.segment, 'CONTEXTUAL'), gte(pq.createdAt, analyticsResetAt))
      : eq(pq.segment, 'CONTEXTUAL');

    // Funnel — CONTEXTUAL quotes only
    const [funnelData] = await db
      .select({
        total_quotes: count(),
        total_viewed: count(pq.viewedAt),
        total_booked: count(pq.bookedAt),
        total_paid: count(pq.depositPaidAt),
      })
      .from(pq)
      .where(contextualFilter);

    // Layout tier breakdown
    const layoutTiers = await db
      .select({
        layout_tier: pq.layoutTier,
        quote_count: count(),
        viewed_count: count(pq.viewedAt),
        booked_count: count(pq.bookedAt),
      })
      .from(pq)
      .where(and(contextualFilter, isNotNull(pq.layoutTier)))
      .groupBy(pq.layoutTier);

    // Headline performance — which AI-generated headlines convert best
    const headlinePerf = await db
      .select({
        headline: pq.contextualHeadline,
        total: count(),
        viewed: count(pq.viewedAt),
        booked: count(pq.bookedAt),
      })
      .from(pq)
      .where(and(contextualFilter, isNotNull(pq.contextualHeadline)))
      .groupBy(pq.contextualHeadline)
      .orderBy(desc(count(pq.bookedAt)))
      .limit(10);

    // Image performance from quotePlatformImages (view/booking counts incremented by tracking endpoints)
    const imagePerf = await db
      .select({
        id: quotePlatformImages.id,
        url: quotePlatformImages.url,
        alt: quotePlatformImages.altText,
        archetypes: quotePlatformImages.archetypes,
        view_count: quotePlatformImages.viewCount,
        booking_count: quotePlatformImages.bookingCount,
      })
      .from(quotePlatformImages)
      .where(eq(quotePlatformImages.isActive, true))
      .orderBy(desc(quotePlatformImages.bookingCount))
      .limit(10);

    // VA context quality breakdown (none / short <50 chars / rich ≥50 chars)
    const allContextual = await db
      .select({ contextSignals: pq.contextSignals, viewedAt: pq.viewedAt, bookedAt: pq.bookedAt })
      .from(pq)
      .where(contextualFilter);

    const contextBuckets = { none: 0, short: 0, rich: 0 };
    const contextConversions = { none: 0, short: 0, rich: 0 };
    for (const row of allContextual) {
      const ctx = row.contextSignals ? JSON.stringify(row.contextSignals) : '';
      const bucket = ctx.length === 0 ? 'none' : ctx.length < 100 ? 'short' : 'rich';
      contextBuckets[bucket]++;
      if (row.bookedAt) contextConversions[bucket]++;
    }

    const sent = Number(funnelData?.total_quotes ?? 0);
    const viewed = Number(funnelData?.total_viewed ?? 0);
    const booked = Number(funnelData?.total_booked ?? 0);
    const paid = Number(funnelData?.total_paid ?? 0);

    return res.json({
      reset_at: analyticsResetAt ? analyticsResetAt.toISOString() : null,
      funnel: { sent, viewed, booked, paid },
      tiers: layoutTiers.map(t => ({
        tier: t.layout_tier,
        count: Number(t.quote_count),
        viewed: Number(t.viewed_count),
        booked: Number(t.booked_count),
        conversion: Number(t.viewed_count) > 0 ? Math.round((Number(t.booked_count) / Number(t.viewed_count)) * 100) : 0,
      })),
      headline_performance: headlinePerf.map(h => ({
        headline: h.headline,
        total: Number(h.total),
        viewed: Number(h.viewed),
        booked: Number(h.booked),
        conversion: Number(h.viewed) > 0 ? Math.round((Number(h.booked) / Number(h.viewed)) * 100) : 0,
      })),
      image_performance: imagePerf.map(img => ({
        id: img.id,
        url: img.url,
        alt: img.alt,
        archetypes: img.archetypes ?? [],
        view_count: Number(img.view_count ?? 0),
        booking_count: Number(img.booking_count ?? 0),
        conversion_rate: Number(img.view_count ?? 0) > 0
          ? Math.round((Number(img.booking_count ?? 0) / Number(img.view_count ?? 0)) * 100)
          : 0,
      })),
      context_quality: {
        buckets: contextBuckets,
        conversions: contextConversions,
      },
    });
  } catch (error) {
    console.error('[quote-platform/analytics] GET error:', error);
    return res.status(500).json({ error: 'Failed to fetch analytics' });
  }
});

// Reset analytics — zeros image/headline counters AND stamps a resetAt date so funnel only counts new quotes
// Optional body: { since: ISO8601 string } to set a specific start date instead of now
router.post('/analytics/reset', requireAdmin, async (req, res) => {
  try {
    await db.update(quotePlatformImages).set({ viewCount: 0, bookingCount: 0 });
    await db.update(quotePlatformHeadlines).set({ viewCount: 0, bookingCount: 0 });
    const customDate = req.body?.since ? new Date(req.body.since) : null;
    analyticsResetAt = (customDate && !isNaN(customDate.getTime())) ? customDate : new Date();
    saveResetAt(analyticsResetAt);
    console.log(`[quote-platform/analytics] Reset: counters zeroed, analyticsResetAt = ${analyticsResetAt.toISOString()}`);
    return res.json({ ok: true, reset_at: analyticsResetAt.toISOString(), message: 'Analytics reset. Only quotes created after this timestamp will appear in the funnel.' });
  } catch (error) {
    console.error('[quote-platform/analytics] Reset error:', error);
    return res.status(500).json({ error: 'Failed to reset analytics' });
  }
});

// ---------------------------------------------------------------------------
// SEED
// ---------------------------------------------------------------------------

async function seedQuotePlatform(): Promise<{ seeded: boolean; message: string }> {
  // Check if tables already have data
  const [imageCount] = await db.select({ c: count() }).from(quotePlatformImages);
  const [headlineCount] = await db.select({ c: count() }).from(quotePlatformHeadlines);
  const [testimonialCount] = await db.select({ c: count() }).from(quotePlatformTestimonials);

  if (
    Number(imageCount.c) > 0 &&
    Number(headlineCount.c) > 0 &&
    Number(testimonialCount.c) > 0
  ) {
    return { seeded: false, message: 'Tables already have data — seed skipped' };
  }

  // ---- Images ----
  if (Number(imageCount.c) === 0) {
    await db.insert(quotePlatformImages).values([
      {
        url: '/assets/quote-images/door-greeting.jpg',
        filename: 'door-greeting.jpg',
        altText: 'Tradesperson greeting customer at the door',
        archetypes: ['homeowner', 'landlord'],
        genderCue: 'neutral',
        jobTypes: ['general'],
      },
      {
        url: '/assets/quote-images/plumber-smile.jpg',
        filename: 'plumber-smile.jpg',
        altText: 'Smiling plumber ready to help',
        archetypes: ['homeowner'],
        genderCue: 'male',
        jobTypes: ['plumbing'],
      },
      {
        url: '/assets/quote-images/older-person-door.jpg',
        filename: 'older-person-door.jpg',
        altText: 'Older homeowner welcoming tradesperson',
        archetypes: ['elderly', 'homeowner'],
        genderCue: 'female',
        jobTypes: ['general'],
      },
      {
        url: '/assets/quote-images/tap-repair.png',
        filename: 'tap-repair.png',
        altText: 'Close-up of tap repair work',
        archetypes: ['homeowner', 'landlord'],
        genderCue: 'neutral',
        jobTypes: ['plumbing'],
      },
      {
        url: '/assets/quote-images/painting.png',
        filename: 'painting.png',
        altText: 'Decorator painting a wall',
        archetypes: ['homeowner'],
        genderCue: 'neutral',
        jobTypes: ['painting'],
      },
      {
        url: '/assets/quote-images/bathroom-repair.png',
        filename: 'bathroom-repair.png',
        altText: 'Bathroom repair and refurbishment work',
        archetypes: ['homeowner', 'landlord'],
        genderCue: 'neutral',
        jobTypes: ['plumbing', 'carpentry'],
      },
    ]);
    console.log('[quote-platform] Seeded 6 images');
  }

  // ---- Headlines ----
  if (Number(headlineCount.c) === 0) {
    await db.insert(quotePlatformHeadlines).values([
      // social_proof
      { section: 'social_proof', text: 'Trusted by {city} homeowners', customerType: 'homeowners' },
      { section: 'social_proof', text: 'Trusted by {city} landlords', customerType: 'landlords' },
      { section: 'social_proof', text: 'Trusted by {city} professionals', customerType: 'professionals' },
      { section: 'social_proof', text: 'Trusted by {city} property managers', customerType: 'property_managers' },
      // guarantee
      { section: 'guarantee', text: 'Not right? We return and fix it free.', customerType: 'homeowners' },
      { section: 'guarantee', text: 'Your property protected. Our guarantee.', customerType: 'landlords' },
      { section: 'guarantee', text: 'Zero hassle. 90-day guarantee.', customerType: 'professionals' },
      // hassle_comparison
      { section: 'hassle_comparison', text: 'Why homeowners choose us.', customerType: 'homeowners' },
      { section: 'hassle_comparison', text: 'Why landlords choose us.', customerType: 'landlords' },
      { section: 'hassle_comparison', text: 'Why professionals choose us.', customerType: 'professionals' },
    ]);
    console.log('[quote-platform] Seeded 10 headlines');
  }

  // ---- Testimonials ----
  if (Number(testimonialCount.c) === 0) {
    await db.insert(quotePlatformTestimonials).values([
      {
        author: 'Sarah T.',
        text: 'Booked online, they came next day, sorted the leak and left the place spotless. Brilliant service.',
        rating: 5,
        archetype: 'homeowner',
        location: 'London',
        source: 'google',
      },
      {
        author: 'James R.',
        text: 'I live two hours away. They coordinated with my tenant, sent photos, and the invoice was in my email by 5pm. Exactly what I needed.',
        rating: 5,
        archetype: 'landlord',
        location: 'Manchester',
        source: 'google',
      },
      {
        author: 'Margaret H.',
        text: 'Very polite young man. He explained everything clearly, no surprise charges, and cleaned up after himself. Would definitely call again.',
        rating: 5,
        archetype: 'elderly',
        location: 'Birmingham',
        source: 'manual',
      },
      {
        author: 'David K.',
        text: 'Quick quote, competitive price, and the team turned up on time every day. Professional outfit, no messing about.',
        rating: 5,
        archetype: 'property_manager',
        location: 'Bristol',
        source: 'google',
      },
    ]);
    console.log('[quote-platform] Seeded 4 testimonials');
  }

  return { seeded: true, message: 'Quote platform seeded successfully' };
}

router.post('/seed', async (req, res) => {
  try {
    const result = await seedQuotePlatform();
    return res.json(result);
  } catch (error) {
    console.error('[quote-platform/seed] error:', error);
    return res.status(500).json({ error: 'Seed failed', details: String(error) });
  }
});

// ---------------------------------------------------------------------------
// Auto-seed on startup if tables are empty
// ---------------------------------------------------------------------------

export async function autoSeedIfEmpty(): Promise<void> {
  try {
    const result = await seedQuotePlatform();
    if (result.seeded) {
      console.log('[quote-platform] Auto-seed complete');
    }
  } catch (error) {
    console.warn('[quote-platform] Auto-seed failed (non-fatal):', error);
  }
}

export default router;
