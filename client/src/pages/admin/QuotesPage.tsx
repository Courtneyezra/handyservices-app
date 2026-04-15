import { useState } from 'react';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { Loader2, Search, LayoutGrid, List as ListIcon, FileText, CreditCard, Clock, CheckCircle, CheckSquare, Receipt, ExternalLink, Copy } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAvailability } from '@/hooks/useAvailability';

import { QuoteCard } from './components/QuoteCard';
import { QuotesList } from './components/QuotesList';
import { RegenerateQuoteDialog } from './components/RegenerateQuoteDialog';
import { EditQuoteDialog } from './components/EditQuoteDialog';
import { QuotePreviewModal } from '@/components/quote/QuotePreviewModal';
import type { PreviewQuote } from '@/components/quote/QuotePreviewModal';

// Define Interface locally or import if centralized. 
export interface PersonalizedQuote {
    id: string;
    shortSlug: string;
    customerName: string;
    phone: string;
    email: string | null;
    postcode: string | null;
    jobDescription: string;
    completionDate: string;
    quoteMode: 'simple' | 'hhh' | 'pick_and_mix' | 'consultation';
    essentialPrice: number | null;
    enhancedPrice: number | null;
    elitePrice: number | null;
    basePrice: number | null;
    materialsCostWithMarkupPence: number | null;
    viewedAt: string | null;
    assessmentReason: string | null;
    selectedPackage: string | null;
    selectedAt: string | null;
    bookedAt: string | null;
    expiresAt: string | null;
    regeneratedFromId: string | null;
    regenerationCount: number | null;
    paymentType: string | null;
    depositPaidAt: string | null;
    depositAmountPence: number | null;
    stripePaymentIntentId: string | null;
    leadId: string | null;
    createdAt: string;
    visitTierMode?: 'tiers' | 'fixed' | null;
    completedAt: string | null;
    address?: string | null;
}

type FilterMode = 'all' | 'booked' | 'completed' | 'pending';

