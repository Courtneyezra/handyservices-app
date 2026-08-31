/**
 * shared/ops-types.ts — Track B contract file. FROZEN after B-Phase0.
 *
 * The Ops Manager agent (server/agents/ops-manager.ts), its HTTP/session layer
 * (server/ops-manager-routes.ts), the chat dock (client/src/components/ops/*)
 * and Ben's Desk (server/desk-routes.ts, DeskPage) all build against these
 * shapes in parallel. Changes here go through the orchestrator only.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Run steps (lean transcript events on the wire)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * One shrunk agent-transcript event, exactly as produced by the
 * leanTranscriptEvent() shaper (strings truncated to 500 chars, depth-capped).
 * `type` mirrors AgentTranscriptEvent['type'] from server/agents/runner.ts
 * ('assistant' | 'tool_call' | 'tool_result' | 'tool_error' | 'error' | ...).
 * tool_call carries {tool, input}; tool_result {tool, result}; tool_error
 * {tool, error}; everything else rides in `detail`.
 */
export interface LeanRunStep {
  at: string;
  type: string;
  tool?: string;
  input?: unknown;
  result?: unknown;
  error?: unknown;
  detail?: unknown;
}

// ─────────────────────────────────────────────────────────────────────────────
// Sessions & messages (DTOs — dates are ISO strings on the wire)
// ─────────────────────────────────────────────────────────────────────────────

export interface OpsSessionDTO {
  id: string;
  title: string;
  createdBy: string;
  status: 'active' | 'archived';
  createdAt: string;
  updatedAt: string;
}

export interface OpsMessageDTO {
  id: string;
  sessionId: string;
  role: 'user' | 'assistant';
  content: string;
  /** Present on assistant rows produced by a run. */
  runId?: string | null;
  /** Lean transcript of the run that produced this assistant message. */
  transcript?: LeanRunStep[] | null;
  /** Token usage blob from the runner (shape owned by AgentRunUsage). */
  usage?: unknown | null;
  createdAt: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// SSE events (additive extension of the comms event bus union)
// ─────────────────────────────────────────────────────────────────────────────
// NOTE: the comms SSE bus broadcasts to ALL admin/VA listeners; clients filter
// ops_* events by sessionId themselves.

export type OpsCommsEvent =
  | { type: 'ops_message'; sessionId: string; message: OpsMessageDTO; at: string }
  | { type: 'ops_run_started'; sessionId: string; runId: string; at: string }
  | { type: 'ops_run_event'; sessionId: string; runId: string; step: LeanRunStep; at: string }
  | { type: 'ops_run_finished'; sessionId: string; runId: string; ok: boolean; at: string };

// ─────────────────────────────────────────────────────────────────────────────
// Tool results
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Result of the ops manager's queue_draft tool. The ONLY exit toward a
 * customer: a message_drafts row in status 'pending' awaiting human approval.
 * 'suppressed' = opt-out/suppression rails stopped it; 'refused' = guard
 * rails refused it (refusal explains why; no draftId in that case).
 */
export interface QueueDraftToolResult {
  /** message_drafts.id (varchar). Null when status is 'refused'. */
  draftId: string | null;
  status: 'pending' | 'suppressed' | 'refused';
  preview: string;
  refusal?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Ben's Desk
// ─────────────────────────────────────────────────────────────────────────────

export interface DeskItem {
  kind: 'reply' | 'draft' | 'call_task' | 'sla_breach' | 'assignment';
  conversationId?: string;
  phone: string;
  contactName: string;
  title: string;
  preview: string;
  /** Working-hours the item has been waiting (comms-sla workingHoursBetween). */
  waitingWorkingHours: number;
  /** Deep link to act on the item (/admin/comms?..., /admin/va-tasks, ...). */
  href: string;
  badges: string[];
  /** kind === 'draft' */
  draftId?: string;
  /** kind === 'call_task' */
  taskId?: string;
  /** kind === 'assignment' — a pending assignment_proposals row awaiting approve/reject. */
  proposalId?: string;
  /** Quote readiness from the conversation's intake state.
   *  quote_pending = research is running (show "Researching..." spinner).
   *  quote_ready = research complete (show "Build Quote" button). */
  intakeReadiness?: 'quote_pending' | 'quote_ready' | 'needs_info' | 'visit_first' | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Agent entry point
// ─────────────────────────────────────────────────────────────────────────────

export interface RunOpsManagerTurnOptions {
  sessionId: string;
  userMessage: string;
  /** Prior session messages, oldest first. The agent caps what it feeds the model (~20). */
  history: OpsMessageDTO[];
  /** Live step stream for SSE relay. */
  onEvent?: (step: LeanRunStep) => void;
}

export interface RunOpsManagerTurnResult {
  finalText: string;
  leanTranscript: LeanRunStep[];
  usage: unknown;
}

export type RunOpsManagerTurn = (opts: RunOpsManagerTurnOptions) => Promise<RunOpsManagerTurnResult>;

