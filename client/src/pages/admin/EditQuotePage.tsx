import { useState, useEffect } from 'react';
import { useParams, useLocation } from 'wouter';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { ArrowLeft, Loader2, AlertTriangle, CreditCard, Calendar, CheckCircle2 } from 'lucide-react';

import { QuoteBuilder } from '@/components/quote/QuoteBuilder';
import type { TaskItem, Segment, AnalyzedJobData, ExistingQuoteData } from '@/types/quote-builder';
import { poundsToPence, penceToPounds, mapApiTasksToTaskItems } from '@/lib/quote-price-calculator';

export default function EditQuotePage() {
  const { slug } = useParams<{ slug: string }>();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [warnings, setWarnings] = useState<string[]>([]);

  // Fetch the existing quote
  const { data: quote, isLoading, error } = useQuery<ExistingQuoteData>({
    queryKey: ['/api/personalized-quotes', slug],
    queryFn: async () => {
      const res = await fetch(`/api/personalized-quotes/${slug}`);
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Failed to fetch quote' }));
        throw new Error(err.error || 'Quote not found');
      }
      return res.json();
    },
    enabled: !!slug,
  });

  // Derive initial data from quote
  const getInitialData = () => {
    if (!quote) return undefined;

    // Parse tasks from jobs array if present
    let tasks: TaskItem[] = [];
    let analyzedJob = null;

    if (quote.jobs && Array.isArray(quote.jobs) && quote.jobs.length > 0) {
      const jobData = quote.jobs[0];
      if (jobData.tasks && Array.isArray(jobData.tasks)) {
        tasks = mapApiTasksToTaskItems(jobData.tasks);
        analyzedJob = {
          summary: jobData.summary || '',
          tasks,
          totalHours: jobData.totalEstimatedHours || 0,
          basePricePounds: jobData.basePricePounds || 0,
        };
      }
    }

    // Calculate effective price from existing quote
    const basePriceInPounds = quote.basePrice
      ? penceToPounds(quote.basePrice)
      : quote.essentialPrice
        ? penceToPounds(quote.essentialPrice)
        : quote.baseJobPricePence
          ? penceToPounds(quote.baseJobPricePence)
          : 0;

    return {
      customerName: quote.customerName || '',
      phone: quote.phone || '',
      email: quote.email || '',
      address: quote.address || '',
      postcode: quote.postcode || '',
      jobDescription: quote.jobDescription || '',
      segment: (quote.segment as Segment) || 'BUSY_PRO',
      tasks,
      analyzedJob,
      priceOverride: basePriceInPounds > 0 ? basePriceInPounds.toString() : '',
    };
  };

  // Check for blocking conditions
  const isBlocked = quote?.installmentStatus === 'active';
  const isPaid = !!quote?.depositPaidAt;
  const isBooked = !!quote?.bookedAt;

  // Handle save
  const handleSubmit = async (data: {
    customerName: string;
    phone: string;
    email?: string;
    address?: string;
    postcode: string;
    jobDescription: string;
    segment: Segment;
    tasks: TaskItem[];
    analyzedJobData: AnalyzedJobData | null;
    effectivePrice: number;
  }) => {
    if (!quote) return;

    setIsSubmitting(true);
    setWarnings([]);

    try {
      // Build the update payload
      const updates: Record<string, any> = {
        customerName: data.customerName,
        phone: data.phone,
        email: data.email || null,
        address: data.address,
        postcode: data.postcode,
        jobDescription: data.jobDescription,
        segment: data.segment,
        editReason: 'Full edit via Edit Quote page',
      };

      // If we have analyzed job data, include it
      if (data.analyzedJobData) {
        updates.analyzedJobData = data.analyzedJobData;
        updates.recalculatePricing = true;
      }

      // Calculate new prices based on segment
      // For HHH mode quotes, recalculate tiers
      if (quote.quoteMode === 'hhh') {
        const basePrice = poundsToPence(data.effectivePrice);
        // Tier calculations: Essential = base, Enhanced = base * 1.3, Elite = base * 1.6
        updates.essentialPrice = basePrice;
        updates.enhancedPrice = Math.round(basePrice * 1.3);
        updates.elitePrice = Math.round(basePrice * 1.6);
      } else {
        // Simple mode
        updates.basePrice = poundsToPence(data.effectivePrice);
      }

      const response = await fetch(`/api/admin/personalized-quotes/${quote.id}/edit`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      });

      const result = await response.json();

      if (!response.ok) {
        if (result.blockers) {
          toast({
            title: 'Cannot edit quote',
            description: result.blockers.join(' '),
            variant: 'destructive',
          });
          return;
        }
        throw new Error(result.error || 'Failed to save changes');
      }

      if (result.warnings && result.warnings.length > 0) {
        setWarnings(result.warnings);
      }

      // Invalidate queries
      queryClient.invalidateQueries({ queryKey: ['/api/personalized-quotes'] });
      queryClient.invalidateQueries({ queryKey: ['/api/personalized-quotes', slug] });

      toast({
        title: 'Quote Updated',
        description: 'Changes saved successfully.',
      });

      // Navigate back after short delay if no warnings
      if (!result.warnings || result.warnings.length === 0) {
        setTimeout(() => setLocation('/admin/quotes'), 1000);
      }

    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message || 'Failed to save changes',
        variant: 'destructive',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error || !quote) {
    return (
      <div className="max-w-2xl mx-auto p-6">
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>
            {error instanceof Error ? error.message : 'Quote not found'}
          </AlertDescription>
        </Alert>
        <Button
          variant="outline"
          className="mt-4"
          onClick={() => setLocation('/admin/quotes')}
        >
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back to Quotes
        </Button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 p-4 md:p-8">
      <div className="max-w-2xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setLocation('/admin/quotes')}
              className="mb-2"
            >
              <ArrowLeft className="h-4 w-4 mr-1" />
              Back to Quotes
            </Button>
            <h1 className="text-3xl font-bold text-slate-900">Edit Quote</h1>
            <p className="text-slate-600 mt-1">
              Editing quote <code className="bg-slate-200 px-2 py-0.5 rounded text-sm">{quote.shortSlug}</code>
            </p>
          </div>
          <div className="flex flex-col items-end gap-2">
            {isPaid && (
              <Badge className="bg-blue-600">
                <CreditCard className="h-3 w-3 mr-1" />
                Paid
              </Badge>
            )}
            {isBooked && (
              <Badge className="bg-green-600">
                <Calendar className="h-3 w-3 mr-1" />
                Booked
              </Badge>
            )}
          </div>
        </div>

        {/* Blocked Warning */}
        {isBlocked && (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>
              <strong>Cannot edit this quote.</strong> It has an active installment plan.
              Cancel the plan first to make changes.
            </AlertDescription>
          </Alert>
        )}

        {/* Paid Warning */}
        {isPaid && !isBlocked && (
          <Alert className="bg-yellow-50 border-yellow-200">
            <AlertTriangle className="h-4 w-4 text-yellow-600" />
            <AlertDescription className="text-yellow-800">
              <strong>Caution:</strong> This quote has been paid. Price changes may require
              additional payment collection or refund handling.
            </AlertDescription>
          </Alert>
        )}

        {/* Post-Save Warnings */}
        {warnings.length > 0 && (
          <Alert className="bg-amber-50 border-amber-200">
            <CheckCircle2 className="h-4 w-4 text-amber-600" />
            <AlertDescription className="text-amber-800">
              <strong>Quote saved with notes:</strong>
              <ul className="mt-2 list-disc list-inside">
                {warnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
              <Button
                variant="outline"
                size="sm"
                className="mt-3"
                onClick={() => setLocation('/admin/quotes')}
              >
                Back to Quotes
              </Button>
            </AlertDescription>
          </Alert>
        )}

        {/* Quote Builder */}
        {!isBlocked && (
          <QuoteBuilder
            mode="edit"
            initialData={getInitialData()}
            onSubmit={handleSubmit}
            isSubmitting={isSubmitting}
            submitLabel="Save Changes"
            showWhatsAppContext={false}
          />
        )}

        {/* Preview Link */}
        <Card className="bg-slate-100">
          <CardContent className="py-4">
            <div className="flex items-center justify-between">
              <span className="text-sm text-slate-600">Quote Preview:</span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => window.open(`/quote-link/${quote.shortSlug}`, '_blank')}
              >
                Open Quote Page
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
