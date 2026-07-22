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
import { Sun, Sunset, Clock, X, Lock, CalendarCheck2, Eye, FileText, CalendarDays, Briefcase, UserRound } from 'lucide-react';

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

interface BookedJob {
  id: string;
  date: string;
  slot: 'am' | 'pm' | 'full_day';
  durationDays?: number;
  customerName: string;
  postcodeArea: string | null;
  jobDescription: string | null;
  valuePence: number | null;
}

interface FlexJob {
  quoteId: string;
  postcodeArea: string | null;
  jobDescription: string | null;
  valuePence: number | null;
  deadline: string | null;
  multiDay: boolean;
  needsFullDay: boolean;
  suggestions: Array<{ date: string; slot: 'am' | 'pm' | 'full_day'; reasons: string[]; packed?: boolean }>;
}

interface JobsPayload {
  booked: BookedJob[];
  flex: FlexJob[];
}

type DayPlanGoal = 'earnings' | 'fewest_days' | 'soonest';

interface DayPlan {
  date: string;
  rationale: string;
  totalPence: number;
  committedCount: number;
  jobs: Array<{ quoteId: string; fixed: boolean; slot: string; customerName: string; postcodeArea: string | null; jobDescription: string | null; valuePence: number }>;
  placements: Array<{ quoteId: string; date: string; slot: string }>;
}

interface DayPlansPayload {
  goal: DayPlanGoal;
  plans: DayPlan[];
  unassignable: Array<{ quoteId: string; reason: string }>;
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
  bookedCountByDate?: Record<string, number>;
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
  const [tab, setTab] = useState<'week' | 'quotes' | 'jobs'>('week');
  const [confirmPlace, setConfirmPlace] = useState<string | null>(null); // `${quoteId}|${date}|${slot}`
  const [placeError, setPlaceError] = useState<{ quoteId: string; message: string } | null>(null);
  const [planGoal, setPlanGoal] = useState<DayPlanGoal>('earnings');
  const [confirmLock, setConfirmLock] = useState<string | null>(null); // plan date
  const [lockError, setLockError] = useState<string | null>(null);

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

  // Jobs — booked work + flex queue with placement suggestions.
  const { data: jobs } = useQuery<JobsPayload>({
    queryKey: ['contractor-app-jobs', token],
    queryFn: async () => {
      const res = await fetch(`/api/contractor-app/${token}/jobs`);
      if (!res.ok) throw new Error('load failed');
      return res.json();
    },
    enabled: !!token,
  });

  // Day Builder — the flex pool composed into day-packs by the optimiser.
  const flexCount = jobs?.flex.filter((f) => !f.multiDay).length ?? 0;
  const { data: dayPlans, isFetching: plansLoading } = useQuery<DayPlansPayload>({
    queryKey: ['contractor-app-day-plans', token, planGoal],
    queryFn: async () => {
      const res = await fetch(`/api/contractor-app/${token}/day-plans?goal=${planGoal}`);
      if (!res.ok) throw new Error('load failed');
      return res.json();
    },
    enabled: !!token && tab === 'jobs' && flexCount >= 2,
  });

