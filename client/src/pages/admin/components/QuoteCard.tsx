import { format } from 'date-fns';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Copy, Eye, Phone, RefreshCw, X, Download, CreditCard, Pencil, FileEdit, MessageCircle, Hammer, ShieldCheck, UserCheck, Receipt, CheckSquare, CheckCircle, MoreHorizontal, Loader2 } from 'lucide-react';
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
    completedAt?: string | null;
    // Scheduling fields
    selectedDate: string | null;
    timeSlotType: string | null;
    exactTimeRequested: string | null;
    dateTimePreferences: { date: string; timeSlot: 'am' | 'pm' | 'flexible' | 'full_day' }[] | null;
    // Dispatch state — populated when this quote has been pushed to the contractor pool.
    dispatch?: {
        id: string;
        status: 'pending' | 'locked' | 'completed' | 'cancelled';
        publicToken: string | null;
        lockedAt: string | null;
        contractorName: string | null;
        bondStatus: 'pending' | 'held' | 'refunded' | 'forfeited' | 'failed' | null;
        bondAmountPence: number | null;
        bondPaidAt: string | null;
    } | null;
}

interface QuoteCardProps {
    quote: PersonalizedQuote;
    onDelete: (id: string) => void;
    onRegenerate: (quote: PersonalizedQuote) => void;
    onEdit?: (quote: PersonalizedQuote) => void;
    onPreview?: (quote: PersonalizedQuote) => void;
    onGenerateInvoice?: (quote: PersonalizedQuote) => void;
    onMarkComplete?: (quote: PersonalizedQuote) => void;
    isGeneratingInvoice?: boolean;
    isMarkingComplete?: boolean;
    availableDates?: DateAvailability[];
}

