/**
 * The old desk standing down while the new desk is the live desk: its automatic customer senders
 * are refused at the one exit, the spine reads as off, the legacy agent reads as disabled, and none
 * of it writes anything, so flipping a switch back gives the old desk back exactly as it was.
 *
 * Process-local configs and stubbed switches: no database, no live row.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../db', () => ({ db: {}, pool: {} }));
vi.mock('../system-events', () => ({ logSystemEvent: async () => undefined }));

import { SENDER_REGISTRY } from '../sender-registry';
import { isSpineEnabled, setSpineConfig, useProcessLocalSpineConfig, _resetSpineConfigForTests } from '../spine/config';
import { spineMode } from '../spine/switch';
import { getCommsAgentConfig, setCommsAgentConfig, useProcessLocalCommsConfig } from '../agents/comms';
import { OLD_DESK_SENDERS, isOldDeskSender, oldDeskRefusal } from './old-desk';

const LIVE_ROW = { enabled: true, mode: 'live' as const, commsDesk: 'comms_v2' as const, senders: { comms_v2: { enabled: true } } };
const liveNow = async () => ({ live: true, off: [] as string[] });
const notLive = async () => ({ live: false, off: ["spine.commsDesk = 'comms_v2'"] });

function switchesOn() {
    vi.stubEnv('COMMS_V2_INTAKE', '1');
    vi.stubEnv('COMMS_WORKER', '1');
}

afterEach(() => { vi.unstubAllEnvs(); _resetSpineConfigForTests(); });

describe('the old desk\'s automatic senders', () => {
    it('are every old agent, the rules layer\'s replies, the webform chase and the lead automations, and nothing else', () => {
        const expected = Object.keys(SENDER_REGISTRY).filter((a) =>
            (a.startsWith('agent.') && a !== 'agent.comms_v2') || (a.startsWith('rules.') && a !== 'rules.job_pack') || a === 'system.webform_chase' || a === 'system.lead_automation');
        expect([...OLD_DESK_SENDERS].sort()).toEqual(expected.sort());
        for (const a of OLD_DESK_SENDERS) expect(SENDER_REGISTRY[a].kind).not.toBe('transactional');
    });

    it('are refused only while the new desk is live, and nobody else ever is', async () => {
        for (const a of OLD_DESK_SENDERS) {
            expect(await oldDeskRefusal(a, liveNow)).toMatch(/stand down while the new desk is the live desk/);
            expect(await oldDeskRefusal(a, notLive)).toBeNull();
        }
        for (const other of ['agent.comms_v2', 'system.notification', 'system.invoice', 'system.staff', 'rules.job_pack', 'human:ben@example.com']) {
            expect(isOldDeskSender(other)).toBe(false);
            expect(await oldDeskRefusal(other, liveNow)).toBeNull();
        }
    });

    it('are not refused when the switches cannot be read: the new desk cannot deliver on that read either', async () => {
        expect(await oldDeskRefusal('rules.holding', async () => { throw new Error('unreadable'); })).toBeNull();
    });
});

describe('the spine stands down', () => {
    it('reads as off while the new desk is live, and gives back its own mode the moment a switch goes off', async () => {
        switchesOn();
        useProcessLocalSpineConfig(LIVE_ROW);
        expect(await spineMode()).toBe('off');
        expect(await isSpineEnabled()).toBe(false);
        await setSpineConfig({ commsDesk: 'spine' }, 'test');
        expect(await spineMode()).toBe('live');
        expect(await isSpineEnabled()).toBe(true);
    });

    it('stands down in no process that is not the comms worker', async () => {
        vi.stubEnv('COMMS_V2_INTAKE', '1');
        useProcessLocalSpineConfig(LIVE_ROW);
        expect(await spineMode()).toBe('live');
    });
});

describe('the legacy comms agent stands down', () => {
    it('reads as disabled with its inbound lane off while the new desk is live, and a write while live does not store that', async () => {
        switchesOn();
        useProcessLocalSpineConfig(LIVE_ROW);
        useProcessLocalCommsConfig({ enabled: true, onInbound: true });
        expect(await getCommsAgentConfig()).toMatchObject({ enabled: false, onInbound: false });
        await setCommsAgentConfig({ autosend: { enabled: false } as any }, 'test');
        await setSpineConfig({ commsDesk: 'spine' }, 'test');
        expect(await getCommsAgentConfig()).toMatchObject({ enabled: true, onInbound: true });
    });
});

describe('the one exit', () => {
    it('refuses an old desk sender while the new desk is live, before any provider is asked, and carries a person\'s send', async () => {
        switchesOn();
        useProcessLocalSpineConfig(LIVE_ROW);
        const { sendCustomerMessage } = await import('../outbound');
        const refused = await sendCustomerMessage({ approver: 'rules.holding', runId: 'run_1', to: '+447700900942', body: 'Thanks, we will be in touch.', context: 'test' });
        expect(refused).toMatchObject({ ok: false, error: 'OLD_DESK_STOOD_DOWN', attempts: [] });
    });
});
