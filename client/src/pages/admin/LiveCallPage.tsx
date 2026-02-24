import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { Play, PhoneOff } from "lucide-react";
import { useLiveCall } from "@/contexts/LiveCallContext";
import { LiveCallHUD } from "@/components/live-call";

// Test scenarios for simulation
const TEST_SCENARIOS = [
    {
        name: "Landlord",
        transcript: [
            "Hi I own a rental property in Battersea",
            "The tenant reported a leak in the bathroom",
            "I am the landlord and live in Birmingham so cannot be there"
        ]
    },
    {
        name: "Emergency",
        transcript: [
            "My pipe has burst and water is everywhere",
            "Its flooding the kitchen right now",
            "I need someone immediately"
        ]
    },
    {
        name: "Busy Pro",
        transcript: [
            "Hi I need someone to fix my boiler",
            "I work from home but have meetings all day",
            "Can you give me an exact time slot"
        ]
    },
    {
        name: "OAP",
        transcript: [
            "Hello dear I am having trouble with my radiator",
            "I am 78 and live alone",
            "Are you insured? I want to make sure"
        ]
    },
];

export default function LiveCallPage() {
    const {
        isLive,
        activeCallSid,
        liveCallData,
        startCallScriptSimulation,
        clearCall,
    } = useLiveCall();

    const [isStartingSimulation, setIsStartingSimulation] = useState(false);

    // Start simulation using the context function
    const handleStartSimulation = async (scenario?: typeof TEST_SCENARIOS[0]) => {
        if (isStartingSimulation) return;
        setIsStartingSimulation(true);

        try {
            const selectedScenario = scenario || TEST_SCENARIOS[Math.floor(Math.random() * TEST_SCENARIOS.length)];
            await startCallScriptSimulation(selectedScenario.transcript);
        } finally {
            setIsStartingSimulation(false);
        }
    };

    return (
        <div className="h-screen bg-slate-950 text-white flex flex-col">
            {!isLive ? (
                /* No Active Call - Show simulation options */
                <div className="flex-1 flex flex-col items-center justify-center p-8">
                    <div className="text-center mb-12">
                        <PhoneOff className="h-16 w-16 text-slate-600 mx-auto mb-4" />
                        <h1 className="text-3xl font-bold text-slate-300 mb-2">
                            No Active Call
                        </h1>
                        <p className="text-slate-500 max-w-md">
                            When a call comes in, the live tube map will guide you through segmentation and routing.
                        </p>
                    </div>

                    <div className="text-slate-400 text-sm mb-4">Test with a simulation:</div>

                    <div className="grid grid-cols-2 gap-4 max-w-lg">
                        {TEST_SCENARIOS.map((scenario) => (
                            <Button
                                key={scenario.name}
                                variant="outline"
                                onClick={() => handleStartSimulation(scenario)}
                                disabled={isStartingSimulation}
                                className="h-20 flex flex-col gap-1 bg-slate-900 border-slate-700 hover:bg-slate-800 hover:border-slate-600"
                            >
                                <Play className="h-5 w-5" />
                                <span className="font-semibold">{scenario.name}</span>
                            </Button>
                        ))}
                    </div>
                </div>
            ) : (
                /* Live Call - Show tube map */
                <div className="flex-1 flex flex-col">
                    {/* End call button */}
                    <div className="absolute top-4 right-4 z-20">
                        <Button
                            variant="destructive"
                            size="sm"
                            onClick={clearCall}
                        >
                            <PhoneOff className="h-4 w-4 mr-2" />
                            End Call
                        </Button>
                    </div>

                    {/* CallHUD - Minimal glanceable VA interface */}
                    {activeCallSid ? (
                        <LiveCallHUD
                            onQuote={() => console.log('Generate quote')}
                            onVideo={() => console.log('Request video')}
                            onVisit={() => console.log('Book visit')}
                        />
                    ) : (
                        <div className="flex-1 flex items-center justify-center">
                            <div className="text-slate-500">Initializing...</div>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
