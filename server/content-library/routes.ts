/**
 * Content Library API Routes
 *
 * CRUD endpoints for all content types + intelligent content selection.
 *
 * Endpoints:
 *   GET/POST/PUT/DELETE /api/content/claims
 *   GET/POST/PUT/DELETE /api/content/images
 *   GET/POST/PUT/DELETE /api/content/guarantees
 *   GET/POST/PUT/DELETE /api/content/testimonials
 *   GET/POST/PUT/DELETE /api/content/hassle-items
 *   GET/POST/PUT/DELETE /api/content/booking-rules
 *   POST /api/content/select          — Intelligent content selection by category + signals
 *   GET  /api/content/stats           — Counts and conversion rates per content type
 */

import { Router } from 'express';
import { eq, sql, and } from 'drizzle-orm';
import multer from 'multer';
import path from 'path';
import { nanoid } from 'nanoid';
import { S3Client, PutObjectCommand, ObjectCannedACL } from '@aws-sdk/client-s3';
import { db } from '../db';
import {
  contentClaims,
  contentImages,
  contentGuarantees,
  contentTestimonials,
  contentHassleItems,
  contentBookingRules,
} from '@shared/schema';
import type {
  ContentClaim,
  ContentImage,
  ContentGuarantee,
  ContentTestimonial,
  ContentHassleItem,
  ContentBookingRule,
} from '@shared/schema';

const router = Router();

// ---------------------------------------------------------------------------
// Helper: Score an item by how well it matches the requested categories + signals
// ---------------------------------------------------------------------------

function scoreItem(
  item: { jobCategories?: string[] | null; signals?: Record<string, any> | null },
  categories: string[],
  signals: Record<string, any>,
): number {
  let score = 0;

  // Category matching: +1 per matching category
  if (item.jobCategories && item.jobCategories.length > 0) {
    for (const cat of item.jobCategories) {
      if (categories.includes(cat)) {
        score += 1;
      }
    }
  }
  // Universal items (no categories) get +0 — they still appear but rank below matches

  // Signal matching: +2 per matching signal key/value
  if (item.signals && typeof item.signals === 'object') {
    const itemSignals = item.signals as Record<string, any>;
    for (const [key, value] of Object.entries(itemSignals)) {
      if (signals[key] !== undefined && signals[key] === value) {
        score += 2;
      }
    }
  }

  return score;
}

function selectTopN<T extends { jobCategories?: string[] | null; signals?: Record<string, any> | null }>(
  items: T[],
  categories: string[],
  signals: Record<string, any>,
  n: number,
): T[] {
  const scored = items.map((item) => ({
    item,
    score: scoreItem(item, categories, signals),
  }));

  scored.sort((a, b) => b.score - a.score);

  return scored.slice(0, n).map((s) => s.item);
}

// ---------------------------------------------------------------------------
// CLAIMS CRUD
// ---------------------------------------------------------------------------

router.get('/api/content/claims', async (req, res) => {
  try {
    const activeFilter = req.query.active;
    let results;
    if (activeFilter === 'true') {
      results = await db.select().from(contentClaims).where(eq(contentClaims.isActive, true));
    } else {
      results = await db.select().from(contentClaims);
    }
    return res.json(results);
  } catch (error) {
    console.error('[content/claims] GET error:', error);
    return res.status(500).json({ error: 'Failed to fetch claims' });
  }
});

router.post('/api/content/claims', async (req, res) => {
  try {
    const { text, category, jobCategories, signals } = req.body;
    if (!text || typeof text !== 'string') {
      return res.status(400).json({ error: 'text is required' });
    }
    const [created] = await db.insert(contentClaims).values({
      text,
      category: category || null,
      jobCategories: jobCategories || null,
      signals: signals || null,
    }).returning();
    return res.status(201).json(created);
  } catch (error) {
    console.error('[content/claims] POST error:', error);
    return res.status(500).json({ error: 'Failed to create claim' });
  }
});

