/**
 * The scheduling fixture for the desk's sandbox door (Goal 5): seeds completed bookings and one
 * booked job on the sandbox number so the pipeline's test step can drive lead time, the picker
 * pointer and the booked-date confirmation live. Synthetic rows only, every one marked and on the
 * drama number and hung on a synthetic contractor of its own, so nothing here can be a real customer
 * or a real contractor's diary; `reset` deletes exactly those rows, the contractor included.
 *
 * The live writer opens the database on first use through server/db.ts, which reads DATABASE_URL:
 * the door host puts the branch string there and refuses production (door-host.ts), and every
 * write refuses through the same branch check the diary reads through (diary.ts branchInUse), so
 * the writer and the reader can never disagree about which database that is. A memory writer
 * stands in for tests.
 */
import { randomUUID } from 'node:crypto';
import { branchInUse, MemoryDiary, type DiaryBooking, type DiaryQuote } from './diary';

/** The drama number the sandbox door types on (desk/sandbox-door.ts SANDBOX_PHONE_E164). */
export const FIXTURE_PHONE_E164 = '+447700900942';
export const FIXTURE_MARK = 'SANDBOX comms-v2 scheduling fixture (synthetic, not a customer)';
export const FIXTURE_CONTRACTOR_EMAIL = 'sandbox-contractor@comms-v2.invalid';
export const FIXTURE_MAX_COMPLETED = 60;
/** The booked job sits this many days out, so a confirmation always reads as a future date. */
export const FIXTURE_BOOKED_DAYS_AHEAD = 14;

export interface FixtureInput {
    /** How many completed bookings to seed (0 to FIXTURE_MAX_COMPLETED). */
    completed: number;
    /** Seed a sent quote on the sandbox number. */
    quote: boolean;
    /** Seed one booked job from that quote (implies quote). */
    booked: boolean;
}

export interface FixtureResult {
    completedSeeded: number;
    quoteRef: string | null;
    quoteSlug: string | null;
    bookingRef: string | null;
    /** ISO date of the booked job, YYYY-MM-DD. */
    bookedDate: string | null;
}

export interface FixtureWriter {
    seed(input: FixtureInput, now: Date): Promise<FixtureResult>;
    /** Deletes every row this fixture wrote. */
    reset(): Promise<{ bookings: number; quotes: number }>;
}

export function validateFixtureInput(raw: unknown): { ok: true; input: FixtureInput } | { ok: false; error: string } {
    const b = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
    const completed = b.completed === undefined ? 0 : Number(b.completed);
    if (!Number.isInteger(completed) || completed < 0 || completed > FIXTURE_MAX_COMPLETED) return { ok: false, error: `completed must be a whole number between 0 and ${FIXTURE_MAX_COMPLETED}` };
    const booked = b.booked === true;
    const quote = booked || b.quote === true;
    return { ok: true, input: { completed, quote, booked } };
}

const DAY_MS = 86_400_000;
const isoDay = (d: Date) => d.toISOString().slice(0, 10);

/** The rows a seed produces, pure, so the memory and live writers agree to the row. */
export function planFixture(input: FixtureInput, now: Date, newId: (prefix: string) => string = (p) => `${p}_${randomUUID()}`): { bookings: DiaryBooking[]; quote: DiaryQuote | null; leads: number[] } {
    const bookings: DiaryBooking[] = [];
    const leads: number[] = [];
    for (let k = 0; k < input.completed; k++) {
        // Lead times of 2 to 5 days, completed over the last few weeks: a diary a small business would have.
        const lead = 2 + (k % 4);
        const visit = new Date(now.getTime() - (3 + k * 2) * DAY_MS);
        const made = new Date(visit.getTime() - lead * DAY_MS);
        leads.push(lead);
        bookings.push({ id: newId('sbxbk'), quoteRef: null, scheduledDate: isoDay(visit), scheduledDays: [isoDay(visit)], durationDays: 1, status: 'completed', dayOfStatus: 'completed', createdAt: made.toISOString(), completedAt: new Date(visit.getTime() + 15 * 3_600_000).toISOString() });
    }
    let quote: DiaryQuote | null = null;
    if (input.quote) {
        quote = { id: newId('sbxq'), slug: `sb${randomUUID().replace(/[^a-z]/gi, '').slice(0, 6).toLowerCase() || 'xqzwvy'}`, isDraft: false, supersededAt: null, revokedAt: null, expiresAt: new Date(now.getTime() + 7 * DAY_MS).toISOString() };
        if (input.booked) {
            const visit = new Date(now.getTime() + FIXTURE_BOOKED_DAYS_AHEAD * DAY_MS);
            bookings.push({ id: newId('sbxbk'), quoteRef: quote.id, scheduledDate: isoDay(visit), scheduledDays: [isoDay(visit)], durationDays: 1, status: 'accepted', dayOfStatus: 'scheduled', createdAt: now.toISOString(), completedAt: null });
        }
    }
    return { bookings, quote, leads };
}

