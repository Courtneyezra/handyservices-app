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
import { Copy, Eye, RefreshCw, Trash2, ExternalLink, Download, CreditCard, Pencil, FileEdit, MessageCircle } from 'lucide-react';
import { useLocation } from 'wouter';
import { useToast } from '@/hooks/use-toast';
import { generateQuotePDF } from '@/lib/quote-pdf-generator';
import { buildQuoteWhatsAppMessage } from '@/lib/whatsapp-quote-message';
import type { DateAvailability } from '@/hooks/useAvailability';

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
    // Scheduling fields
    selectedDate: string | null;
    timeSlotType: string | null;
    exactTimeRequested: string | null;
    schedulingTier: string | null;
    isWeekendBooking: boolean | null;
    dateTimePreferences: { date: string; timeSlot: 'am' | 'pm' | 'flexible' | 'full_day' }[] | null;
}

interface QuotesListProps {
    quotes: PersonalizedQuote[];
    onDelete: (id: string) => void;
    onRegenerate?: (quote: PersonalizedQuote) => void;
    onEdit?: (quote: PersonalizedQuote) => void;
    linkPrefix?: string;
    availableDates?: DateAvailability[];
}

export function QuotesList({ quotes, onDelete, onRegenerate, onEdit, linkPrefix = '/quote-link/', availableDates = [] }: QuotesListProps) {
    const { toast } = useToast();
    const [, setLocation] = useLocation();

    const finalPrefix = linkPrefix.endsWith('/') ? linkPrefix.slice(0, -1) : linkPrefix;

    const copyLink = (e: React.MouseEvent, slug: string) => {
        e.stopPropagation();
        navigator.clipboard.writeText(`${window.location.origin}${finalPrefix}/${slug}`);
        toast({ title: 'Copied', description: 'Link copied to clipboard' });
    };

    const handleWhatsApp = (quote: PersonalizedQuote) => {
        const firstName = quote.customerName.split(' ')[0];
        const quoteUrl = `${window.location.origin}${finalPrefix}/${quote.shortSlug}`;

        const available = availableDates
            .filter(d => d.isAvailable && d.slots.length > 0)
            .slice(0, 3)
            .map(d => ({ date: d.date, slots: d.slots }));

        const message = buildQuoteWhatsAppMessage({
            firstName,
            jobDescription: quote.jobDescription || 'your job',
            quoteUrl,
            segment: quote.segment || 'DEFAULT',
            availableDates: available,
        });

        // Format phone for wa.me: strip all non-digits, ensure 44 country code
        const digits = quote.phone.replace(/[^\d]/g, '');
        const waPhone = digits.startsWith('44') ? digits : digits.startsWith('0') ? `44${digits.slice(1)}` : `44${digits}`;
        window.open(`https://wa.me/${waPhone}?text=${encodeURIComponent(message)}`, '_blank');
    };

    return (
        <div className="rounded-md border">
            <Table>
                <TableHeader>
                    <TableRow>
                        <TableHead>Customer</TableHead>
                        <TableHead className="hidden sm:table-cell">Reference</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead className="hidden md:table-cell">Booking</TableHead>
                        <TableHead className="text-right">Value</TableHead>
                        <TableHead className="text-right hidden sm:table-cell">Payment</TableHead>
                        <TableHead className="text-right hidden md:table-cell">Created</TableHead>
                        <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {quotes.map((quote) => {
                        const isExpired = quote.expiresAt ? new Date(quote.expiresAt) < new Date() : false;
                        const isBooked = !!quote.bookedAt;
                        const isPaid = !!quote.depositPaidAt;
                        const displayPrice = quote.basePrice || quote.enhancedPrice || 0;

                        return (
                            <TableRow key={quote.id} className={isBooked ? 'bg-green-50/50 dark:bg-green-900/10' : ''}>
                                <TableCell className="font-medium">
                                    <div className="flex flex-col">
                                        <span>{quote.customerName}</span>
                                        <span className="text-xs text-muted-foreground">{quote.phone}</span>
                                        {quote.jobDescription && (
                                            <span className="text-xs text-muted-foreground/70 line-clamp-1 max-w-[200px]">
                                                {quote.jobDescription}
                                            </span>
                                        )}
                                    </div>
                                </TableCell>
                                <TableCell className="hidden sm:table-cell">
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
                                        {isBooked && <Badge className="bg-green-600 text-[10px]">Booked</Badge>}
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
                                <TableCell className="hidden md:table-cell">
                                    {quote.dateTimePreferences && quote.dateTimePreferences.length > 0 ? (
                                        <div className="text-sm space-y-0.5">
                                            {quote.dateTimePreferences.map((pref, i) => {
                                                const slotLabel = pref.timeSlot === 'am' ? 'AM'
                                                    : pref.timeSlot === 'pm' ? 'PM'
                                                    : pref.timeSlot === 'full_day' ? 'Full day'
                                                    : 'Flexible';
                                                return (
                                                    <div key={pref.date + i} className="flex items-baseline gap-1.5">
                                                        <span className="text-[10px] font-bold text-muted-foreground">{i + 1}.</span>
                                                        <span className="font-medium">{format(new Date(pref.date), 'EEE d MMM')}</span>
                                                        <span className="text-xs text-muted-foreground">· {slotLabel}</span>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    ) : quote.selectedDate ? (
                                        <div className="text-sm">
                                            <span className="font-medium">{format(new Date(quote.selectedDate), 'EEE d MMM')}</span>
                                            <span className="text-xs text-muted-foreground block">
                                                {quote.timeSlotType === 'morning' ? 'Morning (8am-12pm)'
                                                    : quote.timeSlotType === 'afternoon' ? 'Afternoon (12pm-5pm)'
                                                    : quote.timeSlotType === 'first' ? 'First Slot (8-9am)'
                                                    : quote.timeSlotType === 'exact' ? (quote.exactTimeRequested || 'Exact Time')
                                                    : quote.timeSlotType === 'anytime' ? 'Any Time'
                                                    : quote.timeSlotType || ''}
                                            </span>
                                        </div>
                                    ) : (
                                        <span className="text-xs text-muted-foreground/50">Not booked</span>
                                    )}
                                </TableCell>
                                <TableCell className="text-right font-mono">
                                    {displayPrice ? `£${(displayPrice / 100).toFixed(0)}` : '-'}
                                </TableCell>
                                <TableCell className="text-right hidden sm:table-cell">
                                    {isPaid && quote.depositAmountPence ? (
                                        <div className="text-sm">
                                            <span className="font-mono text-green-600">£{(quote.depositAmountPence / 100).toFixed(2)}</span>
                                            <span className="text-xs text-muted-foreground block">
                                                {format(new Date(quote.depositPaidAt!), 'dd MMM')}
                                            </span>
                                        </div>
                                    ) : (
                                        <span className="text-muted-foreground">-</span>
                                    )}
                                </TableCell>
                                <TableCell className="text-right text-muted-foreground text-sm hidden md:table-cell">
                                    {format(new Date(quote.createdAt), 'dd MMM yyyy')}
                                </TableCell>
                                <TableCell className="text-right">
                                    <div className="flex justify-end items-center gap-1">
                                        {/* WhatsApp — primary action */}
                                        <TooltipProvider>
                                            <Tooltip>
                                                <TooltipTrigger asChild>
                                                    <Button
                                                        variant="ghost"
                                                        size="icon"
                                                        className="h-8 w-8 text-[#25D366] hover:text-white hover:bg-[#25D366]"
                                                        onClick={() => handleWhatsApp(quote)}
                                                    >
                                                        <MessageCircle className="h-4 w-4" />
                                                    </Button>
                                                </TooltipTrigger>
                                                <TooltipContent>Send via WhatsApp</TooltipContent>
                                            </Tooltip>
                                        </TooltipProvider>

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
                                                <TooltipContent>View link</TooltipContent>
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
                                                <TooltipContent>Full edit</TooltipContent>
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
