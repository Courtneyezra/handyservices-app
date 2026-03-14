/**
 * Hassle Comparisons — Single Source of Truth
 *
 * "Without Us / With Us" framing for every segment differentiator.
 * Consumed by all customer touchpoints: landing pages, quote pages,
 * WhatsApp messages, and VA call coaching.
 *
 * IDs align with differentiator IDs in server/segmentation/reference-prices.ts.
 */

export interface HassleComparison {
  /** Matches differentiator ID from reference-prices.ts */
  id: string;
  /** ~10 words — the pain of going without us */
  withoutUs: string;
  /** ~10 words — the relief of choosing us */
  withUs: string;
  /** Single WhatsApp-friendly line (emoji optional) */
  whatsappLine: string;
  /** Conversational, <15 words — for VA to say on a live call */
  vaScript: string;
}

export const SEGMENT_HASSLE_MAP: Record<string, HassleComparison[]> = {
  BUSY_PRO: [
    {
      id: 'same-week',
      withoutUs: 'Wait 2-3 weeks, rearrange your whole schedule',
      withUs: 'Booked this week — done while you\'re at work',
      whatsappLine: '⚡ No 2-week wait — we book you in this week',
      vaScript: 'No waiting weeks — we get you booked in this week',
    },
    {
      id: 'photo-updates',
      withoutUs: 'Come home wondering what happened',
      withUs: 'Photo updates sent to your phone during the job',
      whatsappLine: '📸 Photo updates sent during the job — no guessing',
      vaScript: 'We send you photos during the job so you know exactly what\'s happening',
    },
    {
      id: 'cleanup',
      withoutUs: 'Dust and mess left for you to deal with',
      withUs: 'Full cleanup — come home to a finished room',
      whatsappLine: '✨ Full cleanup included — no mess left behind',
      vaScript: 'We clean up completely — you come home to a finished room',
    },
    {
      id: 'guarantee-90',
      withoutUs: 'If it fails next month, start from scratch',
      withUs: '90-day guarantee — we come back and fix it free',
      whatsappLine: '🛡️ 90-day guarantee — if anything\'s not right, we return free',
      vaScript: '90-day guarantee — if anything goes wrong, we come back free',
    },
    {
      id: 'direct-line',
      withoutUs: 'Call a switchboard, leave voicemails, wait days',
      withUs: 'Direct line to your tradesperson — same-day response',
      whatsappLine: '📞 Direct contact line — no switchboard, no waiting',
      vaScript: 'You get a direct line — no chasing, same-day response',
    },
  ],

  PROP_MGR: [
    {
      id: 'fast-turnaround',
      withoutUs: 'Chase 3 tradesmen, none confirm, tenant complains',
      withUs: '48-72hr commitment — one text, confirmed',
      whatsappLine: '⚡ 48-72hr turnaround — no chasing tradesmen',
      vaScript: 'No chasing tradesmen — we commit to 48-72 hours, every time',
    },
    {
      id: 'photo-report',
      withoutUs: 'Drive to the property to check the work was done',
      withUs: 'Photo report emailed on completion — job verified remotely',
      whatsappLine: '📸 Photo report sent on completion — no site visit needed',
      vaScript: 'We send a photo report when it\'s done — no need to visit',
    },
    {
      id: 'tenant-coord',
      withoutUs: 'Play phone tag between tenant and tradesman',
      withUs: 'We coordinate directly with your tenant for access',
      whatsappLine: '🔑 We coordinate with your tenant — no middleman hassle',
      vaScript: 'We deal with your tenant directly — you\'re not the middleman',
    },
    {
      id: 'same-day-invoice',
      withoutUs: 'Chase for invoices weeks later, accounts frustrated',
      withUs: 'Invoice emailed same day — accounts-ready',
      whatsappLine: '📄 Same-day invoice — no chasing paperwork',
      vaScript: 'Invoice in your inbox same day — no chasing',
    },
  ],

  LANDLORD: [
    {
      id: 'fast-turnaround',
      withoutUs: 'Tenant waiting days, you chasing for updates',
      withUs: 'Sorted within 48-72 hours — no chasing needed',
      whatsappLine: '⚡ Sorted within 48-72 hours — no chasing anyone',
      vaScript: 'We get it sorted in 48-72 hours — no one to chase',
    },
    {
      id: 'photo-report',
      withoutUs: 'Drive 2 hours to check the work yourself',
      withUs: 'Photo proof sent straight to your phone',
      whatsappLine: '📸 Photo proof sent to you — no need to visit the property',
      vaScript: 'You won\'t need to drive over — we send you photos of the finished work',
    },
    {
      id: 'tenant-coord',
      withoutUs: 'Play middleman between your tenant and tradesman',
      withUs: 'We coordinate directly with your tenant',
      whatsappLine: '🔑 We coordinate with your tenant — no middleman',
      vaScript: 'No playing middleman — we talk to your tenant directly',
    },
    {
      id: 'tax-invoice',
      withoutUs: 'Chase for a receipt at tax time, scramble for records',
      withUs: 'Tax-ready invoice in your inbox same day',
      whatsappLine: '📄 Tax-ready invoice same day — your accountant will thank you',
      vaScript: 'Proper tax-ready invoice same day — no chasing at year-end',
    },
  ],

  SMALL_BIZ: [
    {
      id: 'after-hours',
      withoutUs: 'Close the shop, lose a day\'s revenue for a repair',
      withUs: 'We work when you\'re closed — zero lost trading hours',
      whatsappLine: '🌙 After-hours service — zero lost trading time',
      vaScript: 'We work when you\'re closed — your customers never know we were there',
    },
    {
      id: 'same-day',
      withoutUs: 'Emergency during opening hours, customers see the chaos',
      withUs: 'Same-day fix — customers never notice',
      whatsappLine: '⚡ Same-day emergency fix — minimal disruption',
      vaScript: 'Same-day response — we get it fixed before it affects your customers',
    },
    {
      id: 'invoicing',
      withoutUs: 'Chase for receipts, log expenses manually',
      withUs: 'VAT invoice emailed same day — accounts-ready',
      whatsappLine: '📄 Proper VAT invoice same day — no chasing',
      vaScript: 'VAT invoice same day — ready for your accounts',
    },
    {
      id: 'cleanup',
      withoutUs: 'Sawdust, tools, mess visible to your customers',
      withUs: 'Customer-ready cleanup — no trace we were there',
      whatsappLine: '✨ Full cleanup — your customers won\'t know we were there',
      vaScript: 'We clean up completely — no trace for your customers to see',
    },
  ],

  DIY_DEFERRER: [
    {
      id: 'batch-efficiency',
      withoutUs: 'Book 5 separate visits over 5 weeks',
      withUs: 'One visit — full list done in a single trip',
      whatsappLine: '📋 One visit, full list done — no booking 5 separate tradesmen',
      vaScript: 'Send us your full list — we knock it all out in one visit',
    },
    {
      id: 'cleanup',
      withoutUs: 'DIY mess everywhere, half-finished for weeks',
      withUs: 'Professional finish with full cleanup included',
      whatsappLine: '✨ Professional finish + full cleanup — no DIY mess',
      vaScript: 'No half-finished DIY — done properly with full cleanup',
    },
    {
      id: 'guarantee',
      withoutUs: 'If your DIY fix fails, you\'re back to square one',
      withUs: '30-day guarantee — done right first time',
      whatsappLine: '🛡️ 30-day guarantee — done right first time',
      vaScript: 'Done right first time with a 30-day guarantee',
    },
  ],

  BUDGET: [
    {
      id: 'reliability',
      withoutUs: 'Random Gumtree ad — no reviews, no insurance, no comeback',
      withUs: 'Vetted professional — insured, reviewed, guaranteed',
      whatsappLine: '✅ Vetted & insured — not a random Gumtree ad',
      vaScript: 'We\'re vetted and insured — not a random ad with no reviews',
    },
    {
      id: 'cleanup',
      withoutUs: 'Left to clean up after the tradesman yourself',
      withUs: 'Cleanup included — left tidy, no extra charge',
      whatsappLine: '✨ Cleanup included — no extra charge',
      vaScript: 'Cleanup\'s included — we leave it tidy',
    },
  ],

  UNKNOWN: [
    {
      id: 'quality',
      withoutUs: 'Gamble on an unknown tradesman — hope for the best',
      withUs: 'Vetted professional with proven track record',
      whatsappLine: '✅ Vetted professional — 4.9★ rated, £2M insured',
      vaScript: 'We\'re vetted, insured, and 4.9-star rated',
    },
    {
      id: 'cleanup',
      withoutUs: 'Mess left behind for you to sort out',
      withUs: 'Full cleanup included — we leave it spotless',
      whatsappLine: '✨ Full cleanup included — we leave it spotless',
      vaScript: 'Full cleanup included — we leave it spotless',
    },
    {
      id: 'guarantee',
      withoutUs: 'If something goes wrong, good luck getting them back',
      withUs: '30-day guarantee — we come back and fix it free',
      whatsappLine: '🛡️ 30-day guarantee — peace of mind included',
      vaScript: '30-day guarantee — if anything\'s not right, we come back free',
    },
  ],

  // Extended segments for quote pages
  OAP: [
    {
      id: 'trust',
      withoutUs: 'Let a stranger into your home — no idea who they are',
      withUs: 'DBS-checked, £2M insured — vetted and trusted',
      whatsappLine: '🛡️ DBS-checked & £2M insured — safe and trusted',
      vaScript: 'All our team are DBS-checked and fully insured — you\'re in safe hands',
    },
    {
      id: 'no-rush',
      withoutUs: 'Rushed job, no time to ask questions, feeling pressured',
      withUs: 'We take our time, explain everything, no pressure',
      whatsappLine: '🤝 No rush, no pressure — we explain everything clearly',
      vaScript: 'We never rush — happy to explain everything and answer questions',
    },
    {
      id: 'site-visit',
      withoutUs: 'Quote over the phone, surprise charges on the day',
      withUs: 'Free site visit — see exactly what you\'re paying for',
      whatsappLine: '🏠 Free site visit — no surprises on price',
      vaScript: 'We can pop round first so you know exactly what you\'re paying',
    },
  ],

  TRUST_SEEKER: [
    {
      id: 'trust',
      withoutUs: 'Unvetted tradesman — no insurance, no reviews',
      withUs: 'DBS-checked, £2M insured, 4.9★ rated',
      whatsappLine: '🛡️ DBS-checked, £2M insured, 4.9★ on Google',
      vaScript: 'We\'re DBS-checked, fully insured, and 4.9-star rated on Google',
    },
    {
      id: 'transparency',
      withoutUs: 'Vague quote, surprise charges after the job',
      withUs: 'Fixed price upfront — the price you see is what you pay',
      whatsappLine: '💰 Fixed price — no hidden charges, no surprises',
      vaScript: 'Fixed price — no surprises, no hidden charges',
    },
    {
      id: 'guarantee',
      withoutUs: 'If something goes wrong, try getting them back',
      withUs: '30-day guarantee — we return and fix it free',
      whatsappLine: '🛡️ 30-day guarantee — not right? We return free',
      vaScript: 'If anything\'s not right, we come back and fix it free',
    },
  ],

  OLDER_WOMAN: [
    {
      id: 'trust',
      withoutUs: 'Let a stranger in — no way to verify who they are',
      withUs: 'DBS-checked, £2M insured — safe and vetted',
      whatsappLine: '🛡️ DBS-checked & fully insured — safe hands',
      vaScript: 'All our team are DBS-checked and insured — you\'re in safe hands',
    },
    {
      id: 'respect',
      withoutUs: 'Talked down to, rushed, or overcharged',
      withUs: 'Patient, respectful, and happy to explain everything',
      whatsappLine: '🤝 Patient and respectful — happy to answer any questions',
      vaScript: 'We take our time and explain everything — no pressure at all',
    },
    {
      id: 'cleanup',
      withoutUs: 'Mess left behind for you to tidy up',
      withUs: 'Full cleanup — we leave your home spotless',
      whatsappLine: '✨ Full cleanup — your home left spotless',
      vaScript: 'We clean up everything — your home left exactly as it was',
    },
  ],

  EMERGENCY: [
    {
      id: 'speed',
      withoutUs: 'Ring around 10 tradesmen, no one can come today',
      withUs: 'We\'re on our way — average 2-hour response',
      whatsappLine: '🚨 On our way — average 2-hour response time',
      vaScript: 'We\'re getting someone to you now — average 2 hours',
    },
    {
      id: 'availability',
      withoutUs: 'Evening or weekend? Good luck finding anyone',
      withUs: 'Available evenings and weekends for emergencies',
      whatsappLine: '🌙 Available evenings & weekends for emergencies',
      vaScript: 'We\'re available evenings and weekends for emergencies',
    },
    {
      id: 'no-callout',
      withoutUs: 'Hidden callout fees on top of the repair cost',
      withUs: 'Transparent pricing — no hidden callout charges',
      whatsappLine: '💰 No hidden callout fees — transparent pricing',
      vaScript: 'No hidden callout fees — you know the price upfront',
    },
  ],
};

