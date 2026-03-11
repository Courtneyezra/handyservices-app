import { format, parseISO } from 'date-fns';

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
 * Clean job description for use as a standalone label line.
 * - Takes only the first line / sentence if multi-line
 * - Strips trailing punctuation for clean formatting
 * - Capitalises first letter
 * - Truncates to ~60 chars at a word boundary
 */
function cleanJobDescription(desc: string): string {
  // Take first line only
  let clean = desc.split(/[\n\r]/).filter(l => l.trim())[0] || desc;

  // Take first sentence if multiple
  clean = clean.split(/\.\s/)[0];

  // Strip trailing punctuation and whitespace
  clean = clean.replace(/[\s.\-,;:]+$/, '').trim();

  // Truncate at word boundary if too long
  if (clean.length > 60) {
    const trimmed = clean.substring(0, 60);
    const lastSpace = trimmed.lastIndexOf(' ');
    clean = (lastSpace > 20 ? trimmed.substring(0, lastSpace) : trimmed).replace(/[\s\-,]+$/, '');
  }

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
  const dates = availableDates.slice(0, 3);
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
