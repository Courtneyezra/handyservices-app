import { Check } from 'lucide-react';
import type { PriceBuckets } from '../../../../shared/contextual-pricing-types';

interface AmendedQuoteLineItem {
  lineId?: string;
  description: string;
  guardedPricePence?: number;
  materialsWithMarginPence?: number;
  /**
   * Decomposed pricing — this line's allocated share of the job-whole structural
   * buckets (call-out × visits + travel + collection), folded into the displayed
   * line price. 0/absent on legacy/flag-off quotes.
   */
  structuralSharePence?: number;
}

export interface AmendedQuoteCardProps {
  customerName: string;
  previousTotalPence: number;
  currentTotalPence: number;
  depositPaidPence: number;
  balanceDuePence: number;
  pricingLineItems?: AmendedQuoteLineItem[] | null;
  /**
   * Decomposed pricing — structural cost buckets. Accepted for reference but no
   * longer rendered as separate rows: the buckets are folded into each line's
   * displayed price via per-line `structuralSharePence`. Absent on legacy quotes.
   */
  priceBuckets?: PriceBuckets | null;
  explanation?: string;
  isAccepted?: boolean;
  isAccepting?: boolean;
  onAccept: () => void;
}

export function AmendedQuoteCard({
  customerName,
  previousTotalPence,
  currentTotalPence,
  depositPaidPence,
  balanceDuePence,
  pricingLineItems,
  explanation,
  isAccepted = false,
  isAccepting = false,
  onAccept,
}: AmendedQuoteCardProps) {
  const firstName = customerName.split(' ')[0] || customerName;
  return (
    <div
      className="bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 rounded-3xl overflow-hidden shadow-2xl"
      data-testid="amended-quote-card"
    >
      <div className="p-6 space-y-5">
        <div className="text-center">
          <div
            className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold mb-3 ${
              isAccepted ? 'bg-green-500 text-white' : 'bg-amber-500 text-slate-900'
            }`}
          >
            {isAccepted ? 'AMENDED QUOTE ACCEPTED' : 'AMENDED QUOTE'}
          </div>
          <h3 className="text-2xl md:text-3xl font-bold text-white mb-2">
            {firstName}, {isAccepted ? "you're all set" : 'your amended quote'}
          </h3>
          {!isAccepted && explanation && (
            <p className="text-sm text-slate-300 leading-relaxed max-w-md mx-auto">{explanation}</p>
          )}
          {isAccepted && (
            <p className="text-sm text-slate-300 leading-relaxed max-w-md mx-auto">
              Thanks — we'll see you on the booked date and collect the £{(balanceDuePence / 100).toFixed(2)} balance on completion.
            </p>
          )}
        </div>

        {pricingLineItems && pricingLineItems.length > 0 && (
          <div className="bg-slate-800/60 rounded-xl p-4 border border-slate-700">
            <h5 className="text-[11px] font-bold uppercase tracking-widest text-slate-400 mb-3">
              Updated Scope
            </h5>
            <div className="space-y-2.5">
              {pricingLineItems.map((item, idx) => {
                // Folded line total: pure labour + materials + this line's share of
                // the job-whole structural buckets (call-out × visits / travel /
                // collection). Share is 0 on legacy/flag-off quotes ⇒ unchanged.
                const totalPence =
                  (item.guardedPricePence ?? 0) +
                  (item.materialsWithMarginPence ?? 0) +
                  (item.structuralSharePence ?? 0);
                return (
                  <div
                    key={item.lineId ?? idx}
                    className="flex justify-between items-start gap-3 text-sm"
                  >
                    <span className="text-slate-200 flex-1 leading-snug">{item.description}</span>
                    <span className="text-white font-semibold whitespace-nowrap">
                      £{(totalPence / 100).toFixed(2)}
                    </span>
                  </div>
                );
              })}
              {/* Structural buckets are FOLDED into each line above (per-line
                  structuralSharePence) — no separate fee rows. */}
            </div>
          </div>
        )}

        <div className="bg-slate-800/60 rounded-xl p-4 border border-slate-700 space-y-2 text-sm">
          <div className="flex justify-between text-slate-400">
            <span>Previous total</span>
            <span className="line-through">£{(previousTotalPence / 100).toFixed(2)}</span>
          </div>
          <div className="flex justify-between text-white text-base">
            <span>New total</span>
            <span className="font-semibold">£{(currentTotalPence / 100).toFixed(2)}</span>
          </div>
          <div className="flex justify-between text-slate-300 pt-2 border-t border-slate-700">
            <span>Deposit paid</span>
            <span>−£{(depositPaidPence / 100).toFixed(2)}</span>
          </div>
          <div className="flex justify-between text-amber-300 font-bold text-base pt-2 border-t border-slate-700">
            <span>Balance due on completion</span>
            <span>£{(balanceDuePence / 100).toFixed(2)}</span>
          </div>
        </div>

        {isAccepted ? (
          <div
            className="w-full bg-green-600 text-white font-bold text-base px-6 py-4 rounded-xl shadow-lg text-center flex items-center justify-center gap-2"
            data-testid="accept-revision-confirmed"
          >
            <Check className="w-5 h-5" strokeWidth={3} /> Revised quote accepted
          </div>
        ) : (
          <button
            type="button"
            onClick={onAccept}
            disabled={isAccepting}
            className="w-full bg-[#e8b323] hover:bg-[#f3c33b] disabled:opacity-60 disabled:cursor-not-allowed text-slate-900 font-bold text-base px-6 py-4 rounded-xl shadow-lg transition-colors"
            data-testid="accept-revision-button"
          >
            {isAccepting ? 'Accepting…' : 'Accept revised quote'}
          </button>
        )}

        {!isAccepted && (
          <p className="text-[11px] text-slate-400 text-center leading-relaxed">
            By accepting you agree to the new total of £{(currentTotalPence / 100).toFixed(2)}. Your
            deposit is credited in full and the £{(balanceDuePence / 100).toFixed(2)} balance is
            collected by the contractor on completion.
          </p>
        )}
      </div>
    </div>
  );
}