router.put('/api/content/claims/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid id' });

    const updates: Record<string, any> = { updatedAt: new Date() };
    if (req.body.text !== undefined) updates.text = req.body.text;
    if (req.body.category !== undefined) updates.category = req.body.category;
    if (req.body.jobCategories !== undefined) updates.jobCategories = req.body.jobCategories;
    if (req.body.signals !== undefined) updates.signals = req.body.signals;
    if (req.body.isActive !== undefined) updates.isActive = req.body.isActive;

    const [updated] = await db.update(contentClaims).set(updates).where(eq(contentClaims.id, id)).returning();
    if (!updated) return res.status(404).json({ error: 'Claim not found' });
    return res.json(updated);
  } catch (error) {
    console.error('[content/claims] PUT error:', error);
    return res.status(500).json({ error: 'Failed to update claim' });
  }
});

router.delete('/api/content/claims/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid id' });

    const [updated] = await db
      .update(contentClaims)
      .set({ isActive: false, updatedAt: new Date() })
      .where(eq(contentClaims.id, id))
      .returning();
    if (!updated) return res.status(404).json({ error: 'Claim not found' });
    return res.json({ success: true, id });
  } catch (error) {
    console.error('[content/claims] DELETE error:', error);
    return res.status(500).json({ error: 'Failed to soft-delete claim' });
  }
});

// ---------------------------------------------------------------------------
// IMAGES CRUD
// ---------------------------------------------------------------------------

router.get('/api/content/images', async (req, res) => {
  try {
    const activeFilter = req.query.active;
    let results;
    if (activeFilter === 'true') {
      results = await db.select().from(contentImages).where(eq(contentImages.isActive, true));
    } else {
      results = await db.select().from(contentImages);
    }
    return res.json(results);
  } catch (error) {
    console.error('[content/images] GET error:', error);
    return res.status(500).json({ error: 'Failed to fetch images' });
  }
});

router.post('/api/content/images', async (req, res) => {
  try {
    const { url, alt, placement, jobCategories } = req.body;
    if (!url || typeof url !== 'string') {
      return res.status(400).json({ error: 'url is required' });
    }
    const [created] = await db.insert(contentImages).values({
      url,
      alt: alt || null,
      placement: placement || null,
      jobCategories: jobCategories || null,
    }).returning();
    return res.status(201).json(created);
  } catch (error) {
    console.error('[content/images] POST error:', error);
    return res.status(500).json({ error: 'Failed to create image' });
  }
});

router.put('/api/content/images/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid id' });

    const updates: Record<string, any> = { updatedAt: new Date() };
    if (req.body.url !== undefined) updates.url = req.body.url;
    if (req.body.alt !== undefined) updates.alt = req.body.alt;
    if (req.body.placement !== undefined) updates.placement = req.body.placement;
    if (req.body.jobCategories !== undefined) updates.jobCategories = req.body.jobCategories;
    if (req.body.isActive !== undefined) updates.isActive = req.body.isActive;

    const [updated] = await db.update(contentImages).set(updates).where(eq(contentImages.id, id)).returning();
    if (!updated) return res.status(404).json({ error: 'Image not found' });
    return res.json(updated);
  } catch (error) {
    console.error('[content/images] PUT error:', error);
    return res.status(500).json({ error: 'Failed to update image' });
  }
});

router.delete('/api/content/images/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid id' });

    const [updated] = await db
      .update(contentImages)
      .set({ isActive: false, updatedAt: new Date() })
      .where(eq(contentImages.id, id))
      .returning();
    if (!updated) return res.status(404).json({ error: 'Image not found' });
    return res.json({ success: true, id });
  } catch (error) {
    console.error('[content/images] DELETE error:', error);
    return res.status(500).json({ error: 'Failed to soft-delete image' });
  }
});

// ---------------------------------------------------------------------------
// IMAGE UPLOAD (S3)
// ---------------------------------------------------------------------------

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

