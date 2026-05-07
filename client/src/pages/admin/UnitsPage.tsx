// client/src/pages/admin/UnitsPage.tsx
//
// Admin Bench page for Module 03 — Unit Bench.
// Lists units with segment filter chips and a create/edit dialog.
// Gated by FF_UNITS_BENCH at the route layer (App.tsx); the server endpoints
// also enforce the flag and return 503 when off.

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
} from '@/components/ui/dialog';
import { Plus, Search, Loader2, Users, Trash2 } from 'lucide-react';
import { apiRequest } from '@/lib/queryClient';
import { useToast } from '@/hooks/use-toast';
import UnitCard, { type Unit } from '@/components/admin/UnitCard';
import UnitForm from '@/components/admin/UnitForm';

type SegmentFilter = 'all' | 'builder' | 'gap_filler' | 'specialist' | 'inactive';

const FILTER_CHIPS: { id: SegmentFilter; label: string }[] = [
    { id: 'all',         label: 'All' },
    { id: 'builder',     label: 'Builders' },
    { id: 'gap_filler',  label: 'Gap-Fillers' },
    { id: 'specialist',  label: 'Specialists' },
    { id: 'inactive',    label: 'Inactive' },
];

async function fetchUnits(filter: SegmentFilter, search: string): Promise<Unit[]> {
    const params = new URLSearchParams();
    if (filter === 'inactive') {
        params.set('includeInactive', '1');
    } else if (filter !== 'all') {
        params.set('segment', filter);
    }
    if (search.trim()) params.set('search', search.trim());
    const res = await fetch(`/api/admin/units?${params.toString()}`, { credentials: 'include' });
    if (res.status === 503) {
        throw new Error('FF_UNITS_BENCH is OFF — bench endpoints disabled.');
    }
    if (!res.ok) {
        const body = await res.text();
        throw new Error(`Failed to load units: ${res.status} ${body}`);
    }
    const json = await res.json();
    let data: Unit[] = json.data ?? [];
    if (filter === 'inactive') {
        data = data.filter((u) => u.availabilityStatus === 'inactive');
    }
    return data;
}