function resultOf(plan: ReturnType<typeof planFixture>, input: FixtureInput): FixtureResult {
    const booked = plan.bookings.find((b) => b.status === 'accepted') ?? null;
    return { completedSeeded: input.completed, quoteRef: plan.quote?.id ?? null, quoteSlug: plan.quote?.slug ?? null, bookingRef: booked?.id ?? null, bookedDate: booked?.scheduledDate ?? null };
}

/** Writes into a MemoryDiary, for the door's tests. */
export class MemoryFixture implements FixtureWriter {
    constructor(readonly diary: MemoryDiary) {}
    async seed(input: FixtureInput, now: Date): Promise<FixtureResult> {
        const plan = planFixture(input, now);
        this.diary.bookings.push(...plan.bookings);
        if (plan.quote) this.diary.quotes.push(plan.quote);
        return resultOf(plan, input);
    }
    async reset(): Promise<{ bookings: number; quotes: number }> {
        const bookings = this.diary.bookings.length;
        const quotes = this.diary.quotes.length;
        this.diary.bookings.length = 0;
        this.diary.quotes.length = 0;
        return { bookings, quotes };
    }
}

/** The branch database. Refuses production by name before any write. */
export const liveFixture: FixtureWriter = {
    async seed(input, now) {
        branchInUse();
        const { db } = await import('../../db');
        const { contractorBookingRequests, handymanProfiles, personalizedQuotes, users } = await import('../../../shared/schema');
        const { eq } = await import('drizzle-orm');
        const plan = planFixture(input, now);
        // The contractor the bookings hang on is the fixture's own, never a real one on the branch.
        const [user] = await db.select({ id: users.id }).from(users).where(eq(users.email, FIXTURE_CONTRACTOR_EMAIL)).limit(1);
        const userId = user?.id ?? `sbxu_${randomUUID()}`;
        if (!user) await db.insert(users).values({ id: userId, email: FIXTURE_CONTRACTOR_EMAIL, firstName: 'Sandbox', lastName: 'Contractor', role: 'contractor', isActive: false } as any);
        let [profile] = await db.select({ id: handymanProfiles.id }).from(handymanProfiles).where(eq(handymanProfiles.userId, userId)).limit(1);
        if (!profile) {
            const profileId = `sbxhp_${randomUUID()}`;
            await db.insert(handymanProfiles).values({ id: profileId, userId, businessName: FIXTURE_MARK } as any);
            profile = { id: profileId };
        }
        if (plan.quote) {
            await db.insert(personalizedQuotes).values({
                id: plan.quote.id, shortSlug: plan.quote.slug, customerName: 'Sandbox Customer', phone: FIXTURE_PHONE_E164,
                jobDescription: `${FIXTURE_MARK}: one job`, basePrice: 12000, pricingLineItems: [{ description: 'Sandbox job', pricePence: 12000, sandbox: true }],
                expiresAt: new Date(plan.quote.expiresAt!), isDraft: false, createdAt: now,
            } as any);
        }
        for (const b of plan.bookings) {
            const scheduled = new Date(`${b.scheduledDate}T09:00:00.000Z`);
            await db.insert(contractorBookingRequests).values({
                id: b.id, contractorId: profile.id, assignedContractorId: profile.id, customerName: 'Sandbox Customer', customerPhone: FIXTURE_PHONE_E164,
                quoteId: b.quoteRef, requestedDate: scheduled, requestedSlot: '09:00 - 12:00', description: FIXTURE_MARK,
                status: b.status, assignmentStatus: b.status, scheduledDate: scheduled, scheduledSlot: 'am', durationDays: 1, scheduledDates: b.scheduledDays,
                dayOfStatus: b.dayOfStatus, assignedAt: new Date(b.createdAt!), acceptedAt: new Date(b.createdAt!), completedAt: b.completedAt ? new Date(b.completedAt) : null,
                createdAt: new Date(b.createdAt!), updatedAt: now,
            } as any);
        }
        return resultOf(plan, input);
    },
    async reset() {
        branchInUse();
        const { db } = await import('../../db');
        const { contractorBookingRequests, handymanProfiles, personalizedQuotes, users } = await import('../../../shared/schema');
        const { and, eq, like } = await import('drizzle-orm');
        const bookings = await db.delete(contractorBookingRequests).where(and(eq(contractorBookingRequests.customerPhone, FIXTURE_PHONE_E164), eq(contractorBookingRequests.description, FIXTURE_MARK))).returning({ id: contractorBookingRequests.id });
        const quotes = await db.delete(personalizedQuotes).where(and(eq(personalizedQuotes.phone, FIXTURE_PHONE_E164), like(personalizedQuotes.jobDescription, `${FIXTURE_MARK}%`))).returning({ id: personalizedQuotes.id });
        const [user] = await db.select({ id: users.id }).from(users).where(eq(users.email, FIXTURE_CONTRACTOR_EMAIL)).limit(1);
        if (user) {
            await db.delete(handymanProfiles).where(eq(handymanProfiles.userId, user.id));
            await db.delete(users).where(eq(users.id, user.id));
        }
        return { bookings: bookings.length, quotes: quotes.length };
    },
};
