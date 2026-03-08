import React from "react";
import { Button } from "@/components/ui/button";
import { PhoneOff } from "lucide-react";
import { useLiveCall } from "@/contexts/LiveCallContext";
import { LiveCallHUD } from "@/components/live-call";

export default function LiveCallPage() {
    const {
        isLive,
        activeCallSid,
        liveCallData,
        clearCall,
    } = useLiveCall();

    return (
        <div className="h-screen bg-slate-950 text-white flex flex-col">
            {!isLive ? (
                /* No Active Call */
                <div className="flex-1 flex flex-col items-center justify-center p-8">
                    <div className="text-center">
                        <PhoneOff className="h-16 w-16 text-slate-600 mx-auto mb-4" />
                        <h1 className="text-3xl font-bold text-slate-300 mb-2">
                            No Active Call
                        </h1>
                        <p className="text-slate-500 max-w-md">
                            When a call comes in, the live tube map will guide you through segmentation and routing.
                        </p>
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
