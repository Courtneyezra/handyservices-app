/**
 * Week Planner — frontend-only design mock (no backend, nothing books).
 *
 * Shareable at /labs/week-planner to validate the Plan-sheet UX on a phone
 * before P0 (the week-plan endpoint) is built. Seeded with Craig's REAL
 * current situation (Beth's 2-day anchor, Nasreen's 3-day block, Elevate's
 * full-day job, Sharon's overdue extractor) so the design is judged against
 * real shapes, not lorem ipsum. Spec: docs/contractor-platform/05-week-planner-ui.md.
 */
import { useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Lock, X, CalendarPlus, Sparkles } from 'lucide-react';

// ── Seed data (mirrors the live DB on 22 Jul) ─────────────────────────────────

type Goal = 'best' | 'fewest' | 'soonest';

interface PlanJob {
  id: string;
  label: string;
  area: string;
  valuePence: number;
  slot: 'AM' | 'PM' | 'DAY';
  reason?: string;
}

const ANCHOR = { label: 'Beth · shower re-fix + repairs', area: 'DE24', valuePence: 57900 };
const ELEVATE: PlanJob = { id: 'elevate', label: 'Finish herringbone laminate floor', area: 'DE73', valuePence: 71000, slot: 'DAY', reason: 'earliest day you can take it' };
const NASREEN = { id: 'nasreen', label: 'Nasreen · TV wall-mount, hidden cables, flat-packs', area: 'NG14', valuePence: 190300, days: 3, deadline: 'Tue 4 Aug' };
const SHARON: PlanJob = { id: 'sharon', label: 'Kitchen extractor + bath tiles', area: 'DE24', valuePence: 38100, slot: 'AM', reason: 'before her Saturday deadline' };

// ── Component ─────────────────────────────────────────────────────────────────

