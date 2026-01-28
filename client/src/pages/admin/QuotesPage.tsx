import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { Loader2, Search, LayoutGrid, List as ListIcon, FileText } from 'lucide-react';
import { Button } from '@/components/ui/button';

import { QuoteCard } from './components/QuoteCard';
import { QuotesList } from './components/QuotesList';
import { RegenerateQuoteDialog } from './components/RegenerateQuoteDialog';

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
    leadId: string | null;
    createdAt: string;
    visitTierMode?: 'tiers' | 'fixed' | null;
}

export default function QuotesPage() {
    const { toast } = useToast();
    const queryClient = useQueryClient();
    const [searchQuery, setSearchQuery] = useState('');
    const [viewMode, setViewMode] = useState<'card' | 'list'>('card');

    // Dialog State
    const [regenerateDialogOpen, setRegenerateDialogOpen] = useState(false);
    const [selectedQuoteForRegen, setSelectedQuoteForRegen] = useState<PersonalizedQuote | null>(null);

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
                    <FileText className="h-5 w-5 text-emerald-500" />
                    <h3 className="text-lg font-bold text-foreground">
                        Recent Quotes
                    </h3>
                    <Badge variant="secondary" className="bg-emerald-900/10 text-emerald-600 dark:bg-emerald-900/50 dark:text-emerald-300 ml-2">
                        {generatedQuotes.length}
                    </Badge>
                </div>

                {isLoadingQuotes ? (
                    <div className="flex items-center justify-center py-12">
                        <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
                    </div>
                ) : (
                    <>
                        {generatedQuotes.length === 0 ? (
                            <Card className="bg-muted/50 border-dashed">
                                <CardContent className="py-12 text-center text-muted-foreground">
                                    {searchQuery ? 'No quotes found matching your search.' : 'No quotes sent yet.'}
                                </CardContent>
                            </Card>
                        ) : viewMode === 'list' ? (
                            <QuotesList
                                quotes={generatedQuotes as any}
                                onDelete={handleDelete}
                                onRegenerate={handleOpenRegenerate as any}
                            />
                        ) : (
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                                {generatedQuotes.map((quote) => (
                                    <QuoteCard
                                        key={quote.id}
                                        quote={quote as any}
                                        onDelete={handleDelete}
                                        onRegenerate={handleOpenRegenerate as any}
                                    />
                                ))}
                            </div>
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
        </div>
    );
}
