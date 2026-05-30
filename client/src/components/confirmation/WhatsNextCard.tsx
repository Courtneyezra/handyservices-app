import { motion } from 'framer-motion';
import { Card, CardContent } from '@/components/ui/card';
import { CalendarCheck, CalendarClock, MessageCircle, Wrench, Star } from 'lucide-react';

interface WhatsNextCardProps {
  mode?: 'exact' | 'flexible';
  paidInFull?: boolean;
  contractorName?: string;
  dateLabel?: string | null;
  slotLabel?: string | null;
  flexWindowDays?: number;
  balanceLabel?: string | null;
}

export function WhatsNextCard({
  mode = 'exact',
  paidInFull = false,
  contractorName,
  dateLabel,
  slotLabel,
  flexWindowDays = 7,
  balanceLabel,
}: WhatsNextCardProps) {
  const who = contractorName || 'Your contractor';

  // Step 3 depends on payment state: paid-in-full = nothing to settle on the day.
  const workStep = paidInFull
    ? {
        icon: Wrench,
        title: `${who} does the work`,
        description: `${who} arrives and completes the job. Nothing more to pay, you're settled in full.`,
      }
    : {
        icon: Wrench,
        title: `${who} does the work`,
        description: `${who} completes the job and collects the${balanceLabel ? ` ${balanceLabel}` : ''} balance on the day.`,
      };
  const reviewStep = {
    icon: Star,
    title: 'Share your experience',
    description: 'Leave a quick review and help others find great service.',
  };

  // Step 1+2 depend on booking mode: exact = assigned contractor on a fixed day;
  // flexible = we slot you in and confirm the day a few days before.
  const steps =
    mode === 'flexible'
      ? [
          {
            icon: CalendarClock,
            title: "We're fitting you in",
            description: `Your job is booked. We're slotting it into our schedule within the next ${flexWindowDays} days.`,
          },
          {
            icon: MessageCircle,
            title: 'We confirm your day',
            description:
              "We'll WhatsApp your exact date and contractor a few days before, once your slot is locked.",
          },
          workStep,
          reviewStep,
        ]
      : [
          {
            icon: CalendarCheck,
            title: contractorName ? `${contractorName} is booked in` : 'Your slot is locked in',
            description: dateLabel
              ? `Confirmed for ${dateLabel}${slotLabel ? `, ${slotLabel}` : ''}. ${who} is assigned to your job.`
              : `${who} is assigned to your job.`,
          },
          {
            icon: MessageCircle,
            title: 'Day-before reminder',
            description: `We'll WhatsApp you the day before with ${contractorName ? `${contractorName}'s` : "your contractor's"} arrival window.`,
          },
          workStep,
          reviewStep,
        ];

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.4 }}
    >
      <Card className="bg-white border-handy-grid shadow-sm">
        <CardContent className="p-6">
          <h3 className="text-lg font-bold text-handy-navy mb-1">What Happens Next?</h3>
          <div className="h-0.5 w-12 bg-handy-yellow rounded-full mb-4" />

          <div className="relative">
            {/* Vertical line connector */}
            <div className="absolute left-4 top-6 bottom-6 w-0.5 bg-handy-grid" />

            <div className="space-y-6">
              {steps.map((step, index) => {
                const Icon = step.icon;
                const isFirst = index === 0;

                return (
                  <motion.div
                    key={index}
                    className="flex gap-4"
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: 0.5 + index * 0.1 }}
                  >
                    {/* Step number/icon */}
                    <div
                      className={`relative z-10 flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold ${
                        isFirst
                          ? 'bg-handy-navy text-white'
                          : 'bg-handy-grid text-handy-muted'
                      }`}
                    >
                      {index + 1}
                    </div>

                    {/* Step content */}
                    <div className="flex-1 pb-2">
                      <div className="flex items-center gap-2 mb-1">
                        <Icon
                          className={`w-4 h-4 ${
                            isFirst ? 'text-handy-yellow' : 'text-handy-muted'
                          }`}
                        />
                        <h4
                          className={`font-medium ${
                            isFirst ? 'text-handy-navy' : 'text-handy-muted'
                          }`}
                        >
                          {step.title}
                        </h4>
                      </div>
                      <p className="text-sm text-handy-muted">{step.description}</p>
                    </div>
                  </motion.div>
                );
              })}
            </div>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}
