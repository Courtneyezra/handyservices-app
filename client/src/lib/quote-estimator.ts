// ---------------------------------------------------------------------------
// Quote Estimator API — client-side helpers for the F-WP2 estimator agent
// ---------------------------------------------------------------------------
//
// The estimator agent researches materials (catalog/Screwfix/web), time
// (historical + model), and procedure for each line. These helpers manage
// the async polling flow: start an estimate, poll until complete/failed,
// then hydrate the builder with the result.

import type { QuoteBuild, EstimatorLineInput } from '@shared/quote-build';

// Auth header shape mirrors the parent builder (Bearer adminToken from storage).
function getAuthHeaders(): Record<string, string> {
  const token = localStorage.getItem('adminToken');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/** Response from POST /api/pricing/estimate-build */
export interface EstimateStartResponse {
  estimateId: string;
  status: 'running';
}

/** Response from GET /api/pricing/estimate-build/:estimateId */
export interface EstimatePollResponse {
  status: 'running' | 'complete' | 'failed';
  build?: QuoteBuild;
  error?: string;
}

/**
 * Start a new estimator run. The agent processes lines asynchronously;
 * poll with pollEstimate() or use waitForEstimate() for convenience.
 */
export async function startEstimate(opts: {
  conversationId?: string;
  lines?: EstimatorLineInput[];
}): Promise<EstimateStartResponse> {
  const res = await fetch('/api/pricing/estimate-build', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
    body: JSON.stringify({
      conversationId: opts.conversationId,
      lines: opts.lines,
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Failed to start estimate' }));
    throw new Error(err.error || 'Failed to start estimate');
  }

  return res.json();
}

/**
 * Poll the status of an in-progress estimate. Returns immediately with
 * the current status; caller should loop if status === 'running'.
 */
export async function pollEstimate(estimateId: string): Promise<EstimatePollResponse> {
  const res = await fetch(`/api/pricing/estimate-build/${encodeURIComponent(estimateId)}`, {
    method: 'GET',
    headers: { ...getAuthHeaders() },
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Failed to poll estimate' }));
    throw new Error(err.error || 'Failed to poll estimate');
  }

  return res.json();
}

/**
 * Convenience: poll until complete or failed, with configurable timeout.
 * Throws on timeout or if the estimate fails.
 */
export async function waitForEstimate(
  estimateId: string,
  opts?: {
    pollIntervalMs?: number;
    timeoutMs?: number;
  },
): Promise<EstimatePollResponse> {
  const pollInterval = opts?.pollIntervalMs ?? 2000;
  const timeout = opts?.timeoutMs ?? 180000; // 3 minutes default
  const started = Date.now();

  while (true) {
    const result = await pollEstimate(estimateId);

    if (result.status === 'complete') {
      return result;
    }

    if (result.status === 'failed') {
      throw new Error(result.error || 'Estimate failed');
    }

    // Check timeout
    if (Date.now() - started > timeout) {
      throw new Error('Estimate timed out');
    }

    // Wait before next poll
    await new Promise((resolve) => setTimeout(resolve, pollInterval));
  }
}