export default function WeekPlannerPreview() {
  const [week, setWeek] = useState<'this' | 'next'>('this');
  const [goal, setGoal] = useState<Goal>('best');
  // Harvest-inside-planner: which off-days has "Craig" opened in the mock.
  const [opened, setOpened] = useState<Set<string>>(new Set());
  const [confirmKey, setConfirmKey] = useState<string | null>(null);
  const [locked, setLocked] = useState<Set<string>>(new Set());

  const openDay = (d: string) => setOpened((s) => new Set(s).add(d));

  // ── Mock plan composition per week/goal/opened-days ──
  const days = useMemo(() => {
    if (week === 'this') {
      const thuOpen = opened.has('Thu 23');
      return [
        { d: 'Wed 22', state: 'today-off' as const },
        thuOpen
          ? { d: 'Thu 23', state: 'ghost' as const, jobs: [SHARON], lockKey: 'thu-sharon' }
          : { d: 'Thu 23', state: 'coach' as const, coach: `Open Thu to fit Sharon's £381 extractor before Sat` },
        { d: 'Fri 24', state: 'off' as const },
        { d: 'Sat 25', state: 'off' as const },
        { d: 'Sun 26', state: 'off' as const },
        { d: 'Mon 27', state: 'off' as const },
        { d: 'Tue 28', state: 'off' as const },
      ];
    }
    // Next week: Beth anchor Wed–Thu; Fri ghost (Elevate); Mon–Wed = Nasreen's
    // block IF the three days are opened.
    const blockDays = ['Mon 3', 'Tue 4', 'Wed 5'];
    const blockReady = blockDays.every((d) => opened.has(d));
    const soonest = goal === 'soonest';
    return [
      ...(blockReady
        ? blockDays.map((d, i) => ({ d, state: 'block' as const, blockIdx: i, lockKey: 'block-nasreen' }))
        : blockDays.map((d) => ({ d, state: 'coach-open' as const, coach: `Open ${blockDays.join(' + ')} to fit Nasreen's £1,903 3-day job (start by ${NASREEN.deadline})` }))),
      { d: 'Wed 29*', state: 'anchor' as const, tag: 'Day 1 of 2' },
      { d: 'Thu 30*', state: 'anchor' as const, tag: 'Day 2 of 2' },
      { d: 'Fri 31*', state: 'ghost' as const, jobs: [{ ...ELEVATE, reason: soonest ? 'earliest day you can take it' : 'fills your only open day' }], lockKey: 'fri-elevate' },
      { d: 'Sat 1', state: 'off' as const },
    ];
  }, [week, goal, opened]);

  const proposedPence = days.reduce((s, day: any) => {
    if (day.state === 'ghost' && !locked.has(day.lockKey)) s += day.jobs.reduce((a: number, j: PlanJob) => a + j.valuePence, 0);
    if (day.state === 'block' && day.blockIdx === 0 && !locked.has(day.lockKey)) s += NASREEN.valuePence;
    return s;
  }, 0);
  const lockedPence = [...locked].reduce((s, k) => s + (k === 'block-nasreen' ? NASREEN.valuePence : k === 'fri-elevate' ? ELEVATE.valuePence : SHARON.valuePence), 0);
  const bookedPence = 57900 + lockedPence;
  const lockableKeys = days.filter((d: any) => (d.state === 'ghost' || (d.state === 'block' && d.blockIdx === 0)) && !locked.has(d.lockKey)).map((d: any) => d.lockKey);

  const doLock = (key: string) => setLocked((s) => { const n = new Set(s); n.add(key); return n; });

  const money = (p: number) => `£${Math.round(p / 100).toLocaleString()}`;

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <div className="max-w-md mx-auto px-4 pt-5 pb-36">
        {/* Preview banner */}
        <div className="mb-4 py-1.5 px-3 rounded-lg bg-amber-500/15 border border-amber-500/30 text-[11px] font-bold text-amber-400 text-center">
          DESIGN PREVIEW — nothing here books anything
        </div>

        {/* Header: week switcher + payslip */}
        <div className="flex items-center justify-between mb-1">
          <h1 className="text-xl font-bold">Plan my week</h1>
          <button className="w-8 h-8 rounded-full bg-slate-800 flex items-center justify-center text-slate-400"><X size={16} /></button>
        </div>
        <div className="flex gap-1.5 mb-3">
          {(['this', 'next'] as const).map((w) => (
            <button key={w} onClick={() => { setWeek(w); setConfirmKey(null); }}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold border ${week === w ? 'bg-white text-slate-950 border-white' : 'bg-slate-900/60 text-slate-400 border-slate-800'}`}>
              {w === 'this' ? 'This week' : 'Next week'}
            </button>
          ))}
        </div>

        {/* Payslip */}
        <div className="mb-4 p-4 rounded-2xl bg-slate-900/70 border border-slate-800">
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-bold">{money(bookedPence)}</span>
            <span className="text-xs text-slate-400 font-semibold">booked</span>
            {proposedPence > 0 && (
              <>
                <span className="text-emerald-400 text-2xl font-bold">+{money(proposedPence)}</span>
                <span className="text-xs text-emerald-400/80 font-semibold">ready to add</span>
              </>
            )}
          </div>
        </div>

        {/* Goal pills */}
        <div className="flex gap-1.5 mb-4">
          {([
            { key: 'best' as const, label: 'Best week £' },
            { key: 'fewest' as const, label: 'Fewest days' },
            { key: 'soonest' as const, label: 'Done soonest' },
          ]).map((g) => (
            <button key={g.key} onClick={() => setGoal(g.key)}
              className={`flex-1 py-2 rounded-xl text-[11px] font-bold border transition-all ${goal === g.key ? 'bg-emerald-500 text-slate-950 border-emerald-500' : 'bg-slate-900/60 text-slate-400 border-slate-800'}`}>
              {g.label}
            </button>
          ))}
        </div>

        {/* Day rows */}
        <div className="space-y-2">
          {days.map((day: any) => {
            const isLocked = day.lockKey && locked.has(day.lockKey);
            return (
              <div key={day.d} className="flex gap-2.5">
                {/* Date chip */}
                <div className={`w-14 shrink-0 rounded-xl border flex flex-col items-center justify-center py-2 ${
                  day.state === 'anchor' || isLocked ? 'bg-blue-500/15 border-blue-500/30'
                  : day.state === 'ghost' || day.state === 'block' ? 'border-emerald-500/50 border-dashed bg-emerald-500/5'
                  : day.state.startsWith('coach') ? 'bg-slate-900/60 border-amber-500/30'
                  : 'bg-slate-900/40 border-slate-800/50'
                }`}>
                  <span className="text-[10px] font-bold uppercase text-slate-400">{day.d.split(' ')[0]}</span>
                  <span className="text-base font-bold">{day.d.split(' ')[1].replace('*', '')}</span>
                </div>

                {/* Row content */}
                <div className="flex-1 min-w-0">
                  {day.state === 'anchor' && (
                    <div className="p-3 rounded-xl bg-blue-500/15 border border-blue-500/30">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-blue-300 truncate">{ANCHOR.label}</span>
                        <span className="text-sm font-bold text-blue-200 shrink-0 flex items-center gap-1.5">{money(ANCHOR.valuePence)} <Lock size={10} /></span>
                      </div>
                      <span className="text-[10px] text-blue-400/70 font-semibold">{day.tag} · booked</span>
                    </div>
                  )}

                  {day.state === 'block' && (
                    day.blockIdx === 0 ? (
                      <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
                        className={`p-3 rounded-xl border ${isLocked ? 'bg-blue-500/15 border-blue-500/30' : 'bg-emerald-500/8 border-emerald-500/40 border-dashed'}`}>
                        <div className="flex items-center justify-between gap-2">
                          <span className={`text-xs font-bold truncate ${isLocked ? 'text-blue-300' : 'text-emerald-300'}`}>{NASREEN.label}</span>
                          <span className={`text-sm font-bold shrink-0 ${isLocked ? 'text-blue-200' : 'text-emerald-300'}`}>{money(NASREEN.valuePence)}</span>
                        </div>
                        <div className="text-[10px] text-slate-400 mt-0.5">runs Mon 3 → Wed 5 · start by {NASREEN.deadline}</div>
                        {!isLocked && (
                          <button onClick={() => (confirmKey === day.lockKey ? doLock(day.lockKey) : setConfirmKey(day.lockKey))}
                            className={`mt-2 w-full py-2 rounded-lg text-xs font-bold transition-all ${confirmKey === day.lockKey ? 'bg-emerald-500 text-slate-950' : 'bg-slate-800 text-slate-200'}`}>
                            {confirmKey === day.lockKey ? 'Confirm — book Mon 3 → Wed 5?' : 'Lock this block · 3 days'}
                          </button>
                        )}
                        {isLocked && <div className="text-[10px] font-bold text-blue-400 mt-1 flex items-center gap-1"><Lock size={9} /> Booked · Mon–Wed</div>}
                      </motion.div>
                    ) : (
                      <div className={`h-full min-h-[34px] rounded-xl border border-t-0 ${isLocked ? 'bg-blue-500/10 border-blue-500/20' : 'bg-emerald-500/5 border-emerald-500/25 border-dashed'} flex items-center px-3`}>
                        <span className="text-[10px] text-slate-500 font-semibold">↑ Nasreen · day {day.blockIdx + 1} of 3</span>
                      </div>
                    )
                  )}

                  {day.state === 'ghost' && (
                    <div className={`p-3 rounded-xl border ${isLocked ? 'bg-blue-500/15 border-blue-500/30' : 'bg-emerald-500/8 border-emerald-500/40 border-dashed'}`}>
                      {day.jobs.map((j: PlanJob) => (
                        <div key={j.id}>
                          <div className="flex items-center justify-between gap-2">
                            <span className={`text-xs font-bold truncate ${isLocked ? 'text-blue-300' : 'text-emerald-300'}`}>{j.slot} · {j.label}</span>
                            <span className={`text-sm font-bold shrink-0 ${isLocked ? 'text-blue-200' : 'text-emerald-300'}`}>{money(j.valuePence)}</span>
                          </div>
                          {j.reason && !isLocked && <div className="text-[10px] text-emerald-400/80 mt-0.5">{j.reason} · {j.area}</div>}
                        </div>
                      ))}
                      {!isLocked ? (
                        <button onClick={() => (confirmKey === day.lockKey ? doLock(day.lockKey) : setConfirmKey(day.lockKey))}
                          className={`mt-2 w-full py-2 rounded-lg text-xs font-bold transition-all ${confirmKey === day.lockKey ? 'bg-emerald-500 text-slate-950' : 'bg-slate-800 text-slate-200'}`}>
                          {confirmKey === day.lockKey ? `Confirm — book ${day.d}?` : `Lock this day · ${money(day.jobs.reduce((a: number, j: PlanJob) => a + j.valuePence, 0))}`}
                        </button>
                      ) : (
                        <div className="text-[10px] font-bold text-blue-400 mt-1 flex items-center gap-1"><Lock size={9} /> Booked</div>
                      )}
                    </div>
                  )}

                  {(day.state === 'coach' || day.state === 'coach-open') && (
                    <div className="p-3 rounded-xl bg-slate-900/50 border border-amber-500/25">
                      <div className="flex items-start gap-2">
                        <Sparkles size={13} className="text-amber-400 shrink-0 mt-0.5" />
                        <span className="text-[11px] text-amber-300/90 leading-snug">{day.coach}</span>
                      </div>
                      <button onClick={() => openDay(day.d)}
                        className="mt-2 w-full py-2 rounded-lg text-xs font-bold bg-slate-800 text-slate-200 flex items-center justify-center gap-1.5 active:scale-[0.99]">
                        <CalendarPlus size={13} /> Open this day
                      </button>
                    </div>
                  )}

                  {(day.state === 'off' || day.state === 'today-off') && (
                    <div className="h-full min-h-[34px] rounded-xl bg-slate-900/30 border border-slate-800/40 flex items-center px-3">
                      <span className="text-[10px] text-slate-600 font-semibold">{day.state === 'today-off' ? 'today · off' : 'off'}</span>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Sticky week-lock bar */}
      <AnimatePresence>
        {lockableKeys.length > 0 && (
          <motion.div initial={{ y: 80 }} animate={{ y: 0 }} exit={{ y: 80 }}
            className="fixed bottom-0 inset-x-0 z-40 bg-slate-950/95 backdrop-blur-md border-t border-slate-800 p-3 pb-[max(12px,env(safe-area-inset-bottom))]">
            <div className="max-w-md mx-auto">
              <button
                onClick={() => (confirmKey === 'week' ? lockableKeys.forEach(doLock) : setConfirmKey('week'))}
                className={`w-full py-3.5 rounded-xl font-bold text-sm transition-all active:scale-[0.99] ${
                  confirmKey === 'week' ? 'bg-emerald-400 text-slate-950' : 'bg-emerald-500 text-slate-950'
                }`}>
                {confirmKey === 'week'
                  ? `Confirm — book ${lockableKeys.length} placement${lockableKeys.length === 1 ? '' : 's'}?`
                  : `Lock my week · +${money(proposedPence)}`}
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
