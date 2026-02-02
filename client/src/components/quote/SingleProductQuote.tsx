import React, { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Check, Calendar, Clock, Zap, Shield, Wrench,
  ChevronRight, Star, Phone, Camera, Sparkles,
  CalendarCheck, Timer, Plus, Minus
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { format, addDays, isWeekend } from 'date-fns';

interface AddOnOption {
  id: string;
  name: string;
  description: string;
  price: number; // in pence
  icon: React.ReactNode;
  popular?: boolean;
}

interface TimeSlot {
  id: string;
  label: string;
  description: string;
  fee: number; // in pence
}

interface SingleProductQuoteProps {
  serviceName: string;
  basePrice: number; // in pence
  customerName: string;
  jobDescription?: string;
  onBook: (config: {
    selectedDate: Date;
    timeSlot: string;
    addOns: string[];
    totalPrice: number;
  }) => void;
  isBooking?: boolean;
}

export function SingleProductQuote({
  serviceName,
  basePrice,
  customerName,
  jobDescription,
  onBook,
  isBooking = false,
}: SingleProductQuoteProps) {
  // State
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [selectedTimeSlot, setSelectedTimeSlot] = useState<string | null>(null);
  const [selectedAddOns, setSelectedAddOns] = useState<string[]>([]);

  // Generate available dates (next 14 days, excluding Sundays)
  const availableDates = useMemo(() => {
    const dates: { date: Date; label: string; isWeekend: boolean; fee: number }[] = [];
    for (let i = 2; i <= 14; i++) {
      const date = addDays(new Date(), i);
      if (date.getDay() !== 0) { // Exclude Sundays
        const isWknd = isWeekend(date);
        dates.push({
          date,
          label: format(date, 'EEE d MMM'),
          isWeekend: isWknd,
          fee: isWknd ? 2500 : 0, // £25 weekend fee
        });
      }
    }
    return dates;
  }, []);

  // Time slots
  const timeSlots: TimeSlot[] = [
    { id: 'morning', label: 'Morning', description: '8am - 12pm', fee: 0 },
    { id: 'afternoon', label: 'Afternoon', description: '12pm - 5pm', fee: 0 },
    { id: 'first', label: 'First Slot', description: '8am - 9am', fee: 1500 }, // £15
    { id: 'exact', label: 'Exact Time', description: 'Choose your time', fee: 2500 }, // £25
  ];

  // Add-on options
  const addOns: AddOnOption[] = [
    {
      id: 'quick_task',
      name: 'Quick Task',
      description: '15 mins of extra work while there',
      price: 2000, // £20
      icon: <Zap className="w-5 h-5" />,
      popular: true,
    },
    {
      id: 'photo_report',
      name: 'Photo Report',
      description: 'Before & after documentation',
      price: 1500, // £15
      icon: <Camera className="w-5 h-5" />,
    },
    {
      id: 'extended_warranty',
      name: '12-Month Warranty',
      description: 'Upgrade from 90 days',
      price: 3000, // £30
      icon: <Shield className="w-5 h-5" />,
    },
  ];

  // Calculate total
  const { total, breakdown } = useMemo(() => {
    let amount = basePrice;
    const items: { label: string; amount: number }[] = [
      { label: 'Service', amount: basePrice },
    ];

    // Date fee
    const dateInfo = availableDates.find(d =>
      selectedDate && d.date.toDateString() === selectedDate.toDateString()
    );
    if (dateInfo?.fee) {
      amount += dateInfo.fee;
      items.push({ label: 'Weekend booking', amount: dateInfo.fee });
    }

    // Time slot fee
    const timeInfo = timeSlots.find(t => t.id === selectedTimeSlot);
    if (timeInfo?.fee) {
      amount += timeInfo.fee;
      items.push({ label: timeInfo.label, amount: timeInfo.fee });
    }

    // Add-ons
    selectedAddOns.forEach(addOnId => {
      const addOn = addOns.find(a => a.id === addOnId);
      if (addOn) {
        amount += addOn.price;
        items.push({ label: addOn.name, amount: addOn.price });
      }
    });

    return { total: amount, breakdown: items };
  }, [basePrice, selectedDate, selectedTimeSlot, selectedAddOns, availableDates]);

  const toggleAddOn = (id: string) => {
    setSelectedAddOns(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    );
  };

  const canBook = selectedDate && selectedTimeSlot;

  const handleBook = () => {
    if (!selectedDate || !selectedTimeSlot) return;
    onBook({
      selectedDate,
      timeSlot: selectedTimeSlot,
      addOns: selectedAddOns,
      totalPrice: total,
    });
  };

  return (
    <div className="max-w-lg mx-auto">
      {/* Header Card */}
      <div className="bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 rounded-3xl overflow-hidden shadow-2xl">
        {/* Top Badge */}
        <div className="bg-[#7DB00E] py-2 px-4 flex items-center justify-center gap-2">
          <Sparkles className="w-4 h-4 text-slate-900" />
          <span className="text-sm font-bold text-slate-900 uppercase tracking-wide">
            Priority Service
          </span>
          <Sparkles className="w-4 h-4 text-slate-900" />
        </div>

        {/* Main Content */}
        <div className="p-6 space-y-6">
          {/* Price Display */}
          <div className="text-center">
            <div className="text-slate-400 text-sm mb-1">
              Hi {customerName.split(' ')[0]}, your quote
            </div>
            <motion.div
              key={total}
              initial={{ scale: 1.1, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              className="text-5xl font-black text-white"
            >
              £{Math.round(total / 100)}
            </motion.div>
            <div className="text-slate-400 text-sm mt-1">
              All-inclusive, no hidden fees
            </div>
          </div>

          {/* What's Included - Compact */}
          <div className="bg-white/5 rounded-2xl p-4">
            <div className="grid grid-cols-2 gap-3 text-sm">
              {[
                { icon: <Check className="w-4 h-4" />, text: 'Quality guarantee' },
                { icon: <Phone className="w-4 h-4" />, text: 'Direct contact' },
                { icon: <Shield className="w-4 h-4" />, text: '90-day warranty' },
                { icon: <Sparkles className="w-4 h-4" />, text: 'Full cleanup' },
              ].map((item, i) => (
                <div key={i} className="flex items-center gap-2 text-slate-300">
                  <div className="text-[#7DB00E]">{item.icon}</div>
                  {item.text}
                </div>
              ))}
            </div>
          </div>

          {/* Step 1: Select Date */}
          <div className="space-y-3">
            <h3 className="text-white font-semibold flex items-center gap-2">
              <Calendar className="w-5 h-5 text-[#7DB00E]" />
              1. Choose your date
            </h3>
            <div className="grid grid-cols-4 gap-2">
              {availableDates.slice(0, 8).map((d) => (
                <button
                  key={d.date.toISOString()}
                  onClick={() => setSelectedDate(d.date)}
                  className={`p-3 rounded-xl text-center transition-all ${
                    selectedDate?.toDateString() === d.date.toDateString()
                      ? 'bg-[#7DB00E] text-slate-900 ring-2 ring-[#7DB00E] ring-offset-2 ring-offset-slate-900'
                      : 'bg-white/10 text-white hover:bg-white/20'
                  }`}
                >
                  <div className="text-xs font-medium">
                    {format(d.date, 'EEE')}
                  </div>
                  <div className="text-lg font-bold">
                    {format(d.date, 'd')}
                  </div>
                  {d.isWeekend && (
                    <div className="text-[10px] text-amber-400 mt-0.5">+£25</div>
                  )}
                </button>
              ))}
            </div>
          </div>

          {/* Step 2: Select Time (only if date selected) */}
          <AnimatePresence>
            {selectedDate && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="space-y-3"
              >
                <h3 className="text-white font-semibold flex items-center gap-2">
                  <Clock className="w-5 h-5 text-[#7DB00E]" />
                  2. Choose arrival window
                </h3>
                <div className="grid grid-cols-2 gap-2">
                  {timeSlots.map((slot) => (
                    <button
                      key={slot.id}
                      onClick={() => setSelectedTimeSlot(slot.id)}
                      className={`p-3 rounded-xl text-left transition-all ${
                        selectedTimeSlot === slot.id
                          ? 'bg-[#7DB00E] text-slate-900'
                          : 'bg-white/10 text-white hover:bg-white/20'
                      }`}
                    >
                      <div className="font-semibold text-sm">{slot.label}</div>
                      <div className={`text-xs ${
                        selectedTimeSlot === slot.id ? 'text-slate-700' : 'text-slate-400'
                      }`}>
                        {slot.description}
                      </div>
                      {slot.fee > 0 && (
                        <div className={`text-xs mt-1 ${
                          selectedTimeSlot === slot.id ? 'text-slate-700' : 'text-amber-400'
                        }`}>
                          +£{slot.fee / 100}
                        </div>
                      )}
                    </button>
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Step 3: Add-ons (only if time selected) */}
          <AnimatePresence>
            {selectedTimeSlot && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="space-y-3"
              >
                <h3 className="text-white font-semibold flex items-center gap-2">
                  <Wrench className="w-5 h-5 text-[#7DB00E]" />
                  3. Add extras (optional)
                </h3>
                <div className="space-y-2">
                  {addOns.map((addOn) => {
                    const isSelected = selectedAddOns.includes(addOn.id);
                    return (
                      <button
                        key={addOn.id}
                        onClick={() => toggleAddOn(addOn.id)}
                        className={`w-full p-4 rounded-xl flex items-center gap-4 transition-all ${
                          isSelected
                            ? 'bg-[#7DB00E]/20 border-2 border-[#7DB00E]'
                            : 'bg-white/5 border-2 border-transparent hover:bg-white/10'
                        }`}
                      >
                        <div className={`p-2 rounded-lg ${
                          isSelected ? 'bg-[#7DB00E] text-slate-900' : 'bg-white/10 text-slate-400'
                        }`}>
                          {addOn.icon}
                        </div>
                        <div className="flex-1 text-left">
                          <div className="flex items-center gap-2">
                            <span className="text-white font-medium">{addOn.name}</span>
                            {addOn.popular && (
                              <span className="text-[10px] bg-amber-500/20 text-amber-400 px-2 py-0.5 rounded-full font-medium">
                                POPULAR
                              </span>
                            )}
                          </div>
                          <div className="text-slate-400 text-sm">{addOn.description}</div>
                        </div>
                        <div className="text-right">
                          <div className="text-white font-bold">+£{addOn.price / 100}</div>
                          <div className={`w-6 h-6 rounded-full flex items-center justify-center ${
                            isSelected ? 'bg-[#7DB00E]' : 'bg-white/10'
                          }`}>
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

          {/* Price Breakdown (only if ready to book) */}
          <AnimatePresence>
            {canBook && breakdown.length > 1 && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="bg-white/5 rounded-xl p-4 space-y-2"
              >
                {breakdown.map((item, i) => (
                  <div key={i} className="flex justify-between text-sm">
                    <span className="text-slate-400">{item.label}</span>
                    <span className="text-white">£{Math.round(item.amount / 100)}</span>
                  </div>
                ))}
                <div className="border-t border-white/10 pt-2 flex justify-between font-bold">
                  <span className="text-white">Total</span>
                  <span className="text-[#7DB00E] text-lg">£{Math.round(total / 100)}</span>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Book Button */}
          <Button
            onClick={handleBook}
            disabled={!canBook || isBooking}
            className={`w-full h-14 rounded-2xl font-bold text-lg transition-all ${
              canBook
                ? 'bg-[#7DB00E] hover:bg-[#6da000] text-slate-900'
                : 'bg-white/10 text-slate-500 cursor-not-allowed'
            }`}
          >
            {isBooking ? (
              <span className="flex items-center gap-2">
                <motion.div
                  animate={{ rotate: 360 }}
                  transition={{ repeat: Infinity, duration: 1, ease: 'linear' }}
                >
                  <Timer className="w-5 h-5" />
                </motion.div>
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

          {/* Trust Signals */}
          <div className="flex items-center justify-center gap-4 text-xs text-slate-500">
            <span className="flex items-center gap-1">
              <Shield className="w-3 h-3" />
              Secure payment
            </span>
            <span className="flex items-center gap-1">
              <Star className="w-3 h-3" />
              4.9 rating
            </span>
            <span className="flex items-center gap-1">
              <Check className="w-3 h-3" />
              Free cancellation
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
