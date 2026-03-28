import React, { useState, useMemo, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Check, Calendar, Clock, Tag, Shield, Zap,
  ChevronRight, Percent, Sparkles, Star, Plus,
  Phone, Camera, Timer, Lock, CreditCard, Loader2, AlertCircle, MessageCircle
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { format, addDays, isWeekend } from 'date-fns';
import { toZonedTime } from 'date-fns-tz';
import { CardElement, useStripe, useElements } from '@stripe/react-stripe-js';
import { isStripeConfigured } from '@/lib/stripe';
import { getHassleComparisons } from '@shared/hassle-comparisons';
import {
  BASE_SCHEDULING_RULES,
  BASE_TIME_SLOTS,
  getSchedulingConfig,
  getTimeSlotsForSegment,
  applyPsychologicalPricing,
  type TimeSlotOption,
  type AddOnOption,
} from './SchedulingConfig';
import { useAvailability, formatDateStr } from '@/hooks/useAvailability';
import { StickyTimerProgress } from './QuoteTimerContext';

/** Which booking options to show on the card */
export type QuoteBookingMode = 'standard_date' | 'flexible_discount' | 'urgent_premium' | 'deposit_split';

/** A single pricing line item from the contextual pricing engine */
export interface PricingLineItem {
  lineId: string;
  description: string;
  category: string;
  timeEstimateMinutes: number;
  guardedPricePence: number;
  /** Material cost with margin (what customer pays). 0 if no materials. */
  materialsWithMarginPence?: number;
}

/** Multi-job batch discount details */
export interface QuoteBatchDiscount {
  applied: boolean;
  discountPercent: number;
  savingsPence: number;
}

interface UnifiedQuoteCardProps {
  segment: string;
  basePrice: number; // in pence
  customerName: string;
  customerEmail?: string;
  quoteId?: string;
  jobDescription?: string;
  location?: string; // e.g., "Fulham" - used for social proof labels
  optionalExtras?: { label: string; description?: string; priceInPence: number }[] | null;
  onBook: (config: {
    selectedDate: Date | null;
    timeSlot: string | null;
    addOns: string[];
    totalPrice: number;
    chargeNowPence: number; // Amount to charge today (deposit or full discounted price)
    balanceOnCompletionPence: number; // Remaining balance due on job completion
    paymentMode: 'deposit' | 'full';
    usedDownsell: boolean;
    flexiblePeriodDays?: number; // When using downsell, how many days flexibility
  }) => void;
  onPaymentSuccess?: (paymentIntentId: string) => Promise<void>;
  isBooking?: boolean;
  /** Which booking modes to display. When omitted, all default options are shown. */
  bookingModes?: QuoteBookingMode[];
  /** Contextual pricing line item breakdown. When provided, shown above the total. */
  pricingLineItems?: PricingLineItem[];
  /** Multi-job batch discount. When applied, shown as a discount line. */
  batchDiscount?: QuoteBatchDiscount;
  /** Override the default segment-driven feature bullets with contextual value bullets. */
  contextualBullets?: string[];
  /** Deposit percentage (0-100). Default 30. */
  depositPercent?: number;
  /** Pay-in-full discount percentage (0-100). Default 3. */
  payInFullDiscountPercent?: number;
  /** Flexible timing downsell discount percentage (0-100). Default from SchedulingConfig. */
  flexibleDiscountPercent?: number;
  /** Quote short slug for WhatsApp deep-link. */
  shortSlug?: string;
  /** VA-specified available dates (YYYY-MM-DD strings). When set, only these dates are shown in the calendar. */
  allowedDates?: string[] | null;
}

export function UnifiedQuoteCard({
  segment,
  basePrice,
  customerName,
  customerEmail,
  quoteId,
  jobDescription,
  location,
  optionalExtras,
  onBook,
  onPaymentSuccess,
  isBooking = false,
  bookingModes,
  pricingLineItems,
  batchDiscount,
  contextualBullets,
  depositPercent: depositPercentProp,
  payInFullDiscountPercent: payInFullDiscountPercentProp,
  flexibleDiscountPercent: flexibleDiscountPercentProp,
  shortSlug,
  allowedDates,
}: UnifiedQuoteCardProps) {
  // Booking mode flags — when bookingModes is provided, only show those options
  const showStandardDate = !bookingModes || bookingModes.includes('standard_date');
  const showFlexibleDiscount = !bookingModes || bookingModes.includes('flexible_discount');
  const showUrgentPremium = !bookingModes || bookingModes.includes('urgent_premium');
  const showDepositSplit = !bookingModes || bookingModes.includes('deposit_split');

  // Stripe hooks (will be null if not wrapped in Elements provider)
  const stripe = useStripe();
  const elements = useElements();
  // Get segment-specific config, with optional flexible discount override
  const rawConfig = getSchedulingConfig(segment);
  const config = useMemo(() => {
    if (flexibleDiscountPercentProp != null && rawConfig.downsell) {
      return {
        ...rawConfig,
        downsell: { ...rawConfig.downsell, discountPercent: flexibleDiscountPercentProp },
      };
    }
    return rawConfig;
  }, [rawConfig, flexibleDiscountPercentProp]);
  const timeSlots = getTimeSlotsForSegment(segment);

  // State
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [selectedTimeSlot, setSelectedTimeSlot] = useState<string | null>(null);
  const [selectedAddOns, setSelectedAddOns] = useState<string[]>([]);
  const [useDownsell, setUseDownsell] = useState(false);
  const [showAllDates, setShowAllDates] = useState(false);
  const [payFull, setPayFull] = useState(false);

  // Deposit / Pay-in-full config (configurable via admin pricing settings)
  const DEPOSIT_PERCENT = (depositPercentProp ?? 30) / 100;
  const PAY_FULL_DISCOUNT = (payInFullDiscountPercentProp ?? 3) / 100;

  // Payment state (for inline payment when using downsell)
  const [isProcessingPayment, setIsProcessingPayment] = useState(false);
  const [paymentError, setPaymentError] = useState<string | null>(null);
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [paymentIntentId, setPaymentIntentId] = useState<string | null>(null);
  const [isLoadingPaymentIntent, setIsLoadingPaymentIntent] = useState(false);
  const [inlineEmail, setInlineEmail] = useState(customerEmail || '');
  const effectiveEmail = customerEmail || (inlineEmail && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(inlineEmail) ? inlineEmail : undefined);

  // Refs for scroll behavior
  const timeSectionRef = useRef<HTMLDivElement>(null);
  const addOnsSectionRef = useRef<HTMLDivElement>(null);
  const bookSectionRef = useRef<HTMLDivElement>(null);
  const priceCardRef = useRef<HTMLDivElement>(null);
  const dateSectionRef = useRef<HTMLDivElement>(null);

  // Sticky CTA: show once the price card has been scrolled past,
  // stays visible until the user selects a date (starts booking flow)
  const [stickyCTAActivated, setStickyCTAActivated] = useState(false);
  const showStickyCTA = stickyCTAActivated && !selectedDate;

  useEffect(() => {
    const checkPriceCardPosition = () => {
      const priceEl = priceCardRef.current;
      if (!priceEl) return;
      const rect = priceEl.getBoundingClientRect();
      if (rect.top < 0) {
        setStickyCTAActivated(true);
      }
    };

    window.addEventListener('scroll', checkPriceCardPosition, { passive: true });
    // Also check on mount in case page loaded scrolled down
    checkPriceCardPosition();

    return () => window.removeEventListener('scroll', checkPriceCardPosition);
  }, []);

  // Extract unique job categories from line items for contractor-filtered availability
  const jobCategories = useMemo(() => {
    if (!pricingLineItems || pricingLineItems.length === 0) return undefined;
    const cats = Array.from(new Set(pricingLineItems.map(li => li.category).filter(Boolean)));
    return cats.length > 0 ? cats : undefined;
  }, [pricingLineItems]);

  // Estimate total time for full-day detection (>240min = require full day slot)
  const totalEstimatedMinutes = useMemo(() => {
    if (!pricingLineItems) return undefined;
    return pricingLineItems.reduce((sum, li) => sum + (li.timeEstimateMinutes || 0), 0);
  }, [pricingLineItems]);

  // Fetch availability — filtered by contractor pool when categories available
  const { data: availabilityData } = useAvailability({
    categories: jobCategories,
    timeEstimateMinutes: totalEstimatedMinutes,
    days: config.maxDaysOut + 1,
  });

  // Build set of unavailable dates for quick lookup
  const unavailableDates = useMemo(() => {
    const set = new Set<string>();
    if (availabilityData?.dates) {
      for (const d of availabilityData.dates) {
        if (!d.isAvailable) {
          set.add(d.date);
        }
      }
    }
    return set;
  }, [availabilityData]);

  // Generate dates including blocked ones (shown as "Fully Booked" for scarcity)
  // All date calculations anchored to UK time (Europe/London) so dates
  // and next-day / weekend fees are correct regardless of viewer timezone.
  const availableDates = useMemo(() => {
    const ukNow = toZonedTime(new Date(), 'Europe/London');
    const dates: { date: Date; label: string; isWeekend: boolean; isNextDay: boolean; fee: number; isBlocked: boolean }[] = [];
    for (let i = BASE_SCHEDULING_RULES.minDaysOut; i <= config.maxDaysOut; i++) {
      const date = addDays(ukNow, i);
      if (BASE_SCHEDULING_RULES.sundaysClosed && date.getDay() === 0) continue; // Skip Sundays

      const dateStr = formatDateStr(date);
      const isBlocked = unavailableDates.has(dateStr);

      const isSaturday = date.getDay() === 6;
      const isNextDay = i === 1; // Tomorrow (UK time)

      // Calculate fee: next-day and weekend fees can stack
      let fee = 0;
      if (isNextDay) fee += BASE_SCHEDULING_RULES.nextDayFee;
      if (isSaturday && config.showWeekendFee) fee += BASE_SCHEDULING_RULES.weekendFee;

      dates.push({
        date,
        label: format(date, 'EEE d MMM'),
        isWeekend: isSaturday,
        isNextDay,
        fee,
        isBlocked,
      });
    }
    return dates;
  }, [config, unavailableDates]);

  // When urgent_premium mode is disabled, filter out next-day priority dates
  // When allowedDates is set, restrict calendar to only those VA-specified dates
  const allowedDateSet = useMemo(() =>
    allowedDates && allowedDates.length > 0 ? new Set(allowedDates) : null,
  [allowedDates]);

  const filteredDates = availableDates.filter(d => {
    if (!showUrgentPremium && d.isNextDay) return false;
    if (allowedDateSet) {
      const dateStr = d.date.toISOString().slice(0, 10);
      return allowedDateSet.has(dateStr);
    }
    return true;
  });
  const visibleDates = showAllDates ? filteredDates : filteredDates.slice(0, 8);

  // Combine config add-ons with any quote-specific extras
  const allAddOns: AddOnOption[] = useMemo(() => {
    const configAddOns = config.addOns || [];
    const quoteExtras = (optionalExtras || []).map((extra, idx) => ({
      id: `extra_${idx}`,
      name: extra.label,
      description: extra.description || '',
      price: extra.priceInPence,
    }));
    return [...configAddOns, ...quoteExtras];
  }, [config.addOns, optionalExtras]);

  // Calculate total price
  const { total, breakdown, savingsPercent, wasPrice, depositAmount, balanceOnCompletion, payFullTotal, payFullSaving } = useMemo(() => {
    let amount = basePrice;
    const items: { label: string; amount: number }[] = [
      { label: config.priceLabel, amount: basePrice },
    ];

    // Downsell discount
    if (useDownsell && config.downsell) {
      const discount = Math.round(basePrice * (config.downsell.discountPercent / 100));
      amount -= discount;
      items.push({ label: config.downsell.label, amount: -discount });
    }

    // Date fees (next-day and/or weekend)
    const dateInfo = availableDates.find(d =>
      selectedDate && d.date.toDateString() === selectedDate.toDateString()
    );
    if (dateInfo?.isNextDay) {
      amount += BASE_SCHEDULING_RULES.nextDayFee;
      items.push({ label: 'Priority (next day)', amount: BASE_SCHEDULING_RULES.nextDayFee });
    }
    if (dateInfo?.isWeekend && config.showWeekendFee) {
      amount += BASE_SCHEDULING_RULES.weekendFee;
      items.push({ label: 'Weekend', amount: BASE_SCHEDULING_RULES.weekendFee });
    }

    // Time slot fee
    const timeInfo = BASE_TIME_SLOTS.find(t => t.id === selectedTimeSlot);
    if (timeInfo?.fee) {
      amount += timeInfo.fee;
      items.push({ label: timeInfo.label, amount: timeInfo.fee });
    }

    // Add-ons
    selectedAddOns.forEach(addOnId => {
      const addOn = allAddOns.find(a => a.id === addOnId);
      if (addOn && addOn.price > 0) {
        amount += addOn.price;
        items.push({ label: addOn.name, amount: addOn.price });
      }
    });

    // Apply psychological pricing to avoid round numbers (Ramanujam principle)
    const adjustedAmount = applyPsychologicalPricing(amount);

    // Calculate "was" price for discount badge
    // If we have real batch discount data, use the actual subtotal (before discount)
    // Otherwise fall back to the old 1.18x markup for BUDGET segment
    let was: number;
    let savings: number;
    if (batchDiscount?.applied && batchDiscount.savingsPence > 0) {
      // Real data: "was" = current price + actual savings
      was = adjustedAmount + batchDiscount.savingsPence;
      savings = batchDiscount.discountPercent;
    } else {
      was = Math.round(basePrice * 1.18);
      savings = Math.round(((was - adjustedAmount) / was) * 100);
    }

    // Deposit model: 100% of materials upfront + 30% of labour
    const totalMaterialsPence = pricingLineItems
      ? pricingLineItems.reduce((sum, li) => sum + (li.materialsWithMarginPence || 0), 0)
      : 0;
    const labourPortion = adjustedAmount - totalMaterialsPence;
    const depositAmount = totalMaterialsPence > 0
      ? applyPsychologicalPricing(totalMaterialsPence + Math.round(labourPortion * DEPOSIT_PERCENT))
      : applyPsychologicalPricing(Math.round(adjustedAmount * DEPOSIT_PERCENT));
    const balanceOnCompletion = adjustedAmount - depositAmount;

    // Pay-in-full discount: small incentive for guaranteed cash flow
    const payFullTotal = applyPsychologicalPricing(Math.round(adjustedAmount * (1 - PAY_FULL_DISCOUNT)));
    const payFullSaving = adjustedAmount - payFullTotal;

    return { total: adjustedAmount, breakdown: items, wasPrice: was, savingsPercent: savings, depositAmount, balanceOnCompletion, payFullTotal, payFullSaving };
  }, [basePrice, selectedDate, selectedTimeSlot, selectedAddOns, useDownsell, availableDates, allAddOns, config, batchDiscount, pricingLineItems]);

  // Determine if we should show inline payment
  // Show inline Stripe card entry when date + time are selected (all segments) or when using downsell
  const showInlinePayment = useDownsell || (selectedDate && selectedTimeSlot);

  // Create payment intent when inline payment should be shown
  useEffect(() => {
    if (!showInlinePayment || !quoteId || !stripe || !effectiveEmail) {
      setClientSecret(null);
      setPaymentIntentId(null);
      return;
    }

    const abortController = new AbortController();
    let isCurrentRequest = true;

    const createPaymentIntent = async () => {
      setIsLoadingPaymentIntent(true);
      setPaymentError(null);

      try {
        const response = await fetch('/api/create-payment-intent', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            customerName,
            customerEmail: effectiveEmail,
            quoteId,
            selectedTier: 'standard', // Legacy field — single price model
            selectedExtras: selectedAddOns,
            paymentType: payFull ? 'full' : 'deposit',
            chargeAmountPence: payFull ? payFullTotal : depositAmount,
            flexibleTiming: useDownsell,
            flexiblePeriodDays: useDownsell ? config.downsell?.periodDays : undefined,
          }),
          signal: abortController.signal,
        });

        if (!isCurrentRequest) return;

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          throw new Error(errorData.message || `Server error: ${response.status}`);
        }

        const data = await response.json();

        if (!data.clientSecret) {
          throw new Error('Failed to create payment intent');
        }

        setClientSecret(data.clientSecret);
        setPaymentIntentId(data.paymentIntentId);
      } catch (err: any) {
        if (err.name === 'AbortError' || !isCurrentRequest) return;
        setPaymentError(err.message || 'Failed to initialize payment');
      } finally {
        if (isCurrentRequest) {
          setIsLoadingPaymentIntent(false);
        }
      }
    };

    createPaymentIntent();

    return () => {
      isCurrentRequest = false;
      abortController.abort();
    };
  }, [showInlinePayment, useDownsell, quoteId, customerName, effectiveEmail, total, selectedAddOns, segment, config.downsell?.periodDays, stripe, payFull, payFullTotal, depositAmount]);

  // Handle inline payment submission
  const handlePayment = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!stripe || !elements || !clientSecret || !paymentIntentId) return;

    setIsProcessingPayment(true);
    setPaymentError(null);

    try {
      const cardElement = elements.getElement(CardElement);
      if (!cardElement) throw new Error('Card element not found');

      const { error: stripeError, paymentIntent } = await stripe.confirmCardPayment(
        clientSecret,
        {
          payment_method: {
            card: cardElement,
            billing_details: {
              name: customerName,
              email: effectiveEmail,
            },
          },
        }
      );

      if (stripeError) throw new Error(stripeError.message);

      if (paymentIntent?.status === 'succeeded') {
        // First call onBook to set booking details in parent state
        onBook({
          selectedDate: useDownsell ? null : selectedDate,
          timeSlot: useDownsell ? null : selectedTimeSlot,
          addOns: selectedAddOns,
          totalPrice: total,
          usedDownsell: useDownsell,
          flexiblePeriodDays: useDownsell ? config.downsell?.periodDays : undefined,
        });

        // Then call onPaymentSuccess to complete the booking
        if (onPaymentSuccess) {
          await onPaymentSuccess(paymentIntentId);
        }
      } else {
        throw new Error('Payment failed');
      }
    } catch (err: any) {
      setPaymentError(err.message || 'Payment failed. Please try again.');
    } finally {
      setIsProcessingPayment(false);
    }
  };

  const toggleAddOn = (id: string) => {
    setSelectedAddOns(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    );
  };

  // Can book if: downsell selected (flexible timing) OR both date and time selected
  const canBook = useDownsell || (selectedDate && selectedTimeSlot);

  const handleBook = () => {
    const chargeNow = payFull ? payFullTotal : depositAmount;
    const balance = payFull ? 0 : balanceOnCompletion;
    const mode = payFull ? 'full' as const : 'deposit' as const;

    // If using downsell, date/time are flexible (we pick)
    if (useDownsell) {
      onBook({
        selectedDate: null,
        timeSlot: null,
        addOns: selectedAddOns,
        totalPrice: total,
        chargeNowPence: chargeNow,
        balanceOnCompletionPence: balance,
        paymentMode: mode,
        usedDownsell: true,
        flexiblePeriodDays: config.downsell?.periodDays,
      });
      return;
    }

    if (!selectedDate || !selectedTimeSlot) return;
    onBook({
      selectedDate,
      timeSlot: selectedTimeSlot,
      addOns: selectedAddOns,
      totalPrice: total,
      chargeNowPence: chargeNow,
      balanceOnCompletionPence: balance,
      paymentMode: mode,
      usedDownsell: false,
    });
  };

  // Theme based on config - useCardWrapper determines if we show in a dark card
  const useCardWrapper = config.useCardWrapper !== false; // defaults to true if not specified
  const isDarkTheme = useCardWrapper; // dark theme only when in card wrapper

  return (
    <div className={`${isDarkTheme ? 'bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 rounded-3xl overflow-hidden shadow-2xl' : ''}`}>
      {/* Header Badge removed — replaced by QuoteTimer pill */}

      <div className={`${isDarkTheme ? 'p-6' : ''} space-y-6`}>
        {/* Price Display */}
        <div ref={priceCardRef} className={`text-center ${!isDarkTheme ? 'bg-gradient-to-br from-green-50 to-emerald-50 border-2 border-[#7DB00E] rounded-2xl p-6' : ''}`}>
          {/* Discount Badge — only show when there's a real savings to display and not in pay-full mode */}
          {!payFull && config.showDiscountBadge && savingsPercent > 0 && (
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#7DB00E] text-white text-xs font-bold mb-4">
              <Percent className="w-3.5 h-3.5" />
              SAVE {savingsPercent}%
            </div>
          )}

          <div className={`${isDarkTheme ? 'text-slate-400' : 'text-slate-600'} text-sm mb-1`}>
            {customerName.split(' ')[0]}, your quote
          </div>

          <div className="mb-1">
            {config.showDiscountBadge && savingsPercent > 0 && !payFull && (
              <span className="text-slate-400 line-through text-xl mr-3">
                £{Math.round(wasPrice / 100)}
              </span>
            )}
            <AnimatePresence mode="wait">
              {payFull ? (
                <motion.div
                  key="full"
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  transition={{ duration: 0.2 }}
                  className="inline-block"
                >
                  <div className="flex items-baseline justify-center gap-1.5">
                    <span className="text-slate-400 line-through text-xl mr-1">
                      £{Math.round(total / 100)}
                    </span>
                    <span className={`text-5xl font-black ${isDarkTheme ? 'text-white' : 'text-[#7DB00E]'}`}>
                      £{Math.round(payFullTotal / 100)}
                    </span>
                  </div>
                  <div className={`text-xs mt-1 ${isDarkTheme ? 'text-slate-500' : 'text-slate-500'}`}>
                    Save £{Math.round(payFullSaving / 100)} · pay today, nothing on the day
                  </div>
                </motion.div>
              ) : (
                <motion.div
                  key="deposit"
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  transition={{ duration: 0.2 }}
                  className="inline-block"
                >
                  <span className={`text-5xl font-black ${isDarkTheme ? 'text-white' : 'text-[#7DB00E]'}`}>
                    £{Math.round(total / 100)}
                  </span>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Payment mode toggle: Deposit (default) / Pay in full */}
          <div className="mt-3 mb-2 flex justify-center">
            <div className={`inline-flex rounded-full p-0.5 text-xs font-semibold ${isDarkTheme ? 'bg-white/10' : 'bg-slate-200/80'}`}>
              <button
                type="button"
                onClick={() => setPayFull(false)}
                className={`relative px-4 py-1.5 rounded-full transition-all duration-200 ${
                  !payFull
                    ? 'bg-white text-slate-900 shadow-sm'
                    : isDarkTheme ? 'text-slate-400 hover:text-slate-200' : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                Reserve — £{Math.round(depositAmount / 100)} today
              </button>
              <button
                type="button"
                onClick={() => setPayFull(true)}
                className={`relative px-4 py-1.5 rounded-full transition-all duration-200 flex items-center gap-1.5 ${
                  payFull
                    ? 'bg-white text-slate-900 shadow-sm'
                    : isDarkTheme ? 'text-slate-400 hover:text-slate-200' : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                Pay in full
                <span className="text-[#7DB00E] font-bold">-{Math.round(PAY_FULL_DISCOUNT * 100)}%</span>
              </button>
            </div>
          </div>

          <div className={`text-sm ${isDarkTheme ? 'text-slate-400' : 'text-slate-600'}`}>
            {payFull
              ? `Pay £${Math.round(payFullTotal / 100)} now — nothing on the day`
              : `£${Math.round(depositAmount / 100)} deposit · £${Math.round(balanceOnCompletion / 100)} on completion`
            }
          </div>

          {/* Inline Price Breakdown (always visible) */}
          {pricingLineItems && pricingLineItems.length > 0 && (
            <div className={`mt-3 pt-3 border-t text-left space-y-2 ${isDarkTheme ? 'border-white/10' : 'border-[#7DB00E]/20'}`}>
              {pricingLineItems.map((item) => {
                const materialsStr = (item.materialsWithMarginPence || 0) > 0
                  ? `incl. materials`
                  : '';
                return (
                  <div key={item.lineId} className="flex justify-between items-start gap-3 text-sm">
                    <div className="min-w-0">
                      <span className={isDarkTheme ? 'text-slate-200' : 'text-slate-800'}>{item.description}</span>
                      {materialsStr && (
                        <span className={`ml-1.5 ${isDarkTheme ? 'text-slate-500' : 'text-slate-400'}`}>
                          · {materialsStr}
                        </span>
                      )}
                    </div>
                    <span className={`font-medium whitespace-nowrap ${isDarkTheme ? 'text-white' : 'text-slate-900'}`}>
                      £{Math.round((item.guardedPricePence + (item.materialsWithMarginPence || 0)) / 100)}
                    </span>
                  </div>
                );
              })}
              {batchDiscount?.applied && (
                <div className="flex justify-between text-sm">
                  <span className="text-[#7DB00E] font-medium">Multi-job discount ({batchDiscount.discountPercent}%)</span>
                  <span className="text-[#7DB00E] font-medium">-£{Math.round(batchDiscount.savingsPence / 100)}</span>
                </div>
              )}
              <div className={`border-t pt-2 flex justify-between font-bold ${isDarkTheme ? 'border-white/10' : 'border-slate-200'}`}>
                <span className={isDarkTheme ? 'text-white' : 'text-slate-900'}>Total</span>
                <span className="text-[#7DB00E]">£{Math.round(total / 100)}</span>
              </div>
            </div>
          )}

          {/* WhatsApp question link — reduces decision anxiety */}
          <div className="mt-3 text-center">
            <a
              href={`https://wa.me/447508744402?text=${encodeURIComponent(`Hi, I have a question about my quote${shortSlug ? ` (${shortSlug})` : ''}`)}`}
              target="_blank"
              rel="noopener noreferrer"
              className={`inline-flex items-center gap-1.5 text-xs transition-colors ${
                isDarkTheme ? 'text-slate-400 hover:text-slate-200' : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              <MessageCircle className="w-3.5 h-3.5" />
              Have a question? Chat with us
            </a>
          </div>

          {/* What's Included - Contextual bullets override segment-driven */}
          <div className={`mt-4 pt-4 border-t ${isDarkTheme ? 'border-white/10' : 'border-[#7DB00E]/20'}`}>
            <div className={`flex flex-wrap justify-center gap-x-4 gap-y-2 text-sm ${isDarkTheme ? 'text-slate-300' : 'text-slate-700'}`}>
              {contextualBullets && contextualBullets.length > 0
                ? contextualBullets.map((bullet, i) => (
                    <div key={i} className="flex items-center gap-1.5">
                      <span className="text-[#7DB00E]"><Check className="w-4 h-4" /></span>
                      {bullet}
                    </div>
                  ))
                : getHassleComparisons(segment, 3).map((item, i) => (
                    <div key={i} className="flex items-center gap-1.5">
                      <span className="text-[#7DB00E]"><Check className="w-4 h-4" /></span>
                      {item.withUs}
                    </div>
                  ))
              }
            </div>
          </div>
        </div>

        {/* Downsell Option (if available and flexible_discount mode enabled) */}
        {config.downsell && showFlexibleDiscount && (
          <div className={`rounded-xl p-4 ${useDownsell
            ? 'bg-[#7DB00E]/20 border-2 border-[#7DB00E]'
            : isDarkTheme ? 'bg-white/10 border-2 border-white/10' : 'bg-slate-100 border-2 border-transparent'
          }`}>
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={useDownsell}
                onChange={() => {
                  const newValue = !useDownsell;
                  setUseDownsell(newValue);
                  // Clear date/time selection when toggling downsell
                  if (newValue) {
                    setSelectedDate(null);
                    setSelectedTimeSlot(null);
                    // Scroll to add-ons or book section
                    setTimeout(() => {
                      if (allAddOns.length > 0) {
                        addOnsSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                      } else {
                        bookSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                      }
                    }, 150);
                  }
                }}
                className={`w-5 h-5 rounded text-[#7DB00E] focus:ring-[#7DB00E] ${isDarkTheme ? 'border-white/30 bg-white/10' : 'border-slate-300'}`}
              />
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <span className={`font-bold ${isDarkTheme ? 'text-white' : 'text-slate-900'}`}>{config.downsell.label}</span>
                  <span className="text-xs bg-[#7DB00E] text-white px-2 py-0.5 rounded-full font-bold">
                    -{config.downsell.discountPercent}%
                  </span>
                </div>
                <p className={`text-sm ${isDarkTheme ? 'text-slate-400' : 'text-slate-600'}`}>{config.downsell.description}</p>
              </div>
            </label>

            {/* Show confirmation when selected */}
            {useDownsell && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                className="mt-4 pt-4 border-t border-[#7DB00E]/30"
              >
                <div className={`flex items-center gap-3 ${isDarkTheme ? 'text-slate-200' : 'text-slate-700'}`}>
                  <div className="w-10 h-10 rounded-full bg-[#7DB00E] flex items-center justify-center flex-shrink-0">
                    <Check className="w-5 h-5 text-white" />
                  </div>
                  <div>
                    <p className="font-semibold">We'll schedule you {config.downsell.periodLabel}</p>
                    <p className={`text-sm ${isDarkTheme ? 'text-slate-400' : 'text-slate-500'}`}>Best available slot on our route - you save {config.downsell.discountPercent}%</p>
                  </div>
                </div>
              </motion.div>
            )}
          </div>
        )}

        {/* Step 1: Date Selection - Hidden when using downsell or when standard_date mode disabled */}
        {!useDownsell && showStandardDate && (
        <div ref={dateSectionRef}>
          <h4 className={`text-sm font-bold uppercase tracking-wide mb-3 flex items-center gap-2 ${isDarkTheme ? 'text-white' : 'text-slate-700'}`}>
            <Calendar className="w-4 h-4 text-[#7DB00E]" />
            1. Choose your date
          </h4>
          <div className="grid grid-cols-4 gap-2">
            {visibleDates.map((d) => (
              <button
                key={d.date.toISOString()}
                onClick={() => {
                  if (d.isBlocked) return;
                  setSelectedDate(d.date);
                  // Scroll to time section after a brief delay for animation
                  setTimeout(() => {
                    timeSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                  }, 150);
                }}
                disabled={d.isBlocked}
                className={`p-3 rounded-xl text-center transition-all relative ${
                  d.isBlocked
                    ? 'opacity-50 cursor-not-allowed' + (isDarkTheme ? ' bg-white/5 text-slate-500' : ' bg-slate-100 text-slate-400 border border-slate-200')
                    : selectedDate?.toDateString() === d.date.toDateString()
                    ? 'bg-[#7DB00E] text-slate-900 ring-2 ring-[#7DB00E] ring-offset-2' + (isDarkTheme ? ' ring-offset-slate-900' : '')
                    : d.isNextDay
                      ? 'date-card-shimmer ' + (isDarkTheme
                        ? 'bg-amber-500/20 text-white hover:bg-amber-500/30 border border-amber-500/50'
                        : 'bg-amber-50 text-slate-700 hover:bg-amber-100 border border-amber-300')
                      : 'date-card-shimmer ' + (isDarkTheme
                        ? 'bg-white/10 text-white hover:bg-white/20'
                        : 'bg-slate-100 text-slate-700 hover:bg-slate-200')
                }`}
              >
                {d.isNextDay && !d.isBlocked && (
                  <div className="absolute -top-1.5 left-1/2 -translate-x-1/2 text-[8px] font-bold bg-amber-500 text-white px-1.5 py-0.5 rounded">
                    PRIORITY
                  </div>
                )}
                <div className="text-xs font-medium">{format(d.date, 'EEE')}</div>
                <div className="text-lg font-bold">{format(d.date, 'd')}</div>
                {d.isBlocked ? (
                  <div className="text-[9px] font-semibold text-red-500 mt-0.5">Fully Booked</div>
                ) : d.fee > 0 ? (
                  <div className="text-[10px] text-amber-400 mt-0.5">+£{d.fee / 100}</div>
                ) : null}
              </button>
            ))}
          </div>
          {!showAllDates && filteredDates.length > 8 && (
            <button
              onClick={() => setShowAllDates(true)}
              className="w-full mt-2 text-sm text-[#7DB00E] font-medium hover:underline"
            >
              Show more dates...
            </button>
          )}
        </div>
        )}

        {/* Step 2: Time Selection (after date) - Hidden when using downsell */}
        <AnimatePresence>
          {!useDownsell && selectedDate && (
            <motion.div
              ref={timeSectionRef}
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
            >
              <h4 className={`text-sm font-bold uppercase tracking-wide mb-3 flex items-center gap-2 ${isDarkTheme ? 'text-white' : 'text-slate-700'}`}>
                <Clock className="w-4 h-4 text-[#7DB00E]" />
                2. Choose arrival window
              </h4>
              <div className="grid grid-cols-2 gap-2">
                {timeSlots.map((slot) => (
                  <button
                    key={slot.id}
                    onClick={() => {
                      setSelectedTimeSlot(slot.id);
                      // Scroll to add-ons or book section after a brief delay
                      setTimeout(() => {
                        if (allAddOns.length > 0) {
                          addOnsSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                        } else {
                          bookSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                        }
                      }, 150);
                    }}
                    className={`p-3 rounded-xl text-left transition-all ${
                      selectedTimeSlot === slot.id
                        ? 'bg-[#7DB00E] text-slate-900'
                        : isDarkTheme
                          ? 'bg-white/10 text-white hover:bg-white/20'
                          : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                    }`}
                  >
                    <div className="font-semibold text-sm">{slot.label}</div>
                    <div className={`text-xs ${selectedTimeSlot === slot.id ? 'text-slate-700' : isDarkTheme ? 'text-slate-400' : 'text-slate-500'}`}>
                      {slot.description}
                    </div>
                    {slot.fee > 0 && (
                      <div className={`text-xs mt-1 ${selectedTimeSlot === slot.id ? 'text-slate-700' : 'text-amber-500'}`}>
                        +£{slot.fee / 100}
                      </div>
                    )}
                  </button>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Step 3: Add-ons (after time OR when using downsell) */}
        <AnimatePresence>
          {(useDownsell || selectedTimeSlot) && allAddOns.length > 0 && (
            <motion.div
              ref={addOnsSectionRef}
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
            >
              <h4 className={`text-sm font-bold ${config.addOnsLabel ? '' : 'uppercase'} tracking-wide mb-3 flex items-center gap-2 ${isDarkTheme ? 'text-white' : 'text-slate-700'}`}>
                <Tag className="w-4 h-4 text-[#7DB00E]" />
                {config.addOnsLabel
                  ? config.addOnsLabel.replace('{location}', location || 'local')
                  : (useDownsell ? 'Add extras (optional)' : '3. Add extras (optional)')}
              </h4>
              <div className="space-y-2">
                {allAddOns.map((addOn) => {
                  const isSelected = selectedAddOns.includes(addOn.id);
                  return (
                    <button
                      key={addOn.id}
                      onClick={() => toggleAddOn(addOn.id)}
                      className={`w-full p-4 rounded-xl flex items-center gap-4 transition-all ${
                        isSelected
                          ? 'bg-[#7DB00E]/20 border-2 border-[#7DB00E]'
                          : isDarkTheme
                            ? 'bg-white/5 border-2 border-transparent hover:bg-white/10'
                            : 'bg-slate-50 border-2 border-transparent hover:bg-slate-100'
                      }`}
                    >
                      <div className={`p-2 rounded-lg ${isSelected ? 'bg-[#7DB00E] text-slate-900' : isDarkTheme ? 'bg-white/10 text-slate-400' : 'bg-slate-200 text-slate-500'}`}>
                        {addOn.id.includes('task') || addOn.id.includes('extra') ? <Zap className="w-5 h-5" /> :
                         addOn.id.includes('photo') ? <Camera className="w-5 h-5" /> :
                         addOn.id.includes('warranty') ? <Shield className="w-5 h-5" /> :
                         <Plus className="w-5 h-5" />}
                      </div>
                      <div className="flex-1 text-left">
                        <div className="flex items-center gap-2">
                          <span className={`font-medium ${isDarkTheme ? 'text-white' : 'text-slate-900'}`}>{addOn.name}</span>
                          {addOn.popular && (
                            <span className="text-[10px] bg-amber-500/20 text-amber-500 px-2 py-0.5 rounded-full font-medium">
                              POPULAR
                            </span>
                          )}
                        </div>
                        <div className={`text-sm ${isDarkTheme ? 'text-slate-400' : 'text-slate-500'}`}>{addOn.description}</div>
                      </div>
                      <div className="text-right">
                        <div className={`font-bold ${addOn.price === 0 ? 'text-[#7DB00E]' : isDarkTheme ? 'text-white' : 'text-slate-900'}`}>
                          {addOn.price === 0 ? 'FREE' : `+£${addOn.price / 100}`}
                        </div>
                        <div className={`w-6 h-6 rounded-full flex items-center justify-center ${isSelected ? 'bg-[#7DB00E]' : isDarkTheme ? 'bg-white/10' : 'bg-slate-200'}`}>
                          {isSelected ? (
                            <Check className="w-4 h-4 text-slate-900" />
                          ) : (
                            <Plus className="w-4 h-4 text-slate-500" />
                          )}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Price Breakdown (if multiple items) */}
        <AnimatePresence>
          {canBook && breakdown.length > 1 && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className={`rounded-xl p-4 space-y-2 ${isDarkTheme ? 'bg-white/5' : 'bg-slate-100'}`}
            >
              {breakdown.map((item, i) => (
                <div key={i} className="flex justify-between text-sm">
                  <span className={isDarkTheme ? 'text-slate-400' : 'text-slate-600'}>{item.label}</span>
                  <span className={`${item.amount < 0 ? 'text-[#7DB00E]' : isDarkTheme ? 'text-white' : 'text-slate-900'}`}>
                    {item.amount < 0 ? '-' : ''}£{Math.abs(Math.round(item.amount / 100))}
                  </span>
                </div>
              ))}
              <div className={`border-t pt-2 flex justify-between font-bold ${isDarkTheme ? 'border-white/10' : 'border-slate-200'}`}>
                <span className={isDarkTheme ? 'text-white' : 'text-slate-900'}>Total</span>
                <span className="text-[#7DB00E] text-lg">£{Math.round(total / 100)}</span>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Payment/Book Section */}
        <div ref={bookSectionRef}>
        {showInlinePayment && stripe ? (
          /* Inline Stripe card entry — auto-reveals when date + time selected */
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3 }}
            className="space-y-4"
          >
            <h4 className={`text-sm font-bold uppercase tracking-wide flex items-center gap-2 ${isDarkTheme ? 'text-white' : 'text-slate-700'}`}>
              <CreditCard className="w-4 h-4 text-[#7DB00E]" />
              3. Secure your slot
            </h4>
            <div className={`rounded-xl p-4 ${isDarkTheme ? 'bg-white/5' : 'bg-slate-50'}`}>
              <div className="flex items-center gap-2 mb-3">
                <Lock className={`w-3.5 h-3.5 ${isDarkTheme ? 'text-slate-500' : 'text-slate-400'}`} />
                <span className={`text-xs ${isDarkTheme ? 'text-slate-400' : 'text-slate-500'}`}>
                  256-bit encrypted
                </span>
              </div>

              {!effectiveEmail ? (
                <div className="space-y-2">
                  <label className={`text-sm font-medium ${isDarkTheme ? 'text-slate-300' : 'text-slate-600'}`}>
                    Email for receipt
                  </label>
                  <input
                    type="email"
                    value={inlineEmail}
                    onChange={e => setInlineEmail(e.target.value)}
                    placeholder="your@email.com"
                    className={`w-full border rounded-lg p-3 text-base outline-none focus:ring-2 focus:ring-[#7DB00E]/40 ${
                      isDarkTheme ? 'border-white/20 bg-slate-800 text-white' : 'border-slate-200 bg-white text-slate-900'
                    }`}
                  />
                </div>
              ) : isLoadingPaymentIntent ? (
                <div className="flex items-center justify-center py-6">
                  <Loader2 className="w-6 h-6 animate-spin text-[#7DB00E]" />
                  <span className={`ml-2 text-sm ${isDarkTheme ? 'text-slate-400' : 'text-slate-500'}`}>
                    Setting up secure payment...
                  </span>
                </div>
              ) : paymentError && !clientSecret ? (
                <Alert variant="destructive" className="bg-red-50 border-red-200">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>{paymentError}</AlertDescription>
                </Alert>
              ) : (
                <form onSubmit={handlePayment}>
                  <div className={`border rounded-lg p-3 mb-4 ${isDarkTheme ? 'border-white/20 bg-slate-800' : 'border-slate-200 bg-white'}`}>
                    <CardElement
                      options={{
                        hidePostalCode: false,
                        style: {
                          base: {
                            fontSize: '16px',
                            fontFamily: 'system-ui, -apple-system, sans-serif',
                            color: isDarkTheme ? '#ffffff' : '#1e293b',
                            backgroundColor: 'transparent',
                            iconColor: '#7DB00E',
                            '::placeholder': {
                              color: isDarkTheme ? '#64748b' : '#94a3b8',
                            },
                          },
                          invalid: {
                            color: '#ef4444',
                            iconColor: '#ef4444',
                          },
                          complete: {
                            color: '#22c55e',
                            iconColor: '#22c55e',
                          },
                        },
                      }}
                    />
                  </div>

                  {paymentError && (
                    <Alert variant="destructive" className="mb-4 bg-red-50 border-red-200">
                      <AlertCircle className="h-4 w-4" />
                      <AlertDescription>{paymentError}</AlertDescription>
                    </Alert>
                  )}

                  <Button
                    type="submit"
                    disabled={!clientSecret || isProcessingPayment || !isStripeConfigured}
                    className="w-full h-14 rounded-2xl font-bold text-lg bg-[#7DB00E] hover:bg-[#6da000] text-slate-900 transition-all"
                  >
                    {isProcessingPayment ? (
                      <span className="flex items-center gap-2">
                        <Loader2 className="w-5 h-5 animate-spin" />
                        Processing...
                      </span>
                    ) : (
                      <span className="flex items-center gap-2">
                        {payFull
                          ? `Pay £${Math.round(payFullTotal / 100)} now`
                          : `Pay £${Math.round(depositAmount / 100)} deposit`
                        }
                        <ChevronRight className="w-5 h-5" />
                      </span>
                    )}
                  </Button>
                </form>
              )}

              <p className={`text-xs text-center mt-3 ${isDarkTheme ? 'text-slate-500' : 'text-slate-400'}`}>
                {payFull
                  ? 'Secure payment powered by Stripe'
                  : `£${Math.round(balanceOnCompletion / 100)} remaining on completion · Secure payment by Stripe`
                }
              </p>
            </div>
          </motion.div>
        ) : (
          /* Regular Book Button - only show when canBook (date+time selected) */
          canBook && (
            <Button
              onClick={handleBook}
              disabled={!canBook || isBooking}
              className={`w-full h-14 rounded-2xl font-bold text-lg transition-all ${
                canBook
                  ? 'bg-[#7DB00E] hover:bg-[#6da000] text-slate-900'
                  : isDarkTheme
                    ? 'bg-white/10 text-slate-500 cursor-not-allowed'
                    : 'bg-slate-200 text-slate-400 cursor-not-allowed'
              }`}
            >
              {isBooking ? (
                <span className="flex items-center gap-2">
                  <Timer className="w-5 h-5 animate-spin" />
                  Booking...
                </span>
              ) : canBook ? (
                <span className="flex items-center gap-2">
                  {payFull
                    ? `Pay £${Math.round(payFullTotal / 100)} now`
                    : `Reserve — pay £${Math.round(depositAmount / 100)} deposit`
                  }
                  <ChevronRight className="w-5 h-5" />
                </span>
              ) : (
                'Select date & time to book'
              )}
            </Button>
          )
        )}
        </div>

        {/* Trust Guarantees */}
        <div className={`rounded-xl border divide-y ${isDarkTheme ? 'bg-white/5 border-white/10 divide-white/10' : 'bg-white border-slate-200 divide-slate-100'}`}>
          {[
            { icon: Shield, text: '£2M insured', sub: 'Your property is protected' },
            { icon: Lock, text: 'Fixed price', sub: 'No surprises on the day' },
            { icon: Check, text: '30-day guarantee', sub: 'Not right? We fix it free' },
          ].map(({ icon: Icon, text, sub }) => (
            <div key={text} className="flex items-center gap-3 px-4 py-3">
              <div className="w-8 h-8 rounded-full bg-[#7DB00E]/10 flex items-center justify-center flex-shrink-0">
                <Icon className="w-4 h-4 text-[#7DB00E]" />
              </div>
              <div>
                <span className={`text-sm font-medium ${isDarkTheme ? 'text-white' : 'text-slate-900'}`}>{text}</span>
                <span className={`text-sm ${isDarkTheme ? 'text-slate-400' : 'text-slate-500'}`}> · {sub}</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Sticky bottom CTA — portaled to body to avoid transform containment breaking fixed positioning */}
      {createPortal(
        <AnimatePresence>
          {showStickyCTA && (
            <motion.div
              initial={{ y: 100, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 100, opacity: 0 }}
              transition={{ type: 'spring', stiffness: 300, damping: 30 }}
              className="fixed bottom-0 left-0 right-0 z-50 safe-area-bottom"
            >
              {/* Timer progress bar on top edge */}
              <StickyTimerProgress />
              <div className="bg-white border-t border-slate-200 shadow-[0_-4px_20px_rgba(0,0,0,0.12)] px-4 py-3">
                <div className="max-w-lg mx-auto flex items-center justify-between gap-3">
                  <div className="flex-shrink-0">
                    <p className="text-xs text-slate-500">{payFull ? 'Pay today' : 'Reserve from'}</p>
                    <p className="text-2xl font-black text-[#7DB00E] leading-tight">
                      £{payFull ? Math.round(payFullTotal / 100) : Math.round(depositAmount / 100)}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      dateSectionRef.current?.scrollIntoView({
                        behavior: 'smooth',
                        block: 'center',
                      });
                    }}
                    className="flex-1 max-w-[220px] bg-[#7DB00E] hover:bg-[#6a9a0c] active:scale-[0.98] text-white font-bold py-3 px-5 rounded-xl text-sm transition-all flex items-center justify-center gap-2 shadow-lg shadow-[#7DB00E]/25"
                  >
                    <Calendar className="w-4 h-4" />
                    Choose your date
                  </button>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>,
        document.body
      )}
    </div>
  );
}
