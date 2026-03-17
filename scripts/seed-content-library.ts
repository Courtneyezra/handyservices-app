/**
 * Seed Content Library Database
 *
 * Populates the content library tables with initial data for the
 * dynamic quote page content system.
 *
 * Tables seeded:
 *   - contentClaims
 *   - contentImages
 *   - contentGuarantees
 *   - contentTestimonials
 *   - contentHassleItems
 *   - contentBookingRules
 *
 * Run: npx tsx scripts/seed-content-library.ts
 */

import 'dotenv/config';
import { db } from '../server/db';
import { sql } from 'drizzle-orm';
import {
  contentClaims,
  contentImages,
  contentGuarantees,
  contentTestimonials,
  contentHassleItems,
  contentBookingRules,
} from '../shared/schema';

// ---------------------------------------------------------------------------
// 1. Claims (20+ items)
// ---------------------------------------------------------------------------

const CLAIMS_DATA = [
  // Value claims — universal
  { text: "Fixed price — no surprises", category: "value", jobCategories: null, signals: null, isUniversal: true },
  { text: "Photo report on completion", category: "proof", jobCategories: null, signals: null, isUniversal: true },
  { text: "Full cleanup included", category: "convenience", jobCategories: null, signals: null, isUniversal: true },
  { text: "£2M insured", category: "trust", jobCategories: null, signals: null, isUniversal: true },
  { text: "No call-out fee", category: "value", jobCategories: null, signals: null, isUniversal: true },
  { text: "Free no-obligation quote", category: "value", jobCategories: null, signals: null, isUniversal: true },

  // Signal-specific claims
  { text: "Same-day response available", category: "speed", jobCategories: null, signals: { urgency: "emergency" }, isUniversal: false },
  { text: "Scheduled within 48-72 hours", category: "speed", jobCategories: null, signals: { urgency: "standard" }, isUniversal: false },
  { text: "All materials sourced and supplied", category: "convenience", jobCategories: null, signals: { materialsSupply: "we_supply" }, isUniversal: false },
  { text: "Labour only — use your own materials", category: "value", jobCategories: null, signals: { materialsSupply: "customer_supplied" }, isUniversal: false },
  { text: "Weekend availability", category: "convenience", jobCategories: null, signals: { timeOfService: "weekend" }, isUniversal: false },
  { text: "Evening slots available", category: "convenience", jobCategories: null, signals: { timeOfService: "after_hours" }, isUniversal: false },
  { text: "Returning customer? We remember your property", category: "loyalty", jobCategories: null, signals: { isReturningCustomer: true }, isUniversal: false },

  // Category claims — convenience & trust
  { text: "One visit, multiple jobs — save time", category: "convenience", jobCategories: null, signals: null, isUniversal: true },
  { text: "Tax-ready invoice emailed same day", category: "convenience", jobCategories: null, signals: null, isUniversal: false },
  { text: "Tenant coordination available", category: "convenience", jobCategories: null, signals: null, isUniversal: false },
  { text: "DBS checked tradesperson", category: "trust", jobCategories: null, signals: null, isUniversal: false },
  { text: "4.9★ Google rated (127+ reviews)", category: "trust", jobCategories: null, signals: null, isUniversal: false },

  // Guarantee claims
  { text: "30-day workmanship guarantee", category: "guarantee", jobCategories: null, signals: null, isUniversal: true },
  { text: "90-day workmanship guarantee", category: "guarantee", jobCategories: ["bathroom_fitting", "kitchen_fitting"], signals: null, isUniversal: false },

  // Job-category-specific claims
  { text: "Fully qualified for gas & electrical", category: "trust", jobCategories: ["plumbing_minor", "electrical_minor"], signals: null, isUniversal: false },
];

// ---------------------------------------------------------------------------
// 2. Images — no quote-images directory exists yet, seed placeholder entries
// ---------------------------------------------------------------------------

const IMAGES_DATA = [
  { filename: "door-greeting.jpg", alt: "Handyman greeting customer at the door", placement: "hero", jobCategories: null, isUniversal: true },
  { filename: "plumber-smile.jpg", alt: "Smiling plumber after completing a job", placement: "guarantee", jobCategories: ["plumbing_minor"], isUniversal: false },
];

// ---------------------------------------------------------------------------
// 3. Guarantees (4 variants)
// ---------------------------------------------------------------------------

