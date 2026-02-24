/**
 * LiveCallTubeMap - Main wrapper for the call flow visualization
 *
 * Uses SegmentJourneyTree for the tree-based UI that matches the wireframe:
 * - "Listening" box at top
 * - Segments as horizontal row of circles
 * - Selected segment branches down with curved lines
 */

import React, { useState, useCallback } from 'react';
import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';
import {
  Phone,
  CheckCircle2,
  Circle,
} from 'lucide-react';
import type {
  CallScriptStation,
  CallScriptSegment,
  CallScriptDestination,
  CallScriptCapturedInfo
} from '@shared/schema';
import { SegmentJourneyTree } from './SegmentJourneyTree';
import { JobsDetectedPanel, type DetectedJob } from './JobsDetectedPanel';
import type { JourneyState, JourneyActions } from '@/contexts/LiveCallContext';

interface SegmentOption {
  segment: CallScriptSegment;
  confidence: number;
  signals: string[];
}

interface DestinationOption {
  destination: CallScriptDestination;
  recommended: boolean;
  description: string;
}

export interface LiveCallTubeMapProps {
  callId: string;
  currentStation: CallScriptStation;
  completedStations: CallScriptStation[];
  detectedSegment: CallScriptSegment | null;
  segmentConfidence: number;
  segmentOptions: SegmentOption[];
  capturedInfo: CallScriptCapturedInfo;
  isQualified: boolean | null;
  recommendedDestination: CallScriptDestination | null;
  destinationOptions: DestinationOption[];
  currentPrompt: string;
  watchFor: string[];
  segmentTip: string | null;
  callDuration: number;
  onConfirmStation: () => void;
  onSelectSegment: (segment: CallScriptSegment) => void;
  onSetQualified: (qualified: boolean) => void;
  onSelectDestination: (destination: CallScriptDestination) => void;
  phoneNumber?: string;
  // Journey props
  journey?: JourneyState;
  journeyActions?: JourneyActions;
  onJourneyStationClick?: (stationId: string) => void;
  onJourneyOptionSelect?: (stationId: string, optionId: string) => void;
  skuMatched?: boolean;
  // Jobs detection
  detectedJobs?: DetectedJob[];
}

// Pulsing call indicator
function CallPulse() {
  return (
    <div className="relative">
      <motion.div
        className="absolute inset-0 rounded-full bg-green-500"
        animate={{ scale: [1, 1.8, 1], opacity: [0.5, 0, 0.5] }}
        transition={{ duration: 1.5, repeat: Infinity }}
      />
      <div className="relative w-4 h-4 rounded-full bg-green-500" />
    </div>
  );
}

