/**
 * Contractor desk roster - pure shaping (DB-free, unit-tested).
 *
 * Turns the rows `source.ts` loads into the list and detail shapes Ben's Contractors page reads.
 * Every output field is named here, one by one: nothing is spread from a row, so a column added to
 * `handyman_profiles` or `users` later never reaches the page by accident. The login secrets (the
 * password hash, the widget token, the app token, the access code, the calendar sync token) are
 * never output; the page gets `hasAccessCode` and `hasAppLink` instead. No money field is output.
 */
import { expandSpanDates } from '../../shared/schedule-composition';
import { addDaysStr } from '../../shared/uk-time';

export type DeliveryTier = 'partner' | 'core' | 'adhoc';
const TIER_ORDER: DeliveryTier[] = ['partner', 'core', 'adhoc'];

/** One contractor as `source.ts` loads it: profile and user columns, flattened. */
export interface RosterProfileRow {
  id: string;
  userId: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  phone: string | null;
  accountActive: boolean | null;
  businessName: string | null;
  bio: string | null;
  city: string | null;
  postcode: string | null;
  radiusMiles: number | null;
  slug: string | null;
  profileImageUrl: string | null;
  heroImageUrl: string | null;
  publicProfileEnabled: boolean | null;
  availabilityStatus: string | null;
  lastAvailabilityRefresh: Date | null;
  deliveryTier: string | null;
  vertical: string | null;
  deliveryPriority: number | null;
  vehicleType: string | null;
  verificationStatus: string | null;
  publicLiabilityInsuranceUrl: string | null;
  publicLiabilityExpiryDate: Date | null;
  dbsCertificateUrl: string | null;
  identityDocumentUrl: string | null;
  partnerStatus: string | null;
  partnerActivatedAt: Date | null;
  /** True when an access code is stored; the code itself is never loaded. */
  hasAccessCode: boolean;
  /** True when an app token is stored; the token itself is never loaded. */
  hasAppLink: boolean;
  createdAt: Date | null;
}

/** A booking touching a contractor, with only the fields the roster needs. */
export interface RosterBookingRow {
  id: string;
  quoteId: string | null;
  contractorId: string;
  assignedContractorId: string | null;
  status: string | null;
  assignmentStatus: string | null;
  scheduledDate: Date | string | null;
  scheduledDates: unknown;
  durationDays: number | null;
  slot: string | null;
  customerName: string | null;
  description: string | null;
  postcode: string | null;
}

export interface RosterSkillRow {
  handymanId: string;
  categorySlug: string | null;
}

export interface NextJob {
  bookingId: string;
  quoteId: string | null;
  /** The first day of the job that is today or later (UK 'YYYY-MM-DD'). */
  date: string;
  slot: string;
  durationDays: number;
  customerName: string | null;
  postcode: string | null;
  description: string | null;
}

export interface RosterContractor {
  id: string;
  userId: string;
  name: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  phone: string | null;
  businessName: string | null;
  imageUrl: string | null;
  city: string | null;
  postcode: string | null;
  tier: DeliveryTier;
  vertical: string;
  priority: number | null;
  activation: {
    accountActive: boolean;
    availabilityStatus: string | null;
    partnerStatus: string | null;
    partnerActivatedAt: string | null;
  };
  verification: {
    status: string;
    insurance: { present: boolean; expiresAt: string | null };
    dbs: { present: boolean };
    identity: { present: boolean };
  };
  hasAccessCode: boolean;
  hasAppLink: boolean;
  weekStart: string;
  bookedDaysThisWeek: number;
  nextJob: NextJob | null;
  skillsCount: number;
  createdAt: string | null;
}

export interface RosterContractorDetail extends RosterContractor {
  bio: string | null;
  radiusMiles: number | null;
  slug: string | null;
  heroImageUrl: string | null;
  profileImageUrl: string | null;
  publicProfileEnabled: boolean;
  vehicleType: string | null;
  lastAvailabilityRefresh: string | null;
  bookedDatesThisWeek: string[];
}

const BOOKED_STATUSES = new Set(['accepted', 'completed']);
const BOOKED_ASSIGNMENT = new Set(['accepted', 'in_progress', 'completed']);

const iso = (d: Date | null | undefined): string | null => (d ? new Date(d).toISOString() : null);
const present = (v: string | null | undefined): boolean => typeof v === 'string' && v.trim() !== '';

export function asTier(t: string | null | undefined): DeliveryTier {
  return t === 'partner' || t === 'core' ? t : 'adhoc';
}

/** A booking is the contractor's job when it is booked and assigned to them (or theirs unassigned). */
export function isBookedTo(b: RosterBookingRow, contractorId: string): boolean {
  const booked = (b.status != null && BOOKED_STATUSES.has(b.status))
    || (b.assignmentStatus != null && BOOKED_ASSIGNMENT.has(b.assignmentStatus));
  return booked && b.scheduledDate != null && (b.assignedContractorId ?? b.contractorId) === contractorId;
}

function spanDates(b: RosterBookingRow): string[] {
  return expandSpanDates(b.scheduledDate as Date | string, b.durationDays, b.scheduledDates);
}

