import { describe, it, expect } from 'vitest';
import { runGuardChain, ESCALATING_GUARD_CODES } from './guard-chain';

describe('runGuardChain', () => {
    it('reports every detector, not just the first, and the production first-violation', () => {
        const r = runGuardChain("That'll be £120 all in — we can do it Tuesday morning.");
        const codes = r.hits.map((h) => h.code);
        expect(codes).toContain('money_figure');
        expect(codes).toContain('voice_breach');
        expect(r.first?.code).toBe('money_figure');
        expect(r.escalating).toBe(true);
        expect(r.escalatingCodes).toContain('money_figure');
    });
    it('a plain scoping reply is clean', () => {
        const r = runGuardChain('Cheers Jack. Can you send a photo of the bath from the side?');
        expect(r.hits).toEqual([]);
        expect(r.first).toBeNull();
        expect(r.escalating).toBe(false);
    });
    it('a voice breach alone does not escalate', () => {
        const r = runGuardChain('Got it — thanks.');
        expect(r.hits.map((h) => h.code)).toEqual(['voice_breach']);
        expect(r.escalating).toBe(false);
    });
    it('escalating set mirrors comms.ts', () => {
        expect([...ESCALATING_GUARD_CODES].sort()).toEqual(['date_promise', 'discount_offer', 'duration_claim', 'liability_admission', 'money_figure', 'policy_commitment']);
    });
});
