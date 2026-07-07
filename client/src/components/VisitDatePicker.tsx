import { useMemo, useState, useEffect } from "react";
import { addDays, startOfToday, format, isSameDay } from "date-fns";
import { Calendar as CalendarIcon, Clock } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAvailability, formatDateStr } from "@/hooks/useAvailability";

export type VisitSlot = "am" | "pm";

export interface VisitBookingSelection {
    date: Date;
    slot: VisitSlot;
}

interface VisitDatePickerProps {
    onSelect: (selection: VisitBookingSelection) => void;
    selected?: VisitBookingSelection;
    postcode?: string;
    /** Earliest bookable day, counted from today (0 = today). */
    minDaysInFuture?: number;
    /** How many days to show. */
    days?: number;
    className?: string;
}

/**
 * Dark-themed, availability-backed date picker for the diagnostic visit page.
 *
 * Unlike the legacy BookingCalendar (which invented 28 always-available days),
 * this reads the real master-availability engine via /api/public/availability:
 * blocked / weekend / fully-booked days are greyed out and only the am/pm
 * windows the engine actually returns are offered.
 */
export function VisitDatePicker({
    onSelect,
    selected,
    postcode,
    minDaysInFuture = 0,
    days = 28,
    className,
}: VisitDatePickerProps) {
    const [selectedDate, setSelectedDate] = useState<Date | undefined>(selected?.date);
    const [slot, setSlot] = useState<VisitSlot | undefined>(selected?.slot);

    useEffect(() => {
        setSelectedDate(selected?.date);
        setSlot(selected?.slot);
    }, [selected]);

    const { data, isLoading } = useAvailability({ postcode, days: days + 2 });

    // Map date string -> available slots for O(1) lookups.
    const slotsByDate = useMemo(() => {
        const map = new Map<string, ("am" | "pm" | "full")[]>();
        for (const d of data?.dates ?? []) {
            map.set(d.date, d.isAvailable ? d.slots : []);
        }
        return map;
    }, [data]);

    const dateList = useMemo(
        () => Array.from({ length: days }, (_, i) => addDays(startOfToday(), minDaysInFuture + i)),
        [days, minDaysInFuture]
    );

    const slotsForDate = (date: Date): { am: boolean; pm: boolean } => {
        const raw = slotsByDate.get(formatDateStr(date));
        // Before availability data arrives, fall back to "open weekdays" so the UI
        // isn't empty; once data loads the real engine result takes over.
        if (raw === undefined) {
            const weekend = date.getDay() === 0 || date.getDay() === 6;
            return { am: !weekend, pm: !weekend };
        }
        return {
            am: raw.includes("am") || raw.includes("full"),
            pm: raw.includes("pm") || raw.includes("full"),
        };
    };

    const handleDate = (date: Date) => {
        setSelectedDate(date);
        // Reset slot when the day changes so a stale am/pm can't carry over.
        setSlot(undefined);
    };

    const handleSlot = (s: VisitSlot) => {
        setSlot(s);
        if (selectedDate) onSelect({ date: selectedDate, slot: s });
    };

    const selectedSlots = selectedDate ? slotsForDate(selectedDate) : { am: false, pm: false };

    return (
        <div className={cn("space-y-4", className)}>
            <div className="flex items-center gap-2">
                <CalendarIcon className="w-4 h-4 text-emerald-400" />
                <h3 className="text-sm font-bold text-white">Select a date</h3>
                {isLoading && <span className="text-[10px] text-slate-500">checking availability…</span>}
            </div>

            {/* Horizontal date strip */}
            <div className="flex overflow-x-auto py-3 gap-2 scrollbar-thin scrollbar-thumb-slate-700 -mx-1 px-1">
                {dateList.map((date) => {
                    const { am, pm } = slotsForDate(date);
                    const available = am || pm;
                    const isSelected = selectedDate && isSameDay(date, selectedDate);

                    return (
                        <button
                            key={date.toISOString()}
                            type="button"
                            disabled={!available}
                            onClick={() => available && handleDate(date)}
                            aria-label={
                                available
                                    ? format(date, "EEEE, MMMM d")
                                    : `${format(date, "EEEE, MMMM d")} — fully booked`
                            }
                            className={cn(
                                "min-w-[70px] flex-shrink-0 flex flex-col items-center gap-1 py-3 rounded-xl border-2 transition-all",
                                !available
                                    ? "opacity-40 cursor-not-allowed bg-slate-900/40 border-slate-800 text-slate-500"
                                    : isSelected
                                        ? "border-amber-400 text-amber-100 bg-amber-950/60 shadow-[0_0_20px_rgba(251,191,36,0.6)] scale-105 z-10"
                                        : "bg-slate-900/80 border-amber-500/40 text-amber-100/80 hover:border-amber-400 hover:bg-amber-950/40"
                            )}
                        >
                            <span className="text-[10px] uppercase font-bold tracking-wider opacity-60">
                                {format(date, "EEE")}
                            </span>
                            <span className="text-xl font-black">{format(date, "d")}</span>
                            <span className="text-[10px] font-medium opacity-60">{format(date, "MMM")}</span>
                            {!available && (
                                <span className="text-[7px] font-semibold text-red-400/80">Full</span>
                            )}
                        </button>
                    );
                })}
            </div>

            {/* Time window — only the windows the engine offers for the chosen day */}
            {selectedDate && (
                <div className="space-y-3 animate-in fade-in slide-in-from-top-2 duration-300">
                    <h4 className="text-xs font-bold text-slate-400 flex items-center gap-2 uppercase tracking-wide">
                        <Clock className="w-3 h-3 text-emerald-400" /> Available windows
                    </h4>
                    <div className="grid grid-cols-2 gap-2">
                        {([
                            { id: "am" as const, label: "Morning", range: "8am – 12pm", open: selectedSlots.am },
                            { id: "pm" as const, label: "Afternoon", range: "12pm – 5pm", open: selectedSlots.pm },
                        ]).map((w) => (
                            <button
                                key={w.id}
                                type="button"
                                disabled={!w.open}
                                onClick={() => w.open && handleSlot(w.id)}
                                className={cn(
                                    "py-3 rounded-lg border-2 flex flex-col items-center gap-0.5 transition-all",
                                    !w.open
                                        ? "opacity-40 cursor-not-allowed bg-slate-900/40 border-slate-800 text-slate-500"
                                        : slot === w.id
                                            ? "border-amber-400 text-amber-100 bg-amber-950/60 shadow-[0_0_18px_rgba(251,191,36,0.6)]"
                                            : "bg-slate-900/80 border-amber-500/40 text-amber-100/80 hover:border-amber-400 hover:bg-amber-950/40"
                                )}
                            >
                                <span className="font-bold text-xs">{w.label}</span>
                                <span className="text-[9px] opacity-70">{w.range}</span>
                                {!w.open && <span className="text-[7px] text-red-400/80">Full</span>}
                            </button>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}
