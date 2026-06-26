import { Check } from 'lucide-react';
import handyLogo from '@/assets/handy-logo-transparent.png';
import { OFFER_ICONS, HS_GREEN, HS_GREEN_DARK, firstNameOf, type OfferTemplateProps } from './types';

/**
 * 'minimal' template — light, editorial, whitespace-led. No dark band: a small
 * eyebrow, a large quiet headline, the saving as a clean figure (not a pill),
 * a restrained benefit checklist, a solid CTA and a text-link decline.
 */
export function MinimalOffer({ offer, ctx, render, customerName, onAccept, onDecline }: OfferTemplateProps) {
  const savings = render('{savings}');
  const firstName = firstNameOf(customerName);

  return (
    <div className="min-h-screen bg-white font-sans text-slate-900 flex flex-col items-center px-6 py-10">
      <style>{`
        @keyframes hs-fade { 0% { transform: translateY(8px); opacity: 0; } 100% { transform: translateY(0); opacity: 1; } }
      `}</style>

      {/* Brand wordmark */}
      <div className="flex items-center gap-2 mb-10">
        <img src={handyLogo} alt="HandyServices" className="w-8 h-8 object-contain" />
        <span className="text-lg font-extrabold tracking-tight text-slate-900">
          Handy<span style={{ color: HS_GREEN }}>Services</span>
        </span>
      </div>

      <div className="w-full max-w-lg text-center" style={{ animation: 'hs-fade 0.5s ease-out' }}>
        {(firstName || offer.eyebrow) && (
          <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-slate-400 mb-5">
            {firstName ? `${firstName} — ` : ''}{render(offer.eyebrow)}
          </p>
        )}

        <h1 className="text-[2.5rem] sm:text-5xl font-extrabold leading-[1.04] tracking-tight text-slate-900">
          {render(offer.headline)}
        </h1>

        {ctx.savingsPence > 0 && (
          <div className="mt-8 flex items-center justify-center gap-3">
            <span className="h-px w-10 bg-slate-200" />
            <span className="text-sm font-semibold uppercase tracking-widest text-slate-400">Save</span>
            <span className="text-4xl font-extrabold tracking-tight" style={{ color: HS_GREEN_DARK }}>{savings}</span>
            <span className="h-px w-10 bg-slate-200" />
          </div>
        )}

        {offer.subhead && (
          <p className="mt-6 text-base text-slate-500 leading-relaxed max-w-md mx-auto">{render(offer.subhead)}</p>
        )}

        {offer.benefits?.length > 0 && (
          <ul className="mt-9 space-y-3.5 inline-block text-left">
            {offer.benefits.map((b, i) => {
              const Icon = OFFER_ICONS[b.icon] ?? Check;
              return (
                <li key={i} className="flex items-center gap-3">
                  <Icon className="w-[18px] h-[18px] shrink-0" strokeWidth={2.5} style={{ color: HS_GREEN }} />
                  <span className="text-[15px] font-medium text-slate-700">{render(b.text)}</span>
                </li>
              );
            })}
          </ul>
        )}

        <div className="mt-10 flex flex-col items-center gap-4">
          <button
            onClick={onAccept}
            className="w-full max-w-sm rounded-full px-6 py-4 text-base font-extrabold text-white shadow-sm transition-transform active:scale-[0.98]"
            style={{ backgroundColor: HS_GREEN }}
          >
            {render(offer.acceptLabel)}
          </button>
          <button
            onClick={onDecline}
            className="text-sm font-semibold text-slate-500 underline decoration-slate-300 underline-offset-4 transition-colors hover:text-slate-800"
          >
            {render(offer.declineLabel)}
          </button>
        </div>

        {offer.finePrint && (
          <p className="mt-7 text-xs text-slate-400 leading-relaxed max-w-md mx-auto">{render(offer.finePrint)}</p>
        )}
      </div>
    </div>
  );
}
