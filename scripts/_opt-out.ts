/**
 * Ops handle on the suppression list: list it, add to it, lift from it.
 *
 * The keyword detector only catches opt-outs that arrive as text. People also say it on the phone,
 * in person, or by email, and an opt-out mechanism that only works down one pipe is not one. This
 * is how a human records what they were told, and how they lift it if the customer changes their
 * mind.
 *
 *   npx tsx scripts/_opt-out.ts list
 *   npx tsx scripts/_opt-out.ts check "+447700900123"
 *   npx tsx scripts/_opt-out.ts add "+447700900123" --scope all --note "said so on the phone to Ben"
 *   npx tsx scripts/_opt-out.ts revoke "+447700900123" --by ben --note "asked to be put back on"
 *
 * Adds default to scope 'marketing', matching a plain STOP. Use --scope all only for an explicit
 * "do not contact me at all", because that blocks service messages too.
 */
import 'dotenv/config';
import { db } from '../server/db';
import { commsOptOuts } from '@shared/schema';
import { desc, isNull } from 'drizzle-orm';
import { getOptOut, recordOptOut, revokeOptOut, optOutRefusalMessage, countOptOuts } from '../server/opt-out';

const [, , command, target] = process.argv;
const flag = (name: string) => {
    const i = process.argv.indexOf(`--${name}`);
    return i >= 0 ? process.argv[i + 1] : undefined;
};

async function main() {
    switch (command) {
        case 'list': {
            const rows = await db.select().from(commsOptOuts)
                .where(isNull(commsOptOuts.revokedAt))
                .orderBy(desc(commsOptOuts.createdAt)).limit(500);
            const totals = await countOptOuts();
            console.log(`${totals.marketing} marketing, ${totals.all} do-not-contact\n`);
            console.table(rows.map((r) => ({
                when: r.createdAt.toISOString().slice(0, 10),
                phone: r.e164,
                scope: r.scope,
                source: r.source,
                matched: r.matchedKeyword,
                said: (r.triggerText ?? '').slice(0, 40),
            })));
            break;
        }
        case 'check': {
            if (!target) throw new Error('check needs a phone number');
            const record = await getOptOut(target);
            console.log(record ? `${optOutRefusalMessage(record)}\n\n${JSON.stringify(record, null, 2)}` : 'Not suppressed.');
            break;
        }
        case 'add': {
            if (!target) throw new Error('add needs a phone number');
            const scope = (flag('scope') ?? 'marketing') as 'marketing' | 'all';
            if (scope !== 'marketing' && scope !== 'all') throw new Error("--scope must be 'marketing' or 'all'");
            const r = await recordOptOut({
                phone: target, scope, source: 'manual',
                channel: flag('channel') ?? null,
                note: flag('note') ?? 'entered manually',
                triggerText: flag('said') ?? null,
            });
            console.log(r.created ? `Suppressed ${target} (${scope}).` : `Could not record ${target}.`);
            break;
        }
        case 'revoke': {
            if (!target) throw new Error('revoke needs a phone number');
            const n = await revokeOptOut(target, flag('by') ?? 'ops', flag('note'));
            console.log(n ? `Lifted ${n} suppression row(s) for ${target}.` : `Nothing live to lift for ${target}.`);
            break;
        }
        default:
            console.log('Usage: list | check <phone> | add <phone> [--scope marketing|all] [--note ...] | revoke <phone> [--by ...]');
    }
    process.exit(0);
}

main().catch((e) => { console.error(e.message ?? e); process.exit(1); });
