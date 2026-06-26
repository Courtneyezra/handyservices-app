import { useEffect, useRef, useState } from 'react';
import { Check, Loader2, ShieldCheck, Star, Wrench, MapPin, Lock, Sparkles } from 'lucide-react';
import handyLogo from '@/assets/handy-logo-transparent.png';

/**
 * Admiral-style branded "preparing your quote" waiting screen — step 1 of the
 * 3-step ?v=offer test flow (waiting → irresistible offer → quote).
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
  { icon: Wrench, label: 'Matching a vetted specialist' },
  { icon: MapPin, label: 'Checking availability near you' },
  { icon: Lock, label: 'Locking in your fixed price' },
  { icon: Sparkles, label: 'Personalising your quote' },
];

const STEP_MS = 1050; // per-step dwell; ~4.2s total across 4 steps

interface QuotePreparingScreenProps {
  /** Underlying quote data + above-the-fold assets are ready. Gates completion. */
  ready: boolean;
  /** Fired once the checklist finished AND `ready` is true. Called at most once. */
  onComplete: () => void;
  pricingSettings?: {
    googleRating?: string;
    reviewCount?: number;
    jobsCompleted?: string;
  } | null;
}

export function QuotePreparingScreen({ ready, onComplete, pricingSettings }: QuotePreparingScreenProps) {
  // activeStep = the index currently "in progress". Steps below it are done.
  // When it reaches STEPS.length the checklist animation is complete.
  const [activeStep, setActiveStep] = useState(0);
  const completedRef = useRef(false);

  // Advance one step per STEP_MS until all steps are done.
  useEffect(() => {
    if (activeStep >= STEPS.length) return;
    const t = setTimeout(() => setActiveStep((s) => s + 1), STEP_MS);
    return () => clearTimeout(t);
  }, [activeStep]);

  // Fire onComplete once the animation finished AND data/assets are ready.
  useEffect(() => {
    if (completedRef.current) return;
    if (activeStep >= STEPS.length && ready) {
      completedRef.current = true;
      const t = setTimeout(onComplete, 450); // brief beat on the final tick
      return () => clearTimeout(t);
    }
  }, [activeStep, ready, onComplete]);

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

      {/* Brand wordmark */}
      <div className="flex items-center gap-2 mb-8 hs-prep-rise hs-prep-d0">
        <img src={handyLogo} alt="HandyServices" className="w-9 h-9 object-contain" />
        <span className="text-xl font-extrabold tracking-tight text-slate-900">
          Handy<span className="text-[#7DB00E]">Services</span>
        </span>
      </div>

      <div className="w-full max-w-md">
        {/* Headline */}
        <div className="text-center mb-7 hs-prep-rise hs-prep-d1">
          <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight">
            Building your quote.
          </h1>
          <p className="text-slate-500 mt-2 text-sm">
            Putting your fixed price together — one moment.
          </p>
        </div>

        {/* Progress checklist card */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-lg p-5 sm:p-6 hs-prep-rise hs-prep-d2">
          <ul className="space-y-1">
            {STEPS.map((step, i) => {
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
              style={{ width: `${Math.min(100, (activeStep / STEPS.length) * 100)}%` }}
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
