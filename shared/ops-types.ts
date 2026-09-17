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


// ─────────────────────────────────────────────────────────────────────────────
// Handy Desk: the answer surface (server/comms-v2/ask/)
// ─────────────────────────────────────────────────────────────────────────────
// Added 17 Sep 2026 for the comms-v2 ask agent, which reuses the session and
// SSE shapes above (OpsSessionDTO, OpsMessageDTO, LeanRunStep, the ops_* events)
// and carries OpsAnswer on its final message. Nothing here is read by the old
// Ops Manager. The surface is the only thing a Handy Desk client renders for an
// answer: one of the seven types below, then the outgoing tiles, then the
// confirm footer. server/comms-v2/README.md ("Handy Desk: the ask agent") says
// which types the agent produces today and where each one's data comes from.

/** The seven comms-v2 case-file stages, in board order (server/comms-v2/desk/case-file.ts STAGES). */
export type CaseStage = 'first_contact' | 'scoping' | 'ready' | 'quoted' | 'accepted' | 'booked' | 'done';

/** One turn of a case file, as the thread surface shows it. */
export interface SurfaceTurn {
  id: string;
  at: string;
  /** customer: an inbound turn; desk: an outbound turn the desk wrote; person: an outbound turn a `human:*` approver sent; system: anything else. */
  who: 'customer' | 'desk' | 'person' | 'system';
  channel: string;
  kind: string;
  body: string;
  /** Outbound only: the approver the send carried (`agent.comms_v2`, `human:<email>`). */
  approver: string | null;
  /** A call turn's summary once transcription has filled it in; absent on any other turn. */
  callSummary?: string | null;
}

/** One card of the floor: the comms-v2 board card (server/comms-v2/api/board.ts BoardCard), trimmed to what a bay token shows. */
export interface SurfaceBoardCard {
  id: string;
  stage: CaseStage;
  /** The amber ring: the file is held for a person. */
  held: boolean;
  holdReason: string | null;
  holdSince: string | null;
  /** Whether the hold carries a draft a person can send as is. */
  hasDraft: boolean;
  customerName: string | null;
  /** The party's canonical identity key (`phone:<national>` or `email:<address>`). */
  customerAddress: string;
  jobType: string | null;
  location: string | null;
  lastCustomerMessageAt: string | null;
}

/** One day of a contractor's week (server/lib/contractor-week.ts DayAvailability). Slots are AM / PM, never hours. */
export interface WeekCell {
  date: string;
  am: 'off' | 'open' | 'booked';
  pm: 'off' | 'open' | 'booked';
}

/** A job on the dispatch map (server/dispatch-map-routes.ts). */
export interface DispatchJob {
  quoteId: string;
  customerName: string;
  lat: number;
  lng: number;
  postcode: string | null;
  categories: string[];
}

/** A contractor on the dispatch map (server/dispatch-map-routes.ts). */
export interface DispatchContractor {
  id: string;
  name: string;
  lat: number;
  lng: number;
  radiusMiles: number | null;
  categories: string[];
}

/**
 * What an answer renders as. The ask agent produces `thread`, `floor` and `words`
 * today; `diary`, `map`, `quote` and `ledger` are typed so the design's six
 * surfaces have one contract, and are not produced until their sources are wired
 * to the new desk (quote and ledger also wait on money actions).
 */
export type AnswerSurface =
  | { type: 'thread'; caseFileId: string; phone: string; customerName: string | null; stage: CaseStage; turns: SurfaceTurn[] }
  | { type: 'diary'; weekStart: string; lanes: { contractorId: string; name: string; cells: WeekCell[] }[]; changed?: string[] }
  | { type: 'map'; jobs: DispatchJob[]; contractors: DispatchContractor[]; focus?: string }
  | { type: 'quote'; quoteId?: string; lines: { label: string; note?: string; pence: number }[]; totalPence: number }
  | { type: 'ledger'; rows: { phone: string; name: string; pence: number; daysLate: number; chased: string }[] }
  | { type: 'floor'; bays: { stage: CaseStage; cards: SurfaceBoardCard[] }[] }
  | { type: 'words' };

export type AnswerSurfaceType = AnswerSurface['type'];

/**
 * A server-side action a confirm button proposes. The agent never runs one; a
 * person pressing confirm does, through an existing route:
 *   draft.release -> POST /api/comms-v2/case-files/:caseFileId/send-held-draft
 * which is the board's human send path, with its approver check, window rule,
 * bubble ceiling and opt-out ledger. No other kind exists yet. The confirm
 * posts `{ expectedDraft }`, the tile's text, so a draft replaced since the
 * answer was shown is refused with HELD_DRAFT_CHANGED instead of sent.
 */
export type ConfirmAction =
  | { kind: 'draft.release'; args: { caseFileId: string } };

/** send-held-draft's 409 reason when the held draft is no longer the `expectedDraft` the caller saw. */
export const HELD_DRAFT_CHANGED = 'the held draft changed since you saw it';

/** One message that goes out if the person confirms: a held draft, shown as it stands. */
export interface OpsOutgoing {
  /** The channel address the reply would go to: E.164 for WhatsApp and SMS, the email address for email. */
  to: string;
  channel: 'wa' | 'sms' | 'email';
  text: string;
}

/** The ask agent's final answer, carried on its assistant message. */
export interface OpsAnswer {
  /** The reply line shown on the answer card. */
  finalText: string;
  surface: AnswerSurface;
  /** "What goes out when you confirm". Present only while a held draft stands. */
  outgoing?: OpsOutgoing[];
  confirm?: { label: string; action: ConfirmAction };
  /** The footer note: what the desk did, or why it could not. */
  note?: string;
}

/** How the person asked: typed in the ask bar, spoken, or a tap on a card or chip. */
export type AskVia = 'typed' | 'voice' | 'tap';

/** The file the ask is about: the card selected on the desk, by case file id or by the customer's address. */
export interface AskContext {
  caseFileId?: string | null;
  phone?: string | null;
}

/** An ask-agent message: the OpsMessageDTO shape with how it was asked, what it was about and, on the assistant row, the answer. */
export interface AskMessageDTO extends OpsMessageDTO {
  via?: AskVia | null;
  context?: AskContext | null;
  answer?: OpsAnswer | null;
}
