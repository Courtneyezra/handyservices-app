import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, AlertCircle } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";

interface Skill {
    id: string; // HandymanSkill ID
    serviceId: string;
    name: string;
    description: string;
    hourlyRate: number; // Pence
}

export function RateCardEditor() {
    const { toast } = useToast();
    const queryClient = useQueryClient();
    const [edits, setEdits] = useState<Record<string, number>>({}); // id -> newRatePence

    const { data: skills, isLoading } = useQuery<Skill[]>({
        queryKey: ['contractor-skills'],
        queryFn: async () => {
            const token = localStorage.getItem('contractorToken');
            const res = await fetch('/api/contractor/skills', {
                headers: { Authorization: `Bearer ${token}` }
            });
            if (!res.ok) throw new Error('Failed to fetch skills');
            return res.json();
        }
    });

    const mutation = useMutation({
        mutationFn: async (updates: { id: string, hourlyRate: number }[]) => {
            const token = localStorage.getItem('contractorToken');
            const res = await fetch('/api/contractor/skills', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`
                },
                body: JSON.stringify({ updates })
            });
            if (!res.ok) throw new Error('Failed to update rates');
            return res.json();
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['contractor-skills'] });
            setEdits({});
            toast({ title: "Rates Saved", description: "Your rate card has been updated." });
        },
        onError: () => {
            toast({ title: "Error", description: "Failed to save rates.", variant: "destructive" });
        }
    });

    const handleRateChange = (id: string, value: string) => {
        // Allow empty string or single decimal point for better UX while typing
        if (value === '' || value === '.') return;

        const floatVal = parseFloat(value);
        if (isNaN(floatVal)) return;

        // Store as pence, but don't commit to state if it's just intermediate typing
        setEdits(prev => ({ ...prev, [id]: Math.round(floatVal * 100) }));
    };

    const hasChanges = Object.keys(edits).length > 0;

    if (isLoading) return <div className="p-8 text-center"><Loader2 className="w-6 h-6 animate-spin mx-auto text-slate-500" /></div>;

    if (!skills || skills.length === 0) {
        return (
            <div className="p-8 text-center text-slate-400">
                <AlertCircle className="w-8 h-8 mx-auto mb-2 opacity-50" />
                No services found. Please complete onboarding fully to set up your standard rates.
            </div>
        );
    }

    return (
        <div className="space-y-4">
            <div className="rounded-xl border border-white/10 overflow-hidden">
                <Table>
                    <TableHeader className="bg-slate-900/50">
                        <TableRow className="border-white/5 hover:bg-transparent">
                            <TableHead className="text-slate-400">Service</TableHead>
                            <TableHead className="text-right text-slate-400">Hourly Rate (£)</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {skills.map((skill) => {
                            const currentRatePence = edits[skill.id] !== undefined ? edits[skill.id] : skill.hourlyRate;
                            // Display as pounds, careful with re-rendering inputs losing focus if not handled well
                            // For simplicity, we calculate display value here. 
                            const displayValue = (currentRatePence / 100).toFixed(2);

                            return (
                                <TableRow key={skill.id} className="border-white/5 hover:bg-slate-800/50 transition-colors">
                                    <TableCell>
                                        <div className="font-medium text-slate-200">{skill.name}</div>
                                        <div className="text-xs text-slate-500 truncate max-w-[200px]">{skill.description}</div>
                                    </TableCell>
                                    <TableCell className="text-right">
                                        <div className="flex items-center justify-end gap-2">
                                            <span className="text-slate-500 text-sm">£</span>
                                            <Input
                                                type="number"
                                                step="0.01"
                                                defaultValue={displayValue}
                                                // Using defaultValue + onBlur for performance/focus stability, 
                                                // or strictly controlled if we want instant feedback.
                                                // Strictly controlled is better for "Save" button state.
                                                // But let's try onChange with a local state per row if needed? 
                                                // Actually the parent state 'edits' works.
                                                onChange={(e) => handleRateChange(skill.id, e.target.value)}
                                                className="w-24 text-right bg-slate-900 border-slate-700 focus:border-emerald-500 transition-colors h-8 text-white"
                                            />
                                        </div>
                                    </TableCell>
                                </TableRow>
                            );
                        })}
                    </TableBody>
                </Table>
            </div>

            <div className="flex justify-end pt-2">
                <Button
                    onClick={() => {
                        const updates = Object.entries(edits).map(([id, hourlyRate]) => ({ id, hourlyRate }));
                        mutation.mutate(updates);
                    }}
                    disabled={!hasChanges || mutation.isPending}
                    className="bg-emerald-600 hover:bg-emerald-500 text-white"
                >
                    {mutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                    Save Rate Card
                </Button>
            </div>
        </div>
    );
}
