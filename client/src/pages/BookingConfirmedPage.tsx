import { useEffect, useState, useMemo } from 'react';
import { useRoute, useLocation, useSearch } from 'wouter';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { Phone, Mail, ArrowLeft, Download, Calendar, FlaskConical } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { format, addDays } from 'date-fns';

import {
  ConfirmationHeader,
  BookingSummaryCard,
  SegmentValueCard,
  ContextualValueCard,
  PortalIntroCard,
  CrossSellCard,
  WhatsNextCard,
} from '@/components/confirmation';
import type { CrossSellService } from '@/lib/cross-sell-recommendations';
import handyServicesLogo from '../assets/handy-logo-transparent.png';

interface ConfirmationData {
  quote: {
    id: string;
    shortSlug: string;
    customerName: string;
    phone: string;
    email?: string;
    jobDescription: string;
    postcode: string;
    address?: string;
    segment: string;
    selectedPackage?: string;
    selectedExtras?: string[];
    selectedDate?: string;
    timeSlotType?: string;
    exactTimeRequested?: string;
    schedulingTier?: string;
    isWeekendBooking?: boolean;
    schedulingFeeInPence?: number;
    depositAmountPence: number;
    depositPaidAt: string;
    paymentType?: string; // 'deposit' | 'full' | 'installments'
    flexBookingWithinDays?: number; // > 0 => customer chose Flexible scheduling
    // Contextual quote fields
    contextualHeadline?: string;
    contextualMessage?: string;
    jobTopLine?: string;
    proposalSummary?: string;
    valueBullets?: string[];
    layoutTier?: string;
    pricingLineItems?: Array<{
      description: string;
      guardedPricePence: number;
      timeEstimateMinutes?: number;
      materialsCostPence?: number;
      materialsWithMarginPence?: number;
    }>;
    batchDiscountPercent?: number;
  };
  invoice?: {
    id: string;
    invoiceNumber: string;
    totalAmount: number;
    depositPaid: number;
    balanceDue: number;
    status: string;
  };
  portalToken?: string;
  job?: {
    id: string;
    status: string;
    scheduledDate?: string;
  };
  contractor?: {
    name: string;
    imageUrl?: string;
  };
}

// Test data for each segment
const TEST_SEGMENTS = ['CONTEXTUAL', 'PROP_MGR', 'LANDLORD', 'BUSY_PRO', 'SMALL_BIZ', 'DIY_DEFERRER', 'BUDGET', 'UNKNOWN'] as const;

const TEST_JOB_DESCRIPTIONS: Record<string, string> = {
  CONTEXTUAL: 'Mount 65" TV on living room wall with cable management, patch and paint 2 nail holes in hallway',
  PROP_MGR: 'Fix leaking tap in Unit 4B, replace toilet seat in Unit 2A',
  LANDLORD: 'Repair bathroom extractor fan at rental property, tenant reporting condensation',
  BUSY_PRO: 'Mount 65" TV on living room wall, hide cables in wall',
  SMALL_BIZ: 'Fix emergency exit door that won\'t close properly, replace broken lock',
  DIY_DEFERRER: 'Hang 3 pictures, fix squeaky door, put up curtain rail, assemble IKEA bookshelf',
  BUDGET: 'Fix dripping kitchen tap',
  UNKNOWN: 'General handyman work needed',
};

