// server/pay-protection/payout-sla.ts
//
// Guarantee 6 — 48-hour pay SLA monitor.
//
// Spec §9: walk `contractor_payouts` for rows older than 48h still
// unpaid (and not held / failed) and surface them as overdue. Also
// flags rows in the "due soon" window (24-48h since `scheduledPayoutAt`)
// so ops can pre-empt breaches.
//
// The SLA monitor stays online even with FF_PAY_PROTECTION OFF — it's
// observability, not behaviour change. The contractor pay path is
// unaffected.

import { db } from '../db';
import { contractorPayouts } from '../../shared/schema';
import { and, eq, isNull, lt, gte, ne } from 'drizzle-orm';

export interface PayoutSlaReport {
    overdue: PayoutSummary[];
    dueSoon: PayoutSummary[];
}

export interface PayoutSummary {
    payoutId: number;
    contractorId: string;
    netPayoutPence: number;
    scheduledPayoutAt: Date | null;
    ageHours: number | null;
}

const SLA_HOURS_OVERDUE = 48;
const SLA_HOURS_DUE_SOON = 24;

export async function checkPayoutSLA(now: Date = new Date()): Promise<PayoutSlaReport> {
    // Pull every still-unpaid row scheduled before now. We bucket
    // overdue vs due-soon in JS rather than two queries — the cardinality
    // here is tiny (open payouts are bounded) and a single scan keeps
    // the index footprint smaller.
    const open = await db
        .select({
            id: contractorPayouts.id,
            contractorId: contractorPayouts.contractorId,
            netPayoutPence: contractorPayouts.netPayoutPence,
            scheduledPayoutAt: contractorPayouts.scheduledPayoutAt,
            status: contractorPayouts.status,
        })
        .from(contractorPayouts)
        .where(and(
            isNull(contractorPayouts.paidAt),
            ne(contractorPayouts.status, 'held'),
            ne(contractorPayouts.status, 'failed'),
        ));

    const overdue: PayoutSummary[] = [];
    const dueSoon: PayoutSummary[] = [];

    for (const row of open) {
        if (!row.scheduledPayoutAt) continue;
        const ageHours = (now.getTime() - new Date(row.scheduledPayoutAt).getTime()) / (1000 * 60 * 60);
        const summary: PayoutSummary = {
            payoutId: row.id,
            contractorId: row.contractorId,
            netPayoutPence: row.netPayoutPence,
            scheduledPayoutAt: row.scheduledPayoutAt,
            ageHours,
        };
        if (ageHours >= SLA_HOURS_OVERDUE) {
            overdue.push(summary);
        } else if (ageHours >= SLA_HOURS_DUE_SOON) {
            dueSoon.push(summary);
        }
    }

    if (overdue.length > 0) {
        console.warn(
            `[pay-protection][sla] ${overdue.length} payout(s) overdue >${SLA_HOURS_OVERDUE}h`,
            overdue.map((p) => ({
                payoutId: p.payoutId,
                contractorId: p.contractorId,
                ageHours: p.ageHours?.toFixed(1),
            })),
        );
    }

    return { overdue, dueSoon };
}
