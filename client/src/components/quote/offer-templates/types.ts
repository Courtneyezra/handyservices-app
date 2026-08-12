import { CalendarCheck, ShieldCheck, Wallet, Clock, Star, Check } from 'lucide-react';
import type { QuoteOffer, AddonMenuItem } from '@shared/pricing-settings';
import type { OfferPriceContext } from '@/lib/quote-offers';

/**
 * Payload an accept can carry back to the parent.
 *   - add_task offers: the ids of the pre-priced addon tasks the customer
 *     tapped (multi-select).
 *   - welcome_gift offers: the ONE free task the customer picked (`giftId`,
 *     single-select; `addonIds` stays empty).
 * Templates that don't render a menu just call `onAccept()` with no payload.
 */
export interface OfferAcceptPayload {
  addonIds: string[];
  giftId?: string;
}

/**
 * Shared contract every irresistible-offer template implements. The dispatcher
 * (IrresistibleOfferScreen) builds the price context + token renderer once and
 * passes them down, so each template is a pure presentational layout — same
 * data, different chrome. This is what lets any offer be shown in any layout
 * and A/B-tested on design alone.
 */
export interface OfferTemplateProps {
  offer: QuoteOffer;
  /** Server-mirrored price context — drives {savings}/{base}/{firm}/{days}. */
  ctx: OfferPriceContext;
  /** Fills copy tokens from `ctx`. */
  render: (t: string | undefined) => string;
  customerName?: string;
  /** Quote skin — the contractor/team fronting this quote. Defaults to Craig. */
  skin?: { name: string; avatarUrl: string; rating: string; jobsLabel?: string };
  /**
   * add_task offers: the server-stored pre-priced small-job menu. The template
   * renders tap-to-toggle tiles and returns the selected ids via the accept
   * payload. welcome_gift offers: the (pre-filtered) GIFT POOL — the template
   * renders SINGLE-select tiles with the real price struck through + "FREE"
   * and returns the pick as `giftId`. Absent/empty for other offer types (and
   * for templates that don't implement the menu — they show benefits + accept
   * only).
   */
  addonMenu?: AddonMenuItem[];
  /** Accept. add_task offers pass the chosen addon ids; others pass nothing. */
  onAccept: (payload?: OfferAcceptPayload) => void;
  onDecline: () => void;
}

/** Benefit icon key → lucide icon. */
export const OFFER_ICONS: Record<string, typeof Check> = {
  calendar: CalendarCheck,
  shield: ShieldCheck,
  wallet: Wallet,
  clock: Clock,
  star: Star,
  check: Check,
};

export const HS_GREEN = '#7DB00E';
export const HS_GREEN_DARK = '#5a8209';
export const HS_NAVY = '#0f172a';

export const firstNameOf = (name?: string) => name?.trim().split(/\s+/)[0];

export type { QuoteOffer };
