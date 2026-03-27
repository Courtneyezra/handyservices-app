-- Migration: Add quote_section_events table for section engagement analytics
-- This table stores per-section dwell time data captured by the IntersectionObserver
-- on PersonalizedQuotePage. Events are POSTed to /api/analytics/quotes/section-event
-- without authentication (customers view quotes without logging in).

CREATE TABLE IF NOT EXISTS "quote_section_events" (
  "id" serial PRIMARY KEY NOT NULL,
  "quote_id" varchar(255) NOT NULL,
  "short_slug" varchar(50),
  "section" varchar(100) NOT NULL,
  "dwell_time_ms" integer NOT NULL DEFAULT 0,
  "scroll_depth_percent" integer,
  "device_type" varchar(20),
  "layout_tier" varchar(50),
  "created_at" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "idx_section_events_quote" ON "quote_section_events" ("quote_id");
CREATE INDEX IF NOT EXISTS "idx_section_events_section" ON "quote_section_events" ("section");
CREATE INDEX IF NOT EXISTS "idx_section_events_created" ON "quote_section_events" ("created_at");
