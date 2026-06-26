import { useMemo, useState } from 'react';
import {
  DEFAULT_PRICING_SETTINGS,
  QUOTE_OFFER_TEMPLATES,
  QUOTE_OFFER_CUSTOMER_TYPES,
  type QuoteOfferTemplate,
  type QuoteOfferCustomerType,
} from '@shared/pricing-settings';
import { pickQuoteOffer, formatGBP } from '@/lib/quote-offers';
import { IrresistibleOfferScreen } from '@/components/quote/IrresistibleOfferScreen';

/**
 * Frontend-only sandbox (no backend) for iterating on the irresistible-offer
 * interstitial designs — mirrors the /labs/booking pattern. It renders the REAL
 * IrresistibleOfferScreen dispatcher with the offer resolved from the default
 * pricing-settings seed, so edits to the offer-templates/ files hot-reload here.
 *
 * Defaults to the HOMEOWNER flex-save offer (the warm 'at_home' design). Use the
 * bottom control bar to switch customer type, force a different template for
 * side-by-side comparison, change the base price (recomputes the £ tokens via
 * the same server-mirrored lane maths), and set the customer name.
 *
 * Public route, no auth — purely a design preview. Safe to delete.
 */

const BASE_PRESETS = [12000, 18000, 24000, 36000]; // £120 / £180 / £240 / £360

export default function OfferPreviewLab() {
  const [customerType, setCustomerType] = useState<QuoteOfferCustomerType>('homeowner');
  const [templateOverride, setTemplateOverride] = useState<QuoteOfferTemplate | ''>('');
  const [basePence, setBasePence] = useState(18000);
  const [name, setName] = useState('Sarah');

  const offer = useMemo(() => {
    const picked = pickQuoteOffer(DEFAULT_PRICING_SETTINGS.quoteOffers, 'preview', customerType);
    if (!picked) return null;
    return templateOverride ? { ...picked, template: templateOverride } : picked;
  }, [customerType, templateOverride]);

  return (
    <div className="relative">
      {offer ? (
        <IrresistibleOfferScreen
          // Remount on every tweak so entry animations replay
          key={`${offer.id}-${offer.template}-${basePence}-${name}`}
          offer={offer}
          basePricePence={basePence}
          customerName={name}
          onAccept={() => window.alert(`Accept → flexible lane (${formatGBP(basePence)})`)}
          onDecline={() => window.alert('Decline → firm date & time (base + premium)')}
        />
      ) : (
        <div className="min-h-screen grid place-items-center bg-slate-100 p-10 text-center text-slate-600">
          <div>
            <p className="text-lg font-semibold text-slate-800">No offer for “{customerType}”.</p>
            <p className="mt-1 text-sm">This type is suppressed or has no lever (e.g. landlord/business aren’t lane-eligible).</p>
          </div>
        </div>
      )}

      {/* ── Dev control bar (not part of the design) ─────────────────────── */}
      <div className="fixed bottom-0 inset-x-0 z-50 border-t border-white/10 bg-slate-900/95 backdrop-blur px-4 py-2.5 text-white">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-5 gap-y-2 text-xs">
          <span className="font-bold uppercase tracking-widest text-emerald-400">Offer preview</span>

          <label className="flex items-center gap-1.5">
            <span className="text-white/50">Type</span>
            <select
              value={customerType}
              onChange={(e) => setCustomerType(e.target.value as QuoteOfferCustomerType)}
              className="rounded bg-slate-800 px-2 py-1 font-medium outline-none ring-1 ring-white/10"
            >
              {QUOTE_OFFER_CUSTOMER_TYPES.map((t) => (
                <option key={t.id} value={t.id}>{t.label}</option>
              ))}
            </select>
          </label>

          <label className="flex items-center gap-1.5">
            <span className="text-white/50">Template</span>
            <select
              value={templateOverride}
              onChange={(e) => setTemplateOverride(e.target.value as QuoteOfferTemplate | '')}
              className="rounded bg-slate-800 px-2 py-1 font-medium outline-none ring-1 ring-white/10"
            >
              <option value="">Type default ({offer?.template ?? '—'})</option>
              {QUOTE_OFFER_TEMPLATES.map((t) => (
                <option key={t.id} value={t.id}>{t.label}</option>
              ))}
            </select>
          </label>

          <div className="flex items-center gap-1.5">
            <span className="text-white/50">Base</span>
            {BASE_PRESETS.map((p) => (
              <button
                key={p}
                onClick={() => setBasePence(p)}
                className={`rounded px-2 py-1 font-semibold transition ${
                  basePence === p ? 'bg-emerald-500 text-slate-900' : 'bg-slate-800 text-white/80 hover:bg-slate-700'
                }`}
              >
                {formatGBP(p)}
              </button>
            ))}
          </div>

          <label className="flex items-center gap-1.5">
            <span className="text-white/50">Name</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-24 rounded bg-slate-800 px-2 py-1 font-medium outline-none ring-1 ring-white/10"
              placeholder="(none)"
            />
          </label>
        </div>
      </div>
    </div>
  );
}