export default function UnitsPage() {
    const { toast } = useToast();
    const queryClient = useQueryClient();

    const [filter, setFilter] = useState<SegmentFilter>('all');
    const [search, setSearch] = useState('');
    const [searchInput, setSearchInput] = useState('');
    const [editingUnit, setEditingUnit] = useState<Unit | null>(null);
    const [creating, setCreating] = useState(false);
    const [serverError, setServerError] = useState<string | null>(null);

    const isDialogOpen = creating || editingUnit !== null;

    const unitsQuery = useQuery({
        queryKey: ['admin-units', filter, search],
        queryFn: () => fetchUnits(filter, search),
        retry: 0,
    });

    const createMutation = useMutation({
        mutationFn: async (payload: any) => {
            const res = await apiRequest('POST', '/api/admin/units', payload);
            return res.json();
        },
        onSuccess: () => {
            toast({ title: 'Unit created' });
            queryClient.invalidateQueries({ queryKey: ['admin-units'] });
            closeDialog();
        },
        onError: (err: any) => {
            setServerError(err?.message || 'Create failed');
        },
    });

    const updateMutation = useMutation({
        mutationFn: async ({ id, payload }: { id: string; payload: any }) => {
            const res = await apiRequest('PUT', `/api/admin/units/${id}`, payload);
            return res.json();
        },
        onSuccess: () => {
            toast({ title: 'Unit updated' });
            queryClient.invalidateQueries({ queryKey: ['admin-units'] });
            closeDialog();
        },
        onError: (err: any) => {
            setServerError(err?.message || 'Update failed');
        },
    });

    const deleteMutation = useMutation({
        mutationFn: async (id: string) => {
            const res = await apiRequest('DELETE', `/api/admin/units/${id}`);
            return res.json();
        },
        onSuccess: () => {
            toast({ title: 'Unit deactivated' });
            queryClient.invalidateQueries({ queryKey: ['admin-units'] });
            closeDialog();
        },
        onError: (err: any) => {
            toast({ title: 'Delete failed', description: err?.message, variant: 'destructive' });
        },
    });

    function openCreate() {
        setServerError(null);
        setEditingUnit(null);
        setCreating(true);
    }

    function openEdit(unit: Unit) {
        setServerError(null);
        setCreating(false);
        setEditingUnit(unit);
    }

    function closeDialog() {
        setCreating(false);
        setEditingUnit(null);
        setServerError(null);
    }

    function handleSubmit(payload: any) {
        setServerError(null);
        if (editingUnit) {
            updateMutation.mutate({ id: editingUnit.id, payload });
        } else {
            createMutation.mutate(payload);
        }
    }

    function handleDelete() {
        if (!editingUnit) return;
        if (!confirm(`Deactivate ${editingUnit.firstName ?? 'this unit'}?`)) return;
        deleteMutation.mutate(editingUnit.id);
    }

    function applySearch(e: React.FormEvent) {
        e.preventDefault();
        setSearch(searchInput);
    }

    const submitting = createMutation.isPending || updateMutation.isPending;
    const units = unitsQuery.data ?? [];

    return (
        <div className="p-6 max-w-6xl mx-auto">
            {/* Header */}
            <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-2">
                    <Users className="w-6 h-6 text-[#0a2351]" />
                    <h1 className="text-2xl font-bold text-[#0a2351]">Bench</h1>
                </div>
                <Button onClick={openCreate} className="bg-[#0a2351] hover:bg-[#081d44] text-white">
                    <Plus className="w-4 h-4 mr-2" />
                    Add unit
                </Button>
            </div>

            {/* Filter chips + search */}
            <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
                <div className="flex flex-wrap gap-2">
                    {FILTER_CHIPS.map((chip) => (
                        <button
                            key={chip.id}
                            onClick={() => setFilter(chip.id)}
                            className={
                                filter === chip.id
                                    ? 'px-3 py-1.5 rounded-full text-sm bg-[#0a2351] text-white'
                                    : 'px-3 py-1.5 rounded-full text-sm bg-slate-100 text-slate-700 hover:bg-slate-200'
                            }
                            data-testid={`filter-${chip.id}`}
                        >
                            {chip.label}
                        </button>
                    ))}
                </div>
                <form onSubmit={applySearch} className="flex items-center gap-2">
                    <div className="relative">
                        <Search className="w-4 h-4 absolute left-2 top-1/2 -translate-y-1/2 text-slate-400" />
                        <Input
                            value={searchInput}
                            onChange={(e) => setSearchInput(e.target.value)}
                            placeholder="Search name, business, email"
                            className="pl-8 w-64"
                        />
                    </div>
                    <Button type="submit" variant="outline">Search</Button>
                </form>
            </div>

            {/* List */}
            {unitsQuery.isLoading && (
                <div className="flex justify-center py-12">
                    <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
                </div>
            )}

            {unitsQuery.isError && (
                <Card className="border-red-200 bg-red-50">
                    <CardContent className="p-4 text-red-800">
                        {(unitsQuery.error as Error)?.message ?? 'Failed to load units.'}
                    </CardContent>
                </Card>
            )}

            {!unitsQuery.isLoading && !unitsQuery.isError && units.length === 0 && (
                <Card>
                    <CardContent className="p-8 text-center text-slate-500">
                        No units match the current filter.
                    </CardContent>
                </Card>
            )}

            <div className="grid gap-3">
                {units.map((u) => (
                    <UnitCard key={u.id} unit={u} onEdit={openEdit} />
                ))}
            </div>

            {/* Create / edit dialog */}
            <Dialog open={isDialogOpen} onOpenChange={(o) => { if (!o) closeDialog(); }}>
                <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
                    <DialogHeader>
                        <DialogTitle className="text-[#0a2351]">
                            {editingUnit ? 'Edit unit' : 'New unit'}
                        </DialogTitle>
                        <DialogDescription>
                            {editingUnit
                                ? 'Update segment, capabilities, area, and economics.'
                                : 'Create a new unit on the bench. The contractor user is created at the same time.'}
                        </DialogDescription>
                    </DialogHeader>

                    <UnitForm
                        initialUnit={editingUnit}
                        error={serverError}
                        submitting={submitting}
                        onCancel={closeDialog}
                        onSubmit={handleSubmit}
                    />

                    {editingUnit && (
                        <div className="border-t pt-3 mt-3 flex justify-end">
                            <Button
                                variant="outline"
                                onClick={handleDelete}
                                disabled={deleteMutation.isPending || editingUnit.availabilityStatus === 'inactive'}
                                className="text-red-600 border-red-300 hover:bg-red-50"
                            >
                                <Trash2 className="w-4 h-4 mr-2" />
                                {editingUnit.availabilityStatus === 'inactive' ? 'Already inactive' : 'Deactivate unit'}
                            </Button>
                        </div>
                    )}
                </DialogContent>
            </Dialog>
        </div>
    );
}
