import { Card, CardContent } from '@/components/ui/card';
import { Check, FileText, Phone, Mail, Calendar, MapPin, Clock } from 'lucide-react';
import { format } from 'date-fns';

export interface BookingConfirmationProps {
  customerName: string;
  depositPaidPence: number;
  jobDescription: string;
  postcode: string;
  selectedDate?: Date | string | null;
  invoiceNumber?: string;
  quoteSlug: string;
  email?: string | null;
  selectedPackage?: string;
  selectedExtras?: string[];
}

export function BookingConfirmation({
  customerName,
  depositPaidPence,
  jobDescription,
  postcode,
  selectedDate,
  invoiceNumber,
  quoteSlug,
  email,
  selectedPackage,
  selectedExtras = [],
}: BookingConfirmationProps) {
  // Format the date if provided
  const formattedDate = selectedDate
    ? format(new Date(selectedDate), 'EEEE, d MMMM yyyy')
    : 'To be confirmed';

  // Format deposit amount
  const depositFormatted = (depositPaidPence / 100).toFixed(2);

  // Truncate job description for display
  const truncatedJob = jobDescription.length > 60
    ? jobDescription.substring(0, 60) + '...'
    : jobDescription;

  return (
    <Card className="border-green-500 bg-gradient-to-b from-green-900/50 to-gray-800 border-2">
      <CardContent className="p-8">
        {/* Success Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-20 h-20 bg-green-500 rounded-full mb-4 shadow-lg shadow-green-500/30">
            <Check className="h-10 w-10 text-white" />
          </div>
          <h3 className="text-3xl font-bold text-green-400 mb-2">Payment Received!</h3>
          <p className="text-xl text-gray-200 mb-4">
            Your booking is confirmed
          </p>
          <div className="inline-flex items-center gap-2 bg-green-500/20 border border-green-500/30 rounded-lg px-4 py-2">
            <span className="text-gray-400 text-sm">Deposit paid:</span>
            <span className="text-green-400 font-bold text-lg">£{depositFormatted}</span>
          </div>
        </div>

        {/* Booking Details */}
        <div className="bg-gray-800/80 rounded-xl p-6 mb-6 border border-gray-700">
          <h4 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
            <FileText className="w-5 h-5 text-[#e8b323]" />
            Booking Details
          </h4>
          <div className="space-y-3 text-sm">
            <div className="flex justify-between items-start">
              <span className="text-gray-400 flex items-center gap-2">
                <span className="w-4" />Job:
              </span>
              <span className="text-white font-medium text-right max-w-[60%]">{truncatedJob}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-400 flex items-center gap-2">
                <MapPin className="w-4 h-4" />Location:
              </span>
              <span className="text-white font-medium">{postcode}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-400 flex items-center gap-2">
                <Calendar className="w-4 h-4" />Date:
              </span>
              <span className="text-white font-medium">{formattedDate}</span>
            </div>
            {selectedPackage && (
              <div className="flex justify-between">
                <span className="text-gray-400 flex items-center gap-2">
                  <span className="w-4" />Package:
                </span>
                <span className="text-white font-medium capitalize">{selectedPackage}</span>
              </div>
            )}
            {selectedExtras.length > 0 && (
              <div className="flex justify-between">
                <span className="text-gray-400 flex items-center gap-2">
                  <span className="w-4" />Add-ons:
                </span>
                <span className="text-white font-medium">{selectedExtras.length} selected</span>
              </div>
            )}
            <div className="flex justify-between pt-2 border-t border-gray-700">
              <span className="text-gray-400 flex items-center gap-2">
                <span className="w-4" />Reference:
              </span>
              <span className="text-[#e8b323] font-mono font-medium">{invoiceNumber || quoteSlug}</span>
            </div>
          </div>
        </div>

        {/* What Happens Next */}
        <div className="bg-[#e8b323]/10 rounded-xl p-6 mb-6 border border-[#e8b323]/30">
          <h4 className="text-lg font-semibold text-[#e8b323] mb-4 flex items-center gap-2">
            <Clock className="w-5 h-5" />
            What Happens Next?
          </h4>
          <div className="space-y-4">
            <div className="flex gap-3">
              <div className="flex-shrink-0 w-8 h-8 bg-[#e8b323] rounded-full flex items-center justify-center text-gray-900 font-bold text-sm">1</div>
              <div>
                <p className="text-white font-medium">Confirmation Call</p>
                <p className="text-gray-400 text-sm">We'll call you within 24 hours to confirm details</p>
              </div>
            </div>
            <div className="flex gap-3">
              <div className="flex-shrink-0 w-8 h-8 bg-[#e8b323] rounded-full flex items-center justify-center text-gray-900 font-bold text-sm">2</div>
              <div>
                <p className="text-white font-medium">Job Reminder</p>
                <p className="text-gray-400 text-sm">You'll receive a reminder the day before</p>
              </div>
            </div>
            <div className="flex gap-3">
              <div className="flex-shrink-0 w-8 h-8 bg-[#e8b323] rounded-full flex items-center justify-center text-gray-900 font-bold text-sm">3</div>
              <div>
                <p className="text-white font-medium">Job Completed</p>
                <p className="text-gray-400 text-sm">Our contractor completes the work & collects balance</p>
              </div>
            </div>
          </div>
        </div>

        {/* Email Confirmation Note */}
        {email && (
          <div className="bg-blue-900/20 rounded-lg p-4 mb-6 border border-blue-500/30">
            <p className="text-blue-300 text-sm flex items-center gap-2">
              <Mail className="w-4 h-4" />
              Confirmation email sent to <span className="font-medium">{email}</span>
            </p>
          </div>
        )}

        {/* Contact Info */}
        <div className="text-center pt-4 border-t border-gray-700">
          <p className="text-gray-400 text-sm mb-2">Questions? Get in touch:</p>
          <div className="flex items-center justify-center gap-4">
            <a href="tel:08001234567" className="text-[#e8b323] hover:underline flex items-center gap-1">
              <Phone className="w-4 h-4" />
              0800 123 4567
            </a>
            <span className="text-gray-600">|</span>
            <a href="mailto:hello@handyservices.co.uk" className="text-[#e8b323] hover:underline flex items-center gap-1">
              <Mail className="w-4 h-4" />
              Email Us
            </a>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
