/**
 * AvailabilityPanel - Availability slots display for Live Call HUD
 *
 * Shows next 14 days of availability in a compact, collapsible format.
 * VA can quickly glance at available slots while on a call.
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '@/lib/utils';
import { ChevronDown, ChevronUp, Calendar, Loader2, RefreshCw } from 'lucide-react';

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════

interface AvailabilitySlot {
  id: string;
  date: string; // YYYY-MM-DD
  startTime: string; // HH:mm
  endTime: string; // HH:mm
  slotType: 'morning' | 'afternoon' | 'full_day';
  isBooked: boolean;
}

interface DayAvailability {
  date: string;
  dayLabel: string; // "Mon 26th"
  morning: boolean | null; // null = no slot exists, true = available, false = booked
  afternoon: boolean | null;
  fullDay: boolean | null;
}

interface AvailabilityPanelProps {
  className?: string;
  defaultExpanded?: boolean;
}

// ═══════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════

function formatDayLabel(dateStr: string): string {
  const date = new Date(dateStr + 'T00:00:00'); // Ensure local timezone
  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const day = date.getDate();
  const suffix = getOrdinalSuffix(day);
  return `${dayNames[date.getDay()]} ${day}${suffix}`;
}

function getOrdinalSuffix(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return s[(v - 20) % 10] || s[v] || s[0];
}

function getDateRange(): { startDate: string; endDate: string } {
  const today = new Date();
  const endDate = new Date(today);
  endDate.setDate(endDate.getDate() + 13); // 14 days including today

  const formatDate = (d: Date) => d.toISOString().split('T')[0];
  return {
    startDate: formatDate(today),
    endDate: formatDate(endDate),
  };
}

function groupSlotsByDay(slots: AvailabilitySlot[], startDate: string, endDate: string): DayAvailability[] {
  // Create a map of dates to slots
  const slotsByDate = new Map<string, AvailabilitySlot[]>();
  slots.forEach(slot => {
    const existing = slotsByDate.get(slot.date) || [];
    existing.push(slot);
    slotsByDate.set(slot.date, existing);
  });

  // Generate array of all days in range
  const days: DayAvailability[] = [];
  const current = new Date(startDate + 'T00:00:00');
  const end = new Date(endDate + 'T00:00:00');

  while (current <= end) {
    const dateStr = current.toISOString().split('T')[0];
    const daySlots = slotsByDate.get(dateStr) || [];

    // Determine availability for each slot type
    const morning = daySlots.find(s => s.slotType === 'morning');
    const afternoon = daySlots.find(s => s.slotType === 'afternoon');
    const fullDay = daySlots.find(s => s.slotType === 'full_day');

    days.push({
      date: dateStr,
      dayLabel: formatDayLabel(dateStr),
      morning: morning ? !morning.isBooked : null,
      afternoon: afternoon ? !afternoon.isBooked : null,
      fullDay: fullDay ? !fullDay.isBooked : null,
    });

    current.setDate(current.getDate() + 1);
  }

  return days;
}

// ═══════════════════════════════════════════════════════════════════════════
// COMPONENTS
// ═══════════════════════════════════════════════════════════════════════════

function SlotIndicator({ available, label }: { available: boolean | null; label: string }) {
  if (available === null) {
    // No slot exists for this time
    return (
      <span className="text-white/20 text-xs">
        {label} <span className="inline-block w-2 h-2 rounded-full bg-white/10" />
      </span>
    );
  }

  return (
    <span className={cn('text-xs', available ? 'text-green-400' : 'text-white/30')}>
      {label}{' '}
      <span
        className={cn(
          'inline-block w-2 h-2 rounded-full',
          available ? 'bg-green-500' : 'bg-white/20'
        )}
      />
    </span>
  );
}

function DayRow({ day }: { day: DayAvailability }) {
  // Determine if any slot is available
  const hasAvailable = day.morning || day.afternoon || day.fullDay;
  const allBooked = !hasAvailable && (day.morning === false || day.afternoon === false || day.fullDay === false);

  // Check if it's a full day slot situation
  const isFullDayOnly = day.fullDay !== null && day.morning === null && day.afternoon === null;

  return (
    <div
      className={cn(
        'flex items-center justify-between py-1.5 px-2 rounded',
        hasAvailable ? 'bg-white/5' : 'opacity-60'
      )}
    >
      <span className={cn('text-xs font-medium', hasAvailable ? 'text-white' : 'text-white/40')}>
        {day.dayLabel}
      </span>
      <div className="flex items-center gap-3">
        {isFullDayOnly ? (
          // Full day slot only
          <SlotIndicator available={day.fullDay} label="Full" />
        ) : (
          // Morning/afternoon slots
          <>
            <SlotIndicator available={day.morning} label="AM" />
            <SlotIndicator available={day.afternoon} label="PM" />
          </>
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════════════════════════

export function AvailabilityPanel({ className, defaultExpanded = false }: AvailabilityPanelProps) {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);
  const [slots, setSlots] = useState<AvailabilitySlot[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastFetched, setLastFetched] = useState<Date | null>(null);

  const { startDate, endDate } = useMemo(() => getDateRange(), []);

  const fetchAvailability = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch(
        `/api/availability?startDate=${startDate}&endDate=${endDate}&includeBooked=true`
      );

      if (!response.ok) {
        throw new Error('Failed to fetch availability');
      }

      const data = await response.json();
      setSlots(data);
      setLastFetched(new Date());
    } catch (err) {
      console.error('[AvailabilityPanel] Failed to fetch:', err);
      setError('Failed to load availability');
    } finally {
      setIsLoading(false);
    }
  }, [startDate, endDate]);

  // Fetch on mount
  useEffect(() => {
    fetchAvailability();
  }, [fetchAvailability]);

  // Group slots by day
  const days = useMemo(() => groupSlotsByDay(slots, startDate, endDate), [slots, startDate, endDate]);

  // Count available slots
  const availableCount = useMemo(() => {
    return slots.filter(s => !s.isBooked).length;
  }, [slots]);

  // Quick summary for collapsed state
  const summaryText = useMemo(() => {
    if (isLoading) return 'Loading...';
    if (error) return 'Error';
    if (availableCount === 0) return 'Fully booked';
    return `${availableCount} slot${availableCount === 1 ? '' : 's'} free`;
  }, [isLoading, error, availableCount]);

  return (
    <div className={cn('bg-slate-800 rounded-lg overflow-hidden', className)}>
      {/* HEADER - Always visible */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center justify-between px-3 py-2 hover:bg-white/5 transition-colors"
      >
        <div className="flex items-center gap-2">
          <Calendar className="w-4 h-4 text-white/50" />
          <span className="text-sm font-medium text-white/80">Availability</span>
          <span
            className={cn(
              'text-xs px-1.5 py-0.5 rounded',
              availableCount > 0 ? 'bg-green-500/20 text-green-400' : 'bg-white/10 text-white/40'
            )}
          >
            {summaryText}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {!isLoading && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                fetchAvailability();
              }}
              className="p-1 hover:bg-white/10 rounded transition-colors"
              title="Refresh availability"
            >
              <RefreshCw className="w-3.5 h-3.5 text-white/40 hover:text-white/60" />
            </button>
          )}
          {isExpanded ? (
            <ChevronUp className="w-4 h-4 text-white/40" />
          ) : (
            <ChevronDown className="w-4 h-4 text-white/40" />
          )}
        </div>
      </button>

      {/* CONTENT - Expandable */}
      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="px-2 pb-2 max-h-64 overflow-y-auto">
              {isLoading ? (
                <div className="flex items-center justify-center py-4">
                  <Loader2 className="w-5 h-5 text-white/40 animate-spin" />
                </div>
              ) : error ? (
                <div className="text-center py-4">
                  <p className="text-red-400 text-xs">{error}</p>
                  <button
                    onClick={fetchAvailability}
                    className="text-white/40 text-xs hover:text-white/60 mt-1"
                  >
                    Try again
                  </button>
                </div>
              ) : (
                <div className="space-y-0.5">
                  {days.map((day) => (
                    <DayRow key={day.date} day={day} />
                  ))}
                </div>
              )}

              {/* Legend */}
              {!isLoading && !error && (
                <div className="flex items-center justify-center gap-4 mt-2 pt-2 border-t border-white/10">
                  <span className="flex items-center gap-1 text-xs text-white/40">
                    <span className="w-2 h-2 rounded-full bg-green-500" /> Available
                  </span>
                  <span className="flex items-center gap-1 text-xs text-white/40">
                    <span className="w-2 h-2 rounded-full bg-white/20" /> Booked
                  </span>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default AvailabilityPanel;
