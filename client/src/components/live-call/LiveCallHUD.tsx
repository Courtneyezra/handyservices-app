/**
 * LiveCallHUD - Wrapper that connects CallHUD to LiveCallContext
 *
 * Auto-populates customer info from voice entity extraction.
 * VA can still override/edit all fields.
 *
 * Now with real action handlers for:
 * - SEND QUOTE: Create quote, send WhatsApp
 * - GET VIDEO: Request video via WhatsApp
 * - BOOK VISIT: Schedule diagnostic visit
 */

import React, { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useLiveCall } from '@/contexts/LiveCallContext';
import { CallHUD, CustomerInfo, DetectedJobHUD } from './CallHUD';
import { QuoteSendPopup } from './QuoteSendPopup';
import { BookVisitPopup } from './BookVisitPopup';
import { AvailabilityPanel } from './AvailabilityPanel';
import { useToast } from '@/hooks/use-toast';
import { openWhatsApp, getWhatsAppErrorMessage, copyWhatsAppFallback } from '@/lib/whatsapp-helper';
import { Clock, Eye, X } from 'lucide-react';
import type { CallScriptSegment } from '@shared/schema';

type HUDSegment = Exclude<CallScriptSegment, 'EMERGENCY'>;

// Action states for optimistic UI
type ActionState = 'idle' | 'pending' | 'success' | 'error';

interface LiveCallHUDProps {
  onQuote?: () => void;
  onVideo?: () => void;
  onVisit?: () => void;
}

