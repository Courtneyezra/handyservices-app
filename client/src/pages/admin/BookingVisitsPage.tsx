import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Loader2, Search, Wrench, Copy, X, Phone, Eye, LayoutGrid, List as ListIcon } from 'lucide-react';
import { format } from 'date-fns';
import { QuotesList } from './components/QuotesList';

interface PersonalizedQuote {
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
    leadId: string | null;
    createdAt: string;
    visitTierMode?: 'tiers' | 'fixed' | null;
}

export default function BookingVisitsPage() {
    const { toast } = useToast();
    const queryClient = useQueryClient();
    const [searchQuery, setSearchQuery] = useState('');
    const [viewMode, setViewMode] = useState<'card' | 'list'>('card');

    // Fetch personalized quotes
    const { data: quotes = [], isLoading: isLoadingQuotes, refetch: refetchQuotes } = useQuery<PersonalizedQuote[]>({
        queryKey: ['/api/personalized-quotes'],
        queryFn: async () => {
            const res = await fetch('/api/personalized-quotes');
            if (!res.ok) throw new Error('Failed to fetch quotes');
            return res.json();
        },
    });

    // Filter logic for VISITS
    const visitQuotes = quotes.filter(q =>
        (q.customerName?.toLowerCase().includes(searchQuery.toLowerCase()) ||
            q.phone?.includes(searchQuery) ||
            q.shortSlug?.toLowerCase().includes(searchQuery.toLowerCase())) &&
        q.quoteMode === 'consultation'
    );

    const handleDelete = async (id: string, e?: React.MouseEvent) => {
        if (e) e.stopPropagation();
        // QuotesList passes just ID, no event, so event is optional
        // Note: QuotesList.tsx handles the confirm logic internally for delete button, 
        // but here we might want to standardize.
        // Actually QuotesList calls onDelete(id). It does NOT do the fetch.
        // Wait, current QuotesList implementation: 
        // onClick={() => { if (confirm(...)) { onDelete(quote.id); } }}
        // So onDelete just needs to do the deletion.

        try {
            const res = await fetch(`/api/personalized-quotes/${id}`, { method: 'DELETE' });
            if (res.ok) {
                await queryClient.invalidateQueries({ queryKey: ['/api/personalized-quotes'] });
                refetchQuotes();
                toast({ title: 'Deleted', description: 'Visit link removed.' });
            }
        } catch (err) { console.error(err); }
    };

    // Temporary ToggleGroup implementation
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
            <div>
                <h1 className="text-2xl font-bold tracking-tight text-foreground">Booking Visits</h1>
                <p className="text-muted-foreground">Manage paid diagnostic visit links.</p>
            </div>

            <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
                {/* Search */}
                <div className="relative flex-1 max-w-md w-full">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                    <Input
                        placeholder="Search visits..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="pl-10"
                    />
                </div>

                {/* View Toggle */}
                <ViewToggle />
            </div>

            <div>
                <h3 className="text-lg font-bold text-foreground mb-4 flex items-center gap-2">
                    <Wrench className="h-5 w-5 text-blue-500" />
                    Scheduled Visits
                    <Badge variant="secondary" className="bg-blue-900/10 text-blue-600 dark:bg-blue-900/50 dark:text-blue-300 ml-2">
                        {visitQuotes.length}
                    </Badge>
                </h3>

                {isLoadingQuotes ? (
                    <div className="flex items-center justify-center py-12">
                        <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
                    </div>
                ) : visitQuotes.length === 0 ? (
                    <Card className="bg-muted/50 border-dashed">
                        <CardContent className="py-8 text-center text-muted-foreground text-sm">
                            {searchQuery ? 'No visits found matching search.' : 'No diagnostic visits scheduled yet.'}
                        </CardContent>
                    </Card>
                ) : viewMode === 'list' ? (
                    <QuotesList
                        quotes={visitQuotes as any}
                        onDelete={(id) => handleDelete(id)}
                        linkPrefix="/visit-link/"
                    // No onRegenerate passed for visits
                    />
                ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                        {visitQuotes.map((quote) => (
                            <Card key={quote.id} className="hover:shadow-md transition-shadow border-l-4 border-l-blue-500">
                                <CardContent className="p-4">
                                    <div className="flex items-start justify-between gap-2 mb-3">
                                        <div className="flex-1 min-w-0">
                                            <div className="flex flex-wrap items-center gap-2 mb-2">
                                                <h3 className="font-semibold text-lg text-foreground truncate">{quote.customerName}</h3>
                                                {quote.viewedAt && (
                                                    <Badge variant="outline" className="text-green-600 border-green-600 text-[10px]" title={`Opened: ${format(new Date(quote.viewedAt), 'dd MMM yyyy, HH:mm')}`}>
                                                        <Eye className="h-3 w-3 mr-1" />
                                                        Opened
                                                    </Badge>
                                                )}
                                                {quote.bookedAt && (
                                                    <Badge className="bg-green-600 text-[10px]">Booked</Badge>
                                                )}
                                            </div>

                                            <div className="flex items-center gap-2 max-w-full">
                                                <div className="flex-1 bg-muted border rounded px-2 py-1 text-xs font-mono truncate select-all">
                                                    {`${window.location.origin}/visit-link/${quote.shortSlug}`}
                                                </div>
                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    className="h-6 w-6 text-muted-foreground hover:text-foreground"
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        navigator.clipboard.writeText(`${window.location.origin}/visit-link/${quote.shortSlug}`);
                                                        toast({ title: 'Copied', description: 'Link copied to clipboard' });
                                                    }}
                                                >
                                                    <Copy className="h-3 w-3" />
                                                </Button>
                                            </div>
                                        </div>

                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            className="h-8 w-8 text-muted-foreground hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 -mt-1 -mr-2"
                                            onClick={(e) => {
                                                // Call with event to stop propagation if clicked on button
                                                // Wait, handleDelete here takes (id, e).
                                                // QuotesList logic expects simple fn. 
                                                // Local logic for card needs confirm.
                                                e.stopPropagation();
                                                if (confirm('Are you sure you want to delete this visit link?')) {
                                                    handleDelete(quote.id);
                                                }
                                            }}
                                        >
                                            <X className="h-4 w-4" />
                                        </Button>
                                    </div>

                                    <div className="grid grid-cols-1 gap-1 text-sm text-muted-foreground mb-3">
                                        <p className="flex items-center gap-1">
                                            <Phone className="h-3 w-3" />
                                            <a href={`tel:${quote.phone}`} className="text-blue-500 hover:underline">{quote.phone}</a>
                                        </p>
                                        <p><span className="font-medium">Postcode:</span> {quote.postcode}</p>
                                    </div>

                                    {quote.assessmentReason && (
                                        <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-100 dark:border-blue-900/50 rounded-lg p-2 mb-3">
                                            <p className="text-xs text-blue-700 dark:text-blue-200 line-clamp-2"><strong>Reason:</strong> {quote.assessmentReason}</p>
                                        </div>
                                    )}

                                    <div className="flex flex-wrap gap-2 pt-2 border-t mt-auto">
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            className="w-full"
                                            onClick={() => window.open(`/visit-link/${quote.shortSlug}`, '_blank')}
                                        >
                                            <Eye className="h-4 w-4 mr-1" />
                                            View Visit Link
                                        </Button>
                                    </div>
                                </CardContent>
                            </Card>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}
