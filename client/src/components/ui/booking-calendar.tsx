
import { useState, useEffect } from "react";
import { format, addDays, startOfToday, isSameDay } from "date-fns";
import { ChevronLeft, ChevronRight, Clock, Calendar as CalendarIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";

export interface BookingSlot {
    date: Date;
    slot: "morning" | "afternoon" | "evening";
}

interface BookingCalendarProps {
    onSelect: (slot: BookingSlot) => void;
    selectedSlot?: BookingSlot;
    className?: string;
    minDaysInFuture?: number;
}

export function BookingCalendar({ onSelect, selectedSlot, className, minDaysInFuture = 0 }: BookingCalendarProps) {
    // Initial start date respects the minimum wait time
    const [currentStartDate, setCurrentStartDate] = useState(() => addDays(startOfToday(), minDaysInFuture));
    const [selectedDate, setSelectedDate] = useState<Date | undefined>(selectedSlot?.date);
    const [timeSlot, setTimeSlot] = useState<"morning" | "afternoon" | "evening" | undefined>(selectedSlot?.slot);

    // Reset internal state when props change (especially minDaysInFuture or selectedSlot)
    useEffect(() => {
        if (selectedSlot) {
            setSelectedDate(selectedSlot.date);
            setTimeSlot(selectedSlot.slot);
        } else {
            setSelectedDate(undefined);
            setTimeSlot(undefined);
        }
    }, [selectedSlot]);

    // Update start date if minDaysInFuture changes significantly (e.g. tier switch)
    useEffect(() => {
        const targetDate = addDays(startOfToday(), minDaysInFuture);
        if (targetDate.getTime() !== currentStartDate.getTime()) {
            setCurrentStartDate(targetDate);
        }
    }, [minDaysInFuture]);


    // Show 2 weeks of availability in the slider
    const nextDays = Array.from({ length: 14 }).map((_, i) => addDays(currentStartDate, i));

    const handleDateSelect = (date: Date) => {
        setSelectedDate(date);
        if (timeSlot) {
            onSelect({ date, slot: timeSlot });
        }
    };

    const handleSlotSelect = (slot: "morning" | "afternoon" | "evening") => {
        setTimeSlot(slot);
        if (selectedDate) {
            onSelect({ date: selectedDate, slot });
        }
    };

    return (
        <div className={cn("space-y-4", className)}>
            {/* Date Header */}
            <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm font-bold text-white flex items-center gap-2">
                    <CalendarIcon className="w-4 h-4 text-emerald-400" />
                    Select Date
                </h3>
            </div>

            {/* Date Slider (Scrollable) */}
            <div className="flex overflow-x-auto py-6 gap-2 scrollbar-thin scrollbar-thumb-slate-700 scrollbar-track-transparent -mx-1 px-1 animate-wiggle">
                {nextDays.map((date) => {
                    const isSelected = selectedDate && isSameDay(date, selectedDate);

                    return (
                        <Button
                            key={date.toISOString()}
                            variant={isSelected ? "default" : "outline"}
                            className={cn(
                                "h-auto py-3 flex-shrink-0 flex flex-col items-center gap-1 min-w-[70px] rounded-xl transition-all border-2",
                                isSelected
                                    ? "border-amber-400 text-amber-100 shadow-[0_0_25px_rgba(251,191,36,0.8)] scale-105 z-10 bg-amber-950/60 bg-gradient-to-r from-amber-500/40 via-yellow-200/40 to-amber-500/40 bg-[length:200%_100%] animate-gradient-x"
                                    : "bg-slate-900/80 border-amber-500/70 text-amber-100/80 shadow-[0_0_10px_rgba(251,191,36,0.2)] hover:border-amber-400 hover:text-amber-100 hover:shadow-[0_0_15px_rgba(251,191,36,0.4)] hover:bg-amber-950/40"
                            )}
                            onClick={() => handleDateSelect(date)}
                        >
                            <span className="text-[10px] uppercase font-bold tracking-wider opacity-60">
                                {format(date, "EEE")}
                            </span>
                            <span className="text-xl font-black">
                                {format(date, "d")}
                            </span>
                            <span className="text-[10px] font-medium opacity-60">
                                {format(date, "MMM")}
                            </span>
                        </Button>
                    );
                })}
            </div>

            {/* Time Slots (Only show if date selected) */}
            {selectedDate && (
                <div className="space-y-3 animate-in fade-in slide-in-from-top-2 duration-300">
                    <h3 className="text-xs font-bold text-slate-400 flex items-center gap-2 uppercase tracking-wide">
                        <Clock className="w-3 h-3 text-emerald-400" />
                        Available Slots
                    </h3>
                    <div className="grid grid-cols-3 gap-2">
                        {[
                            { id: "morning", label: "Morning", range: "8am - 12pm" },
                            { id: "afternoon", label: "Afternoon", range: "12pm - 4pm" },
                            { id: "evening", label: "Evening", range: "4pm - 8pm" },
                        ].map((slot) => (
                            <Button
                                key={slot.id}
                                variant={timeSlot === slot.id ? "default" : "outline"}
                                className={cn(
                                    "h-auto py-3 flex-shrink-0 flex flex-col items-center gap-0.5 rounded-lg transition-all border-2",
                                    timeSlot === slot.id
                                        ? "border-amber-400 text-amber-100 shadow-[0_0_20px_rgba(251,191,36,0.8)] bg-amber-950/60 bg-gradient-to-r from-amber-500/40 via-yellow-200/40 to-amber-500/40 bg-[length:200%_100%] animate-gradient-x"
                                        : "bg-slate-900/80 border-amber-500/70 text-amber-100/80 shadow-[0_0_10px_rgba(251,191,36,0.2)] hover:border-amber-400 hover:text-amber-100 hover:shadow-[0_0_15px_rgba(251,191,36,0.4)] hover:bg-amber-950/40"
                                )}
                                onClick={() => handleSlotSelect(slot.id as any)}
                            >
                                <span className="font-bold text-xs">{slot.label}</span>
                                <span className="text-[9px] opacity-70">{slot.range}</span>
                            </Button>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}
