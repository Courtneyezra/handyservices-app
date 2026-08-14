/**
 * Server-authoritative date-driven scheduling fees.
 *
 * The customer quote card (client/src/components/quote/UnifiedQuoteCard.tsx)
 * adds next-day and Saturday fees to the total it displays — and to the amount
 * it pins on the Apple/Google Pay sheet via elements.update(). Stripe hard-fails
 * an express-checkout confirm when the sheet amount differs from the
 * PaymentIntent amount, so /api/create-payment-intent MUST charge the same fees.
 *
 * This module ports the client's fee block exactly:
 *   • next-day (UK tomorrow)  → flat £25 (BASE_SCHEDULING_RULES.nextDayFee)
 *   • Saturday               → per-line SKU `offPeakWeekendPremiumPence` sum
 *                              when any line carries one, else flat £25 —
 *                              but the flat fee only for segments whose
 *                              scheduling config opts in (showWeekendFee).
 * The fees stack (a next-day Saturday carries both), matching the client.
 *
 * The DATE is re-derived from trusted state (the reserved slot lock) with the
 * client-named scheduledDate as fallback for lock-less flows; the £ always
 * comes from these mirrored rules, never from client pence. All calendar maths
 * are Europe/London so "tomorrow"/"Saturday" agree with what the card showed
 * regardless of server or viewer timezone.
 *
 * These constants MUST stay in lock-step with SchedulingConfig.ts
 * (BASE_SCHEDULING_RULES + SEGMENT_SCHEDULING_CONFIG.showWeekendFee) or the
 * server will charge a different figure than the customer saw.
 */

export const NEXT_DAY_FEE_PENCE = 2500; // £25 — mirrors nextDayFee
export const FLAT_WEEKEND_FEE_PENCE = 2500; // £25 — mirrors weekendFee

/** Segments whose scheduling config sets showWeekendFee: true. Segments not
 *  listed (BUDGET, PROP_MGR, LANDLORD, SMALL_BIZ, unknown → BUDGET fallback)
 *  never charge the FLAT weekend fee — but a per-line SKU Saturday premium
 *  applies regardless, exactly like the client. */
const FLAT_WEEKEND_FEE_SEGMENTS = new Set(['BUSY_PRO', 'OLDER_WOMAN', 'DIY_DEFERRER', 'CONTEXTUAL']);

/** YYYY-MM-DD of a moment in Europe/London (en-CA locale formats ISO-style). */
export function ukDateStr(d: Date): string {
    return new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(d);
}

/** Day-of-week (0=Sun..6=Sat) of a YYYY-MM-DD calendar date. Noon-UTC anchor
 *  avoids any DST edge shifting the day. */
function dayOfWeek(dateStr: string): number {
    return new Date(`${dateStr}T12:00:00.000Z`).getUTCDay();
}

export interface DateFees {
    feesPence: number;
    isNextDay: boolean;
    isSaturday: boolean;
    nextDayFeePence: number;
    saturdayFeePence: number;
}

const NO_FEES: DateFees = { feesPence: 0, isNextDay: false, isSaturday: false, nextDayFeePence: 0, saturdayFeePence: 0 };

/**
 * Fees for booking a specific calendar date, mirroring the client's
 * availableDates fee computation.
 *
 * @param quote  Needs `segment` + `pricingLineItems` off the trusted quote row.
 * @param dateStr  The booked date as YYYY-MM-DD (from the slot lock, or the
 *                 client-named scheduledDate for lock-less flows).
 * @param now  Injectable clock for tests.
 */
export function computeDateFeesPence(
    quote: { segment?: string | null; pricingLineItems?: unknown },
    dateStr: string | null | undefined,
    now: Date = new Date(),
): DateFees {
    if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return NO_FEES;

    // UK tomorrow — the client's isNextDay is "i === 1" from UK today.
    const todayUk = ukDateStr(now);
    const tomorrowUk = ukDateStr(new Date(now.getTime() + 24 * 60 * 60 * 1000));

    // A date in the past or today isn't a bookable card date — charge no fee
    // rather than guessing (defensive; the booking engine rejects these anyway).
    if (dateStr <= todayUk && dateStr !== tomorrowUk) return NO_FEES;

    const isNextDay = dateStr === tomorrowUk;
    const isSaturday = dayOfWeek(dateStr) === 6;

    const nextDayFeePence = isNextDay ? NEXT_DAY_FEE_PENCE : 0;

    let saturdayFeePence = 0;
    if (isSaturday) {
        // Per-line SKU off-peak premium wins when any line carries one;
        // legacy quotes fall back to the flat fee, gated by segment config.
        const lines = Array.isArray(quote.pricingLineItems) ? (quote.pricingLineItems as any[]) : [];
        const skuPremium = lines.reduce((s, li) => s + (Number(li?.offPeakWeekendPremiumPence) || 0), 0);
        if (skuPremium > 0) {
            saturdayFeePence = skuPremium;
        } else if (FLAT_WEEKEND_FEE_SEGMENTS.has(String(quote.segment || ''))) {
            saturdayFeePence = FLAT_WEEKEND_FEE_PENCE;
        }
    }

    return {
        feesPence: nextDayFeePence + saturdayFeePence,
        isNextDay, isSaturday, nextDayFeePence, saturdayFeePence,
    };
}
