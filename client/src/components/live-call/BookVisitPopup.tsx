/**
 * BookVisitPopup - Calendar popup for booking diagnostic visits
 *
 * Opens when VA clicks BOOK VISIT. Allows selection of:
 * - Date from next 14 days
 * - AM/PM time slot
 * - Shows deposit amount (£25)
 *
 * Creates booking and opens WhatsApp with payment link.
 */

import React, { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '@/lib/utils';
import {
  X,
  User,
  Calendar,
  Clock,
  MapPin,
  Send,
  Loader2,
  Check,
  AlertCircle,
  ExternalLink,
  Sun,
  Sunset,
  ChevronLeft,
  ChevronRight,
  Copy,
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { openWhatsApp, getWhatsAppErrorMessage, copyWhatsAppFallback } from '@/lib/whatsapp-helper';
import type { DetectedJob } from './JobsDetectedPanel';

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════

export interface BookVisitPopupProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;

  // Pre-filled data from live call
  customerName: string;
  whatsappNumber: string;
  address: string;
  jobs: DetectedJob[];
  callSid?: string;
}

interface AvailabilitySlot {
  id: string;
  date: string; // YYYY-MM-DD
  startTime: string;
  endTime: string;
  slotType: 'morning' | 'afternoon' | 'full_day';
  isBooked: boolean;
}

type TimeSlot = 'am' | 'pm';

// ═══════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════

// Generate next 14 days for date selection
function getNext14Days(): Date[] {
  const days: Date[] = [];
  const today = new Date();
  // Start from tomorrow
  for (let i = 1; i <= 14; i++) {
    const date = new Date(today);
    date.setDate(today.getDate() + i);
    days.push(date);
  }
  return days;
}

// Format date for display
function formatDateShort(date: Date): string {
  return date.toLocaleDateString('en-GB', {
    weekday: 'short',
    day: 'numeric',
  });
}

function formatDateFull(date: Date): string {
  return date.toLocaleDateString('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });
}

function formatDateISO(date: Date): string {
  return date.toISOString().split('T')[0];
}

// Get day name
function getDayName(date: Date): string {
  return date.toLocaleDateString('en-GB', { weekday: 'short' });
}

// Get day number
function getDayNumber(date: Date): number {
  return date.getDate();
}

// Check if date is weekend
function isWeekend(date: Date): boolean {
  const day = date.getDay();
  return day === 0 || day === 6;
}

// ═══════════════════════════════════════════════════════════════════════════
// COMPONENT
// ═══════════════════════════════════════════════════════════════════════════

export function BookVisitPopup({
  isOpen,
  onClose,
  onSuccess,
  customerName,
  whatsappNumber,
  address,
  jobs,
  callSid,
}: BookVisitPopupProps) {
  const { toast } = useToast();

  // State
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [selectedSlot, setSelectedSlot] = useState<TimeSlot | null>(null);
  const [availableSlots, setAvailableSlots] = useState<AvailabilitySlot[]>([]);
  const [isLoadingSlots, setIsLoadingSlots] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [calendarOffset, setCalendarOffset] = useState(0); // For scrolling through dates

  // WhatsApp fallback state (shown when popup blocked)
  const [whatsAppFallback, setWhatsAppFallback] = useState<{
    phone: string;
    message: string;
  } | null>(null);

  // Constants
  const DEPOSIT_AMOUNT_PENCE = 2500; // £25
  const DEPOSIT_FORMATTED = '£25';

  // Get next 14 days
  const allDays = useMemo(() => getNext14Days(), []);

  // Show 7 days at a time
  const visibleDays = useMemo(() => {
    return allDays.slice(calendarOffset, calendarOffset + 7);
  }, [allDays, calendarOffset]);

  // Reset state when popup opens
  useEffect(() => {
    if (isOpen) {
      setSelectedDate(null);
      setSelectedSlot(null);
      setError(null);
      setCalendarOffset(0);
      setWhatsAppFallback(null);
      fetchAvailability();
    }
  }, [isOpen]);

  // Fetch availability from API
  const fetchAvailability = async () => {
    setIsLoadingSlots(true);
    try {
      const startDate = formatDateISO(allDays[0]);
      const endDate = formatDateISO(allDays[allDays.length - 1]);

      const response = await fetch(
        `/api/availability?startDate=${startDate}&endDate=${endDate}`
      );

      if (response.ok) {
        const slots = await response.json();
        setAvailableSlots(slots);
      }
    } catch (err) {
      console.error('[BookVisitPopup] Failed to fetch availability:', err);
      // Continue without availability data - all slots shown as available
    } finally {
      setIsLoadingSlots(false);
    }
  };

  // Check if a specific date/slot combo is available
  const isSlotAvailable = (date: Date, slot: TimeSlot): boolean => {
    const dateStr = formatDateISO(date);

    // Find matching availability slot
    const matchingSlot = availableSlots.find(s => {
      if (s.date !== dateStr) return false;
      if (s.isBooked) return false;

      // Match slot type
      if (slot === 'am' && (s.slotType === 'morning' || s.slotType === 'full_day')) {
        return true;
      }
      if (slot === 'pm' && (s.slotType === 'afternoon' || s.slotType === 'full_day')) {
        return true;
      }
      return false;
    });

    // If no availability data, assume available (but may show as limited)
    if (availableSlots.length === 0) return true;

    return !!matchingSlot;
  };

  // Get slot ID for booking
  const getSlotId = (date: Date, slot: TimeSlot): string | undefined => {
    const dateStr = formatDateISO(date);

    const matchingSlot = availableSlots.find(s => {
      if (s.date !== dateStr || s.isBooked) return false;
      if (slot === 'am' && (s.slotType === 'morning' || s.slotType === 'full_day')) {
        return true;
      }
      if (slot === 'pm' && (s.slotType === 'afternoon' || s.slotType === 'full_day')) {
        return true;
      }
      return false;
    });

    return matchingSlot?.id;
  };

  // Validate form
  const isValid = useMemo(() => {
    return selectedDate !== null && selectedSlot !== null;
  }, [selectedDate, selectedSlot]);

  // Handle date selection
  const handleDateSelect = (date: Date) => {
    setSelectedDate(date);
    setSelectedSlot(null); // Reset slot when date changes
    setError(null);
  };

  // Handle slot selection
  const handleSlotSelect = (slot: TimeSlot) => {
    if (selectedDate && isSlotAvailable(selectedDate, slot)) {
      setSelectedSlot(slot);
      setError(null);
    }
  };

  // Navigate calendar
  const canGoBack = calendarOffset > 0;
  const canGoForward = calendarOffset + 7 < allDays.length;

  // Submit booking
  const handleSubmit = async () => {
    if (!isValid || isSubmitting || !selectedDate) return;

    setIsSubmitting(true);
    setError(null);

    try {
      const slotId = selectedSlot ? getSlotId(selectedDate, selectedSlot) : undefined;

      const response = await fetch('/api/live-call/book-visit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customerInfo: {
            name: customerName,
            phone: whatsappNumber,
            address: address || undefined,
          },
          slotId,
          slotDate: formatDateISO(selectedDate),
          slotTime: selectedSlot,
          jobs: jobs.map(job => ({
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
          callSid,
          depositAmountPence: DEPOSIT_AMOUNT_PENCE,
        }),
      });

      const result = await response.json();

      if (!response.ok || !result.success) {
        throw new Error(result.error || 'Failed to book visit');
      }

      // Open WhatsApp with pre-filled message (with error handling)
      const { phone: resultPhone, whatsappMessage } = result;
      if (resultPhone && whatsappMessage) {
        const whatsAppResult = await openWhatsApp(resultPhone, whatsappMessage);

        if (!whatsAppResult.success) {
          // WhatsApp failed to open - show fallback UI in popup
          const errorMsg = getWhatsAppErrorMessage(whatsAppResult);

          if (whatsAppResult.fallbackUsed) {
            // Message was copied to clipboard
            toast({
              title: errorMsg.title,
              description: errorMsg.description,
            });
            // Still close and mark as success - booking was created
            onSuccess();
            onClose();
          } else {
            // Couldn't copy either - show fallback in popup
            setWhatsAppFallback({
              phone: whatsAppResult.phone,
              message: whatsappMessage,
            });
            // Don't close - let user copy manually
            return;
          }
        } else {
          // Success callback
          onSuccess();
          onClose();
        }
      } else {
        // No WhatsApp message returned - still success but show warning
        onSuccess();
        onClose();
      }
    } catch (err: any) {
      console.error('[BookVisitPopup] Error:', err);
      setError(err.message || 'Failed to book visit');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen) return null;

  const firstName = customerName.split(' ')[0] || 'Customer';

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
        onClick={onClose}
      >
        <motion.div
          initial={{ scale: 0.95, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.95, opacity: 0 }}
          onClick={(e) => e.stopPropagation()}
          className="w-full max-w-md max-h-[90vh] overflow-y-auto bg-slate-900 rounded-2xl border border-slate-700 shadow-2xl"
        >
          {/* Header */}
          <div className="flex items-center justify-between px-5 py-4 border-b border-slate-700">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-blue-500/20 flex items-center justify-center">
                <Calendar className="w-5 h-5 text-blue-400" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-white">Book Visit</h2>
                <p className="text-sm text-slate-400">{firstName}</p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Content */}
          <div className="p-5 space-y-5">
            {/* Customer Summary */}
            <div className="flex items-start gap-3 p-3 bg-slate-800/50 rounded-xl">
              <User className="w-4 h-4 text-slate-500 mt-0.5" />
              <div className="flex-1 min-w-0">
                <p className="text-sm text-white font-medium truncate">{customerName}</p>
                {address && (
                  <p className="text-xs text-slate-400 mt-0.5 flex items-center gap-1">
                    <MapPin className="w-3 h-3" />
                    <span className="truncate">{address}</span>
                  </p>
                )}
              </div>
            </div>

            {/* Date Selection */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-medium text-slate-400 uppercase tracking-wider">
                  Select Date
                </h3>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => setCalendarOffset(Math.max(0, calendarOffset - 7))}
                    disabled={!canGoBack}
                    className={cn(
                      "p-1 rounded transition-colors",
                      canGoBack
                        ? "hover:bg-slate-800 text-slate-400 hover:text-white"
                        : "text-slate-600 cursor-not-allowed"
                    )}
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => setCalendarOffset(Math.min(allDays.length - 7, calendarOffset + 7))}
                    disabled={!canGoForward}
                    className={cn(
                      "p-1 rounded transition-colors",
                      canGoForward
                        ? "hover:bg-slate-800 text-slate-400 hover:text-white"
                        : "text-slate-600 cursor-not-allowed"
                    )}
                  >
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {isLoadingSlots ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="w-6 h-6 animate-spin text-slate-500" />
                </div>
              ) : (
                <div className="grid grid-cols-7 gap-1.5">
                  {visibleDays.map((date) => {
                    const dateStr = formatDateISO(date);
                    const isSelected = selectedDate && formatDateISO(selectedDate) === dateStr;
                    const weekend = isWeekend(date);

                    return (
                      <button
                        key={dateStr}
                        onClick={() => handleDateSelect(date)}
                        className={cn(
                          "flex flex-col items-center py-2 px-1 rounded-lg transition-all",
                          isSelected
                            ? "bg-blue-500 text-white"
                            : weekend
                              ? "bg-slate-800/50 text-slate-500 hover:bg-slate-800 hover:text-slate-300"
                              : "bg-slate-800 text-slate-300 hover:bg-slate-700"
                        )}
                      >
                        <span className="text-[10px] uppercase font-medium opacity-70">
                          {getDayName(date)}
                        </span>
                        <span className="text-lg font-semibold">
                          {getDayNumber(date)}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Time Slot Selection */}
            {selectedDate && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="space-y-3"
              >
                <h3 className="text-sm font-medium text-slate-400 uppercase tracking-wider">
                  Select Time
                </h3>
                <div className="grid grid-cols-2 gap-3">
                  {/* Morning Slot */}
                  <button
                    onClick={() => handleSlotSelect('am')}
                    disabled={!isSlotAvailable(selectedDate, 'am')}
                    className={cn(
                      "flex flex-col items-center p-4 rounded-xl border-2 transition-all",
                      selectedSlot === 'am'
                        ? "bg-blue-500/20 border-blue-500 text-white"
                        : isSlotAvailable(selectedDate, 'am')
                          ? "bg-slate-800 border-slate-700 text-slate-300 hover:border-slate-600"
                          : "bg-slate-800/50 border-slate-800 text-slate-600 cursor-not-allowed"
                    )}
                  >
                    <Sun className={cn(
                      "w-6 h-6 mb-2",
                      selectedSlot === 'am' ? "text-yellow-400" : "text-yellow-500/50"
                    )} />
                    <span className="font-semibold">Morning</span>
                    <span className="text-xs text-slate-400 mt-0.5">9am - 12pm</span>
                  </button>

                  {/* Afternoon Slot */}
                  <button
                    onClick={() => handleSlotSelect('pm')}
                    disabled={!isSlotAvailable(selectedDate, 'pm')}
                    className={cn(
                      "flex flex-col items-center p-4 rounded-xl border-2 transition-all",
                      selectedSlot === 'pm'
                        ? "bg-blue-500/20 border-blue-500 text-white"
                        : isSlotAvailable(selectedDate, 'pm')
                          ? "bg-slate-800 border-slate-700 text-slate-300 hover:border-slate-600"
                          : "bg-slate-800/50 border-slate-800 text-slate-600 cursor-not-allowed"
                    )}
                  >
                    <Sunset className={cn(
                      "w-6 h-6 mb-2",
                      selectedSlot === 'pm' ? "text-orange-400" : "text-orange-500/50"
                    )} />
                    <span className="font-semibold">Afternoon</span>
                    <span className="text-xs text-slate-400 mt-0.5">1pm - 5pm</span>
                  </button>
                </div>
              </motion.div>
            )}

            {/* Booking Summary */}
            {selectedDate && selectedSlot && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="p-4 bg-slate-800 rounded-xl space-y-3"
              >
                <div className="flex items-center gap-2 text-sm">
                  <Calendar className="w-4 h-4 text-slate-400" />
                  <span className="text-white">{formatDateFull(selectedDate)}</span>
                </div>
                <div className="flex items-center gap-2 text-sm">
                  <Clock className="w-4 h-4 text-slate-400" />
                  <span className="text-white">
                    {selectedSlot === 'am' ? 'Morning (9am - 12pm)' : 'Afternoon (1pm - 5pm)'}
                  </span>
                </div>

                <div className="pt-3 border-t border-slate-700">
                  <div className="flex justify-between items-center">
                    <span className="text-slate-400">Diagnostic deposit</span>
                    <span className="text-xl font-bold text-green-400">{DEPOSIT_FORMATTED}</span>
                  </div>
                  <p className="text-xs text-slate-500 mt-1">
                    Deducted from final bill if work proceeds
                  </p>
                </div>
              </motion.div>
            )}

            {/* Error Message */}
            {error && (
              <div className="flex items-center gap-2 p-3 bg-red-500/10 border border-red-500/30 rounded-lg">
                <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0" />
                <p className="text-sm text-red-400">{error}</p>
              </div>
            )}

            {/* WhatsApp Fallback UI */}
            {whatsAppFallback && (
              <div className="p-4 bg-amber-500/10 border border-amber-500/30 rounded-xl space-y-3">
                <div className="flex items-start gap-2">
                  <AlertCircle className="w-5 h-5 text-amber-400 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm font-medium text-amber-400">WhatsApp popup blocked</p>
                    <p className="text-xs text-amber-400/80 mt-1">
                      Visit booked successfully. Please send manually:
                    </p>
                  </div>
                </div>

                <div className="bg-slate-800 rounded-lg p-3">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs text-slate-400">Phone:</span>
                    <span className="text-sm text-white font-mono">{whatsAppFallback.phone}</span>
                  </div>
                  <div className="text-xs text-slate-400 mb-1">Message:</div>
                  <p className="text-sm text-white whitespace-pre-wrap bg-slate-700/50 rounded p-2 max-h-24 overflow-y-auto">
                    {whatsAppFallback.message}
                  </p>
                </div>

                <button
                  onClick={async () => {
                    const copied = await copyWhatsAppFallback(whatsAppFallback.phone, whatsAppFallback.message);
                    if (copied) {
                      toast({
                        title: 'Copied to clipboard!',
                        description: `Send message to ${whatsAppFallback.phone}`,
                      });
                      onSuccess();
                      onClose();
                    } else {
                      toast({
                        title: 'Failed to copy',
                        description: 'Please copy manually',
                        variant: 'destructive',
                      });
                    }
                  }}
                  className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-amber-500 hover:bg-amber-600 text-white rounded-xl font-semibold transition-colors"
                >
                  <Copy className="w-5 h-5" />
                  Copy Message & Close
                </button>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="px-5 py-4 border-t border-slate-700 flex gap-3">
            <button
              onClick={onClose}
              className="flex-1 px-4 py-3 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl font-medium transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleSubmit}
              disabled={!isValid || isSubmitting}
              className={cn(
                "flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-xl font-semibold transition-all",
                isValid && !isSubmitting
                  ? "bg-blue-500 hover:bg-blue-600 text-white"
                  : "bg-slate-700 text-slate-500 cursor-not-allowed"
              )}
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  Booking...
                </>
              ) : (
                <>
                  <Send className="w-5 h-5" />
                  Confirm & Send
                  <ExternalLink className="w-4 h-4" />
                </>
              )}
            </button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}

export default BookVisitPopup;
