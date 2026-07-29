/**
 * Scorecard + win-moment — frontend-only design mock (no backend).
 *
 * Two things to feel on a phone before building for real:
 *  1. The LOCK "win" card — the dopamine hit when Craig claims a big job.
 *  2. The Profile SCORECARD — his career at a glance, quality beside money.
 *
 * Design rules (from the pay/loyalty discussion): celebrate MONEY + JOBS +
 * PROMISE-KEPT, never £/day (that trains rushing). Tier ladder is the
 * achievement spine — real rewards (higher %), not fake points. Bold + solid
 * for the big moment; clean everyday. Seeded with Craig's real figures.
 * Shareable at /labs/scorecard.
 */
import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence, useMotionValue, animate } from 'framer-motion';
import { Check, Flame, Star, TrendingUp, Award, X, Lock } from 'lucide-react';

// ── Seed (Craig) ──────────────────────────────────────────────────────────────
const CRAIG = {
  name: 'Craig Smith',
  avatar: '/assets/avatars/craig-avatar-1.webp',
  tier: 'core' as const,
  allTimePence: 824000,
  monthPence: 234000,
  weekPence: 111300,
  jobsDone: 47,
  onTimePct: 100,
  rating: 4.9,
  weekBooked: 4,
  weekOpen: 5,
  streakWeeks: 3,
};
const TIERS = [
  { key: 'adhoc', label: 'Ad-hoc', share: '45–55%' },
  { key: 'core', label: 'Core', share: '+5%' },
  { key: 'partner', label: 'Partner', share: 'equity' },
];

const gbp = (p: number) => '£' + Math.round(p / 100).toLocaleString();

// Animated count-up number.
function Count({ to, className, prefix = '£' }: { to: number; className?: string; prefix?: string }) {
  const mv = useMotionValue(0);
  const [txt, setTxt] = useState(prefix + '0');
  useEffect(() => {
    const controls = animate(mv, to, { duration: 1.1, ease: [0.16, 1, 0.3, 1], onUpdate: (v) => setTxt(prefix + Math.round(v / 100).toLocaleString()) });
    return controls.stop;
  }, [to]);
  return <span className={className}>{txt}</span>;
}

// ── Win overlay ───────────────────────────────────────────────────────────────
function WinCard({ job, monthBefore, onClose }: { job: { customer: string; payPence: number; badge?: string }; monthBefore: number; onClose: () => void }) {
  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex flex-col items-center justify-center px-6 text-center"
      style={{ background: 'radial-gradient(120% 90% at 50% 30%, #065f46 0%, #022c22 55%, #010a08 100%)' }}
    >
      <motion.div initial={{ scale: 0.4, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: 'spring', damping: 12, stiffness: 200, delay: 0.05 }}
        className="w-20 h-20 rounded-full bg-emerald-400 flex items-center justify-center mb-6 shadow-[0_0_60px_rgba(52,211,153,0.6)]">
        <Check size={44} strokeWidth={3} className="text-emerald-950" />
      </motion.div>

      <motion.div initial={{ y: 12, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.15 }} className="text-emerald-300/80 text-sm font-bold uppercase tracking-[0.2em] mb-2">Booked · nice one</motion.div>
      <Count to={job.payPence} className="text-6xl font-black text-white tracking-tight" />
      <motion.div initial={{ y: 12, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.35 }} className="text-emerald-200 font-semibold mt-2">{job.customer} added to your week</motion.div>

      {job.badge && (
        <motion.div initial={{ scale: 0, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: 'spring', delay: 0.6 }}
          className="mt-5 px-4 py-2 rounded-full bg-amber-400/15 border border-amber-400/40 text-amber-300 text-xs font-bold flex items-center gap-2">
          <Flame size={14} /> {job.badge}
        </motion.div>
      )}

      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.8 }} className="mt-8 px-5 py-3 rounded-2xl bg-white/5 border border-white/10">
        <div className="text-[11px] text-emerald-300/70 font-semibold uppercase tracking-wider">Earned this month</div>
        <div className="flex items-baseline gap-2 justify-center">
          <span className="text-slate-500 line-through text-lg font-bold">{gbp(monthBefore)}</span>
          <Count to={monthBefore + job.payPence} className="text-2xl font-black text-emerald-300" />
        </div>
      </motion.div>

      <motion.button initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1 }} onClick={onClose}
        className="mt-8 px-10 py-3.5 rounded-2xl bg-emerald-400 text-emerald-950 font-black text-sm active:scale-95 transition-transform">
        Sweet →
      </motion.button>
    </motion.div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────