/**
 * Get the top N hassle comparisons for a segment.
 * Falls back to UNKNOWN if segment not found.
 */
export function getHassleComparisons(segment: string, maxItems?: number): HassleComparison[] {
  const comparisons = SEGMENT_HASSLE_MAP[segment] || SEGMENT_HASSLE_MAP['UNKNOWN'];
  return maxItems ? comparisons.slice(0, maxItems) : comparisons;
}

/**
 * Get WhatsApp-formatted value lines for a segment.
 * Returns top N lines ready to insert into a message.
 */
export function getWhatsAppValueLines(segment: string, count: number = 2): string[] {
  return getHassleComparisons(segment, count).map(h => h.whatsappLine);
}

/**
 * Segment-specific headlines for the hassle comparison section.
 */
export const HASSLE_SECTION_HEADLINES: Record<string, { title: string; subtitle: string }> = {
  BUSY_PRO: {
    title: 'No waiting. No chasing. No mess.',
    subtitle: 'What you avoid by choosing Handy Services',
  },
  PROP_MGR: {
    title: 'No chasing. No site visits. No invoice drama.',
    subtitle: 'What you avoid by choosing Handy Services',
  },
  LANDLORD: {
    title: 'No driving over. No middleman. No chasing.',
    subtitle: 'What you avoid by choosing Handy Services',
  },
  SMALL_BIZ: {
    title: 'No closing the shop. No lost revenue. No mess.',
    subtitle: 'What you avoid by choosing Handy Services',
  },
  DIY_DEFERRER: {
    title: 'No half-finished jobs. No DIY weekends.',
    subtitle: 'What you avoid by choosing Handy Services',
  },
  BUDGET: {
    title: 'Affordable doesn\'t mean risky.',
    subtitle: 'What you get that a random Gumtree ad can\'t offer',
  },
  UNKNOWN: {
    title: 'Why customers choose us.',
    subtitle: 'What you get with Handy Services',
  },
  OAP: {
    title: 'Safe. Patient. Trusted.',
    subtitle: 'Why our customers feel comfortable with us',
  },
  TRUST_SEEKER: {
    title: 'Vetted. Insured. Guaranteed.',
    subtitle: 'The peace of mind you deserve',
  },
  OLDER_WOMAN: {
    title: 'Safe. Respectful. Spotless.',
    subtitle: 'Why our customers trust us in their homes',
  },
  EMERGENCY: {
    title: 'Fast. Available. No hidden fees.',
    subtitle: 'Emergency service you can count on',
  },
};