function generateTestData(
  segment: string,
  mode: 'exact' | 'flexible' = 'exact',
  payment: 'deposit' | 'full' = 'deposit',
): ConfirmationData {
  const scheduledDate = addDays(new Date(), 3);

  const base: ConfirmationData = {
    quote: {
      id: 'test-quote-id',
      shortSlug: 'TEST123',
      customerName: 'Test Customer',
      phone: '07700 900000',
      email: 'test@example.com',
      jobDescription: TEST_JOB_DESCRIPTIONS[segment] || TEST_JOB_DESCRIPTIONS.UNKNOWN,
      postcode: 'SW1A 1AA',
      address: '10 Downing Street, London',
      segment: segment,
      selectedPackage: 'enhanced',
      selectedExtras: ['Photo Report', 'Tenant Coordination'],
      selectedDate: scheduledDate.toISOString(),
      timeSlotType: 'morning',
      depositAmountPence: 4900,
      depositPaidAt: new Date().toISOString(),
    },
    invoice: {
      id: 'test-invoice-id',
      invoiceNumber: 'INV-2025-TEST',
      totalAmount: 14900,
      depositPaid: 4900,
      balanceDue: 10000,
      status: 'sent',
    },
    portalToken: 'test-portal-token-abc123',
    job: {
      id: 'job_test123',
      status: 'pending',
      scheduledDate: scheduledDate.toISOString(),
    },
    contractor: {
      name: 'Ben the Handyman',
      imageUrl: undefined,
    },
  };

  let data: ConfirmationData = base;

  // Contextual test data — uses AI-generated fields instead of segment content
  if (segment === 'CONTEXTUAL') {
    data = {
      ...base,
      quote: {
        ...base.quote,
        segment: 'CONTEXTUAL',
        selectedPackage: undefined,
        selectedExtras: undefined,
        depositAmountPence: 4650,
        contextualHeadline: 'Your Living Room Sorted',
        contextualMessage: "We'll mount your TV with full cable management and patch those hallway holes, so you won't need to lift a finger.",
        jobTopLine: 'TV mounted, walls patched',
        proposalSummary: 'Mount a 65-inch TV on the living room wall with in-wall cable management for a clean finish. Patch and paint two nail holes in the hallway to match existing decor. All materials included.',
        valueBullets: [
          'Fixed price, no surprises',
          'Full cleanup included',
          '90-day workmanship guarantee',
          '£2M insured',
          'Same-week scheduling',
        ],
        layoutTier: 'standard',
        pricingLineItems: [
          { description: 'Mount 65" TV with cable management', guardedPricePence: 12000, timeEstimateMinutes: 90 },
          { description: 'Patch & paint 2 nail holes', guardedPricePence: 3500, timeEstimateMinutes: 30 },
        ],
        batchDiscountPercent: 10,
      },
      invoice: {
        ...base.invoice!,
        totalAmount: 15500,
        depositPaid: 4650,
        balanceDue: 10850,
      },
    };
  }

  // Mode — flexible means no fixed date or contractor yet; exact means assigned.
  if (mode === 'flexible') {
    data = {
      ...data,
      quote: { ...data.quote, selectedDate: undefined, timeSlotType: undefined, flexBookingWithinDays: 7 },
      contractor: undefined,
      job: undefined,
    };
  } else {
    data = { ...data, quote: { ...data.quote, flexBookingWithinDays: 0 } };
  }

  // Payment — full means paid in full with zero balance; deposit keeps the balance.
  if (payment === 'full') {
    const total = data.invoice?.totalAmount ?? data.quote.depositAmountPence;
    data = {
      ...data,
      quote: { ...data.quote, paymentType: 'full', depositAmountPence: total },
      invoice: data.invoice ? { ...data.invoice, depositPaid: total, balanceDue: 0 } : undefined,
    };
  } else {
    data = { ...data, quote: { ...data.quote, paymentType: 'deposit' } };
  }

  return data;
}

