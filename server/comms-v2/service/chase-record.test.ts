/**
 * Ben's chase record lives on the case file, so a restart or a redeploy never chases Ben again or
 * tells the owner twice: a file written to the durable store and read back carries its record, and
 * the next pass on a fresh chase state picks up where the last one stopped. Every attempt carries
 * its mode and the label the send went, or would have gone, under.
 */
import { describe, expect, it } from 'vitest';
import { hold, open, type CaseFile } from '../desk/case-file';
import { recordOf } from '../desk/database-store';
import { BEN } from '../desk/guards';
import { CHASE_BEN_ENV, CHASE_OWNER_ENV, CHASE_TEMPLATES, chaseIfDue, chaseRecordOf, chaseStateFromEnv, createChaseState } from './chase';

function held(at = '2026-09-14T10:00:00.000Z'): CaseFile {
    const r = open({
        identity: { ok: true, personId: 'p1', customerId: null, role: 'homeowner', isNew: true, canonical: 'phone:07700900942', propertyId: null, landlordId: null, name: 'Sam' },
        channel: 'whatsapp', address: '+447700900942',
        firstTurn: { at, channel: 'whatsapp', kind: 'text', body: 'I want a refund', media: [] },
    });
    if (!r.ok) throw new Error(r.reason);
    hold(r.value, { approver: BEN, reason: 'refund', exception: 'refund' }, { now: () => new Date(at) });
    return r.value;
}
const approved = { async approved(name: string) { return name === CHASE_TEMPLATES.approver_chase.name || name === CHASE_TEMPLATES.owner_escalation.name ? { contentSid: `HX_${name}` } : null; } };
const at = (iso: string) => () => new Date(iso);
const config = () => createChaseState({ chaseAfterMs: 30 * 60_000, escalateAfterMs: 60 * 60_000, ben: { address: '+447700900901', name: 'Ben' }, owner: { address: '+447700900902', name: null } });

describe('the chase record on the case file', () => {
    it('survives the durable store: after a restart the next pass escalates rather than chasing Ben again', async () => {
        const file = held();
        expect((await chaseIfDue(file, config(), { templates: approved, now: at('2026-09-14T10:31:00.000Z') })).action).toBe('chased');
        const restored = JSON.parse(JSON.stringify(recordOf(file))) as CaseFile;
        expect(chaseRecordOf(restored)?.chased).not.toBeNull();
        expect((await chaseIfDue(restored, config(), { templates: approved, now: at('2026-09-14T10:40:00.000Z') })).action).toBe('none');
        expect((await chaseIfDue(restored, config(), { templates: approved, now: at('2026-09-14T11:31:00.000Z') })).action).toBe('escalated');
        const again = JSON.parse(JSON.stringify(recordOf(restored))) as CaseFile;
        expect((await chaseIfDue(again, config(), { templates: approved, now: at('2026-09-14T15:00:00.000Z') })).reason).toMatch(/nothing further until Ben replies/);
        expect(chaseRecordOf(again)?.attempts.map((a) => a.purpose)).toEqual(['approver_chase', 'owner_escalation']);
    });

    it('records each attempt\'s mode and label: a dry run under the label it would carry, a live refusal under the deliverer\'s own', async () => {
        const file = held();
        await chaseIfDue(file, config(), { templates: approved, now: at('2026-09-14T10:31:00.000Z') });
        expect(chaseRecordOf(file)?.attempts[0]).toMatchObject({ purpose: 'approver_chase', ok: true, mode: 'dry_run', label: { purpose: 'marketing', context: 'comms_v2:approver_chase' } });
        const refusing = { async deliver() { return { ok: false as const, reason: 'spine.senders.comms_v2.enabled is not true', delivered: [], label: { purpose: 'marketing' as const, context: 'comms_v2:owner_escalation' } }; } };
        await chaseIfDue(file, config(), { templates: approved, now: at('2026-09-14T11:31:00.000Z'), mode: 'live', sender: { deliverer: refusing } });
        expect(chaseRecordOf(file)?.attempts[1]).toMatchObject({ purpose: 'owner_escalation', ok: false, mode: 'live', reason: 'spine.senders.comms_v2.enabled is not true', label: { purpose: 'marketing', context: 'comms_v2:owner_escalation' } });
    });

    it('the live intake reads Ben\'s and the owner\'s numbers from the environment, and a number not set is a recorded refusal', async () => {
        expect(chaseStateFromEnv({ [CHASE_BEN_ENV]: ' +447700900901 ', [CHASE_OWNER_ENV]: '+447700900902' }).config).toMatchObject({ ben: { address: '+447700900901', name: 'Ben' }, owner: { address: '+447700900902' } });
        const unset = chaseStateFromEnv({});
        expect(unset.config.ben.address).toBeNull();
        const out = await chaseIfDue(held(), unset, { templates: approved, now: at('2026-09-14T10:31:00.000Z') });
        expect(out).toMatchObject({ action: 'refused', purpose: 'approver_chase' });
    });
});
