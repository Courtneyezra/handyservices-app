/**
 * JourneyStation Component
 *
 * Individual station node for the segment journey tree.
 * Styled after London Underground station roundels with state-based rendering.
 */

import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '@/lib/utils';
import { Check, type LucideIcon } from 'lucide-react';
import type { StationOption } from '@/config/segment-journeys-client';

export type StationState = 'pending' | 'active' | 'completed';

export interface JourneyStationProps {
  /** Unique station identifier */
  id: string;
  /** Station display label */
  label: string;
  /** VA prompt to display when active */
  vaPrompt?: string;
  /** Current state of the station */
  state: StationState;
  /** Segment line color (hex) */
  color: string;
  /** Station icon */
  icon: LucideIcon;
  /** Available options/branches from this station */
  options?: StationOption[];
  /** Whether this is a terminal station */
  isTerminal?: boolean;
  /** Called when the station is clicked */
  onClick?: () => void;
  /** Called when an option is selected */
  onOptionSelect?: (optionId: string) => void;
  /** Size of the station roundel */
  size?: 'sm' | 'md' | 'lg';
  /** Show the VA prompt */
  showPrompt?: boolean;
  /** Custom class name */
  className?: string;
}

// Size configurations
const SIZES = {
  sm: {
    outer: 32,
    inner: 24,
    iconSize: 'h-3 w-3',
    fontSize: 'text-[10px]',
    promptWidth: 'max-w-[160px]',
  },
  md: {
    outer: 48,
    inner: 36,
    iconSize: 'h-4 w-4',
    fontSize: 'text-xs',
    promptWidth: 'max-w-[200px]',
  },
  lg: {
    outer: 64,
    inner: 48,
    iconSize: 'h-5 w-5',
    fontSize: 'text-sm',
    promptWidth: 'max-w-[280px]',
  },
};

