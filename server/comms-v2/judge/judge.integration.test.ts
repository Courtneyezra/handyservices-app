/**
 * One scenario end to end against the sandbox door, and the Contract 7 check that a dry run
 * against the current desk yields one planned send per customer turn.
 *
 * Needs the real door: the server's environment (DATABASE_URL and the model keys) for the
 * in-process router, or COMMS_V2_DOOR_URL and COMMS_V2_DOOR_TOKEN for a running server, and
 * COMMS_V2_JUDGE_LIVE=1 to opt in. Without it the file is skipped, never green by pretending.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { openDoor, type DoorClient } from './door';
import { plannedSendSchema } from './planned-send';
import { runScenario } from './runner';
import { loadScenarios } from './scenario';

const live = process.env.COMMS_V2_JUDGE_LIVE === '1' && !!(process.env.COMMS_V2_DOOR_URL || process.env.DATABASE_URL);

describe.skipIf(!live)('judge against the sandbox door (live)', () => {
    let door: DoorClient;
    beforeAll(async () => { door = await openDoor(); }, 60_000);
    afterAll(async () => { await door?.close(); });

    it('runs the 2.1 scenario through the door and yields one planned send per customer turn', async () => {
        const scenario = loadScenarios().find((s) => s.id.startsWith('2.1-'))!;
        const result = await runScenario(scenario, { door, judge: null, run: 1 });
        expect(result.error).toBeNull();
        const customerTurns = result.turns.filter((t) => t.from === 'customer');
        expect(customerTurns).toHaveLength(scenario.turns.filter((t) => t.from === 'customer').length);
        for (const t of customerTurns) {
            expect(t.error).toBeNull();
            expect(t.plannedSend).not.toBeNull();
            expect(plannedSendSchema.safeParse(t.plannedSend).success).toBe(true);
            expect(t.plannedSend!.caseId).toBeTruthy();
            expect(t.plannedSend!.party.address).toBe('+447700900942');
            expect(t.snapshot).not.toBeNull();
        }
        // Every expectation was judged: pass or fail, never error.
        for (const t of result.turns) for (const e of t.expectations) expect(e.status, `${t.index} ${e.kind}`).not.toBe('error');
    }, 900_000);
});
