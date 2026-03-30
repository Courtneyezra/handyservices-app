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
 * Hook to fetch availability config (master switch)
 * When master switch is ON, quotes use admin-managed master availability
 * instead of contractor-based availability.
 */
export function useAvailabilityConfig() {
  return useQuery<{ useMasterSwitch: boolean }>({
    queryKey: ['availabilityConfig'],
    queryFn: async () => {
      const response = await fetch('/api/public/availability/config');
      if (!response.ok) return { useMasterSwitch: true }; // safe default
      return response.json();
    },
    staleTime: 10 * 60 * 1000, // 10 minutes — rarely changes
  });
}

/**
 * Hook to fetch system-wide availability for quote page date pickers
 *
 * Checks the master availability switch first:
 * - If ON: always uses master availability (admin-controlled dates)
 * - If OFF: uses contractor-filtered availability when categories provided
 */
export function useAvailability(options: UseAvailabilityOptions = {}) {
  const { postcode, serviceIds, categories, timeEstimateMinutes, days = 28, enabled = true } = options;

  const { data: config } = useAvailabilityConfig();
  const useMasterSwitch = config?.useMasterSwitch ?? true; // default ON

  return useQuery<AvailabilityResponse>({
    queryKey: ['publicAvailability', postcode, serviceIds, categories, timeEstimateMinutes, days, useMasterSwitch],
    queryFn: async () => {
      // Use category-filtered endpoint ONLY when master switch is OFF and categories provided
      if (!useMasterSwitch && categories && categories.length > 0) {
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

      // Master switch ON or no categories — use master availability endpoint
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
      return 'Fully booked';
    case 'day_inactive':
      return 'We don\'t operate on this day';
    case 'no_contractors':
      return 'Fully booked';
    default:
      return 'Fully booked';
  }
}

/**
 * Helper to format date as YYYY-MM-DD using local date parts
 * (not UTC via toISOString, which can shift the date near midnight)
 */
export function formatDateStr(date: Date): string {
  return format(date, 'yyyy-MM-dd');
}
