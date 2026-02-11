import { motion } from 'framer-motion';
import { Card, CardContent } from '@/components/ui/card';
import { FileText, MapPin, Calendar, Package, Clock } from 'lucide-react';
import { format } from 'date-fns';

interface BookingSummaryCardProps {
  jobDescription: string;
  postcode: string;
  scheduledDate?: Date | string | null;
  selectedPackage?: string;
  selectedExtras?: string[];
  invoiceNumber?: string;
  quoteReference: string;
}

export function BookingSummaryCard({
  jobDescription,
  postcode,
  scheduledDate,
  selectedPackage,
  selectedExtras = [],
  invoiceNumber,
  quoteReference,
}: BookingSummaryCardProps) {
  // Format date
  const formattedDate = scheduledDate
    ? format(new Date(scheduledDate), 'EEEE, d MMMM yyyy')
    : 'To be confirmed';

  // Truncate job description for display
  const truncatedJob =
    jobDescription.length > 80
      ? jobDescription.substring(0, 80) + '...'
      : jobDescription;

  // Format package name
  const formatPackageName = (pkg?: string) => {
    if (!pkg) return null;
    return pkg.charAt(0).toUpperCase() + pkg.slice(1).toLowerCase();
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.3 }}
    >
      <Card className="bg-gray-800/80 border-gray-700">
        <CardContent className="p-6">
          <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
            <FileText className="w-5 h-5 text-[#e8b323]" />
            Booking Details
          </h3>

          <div className="space-y-3 text-sm">
            {/* Job Description */}
            <div className="flex justify-between items-start">
              <span className="text-gray-400 flex items-center gap-2">
                <span className="w-4" />
                Job:
              </span>
              <span className="text-white font-medium text-right max-w-[60%]">
                {truncatedJob}
              </span>
            </div>

            {/* Location */}
            <div className="flex justify-between">
              <span className="text-gray-400 flex items-center gap-2">
                <MapPin className="w-4 h-4" />
                Location:
              </span>
              <span className="text-white font-medium">{postcode}</span>
            </div>

            {/* Date */}
            <div className="flex justify-between">
              <span className="text-gray-400 flex items-center gap-2">
                <Calendar className="w-4 h-4" />
                Date:
              </span>
              <span className="text-white font-medium">{formattedDate}</span>
            </div>

            {/* Package (if selected) */}
            {selectedPackage && (
              <div className="flex justify-between">
                <span className="text-gray-400 flex items-center gap-2">
                  <Package className="w-4 h-4" />
                  Package:
                </span>
                <span className="text-white font-medium">
                  {formatPackageName(selectedPackage)}
                </span>
              </div>
            )}

            {/* Add-ons (if any) */}
            {selectedExtras.length > 0 && (
              <div className="flex justify-between">
                <span className="text-gray-400 flex items-center gap-2">
                  <Clock className="w-4 h-4" />
                  Add-ons:
                </span>
                <span className="text-white font-medium">
                  {selectedExtras.length} selected
                </span>
              </div>
            )}

            {/* Reference */}
            <div className="flex justify-between pt-3 border-t border-gray-700">
              <span className="text-gray-400">Reference:</span>
              <span className="text-[#e8b323] font-mono font-medium">
                {invoiceNumber || quoteReference}
              </span>
            </div>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}
