import React, { useState } from 'react';
import { ChevronLeft, ChevronRight, Calendar } from 'lucide-react';
import { format, addDays } from 'date-fns';

interface DateSelectorProps {
    startDate: Date; // Earliest available date for this tier
    selectedDate?: Date;
    selectedTimeSlot?: 'AM' | 'PM';
    onDateSelect: (date: Date) => void;
    onTimeSlotSelect?: (timeSlot: 'AM' | 'PM') => void;
    className?: string;
}

/**
 * Horizontal scrollable date selector for mobile pricing cards.
 * Shows available booking dates with touch-friendly navigation.
 * No images - uses Lucide icons only.
 */
export function DateSelector({
    startDate,
    selectedDate,
    selectedTimeSlot,
    onDateSelect,
    onTimeSlotSelect,
    className = ''
}: DateSelectorProps) {
    const [scrollIndex, setScrollIndex] = useState(0);
    const datesPerView = 4;

    // Generate 14 days starting from tier's earliest available
    const availableDates = Array.from({ length: 14 }, (_, i) => addDays(startDate, i));

    // Get currently visible dates
    const visibleDates = availableDates.slice(scrollIndex, scrollIndex + datesPerView);

    const canScrollLeft = scrollIndex > 0;
    const canScrollRight = scrollIndex + datesPerView < availableDates.length;

    const handleScrollLeft = () => {
        if (canScrollLeft) setScrollIndex(prev => Math.max(0, prev - 1));
    };

    const handleScrollRight = () => {
        if (canScrollRight) setScrollIndex(prev => prev + 1);
    };

    return (
        <div className={`bg-slate-50 rounded-xl p-4 ${className}`}>
            {/* Header */}
            <div className="flex items-center gap-2 mb-3">
                <Calendar className="w-4 h-4 text-[#7DB00E]" />
                <h4 className="text-sm font-semibold text-slate-700">Choose Your Date</h4>
            </div>

            {/* Date Carousel */}
            <div className="flex items-center gap-2">
                {/* Left Arrow */}
                <button
                    onClick={handleScrollLeft}
                    disabled={!canScrollLeft}
                    className={`
            p-1 rounded-lg transition-colors flex-shrink-0
            ${canScrollLeft
                            ? 'text-slate-600 hover:bg-slate-200'
                            : 'text-slate-300 cursor-not-allowed'
                        }
          `}
                    aria-label="Previous dates"
                >
                    <ChevronLeft className="w-5 h-5" />
                </button>

                {/* Date Grid */}
                <div className="flex gap-2 flex-1 overflow-hidden">
                    {visibleDates.map((date, idx) => {
                        const isSelected = selectedDate &&
                            format(date, 'yyyy-MM-dd') === format(selectedDate, 'yyyy-MM-dd');

                        return (
                            <button
                                key={idx}
                                onClick={() => onDateSelect(date)}
                                className={`
                  flex flex-col items-center justify-center
                  px-2 py-2 rounded-lg min-w-[60px]
                  transition-all duration-200
                  ${isSelected
                                        ? 'bg-[#7DB00E] text-white shadow-lg scale-105'
                                        : 'bg-white text-slate-700 hover:bg-slate-100 border border-slate-200'
                                    }
                `}
                                aria-label={format(date, 'EEEE, MMMM d')}
                            >
                                <span className="text-[10px] uppercase font-medium">
                                    {format(date, 'EEE')}
                                </span>
                                <span className="text-xl font-bold my-0.5">
                                    {format(date, 'd')}
                                </span>
                                <span className="text-[10px] uppercase">
                                    {format(date, 'MMM')}
                                </span>
                            </button>
                        );
                    })}
                </div>

                {/* Right Arrow */}
                <button
                    onClick={handleScrollRight}
                    disabled={!canScrollRight}
                    className={`
            p-1 rounded-lg transition-colors flex-shrink-0
            ${canScrollRight
                            ? 'text-slate-600 hover:bg-slate-200'
                            : 'text-slate-300 cursor-not-allowed'
                        }
          `}
                    aria-label="Next dates"
                >
                    <ChevronRight className="w-5 h-5" />
                </button>
            </div>

            {/* Time Slot Selection - Only shown when date is selected */}
            {selectedDate && onTimeSlotSelect && (
                <div className="mt-4 pt-4 border-t border-slate-200">
                    <p className="text-xs font-medium text-slate-600 mb-2 text-center">
                        Preferred Time
                    </p>
                    <div className="flex gap-2">
                        <button
                            onClick={() => onTimeSlotSelect('AM')}
                            className={`
                                flex-1 py-2.5 px-4 rounded-lg font-medium text-sm transition-all
                                ${selectedTimeSlot === 'AM'
                                    ? 'bg-[#7DB00E] text-white shadow-md'
                                    : 'bg-white text-slate-700 hover:bg-slate-100 border border-slate-200'
                                }
                            `}
                        >
                            Morning
                            <span className="block text-xs opacity-80 mt-0.5">8am - 12pm</span>
                        </button>
                        <button
                            onClick={() => onTimeSlotSelect('PM')}
                            className={`
                                flex-1 py-2.5 px-4 rounded-lg font-medium text-sm transition-all
                                ${selectedTimeSlot === 'PM'
                                    ? 'bg-[#7DB00E] text-white shadow-md'
                                    : 'bg-white text-slate-700 hover:bg-slate-100 border border-slate-200'
                                }
                            `}
                        >
                            Afternoon
                            <span className="block text-xs opacity-80 mt-0.5">12pm - 5pm</span>
                        </button>
                    </div>
                </div>
            )}

            {/* Helper Text */}
            <p className="text-xs text-slate-500 mt-3 text-center">
                {selectedDate ? 'Select your preferred time slot' : 'Tap a date to select'}
            </p>
        </div>
    );
}
