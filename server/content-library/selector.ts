/**
 * Content Library Selector
 *
 * Reusable content selection logic, extracted from the /api/content/select
 * endpoint so it can be called programmatically (e.g. from the contextual
 * quote creation flow).
 *
 * selectContentForQuote(jobCategories, signals) returns the best-matched
 * claims, guarantee, testimonials, hassleItems, bookingModes, and images
 * from the content library database.
 */

import { eq } from 'drizzle-orm';
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

// ---------------------------------------------------------------------------
// Scoring helpers (same logic as routes.ts)
// ---------------------------------------------------------------------------

function scoreItem(
  item: { jobCategories?: string[] | null; signals?: unknown },
  categories: string[],
  signals: Record<string, any>,
): number {
  let score = 0;

  if (item.jobCategories && item.jobCategories.length > 0) {
    for (const cat of item.jobCategories) {
      if (categories.includes(cat)) {
        score += 1;
      }
    }
  }

  if (item.signals && typeof item.signals === 'object' && !Array.isArray(item.signals)) {
    const itemSignals = item.signals as Record<string, any>;
    for (const [key, value] of Object.entries(itemSignals)) {
      if (signals[key] !== undefined && signals[key] === value) {
        score += 2;
      }
    }
  }

  return score;
}

function selectTopN<T extends { jobCategories?: string[] | null; signals?: unknown }>(
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
// Return type
// ---------------------------------------------------------------------------

export interface ContentSelectionResult {
  claims: ContentClaim[];
  guarantee: ContentGuarantee | null;
  testimonials: ContentTestimonial[];
  hassleItems: ContentHassleItem[];
  bookingModes: string[];
  images: ContentImage[];
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * Select the best-matching content from the library for a given set of
 * job categories and contextual signals.
 *
 * This is the same scoring/matching logic used by the /api/content/select
 * endpoint, but callable as a plain function.
 */
export async function selectContentForQuote(
  jobCategories: string[],
  signals: Record<string, any>,
): Promise<ContentSelectionResult> {
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
  let bookingModes: string[] = ['standard_date'];
  const matchingRules = allBookingRules
    .filter((rule) => {
      const conditions = rule.conditions as Record<string, any>;
      for (const [key, value] of Object.entries(conditions)) {
        if (key === 'minPricePence' || key === 'maxPricePence') continue;
        if (signals[key] !== value) return false;
      }
      return true;
    })
    .sort((a, b) => b.priority - a.priority);

  if (matchingRules.length > 0) {
    bookingModes = matchingRules[0].bookingModes;
  }

  // Images: filter by category (images don't have signals, so we add a null placeholder)
  const images = selectTopN(
    allImages.map((img) => ({ ...img, signals: null as unknown })),
    jobCategories,
    signals,
    6,
  ) as unknown as ContentImage[];

  return {
    claims,
    guarantee,
    testimonials,
    hassleItems,
    bookingModes,
    images,
  };
}