function getContentS3Client(): S3Client {
  const bucket = process.env.AWS_S3_BUCKET;
  const accessKey = process.env.AWS_ACCESS_KEY_ID;
  const secretKey = process.env.AWS_SECRET_ACCESS_KEY;
  const region = process.env.AWS_REGION || 'eu-west-2';
  if (!bucket || !accessKey || !secretKey) {
    throw new Error('Missing AWS S3 credentials');
  }
  return new S3Client({ region, credentials: { accessKeyId: accessKey, secretAccessKey: secretKey } });
}

const MIME_MAP: Record<string, string> = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
  '.webp': 'image/webp', '.svg': 'image/svg+xml',
};

router.post('/api/content/images/upload', imageUpload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No image file uploaded' });
    }

    const ext = path.extname(req.file.originalname).toLowerCase();
    const filename = `${nanoid(12)}${ext}`;
    const key = `content-library/${filename}`;
    const bucket = process.env.AWS_S3_BUCKET!;
    const region = process.env.AWS_REGION || 'eu-west-2';
    const contentType = MIME_MAP[ext] || 'application/octet-stream';

    const client = getContentS3Client();
    await client.send(new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: req.file.buffer,
      ContentType: contentType,
      ACL: ObjectCannedACL.public_read,
    }));

    const url = `https://${bucket}.s3.${region}.amazonaws.com/${key}`;
    console.log(`[content/images] S3 upload: ${url}`);
    return res.json({ success: true, url, filename });
  } catch (error) {
    console.error('[content/images] S3 upload error:', error);
    return res.status(500).json({ error: 'Image upload failed' });
  }
});

// ---------------------------------------------------------------------------
// GUARANTEES CRUD
// ---------------------------------------------------------------------------

router.get('/api/content/guarantees', async (req, res) => {
  try {
    const activeFilter = req.query.active;
    let results;
    if (activeFilter === 'true') {
      results = await db.select().from(contentGuarantees).where(eq(contentGuarantees.isActive, true));
    } else {
      results = await db.select().from(contentGuarantees);
    }
    return res.json(results);
  } catch (error) {
    console.error('[content/guarantees] GET error:', error);
    return res.status(500).json({ error: 'Failed to fetch guarantees' });
  }
});

router.post('/api/content/guarantees', async (req, res) => {
  try {
    const { title, description, items, badges, jobCategories, signals } = req.body;
    if (!title || typeof title !== 'string') {
      return res.status(400).json({ error: 'title is required' });
    }
    const [created] = await db.insert(contentGuarantees).values({
      title,
      description: description || null,
      items: items || null,
      badges: badges || null,
      jobCategories: jobCategories || null,
      signals: signals || null,
    }).returning();
    return res.status(201).json(created);
  } catch (error) {
    console.error('[content/guarantees] POST error:', error);
    return res.status(500).json({ error: 'Failed to create guarantee' });
  }
});

router.put('/api/content/guarantees/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid id' });

    const updates: Record<string, any> = { updatedAt: new Date() };
    if (req.body.title !== undefined) updates.title = req.body.title;
    if (req.body.description !== undefined) updates.description = req.body.description;
    if (req.body.items !== undefined) updates.items = req.body.items;
    if (req.body.badges !== undefined) updates.badges = req.body.badges;
    if (req.body.jobCategories !== undefined) updates.jobCategories = req.body.jobCategories;
    if (req.body.signals !== undefined) updates.signals = req.body.signals;
    if (req.body.isActive !== undefined) updates.isActive = req.body.isActive;

    const [updated] = await db.update(contentGuarantees).set(updates).where(eq(contentGuarantees.id, id)).returning();
    if (!updated) return res.status(404).json({ error: 'Guarantee not found' });
    return res.json(updated);
  } catch (error) {
    console.error('[content/guarantees] PUT error:', error);
    return res.status(500).json({ error: 'Failed to update guarantee' });
  }
});

router.delete('/api/content/guarantees/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid id' });

    const [updated] = await db
      .update(contentGuarantees)
      .set({ isActive: false, updatedAt: new Date() })
      .where(eq(contentGuarantees.id, id))
      .returning();
    if (!updated) return res.status(404).json({ error: 'Guarantee not found' });
    return res.json({ success: true, id });
  } catch (error) {
    console.error('[content/guarantees] DELETE error:', error);
    return res.status(500).json({ error: 'Failed to soft-delete guarantee' });
  }
});

