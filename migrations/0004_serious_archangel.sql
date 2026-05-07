CREATE TYPE "public"."application_status" AS ENUM('new', 'phone_screened', 'assessment_scheduled', 'assessed', 'offer_made', 'hired', 'rejected', 'withdrawn');--> statement-breakpoint
CREATE TYPE "public"."availability_status" AS ENUM('available', 'held', 'booked', 'unavailable');--> statement-breakpoint
CREATE TYPE "public"."bond_status" AS ENUM('pending', 'held', 'refunded', 'forfeited', 'failed');--> statement-breakpoint
CREATE TYPE "public"."completion_type" AS ENUM('full', 'partial', 'weather_hold', 'access_failed');--> statement-breakpoint
CREATE TYPE "public"."contractor_link_status" AS ENUM('pending', 'viewed', 'accepted', 'declined', 'questioning', 'locked_taken');--> statement-breakpoint
CREATE TYPE "public"."contractor_segment" AS ENUM('builder', 'gap_filler', 'specialist');--> statement-breakpoint
CREATE TYPE "public"."day_commitment_status" AS ENUM('open', 'assembling', 'offered', 'accepted', 'released', 'expired');--> statement-breakpoint
CREATE TYPE "public"."day_of_status" AS ENUM('scheduled', 'en_route', 'arrived', 'in_progress', 'access_failed', 'customer_unreachable', 'completed', 'cancelled_day_of');--> statement-breakpoint
CREATE TYPE "public"."day_pack_status" AS ENUM('proposed', 'offered', 'accepted', 'declined', 'cancelled', 'completed');--> statement-breakpoint
CREATE TYPE "public"."dispatch_status" AS ENUM('pending', 'locked', 'completed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."dispute_resolution" AS ENUM('refund_full', 'refund_partial', 'return_visit', 'no_action', 'insurance_claim');--> statement-breakpoint
CREATE TYPE "public"."dispute_status" AS ENUM('open', 'investigating', 'awaiting_contractor', 'awaiting_customer', 'resolved', 'escalated', 'closed');--> statement-breakpoint
CREATE TYPE "public"."dispute_type" AS ENUM('quality', 'incomplete', 'damage', 'no_show', 'overcharge', 'other');--> statement-breakpoint
CREATE TYPE "public"."flex_tier" AS ENUM('fast', 'flexible', 'relaxed');--> statement-breakpoint
CREATE TYPE "public"."incident_type" AS ENUM('damage', 'safety_issue', 'weather_delay', 'access_issue', 'other');--> statement-breakpoint
CREATE TYPE "public"."issue_category" AS ENUM('plumbing', 'plumbing_emergency', 'electrical', 'electrical_emergency', 'heating', 'carpentry', 'locksmith', 'security', 'water_leak', 'appliance', 'cosmetic', 'upgrade', 'pest_control', 'cleaning', 'garden', 'general', 'other');--> statement-breakpoint
CREATE TYPE "public"."lead_route" AS ENUM('video', 'instant_quote', 'site_visit');--> statement-breakpoint
CREATE TYPE "public"."lead_segment" AS ENUM('EMERGENCY', 'BUSY_PRO', 'PROP_MGR', 'LANDLORD', 'SMALL_BIZ', 'TRUST_SEEKER', 'RENTER', 'DIY_DEFERRER', 'BUDGET', 'DEFAULT');--> statement-breakpoint
CREATE TYPE "public"."lead_stage" AS ENUM('new_lead', 'contacted', 'awaiting_video', 'video_received', 'visit_scheduled', 'visit_done', 'quote_sent', 'quote_viewed', 'awaiting_payment', 'booked', 'in_progress', 'completed', 'lost', 'expired', 'declined', 'new', 'pending', 'complete');--> statement-breakpoint
CREATE TYPE "public"."materials_pickup_status" AS ENUM('pending', 'collected', 'skipped');--> statement-breakpoint
CREATE TYPE "public"."partner_enquiry_status" AS ENUM('new', 'contacted', 'qualified', 'meeting_scheduled', 'in_negotiation', 'signed', 'declined');--> statement-breakpoint
CREATE TYPE "public"."pay_adjustment_status" AS ENUM('auto_approved', 'pending_review', 'admin_approved', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."pay_adjustment_type" AS ENUM('misscope_uplift', 'callout_fee', 'cancellation_comp', 'materials_reimbursement', 'day_rate_topup', 'completion_bonus');--> statement-breakpoint
CREATE TYPE "public"."payout_status" AS ENUM('pending', 'processing', 'paid', 'failed', 'held', 'reversed');--> statement-breakpoint
CREATE TYPE "public"."property_type" AS ENUM('flat', 'house', 'hmo', 'commercial', 'mixed_use');--> statement-breakpoint
CREATE TYPE "public"."qualification_grade" AS ENUM('HOT', 'WARM', 'COLD');--> statement-breakpoint
CREATE TYPE "public"."routing_offer_status" AS ENUM('pending', 'accepted', 'declined', 'expired', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."scheduled_slot" AS ENUM('am', 'pm', 'full_day');--> statement-breakpoint
CREATE TYPE "public"."slot" AS ENUM('am', 'pm', 'full');--> statement-breakpoint
CREATE TYPE "public"."tenant_issue_status" AS ENUM('new', 'ai_helping', 'awaiting_details', 'reported', 'quoted', 'approved', 'scheduled', 'completed', 'resolved_diy', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."tenant_issue_urgency" AS ENUM('low', 'medium', 'high', 'emergency');--> statement-breakpoint
CREATE TYPE "public"."unit_type" AS ENUM('single', 'team');--> statement-breakpoint
CREATE TYPE "public"."variation_status" AS ENUM('pending_approval', 'approved', 'rejected', 'completed');--> statement-breakpoint
CREATE TYPE "public"."variation_status_dispatch" AS ENUM('pending', 'approved', 'rejected');--> statement-breakpoint
CREATE TABLE "availability_slots" (
	"id" text PRIMARY KEY NOT NULL,
	"date" date NOT NULL,
	"start_time" text NOT NULL,
	"end_time" text NOT NULL,
	"slot_type" text NOT NULL,
	"is_booked" boolean DEFAULT false NOT NULL,
	"booked_by_lead_id" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "booking_slot_locks" (
	"id" serial PRIMARY KEY NOT NULL,
	"quote_id" varchar NOT NULL,
	"contractor_id" varchar(255) NOT NULL,
	"scheduled_date" timestamp NOT NULL,
	"scheduled_slot" "scheduled_slot" NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "booking_state_log" (
	"id" text PRIMARY KEY NOT NULL,
	"booking_id" varchar NOT NULL,
	"from_state" varchar(40),
	"to_state" varchar(40) NOT NULL,
	"triggered_by" varchar(40) NOT NULL,
	"trigger_metadata" jsonb DEFAULT '{}'::jsonb,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "client_references" (
	"id" varchar PRIMARY KEY NOT NULL,
	"application_id" varchar NOT NULL,
	"client_name" varchar NOT NULL,
	"client_email" varchar NOT NULL,
	"client_phone" varchar(20),
	"job_description" text,
	"request_sent_at" timestamp,
	"request_token" varchar(64),
	"response_received_at" timestamp,
	"rating" integer,
	"feedback" text,
	"would_recommend" boolean,
	"verified" boolean DEFAULT false,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "content_booking_rules" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"conditions" jsonb NOT NULL,
	"booking_modes" text[] NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "content_claims" (
	"id" serial PRIMARY KEY NOT NULL,
	"text" text NOT NULL,
	"category" text,
	"job_categories" text[],
	"signals" jsonb,
	"is_active" boolean DEFAULT true NOT NULL,
	"usage_count" integer DEFAULT 0 NOT NULL,
	"view_count" integer DEFAULT 0 NOT NULL,
	"booking_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "content_guarantees" (
	"id" serial PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"items" jsonb,
	"badges" jsonb,
	"job_categories" text[],
	"signals" jsonb,
	"is_active" boolean DEFAULT true NOT NULL,
	"usage_count" integer DEFAULT 0 NOT NULL,
	"view_count" integer DEFAULT 0 NOT NULL,
	"booking_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "content_hassle_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"without_us" text NOT NULL,
	"with_us" text NOT NULL,
	"job_categories" text[],
	"signals" jsonb,
	"is_active" boolean DEFAULT true NOT NULL,
	"usage_count" integer DEFAULT 0 NOT NULL,
	"view_count" integer DEFAULT 0 NOT NULL,
	"booking_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "content_images" (
	"id" serial PRIMARY KEY NOT NULL,
	"url" text NOT NULL,
	"alt" text,
	"placement" text,
	"job_categories" text[],
	"is_active" boolean DEFAULT true NOT NULL,
	"usage_count" integer DEFAULT 0 NOT NULL,
	"view_count" integer DEFAULT 0 NOT NULL,
	"booking_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "content_testimonials" (
	"id" serial PRIMARY KEY NOT NULL,
	"text" text NOT NULL,
	"author" text NOT NULL,
	"location" text,
	"rating" integer DEFAULT 5 NOT NULL,
	"job_categories" text[],
	"source" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"usage_count" integer DEFAULT 0 NOT NULL,
	"view_count" integer DEFAULT 0 NOT NULL,
	"booking_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contractor_job_links" (
	"id" text PRIMARY KEY NOT NULL,
	"dispatch_id" text NOT NULL,
	"contractor_id" varchar NOT NULL,
	"contractor_name" text,
	"contractor_phone" text,
	"token" varchar(64) NOT NULL,
	"status" "contractor_link_status" DEFAULT 'pending' NOT NULL,
	"warnings_acknowledged" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"response_message" text,
	"viewed_at" timestamp,
	"accepted_at" timestamp,
	"declined_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "contractor_job_links_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "contractor_payouts" (
	"id" serial PRIMARY KEY NOT NULL,
	"job_id" varchar,
	"contractor_id" varchar NOT NULL,
	"quote_id" varchar,
	"invoice_id" varchar,
	"gross_amount_pence" integer NOT NULL,
	"platform_fee_pence" integer NOT NULL,
	"net_payout_pence" integer NOT NULL,
	"variation_amount_pence" integer DEFAULT 0,
	"stripe_transfer_id" varchar(255),
	"stripe_transfer_status" varchar(50),
	"stripe_account_id" varchar(255),
	"status" "payout_status" DEFAULT 'pending' NOT NULL,
	"failure_reason" text,
	"held_reason" text,
	"scheduled_payout_at" timestamp,
	"paid_at" timestamp,
	"reversed_at" timestamp,
	"reversal_reason" text,
	"stripe_reversal_id" varchar(255),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contractor_reviews" (
	"id" varchar PRIMARY KEY NOT NULL,
	"contractor_id" varchar NOT NULL,
	"customer_name" varchar NOT NULL,
	"customer_email" varchar,
	"quote_id" varchar,
	"overall_rating" integer NOT NULL,
	"quality_rating" integer,
	"timeliness_rating" integer,
	"communication_rating" integer,
	"value_rating" integer,
	"review_text" text,
	"review_token" varchar(64),
	"is_verified" boolean DEFAULT false,
	"is_public" boolean DEFAULT true,
	"contractor_response" text,
	"responded_at" timestamp,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "credit_notes" (
	"id" serial PRIMARY KEY NOT NULL,
	"invoice_id" varchar NOT NULL,
	"reason" text NOT NULL,
	"amount_pence" integer NOT NULL,
	"line_items" jsonb,
	"issued_at" timestamp DEFAULT now() NOT NULL,
	"issued_by" varchar(255),
	"refund_stripe_payment_intent_id" varchar(255),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "day_commitments" (
	"id" text PRIMARY KEY NOT NULL,
	"unit_id" varchar NOT NULL,
	"date" date NOT NULL,
	"start_time" time DEFAULT '08:00' NOT NULL,
	"end_time" time DEFAULT '17:00' NOT NULL,
	"area_filter" jsonb DEFAULT '[]'::jsonb,
	"target_pence" integer NOT NULL,
	"status" "day_commitment_status" DEFAULT 'open' NOT NULL,
	"locked_at" timestamp with time zone,
	"released_at" timestamp with time zone,
	"released_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "day_packs" (
	"id" text PRIMARY KEY NOT NULL,
	"commitment_id" text NOT NULL,
	"unit_id" varchar NOT NULL,
	"date" date NOT NULL,
	"status" "day_pack_status" DEFAULT 'proposed' NOT NULL,
	"job_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"total_contractor_pay_pence" integer NOT NULL,
	"total_customer_pay_pence" integer NOT NULL,
	"estimated_hours" numeric(4, 2) NOT NULL,
	"travel_minutes" integer DEFAULT 0 NOT NULL,
	"route_summary" jsonb,
	"top_up_pence" integer DEFAULT 0,
	"offered_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"accepted_at" timestamp with time zone,
	"declined_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "deflection_metrics" (
	"id" text PRIMARY KEY NOT NULL,
	"issue_id" text,
	"session_id" text,
	"issue_category" text,
	"flow_id" text,
	"was_deflected" boolean NOT NULL,
	"deflection_type" text,
	"steps_completed" integer,
	"total_steps_in_flow" integer,
	"time_to_resolution_ms" integer,
	"had_follow_up" boolean DEFAULT false,
	"follow_up_within_24h" boolean DEFAULT false,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "dispatch_bonds" (
	"id" text PRIMARY KEY NOT NULL,
	"link_id" text NOT NULL,
	"dispatch_id" text NOT NULL,
	"contractor_id" varchar NOT NULL,
	"amount_pence" integer NOT NULL,
	"stripe_payment_intent_id" varchar(255),
	"stripe_charge_id" varchar(255),
	"stripe_refund_id" varchar(255),
	"status" "bond_status" DEFAULT 'pending' NOT NULL,
	"paid_at" timestamp,
	"refunded_at" timestamp,
	"refund_reason" text,
	"forfeited_at" timestamp,
	"forfeited_by" varchar,
	"forfeit_reason" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dispatch_completions" (
	"id" text PRIMARY KEY NOT NULL,
	"dispatch_id" text NOT NULL,
	"contractor_id" varchar NOT NULL,
	"photo_urls" text[] NOT NULL,
	"notes" text,
	"customer_signature_url" text,
	"completed_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "dispatch_completions_dispatch_id_unique" UNIQUE("dispatch_id")
);
--> statement-breakpoint
CREATE TABLE "dispatch_variations" (
	"id" text PRIMARY KEY NOT NULL,
	"dispatch_id" text NOT NULL,
	"contractor_id" varchar NOT NULL,
	"task_num" integer,
	"description" text NOT NULL,
	"reason" text,
	"additional_price_pence" integer DEFAULT 0,
	"additional_time_mins" integer DEFAULT 0,
	"photo_urls" text[],
	"status" "variation_status_dispatch" DEFAULT 'pending' NOT NULL,
	"admin_notes" text,
	"resolved_at" timestamp,
	"resolved_by" varchar,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "disputes" (
	"id" serial PRIMARY KEY NOT NULL,
	"job_id" varchar,
	"invoice_id" varchar,
	"quote_id" varchar,
	"contractor_id" varchar,
	"customer_name" varchar(255),
	"customer_phone" varchar(50),
	"customer_email" varchar(255),
	"type" "dispute_type" NOT NULL,
	"status" "dispute_status" DEFAULT 'open' NOT NULL,
	"priority" varchar(20) DEFAULT 'medium',
	"customer_description" text,
	"customer_evidence_urls" text[],
	"contractor_response" text,
	"contractor_evidence_urls" text[],
	"disputed_line_items" jsonb,
	"resolution" "dispute_resolution",
	"resolution_notes" text,
	"resolved_by" varchar(255),
	"resolved_at" timestamp,
	"refund_amount_pence" integer,
	"refund_stripe_refund_id" varchar(255),
	"return_visit_job_id" varchar,
	"insurance_claim_ref" varchar(255),
	"contractor_penalty_applied" boolean DEFAULT false,
	"payout_reversal_id" integer,
	"escalated_at" timestamp,
	"escalated_to" varchar(255),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "diy_advice" (
	"id" text PRIMARY KEY NOT NULL,
	"name" varchar(200) NOT NULL,
	"category" "issue_category",
	"keywords" text[] NOT NULL,
	"description_patterns" text[],
	"can_diy" boolean DEFAULT true NOT NULL,
	"steps" text[] NOT NULL,
	"tools_needed" text[],
	"warning" text,
	"priority" integer DEFAULT 0,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invoice_tokens" (
	"id" varchar PRIMARY KEY NOT NULL,
	"invoice_id" varchar NOT NULL,
	"token" varchar(64) NOT NULL,
	"view_count" integer DEFAULT 0,
	"last_viewed_at" timestamp,
	"expires_at" timestamp,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "invoice_tokens_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "job_applications" (
	"id" text PRIMARY KEY NOT NULL,
	"first_name" text NOT NULL,
	"last_name" text NOT NULL,
	"phone" text NOT NULL,
	"email" text,
	"postcode" text,
	"trades" text[],
	"years_experience" text,
	"has_own_tools" boolean,
	"has_driving_licence" boolean,
	"has_cscs" boolean,
	"current_situation" text,
	"cover_note" text,
	"source" text,
	"status" "application_status" DEFAULT 'new' NOT NULL,
	"status_notes" text,
	"rating" integer,
	"assessment_silicone" integer,
	"assessment_carpentry" integer,
	"assessment_painting" integer,
	"assessment_mounting" integer,
	"assessment_notes" text,
	"applied_at" timestamp DEFAULT now() NOT NULL,
	"screened_at" timestamp,
	"assessed_at" timestamp,
	"hired_at" timestamp,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "job_dispatches" (
	"id" text PRIMARY KEY NOT NULL,
	"quote_id" varchar,
	"invoice_id" varchar,
	"title" text NOT NULL,
	"subtitle" text,
	"customer_first_name" text NOT NULL,
	"customer_full_name" text,
	"customer_phone" text,
	"customer_address" text,
	"postcode" text NOT NULL,
	"tasks" jsonb NOT NULL,
	"total_hours" integer NOT NULL,
	"total_contractor_pay_pence" integer NOT NULL,
	"customer_revenue_pence" integer,
	"platform_keeps_pence" integer,
	"status" "dispatch_status" DEFAULT 'pending' NOT NULL,
	"locked_to_contractor_id" varchar,
	"locked_at" timestamp,
	"completed_at" timestamp,
	"scheduled_date" timestamp,
	"public_token" varchar(64),
	"proposal_summary" text,
	"preferred_dates" jsonb,
	"media_urls" text[],
	"bond_required" boolean DEFAULT false NOT NULL,
	"bond_amount_pence" integer,
	"view_count" integer DEFAULT 0 NOT NULL,
	"last_viewed_at" timestamp,
	"created_by" varchar,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "job_dispatches_public_token_unique" UNIQUE("public_token")
);
--> statement-breakpoint
CREATE TABLE "job_incidents" (
	"id" serial PRIMARY KEY NOT NULL,
	"job_id" varchar NOT NULL,
	"reported_by_contractor_id" varchar NOT NULL,
	"type" "incident_type" NOT NULL,
	"description" text NOT NULL,
	"evidence_urls" text[],
	"insurance_claim_required" boolean DEFAULT false,
	"insurance_claim_ref" varchar(255),
	"resolution" text,
	"resolved_at" timestamp,
	"resolved_by" varchar(255),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "job_sheets" (
	"id" serial PRIMARY KEY NOT NULL,
	"job_id" varchar NOT NULL,
	"quote_id" varchar,
	"line_items" jsonb,
	"access_instructions" text,
	"parking_notes" text,
	"customer_contact_preference" varchar(50),
	"materials_checklist" jsonb,
	"special_equipment_needed" text,
	"generated_at" timestamp DEFAULT now() NOT NULL,
	"viewed_by_contractor_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "landlord_settings" (
	"id" text PRIMARY KEY NOT NULL,
	"landlord_lead_id" text NOT NULL,
	"auto_approve_under_pence" integer DEFAULT 15000,
	"require_approval_above_pence" integer DEFAULT 50000,
	"auto_approve_categories" text[] DEFAULT '{"plumbing_emergency","heating","security","water_leak"}',
	"always_require_approval_categories" text[] DEFAULT '{"cosmetic","upgrade"}',
	"emergency_auto_dispatch" boolean DEFAULT true,
	"emergency_contact_phone" varchar(20),
	"monthly_budget_pence" integer,
	"budget_alert_threshold" integer DEFAULT 80,
	"current_month_spend_pence" integer DEFAULT 0,
	"budget_reset_day" integer DEFAULT 1,
	"notify_on_auto_approve" boolean DEFAULT true,
	"notify_on_completion" boolean DEFAULT true,
	"notify_on_new_issue" boolean DEFAULT true,
	"preferred_channel" text DEFAULT 'whatsapp',
	"is_partner_member" boolean DEFAULT false,
	"partner_discount_percent" integer DEFAULT 0,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "landlord_settings_landlord_lead_id_unique" UNIQUE("landlord_lead_id")
);
--> statement-breakpoint
CREATE TABLE "live_call_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"call_id" text NOT NULL,
	"phone" text NOT NULL,
	"current_station" text DEFAULT 'LISTEN' NOT NULL,
	"completed_stations" text[] DEFAULT '{}',
	"detected_segment" text,
	"segment_confidence" integer,
	"segment_signals" text[],
	"captured_info" jsonb DEFAULT '{}'::jsonb,
	"is_qualified" boolean,
	"qualification_notes" text[],
	"recommended_destination" text,
	"selected_destination" text,
	"station_entered_at" timestamp,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "master_availability" (
	"id" serial PRIMARY KEY NOT NULL,
	"day_of_week" integer NOT NULL,
	"start_time" varchar(5),
	"end_time" varchar(5),
	"is_active" boolean DEFAULT true,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "master_blocked_dates" (
	"id" serial PRIMARY KEY NOT NULL,
	"date" date NOT NULL,
	"reason" varchar(255),
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "materials_pickups" (
	"id" text PRIMARY KEY NOT NULL,
	"day_pack_id" text NOT NULL,
	"supplier" varchar(60) NOT NULL,
	"branch_name" varchar(120),
	"postcode" varchar(10) NOT NULL,
	"open_from" time,
	"estimated_minutes" integer DEFAULT 30 NOT NULL,
	"items" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" "materials_pickup_status" DEFAULT 'pending' NOT NULL,
	"collected_at" timestamp with time zone,
	"collected_by_unit_id" varchar,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "partner_applications" (
	"id" varchar PRIMARY KEY NOT NULL,
	"contractor_id" varchar NOT NULL,
	"status" varchar(30) DEFAULT 'not_started' NOT NULL,
	"insurance_status" varchar(20) DEFAULT 'pending',
	"insurance_document_url" text,
	"insurance_policy_number" varchar(100),
	"insurance_expiry_date" timestamp,
	"insurance_verified_at" timestamp,
	"identity_status" varchar(20) DEFAULT 'pending',
	"identity_document_url" text,
	"dbs_certificate_url" text,
	"identity_verified_at" timestamp,
	"references_status" varchar(20) DEFAULT 'pending',
	"references_verified_at" timestamp,
	"training_status" varchar(20) DEFAULT 'incomplete',
	"training_completed_at" timestamp,
	"agreement_signed_at" timestamp,
	"highvis_size" varchar(10),
	"activated_at" timestamp,
	"admin_notes" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "partner_enquiries" (
	"id" text PRIMARY KEY NOT NULL,
	"full_name" text NOT NULL,
	"email" text NOT NULL,
	"phone" text NOT NULL,
	"territory_interest" text,
	"investment_budget" text,
	"current_situation" text,
	"message" text,
	"status" "partner_enquiry_status" DEFAULT 'new' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "pay_adjustments" (
	"id" text PRIMARY KEY NOT NULL,
	"dispatch_id" text NOT NULL,
	"unit_id" varchar NOT NULL,
	"type" "pay_adjustment_type" NOT NULL,
	"amount_pence" integer NOT NULL,
	"reason" text NOT NULL,
	"evidence_photos" jsonb DEFAULT '[]'::jsonb,
	"variance_pct" numeric(5, 2),
	"status" "pay_adjustment_status" DEFAULT 'pending_review' NOT NULL,
	"resolved_at" timestamp with time zone,
	"resolved_by" varchar,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment_links" (
	"id" varchar PRIMARY KEY NOT NULL,
	"contractor_id" varchar NOT NULL,
	"quote_id" varchar,
	"invoice_id" varchar,
	"short_code" varchar(10) NOT NULL,
	"amount_pence" integer NOT NULL,
	"description" text,
	"customer_name" varchar,
	"customer_email" varchar,
	"status" varchar(20) DEFAULT 'active' NOT NULL,
	"stripe_payment_intent_id" varchar,
	"expires_at" timestamp,
	"paid_at" timestamp,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "payment_links_short_code_unique" UNIQUE("short_code")
);
--> statement-breakpoint
CREATE TABLE "properties" (
	"id" text PRIMARY KEY NOT NULL,
	"landlord_lead_id" text NOT NULL,
	"address" text NOT NULL,
	"postcode" varchar(10) NOT NULL,
	"property_type" "property_type",
	"nickname" text,
	"notes" text,
	"coordinates" jsonb,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "push_subscriptions" (
	"id" serial PRIMARY KEY NOT NULL,
	"endpoint" text NOT NULL,
	"p256dh" text NOT NULL,
	"auth" text NOT NULL,
	"user_agent" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "push_subscriptions_endpoint_unique" UNIQUE("endpoint")
);
--> statement-breakpoint
CREATE TABLE "quote_extras_catalog" (
	"id" serial PRIMARY KEY NOT NULL,
	"label" varchar(120) NOT NULL,
	"description" text NOT NULL,
	"price_in_pence" integer NOT NULL,
	"badge" varchar(40),
	"sort_order" integer DEFAULT 100 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"pick_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quote_platform_headlines" (
	"id" serial PRIMARY KEY NOT NULL,
	"section" varchar(50) NOT NULL,
	"text" text NOT NULL,
	"customer_type" varchar(50) DEFAULT 'homeowners' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"view_count" integer DEFAULT 0 NOT NULL,
	"booking_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quote_platform_images" (
	"id" serial PRIMARY KEY NOT NULL,
	"url" text NOT NULL,
	"filename" text NOT NULL,
	"alt_text" text,
	"archetypes" jsonb DEFAULT '[]'::jsonb,
	"gender_cue" varchar(20) DEFAULT 'neutral',
	"job_types" jsonb DEFAULT '[]'::jsonb,
	"is_active" boolean DEFAULT true NOT NULL,
	"view_count" integer DEFAULT 0 NOT NULL,
	"booking_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quote_platform_testimonials" (
	"id" serial PRIMARY KEY NOT NULL,
	"author" text NOT NULL,
	"text" text NOT NULL,
	"rating" integer DEFAULT 5 NOT NULL,
	"archetype" varchar(50) DEFAULT 'homeowner',
	"location" text,
	"source" varchar(20) DEFAULT 'manual',
	"is_active" boolean DEFAULT true NOT NULL,
	"view_count" integer DEFAULT 0 NOT NULL,
	"booking_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quote_section_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"quote_id" varchar(255) NOT NULL,
	"short_slug" varchar(50),
	"section" varchar(100) NOT NULL,
	"dwell_time_ms" integer DEFAULT 0 NOT NULL,
	"scroll_depth_percent" integer,
	"device_type" varchar(20),
	"layout_tier" varchar(50),
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "route_distance_cache" (
	"id" text PRIMARY KEY NOT NULL,
	"origin_postcode" varchar(10) NOT NULL,
	"dest_postcode" varchar(10) NOT NULL,
	"time_bucket" varchar(20) NOT NULL,
	"drive_minutes" integer NOT NULL,
	"drive_miles" numeric(6, 2) NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "routing_decisions" (
	"id" text PRIMARY KEY NOT NULL,
	"booking_id" varchar NOT NULL,
	"decision_type" varchar(40) NOT NULL,
	"inputs" jsonb NOT NULL,
	"outputs" jsonb NOT NULL,
	"decided_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_by" varchar(40) DEFAULT 'system' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "routing_offers" (
	"id" text PRIMARY KEY NOT NULL,
	"booking_id" varchar NOT NULL,
	"job_dispatch_id" text,
	"day_pack_id" text,
	"unit_id" varchar NOT NULL,
	"round" integer DEFAULT 1 NOT NULL,
	"status" "routing_offer_status" DEFAULT 'pending' NOT NULL,
	"offered_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"responded_at" timestamp with time zone,
	"decline_reason" text,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "routing_weights" (
	"id" text PRIMARY KEY NOT NULL,
	"weight_key" varchar(60) NOT NULL,
	"weight_value" numeric(8, 4) NOT NULL,
	"effective_from" timestamp with time zone DEFAULT now() NOT NULL,
	"effective_to" timestamp with time zone,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tenant_issues" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"property_id" text NOT NULL,
	"landlord_lead_id" text NOT NULL,
	"status" "tenant_issue_status" DEFAULT 'new' NOT NULL,
	"issue_description" text,
	"issue_category" "issue_category",
	"urgency" "tenant_issue_urgency",
	"ai_resolution_attempted" boolean DEFAULT false,
	"ai_suggestions" jsonb,
	"ai_resolution_accepted" boolean,
	"photos" text[],
	"voice_notes" text[],
	"tenant_availability" text,
	"additional_notes" text,
	"access_instructions" text,
	"dispatch_decision" text,
	"dispatch_reason" text,
	"price_estimate_low_pence" integer,
	"price_estimate_high_pence" integer,
	"quote_id" text,
	"job_id" text,
	"conversation_id" text,
	"landlord_notified_at" timestamp,
	"landlord_reminder_count" integer DEFAULT 0,
	"landlord_last_reminded_at" timestamp,
	"landlord_approved_at" timestamp,
	"landlord_rejected_at" timestamp,
	"landlord_rejection_reason" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"reported_to_landlord_at" timestamp,
	"resolved_at" timestamp,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tenants" (
	"id" text PRIMARY KEY NOT NULL,
	"property_id" text NOT NULL,
	"name" text NOT NULL,
	"phone" varchar(20) NOT NULL,
	"email" text,
	"is_primary" boolean DEFAULT true,
	"is_active" boolean DEFAULT true NOT NULL,
	"whatsapp_opt_in" boolean DEFAULT false,
	"last_contact_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "training_modules" (
	"id" varchar PRIMARY KEY NOT NULL,
	"slug" varchar(50) NOT NULL,
	"title" varchar(200) NOT NULL,
	"description" text,
	"duration_minutes" integer DEFAULT 10,
	"video_url" text,
	"thumbnail_url" text,
	"quiz_questions" jsonb,
	"pass_threshold" integer DEFAULT 80,
	"order_index" integer NOT NULL,
	"is_required" boolean DEFAULT true,
	"is_active" boolean DEFAULT true,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "training_modules_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "training_progress" (
	"id" varchar PRIMARY KEY NOT NULL,
	"contractor_id" varchar NOT NULL,
	"module_id" varchar NOT NULL,
	"started_at" timestamp,
	"video_watched_at" timestamp,
	"completed_at" timestamp,
	"quiz_score" integer,
	"passed" boolean DEFAULT false,
	"attempts" integer DEFAULT 0,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "troubleshooting_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"issue_id" text,
	"flow_id" text NOT NULL,
	"current_step_id" text,
	"step_history" jsonb,
	"status" text DEFAULT 'active',
	"attempt_count" integer DEFAULT 0,
	"max_attempts" integer DEFAULT 3,
	"collected_data" jsonb,
	"outcome" text,
	"outcome_reason" text,
	"started_at" timestamp DEFAULT now(),
	"completed_at" timestamp,
	"last_activity_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "unit_availability" (
	"id" text PRIMARY KEY NOT NULL,
	"unit_id" varchar NOT NULL,
	"date" date NOT NULL,
	"slot" "slot" NOT NULL,
	"status" "availability_status" DEFAULT 'available' NOT NULL,
	"crew_available_count" integer DEFAULT 1 NOT NULL,
	"hold_expires_at" timestamp with time zone,
	"hold_for_booking_id" varchar,
	"last_synced_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "unsafe_patterns" (
	"id" text PRIMARY KEY NOT NULL,
	"pattern" varchar(200) NOT NULL,
	"is_regex" boolean DEFAULT false NOT NULL,
	"warning_message" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "variation_orders" (
	"id" serial PRIMARY KEY NOT NULL,
	"job_id" varchar NOT NULL,
	"requested_by_contractor_id" varchar NOT NULL,
	"description" text NOT NULL,
	"additional_price_pence" integer NOT NULL,
	"additional_time_mins" integer,
	"materials_required" text,
	"materials_cost_pence" integer DEFAULT 0,
	"status" "variation_status" DEFAULT 'pending_approval' NOT NULL,
	"customer_approval_method" varchar(50),
	"customer_approval_at" timestamp,
	"customer_approval_signature" text,
	"admin_approval_required" boolean DEFAULT false,
	"admin_approved_at" timestamp,
	"admin_approved_by" varchar(255),
	"approval_token" varchar(100),
	"evidence_urls" text[],
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wtbp_rate_card" (
	"id" serial PRIMARY KEY NOT NULL,
	"category_slug" varchar(100) NOT NULL,
	"rate_pence" integer NOT NULL,
	"rate_type" varchar(20) DEFAULT 'hourly',
	"effective_from" timestamp DEFAULT now() NOT NULL,
	"effective_to" timestamp,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "handyman_skills" ALTER COLUMN "service_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "leads" ALTER COLUMN "segment" SET DATA TYPE lead_segment;--> statement-breakpoint
ALTER TABLE "leads" ALTER COLUMN "segment" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "personalized_quotes" ALTER COLUMN "customer_name" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "personalized_quotes" ALTER COLUMN "phone" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "personalized_quotes" ALTER COLUMN "quote_mode" SET DEFAULT 'simple';--> statement-breakpoint
ALTER TABLE "personalized_quotes" ALTER COLUMN "proposal_mode_enabled" SET DEFAULT true;--> statement-breakpoint
ALTER TABLE "calls" ADD COLUMN "inbound_recording_url" varchar;--> statement-breakpoint
ALTER TABLE "calls" ADD COLUMN "outbound_recording_url" varchar;--> statement-breakpoint
ALTER TABLE "calls" ADD COLUMN "site_visit_reason" varchar;--> statement-breakpoint
ALTER TABLE "calls" ADD COLUMN "action_taken_at" timestamp;--> statement-breakpoint
ALTER TABLE "calls" ADD COLUMN "booking_link_sent" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "calls" ADD COLUMN "video_request_sent_at" timestamp;--> statement-breakpoint
ALTER TABLE "contractor_booking_requests" ADD COLUMN "decline_reason" varchar(50);--> statement-breakpoint
ALTER TABLE "contractor_booking_requests" ADD COLUMN "decline_notes" text;--> statement-breakpoint
ALTER TABLE "contractor_booking_requests" ADD COLUMN "needs_reassignment" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "contractor_booking_requests" ADD COLUMN "signature_data_url" text;--> statement-breakpoint
ALTER TABLE "contractor_booking_requests" ADD COLUMN "time_on_job_seconds" integer;--> statement-breakpoint
ALTER TABLE "contractor_booking_requests" ADD COLUMN "scheduled_slot" "scheduled_slot";--> statement-breakpoint
ALTER TABLE "contractor_booking_requests" ADD COLUMN "day_of_status" "day_of_status" DEFAULT 'scheduled';--> statement-breakpoint
ALTER TABLE "contractor_booking_requests" ADD COLUMN "en_route_at" timestamp;--> statement-breakpoint
ALTER TABLE "contractor_booking_requests" ADD COLUMN "arrived_at" timestamp;--> statement-breakpoint
ALTER TABLE "contractor_booking_requests" ADD COLUMN "timer_started_at" timestamp;--> statement-breakpoint
ALTER TABLE "contractor_booking_requests" ADD COLUMN "timer_paused_at" timestamp;--> statement-breakpoint
ALTER TABLE "contractor_booking_requests" ADD COLUMN "timer_accumulated_seconds" integer DEFAULT 0;--> statement-breakpoint
ALTER TABLE "contractor_booking_requests" ADD COLUMN "must_check_in_by" timestamp;--> statement-breakpoint
ALTER TABLE "contractor_booking_requests" ADD COLUMN "completion_type" "completion_type";--> statement-breakpoint
ALTER TABLE "contractor_booking_requests" ADD COLUMN "customer_declined_signature" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "contractor_booking_requests" ADD COLUMN "customer_declined_signature_reason" text;--> statement-breakpoint
ALTER TABLE "contractor_booking_requests" ADD COLUMN "payout_scheduled_at" timestamp;--> statement-breakpoint
ALTER TABLE "contractor_booking_requests" ADD COLUMN "customer_access_notes" text;--> statement-breakpoint
ALTER TABLE "handyman_profiles" ADD COLUMN "subscription_tier" varchar(20) DEFAULT 'free';--> statement-breakpoint
ALTER TABLE "handyman_profiles" ADD COLUMN "partner_status" varchar(30) DEFAULT 'not_started';--> statement-breakpoint
ALTER TABLE "handyman_profiles" ADD COLUMN "partner_activated_at" timestamp;--> statement-breakpoint
ALTER TABLE "handyman_profiles" ADD COLUMN "last_availability_refresh" timestamp;--> statement-breakpoint
ALTER TABLE "handyman_profiles" ADD COLUMN "last_assigned_at" timestamp;--> statement-breakpoint
ALTER TABLE "handyman_profiles" ADD COLUMN "contractor_segment" "contractor_segment";--> statement-breakpoint
ALTER TABLE "handyman_profiles" ADD COLUMN "unit_type" "unit_type" DEFAULT 'single';--> statement-breakpoint
ALTER TABLE "handyman_profiles" ADD COLUMN "crew_max" integer DEFAULT 1;--> statement-breakpoint
ALTER TABLE "handyman_profiles" ADD COLUMN "home_postcode" varchar(10);--> statement-breakpoint
ALTER TABLE "handyman_profiles" ADD COLUMN "area_catchment" jsonb DEFAULT '[]'::jsonb;--> statement-breakpoint
ALTER TABLE "handyman_profiles" ADD COLUMN "skills" jsonb DEFAULT '[]'::jsonb;--> statement-breakpoint
ALTER TABLE "handyman_profiles" ADD COLUMN "accepts_skus" jsonb;--> statement-breakpoint
ALTER TABLE "handyman_profiles" ADD COLUMN "certs" jsonb DEFAULT '[]'::jsonb;--> statement-breakpoint
ALTER TABLE "handyman_profiles" ADD COLUMN "min_job_value_pence" integer;--> statement-breakpoint
ALTER TABLE "handyman_profiles" ADD COLUMN "day_rate_target_pence" integer;--> statement-breakpoint
ALTER TABLE "handyman_profiles" ADD COLUMN "reliability_score" numeric(3, 2) DEFAULT '1.00';--> statement-breakpoint
ALTER TABLE "handyman_profiles" ADD COLUMN "priority_routing_score" numeric(5, 2);--> statement-breakpoint
ALTER TABLE "handyman_skills" ADD COLUMN "category_slug" varchar(50);--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "awaiting_video" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "video_received_at" timestamp;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "site_visit_scheduled_at" timestamp;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "stage" "lead_stage" DEFAULT 'new_lead';--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "stage_updated_at" timestamp;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "route" "lead_route";--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "route_assigned_at" timestamp;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "snoozed_until" timestamp;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "merged_into_id" varchar;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "qualification_score" integer;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "qualification_grade" "qualification_grade";--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "segment_confidence" integer;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "segment_signals" jsonb;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "red_flags" jsonb;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "scored_at" timestamp;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "scored_by" varchar(50);--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "automation_reminder_sent_at" timestamp;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "automation_recovery_sent_at" timestamp;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "action_status" varchar DEFAULT 'pending';--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "action_urgency" integer DEFAULT 3;--> statement-breakpoint
ALTER TABLE "personalized_quotes" ADD COLUMN "segment" varchar(20) DEFAULT 'UNKNOWN';--> statement-breakpoint
ALTER TABLE "personalized_quotes" ADD COLUMN "job_type" varchar(20) DEFAULT 'SINGLE';--> statement-breakpoint
ALTER TABLE "personalized_quotes" ADD COLUMN "quotability" varchar(20) DEFAULT 'VISIT';--> statement-breakpoint
ALTER TABLE "personalized_quotes" ADD COLUMN "completed_at" timestamp;--> statement-breakpoint
ALTER TABLE "personalized_quotes" ADD COLUMN "scheduling_tier" varchar(20);--> statement-breakpoint
ALTER TABLE "personalized_quotes" ADD COLUMN "selected_date" timestamp;--> statement-breakpoint
ALTER TABLE "personalized_quotes" ADD COLUMN "is_weekend_booking" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "personalized_quotes" ADD COLUMN "time_slot_type" varchar(20);--> statement-breakpoint
ALTER TABLE "personalized_quotes" ADD COLUMN "exact_time_requested" varchar(10);--> statement-breakpoint
ALTER TABLE "personalized_quotes" ADD COLUMN "scheduling_fee_in_pence" integer DEFAULT 0;--> statement-breakpoint
ALTER TABLE "personalized_quotes" ADD COLUMN "reminder_sent_at" timestamp;--> statement-breakpoint
ALTER TABLE "personalized_quotes" ADD COLUMN "followup_sent_at" timestamp;--> statement-breakpoint
ALTER TABLE "personalized_quotes" ADD COLUMN "view_nudge_sent_at" timestamp;--> statement-breakpoint
ALTER TABLE "personalized_quotes" ADD COLUMN "created_by" varchar;--> statement-breakpoint
ALTER TABLE "personalized_quotes" ADD COLUMN "created_by_name" varchar(100);--> statement-breakpoint
ALTER TABLE "personalized_quotes" ADD COLUMN "contextual_headline" varchar(100);--> statement-breakpoint
ALTER TABLE "personalized_quotes" ADD COLUMN "contextual_message" text;--> statement-breakpoint
ALTER TABLE "personalized_quotes" ADD COLUMN "job_top_line" text;--> statement-breakpoint
ALTER TABLE "personalized_quotes" ADD COLUMN "proposal_summary" text;--> statement-breakpoint
ALTER TABLE "personalized_quotes" ADD COLUMN "value_bullets" jsonb;--> statement-breakpoint
ALTER TABLE "personalized_quotes" ADD COLUMN "whatsapp_value_lines" jsonb;--> statement-breakpoint
ALTER TABLE "personalized_quotes" ADD COLUMN "whatsapp_closing" varchar(255);--> statement-breakpoint
ALTER TABLE "personalized_quotes" ADD COLUMN "layout_tier" varchar(20);--> statement-breakpoint
ALTER TABLE "personalized_quotes" ADD COLUMN "booking_modes" jsonb;--> statement-breakpoint
ALTER TABLE "personalized_quotes" ADD COLUMN "requires_human_review" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "personalized_quotes" ADD COLUMN "review_reason" text;--> statement-breakpoint
ALTER TABLE "personalized_quotes" ADD COLUMN "pricing_line_items" jsonb;--> statement-breakpoint
ALTER TABLE "personalized_quotes" ADD COLUMN "pricing_layer_breakdown" jsonb;--> statement-breakpoint
ALTER TABLE "personalized_quotes" ADD COLUMN "batch_discount_percent" integer;--> statement-breakpoint
ALTER TABLE "personalized_quotes" ADD COLUMN "selected_content_ids" jsonb;--> statement-breakpoint
ALTER TABLE "personalized_quotes" ADD COLUMN "cost_pence" integer;--> statement-breakpoint
ALTER TABLE "personalized_quotes" ADD COLUMN "margin_pence" integer;--> statement-breakpoint
ALTER TABLE "personalized_quotes" ADD COLUMN "margin_percent" integer;--> statement-breakpoint
ALTER TABLE "personalized_quotes" ADD COLUMN "margin_flags" jsonb;--> statement-breakpoint
ALTER TABLE "personalized_quotes" ADD COLUMN "matched_contractor_id" varchar;--> statement-breakpoint
ALTER TABLE "personalized_quotes" ADD COLUMN "matched_contractor_rate" integer;--> statement-breakpoint
ALTER TABLE "personalized_quotes" ADD COLUMN "available_dates" jsonb;--> statement-breakpoint
ALTER TABLE "personalized_quotes" ADD COLUMN "date_time_preferences" jsonb;--> statement-breakpoint
ALTER TABLE "personalized_quotes" ADD COLUMN "matched_contractor_name" varchar(255);--> statement-breakpoint
ALTER TABLE "personalized_quotes" ADD COLUMN "match_coverage_percent" integer;--> statement-breakpoint
ALTER TABLE "personalized_quotes" ADD COLUMN "uncovered_categories" text[];--> statement-breakpoint
ALTER TABLE "personalized_quotes" ADD COLUMN "match_flags" text[];--> statement-breakpoint
ALTER TABLE "personalized_quotes" ADD COLUMN "per_line_margin" jsonb;--> statement-breakpoint
ALTER TABLE "personalized_quotes" ADD COLUMN "pricing_snapshot" jsonb;--> statement-breakpoint
ALTER TABLE "personalized_quotes" ADD COLUMN "candidate_contractor_ids" jsonb;--> statement-breakpoint
ALTER TABLE "personalized_quotes" ADD COLUMN "candidate_pool_size" integer;--> statement-breakpoint
ALTER TABLE "personalized_quotes" ADD COLUMN "full_coverage_candidates" integer;--> statement-breakpoint
ALTER TABLE "personalized_quotes" ADD COLUMN "booking_locked_at" timestamp;--> statement-breakpoint
ALTER TABLE "personalized_quotes" ADD COLUMN "booking_lock_expires_at" timestamp;--> statement-breakpoint
ALTER TABLE "personalized_quotes" ADD COLUMN "refunded_at" timestamp;--> statement-breakpoint
ALTER TABLE "personalized_quotes" ADD COLUMN "refund_amount_pence" integer;--> statement-breakpoint
ALTER TABLE "personalized_quotes" ADD COLUMN "refund_reason" text;--> statement-breakpoint
ALTER TABLE "personalized_quotes" ADD COLUMN "delivery_channel" varchar(20);--> statement-breakpoint
ALTER TABLE "personalized_quotes" ADD COLUMN "delivery_status" varchar(20);--> statement-breakpoint
ALTER TABLE "personalized_quotes" ADD COLUMN "revoked_at" timestamp;--> statement-breakpoint
ALTER TABLE "personalized_quotes" ADD COLUMN "flex_tier" "flex_tier";--> statement-breakpoint
ALTER TABLE "personalized_quotes" ADD COLUMN "flex_window_days" integer;--> statement-breakpoint
ALTER TABLE "personalized_quotes" ADD COLUMN "crew_size_required" integer DEFAULT 1;--> statement-breakpoint
ALTER TABLE "personalized_quotes" ADD COLUMN "skills_required" jsonb DEFAULT '[]'::jsonb;--> statement-breakpoint
ALTER TABLE "personalized_quotes" ADD COLUMN "cert_required" jsonb DEFAULT '[]'::jsonb;--> statement-breakpoint
ALTER TABLE "personalized_quotes" ADD COLUMN "duration_estimate_minutes" integer;--> statement-breakpoint
ALTER TABLE "personalized_quotes" ADD COLUMN "real_work_minutes" integer;--> statement-breakpoint
ALTER TABLE "personalized_quotes" ADD COLUMN "complexity_flags" jsonb DEFAULT '[]'::jsonb;--> statement-breakpoint
ALTER TABLE "personalized_quotes" ADD COLUMN "heavy_lifting" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "personalized_quotes" ADD COLUMN "booking_state" varchar(40) DEFAULT 'draft';--> statement-breakpoint
ALTER TABLE "productized_services" ADD COLUMN "pricing_time_minutes" integer;--> statement-breakpoint
ALTER TABLE "productized_services" ADD COLUMN "real_work_minutes" integer;--> statement-breakpoint
ALTER TABLE "productized_services" ADD COLUMN "materials_collection_minutes" integer;--> statement-breakpoint
ALTER TABLE "productized_services" ADD COLUMN "setup_minutes" integer DEFAULT 12;--> statement-breakpoint
ALTER TABLE "productized_services" ADD COLUMN "cleanup_minutes" integer DEFAULT 15;--> statement-breakpoint
ALTER TABLE "productized_services" ADD COLUMN "customer_supplied_materials" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "productized_services" ADD COLUMN "requires_specialist_cert" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "productized_services" ADD COLUMN "parking_difficulty" varchar(20);--> statement-breakpoint
ALTER TABLE "availability_slots" ADD CONSTRAINT "availability_slots_booked_by_lead_id_leads_id_fk" FOREIGN KEY ("booked_by_lead_id") REFERENCES "public"."leads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_references" ADD CONSTRAINT "client_references_application_id_partner_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."partner_applications"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contractor_job_links" ADD CONSTRAINT "contractor_job_links_dispatch_id_job_dispatches_id_fk" FOREIGN KEY ("dispatch_id") REFERENCES "public"."job_dispatches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contractor_reviews" ADD CONSTRAINT "contractor_reviews_contractor_id_handyman_profiles_id_fk" FOREIGN KEY ("contractor_id") REFERENCES "public"."handyman_profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contractor_reviews" ADD CONSTRAINT "contractor_reviews_quote_id_personalized_quotes_id_fk" FOREIGN KEY ("quote_id") REFERENCES "public"."personalized_quotes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "day_commitments" ADD CONSTRAINT "day_commitments_unit_id_handyman_profiles_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."handyman_profiles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "day_packs" ADD CONSTRAINT "day_packs_commitment_id_day_commitments_id_fk" FOREIGN KEY ("commitment_id") REFERENCES "public"."day_commitments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "day_packs" ADD CONSTRAINT "day_packs_unit_id_handyman_profiles_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."handyman_profiles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deflection_metrics" ADD CONSTRAINT "deflection_metrics_issue_id_tenant_issues_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."tenant_issues"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deflection_metrics" ADD CONSTRAINT "deflection_metrics_session_id_troubleshooting_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."troubleshooting_sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dispatch_bonds" ADD CONSTRAINT "dispatch_bonds_link_id_contractor_job_links_id_fk" FOREIGN KEY ("link_id") REFERENCES "public"."contractor_job_links"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dispatch_bonds" ADD CONSTRAINT "dispatch_bonds_dispatch_id_job_dispatches_id_fk" FOREIGN KEY ("dispatch_id") REFERENCES "public"."job_dispatches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dispatch_completions" ADD CONSTRAINT "dispatch_completions_dispatch_id_job_dispatches_id_fk" FOREIGN KEY ("dispatch_id") REFERENCES "public"."job_dispatches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dispatch_variations" ADD CONSTRAINT "dispatch_variations_dispatch_id_job_dispatches_id_fk" FOREIGN KEY ("dispatch_id") REFERENCES "public"."job_dispatches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_tokens" ADD CONSTRAINT "invoice_tokens_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "landlord_settings" ADD CONSTRAINT "landlord_settings_landlord_lead_id_leads_id_fk" FOREIGN KEY ("landlord_lead_id") REFERENCES "public"."leads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "live_call_sessions" ADD CONSTRAINT "live_call_sessions_call_id_calls_id_fk" FOREIGN KEY ("call_id") REFERENCES "public"."calls"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "materials_pickups" ADD CONSTRAINT "materials_pickups_day_pack_id_day_packs_id_fk" FOREIGN KEY ("day_pack_id") REFERENCES "public"."day_packs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "materials_pickups" ADD CONSTRAINT "materials_pickups_collected_by_unit_id_handyman_profiles_id_fk" FOREIGN KEY ("collected_by_unit_id") REFERENCES "public"."handyman_profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_applications" ADD CONSTRAINT "partner_applications_contractor_id_handyman_profiles_id_fk" FOREIGN KEY ("contractor_id") REFERENCES "public"."handyman_profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pay_adjustments" ADD CONSTRAINT "pay_adjustments_dispatch_id_job_dispatches_id_fk" FOREIGN KEY ("dispatch_id") REFERENCES "public"."job_dispatches"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pay_adjustments" ADD CONSTRAINT "pay_adjustments_unit_id_handyman_profiles_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."handyman_profiles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_links" ADD CONSTRAINT "payment_links_contractor_id_handyman_profiles_id_fk" FOREIGN KEY ("contractor_id") REFERENCES "public"."handyman_profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_links" ADD CONSTRAINT "payment_links_quote_id_personalized_quotes_id_fk" FOREIGN KEY ("quote_id") REFERENCES "public"."personalized_quotes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_links" ADD CONSTRAINT "payment_links_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "properties" ADD CONSTRAINT "properties_landlord_lead_id_leads_id_fk" FOREIGN KEY ("landlord_lead_id") REFERENCES "public"."leads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "routing_offers" ADD CONSTRAINT "routing_offers_job_dispatch_id_job_dispatches_id_fk" FOREIGN KEY ("job_dispatch_id") REFERENCES "public"."job_dispatches"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "routing_offers" ADD CONSTRAINT "routing_offers_day_pack_id_day_packs_id_fk" FOREIGN KEY ("day_pack_id") REFERENCES "public"."day_packs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "routing_offers" ADD CONSTRAINT "routing_offers_unit_id_handyman_profiles_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."handyman_profiles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_issues" ADD CONSTRAINT "tenant_issues_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_issues" ADD CONSTRAINT "tenant_issues_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_issues" ADD CONSTRAINT "tenant_issues_landlord_lead_id_leads_id_fk" FOREIGN KEY ("landlord_lead_id") REFERENCES "public"."leads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_issues" ADD CONSTRAINT "tenant_issues_quote_id_personalized_quotes_id_fk" FOREIGN KEY ("quote_id") REFERENCES "public"."personalized_quotes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_issues" ADD CONSTRAINT "tenant_issues_job_id_contractor_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."contractor_jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_issues" ADD CONSTRAINT "tenant_issues_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_progress" ADD CONSTRAINT "training_progress_contractor_id_handyman_profiles_id_fk" FOREIGN KEY ("contractor_id") REFERENCES "public"."handyman_profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_progress" ADD CONSTRAINT "training_progress_module_id_training_modules_id_fk" FOREIGN KEY ("module_id") REFERENCES "public"."training_modules"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "troubleshooting_sessions" ADD CONSTRAINT "troubleshooting_sessions_issue_id_tenant_issues_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."tenant_issues"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unit_availability" ADD CONSTRAINT "unit_availability_unit_id_handyman_profiles_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."handyman_profiles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_availability_slots_date" ON "availability_slots" USING btree ("date");--> statement-breakpoint
CREATE INDEX "idx_availability_slots_booked" ON "availability_slots" USING btree ("is_booked");--> statement-breakpoint
CREATE INDEX "idx_availability_slots_lead" ON "availability_slots" USING btree ("booked_by_lead_id");--> statement-breakpoint
CREATE INDEX "idx_bsl_booking" ON "booking_state_log" USING btree ("booking_id","occurred_at");--> statement-breakpoint
CREATE INDEX "idx_client_references_application" ON "client_references" USING btree ("application_id");--> statement-breakpoint
CREATE INDEX "idx_client_references_token" ON "client_references" USING btree ("request_token");--> statement-breakpoint
CREATE INDEX "idx_content_booking_rules_active" ON "content_booking_rules" USING btree ("is_active");--> statement-breakpoint
CREATE INDEX "idx_content_booking_rules_priority" ON "content_booking_rules" USING btree ("priority");--> statement-breakpoint
CREATE INDEX "idx_content_claims_active" ON "content_claims" USING btree ("is_active");--> statement-breakpoint
CREATE INDEX "idx_content_claims_category" ON "content_claims" USING btree ("category");--> statement-breakpoint
CREATE INDEX "idx_content_guarantees_active" ON "content_guarantees" USING btree ("is_active");--> statement-breakpoint
CREATE INDEX "idx_content_hassle_items_active" ON "content_hassle_items" USING btree ("is_active");--> statement-breakpoint
CREATE INDEX "idx_content_images_active" ON "content_images" USING btree ("is_active");--> statement-breakpoint
CREATE INDEX "idx_content_images_placement" ON "content_images" USING btree ("placement");--> statement-breakpoint
CREATE INDEX "idx_content_testimonials_active" ON "content_testimonials" USING btree ("is_active");--> statement-breakpoint
CREATE INDEX "idx_content_testimonials_source" ON "content_testimonials" USING btree ("source");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_contractor_job_links_token" ON "contractor_job_links" USING btree ("token");--> statement-breakpoint
CREATE INDEX "idx_contractor_job_links_dispatch" ON "contractor_job_links" USING btree ("dispatch_id");--> statement-breakpoint
CREATE INDEX "idx_contractor_job_links_contractor" ON "contractor_job_links" USING btree ("contractor_id");--> statement-breakpoint
CREATE INDEX "idx_contractor_job_links_status" ON "contractor_job_links" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_contractor_reviews_contractor" ON "contractor_reviews" USING btree ("contractor_id");--> statement-breakpoint
CREATE INDEX "idx_contractor_reviews_token" ON "contractor_reviews" USING btree ("review_token");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_dc_unit_date" ON "day_commitments" USING btree ("unit_id","date");--> statement-breakpoint
CREATE INDEX "idx_dc_date_status" ON "day_commitments" USING btree ("date","status");--> statement-breakpoint
CREATE INDEX "idx_dp_status" ON "day_packs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_dp_unit_date" ON "day_packs" USING btree ("unit_id","date");--> statement-breakpoint
CREATE INDEX "idx_deflection_metrics_issue" ON "deflection_metrics" USING btree ("issue_id");--> statement-breakpoint
CREATE INDEX "idx_deflection_metrics_session" ON "deflection_metrics" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "idx_deflection_metrics_deflected" ON "deflection_metrics" USING btree ("was_deflected");--> statement-breakpoint
CREATE INDEX "idx_deflection_metrics_category" ON "deflection_metrics" USING btree ("issue_category");--> statement-breakpoint
CREATE INDEX "idx_dispatch_bonds_link" ON "dispatch_bonds" USING btree ("link_id");--> statement-breakpoint
CREATE INDEX "idx_dispatch_bonds_dispatch" ON "dispatch_bonds" USING btree ("dispatch_id");--> statement-breakpoint
CREATE INDEX "idx_dispatch_bonds_contractor" ON "dispatch_bonds" USING btree ("contractor_id");--> statement-breakpoint
CREATE INDEX "idx_dispatch_bonds_status" ON "dispatch_bonds" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_dispatch_completions_dispatch" ON "dispatch_completions" USING btree ("dispatch_id");--> statement-breakpoint
CREATE INDEX "idx_dispatch_variations_dispatch" ON "dispatch_variations" USING btree ("dispatch_id");--> statement-breakpoint
CREATE INDEX "idx_dispatch_variations_status" ON "dispatch_variations" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_diy_advice_category" ON "diy_advice" USING btree ("category");--> statement-breakpoint
CREATE INDEX "idx_diy_advice_active" ON "diy_advice" USING btree ("is_active");--> statement-breakpoint
CREATE INDEX "idx_invoice_tokens_token" ON "invoice_tokens" USING btree ("token");--> statement-breakpoint
CREATE INDEX "idx_job_dispatches_status" ON "job_dispatches" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_job_dispatches_quote" ON "job_dispatches" USING btree ("quote_id");--> statement-breakpoint
CREATE INDEX "idx_landlord_settings_landlord" ON "landlord_settings" USING btree ("landlord_lead_id");--> statement-breakpoint
CREATE INDEX "idx_live_call_sessions_call" ON "live_call_sessions" USING btree ("call_id");--> statement-breakpoint
CREATE INDEX "idx_live_call_sessions_phone" ON "live_call_sessions" USING btree ("phone");--> statement-breakpoint
CREATE INDEX "idx_live_call_sessions_station" ON "live_call_sessions" USING btree ("current_station");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_master_blocked_dates_date" ON "master_blocked_dates" USING btree ("date");--> statement-breakpoint
CREATE INDEX "idx_mp_day_pack" ON "materials_pickups" USING btree ("day_pack_id");--> statement-breakpoint
CREATE INDEX "idx_partner_applications_contractor" ON "partner_applications" USING btree ("contractor_id");--> statement-breakpoint
CREATE INDEX "idx_partner_applications_status" ON "partner_applications" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_pa_dispatch" ON "pay_adjustments" USING btree ("dispatch_id");--> statement-breakpoint
CREATE INDEX "idx_pa_status" ON "pay_adjustments" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_payment_links_contractor" ON "payment_links" USING btree ("contractor_id");--> statement-breakpoint
CREATE INDEX "idx_payment_links_short_code" ON "payment_links" USING btree ("short_code");--> statement-breakpoint
CREATE INDEX "idx_payment_links_status" ON "payment_links" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_properties_landlord" ON "properties" USING btree ("landlord_lead_id");--> statement-breakpoint
CREATE INDEX "idx_properties_postcode" ON "properties" USING btree ("postcode");--> statement-breakpoint
CREATE INDEX "idx_extras_catalog_active" ON "quote_extras_catalog" USING btree ("is_active");--> statement-breakpoint
CREATE INDEX "idx_extras_catalog_sort" ON "quote_extras_catalog" USING btree ("sort_order");--> statement-breakpoint
CREATE INDEX "idx_qp_headlines_section" ON "quote_platform_headlines" USING btree ("section");--> statement-breakpoint
CREATE INDEX "idx_qp_headlines_active" ON "quote_platform_headlines" USING btree ("is_active");--> statement-breakpoint
CREATE INDEX "idx_qp_images_active" ON "quote_platform_images" USING btree ("is_active");--> statement-breakpoint
CREATE INDEX "idx_qp_testimonials_archetype" ON "quote_platform_testimonials" USING btree ("archetype");--> statement-breakpoint
CREATE INDEX "idx_qp_testimonials_active" ON "quote_platform_testimonials" USING btree ("is_active");--> statement-breakpoint
CREATE INDEX "idx_section_events_quote" ON "quote_section_events" USING btree ("quote_id");--> statement-breakpoint
CREATE INDEX "idx_section_events_section" ON "quote_section_events" USING btree ("section");--> statement-breakpoint
CREATE INDEX "idx_section_events_created" ON "quote_section_events" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_rdc_route_bucket" ON "route_distance_cache" USING btree ("origin_postcode","dest_postcode","time_bucket");--> statement-breakpoint
CREATE INDEX "idx_rdc_expires" ON "route_distance_cache" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "idx_routing_decisions_booking" ON "routing_decisions" USING btree ("booking_id","decided_at");--> statement-breakpoint
CREATE INDEX "idx_ro_status" ON "routing_offers" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_ro_expires" ON "routing_offers" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "idx_ro_booking" ON "routing_offers" USING btree ("booking_id","round");--> statement-breakpoint
CREATE INDEX "idx_tenant_issues_tenant" ON "tenant_issues" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "idx_tenant_issues_property" ON "tenant_issues" USING btree ("property_id");--> statement-breakpoint
CREATE INDEX "idx_tenant_issues_landlord" ON "tenant_issues" USING btree ("landlord_lead_id");--> statement-breakpoint
CREATE INDEX "idx_tenant_issues_status" ON "tenant_issues" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_tenant_issues_urgency" ON "tenant_issues" USING btree ("urgency");--> statement-breakpoint
CREATE INDEX "idx_tenant_issues_created" ON "tenant_issues" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_tenants_property" ON "tenants" USING btree ("property_id");--> statement-breakpoint
CREATE INDEX "idx_tenants_phone" ON "tenants" USING btree ("phone");--> statement-breakpoint
CREATE INDEX "idx_training_modules_order" ON "training_modules" USING btree ("order_index");--> statement-breakpoint
CREATE INDEX "idx_training_progress_contractor" ON "training_progress" USING btree ("contractor_id");--> statement-breakpoint
CREATE INDEX "idx_training_progress_module" ON "training_progress" USING btree ("module_id");--> statement-breakpoint
CREATE INDEX "idx_troubleshooting_sessions_issue" ON "troubleshooting_sessions" USING btree ("issue_id");--> statement-breakpoint
CREATE INDEX "idx_troubleshooting_sessions_status" ON "troubleshooting_sessions" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_troubleshooting_sessions_flow" ON "troubleshooting_sessions" USING btree ("flow_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_ua_unit_date_slot" ON "unit_availability" USING btree ("unit_id","date","slot");--> statement-breakpoint
CREATE INDEX "idx_ua_date_status" ON "unit_availability" USING btree ("date","status");--> statement-breakpoint
CREATE INDEX "idx_hp_segment" ON "handyman_profiles" USING btree ("contractor_segment");--> statement-breakpoint
CREATE INDEX "idx_hp_home_postcode" ON "handyman_profiles" USING btree ("home_postcode");--> statement-breakpoint
CREATE INDEX "idx_leads_stage" ON "leads" USING btree ("stage");--> statement-breakpoint
CREATE INDEX "idx_leads_stage_updated" ON "leads" USING btree ("stage_updated_at");--> statement-breakpoint
CREATE INDEX "idx_leads_route" ON "leads" USING btree ("route");--> statement-breakpoint
CREATE INDEX "idx_leads_snoozed" ON "leads" USING btree ("snoozed_until");--> statement-breakpoint
CREATE INDEX "idx_leads_qualification_grade" ON "leads" USING btree ("qualification_grade");--> statement-breakpoint
CREATE INDEX "idx_leads_segment" ON "leads" USING btree ("segment");--> statement-breakpoint
CREATE INDEX "idx_pq_booking_state" ON "personalized_quotes" USING btree ("booking_state");--> statement-breakpoint
CREATE INDEX "idx_pq_flex_tier" ON "personalized_quotes" USING btree ("flex_tier","completion_date");