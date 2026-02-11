import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { Loader2, Plus, Trash2, Calendar, Clock, Save } from "lucide-react";
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

    // New blocked date form
    const [newBlockedDate, setNewBlockedDate] = useState('');
    const [newBlockedReason, setNewBlockedReason] = useState('');

    // Fetch master availability patterns
    const { data: masterPatterns, isLoading: patternsLoading } = useQuery<MasterAvailability[]>({
        queryKey: ["masterAvailability"],
        queryFn: async () => {
            const res = await fetch("/api/admin/availability/master");
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
            const res = await fetch("/api/admin/availability/blocked-dates");
            if (!res.ok) throw new Error("Failed to fetch blocked dates");
            return res.json();
        },
    });

    // Save weekly patterns mutation
    const savePatternsMutation = useMutation({
        mutationFn: async (patterns: typeof weeklyPatterns) => {
            const res = await fetch("/api/admin/availability/master", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
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
                headers: { "Content-Type": "application/json" },
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
                    {/* Add new blocked date */}
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
