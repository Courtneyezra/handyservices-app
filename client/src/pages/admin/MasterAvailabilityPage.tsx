import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { format, getDaysInMonth, getDay, startOfMonth } from "date-fns";
import { Loader2, Plus, Trash2, Calendar, Clock, Save, ChevronLeft, ChevronRight } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";

interface MasterAvailability {
    id: number;
    dayOfWeek: number;
    startTime: string | null;
    endTime: string | null;
    isActive: boolean;
}

interface MasterBlockedDate {
    id: number;
    date: string;
    reason: string | null;
    createdAt: string;
}

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function getAuthHeaders(): Record<string, string> {
    const token = localStorage.getItem('adminToken');
    return token ? { Authorization: `Bearer ${token}` } : {};
}

export default function MasterAvailabilityPage() {
    const { toast } = useToast();
    const queryClient = useQueryClient();

    // Local state for weekly pattern editing
    const [weeklyPatterns, setWeeklyPatterns] = useState<{
        dayOfWeek: number;
        startTime: string;
        endTime: string;
        isActive: boolean;
    }[]>([]);
    const [patternsInitialized, setPatternsInitialized] = useState(false);

    // Calendar month navigation
    const [calendarDate, setCalendarDate] = useState(new Date());

    // New blocked date form
    const [newBlockedDate, setNewBlockedDate] = useState('');
    const [newBlockedReason, setNewBlockedReason] = useState('');

    // Fetch master availability patterns
    const { data: masterPatterns, isLoading: patternsLoading } = useQuery<MasterAvailability[]>({
        queryKey: ["masterAvailability"],
        queryFn: async () => {
            const res = await fetch("/api/admin/availability/master", {
                headers: getAuthHeaders(),
            });
            if (!res.ok) throw new Error("Failed to fetch master availability");
            return res.json();
        },
    });

    // Initialize local state from fetched data
    if (masterPatterns && !patternsInitialized) {
        const initialPatterns = DAYS.map((_, index) => {
            const existing = masterPatterns.find(p => p.dayOfWeek === index);
            return {
                dayOfWeek: index,
                startTime: existing?.startTime || '09:00',
                endTime: existing?.endTime || '17:00',
                isActive: existing?.isActive ?? (index >= 1 && index <= 5), // Default Mon-Fri
            };
        });
        setWeeklyPatterns(initialPatterns);
        setPatternsInitialized(true);
    }

    // Fetch blocked dates
    const { data: blockedDates, isLoading: blockedLoading } = useQuery<MasterBlockedDate[]>({
        queryKey: ["masterBlockedDates"],
        queryFn: async () => {
            const res = await fetch("/api/admin/availability/blocked-dates", {
                headers: getAuthHeaders(),
            });
            if (!res.ok) throw new Error("Failed to fetch blocked dates");
            return res.json();
        },
    });

    // Save weekly patterns mutation
    const savePatternsMutation = useMutation({
        mutationFn: async (patterns: typeof weeklyPatterns) => {
            const res = await fetch("/api/admin/availability/master", {
                method: "POST",
                headers: { "Content-Type": "application/json", ...getAuthHeaders() },
                body: JSON.stringify({ patterns }),
            });
            if (!res.ok) throw new Error("Failed to save patterns");
            return res.json();
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["masterAvailability"] });
            toast({
                title: "Patterns Saved",
                description: "Master availability patterns updated successfully.",
            });
        },
        onError: () => {
            toast({
                title: "Error",
                description: "Failed to save patterns.",
                variant: "destructive",
            });
        },
    });

    // Add blocked date mutation
    const addBlockedDateMutation = useMutation({
        mutationFn: async ({ date, reason }: { date: string; reason: string }) => {
            const res = await fetch("/api/admin/availability/blocked-dates", {
                method: "POST",
                headers: { "Content-Type": "application/json", ...getAuthHeaders() },
                body: JSON.stringify({ date, reason }),
            });
            if (!res.ok) throw new Error("Failed to add blocked date");
            return res.json();
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["masterBlockedDates"] });
            setNewBlockedDate('');
            setNewBlockedReason('');
            toast({
                title: "Date Blocked",
                description: "Blocked date added successfully.",
            });
        },
        onError: () => {
            toast({
                title: "Error",
                description: "Failed to add blocked date.",
                variant: "destructive",
            });
        },
    });

    // Delete blocked date mutation
    const deleteBlockedDateMutation = useMutation({
        mutationFn: async (id: number) => {
            const res = await fetch(`/api/admin/availability/blocked-dates/${id}`, {
                method: "DELETE",
                headers: getAuthHeaders(),
            });
            if (!res.ok) throw new Error("Failed to delete blocked date");
            return res.json();
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["masterBlockedDates"] });
            toast({
                title: "Date Unblocked",
                description: "Blocked date removed successfully.",
            });
        },
        onError: () => {
            toast({
                title: "Error",
                description: "Failed to remove blocked date.",
                variant: "destructive",
            });
        },
    });

    // Toggle blocked date mutation (for calendar clicks)
    const toggleBlockedDateMutation = useMutation({
        mutationFn: async (date: string) => {
            const res = await fetch("/api/admin/availability/blocked-dates/toggle", {
                method: "POST",
                headers: { "Content-Type": "application/json", ...getAuthHeaders() },
                body: JSON.stringify({ date }),
            });
            if (!res.ok) throw new Error("Failed to toggle blocked date");
            return res.json();
        },
        onSuccess: (data: { action: string; date: string }) => {
            queryClient.invalidateQueries({ queryKey: ["masterBlockedDates"] });
            toast({
                title: data.action === 'blocked' ? "Date Blocked" : "Date Unblocked",
                description: `${data.date} has been ${data.action}.`,
            });
        },
        onError: () => {
            toast({
                title: "Error",
                description: "Failed to toggle blocked date.",
                variant: "destructive",
            });
        },
    });

    // Calendar helpers
    const currentYear = calendarDate.getFullYear();
    const currentMonth = calendarDate.getMonth();
    const daysInCurrentMonth = getDaysInMonth(calendarDate);
    const firstDayOffset = getDay(startOfMonth(calendarDate));
    const todayStr = format(new Date(), 'yyyy-MM-dd');

    const blockedDateSet = new Set(
        (blockedDates || []).map(bd => bd.date)
    );

    const getDateKey = (day: number) => {
        return `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    };

    const navigateMonth = (delta: number) => {
        setCalendarDate(prev => {
            const next = new Date(prev);
            next.setMonth(next.getMonth() + delta);
            return next;
        });
    };

    const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June',
        'July', 'August', 'September', 'October', 'November', 'December'];
    const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

    const updatePattern = (dayOfWeek: number, field: string, value: string | boolean) => {
        setWeeklyPatterns(prev => prev.map(p =>
            p.dayOfWeek === dayOfWeek ? { ...p, [field]: value } : p
        ));
    };

    const handleAddBlockedDate = () => {
        if (!newBlockedDate) return;
        addBlockedDateMutation.mutate({ date: newBlockedDate, reason: newBlockedReason });
    };

    if (patternsLoading || blockedLoading) {
        return (
            <div className="flex items-center justify-center h-64">
                <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
            </div>
        );
    }

    return (
        <div className="container mx-auto p-6 space-y-6">
            <div>
                <h1 className="text-2xl font-bold text-gray-900">Master Availability</h1>
                <p className="text-gray-500 mt-1">Set system-wide default availability patterns and blocked dates.</p>
            </div>

            {/* Weekly Pattern Editor */}
            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <Clock className="h-5 w-5" />
                        Default Weekly Pattern
                    </CardTitle>
                    <CardDescription>
                        These defaults apply to all contractors unless overridden by their individual settings.
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    {weeklyPatterns.map((pattern) => (
                        <div key={pattern.dayOfWeek} className="flex items-center gap-4 p-3 bg-gray-50 rounded-lg">
                            <div className="w-28">
                                <span className="font-medium">{DAYS[pattern.dayOfWeek]}</span>
                            </div>
                            <Switch
                                checked={pattern.isActive}
                                onCheckedChange={(checked) => updatePattern(pattern.dayOfWeek, 'isActive', checked)}
                            />
                            {pattern.isActive && (
                                <>
                                    <div className="flex items-center gap-2">
                                        <Label className="text-sm text-gray-500">From</Label>
                                        <Input
                                            type="time"
                                            value={pattern.startTime}
                                            onChange={(e) => updatePattern(pattern.dayOfWeek, 'startTime', e.target.value)}
                                            className="w-28"
                                        />
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <Label className="text-sm text-gray-500">To</Label>
                                        <Input
                                            type="time"
                                            value={pattern.endTime}
                                            onChange={(e) => updatePattern(pattern.dayOfWeek, 'endTime', e.target.value)}
                                            className="w-28"
                                        />
                                    </div>
                                </>
                            )}
                            {!pattern.isActive && (
                                <span className="text-gray-400 text-sm">Unavailable</span>
                            )}
                        </div>
                    ))}
                    <Button
                        onClick={() => savePatternsMutation.mutate(weeklyPatterns)}
                        disabled={savePatternsMutation.isPending}
                        className="mt-4"
                    >
                        {savePatternsMutation.isPending ? (
                            <Loader2 className="h-4 w-4 animate-spin mr-2" />
                        ) : (
                            <Save className="h-4 w-4 mr-2" />
                        )}
                        Save Weekly Pattern
                    </Button>
                </CardContent>
            </Card>

            {/* Blocked Dates Manager */}
            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <Calendar className="h-5 w-5" />
                        Blocked Dates
                    </CardTitle>
                    <CardDescription>
                        Add holidays or other dates when no bookings should be allowed.
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    {/* Visual Month Calendar */}
                    <div className="mb-2">
                        {/* Month Navigation */}
                        <div className="flex items-center justify-between mb-4">
                            <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => navigateMonth(-1)}
                            >
                                <ChevronLeft className="h-4 w-4" />
                            </Button>
                            <h3 className="text-lg font-semibold text-gray-800">
                                {MONTH_NAMES[currentMonth]} {currentYear}
                            </h3>
                            <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => navigateMonth(1)}
                            >
                                <ChevronRight className="h-4 w-4" />
                            </Button>
                        </div>

                        {/* Day Headers */}
                        <div className="grid grid-cols-7 gap-1 mb-2">
                            {DAY_NAMES.map(day => (
                                <div key={day} className="text-center text-xs font-medium text-gray-400 uppercase tracking-wider py-1">
                                    {day}
                                </div>
                            ))}
                        </div>

                        {/* Calendar Grid */}
                        <div className="grid grid-cols-7 gap-1">
                            {/* Empty offset cells for first week alignment */}
                            {Array.from({ length: firstDayOffset }).map((_, i) => (
                                <div key={`empty-${i}`} className="aspect-square" />
                            ))}

                            {/* Day cells */}
                            {Array.from({ length: daysInCurrentMonth }).map((_, i) => {
                                const day = i + 1;
                                const dateKey = getDateKey(day);
                                const isBlocked = blockedDateSet.has(dateKey);
                                const isCurrentDay = dateKey === todayStr;
                                const blockedEntry = (blockedDates || []).find(bd => bd.date === dateKey);

                                return (
                                    <button
                                        key={day}
                                        onClick={() => toggleBlockedDateMutation.mutate(dateKey)}
                                        disabled={toggleBlockedDateMutation.isPending}
                                        title={isBlocked
                                            ? `Blocked${blockedEntry?.reason ? `: ${blockedEntry.reason}` : ''} — click to unblock`
                                            : `Click to block ${dateKey}`
                                        }
                                        className={`
                                            aspect-square rounded-lg flex flex-col items-center justify-center
                                            text-sm font-medium transition-all relative cursor-pointer
                                            ${isBlocked
                                                ? 'bg-red-100 border-2 border-red-300 text-red-700 hover:bg-red-200'
                                                : 'bg-green-50 border border-gray-200 text-gray-700 hover:bg-gray-100'
                                            }
                                            ${isCurrentDay ? 'ring-2 ring-blue-400 ring-offset-1' : ''}
                                        `}
                                    >
                                        <span className={isBlocked ? 'line-through' : ''}>
                                            {day}
                                        </span>
                                        {isBlocked && (
                                            <span className="text-[8px] text-red-500 font-bold uppercase mt-0.5">
                                                Blocked
                                            </span>
                                        )}
                                    </button>
                                );
                            })}
                        </div>

                        {/* Legend */}
                        <div className="mt-3 flex items-center gap-4 text-xs text-gray-500">
                            <span className="flex items-center gap-1.5">
                                <span className="w-3 h-3 rounded bg-green-50 border border-gray-200" />
                                Available
                            </span>
                            <span className="flex items-center gap-1.5">
                                <span className="w-3 h-3 rounded bg-red-100 border-2 border-red-300" />
                                Blocked
                            </span>
                            <span className="flex items-center gap-1.5">
                                <span className="w-3 h-3 rounded ring-2 ring-blue-400" />
                                Today
                            </span>
                        </div>

                        <p className="text-xs text-gray-400 mt-2">
                            Click any date to toggle blocked/unblocked. Blocked dates show as "Fully Booked" on customer quotes.
                        </p>
                    </div>

                    {/* Divider */}
                    <div className="border-t border-gray-200" />

                    {/* Add new blocked date with reason */}
                    <div className="flex items-end gap-3 p-4 bg-gray-50 rounded-lg">
                        <div className="flex-1">
                            <Label className="text-sm text-gray-500">Date</Label>
                            <Input
                                type="date"
                                value={newBlockedDate}
                                onChange={(e) => setNewBlockedDate(e.target.value)}
                            />
                        </div>
                        <div className="flex-1">
                            <Label className="text-sm text-gray-500">Reason (optional)</Label>
                            <Input
                                type="text"
                                placeholder="e.g., Bank Holiday"
                                value={newBlockedReason}
                                onChange={(e) => setNewBlockedReason(e.target.value)}
                            />
                        </div>
                        <Button
                            onClick={handleAddBlockedDate}
                            disabled={!newBlockedDate || addBlockedDateMutation.isPending}
                        >
                            {addBlockedDateMutation.isPending ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                                <Plus className="h-4 w-4" />
                            )}
                            Add
                        </Button>
                    </div>

                    {/* List of blocked dates */}
                    <div className="space-y-2">
                        {blockedDates && blockedDates.length > 0 ? (
                            blockedDates.map((blocked) => (
                                <div key={blocked.id} className="flex items-center justify-between p-3 border rounded-lg">
                                    <div>
                                        <span className="font-medium">
                                            {format(new Date(blocked.date), 'EEEE, MMMM d, yyyy')}
                                        </span>
                                        {blocked.reason && (
                                            <span className="text-gray-500 ml-2">- {blocked.reason}</span>
                                        )}
                                    </div>
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        onClick={() => deleteBlockedDateMutation.mutate(blocked.id)}
                                        disabled={deleteBlockedDateMutation.isPending}
                                    >
                                        <Trash2 className="h-4 w-4 text-red-500" />
                                    </Button>
                                </div>
                            ))
                        ) : (
                            <p className="text-gray-400 text-center py-4">No blocked dates</p>
                        )}
                    </div>
                </CardContent>
            </Card>
        </div>
    );
}