export default function ScorecardPreview() {
  const [view, setView] = useState<'card' | 'scorecard'>('card');
  const [win, setWin] = useState<{ customer: string; payPence: number; badge?: string } | null>(null);
  const [monthPence, setMonthPence] = useState(CRAIG.monthPence);
  const [range, setRange] = useState<'week' | 'month' | 'all'>('month');

  const triggerWin = (customer: string, payPence: number, badge?: string) => setWin({ customer, payPence, badge });
  const closeWin = () => { if (win) setMonthPence((m) => m + win.payPence); setWin(null); };

  const rangePence = range === 'week' ? CRAIG.weekPence : range === 'month' ? monthPence : CRAIG.allTimePence;
  const rangeLabel = range === 'week' ? 'this week' : range === 'month' ? 'this month' : 'all-time';

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <div className="max-w-md mx-auto px-4 pt-5 pb-16">
        <div className="mb-4 py-1.5 px-3 rounded-lg bg-amber-500/15 border border-amber-500/30 text-[11px] font-bold text-amber-400 text-center">DESIGN PREVIEW — tap the buttons to feel the moments</div>

        <div className="flex gap-1.5 mb-5">
          {(['card', 'scorecard'] as const).map((v) => (
            <button key={v} onClick={() => setView(v)} className={`flex-1 py-2 rounded-xl text-xs font-bold border ${view === v ? 'bg-white text-slate-950 border-white' : 'bg-slate-900/60 text-slate-400 border-slate-800'}`}>
              {v === 'card' ? 'Win moment' : 'Scorecard'}
            </button>
          ))}
        </div>

        {/* WIN-MOMENT triggers */}
        {view === 'card' && (
          <div className="space-y-3">
            <p className="text-xs text-slate-500">Locking a job fires the celebration. The big one trips a badge.</p>
            <button onClick={() => triggerWin('Nasreen', 80700, 'Biggest job this month')} className="w-full p-4 rounded-2xl bg-emerald-500 text-slate-950 font-black text-left active:scale-[0.99] transition-transform flex items-center justify-between">
              <span>Lock Nasreen · TV wall + LED shelving</span><span className="flex items-center gap-1.5">£807 <Lock size={16} /></span>
            </button>
            <button onClick={() => triggerWin('Elevate', 35500)} className="w-full p-4 rounded-2xl bg-slate-800 text-white font-bold text-left active:scale-[0.99] transition-transform flex items-center justify-between border border-slate-700">
              <span>Lock Elevate · herringbone floor</span><span className="flex items-center gap-1.5 text-emerald-300">£355 <Lock size={15} /></span>
            </button>
            <button onClick={() => triggerWin('Sharon', 16800)} className="w-full p-4 rounded-2xl bg-slate-800 text-white font-bold text-left active:scale-[0.99] transition-transform flex items-center justify-between border border-slate-700">
              <span>Lock Sharon · kitchen extractor</span><span className="flex items-center gap-1.5 text-emerald-300">£168 <Lock size={15} /></span>
            </button>
          </div>
        )}

        {/* SCORECARD */}
        {view === 'scorecard' && (
          <div>
            <div className="flex items-center gap-3 mb-5">
              <img src={CRAIG.avatar} alt="" className="w-12 h-12 rounded-full object-cover border border-slate-700" />
              <div>
                <div className="text-lg font-bold leading-tight">{CRAIG.name}</div>
                <div className="inline-flex items-center gap-1 mt-0.5 px-2 py-0.5 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-[10px] font-black text-emerald-300 uppercase tracking-wider">Core contractor</div>
              </div>
            </div>

            {/* Hero earnings */}
            <div className="p-5 rounded-2xl bg-gradient-to-br from-emerald-500/15 to-slate-900/40 border border-emerald-500/25 mb-3">
              <div className="flex items-center justify-between mb-1">
                <span className="text-[11px] font-bold uppercase tracking-wider text-emerald-300/70">Earned with Handy · {rangeLabel}</span>
                <TrendingUp size={14} className="text-emerald-400" />
              </div>
              <Count to={rangePence} className="text-4xl font-black text-white" />
              <div className="flex gap-1.5 mt-3">
                {(['week', 'month', 'all'] as const).map((r) => (
                  <button key={r} onClick={() => setRange(r)} className={`px-3 py-1 rounded-lg text-[11px] font-bold ${range === r ? 'bg-emerald-400 text-emerald-950' : 'bg-slate-800 text-slate-400'}`}>
                    {r === 'all' ? 'All-time' : r === 'week' ? 'This week' : 'This month'}
                  </button>
                ))}
              </div>
            </div>

            {/* Quality flex — money's equal (the pride row) */}
            <div className="grid grid-cols-3 gap-2 mb-3">
              <div className="p-3 rounded-xl bg-slate-900/60 border border-slate-800 text-center">
                <div className="text-2xl font-black text-white">{CRAIG.jobsDone}</div>
                <div className="text-[10px] text-slate-500 font-semibold mt-0.5">jobs done</div>
              </div>
              <div className="p-3 rounded-xl bg-blue-500/10 border border-blue-500/25 text-center">
                <div className="text-2xl font-black text-blue-300">{CRAIG.onTimePct}%</div>
                <div className="text-[10px] text-blue-400/70 font-semibold mt-0.5">on time</div>
              </div>
              <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/25 text-center">
                <div className="text-2xl font-black text-amber-300 flex items-center justify-center gap-0.5">{CRAIG.rating}<Star size={14} className="fill-amber-300" /></div>
                <div className="text-[10px] text-amber-400/70 font-semibold mt-0.5">rating</div>
              </div>
            </div>

            {/* Week fill + streak */}
            <div className="p-4 rounded-2xl bg-slate-900/60 border border-slate-800 mb-3">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-bold">This week</span>
                <span className="inline-flex items-center gap-1 text-[11px] font-bold text-amber-300"><Flame size={12} /> {CRAIG.streakWeeks}-week streak</span>
              </div>
              <div className="flex gap-1">
                {Array.from({ length: CRAIG.weekOpen }, (_, i) => (
                  <div key={i} className={`flex-1 h-2.5 rounded-full ${i < CRAIG.weekBooked ? 'bg-emerald-400' : 'bg-slate-700'}`} />
                ))}
              </div>
              <div className="text-[11px] text-slate-400 font-semibold mt-2">{CRAIG.weekBooked} of {CRAIG.weekOpen} open days booked</div>
            </div>

            {/* Tier ladder — the achievement spine */}
            <div className="p-4 rounded-2xl bg-slate-900/60 border border-slate-800">
              <div className="text-xs font-bold mb-3 flex items-center gap-1.5"><Award size={14} className="text-emerald-400" /> Your tier</div>
              <div className="flex items-center gap-1 mb-3">
                {TIERS.map((t, i) => {
                  const active = t.key === CRAIG.tier;
                  const passed = i <= TIERS.findIndex((x) => x.key === CRAIG.tier);
                  return (
                    <div key={t.key} className="flex-1">
                      <div className={`h-1.5 rounded-full ${passed ? 'bg-emerald-400' : 'bg-slate-700'}`} />
                      <div className={`text-[10px] font-bold mt-1 ${active ? 'text-emerald-300' : passed ? 'text-slate-300' : 'text-slate-600'}`}>{t.label}</div>
                      <div className="text-[9px] text-slate-600">{t.share}</div>
                    </div>
                  );
                })}
              </div>
              <div className="text-[11px] text-slate-400 leading-snug">
                You're <span className="text-emerald-300 font-bold">Core</span> — +5% on every job, first pick of the week.
                Next: <span className="text-white font-bold">Partner</span> — 8 more 5★ jobs to unlock.
              </div>
            </div>
          </div>
        )}
      </div>

      <AnimatePresence>
        {win && <WinCard job={win} monthBefore={monthPence} onClose={closeWin} />}
      </AnimatePresence>
    </div>
  );
}
