/**
 * VA Scripts Configuration
 *
 * Real scripts used by Virtual Assistants during live calls.
 * Organized by segment and trigger type for dynamic teleprompter display.
 */

import type { CallScriptSegment } from '@shared/schema';

export interface VAScript {
  id: string;
  trigger: 'segment_detected' | 'job_detected' | 'route_ready' | 'objection' | 'closing';
  segment?: CallScriptSegment;
  route?: 'INSTANT_QUOTE' | 'VIDEO_REQUEST' | 'SITE_VISIT';
  script: string;
  tip?: string;
  followUp?: string;
}

// ==========================================
// SEGMENT-SPECIFIC SCRIPTS
// ==========================================

export const VA_SCRIPTS: Record<CallScriptSegment, VAScript[]> = {
  LANDLORD: [
    {
      id: 'landlord-opening',
      trigger: 'segment_detected',
      script: "Perfect, you don't need to be there at all. We'll coordinate directly with your tenant, send you photos before and after, and email your invoice same day for tax records.",
      tip: "Emphasize 'you don't need to be there' - this is their #1 concern",
      followUp: "Can I take the tenant's contact details?",
    },
    {
      id: 'landlord-route-instant',
      trigger: 'route_ready',
      route: 'INSTANT_QUOTE',
      script: "Based on what you've described, I can give you an exact price right now. It's £{price} and that includes everything - no hidden fees.",
      tip: "Landlords want certainty on cost",
      followUp: "Would you like me to send that quote over so you have it on record?",
    },
    {
      id: 'landlord-route-video',
      trigger: 'route_ready',
      route: 'VIDEO_REQUEST',
      script: "To give you an accurate price, could you ask your tenant to send us a quick 30-second video? I'll text you a link right now.",
      tip: "Make it easy - we text the link, tenant sends video",
      followUp: "What's the best number to send that to?",
    },
    {
      id: 'landlord-route-visit',
      trigger: 'route_ready',
      route: 'SITE_VISIT',
      script: "This sounds like something we'd need to see in person to quote accurately. We can arrange a free assessment - we'll coordinate directly with your tenant.",
      tip: "Mention free assessment and tenant coordination",
      followUp: "When would suit the tenant best for us to pop round?",
    },
    {
      id: 'landlord-closing',
      trigger: 'closing',
      script: "I'll send you a confirmation text now with all the details. You'll get photos when we arrive and when we're done, plus your invoice by email the same day.",
      tip: "Recap the hassle-free benefits",
    },
  ],

  BUSY_PRO: [
    {
      id: 'busy-opening',
      trigger: 'segment_detected',
      script: "Let me make this quick - I can have a quote in your inbox in 60 seconds. We text updates, never call unless you ask.",
      tip: "Respect their time - be concise",
      followUp: "What's the best email for you?",
    },
    {
      id: 'busy-route-instant',
      trigger: 'route_ready',
      route: 'INSTANT_QUOTE',
      script: "Right, that's £{price} all in. I can send you a booking link now - you can pick your exact time slot online.",
      tip: "Emphasize speed and control",
      followUp: "Morning or afternoon work better for you?",
    },
    {
      id: 'busy-route-video',
      trigger: 'route_ready',
      route: 'VIDEO_REQUEST',
      script: "I'll need a quick 30-second video to quote this accurately. I'm texting you a link now - takes 30 seconds, then you'll have your quote within the hour.",
      tip: "Time-box everything - they appreciate it",
      followUp: "I'll follow up by text so you don't need to take another call.",
    },
    {
      id: 'busy-route-visit',
      trigger: 'route_ready',
      route: 'SITE_VISIT',
      script: "This needs a quick look in person - 15 minutes max. We can come early morning before you start work, or evening. Which works?",
      tip: "Offer flexible timing around their schedule",
    },
    {
      id: 'busy-closing',
      trigger: 'closing',
      script: "Done. You'll get a text confirmation now, then an SMS 30 mins before we arrive. No need to call back.",
      tip: "Reinforce the 'no hassle' message",
    },
  ],

  PROP_MGR: [
    {
      id: 'prop-mgr-opening',
      trigger: 'segment_detected',
      script: "I see you manage multiple properties. We work with a lot of property managers - we can set you up with a single account, consolidated invoicing, and priority scheduling across all your properties.",
      tip: "Mention bulk rates and portfolio benefits",
      followUp: "How many properties are we looking at?",
    },
    {
      id: 'prop-mgr-route-instant',
      trigger: 'route_ready',
      route: 'INSTANT_QUOTE',
      script: "For this job, that's £{price}. If you're sending us work regularly, we can discuss a partnership rate - typically 10-15% off.",
      tip: "Plant the seed for partner program",
      followUp: "Would you like me to set up a contractor account for you?",
    },
    {
      id: 'prop-mgr-route-video',
      trigger: 'route_ready',
      route: 'VIDEO_REQUEST',
      script: "Can you get the tenant to send a quick video? I'll text you a link now. Once we have it, we'll have a quote back within the hour.",
      tip: "Position as efficient for their workflow",
    },
    {
      id: 'prop-mgr-route-visit',
      trigger: 'route_ready',
      route: 'SITE_VISIT',
      script: "We'll need to see this one. I can schedule a free assessment and have a quote over to you the same day. We'll coordinate with whoever's on site.",
      tip: "Emphasize same-day turnaround on quotes",
    },
    {
      id: 'prop-mgr-closing',
      trigger: 'closing',
      script: "I'm setting up your account now. You'll have a dedicated portal where you can see all your properties, track jobs, and download invoices for your records.",
      tip: "Mention the portal - they love organisation",
    },
  ],

  OAP: [
    {
      id: 'oap-opening',
      trigger: 'segment_detected',
      script: "Take your time, no rush at all. We're fully insured with £2M cover, and all our team are DBS checked. Would you like us to pop round for a free look first?",
      tip: "Build trust slowly. Mention insurance + DBS",
      followUp: "Is there someone who can be there with you when we visit?",
    },
    {
      id: 'oap-route-instant',
      trigger: 'route_ready',
      route: 'INSTANT_QUOTE',
      script: "For that job, we'd be looking at £{price}. That includes everything - no surprises. And we'll show you exactly what we've done when we finish.",
      tip: "Reassure on price certainty",
      followUp: "Would you like to think it over and I can call you back tomorrow?",
    },
    {
      id: 'oap-route-video',
      trigger: 'route_ready',
      route: 'VIDEO_REQUEST',
      script: "If you're able to, a quick video on your phone would help me give you an exact price. But if that's tricky, we can just pop round for a free look instead.",
      tip: "Don't assume tech comfort - offer alternative",
    },
    {
      id: 'oap-route-visit',
      trigger: 'route_ready',
      route: 'SITE_VISIT',
      script: "I think the best thing would be for us to come and have a look - it's completely free, no obligation. We can explain everything in person and give you a written quote.",
      tip: "Written quote builds confidence",
      followUp: "What day works best for you?",
    },
    {
      id: 'oap-closing',
      trigger: 'closing',
      script: "Lovely. I'll send you a text now with the date and time, and I'll include a photo of who'll be coming so you know who to expect.",
      tip: "Photo of handyman reduces anxiety about strangers",
    },
  ],

  SMALL_BIZ: [
    {
      id: 'small-biz-opening',
      trigger: 'segment_detected',
      script: "I understand you can't have disruption during business hours. We can work evenings, weekends, or early mornings - whatever causes zero impact to your customers.",
      tip: "Lead with flexibility around their hours",
      followUp: "When are your quietest times?",
    },
    {
      id: 'small-biz-route-instant',
      trigger: 'route_ready',
      route: 'INSTANT_QUOTE',
      script: "That's £{price} including VAT, and I can get you a proper invoice for your records. We can be in and out in under {time}.",
      tip: "Mention VAT invoice and quick turnaround",
      followUp: "Do you need a commercial invoice with your business details?",
    },
    {
      id: 'small-biz-route-video',
      trigger: 'route_ready',
      route: 'VIDEO_REQUEST',
      script: "Can you grab a quick video when it's quiet? I'll have a firm quote back to you within the hour so you can plan around it.",
      tip: "Emphasize they can plan around the work",
    },
    {
      id: 'small-biz-route-visit',
      trigger: 'route_ready',
      route: 'SITE_VISIT',
      script: "We'll need to take a look. I can send someone outside your trading hours - evening or early morning. 15 minutes max for the assessment.",
      tip: "Time-box the visit to reduce concern",
    },
    {
      id: 'small-biz-closing',
      trigger: 'closing',
      script: "Perfect. We'll be in and out with minimal disruption. I'll send confirmation now with the exact timing, and your commercial invoice will follow by email.",
      tip: "Reinforce minimal disruption + paperwork sorted",
    },
  ],

  EMERGENCY: [
    {
      id: 'emergency-opening',
      trigger: 'segment_detected',
      script: "Don't worry, we can get someone to you today. Let me just confirm - is this a water leak, gas issue, heating problem, or are you locked out?",
      tip: "Speed matters - confirm type, dispatch fast",
      followUp: "Is the water/gas turned off at the mains?",
    },
    {
      id: 'emergency-route-instant',
      trigger: 'route_ready',
      route: 'INSTANT_QUOTE',
      script: "Right, for an emergency callout that's £{price}. We can have someone with you within {time}. Want me to dispatch them now?",
      tip: "Confirm dispatch immediately",
      followUp: "What's the best number for our handyman to call when he's 10 minutes away?",
    },
    {
      id: 'emergency-route-video',
      trigger: 'route_ready',
      route: 'VIDEO_REQUEST',
      script: "Can you send me a quick video right now? I'll get it to our handyman so he knows exactly what to bring. Texting you the link now.",
      tip: "Video helps handyman prepare tools",
    },
    {
      id: 'emergency-route-visit',
      trigger: 'route_ready',
      route: 'SITE_VISIT',
      script: "I'm sending someone now. They'll assess it on arrival and give you a price before starting any work - is that okay?",
      tip: "Reassure they won't be surprised by cost",
    },
    {
      id: 'emergency-closing',
      trigger: 'closing',
      script: "Help is on the way. You'll get a text with our handyman's photo and ETA. They'll call you when they're 10 minutes out.",
      tip: "Reduce anxiety with clear next steps",
    },
  ],

  BUDGET: [
    {
      id: 'budget-opening',
      trigger: 'segment_detected',
      script: "I'll be completely upfront with you - we're not the cheapest, but we're fair and there are never any hidden fees. The price I give you is the price you pay.",
      tip: "Don't compete on price - compete on transparency",
      followUp: "Have you had any quotes already?",
    },
    {
      id: 'budget-route-instant',
      trigger: 'route_ready',
      route: 'INSTANT_QUOTE',
      script: "For that job, it's £{price} all in. That includes labour, materials, cleanup, and a 12-month guarantee. Nothing extra to pay.",
      tip: "Break down what's included",
      followUp: "Would you like a breakdown of that price?",
    },
    {
      id: 'budget-route-video',
      trigger: 'route_ready',
      route: 'VIDEO_REQUEST',
      script: "Send me a quick video and I'll give you an exact, fixed price. No hourly rates, no surprises when we get there.",
      tip: "Emphasize fixed pricing",
    },
    {
      id: 'budget-route-visit',
      trigger: 'route_ready',
      route: 'SITE_VISIT',
      script: "We'd need to see it to give you an accurate price - the visit's free, no obligation. I don't want to quote blind and then have to adjust it.",
      tip: "Frame visit as protecting them from price changes",
    },
    {
      id: 'budget-closing',
      trigger: 'closing',
      script: "Great. Just to confirm - the price I've given you is fixed. If we find anything unexpected, we'll tell you and agree any extra before we do it.",
      tip: "Final price reassurance",
    },
  ],
};

