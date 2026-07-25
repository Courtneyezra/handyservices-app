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
import { Fragment, useMemo, useState } from 'react';
import { useRoute } from 'wouter';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { format, formatDistanceToNow } from 'date-fns';
import { motion, AnimatePresence } from 'framer-motion';
import { Sun, Sunset, Clock, X, Lock, CalendarCheck2, Eye, FileText, CalendarDays, Briefcase, UserRound, CalendarPlus, Sparkles, Home, ChevronRight, Flame, Star, MapPin } from 'lucide-react';
import { addDays as addDaysFn, startOfWeek } from 'date-fns';

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

interface PayLine {
  category: string;
  description: string | null;
  tier: string;
  labourPence: number;
  payPence: number;
  materialsPence: number;
  method: 'share' | 'floor';
}

interface BookedJob {
  id: string;
  date: string;
  slot: 'am' | 'pm' | 'full_day';
  durationDays?: number;
  customerName: string;
  postcodeArea: string | null;
  jobDescription: string | null;
  fullDescription: string | null;
  mapQuery: string | null;
  photoUrls: string[] | null;
  valuePence: number | null;
  payoutPence: number | null;
  materialsAllowancePence: number | null;
  payLines: PayLine[] | null;
}

interface FlexJob {
  quoteId: string;
  postcodeArea: string | null;
  jobDescription: string | null;
  fullDescription: string | null;
  mapQuery: string | null;
  photoUrls: string[] | null;
  valuePence: number | null;
  payoutPence: number | null;
  materialsAllowancePence: number | null;
  payLines: PayLine[] | null;
  deadline: string | null;
  multiDay: boolean;
  requiredDays: number;
  needsFullDay: boolean;
  suggestions: Array<{ date: string; slot: 'am' | 'pm' | 'full_day'; reasons: string[]; packed?: boolean }>;
  blockStarts: Array<{ startDate: string; endDate: string; reasons: string[] }>;
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
  jobs: Array<{ quoteId: string; fixed: boolean; slot: string; customerName: string; postcodeArea: string | null; jobDescription: string | null; valuePence: number; payoutPence: number | null }>;
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

// Normalised shape the job-detail modal renders (booked or flex).
interface JobDetail {
  title: string;
  area: string | null;
  whenLabel: string | null;
  status: 'booked' | 'flex';
  fullDescription: string | null;
  mapQuery: string | null;
  photoUrls: string[] | null;
  payoutPence: number | null;
  materialsAllowancePence: number | null;
  payLines: PayLine[] | null;
}
const bookedToDetail = (b: BookedJob): JobDetail => ({
  title: b.customerName.trim(),
  area: b.postcodeArea,
  whenLabel: `${format(new Date(b.date + 'T00:00:00'), 'EEE d MMM')}${(b.durationDays ?? 1) > 1 ? ` · ${b.durationDays} days` : b.slot === 'am' ? ' · 9am–1pm' : b.slot === 'pm' ? ' · 2pm–6pm' : ' · 9am–6pm'}`,
  status: 'booked',
  fullDescription: b.fullDescription,
  mapQuery: b.mapQuery,
  photoUrls: b.photoUrls,
  payoutPence: b.payoutPence,
  materialsAllowancePence: b.materialsAllowancePence,
  payLines: b.payLines,
});
const flexToDetail = (f: FlexJob): JobDetail => ({
  title: f.jobDescription?.split(/[—,.]/)[0]?.trim() || 'Job',
  area: f.postcodeArea,
  whenLabel: f.deadline ? `needs a day by ${format(new Date(f.deadline + 'T00:00:00'), 'EEE d MMM')}` : null,
  status: 'flex',
  fullDescription: f.fullDescription,
  mapQuery: f.mapQuery,
  photoUrls: f.photoUrls,
  payoutPence: f.payoutPence,
  materialsAllowancePence: f.materialsAllowancePence,
  payLines: f.payLines,
});
const TIER_LABEL: Record<string, string> = { specialist: 'Specialist', skilled: 'Skilled', general: 'General', outdoor: 'Outdoor' };

// ── Component ─────────────────────────────────────────────────────────────────

export default function MyWeekPage() {
  const [, params] = useRoute('/my-week/:token');
  const token = params?.token ?? '';
  const queryClient = useQueryClient();
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [patternDraft, setPatternDraft] = useState<PatternDay[] | null>(null);
  const [savedFlash, setSavedFlash] = useState(false);
  const [tab, setTab] = useState<'home' | 'week' | 'quotes' | 'jobs' | 'profile'>('home');
  const [scoreRange, setScoreRange] = useState<'week' | 'month' | 'all'>('month');
  const [confirmPlace, setConfirmPlace] = useState<string | null>(null); // `${quoteId}|${date}|${slot}`
  const [placeError, setPlaceError] = useState<{ quoteId: string; message: string } | null>(null);
  const [planGoal, setPlanGoal] = useState<DayPlanGoal>('earnings');
  const [confirmLock, setConfirmLock] = useState<string | null>(null); // plan date
  const [lockError, setLockError] = useState<string | null>(null);
  const [jobDetail, setJobDetail] = useState<JobDetail | null>(null);

  const { data, isLoading, isError } = useQuery<AppPayload>({
    queryKey: ['contractor-app', token],
    queryFn: async () => {
      const res = await fetch(`/api/contractor-app/${token}`);
      if (!res.ok) throw new Error('load failed');
      return res.json();
    },
    enabled: !!token,
  });

  // Scorecard — his real career stats (pay booked/completed, jobs, tier).
  const { data: score } = useQuery<{
    tier: string; allTimePence: number; monthPence: number; weekPence: number;
    completedPence: number; bookedPence: number; jobsCompleted: number; jobsBooked: number;
    weekOpen: number; weekBooked: number; ratingTracked: boolean; onTimeTracked: boolean;
  }>({
    queryKey: ['contractor-app-scorecard', token],
    queryFn: async () => {
      const res = await fetch(`/api/contractor-app/${token}/scorecard`);
      if (!res.ok) throw new Error('load failed');
      return res.json();
    },
    enabled: !!token && tab === 'profile',
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
    enabled: !!token && tab === 'jobs' && flexCount >= 1,
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

  // Book a multi-day block starting on a chosen day.
  const blockMutation = useMutation({
    mutationFn: async ({ quoteId, startDate }: { quoteId: string; startDate: string }) => {
      const res = await fetch(`/api/contractor-app/${token}/flex/${quoteId}/place-block`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ startDate }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error || 'Could not book the block');
    },
    onSuccess: () => {
      setConfirmPlace(null);
      setPlaceError(null);
      queryClient.invalidateQueries({ queryKey: ['contractor-app-jobs', token] });
      queryClient.invalidateQueries({ queryKey: ['contractor-app', token] });
      queryClient.invalidateQueries({ queryKey: ['contractor-app-day-plans', token] });
    },
    onError: (e: any, vars) => {
      setConfirmPlace(null);
      setPlaceError({ quoteId: vars.quoteId, message: e?.message || 'Could not book the block' });
      queryClient.invalidateQueries({ queryKey: ['contractor-app-jobs', token] });
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
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['contractor-app', token] });
      // Opening/closing a day changes what fits — recompute the plan surfaces.
      queryClient.invalidateQueries({ queryKey: ['contractor-app-jobs', token] });
      queryClient.invalidateQueries({ queryKey: ['contractor-app-day-plans', token] });
    },
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

  // ── Week planner composition (client-side over existing queries) ──
  // All money shown is HIS pay (Model C + tier), not the customer price.
  const bookedPence = jobs?.booked.reduce((s, b) => s + (b.payoutPence ?? 0), 0) ?? 0;
  const hasOptions = (f: FlexJob) => (f.multiDay ? f.blockStarts.length : f.suggestions.length) > 0;
  const readyPence = jobs?.flex.reduce((s, f) => s + (hasOptions(f) ? (f.payoutPence ?? 0) : 0), 0) ?? 0;
  const stuck = jobs?.flex.filter((f) => !hasOptions(f)) ?? [];
  const stuckPence = stuck.reduce((s, f) => s + (f.payoutPence ?? 0), 0);

  const planRows = useMemo(() => {
    if (!data || !jobs) return [];
    const gridBy = new Map(data.days.map((d) => [d.date, d]));
    const bookedBy = new Map<string, Array<{ job: BookedJob; payoutPence: number; materialsPence: number; tag: string; firstDay: boolean }>>();
    for (const b of jobs.booked) {
      const dur = b.durationDays ?? 1;
      for (let i = 0; i < dur; i++) {
        const dt = format(addDaysFn(new Date(b.date + 'T00:00:00'), i), 'yyyy-MM-dd');
        const list = bookedBy.get(dt) ?? [];
        list.push({
          job: b,
          // His pay shown once (on day 1) so a multi-day span doesn't visually
          // multiply the figure; later span days show the tag only.
          payoutPence: i === 0 ? (b.payoutPence ?? 0) : 0,
          materialsPence: i === 0 ? (b.materialsAllowancePence ?? 0) : 0,
          tag: dur > 1 ? `Day ${i + 1} of ${dur}` : b.slot === 'am' ? '9am–1pm' : b.slot === 'pm' ? '2pm–6pm' : '9am–6pm',
          firstDay: i === 0,
        });
        bookedBy.set(dt, list);
      }
    }
    const packBy = new Map((dayPlans?.plans ?? []).filter((p) => p.placements.length > 0).map((p) => [p.date, p]));
    // Fallback ghosts: jobs the day-pack optimiser skipped (e.g. outside its
    // travel radius) but the per-job suggester can place — their TOP suggestion
    // renders on its day so "ready to add" money is always visible somewhere.
    const packedQuoteIds = new Set((dayPlans?.plans ?? []).flatMap((p) => p.placements.map((pl) => pl.quoteId)));
    const suggestedBy = new Map<string, Array<{ f: FlexJob; s: FlexJob['suggestions'][0] }>>();
    for (const f of jobs.flex) {
      if (f.multiDay || f.suggestions.length === 0 || packedQuoteIds.has(f.quoteId)) continue;
      const s = f.suggestions[0];
      const list = suggestedBy.get(s.date) ?? [];
      list.push({ f, s });
      suggestedBy.set(s.date, list);
    }
    const blockBy = new Map<string, { f: FlexJob; start: FlexJob['blockStarts'][0] }>();
    const blockSpanBy = new Map<string, { f: FlexJob; idx: number }>();
    for (const f of jobs.flex) {
      if (f.multiDay && f.blockStarts.length > 0) {
        const s = f.blockStarts[0];
        blockBy.set(s.startDate, { f, start: s });
        for (let i = 1; i < f.requiredDays; i++) {
          blockSpanBy.set(format(addDaysFn(new Date(s.startDate + 'T00:00:00'), i), 'yyyy-MM-dd'), { f, idx: i });
        }
      }
    }
    return Array.from({ length: 28 }, (_, i) => {
      const date = format(addDaysFn(new Date(data.today + 'T00:00:00'), i), 'yyyy-MM-dd');
      // Suggested ghosts render even alongside a pack (packedQuoteIds already
      // prevents the same job appearing twice) — a dropped/skipped job must
      // always have a visible, lockable home.
      return { date, g: gridBy.get(date), booked: bookedBy.get(date) ?? [], pack: packBy.get(date), suggested: suggestedBy.get(date), block: blockBy.get(date), blockSpan: blockSpanBy.get(date) };
    });
  }, [data, jobs, dayPlans]);

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
              {isLoading ? 'Loading…' : tab === 'home' ? `Hi, ${data?.provider.firstName}` : tab === 'profile' ? `${data?.provider.firstName}'s stats` : `${data?.provider.firstName}'s week`}
            </h1>
            <div className="flex items-center gap-3 text-[11px]">
              {openCount > 0 && <span className="text-emerald-400 font-semibold">{openCount} days open</span>}
              {bookedCount > 0 && <span className="text-blue-400 font-semibold">{bookedCount} booked</span>}
            </div>
          </div>
        </div>
        <p className="text-xs text-slate-500 mb-4 mt-2">
          {tab === 'home'
            ? 'Your week at a glance — what you’ve earned and what needs a day.'
            : tab === 'profile'
            ? 'Your career with Handy — earnings, jobs and your tier.'
            : tab === 'quotes'
            ? 'Live quotes going out with your name and photo on them.'
            : tab === 'jobs'
              ? 'Your plan: booked days, jobs grouped onto days, and the money waiting.'
              : 'Tap a day to open or close it. Customers can only book days you open.'}
        </p>

        {/* ── HOME dashboard — the cockpit Craig opens to ── */}
        {tab === 'home' && jobs && data && (() => {
          const today = data.today;
          const overdue = jobs.flex.filter((f) => f.deadline && f.deadline < today);
          const nextBooked = jobs.booked.find((b) => b.date >= today);
          const doNow = overdue.length > 0
            ? { tone: 'red', title: `${overdue.length} job${overdue.length > 1 ? 's' : ''} past its promised date`, body: 'Call Handy to sort a new day with the customer.', cta: null }
            : stuck.length > 0
            ? { tone: 'amber', title: `£${Math.round(stuckPence / 100).toLocaleString()} waiting on an open day`, body: `${stuck[0].jobDescription?.slice(0, 40) ?? 'A job'}${stuck[0].deadline ? ` · by ${format(new Date(stuck[0].deadline + 'T00:00:00'), 'EEE d MMM')}` : ''}`, cta: { label: 'Open days →', to: 'week' as const } }
            : readyPence > 0
            ? { tone: 'emerald', title: `£${Math.round(readyPence / 100).toLocaleString()} ready to book`, body: 'Group your jobs into days and lock them in.', cta: { label: 'Plan my week →', to: 'jobs' as const } }
            : openCount === 0
            ? { tone: 'amber', title: 'No open days this week', body: 'Open days so customers can book you.', cta: { label: 'Open days →', to: 'week' as const } }
            : { tone: 'emerald', title: 'You’re all set', body: `${bookedCount} day${bookedCount === 1 ? '' : 's'} booked this week. Keep your calendar fresh.`, cta: { label: 'View week →', to: 'week' as const } };
          const toneCls = doNow.tone === 'red' ? 'bg-red-500/10 border-red-500/30' : doNow.tone === 'amber' ? 'bg-amber-500/10 border-amber-500/30' : 'bg-emerald-500/10 border-emerald-500/30';
          const toneText = doNow.tone === 'red' ? 'text-red-300' : doNow.tone === 'amber' ? 'text-amber-300' : 'text-emerald-300';
          return (
            <div className="space-y-3">
              {/* Pay hero */}
              <div className="p-5 rounded-2xl bg-gradient-to-br from-emerald-500/15 to-slate-900/40 border border-emerald-500/25">
                <div className="text-[10px] font-bold uppercase tracking-wider text-emerald-300/70 mb-1">Your pay · this week</div>
                <div className="flex items-baseline gap-2 flex-wrap">
                  <span className="text-3xl font-black">£{Math.round(bookedPence / 100).toLocaleString()}</span>
                  <span className="text-xs text-slate-400 font-semibold">booked</span>
                  {readyPence > 0 && <span className="text-lg font-bold text-emerald-400">+£{Math.round(readyPence / 100).toLocaleString()} ready</span>}
                </div>
              </div>

              {/* Do this now */}
              <div className={`p-4 rounded-2xl border ${toneCls}`}>
                <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">Do this now</div>
                <div className={`text-sm font-bold ${toneText}`}>{doNow.title}</div>
                <div className="text-xs text-slate-400 mt-0.5 leading-snug">{doNow.body}</div>
                {doNow.cta && (
                  <button onClick={() => setTab(doNow.cta!.to)} className="mt-3 w-full py-2.5 rounded-xl bg-white text-slate-950 text-sm font-bold active:scale-[0.99] transition-transform">
                    {doNow.cta.label}
                  </button>
                )}
              </div>

              {/* Next job */}
              {nextBooked && (
                <button onClick={() => setJobDetail(bookedToDetail(nextBooked))} className="w-full text-left p-4 rounded-2xl bg-blue-500/10 border border-blue-500/25 flex items-center gap-3 active:scale-[0.99] transition-transform">
                  <div className="w-11 h-11 rounded-xl bg-blue-500/20 flex flex-col items-center justify-center shrink-0">
                    <span className="text-[9px] font-bold uppercase text-blue-300">{format(new Date(nextBooked.date + 'T00:00:00'), 'EEE')}</span>
                    <span className="text-base font-black text-blue-200 leading-none">{format(new Date(nextBooked.date + 'T00:00:00'), 'd')}</span>
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-[10px] font-bold uppercase tracking-wider text-blue-400/70">Next job</div>
                    <div className="text-sm font-bold text-blue-200 truncate">{nextBooked.customerName}{nextBooked.postcodeArea ? ` · ${nextBooked.postcodeArea}` : ''}</div>
                    <div className="text-xs text-slate-400">£{Math.round((nextBooked.payoutPence ?? 0) / 100)} you earn</div>
                  </div>
                  <ChevronRight size={18} className="text-blue-400/60 shrink-0" />
                </button>
              )}

              {/* Week strip */}
              <button onClick={() => setTab('week')} className="w-full p-4 rounded-2xl bg-slate-900/60 border border-slate-800 active:scale-[0.99] transition-transform">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">This week</span>
                  <span className="text-[11px] font-bold text-slate-400 flex items-center gap-0.5">Open & plan <ChevronRight size={13} /></span>
                </div>
                <div className="grid grid-cols-7 gap-1">
                  {data.days.slice(0, 7).map((d) => {
                    const booked = d.am === 'booked' || d.pm === 'booked';
                    const open = d.am === 'open' || d.pm === 'open';
                    return (
                      <div key={d.date} className="text-center">
                        <div className="text-[9px] font-bold uppercase text-slate-500">{format(new Date(d.date + 'T00:00:00'), 'EEEEE')}</div>
                        <div className={`mt-0.5 h-8 rounded-lg flex items-center justify-center text-[11px] font-bold ${booked ? 'bg-blue-500/25 text-blue-200' : open ? 'bg-emerald-500/20 text-emerald-300' : 'bg-slate-800/60 text-slate-600'}`}>
                          {format(new Date(d.date + 'T00:00:00'), 'd')}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </button>

              {/* Live-quotes pulse */}
              {(pipeline?.liveCount ?? 0) > 0 && (
                <button onClick={() => setTab('quotes')} className="w-full p-3.5 rounded-2xl bg-slate-900/60 border border-emerald-500/25 flex items-center gap-2.5 text-left active:scale-[0.99] transition-transform">
                  <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse shrink-0" />
                  <span className="flex-1 text-xs font-semibold text-emerald-300">{pipeline!.liveCount} live quote{pipeline!.liveCount === 1 ? '' : 's'} showing your days to customers</span>
                  <ChevronRight size={16} className="text-emerald-400/60" />
                </button>
              )}
            </div>
          );
        })()}

        {/* Payslip — the week as HIS money (spec: 05-week-planner-ui.md) */}
        {tab === 'week' && jobs && (bookedPence > 0 || (jobs.flex.length ?? 0) > 0) && (
          <div className="mb-4 p-4 rounded-2xl bg-slate-900/70 border border-slate-800">
            <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">Your pay</div>
            <div className="flex items-baseline gap-2 flex-wrap">
              <span className="text-2xl font-bold">£{Math.round(bookedPence / 100).toLocaleString()}</span>
              <span className="text-xs text-slate-400 font-semibold">booked</span>
              {readyPence > 0 && (
                <>
                  <span className="text-2xl font-bold text-emerald-400">+£{Math.round(readyPence / 100).toLocaleString()}</span>
                  <span className="text-xs text-emerald-400/80 font-semibold">ready to add</span>
                </>
              )}
            </div>
            {stuckPence > 0 && (
              <div className="mt-1 text-[11px] font-semibold text-amber-400">
                £{Math.round(stuckPence / 100).toLocaleString()} waiting — open days to take it
              </div>
            )}
            {jobs.flex.length > 0 && (
              <button
                onClick={() => setTab('jobs')}
                className="mt-3 w-full py-2.5 rounded-xl bg-emerald-500 text-slate-950 text-sm font-bold active:scale-[0.99] transition-all"
              >
                Plan my week →
              </button>
            )}
          </div>
        )}

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

            {/* THE PLANNER IS THE PAGE (spec: 05-week-planner-ui.md).
              * Payslip → goals → coaching → week-broken day-rows with
              * per-day/per-block optimization inline. Unscheduled jobs
              * (zero options) surface in their own section below. */}
            {jobs && (
              <>
                <div className="mb-3 p-4 rounded-2xl bg-slate-900/70 border border-slate-800">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">Your pay</div>
                  <div className="flex items-baseline gap-2 flex-wrap">
                    <span className="text-2xl font-bold">£{Math.round(bookedPence / 100).toLocaleString()}</span>
                    <span className="text-xs text-slate-400 font-semibold">booked</span>
                    {readyPence > 0 && (
                      <>
                        <span className="text-2xl font-bold text-emerald-400">+£{Math.round(readyPence / 100).toLocaleString()}</span>
                        <span className="text-xs text-emerald-400/80 font-semibold">ready to add</span>
                      </>
                    )}
                  </div>
                  {stuckPence > 0 && (
                    <div className="mt-1 text-[11px] font-semibold text-amber-400">
                      £{Math.round(stuckPence / 100).toLocaleString()} waiting — open days to take it
                    </div>
                  )}
                </div>

                {flexCount >= 1 && (
                  <div className="flex gap-1.5 mb-3">
                    {([
                      { key: 'earnings' as const, label: 'Best week £' },
                      { key: 'fewest_days' as const, label: 'Fewest days' },
                      { key: 'soonest' as const, label: 'Done soonest' },
                    ]).map((g) => (
                      <button key={g.key} onClick={() => { setPlanGoal(g.key); setConfirmLock(null); }}
                        className={`flex-1 py-2 rounded-xl text-[11px] font-bold border transition-all ${planGoal === g.key ? 'bg-emerald-500 text-slate-950 border-emerald-500' : 'bg-slate-900/60 text-slate-400 border-slate-800'}`}>
                        {g.label}
                      </button>
                    ))}
                  </div>
                )}

                {plansLoading && <div className="mb-3 h-10 bg-slate-900 rounded-xl animate-pulse" />}

                {stuck.length > 0 && (
                  <div className="mb-3">
                    <div className="flex items-center gap-1.5 mb-2">
                      <Sparkles size={13} className="text-amber-400" />
                      <span className="text-[11px] font-bold uppercase tracking-wider text-amber-400">Open a day to fit these</span>
                    </div>
                    <div className="space-y-1.5">
                      {stuck.map((f) => {
                        const overdue = f.deadline ? f.deadline < (data?.today ?? '') : false;
                        return (
                          <div key={f.quoteId} className="flex items-center gap-3 p-2.5 rounded-xl bg-slate-900/50 border border-amber-500/25">
                            <div className="shrink-0 text-center w-12">
                              <div className="text-base font-black text-white leading-none">£{Math.round((f.payoutPence ?? 0) / 100)}</div>
                              <div className="text-[8px] text-slate-500 font-semibold mt-0.5">you earn</div>
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="text-xs font-semibold text-slate-200 truncate">{f.jobDescription?.split(/[—,.]/)[0]?.trim() || 'Job'}</div>
                              <div className="flex items-center gap-1.5 mt-0.5">
                                {f.postcodeArea && <span className="text-[9px] font-bold tracking-wider text-slate-400 bg-slate-800 rounded px-1 py-px">{f.postcodeArea}</span>}
                                <span className="text-[10px] text-slate-500">{f.multiDay ? `${f.requiredDays} days in a row` : 'needs a day'}</span>
                              </div>
                            </div>
                            {f.deadline && (
                              <span className={`shrink-0 text-[9px] font-bold px-2 py-1 rounded-full ${overdue ? 'bg-red-500/15 text-red-400 border border-red-500/30' : 'bg-amber-500/15 text-amber-400 border border-amber-500/30'}`}>
                                {overdue ? 'Overdue' : `by ${format(new Date(f.deadline + 'T00:00:00'), 'EEE d')}`}
                              </span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
                {lockError && <p className="mb-2 text-[11px] font-semibold text-red-400">{lockError}</p>}
                {placeError && <p className="mb-2 text-[11px] font-semibold text-red-400">{placeError.message}</p>}

                <div className="space-y-2 mb-7">
                  {planRows.map((row, rowIdx) => {
                    // Proposed block span-days are ghosts (not yet booked) — only real bookings are 'busy'.
                    const state = row.booked.length > 0 ? 'busy' : row.block || row.blockSpan || row.pack || row.suggested ? 'ghost' : row.g && (row.g.am === 'open' || row.g.pm === 'open') ? 'open' : 'off';
                    const dateObj = new Date(row.date + 'T00:00:00');
                    const showWeekBreak = rowIdx === 0 || dateObj.getDay() === 1;
                    let weekLabel = '';
                    if (showWeekBreak && data) {
                      const thisMonday = startOfWeek(new Date(data.today + 'T00:00:00'), { weekStartsOn: 1 }).getTime();
                      const rowMonday = startOfWeek(dateObj, { weekStartsOn: 1 });
                      const weeksAhead = Math.round((rowMonday.getTime() - thisMonday) / (7 * 86400000));
                      weekLabel = weeksAhead === 0 ? 'This week' : weeksAhead === 1 ? 'Next week' : `Week of ${format(rowMonday, 'd MMM')}`;
                    }
                    return (
                      <Fragment key={row.date}>
                      {showWeekBreak && (
                        <div className={`flex items-center gap-2 ${rowIdx === 0 ? '' : 'pt-3'}`}>
                          <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 shrink-0">{weekLabel}</span>
                          <span className="flex-1 h-px bg-slate-800" />
                        </div>
                      )}
                      <div className="flex gap-2.5">
                        <div className={`w-14 shrink-0 rounded-xl border flex flex-col items-center justify-center py-2 ${
                          state === 'busy' ? 'bg-blue-500/15 border-blue-500/30'
                          : state === 'ghost' ? 'border-emerald-500/50 border-dashed bg-emerald-500/5'
                          : state === 'open' ? 'bg-slate-900/60 border-emerald-500/30'
                          : 'bg-slate-900/40 border-slate-800/50'
                        }`}>
                          <span className="text-[10px] font-bold uppercase text-slate-400">{format(new Date(row.date + 'T00:00:00'), 'EEE')}</span>
                          <span className="text-base font-bold">{format(new Date(row.date + 'T00:00:00'), 'd')}</span>
                        </div>

                        <div className="flex-1 min-w-0 space-y-1.5">
                          {row.booked.map((b, i) => (
                            <button key={i} onClick={() => setJobDetail(bookedToDetail(b.job))}
                              className="w-full text-left p-3 rounded-xl bg-blue-500/15 border border-blue-500/30 active:scale-[0.99] transition-transform">
                              <div className="flex items-center justify-between gap-2">
                                <span className="text-xs font-bold text-blue-300 truncate">
                                  {b.job.customerName.trim()}{b.job.postcodeArea ? ` · ${b.job.postcodeArea}` : ''}
                                </span>
                                <Lock size={11} className="text-blue-400 shrink-0" />
                              </div>
                              {b.firstDay ? (
                                <div className="flex items-baseline gap-1.5 mt-1">
                                  <span className="text-base font-bold text-blue-100">£{Math.round(b.payoutPence / 100)}</span>
                                  <span className="text-[10px] text-blue-400/70 font-semibold">you earn</span>
                                  {b.materialsPence > 0 && <span className="text-[10px] text-slate-400 font-semibold">· £{Math.round(b.materialsPence / 100)} materials</span>}
                                </div>
                              ) : null}
                              <div className="text-[10px] text-blue-400/60 font-semibold mt-0.5">{b.tag} · tap for details ›</div>
                            </button>
                          ))}

                          {row.blockSpan && (
                            <div className="min-h-[34px] rounded-xl border border-dashed bg-emerald-500/5 border-emerald-500/25 flex items-center px-3">
                              <span className="text-[10px] text-slate-500 font-semibold">↑ day {row.blockSpan.idx + 1} of {row.blockSpan.f.requiredDays}</span>
                            </div>
                          )}

                          {row.block && (() => {
                            const key = `${row.block.f.quoteId}|block|${row.block.start.startDate}`;
                            const confirming = confirmPlace === key;
                            return (
                              <div className="p-3 rounded-xl border border-dashed bg-emerald-500/8 border-emerald-500/40">
                                <div className="flex items-center justify-between gap-2">
                                  <span className="text-xs font-bold text-emerald-300 truncate">{row.block.f.jobDescription || 'Multi-day job'}</span>
                                  <span className="text-sm font-bold text-emerald-300 shrink-0">£{Math.round((row.block.f.payoutPence ?? 0) / 100)}</span>
                                </div>
                                <div className="text-[10px] text-slate-400 mt-0.5">
                                  runs {format(new Date(row.block.start.startDate + 'T00:00:00'), 'EEE d')} → {format(new Date(row.block.start.endDate + 'T00:00:00'), 'EEE d')}
                                  {row.block.f.deadline ? ` · start by ${format(new Date(row.block.f.deadline + 'T00:00:00'), 'EEE d MMM')}` : ''}
                                </div>
                                <button
                                  disabled={blockMutation.isPending}
                                  onClick={() => (confirming ? blockMutation.mutate({ quoteId: row.block!.f.quoteId, startDate: row.block!.start.startDate }) : setConfirmPlace(key))}
                                  className={`mt-2 w-full py-2 rounded-lg text-xs font-bold transition-all ${confirming ? 'bg-emerald-500 text-slate-950' : 'bg-slate-800 text-slate-200'}`}>
                                  {confirming ? (blockMutation.isPending ? 'Booking…' : `Confirm — book ${format(new Date(row.block.start.startDate + 'T00:00:00'), 'EEE d')} → ${format(new Date(row.block.start.endDate + 'T00:00:00'), 'EEE d')}?`) : `Lock this block · ${row.block.f.requiredDays} days`}
                                </button>
                              </div>
                            );
                          })()}

                          {row.pack && (() => {
                            const confirming = confirmLock === row.pack.date;
                            return (
                              <div className="p-3 rounded-xl border border-dashed bg-emerald-500/8 border-emerald-500/40">
                                {row.pack.jobs.filter((j) => !j.fixed).map((j) => (
                                  <div key={j.quoteId} className="flex items-center justify-between gap-2 py-0.5">
                                    <span className="text-xs font-bold text-emerald-300 truncate">{(j.slot === 'am' ? 'AM' : j.slot === 'pm' ? 'PM' : 'DAY')} · {j.jobDescription || j.customerName}</span>
                                    <span className="text-sm font-bold text-emerald-300 shrink-0">£{Math.round((j.payoutPence ?? 0) / 100)}</span>
                                  </div>
                                ))}
                                <div className="text-[10px] text-slate-500 mt-0.5">{row.pack.rationale}</div>
                                <button
                                  disabled={lockMutation.isPending}
                                  onClick={() => (confirming ? lockMutation.mutate(row.pack!.placements) : setConfirmLock(row.pack!.date))}
                                  className={`mt-2 w-full py-2 rounded-lg text-xs font-bold transition-all ${confirming ? 'bg-emerald-500 text-slate-950' : 'bg-slate-800 text-slate-200'}`}>
                                  {confirming ? (lockMutation.isPending ? 'Booking…' : `Confirm — book ${format(new Date(row.pack.date + 'T00:00:00'), 'EEE d')}?`) : `Lock this day · £${Math.round(row.pack.totalPence / 100)}`}
                                </button>
                              </div>
                            );
                          })()}

                          {/* Suggested ghosts — placeable jobs the pack optimiser skipped */}
                          {row.suggested && row.suggested.map(({ f, s }) => {
                            const key = `${f.quoteId}|${s.date}|${s.slot}`;
                            const confirming = confirmPlace === key;
                            const slotLabel = s.slot === 'am' ? 'AM' : s.slot === 'pm' ? 'PM' : 'DAY';
                            return (
                              <div key={key} className="p-3 rounded-xl border border-dashed bg-emerald-500/8 border-emerald-500/40">
                                <div className="flex items-center justify-between gap-2">
                                  <span className="text-xs font-bold text-emerald-300 truncate">{slotLabel} · {f.jobDescription || 'Job'}</span>
                                  <span className="text-sm font-bold text-emerald-300 shrink-0">£{Math.round((f.payoutPence ?? 0) / 100)}</span>
                                </div>
                                {s.reasons.length > 0 && <div className="text-[10px] text-slate-500 mt-0.5">{s.reasons[0]}{f.deadline ? ` · needs a day by ${format(new Date(f.deadline + 'T00:00:00'), 'EEE d MMM')}` : ''}</div>}
                                <button
                                  disabled={placeMutation.isPending}
                                  onClick={() => (confirming ? placeMutation.mutate({ quoteId: f.quoteId, date: s.date, slot: s.slot }) : setConfirmPlace(key))}
                                  className={`mt-2 w-full py-2 rounded-lg text-xs font-bold transition-all ${confirming ? 'bg-emerald-500 text-slate-950' : 'bg-slate-800 text-slate-200'}`}>
                                  {confirming ? (placeMutation.isPending ? 'Booking…' : `Confirm — book ${format(new Date(s.date + 'T00:00:00'), 'EEE d')}?`) : `Lock this day · £${Math.round((f.payoutPence ?? 0) / 100)}`}
                                </button>
                              </div>
                            );
                          })}

                          {row.booked.length === 0 && !row.block && !row.blockSpan && !row.pack && !row.suggested && (
                            state === 'open' ? (
                              <div className="min-h-[34px] h-full rounded-xl bg-slate-900/40 border border-emerald-500/20 flex items-center px-3">
                                <span className="text-[10px] text-emerald-400/60 font-semibold">open · nothing fits yet</span>
                              </div>
                            ) : (
                              <div className="min-h-[34px] h-full rounded-xl bg-slate-900/30 border border-slate-800/40 flex items-center justify-between px-3">
                                <span className="text-[10px] text-slate-600 font-semibold">off</span>
                                {stuck.length > 0 && (
                                  <button
                                    disabled={dayMutation.isPending}
                                    onClick={() => dayMutation.mutate({ date: row.date, mode: 'full' })}
                                    className="text-[10px] font-bold text-slate-300 bg-slate-800 rounded-md px-2 py-1 flex items-center gap-1 active:scale-95 transition-all">
                                    <CalendarPlus size={11} /> Open this day
                                  </button>
                                )}
                              </div>
                            )
                          )}
                        </div>
                      </div>
                      </Fragment>
                    );
                  })}
                </div>
              </>
            )}

            {/* Unscheduled — jobs with ZERO current options (placeable jobs
              * live in their day-rows above). The per-job card keeps the
              * manual chips path in case options appear between renders. */}
            {jobs && stuck.length > 0 && (
              <div className="mb-6">
                <div className="text-[11px] font-semibold uppercase tracking-wider text-amber-400 mb-2">Unscheduled — open days to fit these</div>
                <div className="space-y-3">
                  {stuck.map((f) => {
                    const overdue = f.deadline ? f.deadline < (data?.today ?? '') : false;
                    return (
                      <div key={f.quoteId} className="p-4 bg-slate-900/60 border border-amber-500/25 rounded-xl">
                        <button onClick={() => setJobDetail(flexToDetail(f))} className="w-full text-left flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              {f.postcodeArea && <span className="text-[10px] font-bold tracking-wider text-slate-400 bg-slate-800 rounded px-1.5 py-0.5">{f.postcodeArea}</span>}
                              {f.deadline && (
                                <span className={`text-[10px] font-semibold ${overdue ? 'text-red-400' : 'text-amber-400'}`}>
                                  {overdue ? 'Overdue — call us' : `needs a day by ${format(new Date(f.deadline + 'T00:00:00'), 'EEE d MMM')}`}
                                </span>
                              )}
                            </div>
                            {f.jobDescription && <p className="text-xs text-slate-300 mt-1.5 leading-snug line-clamp-2">{f.jobDescription}</p>}
                            <div className="text-[10px] text-slate-500 font-semibold mt-1">tap for details ›</div>
                          </div>
                          <div className="shrink-0 text-right">
                            {f.payoutPence != null && <div className="text-lg font-bold text-white">£{Math.round(f.payoutPence / 100)}</div>}
                            <div className="text-[9px] text-slate-500 font-semibold">you earn</div>
                            {(f.materialsAllowancePence ?? 0) > 0 && <div className="text-[10px] text-slate-400 font-semibold mt-0.5">£{Math.round((f.materialsAllowancePence ?? 0) / 100)} mat.</div>}
                          </div>
                        </button>

                        {placeError?.quoteId === f.quoteId && (
                          <p className="mt-2 text-[11px] font-semibold text-red-400">{placeError.message}</p>
                        )}
                        {f.multiDay ? (
                          f.blockStarts.length > 0 ? (
                            <div className="mt-3 space-y-1.5">
                              <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">{f.requiredDays}-day job — pick a start</div>
                              {f.blockStarts.map((b) => {
                                const key = `${f.quoteId}|block|${b.startDate}`;
                                const confirming = confirmPlace === key;
                                return (
                                  <button
                                    key={key}
                                    disabled={blockMutation.isPending}
                                    onClick={() => (confirming
                                      ? blockMutation.mutate({ quoteId: f.quoteId, startDate: b.startDate })
                                      : setConfirmPlace(key))}
                                    className={`w-full flex items-center gap-2 p-2.5 rounded-lg border text-left transition-all active:scale-[0.99] ${
                                      confirming ? 'bg-emerald-500 border-emerald-500 text-slate-950' : 'bg-slate-800/70 border-slate-700 text-slate-200'
                                    }`}
                                  >
                                    <span className="text-xs font-bold shrink-0">
                                      {confirming
                                        ? (blockMutation.isPending ? 'Booking…' : `Confirm ${format(new Date(b.startDate + 'T00:00:00'), 'EEE d')}–${format(new Date(b.endDate + 'T00:00:00'), 'EEE d')}?`)
                                        : `Start ${format(new Date(b.startDate + 'T00:00:00'), 'EEE d MMM')} · runs to ${format(new Date(b.endDate + 'T00:00:00'), 'EEE d')}`}
                                    </span>
                                    {!confirming && b.reasons.length > 0 && (
                                      <span className="text-[10px] text-emerald-400/90 truncate">{b.reasons[0]}</span>
                                    )}
                                  </button>
                                );
                              })}
                            </div>
                          ) : (
                            <p className="mt-3 text-[11px] text-slate-500">
                              {f.requiredDays}-day job — needs {f.requiredDays} open days in a row before the deadline. Open more days on "Week" or call us.
                            </p>
                          )
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

          </div>
        )}

        {/* ── PROFILE / scorecard — his real career, quality beside money ── */}
        {tab === 'profile' && score && (() => {
          const rangePence = scoreRange === 'week' ? score.weekPence : scoreRange === 'month' ? score.monthPence : score.allTimePence;
          const rangeLabel = scoreRange === 'week' ? 'this week' : scoreRange === 'month' ? 'this month' : 'all-time';
          const isCore = score.tier === 'core';
          return (
            <div className="space-y-3">
              {/* Tier badge */}
              <div className="flex items-center gap-2">
                <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full border text-[10px] font-black uppercase tracking-wider ${isCore ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-300' : 'bg-slate-800 border-slate-700 text-slate-300'}`}>
                  {score.tier} contractor
                </span>
              </div>

              {/* Earnings hero */}
              <div className="p-5 rounded-2xl bg-gradient-to-br from-emerald-500/15 to-slate-900/40 border border-emerald-500/25">
                <div className="text-[10px] font-bold uppercase tracking-wider text-emerald-300/70 mb-1">Earned with Handy · {rangeLabel}</div>
                <div className="text-4xl font-black">£{Math.round(rangePence / 100).toLocaleString()}</div>
                <div className="flex gap-1.5 mt-3">
                  {(['week', 'month', 'all'] as const).map((r) => (
                    <button key={r} onClick={() => setScoreRange(r)} className={`px-3 py-1 rounded-lg text-[11px] font-bold ${scoreRange === r ? 'bg-emerald-400 text-emerald-950' : 'bg-slate-800 text-slate-400'}`}>
                      {r === 'all' ? 'All-time' : r === 'week' ? 'This week' : 'This month'}
                    </button>
                  ))}
                </div>
              </div>

              {/* Completed vs booked split */}
              <div className="grid grid-cols-2 gap-2">
                <div className="p-3 rounded-xl bg-slate-900/60 border border-slate-800">
                  <div className="text-lg font-black text-white">£{Math.round(score.completedPence / 100).toLocaleString()}</div>
                  <div className="text-[10px] text-slate-500 font-semibold">completed · {score.jobsCompleted} job{score.jobsCompleted === 1 ? '' : 's'}</div>
                </div>
                <div className="p-3 rounded-xl bg-blue-500/10 border border-blue-500/25">
                  <div className="text-lg font-black text-blue-300">£{Math.round(score.bookedPence / 100).toLocaleString()}</div>
                  <div className="text-[10px] text-blue-400/70 font-semibold">booked · {score.jobsBooked} job{score.jobsBooked === 1 ? '' : 's'}</div>
                </div>
              </div>

              {/* Quality — honest about what isn't tracked yet */}
              <div className="grid grid-cols-3 gap-2">
                <div className="p-3 rounded-xl bg-slate-900/60 border border-slate-800 text-center">
                  <div className="text-2xl font-black text-white">{score.jobsCompleted + score.jobsBooked}</div>
                  <div className="text-[10px] text-slate-500 font-semibold mt-0.5">total jobs</div>
                </div>
                <div className="p-3 rounded-xl bg-slate-900/40 border border-slate-800/60 text-center">
                  <div className="text-lg font-black text-slate-600 flex items-center justify-center h-7"><Star size={16} /></div>
                  <div className="text-[9px] text-slate-600 font-semibold mt-0.5">rating soon</div>
                </div>
                <div className="p-3 rounded-xl bg-slate-900/40 border border-slate-800/60 text-center">
                  <div className="text-lg font-black text-slate-600 flex items-center justify-center h-7"><Flame size={16} /></div>
                  <div className="text-[9px] text-slate-600 font-semibold mt-0.5">streak soon</div>
                </div>
              </div>

              {/* Week fill */}
              {score.weekOpen > 0 && (
                <div className="p-4 rounded-2xl bg-slate-900/60 border border-slate-800">
                  <div className="text-xs font-bold mb-2">This week</div>
                  <div className="flex gap-1">
                    {Array.from({ length: score.weekOpen }, (_, i) => (
                      <div key={i} className={`flex-1 h-2.5 rounded-full ${i < score.weekBooked ? 'bg-emerald-400' : 'bg-slate-700'}`} />
                    ))}
                  </div>
                  <div className="text-[11px] text-slate-400 font-semibold mt-2">{score.weekBooked} of {score.weekOpen} open days booked</div>
                </div>
              )}

              {/* Tier ladder */}
              <div className="p-4 rounded-2xl bg-slate-900/60 border border-slate-800">
                <div className="text-xs font-bold mb-3">Your tier</div>
                <div className="flex items-center gap-1 mb-3">
                  {[{ k: 'adhoc', l: 'Ad-hoc', s: '45–55%' }, { k: 'core', l: 'Core', s: '+5%' }, { k: 'partner', l: 'Partner', s: 'equity' }].map((t, i) => {
                    const idx = ['adhoc', 'core', 'partner'].indexOf(score.tier);
                    const passed = i <= idx;
                    return (
                      <div key={t.k} className="flex-1">
                        <div className={`h-1.5 rounded-full ${passed ? 'bg-emerald-400' : 'bg-slate-700'}`} />
                        <div className={`text-[10px] font-bold mt-1 ${t.k === score.tier ? 'text-emerald-300' : passed ? 'text-slate-300' : 'text-slate-600'}`}>{t.l}</div>
                        <div className="text-[9px] text-slate-600">{t.s}</div>
                      </div>
                    );
                  })}
                </div>
                <div className="text-[11px] text-slate-400 leading-snug">
                  {isCore
                    ? <>You're <span className="text-emerald-300 font-bold">Core</span> — +5% on every job and first pick of the week.</>
                    : <>Complete clean jobs to reach <span className="text-emerald-300 font-bold">Core</span> — +5% pay and first pick.</>}
                </div>
              </div>
            </div>
          );
        })()}
        {tab === 'profile' && !score && <div className="h-40 bg-slate-900 rounded-2xl animate-pulse" />}

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
        <div className="max-w-md mx-auto grid grid-cols-5">
          {([
            { key: 'home' as const, label: 'Home', icon: Home, live: true, badge: 0 },
            { key: 'week' as const, label: 'Week', icon: CalendarDays, live: true, badge: 0 },
            { key: 'jobs' as const, label: 'Jobs', icon: Briefcase, live: true, badge: jobs?.flex.length ?? 0 },
            { key: 'quotes' as const, label: 'Quotes', icon: FileText, live: true, badge: pipeline?.liveCount ?? 0 },
            { key: 'profile' as const, label: 'Stats', icon: UserRound, live: true, badge: 0 },
          ]).map((item) => {
            const active = item.live && tab === item.key;
            return (
              <button
                key={item.key}
                disabled={!item.live}
                aria-label={item.live ? item.label : `${item.label} — coming soon`}
                onClick={() => item.live && setTab(item.key as 'home' | 'week' | 'quotes' | 'jobs' | 'profile')}
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

      {/* Job-detail modal — the card summary opens the full job here. */}
      <AnimatePresence>
        {jobDetail && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-sm"
            onClick={() => setJobDetail(null)}
          >
            <motion.div
              initial={{ y: 100, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 100, opacity: 0 }}
              transition={{ type: 'spring', damping: 26, stiffness: 280 }}
              className="w-full max-w-md mx-2 mb-4 bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl max-h-[88vh] flex flex-col"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Fixed header — same frame for every job, big or small. */}
              <div className="p-5 pb-3 border-b border-slate-800">
                <div className="flex items-start justify-between gap-3 mb-3">
                  <div className="min-w-0">
                    <div className="text-lg font-bold leading-tight truncate">{jobDetail.title}</div>
                    <div className="text-xs text-slate-400 mt-0.5">
                      {jobDetail.area ? jobDetail.area : ''}{jobDetail.area && jobDetail.whenLabel ? ' · ' : ''}{jobDetail.whenLabel}
                    </div>
                  </div>
                  <button onClick={() => setJobDetail(null)} className="w-8 h-8 rounded-full bg-slate-800 flex items-center justify-center text-slate-400 shrink-0" aria-label="Close"><X size={16} /></button>
                </div>

                {/* Directions */}
                {jobDetail.mapQuery && (
                  <a href={`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(jobDetail.mapQuery)}`} target="_blank" rel="noreferrer"
                    className="flex items-center gap-2.5 p-2.5 rounded-xl bg-blue-500/10 border border-blue-500/25 active:scale-[0.99] transition-transform">
                    <div className="w-9 h-9 rounded-lg bg-blue-500/20 flex items-center justify-center shrink-0"><MapPin size={16} className="text-blue-300" /></div>
                    <div className="min-w-0 flex-1">
                      <div className="text-xs font-bold text-blue-200">Get directions</div>
                      <div className="text-[10px] text-slate-400 truncate">{jobDetail.mapQuery}</div>
                    </div>
                    <ChevronRight size={16} className="text-blue-400/60" />
                  </a>
                )}

                {/* Money summary — one compact row */}
                <div className="flex items-center gap-2 mt-3">
                  <div className="flex-1 p-2.5 rounded-xl bg-emerald-500/10 border border-emerald-500/25">
                    <div className="text-[9px] font-bold uppercase tracking-wider text-emerald-400/80">You earn</div>
                    <div className="text-lg font-black text-emerald-300 leading-none mt-0.5">£{Math.round((jobDetail.payoutPence ?? 0) / 100)}</div>
                  </div>
                  <div className="flex-1 p-2.5 rounded-xl bg-slate-800/60 border border-slate-700">
                    <div className="text-[9px] font-bold uppercase tracking-wider text-slate-400">Materials · your card</div>
                    <div className="text-lg font-black text-slate-200 leading-none mt-0.5">£{Math.round((jobDetail.materialsAllowancePence ?? 0) / 100)}</div>
                  </div>
                </div>
              </div>

              {/* Scroll region — the ONLY variable-height part, so 1-task and
                * 20-task jobs share an identical frame. */}
              <div className="p-5 pt-4 overflow-y-auto">
                {/* Photos from the quote */}
                {jobDetail.photoUrls && jobDetail.photoUrls.length > 0 && (
                  <div className="mb-4 -mx-1">
                    <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1.5 px-1">Photos</div>
                    <div className="flex gap-2 overflow-x-auto px-1 pb-1">
                      {jobDetail.photoUrls.map((url, i) => (
                        <a key={i} href={url} target="_blank" rel="noreferrer" className="shrink-0">
                          <img src={url} alt="" className="w-24 h-24 rounded-xl object-cover border border-slate-700" />
                        </a>
                      ))}
                    </div>
                  </div>
                )}

                {/* THE WORK — job scope + pay in one list (each line is a task) */}
                {jobDetail.payLines && jobDetail.payLines.length > 0 ? (
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">The work · {jobDetail.payLines.length} task{jobDetail.payLines.length === 1 ? '' : 's'}</span>
                      <span className="text-[9px] text-slate-600 font-semibold">pay · materials</span>
                    </div>
                    <div className="space-y-1.5">
                      {jobDetail.payLines.map((ln, i) => (
                        <div key={i} className="flex items-start gap-2.5 p-2.5 rounded-xl bg-slate-800/40 border border-slate-800">
                          <div className="min-w-0 flex-1">
                            <div className="text-xs font-semibold text-slate-200 leading-snug">{ln.description || ln.category}</div>
                            <div className="text-[9px] text-slate-500 font-semibold mt-0.5">{TIER_LABEL[ln.tier] ?? ln.tier}{ln.method === 'floor' ? ' · min rate' : ''}</div>
                          </div>
                          <div className="text-right shrink-0">
                            <div className="text-sm font-bold text-emerald-300">£{Math.round(ln.payPence / 100)}</div>
                            {ln.materialsPence > 0 && <div className="text-[10px] text-slate-400 font-semibold">£{Math.round(ln.materialsPence / 100)} mat.</div>}
                          </div>
                        </div>
                      ))}
                    </div>
                    <div className="flex items-center gap-2 text-sm font-black mt-3 pt-3 border-t border-slate-800">
                      <span className="flex-1 text-white">Total</span>
                      <span className="text-emerald-300">£{Math.round((jobDetail.payoutPence ?? 0) / 100)}</span>
                      {(jobDetail.materialsAllowancePence ?? 0) > 0 && <span className="text-slate-400 text-xs">+ £{Math.round((jobDetail.materialsAllowancePence ?? 0) / 100)} mat.</span>}
                    </div>
                  </div>
                ) : jobDetail.fullDescription ? (
                  <div>
                    <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">The work</div>
                    <p className="text-xs text-slate-300 leading-relaxed">{jobDetail.fullDescription}</p>
                  </div>
                ) : null}

                {(jobDetail.materialsAllowancePence ?? 0) > 0 && (
                  <p className="mt-4 text-[10px] text-slate-500 leading-snug">
                    You source materials, plant hire and any extra (Handy-vetted) help on your Handy card, within budget. Handy keeps the receipts.
                  </p>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

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
