import { useState, useEffect } from 'react';
import { useLocation } from 'wouter';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
    ChevronLeft,
    ChevronRight,
    Calendar as CalendarIcon,
    Clock,
    Check,
    X,
    ArrowLeft,
    Wrench,
    LogOut,
    Save
} from 'lucide-react';

interface DateAvailability {
    id: string;
    date: string;
    isAvailable: boolean;
    startTime: string | null;
    endTime: string | null;
    notes: string | null;
}

interface WeeklyPattern {
    id: string;
    dayOfWeek: number;
    startTime: string;
    endTime: string;
    isActive: boolean;
}

export default function ContractorCalendar() {
    const [, setLocation] = useLocation();
    const queryClient = useQueryClient();

    const [currentDate, setCurrentDate] = useState(new Date());
    const [selectedDates, setSelectedDates] = useState<Set<string>>(new Set());
    const [selectionMode, setSelectionMode] = useState<'available' | 'blocked'>('available');
    const [showWeeklyModal, setShowWeeklyModal] = useState(false);

    const currentMonth = currentDate.getMonth() + 1;
    const currentYear = currentDate.getFullYear();

    // Fetch month data
    const { data: monthData, isLoading } = useQuery({
        queryKey: ['contractor-availability', currentYear, currentMonth],
        queryFn: async () => {
            const res = await fetch(`/api/contractor/availability/${currentYear}/${currentMonth}`);
            if (!res.ok) throw new Error('Failed to fetch availability');
            return res.json();
        }
    });

    // Save dates mutation
    const saveDatesMutation = useMutation({
        mutationFn: async (data: { dates: string[], isAvailable: boolean }) => {
            const res = await fetch('/api/contractor/availability/dates', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data)
            });
            if (!res.ok) throw new Error('Failed to save dates');
            return res.json();
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['contractor-availability'] });
            setSelectedDates(new Set());
        }
    });

    // Save weekly pattern mutation
    const saveWeeklyMutation = useMutation({
        mutationFn: async (patterns: any[]) => {
            const res = await fetch('/api/contractor/availability/weekly', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ patterns })
            });
            if (!res.ok) throw new Error('Failed to save weekly pattern');
            return res.json();
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['contractor-availability'] });
            setShowWeeklyModal(false);
        }
    });

    const handleSave = () => {
        const dates = Array.from(selectedDates);
        if (dates.length === 0) return;

        saveDatesMutation.mutate({
            dates,
            isAvailable: selectionMode === 'available',
        });
    };

    const navigateMonth = (delta: number) => {
        const newDate = new Date(currentDate);
        newDate.setMonth(newDate.getMonth() + delta);
        setCurrentDate(newDate);
        setSelectedDates(new Set());
    };

    const daysInMonth = new Date(currentYear, currentMonth, 0).getDate();
    const firstDayOfMonth = new Date(currentYear, currentMonth - 1, 1).getDay();
    const firstDayOffset = firstDayOfMonth;

    const getDateKey = (day: number) => {
        return `${currentYear}-${String(currentMonth).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    };

    const getDateStatus = (day: number): 'available' | 'blocked' | null => {
        const dateKey = getDateKey(day);
        const dateData = monthData?.dates?.find((d: DateAvailability) => d.date === dateKey);
        if (!dateData) return null;
        return dateData.isAvailable ? 'available' : 'blocked';
    };

    const toggleDateSelection = (day: number) => {
        const dateKey = getDateKey(day);
        setSelectedDates(prev => {
            const newSet = new Set(prev);
            if (newSet.has(dateKey)) {
                newSet.delete(dateKey);
            } else {
                newSet.add(dateKey);
            }
            return newSet;
        });
    };

    const isPastDate = (day: number) => {
        const dateKey = getDateKey(day);
        const today = new Date().toISOString().split('T')[0];
        return dateKey < today;
    };

    const monthNames = ['January', 'February', 'March', 'April', 'May', 'June',
        'July', 'August', 'September', 'October', 'November', 'December'];
    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

    return (
        <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 p-4 sm:p-6 pb-24 lg:pb-6">
            <main className="max-w-5xl mx-auto">
                {/* Header */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6 sm:mb-8">
                    <div className="flex items-center gap-4">
                        <button
                            onClick={() => setLocation('/contractor')}
                            className="p-2 hover:bg-white/10 rounded-lg transition-colors"
                        >
                            <ArrowLeft className="w-5 h-5 text-slate-400" />
                        </button>
                        <div>
                            <h1 className="text-2xl sm:text-3xl font-bold text-white flex items-center gap-3">
                                <CalendarIcon className="w-6 h-6 sm:w-8 sm:h-8 text-amber-500" />
                                Availability
                            </h1>
                            <p className="text-slate-400 text-sm mt-1">Manage your work schedule</p>
                        </div>
                    </div>
                    <button
                        onClick={() => setLocation('/contractor')}
                        className="hidden sm:flex px-4 py-2 bg-white/5 hover:bg-white/10 border border-white/10 text-slate-300 rounded-xl text-sm transition-all items-center gap-2"
                    >
                        <LogOut className="w-4 h-4" />
                        Back to Dashboard
                    </button>
                </div>

                {/* Controls */}
                <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-4 mb-6">
                    <div className="flex items-center gap-2 bg-white/5 rounded-xl p-1 self-start sm:self-auto">
                        <button
                            onClick={() => setSelectionMode('available')}
                            className={`flex-1 sm:flex-none px-4 py-2 rounded-lg text-sm font-medium transition-all ${selectionMode === 'available'
                                ? 'bg-emerald-500 text-white'
                                : 'text-slate-400 hover:text-white'
                                }`}
                        >
                            <Check className="w-4 h-4 inline-block mr-1" />
                            Available
                        </button>
                        <button
                            onClick={() => setSelectionMode('blocked')}
                            className={`flex-1 sm:flex-none px-4 py-2 rounded-lg text-sm font-medium transition-all ${selectionMode === 'blocked'
                                ? 'bg-red-500 text-white'
                                : 'text-slate-400 hover:text-white'
                                }`}
                        >
                            <X className="w-4 h-4 inline-block mr-1" />
                            Blocked
                        </button>
                    </div>

                    <div className="flex gap-2">
                        <button
                            onClick={() => setShowWeeklyModal(true)}
                            className="flex-1 sm:flex-none px-4 py-2 bg-white/5 hover:bg-white/10 border border-white/10 text-slate-300 rounded-xl text-sm transition-all whitespace-nowrap"
                        >
                            <Clock className="w-4 h-4 inline-block mr-1" />
                            Weekly Pattern
                        </button>

                        {selectedDates.size > 0 && (
                            <button
                                onClick={handleSave}
                                disabled={saveDatesMutation.isPending}
                                className="flex-1 sm:flex-none px-4 py-2 bg-amber-500 hover:bg-amber-400 text-white rounded-xl text-sm font-medium flex items-center justify-center gap-2 transition-all ml-auto"
                            >
                                {saveDatesMutation.isPending ? (
                                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                                ) : (
                                    <Save className="w-4 h-4" />
                                )}
                                Save {selectedDates.size}
                            </button>
                        )}
                    </div>
                </div>

                {/* Calendar Card */}
                <div className="bg-white/5 backdrop-blur-sm rounded-2xl border border-white/10 p-6">
                    {/* Month Navigation */}
                    <div className="flex items-center justify-between mb-6">
                        <button
                            onClick={() => navigateMonth(-1)}
                            className="p-2 hover:bg-white/10 rounded-lg transition-colors"
                        >
                            <ChevronLeft className="w-5 h-5 text-slate-400" />
                        </button>
                        <h2 className="text-xl font-semibold text-white">
                            {monthNames[currentMonth - 1]} {currentYear}
                        </h2>
                        <button
                            onClick={() => navigateMonth(1)}
                            className="p-2 hover:bg-white/10 rounded-lg transition-colors"
                        >
                            <ChevronRight className="w-5 h-5 text-slate-400" />
                        </button>
                    </div>

                    {/* Day Headers */}
                    <div className="grid grid-cols-7 gap-2 mb-4">
                        {dayNames.map(day => (
                            <div key={day} className="text-center text-slate-500 text-sm font-medium py-2">
                                {day}
                            </div>
                        ))}
                    </div>

                    {/* Calendar Grid */}
                    {isLoading ? (
                        <div className="flex items-center justify-center py-20">
                            <div className="w-8 h-8 border-2 border-amber-500/30 border-t-amber-500 rounded-full animate-spin" />
                        </div>
                    ) : (
                        <div className="grid grid-cols-7 gap-2">
                            {/* Empty cells for offset */}
                            {Array.from({ length: firstDayOffset }).map((_, i) => (
                                <div key={`empty-${i}`} className="aspect-square" />
                            ))}

                            {/* Day cells */}
                            {Array.from({ length: daysInMonth }).map((_, i) => {
                                const day = i + 1;
                                const dateKey = getDateKey(day);
                                const status = getDateStatus(day);
                                const isSelected = selectedDates.has(dateKey);
                                const isPast = isPastDate(day);
                                const isToday = new Date().toISOString().split('T')[0] === dateKey;

                                return (
                                    <button
                                        key={day}
                                        onClick={() => !isPast && toggleDateSelection(day)}
                                        disabled={isPast}
                                        className={`
                                            aspect-square rounded-xl flex flex-col items-center justify-center
                                            transition-all relative
                                            ${isPast
                                                ? 'opacity-30 cursor-not-allowed'
                                                : 'hover:scale-105 cursor-pointer'
                                            }
                                            ${isSelected
                                                ? selectionMode === 'available'
                                                    ? 'ring-2 ring-emerald-400 bg-emerald-500/30'
                                                    : 'ring-2 ring-red-400 bg-red-500/30'
                                                : status === 'available'
                                                    ? 'bg-emerald-500/20 border border-emerald-500/30'
                                                    : status === 'blocked'
                                                        ? 'bg-red-500/20 border border-red-500/30'
                                                        : 'bg-white/5 border border-white/10'
                                            }
                                            ${isToday ? 'ring-2 ring-amber-400' : ''}
                                        `}
                                    >
                                        <span className={`
                                            text-lg font-semibold
                                            ${status === 'available' ? 'text-emerald-400' :
                                                status === 'blocked' ? 'text-red-400' : 'text-slate-400'}
                                        `}>
                                            {day}
                                        </span>
                                        {status === 'available' && (
                                            <Check className="w-3 h-3 text-emerald-400" />
                                        )}
                                        {status === 'blocked' && (
                                            <X className="w-3 h-3 text-red-400" />
                                        )}
                                    </button>
                                );
                            })}
                        </div>
                    )}

                    {/* Legend */}
                    <div className="mt-6 flex flex-wrap items-center gap-4 text-sm text-slate-400">
                        <span className="flex items-center gap-2">
                            <span className="w-4 h-4 rounded bg-emerald-500/30 border border-emerald-500/50" />
                            Available
                        </span>
                        <span className="flex items-center gap-2">
                            <span className="w-4 h-4 rounded bg-red-500/30 border border-red-500/50" />
                            Blocked
                        </span>
                        <span className="flex items-center gap-2">
                            <span className="w-4 h-4 rounded bg-white/5 border border-white/10" />
                            No Preference
                        </span>
                        <span className="flex items-center gap-2">
                            <span className="w-4 h-4 rounded ring-2 ring-amber-400" />
                            Today
                        </span>
                    </div>
                </div>
            </main>

            {/* Weekly Pattern Modal */}
            {showWeeklyModal && (
                <WeeklyPatternModal
                    patterns={monthData?.weeklyPatterns || []}
                    onSave={(patterns) => saveWeeklyMutation.mutate(patterns)}
                    onClose={() => setShowWeeklyModal(false)}
                    isSaving={saveWeeklyMutation.isPending}
                />
            )}
        </div>
    );
}

function WeeklyPatternModal({
    patterns,
    onSave,
    onClose,
    isSaving
}: {
    patterns: WeeklyPattern[];
    onSave: (patterns: any[]) => void;
    onClose: () => void;
    isSaving: boolean;
}) {
    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

    const [localPatterns, setLocalPatterns] = useState(() => {
        return dayNames.map((_, index) => {
            const existing = patterns.find(p => p.dayOfWeek === index);
            return {
                dayOfWeek: index,
                isActive: existing?.isActive ?? false,
                startTime: existing?.startTime ?? '09:00',
                endTime: existing?.endTime ?? '17:00',
            };
        });
    });

    const toggleDay = (dayIndex: number) => {
        setLocalPatterns(prev => prev.map((p, i) =>
            i === dayIndex ? { ...p, isActive: !p.isActive } : p
        ));
    };

    const updateTime = (dayIndex: number, field: 'startTime' | 'endTime', value: string) => {
        setLocalPatterns(prev => prev.map((p, i) =>
            i === dayIndex ? { ...p, [field]: value } : p
        ));
    };

    const handleSave = () => {
        onSave(localPatterns.filter(p => p.isActive));
    };

    return (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="bg-slate-800 rounded-2xl border border-white/10 shadow-2xl w-full max-w-md max-h-[90vh] overflow-y-auto">
                <div className="p-6 border-b border-white/10">
                    <h3 className="text-xl font-semibold text-white">Weekly Availability Pattern</h3>
                    <p className="text-slate-400 text-sm mt-1">Set your recurring weekly schedule</p>
                </div>

                <div className="p-6 space-y-3">
                    {localPatterns.map((pattern, index) => (
                        <div
                            key={pattern.dayOfWeek}
                            className={`p-4 rounded-xl border transition-all ${pattern.isActive
                                ? 'bg-emerald-500/10 border-emerald-500/30'
                                : 'bg-white/5 border-white/10'
                                }`}
                        >
                            <div className="flex items-center justify-between mb-3">
                                <span className={`font-medium ${pattern.isActive ? 'text-emerald-400' : 'text-slate-400'}`}>
                                    {dayNames[index]}
                                </span>
                                <button
                                    onClick={() => toggleDay(index)}
                                    className={`w-12 h-6 rounded-full transition-all ${pattern.isActive ? 'bg-emerald-500' : 'bg-white/10'
                                        }`}
                                >
                                    <div className={`w-5 h-5 rounded-full bg-white shadow-md transform transition-all ${pattern.isActive ? 'translate-x-6' : 'translate-x-0.5'
                                        }`} />
                                </button>
                            </div>

                            {pattern.isActive && (
                                <div className="flex items-center gap-2">
                                    <input
                                        type="time"
                                        value={pattern.startTime}
                                        onChange={(e) => updateTime(index, 'startTime', e.target.value)}
                                        className="flex-1 px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
                                    />
                                    <span className="text-slate-500">to</span>
                                    <input
                                        type="time"
                                        value={pattern.endTime}
                                        onChange={(e) => updateTime(index, 'endTime', e.target.value)}
                                        className="flex-1 px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
                                    />
                                </div>
                            )}
                        </div>
                    ))}
                </div>

                <div className="p-6 border-t border-white/10 flex gap-3">
                    <button
                        onClick={onClose}
                        className="flex-1 py-3 bg-white/5 hover:bg-white/10 text-white font-medium rounded-xl transition-all"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={handleSave}
                        disabled={isSaving}
                        className="flex-1 py-3 bg-amber-500 hover:bg-amber-400 text-white font-medium rounded-xl transition-all flex items-center justify-center gap-2"
                    >
                        {isSaving ? (
                            <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                        ) : (
                            <>
                                <Save className="w-4 h-4" />
                                Save Pattern
                            </>
                        )}
                    </button>
                </div>
            </div>
        </div>
    );
}