// ==========================================
// OBJECTION HANDLING SCRIPTS
// ==========================================

export const OBJECTION_SCRIPTS: Record<string, VAScript> = {
  too_expensive: {
    id: 'objection-price',
    trigger: 'objection',
    script: "I understand. Our price includes the full job, cleanup, and a 12-month guarantee. We're not the cheapest, but we're the last call you'll make on this.",
    tip: "Reframe value, don't discount",
    followUp: "Would you like me to go through exactly what's included?",
  },
  need_to_think: {
    id: 'objection-think',
    trigger: 'objection',
    script: "Absolutely, take your time. The quote is valid for 7 days and I'll send you a reminder. Any questions I can answer now?",
    tip: "No pressure, leave door open",
  },
  getting_other_quotes: {
    id: 'objection-quotes',
    trigger: 'objection',
    script: "That makes sense. Just so you're comparing apples with apples - our quote includes materials, cleanup, and a written 12-month guarantee. Some quotes don't include all that.",
    tip: "Help them compare fairly",
  },
  not_decision_maker: {
    id: 'objection-not-dm',
    trigger: 'objection',
    script: "No problem. Would it help if I sent a detailed quote that you can share with them? I can include photos and a full breakdown.",
    tip: "Arm them to sell internally",
    followUp: "Who should I mark the quote to?",
  },
  bad_timing: {
    id: 'objection-timing',
    trigger: 'objection',
    script: "Understood. When would be a better time? I can make a note and call you back, or just send you the quote and you can book online when you're ready.",
    tip: "Offer callback or self-serve",
  },
  had_bad_experience: {
    id: 'objection-bad-experience',
    trigger: 'objection',
    script: "I'm sorry to hear that. We guarantee our work for 12 months - if anything's not right, we come back and fix it free. No arguments, no questions.",
    tip: "Lead with guarantee",
    followUp: "Would it help to see some of our reviews?",
  },
  just_want_price: {
    id: 'objection-just-price',
    trigger: 'objection',
    script: "Sure, no problem - £{price}. That's labour, materials, and a 12-month guarantee included. Anything else you need to know?",
    tip: "Give price immediately, then add value",
  },
};

