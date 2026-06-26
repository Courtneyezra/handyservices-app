import { ArrowRight, Check } from 'lucide-react';
import handyLogo from '@/assets/handy-logo-transparent.png';
import { OFFER_ICONS, HS_GREEN, HS_GREEN_DARK, firstNameOf, type OfferTemplateProps } from './types';

/**
 * 'dark_hero' template — the launch design. A bold dark navy hero band with a
 * green savings pill, benefit rows beneath, and stacked accept/decline CTAs.
 */
export function DarkHeroOffer({ offer, ctx, render, customerName, onAccept, onDecline }: OfferTemplateProps) {
  const savings = render('{savings}');
  const firstName = firstNameOf(customerName);

  return (
    <div className="min-h-screen bg-slate-50 font-sans text-slate-900 flex flex-col items-center px-4 py-8">
      <style>{`
        @keyframes hs-rise { 0% { transform: translateY(12px); opacity: 0; } 100% { transform: translateY(0); opacity: 1; } }
      `}</style>

      {/* Brand wordmark */}
      <div className="flex items-center gap-2 mb-6">
        <img src={handyLogo} alt="HandyServices" className="w-9 h-9 object-contain" />
        <span className="text-xl font-extrabold tracking-tight text-slate-900">
          Handy<span style={{ color: HS_GREEN }}>Services</span>
        </span>
      </div>

      <div className="w-full max-w-md" style={{ animation: 'hs-rise 0.45s ease-out' }}>
        {offer.eyebrow && (
          <p className="text-center text-xs font-bold uppercase tracking-widest mb-3" style={{ color: HS_GREEN_DARK }}>
            {render(offer.eyebrow)}
          </p>
        )}

        {/* Bold high-contrast hero band — the offer headline + savings badge */}
        <div className="rounded-3xl bg-[#0f172a] text-white px-6 py-8 shadow-xl text-center">
          {firstName && (
            <p className="text-slate-300 text-sm font-medium mb-3">{firstName}, one last thing…</p>
          )}
          <h1 className="text-4xl sm:text-5xl font-extrabold leading-[1.02] tracking-tight">
            {render(offer.headline)}
          </h1>
          {ctx.savingsPence > 0 && (
            <div className="mt-5 inline-flex items-baseline gap-2 rounded-full px-5 py-2.5 shadow-lg" style={{ backgroundColor: HS_GREEN }}>
              <span className="text-sm font-bold uppercase tracking-wide text-white/90">Save</span>
              <span className="text-2xl font-extrabold text-white">{savings}</span>
            </div>
          )}
          {offer.subhead && (
            <p className="mt-5 text-sm text-slate-200 leading-relaxed">{render(offer.subhead)}</p>
          )}
        </div>

        {/* Benefit rows */}
        {offer.benefits?.length > 0 && (
          <ul className="mt-6 space-y-3">
            {offer.benefits.map((b, i) => {
              const Icon = OFFER_ICONS[b.icon] ?? Check;
              return (
                <li key={i} className="flex items-start gap-3">
                  <span className="shrink-0 w-8 h-8 rounded-full flex items-center justify-center" style={{ backgroundColor: 'rgba(125,176,14,0.15)', color: HS_GREEN_DARK }}>
                    <Icon className="w-[18px] h-[18px]" strokeWidth={2.5} />
                  </span>
                  <span className="text-[15px] font-medium text-slate-800 leading-snug pt-1">
                    {render(b.text)}
                  </span>
                </li>
              );
            })}
          </ul>
        )}

        {/* CTAs */}
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
            className="w-full rounded-2xl border-2 border-slate-200 bg-white px-6 py-3.5 text-sm font-semibold text-slate-600 transition-colors hover:bg-slate-50"
          >
            {render(offer.declineLabel)}
          </button>
        </div>

        {offer.finePrint && (
          <p className="mt-5 text-center text-xs text-slate-500 leading-relaxed">
            {render(offer.finePrint)}
          </p>
        )}
      </div>
    </div>
  );
}
