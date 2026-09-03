-- P12: the price screen records HOW Ben priced a line beside WHAT he priced it at — the
-- contradiction resolution (drop / keep the materials), whether he edited the desk's message,
-- and any materials or assumptions he changed. Idempotent; additive; nullable.
ALTER TABLE quote_price_verdicts ADD COLUMN IF NOT EXISTS meta jsonb;