// ---------------------------------------------------------------------------
// TESTIMONIALS CRUD
// ---------------------------------------------------------------------------

router.get('/api/content/testimonials', async (req, res) => {
  try {
    const activeFilter = req.query.active;
    let results;
    if (activeFilter === 'true') {
      results = await db.select().from(contentTestimonials).where(eq(contentTestimonials.isActive, true));
    } else {
      results = await db.select().from(contentTestimonials);
    }
    return res.json(results);
  } catch (error) {
    console.error('[content/testimonials] GET error:', error);
    return res.status(500).json({ error: 'Failed to fetch testimonials' });
  }
});

router.post('/api/content/testimonials', async (req, res) => {
  try {
    const { text, author, location, rating, jobCategories, source } = req.body;
    if (!text || typeof text !== 'string') {
      return res.status(400).json({ error: 'text is required' });
    }
    if (!author || typeof author !== 'string') {
      return res.status(400).json({ error: 'author is required' });
    }
    const [created] = await db.insert(contentTestimonials).values({
      text,
      author,
      location: location || null,
      rating: rating ?? 5,
      jobCategories: jobCategories || null,
      source: source || null,
    }).returning();
    return res.status(201).json(created);
  } catch (error) {
    console.error('[content/testimonials] POST error:', error);
    return res.status(500).json({ error: 'Failed to create testimonial' });
  }
});

router.put('/api/content/testimonials/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid id' });

    const updates: Record<string, any> = { updatedAt: new Date() };
    if (req.body.text !== undefined) updates.text = req.body.text;
    if (req.body.author !== undefined) updates.author = req.body.author;
    if (req.body.location !== undefined) updates.location = req.body.location;
    if (req.body.rating !== undefined) updates.rating = req.body.rating;
    if (req.body.jobCategories !== undefined) updates.jobCategories = req.body.jobCategories;
    if (req.body.source !== undefined) updates.source = req.body.source;
    if (req.body.isActive !== undefined) updates.isActive = req.body.isActive;

    const [updated] = await db.update(contentTestimonials).set(updates).where(eq(contentTestimonials.id, id)).returning();
    if (!updated) return res.status(404).json({ error: 'Testimonial not found' });
    return res.json(updated);
  } catch (error) {
    console.error('[content/testimonials] PUT error:', error);
    return res.status(500).json({ error: 'Failed to update testimonial' });
  }
});

router.delete('/api/content/testimonials/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid id' });

    const [updated] = await db
      .update(contentTestimonials)
      .set({ isActive: false, updatedAt: new Date() })
      .where(eq(contentTestimonials.id, id))
      .returning();
    if (!updated) return res.status(404).json({ error: 'Testimonial not found' });
    return res.json({ success: true, id });
  } catch (error) {
    console.error('[content/testimonials] DELETE error:', error);
    return res.status(500).json({ error: 'Failed to soft-delete testimonial' });
  }
});

// ---------------------------------------------------------------------------
// HASSLE ITEMS CRUD
// ---------------------------------------------------------------------------

router.get('/api/content/hassle-items', async (req, res) => {
  try {
    const activeFilter = req.query.active;
    let results;
    if (activeFilter === 'true') {
      results = await db.select().from(contentHassleItems).where(eq(contentHassleItems.isActive, true));
    } else {
      results = await db.select().from(contentHassleItems);
    }
    return res.json(results);
  } catch (error) {
    console.error('[content/hassle-items] GET error:', error);
    return res.status(500).json({ error: 'Failed to fetch hassle items' });
  }
});

router.post('/api/content/hassle-items', async (req, res) => {
  try {
    const { withoutUs, withUs, jobCategories, signals } = req.body;
    if (!withoutUs || typeof withoutUs !== 'string') {
      return res.status(400).json({ error: 'withoutUs is required' });
    }
    if (!withUs || typeof withUs !== 'string') {
      return res.status(400).json({ error: 'withUs is required' });
    }
    const [created] = await db.insert(contentHassleItems).values({
      withoutUs,
      withUs,
      jobCategories: jobCategories || null,
      signals: signals || null,
    }).returning();
    return res.status(201).json(created);
  } catch (error) {
    console.error('[content/hassle-items] POST error:', error);
    return res.status(500).json({ error: 'Failed to create hassle item' });
  }
});

