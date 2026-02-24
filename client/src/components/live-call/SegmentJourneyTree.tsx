/**
 * Segment Journey Tree - Top-to-Bottom Tree Visualization
 *
 * Shows the call flow as a tree that branches downward:
 * - "Listening" state at top (large rounded box)
 * - Segments as horizontal row of circles
 * - Selected segment branches down to show choices
 * - Curved lines connect the selected path
 */

import React, { useRef, useEffect, useMemo, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Phone, Mic, AlertCircle, Building2, Briefcase, Clock, Home, Users, Wrench, DollarSign, Shield } from 'lucide-react';
import type { CallScriptSegment } from '@shared/schema';

// Segment configurations - matches CallScriptSegment values
const SEGMENTS: {
  id: CallScriptSegment;
  label: string;
  shortLabel?: string;
  icon: React.ElementType;
  color: string;
}[] = [
  { id: 'EMERGENCY', label: 'Emergency', icon: AlertCircle, color: '#E32017' },
  { id: 'LANDLORD', label: 'Landlord', icon: Home, color: '#FF6600' },
  { id: 'PROP_MGR', label: 'Property Manager', shortLabel: 'Prop Mgr', icon: Building2, color: '#00843D' },
  { id: 'BUSY_PRO', label: 'Busy Pro', icon: Briefcase, color: '#FFD300' },
  { id: 'SMALL_BIZ', label: 'Small Biz', icon: Users, color: '#9B0058' },
  { id: 'OAP', label: 'Trust Seeker', shortLabel: 'OAP', icon: Shield, color: '#0019A8' },
  { id: 'BUDGET', label: 'Budget', icon: DollarSign, color: '#A0A5A9' },
];

// Journey steps for each segment
interface JourneyStep {
  id: string;
  question?: string;
  options: { id: string; label: string; nextStep?: string }[];
}

