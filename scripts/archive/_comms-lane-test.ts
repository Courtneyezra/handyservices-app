/**
 * Exercises the on-inbound lane end-to-end exactly as a webhook would: schedules the debounced
 * triage for a conversation and waits for it to fire. Temporarily shortens the debounce so the
 * test takes seconds, then restores it.
 *
 *   npx tsx scripts/_comms-lane-test.ts <phone>
 */
import 'dotenv/config';
import { db } from '../server/db';
import { conversations } from '@shared/schema';
import { eq } from 'drizzle-orm';
import { scheduleInboundTriage } from '../server/agents/comms-lanes';
import { getCommsAgentConfig, setCommsAgentConfig } from '../server/agents/comms';

async function main() {
    const phone = process.argv[2];
    if (!phone) { console.error('usage: _comms-lane-test.ts <phone>'); process.exit(1); }
    const key = `${phone.replace(/\D/g, '')}@c.us`;
    const [conv] = await db.select().from(conversations).where(eq(conversations.phoneNumber, key));
    if (!conv) { console.error(`no conversation for ${key}`); process.exit(1); }

    const before = await getCommsAgentConfig();
    await setCommsAgentConfig({ inboundDebounceMinutes: 0.08 }); // ~5s for the test
    try {
        console.log(`scheduling on-inbound triage for ${conv.id} (debounce ~5s)…`);
        scheduleInboundTriage(conv.id, conv.phoneNumber);
        // The lane logs its own progress; give the run time to finish.
        await new Promise((r) => setTimeout(r, 120_000));
    } finally {
        await setCommsAgentConfig({ inboundDebounceMinutes: before.inboundDebounceMinutes });
        console.log(`debounce restored to ${before.inboundDebounceMinutes} min`);
    }
    process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
