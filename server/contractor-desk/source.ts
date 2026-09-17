/**
 * Contractor desk roster - the database read behind `roster.ts`.
 *
 * Every select names its columns. The access code and the app token are read only as
 * `is not null` booleans, so their values never leave the database; the password hash, the widget
 * token and the calendar sync token are not selected at all. No money column is selected.
 */
import { and, eq, gte, inArray, or, sql } from 'drizzle-orm';
import { db } from '../db';
import { contractorBookingRequests, handymanProfiles, handymanSkills, personalizedQuotes, users } from '../../shared/schema';
import { addDaysStr, ukDayStartUTC } from '../../shared/uk-time';
import type { RosterBookingRow, RosterProfileRow, RosterSkillRow } from './roster';

/** How far back a booking may start and still cover a day in this week (multi-day spans). */
const SPAN_REACH_BACK_DAYS = 14;

export interface RosterData {
  profiles: RosterProfileRow[];
  bookings: RosterBookingRow[];
  skills: RosterSkillRow[];
}

export interface RosterSource {
  /** `ids` null loads every contractor; `from` is the earliest day ('YYYY-MM-DD') the caller needs. */
  load(ids: string[] | null, from: string): Promise<RosterData>;
}

export const ROSTER_PROFILE_COLUMNS = {
  id: handymanProfiles.id,
  userId: handymanProfiles.userId,
  firstName: users.firstName,
  lastName: users.lastName,
  email: users.email,
  phone: users.phone,
  accountActive: users.isActive,
  businessName: handymanProfiles.businessName,
  bio: handymanProfiles.bio,
  city: handymanProfiles.city,
  postcode: handymanProfiles.postcode,
  radiusMiles: handymanProfiles.radiusMiles,
  slug: handymanProfiles.slug,
  profileImageUrl: handymanProfiles.profileImageUrl,
  heroImageUrl: handymanProfiles.heroImageUrl,
  publicProfileEnabled: handymanProfiles.publicProfileEnabled,
  availabilityStatus: handymanProfiles.availabilityStatus,
  lastAvailabilityRefresh: handymanProfiles.lastAvailabilityRefresh,
  deliveryTier: handymanProfiles.deliveryTier,
  vertical: handymanProfiles.vertical,
  deliveryPriority: handymanProfiles.deliveryPriority,
  vehicleType: handymanProfiles.vehicleType,
  verificationStatus: handymanProfiles.verificationStatus,
  publicLiabilityInsuranceUrl: handymanProfiles.publicLiabilityInsuranceUrl,
  publicLiabilityExpiryDate: handymanProfiles.publicLiabilityExpiryDate,
  dbsCertificateUrl: handymanProfiles.dbsCertificateUrl,
  identityDocumentUrl: handymanProfiles.identityDocumentUrl,
  partnerStatus: handymanProfiles.partnerStatus,
  partnerActivatedAt: handymanProfiles.partnerActivatedAt,
  hasAccessCode: sql<boolean>`(${handymanProfiles.accessCode} is not null and ${handymanProfiles.accessCode} <> '')`,
  hasAppLink: sql<boolean>`(${handymanProfiles.appToken} is not null and ${handymanProfiles.appToken} <> '')`,
  createdAt: handymanProfiles.createdAt,
};

export const dbRosterSource: RosterSource = {
  async load(ids, from) {
    if (ids && ids.length === 0) return { profiles: [], bookings: [], skills: [] };

    const profiles = await db
      .select(ROSTER_PROFILE_COLUMNS)
      .from(handymanProfiles)
      .innerJoin(users, eq(handymanProfiles.userId, users.id))
      .where(ids ? inArray(handymanProfiles.id, ids) : undefined);
    const profileIds = profiles.map((p) => p.id);
    if (profileIds.length === 0) return { profiles: [], bookings: [], skills: [] };

    const earliest = ukDayStartUTC(addDaysStr(from, -SPAN_REACH_BACK_DAYS));
    const [bookings, skills] = await Promise.all([
      db
        .select({
          id: contractorBookingRequests.id,
          quoteId: contractorBookingRequests.quoteId,
          contractorId: contractorBookingRequests.contractorId,
          assignedContractorId: contractorBookingRequests.assignedContractorId,
          status: contractorBookingRequests.status,
          assignmentStatus: contractorBookingRequests.assignmentStatus,
          scheduledDate: contractorBookingRequests.scheduledDate,
          scheduledDates: contractorBookingRequests.scheduledDates,
          durationDays: contractorBookingRequests.durationDays,
          slot: contractorBookingRequests.scheduledSlot,
          customerName: contractorBookingRequests.customerName,
          description: sql<string | null>`coalesce(${contractorBookingRequests.description}, ${personalizedQuotes.jobDescription})`,
          postcode: personalizedQuotes.postcode,
        })
        .from(contractorBookingRequests)
        .leftJoin(personalizedQuotes, eq(contractorBookingRequests.quoteId, personalizedQuotes.id))
        .where(and(
          gte(contractorBookingRequests.scheduledDate, earliest),
          or(
            inArray(contractorBookingRequests.contractorId, profileIds),
            inArray(contractorBookingRequests.assignedContractorId, profileIds),
          ),
        )),
      db
        .select({ handymanId: handymanSkills.handymanId, categorySlug: handymanSkills.categorySlug })
        .from(handymanSkills)
        .where(inArray(handymanSkills.handymanId, profileIds)),
    ]);

    return { profiles, bookings, skills };
  },
};
