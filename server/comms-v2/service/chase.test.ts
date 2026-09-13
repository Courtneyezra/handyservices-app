/**
 * Ben's chase (7.5): nothing while the hold is younger than the first interval; one template send
 * to Ben once it is older; one to the owner after the second interval; a missing address or an
 * unapproved template is a refusal on the record, never a silent skip; so is a live chase whose
 * delivery is refused; a live chase goes out under its own purpose; a released hold clears the
 * ledger and a new hold starts a fresh record; the run ids are spent on the file.
 */
import { describe, expect, it } from 'vitest';
import { hold, noteOnHold, open, release, type CaseFile } from '../desk/case-file';
import { BEN } from '../desk/guards';
import { noTemplateApproved } from '../desk/sender';
import { CHASE_TEMPLATES, chaseIfDue, createChaseState } from './chase';

function held(at = '2026-09-11T10:00:00.000Z'): CaseFile {
    const r = open({
        identity: { ok: true, personId: 'p1', customerId: null, role: 'homeowner', isNew: true, canonical: 'phone:07700900942', propertyId: null, landlordId: null, name: 'Sam' },
        channel: 'whatsapp', address: '+447700900942',
        firstTurn: { at, channel: 'whatsapp', kind: 'text', body: 'your last job was rubbish', media: [] },
    });
    if (!r.ok) throw new Error(r.reason);
    hold(r.value, { approver: BEN, reason: 'complaint: your last job was rubbish', exception: 'complaint' }, { now: () => new Date(at) });
    return r.value;
}
const approved = { async approved(name: string) { return name === CHASE_TEMPLATES.approver_chase.name || name === CHASE_TEMPLATES.owner_escalation.name ? { contentSid: `HX_${name}` } : null; } };
const at = (iso: string) => () => new Date(iso);
const state = () => createChaseState({ chaseAfterMs: 30 * 60_000, escalateAfterMs: 60 * 60_000, ben: { address: '+447700900901', name: 'Ben' }, owner: { address: '+447700900902', name: 'the owner' } });

