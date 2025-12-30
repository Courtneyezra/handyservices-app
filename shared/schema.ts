import { pgTable, varchar, integer, timestamp, text, boolean, jsonb, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { relations } from "drizzle-orm";

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

// App Settings table - Key-value store for application configuration
export const appSettings = pgTable("app_settings", {
    id: varchar("id").primaryKey().notNull(),
    key: varchar("key", { length: 100 }).unique().notNull(),
    value: jsonb("value").notNull(),
    description: text("description"),
    updatedAt: timestamp("updated_at").defaultNow(),
});

export type AppSetting = typeof appSettings.$inferSelect;

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
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
});

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
    embedding: text("embedding"),               // B10: Native pgvector column (vector(1536))

    // Categorization
    category: varchar("category", { length: 50 }),
    isActive: boolean("is_active").default(true),
});

export type ProductizedService = typeof productizedServices.$inferSelect;

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

    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
    index("idx_leads_phone").on(table.phone), // B1: Fast phone lookup
    index("idx_leads_place_id").on(table.placeId), // B6: Fast duplicate detection by address
    index("idx_leads_postcode").on(table.postcode), // B6: Postcode-based queries
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
    leadId: varchar("lead_id"),

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

    createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
    index("idx_calls_phone_number").on(table.phoneNumber),
    index("idx_calls_start_time").on(table.startTime),
    index("idx_calls_outcome").on(table.outcome),
    index("idx_calls_customer_name").on(table.customerName),
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


// Handyman Profiles
export const handymanProfiles = pgTable("handyman_profiles", {
    id: varchar("id").primaryKey().notNull(),
    userId: varchar("user_id").references(() => users.id).notNull(),
    bio: text("bio"),
    address: text("address"),
    city: varchar("city", { length: 100 }),
    postcode: varchar("postcode", { length: 20 }),
    latitude: text("latitude"),
    longitude: text("longitude"),
    radiusMiles: integer("radius_miles").notNull().default(10),
    calendarSyncToken: text("calendar_sync_token"),
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
    serviceId: varchar("service_id").references(() => productizedServices.id).notNull(),
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
    urgency: z.enum(['Critical', 'High', 'Standard', 'Low']).optional(),
    leadType: z.enum(['Homeowner', 'Landlord', 'Property Manager', 'Tenant', 'Unknown']).optional(),
    outcome: z.enum(['INSTANT_PRICE', 'VIDEO_QUOTE', 'SITE_VISIT', 'NO_ANSWER', 'VOICEMAIL', 'Unknown']).optional(),
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

    // Lead Information
    customerName: varchar("customer_name").notNull(),
    phone: varchar("phone").notNull(),
    email: varchar("email"),
    postcode: varchar("postcode"),

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
    tierDeliverables: jsonb("tier_deliverables"), // Job-specific outcome sentences for each tier: {essential: string[], enhanced: string[], elite: string[]}

    // PVS (Perceived Value Score) Tracking - DEPRECATED
    pvsScore: integer("pvs_score"), // 0-100 score based on 6-factor weighted system
    valueMultiplier: integer("value_multiplier"), // DEPRECATED - use valueMultiplier100 instead
    dominantCategory: varchar("dominant_category"), // 'safety', 'visual', 'comfort', 'urgency', 'trust', 'property_value'
    anchorPrice: integer("anchor_price"), // Base cost × value multiplier (in pence)

    // Quote Mode - determines if we show simple quote or HHH packages
    quoteMode: varchar("quote_mode", { length: 10 }).notNull().default("hhh"), // 'simple' | 'hhh'

    // EEE Pricing (in pence) - for HHH mode
    essentialPrice: integer("essential_price"),
    enhancedPrice: integer("enhanced_price"),
    elitePrice: integer("elite_price"),

    // Simple Quote Pricing - for simple mode
    basePrice: integer("base_price"), // in pence, the main quote for simple jobs
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
    selectedPackage: varchar("selected_package"), // 'essential', 'enhanced', or 'elite' (for HHH mode)
    selectedExtras: jsonb("selected_extras"), // Array of selected extra labels (for simple mode)
    selectedAt: timestamp("selected_at"), // When package was selected
    bookedAt: timestamp("booked_at"), // When booking was confirmed
    leadId: varchar("lead_id"), // Links to leads table when lead submits
    expiresAt: timestamp("expires_at"), // When the quote expires (15 minutes from creation)

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

    // Deposit Tracking (for audit trail)
    depositAmountPence: integer("deposit_amount_pence"), // Calculated deposit amount in pence
    selectedTierPricePence: integer("selected_tier_price_pence"), // The tier price at time of selection in pence

    // Creation timestamp
    createdAt: timestamp("created_at").defaultNow(),
});

export type UrgencyReasonType = z.infer<typeof urgencyReasonEnum>;
export type OwnershipContextType = z.infer<typeof ownershipContextEnum>;
export type DesiredTimeframeType = z.infer<typeof desiredTimeframeEnum>;

// New Enums for Quote Topology
export const clientTypeEnum = z.enum(['homeowner', 'landlord', 'commercial']);
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
});

export type InsertPersonalizedQuote = z.infer<typeof insertPersonalizedQuoteSchema>;
export type PersonalizedQuote = typeof personalizedQuotes.$inferSelect;

// ==========================================
// WHATSAPP CRM SCHEMA
// ==========================================

// Conversations Table - Represents a unique chat thread with a phone number
export const conversations = pgTable("conversations", {
    id: varchar("id").primaryKey().notNull(), // UUID
    phoneNumber: varchar("phone_number").unique().notNull(), // Format: "447936816338@c.us"
    contactName: varchar("contact_name"), // Display name from WhatsApp or contact
    leadId: varchar("lead_id"), // Optional: Link to leads table

    // Status & Metadata
    status: varchar("status", { length: 20 }).notNull().default('active'), // 'active', 'archived', 'blocked'
    unreadCount: integer("unread_count").default(0),
    lastMessageAt: timestamp("last_message_at").defaultNow(),
    lastMessagePreview: text("last_message_preview"), // Cache last message for list view

    // State Machine Fields (24h window, assignment, lifecycle)
    lastInboundAt: timestamp("last_inbound_at"), // For 24h window calculation
    canSendFreeform: boolean("can_send_freeform").default(false), // Computed from lastInboundAt
    templateRequired: boolean("template_required").default(true), // True if outside 24h window
    assignedTo: varchar("assigned_to"), // User ID (VA/Contractor)
    priority: varchar("priority", { length: 10 }).default('normal'), // 'low', 'normal', 'high', 'urgent'
    stage: varchar("stage", { length: 20 }).default('new'), // 'new', 'active', 'waiting', 'closed'
    readAt: timestamp("read_at"), // When agent last read the conversation
    archivedAt: timestamp("archived_at"), // When conversation was archived

    // CRM Fields
    tags: text("tags").array(), // ['urgent', 'quote_sent']
    notes: text("notes"), // Internal notes for this conversation

    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
    index("idx_conversations_phone").on(table.phoneNumber),
    index("idx_conversations_last_message").on(table.lastMessageAt),
    index("idx_conversations_assigned").on(table.assignedTo),
    index("idx_conversations_stage").on(table.stage),
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