  const lockMutation = useMutation({
    mutationFn: async (placements: DayPlan['placements']) => {
      const res = await fetch(`/api/contractor-app/${token}/day-plans/lock`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ placements }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error || 'Could not lock the day');
      if (body?.failed?.length) throw new Error(`${body.placed.length} booked, ${body.failed.length} failed: ${body.failed[0]?.error}`);
    },
    onSuccess: () => {
      setConfirmLock(null);
      setLockError(null);
      queryClient.invalidateQueries({ queryKey: ['contractor-app-jobs', token] });
      queryClient.invalidateQueries({ queryKey: ['contractor-app', token] });
      queryClient.invalidateQueries({ queryKey: ['contractor-app-day-plans', token] });
    },
    onError: (e: any) => {
      setConfirmLock(null);
      setLockError(e?.message || 'Could not lock the day');
      queryClient.invalidateQueries({ queryKey: ['contractor-app-jobs', token] });
      queryClient.invalidateQueries({ queryKey: ['contractor-app-day-plans', token] });
    },
  });

  // Self-place a flex job onto one of his own open days.
  const placeMutation = useMutation({
    mutationFn: async ({ quoteId, date, slot }: { quoteId: string; date: string; slot: string }) => {
      const res = await fetch(`/api/contractor-app/${token}/flex/${quoteId}/place`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date, slot }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error || 'Could not place the job');
    },
    onSuccess: () => {
      setConfirmPlace(null);
      setPlaceError(null);
      queryClient.invalidateQueries({ queryKey: ['contractor-app-jobs', token] });
      queryClient.invalidateQueries({ queryKey: ['contractor-app', token] });
      queryClient.invalidateQueries({ queryKey: ['contractor-app-pipeline', token] });
    },
    onError: (e: any, vars) => {
      setConfirmPlace(null);
      setPlaceError({ quoteId: vars.quoteId, message: e?.message || 'Could not place the job' });
      // Re-rank — the engine knows something the suggestions didn't.
      queryClient.invalidateQueries({ queryKey: ['contractor-app-jobs', token] });
    },
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
      <div className="max-w-md mx-auto px-4 pt-6 pb-32">
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
          {tab === 'quotes'
            ? 'Live quotes going out with your name and photo on them.'
            : tab === 'jobs'
              ? 'Paid work: booked days, plus flexible jobs waiting for you to pick a day.'
              : 'Tap a day to open or close it. Customers can only book days you open.'}
        </p>

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
                      (data?.bookedCountByDate?.[day.date] ?? 1) > 1 ? (
                        <span className="text-[8px] font-bold text-blue-400 mt-0.5">×{data!.bookedCountByDate![day.date]}</span>
                      ) : (
                        <Lock size={9} className="text-blue-400 mt-0.5" />
                      )
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

        {/* Jobs tab — flex queue (needs a day) + booked work */}
        {tab === 'jobs' && (
          <div>
            {!jobs && <div className="h-24 bg-slate-900 rounded-xl animate-pulse" />}

            {/* Day Builder — the pool composed into day-packs, goal picked by him */}
            {jobs && flexCount >= 2 && (
              <div className="mb-6 p-4 bg-slate-900/60 border border-emerald-500/25 rounded-2xl">
                <div className="text-sm font-bold mb-1">Build my days</div>
                <p className="text-[11px] text-slate-500 mb-3">
                  Your {flexCount} flexible jobs, grouped into days. Pick what matters and lock a day in one go.
                </p>
                <div className="flex gap-1.5 mb-3">
                  {([
                    { key: 'earnings' as const, label: 'Best £/day' },
                    { key: 'fewest_days' as const, label: 'Fewest days' },
                    { key: 'soonest' as const, label: 'Cash soonest' },
                  ]).map((g) => (
                    <button
                      key={g.key}
                      onClick={() => { setPlanGoal(g.key); setConfirmLock(null); }}
                      className={`flex-1 py-1.5 rounded-lg text-[11px] font-bold border transition-all ${
                        planGoal === g.key ? 'bg-emerald-500 text-slate-950 border-emerald-500' : 'bg-slate-800/70 text-slate-400 border-slate-700'
                      }`}
                    >
                      {g.label}
                    </button>
                  ))}
                </div>
                {lockError && <p className="text-[11px] font-semibold text-red-400 mb-2">{lockError}</p>}
                {plansLoading && <div className="h-16 bg-slate-800/60 rounded-xl animate-pulse" />}
                {!plansLoading && dayPlans && dayPlans.plans.length === 0 && (
                  <p className="text-[11px] text-slate-500">No day plans possible — open more days on "Week".</p>
                )}
                {!plansLoading && dayPlans?.plans.map((p) => {
                  const confirming = confirmLock === p.date;
                  return (
                    <div key={p.date} className="mb-2 p-3 bg-slate-800/50 border border-slate-700/60 rounded-xl">
                      <div className="flex items-center justify-between gap-2">
                        <div className="text-sm font-bold">{format(new Date(p.date + 'T00:00:00'), 'EEE d MMM')}</div>
                        <div className="text-base font-bold text-emerald-400">£{Math.round(p.totalPence / 100)}</div>
                      </div>
                      <div className="text-[10px] text-slate-500 mb-2">{p.rationale}</div>
                      <div className="space-y-1 mb-2.5">
                        {p.jobs.map((j) => (
                          <div key={j.quoteId} className="flex items-center gap-2 text-[11px]">
                            <span className={`font-bold uppercase w-7 shrink-0 ${j.fixed ? 'text-blue-400' : 'text-slate-400'}`}>{j.slot === 'full_day' ? 'DAY' : j.slot}</span>
                            <span className="text-slate-300 truncate flex-1">{j.jobDescription || j.customerName}</span>
                            {j.postcodeArea && <span className="text-slate-500 shrink-0">{j.postcodeArea}</span>}
                            <span className="text-slate-400 font-semibold shrink-0">£{Math.round(j.valuePence / 100)}</span>
                            {j.fixed && <Lock size={9} className="text-blue-400 shrink-0" />}
                          </div>
                        ))}
                      </div>
                      {p.placements.length > 0 && (
                        <button
                          disabled={lockMutation.isPending}
                          onClick={() => (confirming ? lockMutation.mutate(p.placements) : setConfirmLock(p.date))}
                          className={`w-full py-2 rounded-lg text-xs font-bold transition-all active:scale-[0.99] ${
                            confirming ? 'bg-emerald-500 text-slate-950' : 'bg-slate-700/80 text-slate-200'
                          }`}
                        >
                          {confirming
                            ? (lockMutation.isPending ? 'Booking the day…' : `Confirm — book ${p.placements.length} job${p.placements.length === 1 ? '' : 's'} on ${format(new Date(p.date + 'T00:00:00'), 'EEE d')}?`)
                            : 'Lock this day'}
                        </button>
                      )}
                    </div>
                  );
                })}
                {!plansLoading && (dayPlans?.unassignable.length ?? 0) > 0 && (
                  <p className="text-[10px] text-slate-500 mt-1">{dayPlans!.unassignable.length} job{dayPlans!.unassignable.length === 1 ? ' has' : 's have'} no possible day yet — open more days or call us.</p>
                )}
              </div>
            )}

            {jobs && jobs.flex.length > 0 && (
              <div className="mb-6">
                <div className="text-[11px] font-semibold uppercase tracking-wider text-amber-400 mb-2">Needs a day — pick one</div>
                <div className="space-y-3">
                  {jobs.flex.map((f) => {
                    const overdue = f.deadline ? f.deadline < (data?.today ?? '') : false;
                    return (
                      <div key={f.quoteId} className="p-4 bg-slate-900/60 border border-amber-500/25 rounded-xl">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              {f.postcodeArea && <span className="text-[10px] font-bold tracking-wider text-slate-400 bg-slate-800 rounded px-1.5 py-0.5">{f.postcodeArea}</span>}
                              {f.deadline && (
                                <span className={`text-[10px] font-semibold ${overdue ? 'text-red-400' : 'text-amber-400'}`}>
                                  {overdue ? 'Overdue — call us' : `needs a day by ${format(new Date(f.deadline + 'T00:00:00'), 'EEE d MMM')}`}
                                </span>
                              )}
                            </div>
                            {f.jobDescription && <p className="text-xs text-slate-300 mt-1.5 leading-snug">{f.jobDescription}</p>}
                          </div>
                          {f.valuePence != null && <div className="text-lg font-bold text-white shrink-0">£{Math.round(f.valuePence / 100)}</div>}
                        </div>

                        {placeError?.quoteId === f.quoteId && (
                          <p className="mt-2 text-[11px] font-semibold text-red-400">{placeError.message}</p>
                        )}
                        {f.multiDay ? (
                          <p className="mt-3 text-[11px] text-slate-500">Multi-day job — Handy will schedule this with you.</p>
                        ) : f.suggestions.length === 0 ? (
                          <p className="mt-3 text-[11px] text-slate-500">No open days before the deadline — open a day on "Week" or call us.</p>
                        ) : (
                          <div className="mt-3 space-y-1.5">
                            {f.suggestions.map((s) => {
                              const key = `${f.quoteId}|${s.date}|${s.slot}`;
                              const confirming = confirmPlace === key;
                              const slotLabel = s.slot === 'am' ? 'Morning' : s.slot === 'pm' ? 'Afternoon' : 'Full day';
                              return (
                                <button
                                  key={key}
                                  disabled={placeMutation.isPending}
                                  onClick={() => (confirming
                                    ? placeMutation.mutate({ quoteId: f.quoteId, date: s.date, slot: s.slot })
                                    : setConfirmPlace(key))}
                                  className={`w-full flex items-center gap-2 p-2.5 rounded-lg border text-left transition-all active:scale-[0.99] ${
                                    confirming ? 'bg-emerald-500 border-emerald-500 text-slate-950' : 'bg-slate-800/70 border-slate-700 text-slate-200'
                                  }`}
                                >
                                  <span className="text-xs font-bold shrink-0">
                                    {confirming ? (placeMutation.isPending ? 'Booking…' : `Confirm ${format(new Date(s.date + 'T00:00:00'), 'EEE d')} ${slotLabel}?`) : `${format(new Date(s.date + 'T00:00:00'), 'EEE d MMM')} · ${slotLabel}`}
                                  </span>
                                  {!confirming && s.packed && (
                                    <span className="text-[9px] font-bold text-amber-400 bg-amber-500/15 border border-amber-500/30 rounded px-1 py-0.5 shrink-0">2ND JOB</span>
                                  )}
                                  {!confirming && s.reasons.length > 0 && (
                                    <span className="text-[10px] text-emerald-400/90 truncate">{s.reasons[0]}</span>
                                  )}
                                </button>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {jobs && (
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-2">Booked</div>
                {jobs.booked.length === 0 ? (
                  <div className="p-6 text-center bg-slate-900/60 border border-slate-800/60 rounded-2xl">
                    <Briefcase size={20} className="mx-auto text-slate-600 mb-2" />
                    <div className="text-sm font-bold text-slate-300">Nothing booked yet</div>
                    <p className="text-xs text-slate-500 mt-1">Booked jobs land here with the customer's details.</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {jobs.booked.map((b) => (
                      <div key={b.id} className="p-3.5 bg-blue-500/10 border border-blue-500/20 rounded-xl flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <div className="text-sm font-bold text-blue-300">
                            {format(new Date(b.date + 'T00:00:00'), 'EEE d MMM')} · {(b.durationDays ?? 1) > 1 ? `${b.durationDays} days` : b.slot === 'am' ? '9am–1pm' : b.slot === 'pm' ? '2pm–6pm' : '9am–6pm'}
                          </div>
                          <div className="text-xs text-slate-400 mt-0.5 truncate">
                            {b.customerName}{b.postcodeArea ? ` · ${b.postcodeArea}` : ''}{b.jobDescription ? ` — ${b.jobDescription}` : ''}
                          </div>
                        </div>
                        {b.valuePence != null && <div className="text-base font-bold text-blue-200 shrink-0">£{Math.round(b.valuePence / 100)}</div>}
                      </div>
                    ))}
                  </div>
                )}
              </div>
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

      {/* Bottom nav — the app frame. Week + Quotes live; Jobs + Profile land
        * in later phases (kept visible so the destination is legible). */}
      <nav className="fixed bottom-0 inset-x-0 z-40 bg-slate-950/90 backdrop-blur-md border-t border-slate-800/80 pb-[env(safe-area-inset-bottom)]">
        <div className="max-w-md mx-auto grid grid-cols-4">
          {([
            { key: 'week' as const, label: 'Week', icon: CalendarDays, live: true, badge: 0 },
            { key: 'quotes' as const, label: 'Quotes', icon: FileText, live: true, badge: pipeline?.liveCount ?? 0 },
            { key: 'jobs' as const, label: 'Jobs', icon: Briefcase, live: true, badge: jobs?.flex.length ?? 0 },
            { key: 'profile' as const, label: 'Profile', icon: UserRound, live: false, badge: 0 },
          ]).map((item) => {
            const active = item.live && tab === item.key;
            return (
              <button
                key={item.key}
                disabled={!item.live}
                aria-label={item.live ? item.label : `${item.label} — coming soon`}
                onClick={() => item.live && setTab(item.key as 'week' | 'quotes' | 'jobs')}
                className={`relative flex flex-col items-center gap-1 py-2.5 transition-colors ${
                  active ? 'text-white' : item.live ? 'text-slate-500 active:text-slate-300' : 'text-slate-700'
                }`}
              >
                <span className="relative">
                  <item.icon size={20} strokeWidth={active ? 2.4 : 1.8} />
                  {item.badge > 0 && (
                    <span className="absolute -top-1.5 -right-2 min-w-[15px] h-[15px] px-0.5 rounded-full bg-emerald-500 text-slate-950 text-[9px] font-bold flex items-center justify-center">
                      {item.badge}
                    </span>
                  )}
                </span>
                <span className={`text-[10px] leading-none ${active ? 'font-bold' : 'font-medium'}`}>
                  {item.live ? item.label : 'Soon'}
                </span>
                {active && <span className="absolute top-0 left-1/2 -translate-x-1/2 w-8 h-0.5 rounded-full bg-white" />}
              </button>
            );
          })}
        </div>
      </nav>

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
