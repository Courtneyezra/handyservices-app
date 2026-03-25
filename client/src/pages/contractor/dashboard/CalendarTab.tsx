import { useState, useRef, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { format, isToday, isSameDay, parseISO, startOfDay, addDays, isWeekend } from 'date-fns';
import { Link } from 'wouter';
import { useToast } from '@/hooks/use-toast';
import { motion, AnimatePresence } from 'framer-motion';
import { Sun, Sunset, Clock, X } from 'lucide-react';

// ── Types ──────────────────────────────────────────────────────────────────────

interface AvailabilityDay {
  date: string;
  isAvailable: boolean;
  startTime?: string;
  endTime?: string;
  source: 'pattern' | 'override' | 'default_off';
}

interface BookedQuote {
  id: string;
  shortSlug: string;
  customerName: string;
  jobDescription: string | null;
  basePrice: number | null;
  basePricePence: number | null;
  baseJobPricePence: number | null;
  bookedAt: string | null;
  createdAt: string;
}

type AvailabilityMode = 'am' | 'pm' | 'full' | 'off';

// ── Helpers ────────────────────────────────────────────────────────────────────

function getCleanToken(): string | null {
  const token = localStorage.getItem('contractorToken');
  return token?.trim().replace(/[^a-zA-Z0-9._-]/g, '') ?? null;
}

function getMode(day: AvailabilityDay): AvailabilityMode {
  if (!day.isAvailable) return 'off';
  const startH = day.startTime ? parseInt(day.startTime.split(':')[0], 10) : 9;
  const endH = day.endTime ? parseInt(day.endTime.split(':')[0], 10) : 17;
  const isAm = startH < 12;
  const isPm = endH > 12;
  if (isAm && isPm) return 'full';
  if (isAm) return 'am';
  if (isPm) return 'pm';
  return 'off';
}

function getJobPrice(q: BookedQuote): number {
  return q.basePrice || q.basePricePence || q.baseJobPricePence || 0;
}

// ── Component ──────────────────────────────────────────────────────────────────

export default function CalendarTab() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const pickerRef = useRef<HTMLDivElement>(null);

  // Close picker on outside click
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setSelectedDate(null);
      }
    }
    if (selectedDate) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [selectedDate]);

  // ── Data fetching ──

  const { data: days, isLoading } = useQuery<AvailabilityDay[]>({
    queryKey: ['contractor-availability'],
    queryFn: async () => {
      const token = getCleanToken();
      const res = await fetch('/api/contractor/availability/upcoming?days=14', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error('Failed to fetch availability');
      return res.json();
    },
  });

  const { data: allQuotes } = useQuery<BookedQuote[]>({
    queryKey: ['contractor-quotes'],
    queryFn: async () => {
      const token = getCleanToken();
      const res = await fetch('/api/contractor/quotes', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error('Failed to fetch quotes');
      return res.json();
    },
  });

  const today = startOfDay(new Date());
  const windowEnd = addDays(today, 14);
  const bookedJobs = (allQuotes ?? []).filter((q) => {
    if (!q.bookedAt) return false;
    const d = startOfDay(parseISO(q.bookedAt));
    return d >= today && d < windowEnd;
  });

  // ── Toggle mutation ──

  const toggleMutation = useMutation({
    mutationFn: async ({ date, mode }: { date: string; mode: AvailabilityMode }) => {
      const token = getCleanToken();
      const res = await fetch('/api/contractor/availability/toggle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ date, mode }),
      });
      if (!res.ok) throw new Error('Failed to update');
    },
    onMutate: async ({ date, mode }) => {
      await queryClient.cancelQueries({ queryKey: ['contractor-availability'] });
      const prev = queryClient.getQueryData<AvailabilityDay[]>(['contractor-availability']);
      queryClient.setQueryData<AvailabilityDay[]>(['contractor-availability'], (old) => {
        if (!old) return [];
        return old.map((d) => {
          if (d.date !== date) return d;
          let start = '09:00', end = '17:00', avail = true;
          if (mode === 'am')   { start = '08:00'; end = '12:00'; }
          if (mode === 'pm')   { start = '13:00'; end = '17:00'; }
          if (mode === 'full') { start = '08:00'; end = '17:00'; }
          if (mode === 'off')  { avail = false; }
          return { ...d, isAvailable: avail, startTime: start, endTime: end };
        });
      });
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      queryClient.setQueryData(['contractor-availability'], ctx?.prev);
      toast({ title: 'Error', description: 'Could not sync. Try again.', variant: 'destructive' });
    },
  });

  const handleSetMode = (date: string, mode: AvailabilityMode) => {
    toggleMutation.mutate({ date, mode });
    setSelectedDate(null);
  };

  // Stats
  const availCount = days?.filter(d => d.isAvailable).length ?? 0;
  const bookedCount = bookedJobs.length;

  return (
    <div className="px-4 pt-5 pb-24 relative">
      {/* Header */}
      <div className="flex items-center justify-between mb-1">
        <h1 className="text-xl font-bold text-white">Your Schedule</h1>
        <div className="flex items-center gap-3 text-[11px]">
          {availCount > 0 && <span className="text-amber-400 font-semibold">{availCount} free</span>}
          {bookedCount > 0 && <span className="text-blue-400 font-semibold">{bookedCount} booked</span>}
        </div>
      </div>
      <p className="text-xs text-slate-500 mb-5">Tap a date to set availability</p>

      {/* Loading */}
      {isLoading && (
        <div className="grid grid-cols-4 gap-2">
          {[...Array(12)].map((_, i) => (
            <div key={i} className="aspect-square bg-slate-900 rounded-xl animate-pulse" />
          ))}
        </div>
      )}

      {/* Grid */}
      {!isLoading && days && (
        <>
          {/* Week labels row */}
          <div className="grid grid-cols-4 gap-2">
            {days.map((day, index) => {
              const dateObj = new Date(day.date + 'T00:00:00');
              const mode = getMode(day);
              const dayIsToday = isToday(dateObj);
              const isWkend = isWeekend(dateObj);
              const isSelected = selectedDate === day.date;

              const bookedJob = bookedJobs.find((q) =>
                q.bookedAt && isSameDay(parseISO(q.bookedAt), dateObj)
              );

              // Square background based on state
              let bgClass = 'bg-slate-900/60 border-slate-800/60';
              let textClass = 'text-white';
              let statusLabel = '';
              let statusColor = '';

              if (bookedJob) {
                bgClass = 'bg-blue-500/15 border-blue-500/30';
                textClass = 'text-blue-300';
                statusLabel = '£' + Math.round(getJobPrice(bookedJob) / 100);
                statusColor = 'text-blue-400';
              } else if (mode === 'full') {
                bgClass = 'bg-emerald-500/15 border-emerald-500/30';
                statusLabel = 'All Day';
                statusColor = 'text-emerald-400';
              } else if (mode === 'am') {
                bgClass = 'bg-amber-500/12 border-amber-500/25';
                statusLabel = 'AM';
                statusColor = 'text-amber-400';
              } else if (mode === 'pm') {
                bgClass = 'bg-emerald-500/10 border-emerald-500/25';
                statusLabel = 'PM';
                statusColor = 'text-emerald-400';
              } else if (isWkend) {
                bgClass = 'bg-slate-900/30 border-slate-800/30';
                textClass = 'text-slate-600';
              }

              return (
                <motion.div
                  key={day.date}
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ duration: 0.2, delay: index * 0.015 }}
                  className="relative"
                >
                  <button
                    onClick={() => setSelectedDate(isSelected ? null : day.date)}
                    className={`w-full aspect-square rounded-xl border flex flex-col items-center justify-center gap-0.5 transition-all active:scale-95 ${bgClass} ${
                      dayIsToday ? 'ring-2 ring-amber-500/40 ring-offset-1 ring-offset-slate-950' : ''
                    } ${isSelected ? 'ring-2 ring-white/30' : ''}`}
                  >
                    {/* Day name */}
                    <span className={`text-[10px] font-medium uppercase tracking-wider ${
                      isWkend && mode === 'off' ? 'text-slate-600' : 'text-slate-400'
                    }`}>
                      {format(dateObj, 'EEE')}
                    </span>

                    {/* Date number */}
                    <span className={`text-lg font-bold leading-none ${textClass}`}>
                      {format(dateObj, 'd')}
                    </span>

                    {/* Status indicator */}
                    {statusLabel ? (
                      <span className={`text-[9px] font-bold mt-0.5 ${statusColor}`}>
                        {statusLabel}
                      </span>
                    ) : dayIsToday ? (
                      <span className="text-[9px] font-bold text-amber-500 mt-0.5">Today</span>
                    ) : (
                      <span className="text-[9px] text-transparent mt-0.5">-</span>
                    )}
                  </button>

                  {/* Booked job dot */}
                  {bookedJob && (
                    <div className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-blue-400" />
                  )}
                </motion.div>
              );
            })}
          </div>

          {/* Inline booked job detail (shown below grid when a booked date is selected) */}
          <AnimatePresence>
            {selectedDate && (() => {
              const bookedJob = bookedJobs.find(q =>
                q.bookedAt && isSameDay(parseISO(q.bookedAt), new Date(selectedDate + 'T00:00:00'))
              );
              if (!bookedJob) return null;
              return (
                <motion.div
                  initial={{ opacity: 0, y: -8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  className="mt-3"
                >
                  <Link href={`/contractor/dashboard/jobs/${bookedJob.shortSlug}`}>
                    <div className="p-4 bg-blue-500/10 border border-blue-500/20 rounded-xl flex items-center justify-between cursor-pointer hover:bg-blue-500/15 transition-colors">
                      <div>
                        <div className="text-sm font-semibold text-blue-400">{bookedJob.customerName}</div>
                        <div className="text-xs text-slate-400 mt-0.5">{bookedJob.jobDescription?.slice(0, 50) || 'Job'}</div>
                      </div>
                      <div className="text-lg font-bold text-blue-300">
                        £{Math.round(getJobPrice(bookedJob) / 100)}
                      </div>
                    </div>
                  </Link>
                </motion.div>
              );
            })()}
          </AnimatePresence>
        </>
      )}

      {/* Mini Picker Overlay */}
      <AnimatePresence>
        {selectedDate && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-sm"
            onClick={() => setSelectedDate(null)}
          >
            <motion.div
              ref={pickerRef}
              initial={{ y: 100, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 100, opacity: 0 }}
              transition={{ type: 'spring', damping: 25, stiffness: 300 }}
              className="w-full max-w-md mx-4 mb-8 bg-slate-900 border border-slate-700 rounded-2xl p-5 shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Picker header */}
              <div className="flex items-center justify-between mb-5">
                <div>
                  <div className="text-lg font-bold text-white">
                    {format(new Date(selectedDate + 'T00:00:00'), 'EEEE d MMM')}
                  </div>
                  <div className="text-xs text-slate-400 mt-0.5">Set your availability</div>
                </div>
                <button
                  onClick={() => setSelectedDate(null)}
                  className="w-8 h-8 rounded-full bg-slate-800 flex items-center justify-center text-slate-400 hover:text-white transition-colors"
                >
                  <X size={16} />
                </button>
              </div>

              {/* AM / PM / Full Day buttons */}
              {(() => {
                const day = days?.find(d => d.date === selectedDate);
                const currentMode = day ? getMode(day) : 'off';

                return (
                  <div className="space-y-2">
                    {/* AM */}
                    <button
                      onClick={() => handleSetMode(selectedDate, currentMode === 'am' || currentMode === 'full' ? (currentMode === 'full' ? 'pm' : 'off') : (currentMode === 'pm' ? 'full' : 'am'))}
                      className={`w-full flex items-center gap-3 p-4 rounded-xl border transition-all active:scale-[0.98] ${
                        currentMode === 'am' || currentMode === 'full'
                          ? 'bg-amber-500/20 border-amber-500/40 text-amber-400'
                          : 'bg-slate-800/80 border-slate-700 text-slate-400 hover:border-slate-600'
                      }`}
                    >
                      <Sun size={20} />
                      <div className="flex-1 text-left">
                        <div className="font-bold text-sm">Morning</div>
                        <div className="text-[11px] opacity-70">8am — 12pm</div>
                      </div>
                      {(currentMode === 'am' || currentMode === 'full') && (
                        <div className="w-5 h-5 rounded-full bg-amber-500 flex items-center justify-center">
                          <svg width="10" height="8" viewBox="0 0 10 8" fill="none"><path d="M1 4L3.5 6.5L9 1" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
                        </div>
                      )}
                    </button>

                    {/* PM */}
                    <button
                      onClick={() => handleSetMode(selectedDate, currentMode === 'pm' || currentMode === 'full' ? (currentMode === 'full' ? 'am' : 'off') : (currentMode === 'am' ? 'full' : 'pm'))}
                      className={`w-full flex items-center gap-3 p-4 rounded-xl border transition-all active:scale-[0.98] ${
                        currentMode === 'pm' || currentMode === 'full'
                          ? 'bg-emerald-500/20 border-emerald-500/40 text-emerald-400'
                          : 'bg-slate-800/80 border-slate-700 text-slate-400 hover:border-slate-600'
                      }`}
                    >
                      <Sunset size={20} />
                      <div className="flex-1 text-left">
                        <div className="font-bold text-sm">Afternoon</div>
                        <div className="text-[11px] opacity-70">1pm — 5pm</div>
                      </div>
                      {(currentMode === 'pm' || currentMode === 'full') && (
                        <div className="w-5 h-5 rounded-full bg-emerald-500 flex items-center justify-center">
                          <svg width="10" height="8" viewBox="0 0 10 8" fill="none"><path d="M1 4L3.5 6.5L9 1" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
                        </div>
                      )}
                    </button>

                    {/* Full Day shortcut */}
                    <button
                      onClick={() => handleSetMode(selectedDate, currentMode === 'full' ? 'off' : 'full')}
                      className={`w-full flex items-center gap-3 p-4 rounded-xl border transition-all active:scale-[0.98] ${
                        currentMode === 'full'
                          ? 'bg-emerald-500/20 border-emerald-500/40 text-emerald-400'
                          : 'bg-slate-800/80 border-slate-700 text-slate-400 hover:border-slate-600'
                      }`}
                    >
                      <Clock size={20} />
                      <div className="flex-1 text-left">
                        <div className="font-bold text-sm">Full Day</div>
                        <div className="text-[11px] opacity-70">8am — 5pm</div>
                      </div>
                      {currentMode === 'full' && (
                        <div className="w-5 h-5 rounded-full bg-emerald-500 flex items-center justify-center">
                          <svg width="10" height="8" viewBox="0 0 10 8" fill="none"><path d="M1 4L3.5 6.5L9 1" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
                        </div>
                      )}
                    </button>

                    {/* Clear */}
                    {currentMode !== 'off' && (
                      <button
                        onClick={() => handleSetMode(selectedDate, 'off')}
                        className="w-full py-3 text-center text-sm font-medium text-red-400 hover:text-red-300 transition-colors"
                      >
                        Mark as unavailable
                      </button>
                    )}
                  </div>
                );
              })()}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Footer */}
      <div className="mt-5 text-center text-[10px] text-slate-600">
        Keep your calendar updated — we fill your free days with matching jobs
      </div>
    </div>
  );
}