export function LiveCallHUD({ onQuote, onVideo, onVisit }: LiveCallHUDProps) {
  const { toast } = useToast();
  const {
    extractedCustomerInfo,
    liveCallData,
    currentSegment,
    segmentOptions,
    setCurrentSegment,
    detectedJobs,
    activeCallSid,
    routeRecommendation,
    callEndedState,
    keepCallOpen,
    clearCall,
  } = useLiveCall();

  // Local state for customer info that VA can edit
  const [customerInfo, setCustomerInfo] = useState<CustomerInfo>({
    name: '',
    whatsappSameAsCalling: null,
    whatsappNumber: '',
    address: '',
  });

  // Track action states for optimistic UI
  const [quoteState, setQuoteState] = useState<ActionState>('idle');
  const [videoState, setVideoState] = useState<ActionState>('idle');
  const [visitState, setVisitState] = useState<ActionState>('idle');

  // Quote popup state
  const [showQuotePopup, setShowQuotePopup] = useState(false);

  // Visit popup state
  const [showVisitPopup, setShowVisitPopup] = useState(false);

  // Track if user has manually edited fields (to avoid overwriting their input)
  const [userEditedFields, setUserEditedFields] = useState<Set<string>>(new Set());

  // Update customer info when extraction finds new data (only if user hasn't edited)
  useEffect(() => {
    setCustomerInfo(prev => {
      const updates: Partial<CustomerInfo> = {};

      // Auto-fill name if extracted and user hasn't edited it
      if (extractedCustomerInfo.name && !userEditedFields.has('name') && !prev.name) {
        updates.name = extractedCustomerInfo.name;
      }

      // Auto-fill address if extracted and user hasn't edited it
      // Combine address and postcode if both available
      if (!userEditedFields.has('address') && !prev.address) {
        if (extractedCustomerInfo.address && extractedCustomerInfo.postcode) {
          updates.address = `${extractedCustomerInfo.address}, ${extractedCustomerInfo.postcode}`;
        } else if (extractedCustomerInfo.address) {
          updates.address = extractedCustomerInfo.address;
        } else if (extractedCustomerInfo.postcode) {
          updates.address = extractedCustomerInfo.postcode;
        }
      }

      return Object.keys(updates).length > 0 ? { ...prev, ...updates } : prev;
    });
  }, [extractedCustomerInfo, userEditedFields]);

  // Track user edits to prevent auto-fill from overwriting
  const handleCustomerInfoChange = useCallback((info: CustomerInfo) => {
    // Detect which fields were manually changed
    const newEditedFields = new Set(userEditedFields);
    if (info.name !== customerInfo.name) {
      newEditedFields.add('name');
    }
    if (info.address !== customerInfo.address) {
      newEditedFields.add('address');
    }
    if (info.whatsappNumber !== customerInfo.whatsappNumber ||
        info.whatsappSameAsCalling !== customerInfo.whatsappSameAsCalling) {
      newEditedFields.add('whatsapp');
    }
    setUserEditedFields(newEditedFields);
    setCustomerInfo(info);
  }, [customerInfo, userEditedFields]);

  // Handle segment selection
  const handleSegmentSelect = useCallback((segment: HUDSegment) => {
    setCurrentSegment(segment);
  }, [setCurrentSegment]);

  // Get AI recommended segment from options
  const aiRecommendedSegment = segmentOptions.length > 0
    ? segmentOptions[0].segment as HUDSegment
    : null;

  // Convert detected jobs to HUD format with full SKU info and traffic light
  const hudJobs: DetectedJobHUD[] = detectedJobs.map(job => ({
    id: job.id,
    description: job.description,
    matched: job.matched,
    pricePence: job.sku?.pricePence,
    trafficLight: job.trafficLight,
  }));

  // Get calling number from metadata
  const callingNumber = liveCallData?.metadata?.phoneNumber || undefined;

  // Determine the phone number to use for WhatsApp
  const getWhatsAppNumber = useCallback((): string | null => {
    if (customerInfo.whatsappSameAsCalling === true) {
      return callingNumber || null;
    }
    if (customerInfo.whatsappSameAsCalling === false && customerInfo.whatsappNumber) {
      return customerInfo.whatsappNumber;
    }
    // Fall back to calling number if nothing else specified
    return callingNumber || null;
  }, [customerInfo, callingNumber]);

  // Extract postcode from address (simple pattern match)
  const extractPostcode = useCallback((address: string): string | undefined => {
    // UK postcode pattern
    const postcodeMatch = address.match(/[A-Z]{1,2}[0-9][0-9A-Z]?\s?[0-9][A-Z]{2}/i);
    return postcodeMatch ? postcodeMatch[0].toUpperCase() : undefined;
  }, []);

  // Calculate call duration
  const [callDuration, setCallDuration] = useState(0);
  useEffect(() => {
    if (!liveCallData) {
      setCallDuration(0);
      return;
    }
    const interval = setInterval(() => {
      setCallDuration(prev => prev + 1);
    }, 1000);
    return () => clearInterval(interval);
  }, [liveCallData]);

  // Reset state when call ends
  useEffect(() => {
    if (!liveCallData) {
      setCustomerInfo({
        name: '',
        whatsappSameAsCalling: null,
        whatsappNumber: '',
        address: '',
      });
      setUserEditedFields(new Set());
      setQuoteState('idle');
      setVideoState('idle');
      setVisitState('idle');
      setShowQuotePopup(false);
      setShowVisitPopup(false);
    }
  }, [liveCallData]);

  // ================================================================
  // SEND QUOTE Action - Opens popup
  // ================================================================
  const handleQuote = useCallback(() => {
    console.log('[LiveCallHUD] SEND QUOTE triggered - opening popup');

    // Check for matched jobs
    const matchedJobs = detectedJobs.filter(j => j.matched && j.sku);
    if (matchedJobs.length === 0) {
      setQuoteState('error');
      setTimeout(() => setQuoteState('idle'), 2000);
      return;
    }

    // Open the popup
    setShowQuotePopup(true);
  }, [detectedJobs]);

  // Handle successful quote send from popup
  const handleQuoteSuccess = useCallback(() => {
    setQuoteState('success');
    // Reset to idle after 3 seconds so button can be used again
    setTimeout(() => setQuoteState('idle'), 3000);
    onQuote?.();
  }, [onQuote]);

  // ================================================================
  // GET VIDEO Action
  // ================================================================
  const handleVideo = useCallback(async () => {
    const phone = getWhatsAppNumber();
    console.log('[LiveCallHUD] GET VIDEO triggered', {
      customerInfo,
      detectedJobs,
      callingNumber,
      phone,
      liveCallData: liveCallData ? { metadata: liveCallData.metadata } : null
    });

    // Validate required fields - button feedback via state
    if (!customerInfo.name.trim()) {
      console.log('[LiveCallHUD] GET VIDEO failed: no name');
      setVideoState('error');
      setTimeout(() => setVideoState('idle'), 2000);
      return;
    }

    if (!phone) {
      console.log('[LiveCallHUD] GET VIDEO failed: no phone');
      setVideoState('error');
      setTimeout(() => setVideoState('idle'), 2000);
      return;
    }

    // Show pending state
    setVideoState('pending');

    try {
      const response = await fetch('/api/live-call/get-video', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customerInfo: {
            name: customerInfo.name,
            phone: phone,
            address: customerInfo.address || undefined,
            postcode: extractPostcode(customerInfo.address),
          },
          jobs: detectedJobs.map(job => ({
            id: job.id,
            description: job.description,
            matched: job.matched,
            pricePence: job.sku?.pricePence,
            sku: job.sku ? {
              id: job.sku.id,
              name: job.sku.name,
              pricePence: job.sku.pricePence,
              category: job.sku.category,
            } : undefined,
          })),
          callSid: activeCallSid || undefined,
        }),
      });

      const result = await response.json();

      if (!response.ok || !result.success) {
        throw new Error(result.error || 'Failed to request video');
      }

      // Open WhatsApp with pre-filled message (with error handling)
      const { phone: resultPhone, whatsappMessage } = result;
      if (resultPhone && whatsappMessage) {
        const whatsAppResult = await openWhatsApp(resultPhone, whatsappMessage);

        if (!whatsAppResult.success) {
          // WhatsApp failed to open - show toast with fallback
          const errorMsg = getWhatsAppErrorMessage(whatsAppResult);
          toast({
            title: errorMsg.title,
            description: errorMsg.description,
            variant: whatsAppResult.fallbackUsed ? 'default' : 'destructive',
            action: !whatsAppResult.fallbackUsed ? (
              <button
                onClick={async () => {
                  const copied = await copyWhatsAppFallback(resultPhone, whatsappMessage);
                  if (copied) {
                    toast({
                      title: 'Copied!',
                      description: `Message copied. Send to ${whatsAppResult.phone}`,
                    });
                  }
                }}
                className="inline-flex h-8 shrink-0 items-center justify-center rounded-md border bg-transparent px-3 text-sm font-medium"
              >
                Copy
              </button>
            ) : undefined,
          });
          // Still mark as success since the backend action completed
          // The WhatsApp part just needs manual intervention
        }
      }

      setVideoState('success');
      // Reset to idle after 3 seconds so button can be used again
      setTimeout(() => setVideoState('idle'), 3000);
      // Call parent callback if provided
      onVideo?.();

    } catch (error) {
      console.error('[LiveCallHUD] GET VIDEO error:', error);
      setVideoState('error');
      setTimeout(() => setVideoState('idle'), 3000);
    }
  }, [customerInfo, detectedJobs, activeCallSid, getWhatsAppNumber, extractPostcode, onVideo, callingNumber, liveCallData]);

  // ================================================================
  // BOOK VISIT Action - Opens popup
  // ================================================================
  const handleVisit = useCallback(() => {
    console.log('[LiveCallHUD] BOOK VISIT triggered - opening popup', { customerInfo, detectedJobs });

    // Validate required fields - button feedback via state
    if (!customerInfo.name.trim()) {
      setVisitState('error');
      setTimeout(() => setVisitState('idle'), 2000);
      return;
    }

    const phone = getWhatsAppNumber();
    if (!phone) {
      setVisitState('error');
      setTimeout(() => setVisitState('idle'), 2000);
      return;
    }

    // Open the popup
    setShowVisitPopup(true);
  }, [customerInfo, detectedJobs, getWhatsAppNumber]);

  // Handle successful visit booking from popup
  const handleVisitSuccess = useCallback(() => {
    setVisitState('success');
    // Reset to idle after 3 seconds so button can be used again
    setTimeout(() => setVisitState('idle'), 3000);
    onVisit?.();
  }, [onVisit]);

  // Get WhatsApp number for popup
  const popupWhatsAppNumber = getWhatsAppNumber() || callingNumber || '';

  return (
    <>
      {/* Call Ended Indicator Banner */}
      <AnimatePresence>
        {callEndedState === 'ended_reviewing' && (
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="fixed top-0 left-0 right-0 z-50 bg-amber-500/90 backdrop-blur-sm px-4 py-3"
          >
            <div className="flex items-center justify-center gap-4 max-w-4xl mx-auto">
              <div className="flex items-center gap-2 text-black">
                <motion.div
                  animate={{ rotate: 360 }}
                  transition={{ duration: 2, repeat: Infinity, ease: 'linear' }}
                >
                  <Clock className="w-5 h-5" />
                </motion.div>
                <span className="font-semibold">Call ended - reviewing summary...</span>
                <span className="text-black/70 text-sm">(auto-clears in 15s)</span>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={keepCallOpen}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-black/20 hover:bg-black/30 rounded-md text-sm font-medium text-black transition-colors"
                  title="Keep the call summary open - prevents auto-clear"
                >
                  <Eye className="w-4 h-4" />
                  Keep Open
                </button>
                <button
                  onClick={clearCall}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-black/20 hover:bg-black/30 rounded-md text-sm font-medium text-black transition-colors"
                  title="Clear now and reset for next call"
                >
                  <X className="w-4 h-4" />
                  Clear Now
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <CallHUD
        selectedSegment={currentSegment as HUDSegment | null}
        aiRecommendedSegment={aiRecommendedSegment}
        onSegmentSelect={handleSegmentSelect}
        jobs={hudJobs}
        routeRecommendation={routeRecommendation}
        customerInfo={customerInfo}
        onCustomerInfoChange={handleCustomerInfoChange}
        callingNumber={callingNumber}
        onQuote={handleQuote}
        onVideo={handleVideo}
        onVisit={handleVisit}
        quoteState={quoteState}
        videoState={videoState}
        visitState={visitState}
        callDuration={callDuration}
      />

      {/* Quote Send Popup */}
      <QuoteSendPopup
        isOpen={showQuotePopup}
        onClose={() => setShowQuotePopup(false)}
        onSuccess={handleQuoteSuccess}
        customerName={customerInfo.name}
        whatsappNumber={popupWhatsAppNumber}
        address={customerInfo.address}
        segment={currentSegment}
        jobs={detectedJobs}
        callSid={activeCallSid || undefined}
      />

      {/* Book Visit Popup */}
      <BookVisitPopup
        isOpen={showVisitPopup}
        onClose={() => setShowVisitPopup(false)}
        onSuccess={handleVisitSuccess}
        customerName={customerInfo.name}
        whatsappNumber={popupWhatsAppNumber}
        address={customerInfo.address}
        jobs={detectedJobs}
        callSid={activeCallSid || undefined}
      />
    </>
  );
}

export default LiveCallHUD;
