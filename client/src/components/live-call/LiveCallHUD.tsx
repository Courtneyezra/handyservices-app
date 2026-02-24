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
import { useLiveCall } from '@/contexts/LiveCallContext';
import { CallHUD, CustomerInfo, DetectedJobHUD } from './CallHUD';
import { useToast } from '@/hooks/use-toast';
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
  const {
    extractedCustomerInfo,
    liveCallData,
    currentSegment,
    segmentOptions,
    setCurrentSegment,
    detectedJobs,
    activeCallSid,
  } = useLiveCall();

  const { toast } = useToast();

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

  // Convert detected jobs to HUD format with full SKU info
  const hudJobs: DetectedJobHUD[] = detectedJobs.map(job => ({
    id: job.id,
    description: job.description,
    matched: job.matched,
    pricePence: job.sku?.pricePence,
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
    }
  }, [liveCallData]);

  // ================================================================
  // SEND QUOTE Action
  // ================================================================
  const handleQuote = useCallback(async () => {
    console.log('[LiveCallHUD] SEND QUOTE triggered', { customerInfo, detectedJobs, currentSegment });

    // Validate required fields
    if (!customerInfo.name.trim()) {
      toast({
        title: "Missing Customer Name",
        description: "Please enter the customer's name before sending a quote.",
        variant: "destructive",
      });
      return;
    }

    const phone = getWhatsAppNumber();
    if (!phone) {
      toast({
        title: "Missing Phone Number",
        description: "Please confirm the WhatsApp number before sending a quote.",
        variant: "destructive",
      });
      return;
    }

    // Check for matched jobs
    const matchedJobs = detectedJobs.filter(j => j.matched && j.sku);
    if (matchedJobs.length === 0) {
      toast({
        title: "No Priced Jobs",
        description: "No jobs are matched to SKUs. Use GET VIDEO for unmatched jobs.",
        variant: "destructive",
      });
      return;
    }

    // Optimistic UI update
    setQuoteState('pending');
    toast({
      title: "Sending Quote...",
      description: `Creating quote for ${customerInfo.name}`,
    });

    try {
      const response = await fetch('/api/live-call/send-quote', {
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
          segment: currentSegment || undefined,
          callSid: activeCallSid || undefined,
        }),
      });

      const result = await response.json();

      if (!response.ok || !result.success) {
        throw new Error(result.error || 'Failed to send quote');
      }

      setQuoteState('success');
      toast({
        title: "Quote Sent!",
        description: result.message || `Quote sent to ${customerInfo.name} via WhatsApp`,
      });

      // Call parent callback if provided
      onQuote?.();

    } catch (error) {
      console.error('[LiveCallHUD] SEND QUOTE error:', error);
      setQuoteState('error');
      toast({
        title: "Failed to Send Quote",
        description: error instanceof Error ? error.message : 'An unexpected error occurred',
        variant: "destructive",
      });
    }
  }, [customerInfo, detectedJobs, currentSegment, activeCallSid, getWhatsAppNumber, extractPostcode, toast, onQuote]);

  // ================================================================
  // GET VIDEO Action
  // ================================================================
  const handleVideo = useCallback(async () => {
    console.log('[LiveCallHUD] GET VIDEO triggered', { customerInfo, detectedJobs });

    // Validate required fields
    if (!customerInfo.name.trim()) {
      toast({
        title: "Missing Customer Name",
        description: "Please enter the customer's name before requesting a video.",
        variant: "destructive",
      });
      return;
    }

    const phone = getWhatsAppNumber();
    if (!phone) {
      toast({
        title: "Missing Phone Number",
        description: "Please confirm the WhatsApp number before requesting a video.",
        variant: "destructive",
      });
      return;
    }

    // Optimistic UI update
    setVideoState('pending');
    toast({
      title: "Requesting Video...",
      description: `Sending video request to ${customerInfo.name}`,
    });

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

      setVideoState('success');
      toast({
        title: "Video Request Sent!",
        description: result.message || `Video request sent to ${customerInfo.name} via WhatsApp`,
      });

      // Call parent callback if provided
      onVideo?.();

    } catch (error) {
      console.error('[LiveCallHUD] GET VIDEO error:', error);
      setVideoState('error');
      toast({
        title: "Failed to Request Video",
        description: error instanceof Error ? error.message : 'An unexpected error occurred',
        variant: "destructive",
      });
    }
  }, [customerInfo, detectedJobs, activeCallSid, getWhatsAppNumber, extractPostcode, toast, onVideo]);

  // ================================================================
  // BOOK VISIT Action
  // ================================================================
  const handleVisit = useCallback(async () => {
    console.log('[LiveCallHUD] BOOK VISIT triggered', { customerInfo, detectedJobs });

    // Validate required fields
    if (!customerInfo.name.trim()) {
      toast({
        title: "Missing Customer Name",
        description: "Please enter the customer's name before booking a visit.",
        variant: "destructive",
      });
      return;
    }

    const phone = getWhatsAppNumber();
    if (!phone) {
      toast({
        title: "Missing Phone Number",
        description: "Please confirm the WhatsApp number before booking a visit.",
        variant: "destructive",
      });
      return;
    }

    if (!customerInfo.address.trim()) {
      toast({
        title: "Missing Address",
        description: "Please enter the property address before booking a visit.",
        variant: "destructive",
      });
      return;
    }

    // Optimistic UI update
    setVisitState('pending');
    toast({
      title: "Booking Visit...",
      description: `Scheduling diagnostic visit for ${customerInfo.name}`,
    });

    try {
      const response = await fetch('/api/live-call/book-visit', {
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
        throw new Error(result.error || 'Failed to book visit');
      }

      setVisitState('success');
      toast({
        title: "Visit Booked!",
        description: result.message || `Diagnostic visit confirmation sent to ${customerInfo.name}`,
      });

      // Call parent callback if provided
      onVisit?.();

    } catch (error) {
      console.error('[LiveCallHUD] BOOK VISIT error:', error);
      setVisitState('error');
      toast({
        title: "Failed to Book Visit",
        description: error instanceof Error ? error.message : 'An unexpected error occurred',
        variant: "destructive",
      });
    }
  }, [customerInfo, detectedJobs, activeCallSid, getWhatsAppNumber, extractPostcode, toast, onVisit]);

  return (
    <CallHUD
      selectedSegment={currentSegment as HUDSegment | null}
      aiRecommendedSegment={aiRecommendedSegment}
      onSegmentSelect={handleSegmentSelect}
      jobs={hudJobs}
      customerInfo={customerInfo}
      onCustomerInfoChange={handleCustomerInfoChange}
      callingNumber={callingNumber}
      onQuote={handleQuote}
      onVideo={handleVideo}
      onVisit={handleVisit}
      callDuration={callDuration}
    />
  );
}

export default LiveCallHUD;
