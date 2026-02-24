import React, { useState } from 'react';
import { LiveCallContainer, type DetectedJob } from '@/components/live-call';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { CallScriptStation, CallScriptSegment } from '@shared/schema';

/**
 * Test page for previewing the Live Call Tube Map UI
 * Access via /admin/live-call-test
 */
export default function LiveCallTestPage() {
  const [testScenario, setTestScenario] = useState<'fresh' | 'mid-call' | 'near-end'>('fresh');
  const [key, setKey] = useState(0); // Force re-mount on scenario change

  // Define test scenarios
  const scenarios: Record<string, {
    station: CallScriptStation;
    completedStations: CallScriptStation[];
    segment: CallScriptSegment | null;
    capturedInfo: {
      job?: string | null;
      postcode?: string | null;
      name?: string | null;
      contact?: string | null;
    };
    detectedJobs: DetectedJob[];
  }> = {
    fresh: {
      station: 'LISTEN',
      completedStations: [],
      segment: null,
      capturedInfo: {},
      detectedJobs: [],
    },
    'mid-call': {
      station: 'SEGMENT',
      completedStations: ['LISTEN'],
      segment: 'LANDLORD',
      capturedInfo: {
        job: 'boiler repair',
        postcode: 'SW9 8LT',
      },
      detectedJobs: [
        {
          id: 'job-1',
          description: 'boiler repair',
          matched: true,
          sku: {
            id: 'SKU-BOILER-REPAIR',
            name: 'Boiler Repair',
            pricePence: 18500,
            category: 'Plumbing',
          },
          confidence: 92,
        },
        {
          id: 'job-2',
          description: 'radiator not heating up',
          matched: false,
          confidence: 45,
        },
      ],
    },
    'near-end': {
      station: 'DESTINATION',
      completedStations: ['LISTEN', 'SEGMENT', 'QUALIFY'],
      segment: 'BUSY_PRO',
      capturedInfo: {
        job: 'TV mounting',
        postcode: 'SE11 4AU',
        name: 'Sarah Jones',
        contact: '07700 900123',
      },
      detectedJobs: [
        {
          id: 'job-1',
          description: 'mount TV on wall',
          matched: true,
          sku: {
            id: 'SKU-TV-MOUNT',
            name: 'TV Wall Mounting',
            pricePence: 8500,
            category: 'Carpentry',
          },
          confidence: 98,
        },
        {
          id: 'job-2',
          description: 'hide cables in wall',
          matched: true,
          sku: {
            id: 'SKU-CABLE-CONCEAL',
            name: 'Cable Concealment',
            pricePence: 4500,
            category: 'Electrical',
          },
          confidence: 85,
        },
        {
          id: 'job-3',
          description: 'install soundbar',
          matched: true,
          sku: {
            id: 'SKU-SOUNDBAR',
            name: 'Soundbar Installation',
            pricePence: 3500,
            category: 'Electrical',
          },
          confidence: 90,
        },
      ],
    },
  };

  const handleScenarioChange = (scenario: 'fresh' | 'mid-call' | 'near-end') => {
    setTestScenario(scenario);
    setKey(k => k + 1); // Force re-mount
  };

  const currentScenario = scenarios[testScenario];

  return (
    <div className="min-h-screen bg-background">
      {/* Test Mode Banner */}
      <div className="bg-purple-600 text-white px-4 py-2 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Badge variant="secondary" className="bg-purple-800">TEST MODE</Badge>
          <span className="text-sm">Live Call Tube Map Preview</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm opacity-75">Scenario:</span>
          <div className="flex gap-1">
            <Button
              size="sm"
              variant={testScenario === 'fresh' ? 'secondary' : 'ghost'}
              className="h-7 text-xs"
              onClick={() => handleScenarioChange('fresh')}
            >
              Fresh Call
            </Button>
            <Button
              size="sm"
              variant={testScenario === 'mid-call' ? 'secondary' : 'ghost'}
              className="h-7 text-xs"
              onClick={() => handleScenarioChange('mid-call')}
            >
              Mid-Call
            </Button>
            <Button
              size="sm"
              variant={testScenario === 'near-end' ? 'secondary' : 'ghost'}
              className="h-7 text-xs"
              onClick={() => handleScenarioChange('near-end')}
            >
              Near End
            </Button>
          </div>
        </div>
      </div>

      <div className="flex h-[calc(100vh-40px)]">
        {/* Main Live Call UI */}
        <div className="flex-1 border-r">
          <LiveCallContainer
            key={key}
            callId="test-call-001"
            initialStation={currentScenario.station}
            initialCompletedStations={currentScenario.completedStations}
            initialSegment={currentScenario.segment}
            initialCapturedInfo={currentScenario.capturedInfo}
            initialDetectedJobs={currentScenario.detectedJobs}
          />
        </div>

        {/* Debug Panel */}
        <div className="w-80 p-4 bg-muted/30 overflow-auto">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Debug Info</CardTitle>
            </CardHeader>
            <CardContent className="text-xs space-y-3">
              <div>
                <div className="text-muted-foreground">Current Station</div>
                <div className="font-mono">{currentScenario.station}</div>
              </div>
              <div>
                <div className="text-muted-foreground">Completed Stations</div>
                <div className="font-mono">{currentScenario.completedStations.join(', ') || 'None'}</div>
              </div>
              <div>
                <div className="text-muted-foreground">Detected Segment</div>
                <div className="font-mono">{currentScenario.segment || 'None'}</div>
              </div>
              <div>
                <div className="text-muted-foreground">Captured Info</div>
                <pre className="font-mono bg-background p-2 rounded text-[10px] overflow-auto">
                  {JSON.stringify(currentScenario.capturedInfo, null, 2)}
                </pre>
              </div>
            </CardContent>
          </Card>

          <Card className="mt-4">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Usage Notes</CardTitle>
            </CardHeader>
            <CardContent className="text-xs space-y-2 text-muted-foreground">
              <p>This is a test page for the Live Call Tube Map UI component.</p>
              <p>The component shows 4 stations that unlock sequentially:</p>
              <ol className="list-decimal list-inside space-y-1 ml-2">
                <li>LISTEN - Gather initial info</li>
                <li>SEGMENT - Identify customer type</li>
                <li>QUALIFY - Confirm decision maker</li>
                <li>DESTINATION - Choose next action</li>
              </ol>
              <p className="mt-2">The VA manually approves AI recommendations at each step.</p>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
