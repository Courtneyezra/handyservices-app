/**
 * The contractor's day-of ladder (pure): which state each step may leave from. The session routes
 * in server/job-lifecycle.ts and the contractor app's token status route both ask here, so the
 * rules have one definition. A missing day-of state reads as 'scheduled', the column's default.
 */
const STEP_FROM = { en_route: 'scheduled', arrived: 'en_route', in_progress: 'arrived' } as const;

export type DayOfStep = keyof typeof STEP_FROM;

/** Null when `next` may be taken from `current`, else why not. */
export function dayOfStepRefusal(current: string | null | undefined, next: DayOfStep): string | null {
  const from = STEP_FROM[next];
  const at = current ?? 'scheduled';
  return at === from ? null : `Cannot transition to ${next} from status '${at}'. Must be '${from}'.`;
}
