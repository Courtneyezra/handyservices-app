import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { Check, Loader2, Star } from 'lucide-react';
import { addDays, format, startOfDay } from 'date-fns';
import { formatDateStr } from '@/hooks/useAvailability';

/**
 * PostPayDayPicker — Model A's second half, exclusion-framed.
 *
 * The checkout keeps the deployed "I'm flexible" promise; THIS step (after
 * payment) asks "any days we should avoid?" — the customer either taps the
 * one-button fast lane ("All days work for me") or crosses off bad days.
 * Everything not crossed off is saved as an allowed day, so dispatch places
 * the job inside window ∩ allowed days and confirms by text.
 *
 * Exclusion framing deliberately replaces the earlier "tap 3+ days that
 * work" positive selection: people satisfice at the minimum, which shrank
 * the routing buffer to 3 days. Crossing off bad days captures near-full
 * flexibility for near-zero effort. Promise line: "we never book a day you
 * crossed off." No availability fetch — these are the customer's
 * constraints, not Craig's openings.
 */
export interface PostPayDayPickerProps {
  quoteId: string;
  /** Already-saved ALLOWED days — renders the summary state instead of the picker. */
  initialDates?: string[];
  /** Fired after a successful save with the allowed dates (YYYY-MM-DD). */
  onSaved?: (dates: string[]) => void;
  /** Open straight into the cross-off grid (hub "Change days" flow). */
  startInEdit?: boolean;
  /** Quote skin — the contractor/team fronting this quote. Defaults to Craig. */
  skinName?: string;
  skinAvatarUrl?: string;
  /** Possessive for copy ("Craig's" / "the team's"). */
  skinPossessive?: string;
}

const MIN_ALLOWED = 3;
// A flexible booking means the customer stays flexible — they may cross off a
// handful of genuine can't-do days, not most of the horizon. Beyond this cap
// they aren't really flexible and should pick a fixed date instead. Enforced
// here AND server-side (public-routes date-preferences).
const MAX_EXCLUDED = 5;
const HORIZON_DAYS = 21;

/** The picker's stable WEEKDAY horizon (YYYY-MM-DD, tomorrow onward, weekends
 *  excluded). Exported so the paid hub can reconstruct avoided days for the
 *  hero's date block without duplicating the calendar grammar. Weekends are
 *  deliberately excluded here — the grid only surfaces a Sat/Sun when a
 *  contractor actually works it, so weekends are additive there, never part of
 *  this baseline reconstruction. */
export function pickerHorizonDates(): string[] {
  const out: string[] = [];
  const start = startOfDay(addDays(new Date(), 1));
  for (let i = 0; i < HORIZON_DAYS; i++) {
    const date = addDays(start, i);
    const dow = date.getDay();
    if (dow === 0 || dow === 6) continue; // weekends gated by availability in the grid
    out.push(formatDateStr(date));
  }
  return out;
}

