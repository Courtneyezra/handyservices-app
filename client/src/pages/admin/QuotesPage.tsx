import { useState } from 'react';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { Loader2, Search, LayoutGrid, List as ListIcon, FileText, CreditCard, Clock, CheckCircle, Receipt, ExternalLink, Copy, MessageCircle, Star } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAvailability } from '@/hooks/useAvailability';

const REVIEW_LINK_SUFFIX = `\n\n⭐ Enjoyed the work? A quick Google review means the world to us:\nhttps://g.page/r/CaTBbeu5MahxEBM/review`;

import { QuoteCard } from './components/QuoteCard';
import { QuotesList } from './components/QuotesList';
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

    const [renewingId, setRenewingId] = useState<string | null>(null);

    // Edit Dialog State
    const [editDialogOpen, setEditDialogOpen] = useState(false);
    const [selectedQuoteForEdit, setSelectedQuoteForEdit] = useState<PersonalizedQuote | null>(null);

    // Preview Modal State
    const [previewOpen, setPreviewOpen] = useState(false);
    const [selectedQuoteForPreview, setSelectedQuoteForPreview] = useState<PreviewQuote | null>(null);

    // Per-quote action result / loading state (bulk selection removed — each
    // quote is invoiced / completed on its own from its card).
    const [generatedInvoiceLink, setGeneratedInvoiceLink] = useState<string | null>(null);
    const [generatedWhatsappMessage, setGeneratedWhatsappMessage] = useState<string | null>(null);
    const [includeReviewLink, setIncludeReviewLink] = useState(true);
    const [invoicingId, setInvoicingId] = useState<string | null>(null);
    const [completingId, setCompletingId] = useState<string | null>(null);

    // Mark a single quote as completed
    const markCompleteMutation = useMutation({
        mutationFn: async (quoteId: string) => {
            const res = await fetch('/api/quotes/mark-complete', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ quoteIds: [quoteId] }),
            });
            if (!res.ok) throw new Error('Failed to mark complete');
            return res.json();
        },
        onSuccess: (data) => {
            queryClient.invalidateQueries({ queryKey: ['/api/personalized-quotes'] });
            toast({ title: 'Job Completed', description: `${data.completed} job marked as completed.` });
        },
        onError: () => {
            toast({ title: 'Error', description: 'Failed to mark job as complete.', variant: 'destructive' });
        },
        onSettled: () => setCompletingId(null),
    });

    // Generate an invoice for a single quote
    const generateInvoiceMutation = useMutation({
        mutationFn: async (quoteId: string) => {
            const res = await fetch('/api/invoices/consolidated', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ quoteIds: [quoteId] }),
            });
            if (!res.ok) throw new Error('Failed to generate invoice');
            return res.json();
        },
        onSuccess: (data) => {
            queryClient.invalidateQueries({ queryKey: ['/api/personalized-quotes'] });
            queryClient.invalidateQueries({ queryKey: ['invoices'] });
            const link = `${window.location.origin}/invoice/${data.invoice.id}`;
            setGeneratedInvoiceLink(link);
            setGeneratedWhatsappMessage(data.whatsappMessage ?? null);
            toast({
                title: 'Invoice Generated',
                description: `${data.invoice.invoiceNumber} — Balance: £${(data.summary.balanceDue / 100).toFixed(2)}`,
            });
        },
        onError: () => {
            toast({ title: 'Error', description: 'Failed to generate invoice.', variant: 'destructive' });
        },
        onSettled: () => setInvoicingId(null),
    });

    const handleGenerateInvoice = (quote: PersonalizedQuote) => {
        setInvoicingId(quote.id);
        setGeneratedInvoiceLink(null);
        generateInvoiceMutation.mutate(quote.id);
    };

    const handleMarkComplete = (quote: PersonalizedQuote) => {
        setCompletingId(quote.id);
        markCompleteMutation.mutate(quote.id);
    };

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

    const handleRenew = async (quote: PersonalizedQuote) => {
        setRenewingId(quote.id);
        try {
            const res = await fetch(`/api/admin/personalized-quotes/${quote.id}/renew`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
            });
            if (!res.ok) throw new Error('Failed to renew');

            await queryClient.invalidateQueries({ queryKey: ['/api/personalized-quotes'] });
            refetchQuotes();
            toast({
                title: 'Quote Renewed',
                description: `${quote.customerName}'s quote link is live again for 48 hours — same price.`,
            });
        } catch (error) {
            console.error(error);
            toast({
                variant: 'destructive',
                title: 'Error',
                description: 'Failed to renew quote.',
            });
        } finally {
            setRenewingId(null);
        }
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
            pricingLayerBreakdown: (quote as any).pricingLayerBreakdown ?? null,
            availableDates: (quote as any).availableDates ?? null,
        });
        setPreviewOpen(true);
    };

    const handleEditSaved = () => {
        queryClient.invalidateQueries({ queryKey: ['/api/personalized-quotes'] });
        refetchQuotes();
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
            <Tabs value={filterMode} onValueChange={(v) => { setFilterMode(v as FilterMode); setGeneratedInvoiceLink(null); }} className="w-full">
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

                {/* Generated Invoice Link */}
                {generatedInvoiceLink && (
                    <Card className="border-green-500/50 bg-green-500/5">
                        <CardContent className="py-3 px-4 space-y-3">
                            <div className="flex flex-wrap items-center gap-3">
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
                                    <Copy className="h-3.5 w-3.5 mr-1" /> Copy Link
                                </Button>
                                {generatedWhatsappMessage && (
                                    <Button
                                        size="sm"
                                        variant="outline"
                                        onClick={() => {
                                            const message = generatedWhatsappMessage + (includeReviewLink ? REVIEW_LINK_SUFFIX : '');
                                            navigator.clipboard.writeText(message);
                                            toast({ title: 'Message copied', description: 'Paste into WhatsApp to send.' });
                                        }}
                                    >
                                        <MessageCircle className="h-3.5 w-3.5 mr-1" /> Copy Message
                                    </Button>
                                )}
                                <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() => window.open(generatedInvoiceLink, '_blank')}
                                >
                                    <ExternalLink className="h-3.5 w-3.5 mr-1" /> Open
                                </Button>
                            </div>
                            {generatedWhatsappMessage && (
                                <>
                                    <div className="flex items-center gap-2">
                                        <Switch
                                            id="include-review-link"
                                            checked={includeReviewLink}
                                            onCheckedChange={setIncludeReviewLink}
                                        />
                                        <Label htmlFor="include-review-link" className="text-xs flex items-center gap-1 cursor-pointer">
                                            <Star className="h-3.5 w-3.5 text-amber-500" />
                                            Include Google review request
                                        </Label>
                                    </div>
                                    <pre className="text-xs bg-muted/60 px-3 py-2 rounded whitespace-pre-wrap font-sans text-muted-foreground border border-border/50">
                                        {generatedWhatsappMessage + (includeReviewLink ? REVIEW_LINK_SUFFIX : '')}
                                    </pre>
                                </>
                            )}
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
                                {viewMode === 'list' ? (
                                    <QuotesList
                                        quotes={displayQuotes as any}
                                        onDelete={handleDelete}
                                        onRenew={handleRenew as any}
                                        renewingId={renewingId}
                                        onEdit={handleOpenEdit as any}
                                        onPreview={handleOpenPreview as any}
                                        availableDates={availableDates}
                                    />
                                ) : (
                                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                                        {displayQuotes.map((quote) => (
                                            <QuoteCard
                                                key={quote.id}
                                                quote={quote as any}
                                                onDelete={handleDelete}
                                                onRenew={handleRenew as any}
                                                renewingId={renewingId}
                                                onEdit={handleOpenEdit as any}
                                                onPreview={handleOpenPreview as any}
                                                onGenerateInvoice={handleGenerateInvoice as any}
                                                onMarkComplete={handleMarkComplete as any}
                                                isGeneratingInvoice={invoicingId === quote.id}
                                                isMarkingComplete={completingId === quote.id}
                                                availableDates={availableDates}
                                            />
                                        ))}
                                    </div>
                                )}
                            </>
                        )}
                    </>
                )}
            </div>


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
