import { useMemo, useState } from 'react';
import { X, RotateCcw } from 'lucide-react';

/**
 * QuoteSplitLab (/labs/quote-split) — pressure-test for the "Choose what to do
 * now" interactive line-item deferral on a real multi-job quote.
 *
 * Honest re-pricing model, grounded in the pricing engine (server/pricing-config.ts):
 *   - Each job has a MARGINAL price (labour + materials-with-markup).
 *   - A visit shares ONE call-out fee (£25) — the real batching benefit.
 *   - "Total now" = Σ(active marginals) + one call-out.
 *   - A DEFERRED job becomes a separate trip, so it needs its OWN call-out
 *     next visit — its next-visit price = marginal + call-out. That £25 delta
 *     is the true, honest cost of deferring (not an invented discount tier).
 *
 * Dependencies: gas hob + Gas Safe certificate are one locked unit (you can't
 * fit a hob without certifying it). At least one unit must stay "now".
 */

const CALLOUT = 25; // £ — pricing-config.ts calloutFee, charged once per visit

type Job = { id: string; label: string; sub?: string; marginal: number; group: string };

// Real hoprev01-style multi-job quote (marginal £, labour+materials).
const JOBS: Job[] = [
  { id: 'pole', label: 'Install curtain pole', marginal: 65, group: 'pole' },
  { id: 'hob', label: 'Install gas hob', marginal: 190, group: 'gas' },
  { id: 'cert', label: 'Issue Gas Safe certificate', sub: 'Required with the hob', marginal: 90, group: 'gas' },
];

// Deferrable UNITS (dependency-locked groups), in display order.
const UNITS = [
  { group: 'pole', label: 'Install curtain pole', locked: false },
  { group: 'gas', label: 'Gas hob + Gas Safe certificate', locked: true },
];

const gbp = (n: number) => `£${Math.round(n).toLocaleString()}`;

