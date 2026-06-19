/**
 * Dispatch goal settings — light JSON-file store (read-with-default + write-on-PUT).
 *
 * NO db migration: db:push is blocked by unrelated schema drift, and a single global
 * dispatch goal doesn't warrant a table. We persist to server/dispatch-settings.json.
 *
 * CAVEAT: on some deploy targets the filesystem is EPHEMERAL (reset on redeploy), so a
 * PUT may not survive a restart. That's acceptable here — the DEFAULT_GOAL is sensible
 * and the setting only steers PROPOSALS (read-only dry sweep), never live bookings. If
 * durability becomes required, swap this for a `settings` row keyed 'dispatch_goal'.
 */
import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { DEFAULT_GOAL, type DispatchGoal, type DispatchObjective, type PackMode } from './dispatch-optimizer';

// Resolve from the project root (process.cwd()), which is the repo root under both
// `npm run dev` (tsx) and `npm start` (the esbuild bundle in dist/). Avoids __dirname,
// which under the production bundle would point at dist/ rather than server/.
const SETTINGS_PATH = join(process.cwd(), 'server', 'dispatch-settings.json');

const OBJECTIVES: DispatchObjective[] = ['contractor_hourly', 'customer_speed', 'throughput', 'even_load', 'day_margin'];
const PACK_MODES: PackMode[] = ['fast', 'balanced', 'dense'];

/** Coerce an arbitrary parsed object into a valid DispatchGoal, filling defaults. */
function sanitize(raw: any): DispatchGoal {
  const objective: DispatchObjective = OBJECTIVES.includes(raw?.objective) ? raw.objective : DEFAULT_GOAL.objective;
  const packMode: PackMode = PACK_MODES.includes(raw?.packMode) ? raw.packMode : DEFAULT_GOAL.packMode;
  const maxJobsPerDayRaw = Number(raw?.maxJobsPerDay);
  const maxTravelRaw = Number(raw?.maxTravelMilesPerJob);
  const fuelRaw = Number(raw?.fuelPencePerMile);
  const dayRateRaw = Number(raw?.defaultDayRatePence);
  // Clamp to sane ranges so a bad PUT can't break the search (e.g. 0 jobs/day).
  const maxJobsPerDay = Number.isFinite(maxJobsPerDayRaw) ? Math.max(1, Math.min(8, Math.round(maxJobsPerDayRaw))) : DEFAULT_GOAL.maxJobsPerDay;
  const maxTravelMilesPerJob = Number.isFinite(maxTravelRaw) ? Math.max(1, Math.min(50, maxTravelRaw)) : DEFAULT_GOAL.maxTravelMilesPerJob;
  // TRUE-MARGIN economics: fuel £/mile 0..500, default day rate 0..200000 pence (£0..£2000).
  const fuelPencePerMile = Number.isFinite(fuelRaw) ? Math.max(0, Math.min(500, Math.round(fuelRaw))) : DEFAULT_GOAL.fuelPencePerMile;
  const defaultDayRatePence = Number.isFinite(dayRateRaw) ? Math.max(0, Math.min(200000, Math.round(dayRateRaw))) : DEFAULT_GOAL.defaultDayRatePence;
  return { objective, packMode, maxJobsPerDay, maxTravelMilesPerJob, fuelPencePerMile, defaultDayRatePence };
}

/** Read the persisted goal, falling back to DEFAULT_GOAL on any missing/corrupt file. */
export function readDispatchGoal(): DispatchGoal {
  try {
    const txt = readFileSync(SETTINGS_PATH, 'utf-8');
    return sanitize(JSON.parse(txt));
  } catch {
    return { ...DEFAULT_GOAL };
  }
}

/** Merge a Partial<DispatchGoal> over the current goal, persist, return the merged goal. */
export function writeDispatchGoal(patch: Partial<DispatchGoal>): DispatchGoal {
  const current = readDispatchGoal();
  const merged = sanitize({ ...current, ...patch });
  try {
    writeFileSync(SETTINGS_PATH, JSON.stringify(merged, null, 2) + '\n', 'utf-8');
  } catch (e) {
    // Persist failed (read-only FS); the in-memory merged value is still returned so
    // the caller's request reflects the requested change for this process lifetime.
    console.error('[DispatchSettings] write failed (FS may be read-only):', e);
  }
  return merged;
}
