import { motion } from 'framer-motion';
import { Check, CalendarCheck, MessageCircle, MapPin, Camera, Banknote } from 'lucide-react';
import { format, isValid, subDays } from 'date-fns';

/**
 * WhatsNextTimeline — calm vertical "what happens next" timeline shown under
 * the post-payment hero on the quote page. This is a trust surface, not a
 * sales surface: it exists so a customer reopening their link (median 7 opens)
 * can see exactly where their job is and what comes next.
 */

/** Stable keys for the five timeline steps, in order. */
export type WhatsNextStepKey = 'booked' | 'reminder' | 'arrival' | 'job_done' | 'balance';

const STEP_ORDER: WhatsNextStepKey[] = ['booked', 'reminder', 'arrival', 'job_done', 'balance'];

export interface WhatsNextTimelineProps {
  /** Which step the job is on — index (0–4) or key. Earlier steps render completed. */
  currentStep?: number | WhatsNextStepKey;
  /** Booked date — used to render real dates on the reminder/arrival steps. */
  selectedDate?: string | Date | null;
  /**
   * Flex bookings: guaranteed-done-by deadline. Used (when selectedDate is
   * absent) to frame the first steps as a deadline promise, not uncertainty.
   */
  flexDeadline?: string | Date | null;
  /** Balance collected on completion. 0 → "paid in full" framing on the last step. */
  balanceDuePence?: number;
}

/** £12.50 for odd pence, £125 for whole pounds — matches quote-page price idiom. */
function formatMoney(pence: number): string {
  return pence % 100 === 0 ? `£${pence / 100}` : `£${(pence / 100).toFixed(2)}`;
}

/** Parse the incoming date prop defensively — strings from the API may be null/garbage. */
function parseDate(value: string | Date | null | undefined): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return isValid(date) ? date : null;
}

export function WhatsNextTimeline({
  currentStep = 'booked',
  selectedDate,
  flexDeadline,
  balanceDuePence,
}: WhatsNextTimelineProps) {
  const currentIndex =
    typeof currentStep === 'number'
      ? Math.min(Math.max(currentStep, 0), STEP_ORDER.length - 1)
      : Math.max(STEP_ORDER.indexOf(currentStep), 0);

  const jobDate = parseDate(selectedDate);
  const arrivalLabel = jobDate ? format(jobDate, 'EEEE d MMMM') : null;
  const reminderLabel = jobDate ? format(subDays(jobDate, 1), 'EEEE d MMMM') : null;
  // Flex bookings have no exact day yet — by design, not by delay. Frame the
  // early steps around the guaranteed-by deadline instead of a vague "shortly".
  const deadline = !jobDate ? parseDate(flexDeadline) : null;
  const deadlineLabel = deadline ? format(deadline, 'EEEE d MMMM') : null;
  const paidInFull = (balanceDuePence ?? 0) <= 0;

  const steps: Array<{ key: WhatsNextStepKey; icon: typeof Check; title: string; description: string }> = [
    {
      key: 'booked',
      icon: CalendarCheck,
      title: 'Booked & confirmed',
      description: arrivalLabel
        ? `Your slot on ${arrivalLabel} is locked in. Nothing more to do.`
        : deadlineLabel
          ? `Your flexible booking is locked in — guaranteed done by ${deadlineLabel}.`
          : "Your job is locked in. We'll WhatsApp your exact date shortly.",
    },
    {
      key: 'reminder',
      icon: MessageCircle,
      title: deadlineLabel ? 'We confirm your day' : 'Reminder the day before',
      description: reminderLabel
        ? `We'll WhatsApp you on ${reminderLabel} with your arrival window.`
        : deadlineLabel
          ? "We'll WhatsApp your exact day and arrival window at least a day ahead."
          : "We'll WhatsApp you the day before with your arrival window.",
    },
    {
      key: 'arrival',
      icon: MapPin,
      title: 'We arrive',
      description: arrivalLabel
        ? `${arrivalLabel} — on time, in your confirmed arrival window.`
        : deadlineLabel
          ? `By ${deadlineLabel} at the latest — on time, in your confirmed window.`
          : 'On time, in your confirmed arrival window.',
    },
    {
      key: 'job_done',
      icon: Camera,
      title: 'Job done + photo report',
      description: 'We finish the work, tidy up, and send you photos of everything completed.',
    },
    {
      key: 'balance',
      icon: Banknote,
      title: paidInFull ? 'Nothing left to pay' : 'Balance due on completion',
      description: paidInFull
        ? "You're paid in full — nothing to settle on the day."
        : `The ${balanceDuePence ? `${formatMoney(balanceDuePence)} ` : ''}balance is settled once you're happy with the work.`,
    },
  ];

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: 0.15 }}
      className="bg-white border border-slate-200 rounded-3xl shadow-sm px-5 py-6 sm:px-7"
    >
      <h3 className="text-lg font-bold text-[#1D2D3D] mb-1">What happens next</h3>
      <div className="h-0.5 w-12 bg-[#7DB00E] rounded-full mb-5" />

      <div className="relative">
        {/* Vertical line connector behind the step markers */}
        <div className="absolute left-4 top-4 bottom-4 w-0.5 bg-slate-200" />

        <div className="space-y-5">
          {steps.map((step, index) => {
            const Icon = step.icon;
            const isCompleted = index < currentIndex;
            const isCurrent = index === currentIndex;

            return (
              <motion.div
                key={step.key}
                className="flex gap-3.5"
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.25 + index * 0.08 }}
              >
                {/* Step marker — green check when done, navy for now, muted for later */}
                <div
                  className={`relative z-10 shrink-0 w-8 h-8 rounded-full flex items-center justify-center ${
                    isCompleted
                      ? 'bg-[#7DB00E] text-white'
                      : isCurrent
                        ? 'bg-[#1D2D3D] text-white ring-4 ring-[#7DB00E]/20'
                        : 'bg-slate-100 text-slate-400'
                  }`}
                >
                  {isCompleted ? (
                    <Check className="w-4 h-4" strokeWidth={3} />
                  ) : (
                    <Icon className="w-4 h-4" />
                  )}
                </div>

                {/* Step content */}
                <div className="flex-1 min-w-0 pt-0.5">
                  <div className="flex items-center gap-2">
                    <h4
                      className={`text-[15px] font-semibold ${
                        isCurrent ? 'text-[#1D2D3D]' : isCompleted ? 'text-slate-600' : 'text-slate-400'
                      }`}
                    >
                      {step.title}
                    </h4>
                    {isCurrent && (
                      <span className="shrink-0 text-[10px] font-bold uppercase tracking-wide bg-[#7DB00E]/12 text-[#5b8a08] rounded-full px-2 py-0.5">
                        You are here
                      </span>
                    )}
                  </div>
                  <p className={`text-sm mt-0.5 ${isCurrent ? 'text-slate-600' : 'text-slate-400'}`}>
                    {step.description}
                  </p>
                </div>
              </motion.div>
            );
          })}
        </div>
      </div>
    </motion.div>
  );
}

export default WhatsNextTimeline;