export default function QuotesPage() {
    const { toast } = useToast();
    const queryClient = useQueryClient();
    const [searchQuery, setSearchQuery] = useState('');
    const [viewMode, setViewMode] = useState<'card' | 'list'>('card');
    const [filterMode, setFilterMode] = useState<FilterMode>('all');

    // Dialog State
    const [regenerateDialogOpen, setRegenerateDialogOpen] = useState(false);
    const [selectedQuoteForRegen, setSelectedQuoteForRegen] = useState<PersonalizedQuote | null>(null);

    // Edit Dialog State
    const [editDialogOpen, setEditDialogOpen] = useState(false);
    const [selectedQuoteForEdit, setSelectedQuoteForEdit] = useState<PersonalizedQuote | null>(null);

    // Preview Modal State
    const [previewOpen, setPreviewOpen] = useState(false);
    const [selectedQuoteForPreview, setSelectedQuoteForPreview] = useState<PreviewQuote | null>(null);

    // Selection state for bulk actions
    const [selectedQuoteIds, setSelectedQuoteIds] = useState<Set<string>>(new Set());
    const [generatedInvoiceLink, setGeneratedInvoiceLink] = useState<string | null>(null);

    const toggleQuoteSelection = (id: string) => {
        setSelectedQuoteIds(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    };

    const toggleSelectAll = (quoteIds: string[]) => {
        const allSelected = quoteIds.every(id => selectedQuoteIds.has(id));
        if (allSelected) {
            setSelectedQuoteIds(new Set());
        } else {
            setSelectedQuoteIds(new Set(quoteIds));
        }
    };

    // Mark quotes as completed
    const markCompleteMutation = useMutation({
        mutationFn: async (quoteIds: string[]) => {
            const res = await fetch('/api/quotes/mark-complete', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ quoteIds }),
            });
            if (!res.ok) throw new Error('Failed to mark complete');
            return res.json();
        },
        onSuccess: (data) => {
            queryClient.invalidateQueries({ queryKey: ['/api/personalized-quotes'] });
            setSelectedQuoteIds(new Set());
            toast({ title: 'Jobs Completed', description: `${data.completed} job(s) marked as completed.` });
        },
        onError: () => {
            toast({ title: 'Error', description: 'Failed to mark jobs as complete.', variant: 'destructive' });
        },
    });

    // Generate consolidated invoice
    const generateInvoiceMutation = useMutation({
        mutationFn: async (quoteIds: string[]) => {
            const res = await fetch('/api/invoices/consolidated', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ quoteIds }),
            });
            if (!res.ok) throw new Error('Failed to generate invoice');
            return res.json();
        },
        onSuccess: (data) => {
            queryClient.invalidateQueries({ queryKey: ['/api/personalized-quotes'] });
            queryClient.invalidateQueries({ queryKey: ['invoices'] });
            setSelectedQuoteIds(new Set());
            const link = `${window.location.origin}/invoice/${data.invoice.id}`;
            setGeneratedInvoiceLink(link);
            toast({
                title: 'Invoice Generated',
                description: `${data.invoice.invoiceNumber} — ${data.summary.totalQuotes} jobs, ${data.summary.totalProperties} properties. Balance: £${(data.summary.balanceDue / 100).toFixed(2)}`,
            });
        },
        onError: () => {
            toast({ title: 'Error', description: 'Failed to generate invoice.', variant: 'destructive' });
        },
    });

    // Fetch system-wide availability for WhatsApp messages
    const { data: availabilityData } = useAvailability({ days: 14 });
    const availableDates = availabilityData?.dates ?? [];

    // Fetch personalized quotes
    const { data: quotes = [], isLoading: isLoadingQuotes, refetch: refetchQuotes } = useQuery<PersonalizedQuote[]>({
        queryKey: ['/api/personalized-quotes'],
        queryFn: async () => {
            const res = await fetch('/api/personalized-quotes');
            if (!res.ok) throw new Error('Failed to fetch quotes');
            return res.json();
        },
    });

    // Filter logic
    const filteredQuotes = quotes.filter(q =>
        q.customerName?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        q.phone?.includes(searchQuery) ||
        q.shortSlug?.toLowerCase().includes(searchQuery.toLowerCase())
    );

    // ONLY Generated Quotes (exclude visits)
    const generatedQuotes = filteredQuotes.filter(q => q.quoteMode !== 'consultation');

    // Apply status filter
    const displayQuotes = generatedQuotes.filter(q => {
        if (filterMode === 'booked') return (!!q.depositPaidAt || !!q.bookedAt) && !q.completedAt;
        if (filterMode === 'completed') return !!q.completedAt;
        if (filterMode === 'pending') return !q.depositPaidAt && !q.bookedAt;
        return true; // 'all'
    });

    // Count stats
    const bookedCount = generatedQuotes.filter(q => (!!q.depositPaidAt || !!q.bookedAt) && !q.completedAt).length;
    const completedCount = generatedQuotes.filter(q => !!q.completedAt).length;
    const pendingCount = generatedQuotes.filter(q => !q.depositPaidAt && !q.bookedAt).length;

    // Get selected quotes for action bar
    const selectedQuotes = displayQuotes.filter(q => selectedQuoteIds.has(q.id));
    const canMarkComplete = selectedQuotes.length > 0 && selectedQuotes.every(q => (!!q.depositPaidAt || !!q.bookedAt) && !q.completedAt);
    const canGenerateInvoice = selectedQuotes.length > 0 && selectedQuotes.every(q => !!q.completedAt || !!q.depositPaidAt || !!q.bookedAt);

    const handleDelete = async (id: string) => {
        try {
            const res = await fetch(`/api/personalized-quotes/${id}`, { method: 'DELETE' });
            if (res.ok) {
                await queryClient.invalidateQueries({ queryKey: ['/api/personalized-quotes'] });
                refetchQuotes();
                toast({ title: 'Deleted', description: 'Quote link removed.' });
            }
        } catch (err) { console.error(err); }
    };

    const handleOpenRegenerate = (quote: PersonalizedQuote) => {
        setSelectedQuoteForRegen(quote);
        setRegenerateDialogOpen(true);
    };

    const handleOpenEdit = (quote: PersonalizedQuote) => {
        setSelectedQuoteForEdit(quote);
        setEditDialogOpen(true);
    };

    const handleOpenPreview = (quote: PersonalizedQuote) => {
        setSelectedQuoteForPreview({
            quoteId: quote.id,
            shortSlug: quote.shortSlug,
            customerName: quote.customerName,
            phone: quote.phone,
            email: quote.email,
            address: (quote as any).address ?? null,
            postcode: quote.postcode ?? null,
            basePrice: quote.basePrice ?? null,
            pricingLineItems: (quote as any).pricingLineItems ?? null,
            availableDates: (quote as any).availableDates ?? null,
        });
        setPreviewOpen(true);
    };

    const handleEditSaved = () => {
        queryClient.invalidateQueries({ queryKey: ['/api/personalized-quotes'] });
        refetchQuotes();
    };

    const confirmRegenerate = async (percentageIncrease: number) => {
        if (!selectedQuoteForRegen) return;

        try {
            const res = await fetch(`/api/admin/personalized-quotes/${selectedQuoteForRegen.id}/regenerate`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ percentageIncrease })
            });

            if (!res.ok) throw new Error('Failed to regenerate');

            await queryClient.invalidateQueries({ queryKey: ['/api/personalized-quotes'] });
            toast({
                title: 'Quote Regenerated',
                description: `Created new version with ${percentageIncrease}% uplift.`
            });
        } catch (error) {
            console.error(error);
            toast({
                variant: 'destructive',
                title: 'Error',
                description: 'Failed to regenerate quote.'
            });
        }
    };

    // Temporary ToggleGroup implementation using Buttons since @/components/ui/toggle-group is missing
    const ViewToggle = () => (
        <div className="flex items-center gap-1 bg-muted p-1 rounded-lg">
            <Button
                variant={viewMode === 'card' ? 'secondary' : 'ghost'}
                size="icon"
                className="h-8 w-8"
                onClick={() => setViewMode('card')}
                title="Card View"
            >
                <LayoutGrid className="h-4 w-4" />
            </Button>
            <Button
                variant={viewMode === 'list' ? 'secondary' : 'ghost'}
                size="icon"
                className="h-8 w-8"
                onClick={() => setViewMode('list')}
                title="List View"
            >
                <ListIcon className="h-4 w-4" />
            </Button>
        </div>
    );

    return (
        <div className="space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight text-foreground">Generated Quotes</h1>
                    <p className="text-muted-foreground">Manage and track sent quotes.</p>
                </div>
            </div>

            {/* Filter Tabs */}
            <Tabs value={filterMode} onValueChange={(v) => { setFilterMode(v as FilterMode); setSelectedQuoteIds(new Set()); setGeneratedInvoiceLink(null); }} className="w-full">
                <TabsList className="grid w-full max-w-xl grid-cols-4">
                    <TabsTrigger value="all" className="flex items-center gap-1">
                        <FileText className="h-4 w-4" />
                        All
                        <Badge variant="secondary" className="ml-1 text-xs">{generatedQuotes.length}</Badge>
                    </TabsTrigger>
                    <TabsTrigger value="booked" className="flex items-center gap-1">
                        <CreditCard className="h-4 w-4 text-blue-600" />
                        Booked
                        <Badge className="ml-1 text-xs bg-blue-600">{bookedCount}</Badge>
                    </TabsTrigger>
                    <TabsTrigger value="completed" className="flex items-center gap-1">
                        <CheckCircle className="h-4 w-4 text-green-600" />
                        Done
                        <Badge className="ml-1 text-xs bg-green-600">{completedCount}</Badge>
                    </TabsTrigger>
                    <TabsTrigger value="pending" className="flex items-center gap-1">
                        <Clock className="h-4 w-4 text-amber-600" />
                        Pending
                        <Badge variant="outline" className="ml-1 text-xs">{pendingCount}</Badge>
                    </TabsTrigger>
                </TabsList>
            </Tabs>

            <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
                {/* Search */}
                <div className="relative flex-1 max-w-md w-full">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                    <Input
                        placeholder="Search by name, phone, or quote ID..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="pl-10"
                    />
                </div>

                {/* View Toggle */}
                <ViewToggle />
            </div>

            <div className="space-y-4">
                <div className="flex items-center gap-2">
                    {filterMode === 'completed' ? (
                        <CheckCircle className="h-5 w-5 text-green-500" />
                    ) : filterMode === 'booked' ? (
                        <CreditCard className="h-5 w-5 text-blue-500" />
                    ) : filterMode === 'pending' ? (
                        <Clock className="h-5 w-5 text-amber-500" />
                    ) : (
                        <FileText className="h-5 w-5 text-emerald-500" />
                    )}
                    <h3 className="text-lg font-bold text-foreground">
                        {filterMode === 'completed' ? 'Completed Jobs' : filterMode === 'booked' ? 'Booked Jobs' : filterMode === 'pending' ? 'Pending Quotes' : 'All Quotes'}
                    </h3>
                    <Badge variant="secondary" className={`ml-2 ${
                        filterMode === 'completed' ? 'bg-green-100 text-green-700 dark:bg-green-900/50 dark:text-green-300' :
                        filterMode === 'booked' ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300' :
                        'bg-emerald-900/10 text-emerald-600 dark:bg-emerald-900/50 dark:text-emerald-300'
                    }`}>
                        {displayQuotes.length}
                    </Badge>
                </div>

                {/* Bulk Action Bar */}
                {selectedQuoteIds.size > 0 && (
                    <Card className="border-blue-500/50 bg-blue-500/5">
                        <CardContent className="py-3 px-4 flex flex-wrap items-center gap-3">
                            <Badge variant="secondary" className="bg-blue-600 text-white">
                                {selectedQuoteIds.size} selected
                            </Badge>
                            {canMarkComplete && (
                                <Button
                                    size="sm"
                                    onClick={() => markCompleteMutation.mutate(Array.from(selectedQuoteIds))}
                                    disabled={markCompleteMutation.isPending}
                                    className="bg-green-600 hover:bg-green-500 text-white"
                                >
                                    {markCompleteMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <CheckSquare className="h-4 w-4 mr-1" />}
                                    Mark Complete
                                </Button>
                            )}
                            {canGenerateInvoice && (
                                <Button
                                    size="sm"
                                    onClick={() => generateInvoiceMutation.mutate(Array.from(selectedQuoteIds))}
                                    disabled={generateInvoiceMutation.isPending}
                                    className="bg-amber-500 hover:bg-amber-400 text-black"
                                >
                                    {generateInvoiceMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Receipt className="h-4 w-4 mr-1" />}
                                    Generate Invoice ({selectedQuoteIds.size} jobs)
                                </Button>
                            )}
                            <Button size="sm" variant="ghost" onClick={() => setSelectedQuoteIds(new Set())}>
                                Clear
                            </Button>
                        </CardContent>
                    </Card>
                )}

                {/* Generated Invoice Link */}
                {generatedInvoiceLink && (
                    <Card className="border-green-500/50 bg-green-500/5">
                        <CardContent className="py-3 px-4 flex flex-wrap items-center gap-3">
                            <Receipt className="h-5 w-5 text-green-500" />
                            <span className="text-sm font-medium">Invoice generated!</span>
                            <code className="text-xs bg-muted px-2 py-1 rounded font-mono flex-1 min-w-0 truncate">{generatedInvoiceLink}</code>
                            <Button
                                size="sm"
                                variant="outline"
                                onClick={() => {
                                    navigator.clipboard.writeText(generatedInvoiceLink);
                                    toast({ title: 'Copied', description: 'Invoice link copied to clipboard.' });
                                }}
                            >
                                <Copy className="h-3.5 w-3.5 mr-1" /> Copy
                            </Button>
                            <Button
                                size="sm"
                                variant="outline"
                                onClick={() => window.open(generatedInvoiceLink, '_blank')}
                            >
                                <ExternalLink className="h-3.5 w-3.5 mr-1" /> Open
                            </Button>
                        </CardContent>
                    </Card>
                )}

                {isLoadingQuotes ? (
                    <div className="flex items-center justify-center py-12">
                        <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
                    </div>
                ) : (
                    <>
                        {displayQuotes.length === 0 ? (
                            <Card className="bg-muted/50 border-dashed">
                                <CardContent className="py-12 text-center text-muted-foreground">
                                    {searchQuery ? 'No quotes found matching your search.' :
                                     filterMode === 'booked' ? 'No booked jobs yet.' :
                                     filterMode === 'completed' ? 'No completed jobs yet.' :
                                     filterMode === 'pending' ? 'No pending quotes.' :
                                     'No quotes sent yet.'}
                                </CardContent>
                            </Card>
                        ) : (
                            <>
                                {/* Select All for booked/completed tabs */}
                                {(filterMode === 'booked' || filterMode === 'completed') && displayQuotes.length > 0 && (
                                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                                        <input
                                            type="checkbox"
                                            checked={displayQuotes.every(q => selectedQuoteIds.has(q.id))}
                                            onChange={() => toggleSelectAll(displayQuotes.map(q => q.id))}
                                            className="w-4 h-4 rounded border-gray-300"
                                        />
                                        <span>Select all ({displayQuotes.length})</span>
                                    </div>
                                )}

                                {viewMode === 'list' ? (
                                    <QuotesList
                                        quotes={displayQuotes as any}
                                        onDelete={handleDelete}
                                        onRegenerate={handleOpenRegenerate as any}
                                        onEdit={handleOpenEdit as any}
                                        onPreview={handleOpenPreview as any}
                                        availableDates={availableDates}
                                    />
                                ) : (
                                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                                        {displayQuotes.map((quote) => (
                                            <div key={quote.id} className="relative">
                                                {/* Selection checkbox */}
                                                {(filterMode === 'booked' || filterMode === 'completed' || filterMode === 'all') && (!!quote.depositPaidAt || !!quote.bookedAt) && (
                                                    <div className="absolute top-2 left-2 z-10">
                                                        <input
                                                            type="checkbox"
                                                            checked={selectedQuoteIds.has(quote.id)}
                                                            onChange={() => toggleQuoteSelection(quote.id)}
                                                            className="w-5 h-5 rounded border-gray-300 cursor-pointer"
                                                        />
                                                    </div>
                                                )}
                                                {/* Completed badge */}
                                                {quote.completedAt && (
                                                    <div className="absolute top-2 right-2 z-10">
                                                        <Badge className="bg-green-600 text-white text-[10px]">
                                                            <CheckCircle className="h-3 w-3 mr-1" /> Done
                                                        </Badge>
                                                    </div>
                                                )}
                                                <QuoteCard
                                                    quote={quote as any}
                                                    onDelete={handleDelete}
                                                    onRegenerate={handleOpenRegenerate as any}
                                                    onEdit={handleOpenEdit as any}
                                                    onPreview={handleOpenPreview as any}
                                                    availableDates={availableDates}
                                                />
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </>
                        )}
                    </>
                )}
            </div>

            <RegenerateQuoteDialog
                open={regenerateDialogOpen}
                onOpenChange={setRegenerateDialogOpen}
                onConfirm={confirmRegenerate}
                quoteCustomerName={selectedQuoteForRegen?.customerName || ''}
            />

            {selectedQuoteForEdit && (
                <EditQuoteDialog
                    quote={selectedQuoteForEdit}
                    open={editDialogOpen}
                    onClose={() => {
                        setEditDialogOpen(false);
                        setSelectedQuoteForEdit(null);
                    }}
                    onSaved={handleEditSaved}
                />
            )}

            <QuotePreviewModal
                open={previewOpen}
                quote={selectedQuoteForPreview}
                onClose={() => {
                    setPreviewOpen(false);
                    setSelectedQuoteForPreview(null);
                }}
                onSaved={() => {
                    queryClient.invalidateQueries({ queryKey: ['/api/personalized-quotes'] });
                }}
            />
        </div>
    );
}
