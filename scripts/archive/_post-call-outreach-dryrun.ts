/**
 * Dry-run the post-call outreach guardrails against REAL recent calls, without sending anything.
 *
 * Re-implements the decision ladder in the same order as maybeSendPostCallVideoRequest() but with
 * the send removed, so you can see exactly who would have been messaged before switching it on.
 *
 *   npx tsx scripts/_post-call-outreach-dryrun.ts [limit]
 */
import { db } from '../server/db';
import { calls, conversations, messages } from '@shared/schema';
import { and, desc, eq, gte, isNotNull } from 'drizzle-orm';
import { getOutreachConfig, isNonMobileUkNumber } from '../server/post-call-outreach';
import { normalizePhoneNumber } from '../server/phone-utils';

async function main() {
    const limit = Number(process.argv[2] || 40);
    const cfg = await getOutreachConfig();
    console.log('Config:', JSON.stringify(cfg));
    console.log(`\nEvaluating the last ${limit} calls (NO messages will be sent)\n`);

    const recent = await db.select().from(calls).orderBy(desc(calls.startTime)).limit(limit);

    // Replay oldest-first: in production each send stamps videoRequestSentAt, which then suppresses
    // the same caller's later calls. Evaluating newest-first without tracking that would report
    // repeat callers as fresh sends and overstate the volume.
    const chronological = [...recent].reverse();
    const sentToInRun = new Map<string, Date>();

    const rows: any[] = [];
    let wouldSend = 0;

    for (const call of chronological) {
        const decide = async (): Promise<string> => {
            if (call.direction !== 'inbound') return `NOT_INBOUND:${call.direction}`;
            if (call.status && !['completed', 'complete'].includes(String(call.status).toLowerCase())) {
                // Status naming varies by path; treat a present duration as evidence it connected.
                if (!call.duration) return `NOT_COMPLETED:${call.status}`;
            }
            const duration = call.duration ?? 0;
            if (duration < cfg.minDurationSeconds) return `TOO_SHORT:${duration}s`;
            if (call.videoRequestSentAt) return 'ALREADY_SENT_FOR_THIS_CALL';

            const phone = normalizePhoneNumber(call.phoneNumber || '');
            if (!phone) return `UNPARSEABLE_PHONE:${call.phoneNumber}`;

            const suppressed = new Set(cfg.suppressedNumbers.map((n) => normalizePhoneNumber(n) || n));
            if (suppressed.has(phone)) return 'SUPPRESSED_NUMBER';

            if (cfg.mobileOnly && isNonMobileUkNumber(phone)) return 'NOT_A_MOBILE';

            // Earlier call in this same replay already triggered a send to this number.
            const alreadyInRun = sentToInRun.get(phone);
            if (alreadyInRun) {
                const days = (call.startTime!.getTime() - alreadyInRun.getTime()) / 86400000;
                if (days < cfg.dedupeDays) return `ALREADY_ASKED_WITHIN_${cfg.dedupeDays}D`;
            }

            const since = new Date(Date.now() - cfg.dedupeDays * 24 * 60 * 60 * 1000);
            const [prior] = await db.select({ id: calls.id }).from(calls)
                .where(and(
                    eq(calls.phoneNumber, call.phoneNumber),
                    isNotNull(calls.videoRequestSentAt),
                    gte(calls.videoRequestSentAt, since),
                ))
                .limit(1);
            if (prior) return `ALREADY_ASKED_WITHIN_${cfg.dedupeDays}D`;

            const convKey = `${phone.replace('+', '')}@c.us`;
            const [conv] = await db.select().from(conversations)
                .where(eq(conversations.phoneNumber, convKey));
            if (conv) {
                const [inbound] = await db.select({ id: messages.id }).from(messages)
                    .where(and(eq(messages.conversationId, conv.id), eq(messages.direction, 'inbound')))
                    .limit(1);
                if (inbound) return 'EXISTING_WHATSAPP_THREAD';
            }
            return 'WOULD_SEND';
        };

        const reason = await decide();
        if (reason === 'WOULD_SEND') {
            wouldSend++;
            const phone = normalizePhoneNumber(call.phoneNumber || '');
            if (phone && call.startTime) sentToInRun.set(phone, call.startTime);
        }
        rows.push({
            started: call.startTime?.toISOString().slice(0, 16).replace('T', ' '),
            phone: call.phoneNumber,
            dir: call.direction,
            secs: call.duration ?? 0,
            decision: reason,
        });
    }

    console.table(rows);

    const tally = rows.reduce<Record<string, number>>((acc, r) => {
        const key = r.decision.split(':')[0];
        acc[key] = (acc[key] || 0) + 1;
        return acc;
    }, {});
    console.log('\nDecision tally:');
    console.table(Object.entries(tally).map(([decision, n]) => ({ decision, n })));
    console.log(`\n${wouldSend} of ${rows.length} recent calls would receive a video request.`);
    console.log(cfg.enabled
        ? 'Outreach is currently ON.'
        : 'Outreach is currently OFF — nothing is being sent in production.');
    process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
