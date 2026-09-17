import { useEffect, useState } from "react";
import { adminAuthHeaders } from "@/lib/admin-auth";

/**
 * GET /api/calls/:id/recording is behind requireAdmin, which reads only the Authorization header,
 * and an <audio src> cannot send one. So the recording is fetched with the admin header and played
 * from an object URL.
 */
export async function fetchAdminRecordingUrl(callId: string): Promise<string> {
    const res = await fetch(`/api/calls/${callId}/recording`, { headers: adminAuthHeaders() });
    if (!res.ok) throw new Error(`Recording request failed (${res.status})`);
    return URL.createObjectURL(await res.blob());
}

/** The recording's object URL once `enabled`; null until loaded or on failure. Revoked on change. */
export function useAdminRecordingUrl(callId: string | null | undefined, enabled: boolean) {
    const [url, setUrl] = useState<string | null>(null);
    const [failed, setFailed] = useState(false);

    useEffect(() => {
        if (!callId || !enabled) return;
        let cancelled = false;
        let objectUrl: string | null = null;
        setFailed(false);
        fetchAdminRecordingUrl(callId)
            .then((u) => {
                if (cancelled) {
                    URL.revokeObjectURL(u);
                    return;
                }
                objectUrl = u;
                setUrl(u);
            })
            .catch(() => {
                if (!cancelled) setFailed(true);
            });
        return () => {
            cancelled = true;
            if (objectUrl) URL.revokeObjectURL(objectUrl);
            setUrl(null);
        };
    }, [callId, enabled]);

    return { url, failed };
}
