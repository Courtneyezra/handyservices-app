import React, { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Check, Calendar, Tag, Shield, Clock,
  ChevronRight, Percent, Sparkles
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { format, addDays } from 'date-fns';

interface AddOnOption {
  id: string;
  name: string;
  description: string;
  price: number; // in pence
}

interface BudgetQuoteInlineProps {
  basePrice: number; // in pence - the discounted price
  originalPrice?: number; // in pence - the "was" price (optional, defaults to basePrice * 1.2)
  customerName: string;
  optionalExtras?: { label: string; description?: string; priceInPence: number }[];
  onBook: (config: {
    selectedDate: Date;
    addOns: string[];
    totalPrice: number;
  }) => void;
  isBooking?: boolean;
}

export function BudgetQuoteInline({
  basePrice,
  originalPrice,
  customerName,
  optionalExtras = [],
  onBook,
  isBooking = false,
}: BudgetQuoteInlineProps) {
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [selectedAddOns, setSelectedAddOns] = useState<string[]>([]);
  const [showAllDates, setShowAllDates] = useState(false);

  // Calculate "was" price - show 15-20% higher to emphasize value
  const wasPrice = originalPrice || Math.round(basePrice * 1.18);
  const savingsPercent = Math.round(((wasPrice - basePrice) / wasPrice) * 100);

  // Generate available dates (next 21 days, excluding Sundays - more flexibility for budget)
  const availableDates = useMemo(() => {
    const dates: { date: Date; label: string }[] = [];
    for (let i = 3; i <= 21; i++) {
      const date = addDays(new Date(), i);
      if (date.getDay() !== 0) { // Exclude Sundays
        dates.push({
          date,
          label: format(date, 'EEE d MMM'),
        });
      }
    }
    return dates;
  }, []);

  const visibleDates = showAllDates ? availableDates : availableDates.slice(0, 6);

  // Map optional extras to add-ons format (handle null/undefined)
  const addOns: AddOnOption[] = (optionalExtras || []).map((extra, idx) => ({
    id: `extra_${idx}`,
    name: extra.label,
    description: extra.description || '',
    price: extra.priceInPence,
  }));

  // Calculate total
  const total = useMemo(() => {
    let amount = basePrice;
    selectedAddOns.forEach(addOnId => {
      const addOn = addOns.find(a => a.id === addOnId);
      if (addOn) {
        amount += addOn.price;
      }
    });
    return amount;
  }, [basePrice, selectedAddOns, addOns]);

  const toggleAddOn = (id: string) => {
    setSelectedAddOns(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    );
  };

  const canBook = selectedDate;

  const handleBook = () => {
    if (!selectedDate) return;
    onBook({
      selectedDate,
      addOns: selectedAddOns,
      totalPrice: total,
    });
  };

  return (
    <div className="space-y-6">
      {/* Price Section - Discount Focused */}
      <div className="bg-gradient-to-br from-green-50 to-emerald-50 border-2 border-[#7DB00E] rounded-2xl p-6 text-center">
        {/* Savings Badge */}
        <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#7DB00E] text-white text-xs font-bold mb-4">
          <Percent className="w-3.5 h-3.5" />
          SAVE {savingsPercent}%
        </div>

        {/* Price Display */}
        <div className="mb-2">
          <span className="text-slate-400 line-through text-xl mr-3">
            £{Math.round(wasPrice / 100)}
          </span>
          <motion.span
            key={total}
            initial={{ scale: 1.05 }}
            animate={{ scale: 1 }}
            className="text-4xl font-black text-[#7DB00E]"
          >
            £{Math.round(total / 100)}
          </motion.span>
        </div>
        <p className="text-slate-600 text-sm">
          {customerName.split(' ')[0]}, your quote - no hidden fees
        </p>

        {/* What's Included - Compact */}
        <div className="mt-4 pt-4 border-t border-[#7DB00E]/20">
          <div className="flex flex-wrap justify-center gap-x-4 gap-y-2 text-sm text-slate-700">
            {[
              { icon: <Check className="w-4 h-4" />, text: 'Quality work' },
              { icon: <Shield className="w-4 h-4" />, text: '30-day warranty' },
              { icon: <Sparkles className="w-4 h-4" />, text: 'Cleanup included' },
            ].map((item, i) => (
              <div key={i} className="flex items-center gap-1.5">
                <span className="text-[#7DB00E]">{item.icon}</span>
                {item.text}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Date Selection */}
      <div>
        <h4 className="text-sm font-bold text-slate-700 uppercase tracking-wide mb-3 flex items-center gap-2">
          <Calendar className="w-4 h-4 text-[#7DB00E]" />
          Choose Your Date
        </h4>
        <div className="grid grid-cols-3 gap-2">
          {visibleDates.map((d) => (
            <button
              key={d.date.toISOString()}
              onClick={() => setSelectedDate(d.date)}
              className={`p-3 rounded-xl text-center transition-all text-sm ${
                selectedDate?.toDateString() === d.date.toDateString()
                  ? 'bg-[#7DB00E] text-white ring-2 ring-[#7DB00E] ring-offset-2'
                  : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
              }`}
            >
              <div className="font-medium">{format(d.date, 'EEE')}</div>
              <div className="text-lg font-bold">{format(d.date, 'd')}</div>
              <div className="text-xs opacity-75">{format(d.date, 'MMM')}</div>
            </button>
          ))}
        </div>
        {!showAllDates && availableDates.length > 6 && (
          <button
            onClick={() => setShowAllDates(true)}
            className="w-full mt-2 text-sm text-[#7DB00E] font-medium hover:underline"
          >
            Show more dates...
          </button>
        )}
      </div>

      {/* Optional Add-ons */}
      {addOns.length > 0 && (
        <div>
          <h4 className="text-sm font-bold text-slate-700 uppercase tracking-wide mb-3 flex items-center gap-2">
            <Tag className="w-4 h-4 text-[#7DB00E]" />
            Add-ons (Optional)
          </h4>
          <div className="space-y-2">
            {addOns.map((addOn) => {
              const isSelected = selectedAddOns.includes(addOn.id);
              return (
                <label
                  key={addOn.id}
                  className={`flex items-center gap-3 p-3 rounded-xl cursor-pointer transition-all border-2 ${
                    isSelected
                      ? 'bg-[#7DB00E]/10 border-[#7DB00E]'
                      : 'bg-slate-50 border-transparent hover:bg-slate-100'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => toggleAddOn(addOn.id)}
                    className="w-5 h-5 rounded border-slate-300 text-[#7DB00E] focus:ring-[#7DB00E]"
                  />
                  <div className="flex-1">
                    <span className="font-medium text-slate-900">{addOn.name}</span>
                    {addOn.description && (
                      <span className="text-slate-500 text-sm ml-2">{addOn.description}</span>
                    )}
                  </div>
                  <span className="text-[#7DB00E] font-bold">+£{Math.round(addOn.price / 100)}</span>
                </label>
              );
            })}
          </div>
        </div>
      )}

      {/* Book Button */}
      <Button
        onClick={handleBook}
        disabled={!canBook || isBooking}
        className={`w-full h-14 rounded-2xl font-bold text-lg transition-all ${
          canBook
            ? 'bg-[#7DB00E] hover:bg-[#6da000] text-white'
            : 'bg-slate-200 text-slate-400 cursor-not-allowed'
        }`}
      >
        {isBooking ? (
          <span className="flex items-center gap-2">
            <Clock className="w-5 h-5 animate-spin" />
            Booking...
          </span>
        ) : canBook ? (
          <span className="flex items-center gap-2">
            Book for £{Math.round(total / 100)}
            <ChevronRight className="w-5 h-5" />
          </span>
        ) : (
          'Select a date to book'
        )}
      </Button>

      {/* Trust Footer */}
      <div className="flex items-center justify-center gap-4 text-xs text-slate-500">
        <span className="flex items-center gap-1">
          <Shield className="w-3 h-3" />
          Vetted & Insured
        </span>
        <span className="flex items-center gap-1">
          <Check className="w-3 h-3" />
          Local Tradesperson
        </span>
      </div>
    </div>
  );
}
