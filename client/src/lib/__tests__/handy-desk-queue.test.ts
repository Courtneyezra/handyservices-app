/**
 * Handy Desk T1 - a held case file from the new desk reads as a "Needs you" card: the badge is the
 * hold reason and the working-hours wait, a held draft offers "Send as is" / "Rewrite", no draft
 * offers "Answer in words" with "Release" under "More", each on the board's own route, and a refusal reads as the
 * desk said it.
 */
import { describe, expect, it } from 'vitest';
import {
    ACTION_ROUTE, displayName, formatWait, initialsOf, isShutWindow, needsWords, queueCardCopy,
    queueQuery, refusalMessage, selectionOf, updatedAgoLabel, type QueueItem,
} from '@/lib/handy-desk-queue';

function item(over: Partial<QueueItem> = {}): QueueItem {
    return {
        id: 'case_1',
        stage: 'scoping',
        mode: 'sandbox',
        held: true,
        holdReason: 'money question',
        holdApprover: 'ben',
        holdApproverAssigned: true,
        holdSince: '2026-09-11T10:00:00.000Z',
        customerName: 'Rob Hale',
        customerAddress: 'phone:07700900942',
        role: 'homeowner',
        jobType: 'leaking tap',
        location: 'NG1 1AA',
        lastCustomerMessage: 'How much roughly?',
        lastCustomerMessageAt: '2026-09-11T10:00:00.000Z',
        replyChannel: 'whatsapp',
        openedAt: '2026-09-11T09:00:00.000Z',
        benToRequest: [],
        draft: null,
        waitingWorkingHours: 3.2,
        ...over,
    };
}

describe('queueCardCopy', () => {
    it('badges the hold reason with the working-hours wait and names the job, place and channel', () => {
        const copy = queueCardCopy(item());
        expect(copy.badge).toBe('money question · 3 h');
        expect(copy.sub).toBe('leaking tap · NG1 1AA · WhatsApp');
        expect(copy.name).toBe('Rob Hale');
        expect(copy.initials).toBe('RH');
        expect(copy.body).toBe('How much roughly?');
        expect(copy.blocked).toBeNull();
    });

    it('a held draft offers Send as is, on send-held-draft, and Rewrite, on answer', () => {
        const copy = queueCardCopy(item({ draft: 'Hi Rob, Tuesday works.' }));
        expect(copy.draft).toBe('Hi Rob, Tuesday works.');
        expect(copy.primary).toEqual({ action: 'send_held_draft', label: 'Send as is' });
        expect(copy.secondary).toEqual({ action: 'rewrite', label: 'Rewrite' });
        expect(copy.more).toEqual([]);
        expect(ACTION_ROUTE[copy.primary.action]).toBe('send-held-draft');
        expect(ACTION_ROUTE[copy.secondary!.action]).toBe('answer');
        expect(needsWords(copy.primary.action)).toBe(false);
        expect(needsWords(copy.secondary!.action)).toBe(true);
    });

    it('no draft offers Answer in words, on answer, and Release under More, on release, both with words', () => {
        const copy = queueCardCopy(item());
        expect(copy.primary).toEqual({ action: 'answer', label: 'Answer in words' });
        expect(copy.secondary).toBeNull();
        expect(copy.more).toEqual([{ action: 'release', label: 'Release' }]);
        expect(ACTION_ROUTE.answer).toBe('answer');
        expect(ACTION_ROUTE.release).toBe('release');
        expect(needsWords('answer') && needsWords('release')).toBe(true);
    });

    it('an unassigned approver slot blocks the card and says why', () => {
        expect(queueCardCopy(item({ holdApproverAssigned: false })).blocked).toMatch(/No one is assigned to the ben slot/);
    });

    it('a card with nothing known yet still reads: the address stands in for the name, and the sub-line is empty', () => {
        const copy = queueCardCopy(item({ customerName: null, jobType: null, location: null, replyChannel: null, holdReason: null }));
        expect(copy.name).toBe('07700900942');
        expect(copy.sub).toBe('');
        expect(copy.badge).toBe('Held · 3 h');
    });
});

describe('formatWait', () => {
    it('reads minutes under an hour and whole hours after', () => {
        expect(formatWait(0)).toBe('just now');
        expect(formatWait(0.5)).toBe('30 min');
        expect(formatWait(1)).toBe('1 h');
        expect(formatWait(11.6)).toBe('12 h');
    });
});

describe('initialsOf and displayName', () => {
    it('takes first and last initials, or two letters of one word', () => {
        expect(initialsOf('Mrs Gemma Patel')).toBe('MP');
        expect(initialsOf('marcus')).toBe('MA');
        expect(initialsOf('  ')).toBe('?');
        expect(displayName({ customerName: null, customerAddress: 'email:sam@example.com' })).toBe('sam@example.com');
        expect(displayName({ customerName: null, customerAddress: '' })).toBe('Unknown');
    });
});

describe('refusalMessage', () => {
    it('a 403 is a plain "you cannot act here", not a retry', () => {
        expect(refusalMessage(403, 'no approver slot is assigned to this user')).toMatch(/can't act on this desk/);
    });
    it('a 409 is the desk\'s own reason, as sent', () => {
        const reason = 'the whatsapp window is shut (last inbound 30h ago); a shut window never carries freeform words';
        expect(refusalMessage(409, reason)).toBe(reason);
        expect(isShutWindow(reason)).toBe(true);
        expect(isShutWindow('there is no held draft to send')).toBe(false);
        expect(refusalMessage(500, undefined)).toBe('The desk refused this (500).');
    });
});

describe('selectionOf and queueQuery', () => {
    it('a selected card becomes the conversation the ask bar takes as context', () => {
        expect(selectionOf(item())).toEqual({ caseFileId: 'case_1', address: 'phone:07700900942', name: 'Rob Hale' });
    });
    it('reads the new desk\'s queue, never the old /api/desk', () => {
        expect(queueQuery()).toBe('/api/comms-v2/queue');
        expect(queueQuery('live')).toBe('/api/comms-v2/queue?mode=live');
    });
});

describe('updatedAgoLabel (B1 top bar)', () => {
    it('reads "just now" under a second, seconds under a minute, then minutes', () => {
        expect(updatedAgoLabel(0)).toBe('Updated just now');
        expect(updatedAgoLabel(0.4)).toBe('Updated just now');
        expect(updatedAgoLabel(8)).toBe('Updated 8s ago');
        expect(updatedAgoLabel(59)).toBe('Updated 59s ago');
        expect(updatedAgoLabel(65)).toBe('Updated 1m ago');
        expect(updatedAgoLabel(Number.NaN)).toBe('Updated just now');
    });
});
