/**
 * Resolve a wheel group's slices with the admin-edited odds applied.
 * Falls back to the built-in default weights if the config can't be fetched,
 * so the wheel never breaks.
 */
import { useQuery } from '@tanstack/react-query';
import { applyWeightOverrides, type WheelGroup, type WheelWeightOverrides, type PrizeSlice } from './prize-wheel-config';

export function useWheelSlices(group: WheelGroup): PrizeSlice[] {
  const { data } = useQuery<{ weights: WheelWeightOverrides }>({
    queryKey: ['prize-wheel-weights'],
    queryFn: () => fetch('/api/prize-wheel-weights').then((r) => r.json()),
    staleTime: 5 * 60 * 1000,
  });
  return applyWeightOverrides(group, data?.weights);
}
