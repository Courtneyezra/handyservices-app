/**
 * Segment-Specific Confirmation Content
 *
 * Based on customer segments, provides personalized post-payment messaging
 * following the Peak-End Rule for memorable experience design.
 */

import type { SegmentType } from '@shared/schema';

export interface SegmentConfirmationContent {
  header: string;
  subheader: string;
  bullets: {
    icon: 'camera' | 'phone' | 'calendar' | 'file-text' | 'clock' | 'key' | 'shield' | 'star' | 'zap' | 'users' | 'percent' | 'wrench';
    text: string;
  }[];
  cta: {
    label: string;
    action: 'portal' | 'download-invoice' | 'add-calendar' | 'partner-program' | 'phone' | 'services';
    variant: 'primary' | 'secondary';
  };
  secondaryCta?: {
    label: string;
    action: 'portal' | 'download-invoice' | 'add-calendar' | 'partner-program' | 'phone' | 'services';
    variant: 'primary' | 'secondary';
  };
  trustStrip: string;
  riskReversal: string;
}

export const segmentConfirmationContent: Record<SegmentType | 'OLDER_WOMAN', SegmentConfirmationContent> = {
  PROP_MGR: {
    header: 'Manage All Your Properties in One Place',
    subheader: 'Your booking is confirmed. Here\'s what happens next:',
    bullets: [
      { icon: 'clock', text: 'Scheduled within 48-72 hours' },
      { icon: 'camera', text: 'Photo report on completion' },
      { icon: 'key', text: 'Tenant coordination available' },
      { icon: 'file-text', text: 'Invoice emailed same day' },
    ],
    cta: {
      label: 'Join Partner Program',
      action: 'partner-program',
      variant: 'primary',
    },
    secondaryCta: {
      label: 'View My Booking',
      action: 'portal',
      variant: 'secondary',
    },
    trustStrip: '£2M Insured • 4.9★ Google (127 reviews) • 230+ properties serviced',
    riskReversal: 'Not right? We return and fix it free. No questions.',
  },

  LANDLORD: {
    header: 'Landlord Tools at Your Fingertips',
    subheader: 'Your rental handled. You don\'t need to be there.',
    bullets: [
      { icon: 'camera', text: 'Photo documentation for your records' },
      { icon: 'key', text: 'Tenant coordination service available' },
      { icon: 'file-text', text: 'Tax-ready invoice included' },
      { icon: 'clock', text: 'Scheduled within 48-72 hours' },
    ],
    cta: {
      label: 'Download Tax Invoice',
      action: 'download-invoice',
      variant: 'primary',
    },
    secondaryCta: {
      label: 'Track My Booking',
      action: 'portal',
      variant: 'secondary',
    },
    trustStrip: '£2M Insured • 4.9★ Google (127 reviews) • 180+ landlords trust us',
    riskReversal: 'Not right? We return and fix it free. No questions.',
  },

  BUSY_PRO: {
    header: 'Your Time is Valuable',
    subheader: 'Sit back. We\'ve got this.',
    bullets: [
      { icon: 'phone', text: 'SMS updates throughout (no calls needed)' },
      { icon: 'calendar', text: 'Calendar invite sent to your email' },
      { icon: 'clock', text: 'Reschedule online anytime' },
      { icon: 'star', text: 'Priority rebooking for repeat customers' },
    ],
    cta: {
      label: 'Add to Calendar',
      action: 'add-calendar',
      variant: 'primary',
    },
    secondaryCta: {
      label: 'Track My Booking',
      action: 'portal',
      variant: 'secondary',
    },
    trustStrip: '£2M Insured • 4.9★ Google (127 reviews) • Same-week service',
    riskReversal: 'Need to reschedule? Just text us. Free changes up to 24h before.',
  },

  SMALL_BIZ: {
    header: 'We Understand Business Needs',
    subheader: 'Your premises. Your schedule. Zero disruption.',
    bullets: [
      { icon: 'clock', text: 'Flexible scheduling around your hours' },
      { icon: 'file-text', text: 'Commercial invoice available' },
      { icon: 'percent', text: 'Regular maintenance packages available' },
      { icon: 'users', text: 'Multi-site discounts for chains' },
    ],
    cta: {
      label: 'Get Business Quote',
      action: 'phone',
      variant: 'primary',
    },
    secondaryCta: {
      label: 'View My Booking',
      action: 'portal',
      variant: 'secondary',
    },
    trustStrip: '£2M Insured • 4.9★ Google (127 reviews) • After-hours available',
    riskReversal: 'Disruption? Let us know immediately - we\'ll make it right.',
  },

  DIY_DEFERRER: {
    header: 'You Made the Right Call',
    subheader: 'Finally getting it done. No more putting it off.',
    bullets: [
      { icon: 'wrench', text: 'Professional results, no hassle' },
      { icon: 'users', text: 'Our team handles everything' },
      { icon: 'zap', text: 'Book your next fix in 30 seconds' },
      { icon: 'star', text: '"Honey-do list" service available' },
    ],
    cta: {
      label: 'What Else Needs Fixing?',
      action: 'services',
      variant: 'primary',
    },
    secondaryCta: {
      label: 'Track My Booking',
      action: 'portal',
      variant: 'secondary',
    },
    trustStrip: '£2M Insured • 4.9★ Google (127 reviews) • Bundle & save 15%',
    riskReversal: 'Found more while we\'re there? No problem - just ask.',
  },

  BUDGET: {
    header: 'Thank You for Trusting Us',
    subheader: 'Quality work at a fair price. That\'s our promise.',
    bullets: [
      { icon: 'shield', text: 'No hidden fees, ever' },
      { icon: 'clock', text: 'Balance due after job completion' },
      { icon: 'phone', text: 'Questions? Call us anytime' },
      { icon: 'star', text: 'Repeat customer discounts available' },
    ],
    cta: {
      label: 'Have Questions?',
      action: 'phone',
      variant: 'primary',
    },
    secondaryCta: {
      label: 'Track My Booking',
      action: 'portal',
      variant: 'secondary',
    },
    trustStrip: '£2M Insured • 4.9★ Google (127 reviews) • Fair prices',
    riskReversal: 'Not satisfied? Let us know - we\'ll make it right.',
  },

  OLDER_WOMAN: {
    header: 'Thank You for Trusting Us',
    subheader: 'We\'re here to help. Any questions, just call.',
    bullets: [
      { icon: 'shield', text: 'No hidden fees, ever' },
      { icon: 'phone', text: 'Questions? Call us anytime' },
      { icon: 'clock', text: 'Balance due after job completion' },
      { icon: 'star', text: 'Senior discount on future bookings' },
    ],
    cta: {
      label: 'Have Questions?',
      action: 'phone',
      variant: 'primary',
    },
    secondaryCta: {
      label: 'Track My Booking',
      action: 'portal',
      variant: 'secondary',
    },
    trustStrip: '£2M Insured • 4.9★ Google (127 reviews) • Trusted locally',
    riskReversal: 'Not satisfied? Let us know - we\'ll make it right.',
  },

  UNKNOWN: {
    header: 'Thank You for Booking',
    subheader: 'Your booking is confirmed. We\'ll take it from here.',
    bullets: [
      { icon: 'shield', text: 'Quality workmanship guaranteed' },
      { icon: 'clock', text: 'We\'ll be in touch to confirm timing' },
      { icon: 'phone', text: 'Questions? Give us a call' },
      { icon: 'file-text', text: 'Invoice sent after completion' },
    ],
    cta: {
      label: 'Track My Booking',
      action: 'portal',
      variant: 'primary',
    },
    trustStrip: '£2M Insured • 4.9★ Google (127 reviews)',
    riskReversal: 'Not satisfied? Let us know - we\'ll make it right.',
  },
};

export function getSegmentConfirmationContent(segment: string): SegmentConfirmationContent {
  const key = segment as keyof typeof segmentConfirmationContent;
  return segmentConfirmationContent[key] || segmentConfirmationContent.UNKNOWN;
}
