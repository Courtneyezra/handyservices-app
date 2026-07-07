import { useEffect, useRef, useState } from 'react';
import { Check, Loader2, ShieldCheck, Star, Wrench, MapPin, Lock, Sparkles } from 'lucide-react';

/**
 * "Preparing your quote" waiting screen — step 1 of the 3-step flow
 * (waiting → irresistible offer → quote). Led by Ben — same avatar, green ring
 * and online dot as the quote page's chat header — so it reads as a continuation
 * of the conversation the customer just had with him, not a foreign system page.
 *
 * Replaces the gray QuoteSkeleton for the test variant: instead of placeholder
 * blocks it shows a confident progress checklist that ticks through sequentially
 * plus social proof, building anticipation before the price is revealed.
 *
 * Timing: the checklist plays over ~STEP_MS × steps. `onComplete` fires once the
 * animation has finished AND `ready` is true (assets/data loaded) — so a slow
 * network just holds on the last step rather than jumping to a half-painted page.
 */

const STEPS: { icon: typeof Wrench; label: string }[] = [
  { icon: Wrench, label: 'Matching you with our best handyman' },
  { icon: MapPin, label: "Checking who's free near you" },
  { icon: Lock, label: 'Locking in your fixed price' },
  { icon: Sparkles, label: 'Adding the finishing touches' },
];

const STEP_MS = 1050; // per-step dwell; ~4.2s total across 4 steps

interface QuotePreparingScreenProps {
  /** Underlying quote data + above-the-fold assets are ready. Gates completion. */
  ready: boolean;
  /** Fired once the checklist finished AND `ready` is true. Called at most once. */
  onComplete: () => void;
  /** Customer's name — the first name greets them ("One moment, Sarah."), tying
   *  the loading beat to the chat. Optional: omitted in the Suspense fallback. */
  customerName?: string;
  pricingSettings?: {
    googleRating?: string;
    reviewCount?: number;
    jobsCompleted?: string;
  } | null;
  /** Sub-headline under the greeting. Defaults to the quote-loading copy. */
  subcopy?: string;
  /** Override the checklist steps (e.g. for the visit flow). Defaults to STEPS. */
  steps?: { icon: typeof Wrench; label: string }[];
  /**
   * Skip the checklist theatre — returning visitors (median 7 opens) and paid
   * customers shouldn't sit through "locking in your fixed price" again. The
   * screen then acts as a plain branded loader: onComplete fires as soon as
   * `ready` is true. May flip true mid-show (once the quote arrives with
   * viewCount > 1) — the checklist snaps to done and completes.
   */
  instant?: boolean;
}

