/**
 * QuoteSendPopup - Scaled-down quote generator for live calls
 *
 * Opens when VA clicks SEND QUOTE. Pre-filled with:
 * - Customer info from call
 * - Matched SKUs as line items
 *
 * VA can edit everything before sending.
 * Creates quote in DB and opens WhatsApp with quote link.
 */

import React, { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '@/lib/utils';
import {
  X,
  User,
  Phone,
  MapPinned,
  Send,
  Loader2,
  Plus,
  Minus,
  Trash2,
  Percent,
  Check,
  AlertCircle,
  ExternalLink,
  Copy,
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { openWhatsApp, getWhatsAppErrorMessage, copyWhatsAppFallback } from '@/lib/whatsapp-helper';
import type { DetectedJob } from './JobsDetectedPanel';
import type { CallScriptSegment } from '@shared/schema';

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════

export interface QuoteSendPopupProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;

  // Pre-filled data from live call
  customerName: string;
  whatsappNumber: string;
  address: string;
  segment: CallScriptSegment | null;
  jobs: DetectedJob[];
  callSid?: string;
}

interface LineItem {
  id: string;
  description: string;
  skuId?: string;
  skuCode?: string;
  pricePence: number;
  quantity: number;
}

type HUDSegment = Exclude<CallScriptSegment, 'EMERGENCY'>;

// Segment options for dropdown
const SEGMENT_OPTIONS: { value: HUDSegment; label: string }[] = [
  { value: 'LANDLORD', label: 'Landlord' },
  { value: 'PROP_MGR', label: 'Property Manager' },
  { value: 'BUSY_PRO', label: 'Busy Professional' },
  { value: 'SMALL_BIZ', label: 'Small Business' },
  { value: 'OAP', label: 'Trust Seeker / OAP' },
  { value: 'BUDGET', label: 'Budget Conscious' },
];

// Preset discount options
const DISCOUNT_PRESETS: { id: string; label: string; percent: number; color: string }[] = [
  { id: 'first_time', label: 'First Time', percent: 10, color: '#22C55E' },
  { id: 'bundle', label: 'Multi-Job Bundle', percent: 15, color: '#3B82F6' },
  { id: 'returning', label: 'Returning Customer', percent: 5, color: '#8B5CF6' },
  { id: 'referral', label: 'Referral', percent: 10, color: '#F59E0B' },
  { id: 'oap', label: 'OAP / Vulnerable', percent: 10, color: '#EC4899' },
];

// ═══════════════════════════════════════════════════════════════════════════
// COMPONENT
// ═══════════════════════════════════════════════════════════════════════════

export function QuoteSendPopup({
  isOpen,
  onClose,
  onSuccess,
  customerName: initialName,
  whatsappNumber: initialPhone,
  address: initialAddress,
  segment: initialSegment,
  jobs,
  callSid,
}: QuoteSendPopupProps) {
  const { toast } = useToast();

  // Form state
  const [name, setName] = useState(initialName);
  const [phone, setPhone] = useState(initialPhone);
  const [address, setAddress] = useState(initialAddress);
  const [segment, setSegment] = useState<HUDSegment | null>(
    initialSegment && initialSegment !== 'EMERGENCY' ? initialSegment as HUDSegment : null
  );

  // Line items state (only matched jobs)
  const [lineItems, setLineItems] = useState<LineItem[]>([]);

  // Discount state
  const [discountPercent, setDiscountPercent] = useState<number>(0);
  const [discountReason, setDiscountReason] = useState<string | null>(null);

  // Submit state
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // WhatsApp fallback state (shown when popup blocked)
  const [whatsAppFallback, setWhatsAppFallback] = useState<{
    phone: string;
    message: string;
  } | null>(null);

  // Reset form when popup opens with new data
  useEffect(() => {
    if (isOpen) {
      setName(initialName);
      setPhone(initialPhone);
      setAddress(initialAddress);
      setSegment(initialSegment && initialSegment !== 'EMERGENCY' ? initialSegment as HUDSegment : null);

      // Convert matched jobs to line items
      const matched = jobs.filter(j => j.matched && j.sku);
      setLineItems(matched.map(job => ({
        id: job.id,
        description: job.sku?.name || job.description,
        skuId: job.sku?.id,
        pricePence: job.sku?.pricePence || 0,
        quantity: job.quantity || 1,
      })));

      setDiscountPercent(0);
      setDiscountReason(null);
      setError(null);
      setWhatsAppFallback(null);
    }
  }, [isOpen, initialName, initialPhone, initialAddress, initialSegment, jobs]);

  // Calculate totals
  const subtotal = useMemo(() => {
    return lineItems.reduce((sum, item) => sum + (item.pricePence * item.quantity), 0);
  }, [lineItems]);

  const discountAmount = useMemo(() => {
    return Math.round(subtotal * (discountPercent / 100));
  }, [subtotal, discountPercent]);

  const total = subtotal - discountAmount;

  // Format price
  const formatPrice = (pence: number) => `£${(pence / 100).toFixed(0)}`;

  // Update line item quantity
  const updateQuantity = (id: string, delta: number) => {
    setLineItems(items =>
      items.map(item =>
        item.id === id
          ? { ...item, quantity: Math.max(1, item.quantity + delta) }
          : item
      )
    );
  };

  // Update line item price
  const updatePrice = (id: string, pricePence: number) => {
    setLineItems(items =>
      items.map(item =>
        item.id === id ? { ...item, pricePence } : item
      )
    );
  };

  // Remove line item
  const removeItem = (id: string) => {
    setLineItems(items => items.filter(item => item.id !== id));
  };

  // Validate form
  const isValid = useMemo(() => {
    return (
      name.trim().length > 0 &&
      phone.trim().length > 0 &&
      lineItems.length > 0 &&
      total > 0
    );
  }, [name, phone, lineItems, total]);

  // Submit handler
  const handleSubmit = async () => {
    if (!isValid || isSubmitting) return;

    setIsSubmitting(true);
    setError(null);

    try {
      // Create quote via API
      const response = await fetch('/api/live-call/create-quote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customerName: name.trim(),
          phone: phone.trim(),
          address: address.trim(),
          segment: segment || 'BUSY_PRO',
          lineItems: lineItems.map(item => ({
            skuId: item.skuId,
            description: item.description,
            pricePence: item.pricePence,
            quantity: item.quantity,
          })),
          discountPercent,
          discountReason: discountReason || undefined,
          subtotalPence: subtotal,
          discountPence: discountAmount,
          totalPence: total,
          callSid,
          expiresInDays: 7,
        }),
      });

      const result = await response.json();

      if (!response.ok || !result.success) {
        throw new Error(result.error || 'Failed to create quote');
      }

      // Build WhatsApp message - Madhavan framework: Price range + Value framing + Segment-specific
      const quoteUrl = result.quoteUrl;
      const firstName = name.split(' ')[0];

      // Price RANGE (not exact) - creates curiosity, gets the click
      // Low = base total, High = base + typical add-ons (~£35 rounded up to nearest £5)
      const basePounds = Math.round(total / 100);
      const addOnBuffer = 35; // Typical add-on value
      const highPounds = Math.ceil((basePounds + addOnBuffer) / 5) * 5; // Round up to nearest £5

      // Show range for larger jobs, "from" for smaller
      const priceStr = basePounds >= 75
        ? `£${basePounds} - £${highPounds}`
        : `from £${basePounds}`;

      // Get job description for personalization
      const jobCount = lineItems.length;
      const jobDesc = jobCount === 1
        ? lineItems[0].description.toLowerCase()
        : `${jobCount} jobs`;

      // Segment-specific value lines (Madhavan: "what are they really buying?")
      const valueLines: Record<string, string> = {
        LANDLORD: `We coordinate with your tenant & send photos when done.`,
        PROP_MGR: `Photo report included. Invoice ready for your records.`,
        BUSY_PRO: `We handle everything. You get your weekend back.`,
        SMALL_BIZ: `Minimal disruption. In and out, job done.`,
        OAP: `Our tradesman will explain everything before starting.`,
        BUDGET: `Fair fixed price. Tap to see full breakdown.`,
      };

      const valueLine = segment ? (valueLines[segment] || valueLines.BUSY_PRO) : '';

      // Build message: Job + Price Range + Value + Trust + CTA
      const whatsappMessage = [
        `Hi ${firstName}!`,
        ``,
        `Your ${jobDesc}: *${priceStr}*`,
        valueLine,
        ``,
        `4.9* rated | £2M insured`,
        ``,
        `Tap to see your quote:`,
        quoteUrl,
      ].filter(line => line !== undefined).join('\n');

      // Open WhatsApp with error handling
      const whatsAppResult = await openWhatsApp(phone, whatsappMessage);

      if (!whatsAppResult.success) {
        // WhatsApp failed to open - show fallback UI in popup
        const errorMsg = getWhatsAppErrorMessage(whatsAppResult);

        if (whatsAppResult.fallbackUsed) {
          // Message was copied to clipboard
          toast({
            title: errorMsg.title,
            description: errorMsg.description,
          });
          // Still close and mark as success - quote was created
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
    } catch (err: any) {
      console.error('[QuoteSendPopup] Error:', err);
      setError(err.message || 'Failed to send quote');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen) return null;

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
          className="w-full max-w-lg max-h-[90vh] overflow-y-auto bg-slate-900 rounded-2xl border border-slate-700 shadow-2xl"
        >
          {/* Header */}
          <div className="flex items-center justify-between px-5 py-4 border-b border-slate-700">
            <h2 className="text-lg font-semibold text-white">Send Quote</h2>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Content */}
          <div className="p-5 space-y-5">
            {/* Customer Info Section */}
            <div className="space-y-3">
              <h3 className="text-sm font-medium text-slate-400 uppercase tracking-wider">Customer</h3>

              {/* Name */}
              <div className="relative">
                <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Customer name..."
                  className={cn(
                    "w-full pl-10 pr-4 py-2.5 bg-slate-800 border rounded-lg text-white placeholder:text-slate-500",
                    "focus:outline-none focus:ring-2 focus:ring-green-500/50",
                    name.trim() ? "border-green-500/50" : "border-slate-600"
                  )}
                />
              </div>

              {/* Phone */}
              <div className="relative">
                <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                <input
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="WhatsApp number..."
                  className={cn(
                    "w-full pl-10 pr-4 py-2.5 bg-slate-800 border rounded-lg text-white placeholder:text-slate-500",
                    "focus:outline-none focus:ring-2 focus:ring-green-500/50",
                    phone.trim() ? "border-green-500/50" : "border-slate-600"
                  )}
                />
              </div>

              {/* Address */}
              <div className="relative">
                <MapPinned className="absolute left-3 top-3 w-4 h-4 text-slate-500" />
                <textarea
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  placeholder="Property address..."
                  rows={2}
                  className="w-full pl-10 pr-4 py-2.5 bg-slate-800 border border-slate-600 rounded-lg text-white placeholder:text-slate-500 resize-none focus:outline-none focus:ring-2 focus:ring-green-500/50"
                />
              </div>

              {/* Segment */}
              <select
                value={segment || ''}
                onChange={(e) => setSegment(e.target.value as HUDSegment || null)}
                className="w-full px-4 py-2.5 bg-slate-800 border border-slate-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-green-500/50"
              >
                <option value="">Select segment...</option>
                {SEGMENT_OPTIONS.map(opt => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>

            {/* Line Items Section */}
            <div className="space-y-3">
              <h3 className="text-sm font-medium text-slate-400 uppercase tracking-wider">Line Items</h3>

              {lineItems.length === 0 ? (
                <p className="text-slate-500 text-sm py-4 text-center">No items - add SKUs from detection first</p>
              ) : (
                <div className="space-y-2">
                  {lineItems.map((item) => (
                    <div
                      key={item.id}
                      className="flex items-center gap-3 p-3 bg-slate-800 rounded-lg"
                    >
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-white truncate">{item.description}</p>
                      </div>

                      {/* Quantity controls */}
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => updateQuantity(item.id, -1)}
                          className="p-1 rounded bg-slate-700 hover:bg-slate-600 text-slate-300"
                        >
                          <Minus className="w-3 h-3" />
                        </button>
                        <span className="w-6 text-center text-sm text-white">{item.quantity}</span>
                        <button
                          onClick={() => updateQuantity(item.id, 1)}
                          className="p-1 rounded bg-slate-700 hover:bg-slate-600 text-slate-300"
                        >
                          <Plus className="w-3 h-3" />
                        </button>
                      </div>

                      {/* Price input */}
                      <div className="w-20">
                        <input
                          type="number"
                          value={Math.round(item.pricePence / 100)}
                          onChange={(e) => updatePrice(item.id, parseInt(e.target.value || '0') * 100)}
                          className="w-full px-2 py-1 bg-slate-700 border border-slate-600 rounded text-sm text-white text-right focus:outline-none focus:ring-1 focus:ring-green-500"
                        />
                      </div>

                      {/* Remove */}
                      <button
                        onClick={() => removeItem(item.id)}
                        className="p-1.5 rounded hover:bg-red-500/20 text-slate-400 hover:text-red-400"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Discount Section */}
            <div className="space-y-3">
              <h3 className="text-sm font-medium text-slate-400 uppercase tracking-wider">Discount</h3>

              {/* Preset discount chips */}
              <div className="flex flex-wrap gap-2">
                {DISCOUNT_PRESETS.map((preset) => {
                  const isSelected = discountReason === preset.id;
                  return (
                    <button
                      key={preset.id}
                      onClick={() => {
                        if (isSelected) {
                          // Deselect
                          setDiscountReason(null);
                          setDiscountPercent(0);
                        } else {
                          // Select preset
                          setDiscountReason(preset.id);
                          setDiscountPercent(preset.percent);
                        }
                      }}
                      className={cn(
                        "px-3 py-1.5 rounded-full text-xs font-medium transition-all",
                        isSelected
                          ? "text-white ring-2 ring-offset-1 ring-offset-slate-900"
                          : "bg-slate-700 text-slate-300 hover:bg-slate-600"
                      )}
                      style={isSelected ? { backgroundColor: preset.color, ringColor: preset.color } : {}}
                    >
                      {preset.label} ({preset.percent}%)
                    </button>
                  );
                })}
              </div>

              {/* Custom discount input */}
              <div className="flex items-center gap-3">
                <div className="relative flex-1">
                  <Percent className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                  <input
                    type="number"
                    min="0"
                    max="50"
                    value={discountPercent || ''}
                    onChange={(e) => {
                      const val = Math.min(50, Math.max(0, parseInt(e.target.value) || 0));
                      setDiscountPercent(val);
                      // Clear preset if manually typing a different value
                      const matchingPreset = DISCOUNT_PRESETS.find(p => p.percent === val);
                      if (matchingPreset) {
                        setDiscountReason(matchingPreset.id);
                      } else if (val > 0) {
                        setDiscountReason('custom');
                      } else {
                        setDiscountReason(null);
                      }
                    }}
                    placeholder="Custom %"
                    className="w-full pl-10 pr-4 py-2.5 bg-slate-800 border border-slate-600 rounded-lg text-white placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-green-500/50"
                  />
                </div>
                {discountPercent > 0 && (
                  <span className="text-green-400 text-sm font-medium whitespace-nowrap">
                    -{formatPrice(discountAmount)} off
                  </span>
                )}
              </div>
            </div>

            {/* Total Section */}
            <div className="p-4 bg-slate-800 rounded-xl space-y-2">
              <div className="flex justify-between text-sm text-slate-400">
                <span>Subtotal</span>
                <span>{formatPrice(subtotal)}</span>
              </div>
              {discountPercent > 0 && (
                <div className="flex justify-between text-sm text-green-400">
                  <span>
                    {discountReason && discountReason !== 'custom'
                      ? `${DISCOUNT_PRESETS.find(p => p.id === discountReason)?.label || 'Discount'} (${discountPercent}%)`
                      : `Discount (${discountPercent}%)`
                    }
                  </span>
                  <span>-{formatPrice(discountAmount)}</span>
                </div>
              )}
              <div className="flex justify-between pt-2 border-t border-slate-700">
                <span className="text-lg font-semibold text-white">Total</span>
                <span className="text-2xl font-bold text-green-400">{formatPrice(total)}</span>
              </div>
              <p className="text-xs text-slate-500 text-center pt-1">Valid for 7 days</p>
            </div>

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
                      Quote created successfully. Please send manually:
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
                  ? "bg-green-500 hover:bg-green-600 text-white"
                  : "bg-slate-700 text-slate-500 cursor-not-allowed"
              )}
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  Creating...
                </>
              ) : (
                <>
                  <Send className="w-5 h-5" />
                  Send via WhatsApp
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

export default QuoteSendPopup;
