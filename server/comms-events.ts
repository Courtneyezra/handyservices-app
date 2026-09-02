// server/comms-events.ts
import { EventEmitter } from 'node:events';
import type { OpsCommsEvent } from '@shared/ops-types';

export type CommsEvent =
  | { type: 'board_delta'; conversationId: string; reason: 'inbound' | 'outbound' | 'stage' | 'tags' | 'priority' | 'sla' | 'other'; at: string }
  | { type: 'draft_delta'; draftId: number | string; conversationId?: string; status: 'pending' | 'approved' | 'sent' | 'rejected' | 'blocked' | 'edited'; at: string }
  | { type: 'run_started'; runId: string; conversationId: string; at: string }
  | { type: 'run_event'; runId: string; conversationId: string; event: unknown; at: string }
  | { type: 'run_finished'; runId: string; conversationId: string; ok: boolean; at: string }
  // Phase 4: a PROPOSE-tier artifact (quote intake, nudge batch) landed for a thread — the in-chat card refetches.
  | { type: 'artifact_delta'; conversationId: string; runId: string; kind: 'quote_intake' | 'nudge_batch' | 'quote_estimate'; at: string }
  // Track B: Ops Manager session events (shapes frozen in shared/ops-types.ts).
  // Same bus, all admin/VA listeners receive them; clients filter by sessionId.
  | OpsCommsEvent;

const bus = new EventEmitter();
bus.setMaxListeners(100);

export function emitCommsEvent(evt: CommsEvent): void {
  bus.emit('comms', evt);
}

export function onCommsEvent(cb: (evt: CommsEvent) => void): () => void {
  bus.on('comms', cb);
  return () => bus.off('comms', cb);
}