describe('chaseIfDue', () => {
    it('chases Ben after the first interval and the owner after the second, one action per pass, each a template send with a run id and the approver', async () => {
        const file = held();
        const s = state();
        expect((await chaseIfDue(file, s, { templates: approved, now: at('2026-09-11T10:10:00.000Z') })).action).toBe('none');
        const chased = await chaseIfDue(file, s, { templates: approved, now: at('2026-09-11T10:31:00.000Z') });
        expect(chased.action).toBe('chased');
        if (chased.action !== 'chased') return;
        expect(chased.send).toMatchObject({ purpose: 'approver_chase', to: { address: '+447700900901', name: 'Ben' }, templateId: 'desk_approver_chase_v1', approver: 'agent.comms_v2', mode: 'dry_run' });
        expect(chased.send.body).toBe('Hi Ben, a customer thread is waiting on you: complaint from Sam. Open the desk to pick it up.');
        expect(file.sentRunIds).toContain(chased.send.runId);
        expect((await chaseIfDue(file, s, { templates: approved, now: at('2026-09-11T11:00:00.000Z') })).action).toBe('none');
        const escalated = await chaseIfDue(file, s, { templates: approved, now: at('2026-09-11T11:31:00.000Z') });
        expect(escalated.action).toBe('escalated');
        if (escalated.action !== 'escalated') return;
        expect(escalated.send).toMatchObject({ purpose: 'owner_escalation', to: { address: '+447700900902' }, templateId: 'desk_owner_escalation_v1' });
        expect(escalated.send.body).toMatch(/waiting on Ben/);
        const after = await chaseIfDue(file, s, { templates: approved, now: at('2026-09-11T13:00:00.000Z') });
        expect(after.action).toBe('none');
        expect(s.ledger.get(file.id)?.attempts.map((a) => a.ok)).toEqual([true, true]);
        expect(file.turns.filter((t) => t.direction === 'outbound')).toHaveLength(0);
    });
    it('a missing address or an unapproved template is refused on the record; the hold still stands', async () => {
        const file = held();
        const noBen = createChaseState({ chaseAfterMs: 1, escalateAfterMs: 1 });
        const r1 = await chaseIfDue(file, noBen, { templates: approved, now: at('2026-09-11T10:31:00.000Z') });
        expect(r1).toMatchObject({ action: 'refused', purpose: 'approver_chase' });
        expect((r1 as any).reason).toMatch(/no address/);
        expect(noBen.ledger.get(file.id)?.attempts[0]).toMatchObject({ ok: false, purpose: 'approver_chase' });
        for (const t of ['2026-09-11T10:32:00.000Z', '2026-09-11T10:33:00.000Z']) expect((await chaseIfDue(file, noBen, { templates: approved, now: at(t) })).action).toBe('refused');
        expect(noBen.ledger.get(file.id)?.attempts).toHaveLength(1);
        const r2 = await chaseIfDue(held(), state(), { templates: noTemplateApproved, now: at('2026-09-11T10:31:00.000Z') });
        expect((r2 as any).reason).toMatch(/not approved/);
        expect(file.hold).not.toBeNull();
    });
    it('ageing the file (the sandbox shifting every timestamp back) keeps the record: the next pass escalates rather than chasing again', async () => {
        const file = held();
        const s = state();
        await chaseIfDue(file, s, { templates: approved, now: at('2026-09-11T10:31:00.000Z') });
        file.hold!.since = '2026-09-11T08:00:00.000Z';
        for (const t of file.turns) t.at = '2026-09-11T08:00:00.000Z';
        const next = await chaseIfDue(file, s, { templates: approved, now: at('2026-09-11T10:32:00.000Z') });
        expect(next.action).toBe('escalated');
        expect(s.ledger.get(file.id)?.attempts).toHaveLength(2);
    });
    it('a released hold clears the record and a new hold starts afresh', async () => {
        const file = held();
        const s = state();
        await chaseIfDue(file, s, { templates: approved, now: at('2026-09-11T10:31:00.000Z') });
        expect(s.ledger.get(file.id)?.chased).not.toBeNull();
        release(file, BEN, 'Sorry Sam, ringing you now.', { now: at('2026-09-11T10:40:00.000Z') });
        expect((await chaseIfDue(file, s, { templates: approved, now: at('2026-09-11T10:41:00.000Z') })).action).toBe('none');
        expect(s.ledger.get(file.id)).toBeNull();
        hold(file, { approver: BEN, reason: 'refund', exception: 'refund' }, { now: at('2026-09-11T12:00:00.000Z') });
        expect((await chaseIfDue(file, s, { templates: approved, now: at('2026-09-11T12:10:00.000Z') })).action).toBe('none');
        expect((await chaseIfDue(file, s, { templates: approved, now: at('2026-09-11T12:31:00.000Z') })).action).toBe('chased');
    });
    it('a live chase goes to the deliverer under its own purpose, never as a customer reply; a refused delivery is on the record and spends nothing', async () => {
        const purposes: string[] = [];
        const file = held();
        const s = state();
        const off = await chaseIfDue(file, s, { templates: approved, now: at('2026-09-11T10:31:00.000Z'), mode: 'live', sender: { deliverer: { async deliver() { return { ok: false, reason: 'spine.senders.comms_v2.enabled is not true', delivered: [] }; } } } });
        expect(off).toMatchObject({ action: 'refused', purpose: 'approver_chase', reason: 'spine.senders.comms_v2.enabled is not true' });
        expect(file.sentRunIds).toHaveLength(0);
        expect(s.ledger.get(file.id)?.attempts[0]).toMatchObject({ purpose: 'approver_chase', ok: false });
        const deliverer = { async deliver(i: { purpose: string }) { purposes.push(i.purpose); return { ok: true as const, sid: 'SM1' }; } };
        const out = await chaseIfDue(file, s, { templates: approved, now: at('2026-09-11T10:32:00.000Z'), mode: 'live', sender: { deliverer } });
        expect(out.action).toBe('chased');
        if (out.action === 'chased') expect(out.send).toMatchObject({ purpose: 'approver_chase', mode: 'live', sid: 'SM1' });
        expect(purposes).toEqual(['approver_chase']);
        expect(file.sentRunIds).toHaveLength(1);
        expect(file.turns.filter((t) => t.direction === 'outbound')).toHaveLength(0);
    });
    it('a hold with no exception is chased without its free-text reason, so a noted change of details never reaches the template', async () => {
        const file = held();
        release(file, BEN, 'Sorry Sam, ringing you now.', { now: at('2026-09-11T10:05:00.000Z') });
        hold(file, { approver: BEN, reason: 'the draft failed a guard twice' }, { now: at('2026-09-11T10:06:00.000Z') });
        noteOnHold(file, { reason: 'change_of_details: email -> sam.new@example.com' });
        noteOnHold(file, { reason: 'change_of_details: address -> 12 High Street, NG1 1AA' });
        const out = await chaseIfDue(file, state(), { templates: approved, now: at('2026-09-11T10:40:00.000Z') });
        expect(out.action).toBe('chased');
        if (out.action !== 'chased') return;
        expect(out.send.body).toBe('Hi Ben, a customer thread is waiting on you: a held thread from Sam. Open the desk to pick it up.');
        expect(out.send.body).not.toMatch(/@|example|High Street|NG1|guard/);
    });
    it('the chase templates carry no date, time, duration, figure or commitment', async () => {
        const { RE_COMMITMENT_OR_FAULT, RE_DATE_TIME_DURATION, RE_FIGURE } = await import('../desk/lexicon');
        for (const t of Object.values(CHASE_TEMPLATES)) {
            const body = t.body.replace(/\{\{\s*(\d+)\s*\}\}/g, (_m, n) => t.variables[n]);
            expect(RE_DATE_TIME_DURATION.test(body)).toBe(false);
            expect(RE_FIGURE.test(body)).toBe(false);
            expect(RE_COMMITMENT_OR_FAULT.test(body)).toBe(false);
            expect(t.name).toMatch(/^[a-z0-9_]+$/);
        }
    });
});
