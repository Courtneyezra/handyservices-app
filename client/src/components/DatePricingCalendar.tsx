import React, { useState, useMemo, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Calendar, Zap, Clock, TrendingDown } from 'lucide-react';
import { format, addDays, differenceInDays, startOfDay } from 'date-fns';
import { useAvailability, formatDateStr } from '@/hooks/useAvailability';

export type SchedulingTier = 'express' | 'priority' | 'standard' | 'flexible';

interface DateOption {
    date: Date;
    tier: SchedulingTier;
    baseFee: number; // in pence
    isWeekend: boolean;
    weekendSurcharge: number; // in pence
    totalFee: number; // baseFee + weekendSurcharge
    isBooked: boolean; // for visual scarcity
}

interface DatePricingCalendarProps {
    onDateSelect: (date: Date, tier: SchedulingTier, fee: number, isWeekend: boolean) => void;
    minDate?: Date;
    maxWeeks?: number;
    postcode?: string;
    serviceIds?: string[];
}

const TIER_CONFIG = {
    express: { label: 'Express', fee: 8000, icon: Zap, color: 'red', emoji: '🔴' },
    priority: { label: 'Priority', fee: 4000, icon: Zap, color: 'green', emoji: '🟢' },
    standard: { label: 'Standard', fee: 0, icon: Calendar, color: 'slate', emoji: '⚪' },
    flexible: { label: 'Flexible', fee: -3000, icon: TrendingDown, color: 'blue', emoji: '💙' },
};

const WEEKEND_SURCHARGE = {
    saturday: 3000, // +£30
    sunday: 5000,   // +£50
};

const getTierForDate = (daysOut: number): SchedulingTier => {
    if (daysOut <= 3) return 'express';
    if (daysOut <= 7) return 'priority';
    if (daysOut <= 14) return 'standard';
    return 'flexible';
};

const formatPrice = (pence: number): string => {
    const pounds = Math.abs(pence) / 100;
    const sign = pence < 0 ? '-' : '+';
    return pence === 0 ? '£0' : `${sign}£${pounds.toFixed(0)}`;
};

