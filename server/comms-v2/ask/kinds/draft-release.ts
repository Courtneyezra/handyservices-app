/**
 * draft.release: send the reply held on a case file exactly as it stands, through the board's human
 * send path (desk/human-reply.ts `sendHeldDraft`), under the confirming person and the confirm's run
 * id. The preview is the held draft; the executor refuses when the draft is no longer the one Ben
 * confirmed, in the same tick as the send reads it (the expected-draft check of the board's
 * one-tap send). The preconditions refuse a route the send has none for and a shut window, in the
 * send's own words, so no confirm is offered for a send certain to be refused. Everything else is
 * `sendHeldDraft`'s: the owner slot, the bubble ceiling and, live, the opt-out ledger.
 *
 * A thread kept with a person may still be sent on: it is a person's send on Ben's confirm.
 */
import { replyRouteOf, sendHeldDraft, shutWindowRefusal } from '../../desk/human-reply';
import { outgoingOf } from '../surface';
import type { ActionKindDef } from '../action-kinds';
import { PREVIEW_CHANGED } from '../actions';

export interface DraftReleaseArgs { caseFileId: string }

export const draftRelease: ActionKindDef<DraftReleaseArgs> = {
    kind: 'draft.release',
    label: 'Send as is',
    sends: true,
    parseArgs(raw) {
        const id = (raw as { caseFileId?: unknown } | null)?.caseFileId;
        return typeof id === 'string' && id.trim() ? { caseFileId: id.trim() } : null;
    },
    caseFileOf: (args) => args.caseFileId,
    async preconditions({ file, now }) {
        if (!file) return 'no such case file';
        if (!file.hold?.draft) return 'there is no held draft to send';
        const route = replyRouteOf(file, now);
        if (!route.ok) return route.reason;
        return shutWindowRefusal(route.channel, route.window);
    },
    async preview({ file, now }) {
        const draft = file?.hold?.draft;
        if (!file || !draft) return { ok: false, reason: 'there is no held draft to send' };
        return { ok: true, text: draft, outgoing: outgoingOf(file, now) };
    },
    async execute(ctx) {
        const { file } = ctx;
        if (!file) return { ok: false, reason: 'no such case file' };
        if (file.hold?.draft !== ctx.expectedPreview) return { ok: false, reason: PREVIEW_CHANGED };
        const out = await sendHeldDraft({ file, approver: ctx.approver, person: ctx.person, mode: ctx.mode, runId: ctx.runId });
        if (!out.ok) return { ok: false, reason: out.reason };
        return {
            ok: true,
            result: {
                approver: out.result.approver, runId: out.result.runId, channel: out.result.channel, turnId: out.result.turnId,
                bubbles: out.result.bubbles.map((b) => ({ text: b.text })), released: !!out.release,
            },
        };
    },
};
