/**
 * P19 replay: one real thread through the spine, BEFORE and AFTER, READ-ONLY.
 *
 *   npx tsx scripts/_p19-replay-thread.ts <conversationId>
 *
 * What it does:
 *   1. buildCaseFile          — SELECTs only
 *   2. triage                 — the real rules + the real Haiku call, with persist / writeConversation /
 *                               notifyRelay OFF, so no tags, no agent_runs row, no relay notice
 *   3. BEFORE                 — agentForLane(lane) → no agent → decide()
 *   4. AFTER                  — benLaneClerkVerdict → the real Quote clerk (runQuotePrep with
 *                               persist:false: the model runs, nothing is recorded) → the
 *                               artifact-only proposal → guards → decide()
 *   5. prints both decisions and diffs them
 *
 * Route A is NOT executed: the chain writes quote_estimates, a draft quote and a Pushover, and this
 * script must not touch the world. What it WOULD do is printed from the artifact's readiness, and
 * server/spine/ben-lane-clerk.test.ts pins the chain end of it.
 *
 * Never writes to the database. Never sends anything. Reads no app_settings flag and flips none.
 */
import 'dotenv/config';
import { buildCaseFile } from '../server/spine/case-file';
import { triage } from '../server/spine/triage';
import { resolvePack } from '../server/spine/packs';
import { checkProposal } from '../server/spine/guards';
import { decide } from '../server/spine/decide';
import { agentForLane, benLaneClerkVerdict, benLaneArtifactOnly } from '../server/spine/index';
import { quoteWorkInFlight } from '../server/spine/request-run';
import { artifactReadiness } from '../server/spine/route-a';
import { withLineCategories } from '../server/spine/agents/line-category';
import { runQuotePrep } from '../server/agents/quote-prep';
import type { Proposal } from '../server/spine/types';

const conversationId = process.argv[2];
if (!conversationId) {
    console.error('usage: npx tsx scripts/_p19-replay-thread.ts <conversationId>');
    process.exit(1);
}

const NOW = new Date();
const line = (s = '') => console.log(s);
const rule = (title: string) => { line(); line(`── ${title} ${'─'.repeat(Math.max(0, 74 - title.length))}`); };

