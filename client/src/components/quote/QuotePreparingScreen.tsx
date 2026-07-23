import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Check, Loader2, ShieldCheck, Star, Wrench } from 'lucide-react';
import handyLogo from '@/assets/handy-logo-transparent.png';

/**
 * "Preparing your quote" waiting screen — stage 1 of the TWO-stage journey
 * (loading → offer; the offer IS the reveal). Redesigned 23 Jul from a
 * checklist+reveal sequence to ONE continuous visual:
 *
 *   Ben (the estimator the customer just spoke to) sits centre with his
 *   contractor pool ORBITING him — "Ben's checking who's free near NG7…" —
 *   then the orbit resolves onto the ONE chosen for this quote (the skin).
 *   The chosen face holds centre, then the offer screen opens led by the
 *   SAME face in the same position: a match cut, not a scene change.
 *
 * HONESTY RULE: the link arrives after Ben built the quote, so every line
 * must be true at open time — availability IS resolved live at page open,
 * and the skin was genuinely chosen for this quote at generation.
 *
 * The old checklist UI survives ONLY for custom-step callers (the visit
 * flow passes its own `steps`); the default quote flow renders the orbit.
 */

export interface MatchedHandyman {
  name: string;
  avatarUrl: string;
  role?: string;
  rating?: string;
  jobsLabel?: string;
}
const DEFAULT_MATCH: MatchedHandyman[] = [
  { name: 'Craig', avatarUrl: '/assets/avatars/craig-avatar-1.webp', role: 'Your Nottingham handyman', rating: '4.9', jobsLabel: '214 jobs' },
];

// ── Pacing ────────────────────────────────────────────────────────────────
// Two beats only. Cadence learning from the checklist era: felt speed is the
// interval between information-bearing changes, so fewer/longer beats read
// calmer than many quick ones. The theatre plays once per customer.
const ORBIT_MS = 3600;   // Ben consulting the pool (the only "working" beat)
// The chosen face holds centred for this long, then — when an offerNode is
// provided — the header slides up IN PLACE and the offer rises in beneath it
// on this same screen (no separate offer page). Without an offerNode (paid /
// non-offer quotes) the resolve completes to the quote as before.
const RESOLVE_MS = 1500;
const STEP_MS = 900;     // custom-steps (visit flow) checklist dwell fallback

// The orbiting pool: real contractor avatars plus honest initials from the
// actual roster (Joe, Alex, Kane — real handyman_profiles rows). The chosen
// skin's avatar is injected as a satellite so the resolve picks it "out of"
// the orbit rather than conjuring a stranger.
const POOL_AVATARS = [
  '/assets/avatars/craig-avatar-1.webp',
  '/assets/avatars/bezent-avatar-1.webp',
];
const POOL_INITIALS = ['J', 'A', 'K'];

interface QuotePreparingScreenProps {
  /** Underlying quote data + above-the-fold assets are ready. Gates completion. */
  ready: boolean;
  /** Fired once the theatre finished AND `ready` is true. Called at most once. */
  onComplete: () => void;
  customerName?: string;
  pricingSettings?: {
    googleRating?: string;
    reviewCount?: number;
    jobsCompleted?: string;
  } | null;
  /** Sub-headline under the greeting. Defaults to the orbit copy. */
  subcopy?: string;
  /** Custom checklist steps (visit flow) — renders the legacy checklist UI
   *  instead of the orbit. Per-step `dwellMs` overrides STEP_MS. */
  steps?: { icon: typeof Wrench; label: string; dwellMs?: number }[];
  /** The matched handyman(s) — the skin the orbit resolves onto. */
  matchedHandymen?: MatchedHandyman[];
  /** Customer postcode — personalises the orbit copy ("near NG5"). */
  postcode?: string;
  /** Returning/paid visitors: skip the theatre, complete as soon as ready. */
  instant?: boolean;
  /** DESIGN/DEMO ONLY (?theatre=checklist|reveal): freeze a beat forever.
   *  'checklist' holds the ORBIT, 'reveal' holds the RESOLVE. */
  holdBeat?: 'checklist' | 'reveal';
  /**
   * The offer body to show ON THIS SCREEN after the resolve: the header
   * (avatar + "{Skin}'s got your job") slides up and this node rises in
   * beneath it — one page, no separate offer stage. When set, onComplete is
   * NOT called; the node's own accept/decline handlers advance the flow.
   */
  offerNode?: ReactNode;
  /** Fired once when the in-stage offer becomes visible (impression tracking). */
  onOfferShown?: () => void;
}

