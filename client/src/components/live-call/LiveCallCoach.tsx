/**
 * LiveCallCoach - Main VA Interface Component
 *
 * This is the primary interface for the Virtual Assistant during live calls.
 * It replaces LiveCallTubeMap with a streamlined, coach-focused layout.
 *
 * Layout:
 * ┌──────────────────────────────────────────────────────────────────┐
 * │  LIVE   +447700...0123                              00:42       │
 * ├──────────────────────────────────────────────────────────────────┤
 * │  ┌─ LIVE TRANSCRIPT ─────────────────────────────────────────┐  │
 * │  │ (LiveTranscriptPanel - auto-scrolling conversation)       │  │
 * │  └───────────────────────────────────────────────────────────┘  │
 * │                                                                  │
 * │  ┌─ DETECTED ─────────────────────────────────────────────────┐  │
 * │  │ (DetectionCard - segment, jobs, route in one card)         │  │
 * │  └───────────────────────────────────────────────────────────┘  │
 * │                                                                  │
 * │  ┌─ SAY THIS ─────────────────────────────────────────────────┐  │
 * │  │ (TeleprompterPanel - current script + tip)                 │  │
 * │  └───────────────────────────────────────────────────────────┘  │
 * │                                                                  │
 * │  ┌─ ACTIONS ──────────────────────────────────────────────────┐  │
 * │  │  [Send Instant Quote]  [Request Video]  [Book Site Visit]  │  │
 * │  │  Recommended: Send Instant Quote (all jobs matched)        │  │
 * │  └───────────────────────────────────────────────────────────┘  │
 * ├──────────────────────────────────────────────────────────────────┤
 * │  Name: John   Postcode: SW9   Contact   Job   SKU              │
 * │  Ask: "What's the best number to reach you?"                    │
 * └──────────────────────────────────────────────────────────────────┘
 */

