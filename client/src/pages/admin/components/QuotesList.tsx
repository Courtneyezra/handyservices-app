import { format } from 'date-fns';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Copy, Eye, RefreshCw, Trash2, ExternalLink, Download, CreditCard, Pencil, FileEdit } from 'lucide-react';
import { useLocation } from 'wouter';
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
    regenerationCount?: number | null;
    // Payment fields
    depositPaidAt: string | null;
    depositAmountPence: number | null;
    paymentType: string | null;
}

interface QuotesListProps {
    quotes: PersonalizedQuote[];
    onDelete: (id: string) => void;
    onRegenerate?: (quote: PersonalizedQuote) => void;
    onEdit?: (quote: PersonalizedQuote) => void;
    linkPrefix?: string;
}

export function QuotesList({ quotes, onDelete, onRegenerate, onEdit, linkPrefix = '/quote-link/' }: QuotesListProps) {
    const { toast } = useToast();
    const [, setLocation] = useLocation();

    // Ensure prefix is clean for use in both context
    const finalPrefix = linkPrefix.endsWith('/') ? linkPrefix.slice(0, -1) : linkPrefix;

    const copyLink = (e: React.MouseEvent, slug: string) => {
        e.stopPropagation();
        navigator.clipboard.writeText(`${window.location.origin}${finalPrefix}/${slug}`);
        toast({ title: 'Copied', description: 'Link copied to clipboard' });
    };

    return (
        <div className="rounded-md border">
            <Table>
                <TableHeader>
                    <TableRow>
                        <TableHead>Customer</TableHead>
                        <TableHead>Reference</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead className="text-right">Value</TableHead>
                        <TableHead className="text-right">Payment</TableHead>
                        <TableHead className="text-right">Created</TableHead>
                        <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {quotes.map((quote) => {
                        const isExpired = quote.expiresAt ? new Date(quote.expiresAt) < new Date() : false;
                        const isBooked = !!quote.bookedAt;
                        const isPaid = !!quote.depositPaidAt;

                        // Determine display price
                        let displayPrice = quote.basePrice;
                        if (quote.quoteMode === 'hhh' && quote.essentialPrice) {
                            displayPrice = quote.essentialPrice;
                        }

                        return (
                            <TableRow key={quote.id} className={isBooked ? 'bg-green-50/50 dark:bg-green-900/10' : ''}>
                                <TableCell className="font-medium">
                                    <div className="flex flex-col">
                                        <span>{quote.customerName}</span>
                                        <span className="text-xs text-muted-foreground">{quote.phone}</span>
                                    </div>
                                </TableCell>
                                <TableCell>
                                    <div className="flex items-center gap-2">
                                        <code className="bg-muted px-1.5 py-0.5 rounded text-xs">{quote.shortSlug}</code>
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            className="h-6 w-6 text-muted-foreground hover:text-foreground"
                                            onClick={(e) => copyLink(e, quote.shortSlug)}
                                        >
                                            <Copy className="h-3 w-3" />
                                        </Button>
                                    </div>
                                </TableCell>
                                <TableCell>
                                    <div className="flex flex-wrap gap-1">
                                        {quote.viewedAt && (
                                            <Badge variant="outline" className="text-green-600 border-green-600 text-[10px]">
                                                Opened
                                            </Badge>
                                        )}
                                        {isBooked && (
                                            <Badge className="bg-green-600 text-[10px]">Booked</Badge>
                                        )}
                                        {isPaid && (
                                            <Badge className="bg-blue-600 text-[10px]">
                                                <CreditCard className="h-3 w-3 mr-1" />
                                                Paid
                                            </Badge>
                                        )}
                                        {isExpired && !isBooked && (
                                            <Badge variant="secondary" className="bg-red-100 text-red-600 dark:bg-red-900/30 text-[10px]">Expired</Badge>
                                        )}
                                        {quote.regenerationCount && quote.regenerationCount > 0 ? (
                                            <Badge variant="outline" className="text-blue-500 border-blue-200 text-[10px]">v{quote.regenerationCount + 1}</Badge>
                                        ) : null}
                                    </div>
                                </TableCell>
                                <TableCell className="text-right font-mono">
                                    {displayPrice ? `£${(displayPrice / 100).toFixed(2)}` : '-'}
                                    {(quote.quoteMode === 'hhh') && <span className="text-xs text-muted-foreground ml-1">(Essential)</span>}
                                </TableCell>
                                <TableCell className="text-right">
                                    {isPaid && quote.depositAmountPence ? (
                                        <div className="text-sm">
                                            <span className="font-mono text-green-600">{"\u00A3"}{(quote.depositAmountPence / 100).toFixed(2)}</span>
                                            <span className="text-xs text-muted-foreground block">
                                                {format(new Date(quote.depositPaidAt!), 'dd MMM')}
                                            </span>
                                        </div>
                                    ) : (
                                        <span className="text-muted-foreground">-</span>
                                    )}
                                </TableCell>
                                <TableCell className="text-right text-muted-foreground text-sm">
                                    {format(new Date(quote.createdAt), 'dd MMM yyyy')}
                                </TableCell>
                                <TableCell className="text-right">
                                    <div className="flex justify-end items-center gap-1">
                                        <TooltipProvider>
                                            <Tooltip>
                                                <TooltipTrigger asChild>
                                                    <Button
                                                        variant="ghost"
                                                        size="icon"
                                                        className="h-8 w-8 text-blue-600 hover:text-blue-700 hover:bg-blue-50"
                                                        onClick={() => window.open(`${finalPrefix}/${quote.shortSlug}`, '_blank')}
                                                    >
                                                        <ExternalLink className="h-4 w-4" />
                                                    </Button>
                                                </TooltipTrigger>
                                                <TooltipContent>View Link</TooltipContent>
                                            </Tooltip>
                                        </TooltipProvider>

                                        <TooltipProvider>
                                            <Tooltip>
                                                <TooltipTrigger asChild>
                                                    <Button
                                                        variant="ghost"
                                                        size="icon"
                                                        className="h-8 w-8 text-slate-600 hover:text-[#7DB00E] hover:bg-green-50"
                                                        onClick={() => {
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
                                                <TooltipContent>Download PDF</TooltipContent>
                                            </Tooltip>
                                        </TooltipProvider>

                                        {onEdit && (
                                            <TooltipProvider>
                                                <Tooltip>
                                                    <TooltipTrigger asChild>
                                                        <Button
                                                            variant="ghost"
                                                            size="icon"
                                                            className="h-8 w-8 text-orange-600 hover:text-orange-700 hover:bg-orange-50"
                                                            onClick={() => onEdit(quote)}
                                                        >
                                                            <Pencil className="h-4 w-4" />
                                                        </Button>
                                                    </TooltipTrigger>
                                                    <TooltipContent>Quick edit</TooltipContent>
                                                </Tooltip>
                                            </TooltipProvider>
                                        )}

                                        <TooltipProvider>
                                            <Tooltip>
                                                <TooltipTrigger asChild>
                                                    <Button
                                                        variant="ghost"
                                                        size="icon"
                                                        className="h-8 w-8 text-purple-600 hover:text-purple-700 hover:bg-purple-50"
                                                        onClick={() => setLocation(`/admin/quotes/${quote.shortSlug}/edit`)}
                                                    >
                                                        <FileEdit className="h-4 w-4" />
                                                    </Button>
                                                </TooltipTrigger>
                                                <TooltipContent>Full edit (tasks & pricing)</TooltipContent>
                                            </Tooltip>
                                        </TooltipProvider>

                                        {(isExpired || !isBooked) && onRegenerate && (
                                            <TooltipProvider>
                                                <Tooltip>
                                                    <TooltipTrigger asChild>
                                                        <Button
                                                            variant="ghost"
                                                            size="icon"
                                                            className="h-8 w-8 text-muted-foreground hover:text-foreground hover:bg-muted"
                                                            onClick={() => onRegenerate(quote)}
                                                        >
                                                            <RefreshCw className="h-4 w-4" />
                                                        </Button>
                                                    </TooltipTrigger>
                                                    <TooltipContent>Regenerate</TooltipContent>
                                                </Tooltip>
                                            </TooltipProvider>
                                        )}

                                        <TooltipProvider>
                                            <Tooltip>
                                                <TooltipTrigger asChild>
                                                    <Button
                                                        variant="ghost"
                                                        size="icon"
                                                        className="h-8 w-8 text-muted-foreground hover:text-red-600 hover:bg-red-50"
                                                        onClick={() => {
                                                            if (confirm('Are you sure you want to delete this quote?')) {
                                                                onDelete(quote.id);
                                                            }
                                                        }}
                                                    >
                                                        <Trash2 className="h-4 w-4" />
                                                    </Button>
                                                </TooltipTrigger>
                                                <TooltipContent>Delete</TooltipContent>
                                            </Tooltip>
                                        </TooltipProvider>
                                    </div>
                                </TableCell>
                            </TableRow>
                        );
                    })}
                </TableBody>
            </Table>
        </div>
    );
}
