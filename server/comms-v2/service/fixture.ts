/**
 * The sandbox fixture for Goal 6, on the branch database only: reviewed and unreviewed
 * knowledge-base rows the Service specialist can be driven against, the two desk chase templates
 * marked approved so Ben's chase can be driven end to end in dry run, and the two channel
 * templates Meta has approved that the branch's sync cache does not show.
 *
 * The knowledge-base rows are written through the store's own admin writes
 * (server/spine/knowledge-base.ts: the seed's insert, Ben's review, the status reset), never by
 * touching kb_entries directly, so the store's access test keeps its one list of callers. The
 * review is signed `human:sandbox-fixture`, which the row itself shows. The rows never carry a
 * figure, a date or a time, because the guards refuse those from any source but a quote line, a
 * customer record or the diary.
 *
 * The template approvals are rows in the sync cache (whatsapp_templates) with a sandbox content
 * SID, inserted only when absent: the desk's chase templates have not been submitted to Meta,
 * the channel templates were approved on the live account (docs/META-TEMPLATE-RUNBOOK.md) and are
 * only mirrored here, and on the branch the cache is a test fixture. Nothing here writes to Meta
 * or Twilio. A production database is refused before anything is written (the door host already
 * refuses it; this checks again).
 */
import { WINDOW_TEMPLATES } from '../../window-templates';
import { CHASE_TEMPLATES } from './chase';

export const FIXTURE_REVIEWER = 'human:sandbox-fixture';

export interface FixtureKbRow { id: string; topic: string; approvedWords: string; reviewed: boolean; sourceNote: string }

/** Ids are prefixed so they can never be mistaken for a row Ben wrote. */
export const FIXTURE_KB_ROWS: FixtureKbRow[] = [
    { id: 'sandbox-kb-insured', topic: 'Are you insured? Do you have public liability insurance?', approvedWords: "Yes, we're fully insured, with public liability cover in place for every job.", reviewed: true, sourceNote: 'Goal 6 sandbox fixture (reviewed)' },
    { id: 'sandbox-kb-areas', topic: 'Which areas do you cover? Do you come out to Beeston or West Bridgford?', approvedWords: 'We cover Nottingham and the surrounding areas, Beeston and West Bridgford included.', reviewed: true, sourceNote: 'Goal 6 sandbox fixture (reviewed)' },
    { id: 'sandbox-kb-payment', topic: 'How do I pay? Do you take card payments?', approvedWords: 'You can pay by card or bank transfer once the job is done, and the invoice has the details on it.', reviewed: true, sourceNote: 'Goal 6 sandbox fixture (reviewed)' },
    { id: 'sandbox-kb-receipt', topic: 'Can I get a receipt or an invoice for the job?', approvedWords: 'Every job comes with an itemised invoice by email, which doubles as your receipt.', reviewed: true, sourceNote: 'Goal 6 sandbox fixture (reviewed)' },
    { id: 'sandbox-kb-weekends', topic: 'Do you work weekends?', approvedWords: 'We do the odd Saturday by arrangement.', reviewed: false, sourceNote: 'Goal 6 sandbox fixture (unreviewed on purpose: a question we have no source for)' },
];

/**
 * The channel templates Meta approved on 15 Sep 2026: the post-call follow-up (checklist 1.3) and
 * the web form acknowledgement without the call offer (1.5). Their approved-template branch is
 * what the door drives once these are in the branch's cache.
 */
export const FIXTURE_APPROVED_ON_META = ['post_call_followup_v1', 'web_enquiry_ack_no_call_v1'] as const;

export const FIXTURE_TEMPLATE_SIDS: Record<string, string> = {
    [CHASE_TEMPLATES.approver_chase.name]: 'HXsandbox0000000000000000000chase01',
    [CHASE_TEMPLATES.owner_escalation.name]: 'HXsandbox0000000000000000000owner01',
    post_call_followup_v1: 'HXsandbox0000000000000000postcall01',
    web_enquiry_ack_no_call_v1: 'HXsandbox000000000000000000nocall01',
};

export interface FixtureTemplateRow { name: string; contentSid: string; category: string; language: string; body: string; variables: Record<string, string> }

