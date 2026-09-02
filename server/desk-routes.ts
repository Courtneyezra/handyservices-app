/**
 * server/desk-routes.ts — Ben's Desk: one ranked list of everything waiting
 * on a human (replies, pending drafts, call tasks, SLA breaches).
 *
 * B-WP4: GET /api/desk returns DeskItem[] (contract in shared/ops-types.ts),
 * merged from four sources and deduped to one item per underlying entity:
 *
 *   reply       loadBoardCards() cards with bensDesk === true
 *   draft       message_drafts rows in status 'pending'
 *   call_task   listVaCallTasks() open tasks
 *   sla_breach  detectSlaLane() over the sweep's candidate conversations,
 *               past the lane's SLA (same dueAt math as sla-sweep Pass B)
 *
 * Dedup keys on the underlying conversation/phone; when two kinds collide the
 * higher-signal kind wins (draft > call_task > sla_breach > reply — the
 * concrete one-click actions first, then the escalated state, then the plain
 * "your move") and the losing kind rides along as a badge. Ranked by
 * waitingWorkingHours DESCENDING — longest-waiting first.
 *
 * Mounted at /api/desk behind requireAdmin (server/index.ts — untouched).
 */
import { Router } from 'express';
import { db } from './db';
import { conversations, messageDrafts } from '@shared/schema';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { DeskItem } from '@shared/ops-types';
import { workingHoursBetween } from './comms-sla';
import {
    approveAssignmentProposal,
    listPendingAssignmentProposals,
    rejectAssignmentProposal,
} from './assignment-proposals';
import { loadBoardCards } from './inbox-board';
import { listVaCallTasks } from './agents/va-call-tasks';
import { detectSlaLane, getSlaSweepConfig } from './agents/sla-sweep';
import { addWorkingHours } from './agents/promise-tracker';

export const deskRouter = Router();

// ---------------------------------------------------------------- helpers

/** Last-10-digits phone key — the one join that works across `+447…`,
 *  `447…@c.us` and bare-digit storage (same trick as inbox-board). */
function digits10(phone: string | null | undefined): string {
    return (phone ?? '').replace('@c.us', '').replace(/\D/g, '').slice(-10);
}

function displayPhone(phone: string | null | undefined): string {
    const digits = (phone ?? '').replace('@c.us', '').replace(/\D/g, '');
    return digits ? `+${digits}` : '';
}