/** The distinct days in the week starting `weekStart` that the contractor has a booked job on. */
export function bookedDatesInWeek(bookings: RosterBookingRow[], contractorId: string, weekStart: string): string[] {
  const weekEnd = addDaysStr(weekStart, 7);
  const days = new Set<string>();
  for (const b of bookings) {
    if (!isBookedTo(b, contractorId)) continue;
    for (const d of spanDates(b)) if (d >= weekStart && d < weekEnd) days.add(d);
  }
  return Array.from(days).sort();
}

/** The contractor's earliest booked job with a day on or after `today`; the job is never completed. */
export function nextBookedJob(bookings: RosterBookingRow[], contractorId: string, today: string): NextJob | null {
  let best: { job: NextJob; slotRank: number } | null = null;
  for (const b of bookings) {
    if (!isBookedTo(b, contractorId)) continue;
    if (b.status === 'completed' || b.assignmentStatus === 'completed') continue;
    const date = spanDates(b).find((d) => d >= today);
    if (!date) continue;
    const durationDays = Math.max(1, b.durationDays ?? 1);
    const slot = durationDays > 1 ? 'full_day' : (b.slot ?? 'full_day');
    const slotRank = slot === 'am' ? 0 : slot === 'pm' ? 2 : 1;
    if (best && (best.job.date < date || (best.job.date === date && best.slotRank <= slotRank))) continue;
    best = {
      slotRank,
      job: {
        bookingId: b.id,
        quoteId: b.quoteId,
        date,
        slot,
        durationDays,
        customerName: b.customerName,
        postcode: b.postcode,
        description: b.description,
      },
    };
  }
  return best?.job ?? null;
}

export function skillsCount(skills: RosterSkillRow[], contractorId: string): number {
  return new Set(skills.filter((s) => s.handymanId === contractorId && s.categorySlug).map((s) => s.categorySlug)).size;
}

export interface RosterContext {
  bookings: RosterBookingRow[];
  skills: RosterSkillRow[];
  today: string;
  weekStart: string;
}

export function shapeContractor(p: RosterProfileRow, ctx: RosterContext): RosterContractor {
  const name = [p.firstName, p.lastName].filter(Boolean).join(' ') || p.businessName || 'Unknown';
  return {
    id: p.id,
    userId: p.userId,
    name,
    firstName: p.firstName,
    lastName: p.lastName,
    email: p.email,
    phone: p.phone,
    businessName: p.businessName,
    imageUrl: p.profileImageUrl ?? p.heroImageUrl ?? null,
    city: p.city,
    postcode: p.postcode,
    tier: asTier(p.deliveryTier),
    vertical: p.vertical ?? 'handyman',
    priority: p.deliveryPriority,
    activation: {
      accountActive: p.accountActive !== false,
      availabilityStatus: p.availabilityStatus,
      partnerStatus: p.partnerStatus,
      partnerActivatedAt: iso(p.partnerActivatedAt),
    },
    verification: {
      status: p.verificationStatus ?? 'unverified',
      insurance: { present: present(p.publicLiabilityInsuranceUrl), expiresAt: iso(p.publicLiabilityExpiryDate) },
      dbs: { present: present(p.dbsCertificateUrl) },
      identity: { present: present(p.identityDocumentUrl) },
    },
    hasAccessCode: p.hasAccessCode === true,
    hasAppLink: p.hasAppLink === true,
    weekStart: ctx.weekStart,
    bookedDaysThisWeek: bookedDatesInWeek(ctx.bookings, p.id, ctx.weekStart).length,
    nextJob: nextBookedJob(ctx.bookings, p.id, ctx.today),
    skillsCount: skillsCount(ctx.skills, p.id),
    createdAt: iso(p.createdAt),
  };
}

export function shapeContractorDetail(p: RosterProfileRow, ctx: RosterContext): RosterContractorDetail {
  return {
    ...shapeContractor(p, ctx),
    bio: p.bio,
    radiusMiles: p.radiusMiles,
    slug: p.slug,
    heroImageUrl: p.heroImageUrl,
    profileImageUrl: p.profileImageUrl,
    publicProfileEnabled: p.publicProfileEnabled === true,
    vehicleType: p.vehicleType,
    lastAvailabilityRefresh: iso(p.lastAvailabilityRefresh),
    bookedDatesThisWeek: bookedDatesInWeek(ctx.bookings, p.id, ctx.weekStart),
  };
}

/** Partner, core, then ad-hoc; within a tier by priority (unranked last), then name. */
export function sortRoster<T extends RosterContractor>(rows: T[]): T[] {
  return [...rows].sort((a, b) => {
    const t = TIER_ORDER.indexOf(a.tier) - TIER_ORDER.indexOf(b.tier);
    if (t !== 0) return t;
    const ap = a.priority ?? Number.POSITIVE_INFINITY;
    const bp = b.priority ?? Number.POSITIVE_INFINITY;
    if (ap !== bp) return ap - bp;
    return a.name.localeCompare(b.name);
  });
}
