/**
 * Contractor desk writes - adding a contractor, activating one, issuing the login code and the app
 * link. The database side of the write routes in `routes.ts`, behind an interface so the routes are
 * tested without a database.
 *
 * No write here takes a password or a money field, and nothing here returns a stored secret except
 * `ensureAppToken`, whose token is the app link itself.
 */
import { randomBytes } from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { and, eq, inArray, isNull, ne } from 'drizzle-orm';
import { db } from '../db';
import { handymanProfiles, users } from '../../shared/schema';
import { geocodeAddress } from '../lib/geocoding';
import { digitsOf, invalidateRoleCache } from '../roles';
import { placeholderEmail } from './no-email';
import type { DeliveryTier } from './roster';

export interface NewContractor {
  firstName: string;
  lastName: string;
  /** E.164, already validated. */
  phone: string;
  /** Lower-cased, or null for none. */
  email: string | null;
  vertical: 'handyman' | 'cleaning';
  deliveryTier: DeliveryTier;
  deliveryPriority: number | null;
  businessName: string | null;
  postcode: string | null;
  city: string | null;
  /** The admin's user id; an admin adding a contractor activates them. */
  activatedBy: string | null;
}

export interface ContractorAccessState {
  id: string;
  activatedAt: Date | null;
}

export interface ContractorDeskStore {
  find(id: string): Promise<ContractorAccessState | null>;
  /** Which of the new contractor's contact details another user already has. */
  contactInUse(email: string | null, phone: string): Promise<{ email: boolean; phone: boolean }>;
  /** Creates the user and the profile; returns the profile id. */
  create(input: NewContractor): Promise<string>;
  /** Sets or clears the activation. Returns false when there is no such contractor. */
  setActivation(id: string, activation: { at: Date; by: string | null } | null): Promise<boolean>;
  /** True when any contractor other than `exceptId` holds one of these stored values. */
  accessCodeInUse(storedValues: string[], exceptId: string): Promise<boolean>;
  /** Stores the hashed code. Throws when the unique index refuses it. */
  setAccessCode(id: string, stored: string): Promise<void>;
  /** The contractor's app token, minted if they have none. */
  ensureAppToken(id: string): Promise<string>;
}

export const dbContractorDeskStore: ContractorDeskStore = {
  async find(id) {
    const rows = await db
      .select({ id: handymanProfiles.id, activatedAt: handymanProfiles.activatedAt })
      .from(handymanProfiles)
      .where(eq(handymanProfiles.id, id))
      .limit(1);
    return rows[0] ?? null;
  },

  async contactInUse(email, phone) {
    const emailRows = email
      ? await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1)
      : [];
    // Stored phones come in every format, so compare digits; contractors are a short list.
    const phoneRows = await db.select({ phone: users.phone }).from(users).where(eq(users.role, 'contractor'));
    const wanted = digitsOf(phone);
    return {
      email: emailRows.length > 0,
      phone: phoneRows.some((r) => sameNumber(digitsOf(r.phone), wanted)),
    };
  },

  async create(input) {
    const userId = uuidv4();
    const profileId = uuidv4();
    const slugBase = `${input.firstName}-${input.lastName}`.toLowerCase().replace(/[^a-z0-9-]/g, '-');

    let latitude: string | null = null;
    let longitude: string | null = null;
    if (input.postcode) {
      try {
        const geo = await geocodeAddress(input.postcode);
        if (geo) { latitude = geo.lat.toString(); longitude = geo.lng.toString(); }
      } catch (err) {
        console.warn('[ContractorDesk] geocode failed on add; the contractor is added without coordinates:', err);
      }
    }

    await db.insert(users).values({
      id: userId,
      email: input.email ?? placeholderEmail(profileId),
      firstName: input.firstName,
      lastName: input.lastName,
      phone: input.phone,
      password: null,
      role: 'contractor',
      isActive: true,
    });
    try {
      await db.insert(handymanProfiles).values({
        id: profileId,
        userId,
        businessName: input.businessName,
        postcode: input.postcode,
        city: input.city,
        latitude,
        longitude,
        slug: `${slugBase}-${uuidv4().slice(0, 6)}`,
        publicProfileEnabled: true,
        availabilityStatus: 'available',
        verificationStatus: 'unverified',
        deliveryTier: input.deliveryTier,
        vertical: input.vertical,
        deliveryPriority: input.deliveryPriority,
        activatedAt: new Date(),
        activatedBy: input.activatedBy,
      });
    } catch (err) {
      // No transactions on this driver: take the user back out so a retry is not refused as a duplicate.
      await db.delete(users).where(eq(users.id, userId));
      throw err;
    }

    // A contractor's phone moves their inbound WhatsApp into the contractor lane (server/roles.ts).
    invalidateRoleCache();
    return profileId;
  },

  async setActivation(id, activation) {
    const rows = await db
      .update(handymanProfiles)
      .set({ activatedAt: activation?.at ?? null, activatedBy: activation?.by ?? null, updatedAt: new Date() })
      .where(eq(handymanProfiles.id, id))
      .returning({ id: handymanProfiles.id });
    return rows.length > 0;
  },

  async accessCodeInUse(storedValues, exceptId) {
    if (storedValues.length === 0) return false;
    const rows = await db
      .select({ id: handymanProfiles.id })
      .from(handymanProfiles)
      .where(and(inArray(handymanProfiles.accessCode, storedValues), ne(handymanProfiles.id, exceptId)))
      .limit(1);
    return rows.length > 0;
  },

  async setAccessCode(id, stored) {
    await db
      .update(handymanProfiles)
      .set({ accessCode: stored, updatedAt: new Date() })
      .where(eq(handymanProfiles.id, id));
  },

  async ensureAppToken(id) {
    const rows = await db
      .select({ appToken: handymanProfiles.appToken })
      .from(handymanProfiles)
      .where(eq(handymanProfiles.id, id))
      .limit(1);
    if (rows[0]?.appToken) return rows[0].appToken;
    const token = randomBytes(24).toString('base64url');
    // Only where there is still none, so two admins issuing at once end with one link.
    await db
      .update(handymanProfiles)
      .set({ appToken: token, updatedAt: new Date() })
      .where(and(eq(handymanProfiles.id, id), isNull(handymanProfiles.appToken)));
    const after = await db
      .select({ appToken: handymanProfiles.appToken })
      .from(handymanProfiles)
      .where(eq(handymanProfiles.id, id))
      .limit(1);
    if (!after[0]?.appToken) throw new Error('App token was not stored');
    return after[0].appToken;
  },
};

/** Same number whether stored with the country code or the trunk zero. */
function sameNumber(a: string, b: string): boolean {
  if (!a || !b) return false;
  const national = (d: string) => (d.startsWith('44') ? d.slice(2) : d.startsWith('0') ? d.slice(1) : d);
  return national(a) === national(b);
}
