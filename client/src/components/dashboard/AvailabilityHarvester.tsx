import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { format, addDays, isSameDay } from 'date-fns';
import { Calendar as CalendarIcon, Check, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';

interface AvailabilityDay {
    date: string; // ISO yyyy-mm-dd
    isAvailable: boolean;
    source: 'pattern' | 'override' | 'default_off';
}

export function AvailabilityHarvester() {
    const { toast } = useToast();
    const queryClient = useQueryClient();

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

    // Toggle Mutation
    const toggleMutation = useMutation({
        mutationFn: async ({ date, isAvailable }: { date: string, isAvailable: boolean }) => {
            const token = localStorage.getItem('contractorToken');
            await fetch('/api/contractor/availability/toggle', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`
                },
                body: JSON.stringify({ date, isAvailable })
            });
        },
        onMutate: async ({ date, isAvailable }) => {
            // Optimistic Update
            await queryClient.cancelQueries({ queryKey: ['contractor-availability'] });
            const previousData = queryClient.getQueryData(['contractor-availability']);

            queryClient.setQueryData<AvailabilityDay[]>(['contractor-availability'], (old) => {
                if (!old) return [];
                return old.map(d => d.date === date ? { ...d, isAvailable } : d);
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

    if (isLoading) return <div className="h-24 bg-slate-100 rounded-xl animate-pulse" />;

    return (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="p-4 border-b border-slate-100 flex items-center justify-between">
                <h3 className="font-bold text-slate-800 flex items-center gap-2">
                    <CalendarIcon className="w-4 h-4 text-emerald-500" />
                    Quick Availability
                </h3>
                <span className="text-xs text-slate-500">Tap to toggle</span>
            </div>

            <div className="p-4">
                <div className="flex gap-3 overflow-x-auto pb-2 snap-x">
                    {days?.map((day) => {
                        const dateObj = new Date(day.date);
                        const isToday = isSameDay(dateObj, new Date());

                        return (
                            <button
                                key={day.date}
                                onClick={() => toggleMutation.mutate({
                                    date: day.date,
                                    isAvailable: !day.isAvailable
                                })}
                                className={cn(
                                    "flex flex-col items-center justify-center min-w-[70px] h-20 rounded-lg border-2 transition-all p-2 bg-white snap-start",
                                    day.isAvailable
                                        ? "border-emerald-100 bg-emerald-50/50 hover:bg-emerald-50 hover:border-emerald-300"
                                        : "border-slate-100 bg-slate-50 opacity-60 hover:opacity-100 hover:border-slate-300",
                                    // isToday && "ring-2 ring-emerald-500 ring-offset-1"
                                )}
                            >
                                <span className="text-xs font-semibold uppercase text-slate-400">
                                    {format(dateObj, 'EEE')}
                                </span>
                                <span className={cn(
                                    "text-lg font-bold",
                                    day.isAvailable ? "text-emerald-700" : "text-slate-400"
                                )}>
                                    {format(dateObj, 'd')}
                                </span>
                                <div className="mt-1">
                                    {day.isAvailable ? (
                                        <Check className="w-3 h-3 text-emerald-500" />
                                    ) : (
                                        <X className="w-3 h-3 text-slate-300" />
                                    )}
                                </div>
                            </button>
                        );
                    })}
                </div>
            </div>

            <div className="bg-slate-50 px-4 py-2 text-xs text-slate-500 text-center border-t border-slate-100">
                Updating this helps us get you 30% more jobs.
            </div>
        </div>
    );
}
