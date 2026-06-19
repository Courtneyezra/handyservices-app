/**
 * Customer slot-offer — the self-service confirmation that must happen BEFORE a contractor
 * is assigned to a flexible job. The customer chose "I'm flexible (we pick the weekday)",
 * so we send a tokenised link to a small page showing a few dispatch-approved dates:
 *   - our RECOMMENDED slot keeps their flexible discount (premium £0), and
 *   - any OTHER offered date forfeits that discount (a Stripe top-up to standard price).
 * On pick (+ payment if they deviated) we assign the contractor (firm booking). If none of
 * the dates work they decline, which loops back to the dispatcher to offer a fresh set.
 *
 * Persisted as one JSONB blob on personalized_quotes.slot_offer (one active offer per
 * quote). Lifecycle:
 *   null ──send──▶ sent ──pick(recommended)──▶ confirmed ─(assignFromPool)→ firm booking
 *                    │                          ▲
 *                    ├──pick(premium)──▶ pay (Stripe Checkout) ──webhook──┘
 *                    └──declineAll──▶ declined_all ──(dispatcher re-sends)──▶ sent
 *
 * SAFETY: while a quote has an active offer (sent) it is held OUT of the fresh dispatch
 * pool, and the offered candidates SOFT-HOLD their contractor slots (added to the dispatch
 * bookedSlots) so the optimiser can't hand them to another job before the customer answers.
 */

export type SlotOfferStatus = 'sent' | 'confirmed' | 'declined_all';
export type OfferSlot = 'am' | 'pm';

/** One offerable slot. `premiumPence === 0` ⇒ the recommended slot (keeps the flex
 *  discount); `> 0` ⇒ a deviation that forfeits the discount (top-up = premiumPence). */
export interface SlotCandidate {
  date: string;                  // YYYY-MM-DD
  slot: OfferSlot;
  contractorId: string;          // soft-held; assigned on confirm
  contractorName: string;
  premiumPence: number;          // 0 = recommended/free; else the forfeited flex discount
  recommended: boolean;          // exactly one true (the optimiser's pick)
  /** Optional human reason this slot costs more ("sooner", "weekend") — display only. */
  note?: string | null;
}

/** A "none of these work" event (loops back to the dispatcher to re-offer). */
export interface SlotDecline {
  at: string;                    // ISO
  reason: string | null;
  /** The candidate dates the customer was shown when they declined (so we don't re-offer). */
  shownDates: string[];
}

export interface SlotOffer {
  status: SlotOfferStatus;
  token: string;                 // credential for /confirm-slot/:token (no login)
  candidates: SlotCandidate[];   // ranked; index 0 is the recommended one
  /** The customer's chosen slot (set once they pick), else null. */
  picked: { date: string; slot: OfferSlot; contractorId: string; contractorName: string } | null;
  premiumPence: number | null;   // what they paid to deviate (0 if recommended), else null
  stripeSessionId: string | null; // Checkout Session for a premium pick (else null)
  paidAt: string | null;         // ISO — premium settled (null for free picks)
  declines: SlotDecline[];       // history of "none work" rounds
  sentAt: string;                // ISO — first sent
  updatedAt: string;             // ISO — last transition
  confirmedAt: string | null;    // ISO — slot confirmed (contractor assigned)
}

/** The active-offer shape the console's "Awaiting customer" section consumes (offer + the
 *  joined quote display fields + SLA slack), returned by GET /slot-offers. */
export interface ActiveSlotOffer {
  quoteId: string;
  customerName: string;
  valuePence: number;
  postcode: string | null;
  address: string | null;
  jobDescription: string | null;
  categories: string[];
  flexDeadline: string;          // SLA deadline (deposit_paid + window)
  slackDays: number;             // whole days to the deadline (negative = past it)
  offer: SlotOffer;
}

/** "am" | "pm" → "AM" | "PM". */
export function offerSlotLabel(slot: OfferSlot): string {
  return slot.toUpperCase();
}