export function QuotePreparingScreen(props: QuotePreparingScreenProps) {
  // Custom steps = the visit flow's checklist loader; default = the orbit.
  // Split into two components so each keeps an unconditional hook order.
  return props.steps ? <ChecklistLoader {...props} /> : <OrbitLoader {...props} />;
}

// ═══════════════════════════════════════════════════════════════════════════
// Orbit loader — the default quote flow
// ═══════════════════════════════════════════════════════════════════════════

function OrbitLoader({ ready, onComplete, customerName, pricingSettings, subcopy, matchedHandymen, postcode, instant = false, holdBeat, offerNode, onOfferShown }: QuotePreparingScreenProps) {
  const firstName = customerName?.trim().split(/\s+/)[0] ?? '';
  const matched = (matchedHandymen && matchedHandymen.length > 0) ? matchedHandymen : DEFAULT_MATCH;
  const chosen = matched[0];
  const skinFirstName = chosen.name.split(/\s+/)[0];
  const outwardPostcode = postcode?.trim().split(/\s+/)[0]?.toUpperCase();

  const reduceMotion =
    typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

  // ── Beat machine: orbit → resolve → (offer in place | complete) ─────────
  const [resolved, setResolved] = useState(instant);
  const [resolveDone, setResolveDone] = useState(instant);
  const [offerShown, setOfferShown] = useState(false);
  const completedRef = useRef(false);
  const hasOffer = !!offerNode && !instant;

  // FLIP handoff: the letterhead's small avatar FLIES from where the big
  // centred avatar sat (measured just before the state flip) — a real
  // continuous shrink-and-slide, not a fade-out/fade-in that reads as the
  // reveal "disappearing".
  const bigAvatarRef = useRef<HTMLDivElement>(null);
  const lhAvatarRef = useRef<HTMLDivElement>(null);
  const flipFromRef = useRef<DOMRect | null>(null);

  // Orbit → resolve after ORBIT_MS ('checklist' hold freezes the orbit).
  useEffect(() => {
    if (resolved || instant || holdBeat === 'checklist') return;
    const t = setTimeout(() => setResolved(true), ORBIT_MS);
    return () => clearTimeout(t);
  }, [resolved, instant, holdBeat]);

  // With an in-stage offer: after the centred hold, slide the header up and
  // reveal the offer HERE. No onComplete — accept/decline advance the flow.
  useEffect(() => {
    if (!hasOffer || !resolved || offerShown || holdBeat === 'reveal') return;
    const t = setTimeout(() => {
      // FIRST: capture where the big avatar sits, so the letterhead avatar
      // can fly from that exact spot after the layout flips.
      flipFromRef.current = bigAvatarRef.current?.getBoundingClientRect() ?? null;
      setOfferShown(true);
      onOfferShown?.();
    }, RESOLVE_MS);
    return () => clearTimeout(t);
  }, [hasOffer, resolved, offerShown, holdBeat, onOfferShown]);

  // LAST + INVERT + PLAY: after the offer layout paints, transform the small
  // letterhead avatar back onto the big avatar's old rect, then release.
  useLayoutEffect(() => {
    if (!offerShown || reduceMotion) return;
    const from = flipFromRef.current;
    const el = lhAvatarRef.current;
    if (!from || !el) return;
    const to = el.getBoundingClientRect();
    if (!to.width) return;
    const dx = from.left - to.left;
    const dy = from.top - to.top;
    const s = from.width / to.width;
    el.style.transition = 'none';
    el.style.transformOrigin = 'top left';
    el.style.transform = `translate(${dx}px, ${dy}px) scale(${s})`;
    // Force a reflow so the inverted position paints before we release it.
    void el.getBoundingClientRect();
    requestAnimationFrame(() => {
      el.style.transition = 'transform 650ms cubic-bezier(0.23, 1, 0.32, 1)';
      el.style.transform = 'none';
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [offerShown]);

  // Without an offer: resolve holds RESOLVE_MS, then releases completion.
  useEffect(() => {
    if (hasOffer || !resolved || resolveDone || instant || holdBeat === 'reveal') return;
    const t = setTimeout(() => setResolveDone(true), RESOLVE_MS);
    return () => clearTimeout(t);
  }, [hasOffer, resolved, resolveDone, instant, holdBeat]);

  // Complete once the theatre is done AND data is ready (no-offer path only).
  useEffect(() => {
    if (completedRef.current || holdBeat || hasOffer) return;
    if (resolved && resolveDone && ready) {
      completedRef.current = true;
      const t = setTimeout(onComplete, instant ? 120 : 500);
      return () => clearTimeout(t);
    }
  }, [resolved, resolveDone, ready, onComplete, instant, holdBeat, hasOffer]);

  // Failsafe: never wait on `ready` forever once the theatre has finished.
  useEffect(() => {
    if (completedRef.current || instant || holdBeat || hasOffer) return;
    if (!(resolved && resolveDone)) return;
    const t = setTimeout(() => {
      if (!completedRef.current) { completedRef.current = true; onComplete(); }
    }, 3000);
    return () => clearTimeout(t);
  }, [resolved, resolveDone, instant, onComplete, holdBeat, hasOffer]);

  const rating = pricingSettings?.googleRating ?? '4.9';
  const jobs = pricingSettings?.jobsCompleted ?? '500+';

  // Satellites: the chosen skin + the rest of the pool (no duplicate of the
  // chosen face), padded with roster initials to 5 orbiters.
  const satelliteAvatars = [
    chosen.avatarUrl,
    ...POOL_AVATARS.filter((a) => a !== chosen.avatarUrl),
  ];
  const satellites: { key: string; avatarUrl?: string; initial?: string }[] = [
    ...satelliteAvatars.map((a, i) => ({ key: `av-${i}`, avatarUrl: a })),
    ...POOL_INITIALS.slice(0, Math.max(0, 5 - satelliteAvatars.length)).map((c) => ({ key: `in-${c}`, initial: c })),
  ].slice(0, 5);

  const RADIUS = 104;

  return (
    <div className="min-h-screen bg-[#1D2D3D] font-sans text-white flex flex-col">
      <style>{`
        @keyframes hs-prep-rise { 0% { transform: translateY(14px); opacity: 0; } 100% { transform: translateY(0); opacity: 1; } }
        .hs-prep-rise { animation: hs-prep-rise .55s cubic-bezier(.23,1,.32,1) both; }
        .hs-prep-d1 { animation-delay: .08s; }
        .hs-prep-d2 { animation-delay: .16s; }
        @keyframes hs-pop { 0% { transform: scale(0.6); opacity: 0; } 60% { transform: scale(1.08); } 100% { transform: scale(1); opacity: 1; } }
        @keyframes hs-orbit-spin { to { transform: rotate(360deg); } }
        @keyframes hs-orbit-unspin { to { transform: rotate(-360deg); } }
        .hs-orbit-spin { animation: hs-orbit-spin 16s linear infinite; }
        .hs-orbit-unspin { animation: hs-orbit-unspin 16s linear infinite; }
      `}</style>

      {/* Wordmark */}
      <div className="flex items-center justify-center gap-2 pt-7 hs-prep-rise">
        <img src={handyLogo} alt="" className="w-7 h-7 object-contain" />
        <span className="text-base font-extrabold tracking-tight">
          Handy<span className="text-[#7DB00E]">Services</span>
        </span>
      </div>

      {/* Centre stage — the orbit, resolving onto the chosen handyman. When an
          in-stage offer follows, the top spacer + stage COLLAPSE so the whole
          header slides up in place while the offer rises in beneath it. */}
      <div className="flex-1 flex flex-col items-center px-4 text-center w-full">
        <div
          className="shrink-0 transition-[height] duration-700 ease-[cubic-bezier(0.23,1,0.32,1)]"
          style={{ height: offerShown ? 6 : '9vh' }}
        />
        <div
          className="relative shrink-0 hs-prep-rise hs-prep-d1 transition-all duration-500 ease-[cubic-bezier(0.23,1,0.32,1)] overflow-hidden"
          style={{ width: 264, height: offerShown ? 0 : 264, opacity: offerShown ? 0 : 1 }}
        >
          {/* orbit ring guide */}
          <div
            className={`absolute rounded-full border border-dashed border-white/15 transition-opacity duration-500 ${resolved ? 'opacity-0' : 'opacity-100'}`}
            style={{ inset: 28 }}
          />

          {/* Ben — centre while consulting; bows out on resolve */}
          <div className={`absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-10 transition-all duration-500 ${resolved ? 'opacity-0 scale-75' : 'opacity-100 scale-100'}`}>
            <div className="relative">
              <div className="w-20 h-20 rounded-full overflow-hidden border-2 border-[#7DB00E] shadow-lg">
                <img src="/assets/quote-images/ben-estimator.webp" alt="Ben" className="w-full h-full object-cover" />
              </div>
              <span className="absolute bottom-0.5 right-0.5 w-3.5 h-3.5 rounded-full bg-[#7DB00E] ring-2 ring-[#1D2D3D]" aria-hidden="true" />
            </div>
          </div>

          {/* The pool — orbiting Ben (static ring under reduced motion) */}
          <div className={`absolute inset-0 transition-opacity duration-500 ${resolved ? 'opacity-0' : 'opacity-100'} ${reduceMotion ? '' : 'hs-orbit-spin'}`}>
            {satellites.map((s, i) => {
              const angle = Math.round((360 / satellites.length) * i) - 90;
              return (
                <div
                  key={s.key}
                  className="absolute left-1/2 top-1/2 w-11 h-11 -ml-[22px] -mt-[22px]"
                  style={{ transform: `rotate(${angle}deg) translateX(${RADIUS}px)` }}
                >
                  <div style={{ transform: `rotate(${-angle}deg)` }} className="w-full h-full">
                    <div className={`w-full h-full ${reduceMotion ? '' : 'hs-orbit-unspin'}`}>
                      {s.avatarUrl ? (
                        <div className="w-11 h-11 rounded-full overflow-hidden border-2 border-white/70 shadow-md bg-white/10">
                          <img src={s.avatarUrl} alt="" className="w-full h-full object-cover" />
                        </div>
                      ) : (
                        <div className="w-11 h-11 rounded-full border-2 border-white/40 bg-white/10 flex items-center justify-center text-sm font-bold text-white/80 shadow-md">
                          {s.initial}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* The chosen — resolves centre, out of the orbit. Centering translate
              lives on the OUTER div: the pop keyframes animate `transform`
              and would override it (off-centre bug) if on the same element.
              The middle layer scales it down as the stage collapses into a
              header when the in-stage offer arrives. */}
          {resolved && (
            <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-20">
              {/* Hidden INSTANTLY at offerShown — its letterhead twin FLIPs
                  from this exact rect, so a fading ghost here would double. */}
              <div style={{ opacity: offerShown ? 0 : 1 }}>
              <div className="relative" style={{ animation: 'hs-pop .5s cubic-bezier(.23,1,.32,1) both' }}>
                <div ref={bigAvatarRef} className="w-32 h-32 rounded-full overflow-hidden border-4 border-[#7DB00E] shadow-2xl">
                  <img src={chosen.avatarUrl} alt={chosen.name} className="w-full h-full object-cover" />
                </div>
                <span className="absolute top-0 right-0 w-8 h-8 rounded-full bg-[#7DB00E] flex items-center justify-center ring-4 ring-[#1D2D3D]" style={{ animation: 'hs-pop .45s ease-out .3s both' }}>
                  <Check className="w-4.5 h-4.5 text-white" strokeWidth={3.5} />
                </span>
              </div>
              </div>
            </div>
          )}
        </div>

        {/* Copy under the stage — collapses when the offer arrives (a compact
            letterhead row takes over as the header; two stacked same-weight
            headlines had no hierarchy) */}
        <div
          className="max-w-md transition-all duration-500 ease-[cubic-bezier(0.23,1,0.32,1)] overflow-hidden"
          style={{ marginTop: offerShown ? 0 : 24, maxHeight: offerShown ? 0 : 220, opacity: offerShown ? 0 : 1 }}
        >
          {resolved ? (
            <div style={{ animation: 'hs-prep-rise .5s cubic-bezier(.23,1,.32,1) both' }}>
              <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-[#a3d65f]">
                {matched.length > 1 ? 'Your team' : 'Your handyman'}
              </p>
              <h1 className="mt-1 text-2xl sm:text-3xl font-extrabold tracking-tight">
                {matched.length > 1
                  ? `Your team's on the job${firstName ? `, ${firstName}` : ''}`
                  : `${skinFirstName}'s got your job${firstName ? `, ${firstName}` : ''}`}
              </h1>
              {(chosen.rating || chosen.jobsLabel) && (
                <p className="mt-1.5 text-sm text-slate-300 inline-flex items-center gap-1.5">
                  {chosen.rating && (
                    <span className="inline-flex items-center gap-1">
                      <Star className="w-4 h-4 text-amber-400 fill-amber-400" />
                      <b className="text-white">{chosen.rating}</b>
                    </span>
                  )}
                  {chosen.rating && chosen.jobsLabel && <span className="text-slate-500">·</span>}
                  {chosen.jobsLabel && <span>{chosen.jobsLabel} completed</span>}
                </p>
              )}
            </div>
          ) : (
            <div>
              <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight hs-prep-rise hs-prep-d1">
                {firstName ? `One moment, ${firstName}.` : 'One moment.'}
              </h1>
              <p className="text-slate-300 mt-2 text-sm hs-prep-rise hs-prep-d2">
                {subcopy ?? `Ben's checking who's free${outwardPostcode ? ` near ${outwardPostcode}` : ' near you'}…`}
              </p>
            </div>
          )}
        </div>

        {/* Letterhead row — the demoted header once the offer takes the stage:
            avatar tucks in left, name + rating in one compact left-aligned
            lockup (the post-pay letterhead grammar). Leaves the offer headline
            as the page's ONE big statement. */}
        {hasOffer && (
          <div
            className="w-full max-w-md transition-[max-height] duration-500 ease-[cubic-bezier(0.23,1,0.32,1)]"
            style={offerShown
              ? { maxHeight: 104 }
              : { maxHeight: 0, overflow: 'hidden', opacity: 0 }}
          >
            {/* pt gives the check badge (-top offset) headroom. NO overflow
                clipping while visible — the avatar FLIPs in from the old big
                position and must be free to travel outside this row. */}
            <div className="flex items-center gap-3 text-left pt-1.5 pb-3 border-b border-white/10 mb-1">
              <div ref={lhAvatarRef} className="relative shrink-0 z-30">
                <div className="w-11 h-11 rounded-full overflow-hidden border-2 border-[#7DB00E]">
                  <img src={chosen.avatarUrl} alt={chosen.name} className="w-full h-full object-cover" />
                </div>
                <span className="absolute -top-0.5 -right-0.5 w-4 h-4 rounded-full bg-[#7DB00E] flex items-center justify-center ring-2 ring-[#1D2D3D]">
                  <Check className="w-2.5 h-2.5 text-white" strokeWidth={4} />
                </span>
              </div>
              <div
                className="min-w-0 leading-tight transition-opacity duration-400"
                style={{ opacity: offerShown ? 1 : 0, transitionDelay: offerShown ? '250ms' : '0ms' }}
              >
                <div className="text-[15px] font-extrabold text-white truncate">
                  {matched.length > 1
                    ? `Your team's on the job${firstName ? `, ${firstName}` : ''}`
                    : `${skinFirstName}'s got your job${firstName ? `, ${firstName}` : ''}`}
                </div>
                <div className="mt-0.5 text-[12px] text-slate-300 inline-flex items-center gap-1">
                  <Star className="w-3 h-3 text-amber-400 fill-amber-400" />
                  <b className="text-white">{chosen.rating ?? '4.9'}</b>
                  <span className="text-slate-500">·</span>
                  <span>{chosen.jobsLabel ?? '214 jobs'} completed</span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* The offer — rises in beneath the slid-up header, on THIS page */}
        {offerNode && (
          <div
            className="w-full max-w-md overflow-hidden transition-all duration-500 ease-[cubic-bezier(0.23,1,0.32,1)] pb-6"
            style={offerShown
              ? { opacity: 1, transform: 'none', maxHeight: 1500, transitionDelay: '250ms', marginTop: 10 }
              : { opacity: 0, transform: 'translateY(28px)', maxHeight: 0, marginTop: 0, paddingBottom: 0, pointerEvents: 'none' }}
          >
            {offerNode}
          </div>
        )}
      </div>

      {/* Trust strip — bows out when the offer arrives (its fine print carries
          the same reassurance) */}
      <div
        className="pb-8 px-4 text-center hs-prep-rise hs-prep-d2 overflow-hidden transition-all duration-500"
        style={offerShown ? { opacity: 0, maxHeight: 0, paddingBottom: 0 } : { opacity: 1, maxHeight: 200 }}
      >
        <div className="flex items-center justify-center gap-2 text-sm">
          <span className="font-bold">Excellent</span>
          <span className="flex items-center gap-0.5" aria-label={`Rated ${rating} out of 5`}>
            {[0, 1, 2, 3, 4].map((i) => (
              <Star key={i} className="w-4 h-4 fill-[#7DB00E] text-[#7DB00E]" />
            ))}
          </span>
          <span className="text-slate-300">{rating} · 300+ reviews</span>
        </div>
        <div className="mt-2.5 flex items-center justify-center gap-x-3 gap-y-1 flex-wrap text-xs text-slate-400 font-medium">
          <span className="inline-flex items-center gap-1">
            <ShieldCheck className="w-3.5 h-3.5 text-[#7DB00E]" /> £2M Insured
          </span>
          <span className="text-slate-600">·</span>
          <span className="inline-flex items-center gap-1">
            <Check className="w-3.5 h-3.5 text-[#7DB00E]" strokeWidth={3} /> DBS Checked
          </span>
          <span className="text-slate-600">·</span>
          <span>{jobs} jobs completed</span>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Checklist loader — custom-steps callers only (the diagnostic-visit flow)
// ═══════════════════════════════════════════════════════════════════════════

function ChecklistLoader({ ready, onComplete, customerName, pricingSettings, subcopy, steps, instant = false }: QuotePreparingScreenProps) {
  const STEPS_TO_USE = steps ?? [];
  const firstName = customerName?.trim().split(/\s+/)[0] ?? '';
  const [activeStep, setActiveStep] = useState(instant ? STEPS_TO_USE.length : 0);
  const completedRef = useRef(false);

  useEffect(() => {
    if (activeStep >= STEPS_TO_USE.length) return;
    if (instant) {
      setActiveStep(STEPS_TO_USE.length);
      return;
    }
    const t = setTimeout(() => setActiveStep((s) => s + 1), STEPS_TO_USE[activeStep]?.dwellMs ?? STEP_MS);
    return () => clearTimeout(t);
  }, [activeStep, STEPS_TO_USE.length, instant]);

  useEffect(() => {
    if (completedRef.current) return;
    if (activeStep >= STEPS_TO_USE.length && ready) {
      completedRef.current = true;
      const t = setTimeout(onComplete, instant ? 120 : 350);
      return () => clearTimeout(t);
    }
  }, [activeStep, ready, onComplete, instant, STEPS_TO_USE.length]);

  useEffect(() => {
    if (completedRef.current || instant) return;
    if (activeStep < STEPS_TO_USE.length) return;
    const t = setTimeout(() => {
      if (!completedRef.current) { completedRef.current = true; onComplete(); }
    }, 3000);
    return () => clearTimeout(t);
  }, [activeStep, instant, onComplete, STEPS_TO_USE.length]);

  const rating = pricingSettings?.googleRating ?? '4.9';
  const jobs = pricingSettings?.jobsCompleted ?? '500+';

  return (
    <div className="min-h-screen bg-slate-50 font-sans text-slate-900 flex flex-col">
      <style>{`
        @keyframes hs-bar { 0% { width: 0%; } 100% { width: 100%; } }
        @keyframes hs-prep-rise { 0% { transform: translateY(14px); opacity: 0; } 100% { transform: translateY(0); opacity: 1; } }
        .hs-prep-rise { animation: hs-prep-rise .55s cubic-bezier(.23,1,.32,1) both; }
        .hs-prep-d1 { animation-delay: .08s; }
        .hs-prep-d2 { animation-delay: .16s; }
        .hs-prep-d3 { animation-delay: .24s; }
        .hs-prep-d4 { animation-delay: .32s; }
      `}</style>

      <div className="bg-[#1D2D3D] pt-7 pb-24 px-4">
        <div className="w-full max-w-md mx-auto flex flex-col items-center text-center">
          <div className="flex items-center gap-2 mb-7 hs-prep-rise">
            <img src={handyLogo} alt="" className="w-7 h-7 object-contain" />
            <span className="text-base font-extrabold tracking-tight text-white">
              Handy<span className="text-[#7DB00E]">Services</span>
            </span>
          </div>
          <div className="relative hs-prep-rise hs-prep-d1">
            <div className="w-16 h-16 rounded-full overflow-hidden border-2 border-[#7DB00E] shadow-lg">
              <img src="/assets/quote-images/ben-estimator.webp" alt="Ben" className="w-full h-full object-cover" />
            </div>
            <span className="absolute bottom-0.5 right-0.5 w-3.5 h-3.5 rounded-full bg-[#7DB00E] ring-2 ring-[#1D2D3D]" aria-hidden="true" />
          </div>
          <h1 className="mt-4 text-2xl sm:text-3xl font-extrabold text-white tracking-tight">
            {firstName ? `One moment, ${firstName}.` : 'One moment.'}
          </h1>
          <p className="text-slate-300 mt-2 text-sm">
            {subcopy ?? 'Ben is putting things together…'}
          </p>
        </div>
      </div>

      <div className="relative z-10 -mt-16 px-4 pb-10 flex-1">
        <div className="w-full max-w-md mx-auto">
          <div className="bg-white rounded-2xl shadow-2xl p-5 sm:p-6 hs-prep-rise hs-prep-d2">
            <ul className="space-y-1">
              {STEPS_TO_USE.map((step, i) => {
                const isDone = i < activeStep;
                const isActive = i === activeStep;
                const Icon = step.icon;
                return (
                  <li
                    key={step.label}
                    className={`flex items-center gap-3 rounded-xl px-2.5 py-2.5 transition-colors duration-300 ${isActive ? 'bg-[#7DB00E]/[0.08]' : ''}`}
                  >
                    <span
                      className={`shrink-0 w-8 h-8 rounded-full flex items-center justify-center transition-colors duration-300 ${
                        isDone ? 'bg-[#7DB00E] text-white' : isActive ? 'bg-[#7DB00E]/15 text-[#5a8209]' : 'bg-slate-100 text-slate-400'
                      }`}
                    >
                      {isDone ? (
                        <Check className="w-4.5 h-4.5" strokeWidth={3} />
                      ) : isActive ? (
                        <Loader2 className="w-4.5 h-4.5 animate-spin" />
                      ) : (
                        <Icon className="w-4 h-4" />
                      )}
                    </span>
                    <span className={`text-[15px] font-semibold transition-colors duration-300 ${isDone || isActive ? 'text-slate-900' : 'text-slate-400'}`}>
                      {step.label}
                    </span>
                  </li>
                );
              })}
            </ul>
            <div className="mt-4 h-1.5 rounded-full bg-slate-100 overflow-hidden">
              <div
                className="h-full rounded-full bg-[#7DB00E] transition-all duration-500"
                style={{ width: `${Math.min(100, (activeStep / Math.max(1, STEPS_TO_USE.length)) * 100)}%` }}
              />
            </div>
          </div>

          <div className="mt-6 flex items-center justify-center gap-2 text-sm hs-prep-rise hs-prep-d3">
            <span className="font-bold text-slate-900">Excellent</span>
            <span className="flex items-center gap-0.5" aria-label={`Rated ${rating} out of 5`}>
              {[0, 1, 2, 3, 4].map((i) => (
                <Star key={i} className="w-4 h-4 fill-[#00b67a] text-[#00b67a]" />
              ))}
            </span>
            <span className="text-slate-500">{rating} · 300+ reviews</span>
          </div>

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
    </div>
  );
}
