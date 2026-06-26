import type { ComponentType } from 'react';
import type { QuoteOffer, QuoteOfferTemplate } from '@shared/pricing-settings';
import { buildOfferPriceContext, renderOfferCopy } from '@/lib/quote-offers';
import { DarkHeroOffer } from './offer-templates/DarkHeroOffer';
import { SplitOffer } from './offer-templates/SplitOffer';
import { MinimalOffer } from './offer-templates/MinimalOffer';
import { AtHomeOffer } from './offer-templates/AtHomeOffer';
import type { OfferTemplateProps } from './offer-templates/types';

/**
 * Irresistible-offer interstitial — step 2 of the 3-step ?v=offer flow
 * (waiting → THIS → quote). Shown full-screen BEFORE the price.
 *
 * This is the DISPATCHER: it builds the server-mirrored price context + token
 * renderer once, then hands off to the layout named by `offer.template`. Each
 * template (offer-templates/) is a pure presentational design over the same
 * QuoteOffer data, so any offer can run in any layout and be A/B-tested on
 * design or copy independently. All copy tokens ({savings} {days} {base}
 * {firm}) resolve to the server-authoritative numbers, so the advertised saving
 * always matches what the server charges.
 *
 * For flex_date: accept → flexible lane (base price); decline → firm date &
 * time (base + premium). The re-price happens downstream via
 * initialUseFlexBooking on UnifiedQuoteCard — this screen only records the
 * choice (and fires analytics upstream in PersonalizedQuotePage).
 */

const TEMPLATES: Record<QuoteOfferTemplate, ComponentType<OfferTemplateProps>> = {
  dark_hero: DarkHeroOffer,
  split: SplitOffer,
  minimal: MinimalOffer,
  at_home: AtHomeOffer,
};

interface IrresistibleOfferScreenProps {
  offer: QuoteOffer;
  /** The quote's base (flexible-lane) price in pence — drives all £ tokens. */
  basePricePence: number;
  customerName?: string;
  onAccept: () => void;
  onDecline: () => void;
}

export function IrresistibleOfferScreen({
  offer,
  basePricePence,
  customerName,
  onAccept,
  onDecline,
}: IrresistibleOfferScreenProps) {
  const ctx = buildOfferPriceContext(offer, basePricePence);
  const render = (t: string | undefined) => renderOfferCopy(t, ctx);
  const Template = TEMPLATES[offer.template ?? 'dark_hero'] ?? DarkHeroOffer;

  return (
    <Template
      offer={offer}
      ctx={ctx}
      render={render}
      customerName={customerName}
      onAccept={onAccept}
      onDecline={onDecline}
    />
  );
}
