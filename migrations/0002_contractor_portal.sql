-- Contractor Portal Migration
-- Adds contractor authentication fields and availability/jobs tables

-- Add new columns to users table for contractor support
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "phone" varchar(20);
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "email_verified" boolean DEFAULT false;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "last_login" timestamp;

-- Create contractor availability dates table
CREATE TABLE IF NOT EXISTS "contractor_availability_dates" (
    "id" varchar PRIMARY KEY NOT NULL,
    "contractor_id" varchar NOT NULL REFERENCES "handyman_profiles"("id"),
    "date" timestamp NOT NULL,
    "is_available" boolean DEFAULT true NOT NULL,
    "start_time" varchar(5),
    "end_time" varchar(5),
    "notes" text,
    "created_at" timestamp DEFAULT now()
);

-- Create contractor jobs table
CREATE TABLE IF NOT EXISTS "contractor_jobs" (
    "id" varchar PRIMARY KEY NOT NULL,
    "contractor_id" varchar NOT NULL REFERENCES "handyman_profiles"("id"),
    "quote_id" varchar,
    "lead_id" varchar,
    "customer_name" varchar,
    "customer_phone" varchar,
    "address" text,
    "postcode" varchar(10),
    "job_description" text,
    "status" varchar(20) DEFAULT 'pending' NOT NULL,
    "scheduled_date" timestamp,
    "scheduled_time" varchar(5),
    "estimated_duration" integer,
    "payout_pence" integer,
    "accepted_at" timestamp,
    "completed_at" timestamp,
    "notes" text,
    "created_at" timestamp DEFAULT now(),
    "updated_at" timestamp DEFAULT now()
);

-- Create indexes
CREATE INDEX IF NOT EXISTS "idx_contractor_availability_date" ON "contractor_availability_dates" USING btree ("contractor_id", "date");
CREATE INDEX IF NOT EXISTS "idx_contractor_jobs_contractor" ON "contractor_jobs" USING btree ("contractor_id");
CREATE INDEX IF NOT EXISTS "idx_contractor_jobs_status" ON "contractor_jobs" USING btree ("status");