const GUARANTEES_DATA = [
  {
    name: "Standard",
    title: "Not right? We return and fix it free.",
    description: "Quality workmanship, full cleanup, and photo report on every job.",
    items: [
      { icon: "Shield", title: "Quality Guaranteed", text: "Backed by our workmanship guarantee" },
      { icon: "Sparkles", title: "Full Cleanup", text: "We leave your home spotless" },
      { icon: "Camera", title: "Photo Report", text: "Photo proof on completion" },
    ],
    badges: [
      { label: "Insured", value: "£2M" },
      { label: "Vetted", value: "DBS Checked" },
      { label: "Price", value: "Fixed" },
      { label: "Quality", value: "Guaranteed" },
    ],
    jobCategories: null,
    signals: null,
    isUniversal: true,
    priority: 1,
  },
  {
    name: "Emergency",
    title: "Emergency sorted. Properly.",
    description: "Fast response doesn't mean rushed work. Same quality, same guarantee.",
    items: [
      { icon: "Zap", title: "Rapid Response", text: "Same-day dispatch for emergencies" },
      { icon: "Shield", title: "No Shortcuts", text: "We fix the root cause, not just the symptom" },
      { icon: "Camera", title: "Photo Evidence", text: "Before and after documented" },
    ],
    badges: null,
    jobCategories: null,
    signals: { urgency: "emergency" },
    isUniversal: false,
    priority: 10,
  },
  {
    name: "Complex",
    title: "Big job? Bigger guarantee.",
    description: "Multi-trade work managed start to finish. One point of contact.",
    items: [
      { icon: "ClipboardList", title: "Project Managed", text: "One team, one visit, fully coordinated" },
      { icon: "Shield", title: "90-Day Guarantee", text: "Extended guarantee for complex work" },
      { icon: "Camera", title: "Progress Updates", text: "Photo updates at every stage" },
    ],
    badges: null,
    jobCategories: ["bathroom_fitting", "kitchen_fitting"],
    signals: null,
    isUniversal: false,
    priority: 8,
  },
  {
    name: "Returning Customer",
    title: "Welcome back. Same quality, guaranteed.",
    description: "We know your property. Consistent quality every time.",
    items: [
      { icon: "Heart", title: "We Know Your Home", text: "Familiar with your property and preferences" },
      { icon: "Shield", title: "Loyalty Guarantee", text: "Priority rebooking if anything needs attention" },
      { icon: "Star", title: "Consistent Quality", text: "Same high standard every visit" },
    ],
    badges: null,
    jobCategories: null,
    signals: { isReturningCustomer: true },
    isUniversal: false,
    priority: 9,
  },
];

// ---------------------------------------------------------------------------
// 4. Testimonials (12 curated)
// ---------------------------------------------------------------------------

const TESTIMONIALS_DATA = [
  {
    quote: "Turned up on time, great quality work, left the place spotless.",
    author: "Sarah M.",
    location: "Nottingham",
    jobCategories: null,
    signals: null,
    isUniversal: true,
  },
  {
    quote: "Fixed everything on the list in one visit. Professional and fair price.",
    author: "David T.",
    location: "West Bridgford",
    jobCategories: ["general_fixing", "shelving"],
    signals: null,
    isUniversal: false,
  },
  {
    quote: "Emergency tap leak sorted within hours. Lifesaver.",
    author: "James R.",
    location: "Beeston",
    jobCategories: ["plumbing_minor"],
    signals: null,
    isUniversal: false,
  },
  {
    quote: "Assembled our entire IKEA kitchen. Neat, fast, no fuss.",
    author: "Emma L.",
    location: "Nottingham",
    jobCategories: ["flat_pack", "kitchen_fitting"],
    signals: null,
    isUniversal: false,
  },
  {
    quote: "Painted the whole downstairs in a day. Can't believe the transformation.",
    author: "Mark S.",
    location: "Arnold",
    jobCategories: ["painting"],
    signals: null,
    isUniversal: false,
  },
  {
    quote: "New bathroom looks incredible. They managed everything from tiling to plumbing.",
    author: "Lisa K.",
    location: "Mapperley",
    jobCategories: ["bathroom_fitting", "tiling", "plumbing_minor"],
    signals: null,
    isUniversal: false,
  },
  {
    quote: "Changed all the locks after our break-in. Made us feel safe again.",
    author: "Helen D.",
    location: "Carlton",
    jobCategories: ["lock_change"],
    signals: null,
    isUniversal: false,
  },
  {
    quote: "TV mounted perfectly, cables hidden, left the place tidy.",
    author: "Tom W.",
    location: "Nottingham",
    jobCategories: ["tv_mounting"],
    signals: null,
    isUniversal: false,
  },
  {
    quote: "Brilliant service start to finish. No hidden costs, top quality work.",
    author: "Chris P.",
    location: "Beeston",
    jobCategories: null,
    signals: null,
    isUniversal: true,
  },
  {
    quote: "As a landlord, they coordinate with my tenants so I don't have to.",
    author: "Robert H.",
    location: "West Bridgford",
    jobCategories: null,
    signals: { segment: "LANDLORD" },
    isUniversal: false,
  },
  {
    quote: "Third time using them. Consistent quality every time.",
    author: "Jenny A.",
    location: "Nottingham",
    jobCategories: null,
    signals: { isReturningCustomer: true },
    isUniversal: false,
  },
  {
    quote: "Gutters cleared and fence panel replaced in one afternoon.",
    author: "Paul G.",
    location: "Gedling",
    jobCategories: ["guttering", "fencing"],
    signals: null,
    isUniversal: false,
  },
];

