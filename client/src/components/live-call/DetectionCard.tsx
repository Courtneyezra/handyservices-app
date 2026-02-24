/**
 * DetectionCard Component
 *
 * Unified card showing segment detection, jobs detected, and route recommendation.
 * Designed for the live call interface with a dark theme.
 *
 * Layout:
 * ┌─ DETECTED ─────────────────────────────────────────────┐
 * │  SEGMENT: LANDLORD (92%)        [Override ▼]          │
 * │  Signals: "rental property", "tenant"                 │
 * │  ───────────────────────────────────────────────────  │
 * │  JOBS:                                                │
 * │  ├─ ✅ Leak Repair → £85-£145     [SKU Matched]       │
 * │  └─ ⚠️  "Boiler service" → needs video                │
 * │  Total (matched): £85-£145                            │
 * │  ───────────────────────────────────────────────────  │
 * │  ROUTE: VIDEO QUOTE                                   │
 * │  "1 job needs visual confirmation before pricing"     │
 * └───────────────────────────────────────────────────────┘
 */

import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Target,
  ChevronDown,
  CheckCircle2,
  AlertTriangle,
  FileText,
  Video,
  MapPin,
  Zap,
  LogOut,
  Package,
  PoundSterling,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { CallScriptSegment } from '@shared/schema';

// ============================================================================
// Types
// ============================================================================

export interface DetectionJob {
  id: string;
  description: string;
  matched: boolean;
  sku?: {
    name: string;
    pricePence: number;
    priceRangePence?: [number, number];
  };
  confidence?: number;
}

export interface DetectionCardProps {
  // Segment
  segment: CallScriptSegment | null;
  segmentConfidence: number;
  segmentSignals: string[];
  segmentAlternatives?: Array<{
    segment: CallScriptSegment;
    confidence: number;
  }>;
  onSegmentOverride?: (segment: CallScriptSegment) => void;

  // Jobs
  jobs: DetectionJob[];

  // Route
  recommendedRoute: 'INSTANT_QUOTE' | 'VIDEO_REQUEST' | 'SITE_VISIT' | null;
  routeReason?: string;

  className?: string;
}

// ============================================================================
// Constants
// ============================================================================

const SEGMENT_COLORS: Record<CallScriptSegment, string> = {
  EMERGENCY: '#E32017',
  LANDLORD: '#FF6600',
  PROP_MGR: '#00843D',
  BUSY_PRO: '#FFD300',
  SMALL_BIZ: '#9B0058',
  OAP: '#0019A8',
  BUDGET: '#A0A5A9',
};

const SEGMENT_LABELS: Record<CallScriptSegment, string> = {
  EMERGENCY: 'Emergency',
  LANDLORD: 'Landlord',
  PROP_MGR: 'Property Manager',
  BUSY_PRO: 'Busy Professional',
  SMALL_BIZ: 'Small Business',
  OAP: 'OAP',
  BUDGET: 'Budget',
};

const ROUTE_CONFIG = {
  INSTANT_QUOTE: {
    color: '#22C55E',
    icon: FileText,
    label: 'Instant Quote',
    emoji: '',
  },
  VIDEO_REQUEST: {
    color: '#EAB308',
    icon: Video,
    label: 'Video Quote',
    emoji: '',
  },
  SITE_VISIT: {
    color: '#3B82F6',
    icon: MapPin,
    label: 'Site Visit',
    emoji: '',
  },
} as const;

// ============================================================================
// Helper Functions
// ============================================================================

function formatPrice(pence: number): string {
  return `£${(pence / 100).toFixed(0)}`;
}

function formatPriceRange(min: number, max: number): string {
  return `£${(min / 100).toFixed(0)}-£${(max / 100).toFixed(0)}`;
}

function getDefaultRouteReason(
  route: 'INSTANT_QUOTE' | 'VIDEO_REQUEST' | 'SITE_VISIT' | null,
  jobs: DetectionJob[]
): string {
  if (!route || jobs.length === 0) {
    return 'Listening for job details...';
  }

  const unmatchedCount = jobs.filter((j) => !j.matched).length;
  const matchedCount = jobs.filter((j) => j.matched).length;

  switch (route) {
    case 'INSTANT_QUOTE':
      return `All ${matchedCount} job${matchedCount !== 1 ? 's' : ''} have SKU matches`;
    case 'VIDEO_REQUEST':
      return `${unmatchedCount} job${unmatchedCount !== 1 ? 's' : ''} need${unmatchedCount === 1 ? 's' : ''} visual confirmation`;
    case 'SITE_VISIT':
      return 'Complex job requires on-site assessment';
    default:
      return '';
  }
}

// ============================================================================
// Sub-Components
// ============================================================================

interface SegmentDropdownProps {
  currentSegment: CallScriptSegment | null;
  alternatives: Array<{ segment: CallScriptSegment; confidence: number }>;
  onSelect: (segment: CallScriptSegment) => void;
  isOpen: boolean;
  onToggle: () => void;
}

