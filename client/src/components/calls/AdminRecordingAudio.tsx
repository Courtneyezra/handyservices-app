import { useState } from "react";
import { Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAdminRecordingUrl } from "@/hooks/useAdminRecording";

/**
 * A call recording player for admin pages. The recording route needs the admin header, which an
 * <audio src> cannot send, so nothing is downloaded until the player is asked for.
 */
export function AdminRecordingAudio({ callId, className }: { callId: string; className?: string }) {
    const [requested, setRequested] = useState(false);
    const { url, failed } = useAdminRecordingUrl(callId, requested);

    if (!requested) {
        return (
            <Button type="button" variant="outline" size="sm" onClick={() => setRequested(true)}>
                <Play className="w-3 h-3 mr-1" />
                Load recording
            </Button>
        );
    }
    if (failed) return <p className="text-xs text-destructive">Could not load the recording.</p>;
    if (!url) return <p className="text-xs text-muted-foreground">Loading recording…</p>;
    return <audio controls autoPlay preload="auto" className={className} src={url} />;
}
