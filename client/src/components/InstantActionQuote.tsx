import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Check, Clock, Shield, ChevronRight, Plus, X } from 'lucide-react';
import type { PersonalizedQuote } from '@/pages/PersonalizedQuotePage';
import { useToast } from '@/hooks/use-toast';

interface UpsellSku {
    skuCode: string;
    name: string;
    pricePence: number;
    customerDescription: string;
    shape: string;
}

interface InstantActionQuoteProps {
    quote: PersonalizedQuote;
}

type Screen = 'quote' | 'upsell' | 'payment' | 'confirmed';

export function InstantActionQuote({ quote }: InstantActionQuoteProps) {
    const [screen, setScreen] = useState<Screen>('quote');
    const [selectedUpsells, setSelectedUpsells] = useState<Set<string>>(new Set());
    const [isBooking, setIsBooking] = useState(false);
    const { toast } = useToast();

    const upsells: UpsellSku[] = quote.upsellSkus ?? [];
    const basePricePence = quote.basePrice ?? 0;

    const upsellTotal = upsells
        .filter((u) => selectedUpsells.has(u.skuCode))
        .reduce((sum, u) => sum + u.pricePence, 0);

    const totalPricePence = basePricePence + upsellTotal;

    const toggleUpsell = (skuCode: string) => {
        setSelectedUpsells((prev) => {
            const next = new Set(prev);
            if (next.has(skuCode)) next.delete(skuCode);
            else next.add(skuCode);
            return next;
        });
    };

    const handleBooking = async (paymentIntentId: string) => {
        setIsBooking(true);
        try {
            const addedUpsellCodes = [...selectedUpsells];
            const leadData = {
                customerName: quote.customerName,
                phone: quote.phone,
                email: quote.email || undefined,
                jobDescription: quote.jobDescription,
                postcode: quote.postcode || undefined,
                address: quote.address || undefined,
                outcome: 'phone_quote',
                eeePackage: 'simple',
                quoteAmount: totalPricePence,
                source: 'instant_quote',
                stripePaymentId: paymentIntentId,
            };

            const leadResponse = await fetch('/api/leads', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(leadData),
            });

            if (!leadResponse.ok) throw new Error('Failed to create lead');
            const lead = await leadResponse.json();

            await fetch(`/api/personalized-quotes/${quote.id}/track-booking`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    leadId: lead.id,
                    selectedPackage: 'simple',
                    paymentType: 'full',
                    addedUpsells: addedUpsellCodes,
                }),
            });

            setScreen('confirmed');
        } catch (error) {
            console.error('Booking error:', error);
            toast({
                title: 'Error',
                description: 'Failed to process booking. Please contact support.',
                variant: 'destructive',
            });
        } finally {
            setIsBooking(false);
        }
    };

    if (screen === 'confirmed') {
        return (
            <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
                <Card className="w-full max-w-md shadow-lg text-center">
                    <CardContent className="p-10 space-y-4">
                        <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto">
                            <Check className="w-8 h-8 text-green-600" />
                        </div>
                        <h2 className="text-2xl font-bold">Booking Confirmed</h2>
                        <p className="text-muted-foreground">
                            We'll be in touch shortly to confirm your appointment.
                        </p>
                        <p className="font-semibold">Total: £{(totalPricePence / 100).toFixed(2)}</p>
                    </CardContent>
                </Card>
            </div>
        );
    }

    // ── "While we're there…" upsell intercept ───────────────────────────────
    if (screen === 'upsell') {
        return (
            <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
                <Card className="w-full max-w-2xl shadow-lg">
                    <CardHeader className="bg-primary text-primary-foreground p-6 rounded-t-lg">
                        <div className="flex items-start justify-between">
                            <div>
                                <Badge variant="secondary" className="mb-2">While We're There…</Badge>
                                <CardTitle className="text-xl font-bold">
                                    Add anything else while we're there?
                                </CardTitle>
                                <p className="text-sm opacity-80 mt-1">
                                    No extra call-out charge — these are priced as add-ons.
                                </p>
                            </div>
                            <button
                                onClick={() => setScreen('quote')}
                                className="opacity-70 hover:opacity-100 transition-opacity"
                                aria-label="Go back"
                            >
                                <X className="w-5 h-5" />
                            </button>
                        </div>
                    </CardHeader>
                    <CardContent className="p-6 space-y-4">
                        {upsells.length === 0 ? (
                            <p className="text-muted-foreground text-sm">No add-ons available for this job.</p>
                        ) : (
                            <ul className="space-y-3">
                                {upsells.map((u) => {
                                    const checked = selectedUpsells.has(u.skuCode);
                                    return (
                                        <li
                                            key={u.skuCode}
                                            onClick={() => toggleUpsell(u.skuCode)}
                                            className={`flex items-start gap-4 p-4 rounded-xl border-2 cursor-pointer transition-all ${
                                                checked
                                                    ? 'border-primary bg-primary/5'
                                                    : 'border-border hover:border-primary/40 bg-white'
                                            }`}
                                        >
                                            <Checkbox
                                                checked={checked}
                                                onCheckedChange={() => toggleUpsell(u.skuCode)}
                                                className="mt-0.5 shrink-0"
                                            />
                                            <div className="flex-1 min-w-0">
                                                <div className="flex items-center justify-between gap-2">
                                                    <span className="font-semibold text-sm">{u.name}</span>
                                                    <span className="font-bold text-sm whitespace-nowrap">
                                                        + £{(u.pricePence / 100).toFixed(0)}
                                                    </span>
                                                </div>
                                                <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                                                    {u.customerDescription}
                                                </p>
                                            </div>
                                        </li>
                                    );
                                })}
                            </ul>
                        )}

                        <div className="border-t pt-4 space-y-3">
                            <div className="flex justify-between items-center">
                                <span className="text-sm text-muted-foreground">Base job</span>
                                <span className="text-sm">£{(basePricePence / 100).toFixed(2)}</span>
                            </div>
                            {upsellTotal > 0 && (
                                <div className="flex justify-between items-center text-primary">
                                    <span className="text-sm">Add-ons selected</span>
                                    <span className="text-sm font-medium">+ £{(upsellTotal / 100).toFixed(2)}</span>
                                </div>
                            )}
                            <div className="flex justify-between items-center border-t pt-3">
                                <span className="font-bold">Total</span>
                                <span className="text-2xl font-bold">£{(totalPricePence / 100).toFixed(2)}</span>
                            </div>
                        </div>

                        <div className="flex flex-col sm:flex-row gap-3 pt-2">
                            <Button
                                variant="outline"
                                className="flex-1"
                                onClick={() => {
                                    setSelectedUpsells(new Set());
                                    handleBooking('skip_payment');
                                }}
                                disabled={isBooking}
                            >
                                No thanks, just the original job
                            </Button>
                            <Button
                                className="flex-1 font-bold"
                                onClick={() => handleBooking('skip_payment')}
                                disabled={isBooking}
                            >
                                {isBooking ? 'Confirming…' : (
                                    <>
                                        {selectedUpsells.size > 0 ? 'Add to booking & confirm' : 'Confirm booking'}
                                        <ChevronRight className="w-4 h-4 ml-1" />
                                    </>
                                )}
                            </Button>
                        </div>

                        <p className="text-xs text-center text-muted-foreground flex items-center justify-center gap-1">
                            <Shield className="w-3 h-3" /> Secure payment via Stripe
                        </p>
                    </CardContent>
                </Card>
            </div>
        );
    }

    // ── Main quote view ──────────────────────────────────────────────────────
    return (
        <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
            <Card className="w-full max-w-2xl shadow-lg">
                <CardHeader className="bg-primary text-primary-foreground p-6 rounded-t-lg">
                    <div className="flex justify-between items-start">
                        <div>
                            <Badge variant="secondary" className="mb-2">Instant Action Quote</Badge>
                            <CardTitle className="text-2xl font-bold">
                                {quote.jobDescription || 'Standard Service'}
                            </CardTitle>
                        </div>
                        {basePricePence > 0 && (
                            <div className="text-right">
                                <div className="text-3xl font-bold">£{(basePricePence / 100).toFixed(2)}</div>
                                <div className="text-sm opacity-90">Fixed Price</div>
                            </div>
                        )}
                    </div>
                </CardHeader>
                <CardContent className="p-6 space-y-6">
                    <div className="space-y-4">
                        <div className="bg-muted p-4 rounded-lg">
                            <h3 className="font-semibold mb-3">What's Included</h3>
                            {quote.jobs && quote.jobs.length > 0 && quote.jobs[0].tasks && quote.jobs[0].tasks.length > 0 ? (
                                <ul className="space-y-3">
                                    {quote.jobs[0].tasks.map((task, idx) => (
                                        <li key={idx} className="flex items-start gap-3">
                                            <div className="mt-1">
                                                <Check className="w-4 h-4 text-green-600" />
                                            </div>
                                            <div className="flex-1">
                                                <span className="font-medium text-sm">{task.description}</span>
                                                {task.estimatedDuration && (
                                                    <span className="text-xs text-muted-foreground ml-2">
                                                        ({task.estimatedDuration})
                                                    </span>
                                                )}
                                            </div>
                                        </li>
                                    ))}
                                </ul>
                            ) : (
                                <ul className="space-y-2">
                                    <li className="flex items-center gap-2">
                                        <Check className="w-4 h-4 text-green-600" />
                                        <span>Professional Service</span>
                                    </li>
                                    <li className="flex items-center gap-2">
                                        <Shield className="w-4 h-4 text-green-600" />
                                        <span>Satisfaction Guarantee</span>
                                    </li>
                                    <li className="flex items-center gap-2">
                                        <Clock className="w-4 h-4 text-green-600" />
                                        <span>Fast Turnaround</span>
                                    </li>
                                </ul>
                            )}
                        </div>

                        {quote.contractor && (
                            <div className="flex items-center gap-4 border-t pt-4">
                                {quote.contractor.profilePhotoUrl && (
                                    <img
                                        src={quote.contractor.profilePhotoUrl}
                                        alt={quote.contractor.name}
                                        className="w-12 h-12 rounded-full object-cover"
                                    />
                                )}
                                <div>
                                    <div className="font-medium">{quote.contractor.name}</div>
                                    <div className="text-sm text-muted-foreground">{quote.contractor.companyName}</div>
                                </div>
                            </div>
                        )}
                    </div>

                    <div className="border-t pt-6 mt-6">
                        <div className="flex items-center justify-between mb-4">
                            <span className="text-lg font-semibold">Total Price</span>
                            <span className="text-2xl font-bold bg-primary/10 text-primary px-3 py-1 rounded">
                                {basePricePence > 0 ? `£${(basePricePence / 100).toFixed(2)}` : '£---'}
                            </span>
                        </div>

                        {upsells.length > 0 && (
                            <p className="text-xs text-muted-foreground mb-3 flex items-center gap-1">
                                <Plus className="w-3 h-3" />
                                We'll suggest a few easy add-ons after you click below — no obligation.
                            </p>
                        )}

                        <Button
                            className="w-full text-lg h-12 font-bold shadow-lg hover:scale-[1.02] transition-transform"
                            onClick={() => {
                                if (upsells.length > 0) {
                                    setScreen('upsell');
                                } else {
                                    handleBooking('skip_payment');
                                }
                            }}
                        >
                            Accept & Pay Securely
                        </Button>
                        <p className="text-xs text-center text-muted-foreground mt-3 flex items-center justify-center gap-1">
                            <Shield className="w-3 h-3" /> Secure payment via Stripe
                        </p>
                    </div>
                </CardContent>
            </Card>
        </div>
    );
}
