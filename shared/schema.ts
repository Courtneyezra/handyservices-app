import { pgTable, varchar, integer, timestamp, text, boolean, jsonb, index, uniqueIndex, serial, vector, date, pgEnum, doublePrecision, uuid, check, primaryKey } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { relations, sql } from "drizzle-orm";
import * as crypto from "crypto";
import type { SlotOffer } from "./slot-offer";

// Lead Stage Enum - Formal funnel stages for Kanban view
export const leadStageEnum = pgEnum('lead_stage', [
    'new_lead',
    'contacted',
    'awaiting_video',
    'video_received',
    'visit_scheduled',
    'visit_done',
    'quote_sent',
    'quote_viewed',
    'awaiting_payment',
    'booked',
    'in_progress',
    'completed',
    'lost',
    'expired',
    'declined',
    'new',
    'pending',
    'complete'
]);

// Lead Route Enum - Which path the lead is on (Tube Map)
export const leadRouteEnum = pgEnum('lead_route', [
    'video',
    'instant_quote',
    'site_visit'
]);

export const LeadStageValues = [
    'new',
    'pending',
    'complete',
    'lost',
    'new_lead',
    'contacted',
    'awaiting_video',
    'video_received',
    'visit_scheduled',
    'visit_done',
    'quote_sent',
    'quote_viewed',
    'awaiting_payment',
    'booked',
    'in_progress',
    'completed',
    'expired',
    'declined'
] as const;

export type LeadStage = typeof LeadStageValues[number];

// Lead Route Values
export const LeadRouteValues = ['video', 'instant_quote', 'site_visit'] as const;
export type LeadRoute = typeof LeadRouteValues[number];

// Lead Qualification Grade Enum
export const qualificationGradeEnum = pgEnum('qualification_grade', ['HOT', 'WARM', 'COLD']);
export const QualificationGradeValues = ['HOT', 'WARM', 'COLD'] as const;
export type QualificationGrade = typeof QualificationGradeValues[number];

// Lead Segment Enum (for database column)
export const leadSegmentEnum = pgEnum('lead_segment', ['EMERGENCY', 'BUSY_PRO', 'PROP_MGR', 'LANDLORD', 'SMALL_BIZ', 'TRUST_SEEKER', 'RENTER', 'DIY_DEFERRER', 'BUDGET', 'DEFAULT']);
export const LeadSegmentValues = ['EMERGENCY', 'BUSY_PRO', 'PROP_MGR', 'LANDLORD', 'SMALL_BIZ', 'TRUST_SEEKER', 'RENTER', 'DIY_DEFERRER', 'BUDGET', 'DEFAULT'] as const;
export type LeadSegment = typeof LeadSegmentValues[number];

// ==========================================
// HANDY SERVICES FOUNDATION ENUMS
// ==========================================

export const scheduledSlotEnum = pgEnum('scheduled_slot', ['am', 'pm', 'full_day']);
export const dayOfStatusEnum = pgEnum('day_of_status', ['scheduled', 'en_route', 'arrived', 'in_progress', 'access_failed', 'customer_unreachable', 'completed', 'cancelled_day_of']);
export const variationStatusEnum = pgEnum('variation_status', ['pending_approval', 'approved', 'rejected', 'completed']);
export const disputeStatusEnum = pgEnum('dispute_status', ['open', 'investigating', 'awaiting_contractor', 'awaiting_customer', 'resolved', 'escalated', 'closed']);
export const disputeTypeEnum = pgEnum('dispute_type', ['quality', 'incomplete', 'damage', 'no_show', 'overcharge', 'other']);
export const disputeResolutionEnum = pgEnum('dispute_resolution', ['refund_full', 'refund_partial', 'return_visit', 'no_action', 'insurance_claim']);
export const payoutStatusEnum = pgEnum('payout_status', ['pending', 'processing', 'paid', 'failed', 'held', 'reversed']);
export const incidentTypeEnum = pgEnum('incident_type', ['damage', 'safety_issue', 'weather_delay', 'access_issue', 'other']);
export const completionTypeEnum = pgEnum('completion_type', ['full', 'partial', 'weather_hold', 'access_failed']);

// Session storage table for authentication
export const sessions = pgTable(
    "sessions",
    {
        sid: varchar("sid").primaryKey(),
        sess: jsonb("sess").notNull(),
        expire: timestamp("expire").notNull(),
    },
    (table) => [index("IDX_session_expire").on(table.expire)],
);

// Contractor Session storage (Persistent)
export const contractorSessions = pgTable("contractor_sessions", {
    sessionToken: varchar("session_token").primaryKey().notNull(),
    userId: varchar("user_id").references(() => users.id).notNull(),
    expiresAt: timestamp("expires_at").notNull(),
    createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
    index("idx_contractor_sessions_user").on(table.userId),
    index("idx_contractor_sessions_expires").on(table.expiresAt),
]);

// App Settings table - Key-value store for application configuration
export const appSettings = pgTable("app_settings", {
    id: varchar("id").primaryKey().notNull(),
    key: varchar("key", { length: 100 }).unique().notNull(),
    value: jsonb("value").notNull(),
    description: text("description"),
    updatedAt: timestamp("updated_at").defaultNow(),
});

export type AppSetting = typeof appSettings.$inferSelect;

// Prize-wheel rewards a customer won post-payment/completion. The code + email
// make it claimable + redeemable; ops/quote-builder surfaces unredeemed ones.
export const customerRewards = pgTable("customer_rewards", {
    id: varchar("id").primaryKey().notNull(),
    code: varchar("code", { length: 16 }).unique().notNull(),      // e.g. HANDY-7F3K
    prizeId: varchar("prize_id", { length: 40 }),                  // slice id (e.g. 'bundle')
    prizeTitle: varchar("prize_title", { length: 160 }).notNull(),
    customerName: varchar("customer_name"),
    customerEmail: varchar("customer_email"),
    customerPhone: varchar("customer_phone"),
    sourceType: varchar("source_type", { length: 20 }),            // 'invoice' | 'completion'
    sourceId: varchar("source_id"),                                // invoiceId or bookingId
    status: varchar("status", { length: 20 }).notNull().default('unredeemed'), // unredeemed | redeemed | expired
    wonAt: timestamp("won_at").defaultNow(),
    expiresAt: timestamp("expires_at"),
    emailedAt: timestamp("emailed_at"),
    redeemedAt: timestamp("redeemed_at"),
    redeemedQuoteId: varchar("redeemed_quote_id"),
}, (table) => [
    index("idx_customer_rewards_email").on(table.customerEmail),
    index("idx_customer_rewards_code").on(table.code),
    index("idx_customer_rewards_status").on(table.status),
]);

export type CustomerReward = typeof customerRewards.$inferSelect;

// Users table (Admin/VA/Contractor access)
export const users = pgTable("users", {
    id: varchar("id").primaryKey().notNull(),
    email: varchar("email").unique().notNull(),
    firstName: varchar("first_name"),
    lastName: varchar("last_name"),
    phone: varchar("phone", { length: 20 }),
    password: varchar("password", { length: 255 }),
    role: varchar("role", { length: 20 }).notNull().default('admin'), // 'admin' | 'va' | 'contractor'
    emailVerified: boolean("email_verified").default(false),
    lastLogin: timestamp("last_login"),
    isActive: boolean("is_active").notNull().default(true),
    // Long-lived bearer token for the read-only iOS home-screen widget
    // (docs/scriptable-widget.js). Deliberately separate from contractorSessions:
    // iOS holds it for months and it only grants GET /api/widget/summary.
    widgetToken: varchar("widget_token"),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
    uniqueIndex("idx_users_widget_token").on(table.widgetToken),
]);

export const userRelations = relations(users, ({ one }) => ({
    handymanProfile: one(handymanProfiles, {
        fields: [users.id],
        references: [handymanProfiles.userId],
    }),
}));

// Productized Services (SKU) table - The "Brain" Knowledge Base
export const productizedServices = pgTable("productized_services", {
    id: varchar("id").primaryKey().notNull(),
    skuCode: varchar("sku_code", { length: 50 }).unique().notNull(), // e.g., "TV-MOUNT-STANDARD"
    name: varchar("name", { length: 200 }).notNull(),
    description: text("description").notNull(),

    // Pricing
    pricePence: integer("price_pence").notNull(),
    timeEstimateMinutes: integer("time_estimate_minutes").notNull(),

    // Matching Logic
    keywords: text("keywords").array().notNull(),
    negativeKeywords: text("negative_keywords").array(),
    aiPromptHint: text("ai_prompt_hint"),
    embeddingVector: text("embedding_vector"), // Legacy: JSON string format (deprecated)
    embedding: vector("embedding", { dimensions: 1536 }), // B10: Native pgvector column (vector(1536))

    // Categorization
    category: varchar("category", { length: 50 }),
    isActive: boolean("is_active").default(true),
});

export type ProductizedService = typeof productizedServices.$inferSelect;

// ──────────────────────────────────────────────────────────────────────────
// Phase 25 — SKU catalog ("service_catalog")
//
// The catalog Agent 25a seeds and the contextual pricing engine resolves
// against. Each row is one of three SHAPES:
//   - 'fixed'     → single pricePence + scheduleMinutes
//   - 'per_unit'  → pricePerUnitPence × count (+ setupMinutes once)
//   - 'tiered'    → tiers JSONB array, one chosen at quote time
//
// pricingLineItems on personalized_quotes references a row by skuCode and
// carries unitCount/selectedTier for the dynamic shapes. The pricing engine
// reads price + schedule directly from this row — no LLM, no multiplier —
// so customer price decouples cleanly from contractor on-site time.
// ──────────────────────────────────────────────────────────────────────────
export const serviceCatalog = pgTable("service_catalog", {
    id: serial("id").primaryKey(),
    skuCode: varchar("sku_code", { length: 40 }).unique().notNull(), // e.g. MIX-TAP-01
    name: varchar("name", { length: 120 }).notNull(),
    category: varchar("category", { length: 50 }).notNull(),         // JobCategory slug
    shape: varchar("shape", { length: 16 }).notNull(),               // 'fixed' | 'per_unit' | 'tiered'

    // Type A (fixed) — single price + duration
    pricePence: integer("price_pence"),
    scheduleMinutes: integer("schedule_minutes"),

    // Type B (per_unit) — scales by count
    unitLabel: varchar("unit_label", { length: 40 }),
    pricePerUnitPence: integer("price_per_unit_pence"),
    minimumUnits: integer("minimum_units"),
    minutesPerUnit: integer("minutes_per_unit"),
    setupMinutes: integer("setup_minutes"),

    // Type C (tiered)
    tiers: jsonb("tiers").$type<Array<{ label: string; pricePence: number; scheduleMinutes: number }>>(),

    // Descriptions
    customerDescription: text("customer_description").notNull(),
    adminDescription: text("admin_description"),

    // Presentation — Lucide icon name (e.g. "tv", "wrench") for the SKU's
    // "shelf item" card on the customer quote + the admin library. Null falls
    // back to a per-category default resolved client-side (Phase 28).
    icon: varchar("icon", { length: 40 }),

    // Yield rules
    flexEligible: boolean("flex_eligible").notNull().default(true),
    offPeakWeekendPremiumPence: integer("off_peak_weekend_premium_pence").notNull().default(0),

    // Telemetry
    pickCount: integer("pick_count").notNull().default(0),

    // Matching (populated by seed-sku-keywords.ts / seed-sku-embeddings.ts)
    keywords: text("keywords").array(),
    negativeKeywords: text("negative_keywords").array(),
    aiPromptHint: text("ai_prompt_hint"),
    embedding: vector("embedding", { dimensions: 1536 }),

    // Post-commitment upsells (populated by seed-upsells.ts)
    upsellSkuCodes: text("upsell_sku_codes").array(),

    // Learned on-site time (populated by scripts/learn-catalog-times.ts from contractor
    // actuals). When set, the dispatch TIME rail prefers this over the authored minutes —
    // the two-rail model's "refine via actuals" loop. Null ⇒ use authored time.
    actualMinutesPerUnit: integer("actual_minutes_per_unit"),
    actualSampleCount: integer("actual_sample_count").notNull().default(0),

    // Audit
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
});

export type ServiceCatalogRow = typeof serviceCatalog.$inferSelect;
export type InsertServiceCatalogRow = typeof serviceCatalog.$inferInsert;

// SKU Detection Logs - For training/debugging "The Brain"
export const skuMatchLogs = pgTable("sku_match_logs", {
    id: varchar("id").primaryKey().notNull(),
    inputText: text("input_text").notNull(),
    matchedSkuId: varchar("matched_sku_id"),
    confidence: integer("confidence"),
    matchMethod: varchar("match_method", { length: 20 }), // 'keyword', 'embedding', 'gpt'
    wasAccepted: boolean("was_accepted"),
    leadId: varchar("lead_id"),
    createdAt: timestamp("created_at").defaultNow(),
});

// Leads table - The destination for "The Switchboard" logs
export const leads = pgTable("leads", {
    id: varchar("id").primaryKey().notNull(),
    clientId: varchar("client_id").references(() => serviceClients.id), // Spine client (who pays)
    customerName: varchar("customer_name").notNull(),
    phone: varchar("phone").notNull(),
    email: varchar("email"),
    address: text("address"), // Legacy field - kept for backwards compatibility

    // Enhanced Address Fields (B5: Address Storage Schema Updates)
    addressRaw: text("address_raw"), // What customer said verbatim
    addressCanonical: text("address_canonical"), // Google's formatted version
    placeId: varchar("place_id", { length: 255 }), // Google's unique identifier
    postcode: varchar("postcode", { length: 10 }), // Extracted postcode
    coordinates: jsonb("coordinates"), // { lat: number, lng: number }

    // Job Info
    jobDescription: text("job_description"),
    transcriptJson: jsonb("transcript_json"), // Full call transcript
    status: varchar("status").notNull().default("new"),

    // Origin
    source: varchar("source").default("call"),
    jobSummary: text("job_summary"),

    // Eleven Labs specific fields (Advanced Features)
    elevenLabsConversationId: varchar("eleven_labs_conversation_id"),
    elevenLabsSummary: text("eleven_labs_summary"),
    elevenLabsRecordingUrl: text("eleven_labs_recording_url"),
    elevenLabsSuccessScore: integer("eleven_labs_success_score"), // 0-100

    // Live Call Action Fields
    awaitingVideo: boolean("awaiting_video").default(false), // Whether we're waiting for customer video
    videoReceivedAt: timestamp("video_received_at"), // When customer sent video
    siteVisitScheduledAt: timestamp("site_visit_scheduled_at"), // When site visit was scheduled

    // Lead Funnel Stage (Kanban)
    stage: leadStageEnum("stage").default('new_lead'), // Formal funnel stage
    stageUpdatedAt: timestamp("stage_updated_at"), // When stage last changed

    // Lead Tube Map - Route tracking
    route: leadRouteEnum("route"), // Which path: video, instant_quote, site_visit
    routeAssignedAt: timestamp("route_assigned_at"), // When route was assigned
    snoozedUntil: timestamp("snoozed_until"), // For "call me later" cases
    mergedIntoId: varchar("merged_into_id"), // ID of lead this was merged into

    // Lead Qualification & Scoring
    qualificationScore: integer("qualification_score"), // 0-100 score
    qualificationGrade: qualificationGradeEnum("qualification_grade"), // HOT, WARM, COLD
    segment: leadSegmentEnum("segment"), // Customer segment type
    segmentConfidence: integer("segment_confidence"), // 0-100 confidence in segment detection
    segmentSignals: jsonb("segment_signals"), // Evidence array e.g. ["mentioned rental property", "urgent"]
    redFlags: jsonb("red_flags"), // Warning array e.g. ["price shopping", "no authority"]
    scoredAt: timestamp("scored_at"), // When lead was last scored
    scoredBy: varchar("scored_by", { length: 50 }), // 'ai_call_parser', 'ai_whatsapp_bot', 'webform', 'manual'

    // Automation Dedup Tracking
    automationReminderSentAt: timestamp("automation_reminder_sent_at"), // Last automation reminder sent (video/general)
    automationRecoverySentAt: timestamp("automation_recovery_sent_at"), // Lost lead recovery message sent
    lastSlaAlertAt: timestamp("last_sla_alert_at"), // Pipeline sweeper SLA alert dedup (24h window)

    // Action Center Fields (unified inbox with calls table)
    actionStatus: varchar("action_status").default('pending'), // 'pending', 'resolved', 'dismissed'
    actionUrgency: integer("action_urgency").default(3), // 1=Critical, 2=High, 3=Normal, 4=Low

    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
    index("idx_leads_phone").on(table.phone), // B1: Fast phone lookup
    index("idx_leads_place_id").on(table.placeId), // B6: Fast duplicate detection by address
    index("idx_leads_postcode").on(table.postcode), // B6: Postcode-based queries
    index("idx_leads_stage").on(table.stage), // Funnel stage queries
    index("idx_leads_stage_updated").on(table.stageUpdatedAt), // Stage update ordering
    index("idx_leads_route").on(table.route), // Route-based queries
    index("idx_leads_snoozed").on(table.snoozedUntil), // Snoozed leads queries
    index("idx_leads_qualification_grade").on(table.qualificationGrade), // Qualification grade queries
    index("idx_leads_segment").on(table.segment), // Segment-based queries
]);

// Calls table - Twilio Webhook Log
export const calls = pgTable("calls", {
    id: varchar("id").primaryKey().notNull(),
    callId: varchar("call_id").unique().notNull(), // Twilio CallSid
    phoneNumber: varchar("phone_number").notNull(),
    startTime: timestamp("start_time").notNull().defaultNow(),
    direction: varchar("direction").notNull(),
    status: varchar("status").notNull(),
    recordingUrl: varchar("recording_url"),
    transcription: text("transcription"),
    localRecordingPath: varchar("local_recording_path"),
    // Dual-channel recordings (both sides of conversation)
    inboundRecordingUrl: varchar("inbound_recording_url"),  // Caller audio
    outboundRecordingUrl: varchar("outbound_recording_url"), // Agent audio
    leadId: varchar("lead_id"),
    clientId: varchar("client_id").references(() => serviceClients.id, { onDelete: 'set null' }), // FK to service_clients (the account)

    // Customer Information
    customerName: varchar("customer_name"),
    email: varchar("email"),
    address: text("address"),
    postcode: varchar("postcode"),

    // Call Metadata
    duration: integer("duration"), // in seconds
    endTime: timestamp("end_time"),
    outcome: varchar("outcome"), // 'INSTANT_PRICE' | 'VIDEO_QUOTE' | 'SITE_VISIT' | 'NO_ANSWER' | 'VOICEMAIL'
    urgency: varchar("urgency"), // 'Critical' | 'High' | 'Standard' | 'Low'
    leadType: varchar("lead_type"), // 'Homeowner' | 'Landlord' | 'Property Manager' | 'Tenant'
    jobSummary: text("job_summary"), // AI-generated short summary of the job
    elevenLabsConversationId: varchar("eleven_labs_conversation_id"), // ID for retrieving recording/transcript


    // SKU Detection Results (from AI)
    detectedSkusJson: jsonb("detected_skus_json"), // Array of detected SKUs with confidence scores
    skuDetectionMethod: varchar("sku_detection_method"), // 'keyword' | 'embedding' | 'gpt' | 'hybrid'

    // Manual SKU Management
    manualSkusJson: jsonb("manual_skus_json"), // Array of manually added/edited SKUs
    totalPricePence: integer("total_price_pence"), // Calculated total from all SKUs

    // Audit Trail
    lastEditedBy: varchar("last_edited_by"), // User ID who last edited
    lastEditedAt: timestamp("last_edited_at"),

    // Additional Context
    notes: text("notes"), // Manual notes from VA
    segments: jsonb("segments"), // Full transcript segments with timestamps

    // Real-time State Persistence (for reconnecting clients)
    liveAnalysisJson: jsonb("live_analysis_json"), // Real-time analysis state
    metadataJson: jsonb("metadata_json"),          // Real-time metadata (customer name, address, etc.)

    // Action Center Fields
    actionStatus: varchar("action_status").default('pending'), // 'pending', 'attempting', 'resolved', 'dismissed'
    actionUrgency: integer("action_urgency").default(3), // 1=Critical, 2=High, 3=Normal, 4=Low
    missedReason: varchar("missed_reason"), // 'out_of_hours', 'busy_agent', 'no_answer', 'user_hangup'
    tags: text("tags").array(), // ['ai_incomplete', 'no_lead_info']

    // Live Call Action Fields
    siteVisitReason: varchar("site_visit_reason"), // Reason for site visit if outcome is SITE_VISIT
    actionTakenAt: timestamp("action_taken_at"), // When VA took action (Book Now, Request Video, Site Visit)
    bookingLinkSent: boolean("booking_link_sent").default(false), // Whether booking link was sent
    videoRequestSentAt: timestamp("video_request_sent_at"), // When video request was sent via WhatsApp

    // VA Performance Tracking (call dashboard)
    ringSeconds: integer("ring_seconds"), // time-to-answer for forwarded calls (derived in dial-status webhook)
    handledBy: varchar("handled_by", { length: 20 }), // 'va' | 'ai_agent' | 'missed' | 'voicemail'
    handledByUserId: varchar("handled_by_user_id"), // user id when handledBy = 'va'
    aiScoreJson: jsonb("ai_score_json"), // structured scorecard from the call-scoring rubric
    aiScoredAt: timestamp("ai_scored_at"), // when the scorecard was generated (null = unscored)

    // Post-call classification (server/call-classifier.ts). Stored shape contract:
    // { kind, whatsappAgreed, messagingObjection, jobSummary, urgency, callbackPromised, callIncomplete, classifiedAt }
    // Applied via scripts/migrate-call-classification.ts — NEVER db:push on this schema.
    classification: jsonb("classification"),

    createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
    index("idx_calls_phone_number").on(table.phoneNumber),
    index("idx_calls_start_time").on(table.startTime),
    index("idx_calls_outcome").on(table.outcome),
    index("idx_calls_customer_name").on(table.customerName),
    index("idx_calls_client").on(table.clientId),
]);

