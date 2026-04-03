import { motion } from 'framer-motion';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { CheckCircle2, Receipt, Percent } from 'lucide-react';

interface PricingLineItem {
  description: string;
  guardedPricePence: number;
  timeEstimateMinutes?: number;
  materialsCostPence?: number;
  materialsWithMarginPence?: number;
}

interface ContextualValueCardProps {
  contextualHeadline: string;
  contextualMessage: string;
  proposalSummary?: string;
  valueBullets: string[];
  pricingLineItems?: PricingLineItem[];
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
      <Card className="bg-gradient-to-b from-[#e8b323]/10 to-gray-800/50 border-[#e8b323]/30">
        <CardContent className="p-6">
          {/* Contextual Header */}
          <h3 className="text-xl font-bold text-[#e8b323] mb-2">{contextualHeadline}</h3>
          <p className="text-gray-300 mb-4">{contextualMessage}</p>

          {/* Proposal Summary — what was agreed */}
          {proposalSummary && (
            <div className="bg-gray-800/60 border border-gray-700 rounded-lg p-4 mb-5">
              <p className="text-sm text-gray-200 leading-relaxed">{proposalSummary}</p>
            </div>
          )}

          {/* Line Item Breakdown */}
          {showLineItems && (
            <div className="mb-5">
              <div className="flex items-center gap-2 mb-3">
                <Receipt className="w-4 h-4 text-[#e8b323]" />
                <span className="text-sm font-medium text-gray-300">Price Breakdown</span>
              </div>
              <div className="space-y-2">
                {pricingLineItems!.map((item, index) => {
                  const itemTotal = item.guardedPricePence + (item.materialsWithMarginPence ?? 0);
                  return (
                    <motion.div
                      key={index}
                      className="flex items-center justify-between py-2 border-b border-gray-700/50 last:border-0"
                      initial={{ opacity: 0, x: -10 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: 0.5 + index * 0.08 }}
                    >
                      <span className="text-sm text-gray-200 flex-1 pr-4">{item.description}</span>
                      <span className="text-sm font-medium text-white whitespace-nowrap">
                        £{(itemTotal / 100).toFixed(2)}
                      </span>
                    </motion.div>
                  );
                })}

                {/* Batch discount row */}
                {hasBatchDiscount && (
                  <motion.div
                    className="flex items-center justify-between py-2 border-t border-green-500/30"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: 0.7 }}
                  >
                    <span className="text-sm text-green-400 flex items-center gap-1.5">
                      <Percent className="w-3.5 h-3.5" />
                      {batchDiscountPercent}% multi-job discount
                    </span>
                    <span className="text-sm font-medium text-green-400">
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
                className="flex items-center gap-3 text-white"
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.5 + index * 0.1 }}
              >
                <div className="flex-shrink-0 w-8 h-8 rounded-full bg-[#e8b323]/20 flex items-center justify-center">
                  <CheckCircle2 className="w-4 h-4 text-[#e8b323]" />
                </div>
                <span>{bullet}</span>
              </motion.li>
            ))}
          </ul>

          {/* CTAs */}
          <div className="space-y-3">
            <Button
              onClick={() => onAction('add-calendar')}
              className="w-full bg-[#e8b323] hover:bg-[#d4a41e] text-gray-900 font-semibold"
              size="lg"
            >
              Add to Calendar
            </Button>

            {portalToken && (
              <Button
                onClick={() => onAction('portal')}
                variant="outline"
                className="w-full border-gray-600 text-gray-300 hover:bg-gray-700"
                size="lg"
              >
                Track My Booking
              </Button>
            )}
          </div>

          {/* Trust strip */}
          <div className="mt-6 pt-4 border-t border-gray-700">
            <p className="text-xs text-center text-gray-400">
              £2M Insured • 4.9★ Google (127 reviews) • 90-day guarantee
            </p>
          </div>

          {/* Risk reversal */}
          <div className="mt-4 bg-green-900/20 border border-green-500/30 rounded-lg p-3">
            <p className="text-sm text-center text-green-400">
              Not right? We return and fix it free. No questions.
            </p>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}
