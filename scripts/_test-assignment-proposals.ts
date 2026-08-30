/**
 * D-WP3 verification: assignment proposal lifecycle against REAL rows,
 * in-process (no HTTP). NEVER approves — approve performs a real assignment
 * and may notify people. Flow:
 *
 *   1. pick a real unassigned, non-terminal CBR + a real contractor profile
 *   2. createAssignmentProposal → status 'pending'
 *   3. buildDeskItems() → an 'assignment' item with our proposalId,
 *      title/preview/badges/href per the desk contract
 *   4. duplicate create → alreadyPending: true, same row
 *   5. rejectAssignmentProposal → status 'rejected', decidedBy/decidedAt set
 *   6. approve AFTER reject → { ok: false, code: 'not_pending' } (the 409
 *      path, exercised safely — nothing is pending, nothing assigns)
 *   7. desk no longer shows the proposal
 *   8. finally: DELETE the proposal row
 *
 * If the DB has NO unassigned, non-terminal CBR (true at time of writing —
 * every row is completed/accepted), a clearly-marked temp CBR is seeded and
 * deleted in finally (same convention as scripts/_test-desk.ts). An
 * unassigned pending CBR just sits in the dispatch pool; nobody is notified.
 *
 * Run: npx tsx scripts/_test-assignment-proposals.ts
 */
import crypto from 'node:crypto';
import { and, eq, notInArray, sql } from 'drizzle-orm';
import { db } from '../server/db';
import { assignmentProposals, contractorBookingRequests, handymanProfiles } from '@shared/schema';
import {
    approveAssignmentProposal,
    createAssignmentProposal,
    listPendingAssignmentProposals,
    rejectAssignmentProposal,
} from '../server/assignment-proposals';
import { buildDeskItems } from '../server/desk-routes';

const MARK = 'D-WP3 TEST proposal — do not action';

let failures = 0;
function assert(cond: boolean, label: string): void {
    if (cond) {
        console.log(`  ✓ ${label}`);
    } else {
        failures++;
        console.error(`  ✗ FAIL: ${label}`);
    }
}