const SEGMENT_JOURNEYS: Record<string, JourneyStep[]> = {
  EMERGENCY: [
    {
      id: 'type',
      question: 'What type of emergency?',
      options: [
        { id: 'water', label: 'Water/Leak', nextStep: 'dispatch' },
        { id: 'gas', label: 'Gas', nextStep: 'dispatch' },
        { id: 'heating', label: 'Heating', nextStep: 'dispatch' },
        { id: 'lockout', label: 'Lockout', nextStep: 'dispatch' },
      ],
    },
    {
      id: 'dispatch',
      options: [
        { id: 'confirm', label: 'Dispatch Now' },
      ],
    },
  ],
  LANDLORD: [
    {
      id: 'properties',
      question: 'How many properties?',
      options: [
        { id: '1', label: '1', nextStep: 'media' },
        { id: '2-5', label: '2-5', nextStep: 'media' },
        { id: '5+', label: '5+', nextStep: 'media' },
      ],
    },
    {
      id: 'media',
      question: 'How to share the job?',
      options: [
        { id: 'you_send', label: 'You Send' },
        { id: 'tenant_sends', label: 'Tenant Sends' },
        { id: 'we_visit', label: 'We Visit' },
      ],
    },
  ],
  PROP_MGR: [
    {
      id: 'properties',
      question: 'How many properties?',
      options: [
        { id: '1', label: '1', nextStep: 'quote' },
        { id: '2-5', label: '2-5', nextStep: 'quote' },
        { id: '5+', label: '5+', nextStep: 'quote' },
      ],
    },
    {
      id: 'quote',
      question: 'How to proceed?',
      options: [
        { id: 'instant', label: 'Instant' },
        { id: 'video', label: 'Video' },
        { id: 'visit', label: 'Visit' },
      ],
    },
  ],
  BUSY_PRO: [
    {
      id: 'timing',
      question: 'When works best?',
      options: [
        { id: 'asap', label: 'ASAP', nextStep: 'quote' },
        { id: 'this_week', label: 'This Week', nextStep: 'quote' },
        { id: 'flexible', label: 'Flexible', nextStep: 'quote' },
      ],
    },
    {
      id: 'quote',
      options: [
        { id: 'instant', label: 'Instant' },
        { id: 'video', label: 'Video' },
        { id: 'visit', label: 'Visit' },
      ],
    },
  ],
  SMALL_BIZ: [
    {
      id: 'timing',
      question: 'Work during or after hours?',
      options: [
        { id: 'during', label: 'During', nextStep: 'quote' },
        { id: 'after', label: 'After', nextStep: 'quote' },
      ],
    },
    {
      id: 'quote',
      options: [
        { id: 'instant', label: 'Instant' },
        { id: 'video', label: 'Video' },
        { id: 'visit', label: 'Visit' },
      ],
    },
  ],
  OAP: [
    {
      id: 'comfort',
      question: 'Would you like a free visit first?',
      options: [
        { id: 'free_visit', label: 'Free Visit' },
        { id: 'quote_ok', label: 'Quote OK', nextStep: 'quote' },
      ],
    },
    {
      id: 'quote',
      question: 'How to proceed?',
      options: [
        { id: 'instant', label: 'Instant' },
        { id: 'video', label: 'Video' },
        { id: 'visit', label: 'Visit' },
      ],
    },
  ],
  BUDGET: [
    {
      id: 'value',
      question: 'Cheapest or best value?',
      options: [
        { id: 'cheapest', label: 'Cheapest' },
        { id: 'value', label: 'Value', nextStep: 'quote' },
      ],
    },
    {
      id: 'quote',
      options: [
        { id: 'instant', label: 'Instant' },
        { id: 'video', label: 'Video' },
        { id: 'visit', label: 'Visit' },
      ],
    },
  ],
  RENTER: [
    {
      id: 'situation',
      question: 'Your situation?',
      options: [
        { id: 'deposit', label: 'Deposit', nextStep: 'quote' },
        { id: 'landlord_pay', label: 'Landlord Pays', nextStep: 'quote' },
        { id: 'i_pay', label: 'I Pay', nextStep: 'quote' },
      ],
    },
    {
      id: 'quote',
      options: [
        { id: 'instant', label: 'Instant' },
        { id: 'video', label: 'Video' },
        { id: 'visit', label: 'Visit' },
      ],
    },
  ],
  DEFAULT: [
    {
      id: 'quote',
      question: 'How to proceed?',
      options: [
        { id: 'instant', label: 'Instant' },
        { id: 'video', label: 'Video' },
        { id: 'visit', label: 'Visit' },
      ],
    },
  ],
};

export interface SegmentJourneyTreeProps {
  isListening?: boolean;
  selectedSegment: CallScriptSegment | null;
  aiRecommendedSegment?: CallScriptSegment | null;
  journeySelections: Record<string, string>;
  onSegmentSelect: (segment: CallScriptSegment) => void;
  onOptionSelect: (stepId: string, optionId: string) => void;
  className?: string;
}

// Circle node component
function CircleNode({
  label,
  isSelected,
  isAiRecommended,
  onClick,
  color = '#666',
  icon: Icon,
  size = 64,
}: {
  label: string;
  isSelected?: boolean;
  isAiRecommended?: boolean;
  onClick?: () => void;
  color?: string;
  icon?: React.ElementType;
  size?: number;
}) {
  return (
    <motion.div
      className="flex flex-col items-center gap-2 cursor-pointer select-none"
      onClick={onClick}
      whileHover={{ scale: 1.08 }}
      whileTap={{ scale: 0.95 }}
      transition={{ duration: 0.1 }}
    >
      <motion.div
        className="rounded-full border-2 flex items-center justify-center relative"
        style={{
          width: size,
          height: size,
          borderColor: isSelected ? color : '#555',
          backgroundColor: isSelected ? '#fff' : '#1a1a2e',
          boxShadow: isSelected ? `0 0 24px ${color}50` : undefined,
        }}
        animate={isAiRecommended && !isSelected ? {
          boxShadow: [
            '0 0 0 0 rgba(59,130,246,0)',
            '0 0 0 8px rgba(59,130,246,0.3)',
            '0 0 0 0 rgba(59,130,246,0)',
          ],
        } : {}}
        transition={{ duration: 1.5, repeat: Infinity }}
      >
        {Icon && (
          <Icon
            className="w-6 h-6"
            style={{ color: isSelected ? color : '#888' }}
          />
        )}
        {isAiRecommended && !isSelected && (
          <div className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-blue-500 text-white text-[9px] flex items-center justify-center font-bold shadow-lg">
            AI
          </div>
        )}
      </motion.div>
      <span
        className="text-center leading-tight max-w-[80px] text-xs"
        style={{
          color: isSelected ? '#fff' : '#888',
          fontWeight: isSelected ? 600 : 400,
        }}
      >
        {label}
      </span>
    </motion.div>
  );
}