// ==========================================
// MISSING INFO PROMPTS
// ==========================================

export const MISSING_INFO_PROMPTS: Record<string, string> = {
  name: "Can I take a name for the booking?",
  postcode: "What's the postcode for the property?",
  contact: "What's the best number to reach you on?",
  job: "Could you describe the issue in a bit more detail?",
  email: "What's the best email to send the quote to?",
  property_access: "How will we access the property - will someone be there?",
  tenant_contact: "Can I take the tenant's contact details?",
  decision_maker: "Are you the one making the decision on this work?",
  timing: "When would you like this done by?",
};

// ==========================================
// HELPER FUNCTIONS
// ==========================================

/**
 * Get the primary script for a segment when first detected
 */
export function getSegmentOpeningScript(segment: CallScriptSegment): VAScript | null {
  const scripts = VA_SCRIPTS[segment];
  return scripts?.find(s => s.trigger === 'segment_detected') || null;
}

/**
 * Get the route-ready script for a segment and specific route
 */
export function getRouteReadyScript(
  segment: CallScriptSegment,
  route: 'INSTANT_QUOTE' | 'VIDEO_REQUEST' | 'SITE_VISIT'
): VAScript | null {
  const scripts = VA_SCRIPTS[segment];
  return scripts?.find(s => s.trigger === 'route_ready' && s.route === route) || null;
}

/**
 * Get the closing script for a segment
 */
export function getClosingScript(segment: CallScriptSegment): VAScript | null {
  const scripts = VA_SCRIPTS[segment];
  return scripts?.find(s => s.trigger === 'closing') || null;
}

/**
 * Interpolate price into script text
 */
export function interpolateScript(script: string, variables: { price?: number; time?: string }): string {
  let result = script;

  if (variables.price !== undefined) {
    result = result.replace(/\{price\}/g, `£${Math.round(variables.price / 100)}`);
  }

  if (variables.time !== undefined) {
    result = result.replace(/\{time\}/g, variables.time);
  }

  return result;
}

/**
 * Get the current script based on call state
 */
export function getCurrentScript(
  segment: CallScriptSegment | null,
  route: 'INSTANT_QUOTE' | 'VIDEO_REQUEST' | 'SITE_VISIT' | null,
  trigger: 'segment_detected' | 'route_ready' | 'closing'
): VAScript | null {
  if (!segment) return null;

  if (trigger === 'route_ready' && route) {
    return getRouteReadyScript(segment, route);
  }

  if (trigger === 'closing') {
    return getClosingScript(segment);
  }

  return getSegmentOpeningScript(segment);
}
