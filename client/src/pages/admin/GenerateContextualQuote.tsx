import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import {
  Phone,
  Clock,
  Plus,
  Trash2,
  Wand2,
  Loader2,
  Copy,
  Check,
  ExternalLink,
  AlertTriangle,
  Info,
} from 'lucide-react';
import { FaWhatsapp } from 'react-icons/fa';
import { formatDistanceToNow } from 'date-fns';
import { buildContextualQuoteWhatsAppMessage } from '@/lib/whatsapp-quote-message';
import type {
  JobCategory,
  ParsedJobResult,
  LineItemResult,
  BatchDiscount,
  LayoutTier,
  BookingMode,
  MultiLineResult,
} from '@shared/contextual-pricing-types';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface RecentCaller {
  id: string;
  customerName: string;
  phone: string;
  address: string;
  postcode: string;
  jobSummary: string;
  calledAt: string | null;
}

interface LineItem {
  id: string;
  description: string;
  category: JobCategory;
  estimatedMinutes: number;
  materialsCostPounds: number; // in pounds for easier input, converted to pence on submit
}

interface ContextSignals {
  urgency: 'standard' | 'priority' | 'emergency';
  materialsSupply: 'customer_supplied' | 'we_supply' | 'labor_only';
  timeOfService: 'standard' | 'after_hours' | 'weekend';
  isReturningCustomer: boolean;
  previousJobCount: number;
  previousAvgPricePence: number;
}