function clip(text: string | null | undefined, max = 200): string {
    const t = (text ?? '').trim();
    return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

// Higher number = higher signal; the winner keeps the item's kind on a dedup
// collision. Concrete one-click actions outrank states; between the states, a
// breach outranks a plain "your move".
const KIND_PRECEDENCE: Record<DeskItem['kind'], number> = {
    assignment: 5,
    draft: 4,
    call_task: 3,
    sla_breach: 2,
    reply: 1,
};

/** Merge `item` into the dedup map: highest-precedence kind wins, waiting
 *  clock keeps the LONGEST wait (the truest signal), badges/ids union. */
function mergeItem(map: Map<string, DeskItem>, key: string, item: DeskItem): void {
    const cur = map.get(key);
    if (!cur) {
        map.set(key, item);
        return;
    }
    const [winner, loser] = KIND_PRECEDENCE[item.kind] > KIND_PRECEDENCE[cur.kind]
        ? [item, cur] : [cur, item];
    winner.waitingWorkingHours = Math.max(winner.waitingWorkingHours, loser.waitingWorkingHours);
    winner.badges = Array.from(new Set([...winner.badges, loser.kind, ...loser.badges]));
    winner.conversationId = winner.conversationId ?? loser.conversationId;
    winner.draftId = winner.draftId ?? loser.draftId;
    winner.taskId = winner.taskId ?? loser.taskId;
    winner.intakeReadiness = winner.intakeReadiness ?? loser.intakeReadiness;
    if (!winner.contactName && loser.contactName) winner.contactName = loser.contactName;
    if (!winner.preview && loser.preview) winner.preview = loser.preview;
    map.set(key, winner);
}

// ---------------------------------------------------------------- the merge

/**
 * Build the ranked desk. Exported directly (not just via HTTP) so
 * scripts/_test-desk.ts and the ops manager agent can call it in-process.
 */
export async function buildDeskItems(opts?: { now?: Date }): Promise<DeskItem[]> {
    const now = opts?.now ?? new Date();
    const byKey = new Map<string, DeskItem>();

    // ---- 1) reply — board cards sitting on Ben's desk. The card's own wait
    // state is comms-sla's workingHoursBetween, so it is used verbatim.
    const board = await loadBoardCards({ limit: 500 });
    const cards = Object.values(board.columns as Record<string, any[]>).flat();
    const cardByDigits = new Map<string, any>();
    for (const card of cards) cardByDigits.set(digits10(card.phoneNumber), card);

    for (const card of cards) {
        if (!card.bensDesk) continue;
        const badges: string[] = [card.stage];
        if ((card.priority ?? 'normal') !== 'normal') badges.push(card.priority);
        if (card.wait?.breached) badges.push('over SLA');
        if (card.complaint) badges.push('complaint');
        if (card.callbackDue) badges.push('callback due');
        if (card.agentDown) badges.push('agent down');
        if (card.heldDraftCount > 0) badges.push(`${card.heldDraftCount} held draft${card.heldDraftCount === 1 ? '' : 's'}`);
        if (card.openQuestionCount > 0) badges.push(`${card.openQuestionCount} open question${card.openQuestionCount === 1 ? '' : 's'}`);
        if (card.quoteValueGBP) badges.push(`£${card.quoteValueGBP} quote`);
        mergeItem(byKey, digits10(card.phoneNumber) || card.id, {
            kind: 'reply',
            conversationId: card.id,
            phone: card.displayPhone ?? displayPhone(card.phoneNumber),
            contactName: card.contactName ?? '',
            title: 'Reply needed',
            preview: clip(card.lastMessagePreview),
            waitingWorkingHours: card.wait?.waitingWorkingHours ?? 0,
            href: `/admin/comms?conversation=${card.id}`,
            badges,
            intakeReadiness: card.intakeReadiness ?? null,
        });
    }

    // ---- 2) draft — pending message_drafts awaiting human approval.
    const pendingDrafts = await db.select().from(messageDrafts)
        .where(eq(messageDrafts.status, 'pending'))
        .limit(100);

    // Contact names for drafts whose conversation isn't on the board.
    const missingConvIds = Array.from(new Set(
        pendingDrafts
            .map((d) => d.conversationId)
            .filter((id): id is string => !!id && !cards.some((c) => c.id === id)),
    ));
    const convById = new Map<string, { contactName: string | null; phoneNumber: string }>();
    if (missingConvIds.length) {
        const rows = await db.select({
            id: conversations.id,
            contactName: conversations.contactName,
            phoneNumber: conversations.phoneNumber,
        }).from(conversations).where(inArray(conversations.id, missingConvIds));
        for (const r of rows) convById.set(r.id, r);
    }

    for (const draft of pendingDrafts) {
        const card = cardByDigits.get(digits10(draft.phone));
        const conv = draft.conversationId ? convById.get(draft.conversationId) : undefined;
        const conversationId = draft.conversationId ?? card?.id;
        const badges: string[] = [draft.channel ?? 'whatsapp'];
        if (draft.source) badges.push(draft.source);
        mergeItem(byKey, digits10(draft.phone) || `draft:${draft.id}`, {
            kind: 'draft',
            conversationId: conversationId ?? undefined,
            phone: displayPhone(draft.phone),
            contactName: card?.contactName ?? conv?.contactName ?? '',
            title: 'Approve draft',
            preview: clip(draft.body),
            waitingWorkingHours: workingHoursBetween(new Date(draft.createdAt), now),
            // Drafts are approved in the comms thread view (draft_delta targets it).
            href: conversationId ? `/admin/comms?conversation=${conversationId}` : '/admin/comms',
            badges,
            draftId: draft.id,
        });
    }

    // ---- 3) call_task — open VA call tasks.
    const { open: openTasks } = await listVaCallTasks();
    for (const task of openTasks) {
        const badges: string[] = [task.channel];
        if (new Date(task.dueAt).getTime() < now.getTime()) badges.push('overdue');
        mergeItem(byKey, digits10(task.phone) || `task:${task.id}`, {
            kind: 'call_task',
            conversationId: task.conversationId,
            phone: displayPhone(task.phone),
            contactName: task.contactName ?? '',
            title: 'Call back',
            preview: clip(task.reason ?? task.context?.[task.context.length - 1]?.content ?? ''),
            waitingWorkingHours: workingHoursBetween(new Date(task.createdAt), now),
            href: '/admin/va-tasks',
            badges,
            taskId: task.id,
        });
    }

    // ---- 4) sla_breach — the sweep's lane detection over its own candidate
    // set (same predicate + dueAt math as sla-sweep Pass B, read-only).
    try {
        const cfg = await getSlaSweepConfig();
        const candidates = await db.select({
            id: conversations.id,
            phoneNumber: conversations.phoneNumber,
            contactName: conversations.contactName,
            tags: conversations.tags,
            metadata: conversations.metadata,
        }).from(conversations)
            .where(and(
                isNull(conversations.archivedAt),
                sql`(${conversations.stage} IS NULL OR ${conversations.stage} NOT IN ('closed', 'won'))`,
                // P8: a spine clerk intake lives on agent_runs, not metadata — include those threads too.
                sql`(${conversations.metadata}->'quotePrepIntake'->>'readiness' IS NOT NULL OR 'needs_ben' = ANY(${conversations.tags})
                    OR EXISTS (SELECT 1 FROM agent_runs r WHERE r.conversation_id = ${conversations.id} AND r.agent = 'quote_clerk'))`,
            ))
            .limit(100);

        for (const conv of candidates) {
            const det = await detectSlaLane(conv);
            if (!det) continue;
            if (now.getTime() - det.enteredAt.getTime() > cfg.maxLaneAgeDays * 86_400_000) continue; // fossil
            const laneCfg = cfg.lanes[det.lane];
            if (!laneCfg) continue;
            const dueAt = det.lane === 'needs_info'
                ? new Date(det.enteredAt.getTime() + cfg.lanes.needs_info.clockHours * 3_600_000)
                : addWorkingHours(det.enteredAt, (laneCfg as { workingHours: number }).workingHours);
            if (now.getTime() < dueAt.getTime()) continue; // in lane, not yet breached

            mergeItem(byKey, digits10(conv.phoneNumber) || conv.id, {
                kind: 'sla_breach',
                conversationId: conv.id,
                phone: displayPhone(conv.phoneNumber),
                contactName: conv.contactName ?? '',
                title: `SLA breach: ${det.lane.replace(/_/g, ' ')}`,
                preview: clip(det.detail),
                waitingWorkingHours: workingHoursBetween(det.enteredAt, now),
                href: `/admin/comms?conversation=${conv.id}`,
                badges: [det.lane, 'over SLA'],
            });
        }
    } catch (error: any) {
        // The desk must never 500 because lane detection hiccuped — the other
        // three sources still render; breaches also surface as reply badges.
        console.error('[Desk] SLA lane detection failed (serving without breaches):', error?.message);
    }

    // ---- 5) assignment — pending assignment proposals awaiting approve/
    // reject (D-WP3). Keyed on the proposal id, NOT the customer phone: a
    // proposal is about a job, and mergeItem doesn't carry proposalId, so a
    // phone collision with a conversation item would strand the approve
    // buttons. Riding alongside a reply for the same customer is correct.
    try {
        const proposals = await listPendingAssignmentProposals();
        for (const p of proposals) {
            mergeItem(byKey, `proposal:${p.id}`, {
                kind: 'assignment',
                phone: displayPhone(p.customerPhone),
                contactName: p.customerName ?? '',
                title: `Assign ${p.contractorName} → ${p.customerName ?? 'customer'}`,
                preview: clip(p.note),
                waitingWorkingHours: workingHoursBetween(new Date(p.createdAt), now),
                href: '/admin/dispatch',
                badges: ['PROPOSAL', ...(Array.isArray(p.scheduledDates) && p.scheduledDates.length
                    ? [(p.scheduledDates as string[])[0]] : [])],
                proposalId: p.id,
            });
        }
    } catch (error: any) {
        // Same contract as lane detection: the desk never 500s because one
        // source hiccuped — the other sources still render.
        console.error('[Desk] Assignment proposal listing failed (serving without proposals):', error?.message);
    }

    // ---- rank: longest-waiting first; ties broken by signal then name so the
    // order is stable across refetches.
    return Array.from(byKey.values()).sort((a, b) =>
        b.waitingWorkingHours - a.waitingWorkingHours
        || KIND_PRECEDENCE[b.kind] - KIND_PRECEDENCE[a.kind]
        || a.contactName.localeCompare(b.contactName));
}

// ---------------------------------------------------------------- route

deskRouter.get('/', async (_req, res) => {
    try {
        res.json(await buildDeskItems());
    } catch (error: any) {
        console.error('[Desk] Failed to build desk:', error?.message);
        res.status(500).json({ error: 'desk_failed' });
    }
});

// ---- D-WP3: assignment proposal decisions. Mounted behind requireAdmin
// (same as the whole router) — decidedBy is the authed admin. Approve is the
// ONLY path from a proposal to a real assignment (assignJobToContractor).

deskRouter.post('/proposals/:id/approve', async (req, res) => {
    const decidedBy = (req as any).user?.email || (req as any).user?.id || 'admin';
    try {
        const result = await approveAssignmentProposal(req.params.id, decidedBy);
        if (result.ok) return res.json({ proposal: result.proposal });
        if (result.code === 'not_found') return res.status(404).json({ error: result.error });
        if (result.code === 'not_pending') return res.status(409).json({ error: result.error, proposal: result.proposal });
        // assign_failed: the decision landed (status 'failed') but the
        // assignment didn't — 200 with the error so the desk can show it.
        return res.json({ proposal: result.proposal, error: result.error });
    } catch (error: any) {
        console.error('[Desk] Proposal approve failed:', error?.message);
        res.status(500).json({ error: 'proposal_approve_failed' });
    }
});

deskRouter.post('/proposals/:id/reject', async (req, res) => {
    const decidedBy = (req as any).user?.email || (req as any).user?.id || 'admin';
    try {
        const result = await rejectAssignmentProposal(req.params.id, decidedBy);
        if (result.ok) return res.json({ proposal: result.proposal });
        if (result.code === 'not_found') return res.status(404).json({ error: result.error });
        return res.status(409).json({ error: result.error, proposal: result.proposal });
    } catch (error: any) {
        console.error('[Desk] Proposal reject failed:', error?.message);
        res.status(500).json({ error: 'proposal_reject_failed' });
    }
});
