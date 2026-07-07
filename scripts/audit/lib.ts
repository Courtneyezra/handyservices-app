/**
 * CONVERSION AUDIT — canonical definitions (single source of truth).
 * Every audit task imports from here so the funnel + dummy rules never drift.
 *
 * FUNNEL (per feedback-conversion-definition):
 *   generated  = row exists (created_at)
 *   viewed     = viewed_at IS NOT NULL OR view_count > 0
 *   delivered  = (WhatsApp only) outbound msg containing a handyservices /quote link
 *   converted  = deposit_paid_at IS NOT NULL      <-- THE conversion event
 *   rate       = paid / viewed   (primary; also report paid / generated)
 *
 * WINDOW: data starts Jan 2026; Stripe deposits live ~Feb, so Jan reads 0%
 *         structurally — start real trend comparisons from APRIL 2026.
 */
import { db } from "../../server/db";
import { sql } from "drizzle-orm";

/** NULL-safe dummy/test exclusion. Pass a table alias prefix for joins, e.g. notDummy('pq.'). */
export function notDummy(p = ""): string {
  return `NOT (
       COALESCE(${p}phone,'')           LIKE '07700900%'
    OR COALESCE(${p}phone,'')           LIKE '+447700900%'
    OR COALESCE(${p}phone,'')           LIKE '07700000%'
    OR COALESCE(${p}phone,'')           LIKE '+449900%'          -- CONTEXTUAL test-matrix range
    OR COALESCE(${p}id,'')              LIKE 'test_q_%'
    OR COALESCE(${p}id,'')              LIKE 'pq_test_%'
    OR COALESCE(${p}customer_name,'')   ILIKE '%test%'
    OR COALESCE(${p}customer_name,'')   ILIKE 'qa %'
    OR COALESCE(${p}created_by_name,'') ILIKE '%test%'
    OR COALESCE(${p}created_by_name,'') ILIKE '%qa%'
    OR COALESCE(${p}created_by_name,'') ILIKE 'phase %'
    OR COALESCE(${p}email,'')           ILIKE '%@example.com'
    OR COALESCE(${p}customer_name,'')   ILIKE 'courtnee%'
    OR LOWER(TRIM(COALESCE(${p}customer_name,''))) = 'ben'
  )`;
}

/** Canonical funnel SQL expressions (apply to personalized_quotes, alias-free or with prefix). */
export const FUNNEL = {
  viewed: (p = "") => `(${p}viewed_at IS NOT NULL OR COALESCE(${p}view_count,0) > 0)`,
  converted: (p = "") => `(${p}deposit_paid_at IS NOT NULL)`,
  bigJob: (p = "", penceThreshold = 30000) => `(COALESCE(${p}base_price,0) >= ${penceThreshold})`,
};

export const NOT_DUMMY = notDummy(); // convenience for unprefixed queries

export async function q(text: string): Promise<any[]> {
  const r: any = await db.execute(sql.raw(text));
  return r.rows ?? r;
}

export const pct = (n: number, d: number) => (d === 0 ? "  -  " : ((100 * n) / d).toFixed(1) + "%");
export const pad = (s: any, w: number) => String(s).padStart(w);
