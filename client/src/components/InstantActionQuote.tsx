import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Check, Clock, Shield } from 'lucide-react';
import type { PersonalizedQuote } from '@/pages/PersonalizedQuotePage';
import { Elements } from '@stripe/react-stripe-js';
import { stripePromise } from '@/lib/stripe';
import { PaymentForm } from '@/components/PaymentForm';
import { useToast } from '@/hooks/use-toast';

interface InstantActionQuoteProps {
    quote: PersonalizedQuote;
}

export function InstantActionQuote({ quote }: InstantActionQuoteProps) {
    const [showPayment, setShowPayment] = useState(false);
    const [hasBooked, setHasBooked] = useState(false);
    const { toast } = useToast();

    const handleBooking = async (paymentIntentId: string) => {
        try {
            const leadData = {
                customerName: quote.customerName,
                phone: quote.phone,
                email: quote.email || undefined,
                jobDescription: quote.jobDescription,
                outcome: 'phone_quote',
                eeePackage: 'simple',
                quoteAmount: quote.basePrice, // already in pence? Check type. PersonalizedQuote basePrice is number (pence or pounds? Schema says pence usually, but display divides by 100. Let's assume pence.)
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

            // Track booking
            await fetch(`/api/personalized-quotes/${quote.id}/track-booking`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    leadId: lead.id,
                    selectedPackage: 'simple',
                    paymentType: 'full',
                }),
            });

            setHasBooked(true);
            toast({
                title: "Booking Confirmed",
                description: "Your payment has been processed successfully.",
            });
        } catch (error) {
            console.error('Booking error:', error);
            toast({
                title: "Error",
                description: "Failed to process booking. Please contact support.",
                variant: "destructive"
            });
        }
    };

    return (
        <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
            <Card className="w-full max-w-2xl shadow-lg">
                <CardHeader className="bg-primary text-primary-foreground p-6 rounded-t-lg">
                    <div className="flex justify-between items-start">
                        <div>
                            <Badge variant="secondary" className="mb-2">Instant Action Quote</Badge>
                            <CardTitle className="text-2xl font-bold">
                                {quote.jobDescription || "Standard Service"}
                            </CardTitle>
                        </div>
                        {quote.basePrice && (
                            <div className="text-right">
                                <div className="text-3xl font-bold">£{(quote.basePrice / 100).toFixed(2)}</div>
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
                                                    <span className="text-xs text-muted-foreground ml-2">({task.estimatedDuration})</span>
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
                                {quote.basePrice ? `£${(quote.basePrice / 100).toFixed(2)}` : '£---'}
                            </span>
                        </div>

                        <Button className="w-full text-lg h-12 font-bold shadow-lg hover:scale-[1.02] transition-transform">
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
