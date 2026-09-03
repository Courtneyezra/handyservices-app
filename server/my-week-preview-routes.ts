/**
 * P13c: the owner's preview of a contractor's My Week (docs/comms-build/BRIEF-P13c-my-week-pack.md).
 *
 *   GET /api/admin/my-week-preview/:contractorId   (requireAdmin)
 *     → { contractorId, name, token, url }
 *
 * The tokenised app is the schedule contractors actually use, and the token IS the credential.
 * The preview hands an admin that contractor's existing app token so the client can mount the
 * very same page (`/my-week/:token` data, including the job pack) in read-only mode at
 * `/admin/my-week-preview/:contractorId`. A contractor with no app link yet gets one minted here,
 * the same once-only mint the code login does; nothing else is written and no contractor action
 * is reachable from the preview (the page refuses every POST when `readOnly`).
 */
import { Router, Request, Response } from 'express';
import { eq } from 'drizzle-orm';
import { randomBytes } from 'crypto';
import { db } from './db';
import { handymanProfiles, users } from '../shared/schema';
import { requireAdmin } from './auth';

const router = Router();

router.get('/:contractorId', requireAdmin, async (req: Request, res: Response) => {
  try {
    const id = String(req.params.contractorId ?? '').trim();
    if (!id) return res.status(400).json({ error: 'contractorId required' });
    const [row] = await db
      .select({ id: handymanProfiles.id, appToken: handymanProfiles.appToken, businessName: handymanProfiles.businessName, firstName: users.firstName, lastName: users.lastName })
      .from(handymanProfiles).leftJoin(users, eq(handymanProfiles.userId, users.id))
      .where(eq(handymanProfiles.id, id)).limit(1);
    if (!row) return res.status(404).json({ error: 'Contractor not found' });
    let token = row.appToken;
    if (!token) {
      token = randomBytes(24).toString('base64url');
      await db.update(handymanProfiles).set({ appToken: token, updatedAt: new Date() }).where(eq(handymanProfiles.id, id));
    }
    const name = [row.firstName, row.lastName].filter(Boolean).join(' ') || row.businessName || 'Contractor';
    return res.json({ contractorId: id, name, token, url: `/my-week/${token}` });
  } catch (err) {
    console.error('[MyWeekPreview] failed:', err instanceof Error ? err.message : err);
    return res.status(500).json({ error: 'Failed to open the preview' });
  }
});

export default router;