async function main() {
    let proposalId: string | undefined;
    let seededJobId: string | undefined;

    try {
        console.log('— picking a real unassigned job + contractor —');
        const [contractor] = await db.select({ id: handymanProfiles.id })
            .from(handymanProfiles).limit(1);
        if (!contractor) throw new Error('No contractor profile found');

        let [job] = await db.select({
            id: contractorBookingRequests.id,
            customerName: contractorBookingRequests.customerName,
            assignmentStatus: contractorBookingRequests.assignmentStatus,
        }).from(contractorBookingRequests)
            .where(and(
                eq(contractorBookingRequests.assignmentStatus, 'unassigned'),
                notInArray(contractorBookingRequests.status, ['completed', 'declined']),
                // no live pending proposal already parked on it (partial unique index)
                sql`NOT EXISTS (SELECT 1 FROM assignment_proposals ap WHERE ap.job_id = ${contractorBookingRequests.id} AND ap.status = 'pending')`,
            ))
            .limit(1);
        if (!job) {
            console.log('  no real unassigned CBR exists — seeding a marked temp one (deleted in finally)');
            seededJobId = crypto.randomUUID();
            const [seeded] = await db.insert(contractorBookingRequests).values({
                id: seededJobId,
                contractorId: contractor.id, // NOT NULL FK anchor only; assignmentStatus is what the pool keys on
                customerName: 'D-WP3 TEST — do not action',
                customerPhone: '+447700900810', // Ofcom drama range, never a real customer
                description: MARK,
                status: 'pending',
                assignmentStatus: 'unassigned',
            }).returning({
                id: contractorBookingRequests.id,
                customerName: contractorBookingRequests.customerName,
                assignmentStatus: contractorBookingRequests.assignmentStatus,
            });
            job = seeded;
        }
        console.log(`  job ${job.id} (${job.customerName}), contractor ${contractor.id}`);

        console.log('— create → pending —');
        const created = await createAssignmentProposal({
            jobId: job.id,
            contractorId: contractor.id,
            note: MARK,
            createdBy: 'd-wp3-test',
        });
        assert(created.ok, 'createAssignmentProposal returns ok');
        if (!created.ok) throw new Error(`create failed: ${created.error}`);
        proposalId = created.proposal.id;
        assert(created.proposal.status === 'pending', "created proposal status is 'pending'");
        assert(created.alreadyPending === false, 'first create is NOT alreadyPending');

        console.log('— list join —');
        const pending = await listPendingAssignmentProposals();
        const listed = pending.find((p) => p.id === proposalId);
        assert(!!listed, 'listPendingAssignmentProposals includes the proposal');
        assert(listed?.customerName === job.customerName, 'list row joins the CBR customerName');
        assert(typeof listed?.contractorName === 'string' && listed.contractorName.length > 0, 'list row carries a contractor display name');

        console.log('— desk shows it —');
        const items = await buildDeskItems();
        const item = items.find((i) => i.kind === 'assignment' && i.proposalId === proposalId);
        assert(!!item, "desk has an 'assignment' item with our proposalId");
        assert(!!item?.title.startsWith('Assign ') && !!item?.title.includes(job.customerName), 'title is "Assign <contractor> → <customer>"');
        assert(item?.preview === MARK, 'preview is the proposal note');
        assert(!!item?.badges.includes('PROPOSAL'), "badges include 'PROPOSAL'");
        assert(item?.href === '/admin/dispatch', 'href points at the dispatch admin page');
        assert(typeof item?.waitingWorkingHours === 'number' && item.waitingWorkingHours >= 0, 'waitingWorkingHours is a number ≥ 0');

        console.log('— duplicate create → alreadyPending —');
        const dup = await createAssignmentProposal({
            jobId: job.id,
            contractorId: contractor.id,
            note: `${MARK} (dup)`,
            createdBy: 'd-wp3-test',
        });
        assert(dup.ok, 'duplicate create returns ok (not a throw)');
        assert(dup.ok && dup.alreadyPending === true, 'duplicate create is flagged alreadyPending');
        assert(dup.ok && dup.proposal.id === proposalId, 'duplicate create returns the EXISTING pending row');

        console.log('— reject (never approve: approve = REAL assignment) —');
        const rejected = await rejectAssignmentProposal(proposalId, 'd-wp3-test');
        assert(rejected.ok, 'reject from pending returns ok');
        assert(rejected.ok && rejected.proposal.status === 'rejected', "proposal status is 'rejected'");
        assert(rejected.ok && rejected.proposal.decidedBy === 'd-wp3-test', 'decidedBy recorded');
        assert(rejected.ok && !!rejected.proposal.decidedAt, 'decidedAt recorded');

        console.log('— approve after reject → not_pending (safe 409 path) —');
        const lateApprove = await approveAssignmentProposal(proposalId, 'd-wp3-test');
        assert(!lateApprove.ok && lateApprove.code === 'not_pending', "approve on a decided proposal returns { ok:false, code:'not_pending' }");

        console.log('— reject again → not_pending —');
        const lateReject = await rejectAssignmentProposal(proposalId, 'd-wp3-test');
        assert(!lateReject.ok && lateReject.code === 'not_pending', 'second reject also refuses (only from pending)');

        console.log('— gone from desk —');
        const itemsAfter = await buildDeskItems();
        assert(!itemsAfter.some((i) => i.proposalId === proposalId), 'rejected proposal is off the desk');

        console.log('— job untouched —');
        const [jobAfter] = await db.select({ assignmentStatus: contractorBookingRequests.assignmentStatus })
            .from(contractorBookingRequests)
            .where(eq(contractorBookingRequests.id, job.id))
            .limit(1);
        assert(jobAfter?.assignmentStatus === 'unassigned', 'the real job is STILL unassigned (nothing assigned it)');
    } finally {
        console.log('— cleanup —');
        try {
            if (proposalId) {
                await db.delete(assignmentProposals).where(eq(assignmentProposals.id, proposalId));
                console.log(`  proposal ${proposalId} deleted`);
            } else {
                console.log('  no proposal to delete');
            }
            if (seededJobId) {
                await db.delete(contractorBookingRequests).where(eq(contractorBookingRequests.id, seededJobId));
                console.log(`  seeded temp CBR ${seededJobId} deleted`);
            }
        } catch (error: any) {
            failures++;
            console.error('  ✗ CLEANUP FAILED — delete the D-WP3 TEST rows by hand:', error?.message);
        }
    }

    console.log(failures === 0 ? '\nALL ASSERTIONS PASSED' : `\n${failures} ASSERTION(S) FAILED`);
    process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
    console.error('Test crashed:', error);
    process.exit(1);
});
