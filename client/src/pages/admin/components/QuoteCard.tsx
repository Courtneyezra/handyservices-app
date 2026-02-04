import { format } from 'date-fns';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Copy, Eye, Phone, RefreshCw, X, AlertCircle, Download } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { generateQuotePDF } from '@/lib/quote-pdf-generator';

interface PersonalizedQuote {
    id: string;
    shortSlug: string;
    customerName: string;
    phone: string;
    postcode: string | null;
    address?: string | null;
    jobDescription?: string;
    segment?: string | null;
    createdAt: string;
    viewedAt: string | null;
    bookedAt: string | null;
    quoteMode: string;
    expiresAt: string | null;
    basePrice: number | null;
    essentialPrice: number | null;
    enhancedPrice: number | null;
    elitePrice: number | null;
    visitTierMode?: 'tiers' | 'fixed' | null;
}

interface QuoteCardProps {
    quote: PersonalizedQuote;
    onDelete: (id: string) => void;
    onRegenerate: (quote: PersonalizedQuote) => void;
}

export function QuoteCard({ quote, onDelete, onRegenerate }: QuoteCardProps) {
    const { toast } = useToast();

    const isExpired = quote.expiresAt ? new Date(quote.expiresAt) < new Date() : false;
    const isBooked = !!quote.bookedAt;

    const copyLink = (e: React.MouseEvent) => {
        e.stopPropagation();
        navigator.clipboard.writeText(`${window.location.origin}/quote-link/${quote.shortSlug}`);
        toast({ title: 'Copied', description: 'Link copied to clipboard' });
    };

    const handleDelete = (e: React.MouseEvent) => {
        e.stopPropagation();
        if (confirm('Are you sure you want to delete this quote link?')) {
            onDelete(quote.id);
        }
    };

    return (
        <Card className={`hover:shadow-md transition-shadow relative overflow-hidden ${isBooked ? 'border-l-4 border-l-green-500' : isExpired ? 'border-l-4 border-l-red-200 opacity-80' : ''}`}>
            <CardContent className="p-4 flex flex-col h-full">
                {/* Header */}
                <div className="flex items-start justify-between gap-2 mb-3">
                    <div className="flex-1 min-w-0">
                        <div className="flex flex-wrap items-center gap-2 mb-2">
                            <h3 className="font-semibold text-lg text-foreground truncate" title={quote.customerName}>
                                {quote.customerName}
                            </h3>

                            {quote.viewedAt && (
                                <Badge variant="outline" className="text-green-600 border-green-600 text-[10px]" title={`Opened: ${format(new Date(quote.viewedAt), 'dd MMM yyyy, HH:mm')}`}>
                                    <Eye className="h-3 w-3 mr-1" />
                                    Opened
                                </Badge>
                            )}
                            {isBooked && (
                                <Badge className="bg-green-600 text-[10px]">Booked</Badge>
                            )}
                            {isExpired && !isBooked && (
                                <Badge variant="secondary" className="bg-red-100 text-red-600 dark:bg-red-900/30 text-[10px]">Expired</Badge>
                            )}
                        </div>

                        <div className="flex items-center gap-2 max-w-full">
                            <div className="flex-1 bg-muted border rounded px-2 py-1 text-xs font-mono truncate select-all">
                                {`${window.location.origin}/quote-link/${quote.shortSlug}`}
                            </div>
                            <Button
                                variant="ghost"
                                size="icon"
                                className="h-6 w-6 text-muted-foreground hover:text-foreground"
                                onClick={copyLink}
                            >
                                <Copy className="h-3 w-3" />
                            </Button>
                        </div>
                    </div>

                    <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-muted-foreground hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 -mt-1 -mr-2"
                        onClick={handleDelete}
                    >
                        <X className="h-4 w-4" />
                    </Button>
                </div>

                {/* Details */}
                <div className="grid grid-cols-1 gap-1 text-sm text-muted-foreground mb-3 flex-grow">
                    <p className="flex items-center gap-1">
                        <Phone className="h-3 w-3" />
                        <a href={`tel:${quote.phone}`} className="text-blue-500 hover:underline">{quote.phone}</a>
                    </p>
                    <p><span className="font-medium">Postcode:</span> {quote.postcode}</p>
                    <p className="text-xs text-muted-foreground/50 mt-1">
                        Created: {format(new Date(quote.createdAt), 'dd MMM yyyy')}
                    </p>
                </div>

                {/* Actions Footer */}
                <div className="flex flex-wrap gap-2 pt-2 border-t mt-auto">
                    <Button
                        variant="outline"
                        size="sm"
                        className="flex-1"
                        onClick={() => window.open(`/quote-link/${quote.shortSlug}`, '_blank')}
                    >
                        <Eye className="h-4 w-4 mr-1" />
                        View
                    </Button>

                    <TooltipProvider>
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    className="text-slate-600 hover:text-[#7DB00E] hover:bg-green-50"
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        const price = quote.enhancedPrice || quote.essentialPrice || quote.basePrice || 0;
                                        generateQuotePDF({
                                            quoteId: quote.id,
                                            customerName: quote.customerName || 'Customer',
                                            address: quote.address,
                                            postcode: quote.postcode,
                                            jobDescription: quote.jobDescription || 'As discussed',
                                            priceInPence: price,
                                            segment: quote.segment || undefined,
                                            validityHours: 48,
                                            createdAt: new Date(quote.createdAt),
                                        });
                                    }}
                                >
                                    <Download className="h-4 w-4" />
                                </Button>
                            </TooltipTrigger>
                            <TooltipContent>
                                <p>Download PDF</p>
                            </TooltipContent>
                        </Tooltip>
                    </TooltipProvider>

                    {(isExpired || !isBooked) && (
                        <TooltipProvider>
                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        className="text-blue-600 hover:text-blue-700 hover:bg-blue-50"
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            onRegenerate(quote);
                                        }}
                                    >
                                        <RefreshCw className="h-4 w-4" />
                                    </Button>
                                </TooltipTrigger>
                                <TooltipContent>
                                    <p>Regenerate with price uplift</p>
                                </TooltipContent>
                            </Tooltip>
                        </TooltipProvider>
                    )}
                </div>
            </CardContent>
        </Card>
    );
}