/** Every template the fixture marks approved, with the wording and language the one registry gives it. */
export function fixtureTemplateRows(): FixtureTemplateRow[] {
    const chase = Object.values(CHASE_TEMPLATES).map((t) => ({ name: t.name, category: 'UTILITY', language: t.language, body: t.body, variables: t.variables }));
    const channel = FIXTURE_APPROVED_ON_META.map((name) => {
        const row = WINDOW_TEMPLATES.find((t) => t.rungs.some((r) => r.name === name));
        const rung = row?.rungs.find((r) => r.name === name);
        if (!row || !rung) throw new Error(`fixture: ${name} has no row in server/window-templates.ts`);
        return { name, category: row.category, language: row.language, body: rung.body, variables: rung.variables };
    });
    return [...chase, ...channel].map((t) => ({ ...t, contentSid: FIXTURE_TEMPLATE_SIDS[t.name] }));
}

export interface FixtureOutcome {
    kb: Array<{ id: string; status: 'reviewed' | 'unreviewed'; action: string }>;
    templates: Array<{ name: string; status: 'approved'; action: string }>;
}

/** Writes the fixture; idempotent. Throws on a production database or a write the store refuses. */
export async function applySandboxFixture(): Promise<FixtureOutcome> {
    const { isProductionDatabaseUrl } = await import('../../worker-gate');
    if (isProductionDatabaseUrl(process.env.DATABASE_URL)) throw new Error('the sandbox fixture is refused on the production database');
    const kb = await import('../../spine/knowledge-base');
    const out: FixtureOutcome = { kb: [], templates: [] };
    for (const row of FIXTURE_KB_ROWS) {
        const inserted = await kb.insertSeedEntryIfMissing({ id: row.id, kind: 'answer', topic: row.topic, approvedWords: row.approvedWords, bannedWords: [], sourceNote: row.sourceNote });
        const actions: string[] = [inserted];
        const reviewedNow = await kb.getReviewedEntry(row.id);
        if (reviewedNow && reviewedNow.approvedWords.trim() !== row.approvedWords) {
            const upd = await kb.updateEntry(row.id, { kind: 'answer', topic: row.topic, approvedWords: row.approvedWords, bannedWords: [], sourceNote: row.sourceNote });
            if (!upd.ok) throw new Error(`fixture ${row.id}: ${upd.errors.join('; ')}`);
            actions.push('words reset');
        }
        if (row.reviewed) {
            if (!(await kb.getReviewedEntry(row.id))) {
                const rev = await kb.reviewEntry(row.id, FIXTURE_REVIEWER);
                if (!rev.ok) throw new Error(`fixture ${row.id}: ${rev.errors.join('; ')}`);
                actions.push('reviewed');
            }
            out.kb.push({ id: row.id, status: 'reviewed', action: actions.join(', ') });
        } else {
            if (await kb.getReviewedEntry(row.id)) {
                const st = await kb.setStatus(row.id, 'unreviewed');
                if (!st.ok) throw new Error(`fixture ${row.id}: ${st.errors.join('; ')}`);
                actions.push('set unreviewed');
            }
            out.kb.push({ id: row.id, status: 'unreviewed', action: actions.join(', ') });
        }
    }
    const { db } = await import('../../db');
    const { whatsappTemplates } = await import('@shared/schema');
    const { eq } = await import('drizzle-orm');
    for (const t of fixtureTemplateRows()) {
        const [existing] = await db.select({ status: whatsappTemplates.status }).from(whatsappTemplates).where(eq(whatsappTemplates.contentSid, t.contentSid)).limit(1);
        if (!existing) {
            await db.insert(whatsappTemplates).values({ contentSid: t.contentSid, name: t.name, status: 'approved', category: t.category, language: t.language, body: t.body, variables: t.variables, approvedAt: new Date(), statusChangedAt: new Date() }).onConflictDoNothing();
            out.templates.push({ name: t.name, status: 'approved', action: 'inserted (sandbox content SID)' });
        } else if (existing.status !== 'approved') {
            await db.update(whatsappTemplates).set({ status: 'approved', approvedAt: new Date(), statusChangedAt: new Date() }).where(eq(whatsappTemplates.contentSid, t.contentSid));
            out.templates.push({ name: t.name, status: 'approved', action: 'status reset to approved' });
        } else out.templates.push({ name: t.name, status: 'approved', action: 'kept' });
    }
    return out;
}
