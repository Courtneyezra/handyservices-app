/**
 * Who occupies an approver slot. The desk holds a file for a slot (`{ kind: 'human', id: 'ben' }`,
 * server/comms-v2/desk/guards.ts), and Contract 2's release lets only that slot release it. Which
 * signed-in account is that slot is policy, not a convention on the email, so it lives in the
 * app_settings row keyed `comms_v2_approvers`: `{ "<slot>": ["<user id>", ...] }`, user ids from
 * the `users` table. A session maps to a slot only when listed there; unlisted, it has no slot and
 * can neither release a hold nor answer a customer. Fail closed: a row that cannot be read assigns
 * nobody.
 *
 * Set it with the migration runner's SQL path; app_settings.id has no default, so supply one:
 *   insert into app_settings (id, key, value)
 *   values (gen_random_uuid()::text, 'comms_v2_approvers', '{"ben": ["<ben user id>"]}')
 *   on conflict (key) do update set value = excluded.value;
 */
import type { ApproverSlot } from '../desk/case-file';

export const COMMS_V2_APPROVERS_KEY = 'comms_v2_approvers';

/** slot id -> the user ids that occupy it. */
export type ApproverAssignments = Record<string, string[]>;

export type ReadApproverAssignments = () => Promise<ApproverAssignments>;

export function parseApproverAssignments(value: unknown): ApproverAssignments {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    const out: ApproverAssignments = {};
    for (const [slot, ids] of Object.entries(value as Record<string, unknown>)) {
        if (!slot.trim() || !Array.isArray(ids)) continue;
        const clean = ids.filter((id): id is string => typeof id === 'string' && id.trim() !== '').map((id) => id.trim());
        if (clean.length) out[slot.trim()] = clean;
    }
    return out;
}

/** The slot a signed-in user occupies, or null when no slot lists them. */
export function slotOf(user: { id?: string | null } | null | undefined, assignments: ApproverAssignments): ApproverSlot | null {
    const id = (user?.id ?? '').trim();
    if (!id) return null;
    for (const [slot, ids] of Object.entries(assignments)) if (ids.includes(id)) return { kind: 'human', id: slot };
    return null;
}

/**
 * The approver a request on an app-mounted router carries: the slot the signed-in session
 * occupies, or null when no slot lists them. Every route that releases a hold reads the approver
 * through this, never from the request body.
 */
export function sessionApprover(read: ReadApproverAssignments = readApproverAssignments): (req: unknown) => Promise<ApproverSlot | null> {
    return async (req) => slotOf((req as { user?: { id?: string | null } | null } | null)?.user, await read());
}

export function slotAssigned(slot: ApproverSlot, assignments: ApproverAssignments): boolean {
    return slot.kind === 'human' ? (assignments[slot.id]?.length ?? 0) > 0 : true;
}

export async function readApproverAssignments(): Promise<ApproverAssignments> {
    try {
        const { db } = await import('../../db');
        const { appSettings } = await import('@shared/schema');
        const { eq } = await import('drizzle-orm');
        const [row] = await db.select({ value: appSettings.value }).from(appSettings).where(eq(appSettings.key, COMMS_V2_APPROVERS_KEY)).limit(1);
        return parseApproverAssignments(row?.value);
    } catch (error: any) {
        console.error('[CommsV2] Could not read approver assignments, assigning nobody:', error?.message ?? error);
        return {};
    }
}

export type ReadStaffNames = (emails: string[]) => Promise<Record<string, string>>;

/**
 * The staff `users` row's name for each of the given emails, keyed by lowercase email, for the
 * board to label a human turn by name rather than by the raw `human:<login>` approver it is
 * recorded under. Fail closed: a read that throws or a login with no match resolves no name, and
 * the board falls back to the login's own local part rather than nothing.
 */
export async function readStaffNames(emails: string[]): Promise<Record<string, string>> {
    const clean = Array.from(new Set(emails.map((e) => e.trim().toLowerCase()).filter(Boolean)));
    if (!clean.length) return {};
    try {
        const { db } = await import('../../db');
        const { users } = await import('@shared/schema');
        const { inArray, sql } = await import('drizzle-orm');
        const rows = await db.select({ email: users.email, firstName: users.firstName, lastName: users.lastName }).from(users).where(inArray(sql`lower(${users.email})`, clean));
        const out: Record<string, string> = {};
        for (const row of rows) {
            const name = [row.firstName, row.lastName].filter(Boolean).join(' ').trim();
            if (name) out[row.email.toLowerCase()] = name;
        }
        return out;
    } catch (error: any) {
        console.error('[CommsV2] Could not read staff names, falling back to raw approver:', error?.message ?? error);
        return {};
    }
}
