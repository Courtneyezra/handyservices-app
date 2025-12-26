CREATE TABLE "calls" (
	"id" varchar PRIMARY KEY NOT NULL,
	"call_id" varchar NOT NULL,
	"phone_number" varchar NOT NULL,
	"direction" varchar NOT NULL,
	"status" varchar NOT NULL,
	"recording_url" varchar,
	"transcription" text,
	"lead_id" varchar,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "calls_call_id_unique" UNIQUE("call_id")
);
--> statement-breakpoint
CREATE TABLE "handyman_availability" (
	"id" varchar PRIMARY KEY NOT NULL,
	"handyman_id" varchar NOT NULL,
	"day_of_week" integer,
	"start_time" varchar(5),
	"end_time" varchar(5),
	"is_active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "handyman_profiles" (
	"id" varchar PRIMARY KEY NOT NULL,
	"user_id" varchar NOT NULL,
	"bio" text,
	"address" text,
	"city" varchar(100),
	"postcode" varchar(20),
	"latitude" text,
	"longitude" text,
	"radius_miles" integer DEFAULT 10 NOT NULL,
	"calendar_sync_token" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "handyman_skills" (
	"id" varchar PRIMARY KEY NOT NULL,
	"handyman_id" varchar NOT NULL,
	"service_id" varchar NOT NULL
);
--> statement-breakpoint
CREATE TABLE "leads" (
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
--> statement-breakpoint
CREATE TABLE "productized_services" (
	"id" varchar PRIMARY KEY NOT NULL,
	"sku_code" varchar(50) NOT NULL,
	"name" varchar(200) NOT NULL,
	"description" text NOT NULL,
	"price_pence" integer NOT NULL,
	"time_estimate_minutes" integer NOT NULL,
	"keywords" text[] NOT NULL,
	"negative_keywords" text[],
	"ai_prompt_hint" text,
	"embedding_vector" text,
	"category" varchar(50),
	"is_active" boolean DEFAULT true,
	CONSTRAINT "productized_services_sku_code_unique" UNIQUE("sku_code")
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"sid" varchar PRIMARY KEY NOT NULL,
	"sess" jsonb NOT NULL,
	"expire" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sku_match_logs" (
	"id" varchar PRIMARY KEY NOT NULL,
	"input_text" text NOT NULL,
	"matched_sku_id" varchar,
	"confidence" integer,
	"match_method" varchar(20),
	"was_accepted" boolean,
	"lead_id" varchar,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" varchar PRIMARY KEY NOT NULL,
	"email" varchar NOT NULL,
	"first_name" varchar,
	"last_name" varchar,
	"password" varchar(255),
	"role" varchar(20) DEFAULT 'admin' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "handyman_availability" ADD CONSTRAINT "handyman_availability_handyman_id_handyman_profiles_id_fk" FOREIGN KEY ("handyman_id") REFERENCES "public"."handyman_profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "handyman_profiles" ADD CONSTRAINT "handyman_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "handyman_skills" ADD CONSTRAINT "handyman_skills_handyman_id_handyman_profiles_id_fk" FOREIGN KEY ("handyman_id") REFERENCES "public"."handyman_profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "handyman_skills" ADD CONSTRAINT "handyman_skills_service_id_productized_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."productized_services"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "IDX_session_expire" ON "sessions" USING btree ("expire");