import { format } from 'date-fns';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Copy, Eye, Phone, RefreshCw, X, Download, CreditCard, Pencil, FileEdit, MessageCircle } from 'lucide-react';
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
    // Payment fields
    depositPaidAt: string | null;
    depositAmountPence: number | null;
    paymentType: string | null;
    stripePaymentIntentId: string | null;
    // Scheduling fields
    selectedDate: string | null;
    timeSlotType: string | null;
    exactTimeRequested: string | null;
    dateTimePreferences: { date: string; timeSlot: 'am' | 'pm' | 'flexible' | 'full_day' }[] | null;
}

interface QuoteCardProps {
    quote: PersonalizedQuote;
    onDelete: (id: string) => void;
    onRegenerate: (quote: PersonalizedQuote) => void;
    onEdit?: (quote: PersonalizedQuote) => void;
    onPreview?: (quote: PersonalizedQuote) => void;
    availableDates?: DateAvailability[];
}

export function QuoteCard({ quote, onDelete, onRegenerate, onEdit, onPreview, availableDates = [] }: QuoteCardProps) {
    const { toast } = useToast();
    const [, setLocation] = useLocation();

    const isExpired = quote.expiresAt ? new Date(quote.expiresAt) < new Date() : false;
    const isBooked = !!quote.bookedAt;
    const isPaid = !!quote.depositPaidAt;

    // Price display — EVE single price
    const displayPrice = quote.basePrice || quote.enhancedPrice || quote.essentialPrice || 0;

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

    const handleWhatsApp = () => {
        const firstName = quote.customerName.split(' ')[0];
        const quoteUrl = `${window.location.origin}/quote-link/${quote.shortSlug}`;

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
        <Card className={`hover:shadow-md transition-shadow relative overflow-hidden ${isBooked ? 'border-l-4 border-l-green-500' : isExpired ? 'border-l-4 border-l-red-200 opacity-80' : ''}`}>
            <CardContent className="p-4 flex flex-col h-full">
                {/* Header: Name + Status Badges */}
                <div className="flex items-start justify-between gap-2 mb-2">
                    <div className="flex-1 min-w-0">
                        <div className="flex flex-wrap items-center gap-1.5 mb-1">
                            <h3 className="font-semibold text-base text-foreground truncate" title={quote.customerName}>
                                {quote.customerName}
                            </h3>
                            {quote.viewedAt && (
                                <Badge variant="outline" className="text-green-600 border-green-600 text-[10px]" title={`Opened: ${format(new Date(quote.viewedAt), 'dd MMM yyyy, HH:mm')}`}>
                                    <Eye className="h-3 w-3 mr-0.5" />
                                    Opened
                                </Badge>
                            )}
                            {isBooked && <Badge className="bg-green-600 text-[10px]">Booked</Badge>}
                            {isPaid && (
                                <Badge className="bg-blue-600 text-[10px]">
                                    <CreditCard className="h-3 w-3 mr-0.5" />
                                    Paid
                                </Badge>
                            )}
                            {isExpired && !isBooked && (
                                <Badge variant="secondary" className="bg-red-100 text-red-600 dark:bg-red-900/30 text-[10px]">Expired</Badge>
                            )}
                        </div>
                    </div>

                    <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-muted-foreground hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 -mt-1 -mr-2 shrink-0"
                        onClick={handleDelete}
                    >
                        <X className="h-3.5 w-3.5" />
                    </Button>
                </div>

                {/* Job Description */}
                {quote.jobDescription && (
                    <p className="text-sm text-muted-foreground line-clamp-2 mb-2">
                        {quote.jobDescription}
                    </p>
                )}

                {/* Price + Details Row */}
                <div className="flex items-center justify-between gap-2 mb-2">
                    {displayPrice > 0 && (
                        <span className="text-lg font-bold text-foreground">
                            £{(displayPrice / 100).toFixed(0)}
                        </span>
                    )}
                    <div className="flex items-center gap-3 text-xs text-muted-foreground">
                        <a href={`tel:${quote.phone}`} className="flex items-center gap-1 text-blue-500 hover:underline">
                            <Phone className="h-3 w-3" />
                            {quote.phone}
                        </a>
                        {quote.postcode && <span>{quote.postcode}</span>}
                    </div>
                </div>

                {/* Quote Link */}
                <div className="flex items-center gap-1.5 mb-2">
                    <div className="flex-1 bg-muted border rounded px-2 py-1 text-xs font-mono truncate select-all">
                        {`/quote-link/${quote.shortSlug}`}
                    </div>
                    <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6 text-muted-foreground hover:text-foreground shrink-0"
                        onClick={copyLink}
                    >
                        <Copy className="h-3 w-3" />
                    </Button>
                </div>

                {/* Booking Dates — show all 3 customer picks if present */}
                {quote.dateTimePreferences && quote.dateTimePreferences.length > 0 ? (
                    <div className="text-xs mb-2 bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400 rounded px-2 py-1 space-y-0.5">
                        {quote.dateTimePreferences.map((pref, i) => {
                            const slotLabel = pref.timeSlot === 'am' ? 'AM'
                                : pref.timeSlot === 'pm' ? 'PM'
                                : pref.timeSlot === 'full_day' ? 'Full day'
                                : 'Flexible';
                            return (
                                <div key={pref.date + i} className="flex items-baseline gap-1.5">
                                    <span className="text-[10px] font-bold opacity-70">{i + 1}.</span>
                                    <span className="font-medium">{format(new Date(pref.date), 'EEE d MMM')}</span>
                                    <span className="text-green-600/70 dark:text-green-500/70">· {slotLabel}</span>
                                </div>
                            );
                        })}
                    </div>
                ) : quote.selectedDate ? (
                    <div className="flex items-center gap-1.5 text-xs mb-2 bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400 rounded px-2 py-1">
                        <span className="font-medium">{format(new Date(quote.selectedDate), 'EEE d MMM')}</span>
                        <span className="text-green-600/70 dark:text-green-500/70">
                            {quote.timeSlotType === 'morning' ? '· Morning'
                                : quote.timeSlotType === 'afternoon' ? '· Afternoon'
                                : quote.timeSlotType === 'first' ? '· First Slot'
                                : quote.timeSlotType === 'exact' ? `· ${quote.exactTimeRequested || 'Exact'}`
                                : quote.timeSlotType === 'anytime' ? '· Any Time'
                                : ''}
                        </span>
                    </div>
                ) : (
                    <div className="text-xs text-muted-foreground/40 mb-2">No booking date</div>
                )}

                {/* Meta Row */}
                <div className="flex items-center gap-2 text-xs text-muted-foreground/60 mb-3">
                    <span>{format(new Date(quote.createdAt), 'dd MMM yyyy')}</span>
                    {quote.segment && (
                        <Badge variant="outline" className="text-[9px] px-1.5 py-0 font-mono">
                            {quote.segment}
                        </Badge>
                    )}
                    {isPaid && quote.depositAmountPence && (
                        <span className="text-blue-600">
                            Paid £{(quote.depositAmountPence / 100).toFixed(2)}
                        </span>
                    )}
                </div>

                {/* Actions — mobile stacked */}
                <div className="mt-auto pt-2 border-t space-y-2">
                    {/* Primary: WhatsApp Send */}
                    <Button
                        className="w-full bg-[#25D366] hover:bg-[#20BD5A] text-white font-medium"
                        size="sm"
                        onClick={handleWhatsApp}
                    >
                        <MessageCircle className="h-4 w-4 mr-2" />
                        Send via WhatsApp
                    </Button>

                    {/* Secondary row: icon buttons */}
                    <div className="flex items-center justify-center gap-1">
                        <TooltipProvider>
                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <Button
                                        variant="outline"
                                        size="icon"
                                        className="h-8 w-8"
                                        onClick={() => window.open(`/quote-link/${quote.shortSlug}`, '_blank')}
                                    >
                                        <Eye className="h-4 w-4" />
                                    </Button>
                                </TooltipTrigger>
                                <TooltipContent>View quote</TooltipContent>
                            </Tooltip>
                        </TooltipProvider>

                        {onPreview && (
                            <TooltipProvider>
                                <Tooltip>
                                    <TooltipTrigger asChild>
                                        <Button
                                            variant="outline"
                                            size="icon"
                                            className="h-8 w-8 text-[#7DB00E] hover:text-[#6a9a0b] hover:bg-green-50 border-[#7DB00E]/30"
                                            onClick={(e) => { e.stopPropagation(); onPreview(quote); }}
                                        >
                                            <Eye className="h-4 w-4" />
                                        </Button>
                                    </TooltipTrigger>
                                    <TooltipContent>Preview & edit</TooltipContent>
                                </Tooltip>
                            </TooltipProvider>
                        )}

                        {onEdit && (
                            <TooltipProvider>
                                <Tooltip>
                                    <TooltipTrigger asChild>
                                        <Button
                                            variant="outline"
                                            size="icon"
                                            className="h-8 w-8 text-orange-600 hover:text-orange-700 hover:bg-orange-50"
                                            onClick={(e) => { e.stopPropagation(); onEdit(quote); }}
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
                                        variant="outline"
                                        size="icon"
                                        className="h-8 w-8 text-purple-600 hover:text-purple-700 hover:bg-purple-50"
                                        onClick={(e) => { e.stopPropagation(); setLocation(`/admin/quotes/${quote.shortSlug}/edit`); }}
                                    >
                                        <FileEdit className="h-4 w-4" />
                                    </Button>
                                </TooltipTrigger>
                                <TooltipContent>Full edit</TooltipContent>
                            </Tooltip>
                        </TooltipProvider>

                        <TooltipProvider>
                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <Button
                                        variant="outline"
                                        size="icon"
                                        className="h-8 w-8 text-slate-600 hover:text-[#7DB00E] hover:bg-green-50"
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            generateQuotePDF({
                                                quoteId: quote.id,
                                                customerName: quote.customerName || 'Customer',
                                                address: quote.address,
                                                postcode: quote.postcode,
                                                jobDescription: quote.jobDescription || 'As discussed',
                                                priceInPence: displayPrice,
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

                        {(isExpired || !isBooked) && (
                            <TooltipProvider>
                                <Tooltip>
                                    <TooltipTrigger asChild>
                                        <Button
                                            variant="outline"
                                            size="icon"
                                            className="h-8 w-8 text-blue-600 hover:text-blue-700 hover:bg-blue-50"
                                            onClick={(e) => { e.stopPropagation(); onRegenerate(quote); }}
                                        >
                                            <RefreshCw className="h-4 w-4" />
                                        </Button>
                                    </TooltipTrigger>
                                    <TooltipContent>Regenerate</TooltipContent>
                                </Tooltip>
                            </TooltipProvider>
                        )}
                    </div>
                </div>
            </CardContent>
        </Card>
    );
}
