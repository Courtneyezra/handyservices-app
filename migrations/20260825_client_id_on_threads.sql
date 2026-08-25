-- ATLAS step 6: Wire thread→client. Additive + backfill only. Targeted run, never db:push.
--
-- Client = the account. Repeat customer = 1 client, 1 thread, N leads, N properties.
-- The gap is one migration: add client_id to conversations + calls, backfill by phone.

-- 1. Add client_id FK to conversations
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS client_id varchar
  REFERENCES service_clients(id) ON DELETE SET NULL;

-- 2. Add client_id FK to calls
ALTER TABLE calls ADD COLUMN IF NOT EXISTS client_id varchar
  REFERENCES service_clients(id) ON DELETE SET NULL;

-- 3. Index for fast lookups
CREATE INDEX IF NOT EXISTS idx_conversations_client ON conversations(client_id);
CREATE INDEX IF NOT EXISTS idx_calls_client ON calls(client_id);

-- 4. Backfill conversations by matching phone digits to service_clients.primary_phone
-- conversations.phone_number format: "447936816338@c.us"
-- service_clients.primary_phone format: "+447936816338" or "07936816338"
UPDATE conversations c SET client_id = sc.id
FROM service_clients sc
WHERE c.client_id IS NULL
  AND length(regexp_replace(c.phone_number, '[^0-9]', '', 'g')) > 6
  AND regexp_replace(c.phone_number, '[^0-9]', '', 'g') =
      regexp_replace(sc.primary_phone, '[^0-9]', '', 'g');

-- 5. Backfill calls by matching phone digits to service_clients.primary_phone
UPDATE calls cl SET client_id = sc.id
FROM service_clients sc
WHERE cl.client_id IS NULL
  AND length(regexp_replace(cl.phone_number, '[^0-9]', '', 'g')) > 6
  AND regexp_replace(cl.phone_number, '[^0-9]', '', 'g') =
      regexp_replace(sc.primary_phone, '[^0-9]', '', 'g');
