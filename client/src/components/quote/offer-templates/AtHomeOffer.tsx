import { Check, ArrowRight } from 'lucide-react';
import handyLogo from '@/assets/handy-logo-transparent.png';
import { HS_GREEN_DARK, HS_NAVY, firstNameOf, type OfferTemplateProps } from './types';

/**
 * 'at_home' template — warm, editorial, trust-led. Built for the HOMEOWNER
 * flex-save offer. Anchor-free by design: it may show the {savings} amount (the
 * cash kept by staying flexible) but never the base/firm TOTALS, so it sharpens
 * the flexibility CHOICE (let us pick the day vs. lock a firm date) without
 * anchoring the actual price before the customer reaches the quote — the full
 * fixed price lands on the quote page itself. Styled to match the preparing/
 * loading screen: slate-50 background, navy editorial headline with a hand-drawn
 * underline on a *starred* word, a white card of green circle-tick benefits, and
 * a green pill CTA — the same visual system, so the loading → offer hand-off
 * feels seamless.
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

export function AtHomeOffer({ offer, render, customerName, onAccept, onDecline }: OfferTemplateProps) {
  const firstName = firstNameOf(customerName);

  // Headline emphasis: a *starred* span gets the hand-drawn underline (brand
  // flourish). Tokens inside it are resolved by `render`, so the {savings} amount
  // can sit under the underline — but base/firm TOTALS stay off this screen so
  // the price anchor still lands on the quote page.
  const hl = offer.headline ?? '';
  const m = hl.match(/^([\s\S]*?)\*([\s\S]+?)\*([\s\S]*)$/);
  const hlBefore = render(m ? m[1] : hl);
  const hlEmphasis = m ? render(m[2]) : '';
  const hlAfter = m ? render(m[3]) : '';

  // Subhead emphasis: a **double-starred** span renders bold (the punchy payoff).
  // Same token resolution as the headline, but distinct from the single-* underline.
  // Falls back to plain text when no ** markup is present.
  const sh = offer.subhead ?? '';
  const sm = sh.match(/^([\s\S]*?)\*\*([\s\S]+?)\*\*([\s\S]*)$/);
  const shBefore = render(sm ? sm[1] : sh);
  const shBold = sm ? render(sm[2]) : '';
  const shAfter = sm ? render(sm[3]) : '';

  return (
    <div
      className="min-h-screen bg-slate-50 flex flex-col items-center justify-center px-6 py-5 font-sans antialiased"
      style={{ color: HS_NAVY }}
    >
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

      {/* Brand wordmark */}
      <div className="flex items-center gap-2 mb-4">
        <img src={handyLogo} alt="HandyServices" className="w-8 h-8 object-contain" />
        <span className="text-lg font-extrabold tracking-tight" style={{ color: HS_NAVY }}>
          Handy<span style={{ color: HS_GREEN_DARK }}>Services</span>
        </span>
      </div>

      <div className="w-full max-w-md">
        {/* Craig — the offer is about slotting into HIS diary, so anchor it with
            his face (same avatar as the loading reveal + the quote's "Meet your
            handyman" section, one consistent person across the journey). */}
        <div className="flex items-center gap-3 mb-4 hs-ah-rise">
          <div className="relative shrink-0">
            <div className="w-12 h-12 rounded-full overflow-hidden border-2 border-[#7DB00E] shadow-sm">
              <img src="/assets/avatars/craig-avatar-1.webp" alt="Craig, your handyman" className="w-full h-full object-cover" />
            </div>
            <span className="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full bg-[#7DB00E] ring-2 ring-slate-50" aria-hidden="true" />
          </div>
          <div className="leading-tight">
            <div className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: navy(0.45) }}>Your handyman</div>
            <div className="text-[15px] font-extrabold" style={{ color: HS_NAVY }}>
              Craig <span className="font-semibold" style={{ color: HS_GREEN_DARK }}>· 4.9★</span>
            </div>
          </div>
        </div>

        {(firstName || offer.eyebrow) && (
          <p className="text-[12px] font-bold uppercase tracking-[0.16em] mb-3 hs-ah-rise" style={{ color: GREEN_INK }}>
            {firstName ? `${firstName}, ` : ''}{render(offer.eyebrow)}
          </p>
        )}

        {/* Editorial headline — hand-underlined saving */}
        <h1 className="text-[2.05rem] sm:text-[2.4rem] leading-[1.05] font-extrabold tracking-tight hs-ah-rise hs-ah-d1" style={{ color: HS_NAVY }}>
          {hlBefore}
          {hlEmphasis && (
            <span className="hs-ah-underline" style={{ color: HS_GREEN_DARK }}>{hlEmphasis}</span>
          )}
          {hlAfter}
        </h1>

        {offer.subhead && (
          <p className="mt-3 text-[15px] leading-snug hs-ah-rise hs-ah-d2" style={{ color: navy(0.7) }}>
            {shBefore}
            {shBold && <strong className="font-extrabold" style={{ color: HS_NAVY }}>{shBold}</strong>}
            {shAfter}
          </p>
        )}

        {/* Benefits — white card with green circle ticks, mirroring the
            preparing/loading screen's checklist card. */}
        {offer.benefits?.length > 0 && (
          <div className="mt-6 bg-white rounded-2xl border border-slate-200 shadow-lg p-4 hs-ah-rise hs-ah-d3">
            <ul className="space-y-1">
              {offer.benefits.map((b, i) => (
                <li key={i} className="flex items-center gap-3 rounded-xl px-2.5 py-2.5">
                  <span className="shrink-0 w-8 h-8 rounded-full flex items-center justify-center bg-[#7DB00E] text-white">
                    <Check className="w-5 h-5" strokeWidth={3} />
                  </span>
                  <span className="text-[14px] font-medium" style={{ color: navy(0.85) }}>{render(b.text)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* CTAs */}
        <div className="mt-6 space-y-2.5 hs-ah-rise hs-ah-d4">
          <button
            onClick={onAccept}
            className="w-full inline-flex items-center justify-center gap-2 rounded-full px-6 py-4 text-base font-extrabold text-white shadow-lg bg-[#7DB00E] hover:bg-[#6da000] transition-all active:scale-[0.98] whitespace-nowrap"
          >
            {render(offer.acceptLabel)}
            <ArrowRight className="w-5 h-5" strokeWidth={2.6} />
          </button>
          <button
            onClick={onDecline}
            className="w-full text-center text-sm font-semibold py-1 underline underline-offset-4"
            style={{ color: navy(0.5), textDecorationColor: navy(0.2) }}
          >
            {render(offer.declineLabel)}
          </button>
        </div>

        {/* Fine print + trust merged into one line — keeps the reassurance at the
            decision point without a second stacked block (fits one mobile
            viewport, no scroll). Rating lives on the Craig chip above, so the
            strip carries insured/guarantee only. */}
        <p className="mt-3 text-center text-[11px] leading-relaxed hs-ah-rise hs-ah-d5" style={{ color: navy(0.45) }}>
          {offer.finePrint && <>{render(offer.finePrint)}<br /></>}
          <span style={{ color: navy(0.55) }} className="font-semibold">£2M insured · DBS-checked · 12-mo guarantee</span>
        </p>
      </div>
    </div>
  );
}