function BookingConfirmedPage() {
  const [, params] = useRoute('/booking-confirmed/:quoteId');
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const quoteId = params?.quoteId;

  // Parse query string for test mode
  const searchString = window.location.search;
  const urlParams = new URLSearchParams(searchString);
  const testSegment = urlParams.get('segment') || 'BUSY_PRO';
  const testMode: 'exact' | 'flexible' = urlParams.get('mode') === 'flexible' ? 'flexible' : 'exact';
  const testPayment: 'deposit' | 'full' = urlParams.get('payment') === 'full' ? 'full' : 'deposit';

  // Check if this is test mode
  const isTestMode = quoteId === 'test';

  // Generate test data if in test mode
  const testData = useMemo(() => {
    if (!isTestMode) return null;
    return generateTestData(testSegment, testMode, testPayment);
  }, [isTestMode, testSegment, testMode, testPayment]);

  // Fetch confirmation data (skip if test mode)
  const { data: fetchedData, isLoading, error } = useQuery<ConfirmationData>({
    queryKey: ['booking-confirmation', quoteId],
    queryFn: async () => {
      const res = await fetch(`/api/personalized-quotes/${quoteId}/confirmation`);
      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.error || 'Failed to load confirmation');
      }
      return res.json();
    },
    enabled: !!quoteId && !isTestMode,
    retry: 1,
  });

  // Use test data or fetched data
  const data = isTestMode ? testData : fetchedData;

  // Handle segment-specific actions
  const handleAction = (action: string) => {
    switch (action) {
      case 'portal':
        if (data?.portalToken) {
          window.location.href = `/invoice/${data.portalToken}`;
        }
        break;
      case 'download-invoice':
        if (data?.portalToken) {
          // Open invoice page with print/download option
          window.open(`/invoice/${data.portalToken}`, '_blank');
        }
        break;
      case 'add-calendar':
        handleAddToCalendar();
        break;
      case 'partner-program':
        // Could link to partner application
        toast({
          title: 'Partner Program',
          description: 'We\'ll be in touch after your job to discuss our Partner Program.',
        });
        break;
      case 'phone':
        window.location.href = 'tel:08001234567';
        break;
      case 'services':
        // Could link to services page
        toast({
          title: 'Coming Soon',
          description: 'Our services catalog is coming soon.',
        });
        break;
    }
  };

  // Generate calendar .ics file
  const handleAddToCalendar = () => {
    if (!data?.quote.selectedDate || !data?.quote.jobDescription) {
      toast({
        title: 'No date selected',
        description: 'Your booking date will be confirmed shortly.',
        variant: 'destructive',
      });
      return;
    }

    const date = new Date(data.quote.selectedDate);
    const startDate = format(date, "yyyyMMdd'T'090000");
    const endDate = format(date, "yyyyMMdd'T'120000");

    const icsContent = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Handy Services//Booking//EN
BEGIN:VEVENT
UID:${data.quote.id}@handyservices.co.uk
DTSTAMP:${format(new Date(), "yyyyMMdd'T'HHmmss'Z'")}
DTSTART:${startDate}
DTEND:${endDate}
SUMMARY:Handy Services - ${data.quote.jobDescription.substring(0, 50)}
DESCRIPTION:Your handyman booking. Reference: ${data.invoice?.invoiceNumber || data.quote.shortSlug}
LOCATION:${data.quote.address || data.quote.postcode}
STATUS:CONFIRMED
END:VEVENT
END:VCALENDAR`;

    const blob = new Blob([icsContent], { type: 'text/calendar' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `booking-${data.quote.shortSlug}.ics`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    toast({
      title: 'Calendar Event Downloaded',
      description: 'Open the file to add it to your calendar.',
    });
  };

  // Handle cross-sell service request
  const handleRequestService = (service: CrossSellService) => {
    toast({
      title: `${service.name} Requested`,
      description: 'We\'ll discuss this with you during our confirmation call.',
    });
    // Could also send to API to log the interest
  };

  // Loading state (not for test mode)
  if (isLoading && !isTestMode) {
    return (
      <div className="min-h-screen bg-handy-bg flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-handy-navy" />
      </div>
    );
  }

  // Error state
  if (error || !data) {
    return (
      <div className="min-h-screen bg-handy-bg flex items-center justify-center p-4">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-handy-navy mb-2">Booking Not Found</h1>
          <p className="text-handy-muted mb-4">
            {error instanceof Error ? error.message : 'This booking could not be found.'}
          </p>
          <Button
            variant="outline"
            onClick={() => setLocation('/')}
            className="border-handy-navy/30 text-handy-navy"
          >
            <ArrowLeft className="w-4 h-4 mr-2" />
            Go Home
          </Button>
        </div>
      </div>
    );
  }

  const { quote, invoice, portalToken, contractor } = data;

  // Detect contextual quote — has AI-generated fields instead of segment content
  const isContextualQuote = !!(quote.contextualHeadline && quote.valueBullets?.length);

  // Phase 31 — booking mode + payment state drive the confirmation copy.
  //  • exact   = a specific date was booked and a contractor is assigned to it
  //  • flexible = customer chose "we slot you in", confirmed nearer the day
  const mode: 'exact' | 'flexible' = (quote.flexBookingWithinDays ?? 0) > 0 ? 'flexible' : 'exact';
  const paidInFull = quote.paymentType === 'full' || (invoice ? invoice.balanceDue <= 0 : false);
  const flexWindowDays = quote.flexBookingWithinDays || 7;
  const dateLabel = quote.selectedDate ? format(new Date(quote.selectedDate), 'EEEE d MMMM') : null;
  const slotLabel = (() => {
    switch (quote.timeSlotType) {
      case 'morning': return 'morning (8am–1pm)';
      case 'afternoon': return 'afternoon (1pm–6pm)';
      case 'first': return 'first slot (8am–9am)';
      default: return null;
    }
  })();
  const balanceLabel = invoice && invoice.balanceDue > 0 ? `£${(invoice.balanceDue / 100).toFixed(2)}` : null;

  return (
    <div className="min-h-screen bg-handy-bg font-sans">
      {/* Brand nav bar — navy with logo, wordmark, social proof + phone (PDF parity) */}
      <header className="bg-handy-navy sticky top-0 z-50">
        <div className="max-w-lg mx-auto px-4 py-2.5 flex items-center gap-3">
          <img src={handyServicesLogo} alt="Handy Services" className="h-7 w-auto shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="text-white font-bold text-sm leading-tight">Handy Services</div>
            <div className="text-[11px] leading-tight">
              <span className="text-handy-yellow">★★★★★</span>{' '}
              <span className="text-white/75">4.9 from 300+ reviews</span>
            </div>
          </div>
          <a
            href="tel:07449501762"
            className="text-white text-sm font-semibold hover:text-handy-yellow flex items-center gap-1.5 shrink-0"
          >
            <Phone className="w-4 h-4" />
            <span className="hidden xs:inline">07449 501 762</span>
            <span className="xs:hidden">Call</span>
          </a>
        </div>
      </header>

      {/* Test Mode Banner */}
      {isTestMode && (
        <div className="bg-purple-900/80 border-b border-purple-500">
          <div className="max-w-lg mx-auto px-4 py-3">
            <div className="flex items-center gap-2 text-purple-200 mb-2">
              <FlaskConical className="w-4 h-4" />
              <span className="text-sm font-medium">Test Mode</span>
              <span className="text-xs text-purple-400">- Preview confirmation page with mock data</span>
            </div>
            <div className="flex flex-wrap gap-2">
              {TEST_SEGMENTS.map((seg) => (
                <Button
                  key={seg}
                  size="sm"
                  variant={testSegment === seg ? 'default' : 'outline'}
                  className={
                    testSegment === seg
                      ? 'bg-purple-600 hover:bg-purple-700 text-white text-xs h-7'
                      : 'border-purple-500 text-purple-300 hover:bg-purple-800 text-xs h-7'
                  }
                  onClick={() => {
                    window.location.href = `/booking-confirmed/test?segment=${seg}&mode=${testMode}&payment=${testPayment}`;
                  }}
                >
                  {seg}
                </Button>
              ))}
            </div>
            {/* Mode + payment toggles — preview all four confirmation states */}
            <div className="flex flex-wrap gap-2 mt-2">
              {([['exact', 'Exact date'], ['flexible', 'Flexible']] as const).map(([m, label]) => (
                <Button
                  key={m}
                  size="sm"
                  variant={testMode === m ? 'default' : 'outline'}
                  className={testMode === m ? 'bg-emerald-600 hover:bg-emerald-700 text-white text-xs h-7' : 'border-purple-500 text-purple-300 hover:bg-purple-800 text-xs h-7'}
                  onClick={() => { window.location.href = `/booking-confirmed/test?segment=${testSegment}&mode=${m}&payment=${testPayment}`; }}
                >
                  {label}
                </Button>
              ))}
              <span className="w-px bg-purple-700 mx-1" />
              {([['deposit', 'Deposit'], ['full', 'Paid in full']] as const).map(([p, label]) => (
                <Button
                  key={p}
                  size="sm"
                  variant={testPayment === p ? 'default' : 'outline'}
                  className={testPayment === p ? 'bg-emerald-600 hover:bg-emerald-700 text-white text-xs h-7' : 'border-purple-500 text-purple-300 hover:bg-purple-800 text-xs h-7'}
                  onClick={() => { window.location.href = `/booking-confirmed/test?segment=${testSegment}&mode=${testMode}&payment=${p}`; }}
                >
                  {label}
                </Button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Main Content */}
      <main className="max-w-lg mx-auto px-4 py-6 space-y-6">
        {/* Animated Confirmation Header */}
        <ConfirmationHeader
          customerName={quote.customerName}
          depositAmount={quote.depositAmountPence}
          jobTopLine={quote.jobTopLine}
          mode={mode}
          paidInFull={paidInFull}
          contractorName={contractor?.name}
          dateLabel={dateLabel}
          slotLabel={slotLabel}
          flexWindowDays={flexWindowDays}
        />

        {/* Booking Summary */}
        <BookingSummaryCard
          jobDescription={quote.jobDescription}
          postcode={quote.postcode}
          scheduledDate={quote.selectedDate}
          timeSlotType={quote.timeSlotType}
          exactTimeRequested={quote.exactTimeRequested}
          selectedPackage={quote.selectedPackage}
          selectedExtras={quote.selectedExtras}
          invoiceNumber={invoice?.invoiceNumber}
          quoteReference={quote.shortSlug}
        />

        {/* What Happens Next */}
        <WhatsNextCard
          mode={mode}
          paidInFull={paidInFull}
          contractorName={contractor?.name}
          dateLabel={dateLabel}
          slotLabel={slotLabel}
          flexWindowDays={flexWindowDays}
          balanceLabel={balanceLabel}
        />

        {/* Value Card — contextual or segment-based */}
        {isContextualQuote ? (
          <ContextualValueCard
            contextualHeadline={quote.contextualHeadline!}
            contextualMessage={quote.contextualMessage!}
            proposalSummary={quote.proposalSummary}
            valueBullets={quote.valueBullets!}
            pricingLineItems={quote.pricingLineItems}
            priceBuckets={(quote as any).pricingLayerBreakdown?.priceBuckets}
            batchDiscountPercent={quote.batchDiscountPercent}
            layoutTier={quote.layoutTier}
            onAction={handleAction}
            portalToken={portalToken}
          />
        ) : (
          <SegmentValueCard
            segment={quote.segment}
            onAction={handleAction}
            portalToken={portalToken}
          />
        )}

        {/* Portal Introduction */}
        {portalToken && (
          <PortalIntroCard
            portalToken={portalToken}
            invoiceNumber={invoice?.invoiceNumber}
            onViewPortal={() => handleAction('portal')}
          />
        )}

        {/* Cross-Sell (segment-based only, not for contextual quotes) */}
        {!isContextualQuote && quote.segment !== 'BUDGET' && quote.segment !== 'OLDER_WOMAN' && (
          <CrossSellCard
            jobDescription={quote.jobDescription}
            segment={quote.segment}
            onRequestService={handleRequestService}
            onViewAllServices={() => handleAction('services')}
          />
        )}

        {/* Contact Footer — navy brand block */}
        <motion.div
          className="bg-handy-navy rounded-2xl px-6 py-6 text-center"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.8 }}
        >
          <p className="text-white/70 text-sm mb-3">Questions? Get in touch:</p>
          <div className="flex items-center justify-center gap-4">
            <a
              href="tel:07449501762"
              className="text-white font-semibold hover:text-handy-yellow flex items-center gap-1.5"
            >
              <Phone className="w-4 h-4 text-handy-yellow" />
              07449 501 762
            </a>
            <span className="text-white/25">|</span>
            <a
              href="mailto:info@handyservices.co.uk"
              className="text-white font-semibold hover:text-handy-yellow flex items-center gap-1.5"
            >
              <Mail className="w-4 h-4 text-handy-yellow" />
              Email Us
            </a>
          </div>

          {/* Balance-due (deposit) or paid-in-full reassurance */}
          {invoice && invoice.balanceDue > 0 ? (
            <div className="mt-4 bg-handy-yellow/15 border border-handy-yellow/30 rounded-lg p-3">
              <p className="text-sm text-white/90">
                Balance due on completion:{' '}
                <span className="font-bold text-handy-yellow">£{(invoice.balanceDue / 100).toFixed(2)}</span>
              </p>
            </div>
          ) : paidInFull ? (
            <div className="mt-4 bg-handy-yellow/15 border border-handy-yellow/30 rounded-lg p-3">
              <p className="text-sm text-white/90">
                <span className="font-bold text-handy-yellow">Paid in full.</span> Nothing more to pay on the day.
              </p>
            </div>
          ) : null}
        </motion.div>
      </main>
    </div>
  );
}

export default BookingConfirmedPage;
