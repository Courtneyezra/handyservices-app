import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';

export interface DateAvailability {
  date: string;
  isAvailable: boolean;
  reason?: 'master_blocked' | 'day_inactive' | 'no_contractors' | 'available';
  slots: ('am' | 'pm' | 'full')[];
  contractorCount?: number;
  isWeekend?: boolean;
  isFallback?: boolean;
}

export interface AvailabilityResponse {
  dates: DateAvailability[];
}

interface UseAvailabilityOptions {
  postcode?: string;
  serviceIds?: string[];
  /** Granular job categories for contractor-filtered availability */
  categories?: string[];
  /** Estimated job time in minutes — if >240 only full-day slots returned */
  timeEstimateMinutes?: number;
  days?: number;
  enabled?: boolean;
}

/**
 * Hook to fetch system-wide availability for quote page date pickers
 *
 * Combines:
 * - Master blocked dates
 * - Master weekly patterns
 * - Contractor availability (patterns + overrides)
 * - Existing bookings
 *
 * Returns available dates where at least one contractor can work.
 */
export function useAvailability(options: UseAvailabilityOptions = {}) {
  const { postcode, serviceIds, categories, timeEstimateMinutes, days = 28, enabled = true } = options;

  return useQuery<AvailabilityResponse>({
    queryKey: ['publicAvailability', postcode, serviceIds, categories, timeEstimateMinutes, days],
    queryFn: async () => {
      // Use category-filtered endpoint when categories are provided
      if (categories && categories.length > 0) {
        const params = new URLSearchParams();
        params.set('categories', categories.join(','));
        if (postcode) params.set('postcode', postcode);
        if (timeEstimateMinutes) params.set('timeEstimateMinutes', timeEstimateMinutes.toString());
        params.set('days', Math.min(days, 14).toString()); // 2-week window for filtered

        const response = await fetch(`/api/public/availability/filtered?${params.toString()}`);
        if (!response.ok) throw new Error('Failed to fetch filtered availability');

        // Filtered endpoint returns array directly, wrap for compatibility
        const dates: DateAvailability[] = await response.json();
        return { dates };
      }

      // Fallback to existing unfiltered endpoint
      const params = new URLSearchParams();
      params.set('days', days.toString());

      if (postcode) {
        params.set('postcode', postcode);
      }

      if (serviceIds && serviceIds.length > 0) {
        params.set('serviceIds', serviceIds.join(','));
      }

      const response = await fetch(`/api/public/availability?${params.toString()}`);

      if (!response.ok) {
        throw new Error('Failed to fetch availability');
      }

      return response.json();
    },
    enabled,
    staleTime: 5 * 60 * 1000, // 5 minutes
    refetchOnWindowFocus: true,
  });
}

/**
 * Helper to check if a specific date is available
 */
export function isDateAvailable(
  dates: DateAvailability[] | undefined,
  dateStr: string
): boolean {
  if (!dates) return false;
  const dateInfo = dates.find(d => d.date === dateStr);
  return dateInfo?.isAvailable ?? false;
}

/**
 * Helper to get available slots for a specific date
 */
export function getAvailableSlots(
  dates: DateAvailability[] | undefined,
  dateStr: string
): ('am' | 'pm' | 'full')[] {
  if (!dates) return [];
  const dateInfo = dates.find(d => d.date === dateStr);
  return dateInfo?.slots ?? [];
}

/**
 * Helper to get the reason why a date is unavailable
 */
export function getUnavailableReason(
  dates: DateAvailability[] | undefined,
  dateStr: string
): string | undefined {
  if (!dates) return undefined;
  const dateInfo = dates.find(d => d.date === dateStr);
  if (!dateInfo || dateInfo.isAvailable) return undefined;

  switch (dateInfo.reason) {
    case 'master_blocked':
      return 'This date is blocked';
    case 'day_inactive':
      return 'We don\'t operate on this day';
    case 'no_contractors':
      return 'No contractors available';
    default:
      return 'Unavailable';
  }
}

/**
 * Helper to format date as YYYY-MM-DD using local date parts
 * (not UTC via toISOString, which can shift the date near midnight)
 */
export function formatDateStr(date: Date): string {
  return format(date, 'yyyy-MM-dd');
}
