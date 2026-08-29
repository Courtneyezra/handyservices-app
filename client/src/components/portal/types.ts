/**
 * Shared types for the unified mobile portal (/admin/portal, T5).
 *
 * These mirror server shapes read-only:
 *  - PortalCard is the subset of the inbox board card (server/inbox-board.ts toCard) the portal renders.
 *  - PortalIntake mirrors conversations.metadata.quotePrepIntake (server/agents/quote-prep.ts).
 *
 * Deliberately NO shadow-score fields: the portal renders lanes, never numeric confidence
 * (docs/AGENT_DECISION_FRAMEWORK.md — "output lanes, not scores").
 */

export type Lane = 'quote_ready' | 'needs_info' | 'visit_first';

export interface PortalCard {
    id: string;
    phoneNumber: string;
    displayPhone: string;
    contactName: string | null;
    lastMessagePreview: string | null;
    lastMessageAt: string | null;
    lastCustomerMessageAt: string | null;
    unreadCount: number;
    stage: string;
    priority: string;
    tags: string[];
    whoseMove: 'ben' | 'customer' | 'agent';
    bensDesk: boolean;
    /** The clerk's lane; string (not Lane) so future lanes render harmlessly (T6a seam). */
    intakeReadiness: string | null;
    openQuestionCount: number;
    heldDraftCount: number;
    callbackDue: boolean;
    complaint: boolean;
    agentDown: boolean;
    /** Whether the WhatsApp 24-hour reply window is currently open. */
    windowOpen: boolean;
    /** short_slug of the newest live (not draft, not revoked) quote — links to /quote/{quoteSlug}. */
    quoteSlug?: string | null;
    wait: { severity: 'breached' | 'due' | 'ok' | 'none'; awaitingReply: boolean };
}

export interface BoardResponse {
    stages: string[];
    columns: Record<string, PortalCard[]>;
}

export type GapImpact = 'none' | 'small' | 'large' | 'forks_job';

export interface PortalIntakeGap {
    question: string;
    audience: 'customer' | 'ben';
    lineIndex: number | null;
    /** Older stored intakes predate the impact label; render cautiously when absent. */
    impact?: GapImpact;
}

export interface PortalIntakeLine {
    title: string;
    detail: string;
    assumptions: string[];
}

export interface PortalIntake {
    customerName: string | null;
    phone: string;
    postcode: string | null;
    customerType?: string;
    lines: PortalIntakeLine[];
    assumptions: string[];
    readiness: string;
    gaps: PortalIntakeGap[];
    urgency: 'low' | 'med' | 'high';
}

export interface IntakeResponse {
    intake: PortalIntake | null;
    preparedAt: string | null;
    readiness: string | null;
}

/** One event on the unified thread timeline (GET /api/inbox/conversations/:id/thread). */
export interface TimelineEvent {
    kind: 'message' | 'call' | 'draft_event' | string;
    id: string;
    createdAt: string;
    // message fields
    direction?: 'inbound' | 'outbound';
    channel?: string;
    content?: string | null;
    type?: string | null;
    mediaUrl?: string | null;
    mediaType?: string | null;
    senderName?: string | null;
    sentVia?: string | null;
    neverSent?: boolean;
    // call fields
    durationSeconds?: number | null;
    summary?: string | null;
    outcome?: string | null;
    // draft_event fields (rejected/failed machinery, rendered as collapsible system lines)
    status?: string | null;
    source?: string;
    reason?: string | null;
    error?: string | null;
    body?: string;
}

/** A pending row from message_drafts — held in the approval gate, not yet sent. */
export interface PortalHeldDraft {
    id: string;
    body: string;
    channel: string;
    source: string;
    reason: string | null;
    status: string;
    createdAt: string;
}

/** An agent_questions row still in flight ('open'/'answered') or a flag for Ben ('flagged'). */
export interface PortalAgentQuestion {
    id: string;
    question: string;
    context: string | null;
    status: string;
    createdAt: string;
}

/** The thread's suppression record, when this person has told us to stop. */
export interface PortalOptOut {
    scope: string;
    at: string;
    source: string;
    channel: string | null;
    keyword?: string | null;
    text?: string | null;
}

export interface ThreadResponse {
    card: PortalCard;
    timeline: TimelineEvent[];
    totalMessages: number;
    truncated: boolean;
    drafts: PortalHeldDraft[];
    questions: PortalAgentQuestion[];
    optOut: PortalOptOut | null;
}

export function getAuthHeaders(): Record<string, string> {
    const token = localStorage.getItem('adminToken');
    return token ? { Authorization: `Bearer ${token}` } : {};
}

/** Compact age for a row: "12m", "5h", "3d". */
export function ageLabel(iso: string | null): string {
    if (!iso) return '—';
    const ms = Date.now() - new Date(iso).getTime();
    if (isNaN(ms)) return '—';
    const mins = Math.max(0, Math.floor(ms / 60_000));
    if (mins < 60) return `${mins}m`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h`;
    return `${Math.floor(hours / 24)}d`;
}
