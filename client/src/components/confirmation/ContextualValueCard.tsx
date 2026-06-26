import { motion } from 'framer-motion';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { CheckCircle2, Receipt, Percent } from 'lucide-react';
import type { PriceBuckets } from '@shared/contextual-pricing-types';

interface PricingLineItem {
  description: string;
  guardedPricePence: number;
  timeEstimateMinutes?: number;
  materialsCostPence?: number;
  materialsWithMarginPence?: number;
  /**
   * Decomposed pricing — this line's allocated share of the job-whole structural
   * buckets (call-out + travel + collection), folded into the displayed price so
   * the customer sees one blended figure per line. 0/absent on flag-off quotes.
   */
  structuralSharePence?: number;
}

interface ContextualValueCardProps {
  contextualHeadline: string;
  contextualMessage: string;
  proposalSummary?: string;
  valueBullets: string[];
  pricingLineItems?: PricingLineItem[];
  /**
   * Decomposed-pricing structural cost buckets (attendance/travel/collection).
   * Accepted for reference but no longer rendered as separate rows: the buckets
   * are now folded into each line's price via per-line `structuralSharePence`.
   * Absent on legacy/flag-off quotes.
   */
  priceBuckets?: PriceBuckets | null;
  batchDiscountPercent?: number;
  layoutTier?: string;
  onAction: (action: string) => void;
  portalToken?: string;
}

export function ContextualValueCard({
  contextualHeadline,
  contextualMessage,
  proposalSummary,
  valueBullets,
  pricingLineItems,
  batchDiscountPercent,
  layoutTier,
  onAction,
  portalToken,
}: ContextualValueCardProps) {
  // Show line items for standard/complex jobs (not quick single-item jobs)
  const showLineItems = pricingLineItems && pricingLineItems.length > 0 && layoutTier !== 'quick';

  // Calculate totals from line items
  const labourTotalPence = pricingLineItems?.reduce((sum, item) => sum + item.guardedPricePence, 0) ?? 0;
  const materialsTotalPence = pricingLineItems?.reduce((sum, item) => sum + (item.materialsWithMarginPence ?? 0), 0) ?? 0;
  const subtotalPence = labourTotalPence + materialsTotalPence;
  const discountPence = batchDiscountPercent ? Math.round(labourTotalPence * batchDiscountPercent / 100) : 0;
  const hasBatchDiscount = batchDiscountPercent && batchDiscountPercent > 0;

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.4 }}
    >
      <Card className="bg-handy-cream border-handy-yellow/40 shadow-sm">
        <CardContent className="p-6">
          {/* Contextual Header */}
          <h3 className="text-xl font-bold text-handy-navy mb-1.5">{contextualHeadline}</h3>
          <div className="h-0.5 w-12 bg-handy-yellow rounded-full mb-3" />
          <p className="text-handy-navy/80 mb-4">{contextualMessage}</p>

          {/* Proposal Summary — what was agreed */}
          {proposalSummary && (
            <div className="bg-white border border-handy-grid rounded-lg p-4 mb-5">
              <p className="text-sm text-handy-navy/90 leading-relaxed">{proposalSummary}</p>
            </div>
          )}

          {/* Line Item Breakdown */}
          {showLineItems && (
            <div className="mb-5">
              <div className="flex items-center gap-2 mb-3">
                <Receipt className="w-4 h-4 text-handy-navy" />
                <span className="text-sm font-medium text-handy-navy/80">Price Breakdown</span>
              </div>
              <div className="space-y-2">
                {pricingLineItems!.map((item, index) => {
                  // Folded line price: labour + materials + this line's allocated
                  // share of the job-whole structural buckets (call-out/travel/
                  // collection). The share is 0 on flag-off quotes ⇒ unchanged.
                  const itemTotal =
                    item.guardedPricePence +
                    (item.materialsWithMarginPence ?? 0) +
                    (item.structuralSharePence ?? 0);
                  return (
                    <motion.div
                      key={index}
                      className="flex items-center justify-between py-2 border-b border-handy-grid last:border-0"
                      initial={{ opacity: 0, x: -10 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: 0.5 + index * 0.08 }}
                    >
                      <span className="text-sm text-handy-navy/90 flex-1 pr-4">{item.description}</span>
                      <span className="text-sm font-medium text-handy-navy whitespace-nowrap">
                        £{(itemTotal / 100).toFixed(2)}
                      </span>
                    </motion.div>
                  );
                })}

                {/* Decomposed pricing — the job-whole structural costs (call-out,
                    travel, materials collection) are now FOLDED into each line's
                    price above (per-line `structuralSharePence`), so there are no
                    separate fee rows. Customer sees clean blended per-job prices. */}

                {/* Batch discount row */}
                {hasBatchDiscount && (
                  <motion.div
                    className="flex items-center justify-between py-2 border-t border-handy-yellow/30"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: 0.7 }}
                  >
                    <span className="text-sm text-handy-navy flex items-center gap-1.5">
                      <Percent className="w-3.5 h-3.5" />
                      {batchDiscountPercent}% multi-job discount
                    </span>
                    <span className="text-sm font-medium text-handy-navy">
                      -£{(discountPence / 100).toFixed(2)}
                    </span>
                  </motion.div>
                )}
              </div>
            </div>
          )}

          {/* Value Bullets */}
          <ul className="space-y-3 mb-6">
            {valueBullets.map((bullet, index) => (
              <motion.li
                key={index}
                className="flex items-center gap-3 text-handy-navy"
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.5 + index * 0.1 }}
              >
                <div className="flex-shrink-0 w-8 h-8 rounded-full bg-handy-yellow/20 flex items-center justify-center">
                  <CheckCircle2 className="w-4 h-4 text-handy-navy" />
                </div>
                <span>{bullet}</span>
              </motion.li>
            ))}
          </ul>

          {/* CTAs */}
          <div className="space-y-3">
            <Button
              onClick={() => onAction('add-calendar')}
              className="w-full bg-handy-navy hover:bg-handy-navy/90 text-white font-semibold"
              size="lg"
            >
              Add to Calendar
            </Button>

            {portalToken && (
              <Button
                onClick={() => onAction('portal')}
                variant="outline"
                className="w-full bg-transparent border-handy-navy/30 text-handy-navy hover:bg-handy-navy/5"
                size="lg"
              >
                Track My Booking
              </Button>
            )}
          </div>

          {/* Trust strip */}
          <div className="mt-6 pt-4 border-t border-handy-grid">
            <p className="text-xs text-center text-handy-muted">
              £2M Insured • 4.9★ Google (127 reviews) • 90-day guarantee
            </p>
          </div>

          {/* Risk reversal */}
          <div className="mt-4 bg-handy-yellow/10 border border-handy-yellow/30 rounded-lg p-3">
            <p className="text-sm text-center text-handy-navy">
              Not right? We return and fix it free. No questions.
            </p>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}
