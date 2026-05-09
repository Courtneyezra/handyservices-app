#!/usr/bin/env node
// Wave 6 smoke — exercises each newly-wired notification emit point in DRY_RUN
// mode. This script does NOT touch the database; it imports the recipient
// helpers and the orchestrator and pushes synthetic payloads through them so
// that we can verify the templates render and the audit-row gate runs.
//
// Run:
//   NOTIFICATIONS_DRY_RUN=1 node scripts/smoke-notifications-wiring.mjs

import 'dotenv/config';
import { dispatchEvent, eventForTransition, notifyOnTransition } from '../server/notifications/index.ts';

if (process.env.NOTIFICATIONS_DRY_RUN !== '1') {
    console.error('FATAL: NOTIFICATIONS_DRY_RUN must be 1 for this script');
    process.exit(2);
}

console.log('--- Wave 6 notifications wiring smoke ---');
console.log('NOTIFICATIONS_DRY_RUN=1, FF_NOTIFICATIONS_V2 must be on for any sends');

const fakeContractor = {
    type: 'contractor',
    id: 'unit_test_mark',
    phone: '+447700900100',
    email: 'mark@example.com',
};
const fakeCustomer = {
    type: 'customer',
    id: 'qte_test_001',
    phone: '+447700900200',
    email: 'cust@example.com',
};
const fakeAdmin = { type: 'admin', id: 'admin', email: 'ops@handy.services' };

const cases = [
    {
        label: 'pack_offered',
        run: () => dispatchEvent('pack_offered', [fakeContractor], {
            contractorFirstName: 'Mark',
            date: '2026-05-15',
            stopCount: 4,
            area: 'NG1, NG2',
            dayRate: 28000,
            offerUrl: 'https://handy.services/dispatch/pack_test?token=unit_test_mark',
            packId: 'pack_test_001',
        }),
    },
    {
        label: 'pack_accepted',
        run: () => dispatchEvent('pack_accepted', [fakeAdmin, fakeContractor, fakeCustomer], {
            packId: 'pack_test_001',
            contractorName: 'Mark Ezra',
            date: '2026-05-15',
            stopCount: 4,
            dayRate: 28000,
        }),
    },
    {
        label: 'pack_released',
        run: () => dispatchEvent('pack_released', [fakeAdmin], {
            packId: 'pack_test_001',
            commitmentId: 'commit_test_001',
            stopCount: 3,
            date: '2026-05-15',
            reason: 'pack_expired',
        }),
    },
    {
        label: 'routing_offer_round_1',
        run: () => dispatchEvent('routing_offer_round_1', [fakeContractor], {
            contractorFirstName: 'Mark',
            title: 'Bathroom tap repair',
            postcode: 'NG7 2BU',
            payAmount: 8500,
            offerUrl: 'https://handy.services/contractor/offers/offer_test_001',
        }),
    },
    {
        label: 'routing_offer_round_2',
        run: () => dispatchEvent('routing_offer_round_2', [fakeContractor], {
            contractorFirstName: 'Mark',
            title: 'Bathroom tap repair',
            postcode: 'NG7 2BU',
            payAmount: 8500,
            offerUrl: 'https://handy.services/contractor/offers/offer_test_001',
        }),
    },
    {
        label: 'routing_offer_broadcast',
        run: () => dispatchEvent('routing_offer_broadcast', [fakeContractor], {
            title: 'Bathroom tap repair',
            postcode: 'NG7 2BU',
            payAmount: 8500,
            offerUrl: 'https://handy.services/contractor/offers/offer_test_001',
        }),
    },
    {
        label: 'offer_accepted',
        run: () => dispatchEvent('offer_accepted', [fakeCustomer, fakeContractor], {
            title: 'Bathroom tap repair',
            startTime: '2026-05-15 AM',
            address: '12 Test St, NG7 2BU',
        }),
    },
    {
        label: 'job_completed (notifyOnTransition)',
        run: () => notifyOnTransition('qte_test_001', 'in_progress', 'completed_pending_review', {
            recipients: [fakeCustomer],
            payload: {
                customerName: 'Test',
                contractorName: 'Mark',
                reviewUrl: 'https://handy.services/review/qte_test_001',
            },
        }),
    },
    {
        label: 'reschedule_required',
        run: () => dispatchEvent('reschedule_required', [fakeCustomer], {
            customerName: 'Test',
            rescheduleUrl: 'https://handy.services/quotes/qte_test_001/reschedule',
            date: 'your slot',
        }, { urgent: true }),
    },
];

console.log('eventForTransition smoke checks:');
console.log('  reserved_for_pack→dispatched =>', eventForTransition('reserved_for_pack', 'dispatched'));
console.log('  reserved_for_pack→offer_round_1 =>', eventForTransition('reserved_for_pack', 'offer_round_1'));
console.log('  in_progress→completed_pending_review =>', eventForTransition('in_progress', 'completed_pending_review'));
console.log('  offer_round_3→reschedule_required =>', eventForTransition('offer_round_3', 'reschedule_required'));

let allOk = true;
for (const c of cases) {
    process.stdout.write(`\n${c.label}: `);
    try {
        const results = await c.run();
        const summary = Array.isArray(results)
            ? results.map((r) => `${r.channel}:${r.status}${r.error ? ` (${r.error})` : ''}`).join(' | ')
            : `${results.channel}:${results.status}`;
        console.log(summary);
    } catch (err) {
        allOk = false;
        console.log(`THREW: ${err.message ?? err}`);
    }
}

console.log(allOk ? '\n✓ all smoke cases ran without throwing' : '\n✗ smoke had failures');
process.exit(allOk ? 0 : 1);
