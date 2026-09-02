/**
 * P8 vitest: the paid-survey offer — the fee from settings, the citation the money guard honours,
 * and the DRAFT routing through guards + decide. Pure.
 */
import { describe, it, expect } from 'vitest';
import { buildSurveyOfferProposal, surveyFeeCitation, citedSettingsFeePence, surveyOfferBody, formatPounds, surveyWhyFrom } from './survey-offer';
import { checkProposal, moneyAllowedBySettings } from './guards';
import { decide } from './decide';
import { getPack } from './packs';
import { artifactReadiness } from './route-a';
import type { CaseFile, TriageResult } from './types';

const DAY_NOW = new Date('2026-09-02T10:00:00Z');
const cf = (over: Partial<CaseFile> = {}): CaseFile => ({
    conversationId: 'c1', phone: '+447700123456', audience: 'customer', stage: 'scoping', contactName: 'Sam Hughes',
    timeline: [{ at: '2026-09-02T09:55:00Z', kind: 'message_in', channel: 'whatsapp', body: 'can you look at the damp wall', by: 'customer' }],
    media: [], window: { canFreeform: true, templateRequired: false, lastInboundAt: '2026-09-02T09:55:00Z', channelLastUsed: 'whatsapp' },
    client: null, quote: null, openPromises: [], openFlags: [], tags: [], lastRun: null, hash: 'h', builtAt: DAY_NOW.toISOString(), ...over,
});
const tri = (): TriageResult => ({ audience: 'customer', intent: 'unknown', lane: 'quote_clerk', exceptions: [], stage: 'scoping', tags: [], reasons: [], source: 'rules' });
const pack = getPack('customer.default');

describe('survey offer', () => {
    it('builds a DRAFT-tier offer_survey proposal with the fee from settings and the citation', () => {
        const p = buildSurveyOfferProposal({ firstName: 'Sam', feePence: 4900, why: 'It depends on what we find', intakeRunId: 'run_c' });
        expect(p.intent).toBe('offer_survey');
        expect(p.body[1]).toMatch(/paid survey visit at £49\. Shall I send the booking link/);
        expect(p.body.join(' ')).not.toMatch(/comes off|credited|deduct/); // the credit mechanism is Ben's promise, not the draft's
        expect(p.body[0]).toMatch(/^Hi Sam, thanks for the details\. It depends on what we find\./);
        expect(p.citations).toContain('price_source=settings surveyFeePence=4900');
        expect(p.body.join(' ')).not.toMatch(/[—–]/);
        expect(citedSettingsFeePence(p.citations)).toBe(4900);
        expect(citedSettingsFeePence(['agent_runs:x'])).toBeNull();
        expect(surveyFeeCitation(4950)).toBe('price_source=settings surveyFeePence=4950');
        expect(formatPounds(4950)).toBe('£49.50');
    });
    it('the money guard passes ONLY when every figure equals the cited fee', () => {
        const ok = buildSurveyOfferProposal({ firstName: null, feePence: 4900, intakeRunId: 'r' });
        expect(moneyAllowedBySettings(ok, ok.body.join('\n'))).toBe(true);
        expect(checkProposal(ok, pack, cf()).guardsHit).toEqual([]);
        // A different figure than the setting: refused.
        const wrong = { ...ok, body: ['We do a paid survey visit at £59.'] };
        expect(moneyAllowedBySettings(wrong, wrong.body.join('\n'))).toBe(false);
        expect(checkProposal(wrong, pack, cf()).guardsHit).toContain('money');
        // A second figure alongside the right one: refused.
        const extra = { ...ok, body: [...ok.body, 'The job itself would be about £300.'] };
        expect(checkProposal(extra, pack, cf()).guardsHit).toContain('money');
        // The citation on a different intent buys nothing.
        const smuggled = { ...ok, intent: 'ask_gap' as const };
        expect(checkProposal(smuggled, pack, cf()).guardsHit).toContain('money');
        // No citation: refused.
        const uncited = { ...ok, citations: [] };
        expect(checkProposal(uncited, pack, cf()).guardsHit).toContain('money');
    });
    it('decide routes it to a pending DRAFT for Ben, never a send, never a flag', () => {
        const p = buildSurveyOfferProposal({ firstName: 'Sam', feePence: 4900, intakeRunId: 'r' });
        const guards = checkProposal(p, pack, cf());
        const d = decide({ proposal: p, guards, pack, triage: tri(), caseFile: cf(), now: DAY_NOW });
        expect(d.kind).toBe('pending');
        expect((d as any).reason).toMatch(/tier DRAFT/);
    });
    it('surveyWhyFrom uses the first short gap; artifactReadiness reads the clerk artifact', () => {
        expect(surveyWhyFrom({ gaps: [{ question: 'Is the wall solid or plasterboard?' }] })).toBe('It depends on what we find (is the wall solid or plasterboard)');
        expect(surveyWhyFrom({ gaps: [] })).toBeNull();
        expect(surveyOfferBody({ firstName: null, feePence: 4900 })[0]).toMatch(/^thanks for the details\. To price/);
        expect(artifactReadiness({ kind: 'quote_intake', data: { readiness: 'visit_first' } })).toBe('visit_first');
        expect(artifactReadiness({ kind: 'nudge_batch', data: { readiness: 'x' } })).toBeNull();
    });
});
