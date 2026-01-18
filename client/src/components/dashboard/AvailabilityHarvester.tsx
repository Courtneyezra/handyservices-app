import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { format, addDays, isSameDay } from 'date-fns';
import { Calendar as CalendarIcon, Check, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';

interface AvailabilityDay {
    date: string; // ISO yyyy-mm-dd
    isAvailable: boolean;
    startTime?: string;
    endTime?: string;
    source: 'pattern' | 'override' | 'default_off';
}

export function AvailabilityHarvester() {
    const { toast } = useToast();
    const queryClient = useQueryClient();

    // Helper: Determine current mode from day data
    const getMode = (d: AvailabilityDay) => {
        if (!d.isAvailable) return 'off';
        // Simple logic: Starts < 12 is AM active, Ends > 12 is PM active.
        const startH = d.startTime ? parseInt(d.startTime.split(':')[0]) : 9;
        const endH = d.endTime ? parseInt(d.endTime.split(':')[0]) : 17;

        const isAm = startH < 12;
        const isPm = endH > 12;

        if (isAm && isPm) return 'full';
        if (isAm) return 'am';
        if (isPm) return 'pm';
        return 'off'; // Fallback
    };

    // Fetch Data
    const { data: days, isLoading } = useQuery<AvailabilityDay[]>({
        queryKey: ['contractor-availability'],
        queryFn: async () => {
            const token = localStorage.getItem('contractorToken');
            const res = await fetch('/api/contractor/availability/upcoming?days=14', {
                headers: { Authorization: `Bearer ${token}` }
            });
            if (!res.ok) throw new Error('Failed to fetch');
            return res.json();
        }
    });

    // Toggle Mutation (Now accepts Mode)
    const toggleMutation = useMutation({
        mutationFn: async ({ date, mode }: { date: string, mode: 'am' | 'pm' | 'full' | 'off' }) => {
            const token = localStorage.getItem('contractorToken');
            await fetch('/api/contractor/availability/toggle', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`
                },
                body: JSON.stringify({ date, mode })
            });
        },
        onMutate: async ({ date, mode }) => {
            // Optimistic Update
            await queryClient.cancelQueries({ queryKey: ['contractor-availability'] });
            const previousData = queryClient.getQueryData(['contractor-availability']);

            queryClient.setQueryData<AvailabilityDay[]>(['contractor-availability'], (old) => {
                if (!old) return [];
                return old.map(d => {
                    if (d.date !== date) return d;
                    // Mock the change locally
                    let start = '09:00';
                    let end = '17:00';
                    let avail = true;
                    if (mode === 'am') { start = '08:00'; end = '12:00'; }
                    if (mode === 'pm') { start = '13:00'; end = '17:00'; }
                    if (mode === 'full') { start = '08:00'; end = '17:00'; }
                    if (mode === 'off') { avail = false; }
                    return { ...d, isAvailable: avail, startTime: start, endTime: end };
                });
            });

            return { previousData };
        },
        onError: (err, newTodo, context) => {
            queryClient.setQueryData(['contractor-availability'], context?.previousData);
            toast({
                title: "Error updating",
                description: "Could not sync your calendar. Please try again.",
                variant: "destructive"
            });
        },
        onSuccess: () => {
            // Optional: Trigger a "Saved" toast or subtle indicator
        }
    });

    if (isLoading) return <div className="h-24 bg-gray-100 rounded-xl animate-pulse" />;

    return (
        <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden h-full flex flex-col shadow-sm">
            <div className="p-4 border-b border-gray-100 flex items-center justify-between bg-slate-50/50">
                <h3 className="font-bold text-slate-900 flex items-center gap-2">
                    <img src="/logo.png" alt="Handy" className="w-5 h-5 object-contain" />
                    Quick Availability
                </h3>
                <span className="text-xs text-slate-500">Tap to toggle</span>
            </div>

            <div className="p-4">
                <div className="flex gap-3 overflow-x-auto pb-2 snap-x scrollbar-hide">
                    {days?.map((day) => {
                        const dateObj = new Date(day.date);
                        const isToday = isSameDay(dateObj, new Date());

                        const currentMode = getMode(day);
                        const isAmActive = currentMode === 'am' || currentMode === 'full';
                        const isPmActive = currentMode === 'pm' || currentMode === 'full';

                        const handleAmClick = (e: React.MouseEvent) => {
                            e.stopPropagation();
                            let nextMode: 'am' | 'pm' | 'full' | 'off' = 'am';
                            if (currentMode === 'off') nextMode = 'am';
                            if (currentMode === 'pm') nextMode = 'full';
                            if (currentMode === 'am') nextMode = 'off';
                            if (currentMode === 'full') nextMode = 'pm';

                            toggleMutation.mutate({ date: day.date, mode: nextMode });
                        };

                        const handlePmClick = (e: React.MouseEvent) => {
                            e.stopPropagation();
                            let nextMode: 'am' | 'pm' | 'full' | 'off' = 'pm';
                            if (currentMode === 'off') nextMode = 'pm';
                            if (currentMode === 'am') nextMode = 'full';
                            if (currentMode === 'pm') nextMode = 'off';
                            if (currentMode === 'full') nextMode = 'am';

                            toggleMutation.mutate({ date: day.date, mode: nextMode });
                        };

                        return (
                            <div
                                key={day.date}
                                className="flex flex-col min-w-[70px] h-24 snap-start gap-1"
                            >
                                {/* Date Header (Static) */}
                                <div className="text-center">
                                    <span className="text-[10px] font-bold uppercase text-slate-400 block leading-tight">
                                        {format(dateObj, 'EEE')}
                                    </span>
                                    <span className={cn(
                                        "text-sm font-bold block leading-tight",
                                        day.isAvailable ? "text-slate-900" : "text-slate-400"
                                    )}>
                                        {format(dateObj, 'd')}
                                    </span>
                                </div>

                                {/* Split Pills Container */}
                                <div className="flex flex-col gap-[1px] flex-grow w-full border border-gray-200 rounded-lg overflow-hidden bg-gray-50">

                                    {/* AM Button */}
                                    <button
                                        onClick={handleAmClick}
                                        className={cn(
                                            "flex-1 flex items-center justify-center transition-all active:scale-95 text-[10px] font-bold tracking-wider",
                                            isAmActive
                                                ? "bg-amber-100 text-amber-700 hover:bg-amber-200 shadow-inner"
                                                : "bg-transparent text-slate-400 hover:bg-gray-100 hover:text-slate-600"
                                        )}
                                    >
                                        AM
                                    </button>

                                    {/* Divider */}
                                    <div className="h-[1px] bg-gray-200" />

                                    {/* PM Button */}
                                    <button
                                        onClick={handlePmClick}
                                        className={cn(
                                            "flex-1 flex items-center justify-center transition-all active:scale-95 text-[10px] font-bold tracking-wider",
                                            isPmActive
                                                ? "bg-emerald-100 text-emerald-700 hover:bg-emerald-200 shadow-inner"
                                                : "bg-transparent text-slate-400 hover:bg-gray-100 hover:text-slate-600"
                                        )}
                                    >
                                        PM
                                    </button>
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>

            <div className="bg-slate-50 px-4 py-3 text-xs text-slate-500 text-center border-t border-gray-100 flex-grow flex items-center justify-center font-medium">
                Updating this helps us get you 30% more jobs.
            </div>
        </div>
    );
}
