import { motion } from 'framer-motion';
import { Card, CardContent } from '@/components/ui/card';
import { Phone, Calendar, Wrench, CheckCircle2 } from 'lucide-react';

interface WhatsNextCardProps {
  scheduledDate?: Date | string | null;
  contractorName?: string;
}

export function WhatsNextCard({ scheduledDate, contractorName }: WhatsNextCardProps) {
  const steps = [
    {
      icon: Phone,
      title: 'Confirmation Call',
      description: "We'll call you within 24 hours to confirm all details",
      status: 'upcoming',
    },
    {
      icon: Calendar,
      title: 'Reminder',
      description: "You'll receive a reminder the day before your booking",
      status: 'pending',
    },
    {
      icon: Wrench,
      title: 'Job Completed',
      description: contractorName
        ? `${contractorName} will complete the work & collect balance`
        : 'Our contractor completes the work & collects balance',
      status: 'pending',
    },
    {
      icon: CheckCircle2,
      title: 'Review',
      description: "Share your experience and help others find great service",
      status: 'pending',
    },
  ];

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.4 }}
    >
      <Card className="bg-gray-800/60 border-gray-700">
        <CardContent className="p-6">
          <h3 className="text-lg font-semibold text-white mb-4">What Happens Next?</h3>

          <div className="relative">
            {/* Vertical line connector */}
            <div className="absolute left-4 top-6 bottom-6 w-0.5 bg-gray-700" />

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
                          ? 'bg-[#e8b323] text-gray-900'
                          : 'bg-gray-700 text-gray-400'
                      }`}
                    >
                      {index + 1}
                    </div>

                    {/* Step content */}
                    <div className="flex-1 pb-2">
                      <div className="flex items-center gap-2 mb-1">
                        <Icon
                          className={`w-4 h-4 ${
                            isFirst ? 'text-[#e8b323]' : 'text-gray-500'
                          }`}
                        />
                        <h4
                          className={`font-medium ${
                            isFirst ? 'text-white' : 'text-gray-400'
                          }`}
                        >
                          {step.title}
                        </h4>
                      </div>
                      <p className="text-sm text-gray-500">{step.description}</p>
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
