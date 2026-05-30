import { motion } from 'framer-motion';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ExternalLink, FileText, Star, CreditCard } from 'lucide-react';

interface PortalIntroCardProps {
  portalToken?: string;
  invoiceNumber?: string;
  onViewPortal: () => void;
}

export function PortalIntroCard({
  portalToken,
  invoiceNumber,
  onViewPortal,
}: PortalIntroCardProps) {
  const portalUrl = portalToken ? `/invoice/${portalToken}` : null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.5 }}
    >
      <Card className="bg-white border-handy-grid shadow-sm">
        <CardContent className="p-6">
          <h3 className="text-lg font-bold text-handy-navy mb-1">
            Track Your Booking Online
          </h3>
          <div className="h-0.5 w-12 bg-handy-yellow rounded-full mb-3" />
          <p className="text-handy-muted text-sm mb-4">
            Access your booking portal anytime to view your invoice, pay the balance, or leave a review.
          </p>

          {/* Portal features */}
          <div className="grid grid-cols-3 gap-4 mb-6">
            <div className="text-center">
              <div className="w-10 h-10 mx-auto rounded-full bg-handy-yellow/15 flex items-center justify-center mb-2">
                <FileText className="w-5 h-5 text-handy-navy" />
              </div>
              <p className="text-xs text-handy-muted">View Invoice</p>
            </div>
            <div className="text-center">
              <div className="w-10 h-10 mx-auto rounded-full bg-handy-yellow/15 flex items-center justify-center mb-2">
                <CreditCard className="w-5 h-5 text-handy-navy" />
              </div>
              <p className="text-xs text-handy-muted">Pay Balance</p>
            </div>
            <div className="text-center">
              <div className="w-10 h-10 mx-auto rounded-full bg-handy-yellow/15 flex items-center justify-center mb-2">
                <Star className="w-5 h-5 text-handy-navy" />
              </div>
              <p className="text-xs text-handy-muted">Leave Review</p>
            </div>
          </div>

          {portalUrl ? (
            <Button
              onClick={onViewPortal}
              className="w-full bg-handy-navy hover:bg-handy-navy/90 text-white font-semibold"
              size="lg"
            >
              <ExternalLink className="w-4 h-4 mr-2" />
              View My Booking Portal
            </Button>
          ) : (
            <p className="text-sm text-handy-muted text-center">
              Portal link will be sent to your email shortly.
            </p>
          )}

          {invoiceNumber && (
            <p className="text-xs text-center text-handy-muted mt-3">
              Invoice: {invoiceNumber}
            </p>
          )}
        </CardContent>
      </Card>
    </motion.div>
  );
}
