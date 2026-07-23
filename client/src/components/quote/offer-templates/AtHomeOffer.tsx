import { Check, ArrowRight, Star } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import handyLogo from '@/assets/handy-logo-transparent.png';
import { HS_GREEN_DARK, HS_NAVY, firstNameOf, type OfferTemplateProps } from './types';

/**
 * 'at_home' template — the HOMEOWNER flex-save offer, rendered ON the same
 * navy stage as the loading orbit so the whole journey reads as ONE page:
 * the orbit resolves onto the chosen face, this template opens with that
 * exact composition (avatar + "{Skin}'s got your job" centred, identical
 * sizes/colors), then SLIDES it up into header position while the offer
 * body rises in beneath. No separate offer page.
 *
 * Anchor-free by design: it may show the {savings} amount (the cash kept by
 * staying flexible) but never the base/firm TOTALS, so it sharpens the
 * flexibility CHOICE without anchoring the price before the quote page.
 *
 * The headline underline lands on the span wrapped in *asterisks* (e.g.
 * "Let us pick the day — *you save {savings}*."); the {savings} token resolves
 * to the cash saving, but {firm}/{base} totals are intentionally not used here.
 */

const GREEN_INK = '#3f5e06';
/** navy at an alpha — mirrors the mockup's text-navy/NN opacities. */
const navy = (a: number) => `rgba(15,23,42,${a})`;

// Hand-drawn underline as an inline SVG data URI (brand green stroke).
const HAND_UNDERLINE =
  "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='120' height='12' viewBox='0 0 120 12'><path d='M2 8 C 30 2, 70 2, 118 7' stroke='%237DB00E' stroke-width='4' fill='none' stroke-linecap='round'/></svg>\")";

/**
 * Dark route map — the reason-why played as a story ON the navy page:
 *
 *   1. The map appears with Bezent's day ALREADY PLANNED — route drawn, jobs
 *      pinned, the van mid-route. A world in motion, not a diagram building.
 *   2. "Your job" DROPS IN from above onto the plan…
 *   3. …and the route BENDS to adopt it: the old line fades as the re-threaded
 *      line takes over, with a brief bright highlight on the new segment.
 *   4. The van keeps looping (now through your pin); your pin keeps a soft
 *      persistent pulse.
 *
 * Flexible days = a packed, efficient route = the saving. The insertion story
 * plays ONCE, gated on actual visibility (IntersectionObserver) because the
 * body mounts hidden inside the loading stage before it's revealed. Reduced
 * motion renders the settled state (adopted route, pin in place, van parked).
 */
