/**
 * QuotePreviewModal
 *
 * Full-screen dialog showing the customer-facing quote in an iframe.
 * An edit slide-over drawer can be opened to update customer details,
 * pricing line items, and available booking date slots.
 *
 * Entry points: GenerateContextualQuote (after creation) + QuotesPage (Recent Quotes list).
 */

import { useState, useRef, useCallback, useEffect } from 'react';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import {
  X,
  ExternalLink,
  Pencil,
  Loader2,
  Plus,
  Trash2,
  CalendarDays,
  User,
  PoundSterling,
  ChevronRight,
  AlertTriangle,
} from 'lucide-react';
import type { LineItemResult, JobCategory } from '@shared/contextual-pricing-types';
import { JOB_CATEGORIES } from '@shared/contextual-pricing-types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PreviewQuote {
  quoteId: string;
  shortSlug: string;
  customerName: string;
  phone: string;
  email?: string | null;
  address?: string | null;
  postcode?: string | null;
  basePrice?: number | null;          // pence
  pricingLineItems?: LineItemResult[] | null;
  batchDiscountPercent?: number | null;
  availableDates?: string[] | null;   // ["2026-03-30", "2026-04-01"]
}

interface QuotePreviewModalProps {
  quote: PreviewQuote | null;
  open: boolean;
  onClose: () => void;
  onSaved?: () => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function penceToGBP(pence: number) {
  return (pence / 100).toFixed(2);
}

function gbpToPence(gbp: string) {
  return Math.round(parseFloat(gbp) * 100);
}

function formatDateLabel(dateStr: string) {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
}

function nextNDays(n: number): string[] {
  const dates: string[] = [];
  const today = new Date();
  for (let i = 1; i <= n; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() + i);
    if (d.getDay() !== 0) { // skip Sundays
      dates.push(d.toISOString().slice(0, 10));
    }
  }
  return dates;
}

// ---------------------------------------------------------------------------
// Editable line item type (pounds for easier UX)
// ---------------------------------------------------------------------------

interface EditableLineItem {
  lineId: string;
  description: string;
  details: string;         // sub-copy — captured so it survives a save round-trip even if the spread can't find a match
  pricePounds: string;     // labour price — string for controlled input
  materialsPounds: string; // materials with margin — string for controlled input
  category: JobCategory | '';   // REQUIRED for engine to price this line for contractors
  timeMinutes: string;     // estimated minutes — string for controlled input
}

