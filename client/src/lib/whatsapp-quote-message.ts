import { format, parseISO, isToday } from 'date-fns';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface QuoteMessageParams {
  firstName: string;
  jobDescription: string;
  quoteUrl: string;
  segment: string;
  availableDates: Array<{ date: string; slots: ('am' | 'pm' | 'full')[] }>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function getOrdinalSuffix(day: number): string {
  if (day >= 11 && day <= 13) return 'th';
  switch (day % 10) {
    case 1: return 'st';
    case 2: return 'nd';
    case 3: return 'rd';
    default: return 'th';
  }
}

/** Format YYYY-MM-DD as "Wednesday 12th March" */
function formatDateUK(dateStr: string): string {
  const date = parseISO(dateStr);
  const dayName = format(date, 'EEEE');
  const dayNum = date.getDate();
  const month = format(date, 'MMMM');
  return `${dayName} ${dayNum}${getOrdinalSuffix(dayNum)} ${month}`;
}

/** Format slot array into readable text */
function formatSlots(slots: ('am' | 'pm' | 'full')[]): string {
  if (slots.includes('full')) return 'All day';
  if (slots.includes('am') && slots.includes('pm')) return 'AM / PM';
  if (slots.includes('am')) return 'AM';
  if (slots.includes('pm')) return 'PM';
  return 'All day';
}

/**
 * Clean job description for WhatsApp message.
 * - Strips trailing punctuation for clean formatting
 * - Capitalises first letter
 * - Shows full description (customer needs to see the complete scope)
 */
function cleanJobDescription(desc: string): string {
  let clean = desc.trim();

  // Strip trailing punctuation and whitespace
  clean = clean.replace(/[\s.\-,;:]+$/, '').trim();

  // Capitalise first letter
  if (clean.length > 0) {
    clean = clean.charAt(0).toUpperCase() + clean.slice(1);
  }

  return clean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Segment closing lines
// ─────────────────────────────────────────────────────────────────────────────

export function getSegmentClosingLine(segment: string): string {
  switch (segment) {
    case 'LANDLORD':
    case 'PROP_MGR':
      return 'Tap the link above to book a slot. We\'re happy to coordinate with your tenant on timing.';
    case 'BUSY_PRO':
      return 'Tap the link above to pick a slot — we\'ll handle the rest.';
    case 'OAP':
    case 'TRUST_SEEKER':
    case 'OLDER_WOMAN':
      return 'Tap the link above when you\'re ready to book. I\'m here if you have any questions at all.';
    case 'SMALL_BIZ':
      return 'Tap the link above to book a slot that works around your hours.';
    default:
      return 'Tap the link above to book a slot that works for you.';
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Main builder
// ─────────────────────────────────────────────────────────────────────────────

export function buildQuoteWhatsAppMessage({
  firstName,
  jobDescription,
  quoteUrl,
  segment,
  availableDates,
}: QuoteMessageParams): string {
  const cleanDesc = cleanJobDescription(jobDescription);
  const closing = getSegmentClosingLine(segment);

  const lines: string[] = [
    `Hi ${firstName},`,
    '',
    `Thanks for getting in touch! Here's your quote:`,
    '',
    `*Job:* ${cleanDesc}`,
    '',
    `View details, check dates and book directly:`,
    quoteUrl,
  ];

  // Availability section (up to 3 dates) — framed as bookable slots
  // Filter out today since same-day booking isn't available (matches quote page DateSelector)
  const dates = availableDates
    .filter(d => !isToday(parseISO(d.date)))
    .slice(0, 3);
  if (dates.length > 0) {
    lines.push('');
    lines.push('*We have a few slots available:*');
    for (const d of dates) {
      lines.push(`• ${formatDateUK(d.date)} — ${formatSlots(d.slots)}`);
    }
  }

  lines.push('');
  lines.push(closing);
  lines.push('');
  lines.push('_4.9★ rated · £2M insured_');

  return lines.join('\n');
}
