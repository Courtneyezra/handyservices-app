/**
 * server/assignment-proposals.ts — D-WP3: assignment proposal rails.
 *
 * The ops agent PROPOSES a job assignment; nothing is assigned until a human
 * approves. Mirrors the message_drafts pattern: the agent's only exit is a
 * pending assignment_proposals row that a human decides on. The approve path
 * calls assignJobToContractor (server/pipeline/actions.ts) — the exact same
 * code the dispatch UI uses, so availability/conflict checks and the
 * scheduled_dates jsonb invariant are preserved.
 *
 * Lifecycle: pending → approved | rejected | failed
 *   - approved: human approved AND assignJobToContractor succeeded
 *   - failed:   human approved but the assignment failed (error recorded)
 *   - rejected: human said no; nothing touched the job
 *
 * A partial unique index (uq_assignment_proposals_pending) allows ONE pending
 * proposal per job — a concurrent duplicate create returns the existing
 * pending row (alreadyPending: true) instead of throwing.
 */
import { and, eq, desc } from 'drizzle-orm';
import { db } from './db';
import {
    assignmentProposals,
    contractorBookingRequests,
    handymanProfiles,
    users,
    type AssignmentProposal,
} from '@shared/schema';
import { assignJobToContractor } from './pipeline/actions';

// ---------------------------------------------------------------- create

export interface CreateAssignmentProposalInput {
    /** contractor_booking_requests id */
    jobId: string;
    /** handyman_profiles id */
    contractorId: string;
    /** Proposed dates (YYYY-MM-DD, first = start day). Optional — falls back to the job's own date on approve. */
    scheduledDates?: string[] | null;
    /** The agent's one-line rationale for the approver. */
    note: string;
    /** e.g. 'ops_manager' */
    createdBy: string;
}

export type CreateAssignmentProposalResult =
    | { ok: true; proposal: AssignmentProposal; alreadyPending: boolean }
    | { ok: false; error: string };

// assignmentStatus values that mean "already assigned or terminal" — no new
// proposal makes sense. 'rejected' (contractor declined, needs reassignment)
// and 'unassigned' are proposable.
const UNPROPOSABLE_ASSIGNMENT_STATUSES = ['assigned', 'accepted', 'in_progress', 'completed'];

function isUniqueViolation(err: any): boolean {
    return err?.code === '23505' || /duplicate key/i.test(err?.message || '');
}

/**
 * Validate the job + contractor, then insert a 'pending' proposal. On the
 * partial-unique race (another pending proposal for the same job) the existing
 * pending row is returned with alreadyPending: true.
 */
export async function createAssignmentProposal(
    input: CreateAssignmentProposalInput,
): Promise<CreateAssignmentProposalResult> {
    const { jobId, contractorId, scheduledDates, note, createdBy } = input;
    if (!jobId || !contractorId || !note?.trim() || !createdBy) {
        return { ok: false, error: 'jobId, contractorId, note and createdBy are required' };
    }

    const [job] = await db.select({
        id: contractorBookingRequests.id,
        status: contractorBookingRequests.status,
        assignmentStatus: contractorBookingRequests.assignmentStatus,
    }).from(contractorBookingRequests)
        .where(eq(contractorBookingRequests.id, jobId))
        .limit(1);
    if (!job) return { ok: false, error: `Job ${jobId} not found` };
    if (UNPROPOSABLE_ASSIGNMENT_STATUSES.includes(job.assignmentStatus ?? '')) {
        return { ok: false, error: `Job is already ${job.assignmentStatus} — nothing to propose` };
    }
    if (job.status === 'completed') {
        return { ok: false, error: 'Job is completed — nothing to propose' };
    }

    const [contractor] = await db.select({ id: handymanProfiles.id })
        .from(handymanProfiles)
        .where(eq(handymanProfiles.id, contractorId))
        .limit(1);
    if (!contractor) return { ok: false, error: `Contractor profile ${contractorId} not found` };

    try {
        const [proposal] = await db.insert(assignmentProposals).values({
            jobId,
            contractorId,
            scheduledDates: scheduledDates?.length ? scheduledDates : null,
            note: note.trim(),
            createdBy,
        }).returning();
        return { ok: true, proposal, alreadyPending: false };
    } catch (err: any) {
        if (!isUniqueViolation(err)) throw err;
        // uq_assignment_proposals_pending — someone got there first. Surface
        // the existing pending proposal instead of erroring the agent turn.
        const [existing] = await db.select().from(assignmentProposals)
            .where(and(
                eq(assignmentProposals.jobId, jobId),
                eq(assignmentProposals.status, 'pending'),
            ))
            .limit(1);
        if (!existing) throw err; // decided between insert-fail and re-read — genuinely racy, rethrow
        return { ok: true, proposal: existing, alreadyPending: true };
    }
}

// ---------------------------------------------------------------- decide

export type DecideProposalResult =
    | { ok: true; proposal: AssignmentProposal }
    | { ok: false; code: 'not_found' | 'not_pending' | 'assign_failed'; error: string; proposal?: AssignmentProposal };