function SegmentDropdown({
  currentSegment,
  alternatives,
  onSelect,
  isOpen,
  onToggle,
}: SegmentDropdownProps) {
  const allOptions = alternatives.filter((a) => a.segment !== currentSegment);

  if (allOptions.length === 0) return null;

  return (
    <div className="relative">
      <button
        onClick={onToggle}
        className={cn(
          'flex items-center gap-1 px-2 py-1 rounded text-xs',
          'bg-white/10 hover:bg-white/20 transition-colors',
          'text-white/70 hover:text-white'
        )}
      >
        <span>Override</span>
        <ChevronDown
          className={cn('w-3 h-3 transition-transform', isOpen && 'rotate-180')}
        />
      </button>

      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.15 }}
            className={cn(
              'absolute right-0 top-full mt-1 z-50',
              'bg-[#1a1a24] border border-white/20 rounded-lg shadow-xl',
              'min-w-[180px] py-1'
            )}
          >
            {allOptions.map(({ segment, confidence }) => (
              <button
                key={segment}
                onClick={() => {
                  onSelect(segment);
                  onToggle();
                }}
                className={cn(
                  'w-full px-3 py-2 text-left text-sm',
                  'hover:bg-white/10 transition-colors',
                  'flex items-center justify-between gap-2'
                )}
              >
                <div className="flex items-center gap-2">
                  <div
                    className="w-3 h-3 rounded-full"
                    style={{ backgroundColor: SEGMENT_COLORS[segment] }}
                  />
                  <span className="text-white">{SEGMENT_LABELS[segment]}</span>
                </div>
                <span className="text-white/50 text-xs">{confidence}%</span>
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ============================================================================
// Main Component
// ============================================================================

export function DetectionCard({
  segment,
  segmentConfidence,
  segmentSignals,
  segmentAlternatives = [],
  onSegmentOverride,
  jobs,
  recommendedRoute,
  routeReason,
  className,
}: DetectionCardProps) {
  const [dropdownOpen, setDropdownOpen] = useState(false);

  // Calculations
  const matchedJobs = jobs.filter((j) => j.matched && j.sku);
  const unmatchedJobs = jobs.filter((j) => !j.matched);

  // Calculate total price (use min of range if available)
  const totalMinPence = matchedJobs.reduce((sum, j) => {
    if (j.sku?.priceRangePence) {
      return sum + j.sku.priceRangePence[0];
    }
    return sum + (j.sku?.pricePence || 0);
  }, 0);

  const totalMaxPence = matchedJobs.reduce((sum, j) => {
    if (j.sku?.priceRangePence) {
      return sum + j.sku.priceRangePence[1];
    }
    return sum + (j.sku?.pricePence || 0);
  }, 0);

  const hasRange = totalMinPence !== totalMaxPence;

  // Route config
  const routeConfig = recommendedRoute ? ROUTE_CONFIG[recommendedRoute] : null;
  const RouteIcon = routeConfig?.icon || FileText;
  const displayReason =
    routeReason || getDefaultRouteReason(recommendedRoute, jobs);

  // Handle segment override
  const handleSegmentOverride = (newSegment: CallScriptSegment) => {
    if (onSegmentOverride) {
      onSegmentOverride(newSegment);
    }
  };

  return (
    <div
      className={cn(
        'bg-[#12121a] border border-white/10 rounded-xl overflow-hidden',
        className
      )}
    >
      {/* ═══════════════════════════════════════════════════════════════════ */}
      {/* Header */}
      {/* ═══════════════════════════════════════════════════════════════════ */}
      <div className="px-4 py-3 border-b border-white/10 flex items-center gap-2">
        <Target className="w-4 h-4 text-white/60" />
        <span className="text-sm font-semibold text-white tracking-wide">
          DETECTED
        </span>
      </div>

      {/* ═══════════════════════════════════════════════════════════════════ */}
      {/* Segment Section */}
      {/* ═══════════════════════════════════════════════════════════════════ */}
      <div className="px-4 py-3 border-b border-white/5">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <span className="text-xs text-white/50 uppercase tracking-wider">
              Segment:
            </span>
            {segment ? (
              <div className="flex items-center gap-2">
                <div
                  className="w-3 h-3 rounded-full"
                  style={{ backgroundColor: SEGMENT_COLORS[segment] }}
                />
                <span
                  className="text-sm font-bold"
                  style={{ color: SEGMENT_COLORS[segment] }}
                >
                  {SEGMENT_LABELS[segment]}
                </span>
                <span className="text-xs text-white/50">
                  ({segmentConfidence}%)
                </span>
              </div>
            ) : (
              <span className="text-sm text-white/40 italic">
                Detecting...
              </span>
            )}
          </div>

          {/* Override Dropdown */}
          {segment && segmentAlternatives.length > 0 && onSegmentOverride && (
            <SegmentDropdown
              currentSegment={segment}
              alternatives={segmentAlternatives}
              onSelect={handleSegmentOverride}
              isOpen={dropdownOpen}
              onToggle={() => setDropdownOpen(!dropdownOpen)}
            />
          )}
        </div>

        {/* Segment Signals */}
        {segmentSignals.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-2">
            {segmentSignals.map((signal, idx) => (
              <span
                key={idx}
                className={cn(
                  'text-xs px-2 py-0.5 rounded-full',
                  'bg-white/10 text-white/70',
                  'border border-white/10'
                )}
              >
                "{signal}"
              </span>
            ))}
          </div>
        )}
      </div>

      {/* ═══════════════════════════════════════════════════════════════════ */}
      {/* Jobs Section */}
      {/* ═══════════════════════════════════════════════════════════════════ */}
      <div className="px-4 py-3 border-b border-white/5">
        <div className="flex items-center gap-2 mb-2">
          <span className="text-xs text-white/50 uppercase tracking-wider">
            Jobs:
          </span>
          {jobs.length > 0 && (
            <span className="text-xs text-white/40 bg-white/10 px-2 py-0.5 rounded-full">
              {jobs.length}
            </span>
          )}
        </div>

        {jobs.length === 0 ? (
          <p className="text-sm text-white/40 italic py-2">
            Listening for jobs...
          </p>
        ) : (
          <div className="space-y-2">
            <AnimatePresence mode="popLayout">
              {jobs.map((job, index) => (
                <motion.div
                  key={job.id}
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -10 }}
                  transition={{ duration: 0.15, delay: index * 0.03 }}
                  className="flex items-start gap-2"
                >
                  {/* Tree connector */}
                  <span className="text-white/30 flex-shrink-0 w-4 text-center">
                    {index === jobs.length - 1 ? '└' : '├'}
                  </span>

                  {/* Status icon */}
                  {job.matched ? (
                    <CheckCircle2 className="w-4 h-4 text-green-500 flex-shrink-0 mt-0.5" />
                  ) : (
                    <AlertTriangle className="w-4 h-4 text-amber-500 flex-shrink-0 mt-0.5" />
                  )}

                  {/* Job content */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <span
                        className={cn(
                          'text-sm truncate',
                          job.matched ? 'text-white' : 'text-amber-200'
                        )}
                      >
                        {job.matched && job.sku
                          ? job.sku.name
                          : `"${job.description}"`}
                      </span>

                      {/* Price or status */}
                      <span className="flex-shrink-0 text-xs">
                        {job.matched && job.sku ? (
                          <span className="text-green-400 font-medium">
                            {job.sku.priceRangePence
                              ? formatPriceRange(
                                  job.sku.priceRangePence[0],
                                  job.sku.priceRangePence[1]
                                )
                              : formatPrice(job.sku.pricePence)}
                          </span>
                        ) : (
                          <span className="text-amber-500/70">needs video</span>
                        )}
                      </span>
                    </div>

                    {/* SKU Matched badge for matched jobs */}
                    {job.matched && (
                      <span className="text-[10px] text-green-500/70 uppercase tracking-wider">
                        SKU Matched
                      </span>
                    )}
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>

            {/* Totals */}
            {matchedJobs.length > 0 && (
              <div className="flex items-center justify-between pt-2 mt-2 border-t border-white/5">
                <span className="text-xs text-white/50">
                  Total (matched):
                </span>
                <div className="flex items-center gap-1">
                  <PoundSterling className="w-3 h-3 text-green-400" />
                  <span className="text-sm font-bold text-green-400">
                    {hasRange
                      ? formatPriceRange(totalMinPence, totalMaxPence)
                      : formatPrice(totalMinPence)}
                  </span>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ═══════════════════════════════════════════════════════════════════ */}
      {/* Route Section */}
      {/* ═══════════════════════════════════════════════════════════════════ */}
      <div
        className="px-4 py-3"
        style={{
          backgroundColor: routeConfig ? `${routeConfig.color}15` : undefined,
        }}
      >
        <div className="flex items-center gap-2 mb-1">
          <span className="text-xs text-white/50 uppercase tracking-wider">
            Route:
          </span>
          {recommendedRoute && routeConfig ? (
            <div className="flex items-center gap-2">
              <RouteIcon
                className="w-4 h-4"
                style={{ color: routeConfig.color }}
              />
              <span
                className="text-sm font-bold uppercase tracking-wide"
                style={{ color: routeConfig.color }}
              >
                {routeConfig.emoji} {routeConfig.label}
              </span>
            </div>
          ) : (
            <span className="text-sm text-white/40 italic">
              Awaiting detection...
            </span>
          )}
        </div>

        {displayReason && (
          <p className="text-xs text-white/50 mt-1">"{displayReason}"</p>
        )}
      </div>
    </div>
  );
}

export default DetectionCard;
