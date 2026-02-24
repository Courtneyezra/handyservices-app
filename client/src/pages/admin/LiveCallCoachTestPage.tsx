import React, { useState, useEffect } from 'react';
import { LiveCallCoach } from '@/components/live-call';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import type { CallScriptSegment } from '@shared/schema';

/**
 * Test page for previewing the new LiveCallCoach interface
 * Access via /admin/live-call-coach
 */
export default function LiveCallCoachTestPage() {
  const [scenario, setScenario] = useState<'landlord' | 'emergency' | 'busy_pro'>('landlord');
  const [callDuration, setCallDuration] = useState(42);
  const [key, setKey] = useState(0);

  // Simulate call timer
  useEffect(() => {
    const timer = setInterval(() => setCallDuration(d => d + 1), 1000);
    return () => clearInterval(timer);
  }, []);

  // Test scenarios
  const scenarios = {
    landlord: {
      phoneNumber: '+447700900123',
      segments: [
        { speaker: 'caller' as const, text: "Hi, I own a rental property in Brixton and my tenant just messaged me about a leak under the kitchen sink.", timestamp: Date.now() - 30000, isFinal: true },
        { speaker: 'agent' as const, text: "I can help with that. Is this property you manage yourself or through an agent?", timestamp: Date.now() - 25000, isFinal: true },
        { speaker: 'caller' as const, text: "It's mine, I manage it myself. I'm about 2 hours away so I can't check it.", timestamp: Date.now() - 20000, isFinal: true },
      ],
      segment: 'LANDLORD' as CallScriptSegment,
      segmentConfidence: 92,
      segmentSignals: ['rental property', 'tenant', "can't check it", 'I manage it myself'],
      segmentAlternatives: [
        { segment: 'PROP_MGR' as CallScriptSegment, confidence: 35 },
        { segment: 'BUSY_PRO' as CallScriptSegment, confidence: 20 },
      ],
      detectedJobs: [
        { id: 'job-1', description: 'leak under kitchen sink', matched: true, sku: { name: 'Leak Repair', pricePence: 12500 }, confidence: 94 },
      ],
      recommendedRoute: 'INSTANT_QUOTE' as const,
      routeReason: 'All jobs matched to SKUs',
      capturedInfo: { name: null, postcode: 'SW9', contact: null, job: 'leak under sink' },
    },
    emergency: {
      phoneNumber: '+447911123456',
      segments: [
        { speaker: 'caller' as const, text: "Hello, I've got water pouring through my ceiling! The flat above must have a burst pipe or something.", timestamp: Date.now() - 15000, isFinal: true },
        { speaker: 'agent' as const, text: "I understand, that sounds urgent. Have you been able to turn off the water?", timestamp: Date.now() - 10000, isFinal: true },
        { speaker: 'caller' as const, text: "No, I don't know where the stopcock is. Please, can someone come now?", timestamp: Date.now() - 5000, isFinal: true },
      ],
      segment: 'EMERGENCY' as CallScriptSegment,
      segmentConfidence: 98,
      segmentSignals: ['water pouring', 'burst pipe', 'come now', 'urgent'],
      segmentAlternatives: [],
      detectedJobs: [
        { id: 'job-1', description: 'burst pipe / ceiling leak', matched: false, confidence: 65 },
      ],
      recommendedRoute: 'SITE_VISIT' as const,
      routeReason: 'Emergency - needs immediate dispatch',
      capturedInfo: { name: null, postcode: null, contact: null, job: 'burst pipe ceiling leak' },
    },
    busy_pro: {
      phoneNumber: '+447800555123',
      segments: [
        { speaker: 'caller' as const, text: "Hi, I need someone to mount a TV and hide the cables. I'm working from home all week.", timestamp: Date.now() - 20000, isFinal: true },
        { speaker: 'agent' as const, text: "Sure, we can do that. What size is the TV?", timestamp: Date.now() - 15000, isFinal: true },
        { speaker: 'caller' as const, text: "65 inch. I want it on a plasterboard wall. Can you give me a price now? I've got a meeting in 5 minutes.", timestamp: Date.now() - 10000, isFinal: true },
      ],
      segment: 'BUSY_PRO' as CallScriptSegment,
      segmentConfidence: 88,
      segmentSignals: ['working from home', 'meeting in 5 minutes', 'price now'],
      segmentAlternatives: [
        { segment: 'LANDLORD' as CallScriptSegment, confidence: 15 },
      ],
      detectedJobs: [
        { id: 'job-1', description: 'mount 65 inch TV', matched: true, sku: { name: 'TV Wall Mounting (Large)', pricePence: 9500 }, confidence: 95 },
        { id: 'job-2', description: 'hide cables in wall', matched: true, sku: { name: 'Cable Concealment', pricePence: 4500 }, confidence: 88 },
      ],
      recommendedRoute: 'INSTANT_QUOTE' as const,
      routeReason: 'All jobs matched - ready to quote',
      capturedInfo: { name: null, postcode: null, contact: null, job: 'TV mounting + cables' },
    },
  };

  const current = scenarios[scenario];

  const handleScenarioChange = (s: typeof scenario) => {
    setScenario(s);
    setKey(k => k + 1);
    setCallDuration(42);
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Test Mode Banner */}
      <div className="bg-purple-600 text-white px-4 py-2 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Badge variant="secondary" className="bg-purple-800">TEST MODE</Badge>
          <span className="text-sm">LiveCallCoach - "The Coach" Interface</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm opacity-75">Scenario:</span>
          <div className="flex gap-1">
            <Button
              size="sm"
              variant={scenario === 'landlord' ? 'secondary' : 'ghost'}
              className="h-7 text-xs"
              onClick={() => handleScenarioChange('landlord')}
            >
              Landlord
            </Button>
            <Button
              size="sm"
              variant={scenario === 'emergency' ? 'secondary' : 'ghost'}
              className="h-7 text-xs"
              onClick={() => handleScenarioChange('emergency')}
            >
              Emergency
            </Button>
            <Button
              size="sm"
              variant={scenario === 'busy_pro' ? 'secondary' : 'ghost'}
              className="h-7 text-xs"
              onClick={() => handleScenarioChange('busy_pro')}
            >
              Busy Pro
            </Button>
          </div>
        </div>
      </div>

      {/* Main Coach Interface */}
      <div className="h-[calc(100vh-40px)]">
        <LiveCallCoach
          key={key}
          phoneNumber={current.phoneNumber}
          callDuration={callDuration}
          segments={current.segments}
          segment={current.segment}
          segmentConfidence={current.segmentConfidence}
          segmentSignals={current.segmentSignals}
          segmentAlternatives={current.segmentAlternatives}
          onSegmentOverride={(s) => console.log('Segment override:', s)}
          detectedJobs={current.detectedJobs}
          recommendedRoute={current.recommendedRoute}
          routeReason={current.routeReason}
          capturedInfo={current.capturedInfo}
          currentTrigger="segment_detected"
          jobPricePence={current.detectedJobs.reduce((sum, j) => sum + ('sku' in j && j.sku ? j.sku.pricePence : 0), 0)}
          onSendQuote={() => console.log('Send Quote clicked')}
          onRequestVideo={() => console.log('Request Video clicked')}
          onBookVisit={() => console.log('Book Visit clicked')}
          onEndCall={() => console.log('End Call clicked')}
        />
      </div>
    </div>
  );
}
