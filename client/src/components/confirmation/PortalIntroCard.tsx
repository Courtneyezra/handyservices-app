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
      <Card className="bg-gray-800/60 border-gray-700">
        <CardContent className="p-6">
          <h3 className="text-lg font-semibold text-white mb-3">
            Track Your Booking Online
          </h3>
          <p className="text-gray-400 text-sm mb-4">
            Access your booking portal anytime to view your invoice, pay the balance, or leave a review.
          </p>

          {/* Portal features */}
          <div className="grid grid-cols-3 gap-4 mb-6">
            <div className="text-center">
              <div className="w-10 h-10 mx-auto rounded-full bg-blue-500/20 flex items-center justify-center mb-2">
                <FileText className="w-5 h-5 text-blue-400" />
              </div>
              <p className="text-xs text-gray-400">View Invoice</p>
            </div>
            <div className="text-center">
              <div className="w-10 h-10 mx-auto rounded-full bg-green-500/20 flex items-center justify-center mb-2">
                <CreditCard className="w-5 h-5 text-green-400" />
              </div>
              <p className="text-xs text-gray-400">Pay Balance</p>
            </div>
            <div className="text-center">
              <div className="w-10 h-10 mx-auto rounded-full bg-yellow-500/20 flex items-center justify-center mb-2">
                <Star className="w-5 h-5 text-yellow-400" />
              </div>
              <p className="text-xs text-gray-400">Leave Review</p>
            </div>
          </div>

          {portalUrl ? (
            <Button
              onClick={onViewPortal}
              className="w-full bg-blue-600 hover:bg-blue-700"
              size="lg"
            >
              <ExternalLink className="w-4 h-4 mr-2" />
              View My Booking Portal
            </Button>
          ) : (
            <p className="text-sm text-gray-400 text-center">
              Portal link will be sent to your email shortly.
            </p>
          )}

          {invoiceNumber && (
            <p className="text-xs text-center text-gray-500 mt-3">
              Invoice: {invoiceNumber}
            </p>
          )}
        </CardContent>
      </Card>
    </motion.div>
  );
}