export default function QuoteSplitLab() {
  const [deferred, setDeferred] = useState<Set<string>>(new Set());

  const toggle = (group: string) => {
    setDeferred(prev => {
      const next = new Set(prev);
      if (next.has(group)) next.delete(group);
      else next.add(group);
      // Guard: never defer everything — the last unit stays "now".
      if (next.size >= UNITS.length) next.delete(group);
      return next;
    });
  };

  const { totalNow, fullTotal, deferUnits } = useMemo(() => {
    const activeJobs = JOBS.filter(j => !deferred.has(j.group));
    const marginals = activeJobs.reduce((s, j) => s + j.marginal, 0);
    const totalNow = activeJobs.length > 0 ? marginals + CALLOUT : 0;
    const fullTotal = JOBS.reduce((s, j) => s + j.marginal, 0) + CALLOUT;
    const deferUnits = UNITS.filter(u => deferred.has(u.group)).map(u => {
      const jobs = JOBS.filter(j => j.group === u.group);
      const m = jobs.reduce((s, j) => s + j.marginal, 0);
      return { ...u, nextVisit: m + CALLOUT, marginal: m };
    });
    return { totalNow, fullTotal, deferUnits };
  }, [deferred]);

  const activeUnitCount = UNITS.length - deferred.size;
  const calloutsSaved = Math.max(0, activeUnitCount - 1); // one shared vs one-each

  return (
    <div className="min-h-screen bg-slate-100 flex flex-col items-center py-8 px-4">
      <div className="w-full max-w-md">
        <p className="text-center text-xs text-slate-400 mb-3">/labs/quote-split — "choose what to do now" re-pricing</p>

        <div className="bg-[#1D2D3D] rounded-3xl shadow-2xl p-5 text-white">
          <div className="text-[13px] text-slate-400">Sarah, your quote</div>
          <div className="flex items-baseline justify-between">
            <div className="text-4xl font-black leading-none">{gbp(totalNow)}</div>
            <div className="text-[12px] text-slate-400">all-in fixed price</div>
          </div>
          <p className="text-[12px] text-[#a3d65f] mt-2 mb-4 leading-snug">
            Not ready for everything? Choose what to do now — do the rest next visit.
          </p>

          {/* Line items grouped into deferrable units */}
          <div className="space-y-0">
            {UNITS.map(unit => {
              const jobs = JOBS.filter(j => j.group === unit.group);
              const isDeferred = deferred.has(unit.group);
              return (
                <div key={unit.group} className={`py-3 border-b border-white/[0.07] rounded-lg px-1 transition-colors ${isDeferred ? 'bg-red-500/[0.06]' : ''}`}>
                  <div className="flex items-start gap-3">
                    <div className="flex-1 min-w-0">
                      {jobs.map(j => (
                        <div key={j.id} className="flex items-baseline justify-between">
                          <div>
                            <span className={`text-[14px] font-semibold ${isDeferred ? 'line-through decoration-red-400 decoration-2 text-slate-400' : ''}`}>{j.label}</span>
                            {unit.locked && (
                              <span className="ml-1.5 text-[10px] text-slate-400 border border-white/15 rounded px-1 py-0.5 align-middle">linked</span>
                            )}
                            {j.sub && <div className={`text-[11px] text-slate-400 ${isDeferred ? 'line-through decoration-red-400/60' : ''}`}>{j.sub}</div>}
                          </div>
                          <span className={`text-[13px] font-medium ml-2 ${isDeferred ? 'line-through decoration-red-400 text-slate-500' : ''}`}>{gbp(j.marginal)}</span>
                        </div>
                      ))}
                    </div>
                    <button
                      type="button"
                      onClick={() => toggle(unit.group)}
                      aria-label={isDeferred ? 'Add this back to the visit' : 'Cross off — do this later'}
                      className={`shrink-0 w-8 h-8 rounded-full flex items-center justify-center border transition-colors ${
                        isDeferred
                          ? 'bg-transparent border-[#7DB00E]/50 text-[#a3d65f] hover:bg-[#7DB00E]/15'
                          : 'bg-transparent border-white/20 text-slate-400 hover:border-red-400 hover:text-red-300'
                      }`}
                    >
                      {isDeferred ? <RotateCcw className="w-4 h-4" /> : <X className="w-4 h-4" strokeWidth={2.5} />}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Shared call-out saving — shrinks as units are deferred */}
          <div className="flex items-center justify-between mt-3 pt-1">
            <span className="text-[13px] text-[#a3d65f]">One visit, one call-out</span>
            <span className="text-[13px] text-right">
              {calloutsSaved < UNITS.length - 1 && deferred.size > 0 && (
                <span className="text-slate-500 line-through mr-1.5 text-[12px]">−{gbp(CALLOUT * (UNITS.length - 1))}</span>
              )}
              <span className="text-[#a3d65f] font-medium">{calloutsSaved > 0 ? `−${gbp(CALLOUT * calloutsSaved)}` : gbp(0)}</span>
            </span>
          </div>

          <div className="flex items-baseline justify-between mt-2">
            <span className="text-[17px] font-bold">Total now</span>
            <span className="text-[20px] font-bold text-[#a3d65f]">{gbp(totalNow)}</span>
          </div>

          {/* Deferred pipeline */}
          {deferUnits.length > 0 && (
            <div className="mt-3 bg-white/[0.05] border border-white/10 rounded-2xl p-3">
              <div className="text-[11px] uppercase tracking-wide text-slate-400 mb-1.5">Booked for a later visit</div>
              {deferUnits.map(u => (
                <div key={u.group} className="flex items-baseline justify-between text-[13px] py-0.5">
                  <span>{u.label}</span>
                  <span className="text-slate-400">{gbp(u.nextVisit)} <span className="text-slate-500">· own call-out</span></span>
                </div>
              ))}
              <p className="text-[11px] text-amber-300/80 mt-1.5">
                Doing it now while Craig's here saves the extra {gbp(CALLOUT)} call-out.
              </p>
            </div>
          )}

          <button
            type="button"
            className="w-full mt-4 bg-[#FFE500] text-[#1B2A4A] font-bold rounded-xl py-3 text-base"
          >
            Approve and pay {gbp(totalNow)}
          </button>
        </div>

        <div className="mt-4 text-[12px] text-slate-500 leading-relaxed bg-white rounded-xl p-3 border border-slate-200">
          <b>Model:</b> each job = marginal (labour + materials). One shared £{CALLOUT} call-out per visit.
          Deferred jobs need their own call-out next time (+£{CALLOUT}) — the honest cost of splitting.
          Gas hob + certificate are dependency-locked. Full-visit price: {gbp(fullTotal)}.
        </div>
      </div>
    </div>
  );
}