export const DatePricingCalendar: React.FC<DatePricingCalendarProps> = ({
    onDateSelect,
    minDate = new Date(),
    maxWeeks = 2,
    postcode,
    serviceIds,
}) => {
    const [selectedDate, setSelectedDate] = useState<Date | null>(null);

    // Fetch system-wide availability
    const { data: availabilityData, isLoading: isLoadingAvailability } = useAvailability({
        postcode,
        serviceIds,
        days: maxWeeks * 7 + 1,
    });

    // Build a set of unavailable dates for quick lookup
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

    // Generate date options for 2 weeks (14 days) - memoized to prevent regeneration
    const dates = useMemo((): DateOption[] => {
        const dates: DateOption[] = [];
        const today = startOfDay(minDate);

        for (let i = 1; i <= maxWeeks * 7; i++) {
            const date = addDays(today, i);
            const dateStr = formatDateStr(date);
            const daysOut = differenceInDays(date, today);
            const tier = getTierForDate(daysOut);
            const dayOfWeek = date.getDay();
            const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;

            const baseFee = TIER_CONFIG[tier].fee;
            const weekendSurcharge = isWeekend
                ? (dayOfWeek === 0 ? WEEKEND_SURCHARGE.sunday : WEEKEND_SURCHARGE.saturday)
                : 0;

            const totalFee = baseFee + weekendSurcharge;

            // Check system availability - if unavailable via API, mark as booked
            const isBooked = unavailableDates.has(dateStr);

            dates.push({
                date,
                tier,
                baseFee,
                isWeekend,
                weekendSurcharge,
                totalFee,
                isBooked,
            });
        }

        return dates;
    }, [minDate, maxWeeks, unavailableDates]); // Regenerate when availability changes

    // Find the FIRST priority weekday date that's not booked as the recommended date
    const recommendedDate = dates.find(
        d => d.tier === 'priority' && !d.isWeekend && !d.isBooked
    );

    // Split into 2 weeks (rows)
    const week1 = dates.slice(0, 7);
    const week2 = dates.slice(7, 14);

    const handleDateClick = (dateOption: DateOption) => {
        if (dateOption.isBooked) return; // Can't select booked dates

        setSelectedDate(dateOption.date);
        onDateSelect(
            dateOption.date,
            dateOption.tier,
            dateOption.totalFee,
            dateOption.isWeekend
        );
    };

    // DISABLED: Auto-select was causing Section 2 to appear immediately in progressive unlock flow
    // Users must manually select a date now
    /*
    useEffect(() => {
        const firstNoCostDate = dates.find(
            d => d.totalFee === 0 && !d.isBooked
        );

        if (firstNoCostDate && !selectedDate) {
            setSelectedDate(firstNoCostDate.date);
            onDateSelect(
                firstNoCostDate.date,
                firstNoCostDate.tier,
                firstNoCostDate.totalFee,
                firstNoCostDate.isWeekend
            );
        }
    }, [dates, selectedDate, onDateSelect]);
    */



    // Desktop detailed card renderer
    const renderDetailedCard = (dateOption: DateOption) => {
        const config = TIER_CONFIG[dateOption.tier];
        const isSelected = selectedDate &&
            format(selectedDate, 'yyyy-MM-dd') === format(dateOption.date, 'yyyy-MM-dd');
        const Icon = config.icon;
        // Only show recommended styling if this IS the recommended date AND (no date selected OR this date is selected)
        const isRecommended = recommendedDate &&
            format(recommendedDate.date, 'yyyy-MM-dd') === format(dateOption.date, 'yyyy-MM-dd') &&
            (!selectedDate || isSelected);

        return (
            <motion.button
                key={format(dateOption.date, 'yyyy-MM-dd')}
                onClick={() => handleDateClick(dateOption)}
                disabled={dateOption.isBooked}
                whileHover={!dateOption.isBooked ? { scale: 1.03 } : {}}
                whileTap={!dateOption.isBooked ? { scale: 0.98 } : {}}
                className={`
          relative p-3 rounded-xl border-2 transition-all min-h-[100px] flex flex-col justify-between
          ${dateOption.isBooked
                        ? 'opacity-40 cursor-not-allowed bg-slate-100 border-slate-200'
                        : isSelected
                            ? 'bg-[#7DB00E]/10 border-[#7DB00E] shadow-lg scale-105'
                            : isRecommended
                                ? 'bg-green-50 border-green-300 hover:border-green-400 shadow-md ring-2 ring-green-200'
                                : 'bg-white border-slate-200 hover:border-slate-300 hover:shadow-sm'
                    }
        `}
            >
                {/* Recommended Badge */}
                {isRecommended && !isSelected && (
                    <div className="absolute -top-2 left-1/2 transform -translate-x-1/2">
                        <div className="bg-[#7DB00E] text-white text-[8px] font-black px-2 py-0.5 rounded-full uppercase tracking-wide whitespace-nowrap">
                            Recommended
                        </div>
                    </div>
                )}

                {/* Day of Week */}
                <div className={`text-[9px] uppercase font-bold mb-1 ${dateOption.isBooked ? 'text-slate-400' :
                    isSelected ? 'text-[#7DB00E]' :
                        'text-slate-500'
                    }`}>
                    {format(dateOption.date, 'EEE')}
                </div>

                {/* Date Number */}
                <div className={`text-2xl font-bold mb-1 ${dateOption.isBooked ? 'text-slate-400' :
                    isSelected ? 'text-slate-900' :
                        'text-slate-700'
                    }`}>
                    {format(dateOption.date, 'd')}
                </div>

                {/* Month */}
                <div className={`text-[9px] mb-2 ${dateOption.isBooked ? 'text-slate-400' : 'text-slate-500'
                    }`}>
                    {format(dateOption.date, 'MMM')}
                </div>

                {/* Tier Badge & Price */}
                {!dateOption.isBooked && (
                    <div className="space-y-1">
                        <div className="flex items-center justify-center gap-1">
                            <span className="text-base">{config.emoji}</span>
                            <Icon className={`w-3 h-3 text-${config.color}-500`} />
                        </div>

                        <div className={`text-xs font-bold ${dateOption.totalFee > 0 ? 'text-[#7DB00E]' :
                            dateOption.totalFee < 0 ? 'text-blue-600' :
                                'text-slate-600'
                            }`}>
                            {formatPrice(dateOption.totalFee)}
                        </div>

                        {dateOption.isWeekend && (
                            <div className="text-[8px] text-amber-600 font-semibold">
                                📅 Weekend
                            </div>
                        )}
                    </div>
                )}

                {/* Booked Overlay */}
                {dateOption.isBooked && (
                    <div className="absolute inset-0 flex items-center justify-center">
                        <div className="text-[10px] font-bold text-slate-500 bg-white/80 px-2 py-1 rounded">
                            Fully Booked
                        </div>
                    </div>
                )}
            </motion.button>
        );
    };

    // Mobile minimalistic square card renderer
    const renderMobileCard = (dateOption: DateOption) => {
        const isSelected = selectedDate &&
            format(selectedDate, 'yyyy-MM-dd') === format(dateOption.date, 'yyyy-MM-dd');
        // Only show recommended styling if this IS the recommended date AND (no date selected OR this date is selected)
        const isRecommended = recommendedDate &&
            format(recommendedDate.date, 'yyyy-MM-dd') === format(dateOption.date, 'yyyy-MM-dd') &&
            (!selectedDate || isSelected);

        return (
            <button
                key={format(dateOption.date, 'yyyy-MM-dd')}
                onClick={() => handleDateClick(dateOption)}
                disabled={dateOption.isBooked}
                className={`
          aspect-square relative p-1 rounded-lg border-2 transition-all flex flex-col items-center justify-center
          ${dateOption.isBooked
                        ? 'opacity-30 cursor-not-allowed bg-slate-100 border-slate-200'
                        : isSelected
                            ? 'bg-[#7DB00E] border-[#7DB00E] text-white shadow-md'
                            : isRecommended
                                ? 'bg-orange-50 border-orange-400'
                                : 'bg-white border-slate-200 active:border-slate-400'
                    }
        `}
            >
                {/* Day initial */}
                <div className={`text-[7px] uppercase font-bold ${dateOption.isBooked ? 'text-slate-400' :
                    isSelected ? 'text-white/70' :
                        'text-slate-400'
                    }`}>
                    {format(dateOption.date, 'EEE').charAt(0)}
                </div>

                {/* Date number */}
                <div className={`text-sm font-bold ${dateOption.isBooked ? 'text-slate-400' :
                    isSelected ? 'text-white' :
                        'text-slate-900'
                    }`}>
                    {format(dateOption.date, 'd')}
                </div>

                {/* Price badge - only if non-zero */}
                {!dateOption.isBooked && dateOption.totalFee !== 0 && (
                    <div className={`text-[8px] font-bold ${isSelected ? 'text-white/90' :
                        dateOption.totalFee > 0 ? 'text-[#7DB00E]' :
                            'text-blue-600'
                        }`}>
                        {formatPrice(dateOption.totalFee)}
                    </div>
                )}

                {/* Booked X */}
                {dateOption.isBooked && (
                    <div className="text-[10px] text-slate-400">✕</div>
                )}
            </button>
        );
    };

    return (
        <div className="space-y-4">
            {/* Mobile: Minimalistic 2-Row Grid */}
            <div className="md:hidden space-y-1.5">
                {/* Week 1 */}
                <div className="grid grid-cols-7 gap-1.5">
                    {week1.map(renderMobileCard)}
                </div>

                {/* Week 2 */}
                <div className="grid grid-cols-7 gap-1.5">
                    {week2.map(renderMobileCard)}
                </div>
            </div>

            {/* Desktop: Detailed Grid */}
            <div className="hidden md:block space-y-3">
                <div className="grid grid-cols-7 gap-2">
                    {week1.map(renderDetailedCard)}
                </div>

                <div className="grid grid-cols-7 gap-2">
                    {week2.map(renderDetailedCard)}
                </div>
            </div>
        </div>
    );
};