interface QuoteResult {
  success: boolean;
  quoteId: string;
  shortSlug: string;
  quoteUrl: string;
  whatsappMessage: string;
  whatsappSendUrl: string;
  pricing: {
    totalPence: number;
    totalFormatted: string;
    lineItems: LineItemResult[];
    batchDiscount: BatchDiscount;
  };
  messaging: {
    headline: string;
    layoutTier: LayoutTier;
    bookingModes: BookingMode[];
    requiresHumanReview: boolean;
    reviewReason?: string;
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const CATEGORY_LABELS: Record<string, string> = {
  general_fixing: 'General Fixing',
  flat_pack: 'Flat Pack Assembly',
  tv_mounting: 'TV Mounting',
  carpentry: 'Carpentry',
  plumbing_minor: 'Plumbing (Minor)',
  electrical_minor: 'Electrical (Minor)',
  painting: 'Painting',
  tiling: 'Tiling',
  plastering: 'Plastering',
  lock_change: 'Lock Change',
  guttering: 'Guttering',
  pressure_washing: 'Pressure Washing',
  fencing: 'Fencing',
  garden_maintenance: 'Garden Maintenance',
  bathroom_fitting: 'Bathroom Fitting',
  kitchen_fitting: 'Kitchen Fitting',
  door_fitting: 'Door Fitting',
  flooring: 'Flooring',
  curtain_blinds: 'Curtain & Blinds',
  silicone_sealant: 'Silicone / Sealant',
  shelving: 'Shelving',
  furniture_repair: 'Furniture Repair',
  waste_removal: 'Waste Removal',
  other: 'Other',
};

const CATEGORY_OPTIONS = Object.entries(CATEGORY_LABELS).map(([value, label]) => ({
  value,
  label,
}));

// Reference hourly rates (pence) and minimums for live estimate — mirrors server/contextual-pricing/reference-rates.ts
const CATEGORY_RATES: Record<string, { hourly: number; min: number }> = {
  general_fixing: { hourly: 3000, min: 4500 },
  flat_pack: { hourly: 2800, min: 4000 },
  tv_mounting: { hourly: 3500, min: 5000 },
  carpentry: { hourly: 4000, min: 5500 },
  curtain_blinds: { hourly: 3000, min: 4000 },
  door_fitting: { hourly: 3500, min: 6000 },
  plumbing_minor: { hourly: 4500, min: 6000 },
  electrical_minor: { hourly: 5000, min: 6500 },
  painting: { hourly: 3000, min: 8000 },
  tiling: { hourly: 4000, min: 6000 },
  waste_removal: { hourly: 2500, min: 4000 },
  plastering: { hourly: 4000, min: 6000 },
  lock_change: { hourly: 5000, min: 7000 },
  guttering: { hourly: 3500, min: 5000 },
  pressure_washing: { hourly: 3000, min: 5000 },
  shelving: { hourly: 3000, min: 4500 },
  silicone_sealant: { hourly: 2500, min: 3500 },
  fencing: { hourly: 3500, min: 5000 },
  flooring: { hourly: 3000, min: 8000 },
  furniture_repair: { hourly: 3000, min: 4500 },
  garden_maintenance: { hourly: 2500, min: 4000 },
  bathroom_fitting: { hourly: 5000, min: 15000 },
  kitchen_fitting: { hourly: 5000, min: 20000 },
  other: { hourly: 3500, min: 5000 },
};

function estimateLineItemPence(item: LineItem): number {
  const rate = CATEGORY_RATES[item.category] || CATEGORY_RATES.other;
  const timeBased = Math.round((rate.hourly / 60) * item.estimatedMinutes);
  const labour = Math.max(timeBased, rate.min);
  const materials = Math.round((item.materialsCostPounds || 0) * 100);
  return labour + materials;
}

function generateId(): string {
  return Math.random().toString(36).substring(2, 10);
}

function getAuthHeaders(): Record<string, string> {
  const token = localStorage.getItem('adminToken');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function formatPhoneForWhatsApp(phone: string): string {
  let cleaned = phone.replace(/[\s\-()]/g, '');
  cleaned = cleaned.replace(/^\+/, '');
  if (cleaned.startsWith('0')) {
    cleaned = '44' + cleaned.substring(1);
  }
  return cleaned;
}

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

export default function GenerateContextualQuote() {
  const { toast } = useToast();

  // ── Customer fields ──
  const [customerName, setCustomerName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [address, setAddress] = useState('');
  const [postcode, setPostcode] = useState('');

  // ── Job description ──
  const [jobDescription, setJobDescription] = useState('');

  // ── Line items ──
  const [lineItems, setLineItems] = useState<LineItem[]>([]);

  // ── Pricing signals ──
  const [signals, setSignals] = useState<ContextSignals>({
    urgency: 'standard',
    materialsSupply: 'labor_only',
    timeOfService: 'standard',
    isReturningCustomer: false,
    previousJobCount: 0,
    previousAvgPricePence: 0,
  });

  // ── Call card selection ──
  const [selectedCallerId, setSelectedCallerId] = useState<string | null>(null);

  // ── Result ──
  const [quoteResult, setQuoteResult] = useState<QuoteResult | null>(null);

  // ── Clipboard state ──
  const [copiedMessage, setCopiedMessage] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);

  // ── Live pricing preview (calls the real engine) ──
  const [livePreview, setLivePreview] = useState<MultiLineResult | null>(null);
  const [livePreviewLoading, setLivePreviewLoading] = useState(false);
  const livePreviewAbortRef = useRef<AbortController | null>(null);
  const livePreviewTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchLivePreview = useCallback(async (items: LineItem[], sigs: ContextSignals) => {
    // Cancel any in-flight request
    livePreviewAbortRef.current?.abort();

    // Need at least one valid line item
    const validItems = items.filter((li) => li.description.trim() && li.estimatedMinutes > 0);
    if (validItems.length === 0) {
      setLivePreview(null);
      setLivePreviewLoading(false);
      return;
    }

    const controller = new AbortController();
    livePreviewAbortRef.current = controller;
    setLivePreviewLoading(true);

    try {
      const res = await fetch('/api/pricing/multi-quote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify({
          lines: validItems.map((li) => ({
            id: li.id,
            description: li.description,
            category: li.category,
            timeEstimateMinutes: li.estimatedMinutes,
            materialsCostPence: Math.round((li.materialsCostPounds || 0) * 100),
          })),
          signals: {
            urgency: sigs.urgency,
            materialsSupply: sigs.materialsSupply,
            timeOfService: sigs.timeOfService,
            isReturningCustomer: sigs.isReturningCustomer,
            previousJobCount: sigs.previousJobCount,
            previousAvgPricePence: sigs.previousAvgPricePence,
          },
        }),
        signal: controller.signal,
      });
      if (!res.ok) throw new Error('Preview failed');
      const data: MultiLineResult = await res.json();
      setLivePreview(data);
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        // Silently fall back — preview is non-critical
        setLivePreview(null);
      }
    } finally {
      if (!controller.signal.aborted) {
        setLivePreviewLoading(false);
      }
    }
  }, []);

  // Debounced effect: re-fetch live preview when line items or signals change
  useEffect(() => {
    if (livePreviewTimerRef.current) clearTimeout(livePreviewTimerRef.current);
    livePreviewTimerRef.current = setTimeout(() => {
      fetchLivePreview(lineItems, signals);
    }, 600);
    return () => {
      if (livePreviewTimerRef.current) clearTimeout(livePreviewTimerRef.current);
    };
  }, [lineItems, signals, fetchLivePreview]);

  // ═══════════════════════════════════════════════════════════════════════════
  // API: Fetch recent callers
  // ═══════════════════════════════════════════════════════════════════════════

  const { data: callers, isLoading: callersLoading } = useQuery<RecentCaller[]>({
    queryKey: ['recent-callers'],
    queryFn: async () => {
      const res = await fetch('/api/calls/recent-callers', {
        headers: getAuthHeaders(),
      });
      if (!res.ok) throw new Error('Failed to fetch recent callers');
      return res.json();
    },
    staleTime: 30_000,
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // API: AI job parser
  // ═══════════════════════════════════════════════════════════════════════════

  const parseJobMutation = useMutation({
    mutationFn: async (description: string): Promise<ParsedJobResult> => {
      const res = await fetch('/api/pricing/parse-job', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify({ description }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Failed to parse job' }));
        throw new Error(err.error || 'Failed to parse job');
      }
      return res.json();
    },
    onSuccess: (result) => {
      // Map parsed lines to our LineItem format
      const newItems: LineItem[] = result.lines.map((line) => ({
        id: line.id || generateId(),
        description: line.description,
        category: line.category,
        estimatedMinutes: line.timeEstimateMinutes,
        materialsCostPounds: 0,
      }));
      setLineItems(newItems);

      // Apply detected signals
      if (result.detectedSignals) {
        const ds = result.detectedSignals;
        setSignals((prev) => ({
          ...prev,
          ...(ds.urgency ? { urgency: ds.urgency } : {}),
          ...(ds.materialsSupply ? { materialsSupply: ds.materialsSupply } : {}),
          ...(ds.timeOfService ? { timeOfService: ds.timeOfService } : {}),
        }));
      }

      toast({ title: 'Parsed!', description: `${newItems.length} line item${newItems.length > 1 ? 's' : ''} detected.` });
    },
    onError: (error: Error) => {
      toast({ title: 'Parse Failed', description: error.message, variant: 'destructive' });
    },
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // API: Create contextual quote
  // ═══════════════════════════════════════════════════════════════════════════

  const createQuoteMutation = useMutation({
    mutationFn: async (): Promise<QuoteResult> => {
      const adminUser = JSON.parse(localStorage.getItem('adminUser') || '{}');
      const res = await fetch('/api/pricing/create-contextual-quote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify({
          customerName,
          phone,
          email: email || undefined,
          address: address || undefined,
          postcode: postcode || undefined,
          jobDescription: jobDescription || undefined,
          lines: lineItems.map((li) => ({
            id: li.id,
            description: li.description,
            category: li.category,
            estimatedMinutes: li.estimatedMinutes,
            materialsCostPence: Math.round(li.materialsCostPounds * 100) || 0,
          })),
          signals: {
            urgency: signals.urgency,
            materialsSupply: signals.materialsSupply,
            timeOfService: signals.timeOfService,
            isReturningCustomer: signals.isReturningCustomer,
            previousJobCount: signals.previousJobCount,
            previousAvgPricePence: signals.previousAvgPricePence,
          },
          sourceCallId: selectedCallerId || undefined,
          createdBy: adminUser?.id || undefined,
          createdByName: adminUser?.name || adminUser?.email || undefined,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Failed to create quote' }));
        throw new Error(err.error || err.message || 'Failed to create quote');
      }
      return res.json();
    },
    onSuccess: (result) => {
      setQuoteResult(result);
      toast({ title: 'Quote Created!', description: 'Ready to send via WhatsApp.' });
    },
    onError: (error: Error) => {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    },
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Handlers
  // ═══════════════════════════════════════════════════════════════════════════

  const handleSelectCaller = (caller: RecentCaller, mode: 'all' | 'customer') => {
    setSelectedCallerId(caller.id);
    setCustomerName(caller.customerName || '');
    setPhone(caller.phone || '');
    setAddress(caller.address || '');
    setPostcode(caller.postcode || '');

    if (mode === 'all') {
      setJobDescription(caller.jobSummary || '');
      // Auto-parse the job description if present
      if (caller.jobSummary && caller.jobSummary.trim().length > 5) {
        parseJobMutation.mutate(caller.jobSummary);
      }
    } else {
      setJobDescription('');
      setLineItems([]);
    }
  };

  const handleAddLineItem = () => {
    if (lineItems.length >= 10) return;
    setLineItems((prev) => [
      ...prev,
      { id: generateId(), description: '', category: 'general_fixing' as JobCategory, estimatedMinutes: 30, materialsCostPounds: 0 },
    ]);
  };

  const handleRemoveLineItem = (id: string) => {
    setLineItems((prev) => prev.filter((li) => li.id !== id));
  };

  const handleUpdateLineItem = (id: string, field: keyof LineItem, value: string | number) => {
    setLineItems((prev) =>
      prev.map((li) => (li.id === id ? { ...li, [field]: value } : li)),
    );
  };

  const handleParseJob = () => {
    if (!jobDescription.trim()) {
      toast({ title: 'No description', description: 'Enter a job description first.', variant: 'destructive' });
      return;
    }
    parseJobMutation.mutate(jobDescription.trim());
  };

  const handleGenerate = () => {
    if (!customerName.trim()) {
      toast({ title: 'Missing name', description: 'Customer name is required.', variant: 'destructive' });
      return;
    }
    if (!phone.trim()) {
      toast({ title: 'Missing phone', description: 'Phone number is required.', variant: 'destructive' });
      return;
    }
    if (lineItems.length === 0) {
      toast({ title: 'No line items', description: 'Add at least one line item.', variant: 'destructive' });
      return;
    }
    // Validate line items have descriptions
    const emptyLines = lineItems.filter((li) => !li.description.trim());
    if (emptyLines.length > 0) {
      toast({ title: 'Incomplete items', description: 'All line items need a description.', variant: 'destructive' });
      return;
    }
    // Auto-set materialsSupply when any line has materials
    const hasMaterials = lineItems.some((li) => li.materialsCostPounds > 0);
    if (hasMaterials && signals.materialsSupply === 'labor_only') {
      setSignals((prev) => ({ ...prev, materialsSupply: 'we_supply' }));
    }
    createQuoteMutation.mutate();
  };

  const handleCopyMessage = () => {
    if (!quoteResult) return;
    navigator.clipboard.writeText(quoteResult.whatsappMessage);
    setCopiedMessage(true);
    toast({ title: 'Copied!' });
    setTimeout(() => setCopiedMessage(false), 2000);
  };

  const handleCopyLink = () => {
    if (!quoteResult) return;
    navigator.clipboard.writeText(quoteResult.quoteUrl);
    setCopiedLink(true);
    toast({ title: 'Link Copied!' });
    setTimeout(() => setCopiedLink(false), 2000);
  };

  const handleSendWhatsApp = () => {
    if (!quoteResult) return;
    window.open(quoteResult.whatsappSendUrl, '_blank');
  };

  const handleReset = () => {
    setQuoteResult(null);
    setCustomerName('');
    setPhone('');
    setEmail('');
    setAddress('');
    setPostcode('');
    setJobDescription('');
    setLineItems([]);
    setSelectedCallerId(null);
    setSignals({
      urgency: 'standard',
      materialsSupply: 'labor_only',
      timeOfService: 'standard',
      isReturningCustomer: false,
      previousJobCount: 0,
      previousAvgPricePence: 0,
    });
  };

  // Validate form completeness for button state
  const canGenerate = customerName.trim() && phone.trim() && lineItems.length > 0 && lineItems.every((li) => li.description.trim());

  // ═══════════════════════════════════════════════════════════════════════════
  // RENDER
  // ═══════════════════════════════════════════════════════════════════════════

  return (
    <div className="p-4 md:p-8">
      <div className="max-w-3xl mx-auto space-y-6">
        {/* Header */}
        <div className="mb-2">
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">Generate Contextual Quote</h1>
          <p className="text-muted-foreground text-sm mt-1">
            AI-powered pricing with full context signals
          </p>
        </div>

        {/* Only show form when no result yet */}
        {!quoteResult && (
          <>
            {/* ─── Section 1: Recent Calls ─── */}
            <div>
              <div className="flex items-center gap-2 mb-2">
                <Phone className="w-4 h-4 text-muted-foreground" />
                <span className="text-sm font-medium text-muted-foreground">Recent Calls</span>
              </div>

              {callersLoading ? (
                <div className="flex gap-2 overflow-x-auto pb-2">
                  {[1, 2, 3].map((i) => (
                    <div key={i} className="h-20 w-48 shrink-0 rounded-xl bg-muted animate-pulse" />
                  ))}
                </div>
              ) : callers && callers.length > 0 ? (
                <div className="flex gap-2 overflow-x-auto pb-2 -mx-1 px-1">
                  {callers.map((caller) => {
                    const isSelected = selectedCallerId === caller.id;
                    return (
                      <div
                        key={caller.id}
                        className={`shrink-0 rounded-xl border p-3 transition-all w-52 ${
                          isSelected
                            ? 'border-amber-500/50 bg-amber-500/10 ring-2 ring-amber-500/20'
                            : 'border-border bg-card hover:border-muted-foreground/30'
                        }`}
                      >
                        <div className="text-sm font-semibold text-foreground truncate">
                          {caller.customerName || 'Unknown'}
                        </div>
                        <div className="text-xs text-muted-foreground truncate mt-0.5">
                          {caller.phone}
                        </div>
                        <div className="flex items-center gap-1 text-xs text-muted-foreground mt-0.5">
                          <Clock className="w-3 h-3" />
                          {caller.calledAt
                            ? formatDistanceToNow(new Date(caller.calledAt), { addSuffix: true })
                            : 'Unknown'}
                        </div>
                        {caller.jobSummary && (
                          <div className="text-xs text-muted-foreground/70 truncate mt-1">
                            {caller.jobSummary.length > 50
                              ? caller.jobSummary.slice(0, 50) + '...'
                              : caller.jobSummary}
                          </div>
                        )}
                        <div className="flex gap-1.5 mt-2">
                          <Button
                            variant="outline"
                            size="sm"
                            className="text-xs h-7 flex-1 border-amber-500/30 text-amber-400 hover:bg-amber-500/10"
                            onClick={() => handleSelectCaller(caller, 'all')}
                          >
                            Use All
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            className="text-xs h-7 flex-1"
                            onClick={() => handleSelectCaller(caller, 'customer')}
                          >
                            Customer Only
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">No recent calls found.</p>
              )}
            </div>

            <Separator />

            {/* ─── Section 2: Customer Details ─── */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Customer Details</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <Label htmlFor="cx-name" className="text-xs text-muted-foreground">Name *</Label>
                    <Input
                      id="cx-name"
                      placeholder="John Smith"
                      value={customerName}
                      onChange={(e) => setCustomerName(e.target.value)}
                      className="mt-1"
                    />
                  </div>
                  <div>
                    <Label htmlFor="cx-phone" className="text-xs text-muted-foreground">Phone *</Label>
                    <Input
                      id="cx-phone"
                      placeholder="07700 900123"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      className="mt-1"
                    />
                  </div>
                  <div>
                    <Label htmlFor="cx-email" className="text-xs text-muted-foreground">Email</Label>
                    <Input
                      id="cx-email"
                      placeholder="john@example.com"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="mt-1"
                    />
                  </div>
                  <div>
                    <Label htmlFor="cx-postcode" className="text-xs text-muted-foreground">Postcode</Label>
                    <Input
                      id="cx-postcode"
                      placeholder="NG1 1AA"
                      value={postcode}
                      onChange={(e) => setPostcode(e.target.value)}
                      className="mt-1"
                    />
                  </div>
                </div>
                <div>
                  <Label htmlFor="cx-address" className="text-xs text-muted-foreground">Address</Label>
                  <Input
                    id="cx-address"
                    placeholder="123 Main Street, Nottingham"
                    value={address}
                    onChange={(e) => setAddress(e.target.value)}
                    className="mt-1"
                  />
                </div>
              </CardContent>
            </Card>

            {/* ─── Section 3: Job Description ─── */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Job Description</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div>
                  <Label htmlFor="job-desc" className="text-xs text-muted-foreground">
                    Job Description (optional -- leave blank if awaiting videos)
                  </Label>
                  <Textarea
                    id="job-desc"
                    placeholder="Describe the work needed... e.g. 'Fix leaking kitchen tap, hang 3 floating shelves in living room, assemble IKEA wardrobe in bedroom'"
                    value={jobDescription}
                    onChange={(e) => setJobDescription(e.target.value)}
                    className="mt-1 min-h-[80px]"
                    rows={3}
                  />
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleParseJob}
                    disabled={parseJobMutation.isPending || !jobDescription.trim()}
                    className="gap-1.5"
                  >
                    {parseJobMutation.isPending ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Wand2 className="w-3.5 h-3.5" />
                    )}
                    AI Parse into Line Items
                  </Button>
                  <span className="text-xs text-muted-foreground flex items-center gap-1" title="For best results, include: what needs doing, which rooms, any materials needed, how many items">
                    <Info className="w-3 h-3" />
                    Tip: Include rooms, quantities, materials
                  </span>
                </div>
              </CardContent>
            </Card>

            {/* ─── Section 4: Line Items ─── */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center justify-between">
                  <span>Line Items</span>
                  {lineItems.length > 0 && (
                    <Badge variant="outline" className="text-xs">
                      {lineItems.length} item{lineItems.length > 1 ? 's' : ''}
                    </Badge>
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {lineItems.length === 0 ? (
                  <div className="text-center py-6 text-sm text-muted-foreground border border-dashed rounded-lg">
                    Add job details above or enter line items manually
                  </div>
                ) : (
                  <div className="space-y-3">
                    {lineItems.map((item, index) => (
                      <div
                        key={item.id}
                        className="space-y-2 sm:space-y-0"
                      >
                        {/* Desktop: single row */}
                        <div className="hidden sm:grid sm:grid-cols-[1fr_170px_80px_90px_32px] gap-2 items-end">
                          <div>
                            {index === 0 && <Label className="text-xs text-muted-foreground mb-1 block">Description</Label>}
                            <Input
                              placeholder="e.g. Fix leaking kitchen tap"
                              value={item.description}
                              onChange={(e) => handleUpdateLineItem(item.id, 'description', e.target.value)}
                            />
                          </div>
                          <div>
                            {index === 0 && <Label className="text-xs text-muted-foreground mb-1 block">Category</Label>}
                            <Select
                              value={item.category}
                              onValueChange={(val) => handleUpdateLineItem(item.id, 'category', val)}
                            >
                              <SelectTrigger className="h-9 text-xs">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {CATEGORY_OPTIONS.map((opt) => (
                                  <SelectItem key={opt.value} value={opt.value} className="text-xs">
                                    {opt.label}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                          <div>
                            {index === 0 && <Label className="text-xs text-muted-foreground mb-1 block">Mins</Label>}
                            <Input
                              type="number"
                              min={5}
                              max={480}
                              value={item.estimatedMinutes}
                              onChange={(e) => handleUpdateLineItem(item.id, 'estimatedMinutes', parseInt(e.target.value) || 30)}
                              className="text-center"
                            />
                          </div>
                          <div>
                            {index === 0 && <Label className="text-xs text-muted-foreground mb-1 block">Materials £</Label>}
                            <Input
                              type="number"
                              min={0}
                              step={1}
                              placeholder="0"
                              value={item.materialsCostPounds || ''}
                              onChange={(e) => handleUpdateLineItem(item.id, 'materialsCostPounds', parseFloat(e.target.value) || 0)}
                              className="text-center"
                            />
                          </div>
                          <div>
                            {index === 0 && <div className="h-4 mb-1" />}
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-9 w-8 p-0 text-muted-foreground hover:text-destructive"
                              onClick={() => handleRemoveLineItem(item.id)}
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </Button>
                          </div>
                        </div>

                        {/* Mobile: stacked rows */}
                        <div className="sm:hidden space-y-2 rounded-lg border border-white/10 p-3">
                          <div className="flex gap-2 items-start">
                            <div className="flex-1">
                              <Label className="text-xs text-muted-foreground mb-1 block">Description</Label>
                              <Input
                                placeholder="e.g. Fix leaking kitchen tap"
                                value={item.description}
                                onChange={(e) => handleUpdateLineItem(item.id, 'description', e.target.value)}
                              />
                            </div>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-9 w-8 p-0 mt-5 text-muted-foreground hover:text-destructive"
                              onClick={() => handleRemoveLineItem(item.id)}
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </Button>
                          </div>
                          <div>
                            <Label className="text-xs text-muted-foreground mb-1 block">Category</Label>
                            <Select
                              value={item.category}
                              onValueChange={(val) => handleUpdateLineItem(item.id, 'category', val)}
                            >
                              <SelectTrigger className="h-9 text-xs">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {CATEGORY_OPTIONS.map((opt) => (
                                  <SelectItem key={opt.value} value={opt.value} className="text-xs">
                                    {opt.label}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                          <div className="grid grid-cols-2 gap-2">
                            <div>
                              <Label className="text-xs text-muted-foreground mb-1 block">Minutes</Label>
                              <Input
                                type="number"
                                min={5}
                                max={480}
                                value={item.estimatedMinutes}
                                onChange={(e) => handleUpdateLineItem(item.id, 'estimatedMinutes', parseInt(e.target.value) || 30)}
                                className="text-center"
                              />
                            </div>
                            <div>
                              <Label className="text-xs text-muted-foreground mb-1 block">Materials £</Label>
                              <Input
                                type="number"
                                min={0}
                                step={1}
                                placeholder="0"
                                value={item.materialsCostPounds || ''}
                                onChange={(e) => handleUpdateLineItem(item.id, 'materialsCostPounds', parseFloat(e.target.value) || 0)}
                                className="text-center"
                              />
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                {lineItems.length < 10 && (
                  <Button variant="outline" size="sm" onClick={handleAddLineItem} className="gap-1.5">
                    <Plus className="w-3.5 h-3.5" />
                    Add Line Item
                  </Button>
                )}

                {/* Live Engine Price Preview */}
                {lineItems.length > 0 && (
                  <>
                    <Separator />
                    {livePreviewLoading && !livePreview ? (
                      <div className="flex items-center justify-center gap-2 py-3">
                        <Loader2 className="w-4 h-4 animate-spin text-amber-400" />
                        <span className="text-sm text-muted-foreground">Calculating price...</span>
                      </div>
                    ) : livePreview ? (
                      <div className="space-y-2">
                        {/* Per-line breakdown */}
                        {livePreview.lineItems.length > 1 && (
                          <div className="space-y-1">
                            {livePreview.lineItems.map((li) => (
                              <div key={li.lineId} className="flex items-center justify-between text-xs">
                                <span className="text-muted-foreground truncate mr-2">{li.description}</span>
                                <span className="text-foreground font-medium shrink-0">
                                  £{(li.guardedPricePence / 100).toFixed(0)}
                                  {li.materialsWithMarginPence > 0 && (
                                    <span className="text-muted-foreground ml-1">+ £{(li.materialsWithMarginPence / 100).toFixed(0)} materials</span>
                                  )}
                                </span>
                              </div>
                            ))}
                          </div>
                        )}

                        {/* Batch discount */}
                        {livePreview.batchDiscount.applied && (
                          <div className="flex items-center justify-between text-xs text-green-400">
                            <span>Batch discount ({livePreview.batchDiscount.discountPercent}%)</span>
                            <span>-£{(livePreview.batchDiscount.savingsPence / 100).toFixed(0)}</span>
                          </div>
                        )}

                        {/* Total */}
                        <div className="flex items-center justify-between py-1">
                          <span className="text-sm text-muted-foreground">
                            Engine Total
                            {livePreviewLoading && <Loader2 className="w-3 h-3 animate-spin inline ml-1.5" />}
                          </span>
                          <span className="text-xl font-bold text-amber-400">
                            £{(livePreview.finalPricePence / 100).toFixed(0)}
                          </span>
                        </div>
                        <p className="text-[11px] text-muted-foreground/60">
                          Live from contextual pricing engine — includes all adjustments.
                        </p>
                      </div>
                    ) : (
                      <div className="flex items-center justify-between py-1">
                        <span className="text-sm text-muted-foreground">Estimated Total</span>
                        <span className="text-xl font-bold text-amber-400">
                          ~£{Math.round(lineItems.reduce((sum, item) => sum + estimateLineItemPence(item), 0) / 100)}
                        </span>
                      </div>
                    )}
                  </>
                )}
              </CardContent>
            </Card>

            {/* ─── Section 5: Pricing Signals ─── */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Pricing Signals</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* 2x2 grid of signal fields */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <Label className="text-xs text-muted-foreground">Urgency</Label>
                    <Select value={signals.urgency} onValueChange={(v: ContextSignals['urgency']) => setSignals((s) => ({ ...s, urgency: v }))}>
                      <SelectTrigger className="mt-1 h-8 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="standard">Standard</SelectItem>
                        <SelectItem value="priority">Priority</SelectItem>
                        <SelectItem value="emergency">Emergency</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground">Materials</Label>
                    <Select value={signals.materialsSupply} onValueChange={(v: ContextSignals['materialsSupply']) => setSignals((s) => ({ ...s, materialsSupply: v }))}>
                      <SelectTrigger className="mt-1 h-8 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="we_supply">We Supply</SelectItem>
                        <SelectItem value="customer_supplied">Customer Supplies</SelectItem>
                        <SelectItem value="labor_only">Labour Only</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground">Scheduling</Label>
                    <Select value={signals.timeOfService} onValueChange={(v: ContextSignals['timeOfService']) => setSignals((s) => ({ ...s, timeOfService: v }))}>
                      <SelectTrigger className="mt-1 h-8 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="standard">Weekday</SelectItem>
                        <SelectItem value="after_hours">Evening</SelectItem>
                        <SelectItem value="weekend">Weekend</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex items-end pb-0.5">
                    <label className="flex items-center gap-2 text-xs cursor-pointer">
                      <Switch
                        checked={signals.isReturningCustomer}
                        onCheckedChange={(c) =>
                          setSignals((s) => ({
                            ...s,
                            isReturningCustomer: c,
                            previousJobCount: c ? s.previousJobCount || 1 : 0,
                            previousAvgPricePence: c ? s.previousAvgPricePence || 0 : 0,
                          }))
                        }
                      />
                      <span>Returning Customer</span>
                    </label>
                  </div>
                </div>

                {/* Conditional returning customer sub-fields */}
                {signals.isReturningCustomer && (
                  <div className="grid grid-cols-2 gap-3 border-t border-border pt-3">
                    <div>
                      <Label className="text-xs text-muted-foreground">Previous Jobs</Label>
                      <Input
                        type="number"
                        min={1}
                        value={signals.previousJobCount}
                        onChange={(e) => setSignals((s) => ({ ...s, previousJobCount: parseInt(e.target.value) || 1 }))}
                        className="mt-1 h-8 text-xs"
                      />
                    </div>
                    <div>
                      <Label className="text-xs text-muted-foreground">Avg Previous Spend ({"\u00A3"})</Label>
                      <Input
                        type="number"
                        min={0}
                        step={1}
                        placeholder="75"
                        value={signals.previousAvgPricePence ? (signals.previousAvgPricePence / 100).toFixed(0) : ''}
                        onChange={(e) =>
                          setSignals((s) => ({
                            ...s,
                            previousAvgPricePence: e.target.value ? Math.round(parseFloat(e.target.value) * 100) : 0,
                          }))
                        }
                        className="mt-1 h-8 text-xs"
                      />
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* ─── Section 6: Generate Button ─── */}
            <Button
              size="lg"
              className="w-full h-12 text-base font-semibold bg-amber-600 hover:bg-amber-700 text-white"
              onClick={handleGenerate}
              disabled={!canGenerate || createQuoteMutation.isPending}
            >
              {createQuoteMutation.isPending ? (
                <>
                  <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                  Generating Quote...
                </>
              ) : (
                'Generate Quote'
              )}
            </Button>
          </>
        )}

        {/* ─── Section 7: Results ─── */}
        {quoteResult && (
          <div className="space-y-4">
            {/* Human Review Banner */}
            {quoteResult.messaging.requiresHumanReview && (
              <div className="flex items-start gap-3 rounded-lg border border-yellow-500/40 bg-yellow-500/10 p-4">
                <AlertTriangle className="w-5 h-5 text-yellow-500 shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-semibold text-yellow-400">AI couldn't fully parse this job. Please review details before sending.</p>
                  {quoteResult.messaging.reviewReason && (
                    <p className="text-xs text-yellow-400/80 mt-1">Reason: {quoteResult.messaging.reviewReason}</p>
                  )}
                </div>
              </div>
            )}

            {/* Quote Summary Card */}
            <Card className="border border-amber-500/30 bg-amber-500/5">
              <CardContent className="pt-6 space-y-4">
                {/* Headline */}
                <div className="text-center">
                  <h2 className="text-xl font-bold text-foreground">{quoteResult.messaging.headline}</h2>
                  <div className="mt-2">
                    <Badge
                      variant="outline"
                      className={
                        quoteResult.messaging.layoutTier === 'quick'
                          ? 'border-green-500/40 text-green-400'
                          : quoteResult.messaging.layoutTier === 'standard'
                          ? 'border-blue-500/40 text-blue-400'
                          : 'border-purple-500/40 text-purple-400'
                      }
                    >
                      {quoteResult.messaging.layoutTier.charAt(0).toUpperCase() + quoteResult.messaging.layoutTier.slice(1)} Quote
                    </Badge>
                  </div>
                </div>

                {/* Total Price */}
                <div className="bg-muted rounded-lg p-4 text-center border border-amber-500/30">
                  <div className="text-xs text-amber-400 uppercase font-semibold mb-1">Total Price</div>
                  <div className="text-3xl sm:text-4xl font-bold text-amber-400">
                    {quoteResult.pricing.totalFormatted}
                  </div>
                </div>

                {/* Line Item Breakdown */}
                {quoteResult.pricing.lineItems.length > 1 && (
                  <div className="space-y-1.5">
                    <div className="text-xs text-muted-foreground font-semibold uppercase">Breakdown</div>
                    {quoteResult.pricing.lineItems.map((li) => (
                      <div key={li.lineId} className="flex items-center justify-between text-sm bg-muted/50 rounded px-3 py-1.5">
                        <span className="text-foreground truncate mr-3">{li.description}</span>
                        <span className="text-foreground font-medium shrink-0">
                          {"\u00A3"}{(li.guardedPricePence / 100).toFixed(0)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}

                {/* Batch Discount */}
                {quoteResult.pricing.batchDiscount.applied && (
                  <div className="flex items-center justify-between text-sm bg-green-500/10 rounded px-3 py-1.5 border border-green-500/20">
                    <span className="text-green-400">
                      Batch discount ({quoteResult.pricing.batchDiscount.discountPercent}%)
                    </span>
                    <span className="text-green-400 font-medium">
                      -{"\u00A3"}{(quoteResult.pricing.batchDiscount.savingsPence / 100).toFixed(0)}
                    </span>
                  </div>
                )}

                {/* Booking Modes */}
                <div className="flex flex-wrap gap-1.5">
                  {quoteResult.messaging.bookingModes.map((mode) => (
                    <Badge key={mode} variant="secondary" className="text-xs">
                      {mode.replace(/_/g, ' ')}
                    </Badge>
                  ))}
                </div>
              </CardContent>
            </Card>

            {/* WhatsApp Send Section */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <FaWhatsapp className="w-4 h-4 text-green-500" />
                  WhatsApp Message
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {/* Message Preview (WhatsApp bubble style) */}
                <div className="bg-[#1a2e1a] rounded-lg p-3 sm:p-4 border border-green-800/30">
                  <div className="text-sm text-green-100/90 whitespace-pre-wrap max-h-64 overflow-y-auto leading-relaxed">
                    {quoteResult.whatsappMessage}
                  </div>
                </div>

                {/* Action Buttons */}
                <div className="flex flex-col sm:flex-row gap-2">
                  <Button
                    onClick={handleSendWhatsApp}
                    className="w-full sm:flex-1 bg-green-600 hover:bg-green-700 h-11 text-sm font-semibold"
                  >
                    <FaWhatsapp className="w-4 h-4 mr-2" />
                    Send via WhatsApp
                  </Button>
                  <Button variant="outline" onClick={handleCopyMessage} className="sm:flex-1 h-10">
                    {copiedMessage ? <Check className="w-4 h-4 mr-1.5" /> : <Copy className="w-4 h-4 mr-1.5" />}
                    Copy Message
                  </Button>
                  <Button variant="outline" onClick={handleCopyLink} className="sm:flex-1 h-10">
                    {copiedLink ? <Check className="w-4 h-4 mr-1.5" /> : <Copy className="w-4 h-4 mr-1.5" />}
                    Copy Quote Link
                  </Button>
                </div>
              </CardContent>
            </Card>

            {/* Quote Link */}
            <div className="flex items-center gap-2 bg-muted rounded-lg p-2.5 border border-border">
              <input
                type="text"
                value={quoteResult.quoteUrl}
                readOnly
                className="flex-1 bg-transparent text-xs sm:text-sm font-mono truncate text-foreground min-w-0"
              />
              <Button
                variant="outline"
                size="sm"
                onClick={handleCopyLink}
                className="shrink-0"
              >
                {copiedLink ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => window.open(quoteResult.quoteUrl, '_blank')}
                className="shrink-0"
              >
                <ExternalLink className="w-4 h-4" />
              </Button>
            </div>

            {/* Reset Button */}
            <Button variant="ghost" onClick={handleReset} className="w-full mt-1 h-9 text-sm">
              Create Another Quote
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
