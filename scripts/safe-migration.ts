import { db } from "../server/db";
import { sql } from "drizzle-orm";

async function applySafeMigration() {
    console.log("Applying safe migration (new tables only)...");

    const statements = [
        `CREATE TABLE IF NOT EXISTS "handyman_profiles" (
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
    );`,
        `CREATE TABLE IF NOT EXISTS "handyman_availability" (
        "id" varchar PRIMARY KEY NOT NULL,
        "handyman_id" varchar NOT NULL,
        "day_of_week" integer,
        "start_time" varchar(5),
        "end_time" varchar(5),
        "is_active" boolean DEFAULT true NOT NULL
    );`,
        `CREATE TABLE IF NOT EXISTS "handyman_skills" (
        "id" varchar PRIMARY KEY NOT NULL,
        "handyman_id" varchar NOT NULL,
        "service_id" varchar NOT NULL
    );`,
        `ALTER TABLE "handyman_availability" DROP CONSTRAINT IF EXISTS "handyman_availability_handyman_id_handyman_profiles_id_fk";`,
        `ALTER TABLE "handyman_availability" ADD CONSTRAINT "handyman_availability_handyman_id_handyman_profiles_id_fk" FOREIGN KEY ("handyman_id") REFERENCES "public"."handyman_profiles"("id") ON DELETE no action ON UPDATE no action;`,
        `ALTER TABLE "handyman_profiles" DROP CONSTRAINT IF EXISTS "handyman_profiles_user_id_users_id_fk";`,
        `ALTER TABLE "handyman_profiles" ADD CONSTRAINT "handyman_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;`,
        `ALTER TABLE "handyman_skills" DROP CONSTRAINT IF EXISTS "handyman_skills_handyman_id_handyman_profiles_id_fk";`,
        `ALTER TABLE "handyman_skills" ADD CONSTRAINT "handyman_skills_handyman_id_handyman_profiles_id_fk" FOREIGN KEY ("handyman_id") REFERENCES "public"."handyman_profiles"("id") ON DELETE no action ON UPDATE no action;`,
        `ALTER TABLE "handyman_skills" DROP CONSTRAINT IF EXISTS "handyman_skills_service_id_productized_services_id_fk";`,
        `ALTER TABLE "handyman_skills" ADD CONSTRAINT "handyman_skills_service_id_productized_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."productized_services"("id") ON DELETE no action ON UPDATE no action;`
    ];

    for (const statement of statements) {
        try {
            console.log(`Executing: ${statement.substring(0, 50)}...`);
            await db.execute(sql.raw(statement));
        } catch (e) {
            console.error(`Statement failed:`, e);
        }
    }

    console.log("Safe migration complete!");
    process.exit(0);
}

applySafeMigration().catch(err => {
    console.error(err);
    process.exit(1);
});
