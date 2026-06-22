/**
 * WhatsApp message for a customer slot-offer ("confirm your date").
 *
 * The dispatch console doesn't send these automatically — the dispatcher COPIES the message
 * and pastes it into WhatsApp manually. So this builder produces the full, ready-to-send text
 * (greeting + the offered dates + the tokenised confirm link), not just the bare link.
 *
 * The wording mirrors what the customer sees on ConfirmSlotPage:
 *   - our RECOMMENDED day is free (keeps their flexible-booking discount), and
 *   - any OTHER offered day carries a small one-off premium (the forfeited discount).
 * The link is where they actually confirm (and pay any premium via Stripe Checkout).
 */
import { format } from 'date-fns';
import type { SlotCandidate, OfferSlot } from '@shared/slot-offer';

const HANDY_PHONE = '07449 501 762';

/** First name only (for the greeting); falls back to a friendly "there". */
function firstNameOf(fullName: string): string {
  return (fullName || '').trim().split(/\s+/)[0] || 'there';
}

function getOrdinalSuffix(day: number): string {
  if (day >= 11 && day <= 13) return 'th';
  switch (day % 10) {
    case 1: return 'st';
    case 2: return 'nd';
    case 3: return 'rd';
    default: return 'th';
  }
}

/** "2026-03-12" → "Wednesday 12th March" (parsed as a LOCAL date — no UTC drift). */
function formatDateUK(isoDate: string): string {
  const [y, m, d] = isoDate.split('-').map(Number);
  if (!y || !m || !d) return isoDate;
  const date = new Date(y, m - 1, d);
  return `${format(date, 'EEEE')} ${d}${getOrdinalSuffix(d)} ${format(date, 'MMMM')}`;
}

/** AM → "Morning (8am–1pm)", PM → "Afternoon (1–6pm)" — matches ConfirmSlotPage. */
function slotWindowLabel(slot: OfferSlot): string {
  return slot === 'am' ? 'Morning (8am–1pm)' : 'Afternoon (1–6pm)';
}

/** Whole pounds when exact, else 2dp (mirrors ConfirmSlotPage's price formatter). */
function formatPounds(pence: number): string {
  return `£${(pence / 100).toFixed(pence % 100 === 0 ? 0 : 2)}`;
}

export interface SlotOfferMessageParams {
  customerName: string;
  candidates: SlotCandidate[];
  /** The tokenised /confirm-slot link the customer taps to pick a date. */
  confirmUrl: string;
}

/**
 * Build the full WhatsApp message a dispatcher copies + pastes to a customer to confirm
 * their booking date. Recommended day is shown first and marked free; premium days show
 * the one-off top-up.
 */
export function buildSlotOfferWhatsAppMessage({
  customerName,
  candidates,
  confirmUrl,
}: SlotOfferMessageParams): string {
  const name = firstNameOf(customerName);
  // Recommended (free) first — mirrors the customer page ordering.
  const ordered = [...candidates].sort((a, b) => Number(b.recommended) - Number(a.recommended));
  const hasPremium = ordered.some((c) => c.premiumPence > 0);

  const lines: string[] = [
    `Hi ${name},`,
    '',
    `Good news — you're all paid up and we're ready to book you in. Here are the dates we've got for you:`,
    '',
  ];

  for (const c of ordered) {
    const when = `${formatDateUK(c.date)} — ${slotWindowLabel(c.slot)}`;
    lines.push(
      c.premiumPence > 0
        ? `• ${when} (+${formatPounds(c.premiumPence)})`
        : `• ${when} ✅ *our pick — no extra cost*`,
    );
  }

  lines.push('');
  lines.push('Tap here to confirm the day that suits you best:');
  lines.push(confirmUrl);

  if (hasPremium) {
    lines.push('');
    lines.push(
      'Our recommended day keeps your flexible-booking discount (free). Any other day carries a small one-off charge.',
    );
  }

  lines.push('');
  lines.push(`Any questions, just reply here or call ${HANDY_PHONE}.`);

  return lines.join('\n');
}