router.put('/api/content/hassle-items/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid id' });

    const updates: Record<string, any> = { updatedAt: new Date() };
    if (req.body.withoutUs !== undefined) updates.withoutUs = req.body.withoutUs;
    if (req.body.withUs !== undefined) updates.withUs = req.body.withUs;
    if (req.body.jobCategories !== undefined) updates.jobCategories = req.body.jobCategories;
    if (req.body.signals !== undefined) updates.signals = req.body.signals;
    if (req.body.isActive !== undefined) updates.isActive = req.body.isActive;

    const [updated] = await db.update(contentHassleItems).set(updates).where(eq(contentHassleItems.id, id)).returning();
    if (!updated) return res.status(404).json({ error: 'Hassle item not found' });
    return res.json(updated);
  } catch (error) {
    console.error('[content/hassle-items] PUT error:', error);
    return res.status(500).json({ error: 'Failed to update hassle item' });
  }
});

router.delete('/api/content/hassle-items/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid id' });

    const [updated] = await db
      .update(contentHassleItems)
      .set({ isActive: false, updatedAt: new Date() })
      .where(eq(contentHassleItems.id, id))
      .returning();
    if (!updated) return res.status(404).json({ error: 'Hassle item not found' });
    return res.json({ success: true, id });
  } catch (error) {
    console.error('[content/hassle-items] DELETE error:', error);
    return res.status(500).json({ error: 'Failed to soft-delete hassle item' });
  }
});

// ---------------------------------------------------------------------------
// BOOKING RULES CRUD
// ---------------------------------------------------------------------------

router.get('/api/content/booking-rules', async (req, res) => {
  try {
    const activeFilter = req.query.active;
    let results;
    if (activeFilter === 'true') {
      results = await db.select().from(contentBookingRules).where(eq(contentBookingRules.isActive, true));
    } else {
      results = await db.select().from(contentBookingRules);
    }
    return res.json(results);
  } catch (error) {
    console.error('[content/booking-rules] GET error:', error);
    return res.status(500).json({ error: 'Failed to fetch booking rules' });
  }
});

router.post('/api/content/booking-rules', async (req, res) => {
  try {
    const { name, conditions, bookingModes, priority } = req.body;
    if (!name || typeof name !== 'string') {
      return res.status(400).json({ error: 'name is required' });
    }
    if (!conditions || typeof conditions !== 'object') {
      return res.status(400).json({ error: 'conditions is required and must be an object' });
    }
    if (!Array.isArray(bookingModes) || bookingModes.length === 0) {
      return res.status(400).json({ error: 'bookingModes must be a non-empty array' });
    }
    const [created] = await db.insert(contentBookingRules).values({
      name,
      conditions,
      bookingModes,
      priority: priority ?? 0,
    }).returning();
    return res.status(201).json(created);
  } catch (error) {
    console.error('[content/booking-rules] POST error:', error);
    return res.status(500).json({ error: 'Failed to create booking rule' });
  }
});

router.put('/api/content/booking-rules/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid id' });

    const updates: Record<string, any> = { updatedAt: new Date() };
    if (req.body.name !== undefined) updates.name = req.body.name;
    if (req.body.conditions !== undefined) updates.conditions = req.body.conditions;
    if (req.body.bookingModes !== undefined) updates.bookingModes = req.body.bookingModes;
    if (req.body.priority !== undefined) updates.priority = req.body.priority;
    if (req.body.isActive !== undefined) updates.isActive = req.body.isActive;

    const [updated] = await db.update(contentBookingRules).set(updates).where(eq(contentBookingRules.id, id)).returning();
    if (!updated) return res.status(404).json({ error: 'Booking rule not found' });
    return res.json(updated);
  } catch (error) {
    console.error('[content/booking-rules] PUT error:', error);
    return res.status(500).json({ error: 'Failed to update booking rule' });
  }
});

