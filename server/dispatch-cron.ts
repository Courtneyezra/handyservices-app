/**
 * Autonomous dispatch sweep — the "no hands" half of the pipeline.
 *
 * Runs the goal-driven optimiser on a schedule AND on each new flexible payment,
 * so proposals stay fresh and urgent jobs surface WITHOUT anyone opening the
 * console. It only computes + broadcasts — it never books (the booking write-path
 * stays human-approved). All failures are swallowed; this must never affect a
 * webhook response or crash the server.
 */
import { runDispatchOptimizer } from './dispatch-optimizer';
import { readDispatchGoal } from './dispatch-settings';
import { broadcastCountsUpdated, broadcastPipelineAlert } from './pipeline-events';

const SWEEP_INTERVAL_MS = 30 * 60 * 1000; // every 30 minutes
const URGENT_SLACK_DAYS = 2;              // flex deadline within this ⇒ surface as urgent
const BOOT_DELAY_MS = 10 * 1000;          // let the server settle before the first run

let running = false;                  // a sweep is in flight — skip overlapping runs
let started = false;                  // cron already scheduled — keep start idempotent
let alertedUrgent = new Set<string>(); // quoteIds alerted this urgent-episode (dedupe)

export interface AutonomousSweepSummary {
  pool: number;
  ready: number;
  urgent: number;
  newlyAlerted: number;
}

export async function runAutonomousSweep(reason: string): Promise<AutonomousSweepSummary | null> {
  if (running) return null;
  running = true;
  try {
    const goal = readDispatchGoal();
    const result = await runDispatchOptimizer(goal, { maxWindowDays: 21 });
    const ready = result.assigned.length;

    // Urgency spans the whole pool: a low-slack job is a fire whether or not the
    // optimiser could place it (placeable ⇒ approve now; blocked ⇒ escalate).
    const urgent = [
      ...result.assigned.map((a) => ({ quoteId: a.quoteId, customerName: a.customerName, slackDays: a.slackDays, blocked: false, reason: 'ready to approve' })),
      ...result.unassignable.map((u) => ({ quoteId: u.quoteId, customerName: u.customerName, slackDays: u.slackDays, blocked: true, reason: u.reason })),
    ].filter((j) => typeof j.slackDays === 'number' && j.slackDays <= URGENT_SLACK_DAYS);

    broadcastCountsUpdated({ dispatchPool: result.poolSize, dispatchReady: ready, dispatchUrgent: urgent.length });

    // Alert only jobs that newly crossed into urgent. A trickle gets individual
    // alerts; a bulk backlog (the historical overdue pool) collapses to ONE summary
    // so we never flood the dashboard with dozens of SLA breaches at once.
    const newlyUrgent = urgent.filter((j) => !alertedUrgent.has(j.quoteId));
    const ALERT_CAP = 5;
    if (newlyUrgent.length > ALERT_CAP) {
      const blocked = newlyUrgent.filter((j) => j.blocked).length;
      broadcastPipelineAlert({
        id: 'dispatch_urgent_batch',
        type: 'sla_breach',
        severity: 'high',
        leadId: '',
        customerName: `${newlyUrgent.length} flexible jobs`,
        message: `${newlyUrgent.length} flexible jobs need attention (${blocked} blocked, ${newlyUrgent.length - blocked} ready to approve) — open the dispatch console`,
        data: { count: newlyUrgent.length, blocked },
      });
    } else {
      for (const j of newlyUrgent) {
        broadcastPipelineAlert({
          id: `dispatch_urgent_${j.quoteId}`,
          type: 'sla_breach',
          severity: j.slackDays <= 0 ? 'high' : 'medium',
          leadId: '',
          customerName: j.customerName,
          message: j.slackDays <= 0
            ? `Flexible job overdue (${-j.slackDays}d past) — ${j.blocked ? `blocked: ${j.reason}` : 'approve now'}`
            : `Flexible job due in ${j.slackDays}d — ${j.blocked ? `blocked: ${j.reason}` : 'ready to approve'}`,
          data: { quoteId: j.quoteId, slackDays: j.slackDays, blocked: j.blocked },
        });
      }
    }
    const newlyAlerted = newlyUrgent.length;
    // Prune to still-urgent ids so a job re-alerts only after a fresh urgent episode.
    alertedUrgent = new Set(urgent.map((j) => j.quoteId));

    console.log(`[DispatchCron] sweep(${reason}): pool=${result.poolSize} ready=${ready} urgent=${urgent.length} newAlerts=${newlyAlerted}`);
    return { pool: result.poolSize, ready, urgent: urgent.length, newlyAlerted };
  } catch (err) {
    console.error('[DispatchCron] sweep failed (non-fatal):', err);
    return null;
  } finally {
    running = false;
  }
}

export function startDispatchCron() {
  if (started) return;
  started = true;
  setTimeout(() => { void runAutonomousSweep('boot'); }, BOOT_DELAY_MS);
  setInterval(() => { void runAutonomousSweep('cron'); }, SWEEP_INTERVAL_MS);
  console.log(`[DispatchCron] started — autonomous sweep every ${SWEEP_INTERVAL_MS / 60000}m (read-only; never books)`);
}
