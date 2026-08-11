import { useMemo, useState, useEffect } from "react";
import { addDays, startOfToday, format, isSameDay } from "date-fns";
import { Calendar as CalendarIcon, Clock } from "lucide-react";
import { cn } from "@/lib/utils";
import { useQuoteAvailability, formatDateStr, type QuoteDateAvailability } from "@/hooks/useAvailability";

export type VisitSlot = "am" | "pm";

export interface VisitBookingSelection {
    date: Date;
    slot: VisitSlot;
}

interface VisitDatePickerProps {
    onSelect: (selection: VisitBookingSelection) => void;
    selected?: VisitBookingSelection;
    /**
     * The quote whose LEAD/skin contractor's real availability drives the
     * calendar — the SAME source the skinned contextual quote page uses. The
     * server resolves the contractor (e.g. Craig) from the quote, so no
     * contractor id is passed from the client.
     */
    quoteId?: string;
    /** Retained for API compatibility; availability is now quote-scoped, not postcode-scoped. */
    postcode?: string;
    /** Earliest bookable day, counted from today (0 = today). */
    minDaysInFuture?: number;
    /** How many days to show. */
    days?: number;
    className?: string;
}

const INITIAL_VISIBLE = 8;

/**
 * Dark-themed date picker for the diagnostic visit page — now backed by the
 * SAME availability source and grid as the skinned contextual quote page.
 *
 * It fetches the quote's lead-contractor availability via
 * `useQuoteAvailability` (GET /api/public/quote/:id/availability), which the
 * server scopes to the resolved lead/skin contractor (e.g. Craig). Only days
 * that contractor is genuinely free are selectable; the am/pm windows come
 * straight from what the engine returns for that day. Presented as the 4-column
 * grid + "show more dates" the contextual quote uses, so the two calendars
 * match.
 */