// Simple option circle (no icon)
function OptionCircle({
  label,
  isSelected,
  onClick,
  color = '#666',
  size = 56,
}: {
  label: string;
  isSelected?: boolean;
  onClick?: () => void;
  color?: string;
  size?: number;
}) {
  return (
    <motion.div
      className="flex flex-col items-center gap-2 cursor-pointer select-none"
      onClick={onClick}
      whileHover={{ scale: 1.08 }}
      whileTap={{ scale: 0.95 }}
      transition={{ duration: 0.1 }}
    >
      <motion.div
        className="rounded-full border-2 flex items-center justify-center"
        style={{
          width: size,
          height: size,
          borderColor: isSelected ? color : '#555',
          backgroundColor: isSelected ? '#fff' : '#1a1a2e',
          boxShadow: isSelected ? `0 0 20px ${color}40` : undefined,
        }}
      >
        <span
          className="text-sm font-medium"
          style={{ color: isSelected ? color : '#888' }}
        >
          {label}
        </span>
      </motion.div>
    </motion.div>
  );
}

export function SegmentJourneyTree({
  isListening = true,
  selectedSegment,
  aiRecommendedSegment,
  journeySelections,
  onSegmentSelect,
  onOptionSelect,
  className,
}: SegmentJourneyTreeProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  // Get segment config
  const selectedSegmentConfig = useMemo(
    () => SEGMENTS.find(s => s.id === selectedSegment),
    [selectedSegment]
  );

  // Get journey steps for selected segment
  const journey = useMemo(
    () => (selectedSegment ? SEGMENT_JOURNEYS[selectedSegment] || [] : []),
    [selectedSegment]
  );

  // Calculate visible steps based on selections
  const visibleSteps = useMemo((): { step: JourneyStep; selectedOptionId?: string }[] => {
    if (!selectedSegment || journey.length === 0) return [];

    const result: { step: JourneyStep; selectedOptionId?: string }[] = [];

    // Process first step
    const firstStep = journey[0];
    if (!firstStep) return result;

    const firstSelectionId = journeySelections[firstStep.id];
    result.push({ step: firstStep, selectedOptionId: firstSelectionId });

    if (!firstSelectionId) return result;

    // Find and process subsequent steps
    let nextStepId = firstStep.options.find((opt: { id: string; label: string; nextStep?: string }) =>
      opt.id === firstSelectionId
    )?.nextStep;

    while (nextStepId) {
      const nextStep = journey.find((s: JourneyStep) => s.id === nextStepId);
      if (!nextStep) break;

      const selectionId = journeySelections[nextStep.id];
      result.push({ step: nextStep, selectedOptionId: selectionId });

      if (!selectionId) break;

      nextStepId = nextStep.options.find((opt: { id: string; label: string; nextStep?: string }) =>
        opt.id === selectionId
      )?.nextStep;
    }

    return result;
  }, [selectedSegment, journey, journeySelections]);

  // SVG path for curved line
  const getCurvedPath = useCallback((
    x1: number, y1: number,
    x2: number, y2: number
  ): string => {
    const midY = y1 + (y2 - y1) * 0.5;
    return `M ${x1} ${y1} C ${x1} ${midY}, ${x2} ${midY}, ${x2} ${y2}`;
  }, []);

  // Compute line positions after render
  const [lines, setLines] = React.useState<{
    path: string;
    color: string;
    key: string;
  }[]>([]);

  useEffect(() => {
    if (!containerRef.current || !selectedSegment || !selectedSegmentConfig) {
      setLines([]);
      return;
    }

    const container = containerRef.current;
    const containerRect = container.getBoundingClientRect();

    const newLines: typeof lines = [];

    // Line from listening box to selected segment
    const listeningBox = container.querySelector('[data-listening]');
    const segmentCircle = container.querySelector(`[data-segment="${selectedSegment}"]`);

    if (listeningBox && segmentCircle) {
      const listenRect = listeningBox.getBoundingClientRect();
      const segRect = segmentCircle.getBoundingClientRect();

      const x1 = listenRect.left + listenRect.width / 2 - containerRect.left;
      const y1 = listenRect.bottom - containerRect.top;
      const x2 = segRect.left + segRect.width / 2 - containerRect.left;
      const y2 = segRect.top - containerRect.top;

      newLines.push({
        path: getCurvedPath(x1, y1, x2, y2),
        color: selectedSegmentConfig.color,
        key: 'listening-to-segment',
      });
    }

    // Lines from segment/options to next level
    let prevElementSelector = `[data-segment="${selectedSegment}"]`;

    visibleSteps.forEach(({ step, selectedOptionId }, stepIndex) => {
      if (!selectedOptionId) return;

      const prevElement = container.querySelector(prevElementSelector);
      const nextElement = container.querySelector(
        `[data-step="${step.id}"][data-option="${selectedOptionId}"]`
      );

      if (prevElement && nextElement) {
        const prevRect = prevElement.getBoundingClientRect();
        const nextRect = nextElement.getBoundingClientRect();

        const x1 = prevRect.left + prevRect.width / 2 - containerRect.left;
        const y1 = prevRect.bottom - containerRect.top;
        const x2 = nextRect.left + nextRect.width / 2 - containerRect.left;
        const y2 = nextRect.top - containerRect.top;

        newLines.push({
          path: getCurvedPath(x1, y1, x2, y2),
          color: selectedSegmentConfig.color,
          key: `${step.id}-${selectedOptionId}`,
        });
      }

      prevElementSelector = `[data-step="${step.id}"][data-option="${selectedOptionId}"]`;
    });

    setLines(newLines);
  }, [selectedSegment, selectedSegmentConfig, visibleSteps, journeySelections, getCurvedPath]);

  return (
    <div
      ref={containerRef}
      className={`relative w-full min-h-[600px] bg-[#0a0a0f] rounded-xl p-8 overflow-hidden ${className || ''}`}
    >
      {/* Background grid */}
      <div
        className="absolute inset-0 opacity-5"
        style={{
          backgroundImage: `
            linear-gradient(to right, #666 1px, transparent 1px),
            linear-gradient(to bottom, #666 1px, transparent 1px)
          `,
          backgroundSize: '50px 50px',
        }}
      />

      {/* SVG for connecting lines */}
      <svg
        ref={svgRef}
        className="absolute inset-0 w-full h-full pointer-events-none"
        style={{ zIndex: 1 }}
      >
        <defs>
          <marker
            id="arrowhead"
            markerWidth="8"
            markerHeight="6"
            refX="7"
            refY="3"
            orient="auto"
          >
            <polygon
              points="0 0, 8 3, 0 6"
              fill={selectedSegmentConfig?.color || '#666'}
            />
          </marker>
        </defs>

        <AnimatePresence>
          {lines.map((line, i) => (
            <motion.path
              key={line.key}
              d={line.path}
              stroke={line.color}
              strokeWidth="2"
              fill="none"
              markerEnd="url(#arrowhead)"
              initial={{ pathLength: 0, opacity: 0 }}
              animate={{ pathLength: 1, opacity: 1 }}
              exit={{ pathLength: 0, opacity: 0 }}
              transition={{ duration: 0.3, delay: i * 0.1 }}
            />
          ))}
        </AnimatePresence>
      </svg>

      {/* Tree content */}
      <div className="relative z-10 flex flex-col items-center gap-12">
        {/* Listening State Box */}
        <motion.div
          data-listening
          className="w-full max-w-3xl h-20 rounded-2xl border-2 flex items-center justify-center gap-4"
          style={{
            borderColor: isListening ? '#22c55e' : '#555',
            backgroundColor: isListening ? 'rgba(34,197,94,0.1)' : '#1a1a2e',
          }}
          animate={isListening ? {
            boxShadow: [
              '0 0 20px rgba(34,197,94,0.2)',
              '0 0 40px rgba(34,197,94,0.4)',
              '0 0 20px rgba(34,197,94,0.2)',
            ],
          } : {}}
          transition={{ duration: 2, repeat: Infinity }}
        >
          {isListening ? (
            <>
              <Mic className="w-6 h-6 text-green-500" />
              <span className="text-green-400 font-semibold text-lg">Listening</span>
              {/* Audio wave */}
              <div className="flex items-end gap-1 ml-2 h-6">
                {[...Array(5)].map((_, i) => (
                  <motion.div
                    key={i}
                    className="w-1 bg-green-500 rounded-full"
                    animate={{ height: ['8px', '24px', '8px'] }}
                    transition={{
                      duration: 0.6,
                      repeat: Infinity,
                      delay: i * 0.1,
                    }}
                  />
                ))}
              </div>
            </>
          ) : (
            <>
              <Phone className="w-6 h-6 text-gray-400" />
              <span className="text-gray-400 font-semibold text-lg">Call Ended</span>
            </>
          )}
        </motion.div>

        {/* Segments Row */}
        <div className="flex items-start justify-center gap-6 flex-wrap">
          {SEGMENTS.map((segment) => (
            <div
              key={segment.id}
              data-segment={segment.id}
            >
              <CircleNode
                label={segment.shortLabel || segment.label}
                icon={segment.icon}
                color={segment.color}
                isSelected={selectedSegment === segment.id}
                isAiRecommended={aiRecommendedSegment === segment.id}
                onClick={() => onSegmentSelect(segment.id)}
                size={70}
              />
            </div>
          ))}
        </div>

        {/* Journey Steps */}
        <AnimatePresence mode="sync">
          {selectedSegment && visibleSteps.map(({ step, selectedOptionId }, stepIndex) => (
            <motion.div
              key={`${selectedSegment}-${step.id}`}
              className="flex flex-col items-center gap-4"
              initial={{ opacity: 0, y: -30 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -30 }}
              transition={{ duration: 0.2, delay: stepIndex * 0.1 }}
            >
              {/* Question label */}
              {step.question && (
                <span className="text-gray-400 text-sm">{step.question}</span>
              )}

              {/* Options row */}
              <div className="flex items-start justify-center gap-8">
                {step.options.map((option) => (
                  <div
                    key={option.id}
                    data-step={step.id}
                    data-option={option.id}
                  >
                    <OptionCircle
                      label={option.label}
                      isSelected={selectedOptionId === option.id}
                      onClick={() => onOptionSelect(step.id, option.id)}
                      color={selectedSegmentConfig?.color}
                      size={60}
                    />
                  </div>
                ))}
              </div>
            </motion.div>
          ))}
        </AnimatePresence>

        {/* Terminal indicator */}
        {selectedSegment && visibleSteps.length > 0 && (() => {
          const lastStep = visibleSteps[visibleSteps.length - 1];
          const lastSelectedOption = lastStep.step.options.find(
            o => o.id === lastStep.selectedOptionId
          );

          if (lastSelectedOption && !lastSelectedOption.nextStep) {
            return (
              <motion.div
                className="flex flex-col items-center gap-3 mt-4"
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.2 }}
              >
                <div
                  className="w-16 h-16 rounded-full border-4 flex items-center justify-center"
                  style={{
                    borderColor: selectedSegmentConfig?.color,
                    backgroundColor: `${selectedSegmentConfig?.color}20`,
                  }}
                >
                  <span className="text-2xl">✓</span>
                </div>
                <span
                  className="font-semibold"
                  style={{ color: selectedSegmentConfig?.color }}
                >
                  Ready
                </span>
              </motion.div>
            );
          }
          return null;
        })()}
      </div>
    </div>
  );
}

export default SegmentJourneyTree;
