import { useQuery } from '@tanstack/react-query';
import type { AddonMenuItem } from '@shared/pricing-settings';

/**
 * The pre-priced small-job menu behind the 'add_task' offer ("Craig's already
 * coming — add another job, ~25% off").
 *
 * Served by GET /api/public/addon-menu from server-stored pricing settings, so
 * the client only ever names addon IDS — every price is re-resolved server-side
 * at payment time (create-payment-intent), keeping money server-authoritative.
 * `scheduleMinutes` per item feeds the availability fetch so the calendar stays
 * capacity-true when addons are selected.
 *
 * Shared queryKey: the offer interstitial and UnifiedQuoteCard both call this
 * and share one cache entry.
 */
export function useAddonMenu(enabled = true) {
  return useQuery<AddonMenuItem[]>({
    queryKey: ['addon-menu'],
    queryFn: async () => {
      const res = await fetch('/api/public/addon-menu');
      if (!res.ok) throw new Error('Failed to fetch addon menu');
      const data = await res.json();
      return Array.isArray(data) ? data : [];
    },
    enabled,
    staleTime: 5 * 60 * 1000,
  });
}
