-- Add public profile fields to handyman_profiles
ALTER TABLE "handyman_profiles" ADD COLUMN IF NOT EXISTS "slug" varchar(100);
ALTER TABLE "handyman_profiles" ADD COLUMN IF NOT EXISTS "public_profile_enabled" boolean DEFAULT false;
ALTER TABLE "handyman_profiles" ADD COLUMN IF NOT EXISTS "hero_image_url" text;
ALTER TABLE "handyman_profiles" ADD COLUMN IF NOT EXISTS "social_links" jsonb DEFAULT '{}';

-- Create unique index on slug
CREATE UNIQUE INDEX IF NOT EXISTS "idx_handyman_profiles_slug" ON "handyman_profiles" ("slug");
