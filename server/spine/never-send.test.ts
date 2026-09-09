/**
 * B7a vitest: the pack's `neverSend` list — the guard on the owner's own tier act. A person, the
 * ladder, a stored overlay row: none of them can put holding, a scope statement, a KB answer, a
 * closing, the survey offer or answer_from_quote at SEND on a customer pack.
 */
import { describe, it, expect } from 'vitest';
import { PACKS, getPack, validatePack, assertPromotable, applyTierOverlay, isNeverSend } from './packs';
import { validateHumanTierRequest } from './autonomy';
import type { PolicyPack } from './types';

const NEVER = ['holding', 'clarify_scope', 'faq_from_kb', 'closing', 'offer_survey'] as const;

describe('neverSend on the customer packs', () => {
    it('customer.default lists the empty-body holding path (D4), scope statements, KB answers, closings and the survey offer', () => {
        expect(getPack('customer.default').neverSend).toEqual([...NEVER]);
    });
    it('customer.post_quote inherits the list and adds answer_from_quote', () => {
        expect(getPack('customer.post_quote').neverSend).toEqual([...NEVER, 'answer_from_quote']);
    });
    it('what is left is exactly PRD v3 §5.1: a gap ask, an acknowledgement, a pointer at the quote page or the picker', () => {
        for (const id of ['customer.default', 'customer.post_quote']) {
            const p = getPack(id);
            const left = p.allowedIntents.filter((i) => !isNeverSend(p, i)).sort();
            expect(left, id).toEqual(['ask_gap', 'confirm_received', 'point_to_picker', 'point_to_quote_page']);
        }
    });
    it('validatePack: every pack loads clean, and a neverSend entry outside allowedIntents is a boot failure', () => {
        for (const p of Object.values(PACKS)) expect(validatePack(p), p.id).toEqual([]);
        const bad: PolicyPack = { ...getPack('customer.default'), neverSend: ['job_brief'] };
        expect(validatePack(bad).join(' ')).toMatch(/neverSend lists job_brief which is not allowed/);
        const atSend: PolicyPack = { ...getPack('customer.default'), tierByIntent: { holding: 'SEND' } };
        expect(validatePack(atSend).join(' ')).toMatch(/holding is at SEND but on neverSend/);
    });
});

describe('the three writers all refuse', () => {
    it('assertPromotable throws for every neverSend intent and passes ask_gap', () => {
        const p = getPack('customer.post_quote');
        for (const intent of [...NEVER, 'answer_from_quote']) expect(() => assertPromotable(p, intent), intent).toThrow(/neverSend list and can never be promoted to SEND/);
        expect(() => assertPromotable(p, 'ask_gap')).not.toThrow();
        expect(() => assertPromotable(getPack('customer.default'), 'confirm_received')).not.toThrow();
    });
    it('validateHumanTierRequest refuses SEND for every neverSend intent, loudly, and still accepts ask_gap', () => {
        for (const intent of NEVER) {
            const v = validateHumanTierRequest({ packId: 'customer.default', intent, tier: 'SEND', reason: 'owner act' });
            expect(v.ok, intent).toBe(false);
            expect((v as any).errors.join(' '), intent).toMatch(new RegExp(`${intent} is on pack customer.default's neverSend list and can never be set to SEND`));
        }
        const aq = validateHumanTierRequest({ packId: 'customer.post_quote', intent: 'answer_from_quote', tier: 'SEND', reason: 'owner act' });
        expect(aq.ok).toBe(false);
        const fine = validateHumanTierRequest({ packId: 'customer.default', intent: 'ask_gap', tier: 'SEND', reason: 'owner act' });
        expect(fine).toEqual({ ok: true, request: { packId: 'customer.default', intent: 'ask_gap', tier: 'SEND', reason: 'owner act' } });
    });
    it('a neverSend intent may still be moved to DRAFT or PROPOSE by a person (only SEND is refused)', () => {
        expect(validateHumanTierRequest({ packId: 'customer.default', intent: 'holding', tier: 'DRAFT', reason: 'back to the queue' }).ok).toBe(true);
        expect(validateHumanTierRequest({ packId: 'customer.default', intent: 'clarify_scope', tier: 'PROPOSE', reason: 'read only' }).ok).toBe(true);
    });
    it('applyTierOverlay ignores a stored SEND row for a neverSend intent and keeps the rest', () => {
        const p = getPack('customer.default');
        const merged = applyTierOverlay(p, { holding: 'SEND', closing: 'SEND', ask_gap: 'SEND', clarify_scope: 'DRAFT' });
        // T35: the pack's own tierByIntent now starts the four §5.1 intents at SEND, so the merge
        // is the overlay OVER those. The claim under test is unchanged: the two neverSend rows
        // are dropped, everything else is honoured.
        expect(merged.tierByIntent).toEqual({
            ...p.tierByIntent,
            ask_gap: 'SEND', clarify_scope: 'DRAFT',
        });
        expect(merged.tierByIntent.holding).toBeUndefined();
        expect(merged.tierByIntent.closing).toBeUndefined();
    });
});
