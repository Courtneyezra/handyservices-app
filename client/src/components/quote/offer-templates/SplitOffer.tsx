import { ArrowRight, Check } from 'lucide-react';
import handyLogo from '@/assets/handy-logo-transparent.png';
import { formatGBP } from '@/lib/quote-offers';
import { OFFER_ICONS, HS_GREEN, HS_GREEN_DARK, firstNameOf, type OfferTemplateProps } from './types';

/**
 * 'split' template — a pricing-forward two-panel card. A dark navy value rail
 * (firm price struck → flexible price + savings) sits beside a white panel with
 * the headline, benefits and CTAs. Stacks to one column on mobile.
 */
export function SplitOffer({ offer, ctx, render, customerName, onAccept, onDecline }: OfferTemplateProps) {
  const savings = render('{savings}');
  const firstName = firstNameOf(customerName);
  const hasSaving = ctx.savingsPence > 0;

  return (
    <div className="min-h-screen bg-slate-100 font-sans text-slate-900 flex flex-col items-center justify-center px-4 py-8">
      <style>{`
        @keyframes hs-rise { 0% { transform: translateY(14px); opacity: 0; } 100% { transform: translateY(0); opacity: 1; } }
      `}</style>

      {/* Brand wordmark */}
      <div className="flex items-center gap-2 mb-6">
        <img src={handyLogo} alt="HandyServices" className="w-9 h-9 object-contain" />
        <span className="text-xl font-extrabold tracking-tight text-slate-900">
          Handy<span style={{ color: HS_GREEN }}>Services</span>
        </span>
      </div>

      <div
        className="w-full max-w-3xl overflow-hidden rounded-3xl bg-white shadow-2xl ring-1 ring-slate-900/5 grid sm:grid-cols-2"
        style={{ animation: 'hs-rise 0.5s ease-out' }}
      >
        {/* Left rail — the value / price proposition */}
        <div className="relative flex flex-col justify-center gap-5 px-7 py-9 text-white bg-[#0f172a] overflow-hidden">
          {/* subtle green glow */}
          <div
            className="pointer-events-none absolute -top-16 -right-16 w-56 h-56 rounded-full blur-3xl opacity-25"
            style={{ backgroundColor: HS_GREEN }}
          />
          <div className="relative">
            {firstName && (
              <p className="text-slate-300 text-sm font-medium mb-1">{firstName}, here's the quick win</p>
            )}
            {offer.eyebrow && (
              <p className="text-[11px] font-bold uppercase tracking-widest" style={{ color: '#a7d129' }}>
                {render(offer.eyebrow)}
              </p>
            )}
          </div>

          {hasSaving ? (
            <div className="relative">
              <p className="text-sm text-slate-400 line-through decoration-slate-500">{formatGBP(ctx.firmPence)} firm date</p>
              <div className="mt-1 flex items-baseline gap-2">
                <span className="text-5xl font-extrabold tracking-tight">{formatGBP(ctx.basePence)}</span>
                <span className="text-sm font-semibold text-slate-300">flexible</span>
              </div>
              <div className="mt-4 inline-flex items-baseline gap-2 rounded-full px-4 py-2 shadow-lg" style={{ backgroundColor: HS_GREEN }}>
                <span className="text-xs font-bold uppercase tracking-wide text-white/90">You save</span>
                <span className="text-xl font-extrabold text-white">{savings}</span>
              </div>
            </div>
          ) : (
            <div className="relative">
              <div className="flex items-baseline gap-2">
                <span className="text-5xl font-extrabold tracking-tight">{formatGBP(ctx.basePence)}</span>
                <span className="text-sm font-semibold text-slate-300">fixed</span>
              </div>
            </div>
          )}
        </div>

        {/* Right panel — headline, benefits, CTAs */}
        <div className="px-7 py-9 flex flex-col">
          <h1 className="text-3xl sm:text-[2rem] font-extrabold leading-[1.05] tracking-tight text-slate-900">
            {render(offer.headline)}
          </h1>
          {offer.subhead && (
            <p className="mt-3 text-[15px] text-slate-600 leading-relaxed">{render(offer.subhead)}</p>
          )}

          {offer.benefits?.length > 0 && (
            <ul className="mt-6 space-y-3">
              {offer.benefits.map((b, i) => {
                const Icon = OFFER_ICONS[b.icon] ?? Check;
                return (
                  <li key={i} className="flex items-start gap-3">
                    <span className="shrink-0 w-7 h-7 rounded-full flex items-center justify-center" style={{ backgroundColor: 'rgba(125,176,14,0.15)', color: HS_GREEN_DARK }}>
                      <Icon className="w-4 h-4" strokeWidth={2.5} />
                    </span>
                    <span className="text-sm font-medium text-slate-700 leading-snug pt-0.5">
                      {render(b.text)}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}

          <div className="mt-7 space-y-3">
            <button
              onClick={onAccept}
              className="w-full inline-flex items-center justify-center gap-2 rounded-2xl px-6 py-4 text-base font-extrabold text-white shadow-lg transition-transform active:scale-[0.98]"
              style={{ backgroundColor: HS_GREEN, boxShadow: '0 10px 25px -5px rgba(125,176,14,0.3)' }}
            >
              {render(offer.acceptLabel)}
              <ArrowRight className="w-5 h-5" strokeWidth={2.5} />
            </button>
            <button
              onClick={onDecline}
              className="w-full rounded-2xl px-6 py-3 text-sm font-semibold text-slate-500 transition-colors hover:text-slate-800 hover:bg-slate-50"
            >
              {render(offer.declineLabel)}
            </button>
          </div>

          {offer.finePrint && (
            <p className="mt-4 text-xs text-slate-400 leading-relaxed">{render(offer.finePrint)}</p>
          )}
        </div>
      </div>
    </div>
  );
}
