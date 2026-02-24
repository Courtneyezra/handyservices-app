/**
 * LiveCallHUD - Wrapper that connects CallHUD to LiveCallContext
 *
 * Auto-populates customer info from voice entity extraction.
 * VA can still override/edit all fields.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { useLiveCall } from '@/contexts/LiveCallContext';
import { CallHUD, CustomerInfo, DetectedJobHUD } from './CallHUD';
import type { CallScriptSegment } from '@shared/schema';

type HUDSegment = Exclude<CallScriptSegment, 'EMERGENCY'>;

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
  } = useLiveCall();

  // Local state for customer info that VA can edit
  const [customerInfo, setCustomerInfo] = useState<CustomerInfo>({
    name: '',
    whatsappSameAsCalling: null,
    whatsappNumber: '',
    address: '',
  });

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

  // Convert detected jobs to HUD format
  const hudJobs: DetectedJobHUD[] = detectedJobs.map(job => ({
    id: job.id,
    description: job.description,
    matched: job.matched,
    pricePence: job.sku?.pricePence,
  }));

  // Get calling number from metadata
  const callingNumber = liveCallData?.metadata?.phoneNumber || undefined;

  // Calculate call duration (would need to track start time for real implementation)
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
    }
  }, [liveCallData]);

  // Default action handlers
  const handleQuote = useCallback(() => {
    console.log('[LiveCallHUD] Quote action triggered', { customerInfo });
    onQuote?.();
  }, [customerInfo, onQuote]);

  const handleVideo = useCallback(() => {
    console.log('[LiveCallHUD] Video action triggered', { customerInfo });
    onVideo?.();
  }, [customerInfo, onVideo]);

  const handleVisit = useCallback(() => {
    console.log('[LiveCallHUD] Visit action triggered', { customerInfo });
    onVisit?.();
  }, [customerInfo, onVisit]);

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
