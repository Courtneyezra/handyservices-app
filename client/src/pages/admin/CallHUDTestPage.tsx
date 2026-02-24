import React, { useState, useEffect } from 'react';
import { CallHUD } from '@/components/live-call';
import type { CustomerInfo } from '@/components/live-call/CallHUD';
import { Button } from '@/components/ui/button';
import type { CallScriptSegment } from '@shared/schema';

type HUDSegment = Exclude<CallScriptSegment, 'EMERGENCY'>;

/**
 * Test page for CallHUD
 * Access via /admin/call-hud
 */
export default function CallHUDTestPage() {
  const [segment, setSegment] = useState<HUDSegment | null>(null);
  const [aiSegment] = useState<HUDSegment | null>('LANDLORD');
  const [duration, setDuration] = useState(0);
  const [scenario, setScenario] = useState<'listening' | 'matched' | 'mixed'>('listening');

  const [customerInfo, setCustomerInfo] = useState<CustomerInfo>({
    name: '',
    whatsappSameAsCalling: null,
    whatsappNumber: '',
    address: '',
  });

  // Timer
  useEffect(() => {
    const timer = setInterval(() => setDuration(d => d + 1), 1000);
    return () => clearInterval(timer);
  }, []);

  // Scenarios
  const scenarios = {
    listening: {
      segment: null as HUDSegment | null,
      jobs: [],
    },
    matched: {
      segment: 'LANDLORD' as HUDSegment,
      jobs: [
        { id: '1', description: 'Leak under sink', matched: true, pricePence: 8500 },
        { id: '2', description: 'Tap washer replacement', matched: true, pricePence: 4500 },
      ],
    },
    mixed: {
      segment: 'BUSY_PRO' as HUDSegment,
      jobs: [
        { id: '1', description: 'TV wall mounting', matched: true, pricePence: 9500 },
        { id: '2', description: 'Boiler making noise', matched: false },
      ],
    },
  };

  const current = scenarios[scenario];

  useEffect(() => {
    setSegment(current.segment);
  }, [scenario]);

  const resetScenario = (s: typeof scenario) => {
    setScenario(s);
    setDuration(0);
    setCustomerInfo({
      name: '',
      whatsappSameAsCalling: null,
      whatsappNumber: '',
      address: '',
    });
  };

  return (
    <div className="h-screen flex flex-col">
      {/* Test Controls */}
      <div className="bg-purple-600 text-white px-3 py-2 flex items-center gap-4 flex-shrink-0">
        <span className="text-xs font-medium">TEST:</span>
        <div className="flex gap-2">
          {(['listening', 'matched', 'mixed'] as const).map((s) => (
            <Button
              key={s}
              size="sm"
              variant={scenario === s ? 'secondary' : 'ghost'}
              className="h-6 text-xs px-3"
              onClick={() => resetScenario(s)}
            >
              {s === 'listening' && 'Listen'}
              {s === 'matched' && 'All Matched'}
              {s === 'mixed' && 'Mixed'}
            </Button>
          ))}
        </div>
      </div>

      {/* HUD */}
      <div className="flex-1">
        <CallHUD
          selectedSegment={segment}
          aiRecommendedSegment={aiSegment}
          onSegmentSelect={setSegment}
          jobs={current.jobs}
          customerInfo={customerInfo}
          onCustomerInfoChange={setCustomerInfo}
          callingNumber="+44 7700 900123"
          callDuration={duration}
          onQuote={() => alert('SEND QUOTE\n\nName: ' + customerInfo.name + '\nAddress: ' + customerInfo.address)}
          onVideo={() => alert('GET VIDEO → Sending WhatsApp to ' + (customerInfo.whatsappSameAsCalling ? 'calling number' : customerInfo.whatsappNumber))}
          onVisit={() => alert('BOOK VISIT → ' + customerInfo.address)}
        />
      </div>
    </div>
  );
}
