/**
 * Test harness for the 3-date picker SingleProductQuote component.
 * Access at /admin/test-date-picker
 */
import { useState } from 'react';
import { SingleProductQuote } from '@/components/quote/SingleProductQuote';
import { format } from 'date-fns';

export default function TestDatePicker() {
  const [lastBooking, setLastBooking] = useState<any>(null);

  return (
    <div className="min-h-screen bg-slate-950 p-4 space-y-6">
      <div className="max-w-lg mx-auto">
        <h1 className="text-white text-xl font-bold mb-1">3-Date Picker Test</h1>
        <p className="text-slate-400 text-sm mb-6">Testing the multi-date selection flow</p>
      </div>

      <SingleProductQuote
        serviceName="Tap Fixed, TV Mounted, Lights Sorted"
        basePrice={21109}
        customerName="John Smith"
        jobDescription="Fix leaking tap, mount TV, replace light switches"
        segment="BUSY_PRO"
        onBook={(config) => {
          setLastBooking({
            primaryDate: format(config.selectedDate, 'yyyy-MM-dd EEE'),
            allDates: config.selectedDates?.map(d => format(d, 'yyyy-MM-dd EEE')) || [],
            timeSlot: config.timeSlot,
            addOns: config.addOns,
            totalPrice: config.totalPrice,
          });
        }}
        isBooking={false}
      />

      {/* Debug output */}
      {lastBooking && (
        <div className="max-w-lg mx-auto bg-slate-800 rounded-xl p-4 space-y-2">
          <h3 className="text-white font-semibold text-sm">onBook() output:</h3>
          <pre className="text-xs text-slate-300 overflow-auto whitespace-pre-wrap">
            {JSON.stringify(lastBooking, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}