// ---------------------------------------------------------------------------
// 5. Hassle comparison items (15+ pairs)
// ---------------------------------------------------------------------------

const HASSLE_ITEMS_DATA = [
  // Universal
  { withoutUs: "Searching Google for hours", withUs: "One message, we handle everything", jobCategories: null, signals: null, isUniversal: true, sortOrder: 1 },
  { withoutUs: "No fixed price — hourly surprises", withUs: "Fixed price — no surprises", jobCategories: null, signals: null, isUniversal: true, sortOrder: 2 },
  { withoutUs: "No photos, no proof of work", withUs: "Photo report on completion", jobCategories: null, signals: null, isUniversal: true, sortOrder: 3 },
  { withoutUs: "Chase for updates yourself", withUs: "Updates at every stage", jobCategories: null, signals: null, isUniversal: true, sortOrder: 4 },
  { withoutUs: "No guarantee if it goes wrong", withUs: "Not right? We return and fix it free", jobCategories: null, signals: null, isUniversal: true, sortOrder: 5 },
  { withoutUs: "Mess left behind", withUs: "Full cleanup included", jobCategories: null, signals: null, isUniversal: true, sortOrder: 6 },

  // Plumbing
  { withoutUs: "Water damage getting worse while you wait", withUs: "Same-day emergency response", jobCategories: ["plumbing_minor"], signals: null, isUniversal: false, sortOrder: 10 },
  { withoutUs: "Bodge job that leaks again next week", withUs: "Fix the root cause first time", jobCategories: ["plumbing_minor"], signals: null, isUniversal: false, sortOrder: 11 },

  // Electrical
  { withoutUs: "Unqualified cowboy — safety risk", withUs: "Qualified, insured, DBS checked", jobCategories: ["electrical_minor"], signals: null, isUniversal: false, sortOrder: 12 },

  // Flat pack
  { withoutUs: "3 hours of frustration with Allen keys", withUs: "Professional assembly, no stress", jobCategories: ["flat_pack"], signals: null, isUniversal: false, sortOrder: 13 },
  { withoutUs: "Leftover screws and wobbly shelves", withUs: "Built solid, looks like the showroom", jobCategories: ["flat_pack"], signals: null, isUniversal: false, sortOrder: 14 },

  // Painting
  { withoutUs: "Paint on the carpet, drips on the skirting", withUs: "Dust sheets, masking, clean finish", jobCategories: ["painting"], signals: null, isUniversal: false, sortOrder: 15 },

  // Multi-job
  { withoutUs: "Multiple tradesmen, multiple no-shows", withUs: "One team, one visit, everything done", jobCategories: null, signals: null, isUniversal: true, sortOrder: 20 },
  { withoutUs: "Coordinating schedules is a nightmare", withUs: "We manage the whole job for you", jobCategories: null, signals: null, isUniversal: true, sortOrder: 21 },
];

// ---------------------------------------------------------------------------
// 6. Booking rules (4 rules)
// ---------------------------------------------------------------------------

const BOOKING_RULES_DATA = [
  {
    name: "Emergency — urgent booking only",
    conditions: { urgency: "emergency" },
    bookingModes: ["standard_date", "urgent_premium"],
    priority: 10,
  },
  {
    name: "Priority — standard and urgent options",
    conditions: { urgency: "priority" },
    bookingModes: ["standard_date", "urgent_premium"],
    priority: 8,
  },
  {
    name: "High value — deposit split available",
    conditions: { minPricePence: 15000 },
    bookingModes: ["standard_date", "flexible_discount", "deposit_split"],
    priority: 6,
  },
  {
    name: "Standard weekday — full options",
    conditions: { urgency: "standard", timeOfService: "standard" },
    bookingModes: ["standard_date", "flexible_discount"],
    priority: 5,
  },
];

