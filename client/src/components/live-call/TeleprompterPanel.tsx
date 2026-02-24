/**
 * TeleprompterPanel
 *
 * Live script display for VAs during calls.
 * Shows segment-specific scripts with tips, follow-ups, and price interpolation.
 *
 * Features:
 * - Large, readable script text (16-18px)
 * - Tip shown below in muted style with icon
 * - Follow-up question if defined
 * - Script updates when segment/route changes
 * - Price interpolation ({price} -> "£85")
 * - Smooth fade transition between scripts
 * - Dark theme with subtle border
 */

import React, { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { MessageSquare, Lightbulb, MessageCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { CallScriptSegment } from '@shared/schema';
import {
  getCurrentScript,
  interpolateScript,
  MISSING_INFO_PROMPTS,
  type VAScript,
} from '@/config/va-scripts';

export interface TeleprompterPanelProps {
  segment: CallScriptSegment | null;
  route: 'INSTANT_QUOTE' | 'VIDEO_REQUEST' | 'SITE_VISIT' | null;
  jobPrice?: number; // Price in pence for interpolation
  currentTrigger: 'segment_detected' | 'route_ready' | 'closing';
  estimatedTime?: string; // e.g., "2 hours" for emergency dispatch
  missingFields?: string[]; // Fields that still need to be captured
  className?: string;
}

export function TeleprompterPanel({
  segment,
  route,
  jobPrice,
  currentTrigger,
  estimatedTime,
  missingFields = [],
  className,
}: TeleprompterPanelProps) {
  const [displayedScript, setDisplayedScript] = useState<VAScript | null>(null);
  const [isTransitioning, setIsTransitioning] = useState(false);

  // Get the current script based on state
  const currentScript = useMemo(() => {
    return getCurrentScript(segment, route, currentTrigger);
  }, [segment, route, currentTrigger]);

  // Handle script transitions with fade effect
  useEffect(() => {
    if (currentScript?.id !== displayedScript?.id) {
      setIsTransitioning(true);
      const timer = setTimeout(() => {
        setDisplayedScript(currentScript);
        setIsTransitioning(false);
      }, 150);
      return () => clearTimeout(timer);
    }
  }, [currentScript, displayedScript?.id]);

  // Interpolate price and time into script
  const interpolatedScript = useMemo(() => {
    if (!displayedScript?.script) return '';
    return interpolateScript(displayedScript.script, {
      price: jobPrice,
      time: estimatedTime,
    });
  }, [displayedScript?.script, jobPrice, estimatedTime]);

  // Interpolate follow-up if present
  const interpolatedFollowUp = useMemo(() => {
    if (!displayedScript?.followUp) return null;
    return interpolateScript(displayedScript.followUp, {
      price: jobPrice,
      time: estimatedTime,
    });
  }, [displayedScript?.followUp, jobPrice, estimatedTime]);

  // Get missing info prompts
  const missingInfoPrompts = useMemo(() => {
    return missingFields
      .filter(field => MISSING_INFO_PROMPTS[field])
      .map(field => ({
        field,
        prompt: MISSING_INFO_PROMPTS[field],
      }));
  }, [missingFields]);

  // Empty state when no segment detected
  if (!segment) {
    return (
      <div
        className={cn(
          'bg-[#12121a] border border-white/10 rounded-xl overflow-hidden',
          className
        )}
      >
        <div className="px-4 py-3 border-b border-white/10 flex items-center gap-2">
          <MessageSquare className="w-4 h-4 text-white/60" />
          <span className="text-sm font-semibold text-white">Say This</span>
        </div>
        <div className="px-6 py-8 text-center">
          <p className="text-sm text-white/40 italic">
            Listening for customer segment...
          </p>
        </div>
      </div>
    );
  }

  return (
    <div
      className={cn(
        'bg-[#12121a] border border-white/10 rounded-xl overflow-hidden',
        className
      )}
    >
      {/* Header */}
      <div className="px-4 py-3 border-b border-white/10 flex items-center gap-2">
        <MessageSquare className="w-4 h-4 text-emerald-400" />
        <span className="text-sm font-semibold text-white">Say This</span>
        {segment && (
          <span className="text-xs text-white/40 bg-white/10 px-2 py-0.5 rounded-full ml-auto">
            {segment}
          </span>
        )}
      </div>

      {/* Main Script Area */}
      <div className="px-6 py-5">
        <AnimatePresence mode="wait">
          {displayedScript ? (
            <motion.div
              key={displayedScript.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: isTransitioning ? 0.5 : 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.15 }}
            >
              {/* Script Text */}
              <p className="text-[17px] leading-relaxed text-white font-medium">
                "{interpolatedScript}"
              </p>

              {/* Tip */}
              {displayedScript.tip && (
                <div className="mt-4 flex items-start gap-2">
                  <Lightbulb className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
                  <p className="text-sm text-white/50">
                    {displayedScript.tip}
                  </p>
                </div>
              )}
            </motion.div>
          ) : (
            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="text-sm text-white/40 italic"
            >
              No script available for this state
            </motion.p>
          )}
        </AnimatePresence>
      </div>

      {/* Follow-up Question */}
      {interpolatedFollowUp && (
        <div className="px-6 py-4 border-t border-white/10 bg-white/[0.02]">
          <div className="flex items-start gap-2">
            <MessageCircle className="w-4 h-4 text-blue-400 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-xs text-white/40 uppercase tracking-wide mb-1">
                Follow-up
              </p>
              <p className="text-sm text-blue-200">
                "{interpolatedFollowUp}"
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Missing Info Prompts */}
      {missingInfoPrompts.length > 0 && (
        <div className="px-6 py-4 border-t border-white/10 bg-amber-500/5">
          <p className="text-xs text-amber-400/80 uppercase tracking-wide mb-2">
            Still need
          </p>
          <div className="space-y-2">
            {missingInfoPrompts.slice(0, 3).map(({ field, prompt }) => (
              <div key={field} className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-amber-500/50 flex-shrink-0" />
                <p className="text-sm text-white/70">
                  {prompt}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default TeleprompterPanel;
