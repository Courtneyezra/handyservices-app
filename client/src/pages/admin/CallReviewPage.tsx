/**
 * CallReviewPage - Review past calls with CallHUD-like interface
 *
 * This page displays a past call in a read-only version of the CallHUD interface
 * with action capabilities (Send Quote, Get Video, Book Visit).
 *
 * Key differences from LiveCallHUD:
 * - No WebSocket connection needed (static data)
 * - Transcript is read-only
 * - Data is pre-populated from call record
 * - Still has functional action buttons for follow-up
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useRoute, useLocation } from 'wouter';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '@/lib/utils';
import {
  ArrowLeft,
  Phone,
  Clock,
  Calendar,
  User,
  MapPinned,
  MessageSquare,
  FileText,
  Video,
  MapPin,
  CheckCircle2,
  AlertTriangle,
  Loader2,
  Check,
  HelpCircle,
  AlertCircle,
  CheckCircle,
  Home,
  Building2,
  Briefcase,
  Store,
  Shield,
  Wallet,
  Play,
  Pause,
} from 'lucide-react';
import { format } from 'date-fns';
import { useToast } from '@/hooks/use-toast';
import { openWhatsApp, getWhatsAppErrorMessage, copyWhatsAppFallback } from '@/lib/whatsapp-helper';
import { QuoteSendPopup } from '@/components/live-call/QuoteSendPopup';
import { BookVisitPopup } from '@/components/live-call/BookVisitPopup';
import { AvailabilityPanel } from '@/components/live-call/AvailabilityPanel';
import type { DetectedJob } from '@/components/live-call/JobsDetectedPanel';
import type { CallScriptSegment } from '@shared/schema';

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════

interface CallSKU {
  id: string;
  callId: string;
  quantity: number;
  pricePence: number;
  source: string;
  confidence?: number;
  detectionMethod?: string;
  sku: {
    id: string;
    skuCode: string;
    name: string;
    description?: string;
    category?: string;
    pricePence: number;
  } | null;
}

interface CallData {
  id: string;
  callSid: string | null;
  phoneNumber: string;
  customerName: string | null;
  address: string | null;
  postcode: string | null;
  status: string;
  outcome: string | null;
  startTime: string | null;
  endTime: string | null;
  duration: number | null;
  transcription: string | null;
  segments: any[] | null;
  metadataJson: any;
  liveAnalysisJson: any;
  leadType: string | null;
  urgency: string | null;
  jobSummary: string | null;
  totalPricePence: number;
  recordingUrl: string | null;
  detectedSkus: CallSKU[];
  manualSkus: CallSKU[];
  allSkus: CallSKU[];
}

type HUDSegment = Exclude<CallScriptSegment, 'EMERGENCY'>;
type ActionState = 'idle' | 'pending' | 'success' | 'error';

interface CustomerInfo {
  name: string;
  whatsappSameAsCalling: boolean | null;
  whatsappNumber: string;
  address: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// SEGMENT CONFIG
// ═══════════════════════════════════════════════════════════════════════════

const SEGMENTS: {
  id: HUDSegment;
  label: string;
  color: string;
  icon: React.ElementType;
}[] = [
  { id: 'LANDLORD', label: 'LANDLORD', color: '#EA580C', icon: Home },
  { id: 'PROP_MGR', label: 'PROP MGR', color: '#16A34A', icon: Building2 },
  { id: 'BUSY_PRO', label: 'BUSY', color: '#CA8A04', icon: Briefcase },
  { id: 'SMALL_BIZ', label: 'BIZ', color: '#9333EA', icon: Store },
  { id: 'OAP', label: 'TRUST', color: '#2563EB', icon: Shield },
  { id: 'BUDGET', label: 'BUDGET', color: '#525252', icon: Wallet },
];

const ACTION_CONFIG = {
  quote: { label: 'SEND QUOTE', icon: FileText, color: '#22C55E' },
  video: { label: 'GET VIDEO', icon: Video, color: '#F59E0B' },
  visit: { label: 'BOOK VISIT', icon: MapPin, color: '#3B82F6' },
};

// ═══════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════

function formatPrice(pence: number): string {
  return `£${Math.round(pence / 100)}`;
}

function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

function extractPostcode(address: string): string | undefined {
  const postcodeMatch = address.match(/[A-Z]{1,2}[0-9][0-9A-Z]?\s?[0-9][A-Z]{2}/i);
  return postcodeMatch ? postcodeMatch[0].toUpperCase() : undefined;
}

// Detect segment from lead type and other signals
function detectSegment(data: {
  leadType: string | null;
  transcription: string | null;
  liveAnalysisJson: any;
  metadataJson: any;
}): HUDSegment | null {
  // 1. Check if segment was already set in metadata
  const metaSegment = data.metadataJson?.segment || data.liveAnalysisJson?.segment;
  if (metaSegment && ['LANDLORD', 'PROP_MGR', 'BUSY_PRO', 'SMALL_BIZ', 'OAP', 'BUDGET'].includes(metaSegment)) {
    return metaSegment as HUDSegment;
  }

  // 2. Try to detect from leadType
  if (data.leadType) {
    const normalized = data.leadType.toUpperCase();
    if (normalized.includes('LANDLORD')) return 'LANDLORD';
    if (normalized.includes('PROPERTY') || normalized.includes('MANAGER')) return 'PROP_MGR';
    if (normalized.includes('COMMERCIAL') || normalized.includes('BUSINESS')) return 'SMALL_BIZ';
    if (normalized.includes('OAP') || normalized.includes('ELDERLY') || normalized.includes('PENSION')) return 'OAP';
    if (normalized.includes('BUDGET') || normalized.includes('PRICE')) return 'BUDGET';
    // Homeowner defaults - could be BUSY_PRO or LANDLORD depending on context
    if (normalized.includes('HOMEOWNER') || normalized.includes('HOME OWNER')) {
      // Check transcript for landlord signals
      const transcript = (data.transcription || '').toLowerCase();
      if (transcript.includes('tenant') || transcript.includes('rental') || transcript.includes('let') || transcript.includes('landlord')) {
        return 'LANDLORD';
      }
      return 'BUSY_PRO'; // Default homeowner to busy pro
    }
  }

  // 3. Scan transcript for segment signals
  const transcript = (data.transcription || '').toLowerCase();
  if (transcript.includes('landlord') || transcript.includes('tenant') || transcript.includes('rental property')) {
    return 'LANDLORD';
  }
  if (transcript.includes('properties') || transcript.includes('portfolio') || transcript.includes('managing')) {
    return 'PROP_MGR';
  }
  if (transcript.includes('business') || transcript.includes('shop') || transcript.includes('office')) {
    return 'SMALL_BIZ';
  }

  return null;
}

// ═══════════════════════════════════════════════════════════════════════════
// COMPONENT
// ═══════════════════════════════════════════════════════════════════════════

export default function CallReviewPage() {
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const [, params] = useRoute('/admin/calls/:id/review');
  const callId = params?.id;

  // Data state
  const [call, setCall] = useState<CallData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Segment state
  const [selectedSegment, setSelectedSegment] = useState<HUDSegment | null>(null);

  // Customer info state
  const [customerInfo, setCustomerInfo] = useState<CustomerInfo>({
    name: '',
    whatsappSameAsCalling: true,
    whatsappNumber: '',
    address: '',
  });

  // Action states
  const [quoteState, setQuoteState] = useState<ActionState>('idle');
  const [videoState, setVideoState] = useState<ActionState>('idle');
  const [visitState, setVisitState] = useState<ActionState>('idle');

  // Popup states
  const [showQuotePopup, setShowQuotePopup] = useState(false);
  const [showVisitPopup, setShowVisitPopup] = useState(false);

  // Audio playback state
  const [isPlayingAudio, setIsPlayingAudio] = useState(false);
  const [audioRef, setAudioRef] = useState<HTMLAudioElement | null>(null);

  // Fetch call data
  useEffect(() => {
    if (!callId) return;

    const fetchCall = async () => {
      setIsLoading(true);
      setError(null);

      try {
        const response = await fetch(`/api/calls/${callId}`);
        if (!response.ok) {
          if (response.status === 404) {
            throw new Error('Call not found');
          }
          throw new Error('Failed to fetch call');
        }

        const data = await response.json();
        setCall(data);

        // Pre-populate customer info
        setCustomerInfo({
          name: data.customerName || '',
          whatsappSameAsCalling: true,
          whatsappNumber: '',
          address: data.address || '',
        });

        // Detect segment from multiple signals
        const detectedSegment = detectSegment({
          leadType: data.leadType,
          transcription: data.transcription,
          liveAnalysisJson: data.liveAnalysisJson,
          metadataJson: data.metadataJson,
        });
        if (detectedSegment) {
          setSelectedSegment(detectedSegment);
        }
      } catch (err: any) {
        console.error('[CallReviewPage] Error fetching call:', err);
        setError(err.message || 'Failed to load call');
      } finally {
        setIsLoading(false);
      }
    };

    fetchCall();
  }, [callId]);

  // Convert SKUs to DetectedJob format
  const detectedJobs: DetectedJob[] = useMemo(() => {
    if (!call) return [];

    return call.allSkus.map((skuEntry) => ({
      id: skuEntry.id,
      description: skuEntry.sku?.name || 'Unknown job',
      matched: !!skuEntry.sku,
      quantity: skuEntry.quantity || 1,
      sku: skuEntry.sku ? {
        id: skuEntry.sku.id,
        name: skuEntry.sku.name,
        pricePence: skuEntry.pricePence || skuEntry.sku.pricePence,
        category: skuEntry.sku.category,
      } : undefined,
      confidence: skuEntry.confidence,
      trafficLight: skuEntry.sku ? 'green' : 'amber',
    }));
  }, [call]);

  // Calculate totals
  const matchedJobs = detectedJobs.filter(j => j.matched);
  const unmatchedJobs = detectedJobs.filter(j => !j.matched);
  const totalPence = matchedJobs.reduce((sum, j) => sum + (j.sku?.pricePence || 0) * (j.quantity || 1), 0);

  // Traffic light status
  const greenJobs = detectedJobs.filter(j => j.trafficLight === 'green' || j.matched);
  const amberJobs = detectedJobs.filter(j => j.trafficLight === 'amber' || !j.matched);
  const redJobs = detectedJobs.filter(j => j.trafficLight === 'red');
  const allGreen = detectedJobs.length > 0 && greenJobs.length === detectedJobs.length;
  const hasAmber = amberJobs.length > 0;
  const hasRed = redJobs.length > 0;

  // Get WhatsApp number
  const getWhatsAppNumber = useCallback((): string | null => {
    if (customerInfo.whatsappSameAsCalling === true) {
      return call?.phoneNumber || null;
    }
    if (customerInfo.whatsappSameAsCalling === false && customerInfo.whatsappNumber) {
      return customerInfo.whatsappNumber;
    }
    return call?.phoneNumber || null;
  }, [customerInfo, call?.phoneNumber]);

  // Check if info is complete
  const hasName = customerInfo.name.trim().length > 0;
  const hasWhatsApp = customerInfo.whatsappSameAsCalling === true ||
    (customerInfo.whatsappSameAsCalling === false && customerInfo.whatsappNumber.trim().length > 0);
  const hasAddress = customerInfo.address.trim().length > 0;
  const infoComplete = hasName && hasWhatsApp && hasAddress;

  // Get segment info
  const segment = SEGMENTS.find(s => s.id === selectedSegment);

  // Handle customer info changes
  const updateInfo = (updates: Partial<CustomerInfo>) => {
    setCustomerInfo(prev => ({ ...prev, ...updates }));
  };

  // ================================================================
  // ACTION HANDLERS
  // ================================================================

  // SEND QUOTE
  const handleQuote = useCallback(() => {
    if (matchedJobs.length === 0) {
      setQuoteState('error');
      setTimeout(() => setQuoteState('idle'), 2000);
      return;
    }
    setShowQuotePopup(true);
  }, [matchedJobs]);

  const handleQuoteSuccess = useCallback(() => {
    setQuoteState('success');
    setTimeout(() => setQuoteState('idle'), 3000);
  }, []);

  // GET VIDEO
  const handleVideo = useCallback(async () => {
    const phone = getWhatsAppNumber();

    if (!customerInfo.name.trim()) {
      setVideoState('error');
      setTimeout(() => setVideoState('idle'), 2000);
      return;
    }

    if (!phone) {
      setVideoState('error');
      setTimeout(() => setVideoState('idle'), 2000);
      return;
    }

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
          callSid: call?.callSid || undefined,
        }),
      });

      const result = await response.json();

      if (!response.ok || !result.success) {
        throw new Error(result.error || 'Failed to request video');
      }

      const { phone: resultPhone, whatsappMessage } = result;
      if (resultPhone && whatsappMessage) {
        const whatsAppResult = await openWhatsApp(resultPhone, whatsappMessage);

        if (!whatsAppResult.success) {
          const errorMsg = getWhatsAppErrorMessage(whatsAppResult);
          toast({
            title: errorMsg.title,
            description: errorMsg.description,
            variant: whatsAppResult.fallbackUsed ? 'default' : 'destructive',
          });
        }
      }

      setVideoState('success');
      setTimeout(() => setVideoState('idle'), 3000);

    } catch (error) {
      console.error('[CallReviewPage] GET VIDEO error:', error);
      setVideoState('error');
      setTimeout(() => setVideoState('idle'), 3000);
    }
  }, [customerInfo, detectedJobs, call?.callSid, getWhatsAppNumber, toast]);

  // BOOK VISIT
  const handleVisit = useCallback(() => {
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

    setShowVisitPopup(true);
  }, [customerInfo.name, getWhatsAppNumber]);

  const handleVisitSuccess = useCallback(() => {
    setVisitState('success');
    setTimeout(() => setVisitState('idle'), 3000);
  }, []);

  // Audio playback
  const handlePlayAudio = useCallback(() => {
    if (!call?.recordingUrl) return;

    if (audioRef) {
      if (isPlayingAudio) {
        audioRef.pause();
        setIsPlayingAudio(false);
      } else {
        audioRef.play();
        setIsPlayingAudio(true);
      }
    } else {
      const audio = new Audio(`/api/calls/${callId}/recording`);
      audio.onended = () => setIsPlayingAudio(false);
      audio.onerror = () => {
        toast({
          title: 'Playback failed',
          description: 'Could not load recording',
          variant: 'destructive',
        });
        setIsPlayingAudio(false);
      };
      audio.play();
      setIsPlayingAudio(true);
      setAudioRef(audio);
    }
  }, [call?.recordingUrl, callId, audioRef, isPlayingAudio, toast]);

  // Handle action button click
  const handleAction = (action: string) => {
    const actions: Record<string, () => void> = { quote: handleQuote, video: handleVideo, visit: handleVisit };
    actions[action]?.();
  };

  // ================================================================
  // RENDER
  // ================================================================

  if (isLoading) {
    return (
      <div className="h-full min-h-screen bg-black flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="w-8 h-8 animate-spin text-white/50" />
          <p className="text-white/40">Loading call...</p>
        </div>
      </div>
    );
  }

  if (error || !call) {
    return (
      <div className="h-full min-h-screen bg-black flex items-center justify-center">
        <div className="flex flex-col items-center gap-4 text-center">
          <AlertCircle className="w-12 h-12 text-red-500" />
          <h1 className="text-xl font-semibold text-white">{error || 'Call not found'}</h1>
          <button
            onClick={() => setLocation('/admin/calls')}
            className="flex items-center gap-2 px-4 py-2 bg-white/10 hover:bg-white/20 rounded-lg text-white transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to Calls
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full min-h-screen bg-black flex flex-col lg:flex-row">
      {/* ═══════════════════════════════════════════════════════════════════ */}
      {/* LEFT SIDE - Call Info, Jobs, Actions */}
      {/* ═══════════════════════════════════════════════════════════════════ */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* HEADER - Review Mode */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setLocation('/admin/calls')}
              className="p-2 -ml-2 hover:bg-white/10 rounded-lg transition-colors"
              title="Back to Calls"
            >
              <ArrowLeft className="w-5 h-5 text-white/60" />
            </button>
            <div className="flex items-center gap-2">
              <div className="px-2 py-1 bg-amber-500/20 border border-amber-500/50 rounded-lg">
                <span className="text-amber-400 text-xs font-semibold">REVIEW MODE</span>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-4">
            {call.duration && (
              <div className="flex items-center gap-2 text-white/50">
                <Clock className="w-4 h-4" />
                <span className="font-mono text-sm">{formatDuration(call.duration)}</span>
              </div>
            )}
            {call.startTime && (
              <div className="flex items-center gap-2 text-white/50">
                <Calendar className="w-4 h-4" />
                <span className="text-sm">{format(new Date(call.startTime), 'MMM d, HH:mm')}</span>
              </div>
            )}
          </div>
        </div>

        {/* SEGMENT TABS */}
        <div className={cn(
          "px-2 py-2 border-b",
          selectedSegment ? "border-white/10" : "border-amber-500/50 bg-amber-500/5"
        )}>
          <div className="flex items-center gap-2">
            {/* Label prompting selection when none chosen */}
            {!selectedSegment && (
              <motion.span
                className="text-xs font-medium text-amber-400 whitespace-nowrap"
                animate={{ opacity: [0.5, 1, 0.5] }}
                transition={{ duration: 2, repeat: Infinity }}
              >
                Select segment →
              </motion.span>
            )}
            <div className="flex gap-1.5 overflow-x-auto pb-1 scrollbar-hide">
              {SEGMENTS.map((seg) => {
                const isSelected = selectedSegment === seg.id;
                const Icon = seg.icon;

                return (
                  <motion.button
                    key={seg.id}
                    onClick={() => setSelectedSegment(seg.id)}
                    whileTap={{ scale: 0.95 }}
                    className={cn(
                      'relative flex items-center gap-1 px-2.5 py-2 rounded-lg',
                      'text-xs font-semibold whitespace-nowrap transition-colors',
                      isSelected ? 'text-white' : 'text-white/40',
                      !selectedSegment && 'ring-1 ring-amber-500/30' // Highlight all when none selected
                    )}
                    style={{ backgroundColor: isSelected ? seg.color : 'rgba(255,255,255,0.05)' }}
                  >
                    <Icon className="w-3.5 h-3.5" />
                    <span>{seg.label}</span>
                  </motion.button>
                );
              })}
            </div>
          </div>
        </div>

        {/* MAIN CONTENT */}
        <div className="flex-1 flex flex-col px-4 py-4 overflow-auto">
          {/* JOBS LIST */}
          <div className="bg-white/5 rounded-xl p-3 mb-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-white/60">Detected Jobs</h3>
              {call.jobSummary && (
                <span className="text-xs text-white/40 truncate max-w-[200px]">
                  {call.jobSummary}
                </span>
              )}
            </div>

            {detectedJobs.length === 0 ? (
              <p className="text-white/30 text-sm text-center py-4">No jobs detected</p>
            ) : (
              <div className="space-y-2">
                {detectedJobs.map((job) => {
                  const qty = job.quantity || 1;
                  const lineTotal = (job.sku?.pricePence || 0) * qty;
                  return (
                    <div key={job.id} className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2 min-w-0">
                        {job.trafficLight === 'red' ? (
                          <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0" />
                        ) : job.matched ? (
                          <CheckCircle2 className="w-4 h-4 text-green-500 flex-shrink-0" />
                        ) : (
                          <AlertTriangle className="w-4 h-4 text-amber-500 flex-shrink-0" />
                        )}
                        <span className={cn('text-sm truncate', job.matched ? 'text-white' : 'text-amber-400')}>
                          {qty > 1 && <span className="text-white/60">{qty}x </span>}
                          {job.description}
                        </span>
                      </div>
                      <span className={cn('text-sm font-semibold flex-shrink-0', job.matched ? 'text-green-400' : 'text-amber-400/70')}>
                        {job.matched && job.sku ? formatPrice(lineTotal) : '(video)'}
                      </span>
                    </div>
                  );
                })}
                {matchedJobs.length > 0 && (
                  <>
                    <div className="border-t border-white/10 my-2" />
                    <div className="flex items-center justify-between">
                      <span className="text-white/60 text-sm">Total</span>
                      <span className="text-xl font-bold" style={{ color: segment?.color || '#22C55E' }}>
                        {formatPrice(totalPence)}
                      </span>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>

          {/* TRANSCRIPT SECTION */}
          <div className="bg-white/5 rounded-xl p-3 mb-4 flex-1">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <MessageSquare className="w-4 h-4 text-white/50" />
                <h3 className="text-sm font-semibold text-white/60">Transcript</h3>
              </div>
              {call.recordingUrl && (
                <button
                  onClick={handlePlayAudio}
                  className={cn(
                    'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors',
                    isPlayingAudio
                      ? 'bg-amber-500/20 text-amber-400'
                      : 'bg-white/10 text-white/60 hover:bg-white/20'
                  )}
                >
                  {isPlayingAudio ? (
                    <>
                      <Pause className="w-3.5 h-3.5" />
                      Pause
                    </>
                  ) : (
                    <>
                      <Play className="w-3.5 h-3.5" />
                      Play
                    </>
                  )}
                </button>
              )}
            </div>

            <div className="max-h-[300px] overflow-y-auto pr-2">
              {call.transcription ? (
                <p className="text-sm text-white/80 whitespace-pre-wrap leading-relaxed">
                  {call.transcription}
                </p>
              ) : (
                <p className="text-white/30 text-sm text-center py-8">No transcript available</p>
              )}
            </div>
          </div>
        </div>

        {/* AVAILABILITY PANEL */}
        <div className="px-3 py-2">
          <AvailabilityPanel defaultExpanded={false} />
        </div>

        {/* ACTION BUTTONS */}
        <div className="px-3 py-3 border-t border-white/10">
          {/* Route Recommendation */}
          <div className="flex items-center gap-2 mb-2">
            <div
              className={cn(
                'w-2 h-2 rounded-full',
                allGreen ? 'bg-green-500' : hasAmber ? 'bg-amber-500' : 'bg-blue-500'
              )}
            />
            <span className="text-xs text-white/60">
              {allGreen && detectedJobs.length > 0 ? (
                <span className="text-green-400 font-medium">SEND QUOTE</span>
              ) : hasAmber ? (
                <span className="text-amber-400 font-medium">GET VIDEO</span>
              ) : detectedJobs.length > 0 ? (
                <span className="text-blue-400 font-medium">BOOK VISIT</span>
              ) : (
                <span className="text-white/40">No jobs detected</span>
              )}
              {detectedJobs.length > 0 && (
                <span className="text-white/40 ml-2">
                  {allGreen ? `All ${greenJobs.length} jobs priced` :
                   hasAmber ? `${amberJobs.length} job${amberJobs.length > 1 ? 's' : ''} need video` :
                   'Site visit needed'}
                </span>
              )}
            </span>
          </div>

          {/* ACTION BUTTONS */}
          <div className="grid grid-cols-3 gap-2">
            {(['quote', 'video', 'visit'] as const).map((action) => {
              const config = ACTION_CONFIG[action];
              const Icon = config.icon;

              // Determine AI recommended action
              let aiRecommendedAction: 'quote' | 'video' | 'visit' | null = null;
              if (hasRed) {
                aiRecommendedAction = 'visit';
              } else if (hasAmber) {
                aiRecommendedAction = 'video';
              } else if (allGreen && detectedJobs.length > 0) {
                aiRecommendedAction = 'quote';
              }

              const isAiPick = aiRecommendedAction === action;

              // Get the state for this action
              const stateMap = { quote: quoteState, video: videoState, visit: visitState };
              const state = stateMap[action];

              // Button enable/disable logic
              let isDisabled = state === 'pending';
              let disabledReason = '';

              if (action === 'quote') {
                const canQuote = detectedJobs.length > 0 && allGreen;
                isDisabled = isDisabled || !canQuote;
                if (hasRed) {
                  disabledReason = 'Site visit required';
                } else if (hasAmber) {
                  disabledReason = 'Video needed first';
                } else if (detectedJobs.length === 0) {
                  disabledReason = 'No jobs detected';
                }
              } else if (action === 'video') {
                const canVideo = hasAmber && !hasRed;
                isDisabled = isDisabled || !canVideo;
                if (hasRed) {
                  disabledReason = 'Site visit required';
                } else if (allGreen) {
                  disabledReason = 'All jobs priced';
                } else if (detectedJobs.length === 0) {
                  disabledReason = 'No jobs detected';
                }
              } else if (action === 'visit') {
                const canVisit = hasRed || (detectedJobs.length > 0 && !allGreen && !hasAmber);
                isDisabled = isDisabled || !canVisit;
                if (allGreen) {
                  disabledReason = 'All jobs priced';
                } else if (hasAmber && !hasRed) {
                  disabledReason = 'Try video first';
                } else if (detectedJobs.length === 0) {
                  disabledReason = 'No jobs detected';
                }
              }

              // Determine button appearance based on state
              const isSuccess = state === 'success';
              const isError = state === 'error';
              const isPending = state === 'pending';

              // Get background color based on state
              const getBgColor = () => {
                if (isDisabled && !isPending) return '#1a1a1a';
                if (isSuccess) return '#16A34A';
                if (isError) return '#DC2626';
                return config.color;
              };

              return (
                <div key={action} className="flex flex-col items-center gap-1">
                  <motion.button
                    onClick={() => handleAction(action)}
                    disabled={isDisabled}
                    whileTap={{ scale: isDisabled ? 1 : 0.95 }}
                    className={cn(
                      'relative w-full flex flex-col items-center justify-center gap-1',
                      'py-3 rounded-xl font-semibold text-xs transition-all',
                      isDisabled && !isPending && 'opacity-30 cursor-not-allowed'
                    )}
                    style={{
                      backgroundColor: getBgColor(),
                      color: 'white',
                    }}
                  >
                    {/* AI Pick pulsing border */}
                    {isAiPick && !isDisabled && !isPending && !isSuccess && !isError && (
                      <motion.div
                        className="absolute inset-0 rounded-xl pointer-events-none"
                        style={{ border: `2px solid ${config.color}` }}
                        animate={{ opacity: [0.4, 1, 0.4] }}
                        transition={{ duration: 1.2, repeat: Infinity }}
                      />
                    )}
                    {isPending ? (
                      <Loader2 className="w-5 h-5 animate-spin" />
                    ) : isSuccess ? (
                      <CheckCircle className="w-5 h-5" />
                    ) : isError ? (
                      <AlertCircle className="w-5 h-5" />
                    ) : (
                      <Icon className="w-5 h-5" />
                    )}
                    <span>
                      {isPending ? 'SENDING...' : isSuccess ? 'SENT!' : isError ? 'FAILED' : config.label}
                    </span>
                  </motion.button>
                  {isDisabled && disabledReason && !isPending && (
                    <span className="text-[10px] text-white/40 text-center leading-tight">
                      {disabledReason}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════════════════ */}
      {/* RIGHT SIDE - Customer Info */}
      {/* ═══════════════════════════════════════════════════════════════════ */}
      <div className="w-full lg:w-80 border-t lg:border-t-0 lg:border-l border-white/10 bg-white/[0.02] p-4 flex flex-col gap-4">
        <h2 className="text-white/60 text-xs font-semibold uppercase tracking-wider">Customer Info</h2>

        {/* NAME */}
        <div>
          <label className="flex items-center gap-2 text-white/40 text-xs mb-1.5">
            <User className="w-3.5 h-3.5" />
            Name
          </label>
          <input
            type="text"
            value={customerInfo.name}
            onChange={(e) => updateInfo({ name: e.target.value })}
            placeholder="Customer name..."
            className={cn(
              "w-full bg-white/5 border rounded-lg px-3 py-2.5 text-sm text-white placeholder:text-white/30",
              "focus:outline-none focus:ring-2 focus:ring-white/20",
              hasName ? "border-green-500/50" : "border-white/10"
            )}
          />
        </div>

        {/* WHATSAPP */}
        <div>
          <label className="flex items-center gap-2 text-white/40 text-xs mb-1.5">
            <Phone className="w-3.5 h-3.5" />
            WhatsApp Number
          </label>
          {call.phoneNumber && (
            <p className="text-white/30 text-xs mb-2">Calling from: {call.phoneNumber}</p>
          )}
          <div className="space-y-2">
            <button
              onClick={() => updateInfo({ whatsappSameAsCalling: true, whatsappNumber: '' })}
              className={cn(
                "w-full flex items-center gap-2 px-3 py-2.5 rounded-lg text-sm transition-colors",
                customerInfo.whatsappSameAsCalling === true
                  ? "bg-green-500/20 border border-green-500/50 text-green-400"
                  : "bg-white/5 border border-white/10 text-white/60 hover:bg-white/10"
              )}
            >
              <div className={cn(
                "w-4 h-4 rounded-full border-2 flex items-center justify-center",
                customerInfo.whatsappSameAsCalling === true ? "border-green-500" : "border-white/30"
              )}>
                {customerInfo.whatsappSameAsCalling === true && <div className="w-2 h-2 rounded-full bg-green-500" />}
              </div>
              Same as calling number
            </button>
            <button
              onClick={() => updateInfo({ whatsappSameAsCalling: false })}
              className={cn(
                "w-full flex items-center gap-2 px-3 py-2.5 rounded-lg text-sm transition-colors",
                customerInfo.whatsappSameAsCalling === false
                  ? "bg-amber-500/20 border border-amber-500/50 text-amber-400"
                  : "bg-white/5 border border-white/10 text-white/60 hover:bg-white/10"
              )}
            >
              <div className={cn(
                "w-4 h-4 rounded-full border-2 flex items-center justify-center",
                customerInfo.whatsappSameAsCalling === false ? "border-amber-500" : "border-white/30"
              )}>
                {customerInfo.whatsappSameAsCalling === false && <div className="w-2 h-2 rounded-full bg-amber-500" />}
              </div>
              Different number
            </button>
            {customerInfo.whatsappSameAsCalling === false && (
              <input
                type="tel"
                value={customerInfo.whatsappNumber}
                onChange={(e) => updateInfo({ whatsappNumber: e.target.value })}
                placeholder="WhatsApp number..."
                className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-sm text-white placeholder:text-white/30 focus:outline-none focus:ring-2 focus:ring-white/20"
              />
            )}
          </div>
        </div>

        {/* ADDRESS */}
        <div>
          <label className="flex items-center gap-2 text-white/40 text-xs mb-1.5">
            <MapPinned className="w-3.5 h-3.5" />
            Property Address
          </label>
          <textarea
            value={customerInfo.address}
            onChange={(e) => updateInfo({ address: e.target.value })}
            placeholder="Full address..."
            rows={3}
            className={cn(
              "w-full bg-white/5 border rounded-lg px-3 py-2.5 text-sm text-white placeholder:text-white/30 resize-none",
              "focus:outline-none focus:ring-2 focus:ring-white/20",
              hasAddress ? "border-green-500/50" : "border-white/10"
            )}
          />
          {call.postcode && (
            <p className="text-white/30 text-xs mt-1">Postcode: {call.postcode}</p>
          )}
        </div>

        {/* CALL METADATA */}
        <div className="mt-auto pt-4 border-t border-white/10 space-y-2">
          {call.outcome && (
            <div className="flex items-center justify-between text-xs">
              <span className="text-white/40">Outcome:</span>
              <span className="text-white/70">{call.outcome.replace(/_/g, ' ')}</span>
            </div>
          )}
          {call.leadType && (
            <div className="flex items-center justify-between text-xs">
              <span className="text-white/40">Lead Type:</span>
              <span className="text-white/70">{call.leadType}</span>
            </div>
          )}
          {call.urgency && (
            <div className="flex items-center justify-between text-xs">
              <span className="text-white/40">Urgency:</span>
              <span className={cn(
                "px-2 py-0.5 rounded text-xs",
                call.urgency === 'Critical' || call.urgency === 'Emergency' ? 'bg-red-500/20 text-red-400' :
                call.urgency === 'High' ? 'bg-amber-500/20 text-amber-400' :
                'bg-white/10 text-white/60'
              )}>
                {call.urgency}
              </span>
            </div>
          )}
        </div>

        {/* STATUS */}
        <div className={cn(
          "flex items-center justify-center gap-2 py-3 rounded-lg text-sm font-medium",
          infoComplete ? "bg-green-500/20 text-green-400" : "bg-white/5 text-white/40"
        )}>
          {infoComplete ? (
            <>
              <Check className="w-4 h-4" />
              Ready to send
            </>
          ) : (
            <>
              <HelpCircle className="w-4 h-4" />
              Complete info above
            </>
          )}
        </div>
      </div>

      {/* POPUPS */}
      <QuoteSendPopup
        isOpen={showQuotePopup}
        onClose={() => setShowQuotePopup(false)}
        onSuccess={handleQuoteSuccess}
        customerName={customerInfo.name}
        whatsappNumber={getWhatsAppNumber() || call.phoneNumber || ''}
        address={customerInfo.address}
        segment={selectedSegment}
        jobs={detectedJobs}
        callSid={call.callSid || undefined}
      />

      <BookVisitPopup
        isOpen={showVisitPopup}
        onClose={() => setShowVisitPopup(false)}
        onSuccess={handleVisitSuccess}
        customerName={customerInfo.name}
        whatsappNumber={getWhatsAppNumber() || call.phoneNumber || ''}
        address={customerInfo.address}
        jobs={detectedJobs}
        callSid={call.callSid || undefined}
      />
    </div>
  );
}
