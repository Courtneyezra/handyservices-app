import { motion } from 'framer-motion';
import { Check } from 'lucide-react';
import { useEffect, useState } from 'react';

interface ConfirmationHeaderProps {
  customerName: string;
  depositAmount: number;
}

export function ConfirmationHeader({ customerName, depositAmount }: ConfirmationHeaderProps) {
  const [showConfetti, setShowConfetti] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => setShowConfetti(false), 3000);
    return () => clearTimeout(timer);
  }, []);

  const firstName = customerName?.split(' ')[0] || 'there';
  const depositFormatted = (depositAmount / 100).toFixed(2);

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
                backgroundColor: ['#e8b323', '#22c55e', '#3b82f6', '#f97316', '#8b5cf6'][
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
          className="absolute inset-0 bg-green-500/20 rounded-full"
          initial={{ scale: 0 }}
          animate={{ scale: 1.5, opacity: 0 }}
          transition={{ duration: 1, delay: 0.5 }}
        />

        {/* Main circle */}
        <div className="absolute inset-0 bg-gradient-to-br from-green-400 to-green-600 rounded-full shadow-lg shadow-green-500/40" />

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
        className="text-3xl md:text-4xl font-bold text-green-400 mb-2"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.5 }}
      >
        Booking Confirmed!
      </motion.h1>

      <motion.p
        className="text-xl text-gray-200 mb-4"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.6 }}
      >
        Thanks, {firstName}. We've got it from here.
      </motion.p>

      {/* Deposit badge */}
      <motion.div
        className="inline-flex items-center gap-2 bg-green-500/20 border border-green-500/30 rounded-full px-6 py-3"
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ delay: 0.7 }}
      >
        <span className="text-gray-300 text-sm">Deposit paid:</span>
        <span className="text-green-400 font-bold text-xl">£{depositFormatted}</span>
      </motion.div>
    </div>
  );
}
