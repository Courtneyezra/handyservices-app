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
  PortalIntroCard,
  CrossSellCard,
  WhatsNextCard,
} from '@/components/confirmation';
import type { CrossSellService } from '@/lib/cross-sell-recommendations';
import handyServicesLogo from '../assets/handy-logo.png';

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
    depositAmountPence: number;
    depositPaidAt: string;
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
const TEST_SEGMENTS = ['PROP_MGR', 'LANDLORD', 'BUSY_PRO', 'SMALL_BIZ', 'DIY_DEFERRER', 'BUDGET', 'UNKNOWN'] as const;

const TEST_JOB_DESCRIPTIONS: Record<string, string> = {
  PROP_MGR: 'Fix leaking tap in Unit 4B, replace toilet seat in Unit 2A',
  LANDLORD: 'Repair bathroom extractor fan at rental property, tenant reporting condensation',
  BUSY_PRO: 'Mount 65" TV on living room wall, hide cables in wall',
  SMALL_BIZ: 'Fix emergency exit door that won\'t close properly, replace broken lock',
  DIY_DEFERRER: 'Hang 3 pictures, fix squeaky door, put up curtain rail, assemble IKEA bookshelf',
  BUDGET: 'Fix dripping kitchen tap',
  UNKNOWN: 'General handyman work needed',
};

function generateTestData(segment: string): ConfirmationData {
  const scheduledDate = addDays(new Date(), 3);

  return {
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
      name: 'Mike the Handyman',
      imageUrl: undefined,
    },
  };
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

  // Check if this is test mode
  const isTestMode = quoteId === 'test';

  // Generate test data if in test mode
  const testData = useMemo(() => {
    if (!isTestMode) return null;
    return generateTestData(testSegment);
  }, [isTestMode, testSegment]);

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
      <div className="min-h-screen bg-gradient-to-b from-gray-900 to-gray-800 flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[#e8b323]" />
      </div>
    );
  }

  // Error state
  if (error || !data) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-gray-900 to-gray-800 flex items-center justify-center p-4">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-red-400 mb-2">Booking Not Found</h1>
          <p className="text-gray-400 mb-4">
            {error instanceof Error ? error.message : 'This booking could not be found.'}
          </p>
          <Button
            variant="outline"
            onClick={() => setLocation('/')}
            className="border-gray-600"
          >
            <ArrowLeft className="w-4 h-4 mr-2" />
            Go Home
          </Button>
        </div>
      </div>
    );
  }

  const { quote, invoice, portalToken, contractor } = data;

  return (
    <div className="min-h-screen bg-gradient-to-b from-gray-900 to-gray-800">
      {/* Header */}
      <header className="bg-gray-900/80 border-b border-gray-700 sticky top-0 z-50">
        <div className="max-w-lg mx-auto px-4 py-3 flex items-center justify-between">
          <img src={handyServicesLogo} alt="Handy Services" className="h-8" />
          <a
            href="tel:08001234567"
            className="text-[#e8b323] text-sm hover:underline flex items-center gap-1"
          >
            <Phone className="w-4 h-4" />
            Call Us
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
                    window.location.href = `/booking-confirmed/test?segment=${seg}`;
                  }}
                >
                  {seg}
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
        />

        {/* Booking Summary */}
        <BookingSummaryCard
          jobDescription={quote.jobDescription}
          postcode={quote.postcode}
          scheduledDate={quote.selectedDate}
          selectedPackage={quote.selectedPackage}
          selectedExtras={quote.selectedExtras}
          invoiceNumber={invoice?.invoiceNumber}
          quoteReference={quote.shortSlug}
        />

        {/* What Happens Next */}
        <WhatsNextCard
          scheduledDate={quote.selectedDate}
          contractorName={contractor?.name}
        />

        {/* Segment-Specific Value Card */}
        <SegmentValueCard
          segment={quote.segment}
          onAction={handleAction}
          portalToken={portalToken}
        />

        {/* Portal Introduction */}
        {portalToken && (
          <PortalIntroCard
            portalToken={portalToken}
            invoiceNumber={invoice?.invoiceNumber}
            onViewPortal={() => handleAction('portal')}
          />
        )}

        {/* Cross-Sell (if not budget segment) */}
        {quote.segment !== 'BUDGET' && quote.segment !== 'OLDER_WOMAN' && (
          <CrossSellCard
            jobDescription={quote.jobDescription}
            segment={quote.segment}
            onRequestService={handleRequestService}
            onViewAllServices={() => handleAction('services')}
          />
        )}

        {/* Contact Footer */}
        <motion.div
          className="text-center pt-4 pb-8 border-t border-gray-700"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.8 }}
        >
          <p className="text-gray-400 text-sm mb-3">Questions? Get in touch:</p>
          <div className="flex items-center justify-center gap-4">
            <a
              href="tel:08001234567"
              className="text-[#e8b323] hover:underline flex items-center gap-1"
            >
              <Phone className="w-4 h-4" />
              0800 123 4567
            </a>
            <span className="text-gray-600">|</span>
            <a
              href="mailto:hello@handyservices.co.uk"
              className="text-[#e8b323] hover:underline flex items-center gap-1"
            >
              <Mail className="w-4 h-4" />
              Email Us
            </a>
          </div>

          {/* Balance Due Note */}
          {invoice && invoice.balanceDue > 0 && (
            <div className="mt-4 bg-blue-900/20 border border-blue-500/30 rounded-lg p-3">
              <p className="text-sm text-blue-300">
                Balance due on completion:{' '}
                <span className="font-bold">£{(invoice.balanceDue / 100).toFixed(2)}</span>
              </p>
            </div>
          )}
        </motion.div>
      </main>
    </div>
  );
}

export default BookingConfirmedPage;