function DarkRouteMap({ compact = false }: { compact?: boolean }) {
  const reduceMotion =
    typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const [started, setStarted] = useState(reduceMotion);
  const [dropped, setDropped] = useState(reduceMotion);
  const [adopted, setAdopted] = useState(reduceMotion);
  const rootRef = useRef<HTMLDivElement>(null);

  // Start the timeline only when the map is genuinely on screen.
  useEffect(() => {
    if (reduceMotion || started) return;
    const el = rootRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') {
      setStarted(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setStarted(true);
          io.disconnect();
        }
      },
      { threshold: 0.3 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [reduceMotion, started]);

  useEffect(() => {
    if (!started || reduceMotion) return;
    const t1 = setTimeout(() => setDropped(true), 1300);  // the plan registers first
    const t2 = setTimeout(() => setAdopted(true), 1850);  // then the route adopts it
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, [started, reduceMotion]);

  // Same waypoints except the segment around the customer's job: the PLANNED
  // route passes below the spot; the ADOPTED route threads up through it.
  const routePlanned = 'M14,64 C48,46 66,38 84,38 C120,38 128,56 152,56 C190,56 214,52 240,52 C266,52 292,46 318,40 C332,37 342,42 346,44';
  const routeAdopted = 'M14,64 C48,46 66,38 84,38 C120,38 128,56 152,56 C186,56 216,26 240,26 C264,26 292,44 318,40 C332,38 342,42 346,44';
  const highlightSeg = 'M152,56 C186,56 216,26 240,26 C264,26 292,44 318,40';

  const van = (
    // Scaled up so the brand mark on the body panel actually reads.
    <g transform="scale(2)">
      {/* light body so it reads on navy; brand-green stripe */}
      <rect x="-11" y="-14" width="16" height="9" rx="2" fill="#EDF2F7" />
      <path d="M5,-14 L9,-14 Q11,-14 11,-11.5 L11,-5 L5,-5 Z" fill="#EDF2F7" />
      <rect x="-11" y="-8.4" width="22" height="1.8" fill="#7DB00E" />
      {/* Handy Services mark — dead centre of the cargo body panel (panel
          spans x -11..5, roof to stripe y -14..-8.4) */}
      <image href={handyLogo} x="-5.6" y="-13.8" width="5.2" height="5.2" />
      <rect x="6" y="-12.6" width="3.6" height="3.4" rx="0.8" fill="#33475C" />
      <circle cx="-6" cy="-4.6" r="2.3" fill="#0f1922" stroke="#EDF2F7" strokeWidth="0.9" />
      <circle cx="6.5" cy="-4.6" r="2.3" fill="#0f1922" stroke="#EDF2F7" strokeWidth="0.9" />
    </g>
  );

  return (
    <div ref={rootRef} className="relative w-full" aria-hidden="true">
      <style>{`
        @keyframes hs-dm-draw { to { stroke-dashoffset: 0; } }
        @keyframes hs-dm-hifade { to { opacity: 0; } }
        @keyframes hs-dm-ride { from { offset-distance: 0%; } to { offset-distance: 100%; } }
        @keyframes hs-dm-pulse { 0% { r: 6; opacity: .45; } 70% { r: 13; opacity: 0; } 100% { r: 13; opacity: 0; } }
        .hs-dm-van { transform: translate(152px, 56px); }
        @supports (offset-path: path('M0,0 L1,1')) {
          .hs-dm-van {
            transform: none;
            offset-rotate: 0deg;
            animation: hs-dm-ride 9s linear infinite;
          }
        }
      `}</style>
      {/* viewBox starts at y -12: the 2× van's roof reaches ~26px above the
          path at the route's high point — without the headroom it clips flat
          at the top of the map. */}
      <svg viewBox={`0 -12 360 ${compact ? 104 : 112}`} className="w-full h-auto block">
        {/* faint streets, dissolving into the navy page */}
        <g stroke="rgba(255,255,255,0.07)" strokeWidth="1">
          <line x1="0" y1="24" x2="360" y2="24" />
          <line x1="0" y1="48" x2="360" y2="48" />
          <line x1="0" y1="72" x2="360" y2="72" />
          <line x1="60" y1="0" x2="60" y2="92" />
          <line x1="140" y1="0" x2="140" y2="92" />
          <line x1="220" y1="0" x2="220" y2="92" />
          <line x1="300" y1="0" x2="300" y2="92" />
        </g>

        {/* the planned day — fades as the adopted line takes over */}
        <path
          d={routePlanned}
          fill="none" stroke="#7DB00E" strokeWidth="2.2" strokeLinecap="round"
          strokeDasharray="1 7"
          style={{ opacity: adopted ? 0 : 0.85, transition: 'opacity 420ms ease' }}
        />
        {/* the route, re-threaded through your job */}
        <path
          d={routeAdopted}
          fill="none" stroke="#7DB00E" strokeWidth="2.2" strokeLinecap="round"
          strokeDasharray="1 7"
          style={{ opacity: adopted ? 0.9 : 0, transition: 'opacity 420ms ease' }}
        />
        {/* one-shot bright highlight on the adopted segment */}
        {adopted && !reduceMotion && (
          <path
            d={highlightSeg}
            fill="none" stroke="#a3d65f" strokeWidth="2.8" strokeLinecap="round"
            pathLength={1} strokeDasharray="1" strokeDashoffset="1"
            style={{ animation: 'hs-dm-draw .5s ease-out both, hs-dm-hifade .7s ease .9s forwards' }}
          />
        )}

        {/* the day's existing jobs — already pinned when the map appears */}
        {[[84, 38], [152, 56], [318, 40]].map(([x, y]) => (
          <g key={`${x}-${y}`}>
            <circle cx={x} cy={y} r="7" fill="#7DB00E" opacity="0.18" />
            <circle cx={x} cy={y} r="3.4" fill="#7DB00E" stroke="rgba(255,255,255,0.85)" strokeWidth="1.4" />
          </g>
        ))}

        {/* YOUR job — drops into the plan, then pulses softly forever */}
        <g
          style={{
            opacity: dropped ? 1 : 0,
            transform: dropped ? 'none' : 'translateY(-30px)',
            transition: 'opacity .35s ease, transform .5s cubic-bezier(.34,1.56,.64,1)',
          }}
        >
          {adopted && !reduceMotion && (
            <circle cx="240" cy="26" fill="none" stroke="#FFE500" strokeWidth="1.6" style={{ animation: 'hs-dm-pulse 2.4s ease-out .4s infinite' }} />
          )}
          <circle cx="240" cy="26" r="8.5" fill="#FFE500" opacity="0.22" />
          <circle cx="240" cy="26" r="4.4" fill="#FFE500" stroke="#1D2D3D" strokeWidth="1.8" />
          <g transform="translate(240, 9)">
            <rect x="-27" y="-8" width="54" height="14" rx="7" fill="#FFE500" />
            <text x="0" y="2.5" textAnchor="middle" fontSize="8.5" fontWeight="800" fill="#1D2D3D" fontFamily="inherit">Your job</text>
          </g>
        </g>

        {/* the van — already working the route when the map appears; after the
            adoption it follows the re-threaded line (parked under reduced motion) */}
        {reduceMotion ? (
          <g transform="translate(152,56)">{van}</g>
        ) : (
          <g className="hs-dm-van" style={{ offsetPath: `path('${adopted ? routeAdopted : routePlanned}')` }}>{van}</g>
        )}
      </svg>
    </div>
  );
}

/**
 * The offer BODY — eyebrow, headline, route map, benefits, CTAs, fine print —
 * extracted so it can render in TWO hosts:
 *   1. inside the loading stage itself (the orbit resolves, the header slides
 *      up, and this body rises in beneath — ONE page, `compact` sizing so the
 *      CTA fits a phone viewport with the header above), and
 *   2. the standalone AtHomeOffer template below (direct offer entry).
 */
export function AtHomeOfferBody({ offer, render, onAccept, onDecline, firstName = '', compact = false, leftAligned = false }: {
  offer: OfferTemplateProps['offer'];
  render: OfferTemplateProps['render'];
  onAccept: () => void;
  onDecline: () => void;
  firstName?: string;
  compact?: boolean;
  /** Editorial left alignment — shares one left edge with the letterhead row
   *  above it (in-stage host). The standalone template stays centred. */
  leftAligned?: boolean;
}) {
  // Headline emphasis: a *starred* span gets the hand-drawn underline. Tokens
  // inside it are resolved by `render`, so the {savings} amount can sit under
  // the underline — but base/firm TOTALS stay off this screen so the price
  // anchor still lands on the quote page.
  const hl = offer.headline ?? '';
  const m = hl.match(/^([\s\S]*?)\*([\s\S]+?)\*([\s\S]*)$/);
  const hlBefore = render(m ? m[1] : hl);
  const hlEmphasis = m ? render(m[2]) : '';
  const hlAfter = m ? render(m[3]) : '';
  const sh = offer.subhead ?? '';
  const sm = sh.match(/^([\s\S]*?)\*\*([\s\S]+?)\*\*([\s\S]*)$/);
  const shBefore = render(sm ? sm[1] : sh);
  const shBold = sm ? render(sm[2]) : '';
  const shAfter = sm ? render(sm[3]) : '';

  return (
    <div className={leftAligned ? 'text-left' : 'text-center'}>
      <style>{`
        @keyframes hs-ah-rise { 0% { transform: translateY(14px); opacity: 0; } 100% { transform: translateY(0); opacity: 1; } }
        .hs-ah-rise { animation: hs-ah-rise .5s cubic-bezier(.23,1,.32,1) both; }
        .hs-ah-d1 { animation-delay: .06s; }
        .hs-ah-d2 { animation-delay: .12s; }
        .hs-ah-d3 { animation-delay: .18s; }
        .hs-ah-d4 { animation-delay: .24s; }
        .hs-ah-d5 { animation-delay: .30s; }
        .hs-ah-underline { background-image: ${HAND_UNDERLINE}; background-repeat: no-repeat; background-position: bottom left; background-size: 100% 10px; padding-bottom: 6px; white-space: nowrap; }
      `}</style>

      {/* No eyebrow: "{Skin}'s got your job, {name}" directly above already
          does the personal address — a second greeting was noise. */}

      {/* Editorial headline — hand-underlined saving */}
      <h1 className={`font-extrabold tracking-tight hs-ah-rise hs-ah-d1 text-white ${compact ? 'text-[1.6rem] leading-[1.12]' : 'text-[2.05rem] sm:text-[2.4rem] leading-[1.05]'}`}>
        {hlBefore}
        {hlEmphasis && (
          <span className="hs-ah-underline text-[#a3d65f]">{hlEmphasis}</span>
        )}
        {hlAfter}
      </h1>

      {offer.subhead && (
        <p className={`leading-snug hs-ah-rise hs-ah-d2 text-slate-300 ${compact ? 'mt-2 text-[13px]' : 'mt-3 text-[15px]'}`}>
          {shBefore}
          {shBold && <strong className="font-extrabold text-white">{shBold}</strong>}
          {shAfter}
        </p>
      )}

      {/* The reason-why, played on the page itself: Bezent's day is ALREADY
          planned — your job drops in and the route bends to adopt it. */}
      <div className={`hs-ah-rise hs-ah-d2 ${compact ? 'mt-1' : 'mt-3'}`}>
        <DarkRouteMap compact={compact} />
      </div>

      {/* Benefits — pure white checklist card (the map lives above, on navy) */}
      {offer.benefits?.length > 0 && (
        <div className={`bg-white rounded-2xl border border-slate-200 shadow-lg hs-ah-rise hs-ah-d3 ${compact ? 'mt-2 p-3' : 'mt-5 p-4'}`}>
          <ul className={compact ? 'space-y-0' : 'space-y-1'}>
            {offer.benefits.map((b, i) => (
              <li key={i} className={`flex items-center gap-2.5 rounded-xl text-left ${compact ? 'px-1.5 py-1.5' : 'px-2.5 py-2.5'}`}>
                <span className={`shrink-0 rounded-full flex items-center justify-center bg-[#7DB00E] text-white ${compact ? 'w-7 h-7' : 'w-8 h-8'}`}>
                  <Check className={compact ? 'w-4 h-4' : 'w-5 h-5'} strokeWidth={3} />
                </span>
                <span className={`font-medium ${compact ? 'text-[13px] leading-snug' : 'text-[14px]'}`} style={{ color: navy(0.85) }}>{render(b.text)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* CTAs */}
      <div className={`space-y-2 hs-ah-rise hs-ah-d4 ${compact ? 'mt-4' : 'mt-6'}`}>
        <button
          onClick={onAccept}
          className={`w-full inline-flex items-center justify-center gap-2 rounded-full px-6 font-extrabold text-white shadow-lg bg-[#7DB00E] hover:bg-[#6da000] transition-all active:scale-[0.98] whitespace-nowrap ${compact ? 'py-3 text-[15px]' : 'py-4 text-base'}`}
        >
          {render(offer.acceptLabel)}
          <ArrowRight className="w-5 h-5" strokeWidth={2.6} />
        </button>
        <button
          onClick={onDecline}
          className={`w-full text-center font-semibold underline underline-offset-4 text-slate-300 decoration-white/25 ${compact ? 'text-[13px] py-0.5' : 'text-sm py-1'}`}
        >
          {render(offer.declineLabel)}
        </button>
      </div>

      {/* Fine print removed (23 Jul): the decline link already offers the
          exact-day path, the bullets carry the guarantee, and the trust chips
          live on the quote page — the block was noise under the decision. */}
    </div>
  );
}

export function AtHomeOffer({ offer, render, customerName, skin, onAccept, onDecline }: OfferTemplateProps) {
  const firstName = firstNameOf(customerName);
  // Quote skin — same face as the loading reveal + "Meet your handyman".
  const skinName = skin?.name ?? 'Craig';
  const skinAvatarUrl = skin?.avatarUrl ?? '/assets/avatars/craig-avatar-1.webp';
  const skinRating = skin?.rating ?? '4.9';
  const skinJobsLabel = skin?.jobsLabel ?? '214 jobs';
  const skinFirstName = skinName.split(/\s+/)[0];

  // ── Intro continuity — the reveal IS this screen's header ───────────────
  // The loading orbit resolves onto the chosen face; this screen then OPENS
  // with the same composition (avatar + "{Skin}'s got your job" centred) and
  // SLIDES it up into header position while the offer body rises in below —
  // one continuous scene instead of a reveal screen and a separate offer.
  const reduceMotion =
    typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const [settled, setSettled] = useState(reduceMotion);
  useEffect(() => {
    if (reduceMotion) return;
    // Brief centred hold so the handoff frame registers, then slide up.
    const t = setTimeout(() => setSettled(true), 650);
    return () => clearTimeout(t);
  }, [reduceMotion]);

  return (
    <div className="min-h-screen bg-[#1D2D3D] text-white flex flex-col items-center justify-center px-6 py-5 font-sans antialiased">
      {/* Brand wordmark — identical to the loading stage's */}
      <div className="flex items-center gap-2 mb-4">
        <img src={handyLogo} alt="HandyServices" className="w-7 h-7 object-contain" />
        <span className="text-base font-extrabold tracking-tight text-white">
          Handy<span className="text-[#7DB00E]">Services</span>
        </span>
      </div>

      <div className="w-full max-w-md">
        {/* The reveal-as-header — same composition the loading orbit resolved
            onto (avatar + "{Skin}'s got your job" + rating·jobs). Starts
            vertically centred (the handoff frame), then slides up into header
            position as the offer body rises in beneath it. */}
        <div
          className="flex flex-col items-center text-center mb-5 transition-transform duration-700 ease-[cubic-bezier(0.23,1,0.32,1)]"
          style={{ transform: settled ? 'none' : 'translateY(24vh)' }}
        >
          {/* Avatar mirrors the loading resolve EXACTLY (w-32, border-4, check
              badge) so the stage handoff is pixel-invisible; it shrinks as it
              slides up into header scale. */}
          <div
            className="relative transition-transform duration-700 ease-[cubic-bezier(0.23,1,0.32,1)]"
            style={{ transform: settled ? 'scale(0.78)' : 'scale(1)' }}
          >
            <div className="w-32 h-32 rounded-full overflow-hidden border-4 border-[#7DB00E] shadow-2xl">
              <img src={skinAvatarUrl} alt={`${skinName}, your handyman`} className="w-full h-full object-cover" />
            </div>
            <span className="absolute top-0 right-0 w-8 h-8 rounded-full bg-[#7DB00E] flex items-center justify-center ring-4 ring-[#1D2D3D]" aria-hidden="true">
              <Check className="w-4.5 h-4.5 text-white" strokeWidth={3.5} />
            </span>
          </div>
          <div className="mt-2 leading-tight">
            <div className="text-[11px] font-bold uppercase tracking-[0.14em] text-[#a3d65f]">
              Your handyman
            </div>
            <div className="mt-1 text-2xl sm:text-3xl font-extrabold tracking-tight text-white">
              {skinFirstName}&rsquo;s got your job{firstName ? `, ${firstName}` : ''}
            </div>
            <div className="mt-1.5 text-sm text-slate-300 inline-flex items-center gap-1.5">
              <span className="inline-flex items-center gap-1">
                <Star className="w-4 h-4 text-amber-400 fill-amber-400" />
                <b className="text-white">{skinRating}</b>
              </span>
              <span className="text-slate-500">·</span>
              <span>{skinJobsLabel} completed</span>
            </div>
          </div>
        </div>

        {/* Offer body — hidden during the centred hold, rises in as the
            header slides up. */}
        <div
          className="transition-all duration-500 ease-[cubic-bezier(0.23,1,0.32,1)]"
          style={settled
            ? { opacity: 1, transform: 'none', transitionDelay: '150ms' }
            : { opacity: 0, transform: 'translateY(28px)', pointerEvents: 'none' }}
        >
          <AtHomeOfferBody
            offer={offer}
            render={render}
            firstName={firstName}
            onAccept={onAccept}
            onDecline={onDecline}
          />
        </div>
      </div>
    </div>
  );
}
