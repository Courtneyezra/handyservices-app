import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import {
    Table,
    TableHeader,
    TableBody,
    TableHead,
    TableRow,
    TableCell,
} from '@/components/ui/table';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { apiRequest } from '@/lib/queryClient';
import { Plus, Pencil, Archive, Sparkles, Loader2, RotateCcw } from 'lucide-react';

interface ExtraEntry {
    id: number;
    label: string;
    description: string;
    priceInPence: number;
    badge: string | null;
    sortOrder: number;
    isActive: boolean;
    pickCount: number;
    createdAt: string;
    updatedAt: string;
}

interface ExtraFormState {
    label: string;
    description: string;
    priceGbp: string;
    badge: string;
    sortOrder: string;
}

const EMPTY_FORM: ExtraFormState = {
    label: '',
    description: '',
    priceGbp: '',
    badge: '',
    sortOrder: '100',
};

function formatGbp(pence: number): string {
    return `£${(pence / 100).toFixed(2)}`;
}

function truncate(text: string, max = 80): string {
    if (text.length <= max) return text;
    return `${text.slice(0, max).trimEnd()}…`;
}

export default function ExtrasCatalogPage() {
    const { toast } = useToast();
    const queryClient = useQueryClient();

    const [showArchived, setShowArchived] = useState(false);
    const [dialogOpen, setDialogOpen] = useState(false);
    const [editingId, setEditingId] = useState<number | null>(null);
    const [form, setForm] = useState<ExtraFormState>(EMPTY_FORM);
    const [formError, setFormError] = useState<string | null>(null);

    // Archive confirmation state
    const [archiveTarget, setArchiveTarget] = useState<ExtraEntry | null>(null);

    const {
        data,
        isLoading,
        isError,
        error,
        refetch,
    } = useQuery<{ extras: ExtraEntry[] }>({
        queryKey: ['/api/admin/extras-catalog'],
        queryFn: async () => {
            const res = await fetch('/api/admin/extras-catalog');
            if (!res.ok) throw new Error('Failed to load extras catalog');
            return res.json();
        },
    });

    const extras = data?.extras ?? [];

    const visibleExtras = useMemo(() => {
        const list = showArchived ? extras : extras.filter(e => e.isActive);
        return [...list].sort((a, b) => {
            // Active items first, then by sortOrder, then by label
            if (a.isActive !== b.isActive) return a.isActive ? -1 : 1;
            if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
            return a.label.localeCompare(b.label);
        });
    }, [extras, showArchived]);

    const archivedCount = extras.filter(e => !e.isActive).length;

    const createMutation = useMutation({
        mutationFn: async (payload: {
            label: string;
            description: string;
            priceInPence: number;
            badge?: string;
            sortOrder?: number;
        }) => {
            const res = await apiRequest('POST', '/api/admin/extras-catalog', payload);
            return res.json();
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['/api/admin/extras-catalog'] });
            toast({ title: 'Extra added', description: 'New entry saved to the catalog.' });
            closeDialog();
        },
        onError: (err: any) => {
            toast({
                title: 'Could not save',
                description: err?.message ?? 'Please try again.',
                variant: 'destructive',
            });
        },
    });

    const updateMutation = useMutation({
        mutationFn: async (args: {
            id: number;
            payload: Partial<{
                label: string;
                description: string;
                priceInPence: number;
                badge: string | null;
                sortOrder: number;
                isActive: boolean;
            }>;
        }) => {
            const res = await apiRequest('PATCH', `/api/admin/extras-catalog/${args.id}`, args.payload);
            return res.json();
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['/api/admin/extras-catalog'] });
            toast({ title: 'Saved', description: 'Extra updated.' });
            closeDialog();
        },
        onError: (err: any) => {
            toast({
                title: 'Could not save',
                description: err?.message ?? 'Please try again.',
                variant: 'destructive',
            });
        },
    });

    const archiveMutation = useMutation({
        mutationFn: async (id: number) => {
            const res = await apiRequest('DELETE', `/api/admin/extras-catalog/${id}`);
            return res.json();
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['/api/admin/extras-catalog'] });
            toast({ title: 'Archived', description: 'Entry hidden from picker.' });
            setArchiveTarget(null);
        },
        onError: (err: any) => {
            toast({
                title: 'Could not archive',
                description: err?.message ?? 'Please try again.',
                variant: 'destructive',
            });
        },
    });

    const restoreMutation = useMutation({
        mutationFn: async (id: number) => {
            const res = await apiRequest('PATCH', `/api/admin/extras-catalog/${id}`, { isActive: true });
            return res.json();
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['/api/admin/extras-catalog'] });
            toast({ title: 'Restored', description: 'Entry is active again.' });
        },
        onError: (err: any) => {
            toast({
                title: 'Could not restore',
                description: err?.message ?? 'Please try again.',
                variant: 'destructive',
            });
        },
    });

    const isSaving = createMutation.isPending || updateMutation.isPending;

    function openCreateDialog() {
        setEditingId(null);
        setForm(EMPTY_FORM);
        setFormError(null);
        setDialogOpen(true);
    }

    function openEditDialog(entry: ExtraEntry) {
        setEditingId(entry.id);
        setForm({
            label: entry.label,
            description: entry.description,
            priceGbp: (entry.priceInPence / 100).toFixed(2),
            badge: entry.badge ?? '',
            sortOrder: String(entry.sortOrder),
        });
        setFormError(null);
        setDialogOpen(true);
    }

    function closeDialog() {
        setDialogOpen(false);
        setEditingId(null);
        setForm(EMPTY_FORM);
        setFormError(null);
    }

    function handleSubmit(e: React.FormEvent) {
        e.preventDefault();
        setFormError(null);

        const label = form.label.trim();
        const description = form.description.trim();
        const badgeTrim = form.badge.trim();

        if (!label) {
            setFormError('Label is required.');
            return;
        }
        if (!description) {
            setFormError('Description is required.');
            return;
        }

        const priceNum = Number(form.priceGbp);
        if (!Number.isFinite(priceNum) || priceNum <= 0) {
            setFormError('Price must be greater than £0.');
            return;
        }
        const priceInPence = Math.round(priceNum * 100);

        let sortOrder = 100;
        if (form.sortOrder.trim() !== '') {
            const parsed = Number(form.sortOrder);
            if (!Number.isFinite(parsed)) {
                setFormError('Sort order must be a number.');
                return;
            }
            sortOrder = Math.round(parsed);
        }

        if (editingId == null) {
            createMutation.mutate({
                label,
                description,
                priceInPence,
                badge: badgeTrim || undefined,
                sortOrder,
            });
        } else {
            updateMutation.mutate({
                id: editingId,
                payload: {
                    label,
                    description,
                    priceInPence,
                    badge: badgeTrim ? badgeTrim : null,
                    sortOrder,
                },
            });
        }
    }

    return (
        <div className="space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight text-foreground">Optional Extras Library</h1>
                    <p className="text-muted-foreground">
                        Reusable add-ons admins can pick from when building a contextual quote.
                    </p>
                </div>
                <Button onClick={openCreateDialog} className="gap-2">
                    <Plus className="h-4 w-4" />
                    Add Extra
                </Button>
            </div>

            <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-2">
                    <Switch
                        id="show-archived"
                        checked={showArchived}
                        onCheckedChange={setShowArchived}
                    />
                    <Label htmlFor="show-archived" className="text-sm cursor-pointer">
                        Show archived
                        {archivedCount > 0 && (
                            <Badge variant="secondary" className="ml-2 text-xs">
                                {archivedCount}
                            </Badge>
                        )}
                    </Label>
                </div>
                <p className="text-xs text-muted-foreground">
                    {extras.filter(e => e.isActive).length} active
                </p>
            </div>

            {isLoading ? (
                <div className="flex items-center justify-center py-12">
                    <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                </div>
            ) : isError ? (
                <Card className="border-destructive/50 bg-destructive/5">
                    <CardContent className="py-6 space-y-2">
                        <p className="text-sm text-destructive">
                            Failed to load extras catalog: {(error as Error)?.message ?? 'Unknown error'}
                        </p>
                        <Button size="sm" variant="outline" onClick={() => refetch()}>
                            Retry
                        </Button>
                    </CardContent>
                </Card>
            ) : visibleExtras.length === 0 ? (
                <Card className="bg-muted/50 border-dashed">
                    <CardContent className="py-12 text-center text-muted-foreground space-y-3">
                        <p>{showArchived ? 'No extras yet.' : 'No active extras yet.'}</p>
                        <Button size="sm" onClick={openCreateDialog} className="gap-2">
                            <Plus className="h-4 w-4" />
                            Add the first extra
                        </Button>
                    </CardContent>
                </Card>
            ) : (
                <Card>
                    <CardContent className="p-0">
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Label</TableHead>
                                    <TableHead>Description</TableHead>
                                    <TableHead className="text-right">Price</TableHead>
                                    <TableHead className="text-right">Sort</TableHead>
                                    <TableHead className="text-right">Picks</TableHead>
                                    <TableHead>Status</TableHead>
                                    <TableHead className="text-right">Actions</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {visibleExtras.map((entry) => (
                                    <TableRow
                                        key={entry.id}
                                        className={!entry.isActive ? 'opacity-50' : ''}
                                    >
                                        <TableCell>
                                            <div className="flex flex-col gap-1">
                                                <span className="font-medium text-foreground">{entry.label}</span>
                                                {entry.badge && (
                                                    <Badge
                                                        variant="secondary"
                                                        className="w-fit gap-1 bg-amber-500/15 text-amber-600 dark:text-amber-300 border border-amber-500/30"
                                                    >
                                                        <Sparkles className="h-3 w-3" />
                                                        {entry.badge}
                                                    </Badge>
                                                )}
                                            </div>
                                        </TableCell>
                                        <TableCell className="max-w-md text-sm text-muted-foreground">
                                            {truncate(entry.description, 100)}
                                        </TableCell>
                                        <TableCell className="text-right font-mono">
                                            {formatGbp(entry.priceInPence)}
                                        </TableCell>
                                        <TableCell className="text-right text-muted-foreground">
                                            {entry.sortOrder}
                                        </TableCell>
                                        <TableCell className="text-right text-muted-foreground">
                                            {entry.pickCount}
                                        </TableCell>
                                        <TableCell>
                                            {entry.isActive ? (
                                                <Badge className="bg-green-600 hover:bg-green-600 text-white">Active</Badge>
                                            ) : (
                                                <Badge variant="outline">Archived</Badge>
                                            )}
                                        </TableCell>
                                        <TableCell className="text-right">
                                            <div className="flex justify-end gap-1">
                                                <Button
                                                    size="sm"
                                                    variant="ghost"
                                                    onClick={() => openEditDialog(entry)}
                                                    title="Edit"
                                                >
                                                    <Pencil className="h-4 w-4" />
                                                </Button>
                                                {entry.isActive ? (
                                                    <Button
                                                        size="sm"
                                                        variant="ghost"
                                                        onClick={() => setArchiveTarget(entry)}
                                                        title="Archive"
                                                    >
                                                        <Archive className="h-4 w-4" />
                                                    </Button>
                                                ) : (
                                                    <Button
                                                        size="sm"
                                                        variant="ghost"
                                                        onClick={() => restoreMutation.mutate(entry.id)}
                                                        disabled={restoreMutation.isPending}
                                                        title="Restore"
                                                    >
                                                        <RotateCcw className="h-4 w-4" />
                                                    </Button>
                                                )}
                                            </div>
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </CardContent>
                </Card>
            )}

            {/* Create / Edit Dialog */}
            <Dialog open={dialogOpen} onOpenChange={(open) => { if (!open) closeDialog(); }}>
                <DialogContent className="sm:max-w-[520px]">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                            <Sparkles className="h-5 w-5 text-amber-500" />
                            {editingId == null ? 'Add Extra' : 'Edit Extra'}
                        </DialogTitle>
                        <DialogDescription>
                            {editingId == null
                                ? 'Add a reusable add-on admins can pick when building a quote.'
                                : 'Update this catalog entry. Changes apply to future quotes only.'}
                        </DialogDescription>
                    </DialogHeader>

                    <form onSubmit={handleSubmit} className="space-y-4">
                        <div className="space-y-2">
                            <Label htmlFor="extra-label">Label *</Label>
                            <Input
                                id="extra-label"
                                value={form.label}
                                onChange={(e) => setForm({ ...form, label: e.target.value })}
                                placeholder="e.g. Same-day priority callout"
                                autoFocus
                            />
                        </div>

                        <div className="space-y-2">
                            <Label htmlFor="extra-description">Description *</Label>
                            <Textarea
                                id="extra-description"
                                value={form.description}
                                onChange={(e) => setForm({ ...form, description: e.target.value })}
                                placeholder="Customer-facing line shown under the option."
                                rows={3}
                            />
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <Label htmlFor="extra-price">Price (£) *</Label>
                                <div className="relative">
                                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">£</span>
                                    <Input
                                        id="extra-price"
                                        type="number"
                                        step="0.01"
                                        min="0"
                                        value={form.priceGbp}
                                        onChange={(e) => setForm({ ...form, priceGbp: e.target.value })}
                                        placeholder="30.00"
                                        className="pl-7"
                                    />
                                </div>
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="extra-sort">Sort order</Label>
                                <Input
                                    id="extra-sort"
                                    type="number"
                                    value={form.sortOrder}
                                    onChange={(e) => setForm({ ...form, sortOrder: e.target.value })}
                                    placeholder="100"
                                />
                                <p className="text-[11px] text-muted-foreground">
                                    Lower numbers appear first in the picker.
                                </p>
                            </div>
                        </div>

                        <div className="space-y-2">
                            <Label htmlFor="extra-badge">Badge (optional)</Label>
                            <Input
                                id="extra-badge"
                                value={form.badge}
                                onChange={(e) => setForm({ ...form, badge: e.target.value })}
                                placeholder="e.g. Most popular"
                            />
                            <p className="text-[11px] text-muted-foreground">
                                Short pill text shown next to the label.
                            </p>
                        </div>

                        {formError && (
                            <p className="text-sm text-destructive">{formError}</p>
                        )}

                        <DialogFooter>
                            <Button type="button" variant="outline" onClick={closeDialog} disabled={isSaving}>
                                Cancel
                            </Button>
                            <Button type="submit" disabled={isSaving}>
                                {isSaving ? (
                                    <>
                                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                        Saving...
                                    </>
                                ) : editingId == null ? (
                                    'Add Extra'
                                ) : (
                                    'Save Changes'
                                )}
                            </Button>
                        </DialogFooter>
                    </form>
                </DialogContent>
            </Dialog>

            {/* Archive confirmation */}
            <Dialog
                open={archiveTarget != null}
                onOpenChange={(open) => { if (!open) setArchiveTarget(null); }}
            >
                <DialogContent className="sm:max-w-[420px]">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                            <Archive className="h-5 w-5 text-amber-500" />
                            Archive extra?
                        </DialogTitle>
                        <DialogDescription>
                            <strong>{archiveTarget?.label}</strong> will be hidden from the picker. Existing
                            quotes already using it are unaffected. You can restore it later.
                        </DialogDescription>
                    </DialogHeader>
                    <DialogFooter>
                        <Button
                            variant="outline"
                            onClick={() => setArchiveTarget(null)}
                            disabled={archiveMutation.isPending}
                        >
                            Cancel
                        </Button>
                        <Button
                            variant="destructive"
                            onClick={() => archiveTarget && archiveMutation.mutate(archiveTarget.id)}
                            disabled={archiveMutation.isPending}
                        >
                            {archiveMutation.isPending ? (
                                <>
                                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                    Archiving...
                                </>
                            ) : (
                                'Archive'
                            )}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}
