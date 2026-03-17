/**
 * SegmentChecklist Component
 *
 * 4-question tick-off checklist for live call segmentation.
 * VA ticks answers as they hear them, or AI auto-fills from keywords.
 * Answers map deterministically to a customer segment.
 *
 * Layout:
 * ┌──────────────────────────────────────────────────────────────────────┐
 * │ 🚨 EMERGENCY: Burst pipe detected                    (if emergency) │
 * ├──────────────────────────────────────────────────────────────────────┤
 * │ PROPERTY         ACCESS          VOLUME         DECISION            │
 * │ ● Own home       ● Present       ● Single       ● Owner            │
 * │ ○ Rental owned   ○ Key safe      ○ List         ○ Needs approval   │
 * │ ○ Managed        ○ Tenant        ○ Ongoing      ○ Just prices      │
 * │ ○ Business       ○ Unknown                                         │
 * ├──────────────────────────────────────────────────────────────────────┤
 * │ SEGMENT: LANDLORD (85%)  │  TIMING: 🚨 Emergency (1.5x)           │
 * └──────────────────────────────────────────────────────────────────────┘
 */

import React, { useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Home,
  Key,
  ClipboardList,
  UserCheck,
  AlertTriangle,
  Zap,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { UrgencyLevel } from '@shared/schema';

// ============================================================================
// Types
// ============================================================================

export type PropertyAnswer = 'own_home' | 'rental_owned' | 'rental_managed' | 'business' | null;
export type AccessAnswer = 'present' | 'key_safe' | 'tenant' | 'unknown' | null;
export type VolumeAnswer = 'single' | 'list' | 'ongoing' | null;
export type DecisionAnswer = 'owner' | 'needs_approval' | 'just_prices' | null;
export type TimingAnswer = 'flexible' | 'this_week' | 'emergency' | null;

export interface ChecklistAnswers {
  property: PropertyAnswer;
  access: AccessAnswer;
  volume: VolumeAnswer;
  decision: DecisionAnswer;
  timing: TimingAnswer;
}

export interface SegmentChecklistProps {
  answers: ChecklistAnswers;
  onChange: (answers: ChecklistAnswers) => void;

  // Emergency overlay (auto-detected from keywords)
  isEmergency: boolean;
  emergencyType?: string | null;
  emergencyKeywords?: string[];

  // Derived segment from answers
  derivedSegment?: string | null;
  derivedConfidence?: number;
  derivedReasoning?: string;

  // Urgency
  urgencyLevel?: UrgencyLevel;

  className?: string;
}

// ============================================================================
// Option Configs
// ============================================================================

interface ChecklistOption<T extends string> {
  value: T;
  label: string;
  shortLabel: string;
}

const PROPERTY_OPTIONS: ChecklistOption<NonNullable<PropertyAnswer>>[] = [
  { value: 'own_home', label: 'Own home', shortLabel: 'Own home' },
  { value: 'rental_owned', label: 'Rental I own', shortLabel: 'Rental' },
  { value: 'rental_managed', label: 'I manage properties', shortLabel: 'Managed' },
  { value: 'business', label: 'Business / shop', shortLabel: 'Business' },
];

const ACCESS_OPTIONS: ChecklistOption<NonNullable<AccessAnswer>>[] = [
  { value: 'present', label: "I'll be there", shortLabel: 'Present' },
  { value: 'key_safe', label: 'Key safe / not home', shortLabel: 'Key safe' },
  { value: 'tenant', label: 'Tenant access', shortLabel: 'Tenant' },
  { value: 'unknown', label: 'Unknown', shortLabel: 'Unknown' },
];

const VOLUME_OPTIONS: ChecklistOption<NonNullable<VolumeAnswer>>[] = [
  { value: 'single', label: 'Just this one', shortLabel: 'Single' },
  { value: 'list', label: 'Got a list / few bits', shortLabel: 'List' },
  { value: 'ongoing', label: 'Ongoing / regular', shortLabel: 'Ongoing' },
];

const DECISION_OPTIONS: ChecklistOption<NonNullable<DecisionAnswer>>[] = [
  { value: 'owner', label: 'Happy to go ahead', shortLabel: 'Owner' },
  { value: 'needs_approval', label: 'Need to check', shortLabel: 'Needs OK' },
  { value: 'just_prices', label: 'Just getting prices', shortLabel: 'Prices' },
];

// VA prompts - what to say if this question hasn't been answered yet
const QUESTION_PROMPTS: Record<string, string> = {
  property: "Is this for your own home, a rental you own, or a business?",
  access: "Will you be there, or do we need to arrange access?",
  volume: "Is it just this one job, or have you got a few bits?",
  decision: "And you're happy to go ahead yourself?",
};

// ============================================================================
// Sub-Components
// ============================================================================

interface ChecklistColumnProps<T extends string> {
  label: string;
  icon: React.ReactNode;
  options: ChecklistOption<T>[];
  value: T | null;
  onChange: (value: T) => void;
  prompt?: string;
  isAutoFilled?: boolean;
}

function ChecklistColumn<T extends string>({
  label,
  icon,
  options,
  value,
  onChange,
  prompt,
  isAutoFilled,
}: ChecklistColumnProps<T>) {
  return (
    <div className="flex-1 min-w-[130px]">
      {/* Column Header */}
      <div className="flex items-center gap-1.5 mb-2">
        {icon}
        <span className="text-[10px] font-bold text-white/60 uppercase tracking-wider">
          {label}
        </span>
        {!value && (
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-500"></span>
          </span>
        )}
      </div>

      {/* Options */}
      <div className="space-y-1">
        {options.map((option) => {
          const isSelected = value === option.value;
          return (
            <button
              key={option.value}
              onClick={() => onChange(option.value)}
              className={cn(
                'w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-left transition-all duration-100',
                'text-xs',
                isSelected
                  ? 'bg-green-500/20 border border-green-500/40 text-green-300'
                  : 'bg-white/5 border border-transparent text-white/50 hover:bg-white/10 hover:text-white/70'
              )}
            >
              {/* Radio indicator */}
              <span className={cn(
                'flex-shrink-0 w-3 h-3 rounded-full border-2 transition-all',
                isSelected
                  ? 'border-green-400 bg-green-400'
                  : 'border-white/30'
              )}>
                {isSelected && (
                  <span className="block w-full h-full rounded-full bg-green-400" />
                )}
              </span>
              <span className="truncate">{option.label}</span>
            </button>
          );
        })}
      </div>

      {/* Prompt hint */}
      {!value && prompt && (
        <div className="mt-2 px-1">
          <p className="text-[10px] text-amber-300/60 italic leading-tight">
            Ask: "{prompt}"
          </p>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Main Component
// ============================================================================

export function SegmentChecklist({
  answers,
  onChange,
  isEmergency,
  emergencyType,
  emergencyKeywords = [],
  derivedSegment,
  derivedConfidence = 0,
  derivedReasoning,
  urgencyLevel = 'standard',
  className,
}: SegmentChecklistProps) {
  // Handlers
  const updateAnswer = useCallback(
    <K extends keyof ChecklistAnswers>(key: K, value: ChecklistAnswers[K]) => {
      onChange({ ...answers, [key]: value });
    },
    [answers, onChange]
  );

  // Urgency display
  const urgencyConfig = useMemo(() => {
    switch (urgencyLevel) {
      case 'emergency':
        return { label: '🚨 Emergency', color: 'text-red-400', bgColor: 'bg-red-500/10', multiplier: '1.5x' };
      case 'priority':
        return { label: '⚡ This Week', color: 'text-amber-400', bgColor: 'bg-amber-500/10', multiplier: '1.25x' };
      default:
        return { label: '📅 Standard', color: 'text-white/50', bgColor: 'bg-white/5', multiplier: '1.0x' };
    }
  }, [urgencyLevel]);

  // Segment display name
  const segmentDisplayName = useMemo(() => {
    const names: Record<string, string> = {
      BUSY_PRO: 'Busy Professional',
      PROP_MGR: 'Property Manager',
      LANDLORD: 'Landlord',
      SMALL_BIZ: 'Small Business',
      DIY_DEFERRER: 'DIY Deferrer',
      BUDGET: 'Budget',
      DEFAULT: 'Standard',
      UNKNOWN: 'Unknown',
    };
    return derivedSegment ? (names[derivedSegment] || derivedSegment) : 'Detecting...';
  }, [derivedSegment]);

  return (
    <div
      className={cn(
        'bg-[#12121a] border border-white/10 rounded-xl overflow-hidden',
        className
      )}
    >
      {/* Emergency Banner */}
      <AnimatePresence>
        {isEmergency && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="bg-red-600/20 border-b border-red-500/40"
          >
            <div className="px-4 py-2 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-red-400 animate-pulse" />
              <span className="text-sm font-bold text-red-300">
                🚨 EMERGENCY DETECTED
              </span>
              {emergencyType && (
                <span className="text-xs bg-red-500/30 text-red-200 px-2 py-0.5 rounded-full capitalize">
                  {emergencyType}
                </span>
              )}
              {emergencyKeywords.length > 0 && (
                <span className="text-xs text-red-300/60 ml-auto">
                  "{emergencyKeywords[0]}"
                </span>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Header */}
      <div className="px-4 py-2.5 border-b border-white/10 flex items-center gap-2">
        <ClipboardList className="w-4 h-4 text-white/60" />
        <span className="text-sm font-semibold text-white tracking-wide">
          QUALIFY
        </span>
        <span className="text-[10px] text-white/30 ml-auto">
          {[answers.property, answers.access, answers.volume, answers.decision].filter(Boolean).length}/4 answered
        </span>
      </div>

      {/* Checklist Grid */}
      <div className="px-4 py-3">
        <div className="flex gap-3">
          <ChecklistColumn
            label="Property"
            icon={<Home className="w-3 h-3 text-white/40" />}
            options={PROPERTY_OPTIONS}
            value={answers.property}
            onChange={(v) => updateAnswer('property', v)}
            prompt={QUESTION_PROMPTS.property}
          />
          <ChecklistColumn
            label="Access"
            icon={<Key className="w-3 h-3 text-white/40" />}
            options={ACCESS_OPTIONS}
            value={answers.access}
            onChange={(v) => updateAnswer('access', v)}
            prompt={QUESTION_PROMPTS.access}
          />
          <ChecklistColumn
            label="Volume"
            icon={<ClipboardList className="w-3 h-3 text-white/40" />}
            options={VOLUME_OPTIONS}
            value={answers.volume}
            onChange={(v) => updateAnswer('volume', v)}
            prompt={QUESTION_PROMPTS.volume}
          />
          <ChecklistColumn
            label="Decision"
            icon={<UserCheck className="w-3 h-3 text-white/40" />}
            options={DECISION_OPTIONS}
            value={answers.decision}
            onChange={(v) => updateAnswer('decision', v)}
            prompt={QUESTION_PROMPTS.decision}
          />
        </div>
      </div>

      {/* Footer - Derived Segment + Urgency */}
      <div className="px-4 py-2.5 border-t border-white/10 bg-white/[0.02]">
        <div className="flex items-center justify-between">
          {/* Segment */}
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-white/40 uppercase tracking-wider">Segment:</span>
            <span className={cn(
              'text-sm font-bold',
              derivedSegment && derivedSegment !== 'DEFAULT' ? 'text-white' : 'text-white/40'
            )}>
              {segmentDisplayName}
            </span>
            {derivedConfidence > 0 && (
              <span className="text-[10px] text-white/30">({derivedConfidence}%)</span>
            )}
          </div>

          {/* Urgency */}
          <div className={cn('flex items-center gap-2 px-2 py-1 rounded-md', urgencyConfig.bgColor)}>
            <span className="text-[10px] text-white/40 uppercase tracking-wider">Timing:</span>
            <span className={cn('text-xs font-medium', urgencyConfig.color)}>
              {urgencyConfig.label}
            </span>
            <span className="text-[10px] text-white/30">({urgencyConfig.multiplier})</span>
          </div>
        </div>

        {/* Reasoning */}
        {derivedReasoning && (
          <p className="text-[10px] text-white/30 mt-1 italic">{derivedReasoning}</p>
        )}
      </div>
    </div>
  );
}

export default SegmentChecklist;