router.delete('/api/content/booking-rules/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid id' });

    const [updated] = await db
      .update(contentBookingRules)
      .set({ isActive: false, updatedAt: new Date() })
      .where(eq(contentBookingRules.id, id))
      .returning();
    if (!updated) return res.status(404).json({ error: 'Booking rule not found' });
    return res.json({ success: true, id });
  } catch (error) {
    console.error('[content/booking-rules] DELETE error:', error);
    return res.status(500).json({ error: 'Failed to soft-delete booking rule' });
  }
});

// ---------------------------------------------------------------------------
// POST /api/content/select — Intelligent content selection
// ---------------------------------------------------------------------------

router.post('/api/content/select', async (req, res) => {
  try {
    const { jobCategories, signals } = req.body as {
      jobCategories: string[];
      signals: Record<string, any>;
    };

    if (!Array.isArray(jobCategories) || jobCategories.length === 0) {
      return res.status(400).json({ error: 'jobCategories must be a non-empty array' });
    }
    if (!signals || typeof signals !== 'object') {
      return res.status(400).json({ error: 'signals must be an object' });
    }

    // Fetch all active content in parallel
    const [
      allClaims,
      allGuarantees,
      allTestimonials,
      allHassleItems,
      allBookingRules,
      allImages,
    ] = await Promise.all([
      db.select().from(contentClaims).where(eq(contentClaims.isActive, true)),
      db.select().from(contentGuarantees).where(eq(contentGuarantees.isActive, true)),
      db.select().from(contentTestimonials).where(eq(contentTestimonials.isActive, true)),
      db.select().from(contentHassleItems).where(eq(contentHassleItems.isActive, true)),
      db.select().from(contentBookingRules).where(eq(contentBookingRules.isActive, true)),
      db.select().from(contentImages).where(eq(contentImages.isActive, true)),
    ]);

    // Select best matches
    const claims = selectTopN(allClaims, jobCategories, signals, 8);
    const guarantee = selectTopN(allGuarantees, jobCategories, signals, 1)[0] || null;
    const testimonials = selectTopN(allTestimonials, jobCategories, signals, 3);
    const hassleItems = selectTopN(allHassleItems, jobCategories, signals, 6);

    // Booking rules: highest priority matching rule wins
    // A rule matches if ALL its conditions are satisfied by the signals
    let bookingModes: string[] = ['standard_date']; // default fallback
    const matchingRules = allBookingRules
      .filter((rule) => {
        const conditions = rule.conditions as Record<string, any>;
        for (const [key, value] of Object.entries(conditions)) {
          // Special handling for numeric thresholds
          if (key === 'minPricePence' || key === 'maxPricePence') continue;
          if (signals[key] !== value) return false;
        }
        return true;
      })
      .sort((a, b) => b.priority - a.priority);

    if (matchingRules.length > 0) {
      bookingModes = matchingRules[0].bookingModes;
    }

    // Images: filter by category + placement
    const images = selectTopN(
      allImages.map((img) => ({ ...img, signals: null })), // images don't have signals
      jobCategories,
      signals,
      6,
    );

    return res.json({
      claims,
      guarantee,
      testimonials,
      hassleItems,
      bookingModes,
      images,
    });
  } catch (error) {
    console.error('[content/select] Error:', error);
    return res.status(500).json({
      error: 'Failed to select content',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

// ---------------------------------------------------------------------------
// GET /api/content/stats — Counts and conversion rates
// ---------------------------------------------------------------------------

router.get('/api/content/stats', async (req, res) => {
  try {
    const [
      claimStats,
      imageStats,
      guaranteeStats,
      testimonialStats,
      hassleItemStats,
      bookingRuleStats,
    ] = await Promise.all([
      db
        .select({
          total: sql<number>`count(*)`,
          active: sql<number>`count(*) filter (where ${contentClaims.isActive} = true)`,
          totalViews: sql<number>`coalesce(sum(${contentClaims.viewCount}), 0)`,
          totalBookings: sql<number>`coalesce(sum(${contentClaims.bookingCount}), 0)`,
        })
        .from(contentClaims),
      db
        .select({
          total: sql<number>`count(*)`,
          active: sql<number>`count(*) filter (where ${contentImages.isActive} = true)`,
          totalViews: sql<number>`coalesce(sum(${contentImages.viewCount}), 0)`,
          totalBookings: sql<number>`coalesce(sum(${contentImages.bookingCount}), 0)`,
        })
        .from(contentImages),
      db
        .select({
          total: sql<number>`count(*)`,
          active: sql<number>`count(*) filter (where ${contentGuarantees.isActive} = true)`,
          totalViews: sql<number>`coalesce(sum(${contentGuarantees.viewCount}), 0)`,
          totalBookings: sql<number>`coalesce(sum(${contentGuarantees.bookingCount}), 0)`,
        })
        .from(contentGuarantees),
      db
        .select({
          total: sql<number>`count(*)`,
          active: sql<number>`count(*) filter (where ${contentTestimonials.isActive} = true)`,
          totalViews: sql<number>`coalesce(sum(${contentTestimonials.viewCount}), 0)`,
          totalBookings: sql<number>`coalesce(sum(${contentTestimonials.bookingCount}), 0)`,
        })
        .from(contentTestimonials),
      db
        .select({
          total: sql<number>`count(*)`,
          active: sql<number>`count(*) filter (where ${contentHassleItems.isActive} = true)`,
          totalViews: sql<number>`coalesce(sum(${contentHassleItems.viewCount}), 0)`,
          totalBookings: sql<number>`coalesce(sum(${contentHassleItems.bookingCount}), 0)`,
        })
        .from(contentHassleItems),
      db
        .select({
          total: sql<number>`count(*)`,
          active: sql<number>`count(*) filter (where ${contentBookingRules.isActive} = true)`,
        })
        .from(contentBookingRules),
    ]);

    const conversionRate = (views: number, bookings: number) =>
      views > 0 ? Math.round((bookings / views) * 10000) / 100 : 0;

    const cs = claimStats[0];
    const is = imageStats[0];
    const gs = guaranteeStats[0];
    const ts = testimonialStats[0];
    const hs = hassleItemStats[0];
    const bs = bookingRuleStats[0];

    return res.json({
      claims: {
        total: Number(cs.total),
        active: Number(cs.active),
        totalViews: Number(cs.totalViews),
        totalBookings: Number(cs.totalBookings),
        conversionRate: conversionRate(Number(cs.totalViews), Number(cs.totalBookings)),
      },
      images: {
        total: Number(is.total),
        active: Number(is.active),
        totalViews: Number(is.totalViews),
        totalBookings: Number(is.totalBookings),
        conversionRate: conversionRate(Number(is.totalViews), Number(is.totalBookings)),
      },
      guarantees: {
        total: Number(gs.total),
        active: Number(gs.active),
        totalViews: Number(gs.totalViews),
        totalBookings: Number(gs.totalBookings),
        conversionRate: conversionRate(Number(gs.totalViews), Number(gs.totalBookings)),
      },
      testimonials: {
        total: Number(ts.total),
        active: Number(ts.active),
        totalViews: Number(ts.totalViews),
        totalBookings: Number(ts.totalBookings),
        conversionRate: conversionRate(Number(ts.totalViews), Number(ts.totalBookings)),
      },
      hassleItems: {
        total: Number(hs.total),
        active: Number(hs.active),
        totalViews: Number(hs.totalViews),
        totalBookings: Number(hs.totalBookings),
        conversionRate: conversionRate(Number(hs.totalViews), Number(hs.totalBookings)),
      },
      bookingRules: {
        total: Number(bs.total),
        active: Number(bs.active),
      },
    });
  } catch (error) {
    console.error('[content/stats] Error:', error);
    return res.status(500).json({
      error: 'Failed to fetch content stats',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

export default router;
