import { motion } from 'framer-motion';
import {
  Banknote, Check, CalendarDays, CalendarPlus, MessageCircle, Phone, Receipt, Star, Sparkles,
} from 'lucide-react';
import { format, isValid } from 'date-fns';

/**
 * PaidBookingHero — the confirmed-state hero for a quote link reopened AFTER
 * payment. Customers open their link a median of 7 times; every open after the
 * deposit lands should read as "you're booked", not the sales pitch again.
 *
 * Purely props-driven — NO data fetching. The integrating page resolves the
 * quote/invoice state and passes it down.
 */
export interface PaidBookingHeroProps {
  customerName: string;
  jobDescription: string;
  /** Booked date. null/invalid → flex-deadline framing (if flexDeadline given) or "we're confirming" fallback. */
  selectedDate: string | Date | null;
  /**
   * Flex bookings have no selectedDate by design — the customer traded the exact
   * day for a guaranteed-by deadline. When set (and selectedDate is absent) the
   * date block renders as a confident "guaranteed done by" promise, never as
   * "we're still confirming".
   */
  flexDeadline?: string | Date | null;
  depositPaidPence: number;
  balanceDuePence: number;
  totalPence: number;
  invoiceNumber?: string;
  /** When present, renders "View invoice / Pay balance" linking to /invoice/${portalToken}. */
  portalToken?: string;
  whatsappUrl?: string;
  phoneNumber?: string;
  /** When true, swaps framing to "Job complete" with review + book-again CTAs. */
  jobCompleted?: boolean;
  /** Google review link — review CTA only renders when provided. */
  reviewUrl?: string;
}

/** £12.50 for odd pence, £125 for whole pounds — matches quote-page price idiom. */
function formatMoney(pence: number): string {
  return pence % 100 === 0 ? `£${pence / 100}` : `£${(pence / 100).toFixed(2)}`;
}

/** Parse the incoming date prop defensively — strings from the API may be null/garbage. */
function parseDate(value: string | Date | null): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return isValid(date) ? date : null;
}