export function VisitDatePicker({
    onSelect,
    selected,
    quoteId,
    minDaysInFuture = 0,
    days = 28,
    className,
}: VisitDatePickerProps) {
    const [selectedDate, setSelectedDate] = useState<Date | undefined>(selected?.date);
    const [slot, setSlot] = useState<VisitSlot | undefined>(selected?.slot);
    const [showAll, setShowAll] = useState(false);

    useEffect(() => {
        setSelectedDate(selected?.date);
        setSlot(selected?.slot);
    }, [selected]);

    // Query am + pm separately so we know which windows the lead contractor has
    // open on each day (the endpoint is slot-specific and returns only free days).
    const amAvail = useQuoteAvailability({ quoteId, slot: "am", enabled: !!quoteId });
    const pmAvail = useQuoteAvailability({ quoteId, slot: "pm", enabled: !!quoteId });
    const isLoading = amAvail.isLoading || pmAvail.isLoading;
    const hasData = amAvail.data !== undefined || pmAvail.data !== undefined;

    // date string -> which windows are free for the lead contractor.
    const availByDate = useMemo(() => {
        const map = new Map<string, { am: boolean; pm: boolean }>();
        const mark = (rows: QuoteDateAvailability[] | undefined, key: "am" | "pm") => {
            for (const r of rows ?? []) {
                const cur = map.get(r.date) ?? { am: false, pm: false };
                cur[key] = true;
                map.set(r.date, cur);
            }
        };
        mark(amAvail.data, "am");
        mark(pmAvail.data, "pm");
        return map;
    }, [amAvail.data, pmAvail.data]);

    // Calendar window: next `days` days, Sundays skipped (mirrors the contextual grid).
    const dateList = useMemo(() => {
        const out: Date[] = [];
        let d = addDays(startOfToday(), minDaysInFuture);
        for (let guard = 0; out.length < days && guard < days + 21; guard++) {
            if (d.getDay() !== 0) out.push(d); // skip Sundays
            d = addDays(d, 1);
        }
        return out;
    }, [days, minDaysInFuture]);

    // No entry for a date = the lead contractor isn't free that day. Before data
    // loads nothing is selectable, so we never surface a day Craig can't do.
    const slotsForDate = (date: Date): { am: boolean; pm: boolean } =>
        availByDate.get(formatDateStr(date)) ?? { am: false, pm: false };

    const handleDate = (date: Date) => {
        setSelectedDate(date);
        setSlot(undefined); // reset window when the day changes
    };

    const handleSlot = (s: VisitSlot) => {
        setSlot(s);
        if (selectedDate) onSelect({ date: selectedDate, slot: s });
    };

    const selectedSlots = selectedDate ? slotsForDate(selectedDate) : { am: false, pm: false };
    const visible = showAll ? dateList : dateList.slice(0, INITIAL_VISIBLE);
    const noneAvailable = hasData && !isLoading && availByDate.size === 0;

    return (
        <div className={cn("space-y-4", className)}>
            <div className="flex items-center gap-2">
                <CalendarIcon className="w-4 h-4 text-emerald-400" />
                <h3 className="text-sm font-bold text-white">Pick a date</h3>
                {isLoading && <span className="text-[10px] text-slate-500">checking availability…</span>}
            </div>

            {noneAvailable ? (
                <p className="text-sm text-slate-400 bg-slate-900/50 border border-slate-700 rounded-lg p-3">
                    No online slots right now — message Ben and we&rsquo;ll fit you in.
                </p>
            ) : (
                <>
                    {/* 4-column date grid — mirrors the contextual quote calendar */}
                    <div className="grid grid-cols-4 gap-2">
                        {visible.map((date) => {
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
                                        "flex flex-col items-center gap-0.5 py-2.5 rounded-xl border-2 transition-all",
                                        !available
                                            ? "opacity-40 cursor-not-allowed bg-slate-900/40 border-slate-800 text-slate-500"
                                            : isSelected
                                                ? "border-amber-400 text-amber-100 bg-amber-950/60 shadow-[0_0_16px_rgba(251,191,36,0.5)]"
                                                : "bg-slate-900/70 border-slate-700 text-slate-200 hover:border-amber-400/70 hover:bg-amber-950/30"
                                    )}
                                >
                                    <span className="text-[10px] uppercase font-bold tracking-wider opacity-60">{format(date, "EEE")}</span>
                                    <span className="text-lg font-black leading-none">{format(date, "d")}</span>
                                    <span className="text-[10px] font-medium opacity-60">{format(date, "MMM")}</span>
                                    {!available && hasData && <span className="text-[7px] font-semibold text-slate-500">Full</span>}
                                </button>
                            );
                        })}
                    </div>

                    {dateList.length > INITIAL_VISIBLE && (
                        <button
                            type="button"
                            onClick={() => setShowAll((v) => !v)}
                            className="text-xs font-semibold text-amber-300/80 hover:text-amber-200 transition-colors"
                        >
                            {showAll ? "Show fewer dates" : "Show more dates"}
                        </button>
                    )}

                    {/* Time window — only the windows the lead contractor has free that day */}
                    {selectedDate && (
                        <div className="space-y-2 animate-in fade-in slide-in-from-top-2 duration-300">
                            <h4 className="text-xs font-bold text-slate-400 flex items-center gap-2 uppercase tracking-wide">
                                <Clock className="w-3 h-3 text-emerald-400" /> Choose a window
                            </h4>
                            <div className="grid grid-cols-2 gap-2">
                                {([
                                    { id: "am" as const, label: "Morning", range: "8am – 1pm", open: selectedSlots.am },
                                    { id: "pm" as const, label: "Afternoon", range: "1pm – 6pm", open: selectedSlots.pm },
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
                                                    ? "border-amber-400 text-amber-100 bg-amber-950/60 shadow-[0_0_16px_rgba(251,191,36,0.5)]"
                                                    : "bg-slate-900/70 border-slate-700 text-slate-200 hover:border-amber-400/70 hover:bg-amber-950/30"
                                        )}
                                    >
                                        <span className="font-bold text-xs">{w.label}</span>
                                        <span className="text-[9px] opacity-70">{w.range}</span>
                                        {!w.open && <span className="text-[7px] text-slate-500">Full</span>}
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}
                </>
            )}
        </div>
    );
}
