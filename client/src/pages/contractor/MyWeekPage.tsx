/**
 * My Week — the contractor availability app (solo v1).
 *
 * Tokenised, no-login: /my-week/:token (handyman_profiles.app_token), texted
 * over WhatsApp. The harvest surface of the contractor platform: tap a day →
 * AM / PM / Full / Off, plus a "usual week" recurring pattern. Writes land in
 * the same tables the customer quote calendar reads, so an opened day is
 * immediately bookable. Craig is the template; a teams variant forks on
 * provider.type. See docs/contractor-platform/04-contractor-app.md.
 */
import { useMemo, useState } from 'react';
import { useRoute } from 'wouter';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { format, formatDistanceToNow } from 'date-fns';
import { motion, AnimatePresence } from 'framer-motion';
import { Sun, Sunset, Clock, X, Lock, CalendarCheck2, Eye, FileText } from 'lucide-react';

// ── Types (mirror server/contractor-app-routes.ts) ────────────────────────────

type SlotState = 'off' | 'open' | 'booked';
type DayMode = 'am' | 'pm' | 'full' | 'off';

interface AppDay {
  date: string; // YYYY-MM-DD
  dayOfWeek: number;
  am: SlotState;
  pm: SlotState;
}

interface PatternDay {
  dayOfWeek: number;
  am: boolean;
  pm: boolean;
}

interface PipelineQuote {
  id: string;
  postcodeArea: string | null;
  jobDescription: string | null;
  valuePence: number | null;
  sentAt: string | null;
  viewed: boolean;
  viewCount: number;
  lastViewedAt: string | null;
  expiresAt: string | null;
}

interface PipelinePayload {
  liveCount: number;
  expiredCount: number;
  quotes: PipelineQuote[];
}

