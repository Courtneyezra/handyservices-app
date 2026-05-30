import { motion } from 'framer-motion';
import { Card, CardContent } from '@/components/ui/card';
import { FileText, MapPin, Calendar, Package, Clock } from 'lucide-react';
import { format } from 'date-fns';

interface BookingSummaryCardProps {
  jobDescription: string;
  postcode: string;
  scheduledDate?: Date | string | null;
  timeSlotType?: string;
  exactTimeRequested?: string;
  selectedPackage?: string;
  selectedExtras?: string[];
  invoiceNumber?: string;
  quoteReference: string;
}

export function BookingSummaryCard({
  jobDescription,
  postcode,
  scheduledDate,
  timeSlotType,
  exactTimeRequested,
  selectedPackage,
  selectedExtras = [],
  invoiceNumber,
  quoteReference,
}: BookingSummaryCardProps) {
  // Format date
  const formattedDate = scheduledDate
    ? format(new Date(scheduledDate), 'EEEE, d MMMM yyyy')
    : 'To be confirmed';

  // Format time slot
  const formatTimeSlot = (slot?: string, exactTime?: string) => {
    if (exactTime) return exactTime;
    switch (slot) {
      case 'morning': return 'Morning (8am - 12pm)';
      case 'afternoon': return 'Afternoon (12pm - 5pm)';
      case 'first': return 'First Slot (8am - 9am)';
      case 'exact': return exactTime || 'Exact Time';
      case 'anytime': return 'Any Time';
      default: return null;
    }
  };
  const formattedTimeSlot = formatTimeSlot(timeSlotType, exactTimeRequested);

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
      <Card className="bg-white border-handy-grid shadow-sm">
        <CardContent className="p-6">
          <h3 className="text-lg font-bold text-handy-navy mb-1 flex items-center gap-2">
            <FileText className="w-5 h-5 text-handy-yellow" />
            Booking Details
          </h3>
          <div className="h-0.5 w-12 bg-handy-yellow rounded-full mb-4" />

          <div className="space-y-3 text-sm">
            {/* Job Description */}
            <div className="flex justify-between items-start">
              <span className="text-handy-muted flex items-center gap-2">
                <span className="w-4" />
                Job:
              </span>
              <span className="text-handy-navy font-medium text-right max-w-[60%]">
                {truncatedJob}
              </span>
            </div>

            {/* Location */}
            <div className="flex justify-between">
              <span className="text-handy-muted flex items-center gap-2">
                <MapPin className="w-4 h-4" />
                Location:
              </span>
              <span className="text-handy-navy font-medium">{postcode}</span>
            </div>

            {/* Date */}
            <div className="flex justify-between">
              <span className="text-handy-muted flex items-center gap-2">
                <Calendar className="w-4 h-4" />
                Date:
              </span>
              <span className="text-handy-navy font-medium">{formattedDate}</span>
            </div>

            {/* Time Slot */}
            {formattedTimeSlot && (
              <div className="flex justify-between">
                <span className="text-handy-muted flex items-center gap-2">
                  <Clock className="w-4 h-4" />
                  Time:
                </span>
                <span className="text-handy-navy font-medium">{formattedTimeSlot}</span>
              </div>
            )}

            {/* Package (if selected) */}
            {selectedPackage && (
              <div className="flex justify-between">
                <span className="text-handy-muted flex items-center gap-2">
                  <Package className="w-4 h-4" />
                  Package:
                </span>
                <span className="text-handy-navy font-medium">
                  {formatPackageName(selectedPackage)}
                </span>
              </div>
            )}

            {/* Add-ons (if any) */}
            {selectedExtras.length > 0 && (
              <div className="flex justify-between">
                <span className="text-handy-muted flex items-center gap-2">
                  <Clock className="w-4 h-4" />
                  Add-ons:
                </span>
                <span className="text-handy-navy font-medium">
                  {selectedExtras.length} selected
                </span>
              </div>
            )}

            {/* Reference */}
            <div className="flex justify-between pt-3 border-t border-handy-grid">
              <span className="text-handy-muted">Reference:</span>
              <span className="text-handy-navy font-mono font-medium">
                {invoiceNumber || quoteReference}
              </span>
            </div>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}
