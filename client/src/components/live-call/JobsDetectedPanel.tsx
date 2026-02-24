/**
 * Jobs Detected Panel
 *
 * Shows a live list of jobs mentioned in the call with:
 * - Matched SKUs with prices
 * - Unmatched jobs that need video/visit
 * - Running total for matched SKUs
 * - Route recommendation based on matches
 */

import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  CheckCircle2,
  AlertTriangle,
  FileText,
  Video,
  MapPin,
  Package,
  PoundSterling
} from 'lucide-react';
import { cn } from '@/lib/utils';

export interface DetectedJob {
  id: string;
  description: string;        // What the customer said
  matched: boolean;           // SKU found?
  sku?: {
    id: string;
    name: string;
    pricePence: number;
    category?: string;
  };
  confidence?: number;        // Match confidence 0-100
  timestamp?: Date;           // When detected
}

export interface JobsDetectedPanelProps {
  jobs: DetectedJob[];
  className?: string;
}

// Format price in pounds
function formatPrice(pence: number): string {
  return `£${(pence / 100).toFixed(0)}`;
}

// Get route recommendation based on jobs
function getRouteRecommendation(jobs: DetectedJob[]): {
  route: 'INSTANT' | 'VIDEO' | 'VISIT';
  color: string;
  icon: React.ElementType;
  reason: string;
} {
  if (jobs.length === 0) {
    return {
      route: 'VIDEO',
      color: '#EAB308',
      icon: Video,
      reason: 'No jobs detected yet',
    };
  }

  const hasUnmatched = jobs.some(j => !j.matched);
  const unmatchedCount = jobs.filter(j => !j.matched).length;

  if (!hasUnmatched) {
    return {
      route: 'INSTANT',
      color: '#22C55E',
      icon: FileText,
      reason: 'All jobs have SKU matches',
    };
  } else if (unmatchedCount === jobs.length) {
    return {
      route: 'VISIT',
      color: '#3B82F6',
      icon: MapPin,
      reason: 'No SKU matches - needs assessment',
    };
  } else {
    return {
      route: 'VIDEO',
      color: '#EAB308',
      icon: Video,
      reason: `${unmatchedCount} job${unmatchedCount > 1 ? 's' : ''} need${unmatchedCount === 1 ? 's' : ''} visual confirmation`,
    };
  }
}

export function JobsDetectedPanel({ jobs, className }: JobsDetectedPanelProps) {
  // Calculate totals
  const matchedJobs = jobs.filter(j => j.matched && j.sku);
  const unmatchedJobs = jobs.filter(j => !j.matched);
  const totalPence = matchedJobs.reduce((sum, j) => sum + (j.sku?.pricePence || 0), 0);

  // Get route recommendation
  const route = getRouteRecommendation(jobs);
  const RouteIcon = route.icon;

  return (
    <div className={cn(
      'bg-[#12121a] border border-white/10 rounded-xl overflow-hidden',
      className
    )}>
      {/* Header */}
      <div className="px-4 py-3 border-b border-white/10 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Package className="w-4 h-4 text-white/60" />
          <span className="text-sm font-semibold text-white">Jobs Detected</span>
          {jobs.length > 0 && (
            <span className="text-xs text-white/40 bg-white/10 px-2 py-0.5 rounded-full">
              {jobs.length}
            </span>
          )}
        </div>
      </div>

      {/* Jobs List */}
      <div className="max-h-[300px] overflow-y-auto">
        <AnimatePresence mode="popLayout">
          {jobs.length === 0 ? (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="px-4 py-8 text-center"
            >
              <p className="text-sm text-white/40">Listening for jobs...</p>
            </motion.div>
          ) : (
            jobs.map((job, index) => (
              <motion.div
                key={job.id}
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                transition={{ duration: 0.15, delay: index * 0.05 }}
                className={cn(
                  'px-4 py-3 border-b border-white/5',
                  'hover:bg-white/5 transition-colors'
                )}
              >
                <div className="flex items-start justify-between gap-3">
                  {/* Left: Status + Description */}
                  <div className="flex items-start gap-2 flex-1 min-w-0">
                    {job.matched ? (
                      <CheckCircle2 className="w-5 h-5 text-green-500 flex-shrink-0 mt-0.5" />
                    ) : (
                      <AlertTriangle className="w-5 h-5 text-amber-500 flex-shrink-0 mt-0.5" />
                    )}
                    <div className="flex-1 min-w-0">
                      <p className={cn(
                        'text-sm font-medium truncate',
                        job.matched ? 'text-white' : 'text-amber-200'
                      )}>
                        {job.matched && job.sku ? job.sku.name : `"${job.description}"`}
                      </p>
                      {job.matched && job.sku ? (
                        <p className="text-xs text-white/40 mt-0.5">
                          SKU: {job.sku.id}
                          {job.sku.category && ` • ${job.sku.category}`}
                        </p>
                      ) : (
                        <p className="text-xs text-amber-500/70 mt-0.5">
                          No SKU match - needs video/visit
                        </p>
                      )}
                    </div>
                  </div>

                  {/* Right: Price */}
                  {job.matched && job.sku && (
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <span className="text-sm font-bold text-green-400">
                        {formatPrice(job.sku.pricePence)}
                      </span>
                    </div>
                  )}
                </div>
              </motion.div>
            ))
          )}
        </AnimatePresence>
      </div>

      {/* Footer: Totals + Route */}
      {jobs.length > 0 && (
        <div className="border-t border-white/10">
          {/* Totals */}
          <div className="px-4 py-3 space-y-2">
            {matchedJobs.length > 0 && (
              <div className="flex items-center justify-between">
                <span className="text-sm text-white/60">
                  Matched ({matchedJobs.length})
                </span>
                <div className="flex items-center gap-1">
                  <PoundSterling className="w-4 h-4 text-green-400" />
                  <span className="text-lg font-bold text-green-400">
                    {formatPrice(totalPence)}
                  </span>
                </div>
              </div>
            )}
            {unmatchedJobs.length > 0 && (
              <div className="flex items-center justify-between">
                <span className="text-sm text-white/60">
                  Unmatched
                </span>
                <span className="text-sm text-amber-400">
                  {unmatchedJobs.length} job{unmatchedJobs.length > 1 ? 's' : ''}
                </span>
              </div>
            )}
          </div>

          {/* Route Recommendation */}
          <div
            className="px-4 py-3 border-t border-white/10"
            style={{ backgroundColor: `${route.color}15` }}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <RouteIcon
                  className="w-5 h-5"
                  style={{ color: route.color }}
                />
                <div>
                  <p
                    className="text-sm font-semibold"
                    style={{ color: route.color }}
                  >
                    {route.route === 'INSTANT' && '🟢 Instant Quote'}
                    {route.route === 'VIDEO' && '🟡 Video Quote'}
                    {route.route === 'VISIT' && '🔵 Site Visit'}
                  </p>
                  <p className="text-xs text-white/50">{route.reason}</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default JobsDetectedPanel;
