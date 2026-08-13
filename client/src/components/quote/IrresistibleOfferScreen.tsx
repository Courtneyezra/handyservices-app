import type { ComponentType } from 'react';
import type { QuoteOffer, QuoteOfferTemplate, AddonMenuItem } from '@shared/pricing-settings';
import { buildOfferPriceContext, renderOfferCopy } from '@/lib/quote-offers';
import { DarkHeroOffer } from './offer-templates/DarkHeroOffer';
import { SplitOffer } from './offer-templates/SplitOffer';
import { MinimalOffer } from './offer-templates/MinimalOffer';
import { AtHomeOffer } from './offer-templates/AtHomeOffer';
import type { OfferTemplateProps, OfferAcceptPayload } from './offer-templates/types';

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
 * For add_task (the live offer — the flex lane was deleted Aug 2026): accept
 * carries the tapped addon ids back in the payload; decline means none. The
 * price impact happens downstream in UnifiedQuoteCard (display) and
 * server-side at payment (money) — this screen only records the choice (and
 * fires analytics upstream in PersonalizedQuotePage).
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
  /** Quote skin — the contractor/team fronting this quote. Defaults to Craig. */
  skin?: { name: string; avatarUrl: string; rating: string; jobsLabel?: string };
  /** add_task offers: the server-stored addon menu the template renders.
   *  welcome_gift offers: the pre-filtered GIFT POOL (items within the
   *  gift-minutes cap) — the caller filters; this screen just passes through. */
  addonMenu?: AddonMenuItem[];
  /** Accept — add_task offers carry the chosen addon ids in the payload. */
  onAccept: (payload?: OfferAcceptPayload) => void;
  onDecline: () => void;
}

export function IrresistibleOfferScreen({
  offer,
  basePricePence,
  customerName,
  skin,
  addonMenu,
  onAccept,
  onDecline,
}: IrresistibleOfferScreenProps) {
  const ctx = buildOfferPriceContext(offer, basePricePence);
  // Offer copy is admin-authored with the default skin's name ("Craig") written
  // literally. When the quote carries a different skin, swap the name so the
  // copy matches the face on screen. No-op for the default skin.
  const render = (t: string | undefined) => {
    let out = renderOfferCopy(t, ctx);
    if (skin && skin.name !== 'Craig') {
      out = out.replace(/Craig's/g, `${skin.name}'s`).replace(/Craig/g, skin.name);
    }
    return out;
  };
  const Template = TEMPLATES[offer.template ?? 'dark_hero'] ?? DarkHeroOffer;

  return (
    <Template
      offer={offer}
      ctx={ctx}
      render={render}
      customerName={customerName}
      skin={skin}
      addonMenu={offer.type === 'add_task' || offer.type === 'welcome_gift' ? addonMenu : undefined}
      onAccept={onAccept}
      onDecline={onDecline}
    />
  );
}
