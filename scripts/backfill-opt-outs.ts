/**
 * BACKFILL — find everyone who ever asked us to stop, before the suppression list existed.
 *
 * Inbound capture predates the opt-out machinery by years, so any STOP sent before today landed in
 * `messages` and nowhere else. A campaign that reads only the live suppression list would message
 * those people again, and "we hadn't built the feature yet" is not a defence — the opt-out was
 * received, it is in our own database, and a false negative here is a compliance problem rather
 * than a missed nicety.
 *
 * This replays every inbound message through the SAME detector the live path uses (detectOptOut),
 * so the historical verdict and the future verdict can never disagree. Idempotent: rows are keyed
 * on the triggering message id, so re-running adds nothing.
 *
 * Dry run by default. `--apply` writes.
 *
 *   npx tsx scripts/backfill-opt-outs.ts                 # report only
 *   npx tsx scripts/backfill-opt-outs.ts --apply         # write the suppressions
 *   npx tsx scripts/backfill-opt-outs.ts --show-near     # also list near-misses for eyeballing
 *
 * NOTE ON THE CORPUS: `messages` carries ~58k phantom OUTBOUND rows from a runaway loop in
 * Feb-Mar 2026. They are outbound, so they are excluded by the direction filter and cannot pollute
 * this. Only genuine inbound text is scanned.
 */
import 'dotenv/config';
import { db } from '../server/db';
import { sql } from 'drizzle-orm';
import { detectOptOut, recordOptOut, countOptOuts, type OptOutScope } from '../server/opt-out';
import { commsPhoneKey } from '../server/phone-utils';

const APPLY = process.argv.includes('--apply');
const SHOW_NEAR = process.argv.includes('--show-near');

/**
 * Messages worth showing a human even though the detector said no. These are the words that WOULD
 * have matched a looser rule; printing them is how we check that "conservative" has not become
 * "deaf". They are never written to the suppression table.
 */
const NEAR_MISS = /\b(stop|unsubscribe|opt.?out|remove me|do not contact|don'?t contact|take me off|leave me alone|no more messages)\b/i;

async function main() {
    console.log(`Scanning inbound message history for opt-outs (${APPLY ? 'APPLY' : 'DRY RUN'}) ...\n`);

    // Only inbound text. Ordered oldest-first so, when someone said STOP twice, the recorded
    // suppression carries the date they FIRST asked.
    const rows: any = await db.execute(sql`
        SELECT m.id, m.conversation_id, m.content, m.channel, m.created_at,
               c.phone_number, c.contact_name
        FROM messages m
        LEFT JOIN conversations c ON c.id = m.conversation_id
        WHERE m.direction = 'inbound'
          AND m.content IS NOT NULL
          AND length(trim(m.content)) > 0
        ORDER BY m.created_at ASC
    `);
    const all = rows.rows ?? rows;
    console.log(`${all.length.toLocaleString()} inbound messages to check.`);

    const hits: Array<{ key: string; phone: string; scope: OptOutScope; keyword: string; rule: string; text: string; id: string; when: string; name: string | null; convId: string | null; channel: string | null }> = [];
    const near: Array<{ phone: string; text: string; when: string }> = [];

    for (const m of all) {
        const match = detectOptOut(m.content);
        const phone = m.phone_number || '';
        if (!match) {
            if (SHOW_NEAR && NEAR_MISS.test(m.content) && m.content.length < 200) {
                near.push({ phone, text: String(m.content).replace(/\s+/g, ' ').trim(), when: String(m.created_at).slice(0, 10) });
            }
            continue;
        }
        const key = commsPhoneKey(phone);
        if (!key) {
            console.warn(`  ! opt-out found on an unusable number, skipped: ${JSON.stringify(m.content).slice(0, 60)}`);
            continue;
        }
        hits.push({
            key, phone, scope: match.scope, keyword: match.keyword, rule: match.rule,
            text: String(m.content).replace(/\s+/g, ' ').trim(), id: m.id,
            when: String(m.created_at).slice(0, 10), name: m.contact_name ?? null,
            convId: m.conversation_id ?? null, channel: m.channel ?? null,
        });
    }

    const people = new Set(hits.map((h) => h.key));
    console.log(`\n${hits.length} matching messages from ${people.size} distinct people.\n`);

    if (hits.length) {
        console.log('─'.repeat(110));
        console.log('date        phone            scope      rule    matched            message');
        console.log('─'.repeat(110));
        for (const h of hits) {
            console.log(
                `${h.when}  ${h.phone.slice(0, 16).padEnd(17)}${h.scope.padEnd(11)}${h.rule.padEnd(8)}` +
                `${h.keyword.slice(0, 18).padEnd(19)}${h.text.slice(0, 40)}`,
            );
        }
        console.log('─'.repeat(110));
    } else {
        console.log('No historical opt-outs found. That is a real result, not a skipped scan:');
        console.log('outbound was broken for months and the marketing templates were only approved on 18 Aug,');
        console.log('so almost nothing has been sent that a customer would reply STOP to yet.');
    }

    if (SHOW_NEAR) {
        console.log(`\n── NEAR MISSES (contain a stop-ish word, NOT treated as opt-outs) ${'─'.repeat(40)}`);
        if (!near.length) console.log('none');
        for (const n of near.slice(0, 60)) {
            console.log(`  ${n.when}  ${n.phone.slice(0, 16).padEnd(17)}${n.text.slice(0, 80)}`);
        }
        if (near.length > 60) console.log(`  … and ${near.length - 60} more`);
        console.log('\nEvery line above is a message the detector deliberately let through. If one of them is a');
        console.log('genuine opt-out, add the phrase to server/opt-out.ts and re-run this.');
    }

    if (!APPLY) {
        console.log(`\nDRY RUN. Re-run with --apply to write ${hits.length} suppression row(s).`);
        process.exit(0);
    }

    let created = 0, existing = 0;
    for (const h of hits) {
        const r = await recordOptOut({
            phone: h.phone,
            scope: h.scope,
            source: 'backfill',
            channel: h.channel,
            conversationId: h.convId,
            messageId: h.id,
            contactName: h.name,
            matchedKeyword: h.keyword,
            matchRule: h.rule as 'exact' | 'phrase',
            triggerText: h.text,
            note: `backfilled from message history on ${new Date().toISOString().slice(0, 10)}`,
        });
        if (r.created) created++; else existing++;
    }

    const totals = await countOptOuts();
    console.log(`\nWrote ${created} new suppression row(s); ${existing} already present.`);
    console.log(`Live suppressions now: ${totals.marketing} marketing, ${totals.all} do-not-contact.`);
    process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
