import { describe, it, expect } from 'vitest';
import { mapApprover, planBackfill, renderPlan } from './approver-backfill';

describe('mapApprover', () => {
    it('leaves enum values and human:<id> alone', () => {
        expect(mapApprover('agent.comms.autosend')).toMatchObject({ to: 'agent.comms.autosend', rule: 'unchanged' });
        expect(mapApprover('rules.first_contact')).toMatchObject({ rule: 'unchanged' });
        expect(mapApprover('human:ben@handy.app')).toMatchObject({ to: 'human:ben@handy.app', rule: 'unchanged' });
    });
    it('maps the brief\'s legacy strings', () => {
        expect(mapApprover('comms_agent:autosend').to).toBe('agent.comms.autosend');
        expect(mapApprover('comms_agent:sla_chase').to).toBe('agent.sla_chase');
        expect(mapApprover('hours_gate:morning_release').to).toBe('rules.hours_gate');
        expect(mapApprover('first_contact_ack:whatsapp').to).toBe('rules.first_contact');
        expect(mapApprover('first_contact_ack:held_release').to).toBe('rules.first_contact');
        const v2 = mapApprover('v2_pipeline:autosend');
        expect(v2.to).toBe('agent.comms.autosend');
        expect(v2.rule).toBe('v2_pipeline');
        expect(v2.note).toMatch(/V2 pipeline/);
    });
    it('maps rejection markers to the rule that decided', () => {
        expect(mapApprover('hours_gate:stale_by_morning')).toMatchObject({ to: 'rules.hours_gate', rule: 'rejection_marker' });
        expect(mapApprover('ack_hold:superseded')).toMatchObject({ to: 'rules.first_contact', rule: 'rejection_marker' });
        expect(mapApprover('comms_agent:superseded')).toMatchObject({ to: 'agent.comms', rule: 'rejection_marker' });
        expect(mapApprover('comms_agent:superseded_by_clerk_gaps')).toMatchObject({ to: 'agent.comms', rule: 'rejection_marker' });
    });
    it('turns bare emails and "admin" into human approvers', () => {
        expect(mapApprover('ben@handyservices.app')).toMatchObject({ to: 'human:ben@handyservices.app', rule: 'bare_human' });
        expect(mapApprover('admin')).toMatchObject({ to: 'human:admin', rule: 'bare_human' });
    });
    it('leaves the unknown alone, counted', () => {
        expect(mapApprover('something_else')).toMatchObject({ to: null, rule: 'unmapped' });
        expect(mapApprover('')).toMatchObject({ to: null, rule: 'unmapped' });
        expect(mapApprover(null)).toMatchObject({ to: null, rule: 'unmapped' });
    });
});

describe('planBackfill / renderPlan', () => {
    it('folds distinct values into counts per rule and the number of rows that will change', () => {
        const plan = planBackfill([
            { approvedBy: 'comms_agent:autosend', count: 165 },
            { approvedBy: 'human:ben@x.com', count: 400 },
            { approvedBy: 'ben@x.com', count: 12 },
            { approvedBy: 'v2_pipeline:autosend', count: 24 },
            { approvedBy: 'mystery', count: 2 },
        ]);
        expect(plan.totals).toEqual({ unchanged: 400, legacy_prefix: 165, v2_pipeline: 24, rejection_marker: 0, bare_human: 12, unmapped: 2 });
        expect(plan.toUpdate).toBe(165 + 12 + 24);
        expect(plan.rows[0].from).toBe('human:ben@x.com'); // sorted by count
        const md = renderPlan(plan);
        expect(md).toMatch(/comms_agent:autosend.*agent\.comms\.autosend.*165/);
        expect(md).toMatch(/Rows to update: 201/);
        expect(md).toMatch(/mystery.*—.*unmapped/);
    });
});