export function PostPayDayPicker({
  quoteId,
  initialDates,
  onSaved,
  startInEdit = false,
  skinName = 'Craig',
  skinAvatarUrl = '/assets/avatars/craig-avatar-1.webp',
  skinPossessive = "Craig's",
}: PostPayDayPickerProps) {
  // startInEdit (hub "Change days" flow): open straight into the grid with
  // the previously-avoided days pre-crossed instead of the summary state.
  const [excluded, setExcluded] = useState<Set<string>>(() => {
    if (!startInEdit || !initialDates || initialDates.length === 0) return new Set();
    const allowed = new Set(initialDates);
    return new Set(pickerHorizonDates().filter(d => !allowed.has(d)));
  });
  const [savedDates, setSavedDates] = useState<string[] | null>(
    initialDates && initialDates.length > 0 ? initialDates : null,
  );
  const [editing, setEditing] = useState(startInEdit);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // The page hydrates the quote from a localStorage cache and refreshes it
  // async — saved preferences can arrive AFTER mount. Adopt them unless the
  // customer is mid-edit or has already saved this session.
  useEffect(() => {
    if (initialDates && initialDates.length > 0 && !editing && !savedDates) {
      setSavedDates(initialDates);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialDates?.join(',')]);

  // Weekend days (Sat/Sun) only appear if a candidate contractor actually works
  // them — per their Handy OS weekly pattern + date overrides. Weekdays always
  // show (they're the customer's constraints, applied before dispatch). The
  // quote-availability endpoint (no month param → next 30 days) resolves the
  // pool and returns only workable dates. null = not loaded yet → weekends
  // stay hidden until we know, so we never offer a weekend no one can work.
  const [weekendWorkable, setWeekendWorkable] = useState<Set<string> | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/public/quote/${quoteId}/availability?slot=full_day`);
        if (!res.ok) throw new Error('availability fetch failed');
        const data = (await res.json()) as { date: string }[];
        if (!cancelled) setWeekendWorkable(new Set(data.map(d => d.date)));
      } catch {
        // Conservative: leave weekends hidden if we can't confirm availability.
        if (!cancelled) setWeekendWorkable(new Set());
      }
    })();
    return () => { cancelled = true; };
  }, [quoteId]);

  // Next 21 days, tomorrow onward. Weekdays always; weekends only when workable.
  const days = useMemo(() => {
    const out: { date: Date; str: string }[] = [];
    const start = startOfDay(addDays(new Date(), 1));
    for (let i = 0; i < HORIZON_DAYS; i++) {
      const date = addDays(start, i);
      const dow = date.getDay();
      const str = formatDateStr(date);
      const isWeekend = dow === 0 || dow === 6;
      if (isWeekend && !weekendWorkable?.has(str)) continue; // weekend only if a contractor works it
      out.push({ date, str });
    }
    return out;
  }, [weekendWorkable]);

  const allowedCount = days.length - excluded.size;
  const atLimit = excluded.size >= MAX_EXCLUDED;
  const withinCap = excluded.size <= MAX_EXCLUDED;
  const canSubmit = allowedCount >= MIN_ALLOWED && withinCap;

  const toggle = (str: string) => {
    setExcluded(prev => {
      const next = new Set(prev);
      if (next.has(str)) {
        next.delete(str);
        return next;
      }
      // Cap reached — ignore further cross-offs (keeps the booking flexible).
      if (next.size >= MAX_EXCLUDED) return prev;
      next.add(str);
      return next;
    });
  };

  const submit = async (allowAll: boolean) => {
    if (saving || (!allowAll && !canSubmit)) return;
    setSaving(true);
    setSaveError(null);
    const dates = allowAll
      ? days.map(d => d.str)
      : days.filter(d => !excluded.has(d.str)).map(d => d.str);
    try {
      const res = await fetch(`/api/public/quote/${quoteId}/date-preferences`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // offeredCount lets the server derive how many days were crossed off
        // (offered − allowed) and enforce the flex cap authoritatively.
        body: JSON.stringify({ dates, offeredCount: days.length }),
      });
      if (!res.ok) throw new Error('save failed');
      setSavedDates(dates);
      setEditing(false);
      onSaved?.(dates);
    } catch {
      setSaveError("Couldn't save just now — please try again, or reply to our text and we'll sort it.");
    } finally {
      setSaving(false);
    }
  };

  const showSummary = savedDates && !editing;
  // Reconstruct the crossed-off days for the summary (horizon minus allowed).
  const savedExcluded = useMemo(() => {
    if (!savedDates) return [];
    const allowed = new Set(savedDates);
    return days.filter(d => !allowed.has(d.str)).map(d => d.str);
  }, [savedDates, days]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: 0.1 }}
      className="bg-[#1D2D3D] rounded-3xl overflow-hidden shadow-2xl"
    >
      <div className="px-5 py-6 sm:px-8 sm:py-7">
        {/* Skin letterhead — the person the days are being matched against */}
        <div className="flex items-center gap-3 mb-4 pb-4 border-b border-white/10">
          <div className="w-12 h-12 rounded-full overflow-hidden border-2 border-[#7DB00E] shrink-0">
            <img src={skinAvatarUrl} alt={`${skinName}, your assigned handyman`} className="w-full h-full object-cover" />
          </div>
          <div className="min-w-0 text-left">
            <div className="text-slate-400 text-[11px] uppercase tracking-wider font-semibold">Your assigned handyman</div>
            <div className="text-white font-bold leading-tight">
              {skinName} <span className="text-[#7DB00E] text-sm font-normal">from HandyServices</span>
            </div>
            <p className="flex items-center gap-1 text-[11px] text-slate-300 mt-0.5">
              <Star className="w-3 h-3 text-amber-400 fill-amber-400 shrink-0" />
              <span><b className="text-white">4.9</b> · 214 jobs</span>
            </p>
          </div>
        </div>

        {showSummary ? (
          /* ── Saved state — reopens read as "sorted", with a change escape hatch ── */
          <div className="text-left">
            <div className="flex items-center gap-2 mb-3">
              <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-[#7DB00E]">
                <Check className="w-4 h-4 text-white" />
              </span>
              <h3 className="text-white font-bold text-lg">
                {savedExcluded.length === 0 ? "You're fully flexible" : 'Your days are set'}
              </h3>
            </div>
            {savedExcluded.length > 0 && (
              <>
                <p className="text-slate-300 text-sm mb-2">We'll avoid:</p>
                <div className="flex flex-wrap gap-2 mb-3">
                  {savedExcluded.map(str => (
                    <span key={str} className="px-3 py-1.5 rounded-lg bg-red-400/10 border border-red-400/30 text-red-300 text-sm font-semibold line-through">
                      {format(new Date(`${str}T12:00:00`), 'EEE d MMM')}
                    </span>
                  ))}
                </div>
              </>
            )}
            <p className="text-slate-300 text-sm leading-relaxed">
              We'll fit you into {skinPossessive} route{savedExcluded.length > 0 ? ' on any other day' : ''} and
              text your confirmed day at least 2 days ahead.
            </p>
            <button
              type="button"
              onClick={() => { setExcluded(new Set(savedExcluded)); setEditing(true); }}
              className="mt-3 text-[#7DB00E] text-sm font-semibold underline underline-offset-2"
            >
              Change my days
            </button>
          </div>
        ) : (
          /* ── Collection state — exclusion-framed with a one-tap fast lane ── */
          <div className="text-left">
            <h3 className="text-white font-bold text-xl leading-tight mb-1">
              Any days we should avoid?
            </h3>
            <p className="text-slate-400 text-xs leading-snug mb-3">
              Your job lands in the next 2 weeks. Cross off any days that don't work.
            </p>

            {/* Fast lane — most flexible customers finish here in one tap */}
            {excluded.size === 0 && (
              <button
                type="button"
                onClick={() => submit(true)}
                disabled={saving}
                className="w-full rounded-xl py-3.5 mb-4 font-bold text-base bg-[#7DB00E] text-white shadow-lg shadow-[#7DB00E]/25 hover:bg-[#6a9a0c] transition-all"
              >
                {saving ? (
                  <span className="inline-flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Saving…</span>
                ) : (
                  <span className="inline-flex items-center gap-2"><Check className="w-5 h-5" strokeWidth={3} /> All days work for me</span>
                )}
              </button>
            )}

            <p className="text-slate-400 text-xs font-semibold uppercase tracking-wider mb-2">
              {excluded.size === 0
                ? `Or cross off up to ${MAX_EXCLUDED} days that don't work`
                : `Crossed off ${excluded.size}/${MAX_EXCLUDED} — tap again to undo`}
            </p>
            <div className="grid grid-cols-4 sm:grid-cols-6 gap-2 mb-4">
              {days.map(({ date, str }) => {
                const isExcluded = excluded.has(str);
                // At the cap, days not already crossed off can't be added.
                const blocked = !isExcluded && atLimit;
                return (
                  <button
                    key={str}
                    type="button"
                    onClick={() => toggle(str)}
                    disabled={blocked}
                    className={`relative rounded-xl px-1 py-2.5 text-center transition-all border ${
                      isExcluded
                        ? 'bg-red-400/10 border-red-400/40'
                        : blocked
                          ? 'bg-white/5 border-white/10 opacity-40 cursor-not-allowed'
                          : 'bg-white/5 border-white/15 hover:border-red-300/50'
                    }`}
                  >
                    <div className={`text-[10px] font-semibold uppercase ${isExcluded ? 'text-slate-500' : 'text-slate-400'}`}>
                      {format(date, 'EEE')}
                    </div>
                    <div className={`text-lg font-bold leading-tight ${isExcluded ? 'text-slate-500' : 'text-white'}`}>{format(date, 'd')}</div>
                    <div className={`text-[10px] ${isExcluded ? 'text-slate-500' : 'text-slate-400'}`}>
                      {format(date, 'MMM')}
                    </div>
                    {/* Pencil-stroke cross through the whole chip — the
                        unmistakable "crossed off" mark. Slightly curved paths
                        + rounded caps read as hand-drawn rather than icon-X. */}
                    {isExcluded && (
                      <svg
                        className="absolute inset-0 w-full h-full pointer-events-none"
                        viewBox="0 0 100 100"
                        preserveAspectRatio="none"
                        aria-hidden="true"
                      >
                        <path d="M12 14 Q48 42 88 86" stroke="#f87171" strokeWidth="7" strokeLinecap="round" fill="none" opacity="0.95" />
                        <path d="M87 12 Q54 46 13 87" stroke="#f87171" strokeWidth="7" strokeLinecap="round" fill="none" opacity="0.95" />
                      </svg>
                    )}
                  </button>
                );
              })}
            </div>

            {atLimit && withinCap && (
              <p className="text-amber-400/90 text-xs mb-3">
                That's the most a flexible booking can avoid ({MAX_EXCLUDED} days). Untick one to change it — or if more days don't work, reply to our text and we'll pin an exact date.
              </p>
            )}

            {saveError && (
              <p className="text-amber-400 text-sm mb-3">{saveError}</p>
            )}

            {/* Confirm appears once they've started crossing off */}
            {excluded.size > 0 && (
              <button
                type="button"
                onClick={() => submit(false)}
                disabled={!canSubmit || saving}
                className={`w-full rounded-xl py-3.5 font-bold text-base transition-all ${
                  canSubmit
                    ? 'bg-[#7DB00E] text-white shadow-lg shadow-[#7DB00E]/25 hover:bg-[#6a9a0c]'
                    : 'bg-white/10 text-slate-500 cursor-not-allowed'
                }`}
              >
                {saving ? (
                  <span className="inline-flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Saving…</span>
                ) : !withinCap ? (
                  `Cross off ${MAX_EXCLUDED} days or fewer`
                ) : canSubmit ? (
                  `Done — avoiding ${excluded.size} day${excluded.size === 1 ? '' : 's'}`
                ) : (
                  `Leave at least ${MIN_ALLOWED} days open`
                )}
              </button>
            )}
            <p className="text-slate-400 text-xs text-center mt-2.5">
              We never book a day you crossed off — and we text your confirmed
              day at least 2 days ahead.
            </p>
          </div>
        )}
      </div>
    </motion.div>
  );
}
