import { CalendarCheck, ShieldCheck, Wallet, Clock, Star, Check } from 'lucide-react';
import type { QuoteOffer } from '@shared/pricing-settings';
import type { OfferPriceContext } from '@/lib/quote-offers';

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
  onAccept: () => void;
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
