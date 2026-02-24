/**
 * Live Transcript Panel
 *
 * Shows the live conversation transcript with:
 * - Speaker labels (Caller / You)
 * - Auto-scroll as new segments arrive
 * - Interim transcript with typing indicator
 * - Keyword highlighting for segment signals
 * - Timestamp on hover
 */

import React, { useRef, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '@/lib/utils';

export interface TranscriptSegment {
  speaker: 'caller' | 'agent';
  text: string;
  timestamp: number;
  isFinal: boolean;
}

export interface LiveTranscriptPanelProps {
  segments: TranscriptSegment[];
  interimTranscript?: string;
  highlightKeywords?: string[];
  className?: string;
  maxHeight?: string;
}

// Format timestamp as HH:MM:SS
function formatTimestamp(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  }
  return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
}

// Highlight keywords in text by wrapping them in spans
function highlightText(
  text: string,
  keywords: string[]
): React.ReactNode {
  if (!keywords || keywords.length === 0) {
    return text;
  }

  // Create a regex pattern that matches any of the keywords (case-insensitive)
  const escapedKeywords = keywords.map(kw =>
    kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  );
  const pattern = new RegExp(`(${escapedKeywords.join('|')})`, 'gi');

  const parts = text.split(pattern);

  return parts.map((part, index) => {
    const isKeyword = keywords.some(
      kw => kw.toLowerCase() === part.toLowerCase()
    );

    if (isKeyword) {
      return (
        <span
          key={index}
          className="bg-amber-500/20 text-amber-200 px-0.5 rounded"
        >
          {part}
        </span>
      );
    }

    return part;
  });
}

// Typing indicator with pulsing cursor
function TypingIndicator() {
  return (
    <span className="inline-flex items-center ml-1">
      <motion.span
        className="w-0.5 h-4 bg-white/60 inline-block"
        animate={{ opacity: [1, 0.2, 1] }}
        transition={{ duration: 0.8, repeat: Infinity, ease: 'easeInOut' }}
      />
    </span>
  );
}

// Single transcript segment component
function TranscriptEntry({
  segment,
  highlightKeywords,
  isLatest,
}: {
  segment: TranscriptSegment;
  highlightKeywords?: string[];
  isLatest: boolean;
}) {
  const isCaller = segment.speaker === 'caller';
  const speakerLabel = isCaller ? 'Caller' : 'You';
  const speakerColor = isCaller ? 'text-white' : 'text-green-400';

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.15 }}
      className={cn(
        'group px-4 py-2',
        isLatest && 'bg-white/[0.02]'
      )}
    >
      <div className="flex items-start gap-3">
        {/* Speaker label */}
        <div className="flex-shrink-0 w-14">
          <span className={cn('text-sm font-bold', speakerColor)}>
            [{speakerLabel}]
          </span>
        </div>

        {/* Transcript text */}
        <div className="flex-1 min-w-0">
          <p
            className={cn(
              'text-sm leading-relaxed',
              isCaller ? 'text-white' : 'text-white/80'
            )}
          >
            "{highlightText(segment.text, highlightKeywords || [])}"
          </p>
        </div>

        {/* Timestamp (shown on hover) */}
        <div className="flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity duration-150">
          <span className="text-xs text-white/30 tabular-nums">
            {formatTimestamp(segment.timestamp)}
          </span>
        </div>
      </div>
    </motion.div>
  );
}

export function LiveTranscriptPanel({
  segments,
  interimTranscript,
  highlightKeywords,
  className,
  maxHeight = '300px',
}: LiveTranscriptPanelProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when new segments arrive
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [segments, interimTranscript]);

  // Memoize filtered final segments
  const finalSegments = useMemo(
    () => segments.filter(s => s.isFinal),
    [segments]
  );

  return (
    <div
      className={cn(
        'bg-[#0a0a0f] border border-white/10 rounded-xl overflow-hidden',
        className
      )}
    >
      {/* Header */}
      <div className="px-4 py-3 border-b border-white/10 flex items-center gap-2">
        <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
        <span className="text-sm font-semibold text-white uppercase tracking-wide">
          Live Transcript
        </span>
      </div>

      {/* Transcript content */}
      <div
        ref={scrollRef}
        className="overflow-y-auto scroll-smooth"
        style={{ maxHeight }}
      >
        <div ref={contentRef} className="py-2">
          <AnimatePresence mode="popLayout">
            {finalSegments.length === 0 && !interimTranscript ? (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="px-4 py-8 text-center"
              >
                <p className="text-sm text-white/40">
                  Waiting for conversation...
                </p>
              </motion.div>
            ) : (
              <>
                {finalSegments.map((segment, index) => (
                  <TranscriptEntry
                    key={`${segment.timestamp}-${index}`}
                    segment={segment}
                    highlightKeywords={highlightKeywords}
                    isLatest={
                      index === finalSegments.length - 1 && !interimTranscript
                    }
                  />
                ))}
              </>
            )}
          </AnimatePresence>

          {/* Interim transcript (currently being spoken) */}
          {interimTranscript && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="px-4 py-2 bg-white/[0.02]"
            >
              <div className="flex items-start gap-3">
                <div className="flex-shrink-0 w-14">
                  <span className="text-sm font-bold text-white/50">
                    [...]
                  </span>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm leading-relaxed text-white/50 italic">
                    "{interimTranscript}"
                    <TypingIndicator />
                  </p>
                </div>
              </div>
            </motion.div>
          )}
        </div>
      </div>
    </div>
  );
}

export default LiveTranscriptPanel;
