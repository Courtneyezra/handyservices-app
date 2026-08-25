/**
 * Checks the working-hours SLA maths against hand-worked cases, including the weekend and
 * overnight boundaries that make naive elapsed-time ageing useless.
 *
 *   npx tsx scripts/_comms-sla-verify.ts
 */
import { workingHoursBetween, computeWaitState } from '../server/comms-sla';

// Europe/London is BST (UTC+1) in August, so 09:00 UTC = 10:00 local.
const d = (iso: string) => new Date(iso);

const cases: Array<{ label: string; from: string; to: string; expect: number }> = [
    { label: 'two hours inside a working day', from: '2026-08-12T09:00:00Z', to: '2026-08-12T11:00:00Z', expect: 2 },
    { label: 'overnight — 17:00 Wed to 09:00 Thu local, only 1h + 1h counts',
      from: '2026-08-12T16:00:00Z', to: '2026-08-13T08:00:00Z', expect: 2 },
    { label: 'across a full weekend — Fri 17:00 to Mon 09:00 local',
      from: '2026-08-14T16:00:00Z', to: '2026-08-17T08:00:00Z', expect: 2 },
    { label: 'entirely within a Sunday counts as zero',
      from: '2026-08-16T09:00:00Z', to: '2026-08-16T17:00:00Z', expect: 0 },
    { label: 'before opening — 06:00 to 10:00 local yields 2h',
      from: '2026-08-12T05:00:00Z', to: '2026-08-12T09:00:00Z', expect: 2 },
    { label: 'to before from', from: '2026-08-12T11:00:00Z', to: '2026-08-12T09:00:00Z', expect: 0 },
];

let failures = 0;

console.log('=== workingHoursBetween ===');
for (const c of cases) {
    const actual = workingHoursBetween(d(c.from), d(c.to));
    const ok = Math.abs(actual - c.expect) < 0.15; // hour-granularity walk
    if (!ok) failures++;
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${c.label}\n      got ${actual}h, expected ~${c.expect}h`);
}

console.log('\n=== computeWaitState ===');
const now = d('2026-08-17T09:00:00Z'); // Monday 10:00 local

const states: Array<{ label: string; inbound: string | null; outbound: string | null; expectAwaiting: boolean; expectBreached: boolean }> = [
    { label: 'no inbound at all — nobody waiting', inbound: null, outbound: '2026-08-17T08:00:00Z', expectAwaiting: false, expectBreached: false },
    { label: 'we replied after them — answered', inbound: '2026-08-17T07:00:00Z', outbound: '2026-08-17T08:00:00Z', expectAwaiting: false, expectBreached: false },
    { label: 'they messaged 1 working hour ago — waiting, not breached', inbound: '2026-08-17T08:00:00Z', outbound: null, expectAwaiting: true, expectBreached: false },
    { label: 'they messaged Friday evening — only 2 working hours by Mon 10:00', inbound: '2026-08-14T16:00:00Z', outbound: null, expectAwaiting: true, expectBreached: false },
    { label: 'they messaged Thursday morning — well past 4 working hours', inbound: '2026-08-13T08:00:00Z', outbound: null, expectAwaiting: true, expectBreached: true },
    { label: 'our reply predates their message — still waiting', inbound: '2026-08-13T08:00:00Z', outbound: '2026-08-12T08:00:00Z', expectAwaiting: true, expectBreached: true },
];

for (const s of states) {
    const r = computeWaitState(s.inbound ? d(s.inbound) : null, s.outbound ? d(s.outbound) : null, 4, now);
    const ok = r.awaitingReply === s.expectAwaiting && r.breached === s.expectBreached;
    if (!ok) failures++;
    console.log(
        `${ok ? 'PASS' : 'FAIL'}  ${s.label}\n      awaiting=${r.awaitingReply} breached=${r.breached} ` +
        `working=${r.waitingWorkingHours}h clock=${r.waitingClockHours}h severity=${r.severity}`
    );
}

console.log(failures === 0 ? '\nAll SLA cases passed.' : `\n${failures} case(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
