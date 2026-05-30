import { motion } from 'framer-motion';
import { Check } from 'lucide-react';
import { useEffect, useState } from 'react';

interface ConfirmationHeaderProps {
  customerName: string;
  depositAmount: number;
  jobTopLine?: string;
  mode?: 'exact' | 'flexible';
  paidInFull?: boolean;
  contractorName?: string;
  dateLabel?: string | null;
  slotLabel?: string | null;
  flexWindowDays?: number;
}

export function ConfirmationHeader({
  customerName,
  depositAmount,
  jobTopLine,
  mode = 'exact',
  paidInFull = false,
  contractorName,
  dateLabel,
  slotLabel,
  flexWindowDays = 7,
}: ConfirmationHeaderProps) {
  const [showConfetti, setShowConfetti] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => setShowConfetti(false), 3000);
    return () => clearTimeout(timer);
  }, []);

  const firstName = customerName?.split(' ')[0] || 'there';
  const depositFormatted = (depositAmount / 100).toFixed(2);

  // Mode-aware reassurance line. Exact = a named contractor is locked to a date;
  // flexible = we slot them in and confirm the day a few days out.
  let subhead: string;
  if (mode === 'flexible') {
    subhead = `You're booked in, ${firstName}. We'll fit your job in within ${flexWindowDays} days and confirm your exact day by WhatsApp a few days before.`;
  } else if (contractorName && dateLabel) {
    subhead = `You're all set, ${firstName}. ${contractorName} is booked in for ${dateLabel}${slotLabel ? `, ${slotLabel}` : ''}.`;
  } else if (dateLabel) {
    subhead = `You're all set, ${firstName}. Your ${dateLabel} slot is locked in. We're confirming your contractor now.`;
  } else {
    subhead = `Thanks, ${firstName}. Your booking is confirmed and we're sorting the details now.`;
  }

  return (
    <div className="relative text-center py-8 overflow-hidden">
      {/* Confetti Animation */}
      {showConfetti && (
        <div className="absolute inset-0 pointer-events-none">
          {[...Array(20)].map((_, i) => (
            <motion.div
              key={i}
              className="absolute w-2 h-2 rounded-full"
              style={{
                left: `${Math.random() * 100}%`,
                backgroundColor: ['#1B2A4A', '#F5A623', '#FFF8EC', '#F5A623', '#1B2A4A'][
                  Math.floor(Math.random() * 5)
                ],
              }}
              initial={{ y: -20, opacity: 1, scale: 0 }}
              animate={{
                y: 300,
                opacity: 0,
                scale: 1,
                rotate: Math.random() * 360,
              }}
              transition={{
                duration: 2 + Math.random(),
                delay: Math.random() * 0.5,
                ease: 'easeOut',
              }}
            />
          ))}
        </div>
      )}

      {/* Animated Checkmark Circle */}
      <motion.div
        className="relative inline-flex items-center justify-center w-24 h-24 mx-auto mb-6"
        initial={{ scale: 0 }}
        animate={{ scale: 1 }}
        transition={{ type: 'spring', stiffness: 200, damping: 15, delay: 0.2 }}
      >
        {/* Outer glow */}
        <motion.div
          className="absolute inset-0 bg-handy-yellow/30 rounded-full"
          initial={{ scale: 0 }}
          animate={{ scale: 1.5, opacity: 0 }}
          transition={{ duration: 1, delay: 0.5 }}
        />

        {/* Main circle */}
        <div className="absolute inset-0 bg-handy-navy rounded-full shadow-lg shadow-handy-navy/30 ring-4 ring-handy-yellow/40" />

        {/* Check icon with draw animation */}
        <motion.div
          initial={{ pathLength: 0, opacity: 0 }}
          animate={{ pathLength: 1, opacity: 1 }}
          transition={{ duration: 0.5, delay: 0.4 }}
        >
          <Check className="relative z-10 h-12 w-12 text-white" strokeWidth={3} />
        </motion.div>
      </motion.div>

      {/* Main heading */}
      <motion.h1
        className="text-3xl md:text-4xl font-bold text-handy-navy mb-2"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.5 }}
      >
        Booking Confirmed!
      </motion.h1>

      {jobTopLine && (
        <motion.p
          className="text-lg text-handy-navy/70 italic mb-1"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.55 }}
        >
          "{jobTopLine}"
        </motion.p>
      )}

      <motion.p
        className="text-xl text-handy-navy/90 mb-4"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.6 }}
      >
        {subhead}
      </motion.p>

      {/* Deposit badge */}
      <motion.div
        className="inline-flex items-center gap-2 bg-handy-cream border border-handy-yellow/40 rounded-full px-6 py-3"
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ delay: 0.7 }}
      >
        <span className="text-handy-navy/70 text-sm">{paidInFull ? 'Paid in full:' : 'Deposit paid:'}</span>
        <span className="text-handy-navy font-bold text-xl">£{depositFormatted}</span>
      </motion.div>
    </div>
  );
}