interface AppPayload {
  provider: {
    type: 'solo';
    firstName: string;
    name: string;
    imageUrl: string | null;
    lastAvailabilityRefresh: string | null;
  };
  today: string;
  weekStart: string;
  days: AppDay[];
  pattern: PatternDay[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function dayMode(day: Pick<AppDay, 'am' | 'pm'>): DayMode {
  const amOn = day.am === 'open';
  const pmOn = day.pm === 'open';
  if (amOn && pmOn) return 'full';
  if (amOn) return 'am';
  if (pmOn) return 'pm';
  return 'off';
}

function patternMode(p: PatternDay): DayMode {
  if (p.am && p.pm) return 'full';
  if (p.am) return 'am';
  if (p.pm) return 'pm';
  return 'off';
}

const NEXT_PATTERN_MODE: Record<DayMode, DayMode> = { off: 'full', full: 'am', am: 'pm', pm: 'off' };

const MODE_STYLE: Record<DayMode, { bg: string; label: string; labelColor: string }> = {
  full: { bg: 'bg-emerald-500/15 border-emerald-500/30', label: 'Full', labelColor: 'text-emerald-400' },
  am:   { bg: 'bg-amber-500/12 border-amber-500/25',     label: 'AM',   labelColor: 'text-amber-400' },
  pm:   { bg: 'bg-sky-500/12 border-sky-500/25',         label: 'PM',   labelColor: 'text-sky-400' },
  off:  { bg: 'bg-slate-900/60 border-slate-800/60',     label: '',     labelColor: '' },
};

const WEEK_TITLES = ['This week', 'Next week'];

// ── Component ─────────────────────────────────────────────────────────────────

export default function MyWeekPage() {
  const [, params] = useRoute('/my-week/:token');
  const token = params?.token ?? '';
  const queryClient = useQueryClient();
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [patternDraft, setPatternDraft] = useState<PatternDay[] | null>(null);
  const [savedFlash, setSavedFlash] = useState(false);
  const [tab, setTab] = useState<'week' | 'quotes'>('week');

  const { data, isLoading, isError } = useQuery<AppPayload>({
    queryKey: ['contractor-app', token],
    queryFn: async () => {
      const res = await fetch(`/api/contractor-app/${token}`);
      if (!res.ok) throw new Error('load failed');
      return res.json();
    },
    enabled: !!token,
  });

  // Pipeline — quotes wearing this contractor's skin (fed by the same token).
  const { data: pipeline } = useQuery<PipelinePayload>({
    queryKey: ['contractor-app-pipeline', token],
    queryFn: async () => {
      const res = await fetch(`/api/contractor-app/${token}/pipeline`);
      if (!res.ok) throw new Error('load failed');
      return res.json();
    },
    enabled: !!token,
  });

  // ── Day override mutation (optimistic) ──
  const dayMutation = useMutation({
    mutationFn: async ({ date, mode }: { date: string; mode: DayMode }) => {
      const res = await fetch(`/api/contractor-app/${token}/day`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date, mode }),
      });
      if (!res.ok) throw new Error('save failed');
    },
    onMutate: async ({ date, mode }) => {
      await queryClient.cancelQueries({ queryKey: ['contractor-app', token] });
      const prev = queryClient.getQueryData<AppPayload>(['contractor-app', token]);
      queryClient.setQueryData<AppPayload>(['contractor-app', token], (old) => {
        if (!old) return old as any;
        return {
          ...old,
          days: old.days.map((d) => {
            if (d.date !== date) return d;
            const am: SlotState = d.am === 'booked' ? 'booked' : mode === 'am' || mode === 'full' ? 'open' : 'off';
            const pm: SlotState = d.pm === 'booked' ? 'booked' : mode === 'pm' || mode === 'full' ? 'open' : 'off';
            return { ...d, am, pm };
          }),
        };
      });
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) queryClient.setQueryData(['contractor-app', token], ctx.prev);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['contractor-app', token] }),
  });

  // ── Usual-week pattern mutation ──
  const patternMutation = useMutation({
    mutationFn: async (days: PatternDay[]) => {
      const res = await fetch(`/api/contractor-app/${token}/pattern`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ days: days.map((p) => ({ dayOfWeek: p.dayOfWeek, mode: patternMode(p) })) }),
      });
      if (!res.ok) throw new Error('save failed');
    },
    onSuccess: () => {
      setPatternDraft(null);
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 2000);
      queryClient.invalidateQueries({ queryKey: ['contractor-app', token] });
    },
  });

  const weeks = useMemo(() => {
    if (!data) return [];
    const out: AppDay[][] = [];
    for (let i = 0; i < data.days.length; i += 7) out.push(data.days.slice(i, i + 7));
    return out;
  }, [data]);

  const pattern = patternDraft ?? data?.pattern ?? [];
  // Mon-first ordering for display (server sends dayOfWeek 0=Sun).
  const patternMonFirst = useMemo(
    () => [1, 2, 3, 4, 5, 6, 0].map((dow) => pattern.find((p) => p.dayOfWeek === dow)).filter(Boolean) as PatternDay[],
    [pattern],
  );

  const handleSetMode = (date: string, mode: DayMode) => {
    dayMutation.mutate({ date, mode });
    setSelectedDate(null);
  };

  const cyclePatternDay = (dow: number) => {
    const base = patternDraft ?? data?.pattern ?? [];
    setPatternDraft(base.map((p) => (p.dayOfWeek === dow ? nextPattern(p) : p)));
  };

  function nextPattern(p: PatternDay): PatternDay {
    const next = NEXT_PATTERN_MODE[patternMode(p)];
    return { ...p, am: next === 'am' || next === 'full', pm: next === 'pm' || next === 'full' };
  }

  // ── Render ──

  if (!token || isError) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center p-6">
        <div className="text-center">
          <div className="text-lg font-bold text-white mb-1">Link not recognised</div>
          <p className="text-sm text-slate-400">Ask Handy Services to send you a fresh link.</p>
        </div>
      </div>
    );
  }

  const openCount = data?.days.filter((d) => d.date >= data.today && (d.am === 'open' || d.pm === 'open')).length ?? 0;
  const bookedCount = data?.days.filter((d) => d.am === 'booked' || d.pm === 'booked').length ?? 0;
  const selectedDay = data?.days.find((d) => d.date === selectedDate);

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <div className="max-w-md mx-auto px-4 pt-6 pb-16">
        {/* Header */}
        <div className="flex items-center gap-3 mb-1">
          {data?.provider.imageUrl ? (
            <img src={data.provider.imageUrl} alt="" className="w-10 h-10 rounded-full object-cover border border-slate-700" />
          ) : (
            <div className="w-10 h-10 rounded-full bg-slate-800 flex items-center justify-center">
              <CalendarCheck2 size={18} className="text-slate-400" />
            </div>
          )}
          <div>
            <h1 className="text-xl font-bold leading-tight">
              {isLoading ? 'Your week' : `${data?.provider.firstName}'s week`}
            </h1>
            <div className="flex items-center gap-3 text-[11px]">
              {openCount > 0 && <span className="text-emerald-400 font-semibold">{openCount} days open</span>}
              {bookedCount > 0 && <span className="text-blue-400 font-semibold">{bookedCount} booked</span>}
            </div>
          </div>
        </div>
        <p className="text-xs text-slate-500 mb-4 mt-2">
          Tap a day to open or close it. Customers can only book days you open.
        </p>

        {/* Tabs */}
        <div className="flex gap-2 mb-4">
          <button
            onClick={() => setTab('week')}
            className={`flex-1 py-2 rounded-xl text-sm font-bold border transition-all ${
              tab === 'week' ? 'bg-white text-slate-950 border-white' : 'bg-slate-900/60 text-slate-400 border-slate-800'
            }`}
          >
            My week
          </button>
          <button
            onClick={() => setTab('quotes')}
            className={`flex-1 py-2 rounded-xl text-sm font-bold border transition-all ${
              tab === 'quotes' ? 'bg-white text-slate-950 border-white' : 'bg-slate-900/60 text-slate-400 border-slate-800'
            }`}
          >
            My quotes{pipeline ? ` (${pipeline.liveCount})` : ''}
          </button>
        </div>

        {/* Live-quotes strip — the demand your open days are feeding */}
        {tab === 'week' && (pipeline?.liveCount ?? 0) > 0 && (
          <button
            onClick={() => setTab('quotes')}
            className="w-full mb-5 p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/25 flex items-center gap-2.5 text-left active:scale-[0.99] transition-all"
          >
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse shrink-0" />
            <span className="text-xs text-emerald-300 font-semibold flex-1">
              {pipeline!.liveCount} live quote{pipeline!.liveCount === 1 ? '' : 's'} showing your days to customers right now
            </span>
            <span className="text-emerald-400 text-xs">View →</span>
          </button>
        )}

        {/* Loading */}
        {tab === 'week' && isLoading && (
          <div className="space-y-2">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="h-20 bg-slate-900 rounded-xl animate-pulse" />
            ))}
          </div>
        )}

        {/* Week rows */}
        {tab === 'week' && !isLoading && weeks.map((week, wi) => (
          <div key={week[0]?.date ?? wi} className="mb-5">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-2">
              {WEEK_TITLES[wi] ?? `Week of ${format(new Date(week[0].date + 'T00:00:00'), 'd MMM')}`}
            </div>
            <div className="grid grid-cols-7 gap-1.5">
              {week.map((day) => {
                const dateObj = new Date(day.date + 'T00:00:00');
                const isPast = data ? day.date < data.today : false;
                const isToday = data ? day.date === data.today : false;
                const hasBooking = day.am === 'booked' || day.pm === 'booked';
                const mode = dayMode(day);
                const style = hasBooking
                  ? { bg: 'bg-blue-500/15 border-blue-500/30', label: 'Booked', labelColor: 'text-blue-400' }
                  : MODE_STYLE[mode];

                return (
                  <button
                    key={day.date}
                    disabled={isPast || hasBooking}
                    aria-label={`${format(dateObj, 'EEEE d MMMM')} — ${hasBooking ? 'booked' : mode === 'off' ? 'not working' : mode === 'full' ? 'full day' : mode.toUpperCase()}`}
                    onClick={() => setSelectedDate(day.date)}
                    className={`aspect-[3/4] rounded-lg border flex flex-col items-center justify-center gap-0.5 transition-all active:scale-95 ${style.bg} ${
                      isPast ? 'opacity-30' : ''
                    } ${isToday ? 'ring-1 ring-amber-500/50' : ''}`}
                  >
                    <span className="text-[9px] font-medium uppercase text-slate-500">{format(dateObj, 'EEEEE')}</span>
                    <span className="text-sm font-bold leading-none">{format(dateObj, 'd')}</span>
                    {hasBooking ? (
                      <Lock size={9} className="text-blue-400 mt-0.5" />
                    ) : (
                      <span className={`text-[8px] font-bold mt-0.5 ${style.labelColor}`}>{style.label || '·'}</span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        ))}

        {/* Usual week */}
        {tab === 'week' && !isLoading && data && (
          <div className="mt-8 p-4 bg-slate-900/60 border border-slate-800/60 rounded-2xl">
            <div className="flex items-center justify-between mb-1">
              <div className="text-sm font-bold">Your usual week</div>
              {savedFlash && <span className="text-[11px] font-semibold text-emerald-400">Saved ✓</span>}
            </div>
            <p className="text-[11px] text-slate-500 mb-3">
              Tap to cycle: Full → AM → PM → Off. This repeats every week — single days above override it.
            </p>
            <div className="grid grid-cols-7 gap-1.5 mb-3">
              {patternMonFirst.map((p) => {
                const mode = patternMode(p);
                const style = MODE_STYLE[mode];
                return (
                  <button
                    key={p.dayOfWeek}
                    aria-label={`Usual ${['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][p.dayOfWeek]}: ${mode === 'off' ? 'not working' : mode === 'full' ? 'full day' : mode.toUpperCase()}`}
                    onClick={() => cyclePatternDay(p.dayOfWeek)}
                    className={`aspect-square rounded-lg border flex flex-col items-center justify-center gap-0.5 transition-all active:scale-95 ${style.bg}`}
                  >
                    <span className="text-[10px] font-bold text-slate-300">{'MTWTFSS'[[1, 2, 3, 4, 5, 6, 0].indexOf(p.dayOfWeek)]}</span>
                    <span className={`text-[8px] font-bold ${style.labelColor}`}>{style.label || '—'}</span>
                  </button>
                );
              })}
            </div>
            {patternDraft && (
              <button
                onClick={() => patternMutation.mutate(patternDraft)}
                disabled={patternMutation.isPending}
                className="w-full py-3 rounded-xl bg-emerald-500 text-slate-950 font-bold text-sm active:scale-[0.98] transition-all disabled:opacity-50"
              >
                {patternMutation.isPending ? 'Saving…' : 'Save usual week'}
              </button>
            )}
          </div>
        )}

        {/* Quotes tab — the pipeline wearing this contractor's skin */}
        {tab === 'quotes' && (
          <div>
            {!pipeline && <div className="h-24 bg-slate-900 rounded-xl animate-pulse" />}
            {pipeline && pipeline.quotes.length === 0 && (
              <div className="p-6 text-center bg-slate-900/60 border border-slate-800/60 rounded-2xl">
                <FileText size={20} className="mx-auto text-slate-600 mb-2" />
                <div className="text-sm font-bold text-slate-300">No live quotes right now</div>
                <p className="text-xs text-slate-500 mt-1">New quotes with your name on them will show here.</p>
              </div>
            )}
            <div className="space-y-2.5">
              {pipeline?.quotes.map((q) => (
                <div key={q.id} className="p-4 bg-slate-900/60 border border-slate-800/60 rounded-xl">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        {q.postcodeArea && <span className="text-[10px] font-bold tracking-wider text-slate-400 bg-slate-800 rounded px-1.5 py-0.5">{q.postcodeArea}</span>}
                        {q.viewed ? (
                          <span className="flex items-center gap-1 text-[10px] font-semibold text-emerald-400"><Eye size={11} /> Seen{q.viewCount > 1 ? ` ×${q.viewCount}` : ''}</span>
                        ) : (
                          <span className="text-[10px] font-semibold text-slate-500">Not seen yet</span>
                        )}
                      </div>
                      {q.jobDescription && <p className="text-xs text-slate-300 mt-1.5 leading-snug">{q.jobDescription}</p>}
                      <div className="text-[10px] text-slate-500 mt-1.5">
                        {q.sentAt && <>Sent {formatDistanceToNow(new Date(q.sentAt), { addSuffix: true })}</>}
                        {q.expiresAt && new Date(q.expiresAt) > new Date() && <> · expires {formatDistanceToNow(new Date(q.expiresAt), { addSuffix: true })}</>}
                      </div>
                    </div>
                    {q.valuePence != null && (
                      <div className="text-lg font-bold text-white shrink-0">£{Math.round(q.valuePence / 100)}</div>
                    )}
                  </div>
                </div>
              ))}
            </div>
            {pipeline && pipeline.quotes.length > 0 && (
              <p className="mt-4 text-center text-[10px] text-slate-600">
                These quotes carry your name and photo. The days you open on "My week" are the days these customers can book.
              </p>
            )}
          </div>
        )}

        {/* Freshness footer */}
        {tab === 'week' && data?.provider.lastAvailabilityRefresh && (
          <div className="mt-5 text-center text-[10px] text-slate-600">
            Last updated {formatDistanceToNow(new Date(data.provider.lastAvailabilityRefresh), { addSuffix: true })}.
            Keep this fresh — we only offer customers days you've opened.
          </div>
        )}
      </div>

      {/* Day bottom sheet */}
      <AnimatePresence>
        {selectedDate && selectedDay && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-sm"
            onClick={() => setSelectedDate(null)}
          >
            <motion.div
              initial={{ y: 100, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 100, opacity: 0 }}
              transition={{ type: 'spring', damping: 25, stiffness: 300 }}
              className="w-full max-w-md mx-4 mb-8 bg-slate-900 border border-slate-700 rounded-2xl p-5 shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between mb-5">
                <div>
                  <div className="text-lg font-bold">{format(new Date(selectedDate + 'T00:00:00'), 'EEEE d MMM')}</div>
                  <div className="text-xs text-slate-400 mt-0.5">When can you work?</div>
                </div>
                <button
                  onClick={() => setSelectedDate(null)}
                  className="w-8 h-8 rounded-full bg-slate-800 flex items-center justify-center text-slate-400"
                >
                  <X size={16} />
                </button>
              </div>

              {(() => {
                const current = dayMode(selectedDay);
                const TINT_ON: Record<string, string> = {
                  amber: 'bg-amber-500/20 border-amber-500/40 text-amber-400',
                  sky: 'bg-sky-500/20 border-sky-500/40 text-sky-400',
                  emerald: 'bg-emerald-500/20 border-emerald-500/40 text-emerald-400',
                };
                const TINT_DOT: Record<string, string> = { amber: 'bg-amber-500', sky: 'bg-sky-500', emerald: 'bg-emerald-500' };
                const rows: Array<{ mode: DayMode; icon: any; title: string; time: string; on: boolean; tint: string }> = [
                  { mode: 'am', icon: Sun, title: 'Morning', time: '9am — 1pm', on: current === 'am', tint: 'amber' },
                  { mode: 'pm', icon: Sunset, title: 'Afternoon', time: '2pm — 6pm', on: current === 'pm', tint: 'sky' },
                  { mode: 'full', icon: Clock, title: 'Full day', time: '9am — 6pm', on: current === 'full', tint: 'emerald' },
                ];
                return (
                  <div className="space-y-2">
                    {rows.map((r) => (
                      <button
                        key={r.mode}
                        onClick={() => handleSetMode(selectedDate, r.on ? 'off' : r.mode)}
                        className={`w-full flex items-center gap-3 p-4 rounded-xl border transition-all active:scale-[0.98] ${
                          r.on ? TINT_ON[r.tint] : 'bg-slate-800/80 border-slate-700 text-slate-400'
                        }`}
                      >
                        <r.icon size={20} />
                        <div className="flex-1 text-left">
                          <div className="font-bold text-sm">{r.title}</div>
                          <div className="text-[11px] opacity-70">{r.time}</div>
                        </div>
                        {r.on && (
                          <div className={`w-5 h-5 rounded-full ${TINT_DOT[r.tint]} flex items-center justify-center`}>
                            <svg width="10" height="8" viewBox="0 0 10 8" fill="none"><path d="M1 4L3.5 6.5L9 1" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
                          </div>
                        )}
                      </button>
                    ))}
                    {current !== 'off' && (
                      <button
                        onClick={() => handleSetMode(selectedDate, 'off')}
                        className="w-full py-3 text-center text-sm font-medium text-red-400"
                      >
                        Not available this day
                      </button>
                    )}
                  </div>
                );
              })()}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