function fromLineItems(items: LineItemResult[]): EditableLineItem[] {
  return items.map(li => ({
    lineId: li.lineId,
    description: li.description,
    details: li.details ?? '',
    pricePounds: penceToGBP(li.guardedPricePence),
    materialsPounds: penceToGBP(li.materialsWithMarginPence || 0),
    category: (li as any).category || '',
    timeMinutes: String((li as any).timeEstimateMinutes || ''),
  }));
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function QuotePreviewModal({ quote: quoteProp, open, onClose, onSaved }: QuotePreviewModalProps) {
  const { toast } = useToast();
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editTab, setEditTab] = useState<'customer' | 'pricing' | 'scheduling'>('customer');

  // Local copy of quote so edits persist across drawer open/close without
  // requiring the parent to re-fetch before the user reopens the drawer.
  const [localQuote, setLocalQuote] = useState<PreviewQuote | null>(null);

  // Re-sync localQuote from the prop whenever the modal opens or the parent
  // pushes a fresh quote. Without this, the modal stays mounted between
  // opens, so a stale `localQuote` from the previous session leaks into the
  // next open of the SAME quote — and saving from there wipes any externally
  // applied line-item `details` (the save spreads from the stale snapshot).
  useEffect(() => {
    if (open && quoteProp) {
      setLocalQuote(quoteProp);
    }
  }, [open, quoteProp]);

  const quote = localQuote && localQuote.quoteId === quoteProp?.quoteId ? localQuote : quoteProp;

  // Customer fields
  const [custName, setCustName] = useState('');
  const [custPhone, setCustPhone] = useState('');
  const [custEmail, setCustEmail] = useState('');
  const [custAddress, setCustAddress] = useState('');
  const [custPostcode, setCustPostcode] = useState('');

  // Pricing fields
  const [lineItems, setLineItems] = useState<EditableLineItem[]>([]);

  // Scheduling fields — selected dates from a pool of upcoming days
  const [selectedDates, setSelectedDates] = useState<string[]>([]);
  const upcomingDates = nextNDays(180); // next 180 days (excl. Sundays)

  // Open drawer and initialise fields from quote
  const openEdit = useCallback(() => {
    if (!quote) return;
    setCustName(quote.customerName);
    setCustPhone(quote.phone);
    setCustEmail(quote.email ?? '');
    setCustAddress(quote.address ?? '');
    setCustPostcode(quote.postcode ?? '');
    setLineItems(quote.pricingLineItems ? fromLineItems(quote.pricingLineItems as LineItemResult[]) : []);
    setSelectedDates(quote.availableDates ?? []);
    setEditOpen(true);
  }, [quote]);

  // Computed totals from line items
  const labourPence = lineItems.reduce((sum, li) => {
    const val = parseFloat(li.pricePounds);
    return sum + (isNaN(val) ? 0 : Math.round(val * 100));
  }, 0);
  const materialsPence = lineItems.reduce((sum, li) => {
    const val = parseFloat(li.materialsPounds);
    return sum + (isNaN(val) ? 0 : Math.round(val * 100));
  }, 0);
  const totalPence = labourPence + materialsPence;

  // Line item helpers
  function updateLineItem(lineId: string, field: 'description' | 'pricePounds' | 'materialsPounds' | 'category' | 'timeMinutes', value: string) {
    setLineItems(prev => prev.map(li => li.lineId === lineId ? { ...li, [field]: value } : li));
  }

  function addLineItem() {
    setLineItems(prev => [
      ...prev,
      {
        lineId: `li_${Date.now()}`,
        description: '',
        details: '',
        pricePounds: '0.00',
        materialsPounds: '0.00',
        category: '',          // REQUIRED — admin must pick before save (validated below)
        timeMinutes: '60',     // sensible default — 1 hour
      },
    ]);
  }

  function removeLineItem(lineId: string) {
    setLineItems(prev => prev.filter(li => li.lineId !== lineId));
  }

  function toggleDate(dateStr: string) {
    setSelectedDates(prev =>
      prev.includes(dateStr) ? prev.filter(d => d !== dateStr) : [...prev, dateStr]
    );
  }

  async function handleSave() {
    if (!quote) return;

    // Validation — every line must have a category + time so the contractor
    // engine can price it. Without this, admin-added lines flow through as
    // 100% platform margin which inflates margins and breaks contractor pay.
    const missing = lineItems.filter((li) => !li.category || !li.timeMinutes || Number(li.timeMinutes) <= 0);
    if (missing.length > 0) {
      const which = missing.map((m, i) => `#${lineItems.indexOf(m) + 1}`).join(", ");
      toast({
        title: "Missing category or time",
        description: `Line ${which} need a category + time estimate before saving.`,
        variant: "destructive",
      });
      return;
    }

    setSaving(true);
    try {
      // Build updated line items (convert back to pence). Spread the original
      // so non-editable fields (referencePricePence, llmSuggestedPricePence,
      // adjustmentFactors, materialsCostPence) survive. `details` is then set
      // explicitly from captured state so it round-trips even when the spread
      // can't find a match (e.g. the original snapshot is stale or this is a
      // newly added line).
      const updatedLineItems = lineItems.map(li => ({
        ...(quote.pricingLineItems?.find((orig: any) => orig.lineId === li.lineId) ?? {}),
        lineId: li.lineId,
        description: li.description,
        details: li.details && li.details.trim().length > 0 ? li.details : null,
        guardedPricePence: gbpToPence(li.pricePounds),
        materialsWithMarginPence: gbpToPence(li.materialsPounds),
        category: li.category,
        timeEstimateMinutes: Number(li.timeMinutes) || 60,
      }));

      const body: Record<string, unknown> = {
        customerName: custName.trim(),
        phone: custPhone.trim(),
        email: custEmail.trim() || null,
        address: custAddress.trim() || null,
        postcode: custPostcode.trim() || null,
      };

      // Always send line items & price so deletions/edits are persisted
      body.pricingLineItems = updatedLineItems;
      body.basePrice = totalPence;

      // availableDates: send null to clear, or array of selected dates
      body.availableDates = selectedDates.length > 0 ? selectedDates : null;

      const res = await fetch(`/api/pricing/quotes/${quote.quoteId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!res.ok) throw new Error('Save failed');

      // Update local quote so re-opening the drawer shows the saved values
      setLocalQuote(prev => prev ? {
        ...prev,
        customerName: custName.trim(),
        phone: custPhone.trim(),
        email: custEmail.trim() || null,
        address: custAddress.trim() || null,
        postcode: custPostcode.trim() || null,
        basePrice: totalPence,
        pricingLineItems: updatedLineItems as LineItemResult[],
        availableDates: selectedDates.length > 0 ? selectedDates : null,
      } : prev);

      toast({ title: 'Quote updated', description: 'Changes saved and live.' });
      setEditOpen(false);
      // Reload iframe so customer sees updated quote
      if (iframeRef.current) {
        iframeRef.current.src = iframeRef.current.src;
      }
      onSaved?.();
    } catch {
      toast({ title: 'Save failed', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  }

  if (!quote) return null;

  const quoteUrl = `/q/${quote.shortSlug}`;

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) { setEditOpen(false); onClose(); } }}>
      <DialogContent className="max-w-none w-[95vw] h-[90vh] p-0 flex flex-col bg-slate-950 border-slate-700/50 overflow-hidden">
        {/* ── Header bar ── */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-slate-700/50 shrink-0">
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-white truncate">{quote.customerName}</p>
            <p className="text-xs text-slate-400 font-mono truncate">/q/{quote.shortSlug}</p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={editOpen ? () => setEditOpen(false) : openEdit}
            className={editOpen
              ? 'border-slate-600 text-slate-300 hover:bg-slate-800'
              : 'border-[#7DB00E]/40 text-[#7DB00E] hover:bg-[#7DB00E]/10'}
          >
            {editOpen ? (
              <><ChevronRight className="w-3.5 h-3.5 mr-1.5 rotate-180" />Close Edit</>
            ) : (
              <><Pencil className="w-3.5 h-3.5 mr-1.5" />Edit</>
            )}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="text-slate-400 hover:text-white"
            onClick={() => window.open(quoteUrl, '_blank')}
          >
            <ExternalLink className="w-4 h-4" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="text-slate-400 hover:text-white"
            onClick={() => { setEditOpen(false); onClose(); }}
          >
            <X className="w-4 h-4" />
          </Button>
        </div>

        {/* ── Body: iframe + slide-over ── */}
        <div className="flex-1 relative overflow-hidden flex">
          {/* iframe */}
          <iframe
            ref={iframeRef}
            src={quoteUrl}
            className="flex-1 h-full border-0"
            title={`Quote for ${quote.customerName}`}
          />

          {/* Slide-over edit drawer — full-screen on mobile, side panel on md+ */}
          {editOpen && (
            <div className="absolute inset-0 md:relative md:inset-auto md:w-[380px] md:shrink-0 border-l border-slate-700/50 bg-slate-900 flex flex-col overflow-hidden z-10">
              {/* Drawer header */}
              <div className="px-4 py-3 border-b border-slate-700/50 shrink-0">
                <p className="text-sm font-semibold text-white">Edit Quote</p>
                <p className="text-xs text-slate-400 mt-0.5">Changes go live immediately on save</p>
              </div>

              {/* Drawer tabs */}
              <Tabs value={editTab} onValueChange={(v) => setEditTab(v as typeof editTab)} className="flex flex-col flex-1 overflow-hidden">
                <TabsList className="mx-4 mt-3 shrink-0 bg-slate-800">
                  <TabsTrigger value="customer" className="flex-1 text-xs gap-1.5">
                    <User className="w-3 h-3" />Customer
                  </TabsTrigger>
                  <TabsTrigger value="pricing" className="flex-1 text-xs gap-1.5">
                    <PoundSterling className="w-3 h-3" />Pricing
                  </TabsTrigger>
                  <TabsTrigger value="scheduling" className="flex-1 text-xs gap-1.5">
                    <CalendarDays className="w-3 h-3" />Dates
                  </TabsTrigger>
                </TabsList>

                {/* Scrollable content */}
                <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">

                  {/* ── Customer tab ── */}
                  <TabsContent value="customer" className="mt-0 space-y-3">
                    <div>
                      <Label className="text-xs text-slate-400 mb-1">Name</Label>
                      <Input
                        value={custName}
                        onChange={e => setCustName(e.target.value)}
                        className="bg-slate-800 border-slate-700 text-white text-sm h-9"
                      />
                    </div>
                    <div>
                      <Label className="text-xs text-slate-400 mb-1">Phone</Label>
                      <Input
                        value={custPhone}
                        onChange={e => setCustPhone(e.target.value)}
                        className="bg-slate-800 border-slate-700 text-white text-sm h-9"
                      />
                    </div>
                    <div>
                      <Label className="text-xs text-slate-400 mb-1">Email</Label>
                      <Input
                        value={custEmail}
                        onChange={e => setCustEmail(e.target.value)}
                        placeholder="optional"
                        className="bg-slate-800 border-slate-700 text-white text-sm h-9"
                      />
                    </div>
                    <div>
                      <Label className="text-xs text-slate-400 mb-1">Address</Label>
                      <Input
                        value={custAddress}
                        onChange={e => setCustAddress(e.target.value)}
                        placeholder="optional"
                        className="bg-slate-800 border-slate-700 text-white text-sm h-9"
                      />
                    </div>
                    <div>
                      <Label className="text-xs text-slate-400 mb-1">Postcode</Label>
                      <Input
                        value={custPostcode}
                        onChange={e => setCustPostcode(e.target.value)}
                        placeholder="optional"
                        className="bg-slate-800 border-slate-700 text-white text-sm h-9"
                      />
                    </div>
                  </TabsContent>

                  {/* ── Pricing tab ── */}
                  <TabsContent value="pricing" className="mt-0 space-y-3">
                    {lineItems.length === 0 ? (
                      <p className="text-xs text-slate-500 py-4 text-center">No line items — add one below.</p>
                    ) : (
                      <div className="space-y-2">
                        {lineItems.map(li => (
                          <div key={li.lineId} className="bg-slate-800 rounded-lg p-3 space-y-2">
                            <div className="flex items-center gap-2">
                              <Input
                                value={li.description}
                                onChange={e => updateLineItem(li.lineId, 'description', e.target.value)}
                                placeholder="Description"
                                className="flex-1 bg-slate-700 border-slate-600 text-white text-xs h-8"
                              />
                              <button
                                onClick={() => removeLineItem(li.lineId)}
                                className="text-slate-500 hover:text-red-400 shrink-0"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                            <div className="flex items-center gap-3 flex-wrap">
                              <div className="flex items-center gap-1.5">
                                <span className="text-slate-500 text-[10px]">Labour</span>
                                <span className="text-slate-400 text-xs">£</span>
                                <Input
                                  value={li.pricePounds}
                                  onChange={e => updateLineItem(li.lineId, 'pricePounds', e.target.value)}
                                  type="number"
                                  step="0.01"
                                  min="0"
                                  className="bg-slate-700 border-slate-600 text-white text-xs h-8 w-24"
                                />
                              </div>
                              <div className="flex items-center gap-1.5">
                                <span className="text-slate-500 text-[10px]">Materials</span>
                                <span className="text-slate-400 text-xs">£</span>
                                <Input
                                  value={li.materialsPounds}
                                  onChange={e => updateLineItem(li.lineId, 'materialsPounds', e.target.value)}
                                  type="number"
                                  step="0.01"
                                  min="0"
                                  className="bg-slate-700 border-slate-600 text-white text-xs h-8 w-24"
                                />
                              </div>
                            </div>
                            {/* Category + time — REQUIRED so the contractor engine can price this line.
                                Without these the line creates 100% platform margin (no contractor pay). */}
                            <div className="flex items-center gap-3 flex-wrap">
                              <div className="flex items-center gap-1.5 flex-1 min-w-[180px]">
                                <span className="text-slate-500 text-[10px] shrink-0">Category</span>
                                <select
                                  value={li.category}
                                  onChange={e => updateLineItem(li.lineId, 'category', e.target.value)}
                                  className={`bg-slate-700 border text-white text-xs h-8 rounded px-2 flex-1 min-w-0 ${!li.category ? 'border-amber-500 ring-1 ring-amber-500/40' : 'border-slate-600'}`}
                                >
                                  <option value="">— pick —</option>
                                  {JOB_CATEGORIES.map((c) => (
                                    <option key={c} value={c}>
                                      {c.replace(/_/g, ' ')}
                                    </option>
                                  ))}
                                </select>
                              </div>
                              <div className="flex items-center gap-1.5">
                                <span className="text-slate-500 text-[10px]">Time</span>
                                <Input
                                  value={li.timeMinutes}
                                  onChange={e => updateLineItem(li.lineId, 'timeMinutes', e.target.value)}
                                  type="number"
                                  step="15"
                                  min="15"
                                  className={`bg-slate-700 text-white text-xs h-8 w-20 ${(!li.timeMinutes || Number(li.timeMinutes) <= 0) ? 'border-amber-500 ring-1 ring-amber-500/40' : 'border-slate-600'}`}
                                />
                                <span className="text-slate-400 text-[10px]">min</span>
                              </div>
                            </div>
                            {(!li.category || !li.timeMinutes || Number(li.timeMinutes) <= 0) && (
                              <p className="text-[10px] text-amber-400 flex items-center gap-1">
                                <AlertTriangle className="w-3 h-3" /> Required so contractor pay can be calculated for this line
                              </p>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={addLineItem}
                      className="w-full border-dashed border-slate-600 text-slate-400 hover:text-white hover:border-slate-500 text-xs h-8"
                    >
                      <Plus className="w-3 h-3 mr-1.5" />Add line item
                    </Button>
                    {lineItems.length > 0 && (
                      <div className="pt-1 border-t border-slate-700/50 space-y-1">
                        <div className="flex justify-between items-center">
                          <span className="text-[10px] text-slate-500">Labour</span>
                          <span className="text-xs text-slate-400">£{penceToGBP(labourPence)}</span>
                        </div>
                        {materialsPence > 0 && (
                          <div className="flex justify-between items-center">
                            <span className="text-[10px] text-slate-500">Materials</span>
                            <span className="text-xs text-slate-400">£{penceToGBP(materialsPence)}</span>
                          </div>
                        )}
                        <div className="flex justify-between items-center">
                          <span className="text-xs text-slate-400">Total</span>
                          <span className="text-sm font-bold text-white">£{penceToGBP(totalPence)}</span>
                        </div>
                      </div>
                    )}
                  </TabsContent>

                  {/* ── Scheduling tab ── */}
                  <TabsContent value="scheduling" className="mt-0 space-y-3">
                    <p className="text-xs text-slate-400">
                      Select dates available for this customer to book. Leave empty to use system availability.
                    </p>
                    {selectedDates.length > 0 && (
                      <div className="flex flex-wrap gap-1.5">
                        {selectedDates.map(d => (
                          <Badge
                            key={d}
                            variant="secondary"
                            className="bg-[#7DB00E]/20 text-[#7DB00E] border border-[#7DB00E]/30 cursor-pointer text-xs"
                            onClick={() => toggleDate(d)}
                          >
                            {formatDateLabel(d)} ×
                          </Badge>
                        ))}
                      </div>
                    )}
                    <div className="grid grid-cols-2 gap-1.5">
                      {upcomingDates.map(d => {
                        const isSelected = selectedDates.includes(d);
                        return (
                          <button
                            key={d}
                            onClick={() => toggleDate(d)}
                            className={`text-xs rounded-md px-2 py-1.5 text-left transition-colors border ${
                              isSelected
                                ? 'bg-[#7DB00E]/20 border-[#7DB00E]/50 text-[#7DB00E]'
                                : 'bg-slate-800 border-slate-700 text-slate-300 hover:border-slate-500'
                            }`}
                          >
                            {formatDateLabel(d)}
                          </button>
                        );
                      })}
                    </div>
                    {selectedDates.length > 0 && (
                      <button
                        onClick={() => setSelectedDates([])}
                        className="text-xs text-slate-500 hover:text-red-400"
                      >
                        Clear all dates (use system availability)
                      </button>
                    )}
                  </TabsContent>
                </div>
              </Tabs>

              {/* Drawer footer */}
              <div className="px-4 py-3 border-t border-slate-700/50 shrink-0 flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setEditOpen(false)}
                  className="flex-1 border-slate-700 text-slate-400 hover:text-white text-xs"
                >
                  Cancel
                </Button>
                <Button
                  size="sm"
                  onClick={handleSave}
                  disabled={saving}
                  className="flex-1 bg-[#7DB00E] hover:bg-[#6a9a0b] text-white text-xs"
                >
                  {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : null}
                  Save Changes
                </Button>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