export function QuotePreparingScreen({ ready, onComplete, customerName, pricingSettings, subcopy, steps, instant = false }: QuotePreparingScreenProps) {
  const STEPS_TO_USE = steps ?? STEPS;
  const firstName = customerName?.trim().split(/\s+/)[0] ?? '';
  // activeStep = the index currently "in progress". Steps below it are done.
  // When it reaches STEPS.length the checklist animation is complete.
  // Instant mode starts (or snaps) fully ticked — no theatre on reopens.
  const [activeStep, setActiveStep] = useState(instant ? STEPS_TO_USE.length : 0);
  const completedRef = useRef(false);

  // Advance one step per STEP_MS until all steps are done.
  useEffect(() => {
    if (activeStep >= STEPS_TO_USE.length) return;
    if (instant) {
      setActiveStep(STEPS_TO_USE.length);
      return;
    }
    const t = setTimeout(() => setActiveStep((s) => s + 1), STEP_MS);
    return () => clearTimeout(t);
  }, [activeStep, STEPS_TO_USE.length, instant]);

  // Fire onComplete once the animation finished AND data/assets are ready.
  useEffect(() => {
    if (completedRef.current) return;
    if (activeStep >= STEPS_TO_USE.length && ready) {
      completedRef.current = true;
      const t = setTimeout(onComplete, instant ? 120 : 450); // brief beat on the final tick
      return () => clearTimeout(t);
    }
  }, [activeStep, ready, onComplete, instant]);

  const rating = pricingSettings?.googleRating ?? '4.9';
  const jobs = pricingSettings?.jobsCompleted ?? '500+';

  return (
    <div className="min-h-screen bg-slate-50 font-sans text-slate-900 flex flex-col items-center px-4 py-10">
      <style>{`
        @keyframes hs-pop { 0% { transform: scale(0.6); opacity: 0; } 60% { transform: scale(1.08); } 100% { transform: scale(1); opacity: 1; } }
        @keyframes hs-bar { 0% { width: 0%; } 100% { width: 100%; } }
        @keyframes hs-prep-rise { 0% { transform: translateY(14px); opacity: 0; } 100% { transform: translateY(0); opacity: 1; } }
        .hs-prep-rise { animation: hs-prep-rise .55s cubic-bezier(.23,1,.32,1) both; }
        .hs-prep-d0 { animation-delay: 0s; }
        .hs-prep-d1 { animation-delay: .08s; }
        .hs-prep-d2 { animation-delay: .16s; }
        .hs-prep-d3 { animation-delay: .24s; }
        .hs-prep-d4 { animation-delay: .32s; }
      `}</style>

      <div className="w-full max-w-md">
        {/* Ben — same face + green ring + online dot as the quote page's chat
            header, so this beat reads as a continuation of the conversation the
            customer just had with him, not a foreign system page. */}
        <div className="flex flex-col items-center text-center mb-7 hs-prep-rise hs-prep-d0">
          <div className="relative">
            <div className="w-16 h-16 rounded-full overflow-hidden border-2 border-[#7DB00E] shadow-lg">
              <img src="/assets/quote-images/ben-estimator.webp" alt="Ben" className="w-full h-full object-cover" />
            </div>
            <span className="absolute bottom-0.5 right-0.5 w-3.5 h-3.5 rounded-full bg-[#7DB00E] ring-2 ring-slate-50" aria-hidden="true" />
          </div>
          <h1 className="mt-4 text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight">
            {firstName ? `One moment, ${firstName}.` : 'One moment.'}
          </h1>
          <p className="text-slate-500 mt-2 text-sm">
            {subcopy ?? 'Ben is putting your quote together…'}
          </p>
        </div>

        {/* Progress checklist card */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-lg p-5 sm:p-6 hs-prep-rise hs-prep-d2">
          <ul className="space-y-1">
            {STEPS_TO_USE.map((step, i) => {
              const done = i < activeStep;
              const active = i === activeStep;
              const Icon = step.icon;
              return (
                <li
                  key={i}
                  className={`flex items-center gap-3 rounded-xl px-2.5 py-3 transition-colors ${
                    active ? 'bg-[#7DB00E]/[0.07]' : ''
                  }`}
                >
                  <span
                    className={`shrink-0 w-8 h-8 rounded-full flex items-center justify-center transition-colors ${
                      done
                        ? 'bg-[#7DB00E] text-white'
                        : active
                        ? 'bg-[#7DB00E]/15 text-[#5a8209]'
                        : 'bg-slate-100 text-slate-300'
                    }`}
                    style={done ? { animation: 'hs-pop 0.35s ease-out' } : undefined}
                  >
                    {done ? (
                      <Check className="w-5 h-5" strokeWidth={3} />
                    ) : active ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Icon className="w-4 h-4" />
                    )}
                  </span>
                  <span
                    className={`text-sm font-medium transition-colors ${
                      done ? 'text-slate-900' : active ? 'text-slate-900' : 'text-slate-400'
                    }`}
                  >
                    {step.label}
                  </span>
                </li>
              );
            })}
          </ul>

          {/* Progress bar */}
          <div className="mt-4 h-1.5 rounded-full bg-slate-100 overflow-hidden">
            <div
              className="h-full bg-[#7DB00E] rounded-full transition-all duration-700 ease-out"
              style={{ width: `${Math.min(100, (activeStep / STEPS_TO_USE.length) * 100)}%` }}
            />
          </div>
        </div>

        {/* Social proof strip — Trustpilot/Google style */}
        <div className="mt-6 flex items-center justify-center gap-2 text-sm hs-prep-rise hs-prep-d3">
          <span className="font-bold text-slate-900">Excellent</span>
          <span className="flex items-center gap-0.5">
            {[0, 1, 2, 3, 4].map((i) => (
              <Star key={i} className="w-4 h-4 text-[#00b67a] fill-[#00b67a]" />
            ))}
          </span>
          <span className="text-slate-500">
            {rating} · 300+ reviews
          </span>
        </div>

        {/* Trust line */}
        <div className="mt-5 flex items-center justify-center gap-x-3 gap-y-2 flex-wrap text-xs text-slate-600 font-medium hs-prep-rise hs-prep-d4">
          <span className="inline-flex items-center gap-1">
            <ShieldCheck className="w-3.5 h-3.5 text-[#7DB00E]" /> £2M Insured
          </span>
          <span className="text-slate-300">·</span>
          <span className="inline-flex items-center gap-1">
            <Check className="w-3.5 h-3.5 text-[#7DB00E]" strokeWidth={3} /> DBS Checked
          </span>
          <span className="text-slate-300">·</span>
          <span className="inline-flex items-center gap-1">{jobs} jobs completed</span>
        </div>
      </div>
    </div>
  );
}
