/**
 * Per-job pay escalation — the granular WTBP optimiser (surge-lite).
 *
 * A dispatch that sits unclaimed escalates its contractor pay by +5% of the
 * ORIGINAL offer every 48 hours, up to 3 bumps (+15% max). Runs from the
 * hourly cron. Why per-job instead of moving tier rates: it finds the clearing
 * price for THIS job with zero sample-size requirement, it's self-limiting
 * (only under-priced jobs pay more), and every bump is a data point telling
 * the tier dial its base rate ran light (surfaced on /admin/pricing-loop).
 * See docs/TWO-SIDED-PRICING-LOOP-2026-07.md.
 *
 * Guardrails:
 *   - max 3 escalations (+15% of original, linear not compounding)
 *   - never pushes contractor pay above 65% of customer revenue
 *   - task-level pays are scaled with the total so line sums stay consistent
 *   - claimed/locked/completed dispatches are never touched
 */
import { db } from './db';
import { jobDispatches } from '../shared/schema';
import { and, eq, isNull, lt, sql } from 'drizzle-orm';

export const ESCALATION_STEP_PERCENT = 5;
export const ESCALATION_MAX_STEPS = 3;
export const ESCALATION_INTERVAL_HOURS = 48;
/** Contractor pay never exceeds this fraction of customer revenue */
export const ESCALATION_TAKE_CEILING = 0.65;
/**
 * Only dispatches created within this window escalate. Older pending
 * dispatches are zombies (abandoned experiments, superseded offers) — they
 * need expiring, not surging. Learned the hard way: the first live sweep
 * bumped 34 stale June/July rows before this guard existed.
 */
export const ESCALATION_FRESH_DAYS = 14;
/**
 * Dispatches created before the mechanism shipped never escalate — offers
 * made under the old rules stay as offered. Applies from the team-bait
 * dispatches (22 Jul 2026) onward.
 */
export const ESCALATION_EPOCH = new Date('2026-07-22T00:00:00Z');

export interface EscalationResult {
  escalated: Array<{ id: string; title: string; fromPence: number; toPence: number; step: number }>;
  skippedAtCeiling: number;
}

export async function escalateStaleDispatches(now = new Date()): Promise<EscalationResult> {
  const result: EscalationResult = { escalated: [], skippedAtCeiling: 0 };
  try {
    const cutoff = new Date(now.getTime() - ESCALATION_INTERVAL_HOURS * 3600_000);
    const freshSince = new Date(Math.max(
      now.getTime() - ESCALATION_FRESH_DAYS * 86400_000,
      ESCALATION_EPOCH.getTime(),
    ));
    const stale = await db.select().from(jobDispatches).where(and(
      eq(jobDispatches.status, 'pending'),
      isNull(jobDispatches.lockedToContractorId),
      lt(jobDispatches.escalationCount, ESCALATION_MAX_STEPS),
      sql`total_contractor_pay_pence > 0`,
      sql`coalesce(created_by, '') != 'demo'`,
      sql`coalesce(last_escalated_at, created_at) < ${cutoff}`,
      sql`created_at >= ${freshSince}`,
    ));

    for (const d of stale) {
      const original = d.originalContractorPayPence || d.totalContractorPayPence;
      const step = (d.escalationCount || 0) + 1;
      const bumpPence = Math.round(original * (ESCALATION_STEP_PERCENT / 100));
      const newTotal = original + bumpPence * step;

      // Margin guardrail: don't escalate past the take ceiling.
      if (d.customerRevenuePence && newTotal > d.customerRevenuePence * ESCALATION_TAKE_CEILING) {
        result.skippedAtCeiling++;
        continue;
      }

      // Scale task pays proportionally so per-line sums match the new total.
      const factor = newTotal / d.totalContractorPayPence;
      const tasks = ((d.tasks as any[]) || []).map(t => ({ ...t, payPence: Math.round((t.payPence || 0) * factor) }));
      const drift = newTotal - tasks.reduce((s, t) => s + (t.payPence || 0), 0);
      if (tasks.length > 0) tasks[tasks.length - 1].payPence += drift; // rounding remainder

      await db.update(jobDispatches).set({
        originalContractorPayPence: original,
        totalContractorPayPence: newTotal,
        platformKeepsPence: d.customerRevenuePence ? d.customerRevenuePence - newTotal : d.platformKeepsPence,
        tasks,
        escalationCount: step,
        lastEscalatedAt: now,
        updatedAt: now,
      }).where(eq(jobDispatches.id, d.id));

      result.escalated.push({ id: d.id, title: d.title, fromPence: d.totalContractorPayPence, toPence: newTotal, step });
      console.log(`[Escalation] "${d.title}" bump ${step}/${ESCALATION_MAX_STEPS}: £${(d.totalContractorPayPence / 100).toFixed(2)} → £${(newTotal / 100).toFixed(2)} (unclaimed ${ESCALATION_INTERVAL_HOURS}h+)`);
    }
  } catch (err) {
    console.warn('[Escalation] sweep failed (non-fatal):', err instanceof Error ? err.message : err);
  }
  return result;
}
