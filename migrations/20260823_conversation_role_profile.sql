-- Contractor comms lane, step 1: which lane does a thread belong to?
-- Additive + backfill only. Targeted run, never db:push.

ALTER TABLE conversations ADD COLUMN IF NOT EXISTS role_profile varchar(16) NOT NULL DEFAULT 'customer';

-- Backfill: threads whose number matches a registered contractor become contractor threads.
-- Empty-digit guard on BOTH sides: 7 of 8 contractor phones are '' (23 Aug), and '' = ''
-- would otherwise lane junk threads like 'anonymous@c.us' as contractors.
UPDATE conversations c SET role_profile = 'contractor'
WHERE role_profile = 'customer'
  AND length(regexp_replace(c.phone_number, '[^0-9]', '', 'g')) > 6
  AND regexp_replace(c.phone_number, '[^0-9]', '', 'g') IN (
    SELECT regexp_replace(u.phone, '[^0-9]', '', 'g') FROM users u
    WHERE u.role = 'contractor' AND u.phone IS NOT NULL
      AND length(regexp_replace(u.phone, '[^0-9]', '', 'g')) > 6
  );
