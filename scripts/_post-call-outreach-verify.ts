/**
 * Exercises the REAL maybeSendPostCallVideoRequest() against real call records, under a config
 * that makes an actual send impossible.
 *
 * The trick: quiet hours are set to cover the whole day (0->24), which is the LAST guardrail before
 * the send. Every earlier check (enabled, status, call lookup, direction, duration, already-sent,
 * phone parse, suppression, mobile-only) therefore runs for real, and anything that survives them
 * stops at QUIET_HOURS instead of messaging a customer. A result of QUIET_HOURS means "this call
 * passed every other guardrail" — i.e. it is exactly the set that would be messaged for real.
 *
 * Restores the previous config on exit, including after a failure.
 *
 *   npx tsx scripts/_post-call-outreach-verify.ts
 */
import { db } from '../server/db';
import { calls } from '@shared/schema';
import { desc } from 'drizzle-orm';
import {
    getOutreachConfig,
    setOutreachConfig,
    maybeSendPostCallVideoRequest,
    isNonMobileUkNumber,
    type PostCallOutreachConfig,
} from '../server/post-call-outreach';

function checkMobileClassifier() {
    const cases: Array<[string, boolean]> = [
        ['+447449501762', false], // UK mobile
        ['+447552217846', false], // UK mobile
        ['+442037722784', true],  // London landline
        ['+441865630073', true],  // Oxford landline
        ['+441245981427', true],  // Chelmsford landline
        ['+84357691573', false],  // Non-UK — undecidable, so not excluded
        ['+15558874602', false],  // Non-UK
    ];
    let bad = 0;
    for (const [num, expected] of cases) {
        const actual = isNonMobileUkNumber(num);
        if (actual !== expected) { bad++; console.log(`  FAIL ${num}: got ${actual}, expected ${expected}`); }
        else console.log(`  ok   ${num} -> ${actual ? 'landline (skip)' : 'sendable'}`);
    }
    return bad;
}

async function main() {
    console.log('=== isNonMobileUkNumber ===');
    const classifierFailures = checkMobileClassifier();

    const original: PostCallOutreachConfig = await getOutreachConfig();
    console.log('\nSaved original config:', JSON.stringify(original));

    let restored = false;
    const restore = async () => {
        if (restored) return;
        restored = true;
        await setOutreachConfig(original);
        console.log('\nOriginal config restored:', JSON.stringify(await getOutreachConfig()));
    };
    process.on('exit', () => { if (!restored) console.error('!! config may not have been restored'); });

    try {
        // Enabled, but with an all-day quiet window as the terminal backstop.
        await setOutreachConfig({ enabled: true, quietHoursStart: 0, quietHoursEnd: 24 });
        console.log('Test config applied (enabled, quiet hours 0->24 = always quiet).\n');

        const recent = await db.select().from(calls).orderBy(desc(calls.startTime)).limit(25);

        const rows: any[] = [];
        for (const call of recent) {
            const decision = await maybeSendPostCallVideoRequest({
                callSid: call.callId,
                callStatus: 'completed',
                from: call.phoneNumber,
                durationSeconds: call.duration ?? undefined,
            });
            rows.push({
                phone: call.phoneNumber,
                dir: call.direction,
                secs: call.duration ?? 0,
                sent: decision.sent,
                reason: decision.reason,
            });
        }
        console.table(rows);

        const sends = rows.filter((r) => r.sent);
        const passedAll = rows.filter((r) => r.reason.startsWith('QUIET_HOURS'));
        const tally = rows.reduce<Record<string, number>>((a, r) => {
            const k = r.reason.split(':')[0];
            a[k] = (a[k] || 0) + 1;
            return a;
        }, {});
        console.table(Object.entries(tally).map(([reason, n]) => ({ reason, n })));

        console.log(`\nActually sent            : ${sends.length}  (MUST be 0)`);
        console.log(`Passed every other check : ${passedAll.length}  (these would be messaged in production)`);

        const ok = sends.length === 0 && classifierFailures === 0;
        console.log(ok ? '\nPASS — no sends escaped, classifier correct.' : '\nFAIL — see above.');
        await restore();
        process.exit(ok ? 0 : 1);
    } catch (e) {
        console.error(e);
        await restore();
        process.exit(1);
    }
}
main();