import React, { useMemo } from 'react';
import { motion } from 'framer-motion';
import {
  PhoneOff,
  FileText,
  Video,
  MapPin,
  CheckCircle2,
  Circle,
  AlertTriangle,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { CallScriptSegment } from '@shared/schema';

// Import sub-components
import { LiveTranscriptPanel, type TranscriptSegment } from './LiveTranscriptPanel';
import { DetectionCard, type DetectionJob } from './DetectionCard';
import { TeleprompterPanel } from './TeleprompterPanel';

// ============================================================================
// Types
// ============================================================================

export interface LiveCallCoachProps {
  // Call info
  phoneNumber: string;
  callDuration: number;

  // Transcript
  segments: TranscriptSegment[];
  interimTranscript?: string;

  // Segment detection
  segment: CallScriptSegment | null;
  segmentConfidence: number;
  segmentSignals: string[];
  segmentAlternatives?: Array<{
    segment: CallScriptSegment;
    confidence: number;
  }>;
  onSegmentOverride: (segment: CallScriptSegment) => void;

  // Jobs
  detectedJobs: Array<{
    id: string;
    description: string;
    matched: boolean;
    sku?: { name: string; pricePence: number };
    confidence?: number;
  }>;

  // Route
  recommendedRoute: 'INSTANT_QUOTE' | 'VIDEO_REQUEST' | 'SITE_VISIT' | null;
  routeReason?: string;

  // Captured info
  capturedInfo: {
    name?: string | null;
    postcode?: string | null;
    contact?: string | null;
    job?: string | null;
  };

  // Script/Teleprompter - used by the real TeleprompterPanel
  currentTrigger?: 'segment_detected' | 'route_ready' | 'closing';
  jobPricePence?: number;
  estimatedTime?: string;

  // Actions
  onSendQuote: () => void;
  onRequestVideo: () => void;
  onBookVisit: () => void;
  onEndCall: () => void;

  className?: string;
}

// ============================================================================
// Constants
// ============================================================================

// Missing info prompts - ordered by priority
const MISSING_INFO_PROMPTS: Record<string, string> = {
  postcode: "What's your postcode so I can check we cover your area?",
  name: "Can I get your name please?",
  contact: "What's the best number to reach you on?",
  job: "What needs fixing?",
};

// Action button configuration
interface ActionButtonConfig {
  id: string;
  label: string;
  icon: LucideIcon;
  color: string;
  hoverColor: string;
  route: 'INSTANT_QUOTE' | 'VIDEO_REQUEST' | 'SITE_VISIT';
}

const ACTION_BUTTONS: ActionButtonConfig[] = [
  {
    id: 'instant',
    label: 'Send Instant Quote',
    icon: FileText,
    color: 'bg-green-600',
    hoverColor: 'hover:bg-green-500',
    route: 'INSTANT_QUOTE',
  },
  {
    id: 'video',
    label: 'Request Video',
    icon: Video,
    color: 'bg-amber-600',
    hoverColor: 'hover:bg-amber-500',
    route: 'VIDEO_REQUEST',
  },
  {
    id: 'visit',
    label: 'Book Site Visit',
    icon: MapPin,
    color: 'bg-blue-600',
    hoverColor: 'hover:bg-blue-500',
    route: 'SITE_VISIT',
  },
];

// Route recommendation messages
const ROUTE_RECOMMENDATION_MESSAGES: Record<string, string> = {
  INSTANT_QUOTE: 'All jobs have SKU matches - ready to quote',
  VIDEO_REQUEST: 'Some jobs need visual confirmation before pricing',
  SITE_VISIT: 'Complex job requires on-site assessment',
};

// Helper to get missing fields for TeleprompterPanel
function getMissingFields(
  capturedInfo: LiveCallCoachProps['capturedInfo']
): string[] {
  const fields: string[] = [];
  if (!capturedInfo.postcode) fields.push('postcode');
  if (!capturedInfo.name) fields.push('name');
  if (!capturedInfo.contact) fields.push('contact');
  if (!capturedInfo.job) fields.push('job');
  return fields;
}

// ============================================================================
// Sub-Components
// ============================================================================

/**
 * Pulsing call indicator
 */
function CallPulse() {
  return (
    <div className="relative">
      <motion.div
        className="absolute inset-0 rounded-full bg-green-500"
        animate={{ scale: [1, 1.8, 1], opacity: [0.5, 0, 0.5] }}
        transition={{ duration: 1.5, repeat: Infinity }}
      />
      <div className="relative w-3 h-3 rounded-full bg-green-500" />
    </div>
  );
}

/**
 * Call header with phone number and duration
 */
interface CallHeaderProps {
  phoneNumber: string;
  callDuration: number;
  onEndCall: () => void;
}

function CallHeader({ phoneNumber, callDuration, onEndCall }: CallHeaderProps) {
  // Format duration as MM:SS
  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  // Redact phone number for privacy (show first 7 and last 4 digits)
  const redactPhone = (phone: string) => {
    const digits = phone.replace(/\D/g, '');
    if (digits.length <= 11) return phone;
    return `+${digits.slice(0, 6)}...${digits.slice(-4)}`;
  };

  return (
    <div className="sticky top-0 z-50 bg-[#0a0a0f]/95 backdrop-blur border-b border-white/10">
      <div className="px-6 py-4">
        <div className="flex items-center justify-between">
          {/* Left: Live indicator + Phone */}
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-green-500/20 border border-green-500/30">
              <CallPulse />
              <span className="text-xs font-bold text-green-400 uppercase tracking-wider">
                LIVE
              </span>
            </div>
            <span className="font-mono text-lg text-white tracking-wide">
              {redactPhone(phoneNumber)}
            </span>
          </div>

          {/* Right: Duration + End Call */}
          <div className="flex items-center gap-4">
            <div className="text-right">
              <div className="font-mono text-3xl font-light text-white/90 tracking-wider">
                {formatDuration(callDuration)}
              </div>
            </div>
            <button
              onClick={onEndCall}
              className={cn(
                'flex items-center gap-2 px-4 py-2 rounded-lg',
                'bg-red-600/20 border border-red-500/30',
                'text-red-400 hover:bg-red-600/30 hover:text-red-300',
                'transition-colors duration-150'
              )}
            >
              <PhoneOff className="w-4 h-4" />
              <span className="text-sm font-medium">End</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Action Buttons Panel
 */
interface ActionsPanelProps {
  recommendedRoute: 'INSTANT_QUOTE' | 'VIDEO_REQUEST' | 'SITE_VISIT' | null;
  detectedJobs: LiveCallCoachProps['detectedJobs'];
  onSendQuote: () => void;
  onRequestVideo: () => void;
  onBookVisit: () => void;
  className?: string;
}

function ActionsPanel({
  recommendedRoute,
  detectedJobs,
  onSendQuote,
  onRequestVideo,
  onBookVisit,
  className,
}: ActionsPanelProps) {
  // Check if all jobs are matched for instant quote eligibility
  const allJobsMatched = detectedJobs.length > 0 && detectedJobs.every((j) => j.matched);
  const hasJobs = detectedJobs.length > 0;

  // Get action handler by route
  const getActionHandler = (route: string) => {
    switch (route) {
      case 'INSTANT_QUOTE':
        return onSendQuote;
      case 'VIDEO_REQUEST':
        return onRequestVideo;
      case 'SITE_VISIT':
        return onBookVisit;
      default:
        return () => {};
    }
  };

  // Determine if button should be disabled
  const isButtonDisabled = (button: ActionButtonConfig) => {
    // Instant quote requires all jobs to be matched
    if (button.route === 'INSTANT_QUOTE') {
      return !allJobsMatched;
    }
    // Other actions just need at least one job
    return !hasJobs;
  };

  // Get recommendation message
  const recommendationMessage = recommendedRoute
    ? ROUTE_RECOMMENDATION_MESSAGES[recommendedRoute]
    : 'Listening for job details...';

  return (
    <div
      className={cn(
        'bg-[#12121a] border border-white/10 rounded-xl overflow-hidden',
        className
      )}
    >
      {/* Header */}
      <div className="px-4 py-3 border-b border-white/10 flex items-center gap-2">
        <span className="text-lg">🎬</span>
        <span className="text-sm font-semibold text-white tracking-wide">
          ACTIONS
        </span>
      </div>

      {/* Action Buttons */}
      <div className="p-4">
        <div className="flex gap-3 flex-wrap">
          {ACTION_BUTTONS.map((button) => {
            const Icon = button.icon;
            const isRecommended = recommendedRoute === button.route;
            const isDisabled = isButtonDisabled(button);
            const handler = getActionHandler(button.route);

            return (
              <button
                key={button.id}
                onClick={handler}
                disabled={isDisabled}
                className={cn(
                  'flex items-center gap-2 px-4 py-3 rounded-lg',
                  'font-medium text-sm transition-all duration-150',
                  isDisabled
                    ? 'bg-white/5 text-white/30 cursor-not-allowed'
                    : cn(button.color, button.hoverColor, 'text-white shadow-lg'),
                  isRecommended && !isDisabled && 'ring-2 ring-white/30 ring-offset-2 ring-offset-[#12121a]'
                )}
              >
                <Icon className="w-5 h-5" />
                <span>{button.label}</span>
              </button>
            );
          })}
        </div>

        {/* Recommendation */}
        <div className="mt-4 pt-3 border-t border-white/5">
          <div className="flex items-center gap-2">
            {recommendedRoute ? (
              <>
                <CheckCircle2 className="w-4 h-4 text-green-400" />
                <span className="text-sm text-white/70">
                  <span className="text-green-400 font-medium">Recommended:</span>{' '}
                  {recommendationMessage}
                </span>
              </>
            ) : (
              <>
                <Circle className="w-4 h-4 text-white/30" />
                <span className="text-sm text-white/40 italic">
                  {recommendationMessage}
                </span>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Missing Info Footer
 */
interface MissingInfoFooterProps {
  capturedInfo: LiveCallCoachProps['capturedInfo'];
  skuMatched: boolean;
}

function MissingInfoFooter({ capturedInfo, skuMatched }: MissingInfoFooterProps) {
  // Info fields to display
  const infoFields = [
    { key: 'name', label: 'Name', value: capturedInfo.name },
    { key: 'postcode', label: 'Postcode', value: capturedInfo.postcode },
    { key: 'contact', label: 'Contact', value: capturedInfo.contact },
    { key: 'job', label: 'Job', value: capturedInfo.job },
    { key: 'sku', label: 'SKU', value: skuMatched ? 'matched' : null },
  ];

  // Find the first missing info field (by priority)
  const missingFieldPriority = ['postcode', 'name', 'contact', 'job'];
  const firstMissing = missingFieldPriority.find((key) => {
    if (key === 'sku') return !skuMatched;
    return !capturedInfo[key as keyof typeof capturedInfo];
  });

  const missingPrompt = firstMissing ? MISSING_INFO_PROMPTS[firstMissing] : null;

  return (
    <div className="sticky bottom-0 bg-[#0a0a0f]/95 backdrop-blur border-t border-white/10">
      <div className="px-6 py-3">
        {/* Info Status */}
        <div className="flex items-center justify-center gap-4 flex-wrap">
          {infoFields.map(({ key, label, value }) => (
            <div
              key={key}
              className={cn(
                'flex items-center gap-2 px-3 py-1.5 rounded-lg border transition-all',
                value
                  ? 'border-green-500/50 bg-green-500/10 text-green-400'
                  : 'border-white/10 bg-white/5 text-white/40'
              )}
            >
              {value ? (
                <CheckCircle2 className="h-4 w-4" />
              ) : (
                <Circle className="h-4 w-4" />
              )}
              <span className="text-sm font-medium">{label}</span>
              {value && key === 'name' && typeof value === 'string' && (
                <span className="text-xs text-green-300/70 max-w-[80px] truncate">
                  {value}
                </span>
              )}
            </div>
          ))}
        </div>

        {/* Missing Info Prompt */}
        {missingPrompt && (
          <div className="mt-3 flex items-center justify-center gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-400" />
            <span className="text-sm text-amber-200">
              <span className="font-medium">Ask:</span> "{missingPrompt}"
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================================================
// Main Component
// ============================================================================

export function LiveCallCoach({
  phoneNumber,
  callDuration,
  segments,
  interimTranscript,
  segment,
  segmentConfidence,
  segmentSignals,
  segmentAlternatives = [],
  onSegmentOverride,
  detectedJobs,
  recommendedRoute,
  routeReason,
  capturedInfo,
  currentTrigger = 'segment_detected',
  jobPricePence,
  estimatedTime,
  onSendQuote,
  onRequestVideo,
  onBookVisit,
  onEndCall,
  className,
}: LiveCallCoachProps) {
  // Convert detectedJobs to DetectionJob format for DetectionCard
  const detectionJobs: DetectionJob[] = useMemo(
    () =>
      detectedJobs.map((job) => ({
        id: job.id,
        description: job.description,
        matched: job.matched,
        sku: job.sku
          ? {
              name: job.sku.name,
              pricePence: job.sku.pricePence,
            }
          : undefined,
        confidence: job.confidence,
      })),
    [detectedJobs]
  );

  // Check if any SKU is matched
  const skuMatched = detectedJobs.some((j) => j.matched);

  // Highlight keywords from segment signals for transcript
  const highlightKeywords = useMemo(() => segmentSignals, [segmentSignals]);

  return (
    <div
      className={cn(
        'h-full flex flex-col bg-[#0a0a0f] text-white overflow-hidden',
        className
      )}
    >
      {/* ═══════════════════════════════════════════════════════════════════════ */}
      {/* Header */}
      {/* ═══════════════════════════════════════════════════════════════════════ */}
      <CallHeader
        phoneNumber={phoneNumber}
        callDuration={callDuration}
        onEndCall={onEndCall}
      />

      {/* ═══════════════════════════════════════════════════════════════════════ */}
      {/* Main Content - Scrollable */}
      {/* ═══════════════════════════════════════════════════════════════════════ */}
      <div className="flex-1 overflow-y-auto">
        <div className="p-6 space-y-4">
          {/* Live Transcript Panel */}
          <LiveTranscriptPanel
            segments={segments}
            interimTranscript={interimTranscript}
            highlightKeywords={highlightKeywords}
            maxHeight="250px"
          />

          {/* Detection Card */}
          <DetectionCard
            segment={segment}
            segmentConfidence={segmentConfidence}
            segmentSignals={segmentSignals}
            segmentAlternatives={segmentAlternatives}
            onSegmentOverride={onSegmentOverride}
            jobs={detectionJobs}
            recommendedRoute={recommendedRoute}
            routeReason={routeReason}
          />

          {/* Teleprompter Panel - This should be the LARGEST section */}
          <TeleprompterPanel
            segment={segment}
            route={recommendedRoute}
            jobPrice={jobPricePence}
            currentTrigger={currentTrigger}
            estimatedTime={estimatedTime}
            missingFields={getMissingFields(capturedInfo)}
          />

          {/* Actions Panel */}
          <ActionsPanel
            recommendedRoute={recommendedRoute}
            detectedJobs={detectedJobs}
            onSendQuote={onSendQuote}
            onRequestVideo={onRequestVideo}
            onBookVisit={onBookVisit}
          />
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════════════════════ */}
      {/* Footer - Missing Info */}
      {/* ═══════════════════════════════════════════════════════════════════════ */}
      <MissingInfoFooter capturedInfo={capturedInfo} skuMatched={skuMatched} />
    </div>
  );
}

export default LiveCallCoach;