export function QuoteCard({ quote, onDelete, onRegenerate, onEdit, onPreview, onGenerateInvoice, onMarkComplete, isGeneratingInvoice, isMarkingComplete, availableDates = [] }: QuoteCardProps) {
    const { toast } = useToast();
    const [, setLocation] = useLocation();

    const isExpired = quote.expiresAt ? new Date(quote.expiresAt) < new Date() : false;
    const isBooked = !!quote.bookedAt;
    const isPaid = !!quote.depositPaidAt;
    const isCompleted = !!quote.completedAt;
    // Invoicing makes sense once a job is committed (paid / booked) or done.
    const canInvoice = isPaid || isBooked || isCompleted;
    // Mark-complete only for committed jobs that aren't already done.
    const canMarkComplete = (isPaid || isBooked) && !isCompleted;

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
                            {isCompleted && (
                                <Badge className="bg-green-600 text-[10px]">
                                    <CheckCircle className="h-3 w-3 mr-0.5" />
                                    Done
                                </Badge>
                            )}
                            {isBooked && !isCompleted && <Badge className="bg-green-600 text-[10px]">Booked</Badge>}
                            {isPaid && (
                                <Badge className="bg-blue-600 text-[10px]">
                                    <CreditCard className="h-3 w-3 mr-0.5" />
                                    Paid
                                </Badge>
                            )}
                            {/* Dispatch state — locked contractor + bond status */}
                            {quote.dispatch?.status === 'pending' && (
                                <Badge variant="outline" className="text-amber-700 border-amber-300 bg-amber-50 text-[10px]" title="Dispatched, awaiting contractor lock">
                                    <Hammer className="h-3 w-3 mr-0.5" /> Dispatched
                                </Badge>
                            )}
                            {(quote.dispatch?.status === 'locked' || quote.dispatch?.status === 'completed') && quote.dispatch.contractorName && (
                                <Badge className="bg-emerald-600 text-[10px]" title={quote.dispatch.lockedAt ? `Locked ${format(new Date(quote.dispatch.lockedAt), 'dd MMM HH:mm')}` : 'Locked'}>
                                    <UserCheck className="h-3 w-3 mr-0.5" />
                                    {quote.dispatch.contractorName}
                                </Badge>
                            )}
                            {quote.dispatch?.bondStatus === 'held' && quote.dispatch.bondAmountPence && (
                                <Badge variant="outline" className="text-emerald-700 border-emerald-300 bg-emerald-50 text-[10px]" title={quote.dispatch.bondPaidAt ? `Bond paid ${format(new Date(quote.dispatch.bondPaidAt), 'dd MMM HH:mm')}` : 'Bond held'}>
                                    <ShieldCheck className="h-3 w-3 mr-0.5" />
                                    Bond £{Math.round(quote.dispatch.bondAmountPence / 100)}
                                </Badge>
                            )}
                            {isExpired && !isBooked && (
                                <Badge variant="secondary" className="bg-red-100 text-red-600 dark:bg-red-900/30 text-[10px]">Expired</Badge>
                            )}
                        </div>
                    </div>
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

                {/* Actions */}
                <div className="mt-auto pt-3 border-t space-y-2">
                    {/* Primary: WhatsApp Send */}
                    <Button
                        className="w-full bg-[#25D366] hover:bg-[#20BD5A] text-white font-medium"
                        size="sm"
                        onClick={handleWhatsApp}
                    >
                        <MessageCircle className="h-4 w-4 mr-2" />
                        Send via WhatsApp
                    </Button>

                    {/* Lean action row: View · Edit · Invoice · More */}
                    <div className="flex items-center gap-1.5">
                        <Button
                            variant="outline"
                            size="sm"
                            className="flex-1 h-8 px-2 text-xs"
                            onClick={(e) => { e.stopPropagation(); window.open(`/quote-link/${quote.shortSlug}`, '_blank'); }}
                        >
                            <Eye className="h-3.5 w-3.5 mr-1" /> View
                        </Button>

                        <Button
                            variant="outline"
                            size="sm"
                            className="flex-1 h-8 px-2 text-xs text-orange-600 hover:text-orange-700 hover:bg-orange-50 border-orange-200"
                            onClick={(e) => { e.stopPropagation(); onPreview ? onPreview(quote) : setLocation(`/admin/quotes/${quote.shortSlug}/edit`); }}
                        >
                            <Pencil className="h-3.5 w-3.5 mr-1" /> Edit
                        </Button>

                        {canInvoice && onGenerateInvoice && (
                            <Button
                                size="sm"
                                className="flex-1 h-8 px-2 text-xs bg-amber-500 hover:bg-amber-400 text-black font-medium"
                                disabled={isGeneratingInvoice}
                                onClick={(e) => { e.stopPropagation(); onGenerateInvoice(quote); }}
                            >
                                {isGeneratingInvoice
                                    ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
                                    : <Receipt className="h-3.5 w-3.5 mr-1" />}
                                Invoice
                            </Button>
                        )}

                        {/* Overflow menu — less-frequent actions */}
                        <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                                <Button variant="outline" size="icon" className="h-8 w-8 shrink-0" onClick={(e) => e.stopPropagation()}>
                                    <MoreHorizontal className="h-4 w-4" />
                                </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-52">
                                <DropdownMenuItem onClick={(e) => { e.stopPropagation(); setLocation(`/admin/quotes/${quote.shortSlug}/edit`); }}>
                                    <FileEdit className="h-4 w-4 mr-2" /> Full edit
                                </DropdownMenuItem>
                                {canMarkComplete && onMarkComplete && (
                                    <DropdownMenuItem
                                        onClick={(e) => { e.stopPropagation(); onMarkComplete(quote); }}
                                        disabled={isMarkingComplete}
                                        className="text-green-700 focus:text-green-800"
                                    >
                                        {isMarkingComplete
                                            ? <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                                            : <CheckSquare className="h-4 w-4 mr-2" />}
                                        Mark complete
                                    </DropdownMenuItem>
                                )}
                                {isPaid && (
                                    <DropdownMenuItem onClick={(e) => { e.stopPropagation(); setLocation(`/admin/dispatch/new?quoteId=${quote.shortSlug}`); }}>
                                        <Hammer className="h-4 w-4 mr-2" /> Dispatch to contractors
                                    </DropdownMenuItem>
                                )}
                                {(isExpired || !isBooked) && (
                                    <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onRegenerate(quote); }}>
                                        <RefreshCw className="h-4 w-4 mr-2" /> Regenerate
                                    </DropdownMenuItem>
                                )}
                                <DropdownMenuItem
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
                                    <Download className="h-4 w-4 mr-2" /> Download PDF
                                </DropdownMenuItem>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem
                                    onClick={(e) => { e.stopPropagation(); handleDelete(e); }}
                                    className="text-red-600 focus:text-red-700 focus:bg-red-50"
                                >
                                    <X className="h-4 w-4 mr-2" /> Delete quote
                                </DropdownMenuItem>
                            </DropdownMenuContent>
                        </DropdownMenu>
                    </div>
                </div>
            </CardContent>
        </Card>
    );
}
