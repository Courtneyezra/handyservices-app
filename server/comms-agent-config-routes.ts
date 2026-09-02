/**
 * POST /api/comms-agent/config — the two legacy comms-agent flags a person may flip from
 * /admin/staff (P6 close-out / A2): `autosend.enabled` and `onInbound`. Mounted behind
 * requireAdmin in server/index.ts.
 *
 *   autosend    OWNER-ONLY (the owner account or role admin, never va). Turning it ON needs
 *               `confirm: 'LIVE'`: it is the switch that let the legacy agent send unguarded on
 *               2 Sep 2026, and CUTOVER says keep it OFF.
 *   onInbound   any admin, including the VA: one brain per thread once the spine is live.
 *
 * setCommsAgentConfig writes the row and logs the config_change event with `by`.
 */
import { Router } from 'express';
import { validateCommsConfigPatch, isOwner } from './spine/controls';

export const commsAgentConfigRouter = Router();

function sessionUser(req: any): { id?: string | null; email?: string | null; role?: string | null } {
    const u = req?.user ?? {};
    return { id: u.id ?? null, email: u.email ?? null, role: u.role ?? null };
}

commsAgentConfigRouter.post('/config', async (req, res) => {
    try {
        const v = validateCommsConfigPatch(req.body ?? {});
        if (!v.ok) return res.status(400).json({ ok: false, errors: v.errors });
        const u = sessionUser(req);
        if (v.needs === 'owner' && !isOwner(u)) return res.status(403).json({ ok: false, errors: ['Legacy autosend is owner-only (the owner account or role admin).'] });
        const { setCommsAgentConfig } = await import('./agents/comms');
        const { humanApprover } = await import('./approver');
        const next = await setCommsAgentConfig(v.patch as any, humanApprover(u.email ?? u.id ?? 'admin'));
        console.log(`[CommsConfig] ${v.changes.join(', ')} by ${u.email ?? u.id ?? 'admin'}`);
        res.json({ ok: true, changes: v.changes, legacy: { enabled: next.enabled, onInbound: next.onInbound, autosend: next.autosend.enabled, firstContactAck: next.firstContactAutoAck.enabled, quotePrep: next.quotePrep.enabled } });
    } catch (error: any) {
        console.error('[CommsConfig] write failed:', error?.message ?? error);
        res.status(500).json({ ok: false, errors: [error?.message ?? 'Could not save the config'] });
    }
});
