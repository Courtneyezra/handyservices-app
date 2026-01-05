import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Calendar, ChevronLeft, ChevronRight, CheckCircle, Info } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

interface AvailableDate {
    date: string;
    dayName: string;
    dayNumber: number;
    monthName: string;
    daysFromNow: number;
    isLocked: boolean;
}

interface AvailabilityPreviewProps {
    tier: 'essential' | 'enhanced' | 'elite';
}

export function AvailabilityPreview({ tier }: AvailabilityPreviewProps) {
    const [dateOffset, setDateOffset] = useState(0);

    // Map full tier names to H/HH/HHH format expected by logic
    const tierCode = tier === 'essential' ? 'H' : tier === 'enhanced' ? 'HH' : 'HHH';

    // Get minimum days based on tier
    const getMinimumDaysForTier = (): number => {
        switch (tierCode) {
            case 'H':
                return 14; // Essential: 14+ days out
            case 'HH':
                return 7;  // Enhanced: 7+ days out
            case 'HHH':
                return 1;  // Elite: next day
            default:
                return 1;
        }
    };

    const minimumDays = getMinimumDaysForTier();

    // Generate available dates for selection (Simplified version of DateSelectionForm)
    const getAvailableDates = (): AvailableDate[] => {
        const dates = [];
        const today = new Date();

        // Start from tomorrow or offset
        const startOffset = Math.max(1, dateOffset + 1);

        // Show 2 weeks at a time
        for (let i = startOffset; i <= startOffset + 13; i++) {
            const date = new Date(today);
            date.setDate(today.getDate() + i);
            const dateString = date.toISOString().split('T')[0];

            // Check if this is a weekend (0 = Sunday, 6 = Saturday)
            const dayOfWeek = date.getDay();
            const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;

            // Check if this date is available for the current tier
            const isAvailableForTier = i >= minimumDays;

            dates.push({
                date: dateString,
                dayName: date.toLocaleDateString('en-GB', { weekday: 'short' }),
                dayNumber: date.getDate(),
                monthName: date.toLocaleDateString('en-GB', { month: 'short' }),
                daysFromNow: i,
                isLocked: !isAvailableForTier || isWeekend
            });
        }

        return dates;
    };

    const availableDates = getAvailableDates();

    // Navigation
    const goToPreviousWeek = () => {
        setDateOffset(Math.max(0, dateOffset - 7));
    };

    const goToNextWeek = () => {
        setDateOffset(dateOffset + 7);
    };

    // Get date range for display
    const getDateRangeInfo = () => {
        const today = new Date();
        const startDate = new Date(today);
        const endDate = new Date(today);

        startDate.setDate(today.getDate() + Math.max(1, dateOffset + 1));
        endDate.setDate(today.getDate() + Math.max(1, dateOffset + 1) + 13);

        return {
            start: startDate.toLocaleDateString('en-GB', { month: 'short', day: 'numeric' }),
            end: endDate.toLocaleDateString('en-GB', { month: 'short', day: 'numeric' }),
        };
    };

    const getTierDisplayName = () => {
        switch (tier) {
            case 'essential': return 'Handy Fix';
            case 'enhanced': return 'Hassle-Free';
            case 'elite': return 'High Speed';
            default: return tier;
        }
    };

    return (
        <div className="space-y-4">
            {/* Header */}
            <div className="text-center mb-4">
                <h3 className="text-lg font-semibold text-gray-900">
                    Availability for <span className="text-amber-600">{getTierDisplayName()}</span>
                </h3>
                <p className="text-sm text-gray-500">
                    Earliest available booking: <span className="font-medium text-gray-900">{minimumDays === 1 ? 'Tomorrow' : `in ${minimumDays} days`}</span>
                </p>
            </div>

            {/* Date Grid */}
            <div className="bg-gray-50 rounded-lg p-4 border border-gray-200">
                <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2 text-sm font-medium text-gray-700">
                        <Calendar className="h-4 w-4 text-gray-500" />
                        <span>Available Dates</span>
                    </div>

                    <div className="flex items-center gap-1">
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={goToPreviousWeek}
                            disabled={dateOffset <= 0}
                            className="h-7 w-7 p-0"
                        >
                            <ChevronLeft className="h-4 w-4" />
                        </Button>

                        <span className="text-xs text-gray-500 min-w-[90px] text-center">
                            {getDateRangeInfo().start} - {getDateRangeInfo().end}
                        </span>

                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={goToNextWeek}
                            className="h-7 w-7 p-0"
                        >
                            <ChevronRight className="h-4 w-4" />
                        </Button>
                    </div>
                </div>

                <div className="grid grid-cols-4 sm:grid-cols-7 gap-2">
                    {availableDates.map((date) => {
                        const isLocked = date.isLocked;

                        // Generate tooltip message
                        const getTooltipMessage = () => {
                            if (!isLocked) return 'Available';
                            const dateObj = new Date(date.date);
                            const dayOfWeek = dateObj.getDay();
                            if (dayOfWeek === 0 || dayOfWeek === 6) return 'Weekend dates unavailable';
                            return `${getTierDisplayName()} requires ${minimumDays} days notice`;
                        };

                        const dateCell = (
                            <div
                                className={`flex flex-col items-center justify-center p-2 rounded-md border text-center text-xs transition-colors ${isLocked
                                        ? "bg-gray-100 text-gray-400 border-gray-200 cursor-not-allowed"
                                        : "bg-white text-gray-900 border-green-200 hover:border-green-400 cursor-default shadow-sm"
                                    }`}
                            >
                                <span className="opacity-70">{date.dayName}</span>
                                <span className="text-base font-bold my-0.5">{date.dayNumber}</span>
                                {!isLocked && <CheckCircle className="w-3 h-3 text-green-500 mt-1" />}
                            </div>
                        );

                        return (
                            <TooltipProvider key={date.date}>
                                <Tooltip delayDuration={300}>
                                    <TooltipTrigger asChild>
                                        <div>{dateCell}</div>
                                    </TooltipTrigger>
                                    <TooltipContent>
                                        <p>{getTooltipMessage()}</p>
                                    </TooltipContent>
                                </Tooltip>
                            </TooltipProvider>
                        );
                    })}
                </div>

                <div className="mt-3 flex items-start gap-2 text-xs text-gray-500 bg-blue-50 p-2 rounded border border-blue-100">
                    <Info className="w-4 h-4 text-blue-500 shrink-0 mt-0.5" />
                    <p>
                        You can secure one of these dates immediately after accepting the quote. You can also forward a booking link to your tenant.
                    </p>
                </div>
            </div>
        </div>
    );
}
