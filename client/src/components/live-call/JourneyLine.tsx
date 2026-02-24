/**
 * JourneyLine Component
 *
 * Animated SVG connecting lines between stations on the segment journey tree.
 * Uses London Underground tube line styling with segment-specific colors.
 */

import React, { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';

export interface JourneyLineProps {
  /** Starting station ID */
  fromStation: string;
  /** Ending station ID */
  toStation: string;
  /** Segment color (hex) */
  color: string;
  /** Whether the line has been traversed (completed) */
  isComplete?: boolean;
  /** Whether the line is currently active (being traversed) */
  isActive?: boolean;
  /** Whether the line is pending (not yet reached) */
  isPending?: boolean;
  /** Line orientation */
  orientation?: 'vertical' | 'horizontal' | 'diagonal-right' | 'diagonal-left';
  /** Line length in pixels */
  length?: number;
  /** Line thickness */
  thickness?: number;
  /** Animation delay for staggered reveals */
  delay?: number;
  /** Custom class name */
  className?: string;
}

export function JourneyLine({
  fromStation,
  toStation,
  color,
  isComplete = false,
  isActive = false,
  isPending = true,
  orientation = 'vertical',
  length = 60,
  thickness = 4,
  delay = 0,
  className,
}: JourneyLineProps) {
  const [isAnimating, setIsAnimating] = useState(false);

  // Trigger animation when becoming active or complete
  useEffect(() => {
    if (isActive || isComplete) {
      setIsAnimating(true);
    }
  }, [isActive, isComplete]);

  // Calculate SVG dimensions and path based on orientation
  const getDimensions = () => {
    switch (orientation) {
      case 'horizontal':
        return { width: length, height: thickness + 8 };
      case 'diagonal-right':
        return { width: length * 0.7, height: length };
      case 'diagonal-left':
        return { width: length * 0.7, height: length };
      case 'vertical':
      default:
        return { width: thickness + 8, height: length };
    }
  };

  const getPath = () => {
    const { width, height } = getDimensions();
    const halfThickness = thickness / 2;

    switch (orientation) {
      case 'horizontal':
        return `M ${halfThickness + 4} ${height / 2} L ${width - halfThickness - 4} ${height / 2}`;
      case 'diagonal-right':
        return `M ${halfThickness + 4} ${halfThickness + 4} L ${width - halfThickness - 4} ${height - halfThickness - 4}`;
      case 'diagonal-left':
        return `M ${width - halfThickness - 4} ${halfThickness + 4} L ${halfThickness + 4} ${height - halfThickness - 4}`;
      case 'vertical':
      default:
        return `M ${(thickness + 8) / 2} ${halfThickness + 4} L ${(thickness + 8) / 2} ${height - halfThickness - 4}`;
    }
  };

  const { width, height } = getDimensions();
  const path = getPath();
  const pathLength = length - thickness - 8;

  // Determine opacity and color based on state
  const lineOpacity = isComplete ? 1 : isActive ? 0.9 : isPending ? 0.2 : 0.2;
  const lineColor = isComplete || isActive ? color : '#4a4a52';

  return (
    <svg
      width={width}
      height={height}
      className={cn(
        'overflow-visible',
        className
      )}
      style={{
        filter: isActive ? `drop-shadow(0 0 6px ${color}60)` : undefined,
      }}
    >
      {/* Background track (always visible, dimmed) */}
      <path
        d={path}
        fill="none"
        stroke="#1f1f26"
        strokeWidth={thickness + 2}
        strokeLinecap="round"
      />

      {/* Main line with animation */}
      <motion.path
        d={path}
        fill="none"
        stroke={lineColor}
        strokeWidth={thickness}
        strokeLinecap="round"
        initial={{
          strokeDasharray: pathLength,
          strokeDashoffset: isPending ? pathLength : 0,
          opacity: 0.2,
        }}
        animate={{
          strokeDashoffset: isComplete || isActive ? 0 : pathLength,
          opacity: lineOpacity,
        }}
        transition={{
          strokeDashoffset: {
            duration: 0.08, // < 100ms for instant feel
            delay,
            ease: 'easeOut',
          },
          opacity: {
            duration: 0.05,
            delay,
          },
        }}
      />

      {/* Active pulse effect */}
      {isActive && (
        <motion.path
          d={path}
          fill="none"
          stroke={color}
          strokeWidth={thickness + 4}
          strokeLinecap="round"
          initial={{ opacity: 0 }}
          animate={{
            opacity: [0, 0.4, 0],
          }}
          transition={{
            duration: 1.2,
            repeat: Infinity,
            ease: 'easeInOut',
          }}
          style={{
            filter: `blur(4px)`,
          }}
        />
      )}
    </svg>
  );
}

// Branch line variant for option branches
export interface BranchLineProps extends Omit<JourneyLineProps, 'orientation'> {
  /** Direction the branch goes */
  direction: 'left' | 'right' | 'down';
  /** Branch angle in degrees (for non-standard angles) */
  angle?: number;
}

export function BranchLine({
  direction,
  angle,
  length = 40,
  thickness = 3,
  ...props
}: BranchLineProps) {
  const orientation = direction === 'down'
    ? 'vertical'
    : direction === 'right'
      ? 'diagonal-right'
      : 'diagonal-left';

  return (
    <JourneyLine
      {...props}
      orientation={orientation}
      length={length}
      thickness={thickness}
    />
  );
}

export default JourneyLine;