export function JourneyStation({
  id,
  label,
  vaPrompt,
  state,
  color,
  icon: Icon,
  options,
  isTerminal = false,
  onClick,
  onOptionSelect,
  size = 'md',
  showPrompt = true,
  className,
}: JourneyStationProps) {
  const sizeConfig = SIZES[size];
  const isActive = state === 'active';
  const isCompleted = state === 'completed';
  const isPending = state === 'pending';

  // Roundel colors based on state
  const outerColor = isCompleted || isActive ? color : isPending ? '#2a2a32' : '#2a2a32';
  const innerColor = isActive ? color : isCompleted ? color : '#0a0a0f';
  const iconColor = isActive || isCompleted ? '#ffffff' : '#6b6b75';

  return (
    <div className={cn('flex flex-col items-center', className)}>
      {/* Station Roundel */}
      <motion.button
        onClick={onClick}
        disabled={!onClick || isPending}
        className={cn(
          'relative flex items-center justify-center rounded-full transition-all',
          'focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-[#0a0a0f]',
          onClick && !isPending ? 'cursor-pointer hover:scale-105' : 'cursor-default'
        )}
        style={{
          width: sizeConfig.outer,
          height: sizeConfig.outer,
          backgroundColor: outerColor,
          boxShadow: isActive
            ? `0 0 0 4px ${color}30, 0 0 20px ${color}40`
            : 'none',
        }}
        whileHover={onClick && !isPending ? { scale: 1.08 } : {}}
        whileTap={onClick && !isPending ? { scale: 0.95 } : {}}
        animate={isActive ? {
          boxShadow: [
            `0 0 0 4px ${color}30, 0 0 20px ${color}40`,
            `0 0 0 8px ${color}20, 0 0 30px ${color}50`,
            `0 0 0 4px ${color}30, 0 0 20px ${color}40`,
          ],
        } : {}}
        transition={isActive ? {
          duration: 1.5,
          repeat: Infinity,
          ease: 'easeInOut',
        } : {
          duration: 0.08, // < 100ms
        }}
      >
        {/* Inner circle (London Underground style) */}
        <motion.div
          className="absolute rounded-full flex items-center justify-center"
          style={{
            width: sizeConfig.inner,
            height: sizeConfig.inner,
            backgroundColor: innerColor,
          }}
          initial={{ scale: 0.8, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ duration: 0.08 }}
        >
          {/* Icon or checkmark */}
          {isCompleted ? (
            <motion.div
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ type: 'spring', stiffness: 500, damping: 25 }}
            >
              <Check className={cn(sizeConfig.iconSize, 'text-white')} strokeWidth={3} />
            </motion.div>
          ) : (
            <Icon
              className={sizeConfig.iconSize}
              style={{ color: iconColor }}
            />
          )}
        </motion.div>

        {/* Terminal station indicator (double ring) */}
        {isTerminal && (
          <motion.div
            className="absolute inset-0 rounded-full border-2"
            style={{ borderColor: outerColor }}
            initial={{ scale: 1.2, opacity: 0 }}
            animate={{ scale: 1.3, opacity: isActive || isCompleted ? 0.6 : 0.3 }}
            transition={{ duration: 0.08 }}
          />
        )}
      </motion.button>

      {/* Station Label */}
      <motion.span
        className={cn(
          'mt-2 font-bold uppercase tracking-wider text-center',
          sizeConfig.fontSize,
          isActive ? 'text-white' : isCompleted ? 'text-white/80' : 'text-white/40',
          "font-['Johnston',_'Gill_Sans',_sans-serif]"
        )}
        initial={{ opacity: 0, y: -4 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.08, delay: 0.02 }}
      >
        {label}
      </motion.span>

      {/* VA Prompt (shown when active) */}
      <AnimatePresence>
        {isActive && showPrompt && vaPrompt && (
          <motion.div
            className={cn(
              'mt-3 px-4 py-2 rounded-lg bg-white/10 border border-white/20',
              sizeConfig.promptWidth
            )}
            initial={{ opacity: 0, y: -8, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.95 }}
            transition={{ duration: 0.08 }}
          >
            <p className="text-sm text-white/90 text-center italic">
              "{vaPrompt}"
            </p>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Options/Branches (shown when active) */}
      <AnimatePresence>
        {isActive && options && options.length > 0 && (
          <motion.div
            className="mt-4 flex flex-wrap gap-2 justify-center"
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.08 }}
          >
            {options.map((option, index) => {
              const OptionIcon = option.icon;
              return (
                <motion.button
                  key={option.id}
                  onClick={() => onOptionSelect?.(option.id)}
                  className={cn(
                    'flex items-center gap-2 px-4 py-2 rounded-lg',
                    'border-2 transition-all',
                    'hover:scale-105 active:scale-95',
                    option.isDefault
                      ? 'border-green-500 bg-green-500/20 text-green-400'
                      : 'border-white/30 bg-white/5 text-white/80 hover:border-white/50 hover:bg-white/10'
                  )}
                  style={{
                    borderColor: option.color || (option.isDefault ? undefined : color + '60'),
                  }}
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ duration: 0.08, delay: index * 0.02 }}
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                >
                  <OptionIcon className="h-4 w-4" />
                  <span className="text-sm font-medium">{option.label}</span>
                </motion.button>
              );
            })}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// Compact station variant for inline displays
export interface CompactStationProps {
  label: string;
  state: StationState;
  color: string;
  icon: LucideIcon;
  onClick?: () => void;
}

export function CompactStation({
  label,
  state,
  color,
  icon: Icon,
  onClick,
}: CompactStationProps) {
  const isActive = state === 'active';
  const isCompleted = state === 'completed';

  return (
    <motion.button
      onClick={onClick}
      disabled={!onClick}
      className={cn(
        'flex items-center gap-2 px-3 py-1.5 rounded-full transition-all',
        isActive
          ? 'bg-white/10 border border-white/20'
          : isCompleted
            ? 'bg-white/5 border border-white/10'
            : 'bg-transparent border border-white/5',
        onClick ? 'cursor-pointer hover:bg-white/15' : 'cursor-default'
      )}
      whileHover={onClick ? { scale: 1.02 } : {}}
      whileTap={onClick ? { scale: 0.98 } : {}}
    >
      <div
        className="w-5 h-5 rounded-full flex items-center justify-center"
        style={{
          backgroundColor: isCompleted || isActive ? color : '#2a2a32',
        }}
      >
        {isCompleted ? (
          <Check className="h-3 w-3 text-white" strokeWidth={3} />
        ) : (
          <Icon
            className="h-3 w-3"
            style={{ color: isActive ? '#ffffff' : '#6b6b75' }}
          />
        )}
      </div>
      <span
        className={cn(
          'text-xs font-medium uppercase tracking-wide',
          isActive ? 'text-white' : isCompleted ? 'text-white/70' : 'text-white/40'
        )}
      >
        {label}
      </span>
    </motion.button>
  );
}

export default JourneyStation;