export function PaidBookingHero({
  customerName,
  jobDescription,
  selectedDate,
  flexDeadline,
  depositPaidPence,
  balanceDuePence,
  totalPence,
  invoiceNumber,
  portalToken,
  whatsappUrl = 'https://wa.me/447508744402',
  phoneNumber = '+447449501762',
  jobCompleted = false,
  reviewUrl,
}: PaidBookingHeroProps) {
  const firstName = customerName?.split(' ')[0] || 'there';
  const jobDate = parseDate(selectedDate);
  const dateLabel = jobDate ? format(jobDate, 'EEEE d MMMM') : null;
  const deadline = !jobDate ? parseDate(flexDeadline ?? null) : null;
  const deadlineLabel = deadline ? format(deadline, 'EEEE d MMMM') : null;
  const paidInFull = balanceDuePence <= 0;

  // Generate and download an .ics client-side (mirrors BookingConfirmedPage).
  // 9am–12pm placeholder window — the day-before reminder carries the real one.
  const handleAddToCalendar = () => {
    if (!jobDate) return;

    const startDate = format(jobDate, "yyyyMMdd'T'090000");
    const endDate = format(jobDate, "yyyyMMdd'T'120000");
    const reference = invoiceNumber || format(jobDate, 'yyyyMMdd');

    const icsContent = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Handy Services//Booking//EN
BEGIN:VEVENT
UID:${reference}@handyservices.co.uk
DTSTAMP:${format(new Date(), "yyyyMMdd'T'HHmmss'Z'")}
DTSTART:${startDate}
DTEND:${endDate}
SUMMARY:Handy Services - ${jobDescription.substring(0, 50)}
DESCRIPTION:Your handyman booking.${invoiceNumber ? ` Reference: ${invoiceNumber}` : ''}
STATUS:CONFIRMED
END:VEVENT
END:VCALENDAR`;

    const blob = new Blob([icsContent], { type: 'text/calendar' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `handy-services-booking-${reference}.ics`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  // Book-again WhatsApp deep link — reuse the customer's existing thread with a prefill.
  const bookAgainUrl = `${whatsappUrl}${whatsappUrl.includes('?') ? '&' : '?'}text=${encodeURIComponent(
    "Hi, you did a job for me recently — I'd like to book something else in",
  )}`;

  // Balance-settling fallback when the invoice/portal isn't available yet —
  // a paid-state page with money owed must never be a dead end.
  const settleBalanceUrl = `${whatsappUrl}${whatsappUrl.includes('?') ? '&' : '?'}text=${encodeURIComponent(
    "Hi, my job's done — I'd like to settle my remaining balance",
  )}`;

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      className="bg-[#1D2D3D] rounded-3xl overflow-hidden shadow-2xl"
    >
      <div className="px-5 py-7 sm:px-8 sm:py-8 text-center">
        {/* Green check — the single loudest signal on the page */}
        <motion.div
          className="relative inline-flex items-center justify-center w-16 h-16 mx-auto mb-4"
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ type: 'spring', stiffness: 200, damping: 15, delay: 0.15 }}
        >
          <div className="absolute inset-0 bg-[#7DB00E] rounded-full shadow-lg shadow-[#7DB00E]/30 ring-4 ring-[#7DB00E]/25" />
          <Check className="relative z-10 w-8 h-8 text-white" strokeWidth={3} />
        </motion.div>

        <motion.h1
          className="text-3xl sm:text-4xl font-black text-white mb-1.5"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.25 }}
        >
          {jobCompleted ? 'Job complete' : "You're booked"}
        </motion.h1>

        <motion.p
          className="text-white/70 text-[15px] leading-snug max-w-sm mx-auto"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
        >
          {jobCompleted
            ? `Thanks, ${firstName} — your job is done and dusted. We hope everything's spot on.`
            : `All confirmed, ${firstName}. Nothing more to do — we'll take it from here.`}
        </motion.p>

        {/* Job date — the fact customers reopen the link to check */}
        {!jobCompleted && (
          <motion.div
            className="mt-5 bg-[#7DB00E] rounded-2xl px-5 py-4"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.35 }}
          >
            <div className="flex items-center justify-center gap-2 text-white/85 text-xs font-semibold uppercase tracking-wide mb-0.5">
              <CalendarDays className="w-3.5 h-3.5" />
              {dateLabel ? 'Your job date' : deadlineLabel ? 'Guaranteed done by' : 'Your job date'}
            </div>
            <div className="text-white text-2xl font-black leading-tight">
              {dateLabel || deadlineLabel || "We're confirming your date"}
            </div>
            {!dateLabel && (
              <div className="text-white/85 text-xs mt-1">
                {deadlineLabel
                  ? "You chose our flexible slot — we pick the exact day and WhatsApp you at least a day ahead."
                  : "We'll WhatsApp you as soon as your slot is locked."}
              </div>
            )}
          </motion.div>
        )}

        {/* Job summary line */}
        <motion.p
          className="mt-4 text-white/60 text-sm leading-snug max-w-sm mx-auto line-clamp-2"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.4 }}
        >
          {jobDescription}
        </motion.p>

        {/* Money breakdown — deposit paid vs balance due */}
        <motion.div
          className="mt-5 bg-white/[0.06] border border-white/10 rounded-2xl divide-y divide-white/10 text-left"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.45 }}
        >
          <div className="flex items-center justify-between px-4 py-2.5">
            <span className="text-white/60 text-sm">Job total</span>
            <span className="text-white font-bold tabular-nums">{formatMoney(totalPence)}</span>
          </div>
          <div className="flex items-center justify-between px-4 py-2.5">
            <span className="flex items-center gap-1.5 text-white/60 text-sm">
              <span className="w-4 h-4 rounded-full bg-[#7DB00E] flex items-center justify-center">
                <Check className="w-2.5 h-2.5 text-white" strokeWidth={3.5} />
              </span>
              {paidInFull ? 'Paid in full' : 'Deposit paid'}
            </span>
            <span className="text-[#a3d65f] font-bold tabular-nums">{formatMoney(depositPaidPence)}</span>
          </div>
          <div className="flex items-center justify-between px-4 py-2.5">
            <span className="text-white/60 text-sm">
              {paidInFull ? 'Left to pay' : jobCompleted ? 'Balance due' : 'Balance due on completion'}
            </span>
            <span className={`font-bold tabular-nums ${paidInFull ? 'text-[#a3d65f]' : 'text-white'}`}>
              {paidInFull ? 'Nothing' : formatMoney(balanceDuePence)}
            </span>
          </div>
          {invoiceNumber && (
            <div className="flex items-center justify-between px-4 py-2.5">
              <span className="text-white/60 text-sm">Invoice</span>
              <span className="text-white/80 text-sm font-semibold tabular-nums">{invoiceNumber}</span>
            </div>
          )}
        </motion.div>

        {/* Primary actions */}
        <motion.div
          className="mt-5 space-y-2.5"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.5 }}
        >
          {jobCompleted ? (
            <>
              {/* Job done + money owed — settling the balance IS the page's job.
                  Loudest button, before the review/rebook asks. */}
              {!paidInFull &&
                (portalToken ? (
                  <a
                    href={`/invoice/${portalToken}`}
                    className="w-full flex items-center justify-center gap-2 bg-[#7DB00E] hover:bg-[#6da00c] text-white font-bold text-[15px] rounded-xl px-4 py-3.5 transition-colors"
                  >
                    <Banknote className="w-[18px] h-[18px]" />
                    Pay remaining balance — {formatMoney(balanceDuePence)}
                  </a>
                ) : (
                  <a
                    href={settleBalanceUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="w-full flex items-center justify-center gap-2 bg-[#7DB00E] hover:bg-[#6da00c] text-white font-bold text-[15px] rounded-xl px-4 py-3.5 transition-colors"
                  >
                    <MessageCircle className="w-[18px] h-[18px]" />
                    Settle your balance — {formatMoney(balanceDuePence)}
                  </a>
                ))}
              {/* Review + repeat business — review takes the solid treatment only
                  once nothing is owed, so the pay CTA never has to compete. */}
              {reviewUrl && (
                <a
                  href={reviewUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={`w-full flex items-center justify-center gap-2 font-bold text-[15px] rounded-xl px-4 py-3.5 transition-colors ${
                    paidInFull
                      ? 'bg-[#7DB00E] hover:bg-[#6da00c] text-white'
                      : 'bg-white/10 hover:bg-white/15 border border-white/15 text-white'
                  }`}
                >
                  <Star className="w-[18px] h-[18px] fill-current" />
                  Happy with the work? Leave us a Google review
                </a>
              )}
              <a
                href={bookAgainUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="w-full flex items-center justify-center gap-2 bg-white/10 hover:bg-white/15 border border-white/15 text-white font-semibold text-[15px] rounded-xl px-4 py-3.5 transition-colors"
              >
                <Sparkles className="w-[18px] h-[18px] text-[#a3d65f]" />
                Need anything else done? Book your next job
              </a>
            </>
          ) : (
            jobDate && (
              <button
                type="button"
                onClick={handleAddToCalendar}
                className="w-full flex items-center justify-center gap-2 bg-white hover:bg-slate-100 text-[#1D2D3D] font-bold text-[15px] rounded-xl px-4 py-3.5 transition-colors"
              >
                <CalendarPlus className="w-[18px] h-[18px]" />
                Add to calendar
              </button>
            )
          )}

          {/* Ghost invoice link — hidden when the primary pay CTA above already
              owns the portal destination. */}
          {portalToken && !(jobCompleted && !paidInFull) && (
            <a
              href={`/invoice/${portalToken}`}
              className="w-full flex items-center justify-center gap-2 bg-white/10 hover:bg-white/15 border border-white/15 text-white font-semibold text-[15px] rounded-xl px-4 py-3.5 transition-colors"
            >
              <Receipt className="w-[18px] h-[18px] text-[#a3d65f]" />
              {paidInFull ? 'View invoice' : 'View invoice / Pay balance'}
            </a>
          )}
        </motion.div>

        {/* Contact strip — WhatsApp first (customers live there), call as backup */}
        <motion.div
          className="mt-4 grid grid-cols-2 gap-2.5"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.55 }}
        >
          <a
            href={whatsappUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-center gap-1.5 bg-white/[0.06] hover:bg-white/10 border border-white/10 text-white/90 font-semibold text-sm rounded-xl px-3 py-3 transition-colors"
          >
            <MessageCircle className="w-4 h-4 text-[#a3d65f]" />
            WhatsApp us
          </a>
          <a
            href={`tel:${phoneNumber}`}
            className="flex items-center justify-center gap-1.5 bg-white/[0.06] hover:bg-white/10 border border-white/10 text-white/90 font-semibold text-sm rounded-xl px-3 py-3 transition-colors"
          >
            <Phone className="w-4 h-4 text-[#a3d65f]" />
            Call us
          </a>
        </motion.div>
      </div>
    </motion.div>
  );
}

export default PaidBookingHero;
