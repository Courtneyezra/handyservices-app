/**
 * Contractor desk jobs - the database read behind `jobs.ts`, through the contractor app's own
 * loaders (`server/contractor-jobs.ts`), so the page and the app agree on which jobs are his.
 */
import { eq } from 'drizzle-orm';
import { db } from '../db';
import { handymanProfiles } from '../../shared/schema';
import { ukToday } from '../../shared/uk-time';
import { loadFlexQuotes, loadJobsAndGrid, loadPastWeekDetail, shapeFlexJobs } from '../contractor-jobs';
import { UPCOMING_HORIZON_DAYS, type JobsSource } from './jobs';

export const dbJobsSource: JobsSource = {
  async profile(id) {
    const [row] = await db
      .select({ id: handymanProfiles.id, deliveryTier: handymanProfiles.deliveryTier })
      .from(handymanProfiles)
      .where(eq(handymanProfiles.id, id))
      .limit(1);
    return row ?? null;
  },

  async upcoming(profile) {
    const { bookedOut, bookings } = await loadJobsAndGrid(profile.id, profile.deliveryTier, { horizonDays: UPCOMING_HORIZON_DAYS });
    return { jobs: bookedOut, bookings };
  },

  async flex(profile) {
    // The placement suggestions read the app's own four-week grid, as the app does.
    const [grid, quotes] = await Promise.all([loadJobsAndGrid(profile.id, profile.deliveryTier), loadFlexQuotes(profile.id)]);
    return { jobs: shapeFlexJobs(quotes, grid, profile.deliveryTier, ukToday()), quotes };
  },

  past(profile, weeksBack) {
    return loadPastWeekDetail(profile.id, profile.deliveryTier, weeksBack);
  },
};
