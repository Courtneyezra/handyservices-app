/**
 * Contractor app — pure helpers (DB-free, unit-tested).
 *
 * The contractor-facing availability harvester (/my-week/:token) writes the
 * SAME rows as Ben's mobile tool and the admin hub: one override row per
 * calendar day in `contractor_availability_dates`, slot-typed via
 * `@shared/slot-times`. These helpers map a tapped day-state to that row.
 * See docs/contractor-platform/04-contractor-app.md.
 */
import { SLOT_TIMES } from '../../shared/slot-times';

/** The four states a contractor can put a day into. */
export type DayMode = 'am' | 'pm' | 'full' | 'off';

export const DAY_MODES: DayMode[] = ['am', 'pm', 'full', 'off'];

export interface OverrideWindow {
  isAvailable: boolean;
  startTime: string | null;
  endTime: string | null;
}

/**
 * Map a day mode to the override row it writes. 'off' is an EXPLICIT
 * unavailable override (beats the weekly pattern), matching the engine's
 * override-wins precedence — a contractor saying "not that day" must win
 * even when their pattern says they usually work it.
 */
export function modeToWindow(mode: DayMode): OverrideWindow {
  switch (mode) {
    case 'am':
      return { isAvailable: true, startTime: SLOT_TIMES.am.start, endTime: SLOT_TIMES.am.end };
    case 'pm':
      return { isAvailable: true, startTime: SLOT_TIMES.pm.start, endTime: SLOT_TIMES.pm.end };
    case 'full':
      return { isAvailable: true, startTime: SLOT_TIMES.full_day.start, endTime: SLOT_TIMES.full_day.end };
    case 'off':
      return { isAvailable: false, startTime: null, endTime: null };
  }
}

export function isDayMode(v: unknown): v is DayMode {
  return typeof v === 'string' && (DAY_MODES as string[]).includes(v);
}

/** Strict YYYY-MM-DD check (the only date shape the app accepts). */
export function isIsoDate(v: unknown): v is string {
  return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(new Date(`${v}T00:00:00`).getTime());
}

/** Past days are history — the app only harvests today onward. */
export function isEditableDate(dateStr: string, today: string): boolean {
  return dateStr >= today;
}

/**
 * Privacy gate for the contractor pipeline view: pre-deposit quotes show the
 * OUTWARD postcode only (dispatch-link convention — area, not doorstep).
 */
export function outwardPostcode(postcode: string | null | undefined): string | null {
  if (!postcode) return null;
  const clean = postcode.trim().toUpperCase();
  if (!clean) return null;
  if (clean.includes(' ')) return clean.split(/\s+/)[0];
  // No space: strip the inward part (digit + 2 letters) if it looks like a full code.
  const m = clean.match(/^([A-Z]{1,2}\d[A-Z\d]?)\d[A-Z]{2}$/);
  return m ? m[1] : clean;
}

/** Trim a job description for the pipeline card (whole words, ellipsis). */
export function trimDescription(desc: string | null | undefined, max = 90): string | null {
  if (!desc) return null;
  const clean = desc.replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(' '), max - 20))}…`;
}