// ---------------------------------------------------------------------------
// Seed runner
// ---------------------------------------------------------------------------

async function seed() {
  console.log("Seeding Content Library...\n");

  try {
    // ---- Truncate all content library tables ----
    console.log("Clearing existing content library data...");
    await db.execute(sql`TRUNCATE TABLE ${contentClaims} CASCADE`);
    await db.execute(sql`TRUNCATE TABLE ${contentImages} CASCADE`);
    await db.execute(sql`TRUNCATE TABLE ${contentGuarantees} CASCADE`);
    await db.execute(sql`TRUNCATE TABLE ${contentTestimonials} CASCADE`);
    await db.execute(sql`TRUNCATE TABLE ${contentHassleItems} CASCADE`);
    await db.execute(sql`TRUNCATE TABLE ${contentBookingRules} CASCADE`);
    console.log("  Done.\n");

    // ---- 1. Claims ----
    console.log("Seeding claims...");
    for (const claim of CLAIMS_DATA) {
      await db.insert(contentClaims).values({
        text: claim.text,
        category: claim.category,
        jobCategories: claim.jobCategories,
        signals: claim.signals || null,
        isActive: true,
      });
    }
    console.log(`  ${CLAIMS_DATA.length} claims seeded.`);

    // ---- 2. Images ----
    console.log("Seeding images...");
    for (const image of IMAGES_DATA) {
      await db.insert(contentImages).values({
        url: `/assets/quote-images/${image.filename}`,
        alt: image.alt,
        placement: image.placement,
        jobCategories: image.jobCategories,
        isActive: true,
      });
    }
    console.log(`  ${IMAGES_DATA.length} images seeded.`);

    // ---- 3. Guarantees ----
    console.log("Seeding guarantees...");
    for (const guarantee of GUARANTEES_DATA) {
      await db.insert(contentGuarantees).values({
        title: guarantee.title,
        description: guarantee.description,
        items: guarantee.items,
        badges: guarantee.badges,
        jobCategories: guarantee.jobCategories,
        signals: guarantee.signals || null,
        isActive: true,
      });
    }
    console.log(`  ${GUARANTEES_DATA.length} guarantees seeded.`);

    // ---- 4. Testimonials ----
    console.log("Seeding testimonials...");
    for (const testimonial of TESTIMONIALS_DATA) {
      await db.insert(contentTestimonials).values({
        text: testimonial.quote,
        author: testimonial.author,
        location: testimonial.location,
        jobCategories: testimonial.jobCategories,
        source: 'manual',
        isActive: true,
      });
    }
    console.log(`  ${TESTIMONIALS_DATA.length} testimonials seeded.`);

    // ---- 5. Hassle items ----
    console.log("Seeding hassle comparison items...");
    for (const item of HASSLE_ITEMS_DATA) {
      await db.insert(contentHassleItems).values({
        withoutUs: item.withoutUs,
        withUs: item.withUs,
        jobCategories: item.jobCategories,
        signals: item.signals || null,
        isActive: true,
      });
    }
    console.log(`  ${HASSLE_ITEMS_DATA.length} hassle items seeded.`);

    // ---- 6. Booking rules ----
    console.log("Seeding booking rules...");
    for (const rule of BOOKING_RULES_DATA) {
      await db.insert(contentBookingRules).values({
        name: rule.name,
        conditions: rule.conditions,
        bookingModes: rule.bookingModes,
        priority: rule.priority,
        isActive: true,
      });
    }
    console.log(`  ${BOOKING_RULES_DATA.length} booking rules seeded.`);

    // ---- Summary ----
    console.log("\n--- Seed Summary ---");
    console.log(`  Claims:        ${CLAIMS_DATA.length}`);
    console.log(`  Images:        ${IMAGES_DATA.length}`);
    console.log(`  Guarantees:    ${GUARANTEES_DATA.length}`);
    console.log(`  Testimonials:  ${TESTIMONIALS_DATA.length}`);
    console.log(`  Hassle items:  ${HASSLE_ITEMS_DATA.length}`);
    console.log(`  Booking rules: ${BOOKING_RULES_DATA.length}`);
    console.log(`  Total:         ${CLAIMS_DATA.length + IMAGES_DATA.length + GUARANTEES_DATA.length + TESTIMONIALS_DATA.length + HASSLE_ITEMS_DATA.length + BOOKING_RULES_DATA.length}`);
    console.log("\nSeeding complete!");
  } catch (error) {
    console.error("Seeding failed:", error);
    process.exit(1);
  }

  process.exit(0);
}

seed();
