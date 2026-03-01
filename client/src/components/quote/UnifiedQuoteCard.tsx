import React, { useState, useMemo, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Check, Calendar, Clock, Tag, Shield, Zap,
  ChevronRight, Percent, Sparkles, Star, Plus,
  Phone, Camera, Timer, Lock, CreditCard, Loader2, AlertCircle
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { format, addDays, isWeekend } from 'date-fns';
import { toZonedTime } from 'date-fns-tz';
import { CardElement, useStripe, useElements } from '@stripe/react-stripe-js';
import { isStripeConfigured } from '@/lib/stripe';
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
    usedDownsell: boolean;
    flexiblePeriodDays?: number; // When using downsell, how many days flexibility
  }) => void;
  onPaymentSuccess?: (paymentIntentId: string) => Promise<void>;
  isBooking?: boolean;
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
}: UnifiedQuoteCardProps) {
  // Stripe hooks (will be null if not wrapped in Elements provider)
  const stripe = useStripe();
  const elements = useElements();
  // Get segment-specific config
  const config = getSchedulingConfig(segment);
  const timeSlots = getTimeSlotsForSegment(segment);

  // State
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [selectedTimeSlot, setSelectedTimeSlot] = useState<string | null>(null);
  const [selectedAddOns, setSelectedAddOns] = useState<string[]>([]);
  const [useDownsell, setUseDownsell] = useState(false);
  const [showAllDates, setShowAllDates] = useState(false);

  // Payment state (for inline payment when using downsell)
  const [isProcessingPayment, setIsProcessingPayment] = useState(false);
  const [paymentError, setPaymentError] = useState<string | null>(null);
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [paymentIntentId, setPaymentIntentId] = useState<string | null>(null);
  const [isLoadingPaymentIntent, setIsLoadingPaymentIntent] = useState(false);

  // Refs for scroll behavior
  const timeSectionRef = useRef<HTMLDivElement>(null);
  const addOnsSectionRef = useRef<HTMLDivElement>(null);
  const bookSectionRef = useRef<HTMLDivElement>(null);

  // Fetch system-wide availability (blocked dates, etc.)
  const { data: availabilityData } = useAvailability({
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

  // Generate available dates (filtering out blocked/unavailable)
  // All date calculations anchored to UK time (Europe/London) so dates
  // and next-day / weekend fees are correct regardless of viewer timezone.
  const availableDates = useMemo(() => {
    const ukNow = toZonedTime(new Date(), 'Europe/London');
    const dates: { date: Date; label: string; isWeekend: boolean; isNextDay: boolean; fee: number }[] = [];
    for (let i = BASE_SCHEDULING_RULES.minDaysOut; i <= config.maxDaysOut; i++) {
      const date = addDays(ukNow, i);
      if (BASE_SCHEDULING_RULES.sundaysClosed && date.getDay() === 0) continue; // Skip Sundays

      // Skip blocked/unavailable dates
      const dateStr = formatDateStr(date);
      if (unavailableDates.has(dateStr)) continue;

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
      });
    }
    return dates;
  }, [config, unavailableDates]);

  const visibleDates = showAllDates ? availableDates : availableDates.slice(0, 8);

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
  const { total, breakdown, savingsPercent, wasPrice } = useMemo(() => {
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

    // Calculate "was" price for discount badge (BUDGET segment)
    const was = Math.round(basePrice * 1.18);
    const savings = Math.round(((was - adjustedAmount) / was) * 100);

    return { total: adjustedAmount, breakdown: items, wasPrice: was, savingsPercent: savings };
  }, [basePrice, selectedDate, selectedTimeSlot, selectedAddOns, useDownsell, availableDates, allAddOns, config]);

  // Determine if we should show inline payment
  // For BUDGET & BUSY_PRO: show inline payment when date + time selected OR when using downsell
  // For other segments with downsell: show inline payment when using downsell
  const showInlinePayment = (segment === 'BUDGET' || segment === 'BUSY_PRO')
    ? (useDownsell || (selectedDate && selectedTimeSlot))
    : useDownsell;

  // Create payment intent when inline payment should be shown
  useEffect(() => {
    if (!showInlinePayment || !quoteId || !stripe) {
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
            customerEmail,
            quoteId,
            selectedTier: segment === 'BUDGET' ? 'essential' : 'enhanced',
            selectedTierPrice: total,
            selectedExtras: selectedAddOns,
            paymentType: 'full',
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
  }, [showInlinePayment, useDownsell, quoteId, customerName, customerEmail, total, selectedAddOns, segment, config.downsell?.periodDays, stripe]);

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
              email: customerEmail,
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
    // If using downsell, date/time are flexible (we pick)
    if (useDownsell) {
      onBook({
        selectedDate: null,
        timeSlot: null,
        addOns: selectedAddOns,
        totalPrice: total,
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
      usedDownsell: false,
    });
  };

  // Theme based on config - useCardWrapper determines if we show in a dark card
  const useCardWrapper = config.useCardWrapper !== false; // defaults to true if not specified
  const isDarkTheme = useCardWrapper; // dark theme only when in card wrapper

  return (
    <div className={`${isDarkTheme ? 'bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 rounded-3xl overflow-hidden shadow-2xl' : ''}`}>
      {/* Header Badge - Segment specific */}
      {isDarkTheme && (
        <div className="bg-[#7DB00E] py-2 px-4 flex items-center justify-center gap-2">
          <Sparkles className="w-4 h-4 text-slate-900" />
          <span className="text-sm font-bold text-slate-900 uppercase tracking-wide">
            {config.priceLabel}
          </span>
          <Sparkles className="w-4 h-4 text-slate-900" />
        </div>
      )}

      <div className={`${isDarkTheme ? 'p-6' : ''} space-y-6`}>
        {/* Price Display */}
        <div className={`text-center ${!isDarkTheme ? 'bg-gradient-to-br from-green-50 to-emerald-50 border-2 border-[#7DB00E] rounded-2xl p-6' : ''}`}>
          {/* Discount Badge for BUDGET */}
          {config.showDiscountBadge && (
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#7DB00E] text-white text-xs font-bold mb-4">
              <Percent className="w-3.5 h-3.5" />
              SAVE {savingsPercent}%
            </div>
          )}

          <div className={`${isDarkTheme ? 'text-slate-400' : 'text-slate-600'} text-sm mb-1`}>
            {customerName.split(' ')[0]}, your quote
          </div>

          <div className="mb-1">
            {config.showDiscountBadge && (
              <span className="text-slate-400 line-through text-xl mr-3">
                £{Math.round(wasPrice / 100)}
              </span>
            )}
            <motion.span
              key={total}
              initial={{ scale: 1.1, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              className={`text-5xl font-black ${isDarkTheme ? 'text-white' : 'text-[#7DB00E]'}`}
            >
              £{Math.round(total / 100)}
            </motion.span>
          </div>

          <div className={`text-sm ${isDarkTheme ? 'text-slate-400' : 'text-slate-600'}`}>
            All-inclusive, no hidden fees
          </div>

          {/* What's Included - Compact */}
          <div className={`mt-4 pt-4 border-t ${isDarkTheme ? 'border-white/10' : 'border-[#7DB00E]/20'}`}>
            <div className={`flex flex-wrap justify-center gap-x-4 gap-y-2 text-sm ${isDarkTheme ? 'text-slate-300' : 'text-slate-700'}`}>
              {[
                { icon: <Check className="w-4 h-4" />, text: 'Quality guarantee' },
                { icon: <Shield className="w-4 h-4" />, text: segment === 'BUSY_PRO' ? '90-day warranty' : '30-day warranty' },
                { icon: <Sparkles className="w-4 h-4" />, text: 'Full cleanup' },
              ].map((item, i) => (
                <div key={i} className="flex items-center gap-1.5">
                  <span className="text-[#7DB00E]">{item.icon}</span>
                  {item.text}
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Downsell Option (if available) */}
        {config.downsell && (
          <div className={`rounded-xl p-4 ${useDownsell ? 'bg-[#7DB00E]/20 border-2 border-[#7DB00E]' : 'bg-slate-100 border-2 border-transparent'}`}>
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
                className="w-5 h-5 rounded border-slate-300 text-[#7DB00E] focus:ring-[#7DB00E]"
              />
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-bold text-slate-900">{config.downsell.label}</span>
                  <span className="text-xs bg-[#7DB00E] text-white px-2 py-0.5 rounded-full font-bold">
                    -{config.downsell.discountPercent}%
                  </span>
                </div>
                <p className="text-slate-600 text-sm">{config.downsell.description}</p>
              </div>
            </label>

            {/* Show confirmation when selected */}
            {useDownsell && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                className="mt-4 pt-4 border-t border-[#7DB00E]/30"
              >
                <div className="flex items-center gap-3 text-slate-700">
                  <div className="w-10 h-10 rounded-full bg-[#7DB00E] flex items-center justify-center">
                    <Check className="w-5 h-5 text-white" />
                  </div>
                  <div>
                    <p className="font-semibold">We'll schedule you {config.downsell.periodLabel}</p>
                    <p className="text-sm text-slate-500">Best available slot on our route - you save {config.downsell.discountPercent}%</p>
                  </div>
                </div>
              </motion.div>
            )}
          </div>
        )}

        {/* Step 1: Date Selection - Hidden when using downsell */}
        {!useDownsell && (
        <div>
          <h4 className={`text-sm font-bold uppercase tracking-wide mb-3 flex items-center gap-2 ${isDarkTheme ? 'text-white' : 'text-slate-700'}`}>
            <Calendar className="w-4 h-4 text-[#7DB00E]" />
            1. Choose your date
          </h4>
          <div className="grid grid-cols-4 gap-2">
            {visibleDates.map((d) => (
              <button
                key={d.date.toISOString()}
                onClick={() => {
                  setSelectedDate(d.date);
                  // Scroll to time section after a brief delay for animation
                  setTimeout(() => {
                    timeSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                  }, 150);
                }}
                className={`p-3 rounded-xl text-center transition-all relative ${
                  selectedDate?.toDateString() === d.date.toDateString()
                    ? 'bg-[#7DB00E] text-slate-900 ring-2 ring-[#7DB00E] ring-offset-2' + (isDarkTheme ? ' ring-offset-slate-900' : '')
                    : d.isNextDay
                      ? isDarkTheme
                        ? 'bg-amber-500/20 text-white hover:bg-amber-500/30 border border-amber-500/50'
                        : 'bg-amber-50 text-slate-700 hover:bg-amber-100 border border-amber-300'
                      : isDarkTheme
                        ? 'bg-white/10 text-white hover:bg-white/20'
                        : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                }`}
              >
                {d.isNextDay && (
                  <div className="absolute -top-1.5 left-1/2 -translate-x-1/2 text-[8px] font-bold bg-amber-500 text-white px-1.5 py-0.5 rounded">
                    PRIORITY
                  </div>
                )}
                <div className="text-xs font-medium">{format(d.date, 'EEE')}</div>
                <div className="text-lg font-bold">{format(d.date, 'd')}</div>
                {d.fee > 0 && (
                  <div className="text-[10px] text-amber-400 mt-0.5">+£{d.fee / 100}</div>
                )}
              </button>
            ))}
          </div>
          {!showAllDates && availableDates.length > 8 && (
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
          /* Inline Stripe Payment (for BUDGET after date+time, or for flexible timing) */
          <div className="space-y-4">
            <div className={`rounded-xl p-4 ${isDarkTheme ? 'bg-white/5' : 'bg-slate-50'}`}>
              <div className="flex items-center gap-2 mb-3">
                <CreditCard className={`w-5 h-5 ${isDarkTheme ? 'text-slate-400' : 'text-slate-500'}`} />
                <span className={`text-sm font-medium ${isDarkTheme ? 'text-white' : 'text-slate-700'}`}>
                  Card Details
                </span>
                <Lock className={`w-3 h-3 ml-auto ${isDarkTheme ? 'text-slate-500' : 'text-slate-400'}`} />
              </div>

              {isLoadingPaymentIntent ? (
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
                        Pay £{Math.round(total / 100)}
                        <ChevronRight className="w-5 h-5" />
                      </span>
                    )}
                  </Button>
                </form>
              )}

              <p className={`text-xs text-center mt-3 ${isDarkTheme ? 'text-slate-500' : 'text-slate-400'}`}>
                Secure payment powered by Stripe
              </p>
            </div>
          </div>
        ) : (
          /* Regular Book Button - hide disabled state for BUSY_PRO */
          (canBook || segment !== 'BUSY_PRO') && (
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
                  Book for £{Math.round(total / 100)}
                  <ChevronRight className="w-5 h-5" />
                </span>
              ) : (
                'Select date & time to book'
              )}
            </Button>
          )
        )}
        </div>

        {/* Trust Footer */}
        <div className={`flex items-center justify-center gap-4 text-xs ${isDarkTheme ? 'text-slate-500' : 'text-slate-500'}`}>
          <span className="flex items-center gap-1">
            <Shield className="w-3 h-3" />
            {isDarkTheme ? 'Secure payment' : 'Vetted & Insured'}
          </span>
          <span className="flex items-center gap-1">
            <Star className="w-3 h-3" />
            4.9 rating
          </span>
          <span className="flex items-center gap-1">
            <Check className="w-3 h-3" />
            {isDarkTheme ? 'Free cancellation' : 'Local tradesperson'}
          </span>
        </div>
      </div>
    </div>
  );
}
