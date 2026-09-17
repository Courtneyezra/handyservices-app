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
 *   npx tsx scripts/_opt-out.ts revoke "+447700900123" "sam@example.com" --by ben --note "asked to be put back on"
 *
 * A lift takes every address of the party, phones and emails alike: a row that also carries an
 * address not named is left live, in case that address is another party's.
 *
 * Adds default to scope 'marketing', matching a plain STOP. Use --scope all only for an explicit
 * "do not contact me at all", because that blocks service messages too.
 */
import 'dotenv/config';
import { db } from '../server/db';
import { commsOptOuts } from '@shared/schema';
import { desc, isNull } from 'drizzle-orm';
import { getOptOut, recordOptOut, revokeOptOut, liftAddressOf, optOutRefusalMessage, countOptOuts } from '../server/opt-out';

const [, , command, target] = process.argv;
const firstFlag = process.argv.findIndex((a, i) => i > 2 && a.startsWith('--'));
const targets = process.argv.slice(3, firstFlag < 0 ? undefined : firstFlag);
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
            if (!targets.length) throw new Error('revoke needs one or more phone numbers or email addresses');
            const who = targets.join(', ');
            const { revoked, leftShared, stillLive } = await revokeOptOut(liftAddressOf(targets), flag('by') ?? 'ops', flag('note'));
            console.log(revoked ? `Lifted ${revoked} suppression row(s) for ${who}.` : `Nothing lifted for ${who}.`);
            const line = (r: { id: string; scope: string; phoneKey: string | null; emailKey: string | null }) => `${r.id} (${r.scope}, ${r.phoneKey ?? '-'} / ${r.emailKey ?? '-'})`;
            for (const r of leftShared) console.log(`  Left live on a shared address: ${line(r)}`);
            for (const r of stillLive) console.log(`  Still live: ${line(r)}; run the lift again to lift it`);
            break;
        }
        default:
            console.log('Usage: list | check <phone> | add <phone> [--scope marketing|all] [--note ...] | revoke <phone|email>... [--by ...]');
    }
    process.exit(0);
}

main().catch((e) => { console.error(e.message ?? e); process.exit(1); });
