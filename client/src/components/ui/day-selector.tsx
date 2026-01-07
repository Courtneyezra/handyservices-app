import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Check } from "lucide-react";

interface DaySelectorProps {
    value: string; // "1,2,3,4,5"
    onChange: (value: string) => void;
    disabled?: boolean;
    className?: string;
}

const DAYS = [
    { id: 1, label: "Mon", fullLabel: "Monday" },
    { id: 2, label: "Tue", fullLabel: "Tuesday" },
    { id: 3, label: "Wed", fullLabel: "Wednesday" },
    { id: 4, label: "Thu", fullLabel: "Thursday" },
    { id: 5, label: "Fri", fullLabel: "Friday" },
    { id: 6, label: "Sat", fullLabel: "Saturday" },
    { id: 7, label: "Sun", fullLabel: "Sunday" },
];

export function DaySelector({ value, onChange, disabled = false, className }: DaySelectorProps) {
    const selectedDays = value ? value.split(',').map(Number) : [];

    const toggleDay = (dayId: number) => {
        if (disabled) return;

        const newSelectedDays = selectedDays.includes(dayId)
            ? selectedDays.filter(d => d !== dayId)
            : [...selectedDays, dayId];

        // Sort effectively to keep "1,2,3" format clean
        onChange(newSelectedDays.sort((a, b) => a - b).join(','));
    };

    const selectAll = () => {
        onChange("1,2,3,4,5,6,7");
    };

    const clearAll = () => {
        onChange("");
    };

    const isWeekdaysOnly = selectedDays.length === 5 && [1, 2, 3, 4, 5].every(d => selectedDays.includes(d));
    const isAllDays = selectedDays.length === 7;

    return (
        <div className={cn("space-y-3", className)}>
            <div className="flex flex-wrap gap-2">
                {DAYS.map((day) => {
                    const isSelected = selectedDays.includes(day.id);
                    return (
                        <button
                            key={day.id}
                            type="button"
                            onClick={() => toggleDay(day.id)}
                            disabled={disabled}
                            className={cn(
                                "flex items-center gap-1.5 px-3 py-2 rounded-md border text-sm font-medium transition-all focus:outline-none focus:ring-2 focus:ring-blue-500/50",
                                isSelected
                                    ? "bg-blue-600 text-white border-blue-600 hover:bg-blue-700"
                                    : "bg-background text-muted-foreground border-input hover:bg-accent hover:text-accent-foreground",
                                disabled && "opacity-50 cursor-not-allowed"
                            )}
                            aria-label={`Toggle ${day.fullLabel}`}
                            aria-pressed={isSelected}
                        >
                            {isSelected && <Check className="w-3.5 h-3.5" />}
                            {day.label}
                        </button>
                    );
                })}
            </div>

            <div className="flex gap-2 text-xs">
                <Button
                    variant="ghost"
                    size="sm"
                    onClick={selectAll}
                    disabled={disabled || isAllDays}
                    className="h-7 px-2 text-muted-foreground hover:text-foreground"
                >
                    Select All
                </Button>
                <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => onChange("1,2,3,4,5")}
                    disabled={disabled || isWeekdaysOnly}
                    className="h-7 px-2 text-muted-foreground hover:text-foreground"
                >
                    Weekdays Only
                </Button>
                <Button
                    variant="ghost"
                    size="sm"
                    onClick={clearAll}
                    disabled={disabled || selectedDays.length === 0}
                    className="h-7 px-2 text-muted-foreground hover:text-foreground"
                >
                    Clear All
                </Button>
            </div>
        </div>
    );
}