async function loadProposal(id: string): Promise<AssignmentProposal | undefined> {
    const [row] = await db.select().from(assignmentProposals)
        .where(eq(assignmentProposals.id, id)).limit(1);
    return row;
}

/** Distinguish not_found vs not_pending after a conditional update hit 0 rows. */
async function notPendingResult(id: string): Promise<DecideProposalResult> {
    const row = await loadProposal(id);
    if (!row) return { ok: false, code: 'not_found', error: 'Proposal not found' };
    return { ok: false, code: 'not_pending', error: `Proposal is already ${row.status}`, proposal: row };
}

/**
 * Approve a pending proposal: atomically claim it (pending → approved), then
 * run assignJobToContractor. If the assignment fails the proposal flips to
 * 'failed' with the error recorded, and the error is returned to the caller.
 */
export async function approveAssignmentProposal(id: string, decidedBy: string): Promise<DecideProposalResult> {
    // Atomic pending → approved claim; a concurrent decide loses cleanly.
    const [claimed] = await db.update(assignmentProposals)
        .set({ status: 'approved', decidedBy, decidedAt: new Date(), updatedAt: new Date() })
        .where(and(eq(assignmentProposals.id, id), eq(assignmentProposals.status, 'pending')))
        .returning();
    if (!claimed) return notPendingResult(id);

    const fail = async (error: string): Promise<DecideProposalResult> => {
        const [failed] = await db.update(assignmentProposals)
            .set({ status: 'failed', error, updatedAt: new Date() })
            .where(eq(assignmentProposals.id, id))
            .returning();
        return { ok: false, code: 'assign_failed', error, proposal: failed ?? claimed };
    };

    // Resolve the start date: first proposed date, else the job's own date.
    const proposedDates = Array.isArray(claimed.scheduledDates)
        ? (claimed.scheduledDates as string[]).filter((d) => typeof d === 'string' && d)
        : [];
    let scheduledDate: string | null = proposedDates[0] ?? null;
    if (!scheduledDate) {
        const [job] = await db.select({ scheduledDate: contractorBookingRequests.scheduledDate })
            .from(contractorBookingRequests)
            .where(eq(contractorBookingRequests.id, claimed.jobId))
            .limit(1);
        if (job?.scheduledDate) scheduledDate = new Date(job.scheduledDate).toISOString().slice(0, 10);
    }
    if (!scheduledDate) {
        return fail('No scheduled date: the proposal has no dates and the job has no scheduled_date');
    }

    try {
        // The one real assignment path — availability/conflict checks and the
        // scheduled_dates jsonb invariant all live inside this action.
        const result = await assignJobToContractor({
            jobId: claimed.jobId,
            contractorId: claimed.contractorId,
            scheduledDate,
        });
        if (!result.ok) {
            return fail(typeof result.body.error === 'string' ? result.body.error : JSON.stringify(result.body));
        }
    } catch (err: any) {
        return fail(err?.message || 'assignJobToContractor threw');
    }

    return { ok: true, proposal: claimed };
}

/** Reject a pending proposal. Only from 'pending'; touches nothing else. */
export async function rejectAssignmentProposal(id: string, decidedBy: string): Promise<DecideProposalResult> {
    const [rejected] = await db.update(assignmentProposals)
        .set({ status: 'rejected', decidedBy, decidedAt: new Date(), updatedAt: new Date() })
        .where(and(eq(assignmentProposals.id, id), eq(assignmentProposals.status, 'pending')))
        .returning();
    if (!rejected) return notPendingResult(id);
    return { ok: true, proposal: rejected };
}

// ---------------------------------------------------------------- list

export interface PendingAssignmentProposal extends AssignmentProposal {
    customerName: string | null;
    customerPhone: string | null;
    jobDescription: string | null;
    contractorName: string;
}

/**
 * Pending proposals joined for desk display: customer name/phone + job
 * description from the CBR, contractor display name from users (business
 * name as fallback). Newest first.
 */
export async function listPendingAssignmentProposals(): Promise<PendingAssignmentProposal[]> {
    const rows = await db.select({
        proposal: assignmentProposals,
        customerName: contractorBookingRequests.customerName,
        customerPhone: contractorBookingRequests.customerPhone,
        jobDescription: contractorBookingRequests.description,
        contractorFirstName: users.firstName,
        contractorLastName: users.lastName,
        contractorBusinessName: handymanProfiles.businessName,
    }).from(assignmentProposals)
        .leftJoin(contractorBookingRequests, eq(assignmentProposals.jobId, contractorBookingRequests.id))
        .leftJoin(handymanProfiles, eq(assignmentProposals.contractorId, handymanProfiles.id))
        .leftJoin(users, eq(handymanProfiles.userId, users.id))
        .where(eq(assignmentProposals.status, 'pending'))
        .orderBy(desc(assignmentProposals.createdAt))
        .limit(100);

    return rows.map((r) => ({
        ...r.proposal,
        customerName: r.customerName ?? null,
        customerPhone: r.customerPhone ?? null,
        jobDescription: r.jobDescription ?? null,
        contractorName: [r.contractorFirstName, r.contractorLastName].filter(Boolean).join(' ')
            || r.contractorBusinessName
            || 'Contractor',
    }));
}
