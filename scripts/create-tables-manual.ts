
import { neon } from "@neondatabase/serverless";
import dotenv from "dotenv";

dotenv.config();

if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL must be set");
}

const sql = neon(process.env.DATABASE_URL);

async function main() {
    console.log("Creating tables manually...");
    try {
        // Create LEADS table
        await sql`
        CREATE TABLE IF NOT EXISTS "leads" (
            "id" varchar PRIMARY KEY NOT NULL,
            "customer_name" varchar NOT NULL,
            "phone" varchar NOT NULL,
            "email" varchar,
            "address" text,
            "job_description" text,
            "transcript_json" jsonb,
            "status" varchar DEFAULT 'new' NOT NULL,
            "source" varchar DEFAULT 'call',
            "created_at" timestamp DEFAULT now(),
            "updated_at" timestamp DEFAULT now()
        );
        `;
        console.log("Created leads table");

        // Create PERSONALIZED QUOTES table
        await sql`DROP TABLE IF EXISTS "personalized_quotes" CASCADE;`;
        await sql`
        CREATE TABLE "personalized_quotes" (
            "id" varchar PRIMARY KEY NOT NULL,
            "short_slug" varchar(8) NOT NULL,
            "contractor_id" varchar,
            "customer_name" varchar NOT NULL,
            "phone" varchar NOT NULL,
            "email" varchar,
            "postcode" varchar,
            "job_description" text NOT NULL,
            "completion_date" varchar,
            "tasks" text[],
            "categories" varchar(50)[],
            "substrates" varchar(50)[],
            "materials_by" varchar(20),
            "urgency" varchar(20),
            "persona" varchar(20),
            "risk" integer,
            "jobs" jsonb,
            "context_signals" jsonb,
            "urgency_reason" varchar(20),
            "ownership_context" varchar(20),
            "desired_timeframe" varchar(20),
            "base_job_price_pence" integer,
            "value_multiplier_100" integer,
            "recommended_tier" varchar(20),
            "additional_notes" text,
            "tier_deliverables" jsonb,
            "pvs_score" integer,
            "value_multiplier" integer,
            "dominant_category" varchar,
            "anchor_price" integer,
            "quote_mode" varchar(10) DEFAULT 'hhh' NOT NULL,
            "essential_price" integer,
            "enhanced_price" integer,
            "elite_price" integer,
            "base_price" integer,
            "optional_extras" jsonb,
            "materials_cost_with_markup_pence" integer DEFAULT 0,
            "value_opportunities" jsonb,
            "emotional_angle" varchar,
            "personalized_features" jsonb,
            "core_deliverables" jsonb,
            "potential_upgrades" jsonb,
            "potential_extras" jsonb,
            "desirables" jsonb,
            "viewed_at" timestamp,
            "selected_package" varchar,
            "selected_extras" jsonb,
            "selected_at" timestamp,
            "booked_at" timestamp,
            "lead_id" varchar,
            "expires_at" timestamp,
            "regenerated_from_id" varchar,
            "regeneration_count" integer DEFAULT 0,
            "extension_count" integer DEFAULT 0,
            "payment_type" varchar(20),
            "stripe_customer_id" varchar,
            "stripe_subscription_schedule_id" varchar,
            "stripe_payment_method_id" varchar,
            "stripe_payment_intent_id" varchar,
            "installment_status" varchar(20),
            "installment_amount_pence" integer,
            "total_installments" integer DEFAULT 3,
            "completed_installments" integer DEFAULT 0,
            "next_installment_date" timestamp,
            "deposit_paid_at" timestamp,
            "deposit_amount_pence" integer,
            "selected_tier_price_pence" integer,
            "created_at" timestamp DEFAULT now(),
            CONSTRAINT "personalized_quotes_short_slug_unique" UNIQUE("short_slug")
        );
        `;
        console.log("Created personalized_quotes table");

        // Create HANDYMAN PROFILES table
        await sql`DROP TABLE IF EXISTS "handyman_skills" CASCADE;`;
        await sql`DROP TABLE IF EXISTS "handyman_availability" CASCADE;`;
        await sql`DROP TABLE IF EXISTS "productized_services" CASCADE;`;
        await sql`DROP TABLE IF EXISTS "handyman_profiles" CASCADE;`;

        await sql`
        CREATE TABLE "handyman_profiles" (
            "id" varchar PRIMARY KEY NOT NULL,
            "user_id" varchar NOT NULL,
            "bio" text,
            "address" text,
            "city" varchar(100),
            "postcode" varchar(20),
            "latitude" text,
            "longitude" text,
            "radius_miles" integer NOT NULL DEFAULT 10,
            "calendar_sync_token" text,
            "slug" varchar(100) UNIQUE,
            "public_profile_enabled" boolean DEFAULT false,
            "hero_image_url" text,
            "social_links" jsonb,
            "created_at" timestamp DEFAULT now(),
            "updated_at" timestamp DEFAULT now()
        );
        `;
        console.log("Created handyman_profiles table");

        // Create PRODUCTIZED SERVICES (SKUs) table
        await sql`
        CREATE TABLE "productized_services" (
            "id" varchar PRIMARY KEY NOT NULL,
            "sku_code" varchar(50) UNIQUE NOT NULL,
            "name" varchar(200) NOT NULL,
            "description" text NOT NULL,
            "price_pence" integer NOT NULL,
            "time_estimate_minutes" integer NOT NULL,
            "keywords" text[] NOT NULL,
            "negative_keywords" text[],
            "ai_prompt_hint" text,
            "embedding_vector" text,
            "embedding" text,
            "category" varchar(50),
            "is_active" boolean DEFAULT true
        );
        `;
        console.log("Created productized_services table");

        // Create HANDYMAN SKILLS table
        await sql`
        CREATE TABLE "handyman_skills" (
            "id" varchar PRIMARY KEY NOT NULL,
            "handyman_id" varchar NOT NULL,
            "service_id" varchar NOT NULL
        );
        `;
        console.log("Created handyman_skills table");

        // Create HANDYMAN AVAILABILITY table
        await sql`
        CREATE TABLE "handyman_availability" (
            "id" varchar PRIMARY KEY NOT NULL,
            "handyman_id" varchar NOT NULL,
            "day_of_week" integer,
            "start_time" varchar(5),
            "end_time" varchar(5),
            "is_active" boolean NOT NULL DEFAULT true
        );
        `;
        console.log("Created handyman_availability table");


        console.log("Tables created successfully.");
    } catch (error) {
        console.error("Error creating tables:", error);
    }
}

main();