// Call SKUs junction table - Many-to-many relationship between calls and SKUs
export const callSkus = pgTable("call_skus", {
    id: varchar("id").primaryKey().notNull(),
    callId: varchar("call_id").references(() => calls.id, { onDelete: 'cascade' }).notNull(),
    skuId: varchar("sku_id").references(() => productizedServices.id).notNull(),
    quantity: integer("quantity").notNull().default(1),
    pricePence: integer("price_pence").notNull(), // Snapshot price at time of call
    source: varchar("source").notNull(), // 'detected' | 'manual'
    confidence: integer("confidence"), // For detected SKUs (0-100)
    detectionMethod: varchar("detection_method"), // For detected SKUs
    addedBy: varchar("added_by"), // User ID for manual additions
    addedAt: timestamp("added_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
    index("idx_call_skus_call_id").on(table.callId),
    index("idx_call_skus_sku_id").on(table.skuId),
]);

// Relations for calls and callSkus
export const callsRelations = relations(calls, ({ many }) => ({
    callSkus: many(callSkus),
}));

export const callSkusRelations = relations(callSkus, ({ one }) => ({
    call: one(calls, {
        fields: [callSkus.callId],
        references: [calls.id],
    }),
    sku: one(productizedServices, {
        fields: [callSkus.skuId],
        references: [productizedServices.id],
    }),
}));

// ─── Multi-VA telephony (Groundwire routing + attribution) ──────────────────
// One row per VA: maps their identity to the Groundwire SIP address calls
// forward to. The dial-status webhook matches the answered SIP endpoint here
// to attribute a call to the right VA (calls.handledByUserId).
export const vaEndpoints = pgTable("va_endpoints", {
    id: varchar("id").primaryKey().notNull(),
    userId: varchar("user_id").references(() => users.id), // the VA
    sipAddress: varchar("sip_address").notNull(),          // e.g. "sip:ben@handyservices.sip.twilio.com"
    displayName: varchar("display_name", { length: 100 }),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
    index("idx_va_endpoints_sip").on(table.sipAddress),
]);

// When each VA is on shift, in UK time. Single source of truth for BOTH call
// routing (who rings) and coverage reporting (expected vs actual). Overlaps =
// two rows covering the same minute; a gap = no row → falls to Eleven Labs.
export const vaShifts = pgTable("va_shifts", {
    id: varchar("id").primaryKey().notNull(),
    vaEndpointId: varchar("va_endpoint_id").references(() => vaEndpoints.id),
    dayOfWeek: integer("day_of_week").notNull(),   // 0=Sun … 6=Sat (UK)
    startMinute: integer("start_minute").notNull(), // minutes past UK midnight (0–1440)
    endMinute: integer("end_minute").notNull(),
    createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
    index("idx_va_shifts_endpoint").on(table.vaEndpointId),
    index("idx_va_shifts_day").on(table.dayOfWeek),
]);

// Handyman Profiles
export const handymanProfiles = pgTable("handyman_profiles", {
    id: varchar("id").primaryKey().notNull(),
    userId: varchar("user_id").references(() => users.id).notNull(),
    businessName: varchar("business_name"), // Added field
    bio: text("bio"),
    address: text("address"),
    city: varchar("city", { length: 100 }),
    postcode: varchar("postcode", { length: 20 }),
    latitude: text("latitude"),
    longitude: text("longitude"),
    radiusMiles: integer("radius_miles").notNull().default(10),
    hourlyRate: integer("hourly_rate").default(50), // Standard hourly rate in pounds
    dayRate: integer("day_rate"), // FIXED daily cost in PENCE (nullable → fall back to goal.defaultDayRatePence). True-margin economics: a contractor-day costs this in full regardless of job count.
    calendarSyncToken: text("calendar_sync_token"),
    // Launch bonus (two-sided pricing loop, Phase 2): explicit expiring
    // onboarding boost — "+X% on your first N jobs". Rendered as a SEPARATE
    // bonus line on job offers (never blended into the base rate) and
    // decremented on accept. See docs/TWO-SIDED-PRICING-LOOP-2026-07.md.
    onboardingBoostPercent: integer("onboarding_boost_percent"),
    onboardingBoostJobsRemaining: integer("onboarding_boost_jobs_remaining"),

    // Public Profile Fields
    slug: varchar("slug", { length: 100 }).unique(),
    publicProfileEnabled: boolean("public_profile_enabled").default(false),
    heroImageUrl: text("hero_image_url"),
    profileImageUrl: text("profile_image_url"), // Profile avatar
    socialLinks: jsonb("social_links"), // { instagram, linkedin, website }
    mediaGallery: jsonb("media_gallery"), // Array of { type: 'image'|'video', url: string, caption?: string }

    // New "Smart Widget" Fields
    whatsappNumber: varchar("whatsapp_number", { length: 20 }), // Specific WhatsApp number (overrides main phone)
    trustBadges: jsonb("trust_badges"), // Array of strings e.g. ['dbs', 'insured', 'dog_friendly']
    availabilityStatus: varchar("availability_status", { length: 20 }).default('available'), // 'available', 'busy', 'holiday'
    introVideoUrl: text("intro_video_url"),
    reviews: jsonb("reviews"), // Array of { id, author, rating, date, text, source? }
    aiRules: jsonb("ai_rules"), // { removeRubbish, supplyMaterials, ... }
    beforeAfterGallery: jsonb("before_after_gallery"), // Array of { before: string, after: string, caption: string }

    // Verification Documents & Status
    dbsCertificateUrl: text("dbs_certificate_url"),
    identityDocumentUrl: text("identity_document_url"),
    publicLiabilityInsuranceUrl: text("public_liability_insurance_url"),
    publicLiabilityExpiryDate: timestamp("public_liability_expiry_date"),
    verificationStatus: varchar("verification_status", { length: 20 }).default('unverified'), // 'unverified' | 'pending' | 'verified' | 'rejected'

    // Stripe Connect
    stripeAccountId: varchar("stripe_account_id"),
    stripeAccountStatus: varchar("stripe_account_status", { length: 20 }).default('unverified'), // 'unverified' | 'pending' | 'active' | 'rejected'

    // Freemium Tier Fields
    subscriptionTier: varchar("subscription_tier", { length: 20 }).default('free'), // 'free' | 'partner'
    partnerStatus: varchar("partner_status", { length: 30 }).default('not_started'), // Partner application status
    partnerActivatedAt: timestamp("partner_activated_at"), // When they became a partner

    // ── Fulfilment fundamentals (Jul 2026 — quote skin + solo/team) ──────
    // Vehicle determines what materials/equipment they can carry (feeds
    // matching + the notebook's "vehicle size" logic).
    vehicleType: varchar("vehicle_type", { length: 20 }), // 'none' | 'car' | 'small_van' | 'large_van' | 'pickup'
    // Contractor-level performance score (0-100). Column stub — the scoring
    // formula lands later; allocation logic should treat null as "unscored".
    performanceScore: integer("performance_score"),

    // Contractor platform — DELIVERY tier (feat/contractor-platform).
    // Distinct from subscriptionTier above (freemium/marketing). Do NOT overload.
    // Canonical delivery-lane classification — supersedes the short-lived
    // contractor_type column from the skin work (merged 23 Jul).
    deliveryTier: varchar("delivery_tier", { length: 20 }).notNull().default('adhoc'), // 'partner' | 'core' | 'adhoc'
    // Which brand vertical this contractor delivers — a cleaning quote only ever
    // matches 'cleaning' contractors, a handyman quote only 'handyman' (see
    // shared/verticals.ts + findBestContractors). Existing pool defaults to handyman.
    vertical: varchar("vertical", { length: 20 }).notNull().default('handyman'), // 'handyman' | 'cleaning'
    deliveryPriority: integer("delivery_priority"), // routing order within a tier — lower = picked first (Craig = 1); null = unranked
    // Contractor app entry — unguessable per-contractor link token (no login).
    // /my-week/:token → availability harvesting. Issued lazily from the Hub.
    appToken: varchar("app_token", { length: 80 }).unique(),

    // Simple field-login: contractor enters their name + this short keycode at
    // /partner/login → resolves to their app_token → my-week. Low-friction by
    // design (the token URL is already unguessed-link security).
    accessCode: varchar("access_code", { length: 12 }),

    // Availability freshness — updated when contractor toggles availability
    lastAvailabilityRefresh: timestamp("last_availability_refresh"),
    // Round-robin fairness — updated when contractor is assigned a job
    lastAssignedAt: timestamp("last_assigned_at"),

    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
});

export const handymanProfileRelations = relations(handymanProfiles, ({ one, many }) => ({
    user: one(users, {
        fields: [handymanProfiles.userId],
        references: [users.id],
    }),
    skills: many(handymanSkills),
    availability: many(handymanAvailability),
}));

// Handyman Skills (Matching SKUs)
export const handymanSkills = pgTable("handyman_skills", {
    id: varchar("id").primaryKey().notNull(),
    handymanId: varchar("handyman_id").references(() => handymanProfiles.id).notNull(),
    serviceId: varchar("service_id").references(() => productizedServices.id),  // Nullable — legacy link to SKU
    categorySlug: varchar("category_slug", { length: 50 }),  // Granular category from shared/categories.ts (e.g. 'plumbing_minor', 'tv_mounting')
    hourlyRate: integer("hourly_rate"), // Override standard rate for this specific skill (pence)
    dayRate: integer("day_rate"),       // Day rate (pence)
    proficiency: varchar("proficiency", { length: 20 }).default('competent'), // 'basic' | 'competent' | 'expert'
});

export const handymanSkillRelations = relations(handymanSkills, ({ one }) => ({
    handyman: one(handymanProfiles, {
        fields: [handymanSkills.handymanId],
        references: [handymanProfiles.id],
    }),
    service: one(productizedServices, {
        fields: [handymanSkills.serviceId],
        references: [productizedServices.id],
    }),
}));

// Handyman Availability (Recurring or Specific Slots)
export const handymanAvailability = pgTable("handyman_availability", {
    id: varchar("id").primaryKey().notNull(),
    handymanId: varchar("handyman_id").references(() => handymanProfiles.id).notNull(),
    dayOfWeek: integer("day_of_week"), // 0-6 (Sunday-Saturday)
    startTime: varchar("start_time", { length: 5 }), // "HH:mm"
    endTime: varchar("end_time", { length: 5 }), // "HH:mm"
    isActive: boolean("is_active").notNull().default(true),
});

export const handymanAvailabilityRelations = relations(handymanAvailability, ({ one }) => ({
    handyman: one(handymanProfiles, {
        fields: [handymanAvailability.handymanId],
        references: [handymanProfiles.id],
    }),
}));

// ── Contractor Teams (Jul 2026 — solo/team fulfilment) ─────────────────────
// A team is a named crew of contractors that can be quoted/booked as a unit.
// Team skills = union of member skills; team size = member count; team score =
// derived from member performanceScores. The team can also front a quote as a
// skin (crewType='team' + skinTeamId on personalized_quotes).
export const contractorTeams = pgTable("contractor_teams", {
    id: varchar("id").primaryKey().notNull(),
    name: varchar("name", { length: 100 }).notNull(),          // internal name, e.g. "Craig + Joe"
    displayName: varchar("display_name", { length: 100 }),      // customer-facing, e.g. "Craig's Team"
    leadContractorId: varchar("lead_contractor_id").references(() => handymanProfiles.id),
    profileImageUrl: text("profile_image_url"),                 // team avatar for quote skins
    heroImageUrl: text("hero_image_url"),                       // team banner for quote skins
    bio: text("bio"),
    // Crew size = how many pairs of hands. Drives capacity: a team of N books
    // ~N× the daily labour and completes a job in ~1/Nth the wall-clock (with an
    // efficiency floor — see the scheduler, Phase 2). 1 behaves exactly like a solo.
    crewSize: integer("crew_size").notNull().default(1),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at").defaultNow(),
});

export const contractorTeamMembers = pgTable("contractor_team_members", {
    id: varchar("id").primaryKey().notNull(),
    teamId: varchar("team_id").references(() => contractorTeams.id).notNull(),
    contractorId: varchar("contractor_id").references(() => handymanProfiles.id).notNull(),
    role: varchar("role", { length: 20 }).default('member'),    // 'lead' | 'member'
    createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
    index("idx_team_members_team").on(table.teamId),
]);

export const contractorTeamRelations = relations(contractorTeams, ({ one, many }) => ({
    lead: one(handymanProfiles, {
        fields: [contractorTeams.leadContractorId],
        references: [handymanProfiles.id],
    }),
    members: many(contractorTeamMembers),
}));

export const contractorTeamMemberRelations = relations(contractorTeamMembers, ({ one }) => ({
    team: one(contractorTeams, {
        fields: [contractorTeamMembers.teamId],
        references: [contractorTeams.id],
    }),
    contractor: one(handymanProfiles, {
        fields: [contractorTeamMembers.contractorId],
        references: [handymanProfiles.id],
    }),
}));

// Contractor Availability Dates - Date-specific availability (overrides weekly patterns)
export const contractorAvailabilityDates = pgTable("contractor_availability_dates", {
    id: varchar("id").primaryKey().notNull(),
    contractorId: varchar("contractor_id").references(() => handymanProfiles.id).notNull(),
    date: timestamp("date").notNull(),
    isAvailable: boolean("is_available").notNull().default(true),
    startTime: varchar("start_time", { length: 5 }), // "HH:mm"
    endTime: varchar("end_time", { length: 5 }), // "HH:mm"
    notes: text("notes"),
    createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
    index("idx_contractor_availability_date").on(table.contractorId, table.date),
]);

export const contractorAvailabilityDatesRelations = relations(contractorAvailabilityDates, ({ one }) => ({
    contractor: one(handymanProfiles, {
        fields: [contractorAvailabilityDates.contractorId],
        references: [handymanProfiles.id],
    }),
}));

// Contractor Diary Items - non-job entries in a contractor's day (first kind:
// quote_visit — survey/quote a prospect). Occupy real time (consume capacity)
// but have NO payout/deposit/completion ceremony. Pure UK day, like availability.
export const contractorDiaryItems = pgTable("contractor_diary_items", {
    id: varchar("id").primaryKey().notNull(),
    contractorId: varchar("contractor_id").notNull(),
    date: date("date", { mode: "date" }).notNull(), // pg date + mode:'date' → UTC-midnight Date round-trip
    slot: varchar("slot", { length: 8 }).notNull().default("am"), // 'am' | 'pm'
    startTime: varchar("start_time", { length: 5 }), // optional "HH:mm"
    minutes: integer("minutes").notNull().default(45),
    kind: varchar("kind", { length: 20 }).notNull().default("quote_visit"),
    customerName: varchar("customer_name").notNull(),
    customerPhone: varchar("customer_phone"),
    address: text("address"),
    postcode: varchar("postcode", { length: 12 }),
    notes: text("notes"),
    status: varchar("status", { length: 10 }).notNull().default("open"), // 'open' | 'done'
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
}, (table) => [
    index("idx_contractor_diary_items_contractor_date").on(table.contractorId, table.date),
]);

export type ContractorDiaryItem = typeof contractorDiaryItems.$inferSelect;

// Master Availability - System-wide default availability patterns
export const masterAvailability = pgTable("master_availability", {
    id: serial("id").primaryKey(),
    dayOfWeek: integer("day_of_week").notNull(), // 0-6 (Sunday-Saturday)
    startTime: varchar("start_time", { length: 5 }), // "HH:mm"
    endTime: varchar("end_time", { length: 5 }), // "HH:mm"
    isActive: boolean("is_active").default(true),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
});

// Master Blocked Dates - System-wide blocked dates (holidays, etc.)
export const masterBlockedDates = pgTable("master_blocked_dates", {
    id: serial("id").primaryKey(),
    date: date("date").notNull(),
    reason: varchar("reason", { length: 255 }),
    createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
    uniqueIndex("idx_master_blocked_dates_date").on(table.date),
]);

// Contractor Jobs - Job assignments to contractors
export const contractorJobs = pgTable("contractor_jobs", {
    id: varchar("id").primaryKey().notNull(),
    contractorId: varchar("contractor_id").references(() => handymanProfiles.id).notNull(),
    quoteId: varchar("quote_id"),
    leadId: varchar("lead_id"),
    customerName: varchar("customer_name"),
    customerPhone: varchar("customer_phone"),
    address: text("address"),
    postcode: varchar("postcode", { length: 10 }),
    jobDescription: text("job_description"),
    status: varchar("status", { length: 20 }).notNull().default('pending'), // 'pending' | 'accepted' | 'declined' | 'in_progress' | 'completed' | 'cancelled'
    scheduledDate: timestamp("scheduled_date"),
    scheduledTime: varchar("scheduled_time", { length: 5 }),
    estimatedDuration: integer("estimated_duration"), // minutes
    payoutPence: integer("payout_pence"),
    acceptedAt: timestamp("accepted_at"),
    completedAt: timestamp("completed_at"),
    notes: text("notes"),

    // Payment Tracking
    paymentStatus: varchar("payment_status", { length: 20 }).default('unpaid'), // 'unpaid', 'paid', 'refunded'
    paymentMethod: varchar("payment_method", { length: 20 }), // 'cash', 'bank_transfer', 'card'
    paidAt: timestamp("paid_at"),

    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
    index("idx_contractor_jobs_contractor").on(table.contractorId),
    index("idx_contractor_jobs_status").on(table.status),
]);

export const contractorJobsRelations = relations(contractorJobs, ({ one }) => ({
    contractor: one(handymanProfiles, {
        fields: [contractorJobs.contractorId],
        references: [handymanProfiles.id],
    }),
}));

// Schemas for API validation
export const insertLeadSchema = createInsertSchema(leads);
export type InsertLead = z.infer<typeof insertLeadSchema>;
export type Lead = typeof leads.$inferSelect;

export const insertCallSchema = createInsertSchema(calls);
export type InsertCall = z.infer<typeof insertCallSchema>;
export type Call = typeof calls.$inferSelect;

export const insertCallSkuSchema = createInsertSchema(callSkus);
export type CallSku = typeof callSkus.$inferSelect;
export type InsertCallSku = z.infer<typeof insertCallSkuSchema>;

// Schema for updating call metadata
export const updateCallSchema = z.object({
    customerName: z.string().optional(),
    email: z.union([z.string().email(), z.literal("")]).optional(),
    address: z.string().optional(),
    postcode: z.string().optional(),
    notes: z.string().optional(),
    leadType: z.enum(['Homeowner', 'Landlord', 'Property Manager', 'Tenant', 'Unknown']).optional(),
    outcome: z.enum(['INSTANT_PRICE', 'VIDEO_QUOTE', 'SITE_VISIT', 'NO_ANSWER', 'VOICEMAIL', 'ELEVEN_LABS', 'MISSED_OPPORTUNITY', 'CALLBACK_URGENT', 'LEAD_CAPTURED', 'Unknown']).optional(),
    actionStatus: z.enum(['pending', 'attempting', 'resolved', 'dismissed']).optional(),
    actionUrgency: z.number().int().min(1).max(5).optional(),
    missedReason: z.string().optional(),
    tags: z.array(z.string()).optional(),
});

export const insertHandymanProfileSchema = createInsertSchema(handymanProfiles);
export type HandymanProfile = typeof handymanProfiles.$inferSelect;
export type InsertHandymanProfile = z.infer<typeof insertHandymanProfileSchema>;

export const insertHandymanSkillSchema = createInsertSchema(handymanSkills);
export type HandymanSkill = typeof handymanSkills.$inferSelect;

export const insertHandymanAvailabilitySchema = createInsertSchema(handymanAvailability);
export type HandymanAvailability = typeof handymanAvailability.$inferSelect;

// User Types
export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

// Contractor Availability Dates Types
export const insertContractorAvailabilityDateSchema = createInsertSchema(contractorAvailabilityDates);
export type ContractorAvailabilityDate = typeof contractorAvailabilityDates.$inferSelect;
export type InsertContractorAvailabilityDate = z.infer<typeof insertContractorAvailabilityDateSchema>;

// Master Availability Types
export const insertMasterAvailabilitySchema = createInsertSchema(masterAvailability);
export type MasterAvailability = typeof masterAvailability.$inferSelect;
export type InsertMasterAvailability = z.infer<typeof insertMasterAvailabilitySchema>;

// Master Blocked Dates Types
export const insertMasterBlockedDateSchema = createInsertSchema(masterBlockedDates);
export type MasterBlockedDate = typeof masterBlockedDates.$inferSelect;
export type InsertMasterBlockedDate = z.infer<typeof insertMasterBlockedDateSchema>;

// Contractor Jobs Types
export const insertContractorJobSchema = createInsertSchema(contractorJobs);
export type ContractorJob = typeof contractorJobs.$inferSelect;
export type InsertContractorJob = z.infer<typeof insertContractorJobSchema>;

// ==========================================
// MIGRATED FROM V5 - PERSONALIZED QUOTES
// ==========================================

export const jobCategoryEnum = z.enum(['mounting', 'carpentry', 'plaster', 'painting', 'plumbing', 'electrical_minor']);
export const substrateTypeEnum = z.enum(['plasterboard', 'brick', 'tile', 'mixed', 'unknown']);
export const materialsByEnum = z.enum(['us', 'client', 'mixed']);
export const urgencyLevelEnum = z.enum(['same_day', 'next_day', 'flexible']);
export const personaTypeEnum = z.enum(['price', 'homeowner', 'landlord']);

// Migrated Enums for Value Pricing
export const urgencyReasonEnum = z.enum(['low', 'med', 'high']);
export const ownershipContextEnum = z.enum(['tenant', 'homeowner', 'landlord', 'airbnb', 'selling']);
export const desiredTimeframeEnum = z.enum(['flex', 'week', 'asap']);

// B1.1: Segmentation Enums (Phase 1 Master Plan)
// Note: EMERGENCY is deprecated as a segment. It is now an urgency flag (isEmergency) that overlays any segment.
export const segmentEnum = z.enum(['EMERGENCY', 'BUSY_PRO', 'PROP_MGR', 'LANDLORD', 'SMALL_BIZ', 'TRUST_SEEKER', 'OLDER_WOMAN', 'RENTER', 'DIY_DEFERRER', 'BUDGET', 'DEFAULT']);
export type SegmentType = z.infer<typeof segmentEnum>;
export const jobTypeEnum = z.enum(['SINGLE', 'COMPLEX', 'MULTIPLE']);
export const quotabilityEnum = z.enum(['INSTANT', 'VIDEO', 'VISIT']);

export const optionalExtraSchema = z.object({
    id: z.string().optional(), // Unique ID for tracking
    label: z.string().min(1, "Label is required"),
    description: z.string().min(1, "Description is required"),

    // Raw pricing inputs (editable by admin)
    serviceType: z.enum(['carpentry', 'painting', 'plumbing', 'electrical', 'mounting', 'general']).default('general'),
    complexity: z.enum(['easy', 'medium', 'hard', 'simple', 'moderate', 'complex', 'very_complex']).optional(), // Supports both legacy and new values
    estimatedHours: z.number().nonnegative().optional(), // Allow 0 hours
    materialsCost: z.number().nonnegative().optional(), // Materials in pounds (for admin editing)

    // Calculated pricing (in Pence)
    priceInPence: z.number().int().nonnegative(),
    materialsCostInPence: z.number().int().nonnegative().default(0),
    laborCostInPence: z.number().int().nonnegative().default(0),
    calloutFeeInPence: z.number().int().nonnegative().default(0),

    isRecommended: z.boolean().default(false),
});

export const personalizedQuotes = pgTable("personalized_quotes", {
    id: varchar("id").primaryKey().notNull(),
    shortSlug: varchar("short_slug", { length: 8 }).unique().notNull(), // Short URL slug for personalized link
    contractorId: varchar("contractor_id"), // Optional: if generated by a contractor

    // Lead Information
    customerName: varchar("customer_name").notNull(),
    phone: varchar("phone").notNull(),
    email: varchar("email"),
    postcode: varchar("postcode"),
    address: text("address"), // Full Google Maps address
    coordinates: jsonb("coordinates"), // { lat: number, lng: number }
    propertyId: varchar("property_id").references(() => serviceProperties.id), // Spine property (where the work happens)
    clientId: varchar("client_id").references(() => serviceClients.id), // Spine client (who pays)

    // Job Details
    jobDescription: text("job_description").notNull(),
    completionDate: varchar("completion_date"), // Optional completion timeframe or specific date

    // H/HH/HHH Structured Inputs (new value-priced system)
    tasks: text("tasks").array(), // Array of task strings describing outcomes
    categories: varchar("categories", { length: 50 }).array(), // Multi-select: mounting, carpentry, plaster, painting, plumbing, electrical_minor
    substrates: varchar("substrates", { length: 50 }).array(), // Multi-select: plasterboard, brick, tile, mixed, unknown
    materialsBy: varchar("materials_by", { length: 20 }), // Enum: us, client, mixed
    urgency: varchar("urgency", { length: 20 }), // Enum: same_day, next_day, flexible (replaces old low/medium/high)
    persona: varchar("persona", { length: 20 }), // Enum: price, homeowner, landlord
    risk: integer("risk"), // 1-3 scale (max risk across tasks)

    // B1.2: Segmentation Fields (Phase 1 Master Plan)
    segment: varchar("segment", { length: 20 }).default('UNKNOWN'), // BUSY_PRO, PROP_MGR, SMALL_BIZ, DIY_DEFERRER, BUDGET
    jobType: varchar("job_type", { length: 20 }).default('SINGLE'), // SINGLE, COMPLEX, MULTIPLE
    quotability: varchar("quotability", { length: 20 }).default('VISIT'), // INSTANT, VIDEO, VISIT
    proposalModeEnabled: boolean("proposal_mode_enabled").default(true), // Standard for all quotes - weighted scroll value primer

    // Multi-Job Support (value-anchored pricing) - DEPRECATED
    jobs: jsonb("jobs"), // Array of individual job objects with their own PVS scores

    // Value-Anchored Pricing Context - DEPRECATED
    contextSignals: jsonb("context_signals"), // {urgency, motivation, pastLetDown, guestsSoon, narrativeTone, propertyType, roomType, timingPreference}

    // Value Pricing Inputs (NEW PRD-based system)
    urgencyReason: varchar("urgency_reason", { length: 20 }), // Enum: low, med, high
    ownershipContext: varchar("ownership_context", { length: 20 }), // Enum: tenant, landlord, own, airbnb, selling
    desiredTimeframe: varchar("desired_timeframe", { length: 20 }), // Enum: flex, week, asap
    baseJobPricePence: integer("base_job_price_pence"), // Base price estimate in pence (before value multiplier)
    valueMultiplier100: integer("value_multiplier_100"), // Stored as 100x (e.g., 1.12x = 112)
    recommendedTier: varchar("recommended_tier", { length: 20 }), // System recommendation: essential, hassleFree, highStandard
    additionalNotes: text("additional_notes"), // Optional context from call
    assessmentReason: text("assessment_reason"), // Why a generic quote wasn't possible
    // DEPRECATED — visit tier prices no longer used, single price model via basePrice
    tierStandardPrice: integer("tier_standard_price"),
    tierPriorityPrice: integer("tier_priority_price"),
    tierEmergencyPrice: integer("tier_emergency_price"),
    tierDeliverables: jsonb("tier_deliverables"), // DEPRECATED — deliverables stored as flat array

    // PVS (Perceived Value Score) Tracking - DEPRECATED
    pvsScore: integer("pvs_score"), // 0-100 score based on 6-factor weighted system
    valueMultiplier: integer("value_multiplier"), // DEPRECATED - use valueMultiplier100 instead
    dominantCategory: varchar("dominant_category"), // 'safety', 'visual', 'comfort', 'urgency', 'trust', 'property_value'
    anchorPrice: integer("anchor_price"), // Base cost × value multiplier (in pence)

    // Quote Mode — DEPRECATED, all new quotes use 'simple' (single price model)
    quoteMode: varchar("quote_mode", { length: 20 }).notNull().default("simple"), // Legacy: 'simple' | 'hhh' | 'pick_and_mix' | 'consultation'
    visitTierMode: varchar("visit_tier_mode", { length: 20 }).default('standard'), // 'standard' | 'tiers'
    clientType: varchar("client_type", { length: 20 }).default('residential'), // 'residential' | 'commercial'

    // DEPRECATED — EEE tier prices, kept for backward compat with existing quotes
    essentialPrice: integer("essential_price"),
    enhancedPrice: integer("enhanced_price"),
    elitePrice: integer("elite_price"),

    // Canonical quote price (single price model)
    basePrice: integer("base_price"), // in pence — THE price for the quote
    optionalExtras: jsonb("optional_extras"), // Array of {label, priceInPence, description, isRecommended}

    // Materials Cost (for deposit calculation)
    materialsCostWithMarkupPence: integer("materials_cost_with_markup_pence").default(0), // Total materials cost with 30% markup applied, in pence

    // Personalization Data - DEPRECATED (replaced by fixed value bullets in code)
    valueOpportunities: jsonb("value_opportunities"), // DEPRECATED
    emotionalAngle: varchar("emotional_angle"), // DEPRECATED
    personalizedFeatures: jsonb("personalized_features"), // DEPRECATED

    // Manual Feature Entry - DEPRECATED (replaced by fixed value bullets per tier in code)
    coreDeliverables: jsonb("core_deliverables"), // DEPRECATED
    potentialUpgrades: jsonb("potential_upgrades"), // DEPRECATED
    potentialExtras: jsonb("potential_extras"), // DEPRECATED
    desirables: jsonb("desirables"), // DEPRECATED

    // Tracking
    viewedAt: timestamp("viewed_at"), // When lead first viewed the link
    viewCount: integer("view_count").default(0),
    lastViewedAt: timestamp("last_viewed_at"),
    selectedPackage: varchar("selected_package"), // 'essential', 'enhanced', or 'elite' (for HHH mode)
    selectedExtras: jsonb("selected_extras"), // Array of selected extra labels
    selectedAt: timestamp("selected_at"), // When package was selected
    bookedAt: timestamp("booked_at"), // When booking was confirmed
    rejectionReason: text("rejection_reason"),
    feedbackJson: jsonb("feedback_json"),
    leadId: varchar("lead_id"), // Links to leads table when lead submits
    expiresAt: timestamp("expires_at"), // When the quote expires (48 hours from creation — QUOTE_VALIDITY_MS)

    // Regeneration Tracking
    regeneratedFromId: varchar("regenerated_from_id"), // ID of original quote if this was regenerated from an expired quote
    regenerationCount: integer("regeneration_count").default(0), // How many times this quote chain has been regenerated
    extensionCount: integer("extension_count").default(0), // How many times customer has extended the quote timer (max 3)

    // Payment & Installments Tracking
    paymentType: varchar("payment_type", { length: 20 }), // 'full' | 'installments'
    stripeCustomerId: varchar("stripe_customer_id"), // Stripe Customer ID for recurring payments
    stripeSubscriptionScheduleId: varchar("stripe_subscription_schedule_id"), // Stripe Subscription Schedule ID
    stripePaymentMethodId: varchar("stripe_payment_method_id"), // Saved payment method for installments
    stripePaymentIntentId: varchar("stripe_payment_intent_id"), // Stripe Payment Intent ID for deposit payment
    installmentStatus: varchar("installment_status", { length: 20 }), // 'pending' | 'active' | 'completed' | 'failed' | 'canceled'
    installmentAmountPence: integer("installment_amount_pence"), // Amount per installment in pence
    totalInstallments: integer("total_installments").default(3), // Number of installments (default 3)
    completedInstallments: integer("completed_installments").default(0), // How many installments have been paid
    nextInstallmentDate: timestamp("next_installment_date"), // When the next installment is due
    depositPaidAt: timestamp("deposit_paid_at"), // When the deposit was successfully paid
    completedAt: timestamp("completed_at"), // When the job was marked as completed (for invoicing)

    // Line-item split ("save for another visit"): snapshot of the lines the
    // customer deferred at booking. The paid booking covers only the KEPT scope;
    // these are surfaced to admin/dispatch as saved-for-a-follow-up-visit.
    deferredLineItems: jsonb("deferred_line_items").$type<Array<{ lineId: string; label: string; pricePence: number }>>(),

    // Deposit Tracking (for audit trail)
    depositAmountPence: integer("deposit_amount_pence"), // Calculated deposit amount in pence
    selectedTierPricePence: integer("selected_tier_price_pence"), // The tier price at time of selection in pence

    // BUSY_PRO Calendar-Based Scheduling (Dynamic Pricing)
    schedulingTier: varchar("scheduling_tier", { length: 20 }), // 'express' | 'priority' | 'standard' | 'flexible'
    selectedDate: timestamp("selected_date"), // The date customer selected for service
    isWeekendBooking: boolean("is_weekend_booking").default(false), // Whether the selected date is a weekend
    timeSlotType: varchar("time_slot_type", { length: 20 }), // 'am' | 'pm' | 'exact' | 'out_of_hours'
    exactTimeRequested: varchar("exact_time_requested", { length: 10 }), // e.g., "10:00" if exact time selected
    schedulingFeeInPence: integer("scheduling_fee_in_pence").default(0), // Total scheduling fee (date + time combined)

    // Automation Dedup Tracking
    reminderSentAt: timestamp("reminder_sent_at"), // Quote reminder automation sent
    followupSentAt: timestamp("followup_sent_at"), // Quote viewed follow-up automation sent
    viewNudgeSentAt: timestamp("view_nudge_sent_at"), // Nudge sent after 3rd view (dedup)
    followupAlertSentAt: timestamp("followup_alert_sent_at"), // Internal Pushover "chase this quote" alert sent (dedup)

    // Quote Attribution (who created this quote — for VA commission tracking)
    createdBy: varchar("created_by"), // User ID of the admin/VA who created this quote
    createdByName: varchar("created_by_name", { length: 100 }), // Display name for quick reference (avoids JOIN)

    // Quote Origin (ties call metrics to quotes/conversions)
    sourceCallId: varchar("source_call_id"), // calls.id this quote originated from (auto-matched or picked)
    sourceChannel: varchar("source_channel", { length: 20 }), // 'call' | 'whatsapp' | 'web' | 'other'

    // Contextual Pricing Engine (Phase 3)
    contextualHeadline: varchar("contextual_headline", { length: 100 }), // LLM-generated headline (e.g. "Your Kitchen Sorted")
    contextualMessage: text("contextual_message"), // 1-2 sentence summary
    jobTopLine: text("job_top_line"),
    proposalSummary: text("proposal_summary"), // AI-generated scope-of-work summary (2-4 sentences, 40-80 words)
    valueBullets: jsonb("value_bullets").$type<string[]>(), // 3-5 approved claim bullets for quote page
    whatsappValueLines: jsonb("whatsapp_value_lines").$type<string[]>(), // 2 WhatsApp value lines
    whatsappClosing: varchar("whatsapp_closing", { length: 255 }), // WhatsApp closing line
    layoutTier: varchar("layout_tier", { length: 20 }), // 'quick', 'standard', or 'complex'
    bookingModes: jsonb("booking_modes").$type<string[]>(), // which booking options to show
    requiresHumanReview: boolean("requires_human_review").default(false), // flag for AI parser fallback
    reviewReason: text("review_reason"), // why human review is needed
    // Survey gate — when true the customer CANNOT book the job (no flex, no
    // date-pick). A physical site survey must happen first, so the quote page
    // swaps the job booking card for a paid-survey booking card (fee below).
    // Prevents mis-scoped jobs being committed sight-unseen (the "Alicia" case).
    surveyRequired: boolean("survey_required").default(false),
    surveyFeePence: integer("survey_fee_pence"), // survey/site-visit fee in pence (credited to the job)
    // Provisional welcome-gift claim (pre-payment). Set server-side when the
    // customer accepts a validated gift on the interstitial / gift band, so a
    // returning visitor keeps their pick. AUTHORITY UNCHANGED: money paths
    // still re-validate the client-sent giftId at payment time.
    claimedGiftId: varchar("claimed_gift_id", { length: 100 }),
    // Site-survey response — a contractor (e.g. Joe) opens a tokenised /survey/:slug
    // link on their phone and fills a per-item survey (scope, time estimate,
    // materials, notes, photos) for additional works found on site. Record/display
    // only (no acceptance gate); the office is pinged via Pushover on submit.
    // Primary capture per item is now a voice note (auto-transcribed via
    // Whisper) + video; scope/notes text is optional/secondary. New fields are
    // optional so older/partial submissions still fit the shape (jsonb — no
    // migration needed).
    surveyResponse: jsonb("survey_response").$type<{
      items: Array<{
        key: string;
        scope: string;
        timeEstimate: string;
        materials: 'us' | 'her' | '';
        notes: string;
        photoUrls: string[];
        voiceNoteUrl?: string;
        transcript?: string;
        videoUrls?: string[];
      }>;
      anythingElse: string;
      surveyorName: string;
    }>(),
    surveySubmittedAt: timestamp("survey_submitted_at"), // when the contractor submitted the site survey
    // Quote-level "standard assumptions" — caveats the fixed price is based on
    // (access, parking, existing installs sound…). Shown on the quote page so
    // there's a documented basis to re-price if reality differs on the day.
    // Per-line assumptions live inside pricing_line_items jsonb, not here.
    quoteAssumptions: jsonb("quote_assumptions").$type<string[]>(),
    pricingLineItems: jsonb("pricing_line_items"), // full line item breakdown from contextual engine
    pricingLayerBreakdown: jsonb("pricing_layer_breakdown"), // L1/L3/L4 breakdown for admin reference
    batchDiscountPercent: integer("batch_discount_percent"), // batch discount applied (stored as whole number, e.g. 10 for 10%)
    // Content Library: selected content IDs for conversion tracking
    selectedContentIds: jsonb("selected_content_ids").$type<{
      claimIds?: number[];
      guaranteeId?: number | null;
      testimonialIds?: number[];
      hassleItemIds?: number[];
      imageIds?: number[];
      bookingRuleId?: number | null;
    }>(),

    // Customer-supplied job photos (uploaded during contextual quote generation,
    // shown on the customer quote page as "your job, as you sent it")
    customerPhotoUrls: jsonb("customer_photo_urls").$type<string[]>(),

    // Note: contextSignals field already exists above (line 664) — reused for raw context signals for analytics/retraining

    // Margin Engine — Cost vs Price tracking
    costPence: integer("cost_pence"),                    // Total contractor cost for this quote (pence)
    marginPence: integer("margin_pence"),                // basePrice - costPence (pence)
    marginPercent: integer("margin_percent"),             // (marginPence / basePrice) × 100
    marginFlags: jsonb("margin_flags").$type<string[]>(), // Warning strings for admin dashboard
    matchedContractorId: varchar("matched_contractor_id"), // Pre-matched contractor at quote time
    matchedContractorRate: integer("matched_contractor_rate"), // Snapshot of their rate (pence/hr)

    // VA-specified available booking dates for this quote (overrides system availability when set)
    availableDates: jsonb("available_dates").$type<string[]>(),
    // Per-date time preferences from 3-date buffer picker: [{date: "2026-04-15", timeSlot: "am"|"pm"|"full_day"}]
    dateTimePreferences: jsonb("date_time_preferences").$type<{ date: string; timeSlot: 'am' | 'pm' | 'flexible' | 'full_day' }[]>(),

    // Contractor Matching & Margin Tracking (Handy Services rebuild)
    matchedContractorName: varchar("matched_contractor_name", { length: 255 }),
    matchCoveragePercent: integer("match_coverage_percent"),
    uncoveredCategories: text("uncovered_categories").array(),
    matchFlags: text("match_flags").array(),
    perLineMargin: jsonb("per_line_margin"), // [{categorySlug, customerPricePence, contractorRatePence, marginPence, marginPercent}]
    pricingSnapshot: jsonb("pricing_snapshot"), // snapshot of pricing settings at creation time

    // Candidate Contractor Pool — built at quote creation time
    candidateContractorIds: jsonb("candidate_contractor_ids").$type<string[]>(), // All contractor IDs who can service this quote
    candidatePoolSize: integer("candidate_pool_size"), // Total candidates found
    fullCoverageCandidates: integer("full_coverage_candidates"), // Count who cover 100% of categories

    // Contractor platform — SOFT lead + composed team plan (feat/contractor-platform).
    // Advisory only: set at quote generation, drives the contractor skin + hub pipeline
    // lane. Holds NO capacity — hard reservation still happens at deposit (bookingSlotLocks).
    leadContractorId: varchar("lead_contractor_id").references(() => handymanProfiles.id), // soft-assigned lead
    teamPlan: jsonb("team_plan"), // { lead, assignments:[{contractorId,role,coveredCategories}], uncoveredCategories } — the "steer, then compose" suggestion Ben confirms
    // 'manual' = Ben forced the lead in the quote builder → live fit recomputes
    // (public availability, admin panels) must keep steering this lead first.
    // 'auto'/null = engine's own pick, free to move as the roster changes.
    leadContractorSource: varchar("lead_contractor_source").$type<'auto' | 'manual'>(),

    // Booking Lock
    bookingLockedAt: timestamp("booking_locked_at"),
    bookingLockExpiresAt: timestamp("booking_lock_expires_at"),

    // Refund Tracking
    refundedAt: timestamp("refunded_at"),
    refundAmountPence: integer("refund_amount_pence"),
    refundReason: text("refund_reason"),

    // Delivery Tracking
    deliveryChannel: varchar("delivery_channel", { length: 20 }), // whatsapp | sms | email
    deliveryStatus: varchar("delivery_status", { length: 20 }), // pending | delivered | read | failed

    // Unsent draft (saved from the in-chat quote card in /admin/comms). A draft
    // is resumable from the quotes list / builder but must never reach the
    // customer: customer-facing automations skip it, and a normal builder save
    // (no isDraft flag) clears it — that's Ben taking the quote over.
    isDraft: boolean("is_draft").default(false),

    // Revocation
    revokedAt: timestamp("revoked_at"),

    // ── Crew & skin selection (set at quote generation) ──────────────────
    // crewType decides which contractor pool fulfils the job (solo vs team)
    // and which face fronts the quote. The skin ids point at the contractor/
    // team whose imagery + name the customer page renders; when both are null
    // the page falls back to the default brand skin (Craig).
    crewType: varchar("crew_type", { length: 10 }).default('solo'), // 'solo' | 'team'
    skinContractorId: varchar("skin_contractor_id"), // handyman_profiles.id fronting the quote
    skinTeamId: varchar("skin_team_id"),             // contractor_teams.id when crewType='team'

    // Which brand vertical fronts this quote — decides the theatre, avatars,
    // hero imagery and all trade copy (see shared/verticals.ts). Set at
    // generation; default keeps every legacy quote on the handyman brand.
    vertical: varchar("vertical", { length: 20 }).default('handyman'), // 'handyman' | 'cleaning'

    // Customer type promoted to a first-class column (also kept inside
    // contextSignals for legacy readers). Queryable for analytics/segmenting.
    customerType: varchar("customer_type", { length: 30 }), // homeowner | oap_homeowner | landlord | property_manager | tenant | business | letting_agent

    // ── Materials & equipment logistics ──────────────────────────────────
    // Longest supplier lead time across the job's materials — gates the
    // earliest date the customer picker should offer.
    materialLeadTimeDays: integer("material_lead_time_days"),
    // Plant/tool hire needed for the job: [{ name, days?, costPence?, notes? }].
    // Hire availability gates dates and feeds job cost.
    hireEquipment: jsonb("hire_equipment").$type<{ name: string; days?: number; costPence?: number; notes?: string }[]>(),
    // Customer-supplied job videos (companion to customerPhotoUrls)
    customerVideoUrls: jsonb("customer_video_urls").$type<string[]>(),

    // ── Time-affecting context (Phase 4b) ────────────────────────────────
    // Cross-cutting variables that multiply or buffer per-line work time.
    // The booking engine + LLM both read these when composing schedule
    // duration; line items handle the work itself.
    floorNumber: integer("floor_number"),                    // 0 = ground; affects materials trips
    hasLift: boolean("has_lift"),                            // null = unknown; true = lift present
    parkingDistanceCategory: varchar("parking_distance_category", { length: 20 }), // 'on_drive' | 'street_outside' | 'street_within_50m' | '50m_plus'
    customerPresent: boolean("customer_present"),            // null = unknown; affects +15% buffer

    // ── Phase 25 — Flex booking (yield mechanism) ─────────────────────────
    // When non-null, the quote was sold as flex: customer chose
    // "we pick a day within N days, ~10% off" instead of a specific date.
    // Dispatcher uses this to route bookings to thin days. Owned by
    // Agent 25c/25d for the routing logic; this column is the persistence layer.
    flexBookingWithinDays: integer("flex_booking_within_days"),

    // Customer slot-offer handshake (one active offer per quote). The dispatcher sends a
    // tokenised link of dispatch-approved dates; the customer self-selects (recommended =
    // free/keeps flex discount, others = forfeit-discount top-up via Stripe); on confirm we
    // assign the contractor. See shared/slot-offer.ts. Null ⇒ no active offer.
    slotOffer: jsonb("slot_offer").$type<SlotOffer>(),

    // Creation timestamp
    createdAt: timestamp("created_at").defaultNow(),

});

export type UrgencyReasonType = z.infer<typeof urgencyReasonEnum>;
export type OwnershipContextType = z.infer<typeof ownershipContextEnum>;
export type DesiredTimeframeType = z.infer<typeof desiredTimeframeEnum>;

// New Enums for Quote Topology

export const clientTypeEnum = z.enum(['residential', 'commercial']);
export const jobComplexityEnum = z.enum(['trivial', 'low', 'medium', 'high']);

export type ClientType = z.infer<typeof clientTypeEnum>;
export type JobComplexityType = z.infer<typeof jobComplexityEnum>;

export interface ValuePricingInputs {
    urgencyReason: UrgencyReasonType;
    ownershipContext: OwnershipContextType;
    desiredTimeframe: DesiredTimeframeType;
    baseJobPrice: number; // in pence
    clientType: ClientType; // New: Who is asking?
    jobComplexity: JobComplexityType; // New: How hard is it?
    forcedQuoteStyle?: 'hhh' | 'direct' | 'rate_card' | 'pick_and_mix' | 'consultation'; // Override auto-detection

    // B1: Phase 1 Segmentation Fields (Manual Entry)
    segment?: string; // BUSY_PRO, PROP_MGR, SMALL_BIZ, DIY_DEFERRER, BUDGET, UNKNOWN
    jobType?: string; // SINGLE, COMPLEX, MULTIPLE
    quotability?: string; // INSTANT, VIDEO, VISIT
}

export interface HHHStructuredInputs {
    tasks: string[];
    categories: string[];
    substrates: string[];
    materialsBy: 'us' | 'client' | 'mixed';
    urgency: 'same_day' | 'next_day' | 'flexible';
    persona: 'price' | 'homeowner' | 'landlord';
    risk: number;
    totalEstimatedHours?: number;
}

export const insertPersonalizedQuoteSchema = createInsertSchema(personalizedQuotes).omit({
    id: true,
    shortSlug: true, // Auto-generated by backend
    viewedAt: true,
    selectedPackage: true,
    selectedExtras: true,
    selectedAt: true,
    bookedAt: true,
    leadId: true,
    createdAt: true,
}).extend({
    // New H/HH/HHH structured inputs with validation
    tasks: z.array(z.string().min(1)).min(1, "At least one task is required").max(5, "Maximum 5 tasks allowed").optional(),
    categories: z.array(jobCategoryEnum).min(1, "At least one category is required").optional(),
    substrates: z.array(substrateTypeEnum).min(1, "At least one substrate is required").optional(),
    materialsBy: materialsByEnum.optional(),
    urgency: urgencyLevelEnum.optional(),
    persona: personaTypeEnum.optional(),
    risk: z.number().int().min(1).max(3).optional(),
    // Optional extras with full schema validation (CRITICAL: ties JSONB to optionalExtraSchema)
    optionalExtras: z.array(optionalExtraSchema).optional().nullable(),
    visitTierMode: z.enum(['standard', 'tiers']).optional(),
    address: z.string().optional(),
});

// ... (PersonalizedQuote types above)
export type InsertPersonalizedQuote = z.infer<typeof insertPersonalizedQuoteSchema>;
export type PersonalizedQuote = typeof personalizedQuotes.$inferSelect;

// B1: Invoices table - For post-job billing
export const invoices = pgTable("invoices", {
    id: varchar("id").primaryKey().notNull(),
    invoiceNumber: varchar("invoice_number", { length: 50 }).unique().notNull(), // e.g., "INV-2024-001"

    // Relationships
    quoteId: varchar("quote_id").references(() => personalizedQuotes.id),
    customerId: varchar("customer_id"), // Could link to a customers table in future
    contractorId: varchar("contractor_id").references(() => handymanProfiles.id),

    // Customer Details (denormalized for invoice stability)
    customerName: varchar("customer_name").notNull(),
    customerEmail: varchar("customer_email"),
    customerPhone: varchar("customer_phone"),
    customerAddress: text("customer_address"),
    propertyId: varchar("property_id").references(() => serviceProperties.id), // Spine property (where the work happened)
    clientId: varchar("client_id").references(() => serviceClients.id), // Spine client (who pays)

    // Financial Details (all in pence)
    totalAmount: integer("total_amount").notNull(), // Total job cost
    depositPaid: integer("deposit_paid").default(0), // Amount already paid as deposit
    balanceDue: integer("balance_due").notNull(), // Remaining amount to be paid

    // Line Items (for detailed breakdown)
    lineItems: jsonb("line_items"), // Array of {description, quantity, unitPrice, total}

    // Status Management
    status: varchar("status", { length: 20 }).notNull().default('draft'), // 'draft' | 'sent' | 'paid' | 'void' | 'overdue'

    // Dates
    dueDate: timestamp("due_date"),
    sentAt: timestamp("sent_at"),
    paidAt: timestamp("paid_at"),
    voidedAt: timestamp("voided_at"),

    // Payment Tracking
    stripePaymentIntentId: varchar("stripe_payment_intent_id"),
    paymentMethod: varchar("payment_method", { length: 50 }), // 'stripe' | 'bank_transfer' | 'cash' | 'other'

    // Documents
    pdfUrl: text("pdf_url"), // S3 link to generated PDF invoice

    // Notes
    notes: text("notes"), // Internal notes
    customerNotes: text("customer_notes"), // Notes visible to customer

    // Timestamps
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
    index("idx_invoices_quote").on(table.quoteId),
    index("idx_invoices_status").on(table.status),
    index("idx_invoices_due_date").on(table.dueDate),
]);

export type Invoice = typeof invoices.$inferSelect;
export type InsertInvoice = typeof invoices.$inferInsert;

// ==========================================
// CONTRACTOR BOOKING REQUESTS
// ==========================================

export const contractorBookingRequests = pgTable("contractor_booking_requests", {
    id: varchar("id").primaryKey().notNull(),
    contractorId: varchar("contractor_id").references(() => handymanProfiles.id).notNull(),
    customerName: varchar("customer_name").notNull(),
    customerEmail: varchar("customer_email"),
    customerPhone: varchar("customer_phone"),
    requestedDate: timestamp("requested_date"), // Specific date
    requestedSlot: varchar("requested_slot"), // "09:00 - 11:00"
    description: text("description"),
    status: varchar("status", { length: 20 }).notNull().default('pending'), // 'pending' | 'accepted' | 'declined' | 'completed'

    // B4: Job Assignment & Dispatch Fields
    quoteId: varchar("quote_id").references(() => personalizedQuotes.id), // Link to quote if job came from quote
    propertyId: varchar("property_id").references(() => serviceProperties.id), // Spine property (where the work happens)
    clientId: varchar("client_id").references(() => serviceClients.id), // Spine client (who pays)
    assignedContractorId: varchar("assigned_contractor_id").references(() => handymanProfiles.id), // Who is assigned (may differ from initial contractor)
    scheduledDate: timestamp("scheduled_date"), // When the job is scheduled
    scheduledStartTime: varchar("scheduled_start_time", { length: 10 }), // e.g., "09:00"
    scheduledEndTime: varchar("scheduled_end_time", { length: 10 }), // e.g., "11:00"
    assignedAt: timestamp("assigned_at"), // When job was assigned
    acceptedAt: timestamp("accepted_at"), // When contractor accepted
    rejectedAt: timestamp("rejected_at"), // When contractor rejected
    declineReason: varchar("decline_reason", { length: 50 }), // 'unavailable' | 'too_far' | 'schedule_conflict' | 'other'
    declineNotes: text("decline_notes"), // Free-text notes when reason is 'other'
    needsReassignment: boolean("needs_reassignment").default(false), // Flag for ops team to manually reassign
    completedAt: timestamp("completed_at"), // When job was marked complete
    assignmentStatus: varchar("assignment_status", { length: 20 }).default('unassigned'), // 'unassigned' | 'assigned' | 'accepted' | 'rejected' | 'in_progress' | 'completed'

    // Evidence/Completion
    evidenceUrls: text("evidence_urls").array(), // Photos uploaded on completion
    completionNotes: text("completion_notes"), // Notes from contractor on completion
    signatureDataUrl: text("signature_data_url"), // Customer signature as base64 PNG
    timeOnJobSeconds: integer("time_on_job_seconds"), // Tracked time in seconds

    // Financial
    invoiceId: varchar("invoice_id").references(() => invoices.id), // Link to generated invoice
    // Track A: balance-invoice reliability. Null = pre-tracking legacy rows.
    balanceInvoiceStatus: text("balance_invoice_status"), // 'pending' | 'generated' | 'skipped' | 'failed'
    balanceInvoiceAttempts: integer("balance_invoice_attempts").default(0),
    balanceInvoiceLastError: text("balance_invoice_last_error"),

    // Day-of Operations
    scheduledSlot: scheduledSlotEnum("scheduled_slot"), // AM/PM/FULL_DAY
    // Phase 24 — multi-day jobs. 1 = single-day (legacy default, backward-compatible).
    // 2+ = working days starting at scheduledDate. confirmBooking inserts ONE
    // row per job; the booking engine treats N days as one reservation.
    durationDays: integer("duration_days").notNull().default(1),
    // Phase 24e — the ACTUAL dates the span occupies (YYYY-MM-DD[]). A span is
    // the contractor's next N available days, so it can skip weekends/days off.
    // Null on legacy rows → readers fall back to consecutive-day expansion via
    // shared/schedule-composition.expandSpanDates. Always read spans through it.
    scheduledDates: jsonb("scheduled_dates").$type<string[] | null>(),
    dayOfStatus: dayOfStatusEnum("day_of_status").default('scheduled'),
    enRouteAt: timestamp("en_route_at"),
    arrivedAt: timestamp("arrived_at"),
    timerStartedAt: timestamp("timer_started_at"),
    timerPausedAt: timestamp("timer_paused_at"),
    timerAccumulatedSeconds: integer("timer_accumulated_seconds").default(0),
    mustCheckInBy: timestamp("must_check_in_by"),
    completionType: completionTypeEnum("completion_type"),
    customerDeclinedSignature: boolean("customer_declined_signature").default(false),
    customerDeclinedSignatureReason: text("customer_declined_signature_reason"),
    payoutScheduledAt: timestamp("payout_scheduled_at"),
    customerAccessNotes: text("customer_access_notes"),

    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
    index("idx_booking_requests_contractor").on(table.contractorId),
    index("idx_booking_requests_status").on(table.status),
    index("idx_booking_requests_assigned").on(table.assignedContractorId),
    index("idx_booking_requests_scheduled").on(table.scheduledDate),
    index("idx_booking_requests_quote").on(table.quoteId),
]);

export const contractorBookingRequestsRelations = relations(contractorBookingRequests, ({ one }) => ({
    contractor: one(handymanProfiles, {
        fields: [contractorBookingRequests.contractorId],
        references: [handymanProfiles.id],
    }),
}));

export const insertContractorBookingRequestSchema = createInsertSchema(contractorBookingRequests);
export type ContractorBookingRequest = typeof contractorBookingRequests.$inferSelect;// ==========================================
// EXPENSES & BOOKKEEPING
// ==========================================

export const expenses = pgTable("expenses", {
    id: varchar("id").primaryKey().notNull(),
    contractorId: varchar("contractor_id").references(() => handymanProfiles.id).notNull(),
    jobId: varchar("job_id"), // Optional: Link to a specific job
    date: timestamp("date").notNull().defaultNow(),
    description: text("description").notNull(),
    category: varchar("category", { length: 50 }).notNull(), // 'materials', 'marketing', 'travel', 'equipment', 'insurance', 'other'
    amountPence: integer("amount_pence").notNull(),
    receiptUrl: text("receipt_url"),
    createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
    index("idx_expenses_contractor").on(table.contractorId),
    index("idx_expenses_date").on(table.date),
]);

export const expensesRelations = relations(expenses, ({ one }) => ({
    contractor: one(handymanProfiles, {
        fields: [expenses.contractorId],
        references: [handymanProfiles.id],
    }),
}));

export const insertExpenseSchema = createInsertSchema(expenses);
export type Expense = typeof expenses.$inferSelect;
export type InsertExpense = z.infer<typeof insertExpenseSchema>;

// ==========================================
// QUOTE-ACCURACY: EXPENSE-CARD RECONCILIATION
// ==========================================
//
// Captures ACTUAL materials spend per job (from the Handy expense card the
// contractor sources on) so it can be compared to the materials cost QUOTED at
// build time. This is the accuracy feedback loop that lets Ben's comp eventually
// reward accuracy, not just close rate: a materials over-spend is Handy's to eat
// (its card, fixed markup), so systematic under-quoting is a real cost.
//
// One row per spend transaction (a job can have several receipts / card lines),
// linked to the quote. Quoted materials + quoter attribution are read live from
// personalized_quotes at aggregation time (no snapshot here → no double-count
// across a job's many rows). ADDITIVE / merge-safe: a brand-new table only.
export const jobMaterialExpenses = pgTable("job_material_expenses", {
    id: varchar("id").primaryKey().notNull(),
    // The quote/job this spend belongs to. Nullable so a card line can be
    // imported first and matched to a job afterwards.
    quoteId: varchar("quote_id").references(() => personalizedQuotes.id),
    // Optional link to the booking (contractorBookingRequests.id) for the job.
    bookingRequestId: varchar("booking_request_id"),
    // Who spent it (the sourcing contractor), optional.
    contractorId: varchar("contractor_id").references(() => handymanProfiles.id),

    // The ACTUAL spend on this line/transaction, in pence.
    amountPence: integer("amount_pence").notNull(),
    vendor: varchar("vendor", { length: 160 }), // e.g. "Screwfix", "Toolstation"
    description: text("description"),
    spendDate: varchar("spend_date", { length: 10 }), // YYYY-MM-DD (card txn date)

    // Provenance so we can trust/aggregate correctly.
    source: varchar("source", { length: 20 }).notNull().default('manual'), // 'manual' | 'csv' | 'card_api'
    // Card txn id / receipt ref — the dedupe key for CSV/card imports.
    externalRef: varchar("external_ref", { length: 160 }),
    receiptUrl: text("receipt_url"),

    // Who keyed/imported it (admin/VA), denormalised for a quick audit trail.
    enteredBy: varchar("entered_by"),
    enteredByName: varchar("entered_by_name", { length: 100 }),

    createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
    index("idx_jme_quote").on(table.quoteId),
    index("idx_jme_contractor").on(table.contractorId),
    index("idx_jme_spend_date").on(table.spendDate),
    // NULLs are distinct in Postgres, so many manual rows (null ref) coexist;
    // this only blocks re-importing the same card/receipt reference twice.
    uniqueIndex("uq_jme_external_ref").on(table.externalRef),
]);

export const jobMaterialExpensesRelations = relations(jobMaterialExpenses, ({ one }) => ({
    quote: one(personalizedQuotes, {
        fields: [jobMaterialExpenses.quoteId],
        references: [personalizedQuotes.id],
    }),
    contractor: one(handymanProfiles, {
        fields: [jobMaterialExpenses.contractorId],
        references: [handymanProfiles.id],
    }),
}));

export const insertJobMaterialExpenseSchema = createInsertSchema(jobMaterialExpenses);
export type JobMaterialExpense = typeof jobMaterialExpenses.$inferSelect;
export type InsertJobMaterialExpense = z.infer<typeof insertJobMaterialExpenseSchema>;

// ---------------------------------------------------------------------------
// Materials Catalog — self-building product cache for the quote materials picker
// ---------------------------------------------------------------------------
//
// When Ben types a material at quote time we search this table FIRST (fast,
// free), then fall back to a live Screwfix/supplier scrape via Apify. Every
// product picked into a quote is upserted here, so over time this becomes our
// own curated catalog of the few hundred items the business actually uses —
// no need to mirror a supplier's whole 25k-SKU range.
//
// Prices are stored in PENCE. `pricePenceExVat` is the trade cost basis used
// for quoting; `pricePenceIncVat` is what the contractor pays on the card.
export const materialsCatalog = pgTable("materials_catalog", {
    id: varchar("id").primaryKey().notNull(),
    // 'screwfix' | 'toolstation' | 'manual'. Manual rows are hand-entered items
    // with no supplier SKU (supplierItemNumber null).
    supplier: varchar("supplier", { length: 20 }).notNull().default('manual'),
    // Supplier SKU / item number, e.g. Screwfix "469JE". The re-sync key.
    supplierItemNumber: varchar("supplier_item_number", { length: 64 }),
    name: varchar("name", { length: 300 }).notNull(),
    brand: varchar("brand", { length: 160 }),
    description: text("description"),
    category: varchar("category", { length: 160 }),
    imageUrl: text("image_url"),
    supplierUrl: text("supplier_url"),
    // Trade (ex-VAT) and consumer (inc-VAT) unit prices in pence.
    pricePenceExVat: integer("price_pence_ex_vat"),
    pricePenceIncVat: integer("price_pence_inc_vat"),
    currency: varchar("currency", { length: 8 }).default('GBP'),
    // How many times picked into a quote — powers "most used" ordering in the picker.
    usageCount: integer("usage_count").notNull().default(0),
    // When the price was last confirmed against the supplier (drives staleness re-sync).
    lastPriceSyncAt: timestamp("last_price_sync_at"),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
    index("idx_materials_catalog_name").on(table.name),
    index("idx_materials_catalog_usage").on(table.usageCount),
    index("idx_materials_catalog_supplier").on(table.supplier),
    // NULLs are distinct in Postgres, so many manual rows (null SKU) coexist;
    // this only blocks caching the same supplier product twice.
    uniqueIndex("uq_materials_catalog_supplier_item").on(table.supplier, table.supplierItemNumber),
]);

export const insertMaterialsCatalogSchema = createInsertSchema(materialsCatalog);
export type MaterialsCatalogRow = typeof materialsCatalog.$inferSelect;
export type InsertMaterialsCatalog = typeof materialsCatalog.$inferInsert;

// ==========================================
// WHATSAPP CRM SCHEMA
// ==========================================

// Conversations Table - Represents a unique chat thread with a phone number
export const conversations = pgTable("conversations", {
    id: varchar("id").primaryKey().notNull(), // UUID
    phoneNumber: varchar("phone_number").unique().notNull(), // Format: "447936816338@c.us"
    contactName: varchar("contact_name"), // Display name from WhatsApp or contact
    leadId: varchar("lead_id"), // Optional: Link to leads table
    clientId: varchar("client_id").references(() => serviceClients.id, { onDelete: 'set null' }), // FK to service_clients (the account)
    // Which lane this thread belongs to (server/roles.ts). A contractor texting the business
    // number must not become a customer lead — ingest forks on this. Default 'customer'.
    roleProfile: varchar("role_profile", { length: 16 }).notNull().default('customer'),

    // Status & Metadata
    status: varchar("status", { length: 20 }).notNull().default('active'), // 'active', 'archived', 'blocked'
    unreadCount: integer("unread_count").default(0),
    lastMessageAt: timestamp("last_message_at").defaultNow(),
    lastMessagePreview: text("last_message_preview"), // Cache last message for list view

    // State Machine Fields (24h window, assignment, lifecycle)
    //
    // IMPORTANT: lastInboundAt is WhatsApp-window semantics ONLY. Only an inbound *WhatsApp*
    // message opens Meta's 24-hour freeform window — an SMS, a call or a webform submission does
    // not. Advancing this on any other channel would make the app believe it can send WhatsApp
    // freeform when Meta will reject it (error 63016). Use lastCustomerContactAt for "when did we
    // last hear from this person on any channel".
    lastInboundAt: timestamp("last_inbound_at"), // WhatsApp-only; drives the 24h window
    canSendFreeform: boolean("can_send_freeform").default(false), // Computed from lastInboundAt
    templateRequired: boolean("template_required").default(true), // True if outside 24h window
    lastCustomerContactAt: timestamp("last_customer_contact_at"), // Any channel; drives SLA/ageing
    assignedTo: varchar("assigned_to"), // User ID (VA/Contractor)
    priority: varchar("priority", { length: 10 }).default('normal'), // 'low', 'normal', 'high', 'urgent'
    stage: varchar("stage", { length: 20 }).default('new'), // 'new', 'active', 'waiting', 'closed'
    readAt: timestamp("read_at"), // When agent last read the conversation
    archivedAt: timestamp("archived_at"), // When conversation was archived

    // CRM Fields
    tags: text("tags").array(), // ['urgent', 'quote_sent']
    notes: text("notes"), // Internal notes for this conversation
    metadata: jsonb("metadata"), // Store Agentic Plans (detected tasks, urgency, etc.)

    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
    index("idx_conversations_phone").on(table.phoneNumber),
    index("idx_conversations_last_message").on(table.lastMessageAt),
    index("idx_conversations_assigned").on(table.assignedTo),
    index("idx_conversations_stage").on(table.stage),
    index("idx_conversations_client").on(table.clientId),
]);

export const conversationRelations = relations(conversations, ({ many }) => ({
    messages: many(messages),
}));

// Messages Table - Individual messages within a conversation
export const messages = pgTable("messages", {
    id: varchar("id").primaryKey().notNull(), // Ideally Twilio Message SID or UUID
    conversationId: varchar("conversation_id").references(() => conversations.id, { onDelete: 'cascade' }).notNull(),

    // Core Message Data
    direction: varchar("direction", { length: 10 }).notNull(), // 'inbound' | 'outbound'
    content: text("content"), // Text body
    type: varchar("type", { length: 20 }).default('text'), // 'text', 'image', 'video', 'audio', 'document', 'template'

    // Which pipe this travelled down. Everything before Aug 2026 was WhatsApp, hence the default.
    // Drives thread rendering and, critically, whether an inbound opens the WhatsApp 24h window.
    channel: varchar("channel", { length: 16 }).default('whatsapp').notNull(), // whatsapp|sms|call|webform|email|note

    // Media Support
    mediaUrl: text("media_url"), // URL to stored media
    mediaType: varchar("media_type"), // MIME type

    // Status Tracking
    status: varchar("status", { length: 20 }).default('sent'), // 'queued', 'sent', 'delivered', 'read', 'failed'
    errorCode: varchar("error_code"),
    errorMessage: text("error_message"),

    // Metadata
    senderName: varchar("sender_name"), // Display name of sender (e.g., 'John Doe' or 'System')
    twilioSid: varchar("twilio_sid").unique(), // Store external ID

    // QUARANTINE — "this row is on the record, but it never reached the customer."
    //
    // 58,216 outbound rows written between 18 Feb and 14 Aug 2026 were never delivered: the Feb-Mar
    // runaway loop, then months of automation firing through a sender that could not send. Left as
    // ordinary outbound they make computeWaitState read those threads as ANSWERED, which hides real
    // customers from the board. Deleting them is not an option — customer comms are a business
    // record — so they are MARKED instead, and every "did we reply?" read skips a marked row while
    // every "what happened here?" read still shows it.
    //
    // Set only by scripts/migrate-quarantine-phantom-messages.ts, which is date-bounded to that
    // historical window. Nothing at runtime writes these, and no runtime rule infers quarantine from
    // a missing twilio_sid — a Meta Cloud API send legitimately has none.
    quarantinedAt: timestamp("quarantined_at"),
    quarantineReason: varchar("quarantine_reason", { length: 40 }), // runaway_loop|dead_sender|tenant_sandbox

    createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
    index("idx_messages_conversation").on(table.conversationId),
    index("idx_messages_created").on(table.createdAt),
]);

export const messageRelations = relations(messages, ({ one }) => ({
    conversation: one(conversations, {
        fields: [messages.conversationId],
        references: [conversations.id],
    }),
}));

export const insertConversationSchema = createInsertSchema(conversations);
export type Conversation = typeof conversations.$inferSelect;
export type InsertConversation = z.infer<typeof insertConversationSchema>;

export const insertMessageSchema = createInsertSchema(messages);
export type Message = typeof messages.$inferSelect;
export type InsertMessage = z.infer<typeof insertMessageSchema>;

// Quick Replies - canned messages Ben can drop into a conversation.
//
// A reply with a contentSid is backed by a Twilio-approved WhatsApp template, so it can also be
// sent OUTSIDE the 24-hour window. Replies without one are freeform and only sendable while the
// window is open. The inbox uses this distinction to decide what to offer.
export const quickReplies = pgTable("quick_replies", {
    id: varchar("id").primaryKey().notNull(),
    label: varchar("label", { length: 80 }).notNull(), // Shown in the picker, e.g. "Ask for a video"
    body: text("body").notNull(), // Message text; may contain {{name}} / {{first_name}} placeholders
    category: varchar("category", { length: 30 }).default('general'), // Grouping in the picker

    // Template backing (optional) — presence means "sendable outside the 24h window"
    contentSid: varchar("content_sid"), // Twilio Content Template SID (HX...)
    contentVariables: jsonb("content_variables"), // Positional var map, e.g. {"1": "{{name}}"}

    shortcut: varchar("shortcut", { length: 24 }), // Type-to-filter token, e.g. "/video"
    sortOrder: integer("sort_order").default(0),
    isActive: boolean("is_active").default(true),

    // Usage telemetry — surfaces which replies actually earn their place
    usageCount: integer("usage_count").default(0),
    lastUsedAt: timestamp("last_used_at"),

    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
    index("idx_quick_replies_active").on(table.isActive, table.sortOrder),
    index("idx_quick_replies_category").on(table.category),
]);

export const insertQuickReplySchema = createInsertSchema(quickReplies);
export type QuickReply = typeof quickReplies.$inferSelect;
export type InsertQuickReply = z.infer<typeof insertQuickReplySchema>;

// Local cache of every WhatsApp template on the Twilio account, with its Meta approval status.
//
// Twilio has NO push webhook for template approval — the only way to learn that Meta approved a
// template is to ask. server/whatsapp-template-sync.ts polls hourly and writes here, so the app
// (composer picker, quote send path, staff page) can answer "what can we send right now?" from
// the DB instead of a live API call on every render.
export const whatsappTemplates = pgTable("whatsapp_templates", {
    contentSid: varchar("content_sid").primaryKey().notNull(),  // Twilio Content SID (HX...)
    name: varchar("name", { length: 160 }).notNull(),           // friendly_name, e.g. quote_ready_link
    status: varchar("status", { length: 24 }).notNull(),        // approved | pending | received | rejected | unsubmitted
    category: varchar("category", { length: 24 }),              // UTILITY | MARKETING | AUTHENTICATION
    language: varchar("language", { length: 12 }),
    body: text("body"),                                         // template text with {{1}} placeholders
    variables: jsonb("variables"),                              // Twilio's sample map, e.g. {"1":"Courtnee"}
    rejectionReason: text("rejection_reason"),

    firstSeenAt: timestamp("first_seen_at").defaultNow(),
    lastCheckedAt: timestamp("last_checked_at").defaultNow(),
    statusChangedAt: timestamp("status_changed_at"),            // when the CACHED status last moved
    approvedAt: timestamp("approved_at"),                       // first time we observed 'approved'
}, (table) => [
    index("idx_whatsapp_templates_status").on(table.status),
]);

// Status history — one row per observed transition. Kept because "when did this go live?" and
// "what did Meta say when it bounced?" are questions asked days later, and the current-status
// row alone cannot answer either.
export const whatsappTemplateEvents = pgTable("whatsapp_template_events", {
    id: varchar("id").primaryKey().notNull(),
    contentSid: varchar("content_sid").notNull(),
    name: varchar("name", { length: 160 }),
    fromStatus: varchar("from_status", { length: 24 }),         // null on first sight
    toStatus: varchar("to_status", { length: 24 }).notNull(),
    reason: text("reason"),                                     // Meta's rejection reason, when given
    notified: boolean("notified").default(false),               // did a Pushover alert go out for it
    createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
    index("idx_whatsapp_template_events_sid").on(table.contentSid, table.createdAt),
]);

export type WhatsappTemplate = typeof whatsappTemplates.$inferSelect;
export type WhatsappTemplateEvent = typeof whatsappTemplateEvents.$inferSelect;

// Outbound drafts awaiting human approval.
//
// Every message the SYSTEM originates lands here first; nothing reaches a customer until someone
// approves it. Ben's own typed replies bypass this entirely — approval is for machine-authored
// messages, not for a person talking to a customer.
//
// This exists because automated outreach has gone wrong here before: invoice dunning chased a
// customer over an invoice that was never sent, and had to be switched off entirely. A draft queue
// keeps the leverage of automation without handing it the send button.
// Questions the comms agent asks Ben when it cannot safely draft a reply itself — e.g. the
// customer wants a date we may not do, or is asking about money not covered by a quote. Ben's
// tapped answer is consumed by the agent's next run, which then produces the draft. A question
// is the agent's ONLY alternative to drafting: it never guesses and it never goes silent.
export const agentQuestions = pgTable("agent_questions", {
    id: varchar("id").primaryKey().notNull(),
    conversationId: varchar("conversation_id").notNull(),
    phone: varchar("phone").notNull(),                    // E.164, denormalised for the queue view
    question: text("question").notNull(),                 // what the agent needs to know
    context: text("context"),                             // why it's asking (shown under the question)
    options: jsonb("options"),                            // string[] of tappable answers; freetext always allowed
    answer: text("answer"),
    answeredBy: varchar("answered_by"),
    answeredAt: timestamp("answered_at"),
    // open → answered (Ben replied, agent hasn't consumed it) → resolved (agent drafted from it).
    // 'dismissed' = Ben decided no answer is needed (e.g. he'll reply himself).
    status: varchar("status", { length: 16 }).default('open').notNull(),
    source: varchar("source", { length: 40 }).default('comms_agent').notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    // Phase 1 (2 Sep 2026): a flag carries a clock. 4 office hours (20 min if urgent /
    // callback_requested); when it passes unanswered the rules layer sends the holding line and
    // stamps expiredAt. Migration 20260902_due_at_holding_line.sql.
    dueAt: timestamp("due_at", { withTimezone: true }),
    expiredAt: timestamp("expired_at", { withTimezone: true }),
    // Phase 1 (2 Sep 2026): the agent run that raised the flag / question.
    runId: text("run_id"),
}, (table) => [
    index("idx_agent_questions_status").on(table.status, table.createdAt),
    index("idx_agent_questions_conversation").on(table.conversationId),
]);

export const messageDrafts = pgTable("message_drafts", {
    id: varchar("id").primaryKey().notNull(),
    conversationId: varchar("conversation_id"),          // null if no conversation exists yet
    phone: varchar("phone").notNull(),                    // E.164 recipient

    // What would be sent
    body: text("body").notNull(),                         // rendered text (or the template's preview)
    channel: varchar("channel", { length: 16 }).default('whatsapp').notNull(),
    contentSid: varchar("content_sid"),                   // Twilio template, when outside the 24h window
    contentVariables: jsonb("content_variables"),

    // Why it was drafted — shown to the approver, and the audit trail afterwards
    source: varchar("source", { length: 40 }).notNull(),  // webform_ack | post_call_video | recovery | manual
    reason: text("reason"),                                // human-readable rationale

    status: varchar("status", { length: 20 }).default('pending').notNull(), // pending|approved|sent|rejected|failed
    createdAt: timestamp("created_at").defaultNow().notNull(),
    approvedAt: timestamp("approved_at"),
    approvedBy: varchar("approved_by"),
    sentAt: timestamp("sent_at"),
    sentMessageId: varchar("sent_message_id"),
    error: text("error"),
    // Phase 1 (2 Sep 2026): a pending draft carries a clock (4 office hours from queue time). Past
    // it, the rules layer sends the holding line and marks heldReason 'due_expired'; the draft
    // stays pending for Ben. Migration 20260902_due_at_holding_line.sql.
    dueAt: timestamp("due_at", { withTimezone: true }),
    heldReason: text("held_reason"),                      // 'due_expired' | 'stale_by_inbound' (P7)
    // Phase 1 (2 Sep 2026): the agent run (or sweep / draft release) that produced this row.
    runId: text("run_id"),
    // P7 (4 Sep 2026): the inbound message this draft was written against. approveAndSendDraft
    // refuses to send when a newer inbound exists (held_reason 'stale_by_inbound'); a new inbound
    // rejects older agent drafts outright. Migration 20260904_message_drafts_based_on_inbound.sql.
    basedOnInboundId: text("based_on_inbound_id"),
    // Phase 1 (2 Sep 2026): the body as first drafted. Set by the first PATCH on a pending draft
    // and never changed after, so approval can tell "edit" from "approve" (draft_verdicts).
    // Null = never edited. Migration 20260902_draft_verdicts.sql.
    originalBody: text("original_body"),
}, (table) => [
    index("idx_message_drafts_status").on(table.status, table.createdAt),
    index("idx_message_drafts_phone").on(table.phone),
    index("idx_message_drafts_run").on(table.runId),
]);

export const insertMessageDraftSchema = createInsertSchema(messageDrafts);

/**
 * Ben's verdicts on machine-drafted messages (Phase 1, 2 Sep 2026; COMMS_AGENTS_V3_DESIGN §4, §8).
 *
 * One row per human decision: 'approve' (sent as drafted), 'edit' (wording changed, then sent),
 * 'reject' (never sent) — each with a reason code. This is the evidence stream that promotes an
 * intent to SEND (≥ 30 verdicts across the pack in 30 days, unedited-approval ≥ 90%, zero 'unsafe')
 * and demotes it. Phase 3's 10% morning sample review reuses the table as 'sample_fine' /
 * 'sample_not_fine'. Automated approvals (agent.* / rules.* / system.*) are NOT verdicts and never
 * land here. Migration 20260902_draft_verdicts.sql.
 */
export const DRAFT_VERDICTS = ['approve', 'edit', 'reject', 'sample_fine', 'sample_not_fine'] as const;
export type DraftVerdict = (typeof DRAFT_VERDICTS)[number];
export const VERDICT_REASONS = ['fine', 'tone', 'wrong_move', 'unsafe', 'missing_info'] as const;
export type VerdictReason = (typeof VERDICT_REASONS)[number];

export const draftVerdicts = pgTable("draft_verdicts", {
    id: uuid("id").primaryKey().defaultRandom(),
    draftId: varchar("draft_id").notNull(),               // message_drafts.id (varchar, not uuid)
    runId: text("run_id"),                                 // agent_runs.id when the draft came from a run
    verdict: text("verdict").notNull(),                    // DraftVerdict
    reason: text("reason"),                                // VerdictReason; null only for legacy/system rows
    originalBody: text("original_body").notNull(),         // what the machine wrote
    finalBody: text("final_body"),                         // what went out (null on reject)
    by: text("by").notNull(),                              // human:<id> — always a person
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
    index("idx_draft_verdicts_created_at").on(table.createdAt),
    index("idx_draft_verdicts_draft_id").on(table.draftId),
    check("draft_verdicts_verdict_check", sql`${table.verdict} IN ('approve', 'edit', 'reject', 'sample_fine', 'sample_not_fine')`),
    check("draft_verdicts_reason_check", sql`${table.reason} IS NULL OR ${table.reason} IN ('fine', 'tone', 'wrong_move', 'unsafe', 'missing_info')`),
]);
export type DraftVerdictRow = typeof draftVerdicts.$inferSelect;

/**
 * P8 / B (4 Sep 2026): one row per quote line Ben confirmed on /admin/price/<slug>. The chain
 * suggests, Ben's tap decides; this is the record of the decision the Route B graduation trigger
 * (design §6) is computed from. `by` is always human:<id> — the CHECK enforces the money rule.
 * Migration: migrations/20260904_quote_price_verdicts.sql.
 */
export const quotePriceVerdicts = pgTable("quote_price_verdicts", {
    id: uuid("id").primaryKey().defaultRandom(),
    slug: varchar("slug", { length: 8 }).notNull(),           // personalized_quotes.short_slug
    quoteId: varchar("quote_id").notNull(),                   // personalized_quotes.id
    lineId: text("line_id").notNull(),                        // pricing_line_items[].lineId
    category: text("category"),                               // line category at confirm time
    suggestedPence: integer("suggested_pence"),               // null when the chain had nothing
    bandLowPence: integer("band_low_pence"),
    bandHighPence: integer("band_high_pence"),
    finalPence: integer("final_pence").notNull(),             // what Ben sent
    inBand: boolean("in_band").notNull().default(false),
    edited: boolean("edited").notNull().default(false),
    checkThis: boolean("check_this").notNull().default(false),
    by: text("by").notNull(),                                 // human:<id>
    at: timestamp("at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
    index("idx_quote_price_verdicts_at").on(table.at),
    index("idx_quote_price_verdicts_slug").on(table.slug),
    index("idx_quote_price_verdicts_category_at").on(table.category, table.at),
    check("quote_price_verdicts_final_check", sql`${table.finalPence} > 0`),
    check("quote_price_verdicts_by_check", sql`${table.by} LIKE 'human:%'`),
]);
export type QuotePriceVerdictRow = typeof quotePriceVerdicts.$inferSelect;
export type MessageDraft = typeof messageDrafts.$inferSelect;
export type InsertMessageDraft = z.infer<typeof insertMessageDraftSchema>;

/**
 * The comms event ledger (COMMS_ARCHITECTURE verdict, 23 Aug 2026).
 *
 * One append-only row per communication event — message, call, draft lifecycle — across every
 * audience (customer, contractor, supplier). The source tables (messages, calls, message_drafts)
 * stay authoritative for their own machinery; this table exists to answer the four questions the
 * sources cannot answer alone: response times, outcome-per-job, audit-grade who-said-what, and
 * agent-vs-human attribution (drafted/edited/sent are three different hands on one message).
 *
 * Populated by server/comms-ledger.ts syncing FROM the source tables — deliberately not by hooks
 * at the nine insert sites, which would drift. (ref_table, ref_id, event_type) is unique, so the
 * sync is idempotent and re-runnable from zero.
 */
export const commsEvents = pgTable("comms_events", {
    id: varchar("id").primaryKey().notNull(),
    occurredAt: timestamp("occurred_at").notNull(),
    // message_in|message_out|call_in|call_out|draft_created|draft_approved|draft_edited|draft_sent|draft_rejected|draft_failed|
    // flag_raised|flag_closed|flag_expired|run_started|run_finished|sample_reviewed  (server/ledger.ts LEDGER_EVENT_TYPES)
    eventType: varchar("event_type", { length: 24 }).notNull(),
    channel: varchar("channel", { length: 16 }).notNull(),      // whatsapp|sms|call|webform|email|note|system
    phone: varchar("phone").notNull(),                           // E.164 — number-first threading
    // One person, two roles, one number: threading is (phone, role_profile), not phone alone.
    roleProfile: varchar("role_profile", { length: 16 }).notNull().default('customer'), // customer|contractor|supplier|internal|unknown
    conversationId: varchar("conversation_id"),
    jobRef: varchar("job_ref"),                                  // quote/job id once the relay lands; outcomes join through this
    // Who caused the event. 'counterparty' = the person on the other end of the wire.
    actor: varchar("actor", { length: 60 }).notNull(),           // counterparty | agent:comms | human:<who> | system:<name>
    draftedBy: varchar("drafted_by", { length: 60 }),
    editedBy: varchar("edited_by", { length: 60 }),
    sentBy: varchar("sent_by", { length: 60 }),
    body: text("body"),
    refTable: varchar("ref_table", { length: 32 }).notNull(),
    refId: varchar("ref_id").notNull(),
    meta: jsonb("meta"),
    // Phase 1 (2 Sep 2026): the run this event belongs to, written at source.
    runId: text("run_id"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
    uniqueIndex("uq_comms_events_ref").on(table.refTable, table.refId, table.eventType),
    index("idx_comms_events_phone_time").on(table.phone, table.occurredAt),
    index("idx_comms_events_type_time").on(table.eventType, table.occurredAt),
    index("idx_comms_events_run").on(table.runId),
]);

/**
 * One row per agent run (Phase 1, COMMS_AGENTS_V3_DESIGN §3.7). Written by server/agents/runner.ts
 * through server/agent-runs.ts: created at start, completed at finish. Every draft, flag and nudge
 * an agent produces carries this id in its own run_id column, and every ledger event does too —
 * so "what did it do and why" is one join, and the replay corpus for evals is this table.
 */
export const agentRuns = pgTable("agent_runs", {
    id: text("id").primaryKey().notNull(),
    agent: text("agent").notNull(),                 // comms | quote-prep | recovery | ops-manager | …
    packId: text("pack_id"),                        // policy pack (Phase 2)
    packVersion: integer("pack_version"),
    trigger: text("trigger"),                       // inbound_message | sla_sweep | ops_manager | manual | …
    conversationId: varchar("conversation_id"),     // conversations.id (varchar, not uuid)
    caseFileRef: text("case_file_ref"),
    model: text("model"),
    modelSnapshot: text("model_snapshot"),
    promptHash: text("prompt_hash"),
    decision: text("decision"),                     // Phase 2: SEND | PENDING | FLAG
    shadowDecision: text("shadow_decision"),        // Phase 3: what the spine WOULD have done in shadow mode (migration 20260903)
    parentRunId: text("parent_run_id"),             // P6: the spine run this child row (triage model, vision, wrapped legacy runner) belongs to (migration 20260904)
    lane: text("lane"),
    proposal: jsonb("proposal"),
    guardsHit: text("guards_hit").array().notNull().default(sql`'{}'::text[]`),
    usage: jsonb("usage"),                          // { inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens }
    costPence: integer("cost_pence"),
    durationMs: integer("duration_ms"),
    transcriptRef: text("transcript_ref"),
    error: text("error"),
    startedAt: timestamp("started_at", { withTimezone: true }).defaultNow().notNull(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
}, (table) => [
    index("idx_agent_runs_conversation_started").on(table.conversationId, table.startedAt),
    index("idx_agent_runs_agent_started").on(table.agent, table.startedAt),
]);

/**
 * Phase 3 (3 Sep 2026): earned autonomy. The current tier per (pack, intent), overlaid on the
 * static launch defaults in server/spine/packs/*.ts by resolvePack. Written only by the
 * promotion/demotion job (server/spine/autonomy.ts) or a person. Never SEND for an intent the
 * pack does not allow; money and dates are not intents at all.
 */
export const packIntentTiers = pgTable("pack_intent_tiers", {
    packId: text("pack_id").notNull(),
    intent: text("intent").notNull(),
    tier: text("tier").notNull(),                   // READ | PROPOSE | DRAFT | SEND
    reason: text("reason"),
    changedBy: text("changed_by"),                  // system:autonomy | human:<id>
    changedAt: timestamp("changed_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
    primaryKey({ columns: [table.packId, table.intent] }),
]);

/** Append-only: every promotion / demotion with the evidence that decided it. */
export const packTierEvents = pgTable("pack_tier_events", {
    id: text("id").primaryKey().notNull(),
    packId: text("pack_id").notNull(),
    intent: text("intent").notNull(),
    fromTier: text("from_tier"),
    toTier: text("to_tier").notNull(),
    reason: text("reason"),
    evidence: jsonb("evidence"),
    by: text("by").notNull(),
    at: timestamp("at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
    index("idx_pack_tier_events_pack_at").on(table.packId, table.intent, table.at),
]);

export type CommsEvent = typeof commsEvents.$inferSelect;
export type InsertCommsEvent = typeof commsEvents.$inferInsert;

/**
 * Every decision the first-contact auto-responder makes, sent OR refused.
 *
 * Until this table existed the only trace of the feature working was a message_drafts row, which
 * by definition only exists when something was composed. Every refusal — disabled, mid-thread,
 * out of area, spam, no template — was a console line on a server nobody tails, so the one
 * question an operator actually asks ("this enquiry got no reply, why?") had no answer. That is
 * the whole reason the feature could never responsibly be switched on.
 *
 * Written fire-and-forget on every outcome: an insert here must never be able to stop, slow or
 * break a send. Deliberately denormalised (phone, name and body are copied in) so a row still
 * explains itself after the conversation is archived or the draft is purged.
 */
export const firstContactAckLog = pgTable("first_contact_ack_log", {
    id: varchar("id").primaryKey().notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),

    // Who, and on which surface it arrived
    conversationId: varchar("conversation_id"),
    phone: varchar("phone").notNull(),
    contactName: varchar("contact_name"),
    channel: varchar("channel", { length: 16 }).notNull(),   // whatsapp | sms | webform | post_call

    // What we decided
    intent: varchar("intent", { length: 24 }),               // ack_enquiry | ack_photos | ack_missed_call | ack_returning
    contactClass: varchar("contact_class", { length: 12 }),  // first | returning | ongoing
    sent: boolean("sent").default(false).notNull(),
    /** SENT | DISABLED | NOT_FIRST_CONTACT | OUT_OF_AREA | LOOKS_LIKE_SPAM | QUEUED_NO_TEMPLATE |
     *  DUPLICATE_DRAFT | SEND_REFUSED:<code> | ERROR | CHANNEL_NOT_ENABLED | NO_PHONE */
    reason: varchar("reason", { length: 48 }).notNull(),
    /** Which rule refused, when one did (the spam pattern's name, the dialling prefix, …). */
    detail: text("detail"),

    // What actually went out, when anything did
    mode: varchar("mode", { length: 16 }),                   // freeform | template | sms
    templateName: varchar("template_name"),
    outOfHours: boolean("out_of_hours"),
    body: text("body"),
    draftId: varchar("draft_id"),
}, (table) => [
    index("idx_fca_log_created").on(table.createdAt),
    index("idx_fca_log_phone").on(table.phone),
]);

export type FirstContactAckLogRow = typeof firstContactAckLog.$inferSelect;

/**
 * THE OUTCOME LEDGER — every agent proposal, what the human did with it, and what happened next.
 *
 * The trust ladder in this system says autonomy is EARNED per capability, measured by how often a
 * human approves a draft unedited. Until this table existed that number could not be computed at
 * all: `message_drafts.body` is EDITED IN PLACE by PATCH /api/drafts/:id, so by the time anyone
 * approved a draft the agent's original wording was gone. An approval and an approval-after-a-
 * rewrite were the same row. That is the one distinction the whole gating decision rests on.
 *
 * So the proposal is copied HERE at the moment it is written, immutably, and the verdict is
 * recorded against it later. The diff between `proposed_body` and `final_body` is the training
 * signal — what Ben changed says more than any satisfaction score.
 *
 * SHAPE — one row per proposal, keyed by (kind, ref_id) so a hook can never double-write. Rows are
 * denormalised on purpose (phone, body, capability are copied in) so a row still explains itself
 * after the draft is purged or the conversation archived.
 *
 * WRITES ARE FIRE-AND-FORGET. Every call site wraps this in its own try/catch: the ledger must
 * never be able to stop, slow or break a send. A missing row is a gap in a report; a thrown error
 * would be a customer who never got their reply.
 *
 * VERDICT is deliberately fine-grained, because the cheap version of this metric lies:
 *   approved_unedited  a human approved the agent's words verbatim   ← THE trust-ladder number
 *   approved_edited    a human approved after changing the text      (edit_distance is the signal)
 *   approved_unknown   backfilled: approved, but the pre-edit text was never captured
 *   rejected           a human declined it
 *   auto_sent          the machine approved itself (whitelist/first-contact). NOT a human signal
 *   superseded         the agent replaced its own draft in the same run. Not a judgement either
 *   blocked            the system refused at send time (opt-out). Not a judgement
 *   expired            nobody acted for long enough that it stopped being actionable
 *   answered/dismissed the ask-Ben equivalents of approved/rejected, for kind='question'
 *
 * `send_status` is kept separate from `verdict` for the same reason: a human approving wording that
 * later failed to send is still a vote of confidence in the wording. Trust metrics read `verdict`;
 * reply and conversion metrics read `send_status = 'sent'`.
 */
export const agentOutcomes = pgTable("agent_outcomes", {
    id: varchar("id").primaryKey().notNull(),

    // WHO PROPOSED IT
    agent: varchar("agent", { length: 32 }).notNull(),        // comms | recovery | quote_prep | system
    /** The unit autonomy is granted in: a draft intent, a nudge lever, 'question'. */
    capability: varchar("capability", { length: 40 }).notNull(),
    kind: varchar("kind", { length: 16 }).notNull(),          // draft | question | nudge
    source: varchar("source", { length: 40 }),                // message_drafts.source, when it came from one

    // WHAT IT WAS ABOUT
    /** message_drafts.id / agent_questions.id / nudge_queue.id — unique with `kind`. */
    refId: varchar("ref_id").notNull(),
    conversationId: varchar("conversation_id"),
    phone: varchar("phone"),
    /** commsPhoneKey() — THE identity key. Raw phone strings do not join across these tables. */
    phoneKey: varchar("phone_key", { length: 20 }),
    quoteSlug: varchar("quote_slug", { length: 24 }),

    // THE PROPOSAL, frozen at the moment it was made
    proposedBody: text("proposed_body").notNull(),
    reason: text("reason"),
    proposedAt: timestamp("proposed_at").defaultNow().notNull(),

    // THE HUMAN VERDICT
    verdict: varchar("verdict", { length: 24 }).default('pending').notNull(),
    decidedBy: varchar("decided_by"),
    decidedAt: timestamp("decided_at"),
    /** Seconds from proposal to a human acting on it — the queue's real latency. */
    timeToActionSeconds: integer("time_to_action_seconds"),

    // WHAT HE CHANGED — the valuable part
    /** The text as actually sent (or the answer he typed), when it differs from the proposal. */
    finalBody: text("final_body"),
    editDistance: integer("edit_distance"),                   // Levenshtein, trimmed both sides
    /** distance / longer length. 0 = verbatim, 1 = rewritten from scratch. */
    editRatio: doublePrecision("edit_ratio"),

    // DELIVERY
    sendStatus: varchar("send_status", { length: 16 }),       // sent | failed | null (never attempted)
    sentAt: timestamp("sent_at"),
    sentMessageId: varchar("sent_message_id"),

    // WHAT THE CUSTOMER DID NEXT
    customerRepliedAt: timestamp("customer_replied_at"),
    replyLatencySeconds: integer("reply_latency_seconds"),
    /** Deposit paid on any quote for this number after the send — the loop actually closing. */
    convertedQuoteId: varchar("converted_quote_id"),
    convertedAt: timestamp("converted_at"),
    conversionValuePence: integer("conversion_value_pence"),
    /** Last time the downstream columns above were recomputed. */
    outcomeCheckedAt: timestamp("outcome_checked_at"),

    /** Room for per-kind extras (option lists, whether Ben tapped an offered answer, backfill notes). */
    meta: jsonb("meta"),
    /** True when the row was reconstructed from history rather than captured live. */
    backfilled: boolean("backfilled").default(false).notNull(),

    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
    uniqueIndex("idx_agent_outcomes_ref").on(table.kind, table.refId),
    index("idx_agent_outcomes_agent").on(table.agent, table.capability, table.proposedAt),
    index("idx_agent_outcomes_verdict").on(table.verdict, table.proposedAt),
    index("idx_agent_outcomes_phone_key").on(table.phoneKey),
]);

export type AgentOutcome = typeof agentOutcomes.$inferSelect;

/**
 * THE SUPPRESSION LIST. Every "stop messaging me" this business has ever been told.
 *
 * The approved WhatsApp templates say "Reply STOP to opt out". Until this table existed nothing in
 * the codebase listened, so that sentence was a promise with no machinery behind it. Under UK PECR
 * an opt-out mechanism has to actually work, and advertising one that does not is worse than not
 * offering one at all: it converts a compliant contact into a documented breach.
 *
 * SHAPE — append-only log, not a mutable flag. Each row is one thing a person said, with the words
 * that triggered it kept verbatim. If a regulator or a customer ever asks "when did I opt out and
 * what did I say?", the answer is a row, not a reconstruction. Escalations (a plain STOP later
 * followed by "do not contact me") are two rows and the strongest one wins; `revoked_at` is how an
 * opt-out is lifted, so even un-suppressing leaves a trace.
 *
 * KEYED ON `phone_key` — the normalised identity from commsPhoneKey(), NOT the raw string. The same
 * human appears as "+44 7938 658185", "07938 658185" and "447938658185@c.us" across this database,
 * and suppression that only holds for the format the STOP arrived in is not suppression.
 *
 * SCOPE is the judgement call this table exists to encode:
 *
 *   'marketing'  A plain STOP. Blocks campaigns, bulk outreach, revival, promotional templates —
 *                everything we chose to start. It deliberately does NOT block a service reply: a
 *                customer mid-job who texts STOP after a marketing blast still deserves an answer
 *                to their own question and their booking confirmation. Silencing those would be
 *                using compliance as an excuse to abandon a live obligation, and PECR governs
 *                direct marketing, not the performance of a contract.
 *   'all'        An explicit "do not contact me" / "stop all" / "delete my number" / "leave me
 *                alone". This person has asked to be left alone entirely, so nothing automated
 *                reaches them, service replies included. Only a human can decide to break that,
 *                and they have to do it outside this system.
 *
 * The default for an ambiguous-but-clear opt-out is 'marketing', because that is what the advertised
 * keyword actually promises ("reply STOP to opt out" sits under a marketing message) and because
 * over-suppressing a live customer causes its own harm.
 */
export const commsOptOuts = pgTable("comms_opt_outs", {
    id: varchar("id").primaryKey().notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),

    /** Normalised identity from commsPhoneKey(). UK numbers are the 10-digit national form. */
    phoneKey: varchar("phone_key").notNull(),
    /** Best-effort E.164 for humans reading the row. Never the lookup key. */
    e164: varchar("e164"),

    /** 'marketing' | 'all' — see the note above. */
    scope: varchar("scope", { length: 12 }).notNull().default('marketing'),
    /** 'inbound_keyword' | 'backfill' | 'manual' */
    source: varchar("source", { length: 24 }).notNull(),
    /** Which pipe carried the opt-out: whatsapp | sms | call | webform | email | note */
    channel: varchar("channel", { length: 16 }),

    conversationId: varchar("conversation_id"),
    /** The inbound message that triggered it. Unique when present, so a backfill is idempotent. */
    messageId: varchar("message_id"),
    contactName: varchar("contact_name"),

    /** Which keyword fired, and whether it was a whole-message match or a phrase inside a short one. */
    matchedKeyword: varchar("matched_keyword"),
    matchRule: varchar("match_rule", { length: 12 }),
    /** The customer's words, verbatim. The evidence. */
    triggerText: text("trigger_text"),

    /** Set when someone opts back in. A live suppression is one with revoked_at IS NULL. */
    revokedAt: timestamp("revoked_at"),
    revokedBy: varchar("revoked_by"),
    note: text("note"),
}, (table) => [
    index("idx_comms_opt_outs_key").on(table.phoneKey),
    index("idx_comms_opt_outs_created").on(table.createdAt),
]);

export type CommsOptOut = typeof commsOptOuts.$inferSelect;

// ==========================================
// LANDING PAGE & BANNER OPTIMIZATION
// ==========================================

export const landingPages = pgTable("landing_pages", {
    id: serial("id").primaryKey(),
    slug: text("slug").notNull().unique(),
    name: text("name").notNull(), // Internal name
    isActive: boolean("is_active").default(true).notNull(),
    optimizationMode: text("optimization_mode", { enum: ["manual", "auto"] }).default("manual").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
    index("idx_landing_pages_slug").on(table.slug),
]);

export const landingPageVariants = pgTable("landing_page_variants", {
    id: serial("id").primaryKey(),
    landingPageId: integer("landing_page_id").references(() => landingPages.id, { onDelete: 'cascade' }).notNull(),
    name: text("name").notNull(), // e.g., "Variant A", "Control"
    weight: integer("weight").default(50).notNull(), // 0-100 probability
    content: jsonb("content").notNull(), // { heroHeadline, heroSubhead, ctaText, heroImage, ... }

    // Quick Stats (synced from PostHog or local tracking)
    viewCount: integer("view_count").default(0).notNull(),
    conversionCount: integer("conversion_count").default(0).notNull(),

    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
    index("idx_landing_page_variants_page").on(table.landingPageId),
]);

export const banners = pgTable("banners", {
    id: serial("id").primaryKey(),
    content: text("content").notNull(), // HTML or Text
    linkUrl: text("link_url"),
    location: text("location").default('top-bar').notNull(),
    isActive: boolean("is_active").default(true).notNull(),
    startDate: timestamp("start_date"),
    endDate: timestamp("end_date"),

    viewCount: integer("view_count").default(0).notNull(),
    clickCount: integer("click_count").default(0).notNull(),

    createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Relations
export const landingPageRelations = relations(landingPages, ({ many }) => ({
    variants: many(landingPageVariants),
}));

export const landingPageVariantRelations = relations(landingPageVariants, ({ one }) => ({
    landingPage: one(landingPages, {
        fields: [landingPageVariants.landingPageId],
        references: [landingPages.id],
    }),
}));

// Schemas
export const landingPageContentSchema = z.object({
    heroHeadline: z.string().optional(),
    heroSubhead: z.string().optional(),
    ctaText: z.string().optional(),
    mobileCtaText: z.string().optional(),
    desktopCtaText: z.string().optional(),
    bannerText: z.string().optional(),
    heroImage: z.string().optional(),
});

export const insertLandingPageSchema = createInsertSchema(landingPages);
export const insertLandingPageVariantSchema = createInsertSchema(landingPageVariants);
export const insertBannerSchema = createInsertSchema(banners);

export type LandingPage = typeof landingPages.$inferSelect;
export type InsertLandingPage = typeof insertLandingPageSchema.$inferInsert;
export type LandingPageVariant = typeof landingPageVariants.$inferSelect;
export type InsertLandingPageVariant = typeof insertLandingPageVariantSchema.$inferInsert;
export type Banner = typeof banners.$inferSelect;
export type InsertBanner = typeof insertBannerSchema.$inferInsert;

// ==========================================
// FREEMIUM PRODUCT - CONTRACTOR APP
// ==========================================

// Partner Applications - Track 5-step accreditation process
export const partnerApplications = pgTable("partner_applications", {
    id: varchar("id").primaryKey().notNull(),
    contractorId: varchar("contractor_id").references(() => handymanProfiles.id).notNull(),
    status: varchar("status", { length: 30 }).default("not_started").notNull(),

    // Step 1: Insurance Verification
    insuranceStatus: varchar("insurance_status", { length: 20 }).default("pending"),
    insuranceDocumentUrl: text("insurance_document_url"),
    insurancePolicyNumber: varchar("insurance_policy_number", { length: 100 }),
    insuranceExpiryDate: timestamp("insurance_expiry_date"),
    insuranceVerifiedAt: timestamp("insurance_verified_at"),

    // Step 2: Identity & Background
    identityStatus: varchar("identity_status", { length: 20 }).default("pending"),
    identityDocumentUrl: text("identity_document_url"),
    dbsCertificateUrl: text("dbs_certificate_url"),
    identityVerifiedAt: timestamp("identity_verified_at"),

    // Step 3: Client References
    referencesStatus: varchar("references_status", { length: 20 }).default("pending"),
    referencesVerifiedAt: timestamp("references_verified_at"),

    // Step 4: Training
    trainingStatus: varchar("training_status", { length: 20 }).default("incomplete"),
    trainingCompletedAt: timestamp("training_completed_at"),

    // Step 5: Agreement & Activation
    agreementSignedAt: timestamp("agreement_signed_at"),
    highvisSize: varchar("highvis_size", { length: 10 }),
    activatedAt: timestamp("activated_at"),
    adminNotes: text("admin_notes"),

    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
    index("idx_partner_applications_contractor").on(table.contractorId),
    index("idx_partner_applications_status").on(table.status),
]);

export const insertPartnerApplicationSchema = createInsertSchema(partnerApplications);
export type PartnerApplication = typeof partnerApplications.$inferSelect;
export type InsertPartnerApplication = z.infer<typeof insertPartnerApplicationSchema>;

// Client References - For partner verification
export const clientReferences = pgTable("client_references", {
    id: varchar("id").primaryKey().notNull(),
    applicationId: varchar("application_id").references(() => partnerApplications.id).notNull(),
    clientName: varchar("client_name").notNull(),
    clientEmail: varchar("client_email").notNull(),
    clientPhone: varchar("client_phone", { length: 20 }),
    jobDescription: text("job_description"),
    requestSentAt: timestamp("request_sent_at"),
    requestToken: varchar("request_token", { length: 64 }),
    responseReceivedAt: timestamp("response_received_at"),
    rating: integer("rating"),
    feedback: text("feedback"),
    wouldRecommend: boolean("would_recommend"),
    verified: boolean("verified").default(false),
    createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
    index("idx_client_references_application").on(table.applicationId),
    index("idx_client_references_token").on(table.requestToken),
]);

export const insertClientReferenceSchema = createInsertSchema(clientReferences);
export type ClientReference = typeof clientReferences.$inferSelect;
export type InsertClientReference = z.infer<typeof insertClientReferenceSchema>;

// Training Modules - Education content for partners
export const trainingModules = pgTable("training_modules", {
    id: varchar("id").primaryKey().notNull(),
    slug: varchar("slug", { length: 50 }).unique().notNull(),
    title: varchar("title", { length: 200 }).notNull(),
    description: text("description"),
    durationMinutes: integer("duration_minutes").default(10),
    videoUrl: text("video_url"),
    thumbnailUrl: text("thumbnail_url"),
    quizQuestions: jsonb("quiz_questions"),
    passThreshold: integer("pass_threshold").default(80),
    orderIndex: integer("order_index").notNull(),
    isRequired: boolean("is_required").default(true),
    isActive: boolean("is_active").default(true),
    createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
    index("idx_training_modules_order").on(table.orderIndex),
]);

export const insertTrainingModuleSchema = createInsertSchema(trainingModules);
export type TrainingModule = typeof trainingModules.$inferSelect;
export type InsertTrainingModule = z.infer<typeof insertTrainingModuleSchema>;

// Training Progress - Track contractor progress
export const trainingProgress = pgTable("training_progress", {
    id: varchar("id").primaryKey().notNull(),
    contractorId: varchar("contractor_id").references(() => handymanProfiles.id).notNull(),
    moduleId: varchar("module_id").references(() => trainingModules.id).notNull(),
    startedAt: timestamp("started_at"),
    videoWatchedAt: timestamp("video_watched_at"),
    completedAt: timestamp("completed_at"),
    quizScore: integer("quiz_score"),
    passed: boolean("passed").default(false),
    attempts: integer("attempts").default(0),
    createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
    index("idx_training_progress_contractor").on(table.contractorId),
    index("idx_training_progress_module").on(table.moduleId),
]);

export const insertTrainingProgressSchema = createInsertSchema(trainingProgress);
export type TrainingProgress = typeof trainingProgress.$inferSelect;
export type InsertTrainingProgress = z.infer<typeof insertTrainingProgressSchema>;

// Contractor Reviews - Customer reviews
export const contractorReviews = pgTable("contractor_reviews", {
    id: varchar("id").primaryKey().notNull(),
    contractorId: varchar("contractor_id").references(() => handymanProfiles.id).notNull(),
    customerName: varchar("customer_name").notNull(),
    customerEmail: varchar("customer_email"),
    quoteId: varchar("quote_id").references(() => personalizedQuotes.id),
    overallRating: integer("overall_rating").notNull(),
    qualityRating: integer("quality_rating"),
    timelinessRating: integer("timeliness_rating"),
    communicationRating: integer("communication_rating"),
    valueRating: integer("value_rating"),
    reviewText: text("review_text"),
    reviewToken: varchar("review_token", { length: 64 }),
    isVerified: boolean("is_verified").default(false),
    isPublic: boolean("is_public").default(true),
    contractorResponse: text("contractor_response"),
    respondedAt: timestamp("responded_at"),
    createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
    index("idx_contractor_reviews_contractor").on(table.contractorId),
    index("idx_contractor_reviews_token").on(table.reviewToken),
]);

export const insertContractorReviewSchema = createInsertSchema(contractorReviews);
export type ContractorReview = typeof contractorReviews.$inferSelect;
export type InsertContractorReview = z.infer<typeof insertContractorReviewSchema>;

// Payment Links - For instant payments
export const paymentLinks = pgTable("payment_links", {
    id: varchar("id").primaryKey().notNull(),
    contractorId: varchar("contractor_id").references(() => handymanProfiles.id).notNull(),
    quoteId: varchar("quote_id").references(() => personalizedQuotes.id),
    invoiceId: varchar("invoice_id").references(() => invoices.id),
    shortCode: varchar("short_code", { length: 10 }).unique().notNull(),
    amountPence: integer("amount_pence").notNull(),
    description: text("description"),
    customerName: varchar("customer_name"),
    customerEmail: varchar("customer_email"),
    status: varchar("status", { length: 20 }).default("active").notNull(),
    stripePaymentIntentId: varchar("stripe_payment_intent_id"),
    expiresAt: timestamp("expires_at"),
    paidAt: timestamp("paid_at"),
    createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
    index("idx_payment_links_contractor").on(table.contractorId),
    index("idx_payment_links_short_code").on(table.shortCode),
    index("idx_payment_links_status").on(table.status),
]);

export const insertPaymentLinkSchema = createInsertSchema(paymentLinks);
export type PaymentLink = typeof paymentLinks.$inferSelect;
export type InsertPaymentLink = z.infer<typeof insertPaymentLinkSchema>;

// Invoice Tokens - For client portal access
export const invoiceTokens = pgTable("invoice_tokens", {
    id: varchar("id").primaryKey().notNull(),
    invoiceId: varchar("invoice_id").references(() => invoices.id).notNull(),
    token: varchar("token", { length: 64 }).unique().notNull(),
    viewCount: integer("view_count").default(0),
    lastViewedAt: timestamp("last_viewed_at"),
    expiresAt: timestamp("expires_at"),
    createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
    index("idx_invoice_tokens_token").on(table.token),
]);

export const insertInvoiceTokenSchema = createInsertSchema(invoiceTokens);
export type InvoiceToken = typeof invoiceTokens.$inferSelect;
export type InsertInvoiceToken = z.infer<typeof insertInvoiceTokenSchema>;

// ==========================================
// CALL SCRIPT TUBE MAP SYSTEM
// ==========================================

// Station types - The 4 stages of the call flow
export const CallScriptStationValues = ['LISTEN', 'SEGMENT', 'QUALIFY', 'DESTINATION'] as const;
export type CallScriptStation = typeof CallScriptStationValues[number];

// Segment types for call scripts (subset focused on common call scenarios)
export const CallScriptSegmentValues = ['LANDLORD', 'BUSY_PRO', 'PROP_MGR', 'OAP', 'SMALL_BIZ', 'EMERGENCY', 'BUDGET'] as const;
export type CallScriptSegment = typeof CallScriptSegmentValues[number];

// Destination types - Where the call should end up
export const CallScriptDestinationValues = ['INSTANT_QUOTE', 'VIDEO_REQUEST', 'SITE_VISIT', 'EMERGENCY_DISPATCH', 'EXIT'] as const;
export type CallScriptDestination = typeof CallScriptDestinationValues[number];

// Captured info interface for call script state
export interface CallScriptCapturedInfo {
    job: string | null;
    postcode: string | null;
    name: string | null;
    contact: string | null;
    isDecisionMaker: boolean | null;
    isRemote: boolean | null;
    hasTenant: boolean | null;
    urgencyLevel: UrgencyLevel | null;
    isEmergency: boolean;
    emergencyType: string | null;
    checklistAnswers: SegmentChecklistAnswers | null;
}

// Urgency level - overlays any segment (Emergency is not a segment, it's a timing flag)
export type UrgencyLevel = 'standard' | 'priority' | 'emergency';

// Checklist answers for live call segmentation
export interface SegmentChecklistAnswers {
    property: 'own_home' | 'rental_owned' | 'rental_managed' | 'business' | null;
    access: 'present' | 'key_safe' | 'tenant' | 'unknown' | null;
    volume: 'single' | 'list' | 'ongoing' | null;
    decision: 'owner' | 'needs_approval' | 'just_prices' | null;
    timing: 'flexible' | 'this_week' | 'emergency' | null;
}

// Emergency detection result
export interface EmergencyDetection {
    isEmergency: boolean;
    emergencyType: 'water' | 'gas' | 'heating' | 'lockout' | 'electrical' | null;
    detectedKeywords: string[];
}

// Call script state for tracking progress through the tube map
export interface CallScriptState {
    callId: string;
    currentStation: CallScriptStation;
    completedStations: CallScriptStation[];

    // Detected segment
    detectedSegment: CallScriptSegment | null;
    segmentConfidence: number;
    segmentSignals: string[];

    // Captured info
    capturedInfo: CallScriptCapturedInfo;

    // Qualification
    isQualified: boolean | null;
    qualificationNotes: string[];

    // Destination
    recommendedDestination: CallScriptDestination | null;
    selectedDestination: CallScriptDestination | null;

    // Timestamps
    stationEnteredAt: Date;
    createdAt: Date;
    updatedAt: Date;
}

// Segment config for UI display
export interface SegmentConfig {
    id: CallScriptSegment;
    name: string;
    color: string;
    oneLiner: string;
    defaultDestination: CallScriptDestination;
    detectionKeywords: string[];
    watchForSignals: string[];
}

// Live Call Sessions table - Persistent storage for call script state
export const liveCallSessions = pgTable('live_call_sessions', {
    id: text('id').primaryKey(),
    callId: text('call_id').notNull().references(() => calls.id),
    phone: text('phone').notNull(),

    // Current state
    currentStation: text('current_station').notNull().default('LISTEN'),
    completedStations: text('completed_stations').array().default([]),

    // Segment detection
    detectedSegment: text('detected_segment'),
    segmentConfidence: integer('segment_confidence'),
    segmentSignals: text('segment_signals').array(),

    // Captured info (JSONB)
    capturedInfo: jsonb('captured_info').default({}),

    // Qualification
    isQualified: boolean('is_qualified'),
    qualificationNotes: text('qualification_notes').array(),

    // Destination
    recommendedDestination: text('recommended_destination'),
    selectedDestination: text('selected_destination'),

    // Timestamps
    stationEnteredAt: timestamp('station_entered_at'),
    createdAt: timestamp('created_at').defaultNow(),
    updatedAt: timestamp('updated_at').defaultNow(),
}, (table) => [
    index("idx_live_call_sessions_call").on(table.callId),
    index("idx_live_call_sessions_phone").on(table.phone),
    index("idx_live_call_sessions_station").on(table.currentStation),
]);

export const liveCallSessionsRelations = relations(liveCallSessions, ({ one }) => ({
    call: one(calls, {
        fields: [liveCallSessions.callId],
        references: [calls.id],
    }),
}));

// Schema and types for live call sessions
export const insertLiveCallSessionSchema = createInsertSchema(liveCallSessions);
export type LiveCallSession = typeof liveCallSessions.$inferSelect;
export type InsertLiveCallSession = z.infer<typeof insertLiveCallSessionSchema>;

// ==========================================
// AVAILABILITY SLOTS FOR LIVE CALL HUD
// ==========================================

// Slot type enum for availability slots
export const SlotTypeValues = ['morning', 'afternoon', 'full_day'] as const;
export type SlotType = typeof SlotTypeValues[number];

// Availability Slots table - Bookable time slots for Live Call HUD
export const availabilitySlots = pgTable("availability_slots", {
    id: text("id").primaryKey().notNull(),
    date: date("date").notNull(), // Date of the slot
    startTime: text("start_time").notNull(), // e.g. "09:00"
    endTime: text("end_time").notNull(), // e.g. "12:00"
    slotType: text("slot_type").notNull(), // 'morning' | 'afternoon' | 'full_day'
    isBooked: boolean("is_booked").default(false).notNull(),
    bookedByLeadId: text("booked_by_lead_id").references(() => leads.id), // Which lead booked this slot
    capacityCheckedAt: timestamp("capacity_checked_at"), // Last capacity validation (AVAILABILITY_CAPACITY_CHECK warn/enforce)
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
    index("idx_availability_slots_date").on(table.date),
    index("idx_availability_slots_booked").on(table.isBooked),
    index("idx_availability_slots_lead").on(table.bookedByLeadId),
]);

export const availabilitySlotsRelations = relations(availabilitySlots, ({ one }) => ({
    lead: one(leads, {
        fields: [availabilitySlots.bookedByLeadId],
        references: [leads.id],
    }),
}));

// Schema and types for availability slots
export const insertAvailabilitySlotSchema = createInsertSchema(availabilitySlots);
export type AvailabilitySlot = typeof availabilitySlots.$inferSelect;
export type InsertAvailabilitySlot = z.infer<typeof insertAvailabilitySlotSchema>;

// ==========================================
// SEGMENT JOURNEY TREE SYSTEM
// ==========================================

/**
 * Station types in a segment journey
 * - prompt: VA reads a prompt to customer
 * - choice: Customer chooses from options
 * - info_capture: VA captures specific info
 * - destination: Final destination (quote fork)
 */
export type JourneyStationType = 'prompt' | 'choice' | 'info_capture' | 'destination';

/**
 * Conditions for station option availability
 */
export type StationOptionCondition = 'always' | 'sku_match' | 'has_video' | 'emergency_type';

/**
 * Action types for station options
 */
export type StationOptionAction = 'set_flag' | 'capture_info' | 'navigate' | 'fast_track';

/**
 * Station option - a choice within a journey station
 */
export interface StationOption {
    id: string;
    label: string;
    icon?: string;
    nextStation: string | null; // null = end journey
    action?: StationOptionAction;
    actionPayload?: Record<string, unknown>;
    condition?: StationOptionCondition;
}

/**
 * Journey station - a node in the segment journey tree
 */
export interface JourneyStation {
    id: string;
    type: JourneyStationType;
    label: string;
    vaPrompt: string; // What VA should say
    description?: string; // Additional context for VA
    options?: StationOption[];
    nextStation?: string; // For non-choice stations
    captureFields?: string[]; // For info_capture stations
    skipCondition?: StationOptionCondition; // When to skip this station
}

/**
 * Quote fork destination types
 */
export type QuoteForkDestination = 'INSTANT_QUOTE' | 'VIDEO_REQUEST' | 'SITE_VISIT' | 'EMERGENCY_DISPATCH' | 'EXIT';

/**
 * Final destination configuration
 */
export interface JourneyFinalDestination {
    id: QuoteForkDestination;
    label: string;
    vaPrompt: string;
    color: string;
    icon: string;
    condition?: StationOptionCondition;
}

/**
 * Segment journey configuration
 */
export interface SegmentJourney {
    segmentId: CallScriptSegment;
    name: string;
    primaryFear: string; // What the customer fears most
    entryStation: string; // First station in journey
    stations: Record<string, JourneyStation>;
    optimizations: string[]; // Key phrases/behaviors for this segment
    finalDestinations: JourneyFinalDestination[];
}

/**
 * Extended CallScriptState with journey tracking
 */
export interface CallScriptStateWithJourney extends CallScriptState {
    // Journey tracking
    journeyPath: string[]; // Array of station IDs visited
    currentJourneyStation: string | null; // Current station ID in segment journey
    journeyFlags: Record<string, boolean | string>; // Flags set during journey
}

// ==========================================
// PROPERTY MAINTENANCE AI PLATFORM
// ==========================================

// Tenant Issue Status Enum
export const tenantIssueStatusEnum = pgEnum("tenant_issue_status", [
    "new",              // Just reported
    "ai_helping",       // AI is attempting DIY resolution
    "awaiting_details", // Waiting for photos/availability
    "reported",         // Sent to landlord + hub
    "quoted",           // Quote generated
    "approved",         // Landlord approved
    "scheduled",        // Job scheduled
    "completed",        // Job done
    "resolved_diy",     // Tenant fixed it themselves
    "cancelled"         // Cancelled/invalid
]);

export const TenantIssueStatusValues = [
    "new", "ai_helping", "awaiting_details", "reported", "quoted",
    "approved", "scheduled", "completed", "resolved_diy", "cancelled"
] as const;
export type TenantIssueStatus = typeof TenantIssueStatusValues[number];

// Tenant Issue Urgency Enum
export const tenantIssueUrgencyEnum = pgEnum("tenant_issue_urgency", [
    "low",        // Cosmetic, can wait
    "medium",     // Functional issue, within 2 weeks
    "high",       // Affecting daily life, within days
    "emergency"   // Safety/habitability issue, ASAP
]);

export const TenantIssueUrgencyValues = ["low", "medium", "high", "emergency"] as const;
export type TenantIssueUrgency = typeof TenantIssueUrgencyValues[number];

// Issue Category Enum
export const issueCategoryEnum = pgEnum("issue_category", [
    "plumbing",
    "plumbing_emergency",
    "electrical",
    "electrical_emergency",
    "heating",
    "carpentry",
    "locksmith",
    "security",
    "water_leak",
    "appliance",
    "cosmetic",
    "upgrade",
    "pest_control",
    "cleaning",
    "garden",
    "general",
    "other"
]);

export const IssueCategoryValues = [
    "plumbing", "plumbing_emergency", "electrical", "electrical_emergency",
    "heating", "carpentry", "locksmith", "security", "water_leak",
    "appliance", "cosmetic", "upgrade", "pest_control", "cleaning",
    "garden", "general", "other"
] as const;
export type IssueCategory = typeof IssueCategoryValues[number];

// Property Type Enum
export const propertyTypeEnum = pgEnum("property_type", [
    "flat",
    "house",
    "hmo",
    "commercial",
    "mixed_use"
]);

export const PropertyTypeValues = ["flat", "house", "hmo", "commercial", "mixed_use"] as const;
export type PropertyType = typeof PropertyTypeValues[number];

// Properties Table - Rental properties linked to landlords
// ============================================================================
// SERVICE PROPERTIES — the physical locations where we do work.
//
// Jobber-style "Property": a first-class location entity sitting between the
// (derived) client and the job spine. One client can own many properties
// (landlords, property managers). Quotes, jobs (contractor_booking_requests)
// and invoices each carry a nullable property_id pointing here.
//
// NOTE: distinct from the landlord-portal `properties` table below, which is
// scoped to a landlord lead + tenants/tenant-issues. THIS table is the spine
// property used across quote → job → invoice. (The two can be unified later.)
//
// Identity: deduped on Google place_id when present, else a normalized
// "postcode|addressline" key (dedupeKey, unique). client_key is the same
// phone:/email: heuristic the client-aggregation read model uses, so
// Client → Properties nests cleanly.
// ============================================================================
// ============================================================================
// CLIENTS — first-class customer record (Jobber's Client: WHO pays / is billed).
// Until now "clients" were derived at read-time from contact details on the
// spine. This promotes them to a real, editable, mergeable entity. One client
// owns many service_properties (landlords / property managers). Identity is the
// canonical contact key (see server/clients.ts) — phone preferred, else email,
// with UK phone canonicalization so "07766…" and "7766…" resolve to ONE client.
// ============================================================================
// NOTE: table is "service_clients" (not "clients") — a legacy orphan `clients`
// table already exists with an unrelated shape, exactly like the landlord
// `properties` vs spine `service_properties` split. This is the spine client.
export const serviceClients = pgTable("service_clients", {
    id: varchar("id").primaryKey().notNull().$defaultFn(() => crypto.randomUUID()),
    dedupeKey: varchar("dedupe_key").notNull(),   // canonical identity: "phone:<canon>" | "email:<lower>"
    displayName: text("display_name"),
    primaryPhone: varchar("primary_phone"),       // canonical UK form
    primaryEmail: varchar("primary_email"),
    phones: jsonb("phones"),                       // string[] — all known phone forms
    emails: jsonb("emails"),                        // string[] — all known emails
    billingAddress: text("billing_address"),
    notes: text("notes"),
    tags: jsonb("tags"),                            // string[]
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
    archivedAt: timestamp("archived_at"),
}, (table) => [
    uniqueIndex("uq_service_clients_dedupe").on(table.dedupeKey),
    index("idx_service_clients_primary_phone").on(table.primaryPhone),
    index("idx_service_clients_primary_email").on(table.primaryEmail),
]);

export const serviceProperties = pgTable("service_properties", {
    id: varchar("id").primaryKey().notNull().$defaultFn(() => crypto.randomUUID()),
    clientKey: varchar("client_key"),            // derived owner key: "phone:<digits>" | "email:<lower>" (legacy heuristic)
    clientId: varchar("client_id").references(() => serviceClients.id), // FK to the first-class client record (who pays)
    placeId: varchar("place_id"),                // Google Place ID — canonical address identity
    dedupeKey: varchar("dedupe_key").notNull(),  // placeId or normalized "postcode|addressline"
    address: text("address"),                    // best canonical/raw address string
    postcode: varchar("postcode", { length: 10 }),
    coordinates: jsonb("coordinates"),           // { lat, lng }
    nickname: text("nickname"),                  // optional human label, e.g. "Mrs Smith's BTL"
    notes: text("notes"),                        // free-form property notes (admin)
    accessNotes: text("access_notes"),           // gate code, parking, key safe, "dog in garden" — flows onto every job sheet at this address
    addressManual: boolean("address_manual").default(false).notNull(), // true once address/postcode hand-edited; keeps resolve-enrich from drift
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
    index("idx_service_properties_client").on(table.clientKey),
    index("idx_service_properties_place").on(table.placeId),
    uniqueIndex("uq_service_properties_dedupe").on(table.dedupeKey),
]);

export const properties = pgTable("properties", {
    id: text("id").primaryKey().notNull().$defaultFn(() => crypto.randomUUID()),
    landlordLeadId: text("landlord_lead_id").references(() => leads.id).notNull(),
    address: text("address").notNull(),
    postcode: varchar("postcode", { length: 10 }).notNull(),
    propertyType: propertyTypeEnum("property_type"),
    nickname: text("nickname"), // "Baker Street Flat" for landlord reference
    notes: text("notes"),
    coordinates: jsonb("coordinates"), // { lat: number, lng: number }
    isActive: boolean("is_active").default(true).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
    index("idx_properties_landlord").on(table.landlordLeadId),
    index("idx_properties_postcode").on(table.postcode),
]);

// Tenants Table - Tenants linked to properties
export const tenants = pgTable("tenants", {
    id: text("id").primaryKey().notNull().$defaultFn(() => crypto.randomUUID()),
    propertyId: text("property_id").references(() => properties.id).notNull(),
    name: text("name").notNull(),
    phone: varchar("phone", { length: 20 }).notNull(), // E.164 format for WhatsApp
    email: text("email"),
    isPrimary: boolean("is_primary").default(true), // Primary contact for property
    isActive: boolean("is_active").default(true).notNull(),
    whatsappOptIn: boolean("whatsapp_opt_in").default(false), // Has messaged us
    lastContactAt: timestamp("last_contact_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
    index("idx_tenants_property").on(table.propertyId),
    index("idx_tenants_phone").on(table.phone),
]);

// Tenant Issues Table - Issue reports from tenants
export const tenantIssues = pgTable("tenant_issues", {
    id: text("id").primaryKey().notNull().$defaultFn(() => crypto.randomUUID()),

    // Relationships
    tenantId: text("tenant_id").references(() => tenants.id).notNull(),
    propertyId: text("property_id").references(() => properties.id).notNull(),
    landlordLeadId: text("landlord_lead_id").references(() => leads.id).notNull(),

    // Issue details
    status: tenantIssueStatusEnum("status").default("new").notNull(),
    issueDescription: text("issue_description"),
    issueCategory: issueCategoryEnum("issue_category"),
    urgency: tenantIssueUrgencyEnum("urgency"),

    // AI resolution tracking
    aiResolutionAttempted: boolean("ai_resolution_attempted").default(false),
    aiSuggestions: jsonb("ai_suggestions"), // Array of suggestions given
    aiResolutionAccepted: boolean("ai_resolution_accepted"),

    // Media & details
    photos: text("photos").array(), // S3 URLs
    voiceNotes: text("voice_notes").array(), // S3 URLs for transcribed voice messages
    tenantAvailability: text("tenant_availability"), // Free text for beta
    additionalNotes: text("additional_notes"),
    accessInstructions: text("access_instructions"), // Key location, alarm code, etc.

    // Dispatch decision tracking
    dispatchDecision: text("dispatch_decision"), // 'auto_dispatch' | 'request_approval' | 'escalate_admin'
    dispatchReason: text("dispatch_reason"), // Why this decision was made
    priceEstimateLowPence: integer("price_estimate_low_pence"),
    priceEstimateHighPence: integer("price_estimate_high_pence"),

    // Conversion tracking
    quoteId: text("quote_id").references(() => personalizedQuotes.id),
    jobId: text("job_id").references(() => contractorJobs.id),

    // Conversation tracking
    conversationId: text("conversation_id").references(() => conversations.id),

    // Landlord notification tracking
    landlordNotifiedAt: timestamp("landlord_notified_at"),
    landlordReminderCount: integer("landlord_reminder_count").default(0),
    landlordLastRemindedAt: timestamp("landlord_last_reminded_at"),
    landlordApprovedAt: timestamp("landlord_approved_at"),
    landlordRejectedAt: timestamp("landlord_rejected_at"),
    landlordRejectionReason: text("landlord_rejection_reason"),

    // Timestamps
    createdAt: timestamp("created_at").defaultNow().notNull(),
    reportedToLandlordAt: timestamp("reported_to_landlord_at"),
    resolvedAt: timestamp("resolved_at"),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
    index("idx_tenant_issues_tenant").on(table.tenantId),
    index("idx_tenant_issues_property").on(table.propertyId),
    index("idx_tenant_issues_landlord").on(table.landlordLeadId),
    index("idx_tenant_issues_status").on(table.status),
    index("idx_tenant_issues_urgency").on(table.urgency),
    index("idx_tenant_issues_created").on(table.createdAt),
]);

// Landlord Settings Table - Auto-approval rules
export const landlordSettings = pgTable("landlord_settings", {
    id: text("id").primaryKey().notNull().$defaultFn(() => crypto.randomUUID()),
    landlordLeadId: text("landlord_lead_id").references(() => leads.id).notNull().unique(),

    // Price thresholds (in pence)
    autoApproveUnderPence: integer("auto_approve_under_pence").default(15000), // £150
    requireApprovalAbovePence: integer("require_approval_above_pence").default(50000), // £500

    // Category rules
    autoApproveCategories: text("auto_approve_categories").array().default([
        'plumbing_emergency', 'heating', 'security', 'water_leak'
    ]),
    alwaysRequireApprovalCategories: text("always_require_approval_categories").array().default([
        'cosmetic', 'upgrade'
    ]),

    // Emergency handling
    emergencyAutoDispatch: boolean("emergency_auto_dispatch").default(true), // Auto-dispatch for emergencies
    emergencyContactPhone: varchar("emergency_contact_phone", { length: 20 }), // Alternate emergency contact

    // Budget tracking
    monthlyBudgetPence: integer("monthly_budget_pence"),
    budgetAlertThreshold: integer("budget_alert_threshold").default(80), // Alert at 80%
    currentMonthSpendPence: integer("current_month_spend_pence").default(0),
    budgetResetDay: integer("budget_reset_day").default(1), // Day of month to reset budget

    // Notification preferences
    notifyOnAutoApprove: boolean("notify_on_auto_approve").default(true),
    notifyOnCompletion: boolean("notify_on_completion").default(true),
    notifyOnNewIssue: boolean("notify_on_new_issue").default(true),
    preferredChannel: text("preferred_channel").default('whatsapp'), // whatsapp, email, dashboard

    // Partner program
    isPartnerMember: boolean("is_partner_member").default(false),
    partnerDiscountPercent: integer("partner_discount_percent").default(0),

    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
    index("idx_landlord_settings_landlord").on(table.landlordLeadId),
]);

// Relations for Property Maintenance tables
export const propertiesRelations = relations(properties, ({ one, many }) => ({
    landlord: one(leads, { fields: [properties.landlordLeadId], references: [leads.id] }),
    tenants: many(tenants),
    issues: many(tenantIssues),
}));

export const tenantsRelations = relations(tenants, ({ one, many }) => ({
    property: one(properties, { fields: [tenants.propertyId], references: [properties.id] }),
    issues: many(tenantIssues),
}));

export const tenantIssuesRelations = relations(tenantIssues, ({ one }) => ({
    tenant: one(tenants, { fields: [tenantIssues.tenantId], references: [tenants.id] }),
    property: one(properties, { fields: [tenantIssues.propertyId], references: [properties.id] }),
    landlord: one(leads, { fields: [tenantIssues.landlordLeadId], references: [leads.id] }),
    quote: one(personalizedQuotes, { fields: [tenantIssues.quoteId], references: [personalizedQuotes.id] }),
    job: one(contractorJobs, { fields: [tenantIssues.jobId], references: [contractorJobs.id] }),
    conversation: one(conversations, { fields: [tenantIssues.conversationId], references: [conversations.id] }),
}));

export const landlordSettingsRelations = relations(landlordSettings, ({ one }) => ({
    landlord: one(leads, { fields: [landlordSettings.landlordLeadId], references: [leads.id] }),
}));

// Insert schemas and types
export const insertPropertySchema = createInsertSchema(properties);
export type Property = typeof properties.$inferSelect;
export type InsertProperty = z.infer<typeof insertPropertySchema>;

export const insertTenantSchema = createInsertSchema(tenants);
export type Tenant = typeof tenants.$inferSelect;
export type InsertTenant = z.infer<typeof insertTenantSchema>;

export const insertTenantIssueSchema = createInsertSchema(tenantIssues);
export type TenantIssue = typeof tenantIssues.$inferSelect;
export type InsertTenantIssue = z.infer<typeof insertTenantIssueSchema>;

export const insertLandlordSettingsSchema = createInsertSchema(landlordSettings);
export type LandlordSettings = typeof landlordSettings.$inferSelect;
export type InsertLandlordSettings = z.infer<typeof insertLandlordSettingsSchema>;

// Push Subscriptions - Web Push API subscriptions for mobile notifications
export const pushSubscriptions = pgTable("push_subscriptions", {
    id: serial("id").primaryKey(),
    endpoint: text("endpoint").notNull().unique(),
    p256dh: text("p256dh").notNull(),
    auth: text("auth").notNull(),
    userAgent: text("user_agent"),
    userId: varchar("user_id"), // users.id; null = legacy pre-auth row
    role: varchar("role", { length: 20 }), // 'admin' | 'va' | 'contractor'
    createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
    index("idx_push_subs_user").on(table.userId),
    index("idx_push_subs_role").on(table.role),
]);

// ==========================================
// RULES ENGINE TYPES
// ==========================================

/**
 * Dispatch decision from the rules engine
 */
export interface DispatchDecision {
    action: 'auto_dispatch' | 'request_approval' | 'escalate_admin';
    reason: string;
    notifyLandlord: boolean;
    urgencyOverride?: boolean; // True if emergency override was applied
}

/**
 * Price estimate from the triage worker
 */
export interface PriceEstimate {
    lowPricePence: number;
    highPricePence: number;
    midPricePence: number;
    confidence: number; // 0-100
    matchedSkus?: string[];
}

/**
 * AI worker response structure
 */
export interface WorkerResponse {
    message: string;
    nextWorker?: 'TENANT_WORKER' | 'TRIAGE_WORKER' | 'DISPATCH_WORKER' | 'LANDLORD_WORKER' | 'INSPECTOR_WORKER';
    stateUpdates?: Partial<TenantIssue>;
    toolCalls?: Array<{
        tool: string;
        args: Record<string, unknown>;
        result?: unknown;
    }>;
}

/**
 * Worker context for AI agents
 */
export interface WorkerContext {
    conversationId: string;
    senderId: string;
    senderType: 'tenant' | 'landlord' | 'admin';
    tenant?: Tenant;
    property?: Property;
    landlord?: Lead;
    landlordSettings?: LandlordSettings;
    currentIssue?: TenantIssue;
    conversationHistory: Message[];
}

// ==========================================
// TROUBLESHOOTING DEFLECTION SYSTEM
// ==========================================

// Troubleshooting Status Types
export type TroubleshootingStatus = 'active' | 'paused' | 'completed' | 'escalated' | 'abandoned';
export type TroubleshootingOutcome = 'resolved_diy' | 'needs_callout' | 'escalated_complex' | 'escalated_safety' | 'abandoned';

export interface StepHistoryEntry {
    stepId: string;
    timestamp: Date;
    userResponse: string;
    interpretedAs: string;
    actionTaken: string;
}

// Troubleshooting Sessions Table - Tracks user progress through troubleshooting flows
export const troubleshootingSessions = pgTable("troubleshooting_sessions", {
    id: text("id").primaryKey().notNull().$defaultFn(() => crypto.randomUUID()),
    issueId: text("issue_id").references(() => tenantIssues.id),

    // Flow tracking
    flowId: text("flow_id").notNull(),
    currentStepId: text("current_step_id"),
    stepHistory: jsonb("step_history").$type<StepHistoryEntry[]>(),

    // State
    status: text("status").$type<TroubleshootingStatus>().default('active'),
    attemptCount: integer("attempt_count").default(0),
    maxAttempts: integer("max_attempts").default(3),

    // Collected data
    collectedData: jsonb("collected_data").$type<Record<string, unknown>>(),

    // Outcome tracking
    outcome: text("outcome").$type<TroubleshootingOutcome>(),
    outcomeReason: text("outcome_reason"),

    // Timestamps
    startedAt: timestamp("started_at").defaultNow(),
    completedAt: timestamp("completed_at"),
    lastActivityAt: timestamp("last_activity_at").defaultNow(),
}, (table) => [
    index("idx_troubleshooting_sessions_issue").on(table.issueId),
    index("idx_troubleshooting_sessions_status").on(table.status),
    index("idx_troubleshooting_sessions_flow").on(table.flowId),
]);

// Deflection Metrics Table - Tracks deflection success/failure for analytics
export const deflectionMetrics = pgTable("deflection_metrics", {
    id: text("id").primaryKey().notNull().$defaultFn(() => crypto.randomUUID()),
    issueId: text("issue_id").references(() => tenantIssues.id),
    sessionId: text("session_id").references(() => troubleshootingSessions.id),

    // Classification
    issueCategory: text("issue_category"),
    flowId: text("flow_id"),

    // Outcome
    wasDeflected: boolean("was_deflected").notNull(),
    deflectionType: text("deflection_type").$type<'diy_resolved' | 'self_service' | 'info_only'>(),

    // Quality metrics
    stepsCompleted: integer("steps_completed"),
    totalStepsInFlow: integer("total_steps_in_flow"),
    timeToResolutionMs: integer("time_to_resolution_ms"),

    // Follow-up tracking
    hadFollowUp: boolean("had_follow_up").default(false),
    followUpWithin24h: boolean("follow_up_within_24h").default(false),

    createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
    index("idx_deflection_metrics_issue").on(table.issueId),
    index("idx_deflection_metrics_session").on(table.sessionId),
    index("idx_deflection_metrics_deflected").on(table.wasDeflected),
    index("idx_deflection_metrics_category").on(table.issueCategory),
]);

// Relations for Troubleshooting tables
export const troubleshootingSessionsRelations = relations(troubleshootingSessions, ({ one }) => ({
    issue: one(tenantIssues, { fields: [troubleshootingSessions.issueId], references: [tenantIssues.id] }),
}));

export const deflectionMetricsRelations = relations(deflectionMetrics, ({ one }) => ({
    issue: one(tenantIssues, { fields: [deflectionMetrics.issueId], references: [tenantIssues.id] }),
    session: one(troubleshootingSessions, { fields: [deflectionMetrics.sessionId], references: [troubleshootingSessions.id] }),
}));

// Type exports for Troubleshooting System
export type TroubleshootingSession = typeof troubleshootingSessions.$inferSelect;
export type InsertTroubleshootingSession = typeof troubleshootingSessions.$inferInsert;
export type DeflectionMetric = typeof deflectionMetrics.$inferSelect;
export type InsertDeflectionMetric = typeof deflectionMetrics.$inferInsert;

// ==========================================
// DIY Advice Database
// ==========================================

// DIY Advice Table - Stores DIY troubleshooting advice for tenants
export const diyAdvice = pgTable("diy_advice", {
    id: text("id").primaryKey().notNull().$defaultFn(() => crypto.randomUUID()),

    // Identity & matching
    name: varchar("name", { length: 200 }).notNull(),
    category: issueCategoryEnum("category"),
    keywords: text("keywords").array().notNull(),
    descriptionPatterns: text("description_patterns").array(),

    // DIY content
    canDIY: boolean("can_diy").notNull().default(true),
    steps: text("steps").array().notNull(),
    toolsNeeded: text("tools_needed").array(),
    warning: text("warning"),

    // Metadata
    priority: integer("priority").default(0),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
    index("idx_diy_advice_category").on(table.category),
    index("idx_diy_advice_active").on(table.isActive),
]);

// Unsafe Patterns Table - Safety gate patterns that block DIY advice
export const unsafePatterns = pgTable("unsafe_patterns", {
    id: text("id").primaryKey().notNull().$defaultFn(() => crypto.randomUUID()),
    pattern: varchar("pattern", { length: 200 }).notNull(),
    isRegex: boolean("is_regex").notNull().default(false),
    warningMessage: text("warning_message"),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Type exports for DIY Advice
export type DIYAdvice = typeof diyAdvice.$inferSelect;
export type InsertDIYAdvice = typeof diyAdvice.$inferInsert;
export type UnsafePattern = typeof unsafePatterns.$inferSelect;
export type InsertUnsafePattern = typeof unsafePatterns.$inferInsert;

// ============================================================
// Content Library Tables
// ============================================================

// Content Claims — approved value claims/bullets
export const contentClaims = pgTable("content_claims", {
    id: serial("id").primaryKey(),
    text: text("text").notNull(),
    category: text("category"), // "value", "guarantee", "trust", "convenience", "quality"
    jobCategories: text("job_categories").array(), // e.g. ["plumbing_minor", "electrical_minor"]. Empty = universal.
    signals: jsonb("signals"), // context signals e.g. {"urgency": "emergency"}
    isActive: boolean("is_active").notNull().default(true),
    usageCount: integer("usage_count").notNull().default(0),
    viewCount: integer("view_count").notNull().default(0),
    bookingCount: integer("booking_count").notNull().default(0),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
    index("idx_content_claims_active").on(table.isActive),
    index("idx_content_claims_category").on(table.category),
]);

// Content Images — image library
export const contentImages = pgTable("content_images", {
    id: serial("id").primaryKey(),
    url: text("url").notNull(), // e.g. "/assets/quote-images/plumber-smile.jpg"
    alt: text("alt"),
    placement: text("placement"), // "hero", "guarantee", "social_proof", "gallery"
    jobCategories: text("job_categories").array(),
    isActive: boolean("is_active").notNull().default(true),
    usageCount: integer("usage_count").notNull().default(0),
    viewCount: integer("view_count").notNull().default(0),
    bookingCount: integer("booking_count").notNull().default(0),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
    index("idx_content_images_active").on(table.isActive),
    index("idx_content_images_placement").on(table.placement),
]);

// Content Guarantees — guarantee section variants
export const contentGuarantees = pgTable("content_guarantees", {
    id: serial("id").primaryKey(),
    title: text("title").notNull(), // e.g. "Not right? We return and fix it free."
    description: text("description"),
    items: jsonb("items"), // array of {icon, title, text}
    badges: jsonb("badges"), // array of {label, value, icon}
    jobCategories: text("job_categories").array(),
    signals: jsonb("signals"), // e.g. {"urgency": "emergency"}
    isActive: boolean("is_active").notNull().default(true),
    usageCount: integer("usage_count").notNull().default(0),
    viewCount: integer("view_count").notNull().default(0),
    bookingCount: integer("booking_count").notNull().default(0),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
    index("idx_content_guarantees_active").on(table.isActive),
]);

// Content Testimonials — curated review pool
export const contentTestimonials = pgTable("content_testimonials", {
    id: serial("id").primaryKey(),
    text: text("text").notNull(),
    author: text("author").notNull(),
    location: text("location"), // e.g. "Nottingham", "West Bridgford"
    rating: integer("rating").notNull().default(5),
    jobCategories: text("job_categories").array(),
    source: text("source"), // "google", "manual", "trustpilot"
    isActive: boolean("is_active").notNull().default(true),
    usageCount: integer("usage_count").notNull().default(0),
    viewCount: integer("view_count").notNull().default(0),
    bookingCount: integer("booking_count").notNull().default(0),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
    index("idx_content_testimonials_active").on(table.isActive),
    index("idx_content_testimonials_source").on(table.source),
]);

// Content Hassle Items — "without us vs with us" comparison pairs
export const contentHassleItems = pgTable("content_hassle_items", {
    id: serial("id").primaryKey(),
    withoutUs: text("without_us").notNull(),
    withUs: text("with_us").notNull(),
    jobCategories: text("job_categories").array(),
    signals: jsonb("signals"),
    isActive: boolean("is_active").notNull().default(true),
    usageCount: integer("usage_count").notNull().default(0),
    viewCount: integer("view_count").notNull().default(0),
    bookingCount: integer("booking_count").notNull().default(0),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
    index("idx_content_hassle_items_active").on(table.isActive),
]);

// Content Booking Rules — deterministic booking mode rules
export const contentBookingRules = pgTable("content_booking_rules", {
    id: serial("id").primaryKey(),
    name: text("name").notNull(),
    conditions: jsonb("conditions").notNull(), // e.g. {"urgency": "standard", "timeOfService": "standard", "minPricePence": 0}
    bookingModes: text("booking_modes").array().notNull(), // e.g. ["standard_date", "flexible_discount"]
    priority: integer("priority").notNull().default(0), // higher priority rules override lower
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
    index("idx_content_booking_rules_active").on(table.isActive),
    index("idx_content_booking_rules_priority").on(table.priority),
]);

// Type exports for Content Library
export type ContentClaim = typeof contentClaims.$inferSelect;
export type InsertContentClaim = typeof contentClaims.$inferInsert;
export type ContentImage = typeof contentImages.$inferSelect;
export type InsertContentImage = typeof contentImages.$inferInsert;
export type ContentGuarantee = typeof contentGuarantees.$inferSelect;
export type InsertContentGuarantee = typeof contentGuarantees.$inferInsert;
export type ContentTestimonial = typeof contentTestimonials.$inferSelect;
export type InsertContentTestimonial = typeof contentTestimonials.$inferInsert;
export type ContentHassleItem = typeof contentHassleItems.$inferSelect;
export type InsertContentHassleItem = typeof contentHassleItems.$inferInsert;
export type ContentBookingRule = typeof contentBookingRules.$inferSelect;
export type InsertContentBookingRule = typeof contentBookingRules.$inferInsert;

// ---------------------------------------------------------------------------
// Quote Section Engagement Events
// Stores per-section dwell time data for in-app engagement analytics
// ---------------------------------------------------------------------------
export const quoteSectionEvents = pgTable("quote_section_events", {
  id: serial("id").primaryKey(),
  quoteId: varchar("quote_id", { length: 255 }).notNull(),
  shortSlug: varchar("short_slug", { length: 50 }),
  section: varchar("section", { length: 100 }).notNull(),
  dwellTimeMs: integer("dwell_time_ms").notNull().default(0),
  scrollDepthPercent: integer("scroll_depth_percent"),
  deviceType: varchar("device_type", { length: 20 }),
  layoutTier: varchar("layout_tier", { length: 50 }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("idx_section_events_quote").on(table.quoteId),
  index("idx_section_events_section").on(table.section),
  index("idx_section_events_created").on(table.createdAt),
]);

// ---------------------------------------------------------------------------
// Irresistible-Offer Events
// One row per interaction with the offer interstitial (?v=offer flow):
//   - 'impression' when the offer screen is shown
//   - 'accept'     when the customer takes the offer
//   - 'decline'    when they decline it
// Joined back to personalized_quotes (by quote_id) for downstream booking /
// revenue attribution per offer + per template.
// ---------------------------------------------------------------------------
export const quoteOfferEvents = pgTable("quote_offer_events", {
  id: serial("id").primaryKey(),
  quoteId: varchar("quote_id", { length: 255 }).notNull(),
  shortSlug: varchar("short_slug", { length: 50 }),
  offerId: varchar("offer_id", { length: 100 }).notNull(),
  offerType: varchar("offer_type", { length: 50 }),
  template: varchar("template", { length: 50 }),
  customerType: varchar("customer_type", { length: 30 }), // homeowner | landlord | property_manager | tenant | business | letting_agent
  event: varchar("event", { length: 20 }).notNull(), // impression | accept | decline
  deviceType: varchar("device_type", { length: 20 }),
  // welcome_gift accepts: WHICH gift the customer picked (addonMenu id). Also
  // set by the quote card's resurfaced gift band. Analytics: gift popularity
  // among non-payers (paid picks live on pricing_line_items).
  giftId: varchar("gift_id", { length: 100 }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("idx_offer_events_quote").on(table.quoteId),
  index("idx_offer_events_offer").on(table.offerId),
  index("idx_offer_events_event").on(table.event),
  index("idx_offer_events_ctype").on(table.customerType),
  index("idx_offer_events_created").on(table.createdAt),
]);

// ---------------------------------------------------------------------------
// Quote Platform — Image Library
// ---------------------------------------------------------------------------
export const quotePlatformImages = pgTable("quote_platform_images", {
  id: serial("id").primaryKey(),
  url: text("url").notNull(),
  filename: text("filename").notNull(),
  altText: text("alt_text"),
  archetypes: jsonb("archetypes").$type<string[]>().default([]),
  genderCue: varchar("gender_cue", { length: 20 }).default('neutral'),
  jobTypes: jsonb("job_types").$type<string[]>().default([]),
  isActive: boolean("is_active").notNull().default(true),
  viewCount: integer("view_count").notNull().default(0),
  bookingCount: integer("booking_count").notNull().default(0),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("idx_qp_images_active").on(table.isActive),
]);

// ---------------------------------------------------------------------------
// Quote Platform — Headline Variants
// ---------------------------------------------------------------------------
export const quotePlatformHeadlines = pgTable("quote_platform_headlines", {
  id: serial("id").primaryKey(),
  section: varchar("section", { length: 50 }).notNull(), // social_proof | guarantee | hassle_comparison | hero_sub
  text: text("text").notNull(),
  customerType: varchar("customer_type", { length: 50 }).notNull().default('homeowners'),
  isActive: boolean("is_active").notNull().default(true),
  viewCount: integer("view_count").notNull().default(0),
  bookingCount: integer("booking_count").notNull().default(0),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("idx_qp_headlines_section").on(table.section),
  index("idx_qp_headlines_active").on(table.isActive),
]);

// ---------------------------------------------------------------------------
// Quote Platform — Testimonials
// ---------------------------------------------------------------------------
export const quotePlatformTestimonials = pgTable("quote_platform_testimonials", {
  id: serial("id").primaryKey(),
  author: text("author").notNull(),
  text: text("text").notNull(),
  rating: integer("rating").notNull().default(5),
  archetype: varchar("archetype", { length: 50 }).default('homeowner'),
  location: text("location"),
  source: varchar("source", { length: 20 }).default('manual'),
  isActive: boolean("is_active").notNull().default(true),
  viewCount: integer("view_count").notNull().default(0),
  bookingCount: integer("booking_count").notNull().default(0),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("idx_qp_testimonials_archetype").on(table.archetype),
  index("idx_qp_testimonials_active").on(table.isActive),
]);

export type QuotePlatformImage = typeof quotePlatformImages.$inferSelect;
export type InsertQuotePlatformImage = typeof quotePlatformImages.$inferInsert;
export type QuotePlatformHeadline = typeof quotePlatformHeadlines.$inferSelect;
export type InsertQuotePlatformHeadline = typeof quotePlatformHeadlines.$inferInsert;
export type QuotePlatformTestimonial = typeof quotePlatformTestimonials.$inferSelect;
export type InsertQuotePlatformTestimonial = typeof quotePlatformTestimonials.$inferInsert;

// ---------------------------------------------------------------------------
// Optional Extras Catalog — reusable add-ons admins pick from when building a
// contextual quote. The picked entries get serialised onto the quote's
// `optional_extras` JSONB column (existing) so the customer page renders them
// as ticked rows. Only the active entries surface in the picker.
// ---------------------------------------------------------------------------
export const quoteExtrasCatalog = pgTable("quote_extras_catalog", {
  id: serial("id").primaryKey(),
  label: varchar("label", { length: 120 }).notNull(),
  description: text("description").notNull(),
  priceInPence: integer("price_in_pence").notNull(),
  /** Optional pill text rendered next to the title on the customer page (e.g. "Clean Team"). */
  badge: varchar("badge", { length: 40 }),
  /** Display order in the admin picker. Lower = higher in the list. */
  sortOrder: integer("sort_order").notNull().default(100),
  isActive: boolean("is_active").notNull().default(true),
  /** Cumulative tracking — how often this entry has been picked into a quote. */
  pickCount: integer("pick_count").notNull().default(0),
  /** Phase 16 — category slugs this extra is relevant for. Empty array = always-relevant impulse add. */
  relevantCategories: text("relevant_categories").array(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  index("idx_extras_catalog_active").on(table.isActive),
  index("idx_extras_catalog_sort").on(table.sortOrder),
]);

export type QuoteExtrasCatalog = typeof quoteExtrasCatalog.$inferSelect;
export type InsertQuoteExtrasCatalog = typeof quoteExtrasCatalog.$inferInsert;

// ---------------------------------------------------------------------------
// Job Applications (recruitment pipeline)
// ---------------------------------------------------------------------------
export const applicationStatusEnum = pgEnum('application_status', [
  'new',
  'phone_screened',
  'assessment_scheduled',
  'assessed',
  'offer_made',
  'hired',
  'rejected',
  'withdrawn'
]);

export const jobApplications = pgTable('job_applications', {
  id: text('id').primaryKey().$defaultFn(() => `app_${crypto.randomUUID()}`),

  // Applicant details
  firstName: text('first_name').notNull(),
  lastName: text('last_name').notNull(),
  phone: text('phone').notNull(),
  email: text('email'),
  postcode: text('postcode'),

  // Skills & experience
  trades: text('trades').array(), // ['carpentry', 'painting', 'plumbing', etc.]
  yearsExperience: text('years_experience'), // '1-2', '3-5', '5-10', '10+'
  hasOwnTools: boolean('has_own_tools'),
  hasDrivingLicence: boolean('has_driving_licence'),
  hasCSCS: boolean('has_cscs'),
  currentSituation: text('current_situation'), // 'employed', 'self-employed', 'looking'

  // Application
  coverNote: text('cover_note'), // Optional free text from applicant
  source: text('source'), // 'indeed', 'facebook', 'gumtree', 'referral', 'direct', 'checkatrade'

  // Pipeline tracking
  status: applicationStatusEnum('status').default('new').notNull(),
  statusNotes: text('status_notes'), // Internal notes per status change
  rating: integer('rating'), // 1-5 overall rating after assessment

  // Assessment scores (from practical test)
  assessmentSilicone: integer('assessment_silicone'), // 1-5
  assessmentCarpentry: integer('assessment_carpentry'), // 1-5
  assessmentPainting: integer('assessment_painting'), // 1-5
  assessmentMounting: integer('assessment_mounting'), // 1-5
  assessmentNotes: text('assessment_notes'),

  // Timestamps
  appliedAt: timestamp('applied_at').defaultNow().notNull(),
  screenedAt: timestamp('screened_at'),
  assessedAt: timestamp('assessed_at'),
  hiredAt: timestamp('hired_at'),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export type JobApplication = typeof jobApplications.$inferSelect;
export type InsertJobApplication = typeof jobApplications.$inferInsert;

// ==========================================
// HANDY SERVICES FOUNDATION TABLES
// ==========================================

// WTBP Rate Card — what we pay contractors per category
export const wtbpRateCard = pgTable('wtbp_rate_card', {
    id: serial('id').primaryKey(),
    categorySlug: varchar('category_slug', { length: 100 }).notNull(),
    ratePence: integer('rate_pence').notNull(), // what we pay the contractor per hour in this category
    rateType: varchar('rate_type', { length: 20 }).default('hourly'),
    effectiveFrom: timestamp('effective_from').defaultNow().notNull(),
    effectiveTo: timestamp('effective_to'), // null = current rate
    notes: text('notes'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// Contractor Payouts — payment tracking for contractor earnings
export const contractorPayouts = pgTable('contractor_payouts', {
    id: serial('id').primaryKey(),
    jobId: varchar('job_id'), // FK to contractorBookingRequests (varchar PK)
    contractorId: varchar('contractor_id').notNull(), // FK to handymanProfiles (varchar PK)
    quoteId: varchar('quote_id'), // FK to personalizedQuotes
    invoiceId: varchar('invoice_id'), // FK to invoices (varchar PK)
    grossAmountPence: integer('gross_amount_pence').notNull(), // total customer paid for this job
    platformFeePence: integer('platform_fee_pence').notNull(), // platform cut
    netPayoutPence: integer('net_payout_pence').notNull(), // contractor receives
    variationAmountPence: integer('variation_amount_pence').default(0),
    stripeTransferId: varchar('stripe_transfer_id', { length: 255 }),
    stripeTransferStatus: varchar('stripe_transfer_status', { length: 50 }),
    stripeAccountId: varchar('stripe_account_id', { length: 255 }),
    status: payoutStatusEnum('status').default('pending').notNull(),
    failureReason: text('failure_reason'),
    heldReason: text('held_reason'),
    scheduledPayoutAt: timestamp('scheduled_payout_at'),
    paidAt: timestamp('paid_at'),
    reversedAt: timestamp('reversed_at'),
    reversalReason: text('reversal_reason'),
    stripeReversalId: varchar('stripe_reversal_id', { length: 255 }),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// Job Sheets — structured work instructions for contractors
export const jobSheets = pgTable('job_sheets', {
    id: serial('id').primaryKey(),
    jobId: varchar('job_id').notNull(), // FK to contractorBookingRequests (varchar PK)
    quoteId: varchar('quote_id'), // FK to personalizedQuotes
    lineItems: jsonb('line_items'), // array of {description, categorySlug, estimatedMinutes, pricePence, contractorRatePence, materialsRequired[], status: 'pending'|'in_progress'|'completed'|'skipped'}
    accessInstructions: text('access_instructions'),
    parkingNotes: text('parking_notes'),
    customerContactPreference: varchar('customer_contact_preference', { length: 50 }),
    materialsChecklist: jsonb('materials_checklist'),
    specialEquipmentNeeded: text('special_equipment_needed'),
    generatedAt: timestamp('generated_at').defaultNow().notNull(),
    viewedByContractorAt: timestamp('viewed_by_contractor_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// Variation Orders — additional work requested on-site
export const variationOrders = pgTable('variation_orders', {
    id: serial('id').primaryKey(),
    jobId: varchar('job_id').notNull(), // FK to contractorBookingRequests (varchar PK)
    requestedByContractorId: varchar('requested_by_contractor_id').notNull(), // FK to handymanProfiles (varchar PK)
    description: text('description').notNull(),
    additionalPricePence: integer('additional_price_pence').notNull(),
    additionalTimeMins: integer('additional_time_mins'),
    materialsRequired: text('materials_required'),
    materialsCostPence: integer('materials_cost_pence').default(0),
    status: variationStatusEnum('status').default('pending_approval').notNull(),
    customerApprovalMethod: varchar('customer_approval_method', { length: 50 }), // sms | signature | whatsapp | admin_override
    customerApprovalAt: timestamp('customer_approval_at'),
    customerApprovalSignature: text('customer_approval_signature'),
    adminApprovalRequired: boolean('admin_approval_required').default(false),
    adminApprovedAt: timestamp('admin_approved_at'),
    adminApprovedBy: varchar('admin_approved_by', { length: 255 }),
    approvalToken: varchar('approval_token', { length: 100 }), // for SMS/WhatsApp approval links
    evidenceUrls: text('evidence_urls').array(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// Disputes — customer complaint tracking
export const disputes = pgTable('disputes', {
    id: serial('id').primaryKey(),
    jobId: varchar('job_id'), // FK to contractorBookingRequests (varchar PK)
    invoiceId: varchar('invoice_id'), // FK to invoices (varchar PK)
    quoteId: varchar('quote_id'),
    contractorId: varchar('contractor_id'), // FK to handymanProfiles (varchar PK)
    customerName: varchar('customer_name', { length: 255 }),
    customerPhone: varchar('customer_phone', { length: 50 }),
    customerEmail: varchar('customer_email', { length: 255 }),
    type: disputeTypeEnum('type').notNull(),
    status: disputeStatusEnum('status').default('open').notNull(),
    priority: varchar('priority', { length: 20 }).default('medium'),
    customerDescription: text('customer_description'),
    customerEvidenceUrls: text('customer_evidence_urls').array(),
    contractorResponse: text('contractor_response'),
    contractorEvidenceUrls: text('contractor_evidence_urls').array(),
    disputedLineItems: jsonb('disputed_line_items'), // [{lineItemIndex, reason, requestedRefundPence}]
    resolution: disputeResolutionEnum('resolution'),
    resolutionNotes: text('resolution_notes'),
    resolvedBy: varchar('resolved_by', { length: 255 }),
    resolvedAt: timestamp('resolved_at'),
    refundAmountPence: integer('refund_amount_pence'),
    refundStripeRefundId: varchar('refund_stripe_refund_id', { length: 255 }),
    returnVisitJobId: varchar('return_visit_job_id'), // FK to contractorBookingRequests (varchar PK)
    insuranceClaimRef: varchar('insurance_claim_ref', { length: 255 }),
    contractorPenaltyApplied: boolean('contractor_penalty_applied').default(false),
    payoutReversalId: integer('payout_reversal_id'),
    escalatedAt: timestamp('escalated_at'),
    escalatedTo: varchar('escalated_to', { length: 255 }),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// Job Incidents — on-site incident reporting
export const jobIncidents = pgTable('job_incidents', {
    id: serial('id').primaryKey(),
    jobId: varchar('job_id').notNull(), // FK to contractorBookingRequests (varchar PK)
    reportedByContractorId: varchar('reported_by_contractor_id').notNull(), // FK to handymanProfiles (varchar PK)
    type: incidentTypeEnum('type').notNull(),
    description: text('description').notNull(),
    evidenceUrls: text('evidence_urls').array(),
    insuranceClaimRequired: boolean('insurance_claim_required').default(false),
    insuranceClaimRef: varchar('insurance_claim_ref', { length: 255 }),
    resolution: text('resolution'),
    resolvedAt: timestamp('resolved_at'),
    resolvedBy: varchar('resolved_by', { length: 255 }),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// Credit Notes — refund/credit tracking against invoices
export const creditNotes = pgTable('credit_notes', {
    id: serial('id').primaryKey(),
    invoiceId: varchar('invoice_id').notNull(), // FK to invoices (varchar PK)
    reason: text('reason').notNull(),
    amountPence: integer('amount_pence').notNull(),
    lineItems: jsonb('line_items'),
    issuedAt: timestamp('issued_at').defaultNow().notNull(),
    issuedBy: varchar('issued_by', { length: 255 }),
    refundStripePaymentIntentId: varchar('refund_stripe_payment_intent_id', { length: 255 }),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// Booking Slot Locks — prevent double-booking during checkout
export const bookingSlotLocks = pgTable('booking_slot_locks', {
    id: serial('id').primaryKey(),
    quoteId: varchar('quote_id').notNull(),
    contractorId: varchar('contractor_id', { length: 255 }).notNull(),
    scheduledDate: timestamp('scheduled_date').notNull(),
    scheduledSlot: scheduledSlotEnum('scheduled_slot').notNull(),
    // Phase 24 — multi-day jobs. 1 = single-day (legacy default). 2+ means the
    // lock spans `durationDays` working days starting at scheduledDate.
    // Conflict checks must consider every day in the span.
    durationDays: integer('duration_days').notNull().default(1),
    // Phase 24e — actual span dates (see contractorBookingRequests.scheduledDates).
    scheduledDates: jsonb('scheduled_dates').$type<string[] | null>(),
    // Sparse-day fee snapshot (pence) computed at reserve time — the charge
    // authority for /api/create-payment-intent. Null = pre-feature lock
    // (payment falls back to recomputing).
    sparseFeePence: integer('sparse_fee_pence'),
    expiresAt: timestamp('expires_at').notNull(), // 5 min TTL
    createdAt: timestamp('created_at').defaultNow().notNull(),
});

// Type exports for Handy Services foundation tables
export type WtbpRateCard = typeof wtbpRateCard.$inferSelect;
export type InsertWtbpRateCard = typeof wtbpRateCard.$inferInsert;
export type ContractorPayout = typeof contractorPayouts.$inferSelect;
export type InsertContractorPayout = typeof contractorPayouts.$inferInsert;
export type JobSheet = typeof jobSheets.$inferSelect;
export type InsertJobSheet = typeof jobSheets.$inferInsert;
export type VariationOrder = typeof variationOrders.$inferSelect;
export type InsertVariationOrder = typeof variationOrders.$inferInsert;
export type Dispute = typeof disputes.$inferSelect;
export type InsertDispute = typeof disputes.$inferInsert;
export type JobIncident = typeof jobIncidents.$inferSelect;
export type InsertJobIncident = typeof jobIncidents.$inferInsert;
export type CreditNote = typeof creditNotes.$inferSelect;
export type InsertCreditNote = typeof creditNotes.$inferInsert;
export type BookingSlotLock = typeof bookingSlotLocks.$inferSelect;
export type InsertBookingSlotLock = typeof bookingSlotLocks.$inferInsert;

// ─── Partner Enquiries ──────────────────────────────────────────────────────

export const partnerEnquiryStatusEnum = pgEnum('partner_enquiry_status', [
  'new',
  'contacted',
  'qualified',
  'meeting_scheduled',
  'in_negotiation',
  'signed',
  'declined',
]);

export const partnerEnquiries = pgTable('partner_enquiries', {
  id: text('id').primaryKey().$defaultFn(() => `penq_${crypto.randomUUID()}`),
  fullName: text('full_name').notNull(),
  email: text('email').notNull(),
  phone: text('phone').notNull(),
  territoryInterest: text('territory_interest'),
  investmentBudget: text('investment_budget'),
  currentSituation: text('current_situation'),
  message: text('message'),
  status: partnerEnquiryStatusEnum('status').default('new').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at'),
});

export type PartnerEnquiry = typeof partnerEnquiries.$inferSelect;
export type InsertPartnerEnquiry = typeof partnerEnquiries.$inferInsert;

// ─── Contractor Job Dispatch ────────────────────────────────────────────────
// Broadcast a job to multiple contractors via tokenised links.
// First-to-accept locks the job. All accept/decline/question/variation/completion
// events are tracked for admin visibility + liability evidence.

export const dispatchStatusEnum = pgEnum('dispatch_status', [
  'pending',
  'locked',
  'completed',
  'cancelled',
]);

export const contractorLinkStatusEnum = pgEnum('contractor_link_status', [
  'pending',
  'viewed',
  'accepted',
  'declined',
  'questioning',
  'locked_taken',
]);

export const variationStatusEnumDispatch = pgEnum('variation_status_dispatch', [
  'pending',
  'approved',
  'rejected',
]);

// A job dispatch — one row per outbound job. Tied to a quote (optional).
export const jobDispatches = pgTable('job_dispatches', {
  id: text('id').primaryKey().$defaultFn(() => `disp_${crypto.randomUUID()}`),
  quoteId: varchar('quote_id'), // FK to personalized_quotes (optional)
  invoiceId: varchar('invoice_id'), // FK to invoices (optional)
  title: text('title').notNull(),
  subtitle: text('subtitle'),
  customerFirstName: text('customer_first_name').notNull(),
  customerFullName: text('customer_full_name'), // unlocked post-accept
  customerPhone: text('customer_phone'), // unlocked post-accept
  customerAddress: text('customer_address'), // unlocked post-accept
  postcode: text('postcode').notNull(),
  // tasks: array of { num, title, tier, hours, payPence, payMethod, description, warning?, materials[] }
  tasks: jsonb('tasks').notNull(),
  totalHours: integer('total_hours').notNull(), // store ×10 to avoid float (e.g. 280 = 28.0)
  totalContractorPayPence: integer('total_contractor_pay_pence').notNull(),
  // Internal — not exposed to contractors
  customerRevenuePence: integer('customer_revenue_pence'),
  platformKeepsPence: integer('platform_keeps_pence'),
  status: dispatchStatusEnum('status').default('pending').notNull(),
  lockedToContractorId: varchar('locked_to_contractor_id'), // FK to handyman_profiles
  lockedAt: timestamp('locked_at'),
  completedAt: timestamp('completed_at'),
  scheduledDate: timestamp('scheduled_date'), // when the customer expects work done — drives bond timeline UI
  // Open shareable link — admin generates one URL per dispatch and shares it freely
  // (WhatsApp groups, broadcast). Any contractor in the pool can claim it.
  // Distinct from contractorJobLinks.token (per-contractor private URLs).
  publicToken: varchar('public_token', { length: 64 }).unique().$defaultFn(() => crypto.randomBytes(20).toString('base64url')),
  // Contractor-flavoured 1-liner shown on the brief hero (e.g. "Tap swap, splashback re-grout, cupboard hinge + 1 more")
  // Snapshotted at dispatch creation from the linked quote so the brief is self-contained.
  proposalSummary: text('proposal_summary'),
  // Per-job pay escalation (surge-lite): unclaimed dispatches auto-bump +5% of
  // the ORIGINAL pay every 48h, max 3 bumps, margin-guarded. Each bump is a
  // supply-side data point (base rate ran light for this tier).
  originalContractorPayPence: integer('original_contractor_pay_pence'),
  escalationCount: integer('escalation_count').default(0),
  lastEscalatedAt: timestamp('last_escalated_at'),
  // Customer's preferred dates from the contextual quote — array of { date, timeSlot } objects.
  // Snapshotted from personalized_quotes.date_time_preferences.
  preferredDates: jsonb('preferred_dates'),
  // Dispatch-level media (overview photos / walkthrough video) shown on the contractor brief.
  // Each task can also carry its own mediaUrls inside the tasks jsonb structure.
  mediaUrls: text('media_urls').array(),
  // Bond config — refundable security deposit required to accept this dispatch
  bondRequired: boolean('bond_required').default(false).notNull(),
  bondAmountPence: integer('bond_amount_pence'), // null when bondRequired=false
  // Live scarcity tracking — incremented on each public link GET to power the
  // "X views · last seen Xm ago" pill on the contractor brief.
  viewCount: integer('view_count').notNull().default(0),
  lastViewedAt: timestamp('last_viewed_at'),
  createdBy: varchar('created_by'), // admin user id
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => [
  index('idx_job_dispatches_status').on(table.status),
  index('idx_job_dispatches_quote').on(table.quoteId),
]);

// Per-contractor token link — one row per (dispatch × contractor) pair.
// The unique token is what goes in the URL.
export const contractorJobLinks = pgTable('contractor_job_links', {
  id: text('id').primaryKey().$defaultFn(() => `cjl_${crypto.randomUUID()}`),
  dispatchId: text('dispatch_id').notNull().references(() => jobDispatches.id, { onDelete: 'cascade' }),
  contractorId: varchar('contractor_id').notNull(), // FK to handyman_profiles
  contractorName: text('contractor_name'), // denormalised for display
  contractorPhone: text('contractor_phone'),
  token: varchar('token', { length: 64 }).notNull().unique().$defaultFn(() => crypto.randomBytes(24).toString('base64url')),
  status: contractorLinkStatusEnum('status').default('pending').notNull(),
  // Each warning ack: { taskNum, warningText, ackedAt }
  warningsAcknowledged: jsonb('warnings_acknowledged').default([]).notNull(),
  responseMessage: text('response_message'), // decline reason or question text
  // Launch bonus actually applied at accept (pence) — durable record for
  // payout reconciliation; base dispatch pay is never mutated.
  boostAppliedPence: integer('boost_applied_pence'),
  viewedAt: timestamp('viewed_at'),
  acceptedAt: timestamp('accepted_at'),
  declinedAt: timestamp('declined_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => [
  uniqueIndex('idx_contractor_job_links_token').on(table.token),
  index('idx_contractor_job_links_dispatch').on(table.dispatchId),
  index('idx_contractor_job_links_contractor').on(table.contractorId),
  index('idx_contractor_job_links_status').on(table.status),
]);

// On-site variations reported by the contractor — replaces the manual
// Herbert-style admin amendment with a structured flow.
export const dispatchVariations = pgTable('dispatch_variations', {
  id: text('id').primaryKey().$defaultFn(() => `dv_${crypto.randomUUID()}`),
  dispatchId: text('dispatch_id').notNull().references(() => jobDispatches.id, { onDelete: 'cascade' }),
  contractorId: varchar('contractor_id').notNull(),
  taskNum: integer('task_num'), // which task this relates to (optional)
  description: text('description').notNull(),
  reason: text('reason'), // e.g. "panel did not fit"
  additionalPricePence: integer('additional_price_pence').default(0),
  additionalTimeMins: integer('additional_time_mins').default(0),
  photoUrls: text('photo_urls').array(),
  status: variationStatusEnumDispatch('status').default('pending').notNull(),
  adminNotes: text('admin_notes'),
  resolvedAt: timestamp('resolved_at'),
  resolvedBy: varchar('resolved_by'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => [
  index('idx_dispatch_variations_dispatch').on(table.dispatchId),
  index('idx_dispatch_variations_status').on(table.status),
]);

// Job completion record — photos required.
export const dispatchCompletions = pgTable('dispatch_completions', {
  id: text('id').primaryKey().$defaultFn(() => `dc_${crypto.randomUUID()}`),
  dispatchId: text('dispatch_id').notNull().references(() => jobDispatches.id, { onDelete: 'cascade' }).unique(),
  contractorId: varchar('contractor_id').notNull(),
  photoUrls: text('photo_urls').array().notNull(), // required, min 1 enforced in router
  notes: text('notes'),
  customerSignatureUrl: text('customer_signature_url'),
  completedAt: timestamp('completed_at').defaultNow().notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => [
  index('idx_dispatch_completions_dispatch').on(table.dispatchId),
]);

export type JobDispatch = typeof jobDispatches.$inferSelect;
export type InsertJobDispatch = typeof jobDispatches.$inferInsert;
export type ContractorJobLink = typeof contractorJobLinks.$inferSelect;
export type InsertContractorJobLink = typeof contractorJobLinks.$inferInsert;
export type DispatchVariation = typeof dispatchVariations.$inferSelect;
export type InsertDispatchVariation = typeof dispatchVariations.$inferInsert;
export type DispatchCompletion = typeof dispatchCompletions.$inferSelect;
export type InsertDispatchCompletion = typeof dispatchCompletions.$inferInsert;

// ─── Contractor Security Bonds ──────────────────────────────────────────────
// Refundable security deposit a contractor pays to claim a confirmed booked job.
// Auto-refunded on completion. Forfeited only on no-show / late cancellation.

export const bondStatusEnum = pgEnum('bond_status', [
  'pending',     // payment intent created, not yet captured
  'held',        // payment captured, contractor accepted
  'refunded',    // job completed (or admin refund) — money back to contractor
  'forfeited',   // contractor flaked — money kept by platform
  'failed',      // payment intent failed (card decline etc)
]);

export const dispatchBonds = pgTable('dispatch_bonds', {
  id: text('id').primaryKey().$defaultFn(() => `bond_${crypto.randomUUID()}`),
  linkId: text('link_id').notNull().references(() => contractorJobLinks.id, { onDelete: 'cascade' }),
  dispatchId: text('dispatch_id').notNull().references(() => jobDispatches.id, { onDelete: 'cascade' }),
  contractorId: varchar('contractor_id').notNull(),
  amountPence: integer('amount_pence').notNull(),
  stripePaymentIntentId: varchar('stripe_payment_intent_id', { length: 255 }),
  stripeChargeId: varchar('stripe_charge_id', { length: 255 }),
  stripeRefundId: varchar('stripe_refund_id', { length: 255 }),
  status: bondStatusEnum('status').default('pending').notNull(),
  paidAt: timestamp('paid_at'),
  refundedAt: timestamp('refunded_at'),
  refundReason: text('refund_reason'), // 'job_completed' | 'admin_refund' | 'customer_cancelled' | 'dispatch_cancelled'
  forfeitedAt: timestamp('forfeited_at'),
  forfeitedBy: varchar('forfeited_by'),
  forfeitReason: text('forfeit_reason'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => [
  index('idx_dispatch_bonds_link').on(table.linkId),
  index('idx_dispatch_bonds_dispatch').on(table.dispatchId),
  index('idx_dispatch_bonds_contractor').on(table.contractorId),
  index('idx_dispatch_bonds_status').on(table.status),
]);

export type DispatchBond = typeof dispatchBonds.$inferSelect;
export type InsertDispatchBond = typeof dispatchBonds.$inferInsert;

// ─── V2 Bookings ────────────────────────────────────────────────────────────
// Bookings created from the /v2 BookingFlowV2 funnel (basket → date → address → review).
// Captures the full snapshot needed to confirm + invoice the job.

export const v2Bookings = pgTable("v2_bookings", {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    reference: text("reference").notNull().unique(),
    customerFirstName: text("customer_first_name").notNull(),
    customerLastName: text("customer_last_name").notNull(),
    customerEmail: text("customer_email").notNull(),
    customerPhone: text("customer_phone").notNull(),
    addressLine1: text("address_line_1").notNull(),
    addressLine2: text("address_line_2"),
    town: text("town").notNull(),
    postcode: text("postcode").notNull(),
    services: jsonb("services").notNull(),
    slotDate: text("slot_date").notNull(),
    slotLabel: text("slot_label").notNull(),
    slotSurcharge: integer("slot_surcharge").notNull().default(0),
    subtotal: integer("subtotal").notNull(),
    visitFee: integer("visit_fee").notNull().default(0),
    weekendSurcharge: integer("weekend_surcharge").notNull().default(0),
    eveningSurcharge: integer("evening_surcharge").notNull().default(0),
    total: integer("total").notNull(),
    variant: text("variant"),
    status: text("status").notNull().default("pending_payment"),
    notes: text("notes"),
    stripePaymentIntentId: text("stripe_payment_intent_id"),
    paidAt: timestamp("paid_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type V2Booking = typeof v2Bookings.$inferSelect;
export type InsertV2Booking = typeof v2Bookings.$inferInsert;

// ===========================================================================
// Contractor Platform (feat/contractor-platform)
// Additive tables for the 3-tier delivery OS. See docs/contractor-platform/.
// Appended at end-of-file + additive-only so the merge with the -deployed
// chat's schema edits stays conflict-free.
// ===========================================================================

// Committed-capacity agreement per Core/Partner contractor — the "weekly
// retainer agreed?" flag from the founder sketch. Versioned (effectiveFrom/To)
// so floor terms can change without losing history. Null money fields = the
// floor is theoretical (tiers route work; floor is papered later).
export const contractorCommitments = pgTable("contractor_commitments", {
    id: varchar("id").primaryKey().notNull(),
    contractorId: varchar("contractor_id").references(() => handymanProfiles.id).notNull(),
    weeklyFloorPence: integer("weekly_floor_pence"),            // guaranteed weekly earnings floor (null until agreed)
    topupPercentOfLabour: integer("topup_percent_of_labour"),  // % of the labour line paid per job (e.g. 10)
    residualBookPercent: integer("residual_book_percent"),     // % on rebookings from a customer they served
    acceptanceSlaMinutes: integer("acceptance_sla_minutes"),   // must accept assigned jobs within N mins to keep the floor
    committedDaysPerWeek: integer("committed_days_per_week"),   // committed working days per week
    status: varchar("status", { length: 20 }).notNull().default('draft'), // 'draft' | 'proposed' | 'active' | 'ended'
    effectiveFrom: timestamp("effective_from"),
    effectiveTo: timestamp("effective_to"),
    notes: text("notes"),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
    index("idx_contractor_commitments_contractor").on(table.contractorId),
    index("idx_contractor_commitments_status").on(table.status),
]);

// One booking → many contractor assignments. A solo job = one 'lead' row (the
// existing contractorBookingRequests.assignedContractorId stays the lead, so
// nothing downstream breaks). Multi-trade = lead + one 'specialist' row per
// off-skill line. This is what makes "steer, then compose" real.
export const bookingAssignments = pgTable("booking_assignments", {
    id: varchar("id").primaryKey().notNull(),
    bookingId: varchar("booking_id").references(() => contractorBookingRequests.id).notNull(),
    contractorId: varchar("contractor_id").references(() => handymanProfiles.id).notNull(),
    role: varchar("role", { length: 20 }).notNull().default('lead'), // 'lead' | 'specialist'
    coveredCategories: text("covered_categories").array(), // category slugs this contractor covers on the job
    status: varchar("status", { length: 20 }).notNull().default('assigned'), // 'assigned' | 'accepted' | 'declined' | 'in_progress' | 'completed'
    payoutPence: integer("payout_pence"),                  // this contractor's share of the labour line
    scheduledDate: timestamp("scheduled_date"),            // may differ from the lead if a specialist follows separately
    scheduledSlot: scheduledSlotEnum("scheduled_slot"),
    offeredVia: varchar("offered_via", { length: 20 }),    // 'auto' | 'whatsapp' | 'manual' — v1 = whatsapp/manual (no job_offers table yet)
    assignedAt: timestamp("assigned_at"),
    acceptedAt: timestamp("accepted_at"),
    declinedAt: timestamp("declined_at"),
    completedAt: timestamp("completed_at"),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
    index("idx_booking_assignments_booking").on(table.bookingId),
    index("idx_booking_assignments_contractor").on(table.contractorId),
    index("idx_booking_assignments_status").on(table.status),
]);

export const contractorCommitmentsRelations = relations(contractorCommitments, ({ one }) => ({
    contractor: one(handymanProfiles, {
        fields: [contractorCommitments.contractorId],
        references: [handymanProfiles.id],
    }),
}));

export const bookingAssignmentsRelations = relations(bookingAssignments, ({ one }) => ({
    booking: one(contractorBookingRequests, {
        fields: [bookingAssignments.bookingId],
        references: [contractorBookingRequests.id],
    }),
    contractor: one(handymanProfiles, {
        fields: [bookingAssignments.contractorId],
        references: [handymanProfiles.id],
    }),
}));

export const insertContractorCommitmentSchema = createInsertSchema(contractorCommitments);
export type ContractorCommitment = typeof contractorCommitments.$inferSelect;
export type InsertContractorCommitment = typeof contractorCommitments.$inferInsert;

export const insertBookingAssignmentSchema = createInsertSchema(bookingAssignments);
export type BookingAssignment = typeof bookingAssignments.$inferSelect;
export type InsertBookingAssignment = typeof bookingAssignments.$inferInsert;

// =====================================================================
// SEO / AI-Search domination system (Nottingham/Derby, cloneable per-city)
// See docs blueprint. Core principle: RANK != FULFIL — tracking is always
// on; publishing a page and enabling its booking CTA are gated per-trade
// on real delivery capacity (trackRankings vs pagePublished vs bookingEnabled).
// =====================================================================

// Where a keyword can rank / be cited
export const seoEngineEnum = pgEnum('seo_engine', [
    'google_organic',        // classic 10-blue-links (Apify SERP scrape, point-in-time)
    'google_pack',           // local map pack (different ranking system)
    'google_search_console', // GSC-reported 28-day avg position + real clicks/impressions
    'ai_overview',           // Google AI Overviews
    'chatgpt',               // cited in ChatGPT answer
    'perplexity',            // cited in Perplexity answer
    'gemini',                // cited in Gemini answer
]);

// Search intent — drives page type and whether we target at all
export const seoIntentEnum = pgEnum('seo_intent', [
    'service_head',       // "handyman nottingham" — umbrella head
    'trade_service',      // "gutter cleaning nottingham" — the SEO engine
    'trade_supply',       // "fence panels nottingham" — DIY/product, usually SKIP
    'upmarket',           // "property maintenance nottingham" — high LTV
    'emergency',          // "emergency plumber nottingham" — urgent, gated on capacity
    'brand_competitor',   // "ag fencing derby" — competitor brand, SKIP
    'informational',      // "cost of X in nottingham" — AEO/answer content
]);

// Who fulfils the work — decoupled from whether we rank
export const seoDeliverabilityEnum = pgEnum('seo_deliverability', [
    'core',          // Handy delivers directly (painter, gutter, fencing, etc.)
    'sub',           // vetted-pool fork (roofer, locksmith, plumber, electrician)
    'out_of_scope',  // will not fulfil
]);

export const seoCompetitionEnum = pgEnum('seo_competition', ['LOW', 'MEDIUM', 'HIGH', 'UNKNOWN']);

// Page tier in the 5-tier architecture (maps intent -> page type)
export const seoTierEnum = pgEnum('seo_tier', [
    'T1_city_hub',
    'T2_service_city',
    'T3_job_suburb',      // programmatic
    'T4_segment',
    'T5_emergency',
]);

// The keyword universe — seeded once from the Apify keyword pull, tracked forever.
export const keywordTargets = pgTable("keyword_targets", {
    id: serial("id").primaryKey(),
    city: text("city").notNull(),                 // e.g. "nottingham", "derby"
    trade: text("trade").notNull(),               // e.g. "gutter-cleaning", "handyman"
    keyword: text("keyword").notNull(),           // the exact geo query
    intent: seoIntentEnum("intent").notNull(),
    tier: seoTierEnum("tier"),                     // nullable until architecture-mapped
    deliverability: seoDeliverabilityEnum("deliverability").notNull(),

    // Demand data (from Google Keyword Planner via Apify)
    avgMonthlySearches: integer("avg_monthly_searches").default(0).notNull(),
    competition: seoCompetitionEnum("competition").default('UNKNOWN').notNull(),
    cpcLowMicros: integer("cpc_low_micros"),      // top-of-page bid, low (micros)
    cpcHighMicros: integer("cpc_high_micros"),    // top-of-page bid, high (micros)
    priorityScore: integer("priority_score"),     // computed: volume x intent x deliverability

    // Funnel gates — RANK != FULFIL. Track always; publish + book only when ready.
    trackRankings: boolean("track_rankings").default(true).notNull(),
    pagePublished: boolean("page_published").default(false).notNull(),  // page generator reads this
    bookingEnabled: boolean("booking_enabled").default(false).notNull(),// booking CTA / fulfil gate

    targetUrl: text("target_url"),                // the page this maps to, once built
    source: text("source").default('google_keyword_planner').notNull(),
    notes: text("notes"),

    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
    uniqueIndex("idx_keyword_targets_city_keyword").on(table.city, table.keyword),
    index("idx_keyword_targets_city_trade").on(table.city, table.trade),
    index("idx_keyword_targets_deliverability").on(table.deliverability),
]);

// Time-series of where each keyword ranks / is cited, per engine. Cron-populated.
export const rankSnapshots = pgTable("rank_snapshots", {
    id: serial("id").primaryKey(),
    keywordTargetId: integer("keyword_target_id").references(() => keywordTargets.id, { onDelete: 'cascade' }).notNull(),
    engine: seoEngineEnum("engine").notNull(),
    position: integer("position"),               // null = not found / not ranking
    url: text("url"),                            // ranking/cited URL
    rankedFeature: text("ranked_feature"),       // e.g. "featured_snippet", "local_pack_3"
    cited: boolean("cited").default(false).notNull(), // AI engines: were we named/cited
    rawMeta: jsonb("raw_meta"),                  // full SERP/citation payload for audit
    capturedAt: timestamp("captured_at").defaultNow().notNull(),
}, (table) => [
    index("idx_rank_snapshots_keyword").on(table.keywordTargetId),
    index("idx_rank_snapshots_captured").on(table.capturedAt),
    index("idx_rank_snapshots_keyword_engine").on(table.keywordTargetId, table.engine),
]);

// Google Business Profile performance per location — the Local Pack signal + reviews.
export const gmbMetrics = pgTable("gmb_metrics", {
    id: serial("id").primaryKey(),
    location: text("location").notNull(),        // e.g. "nottingham"
    profileId: text("profile_id"),               // Google Business Profile location id
    searchViews: integer("search_views").default(0).notNull(),
    mapsViews: integer("maps_views").default(0).notNull(),
    calls: integer("calls").default(0).notNull(),
    directionRequests: integer("direction_requests").default(0).notNull(),
    websiteClicks: integer("website_clicks").default(0).notNull(),
    bookings: integer("bookings").default(0).notNull(),
    reviewCount: integer("review_count").default(0).notNull(),
    avgRatingTenths: integer("avg_rating_tenths"),   // 49 = 4.9 stars (integer convention)
    capturedAt: timestamp("captured_at").defaultNow().notNull(),
}, (table) => [
    index("idx_gmb_metrics_location").on(table.location),
    index("idx_gmb_metrics_captured").on(table.capturedAt),
]);

// Closes the loop: ties an inbound lead to the keyword/page that produced it,
// so rankings connect to deposit_paid_at revenue, not vanity positions.
// Kept as its own table (additive, non-invasive to the hot leads table).
export const seoLeadAttributions = pgTable("seo_lead_attributions", {
    id: serial("id").primaryKey(),
    leadId: varchar("lead_id").references(() => leads.id, { onDelete: 'cascade' }).notNull(),
    keywordTargetId: integer("keyword_target_id").references(() => keywordTargets.id, { onDelete: 'set null' }),
    landingUrl: text("landing_url"),
    rawKeyword: text("raw_keyword"),             // query as captured (may pre-date a target row)
    engine: seoEngineEnum("engine"),             // which surface referred them
    capturedAt: timestamp("captured_at").defaultNow().notNull(),
}, (table) => [
    index("idx_seo_lead_attr_lead").on(table.leadId),
    index("idx_seo_lead_attr_keyword").on(table.keywordTargetId),
]);

export const insertKeywordTargetSchema = createInsertSchema(keywordTargets);
export type KeywordTarget = typeof keywordTargets.$inferSelect;
export type InsertKeywordTarget = typeof keywordTargets.$inferInsert;

export const insertRankSnapshotSchema = createInsertSchema(rankSnapshots);
export type RankSnapshot = typeof rankSnapshots.$inferSelect;
export type InsertRankSnapshot = typeof rankSnapshots.$inferInsert;

export const insertGmbMetricSchema = createInsertSchema(gmbMetrics);
export type GmbMetric = typeof gmbMetrics.$inferSelect;
export type InsertGmbMetric = typeof gmbMetrics.$inferInsert;

export const insertSeoLeadAttributionSchema = createInsertSchema(seoLeadAttributions);
export type SeoLeadAttribution = typeof seoLeadAttributions.$inferSelect;
export type InsertSeoLeadAttribution = typeof seoLeadAttributions.$inferInsert;

// ── Offer decision log (docs/OFFER_DECISION_PLAYBOOK.md §6) ──────────────────
// Append-only: one row per router run (generation, edit re-decision, Ben
// override). Never updated in place except the shadow-agent columns, which the
// async classifier backfills onto its own row.
export const quoteOfferDecisions = pgTable("quote_offer_decisions", {
    id: varchar("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    quoteId: varchar("quote_id").notNull(),
    slug: varchar("slug"),
    decidedAt: timestamp("decided_at").defaultNow().notNull(),
    moment: varchar("moment").default("first_view").notNull(),
    inputs: jsonb("inputs"),                    // OfferDecisionInputs snapshot
    ruleFired: varchar("rule_fired").notNull(), // "R9" | "G1" | "R11" | "ben_override"
    goal: varchar("goal"),
    targetPlay: varchar("target_play").notNull(),
    servedPlay: varchar("served_play").notNull(),
    rationale: text("rationale"),
    decidedBy: varchar("decided_by").default("rules").notNull(), // rules | ben_override
    // Shadow LLM (logged, never served) — backfilled async on the same row
    shadowPlay: varchar("shadow_play"),
    shadowStakes: varchar("shadow_stakes"),
    shadowRationale: text("shadow_rationale"),
    shadowModel: varchar("shadow_model"),
}, (table) => [
    index("idx_offer_decisions_quote").on(table.quoteId),
    index("idx_offer_decisions_decided_at").on(table.decidedAt),
]);

// ── GMB post log (server/gmb-posts/) ─────────────────────────────────────────
// One row per generated Google Business Profile post — drafts, successes and
// failures alike. Drives theme rotation (don't repeat the last N themes) and
// gives an audit trail of exactly what was published, with which voice files.
export const gmbPosts = pgTable("gmb_posts", {
    id: serial("id").primaryKey(),
    location: text("location").notNull(),               // internal key, e.g. "nottingham"
    topicType: text("topic_type").default('STANDARD').notNull(), // STANDARD | EVENT | OFFER
    theme: text("theme").notNull(),                     // rotation key, e.g. "service_spotlight"
    themeDetail: text("theme_detail"),                  // e.g. the service featured
    summary: text("summary").notNull(),                 // post body sent to Google (≤1500 chars)
    ctaType: text("cta_type"),                          // LEARN_MORE | BOOK | CALL | ...
    ctaUrl: text("cta_url"),
    mediaUrl: text("media_url"),                        // public photo URL attached, if any
    status: text("status").default('draft').notNull(),  // draft | posted | failed
    googleName: text("google_name"),                    // resource name returned by the API
    searchUrl: text("search_url"),                      // public post URL, when returned
    error: text("error"),
    model: text("model"),                               // LLM that wrote it
    createdAt: timestamp("created_at").defaultNow().notNull(),
    postedAt: timestamp("posted_at"),
}, (table) => [
    index("idx_gmb_posts_location").on(table.location),
    index("idx_gmb_posts_created").on(table.createdAt),
]);

export const insertGmbPostSchema = createInsertSchema(gmbPosts);
export type GmbPost = typeof gmbPosts.$inferSelect;
export type InsertGmbPost = typeof gmbPosts.$inferInsert;

export const insertQuoteOfferDecisionSchema = createInsertSchema(quoteOfferDecisions);
export type QuoteOfferDecision = typeof quoteOfferDecisions.$inferSelect;
export type InsertQuoteOfferDecision = typeof quoteOfferDecisions.$inferInsert;

// ── Recovery-agent nudge queue ───────────────────────────────────────────────
// The Recovery Agent's ONLY write surface: proposed follow-ups for stalled/
// unopened quotes. Nothing sends from here without a human — Ben approves and
// the send happens through a wa.me prefill he taps himself (trust-ladder v0).
// Rows double as the lifetime-nudge log (max 3 per quote, enforced in the
// candidate query) and the recovery-attribution source (nudge → paid ≤7d).
export const nudgeQueue = pgTable("nudge_queue", {
    id: varchar("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    quoteId: varchar("quote_id").notNull(),
    slug: varchar("slug"),
    phone: varchar("phone"),
    status: varchar("status", { length: 20 }).default("proposed").notNull(), // proposed | approved | sent | dismissed | skipped
    lever: varchar("lever", { length: 30 }),          // reminder | split | reassure | expiry | gift_unclaimed
    message: text("message"),                          // the drafted WhatsApp text (null for skips)
    reason: text("reason"),                            // agent's why (nudge rationale or skip reason)
    sendAfter: timestamp("send_after"),                // UK-polite scheduling hint
    agentRun: varchar("agent_run"),                    // transcript file ref for auditability
    runId: text("run_id"),                             // Phase 1: agent_runs.id that proposed it
    createdAt: timestamp("created_at").defaultNow().notNull(),
    approvedAt: timestamp("approved_at"),
    sentAt: timestamp("sent_at"),
}, (table) => [
    index("idx_nudge_queue_quote").on(table.quoteId),
    index("idx_nudge_queue_status").on(table.status),
    index("idx_nudge_queue_created").on(table.createdAt),
]);

export const insertNudgeQueueSchema = createInsertSchema(nudgeQueue);
export type NudgeQueueRow = typeof nudgeQueue.$inferSelect;

// ── System event log ─────────────────────────────────────────────────────────
// Live-beta observability: every side effect the machine takes (a send, a held
// draft, a delivery failure, a Pushover alert, a call verdict) becomes one row a
// human can scan on /admin/activity while the system is new and being watched.
// Append-only, written fire-and-forget via logSystemEvent (server/system-events.ts)
// — a bookkeeping failure must never break the action it describes.
// Migration: scripts/migrate-system-events.ts (targeted DDL; never db:push).
export const systemEvents = pgTable("system_events", {
    id: varchar("id").primaryKey().notNull(),
    at: timestamp("at", { withTimezone: true }).defaultNow().notNull(),
    kind: varchar("kind", { length: 32 }).notNull(),      // send | hold | delivery_fail | pushover | classification | ...
    phone: varchar("phone", { length: 32 }),              // E.164 when the event concerns a customer
    conversationId: varchar("conversation_id"),           // links the row to /admin/comms when known
    summary: text("summary").notNull(),                   // one human-readable line, capped at 300 chars
    detail: jsonb("detail"),                              // machine payload for drill-down
    source: varchar("source", { length: 48 }).notNull(),  // which module wrote it, e.g. 'outbound'
}, (table) => [
    index("idx_system_events_at").on(table.at.desc()),
    index("idx_system_events_kind_at").on(table.kind, table.at.desc()),
]);

export type SystemEvent = typeof systemEvents.$inferSelect;
export type InsertSystemEvent = typeof systemEvents.$inferInsert;

// ── VA call tasks ────────────────────────────────────────────────────────────
// Speed-to-lead calling on text-channel enquiries (28 Aug 2026). A first-contact
// (or returning-after-60d) enquiry via whatsapp/sms/webform creates ONE open
// task: "a human should ring this person within 15 working minutes". The task
// is a DEBT, not a message — this table never sends anything to a customer.
//
// Lifecycle, encoded in the nullable timestamps (deliberately no status column,
// matching messageDrafts' philosophy that a status you can compute is a status
// that cannot lie):
//   open       = completedAt IS NULL AND dismissedAt IS NULL
//   completed  = completedAt set — a call actually landed on the thread (any
//                direction; server/call-thread.ts hooks the ingest), or an
//                admin pressed "Mark called".
//   dismissed  = dismissedAt set — customer said "text only"
//                (dismissReason 'customer_prefers_text'), opted out, an admin
//                dismissed it, or the 15-minute window lapsed
//                (dismissedBy 'system:expired' — expiry is a dismissal, not a
//                third state; nothing downstream needs to tell them apart).
//
// While a task is open, the conversation's LLM triage is HELD (nextTriageAt
// pushed to dueAt — see server/agents/va-call-tasks.ts) so the agent does not
// run a full text intake while a call is imminent. Resolution releases it.
//
// Migration: migrations/20260828_va_call_tasks.sql (targeted additive run;
// never db:push — shared production DB).
export const vaCallTasks = pgTable("va_call_tasks", {
    id: varchar("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    conversationId: varchar("conversation_id").notNull(),
    phone: varchar("phone").notNull(),                       // E.164
    contactName: varchar("contact_name"),
    channel: varchar("channel", { length: 16 }).notNull(),   // whatsapp | sms | webform (voice is exempt by construction)
    reason: text("reason"),                                  // why the task exists, human-readable ("first contact via webform")
    createdAt: timestamp("created_at").defaultNow().notNull(),
    dueAt: timestamp("due_at").notNull(),                    // createdAt + 15 WORKING minutes (08:00–20:00 UK; out-of-hours defers to 08:15)
    completedAt: timestamp("completed_at"),
    dismissedAt: timestamp("dismissed_at"),
    dismissedBy: varchar("dismissed_by", { length: 60 }),    // human:admin | system:expired | system:opt_out | system:prefers_text
    dismissReason: varchar("dismiss_reason", { length: 80 }),
    notifiedAt: timestamp("notified_at"),                    // when the creation Pushover ping fired (null = ping failed/disarmed)
}, (table) => [
    index("idx_va_call_tasks_conversation").on(table.conversationId),
    index("idx_va_call_tasks_due").on(table.dueAt),
    // ONE open task per conversation, enforced by the database, not by a
    // check-then-act read (the 27 Aug 2026 triple-send taught this codebase
    // that two concurrent inbounds sail through any advisory SELECT together).
    // Inserts race → one wins, the loser's onConflictDoNothing returns no row.
    uniqueIndex("uq_va_call_tasks_open")
        .on(table.conversationId)
        .where(sql`completed_at IS NULL AND dismissed_at IS NULL`),
]);

export type VaCallTask = typeof vaCallTasks.$inferSelect;
export type InsertVaCallTask = typeof vaCallTasks.$inferInsert;

// SLA breach alerts (per-lane escalation sweep, 29 Aug 2026 — T6b).
//
// One row per (conversation, lane) breach EPISODE: the row is the idempotency claim
// ("Ben was pinged about this lane on this thread"), so the 15-second sweep cannot
// re-ping every pass. Written and resolved only by server/agents/sla-sweep.ts.
//
// Lifecycle: open (resolved_at NULL) → resolved. lane_entered_at pins the episode to a
// specific lane entry — when the thread re-enters the same lane later (new verdict),
// the timestamps differ, the old row is resolved and a fresh episode may open.
// last_alert_at drives the at-most-daily reminder while still breached.
export const slaAlerts = pgTable("sla_alerts", {
    id: varchar("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    conversationId: varchar("conversation_id").notNull(),
    // quote_ready | needs_ben | needs_info | visit_first (+ 'decline' reserved for T6a)
    lane: varchar("lane", { length: 24 }).notNull(),
    laneEnteredAt: timestamp("lane_entered_at").notNull(), // when the lane verdict/flag was recorded
    firstAlertAt: timestamp("first_alert_at").defaultNow().notNull(),
    lastAlertAt: timestamp("last_alert_at").defaultNow().notNull(), // reminder clock (CAS-updated)
    alertCount: integer("alert_count").default(1).notNull(),
    resolvedAt: timestamp("resolved_at"),
    resolveReason: varchar("resolve_reason", { length: 80 }), // lane_changed | lane_reentered | conversation_closed | ...
}, (table) => [
    index("idx_sla_alerts_conversation").on(table.conversationId),
    // ONE open episode per (conversation, lane), enforced by the database — the insert IS
    // the claim (onConflictDoNothing loses the race quietly), same shape as uq_va_call_tasks_open.
    uniqueIndex("uq_sla_alerts_open")
        .on(table.conversationId, table.lane)
        .where(sql`resolved_at IS NULL`),
]);

export type SlaAlert = typeof slaAlerts.$inferSelect;
export type InsertSlaAlert = typeof slaAlerts.$inferInsert;

// ─────────────────────────────────────────────────────────────────────────────
// Ops Manager sessions (Track B, B-WP2).
//
// A session is one persistent chat thread between an operator and the Ops
// Manager agent; messages are its turns. Wire DTOs (dates as ISO strings) live
// in shared/ops-types.ts — these rows are the storage shape behind them.
//
// Migration: additive-only via scripts/_ops-apply-tables.ts (CREATE TABLE IF
// NOT EXISTS). NEVER db:push — the shared Neon DB carries legacy V5 tables
// absent from this file, and push proposes dropping them.
// ─────────────────────────────────────────────────────────────────────────────

export const opsSessions = pgTable("ops_sessions", {
    id: varchar("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    title: varchar("title").notNull(),
    createdBy: varchar("created_by").notNull(),               // authed user id/email from requireAdmin
    status: varchar("status", { length: 16 }).default('active').notNull(), // 'active' | 'archived'
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const opsMessages = pgTable("ops_messages", {
    id: varchar("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    sessionId: varchar("session_id").notNull().references(() => opsSessions.id),
    role: varchar("role", { length: 16 }).notNull(),          // 'user' | 'assistant'
    content: text("content").notNull(),
    runId: varchar("run_id"),                                  // assistant rows produced by a run
    transcript: jsonb("transcript"),                           // LeanRunStep[] (shared/ops-types.ts)
    usage: jsonb("usage"),                                     // runner usage blob (AgentRunUsage)
    createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
    index("idx_ops_messages_session").on(table.sessionId),
]);

export const insertOpsSessionSchema = createInsertSchema(opsSessions);
export const insertOpsMessageSchema = createInsertSchema(opsMessages);
export type OpsSession = typeof opsSessions.$inferSelect;
export type InsertOpsSession = z.infer<typeof insertOpsSessionSchema>;
export type OpsMessage = typeof opsMessages.$inferSelect;
export type InsertOpsMessage = z.infer<typeof insertOpsMessageSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// Assignment proposals (Track D).
//
// The ops manager PROPOSES a job assignment; nothing is assigned until a human
// approves, at which point the approve path calls assignJobToContractor (the
// same code the dispatch UI uses). Mirrors the message_drafts pattern: the
// agent's only exit is a pending row a human decides on.
//
// Migration: additive-only via scripts/_apply-assignment-proposals.ts
// (CREATE TABLE IF NOT EXISTS). NEVER db:push — see ops_sessions note above.
// ─────────────────────────────────────────────────────────────────────────────

export const assignmentProposals = pgTable("assignment_proposals", {
    id: varchar("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    jobId: varchar("job_id").notNull(),                        // contractor_booking_requests id
    contractorId: varchar("contractor_id").notNull(),
    scheduledDates: jsonb("scheduled_dates"),                  // string[] of YYYY-MM-DD, when the agent proposes dates
    note: text("note").notNull(),                              // the agent's one-line rationale for the approver
    status: varchar("status", { length: 16 }).default('pending').notNull(), // 'pending' | 'approved' | 'rejected' | 'failed'
    createdBy: varchar("created_by").notNull(),                // 'ops_manager'
    decidedBy: varchar("decided_by"),                          // authed user id/email
    decidedAt: timestamp("decided_at"),
    error: text("error"),                                      // approve-path assignJobToContractor failure detail
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
    index("idx_assignment_proposals_job").on(table.jobId),
    // One live proposal per job — a second propose while one is pending is a bug/noise.
    uniqueIndex("uq_assignment_proposals_pending")
        .on(table.jobId)
        .where(sql`status = 'pending'`),
]);

export type AssignmentProposal = typeof assignmentProposals.$inferSelect;
export type InsertAssignmentProposal = typeof assignmentProposals.$inferInsert;

// ─────────────────────────────────────────────────────────────────────────────
// Quote Research (WP1: Quote Builder v2 background research).
//
// Pre-computed research for quote building: parsed job lines from intake,
// materials/time estimates/procedures per job, and a confidence score.
// Triggered when a conversation reaches quote_ready status.
//
// Migration: additive-only via scripts/_apply-quote-research.ts
// (CREATE TABLE IF NOT EXISTS). NEVER db:push — see ops_sessions note above.
// ─────────────────────────────────────────────────────────────────────────────

export const quoteResearchStatusEnum = pgEnum('quote_research_status', [
    'pending',
    'running',
    'completed',
    'failed',
]);

export const quoteResearch = pgTable("quote_research", {
    id: serial("id").primaryKey(),
    conversationId: varchar("conversation_id").notNull().references(() => conversations.id),
    status: quoteResearchStatusEnum("status").notNull().default('pending'),
    /** Parsed job lines from intake (copied from quotePrepIntake.lines). */
    jobs: jsonb("jobs"),
    /** Research results: materials[], timeEstimates[], procedures[] per job. */
    research: jsonb("research"),
    /** Overall confidence score 0-1. */
    confidence: doublePrecision("confidence"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    completedAt: timestamp("completed_at"),
    error: text("error"),
}, (table) => [
    index("idx_quote_research_conversation").on(table.conversationId),
    index("idx_quote_research_status").on(table.status),
]);

export type QuoteResearch = typeof quoteResearch.$inferSelect;
export type InsertQuoteResearch = typeof quoteResearch.$inferInsert;

// conversation_memory (Agent Framework V2) was DELETED in Phase 5 of the comms rebuild (3 Sep 2026).
// The table itself is dropped by hand via migrations/20260903_drop_conversation_memory.sql once
// the orchestrator confirms it is empty; nothing reads or writes it any more.