async function main() {
    rule('case file');
    const caseFile = await buildCaseFile(conversationId);
    line(`thread     ${caseFile.conversationId}  ${caseFile.contactName ?? '(no name)'}  ${caseFile.phone}`);
    line(`stage      ${caseFile.stage}   audience ${caseFile.audience}`);
    line(`tags       ${caseFile.tags.join(', ') || '(none)'}`);
    line(`openFlags  ${caseFile.openFlags.map((f) => `${f.exception} due ${f.dueAt}`).join('; ') || '(none)'}`);
    line(`promises   ${caseFile.openPromises.map((p) => `"${p.text}" due ${p.dueAt}`).join('; ') || '(none)'}`);
    line(`timeline   ${caseFile.timeline.length} items, ${caseFile.media.length} media`);
    for (const t of caseFile.timeline.slice(-8)) {
        line(`  ${t.at}  ${t.kind.padEnd(12)} ${(t.body ?? t.transcript ?? '').replace(/\s+/g, ' ').slice(0, 90)}${t.mediaIds?.length ? `  [${t.mediaIds.length} media]` : ''}`);
    }

    rule('triage (real rules + real model, nothing written)');
    const tri = await triage(caseFile, { persist: false, writeConversation: false, notifyRelay: false });
    line(`src=${tri.source}  lane=${tri.lane}  intent=${tri.intent}  exc=${JSON.stringify(tri.exceptions)}`);
    line(`tags=${JSON.stringify(tri.tags)}`);
    for (const r of tri.reasons) line(`  · ${r}`);

    const pack = resolvePack(caseFile, tri);
    line(`pack       ${pack.id} v${pack.version}`);

    // ---------------------------------------------------------------- BEFORE
    rule('BEFORE (main @ 26dcdb06)');
    const beforeAgent = agentForLane(tri.lane);
    line(`agentForLane('${tri.lane}') = ${beforeAgent ?? 'null'}  → no agent runs, no proposal`);
    const before = decide({ proposal: null, guards: null, pack, triage: tri, caseFile, now: NOW });
    line(`decision   ${JSON.stringify(before, null, 2)}`);

    // ---------------------------------------------------------------- AFTER
    rule('AFTER (P19)');
    const inFlight = await quoteWorkInFlight(conversationId);
    const verdict = benLaneClerkVerdict({ caseFile, triage: tri, inFlight });
    line(`in flight  liveEstimate=${inFlight.liveEstimate}  liveDraft=${inFlight.liveDraft}`);
    line(`clerk      ${verdict.run ? 'RUNS' : 'does not run'} — ${verdict.reason}`);

    let proposal: Proposal | null = null;
    if (verdict.run) {
        const { intake, summary } = await runQuotePrep(conversationId, { trigger: 'manual', persist: false });
        if (!intake) {
            line(`clerk returned no intake: ${summary.slice(0, 300)}`);
        } else {
            const categorised = withLineCategories(intake);
            proposal = benLaneArtifactOnly({
                intent: 'propose_intake', body: [], reasons: [summary.slice(0, 500)], flag: null,
                contactName: intake.customerName ?? null,
                artifact: {
                    kind: 'quote_intake',
                    summary: `${categorised.lines.length} line(s), readiness ${intake.readiness}, ${intake.gaps.length} gap(s)`,
                    data: categorised, childRunId: null,
                },
            });
            line();
            line(`ARTIFACT   ${proposal.artifact!.summary}`);
            line(`  customer ${intake.customerName ?? '(none)'}   postcode ${intake.postcode ?? '(none)'}   type ${intake.customerType ?? '(none)'}   urgency ${intake.urgency}`);
            categorised.lines.forEach((l, i) => {
                line(`  ${i + 1}. ${l.title}  [${(l as any).category ?? '?'}]`);
                if (l.detail) line(`     ${String(l.detail).replace(/\s+/g, ' ').slice(0, 110)}`);
                for (const a of l.assumptions ?? []) line(`     assumes: ${a}`);
            });
            for (const g of intake.gaps) line(`  gap (${g.audience}, ${g.impact}): ${g.question}`);
            line(`  body sent to the customer: ${JSON.stringify(proposal.body)}   ← the clerk prepares, it never speaks`);
            line();
            const readiness = artifactReadiness(proposal.artifact);
            line(`Route A    readiness ${readiness} → ${readiness === 'quote_ready'
                ? 'estimator → engine → draft quote with every customer-visible price NULL → Pushover "Quote ready to price"'
                : readiness === 'visit_first' ? 'SKIPPED on the Ben lane (no survey offer is built)' : 'no chain'} (not executed here: this replay is read-only)`);
        }
    }

    const guards = proposal ? checkProposal(proposal, pack, caseFile) : null;
    const after = decide({ proposal, guards, pack, triage: tri, caseFile, now: NOW });
    line();
    line(`guards     ${guards ? JSON.stringify(guards) : '(no proposal)'}`);
    line(`decision   ${JSON.stringify(after, null, 2)}`);

    // ---------------------------------------------------------------- diff
    rule('before → after');
    const same = JSON.stringify(before) === JSON.stringify(after);
    line(`decision   ${same ? 'IDENTICAL ✓' : 'CHANGED ✗'}`);
    if (!same) { line(`  before ${JSON.stringify(before)}`); line(`  after  ${JSON.stringify(after)}`); }
    line(`artifact   ${proposal?.artifact ? `NEW: ${proposal.artifact.summary}` : 'none'}`);
    line(`to customer none, either way (before: no proposal; after: body ${JSON.stringify(proposal?.body ?? null)})`);
    line();
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
