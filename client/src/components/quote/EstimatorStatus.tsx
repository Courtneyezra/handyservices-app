// ---------------------------------------------------------------------------
// EstimatorStatus — overlay modal showing estimator agent progress
// ---------------------------------------------------------------------------
//
// Displays a modal while the estimator agent is researching materials, time,
// and procedure for quote lines. Polls every 2 seconds and auto-dismisses
// when complete. Calls onComplete with the QuoteBuild for hydration.

import React, { useEffect, useRef, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Loader2, X } from 'lucide-react';
import { pollEstimate } from '@/lib/quote-estimator';
import type { QuoteBuild } from '@shared/quote-build';

export interface EstimatorStatusProps {
  estimateId: string;
  onComplete: (build: QuoteBuild) => void;
  onCancel: () => void;
  onError: (error: string) => void;
}

export function EstimatorStatus({
  estimateId,
  onComplete,
  onCancel,
  onError,
}: EstimatorStatusProps) {
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const cancelledRef = useRef(false);
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const timerIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Elapsed time counter
  useEffect(() => {
    timerIntervalRef.current = setInterval(() => {
      setElapsedSeconds((s) => s + 1);
    }, 1000);

    return () => {
      if (timerIntervalRef.current) {
        clearInterval(timerIntervalRef.current);
      }
    };
  }, []);

  // Polling loop
  useEffect(() => {
    const doPoll = async () => {
      if (cancelledRef.current) return;

      try {
        const result = await pollEstimate(estimateId);

        if (cancelledRef.current) return;

        if (result.status === 'complete' && result.build) {
          // Stop polling
          if (pollIntervalRef.current) {
            clearInterval(pollIntervalRef.current);
            pollIntervalRef.current = null;
          }
          onComplete(result.build);
        } else if (result.status === 'failed') {
          // Stop polling
          if (pollIntervalRef.current) {
            clearInterval(pollIntervalRef.current);
            pollIntervalRef.current = null;
          }
          onError(result.error || 'Estimate failed');
        }
        // status === 'running': continue polling
      } catch (err) {
        if (cancelledRef.current) return;
        // Stop polling on error
        if (pollIntervalRef.current) {
          clearInterval(pollIntervalRef.current);
          pollIntervalRef.current = null;
        }
        onError(err instanceof Error ? err.message : 'Failed to poll estimate');
      }
    };

    // Initial poll
    doPoll();

    // Poll every 2 seconds
    pollIntervalRef.current = setInterval(doPoll, 2000);

    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
    };
  }, [estimateId, onComplete, onError]);

  const handleCancel = () => {
    cancelledRef.current = true;
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }
    onCancel();
  };

  // Format elapsed time
  const formatElapsed = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    if (mins > 0) {
      return `${mins}m ${secs}s`;
    }
    return `${secs}s`;
  };

  // Progress messages based on elapsed time
  const getProgressMessage = (): string => {
    if (elapsedSeconds < 5) {
      return 'Starting research...';
    }
    if (elapsedSeconds < 15) {
      return 'Searching materials catalog...';
    }
    if (elapsedSeconds < 30) {
      return 'Checking Screwfix prices...';
    }
    if (elapsedSeconds < 60) {
      return 'Estimating time from similar jobs...';
    }
    if (elapsedSeconds < 90) {
      return 'Building procedure steps...';
    }
    return 'Finalizing estimate...';
  };

  return (
    <Dialog open onOpenChange={(open) => !open && handleCancel()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-handy-navy">
            <Loader2 className="w-5 h-5 animate-spin text-handy-yellow" />
            Researching Job
          </DialogTitle>
          <DialogDescription>
            The estimator is researching materials, time, and procedures.
          </DialogDescription>
        </DialogHeader>

        <div className="py-6 space-y-4">
          {/* Progress indicator */}
          <div className="flex items-center justify-center">
            <div className="relative w-20 h-20">
              {/* Spinning ring */}
              <svg
                className="w-full h-full animate-spin"
                style={{ animationDuration: '3s' }}
                viewBox="0 0 100 100"
              >
                <circle
                  cx="50"
                  cy="50"
                  r="45"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="6"
                  className="text-handy-grid"
                />
                <circle
                  cx="50"
                  cy="50"
                  r="45"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="6"
                  strokeLinecap="round"
                  strokeDasharray="70 200"
                  className="text-handy-yellow"
                />
              </svg>
              {/* Center text */}
              <div className="absolute inset-0 flex items-center justify-center">
                <span className="text-sm font-semibold text-handy-navy tabular-nums">
                  {formatElapsed(elapsedSeconds)}
                </span>
              </div>
            </div>
          </div>

          {/* Status message */}
          <div className="text-center">
            <p className="text-sm font-medium text-handy-navy">
              {getProgressMessage()}
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              This typically takes 30-60 seconds
            </p>
          </div>

          {/* What we're doing list */}
          <div className="bg-handy-cream/50 rounded-lg p-3 space-y-1.5">
            <div className="flex items-center gap-2 text-xs">
              <span
                className={`w-2 h-2 rounded-full ${
                  elapsedSeconds >= 5 ? 'bg-green-500' : 'bg-handy-grid animate-pulse'
                }`}
              />
              <span className={elapsedSeconds >= 5 ? 'text-handy-navy' : 'text-muted-foreground'}>
                Matching materials from catalog
              </span>
            </div>
            <div className="flex items-center gap-2 text-xs">
              <span
                className={`w-2 h-2 rounded-full ${
                  elapsedSeconds >= 15
                    ? 'bg-green-500'
                    : elapsedSeconds >= 5
                      ? 'bg-handy-yellow animate-pulse'
                      : 'bg-handy-grid'
                }`}
              />
              <span
                className={elapsedSeconds >= 15 ? 'text-handy-navy' : 'text-muted-foreground'}
              >
                Fetching live supplier prices
              </span>
            </div>
            <div className="flex items-center gap-2 text-xs">
              <span
                className={`w-2 h-2 rounded-full ${
                  elapsedSeconds >= 30
                    ? 'bg-green-500'
                    : elapsedSeconds >= 15
                      ? 'bg-handy-yellow animate-pulse'
                      : 'bg-handy-grid'
                }`}
              />
              <span
                className={elapsedSeconds >= 30 ? 'text-handy-navy' : 'text-muted-foreground'}
              >
                Estimating time from history
              </span>
            </div>
            <div className="flex items-center gap-2 text-xs">
              <span
                className={`w-2 h-2 rounded-full ${
                  elapsedSeconds >= 60
                    ? 'bg-green-500'
                    : elapsedSeconds >= 30
                      ? 'bg-handy-yellow animate-pulse'
                      : 'bg-handy-grid'
                }`}
              />
              <span
                className={elapsedSeconds >= 60 ? 'text-handy-navy' : 'text-muted-foreground'}
              >
                Building procedure steps
              </span>
            </div>
          </div>
        </div>

        {/* Cancel button */}
        <div className="flex justify-end">
          <Button variant="outline" onClick={handleCancel} className="gap-2">
            <X className="w-4 h-4" />
            Cancel
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default EstimatorStatus;