export function LiveCallTubeMap({
  callId,
  currentStation,
  completedStations,
  detectedSegment,
  segmentConfidence,
  segmentOptions,
  capturedInfo,
  isQualified,
  recommendedDestination,
  destinationOptions,
  currentPrompt,
  watchFor,
  segmentTip,
  callDuration,
  onConfirmStation,
  onSelectSegment,
  onSetQualified,
  onSelectDestination,
  phoneNumber = '+447700900123',
  journey,
  journeyActions,
  onJourneyStationClick,
  onJourneyOptionSelect,
  skuMatched = false,
  detectedJobs = [],
}: LiveCallTubeMapProps) {
  // Track journey selections locally
  const [journeySelections, setJourneySelections] = useState<Record<string, string>>({});

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const isStationCurrent = (station: CallScriptStation) => station === currentStation;

  // Get AI recommended segment
  const aiRecommendedSegment = segmentOptions.length > 0 ? segmentOptions[0].segment : null;

  // Handle segment selection
  const handleSegmentSelect = useCallback((segment: CallScriptSegment) => {
    // Reset journey selections when segment changes
    setJourneySelections({});
    onSelectSegment(segment);
  }, [onSelectSegment]);

  // Handle option selection within journey
  const handleOptionSelect = useCallback((stepId: string, optionId: string) => {
    setJourneySelections(prev => ({
      ...prev,
      [stepId]: optionId,
    }));

    // Also call the external handler if provided
    if (onJourneyOptionSelect) {
      onJourneyOptionSelect(stepId, optionId);
    }
  }, [onJourneyOptionSelect]);

  return (
    <div className="h-full bg-[#0a0a0f] text-white overflow-auto font-['Johnston',_'Gill_Sans',_sans-serif]">

      {/* ══════════════════════════════════════════════════════════════════════ */}
      {/* HEADER - Call Status Bar */}
      {/* ══════════════════════════════════════════════════════════════════════ */}
      <div className="sticky top-0 z-50 bg-[#0a0a0f]/95 backdrop-blur border-b border-white/10">
        <div className="max-w-5xl mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            {/* Phone & Status */}
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-3">
                <CallPulse />
                <div>
                  <div className="font-mono text-2xl tracking-wide text-white">{phoneNumber}</div>
                  <div className="text-xs text-white/50 uppercase tracking-widest">Incoming Call</div>
                </div>
              </div>
            </div>

            {/* Timer */}
            <div className="flex items-center gap-3">
              <div className="text-right">
                <div className="font-mono text-4xl font-light tracking-wider text-white/90">
                  {formatDuration(callDuration)}
                </div>
                <div className="text-[10px] text-white/40 uppercase tracking-widest">Duration</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ══════════════════════════════════════════════════════════════════════ */}
      {/* MAIN CONTENT - Two Column Layout */}
      {/* ══════════════════════════════════════════════════════════════════════ */}
      <div className="p-6">
        <div className="flex gap-6">
          {/* Left Column - Segment Journey Tree */}
          <div className="flex-1 min-w-0">
            <SegmentJourneyTree
              isListening={isStationCurrent('LISTEN')}
              selectedSegment={detectedSegment}
              aiRecommendedSegment={aiRecommendedSegment}
              journeySelections={journeySelections}
              onSegmentSelect={handleSegmentSelect}
              onOptionSelect={handleOptionSelect}
            />
          </div>

          {/* Right Column - Jobs Detected Panel */}
          <div className="w-80 flex-shrink-0">
            <JobsDetectedPanel jobs={detectedJobs} />
          </div>
        </div>
      </div>

      {/* ══════════════════════════════════════════════════════════════════════ */}
      {/* FOOTER - Captured Info Status */}
      {/* ══════════════════════════════════════════════════════════════════════ */}
      <div className="sticky bottom-0 bg-[#0a0a0f]/95 backdrop-blur border-t border-white/10">
        <div className="max-w-4xl mx-auto px-6 py-4">
          <div className="flex justify-center gap-4 flex-wrap">
            {[
              { key: 'name', label: 'Name', value: capturedInfo.name },
              { key: 'postcode', label: 'Postcode', value: capturedInfo.postcode },
              { key: 'contact', label: 'Contact', value: capturedInfo.contact },
              { key: 'job', label: 'Job', value: capturedInfo.job },
            ].map(({ key, label, value }) => (
              <div
                key={key}
                className={cn(
                  "flex items-center gap-2 px-4 py-2 rounded-lg border transition-all",
                  value
                    ? "border-green-500/50 bg-green-500/10 text-green-400"
                    : "border-white/10 bg-white/5 text-white/40"
                )}
              >
                {value ? (
                  <CheckCircle2 className="h-4 w-4" />
                ) : (
                  <Circle className="h-4 w-4" />
                )}
                <span className="text-sm font-medium">{label}</span>
                {value && key === 'name' && (
                  <span className="text-xs text-green-300/70 max-w-[100px] truncate">{value}</span>
                )}
              </div>
            ))}

            {/* SKU Match indicator */}
            <div
              className={cn(
                "flex items-center gap-2 px-4 py-2 rounded-lg border transition-all",
                skuMatched
                  ? "border-green-500/50 bg-green-500/10 text-green-400"
                  : "border-amber-500/50 bg-amber-500/10 text-amber-400"
              )}
            >
              {skuMatched ? (
                <CheckCircle2 className="h-4 w-4" />
              ) : (
                <Circle className="h-4 w-4" />
              )}
              <span className="text-sm font-medium">SKU</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default LiveCallTubeMap;
