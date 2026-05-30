import { motion } from 'framer-motion';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  Camera,
  Phone,
  Calendar,
  FileText,
  Clock,
  Key,
  Shield,
  Star,
  Zap,
  Users,
  Percent,
  Wrench,
} from 'lucide-react';
import { getSegmentConfirmationContent, type SegmentConfirmationContent } from '@/config/segment-confirmation-content';

const iconMap = {
  camera: Camera,
  phone: Phone,
  calendar: Calendar,
  'file-text': FileText,
  clock: Clock,
  key: Key,
  shield: Shield,
  star: Star,
  zap: Zap,
  users: Users,
  percent: Percent,
  wrench: Wrench,
};

interface SegmentValueCardProps {
  segment: string;
  onAction: (action: string) => void;
  portalToken?: string;
}

export function SegmentValueCard({ segment, onAction, portalToken }: SegmentValueCardProps) {
  const content = getSegmentConfirmationContent(segment);

  const handlePrimaryClick = () => {
    onAction(content.cta.action);
  };

  const handleSecondaryClick = () => {
    if (content.secondaryCta) {
      onAction(content.secondaryCta.action);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.4 }}
    >
      <Card className="bg-handy-cream border-handy-yellow/40 shadow-sm">
        <CardContent className="p-6">
          {/* Header */}
          <h3 className="text-xl font-bold text-handy-navy mb-1.5">{content.header}</h3>
          <div className="h-0.5 w-12 bg-handy-yellow rounded-full mb-3" />
          <p className="text-handy-navy/80 mb-4">{content.subheader}</p>

          {/* Benefit bullets */}
          <ul className="space-y-3 mb-6">
            {content.bullets.map((bullet, index) => {
              const Icon = iconMap[bullet.icon] || Star;
              return (
                <motion.li
                  key={index}
                  className="flex items-center gap-3 text-handy-navy"
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.5 + index * 0.1 }}
                >
                  <div className="flex-shrink-0 w-8 h-8 rounded-full bg-handy-yellow/20 flex items-center justify-center">
                    <Icon className="w-4 h-4 text-handy-navy" />
                  </div>
                  <span>{bullet.text}</span>
                </motion.li>
              );
            })}
          </ul>

          {/* CTAs */}
          <div className="space-y-3">
            <Button
              onClick={handlePrimaryClick}
              className={
                content.cta.variant === 'primary'
                  ? 'w-full bg-handy-navy hover:bg-handy-navy/90 text-white font-semibold'
                  : 'w-full bg-handy-navy hover:bg-handy-navy/90 text-white'
              }
              size="lg"
            >
              {content.cta.label}
            </Button>

            {content.secondaryCta && (
              <Button
                onClick={handleSecondaryClick}
                variant="outline"
                className="w-full border-handy-navy/30 text-handy-navy hover:bg-handy-navy/5"
                size="lg"
              >
                {content.secondaryCta.label}
              </Button>
            )}
          </div>

          {/* Trust strip */}
          <div className="mt-6 pt-4 border-t border-handy-grid">
            <p className="text-xs text-center text-handy-muted">{content.trustStrip}</p>
          </div>

          {/* Risk reversal */}
          <div className="mt-4 bg-handy-yellow/10 border border-handy-yellow/30 rounded-lg p-3">
            <p className="text-sm text-center text-handy-navy">{content.riskReversal}</p>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}
