import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { Play, PhoneOff } from "lucide-react";
import { useLiveCall } from "@/contexts/LiveCallContext";
import { LiveCallHUD } from "@/components/live-call";

// Test scenarios for simulation - using job descriptions that match the 60 productized SKUs
const TEST_SCENARIOS = [
    {
        name: "Tap Repair",
        transcript: [
            "Hi, my kitchen tap is dripping constantly",
            "It's been leaking for a few days now",
            "My name is John Smith, I'm at 45 Oak Street, SW11 5TN",
            "My number is 07700 900456"
        ]
    },
    {
        name: "TV Mount",
        transcript: [
            "Hi I need a TV mounted on the wall",
            "It's a 55 inch Samsung, going on a plasterboard wall",
            "I'm Sarah at 12 Willow Road, E14 5AB",
            "Can you text me on 07700 900789"
        ]
    },
    {
        name: "Multiple Jobs",
        transcript: [
            "Hi I've got a few things that need doing",
            "I need 3 floating shelves put up and also a curtain pole fitted",
            "Plus my toilet keeps running and won't stop",
            "I'm Tom Richards at 8 High Street, SW6 1AA, number is 07700 900321"
        ]
    },
    {
        name: "Flatpack",
        transcript: [
            "Hello, I need someone to build a PAX wardrobe from IKEA",
            "It's a big one with sliding doors, about 2 metres tall",
            "I'm Emma Davis in Wimbledon, SW19 4AA",
            "Best to reach me on 07700 900987"
        ]
    },
    {
        name: "Landlord",
        transcript: [
            "Hi I'm a landlord, I own a rental flat in Clapham",
            "The tenant says the bath silicone is mouldy and there's a blocked sink",
            "I can't be there myself, I'm based in Manchester",
            "It's James Wilson, 07700 900456, the property is at 45 Acre Lane, SW2 5TN"
        ]
    },
    {
        name: "Mixed (Quote + Video)",
        transcript: [
            "Hi I've got two problems",
            "My bathroom tap is dripping which I need fixed",
            "And my boiler is making a weird banging noise",
            "I'm Mike Thompson at 12 Richmond Road, TW1 3BB, 07700 900654"
        ]
    },
    // Realistic traffic light test scenarios
    {
        name: "Boiler Issue",
        transcript: [
            "Hi the boiler's been making a weird banging noise",
            "And it's not heating the water properly",
            "Been like this for a few days now",
            "I'm at 23 Station Road, SE15 4AA, 07700 900111"
        ]
    },
    {
        name: "Damp & Mould",
        transcript: [
            "Hi I've noticed some damp on the wall in the bedroom",
            "There's a bit of mould appeared in the corner too",
            "Not sure if it's condensation or something worse",
            "I'm Dave at 18 London Road, SW4 5TT, 07700 900333"
        ]
    },
    {
        name: "Mixed Jobs",
        transcript: [
            "Hi I've got a few bits that need doing",
            "The kitchen tap's been dripping for ages",
            "And the bathroom extractor fan stopped working",
            "Plus there's a crack appeared above the door",
            "I'm Lisa at 42 Church Street, W11 2AB, 07700 900444"
        ]
    },
    {
        name: "Vague Problem",
        transcript: [
            "Hi I'm not really sure what's wrong",
            "There's water appearing under the kitchen sink",
            "Could be a leak somewhere but I can't see where",
            "I'm Tom at 8 Green Lane, E3 2AB, 07700 900555"
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
